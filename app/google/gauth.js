/* ============================================================================
   AGENDA PRO — app/google/gauth.js
   LA BRIQUE « CONNEXION GOOGLE », SANS SERVEUR.
   ----------------------------------------------------------------------------

   ###########################################################################
   #  LA REGLE QUI PASSE AVANT TOUT LE RESTE — L'AGENDA N'EST PAS A NOUS     #
   #  --------------------------------------------------------------------   #
   #  Cet agenda Google est le VRAI agenda de l'artisan. Sa femme y voit     #
   #  les rendez-vous, son telephone y sonne, ses clients y sont invites.    #
   #  Le programme n'a donc PAS le droit de toucher a :                      #
   #                                                                         #
   #      summary       (le titre du rendez-vous)                            #
   #      description   (le texte du rendez-vous)                            #
   #      start / end   (la date et l'heure)                                 #
   #      attendees     (les personnes invitees)                             #
   #      recurrence    (« tous les lundis »)                                #
   #                                                                         #
   #  Il n'ecrit QUE dans extendedProperties.private — un tiroir cache que   #
   #  Google transporte d'un appareil a l'autre et que l'application Agenda  #
   #  de Google n'affiche jamais. C'est la que vont le statut, la liste des  #
   #  documents cochee, les notes de l'artisan, le contact, le lieu, la      #
   #  sous-categorie et la section.                                          #
   #                                                                         #
   #  DEUX SEULES EXCEPTIONS :                                               #
   #    1. une tache que l'artisan cree LUI-MEME depuis le programme ;       #
   #    2. une modification qu'il demande EXPLICITEMENT.                     #
   #                                                                         #
   #  ET CETTE REGLE N'EST PAS QU'UN COMMENTAIRE. Elle est appliquee par le  #
   #  code, a la PARTIE 3 : toute requete vers Google passe obligatoirement  #
   #  par AP.gauth.appel(), qui OUVRE le contenu de la requete et la REFUSE  #
   #  si elle contient un champ interdit. Une brique qui se tromperait       #
   #  recevrait une erreur claire avant que le moindre octet ne parte.       #
   ###########################################################################


   CE QUE FAIT CE FICHIER, EN UNE PHRASE
   -------------------------------------
   Il obtient de Google un « jeton d'acces » — un laissez-passer temporaire —
   et il le tient a disposition de la brique moteur, qui s'en sert pour lire
   et annoter les rendez-vous. Il ne synchronise rien lui-meme.


   POURQUOI GOOGLE EST DEVENU LA SOURCE DE VERITE
   ----------------------------------------------
   L'artisan veut travailler depuis son bureau ET depuis son telephone, et
   retrouver la meme chose des deux cotes. Google Agenda sait deja faire
   voyager les RENDEZ-VOUS entre ses appareils, gratuitement et sans serveur
   a nous. Ce qui ne voyageait pas, c'est ce que l'artisan AJOUTE par-dessus :
   le statut, les documents coches, ses notes. En rangeant ces annotations
   DANS le rendez-vous lui-meme (extendedProperties.private), on les fait
   voyager avec lui. Plus de serveur a payer, plus de compte a gerer.

   La couche Supabase (app/auth, app/sync, app/billing) n'est ni cassee ni
   supprimee : elle dort. Le jour ou son quota sera regle, elle reviendra
   A COTE de celle-ci, pas a sa place. Ce fichier ne lui prend rien et ne lui
   parle pas.


   LA REGLE DU PROJET, RESPECTEE ICI COMME AILLEURS
   ------------------------------------------------
   Tant qu'AUCUN googleClientId n'est connu, CE FICHIER NE FAIT RIEN : il ne
   charge pas la librairie de Google, n'ouvre aucune fenetre, n'ecrit pas une
   ligne dans la console. L'application reste le tableau de bord local qu'elle
   est aujourd'hui. Et si l'artisan ne se connecte pas, c'est pareil : local,
   silencieux, sans une erreur rouge.

   « Connu » veut dire deux choses, dans cet ordre : d'abord app/config.js,
   ensuite l'identifiant que l'artisan a pu coller a la main dans le panneau
   de reglages. La brique moteur lisait deja ces deux sources ; celle-ci n'en
   lisait qu'une seule, et restait donc endormie — sans un mot — pendant que
   le moteur, lui, se reveillait. Voir idClient(), PARTIE 4.


   LES DEUX ENVIRONNEMENTS — ET POURQUOI ILS NE PEUVENT PAS ETRE IDENTIQUES
   ------------------------------------------------------------------------
   Il faut DEUX identifiants OAuth differents dans la console Google, et ce
   n'est pas un caprice d'administration : c'est une contrainte technique dont
   on ne peut pas sortir.

   VOIE A — LE SITE PUBLIE (GitHub Pages), et le telephone qui l'ouvre.
     On utilise « Google Identity Services », le petit client de jetons qui
     tourne dans le navigateur. Il exige que l'ADRESSE EXACTE de la page soit
     inscrite dans la console Google, sous « Origines JavaScript autorisees ».
       - type de client  : Application Web
       - origine a inscrire : l'adresse de votre page GitHub Pages,
                              par exemple https://votre-compte.github.io
       - pas d'URI de redirection a remplir (le client de jetons n'en
         utilise pas : il travaille en fenetre surgissante).

   VOIE B — L'APPLICATION DE BUREAU (Electron).
     Elle ne charge pas une adresse fixe : app/desktop/main.js, PARTIE 4 bis,
     demande a Windows un port LIBRE au demarrage (« port 0 »), et la page
     s'ouvre donc sur http://127.0.0.1:51234, puis 49871 le lendemain, etc.
     C'est un bon choix pour le bureau — deux exemplaires du programme ne se
     marchent pas dessus — mais c'est incompatible avec la Voie A : Google
     compare les origines CARACTERE PAR CARACTERE, port compris, et n'accepte
     aucun caractere joker. On ne peut donc pas inscrire d'avance une origine
     dont on ne connaitra le port qu'au demarrage.

     LA SEULE VOIE PROPRE PASSE DONC PAR LE PROCESSUS PRINCIPAL D'ELECTRON,
     et il faut le dire franchement. Le bon montage est celui que Google
     appelle « application installee » :
       - type de client  : Application de bureau
       - URI de redirection : http://127.0.0.1 sur un port choisi au moment
         de la connexion. Pour ce type de client, et pour lui seul, Google
         accepte n'importe quel port sur l'adresse de bouclage : il n'y a
         RIEN a inscrire dans la console pour le port.
       - la connexion s'ouvre dans le NAVIGATEUR de l'artisan (pas dans une
         fenetre Electron), avec PKCE, et Google renvoie le resultat sur le
         petit serveur d'un instant que le processus principal a ouvert.

     BENEFICE QUI VAUT A LUI SEUL le detour : ce montage-la donne un
     REFRESH TOKEN. Sur le bureau, l'artisan se connecte une fois et reste
     connecte. Le probleme de l'heure decrit plus bas ne concerne alors que
     la Voie A.

     Le code du processus principal est ecrit, pret a l'emploi, dans
     app/google/electron-google.js. La marche a suivre exacte — les trois
     lignes a ajouter a main.js, les deux a preload.js, la ligne de politique
     de securite a corriger — est dans app/google/CONSOLE-GOOGLE.md.

     TANT QUE CE MONTAGE N'EST PAS FAIT, ce fichier ne tente rien dans
     l'application de bureau : il l'explique en une phrase a l'artisan au lieu
     d'ouvrir une fenetre Google qui afficherait une erreur incomprehensible.


   LE PROBLEME DU JETON D'UNE HEURE, DIT FRANCHEMENT
   -------------------------------------------------
   Un jeton d'acces vit environ une heure. Pour en obtenir un nouveau sans
   rien demander a personne, il faut un « refresh token » ; et pour recevoir
   un refresh token, il faut un serveur, parce qu'il doit etre garde a l'abri
   du navigateur. Nous n'avons pas de serveur. Sur la Voie A, nous n'aurons
   donc jamais de refresh token. C'est ainsi, et aucune astuce ne le contourne
   honnetement.

   Ce que nous faisons a la place, et qui suffit en pratique :
     1. RENOUVELLEMENT SILENCIEUX. Cinq minutes avant l'expiration, on
        redemande un jeton a Google avec prompt vide. Tant que l'artisan est
        encore connecte a son compte Google dans ce navigateur — ce qui est le
        cas toute la journee — Google le rend sans rien afficher.
     2. QUAND CELA ECHOUE, UNE INVITE CLAIRE ET NON BLOQUANTE. Un bandeau en
        bas de l'ecran : « la liaison avec Google a expire — se reconnecter ».
        L'application continue de fonctionner, on peut continuer a travailler,
        le bandeau attend.
     3. LE TRAVAIL EN COURS N'EST JAMAIS PERDU. La file d'ecriture de la
        brique moteur demande son jeton par AP.gauth.jeton(). Si le jeton a
        expire, cette promesse NE SE REJETTE PAS : elle ATTEND. Des que
        l'artisan se reconnecte, elle se resout et la file repart toute seule,
        exactement ou elle s'etait arretee. C'est le point le plus important
        de ce fichier.


   POURQUOI LE JETON NE VA JAMAIS DANS localStorage
   ------------------------------------------------
   Parce que localStorage est une piece commune. Tout script charge par la
   page peut le lire : nos briques, mais aussi une librairie du CDN dont le
   compte aurait ete pirate a la source, ou un bout de code colle un jour dans
   la console. Un jeton recopie dans localStorage survit a la fermeture de
   l'onglet, a la mise en veille de la machine, et parfois a la sauvegarde du
   profil du navigateur : il devient un double des cles de l'agenda qui traine
   sur le disque.

   Ici, le jeton vit dans une variable JavaScript a l'interieur de cette
   fonction fermee. Il disparait au rechargement de la page — et on le
   redemande alors a Google, ce qui prend une fraction de seconde quand la
   session Google est vivante. Le desagrement est minuscule, le gain est reel.
   La meme regle vaut pour sessionStorage, les cookies et IndexedDB.
   (C'est la meme discipline que app/pwa/sw.js, qui refuse deja de mettre en
   cache les reponses portant un jeton.)


   CE QU'IL PUBLIE : window.AP.gauth, et rien d'autre dans le global.

   ============================================================================ */

(function () {
  'use strict';

  var W = window;
  W.AP = W.AP || {};
  var AP = W.AP;

  /* Double inclusion de la balise <script> : on ne refait rien. */
  if (AP.gauth) { return; }

  var CFG = W.AP_CONFIG || {};

  /* Ou se trouve ce fichier ? On s'en sert pour retrouver gauth.css a cote,
     ou que vous ayez range le dossier « app ». */
  var MOI = (document.currentScript && document.currentScript.src) || '';
  var DOSSIER = MOI ? MOI.replace(/[^\/]*$/, '') : 'app/google/';


  /* =========================================================================
     PARTIE 1 — LES CONSTANTES
     Tout ce qui pourrait avoir besoin d'etre change un jour est ici, en haut,
     nomme. Rien de tout cela n'est repete ailleurs dans le fichier.
     ========================================================================= */

  /* Les portees, c'est-a-dire ce qu'on demande le droit de faire.
     LECTURE et ECRITURE sont deux portees distinctes, et c'est exactement ce
     qui permet le consentement incremental explique a la PARTIE 6. */
  var PORTEE = {
    /* Etape 1 : lire les rendez-vous. Ne permet RIEN d'autre. */
    lecture: 'https://www.googleapis.com/auth/calendar.events.readonly',

    /* Etape 2 : lire ET ecrire les rendez-vous. Il n'existe malheureusement
       pas de portee Google « je ne touche qu'a extendedProperties » : pour
       poser une annotation, il faut demander le droit d'ecriture complet.
       C'est precisement pour cela que la regle du haut est appliquee par le
       code a la PARTIE 3 : Google nous fait confiance, le programme non. */
    ecriture: 'https://www.googleapis.com/auth/calendar.events',

    /* Etape 3, seulement si la brique moteur choisit Drive pour ranger les
       reglages. « appdata » est un tiroir prive : on ne voit pas les fichiers
       de l'artisan, et il ne voit pas les notres dans son Drive. */
    reglages: 'https://www.googleapis.com/auth/drive.appdata',

    /* Demandee des l'etape 1, et voici pourquoi : puisque le programme va
       ANNOTER un vrai agenda, l'artisan doit voir NOIR SUR BLANC de quel
       compte il s'agit — surtout s'il a une adresse personnelle et une
       adresse professionnelle. Sans cela, la pastille ne peut afficher que
       « connecte », ce qui ne rassure personne.
       Pour retirer cette demande : videz la chaine ci-dessous ('') ; tout le
       reste du fichier continue de fonctionner, la pastille dira seulement
       « connecte a Google » sans l'adresse. */
    compte: 'https://www.googleapis.com/auth/userinfo.email'
  };

  var GIS = 'https://accounts.google.com/gsi/client';
  var API_COMPTE = 'https://www.googleapis.com/oauth2/v3/userinfo';
  var API_AGENDA = 'https://www.googleapis.com/calendar/v3';

  /* On renouvelle CINQ MINUTES avant l'expiration annoncee. Assez tot pour
     qu'une requete lente ne parte pas avec un jeton deja mort, assez tard
     pour ne pas harceler Google. */
  var MARGE_MS = 5 * 60 * 1000;

  /* La marque que le programme pose sur les taches QU'IL A CREEES lui-meme.
     C'est elle, et elle seule, qui autorise plus tard une modification
     complete de ce rendez-vous : voir PARTIE 3. */
  var CLE_ORIGINE = 'apOrigine';
  var MARQUE = 'agenda-pro';

  /* Le mot de passe de l'exception n° 2. Une brique qui veut modifier le
     titre ou l'heure d'un rendez-vous existant doit passer cette valeur, en
     toutes lettres, dans son appel. On ne la tape pas par distraction : c'est
     une phrase qui dit ce qu'elle fait, et elle apparait dans le code de la
     brique appelante, ou une relecture la verra. */
  var PERMISSION_EXPLICITE = 'l-artisan-a-demande-cette-modification';

  /* LES CHAMPS AUXQUELS ON NE TOUCHE PAS. Ils sont ici pour le message
     d'erreur et pour la documentation ; la protection reelle, elle, ne
     fonctionne PAS par cette liste d'interdits — voir PARTIE 3. */
  var CHAMPS_PROTEGES = ['summary', 'description', 'start', 'end', 'attendees', 'recurrence'];


  /* =========================================================================
     PARTIE 2 — LE DICTIONNAIRE
     Chaque texte visible existe en arabe et en francais. Aucune phrase n'est
     ecrite en dur ailleurs dans le fichier : pour corriger une formulation,
     c'est ici, et ici seulement.
     ========================================================================= */

  var T = {
    ar: {
      connecter:      'ربط مع تقويم Google',
      connecte:       'مرتبط بـ Google',
      connexion:      'جارٍ الربط…',
      deconnecter:    'قطع الربط',
      deconnecte:     'تم قطع الربط مع Google',
      expire:         'انتهت صلاحية الربط مع Google',
      reconnecter:    'إعادة الربط',
      plusTard:       'لاحقًا',
      bandeau:        'انتهت مهلة الربط مع Google. عملك محفوظ وينتظر — أعد الربط ليكمل الإرسال.',
      refuse:         'تم إلغاء الربط. البرنامج يواصل العمل محليًا كالمعتاد.',
      erreur:         'تعذّر الربط مع Google. حاول مرة أخرى لاحقًا.',
      lecture:        'قراءة فقط',
      ecriture:       'قراءة وكتابة',
      demandeEcriture:'لحفظ الحالة والوثائق داخل الموعد، يحتاج البرنامج إذن الكتابة.',
      autoriser:      'السماح',
      bureauAbsent:   'الربط مع Google من تطبيق سطح المكتب يحتاج تحديث البرنامج. افتح النسخة على الويب في الأثناء.',
      pasConfig:      'لم يتم إعداد Google بعد.',
      compteInconnu:  'حساب Google'
    },
    fr: {
      connecter:      'Connecter Google Agenda',
      connecte:       'Connecte a Google',
      connexion:      'Connexion…',
      deconnecter:    'Deconnecter',
      deconnecte:     'Liaison Google coupee',
      expire:         'La liaison Google a expire',
      reconnecter:    'Se reconnecter',
      plusTard:       'Plus tard',
      bandeau:        'La liaison avec Google a expire. Votre travail est garde et attend — reconnectez-vous pour qu\'il parte.',
      refuse:         'Connexion annulee. Le programme continue en local, comme avant.',
      erreur:         'Connexion a Google impossible. Reessayez plus tard.',
      lecture:        'lecture seule',
      ecriture:       'lecture et ecriture',
      demandeEcriture:'Pour ranger le statut et les documents dans le rendez-vous, le programme a besoin du droit d\'ecriture.',
      autoriser:      'Autoriser',
      bureauAbsent:   'La connexion Google depuis l\'application de bureau demande une mise a jour du programme. En attendant, utilisez la version web.',
      pasConfig:      'Google n\'est pas encore configure.',
      compteInconnu:  'compte Google'
    }
  };

  function langue() {
    if (AP.ui && typeof AP.ui.lang === 'function') { return AP.ui.lang(); }
    var l = (document.documentElement.lang || '').toLowerCase();
    return (l.indexOf('fr') === 0) ? 'fr' : 'ar';
  }
  function M(cle) {
    var d = T[langue()] || T.ar;
    return d[cle] || T.ar[cle] || '';
  }
  function toast(msg) {
    if (AP.ui && typeof AP.ui.toast === 'function') { AP.ui.toast(msg); return; }
    if (typeof W.toast === 'function') { try { W.toast(msg); } catch (e) { } }
  }

  /* Le journal. Par defaut, ce fichier est MUET : un artisan qui ouvre la
     console de son navigateur ne doit pas y trouver nos messages, et une
     application non configuree n'a rien a raconter. Pour enqueter un jour,
     mettez googleDebug: true dans app/config.js. */
  function journal() {
    if (!CFG.googleDebug) { return; }
    try { console.log.apply(console, ['[gauth]'].concat([].slice.call(arguments))); } catch (e) { }
  }


  /* =========================================================================
     PARTIE 3 — LA REGLE D'ECRITURE, RENDUE EXECUTABLE
     ---------------------------------------------------------------------
     C'est le coeur de la securite de ce produit, et il tient en une idee :

        ON NE TRAVAILLE PAS PAR LISTE D'INTERDITS, MAIS PAR LISTE D'AUTORISES.

     Une liste d'interdits (« ne pas envoyer summary, ni description… ») a un
     defaut mortel : le jour ou Google ajoute un champ — disons « conferenceData »
     ou « eventType » — ce champ n'est pas dans la liste, donc il passe. La
     protection vieillit toute seule, en silence.

     Une liste d'autorises fait l'inverse. Pour modifier un rendez-vous qui
     n'est pas a nous, UN SEUL champ est acceptable : extendedProperties. Tout
     le reste est refuse, y compris ce qui n'existe pas encore. La protection
     ne vieillit pas.

     Les deux exceptions de la regle sont ecrites ici, et nulle part ailleurs :
       - le rendez-vous porte NOTRE marque (le programme l'a cree) ;
       - l'appelant fournit la permission explicite de l'artisan.
     ========================================================================= */

  /* L'erreur que recoit une brique qui se trompe. Elle porte un nom, pour
     qu'un `catch` puisse la distinguer d'une panne de reseau. */
  function refus(message) {
    var e = new Error(message);
    e.name = 'AP_REGLE_ECRITURE';
    return e;
  }

  /* Est-ce une adresse de rendez-vous ? On ne veut pas soumettre a cette
     regle un appel a /users/me/calendarList, qui ne touche aucun evenement. */
  function estUnEvenement(url) {
    return /\/calendar\/v3\/calendars\/[^\/]+\/events(\/|\?|$)/.test(url);
  }
  function estUnEvenementPrecis(url) {
    /* .../events/ID — donc une modification ou une suppression, pas une
       creation ni une liste. */
    return /\/calendar\/v3\/calendars\/[^\/]+\/events\/[^\/?#]+/.test(url);
  }

  /* LE GARDIEN. Il recoit la methode, l'adresse, le corps de la requete, et
     ce que l'appelant declare ; il rend le corps a envoyer, ou il jette. */
  function verifierEcriture(methode, url, corps, opts) {
    opts = opts || {};
    methode = (methode || 'GET').toUpperCase();

    /* Lire n'a jamais fait de mal. */
    if (methode === 'GET' || methode === 'HEAD') { return corps; }

    /* Une requete qui ne vise pas un evenement (les parametres de l'agenda,
       la liste des agendas…) n'est pas concernee par cette regle-ci. */
    if (!estUnEvenement(url)) { return corps; }

    var permis = (opts.permission === PERMISSION_EXPLICITE);
    var notre = (opts.origine === MARQUE);

    /* --- CREATION : autorisee, mais le programme signe son ouvrage. ------
       Exception n° 1 de la regle : « une tache que l'artisan cree lui-meme
       depuis le programme ». On pose NOTRE marque dans le tiroir prive, ce
       qui fait deux choses a la fois : plus tard, on saura que ce rendez-vous
       est le notre et qu'on peut le modifier entierement ; et un rendez-vous
       cree ailleurs ne pourra jamais usurper ce droit, puisqu'il n'a pas la
       marque. */
    if (methode === 'POST') {
      var neuf = corps || {};
      neuf.extendedProperties = neuf.extendedProperties || {};
      neuf.extendedProperties.private = neuf.extendedProperties.private || {};
      neuf.extendedProperties.private[CLE_ORIGINE] = MARQUE;
      return neuf;
    }

    /* --- PUT : refuse, toujours. -----------------------------------------
       PUT remplace le rendez-vous EN ENTIER : tout champ absent du corps est
       efface chez Google. C'est la facon la plus rapide de faire disparaitre
       la description d'un rendez-vous par simple oubli. On n'en veut pas, et
       PATCH fait le meme travail sans ce danger. */
    if (methode === 'PUT') {
      throw refus(
        'Regle d\'ecriture : PUT est interdit sur un rendez-vous, car il efface ' +
        'tout ce que le corps ne contient pas. Utilisez PATCH.'
      );
    }

    /* --- SUPPRESSION ------------------------------------------------------
       On ne supprime que ce qu'on a cree, ou ce que l'artisan demande. */
    if (methode === 'DELETE') {
      if (notre || permis) { return corps; }
      throw refus(
        'Regle d\'ecriture : refus de supprimer un rendez-vous que le programme ' +
        'n\'a pas cree. Fournissez origine:"' + MARQUE + '" (lu dans le rendez-vous) ' +
        'ou permission:"' + PERMISSION_EXPLICITE + '".'
      );
    }

    /* --- MODIFICATION (PATCH) — LA LISTE D'AUTORISES ---------------------- */
    if (methode === 'PATCH' && estUnEvenementPrecis(url)) {

      /* Nos propres taches, et les demandes explicites de l'artisan, passent
         sans restriction : ce sont les deux exceptions de la regle. */
      if (notre || permis) { return corps; }

      var cles = Object.keys(corps || {});
      var interdits = [];
      for (var i = 0; i < cles.length; i++) {
        if (cles[i] !== 'extendedProperties') { interdits.push(cles[i]); }
      }
      if (interdits.length) {
        /* On nomme d'abord les champs sacres, s'il y en a, parce que c'est
           l'erreur qu'un lecteur comprendra tout de suite. */
        var sacres = interdits.filter(function (c) { return CHAMPS_PROTEGES.indexOf(c) >= 0; });
        throw refus(
          'Regle d\'ecriture : sur un rendez-vous existant, le programme n\'a le droit ' +
          'de modifier QUE extendedProperties. Champs refuses : ' + interdits.join(', ') + '.' +
          (sacres.length ? ' (' + sacres.join(', ') + ' appartiennent a l\'artisan.)' : '')
        );
      }
      return corps;
    }

    /* Une methode qu'on n'avait pas prevue sur un evenement : on refuse.
       C'est le principe de la liste d'autorises, applique jusqu'au bout. */
    throw refus('Regle d\'ecriture : methode ' + methode + ' non prevue sur un rendez-vous.');
  }


  /* =========================================================================
     PARTIE 4 — L'ETAT, EN MEMOIRE SEULEMENT
     Relisez la note du haut : rien de ce qui suit ne descend sur le disque.
     ========================================================================= */

  /* ---------------------------------------------------------------------
     L'IDENTIFIANT DU CLIENT GOOGLE — DEUX SOURCES, LE MEME ORDRE QUE gsync
     ---------------------------------------------------------------------
     app/config.js d'abord : c'est la source officielle, celle que la
     construction du site depose. Puis le panneau de reglages, ou l'artisan
     peut coller son identifiant a la main sur un appareil, sans reconstruire
     le site. gsync.js lisait deja les deux (sa fonction clientId) ; ce
     fichier-ci ne lisait que la premiere. Resultat : l'artisan collait son
     identifiant, le moteur se reveillait, et l'authentification restait
     endormie sans afficher la moindre pastille. Les deux briques lisent
     desormais la meme chose, dans le meme ordre.

     Un identifiant de client OAuth est PUBLIC — il voyage en clair dans
     l'adresse que Google affiche a l'artisan. Le lire dans localStorage ne
     contredit donc en rien la note de la PARTIE 3, qui ne parle que du
     JETON, et le jeton, lui, ne descend toujours pas sur le disque. */
  var CLE_REGLAGES = 'agendapro_g_reglages_v1';

  function idClient() {
    var officiel = CFG.googleClientId;
    if (officiel && String(officiel).trim()) { return String(officiel).trim(); }
    try {
      var brut = W.localStorage.getItem(CLE_REGLAGES);
      if (!brut) { return ''; }
      var r = JSON.parse(brut);
      return (r && r.clientId) ? String(r.clientId).trim() : '';
    } catch (e) {
      /* Navigation privee, stockage refuse, JSON abime : on se tait et on se
         comporte comme si rien n'etait configure. Jamais d'erreur rouge. */
      return '';
    }
  }

  var S = {
    configure: !!idClient(),
    environnement: 'web',    /* 'web' | 'bureau' | 'bureau-sans-pont' */
    pret: false,             /* la librairie de Google est-elle chargee ? */
    connecte: false,
    connexionEnCours: false,
    renouvellementEnCours: false,
    besoinReconnexion: false,
    courriel: '',
    portees: [],             /* ce que Google nous a REELLEMENT accorde */
    _jeton: '',              /* <<< LE JETON. Jamais recopie ailleurs. */
    _expireA: 0              /* horodatage en millisecondes */
  };

  var abonnes = [];
  var attentes = [];         /* les promesses qui attendent un jeton frais */
  var minuteur = null;

  function prevenir() {
    var e = etat();
    for (var i = 0; i < abonnes.length; i++) {
      try { abonnes[i](e); } catch (err) { /* une brique cassee n'en casse pas une autre */ }
    }
    majPastille();
  }

  function valide() {
    return !!S._jeton && (Date.now() < S._expireA - 1000);
  }

  function aLaPortee(p) {
    return S.portees.indexOf(p) >= 0;
  }

  /* Ranger un jeton frais, armer le renouvellement, et reveiller tout le
     monde : les abonnes, et surtout la file d'ecriture qui patientait. */
  function poserJeton(reponse) {
    S._jeton = reponse.access_token || '';
    var secondes = parseInt(reponse.expires_in, 10);
    if (!(secondes > 0)) { secondes = 3600; }
    S._expireA = Date.now() + secondes * 1000;
    S.portees = String(reponse.scope || '').split(/\s+/).filter(Boolean);
    S.connecte = true;
    S.besoinReconnexion = false;
    cacherBandeau();
    armerRenouvellement();
    journal('jeton pose, expire dans', secondes, 's, portees:', S.portees.join(' '));
    reveillerLesAttentes(S._jeton);
    prevenir();
  }

  function oublierJeton() {
    S._jeton = '';
    S._expireA = 0;
    S.portees = [];
    S.connecte = false;
    if (minuteur) { clearTimeout(minuteur); minuteur = null; }
  }

  /* UN JETON QUE GOOGLE VIENT DE REFUSER, ET POURQUOI IL FAUT NOUS LE DIRE.
     Notre horloge ne sait qu'une chose : « ce jeton est bon pendant une
     heure ». Elle ne sait pas que l'artisan vient de retirer l'acces depuis
     son compte Google, ni qu'il a change son mot de passe. Dans ces cas-la,
     Google repond 401 (ou un 403 d'authentification) et notre horloge, elle,
     continue tranquillement a rendre le meme jeton mort a qui le demande.
     C'est exactement ce qui bloquait la file d'envoi pour toujours.

     La brique qui essuie le refus nous le renvoie donc, et on le jette. On ne
     coupe PAS `connecte` : le compte est toujours lie, c'est le laissez-passer
     qui est perime. C'est renouveler() — appele juste apres par jeton() — qui
     decidera si un jeton neuf arrive, ou s'il faut lever « reconnexion
     necessaire » et montrer le bandeau. */
  function invaliderJeton(mort) {
    if (!mort) { return false; }
    /* Deja remplace entre-temps : le refus concernait un jeton perime, il n'y
       a rien a jeter et surtout rien a casser. */
    if (S._jeton && String(mort) !== S._jeton) { return false; }
    journal('jeton refuse par Google — on le jette et on en redemande un');
    S._jeton = '';
    S._expireA = 0;
    if (minuteur) { clearTimeout(minuteur); minuteur = null; }
    prevenir();
    return true;
  }

  function reveillerLesAttentes(jetonOuNull) {
    var liste = attentes;
    attentes = [];
    for (var i = 0; i < liste.length; i++) {
      try { liste[i](jetonOuNull); } catch (e) { }
    }
  }


  /* =========================================================================
     PARTIE 5 — QUEL ENVIRONNEMENT ?
     ========================================================================= */

  function pontBureau() {
    var d = W.AP_DESKTOP;
    if (!d || d.estBureau !== true) { return null; }
    /* Le pont Google existe-t-il dans CETTE version du programme de bureau ?
       Voir app/google/CONSOLE-GOOGLE.md, « Ce qu'il faut ajouter a Electron ». */
    if (typeof d.googleConnecter !== 'function' || typeof d.googleJeton !== 'function') {
      return null;
    }
    return d;
  }

  function detecterEnvironnement() {
    if (W.AP_DESKTOP && W.AP_DESKTOP.estBureau === true) {
      S.environnement = pontBureau() ? 'bureau' : 'bureau-sans-pont';
    } else {
      S.environnement = 'web';
    }
    journal('environnement:', S.environnement);
  }


  /* =========================================================================
     PARTIE 6 — VOIE A : GOOGLE IDENTITY SERVICES (le navigateur)
     ========================================================================= */

  var chargementGis = null;

  function chargerGis() {
    if (chargementGis) { return chargementGis; }
    chargementGis = new Promise(function (resoudre) {
      if (W.google && W.google.accounts && W.google.accounts.oauth2) {
        resoudre(true); return;
      }
      var s = document.createElement('script');
      s.src = GIS;
      s.async = true;
      s.defer = true;
      /* Un echec de chargement (atelier sans internet, politique de securite
         mal reglee) ne doit RIEN afficher : on rend false, et la brique se
         tait. C'est la regle du projet. */
      s.onload = function () { resoudre(!!(W.google && W.google.accounts && W.google.accounts.oauth2)); };
      s.onerror = function () { journal('gsi/client injoignable'); resoudre(false); };
      (document.head || document.documentElement).appendChild(s);
    });
    return chargementGis;
  }

  /* Un client de jetons NEUF a chaque demande. Pourquoi ne pas en garder un
     seul ? Parce que la liste des portees se fixe a la creation du client et
     ne peut pas etre changee ensuite : le consentement incremental de la
     PARTIE 7 a justement besoin d'en demander une de plus. Un client neuf
     coute une poignee de microsecondes ; garder le mauvais couterait un
     bogue introuvable. */
  function demanderJetonGis(portees, interactif) {
    return chargerGis().then(function (ok) {
      if (!ok) { return null; }
      return new Promise(function (resoudre) {
        var fini = false;
        var client;
        try {
          client = W.google.accounts.oauth2.initTokenClient({
            client_id: idClient(),
            scope: portees.join(' '),

            /* Les portees deja accordees restent accordees : c'est ce qui
               fait que demander l'ecriture ne fait pas perdre la lecture. */
            include_granted_scopes: true,

            /* Google laisse l'artisan decocher une permission. On l'accepte —
               c'est son agenda — et on verifie ensuite ce qui a REELLEMENT
               ete accorde, au lieu de le supposer. */
            enable_granular_consent: true,

            callback: function (reponse) {
              if (fini) { return; }
              fini = true;
              if (reponse && reponse.access_token) { resoudre(reponse); }
              else { resoudre(null); }
            },
            error_callback: function (err) {
              if (fini) { return; }
              fini = true;
              journal('erreur GIS:', err && (err.type || err.message));
              resoudre(null);
            }
          });
        } catch (e) {
          journal('initTokenClient a echoue:', e && e.message);
          resoudre(null);
          return;
        }

        try {
          client.requestAccessToken({
            /* prompt vide = « n'affiche rien si tu peux » : c'est le
               renouvellement silencieux. prompt 'consent' = « montre l'ecran
               d'autorisation » : c'est une demande faite par l'artisan, sur
               un clic, ou la fenetre surgissante est donc autorisee. */
            prompt: interactif ? 'consent' : '',
            login_hint: S.courriel || undefined
          });
        } catch (e) {
          if (!fini) { fini = true; journal('requestAccessToken a echoue:', e && e.message); resoudre(null); }
        }

        /* Filet : si Google ne rappelle jamais (fenetre fermee a la main sur
           un vieux navigateur), on ne laisse pas la promesse pendue. */
        setTimeout(function () {
          if (!fini) { fini = true; journal('pas de reponse de Google'); resoudre(null); }
        }, interactif ? 180000 : 20000);
      });
    });
  }

  /* Qui est connecte ? Une seule requete, une seule fois par connexion. */
  function lireLeCompte() {
    if (!PORTEE.compte || !aLaPortee(PORTEE.compte)) { return Promise.resolve(); }
    return fetch(API_COMPTE, { headers: { Authorization: 'Bearer ' + S._jeton } })
      .then(function (r) { return r.ok ? r.json() : null; })
      .then(function (d) { if (d && d.email) { S.courriel = d.email; prevenir(); } })
      .catch(function () { /* sans importance : la pastille dira « connecte » */ });
  }


  /* =========================================================================
     PARTIE 7 — LE CONSENTEMENT INCREMENTAL
     ---------------------------------------------------------------------
     POURQUOI NE PAS TOUT DEMANDER D'UN COUP ? Parce que le premier ecran que
     Google montre a l'artisan decide de tout. S'il y lit « Agenda Pro veut
     VOIR, MODIFIER ET SUPPRIMER vos evenements » alors qu'il n'a encore rien
     vu du programme, beaucoup s'arretent la — et ils ont raison.

     On demande donc la LECTURE seule au depart. Le programme se remplit, il
     montre les rendez-vous, il devient utile. Le jour ou l'artisan coche son
     premier document ou change un statut — donc au moment ou l'ecriture SERT
     vraiment — on demande le droit d'ecrire, et la phrase de Google arrive
     enfin au bon moment : elle repond a un geste qu'il vient de faire.

     Techniquement, Google le permet grace a include_granted_scopes : le
     nouveau jeton porte l'ancienne portee ET la nouvelle. On ne perd rien.
     ========================================================================= */

  function porteesVoulues(niveau) {
    var l = [];
    if (PORTEE.compte) { l.push(PORTEE.compte); }
    l.push(niveau === 'ecriture' ? PORTEE.ecriture : PORTEE.lecture);
    return l;
  }


  /* =========================================================================
     PARTIE 8 — LE RENOUVELLEMENT SILENCIEUX, ET LA FILE QUI ATTEND
     ========================================================================= */

  function armerRenouvellement() {
    if (minuteur) { clearTimeout(minuteur); minuteur = null; }
    var dans = S._expireA - Date.now() - MARGE_MS;
    if (dans < 1000) { dans = 1000; }
    /* setTimeout ne se declenche pas pendant la mise en veille de la machine.
       Ce minuteur est donc un confort, pas une garantie : la verification qui
       compte vraiment est celle faite a chaque appel de jeton(). */
    minuteur = setTimeout(function () { renouveler(); }, dans);
  }

  function renouveler() {
    if (S.renouvellementEnCours) { return Promise.resolve(valide()); }
    if (!S.connecte && !S._jeton) { return Promise.resolve(false); }

    S.renouvellementEnCours = true;
    prevenir();

    var niveau = aLaPortee(PORTEE.ecriture) ? 'ecriture' : 'lecture';
    var pont = pontBureau();

    var demande = pont
      /* VOIE B : le processus principal a un refresh token. Silencieux pour
         de bon, et pour des mois. */
      ? pont.googleJeton(porteesVoulues(niveau))
      /* VOIE A : on retente sans rien afficher. Tant que la session Google du
         navigateur est vivante, cela passe. */
      : demanderJetonGis(porteesVoulues(niveau), false);

    return demande.then(function (r) {
      S.renouvellementEnCours = false;
      if (r && r.access_token) {
        poserJeton(r);
        return true;
      }
      /* Echec : on ne jette pas, on ne vide pas le travail en cours. On leve
         le drapeau et on montre l'invite. L'application continue. */
      journal('renouvellement silencieux refuse — invite affichee');
      S.besoinReconnexion = true;
      S._jeton = '';
      S._expireA = 0;
      montrerBandeau();
      prevenir();
      return false;
    }).catch(function () {
      S.renouvellementEnCours = false;
      S.besoinReconnexion = true;
      montrerBandeau();
      prevenir();
      return false;
    });
  }


  /* =========================================================================
     PARTIE 9 — LE BANDEAU « RECONNECTEZ-VOUS » (non bloquant)
     Pas de fenetre modale, pas de blocage : l'artisan est peut-etre en train
     de taper une note sur un chantier. Un bandeau en bas, qui attend.
     ========================================================================= */

  var bandeau = null;
  var cssPosee = false;

  function poserCss() {
    if (cssPosee) { return; }
    cssPosee = true;
    try {
      var l = document.createElement('link');
      l.rel = 'stylesheet';
      l.href = DOSSIER + 'gauth.css';
      document.head.appendChild(l);
    } catch (e) { }
  }

  function montrerBandeau() {
    if (!document.body) { return; }
    poserCss();
    if (bandeau) { bandeau.classList.add('on'); return; }

    bandeau = document.createElement('div');
    bandeau.className = 'ap-g-bandeau on';
    bandeau.setAttribute('role', 'status');

    var txt = document.createElement('span');
    txt.className = 'ap-g-bandeau-txt';
    txt.textContent = M('bandeau');

    var ok = document.createElement('button');
    ok.className = 'ap-g-btn primaire';
    ok.textContent = M('reconnecter');
    ok.onclick = function () { connecter({ interactif: true }); };

    var plusTard = document.createElement('button');
    plusTard.className = 'ap-g-btn';
    plusTard.textContent = M('plusTard');
    plusTard.onclick = function () { cacherBandeau(); };

    bandeau.appendChild(txt);
    bandeau.appendChild(ok);
    bandeau.appendChild(plusTard);
    document.body.appendChild(bandeau);

    if (AP.ui && typeof AP.ui.onLang === 'function') {
      AP.ui.onLang(function () {
        if (!bandeau) { return; }
        txt.textContent = M('bandeau');
        ok.textContent = M('reconnecter');
        plusTard.textContent = M('plusTard');
      });
    }
  }

  function cacherBandeau() {
    if (bandeau) { bandeau.classList.remove('on'); }
  }


  /* =========================================================================
     PARTIE 10 — LA PASTILLE DANS LA BARRE DU HAUT
     ---------------------------------------------------------------------
     Elle n'apparait QUE si un googleClientId est configure. Sur une
     installation non configuree, la barre du haut est exactement celle
     d'aujourd'hui, au pixel pres.
     ========================================================================= */

  var pastille = null;

  function creerPastille(conteneur) {
    if (!S.configure) { return null; }
    if (pastille) {
      if (conteneur && pastille.parentNode !== conteneur) { conteneur.appendChild(pastille); }
      return pastille;
    }
    poserCss();
    pastille = document.createElement('button');
    pastille.className = 'tbtn ap-g-pastille';
    pastille.type = 'button';
    pastille.onclick = function () {
      if (S.connecte) { ouvrirMenu(); }
      else { connecter({ interactif: true }); }
    };
    if (conteneur) { conteneur.appendChild(pastille); }
    majPastille();
    if (AP.ui && typeof AP.ui.onLang === 'function') { AP.ui.onLang(majPastille); }
    return pastille;
  }

  function majPastille() {
    if (!pastille) { return; }
    var point, texte;
    if (S.connexionEnCours) { point = '◌'; texte = M('connexion'); }
    else if (S.besoinReconnexion) { point = '⚠️'; texte = M('expire'); }
    else if (S.connecte) { point = '🟢'; texte = S.courriel || M('connecte'); }
    else { point = '📅'; texte = M('connecter'); }
    pastille.textContent = point + ' ' + texte;
    pastille.classList.toggle('alerte', !!S.besoinReconnexion);
    pastille.classList.toggle('actif', !!S.connecte && !S.besoinReconnexion);
    pastille.title = S.connecte
      ? (S.courriel || M('compteInconnu')) + ' — ' +
        (aLaPortee(PORTEE.ecriture) ? M('ecriture') : M('lecture'))
      : M('connecter');
  }

  function ouvrirMenu() {
    /* Volontairement pauvre : l'adresse du compte, le droit en cours, et la
       porte de sortie. Tout le reste appartient a la brique moteur. */
    var ancien = document.getElementById('apGMenu');
    if (ancien) { ancien.remove(); return; }

    poserCss();
    var m = document.createElement('div');
    m.id = 'apGMenu';
    m.className = 'ap-g-menu';

    var t = document.createElement('div');
    t.className = 'ap-g-menu-t';
    t.textContent = S.courriel || M('compteInconnu');

    var p = document.createElement('div');
    p.className = 'ap-g-menu-p';
    p.textContent = aLaPortee(PORTEE.ecriture) ? M('ecriture') : M('lecture');

    var d = document.createElement('button');
    d.className = 'ap-g-btn';
    d.textContent = M('deconnecter');
    d.onclick = function () { m.remove(); deconnecter(); };

    m.appendChild(t); m.appendChild(p); m.appendChild(d);
    document.body.appendChild(m);

    if (pastille) {
      var r = pastille.getBoundingClientRect();
      m.style.top = (r.bottom + 8) + 'px';
      /* On colle au bord le plus proche, ce qui marche aussi bien en arabe
         (droite a gauche) qu'en francais. */
      if (langue() === 'ar') { m.style.right = Math.max(8, W.innerWidth - r.right) + 'px'; }
      else { m.style.left = Math.max(8, r.left) + 'px'; }
    }

    setTimeout(function () {
      document.addEventListener('click', function fermer(e) {
        if (m.contains(e.target) || (pastille && pastille.contains(e.target))) { return; }
        m.remove();
        document.removeEventListener('click', fermer);
      });
    }, 0);
  }

  /* On accroche la pastille la ou auth.js accroche deja la sienne, pour que
     les deux briques se rangent au meme endroit sans se connaitre. */
  function accrocherPastille() {
    if (!S.configure) { return; }
    var barre = document.querySelector('header .tools') || document.querySelector('.tools');
    if (barre) { creerPastille(barre); }
  }


  /* =========================================================================
     PARTIE 11 — CONNECTER, DECONNECTER
     ========================================================================= */

  function connecter(opts) {
    opts = opts || {};
    if (!S.configure) { return Promise.resolve(false); }
    if (S.connexionEnCours) { return Promise.resolve(S.connecte); }

    var niveau = opts.ecriture ? 'ecriture' : 'lecture';
    var portees = porteesVoulues(niveau);
    if (opts.drive) { portees.push(PORTEE.reglages); }

    /* L'application de bureau sans le pont : on le DIT, une fois, au lieu
       d'ouvrir une fenetre Google qui finirait sur « origine non autorisee ».
       Voir l'explication des deux environnements, en tete de fichier. */
    if (S.environnement === 'bureau-sans-pont') {
      toast(M('bureauAbsent'));
      journal('pont Google absent du programme de bureau — voir CONSOLE-GOOGLE.md');
      return Promise.resolve(false);
    }

    S.connexionEnCours = true;
    prevenir();

    var pont = pontBureau();
    var demande = pont
      ? pont.googleConnecter(portees)
      : demanderJetonGis(portees, opts.interactif !== false);

    return demande.then(function (r) {
      S.connexionEnCours = false;
      if (r && r.access_token) {
        poserJeton(r);
        if (r.email) { S.courriel = r.email; }
        return lireLeCompte().then(function () { return true; });
      }
      /* L'artisan a ferme la fenetre, ou a refuse : ce n'est pas une panne.
         On le dit calmement et on retourne travailler en local. */
      prevenir();
      if (opts.interactif !== false) { toast(M('refuse')); }
      return false;
    }).catch(function (e) {
      S.connexionEnCours = false;
      prevenir();
      journal('connexion: ', e && e.message);
      if (opts.interactif !== false) { toast(M('erreur')); }
      return false;
    });
  }

  /* Monter d'un cran : demander l'ecriture. La brique moteur appelle ceci au
     moment ou l'artisan coche son premier document, pas avant. */
  function demanderEcriture() {
    if (!S.configure) { return Promise.resolve(false); }
    if (aLaPortee(PORTEE.ecriture)) { return Promise.resolve(true); }
    if (!S.connecte) { return connecter({ interactif: true, ecriture: true }); }
    toast(M('demandeEcriture'));
    return connecter({ interactif: true, ecriture: true }).then(function () {
      return aLaPortee(PORTEE.ecriture);
    });
  }

  function deconnecter() {
    var ancien = S._jeton;
    var pont = pontBureau();

    oublierJeton();
    S.besoinReconnexion = false;
    S.courriel = '';
    cacherBandeau();

    /* On libere les promesses en attente AVEC null : sans cela, une file
       d'ecriture resterait suspendue pour toujours apres une deconnexion —
       le genre de bogue qu'on ne retrouve jamais. */
    reveillerLesAttentes(null);
    prevenir();
    toast(M('deconnecte'));

    /* On demande a Google d'oublier le jeton pour de bon. Si cela echoue, ce
       n'est pas grave : il est deja hors de notre memoire, et il expire seul. */
    try {
      if (pont && typeof pont.googleDeconnecter === 'function') {
        pont.googleDeconnecter();
      } else if (ancien && W.google && W.google.accounts && W.google.accounts.oauth2) {
        W.google.accounts.oauth2.revoke(ancien, function () { });
      }
    } catch (e) { }

    return Promise.resolve(true);
  }


  /* =========================================================================
     PARTIE 12 — LE JETON, TEL QUE LES AUTRES BRIQUES LE DEMANDENT
     ---------------------------------------------------------------------
     LIRE CECI AVANT D'ECRIRE LA FILE D'ECRITURE.

     jeton() rend une PROMESSE. Trois cas :
       - un jeton valide est la          -> elle se resout tout de suite ;
       - il a expire                     -> renouvellement silencieux, puis
                                            elle se resout ;
       - le renouvellement echoue        -> le bandeau apparait, et LA
                                            PROMESSE RESTE EN ATTENTE. Elle se
                                            resoudra quand l'artisan se sera
                                            reconnecte, et la file repartira
                                            d'elle-meme.

     C'est ce troisieme cas qui garantit qu'aucune modification n'est perdue a
     l'expiration. Si votre appelant ne PEUT pas attendre (un rafraichissement
     d'affichage, par exemple), demandez jeton({ attendre: false }) : vous
     recevrez null immediatement, sans bandeau.
     ========================================================================= */

  function jeton(opts) {
    opts = opts || {};
    var attendre = (opts.attendre !== false);

    if (!S.configure) { return Promise.resolve(null); }
    if (valide()) { return Promise.resolve(S._jeton); }

    /* Jamais connecte : on ne reveille personne, on ne montre rien. */
    if (!S.connecte && !S.besoinReconnexion) { return Promise.resolve(null); }

    return renouveler().then(function (ok) {
      if (ok && valide()) { return S._jeton; }
      if (!attendre) { return null; }
      montrerBandeau();
      /* On se met dans la file. poserJeton() (a la reconnexion) ou
         deconnecter() (avec null) nous reveillera. */
      return new Promise(function (resoudre) { attentes.push(resoudre); });
    });
  }


  /* =========================================================================
     PARTIE 12 bis — LA PRISE POUR LE MOTEUR (app/google/gsync.js)
     ---------------------------------------------------------------------
     Le moteur de synchronisation sait obtenir un jeton tout seul, et il a
     aussi une porte d'entree pour qu'on le lui fournisse autrement :
     AP.gsync.setTokenProvider(fn). Il l'avait prevue pour le programme de
     bureau, dont la page ne peut pas se servir de la librairie de Google
     (l'histoire du port qui change, racontee en tete de ce fichier).

     On branche donc les deux briques par cette porte-la, et l'integration
     tient en une ligne, a mettre apres le chargement des deux fichiers :

         AP.gsync.setTokenProvider(AP.gauth.fournisseur);

     CE QU'ON Y GAGNE, ET CE N'EST PAS UNE COQUETTERIE : il n'y a plus alors
     qu'UN SEUL endroit dans le produit qui detienne un jeton, qui sache le
     renouveler, et qui sache attendre sans rien perdre quand il expire. Deux
     briques qui gardent chacune leur jeton, ce sont deux fenetres de Google
     qui s'ouvrent, deux horloges d'expiration qui ne sont pas d'accord, et un
     bogue que personne ne retrouve. Et surtout : par cette porte, le moteur
     fonctionne SUR LE BUREAU sans une ligne de plus, puisque c'est ce
     fichier-ci qui sait parler au processus principal d'Electron.

     Forme attendue par le moteur, respectee a la lettre :
         fn({ interactif, permissions }) -> Promise<{ token, expires_in, scope }>
     ========================================================================= */

  function enveloppe(j) {
    return {
      token: j,
      expires_in: Math.max(1, Math.round((S._expireA - Date.now()) / 1000)),
      scope: S.portees.join(' ')
    };
  }

  function fournisseur(opts) {
    opts = opts || {};
    var demandees = String(opts.permissions || '').split(/\s+/).filter(Boolean);
    var veutEcriture = demandees.indexOf(PORTEE.ecriture) >= 0;
    var veutDrive = demandees.indexOf(PORTEE.reglages) >= 0;

    /* `refuse` porte le jeton que Google vient de rejeter. Le moteur nous le
       rend, puisque nous sommes la seule autorite du jeton : a nous de le
       jeter. jeton() qui suit verra qu'il n'y en a plus, demandera un
       renouvellement silencieux, et, si Google le refuse aussi, levera
       « reconnexion necessaire » et montrera le bandeau. */
    if (opts.refuse) { invaliderJeton(opts.refuse); }

    return jeton({ attendre: false }).then(function (j) {
      /* Le moteur reclame l'ecriture et nous n'avons que la lecture : c'est
         le moment du consentement incremental (PARTIE 7). L'artisan vient de
         cocher un document ; la demande de Google arrive donc en reponse a un
         geste qu'il vient de faire, et non a froid. */
      var manqueEcriture = veutEcriture && !aLaPortee(PORTEE.ecriture);
      var manqueDrive = veutDrive && !aLaPortee(PORTEE.reglages);

      if (j && !manqueEcriture && !manqueDrive) { return enveloppe(j); }

      /* APRES UN REFUS, ON NE PARQUE PAS LA PROMESSE — ON REND LA MAIN.
         La PARTIE 12 fait attendre l'appelant jusqu'a la reconnexion, et c'est
         la bonne chose quand un jeton expire tout seul : rien n'est perdu.
         Apres un REFUS, non : une promesse qui ne se resout jamais laisse la
         file d'envoi du moteur bloquee sur elle-meme, et les lectures
         suivantes s'empilent derriere. On rejette donc proprement. Ce qui
         attendait reste dans la file du moteur, qui sait ne pas compter cet
         echec ; le bandeau est a l'ecran, avec le bouton pour s'en sortir ; et
         tout repart des que l'artisan a repondu. */
      if (!j && opts.refuse && !opts.interactif) {
        /* Un renouvellement deja en vol repondra tout seul : on ne l'accuse
           pas d'un echec qu'il n'a pas encore eu. Sinon, le refus est
           definitif et l'artisan doit le voir. */
        if (!S.renouvellementEnCours && !S.besoinReconnexion) {
          S.besoinReconnexion = true;
          prevenir();
        }
        if (S.besoinReconnexion) { montrerBandeau(); }
        throw nommer(new Error(M('bandeau')), 'ErreurReconnexion');
      }

      /* LE CONSENTEMENT INCREMENTAL SUPPOSE QU'ON EST DEJA CONNECTE.
         « Il nous manque l'ecriture » n'a de sens que si nous tenons deja la
         lecture : c'est alors que l'artisan vient de cocher un document, et la
         fenetre de Google arrive en reponse a son geste. Quand nous n'avons
         RIEN — le cas de chaque demarrage, ou le moteur demande son jeton
         avant que la reprise silencieuse ait abouti — il ne manque pas une
         permission, il manque une connexion. Ouvrir une fenetre la serait un
         surgissement que personne n'a demande, a chaque ouverture du
         programme. La regle du projet l'interdit, et elle a raison. */
      if (opts.interactif || ((manqueEcriture || manqueDrive) && S.connecte)) {
        return connecter({
          interactif: true,
          ecriture: veutEcriture || aLaPortee(PORTEE.ecriture),
          drive: veutDrive || aLaPortee(PORTEE.reglages)
        }).then(function (ok) {
          if (!ok || !valide()) { throw new Error('autorisation interrompue'); }
          return enveloppe(S._jeton);
        });
      }

      /* Ni jeton, ni droit d'ouvrir une fenetre : on ATTEND, exactement comme
         a la PARTIE 12. C'est ce qui fait que la file d'ecriture du moteur ne
         perd rien a l'expiration — elle repart quand l'artisan se reconnecte. */
      return jeton({ attendre: true }).then(function (j2) {
        if (!j2) { throw new Error('liaison Google absente'); }
        return enveloppe(j2);
      });
    });
  }


  /* =========================================================================
     PARTIE 13 — APPELER GOOGLE : LE SEUL CHEMIN AUTORISE
     ---------------------------------------------------------------------
     La brique moteur ne doit PAS appeler fetch() elle-meme. Elle passe par
     ici, et elle y gagne quatre choses qu'elle n'aurait pas a reecrire :
       1. le jeton frais, avec l'attente decrite a la PARTIE 12 ;
       2. la regle d'ecriture, verifiee avant l'envoi (PARTIE 3) ;
       3. le 401 rattrape : un renouvellement, un seul essai de plus ;
       4. les 403/429 de Google (trop de requetes) rendus reconnaissables,
          pour que la file sache ralentir au lieu de s'acharner.

     Exemple, cote brique moteur — poser une annotation :

        AP.gauth.appel('/calendars/primary/events/' + id, {
          methode: 'PATCH',
          corps: { extendedProperties: { private: {
            apStatut: 'fait', apDocs: '1,3,4'
          } } }
        });

     Et pour modifier l'heure d'un rendez-vous parce que l'artisan vient de le
     demander a l'ecran :

        AP.gauth.appel('/calendars/primary/events/' + id, {
          methode: 'PATCH',
          corps: { start: { … }, end: { … } },
          permission: AP.gauth.PERMISSION_EXPLICITE
        });

     ATTENTION, UN PIEGE DE GOOGLE : dans un PATCH, extendedProperties.private
     est REMPLACE en entier, pas fusionne. Envoyez toujours la totalite des
     annotations de ce rendez-vous, jamais la seule qui change.
     ========================================================================= */

  function appel(chemin, options) {
    options = options || {};
    var methode = (options.methode || options.method || 'GET').toUpperCase();
    var url = /^https?:/.test(chemin) ? chemin : (API_AGENDA + chemin);

    /* LA REGLE, AVANT LE RESEAU. Si elle refuse, rien ne part : la promesse
       se rejette avec une erreur nommee AP_REGLE_ECRITURE. */
    var corps;
    try {
      corps = verifierEcriture(methode, url, options.corps || options.body, options);
    } catch (e) {
      return Promise.reject(e);
    }

    function envoyer(leJeton, deuxiemeEssai) {
      var init = {
        method: methode,
        headers: { Authorization: 'Bearer ' + leJeton }
      };
      if (corps !== undefined && corps !== null && methode !== 'GET' && methode !== 'HEAD') {
        init.headers['Content-Type'] = 'application/json';
        init.body = JSON.stringify(corps);
      }

      return fetch(url, init).then(function (r) {
        /* 401 : le jeton est mort plus tot que prevu (revoque, mot de passe
           change). Un renouvellement, un seul nouvel essai. */
        if (r.status === 401 && !deuxiemeEssai) {
          S._jeton = '';
          S._expireA = 0;
          return renouveler().then(function () {
            return jeton().then(function (neuf) {
              if (!neuf) { throw nommer(new Error('jeton indisponible'), 'AP_SANS_JETON'); }
              return envoyer(neuf, true);
            });
          });
        }
        /* 403 avec un motif de quota, ou 429 : Google demande de ralentir.
           On rend une erreur reconnaissable pour que la file patiente au lieu
           de marteler l'API et de se faire bloquer plus longtemps. */
        if (r.status === 429 || r.status === 403) {
          return r.text().then(function (t) {
            var e = nommer(new Error('Google demande de ralentir (' + r.status + ')'), 'AP_TROP_VITE');
            e.statut = r.status;
            e.detail = t;
            throw e;
          });
        }
        if (!r.ok) {
          return r.text().then(function (t) {
            var e = nommer(new Error('Google a refuse (' + r.status + ')'), 'AP_GOOGLE');
            e.statut = r.status;
            e.detail = t;
            throw e;
          });
        }
        if (r.status === 204) { return null; }
        return r.json().catch(function () { return null; });
      });
    }

    return jeton({ attendre: options.attendre !== false }).then(function (j) {
      if (!j) { throw nommer(new Error('pas de liaison Google'), 'AP_SANS_JETON'); }
      return envoyer(j, false);
    });
  }

  function nommer(e, nom) { e.name = nom; return e; }


  /* =========================================================================
     PARTIE 14 — L'ETAT PUBLIC
     Une COPIE, jamais l'objet interne : une brique curieuse ne doit pas
     pouvoir ecrire S._jeton en passant. Et le jeton lui-meme n'est pas dans
     cette copie — on le demande par jeton(), qui sait le renouveler.
     ========================================================================= */

  function etat() {
    return {
      configure: S.configure,
      environnement: S.environnement,
      pret: S.pret,
      connecte: S.connecte,
      connexionEnCours: S.connexionEnCours,
      renouvellementEnCours: S.renouvellementEnCours,
      besoinReconnexion: S.besoinReconnexion,
      courriel: S.courriel,
      portees: S.portees.slice(),
      /* « peut » veut dire « peut, maintenant ». Tant que la reconnexion est
         attendue, le compte reste lie — d'ou `connecte` — mais plus rien ne
         passe : le dire autrement serait mentir a l'ecran qui s'y fie. */
      peutLire: S.connecte && !S.besoinReconnexion && (aLaPortee(PORTEE.lecture) || aLaPortee(PORTEE.ecriture)),
      peutEcrire: S.connecte && !S.besoinReconnexion && aLaPortee(PORTEE.ecriture),
      expireDans: S._expireA ? Math.max(0, S._expireA - Date.now()) : 0
    };
  }

  function onChange(fn) {
    if (typeof fn !== 'function') { return function () { }; }
    abonnes.push(fn);
    try { fn(etat()); } catch (e) { }
    return function () {
      var i = abonnes.indexOf(fn);
      if (i >= 0) { abonnes.splice(i, 1); }
    };
  }


  /* =========================================================================
     PARTIE 15 — L'API PUBLIQUE
     ========================================================================= */

  AP.gauth = {
    /* Les cinq demandees. */
    connecter: connecter,
    deconnecter: deconnecter,
    jeton: jeton,
    etat: etat,
    onChange: onChange,

    /* Le reste, dont la brique moteur a besoin. */
    appel: appel,

    /* La prise du moteur (PARTIE 12 bis) :
           AP.gsync.setTokenProvider(AP.gauth.fournisseur); */
    fournisseur: fournisseur,

    demanderEcriture: demanderEcriture,
    pastille: creerPastille,

    /* A appeler apres avoir range un googleClientId dans les reglages :
       sans cet appel la brique reste endormie jusqu'au prochain
       rechargement de la page. */
    reconfigurer: reconfigurer,

    /* Les valeurs que la brique moteur doit connaitre pour respecter la regle
       sans la recopier : le nom du champ de marquage, la marque, la phrase de
       permission explicite, et la liste des champs qui appartiennent a
       l'artisan. */
    CLE_ORIGINE: CLE_ORIGINE,
    MARQUE: MARQUE,
    PERMISSION_EXPLICITE: PERMISSION_EXPLICITE,
    CHAMPS_PROTEGES: CHAMPS_PROTEGES.slice(),
    PORTEE: PORTEE,

    /* Une promesse resolue quand la brique a fini de s'installer : la
       librairie de Google est chargee (ou declaree injoignable) et une
       eventuelle session silencieuse a ete tentee. La brique moteur l'attend
       avant de decider si elle travaille en local ou avec Google. */
    pret: null
  };


  /* =========================================================================
     PARTIE 16 — LE DEMARRAGE
     ---------------------------------------------------------------------
     Rien d'agressif. Si Google n'est pas configure, on s'arrete ici et
     l'application est, au comportement pres, celle d'hier.
     ========================================================================= */

  function demarrage() {
    if (!S.configure) {
      journal('aucun googleClientId — brique au repos');
      S.pret = true;
      return Promise.resolve(etat());
    }

    detecterEnvironnement();

    return new Promise(function (resoudre) {
      function demarrer() {
        accrocherPastille();

        var pont = pontBureau();

        /* SUR LE BUREAU : le processus principal garde un refresh token. On
           lui demande poliment s'il a deja une session ; si oui, l'artisan
           est connecte sans avoir rien a faire, meme apres un redemarrage de
           Windows. */
        if (pont) {
          pont.googleJeton(porteesVoulues('lecture')).then(function (r) {
            if (r && r.access_token) { poserJeton(r); if (r.email) { S.courriel = r.email; } }
            S.pret = true; prevenir(); resoudre(etat());
          }).catch(function () { S.pret = true; prevenir(); resoudre(etat()); });
          return;
        }

        if (S.environnement === 'bureau-sans-pont') {
          /* On ne charge meme pas la librairie de Google : elle ne pourrait
             pas fonctionner ici, et une erreur dans la console est exactement
             ce que ce projet s'interdit. */
          S.pret = true; prevenir(); resoudre(etat());
          return;
        }

        /* SUR LE WEB : on tente une reprise SILENCIEUSE. C'est ce qui rattrape
           le rechargement de la page — souvenez-vous que le jeton n'est pas
           garde sur le disque, expres. Si la session Google est vivante, la
           pastille passe au vert en une demi-seconde et l'artisan n'a rien vu.
           Si elle ne l'est pas, il ne se passe RIEN : aucune fenetre ne
           surgit sans qu'on ait clique, aucune erreur. */
        demanderJetonGis(porteesVoulues('lecture'), false).then(function (r) {
          if (r && r.access_token) {
            poserJeton(r);
            return lireLeCompte();
          }
          journal('pas de session Google silencieuse — on reste en local');
        }).catch(function () { }).then(function () {
          S.pret = true;
          prevenir();
          resoudre(etat());
        });
      }

      if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', demarrer);
      } else {
        demarrer();
      }
    });
  }

  AP.gauth.pret = demarrage();


  /* ---------------------------------------------------------------------
     RECONFIGURER — l'artisan vient de coller son identifiant
     ---------------------------------------------------------------------
     Le panneau de reglages range l'identifiant puis nous appelle. Si la
     brique dormait faute d'identifiant et qu'il y en a un maintenant, on
     demarre pour de bon : la pastille apparait, la reprise silencieuse est
     tentee. Sans cela, l'artisan colle son identifiant et il ne se passe
     RIEN — c'etait exactement le defaut.

     Idempotente : si l'etat n'a pas change, on ne redemarre pas. */
  function reconfigurer() {
    var avant = S.configure;
    S.configure = !!idClient();
    if (S.configure === avant) { return AP.gauth.pret; }
    if (!S.configure) { prevenir(); return AP.gauth.pret; }
    journal('identifiant Google trouve — la brique se reveille');
    S.pret = false;
    AP.gauth.pret = demarrage();
    prevenir();
    return AP.gauth.pret;
  }


  /* Quand la machine sort de veille ou que l'onglet revient au premier plan,
     le minuteur de la PARTIE 8 a pu dormir avec elle. On verifie alors tout
     de suite, sans attendre la prochaine ecriture. */
  document.addEventListener('visibilitychange', function () {
    if (document.visibilityState !== 'visible') { return; }
    if (!S.connecte) { return; }
    if (!valide() || (S._expireA - Date.now()) < MARGE_MS) { renouveler(); }
  });

})();
