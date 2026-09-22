/* ============================================================================
   AGENDA PRO — app/supabase-client.js
   LE CLIENT SUPABASE PARTAGE PAR TOUTES LES BRIQUES.
   ----------------------------------------------------------------------------
   Ce fichier fait trois choses, et rien d'autre :
     1. il decide s'il y a lieu de se connecter au serveur (config remplie ?) ;
     2. il telecharge la librairie Supabase depuis un CDN ;
     3. il fabrique UN client, un seul, publie dans window.AP.sb.

   POURQUOI UN SEUL CLIENT ?
   Chaque client Supabase tient sa propre copie de la session et son propre
   minuteur de rafraichissement du jeton. En creer deux, c'est avoir deux
   horloges qui se marchent dessus : l'un renouvelle le jeton, l'autre garde
   l'ancien, et l'utilisateur est deconnecte sans raison apparente. Les cinq
   autres briques (synchro, facturation, interface...) utilisent donc
   window.AP.sb et n'appellent JAMAIS createClient elles-memes.

   POURQUOI LE CDN EST CHARGE PAR DU CODE, ET NON PAR UNE BALISE <script> ?
   Parce qu'une balise <script src="https://…"> qui echoue (pas d'internet
   dans l'atelier, CDN bloque par un pare-feu) laisse une erreur rouge dans la
   console et, surtout, oblige a respecter un ordre de chargement fragile. Ici
   l'echec est prevu, attrape, et l'application repart en mode local sans un
   mot. C'est la regle numero un du projet : on ne casse jamais l'existant.

   CE QUE CE FICHIER PUBLIE :
     window.AP        l'espace de noms commun (le seul ajoute au global)
     window.AP.sb     le client, ou null tant qu'il n'existe pas
     window.AP.ready  une promesse resolue avec le client, ou avec null
     window.AP.status un petit bulletin de sante lisible a tout moment
   ============================================================================ */

(function () {
  'use strict';

  var W = window;
  W.AP = W.AP || {};
  var AP = W.AP;

  /* Deja charge (double inclusion de la balise script) : on ne refait rien. */
  if (AP.ready) { return; }

  var CFG = W.AP_CONFIG || {};

  /* Bulletin de sante. L'interface s'en sert pour expliquer a l'utilisateur
     POURQUOI il est hors ligne, au lieu d'afficher un echec muet. */
  AP.sb = null;
  AP.status = {
    configured: false,   // le fichier config.js est-il rempli ?
    libLoaded: false,    // la librairie a-t-elle ete telechargee ?
    /* integrite : la librairie du CDN est-elle verifiee par une empreinte
       (SRI) ? false = elle est executee sur parole, voir la section 2. */
    integrite: false,
    reason: 'non-configure'
  };

  /* --------------------------------------------------------------------- */
  /* 1. CONFIGURATION ABSENTE = SILENCE TOTAL                              */
  /* --------------------------------------------------------------------- */
  /* Pas d'adresse, pas de cle : on n'essaie meme pas. Aucune requete, aucun
     message dans la console, aucune balise ajoutee a la page. L'application
     reste ce qu'elle est aujourd'hui : un fichier autonome qui travaille dans
     le localStorage du navigateur. */
  if (!CFG.supabaseUrl || !CFG.supabaseAnonKey) {
    AP.ready = Promise.resolve(null);
    return;
  }

  AP.status.configured = true;
  AP.status.reason = 'chargement';

  /* --------------------------------------------------------------------- */
  /* 2. TELECHARGEMENT DE LA LIBRAIRIE                                     */
  /* --------------------------------------------------------------------- */
  /* Le format « umd » est celui qui fonctionne avec une simple balise
     <script> : il depose un objet global window.supabase. Le format « esm »,
     lui, exigerait un assembleur (bundler), que ce projet s'interdit.

     ---------------------------------------------------------------------
     LE RISQUE, EN CLAIR, ET CE QU'IL FAUT FAIRE.
     ---------------------------------------------------------------------
     Le script telecharge ici s'execute dans la page avec TOUS ses droits, et
     c'est lui qui detient la session : il peut lire localStorage, donc la cle
     'agendapro_auth' posee plus bas (persistSession:true), donc l'access_token
     ET le refresh_token. Quiconque parvient a modifier l'octet servi par le
     CDN — publication malveillante en amont, compte npm compromis, incident
     chez le CDN — devient l'utilisateur : toutes les policies RLS lui
     repondent oui, puisqu'il presente le jeton de l'utilisateur.
     Aggravant : app/pwa/sw.js met cdn.jsdelivr.net en cache « reserve
     d'abord ». Une copie empoisonnee serait EPINGLEE sur le telephone de
     l'artisan et resservie a chaque ouverture jusqu'au prochain changement de
     VERSION du service worker, meme apres que le CDN a ete nettoye.

     DEUX CORRECTIONS SONT DEJA APPLIQUEES ICI :
       1. la source « flottante » @2 a ete SUPPRIMEE. Elle changeait de contenu
          par conception a chaque publication amont : elle etait donc, par
          construction, impossible a verifier par une empreinte. Et le repli se
          declenchait tout seul des que la premiere adresse etait lente — il
          suffisait donc de ralentir la premiere pour faire servir la seconde.
          Il ne reste qu'une adresse, figee sur une version exacte.
       2. le mecanisme d'integrite (SRI) est en place : chargerUne() pose
          `script.integrity` des qu'une empreinte est renseignee ci-dessous.
          Si l'octet servi ne correspond pas a l'empreinte, le navigateur
          REFUSE d'executer le fichier et l'on bascule sur la source suivante.

     CE QUI RESTE A FAIRE, ET QUI N'A PAS PU L'ETRE ICI :
     le champ `integrity` est VIDE. L'empreinte n'a PAS ete calculee — cela
     demande de telecharger le fichier reel — et aucune valeur n'a ete
     inventee : une empreinte fausse bloquerait la librairie, une empreinte
     inventee donnerait l'illusion d'une protection, ce qui est pire que pas
     de protection du tout. TANT QUE LE CHAMP EST VIDE, LA PROTECTION N'EXISTE
     PAS et le risque decrit ci-dessus reste entier ; AP.status.integrite vaut
     alors false. Ne publiez pas en production sans avoir fait ce qui suit.

     MARCHE A SUIVRE POUR FIGER UNE VERSION VERIFIEE (5 minutes, une fois) :
       a) Calculer l'empreinte de l'adresse, dans PowerShell :

            $url = 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.45.4/dist/umd/supabase.js'
            $tmp = Join-Path $env:TEMP 'supabase-umd.js'
            Invoke-WebRequest -Uri $url -OutFile $tmp
            $h = [System.Security.Cryptography.SHA384]::Create()
            'sha384-' + [Convert]::ToBase64String($h.ComputeHash([System.IO.File]::ReadAllBytes($tmp)))

          (equivalent sous Linux/macOS :
             curl -sL "$url" | openssl dgst -sha384 -binary | openssl base64 -A )

       b) Recouper la valeur avec une seconde source AVANT de la coller : la
          page jsdelivr du paquet affiche elle-meme l'empreinte SRI de chaque
          fichier (bouton « SRI »). Si les deux ne concordent pas, ARRETEZ-VOUS :
          ce que vous venez de telecharger n'est pas ce qui a ete publie.
       c) Coller la valeur obtenue, en entier et avec son prefixe `sha384-`,
          dans le champ `integrity` ci-dessous, puis recharger l'application.
          Si elle fonctionne encore, l'empreinte est bonne. Si la console
          signale un refus d'integrite, c'est que la valeur a ete mal recopiee
          (ou que le fichier a change entre a et c — recommencez en a).
       d) A chaque montee de version : refaire a), b), c). Changer le numero de
          version SANS refaire l'empreinte bloque la librairie — c'est voulu,
          c'est exactement ce que le mecanisme doit faire.

     LE PLUS SUR RESTE DE NE PAS DEPENDRE D'UN CDN : telecharger une fois le
     fichier umd, le deposer a cote de index.html (par exemple
     app/vendor/supabase-2.45.4.umd.js) et le mettre en PREMIERE entree de
     SOURCES, avec un chemin relatif et sans empreinte (elle ne sert a rien sur
     sa propre origine). Il est alors servi par votre propre domaine, il entre
     dans le depot Git, il est visible dans les diffs, et plus aucun tiers ne
     peut le remplacer. Le projet s'interdit un assembleur, pas un fichier
     copie. */
  var SOURCES = [
    {
      url: 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.45.4/dist/umd/supabase.js',
      /* Empreinte NON calculee — voir le mode d'emploi ci-dessus. */
      integrity: ''
    }
    /* IL N'Y A PLUS DE SECONDE SOURCE, ET C'EST VOLONTAIRE.
       L'ancienne etait la version flottante @2, impossible a verifier. La
       remplacer par un second CDN (unpkg, esm.sh...) serait tentant, mais ce
       serait un piege : la politique de securite de l'application de bureau
       (app/desktop/main.js, fonction politiqueSecurite()) n'autorise que
       cdn.jsdelivr.net dans script-src. Un second domaine marcherait dans
       Chrome et serait BLOQUE EN SILENCE dans l'application de bureau — la
       panne la plus penible a diagnostiquer.
       Si vous voulez vraiment un second fournisseur, les trois choses vont
       ensemble et aucune ne se saute : (1) l'adresse en version EXACTE ici,
       (2) SON empreinte calculee separement, (3) son domaine ajoute a
       script-src ET a connect-src dans politiqueSecurite(). Sinon, le vrai
       filet de secours reste le fichier depose a cote de index.html, decrit
       juste au-dessus : il ne depend d'aucun reseau et d'aucune CSP. */
  ];

  /* AP.status.integrite (declare plus haut, false au depart) passe a true
     uniquement si la source qui a REELLEMENT repondu portait une empreinte.
     C'est ce que doit verifier la recette : une page de diagnostic, ou la
     checkliste de securite, peut le lire sans ouvrir ce fichier. */

  /* Delai maximal avant de declarer le CDN injoignable. Sans ce garde-fou, un
     reseau qui « pend » (typique d'un partage de connexion telephonique dans
     une zone mal couverte) laisserait l'application en attente pour toujours. */
  var TIMEOUT_MS = 12000;

  function chargerUne(source) {
    return new Promise(function (resolve, reject) {
      var s = document.createElement('script');
      var fini = false;
      var minuteur = setTimeout(function () {
        if (fini) { return; }
        fini = true;
        s.parentNode && s.parentNode.removeChild(s);
        reject(new Error('delai depasse'));
      }, TIMEOUT_MS);

      s.src = source.url;
      s.async = true;
      /* crossOrigin : sans lui, une erreur venant du CDN arrive anonyme et
         devient impossible a diagnostiquer. Il est aussi OBLIGATOIRE pour que
         `integrity` soit pris en compte sur une ressource d'un autre domaine :
         sans en-tete CORS, le navigateur ne peut pas lire les octets pour les
         comparer, et il bloque le script. Les deux attributs vont ensemble. */
      s.crossOrigin = 'anonymous';
      /* INTEGRITE (SRI). Le navigateur calcule lui-meme l'empreinte de ce
         qu'il a recu et refuse d'executer quoi que ce soit d'autre. C'est ce
         qui transforme « je fais confiance au CDN » en « je fais confiance a
         ces octets-la, et a eux seuls » : une version empoisonnee servie a la
         place de la bonne declenche onerror, et l'on passe a la source
         suivante au lieu de lui donner la session de l'utilisateur.
         Tant que l'empreinte est vide, on ne pose RIEN : poser integrity=''
         ne protege pas, cela ferait seulement croire que si. */
      if (source.integrity) { s.integrity = source.integrity; }
      s.onload = function () {
        if (fini) { return; }
        fini = true; clearTimeout(minuteur);
        resolve();
      };
      s.onerror = function () {
        if (fini) { return; }
        fini = true; clearTimeout(minuteur);
        s.parentNode && s.parentNode.removeChild(s);
        reject(new Error('telechargement refuse'));
      };
      (document.head || document.documentElement).appendChild(s);
    });
  }

  function chargerLib() {
    /* Deja presente (une autre page l'a chargee, ou vous l'avez mise en dur).
       On ne sait rien de sa provenance : AP.status.integrite reste false, ce
       qui est la verite plutot qu'une supposition flatteuse. */
    if (W.supabase && typeof W.supabase.createClient === 'function') {
      return Promise.resolve();
    }
    /* On essaie les sources dans l'ordre. Chaque echec — reseau coupe, CDN
       bloque par un pare-feu, ET REFUS D'INTEGRITE — fait passer a la
       suivante. AP.status.integrite dit ensuite si celle qui a finalement
       repondu etait verifiee ou non. */
    function suivante(i) {
      if (i >= SOURCES.length) { return Promise.reject(new Error('telechargement refuse')); }
      var source = SOURCES[i];
      return chargerUne(source).then(
        function () { AP.status.integrite = !!source.integrity; },
        function () { return suivante(i + 1); }
      );
    }
    return suivante(0);
  }

  /* --------------------------------------------------------------------- */
  /* 3. FABRICATION DU CLIENT                                              */
  /* --------------------------------------------------------------------- */
  function fabriquer() {
    if (!W.supabase || typeof W.supabase.createClient !== 'function') {
      throw new Error('librairie absente');
    }
    AP.status.libLoaded = true;

    var client = W.supabase.createClient(CFG.supabaseUrl, CFG.supabaseAnonKey, {
      auth: {
        /* La session survit a la fermeture de l'onglet : l'artisan ne doit pas
           ressaisir son mot de passe chaque matin. */
        persistSession: true,
        /* Le jeton d'acces dure une heure au plus ; la librairie le renouvelle
           toute seule tant que l'onglet est ouvert. */
        autoRefreshToken: true,
        /* Indispensable au retour de Google et au retour d'un lien de
           reinitialisation : c'est ce reglage qui lit le code dans l'adresse
           et le transforme en session. */
        detectSessionInUrl: true,
        /* PKCE : le code renvoye dans l'adresse ne vaut rien sans un secret
           reste dans CE navigateur. Un lien de connexion intercepte (capture
           d'ecran d'une URL, historique partage) devient donc inutilisable
           ailleurs. Contrepartie honnete : le lien recu par courriel DOIT etre
           ouvert dans le meme navigateur que celui qui l'a demande. */
        flowType: 'pkce',
        /* Nom de la case de rangement dans le navigateur. On le nomme
           explicitement pour ne pas se melanger avec une autre application
           Supabase ouverte sur le meme domaine. */
        storageKey: 'agendapro_auth'
      },
      global: {
        /* Entete purement informatif : il apparait dans les journaux Supabase
           et permet de reconnaitre le trafic de l'application. */
        headers: { 'x-application-name': 'agenda-pro' }
      },
      db: { schema: 'public' }
    });

    AP.sb = client;
    AP.status.reason = 'pret';
    return client;
  }

  /* --------------------------------------------------------------------- */
  /* 4. LA PROMESSE PUBLIQUE                                               */
  /* --------------------------------------------------------------------- */
  /* Toutes les briques ecrivent :
         AP.ready.then(function (sb) { if (!sb) return; ... });
     Elle n'est JAMAIS rejetee : un `then` suffit, personne n'a besoin d'un
     `catch`, et un oubli de `catch` ne peut donc pas produire d'erreur rouge
     dans la console d'un client. */
  AP.ready = chargerLib()
    .then(fabriquer)
    .catch(function (e) {
      AP.sb = null;
      AP.status.libLoaded = !!(W.supabase && W.supabase.createClient);
      AP.status.reason = (e && e.message === 'librairie absente')
        ? 'librairie-invalide'
        : 'cdn-injoignable';
      /* Volontairement muet : pas de console.error. Un artisan qui travaille
         hors ligne n'a pas a voir de rouge dans sa console, et l'interface
         affichera de toute facon une pastille « hors ligne » lisible. */
      return null;
    });
})();
