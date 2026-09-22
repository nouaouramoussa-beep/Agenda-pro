/* ============================================================================
   AGENDA PRO — app/google/electron-google.js
   LA CONNEXION GOOGLE DU COTE DU PROGRAMME DE BUREAU.
   Ce fichier tourne dans le PROCESSUS PRINCIPAL d'Electron, pas dans la page.
   ----------------------------------------------------------------------------

   ###########################################################################
   #  RAPPEL DE LA REGLE — L'AGENDA N'EST PAS A NOUS                        #
   #  Le programme n'ecrit JAMAIS dans summary, description, start, end,    #
   #  attendees ni recurrence d'un rendez-vous existant. Il n'ecrit que     #
   #  dans extendedProperties.private. Ce fichier-ci ne touche a aucun      #
   #  rendez-vous : il ne fait qu'obtenir le laissez-passer. La regle est   #
   #  appliquee par le code dans app/google/gauth.js, PARTIE 3, par ou      #
   #  passent toutes les requetes.                                          #
   ###########################################################################


   POURQUOI CE FICHIER EXISTE — ET POURQUOI IL N'Y AVAIT PAS D'AUTRE CHOIX
   -----------------------------------------------------------------------
   Sur le site publie, la connexion Google se fait entierement dans la page,
   avec la librairie « Google Identity Services ». Cette librairie exige que
   l'adresse exacte de la page soit inscrite d'avance dans la console Google,
   sous « Origines JavaScript autorisees ». Google compare cette adresse
   caractere par caractere, PORT COMPRIS, et n'accepte aucun caractere joker.

   Or le programme de bureau ne charge pas une adresse fixe : main.js,
   PARTIE 4 bis, demande a Windows un port LIBRE au demarrage (« port 0 »),
   pour que deux exemplaires du programme ne se marchent jamais dessus. La
   page s'ouvre donc sur http://127.0.0.1:51234 aujourd'hui, 49871 demain.
   On ne peut pas inscrire d'avance une adresse qu'on ne connaitra qu'au
   demarrage. Il n'y a pas d'astuce : la librairie du navigateur ne peut pas
   fonctionner ici.

   La voie prevue par Google pour ce cas s'appelle « application installee ».
   Elle ne passe pas par la page, mais par le programme lui-meme :
     1. le programme ouvre une adresse Google dans le NAVIGATEUR HABITUEL de
        l'artisan — pas dans une fenetre Electron ;
     2. il ouvre en meme temps, pour quelques secondes, un minuscule serveur
        sur 127.0.0.1, sur un port au hasard ;
     3. quand l'artisan a dit oui, Google renvoie le navigateur vers ce petit
        serveur, qui recupere un code a usage unique et se ferme ;
     4. le programme echange ce code contre un jeton.

   POUR CE TYPE DE CLIENT, ET POUR LUI SEUL, Google accepte n'importe quel
   port sur 127.0.0.1 : il n'y a RIEN a inscrire dans la console pour le port.
   C'est exactement le probleme d'en haut, resolu.

   POURQUOI LE NAVIGATEUR DE L'ARTISAN, ET PAS UNE FENETRE DU PROGRAMME ?
   Parce que l'artisan doit voir la barre d'adresse et le cadenas de son vrai
   navigateur avant de taper son mot de passe Google. Une fenetre sans barre
   d'adresse, c'est exactement ce que fabrique un logiciel qui vole des mots
   de passe ; Google refuse d'ailleurs ces fenetres depuis plusieurs annees.
   Et puis sa session Google est deja ouverte dans son navigateur : le plus
   souvent, il n'a qu'un bouton a cliquer.

   CE QU'ON Y GAGNE EN PLUS, ET CE N'EST PAS RIEN
   ----------------------------------------------
   Cette voie-la donne un REFRESH TOKEN : de quoi refabriquer un jeton
   d'acces, tout seul, pendant des mois. Sur le bureau, l'artisan se connecte
   UNE FOIS. Le probleme du jeton d'une heure, explique dans gauth.js, ne
   concerne plus que la version web.


   AU SUJET DU « CLIENT SECRET » — A LIRE, C'EST CONTRE-INTUITIF
   -------------------------------------------------------------
   Google fournit un « client secret » avec un client de type « Application
   de bureau ». Il va falloir l'ecrire dans le programme, et cela ressemble a
   une faute. Ce n'en est pas une, et Google le documente noir sur blanc :
   pour une application installee, ce secret N'EST PAS considere comme un
   secret, puisque le programme est sur la machine de l'utilisateur et que
   n'importe qui peut l'y lire. Ce qui protege reellement l'echange, c'est
   PKCE : un nombre au hasard tire a chaque connexion, dont seul le programme
   connait la forme d'origine. Un voleur qui intercepterait le code de retour
   ne pourrait rien en faire sans ce nombre-la.

   DEUX PRECAUTIONS QUI, ELLES, NE SE DISCUTENT PAS :
     - ce secret doit etre celui d'un client « Application de bureau », JAMAIS
       celui d'un client « Application Web ». Celui d'un client Web est un
       vrai secret, et l'ecrire ici serait une faute grave.
     - ce client ne donne acces a rien par lui-meme : sans le oui de
       l'artisan devant l'ecran de Google, il n'ouvre aucune porte.


   CE QUE CE FICHIER GARDE SUR LE DISQUE, ET COMMENT
   --------------------------------------------------
   Le refresh token, et lui seul. Il est CHIFFRE par safeStorage, qui s'appuie
   sur le coffre de Windows (DPAPI) : le fichier obtenu est illisible sur une
   autre machine et par un autre compte Windows. Si safeStorage n'est pas
   disponible, ON N'ECRIT RIEN — il vaut mieux redemander une connexion de
   temps en temps que laisser trainer une cle en clair.

   Le JETON D'ACCES, lui, ne descend jamais sur le disque : il reste en
   memoire ici, et la page le redemande quand elle en a besoin. Meme regle que
   dans gauth.js, et pour les memes raisons.

   ----------------------------------------------------------------------------
   COMMENT S'EN SERVIR : voir app/google/CONSOLE-GOOGLE.md, section
   « Ce qu'il faut ajouter a Electron ». Trois lignes dans main.js, deux dans
   preload.js, une ligne de politique de securite a completer.
   ============================================================================ */

'use strict';

const http = require('http');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const { ipcMain, shell, safeStorage, app } = require('electron');


/* ---------------------------------------------------------------------------
   LES ADRESSES DE GOOGLE. Aucune n'est repetee ailleurs dans le fichier.
   --------------------------------------------------------------------------- */
const AUTORISATION = 'https://accounts.google.com/o/oauth2/v2/auth';
const ECHANGE = 'https://oauth2.googleapis.com/token';
const REVOCATION = 'https://oauth2.googleapis.com/revoke';
const QUI_SUIS_JE = 'https://www.googleapis.com/oauth2/v3/userinfo';

/* Cinq minutes pour dire oui dans le navigateur. Au-dela, on ferme le petit
   serveur : un port qui reste ouvert a ne rien faire est un port de trop. */
const DELAI_MS = 5 * 60 * 1000;


/* ===========================================================================
   L'INSTALLATION — a appeler une fois, depuis main.js
   ---------------------------------------------------------------------------
   Si clientId est vide, cette fonction ne declare AUCUN canal : la page ne
   verra pas de pont Google, gauth.js le constatera et restera silencieux.
   C'est la regle du projet — on ne casse jamais l'existant.
   =========================================================================== */

function installerGoogle(options) {
  const clientId = (options && options.clientId) || '';
  const clientSecret = (options && options.clientSecret) || '';
  const bavard = !!(options && options.bavard);

  function journal() {
    if (!bavard) { return; }
    try { console.log.apply(console, ['[google]'].concat([].slice.call(arguments))); } catch (e) { }
  }

  if (!clientId) {
    journal('aucun identifiant de bureau — pont Google non installe');
    return false;
  }

  /* Le jeton d'acces vit ICI, en memoire, et nulle part ailleurs. */
  let jetonAcces = '';
  let expireA = 0;
  let porteesAccordees = [];
  let courriel = '';

  /* Une seule connexion a la fois : deux fenetres de navigateur ouvertes en
     meme temps, c'est un artisan qui ne sait plus laquelle regarder. */
  let flotEnCours = null;


  /* -------------------------------------------------------------------------
     LE COFFRE : le refresh token, chiffre par Windows.
     ------------------------------------------------------------------------- */

  function cheminCoffre() {
    return path.join(app.getPath('userData'), 'google-liaison.dat');
  }

  function ecrireCoffre(refresh) {
    try {
      if (!refresh) { return false; }
      if (!safeStorage.isEncryptionAvailable()) {
        /* Pas de coffre : on ne garde rien. L'artisan devra se reconnecter
           apres un redemarrage. C'est le bon compromis. */
        journal('safeStorage indisponible — rien n\'est garde sur le disque');
        return false;
      }
      fs.writeFileSync(cheminCoffre(), safeStorage.encryptString(refresh), { mode: 0o600 });
      return true;
    } catch (e) { journal('ecriture du coffre impossible:', e.message); return false; }
  }

  function lireCoffre() {
    try {
      if (!safeStorage.isEncryptionAvailable()) { return ''; }
      const f = cheminCoffre();
      if (!fs.existsSync(f)) { return ''; }
      return safeStorage.decryptString(fs.readFileSync(f));
    } catch (e) {
      /* Un coffre illisible (profil Windows recree, fichier copie d'une autre
         machine) n'est pas une panne : on l'efface et on redemande. */
      journal('coffre illisible — on repart de zero');
      try { fs.unlinkSync(cheminCoffre()); } catch (e2) { }
      return '';
    }
  }

  function viderCoffre() {
    try { fs.unlinkSync(cheminCoffre()); } catch (e) { }
  }


  /* -------------------------------------------------------------------------
     PKCE — LE NOMBRE AU HASARD QUI PROTEGE L'ECHANGE
     On tire un long nombre au hasard (le « verifier »), on en envoie a Google
     l'EMPREINTE (le « challenge »), et on ne revele le nombre lui-meme qu'au
     moment d'echanger le code. Quelqu'un qui intercepterait le code de retour
     — un autre logiciel a l'ecoute sur la machine, par exemple — ne pourrait
     rien en faire : il lui manquerait le nombre.
     ------------------------------------------------------------------------- */

  function base64url(buf) {
    return buf.toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  }
  function fabriquerPkce() {
    const verifier = base64url(crypto.randomBytes(48));
    const challenge = base64url(crypto.createHash('sha256').update(verifier).digest());
    return { verifier, challenge };
  }


  /* -------------------------------------------------------------------------
     LE PETIT SERVEUR D'UN INSTANT
     Il n'ecoute que sur 127.0.0.1 — la machine elle-meme, jamais le reseau de
     l'atelier — sur un port que Windows choisit parmi les libres, et il se
     ferme des qu'il a fait son travail.
     ------------------------------------------------------------------------- */

  function pageDeRetour(ok) {
    const titre = ok ? 'C\'est fait — تم' : 'Annule — أُلغي';
    const texte = ok
      ? 'Vous pouvez fermer cet onglet et revenir a Agenda Pro.<br>يمكنك إغلاق هذه الصفحة والعودة إلى البرنامج.'
      : 'La connexion n\'a pas abouti.<br>لم يكتمل الربط.';
    /* Une page volontairement nue, avec sa propre politique de securite : elle
       ne charge rien, n'execute rien, ne sort pas de la machine. */
    return '<!DOCTYPE html><html lang="fr"><head><meta charset="utf-8">' +
      '<meta http-equiv="Content-Security-Policy" content="default-src \'none\'; style-src \'unsafe-inline\'">' +
      '<title>Agenda Pro</title><style>' +
      'body{font-family:system-ui,sans-serif;background:#f5f7fa;color:#101a2b;display:flex;' +
      'align-items:center;justify-content:center;height:100vh;margin:0;text-align:center}' +
      'div{max-width:420px;padding:28px 30px;background:#fff;border:1px solid #e3e9f0;border-radius:14px}' +
      'h1{font-size:19px;margin:0 0 10px}p{font-size:14px;line-height:1.7;color:#54637c;margin:0}' +
      '</style></head><body><div><h1>' + titre + '</h1><p>' + texte + '</p></div></body></html>';
  }

  /* Ouvre le serveur et rend { port, attendre, fermer } :
       port     celui que Windows vient de nous donner — on en a besoin TOUT
                DE SUITE, pour le mettre dans l'adresse envoyee a Google ;
       attendre une promesse qui donnera le code de retour, ou null ;
       fermer   pour tout ranger si la suite echoue avant le retour.
     On rend le port et l'attente SEPAREMENT parce qu'ils n'arrivent pas au
     meme moment : le port est connu en quelques millisecondes, le code peut
     mettre deux minutes — le temps que l'artisan trouve son mot de passe. */
  function ouvrirServeurRetour(etatAttendu) {
    return new Promise(function (resoudrePort, rejeterPort) {
      let fini = false;
      let minuteur = null;
      let donnerLeCode = null;
      const attendre = new Promise(function (r) { donnerLeCode = r; });

      function terminer(code) {
        if (fini) { return; }
        fini = true;
        if (minuteur) { clearTimeout(minuteur); minuteur = null; }
        try { serveur.close(); } catch (e) { }
        donnerLeCode(code || null);
      }

      const serveur = http.createServer(function (requete, reponse) {
        let code = '';
        let ok = false;
        try {
          /* L'adresse de base n'a aucune importance : elle ne sert qu'a
             donner a l'analyseur d'URL de quoi travailler. */
          const u = new URL(requete.url, 'http://127.0.0.1');
          if (u.pathname === '/retour') {
            /* LA VERIFICATION QUI COMPTE : le « state ». Sans elle, un autre
               logiciel de la machine pourrait nous pousser SON code de retour
               et lier le programme a SON compte Google. */
            if (u.searchParams.get('state') === etatAttendu) {
              code = u.searchParams.get('code') || '';
              ok = !!code;
            }
          }
        } catch (e) { }

        reponse.writeHead(200, {
          'Content-Type': 'text/html; charset=utf-8',
          'Cache-Control': 'no-store'
        });
        reponse.end(pageDeRetour(ok));

        terminer(code);
      });

      /* Le port est pris par un autre logiciel, ou Windows refuse l'ecoute :
         on le dit a l'appelant, qui renoncera proprement. */
      serveur.on('error', function (e) {
        if (!fini) { rejeterPort(e); }
        terminer(null);
      });

      /* Port 0 : Windows nous en donne un de libre. Google l'accepte pour un
         client « Application de bureau » — c'est toute l'astuce. */
      serveur.listen(0, '127.0.0.1', function () {
        const port = serveur.address().port;
        journal('petit serveur de retour sur 127.0.0.1:' + port);

        minuteur = setTimeout(function () {
          journal('personne n\'est revenu au bout de 5 minutes');
          terminer(null);
        }, DELAI_MS);

        resoudrePort({
          port: port,
          attendre: attendre,
          fermer: function () { terminer(null); }
        });
      });
    });
  }


  /* -------------------------------------------------------------------------
     PARLER A GOOGLE
     ------------------------------------------------------------------------- */

  async function posterFormulaire(url, champs) {
    const corps = new URLSearchParams(champs).toString();
    const r = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: corps
    });
    const texte = await r.text();
    let json = null;
    try { json = JSON.parse(texte); } catch (e) { }
    if (!r.ok) {
      journal('Google a refuse (' + r.status + ') :', (json && json.error) || texte.slice(0, 200));
      return null;
    }
    return json;
  }

  /* Ranger une reponse de Google, et rendre a la page la forme exacte que
     gauth.js attend : { access_token, expires_in, scope, email }. */
  async function ranger(reponse) {
    if (!reponse || !reponse.access_token) { return null; }
    jetonAcces = reponse.access_token;
    const secondes = parseInt(reponse.expires_in, 10) || 3600;
    expireA = Date.now() + secondes * 1000;
    porteesAccordees = String(reponse.scope || '').split(/\s+/).filter(Boolean);
    if (reponse.refresh_token) { ecrireCoffre(reponse.refresh_token); }

    if (!courriel) { courriel = await lireCourriel(); }

    return {
      access_token: jetonAcces,
      expires_in: Math.max(1, Math.round((expireA - Date.now()) / 1000)),
      scope: porteesAccordees.join(' '),
      email: courriel
    };
  }

  async function lireCourriel() {
    try {
      const r = await fetch(QUI_SUIS_JE, { headers: { Authorization: 'Bearer ' + jetonAcces } });
      if (!r.ok) { return ''; }
      const d = await r.json();
      return (d && d.email) || '';
    } catch (e) { return ''; }
  }


  /* -------------------------------------------------------------------------
     LA CONNEXION COMPLETE
     ------------------------------------------------------------------------- */

  async function connecter(portees) {
    if (flotEnCours) { return flotEnCours; }

    flotEnCours = (async function () {
      const pkce = fabriquerPkce();
      const etat = base64url(crypto.randomBytes(24));

      /* On lance l'ecoute AVANT d'ouvrir le navigateur : il faut connaitre le
         port pour pouvoir le donner a Google comme adresse de retour. */
      let retour;
      try {
        retour = await ouvrirServeurRetour(etat);
      } catch (e) {
        journal('impossible d\'ouvrir le petit serveur:', e.message);
        return null;
      }

      const redirection = 'http://127.0.0.1:' + retour.port + '/retour';

      const adresse = AUTORISATION + '?' + new URLSearchParams({
        client_id: clientId,
        redirect_uri: redirection,
        response_type: 'code',
        scope: (portees || []).join(' '),
        state: etat,
        code_challenge: pkce.challenge,
        code_challenge_method: 'S256',

        /* access_type=offline + prompt=consent : c'est ce couple qui fait que
           Google delivre un refresh token. Sans lui, on retomberait dans le
           probleme du jeton d'une heure, sur le bureau aussi. */
        access_type: 'offline',
        prompt: 'consent',

        /* Les droits deja accordes le restent : c'est ce qui permet de
           demander l'ecriture plus tard sans perdre la lecture (le
           consentement incremental de gauth.js, PARTIE 7). */
        include_granted_scopes: 'true'
      }).toString();

      journal('ouverture du navigateur de l\'artisan');
      try {
        await shell.openExternal(adresse);
      } catch (e) {
        journal('impossible d\'ouvrir le navigateur:', e.message);
        retour.fermer();     /* pas de navigateur, pas de retour : on range */
        return null;
      }

      const code = await retour.attendre;
      if (!code) { return null; }

      const reponse = await posterFormulaire(ECHANGE, {
        client_id: clientId,
        client_secret: clientSecret,
        code: code,
        code_verifier: pkce.verifier,
        grant_type: 'authorization_code',
        redirect_uri: redirection
      });

      courriel = '';   /* le compte a pu changer : on le relira */
      return await ranger(reponse);
    })();

    try { return await flotEnCours; }
    finally { flotEnCours = null; }
  }


  /* -------------------------------------------------------------------------
     LE JETON SILENCIEUX — le vrai confort du bureau
     Si le jeton en memoire est encore bon, on le rend. Sinon on en refabrique
     un avec le refresh token, SANS RIEN AFFICHER. C'est ce qui fait qu'un
     artisan se connecte une fois et n'y repense plus.
     ------------------------------------------------------------------------- */

  async function jetonSilencieux(portees) {
    /* Encore valide, avec une minute de marge ? On ne derange pas Google. */
    if (jetonAcces && Date.now() < expireA - 60000) {
      if (couvre(portees)) {
        return {
          access_token: jetonAcces,
          expires_in: Math.max(1, Math.round((expireA - Date.now()) / 1000)),
          scope: porteesAccordees.join(' '),
          email: courriel
        };
      }
    }

    const refresh = lireCoffre();
    if (!refresh) { return null; }

    const reponse = await posterFormulaire(ECHANGE, {
      client_id: clientId,
      client_secret: clientSecret,
      refresh_token: refresh,
      grant_type: 'refresh_token'
    });

    if (!reponse) {
      /* Le refresh token a ete revoque (mot de passe change, acces retire
         depuis le compte Google). On efface, et la page proposera une
         reconnexion : c'est l'invite claire et non bloquante de gauth.js. */
      viderCoffre();
      jetonAcces = ''; expireA = 0; porteesAccordees = [];
      return null;
    }

    const range = await ranger(reponse);
    if (range && !couvre(portees)) {
      /* On a bien un jeton, mais il ne couvre pas ce qui est demande (par
         exemple l'ecriture, jamais accordee). On le dit, la page ouvrira une
         vraie demande de consentement. */
      return null;
    }
    return range;
  }

  function couvre(portees) {
    if (!portees || !portees.length) { return true; }
    for (let i = 0; i < portees.length; i++) {
      if (porteesAccordees.indexOf(portees[i]) < 0) { return false; }
    }
    return true;
  }


  /* -------------------------------------------------------------------------
     LA DECONNEXION
     On oublie, on efface, et on demande a Google d'oublier aussi.
     ------------------------------------------------------------------------- */

  async function deconnecter() {
    const refresh = lireCoffre();
    jetonAcces = ''; expireA = 0; porteesAccordees = []; courriel = '';
    viderCoffre();
    if (refresh) {
      /* On revoque le refresh token : cela revoque aussi les jetons d'acces
         qui en descendent. Si Google ne repond pas, tant pis — plus rien
         n'est garde de notre cote. */
      try { await posterFormulaire(REVOCATION, { token: refresh }); } catch (e) { }
    }
    return true;
  }


  /* -------------------------------------------------------------------------
     LES TROIS CANAUX, ET PAS UN DE PLUS
     Meme discipline que preload.js : des INTENTIONS precises, jamais un outil
     general. La page ne peut ni choisir l'adresse appelee, ni lire le refresh
     token, ni demander un jeton pour autre chose que l'agenda.
     ------------------------------------------------------------------------- */

  /* Les seules portees que ce pont acceptera de demander. Une page piratee
     qui reclamerait « lire tous vos courriels » se ferait renvoyer. */
  const PORTEES_PERMISES = [
    'https://www.googleapis.com/auth/calendar.events',
    'https://www.googleapis.com/auth/calendar.events.readonly',
    'https://www.googleapis.com/auth/drive.appdata',
    'https://www.googleapis.com/auth/userinfo.email',
    'openid', 'email'
  ];

  function filtrer(portees) {
    if (!Array.isArray(portees)) { return []; }
    return portees
      .map(function (p) { return String(p || ''); })
      .filter(function (p) { return PORTEES_PERMISES.indexOf(p) >= 0; });
  }

  ipcMain.handle('ap:google-connecter', async function (evenement, portees) {
    const p = filtrer(portees);
    if (!p.length) { return null; }
    try { return await connecter(p); }
    catch (e) { journal('connexion:', e.message); return null; }
  });

  ipcMain.handle('ap:google-jeton', async function (evenement, portees) {
    try { return await jetonSilencieux(filtrer(portees)); }
    catch (e) { journal('jeton:', e.message); return null; }
  });

  ipcMain.handle('ap:google-deconnecter', async function () {
    try { return await deconnecter(); }
    catch (e) { return false; }
  });

  journal('pont Google installe');
  return true;
}

module.exports = { installerGoogle };
