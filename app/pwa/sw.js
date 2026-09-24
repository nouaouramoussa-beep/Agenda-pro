/* ============================================================================
   AGENDA PRO — app/pwa/sw.js
   LE « SERVICE WORKER » : le petit gardien qui repond a la place du reseau.
   ----------------------------------------------------------------------------
   QU'EST-CE QUE C'EST, EN UNE PHRASE ?
   Un bout de programme que le navigateur garde en memoire meme quand votre
   page est fermee, et qui se met en travers de CHAQUE demande de fichier. Il
   peut repondre depuis une reserve locale au lieu d'aller sur internet. C'est
   ce qui permet a l'application de s'ouvrir dans un sous-sol, dans un camion,
   ou avec un forfait epuise.

   LES TROIS REGLES DE CE FICHIER, DANS L'ORDRE D'IMPORTANCE
   ---------------------------------------------------------
   1. ON NE MET JAMAIS EN RESERVE CE QUI VIENT DU SERVEUR SUPABASE, NI UN
      JETON DE CONNEXION. Jamais. Pas « rarement » : jamais. Deux raisons :
        * un jeton copie dans la reserve du navigateur y reste apres la
          deconnexion. Le SQL (session_is_live() dans 003_durcissement.sql)
          coupe les jetons emis avant une deconnexion globale — ce travail
          serait ruine si une vieille reponse ressortait de notre reserve ;
        * les donnees d'une organisation sont protegees ligne par ligne par
          les policies RLS. Une reponse mise en reserve, elle, n'est protegee
          par rien : sur un telephone partage entre deux employes, le second
          verrait les donnees du premier.
      La synchronisation a deja SA propre memoire locale, pensee pour cela
      (app/sync/sync.js et sa file d'attente). Ce n'est pas notre travail.
   2. LA COQUILLE (index.html, les fichiers .js, .css, les icones, les
      polices) est servie DEPUIS LA RESERVE D'ABORD. Elle ne change qu'au
      moment d'une publication, donc l'application s'ouvre instantanement,
      avec ou sans reseau.
   3. LES DONNEES PUBLIQUES (la meteo, par exemple) sont demandees AU RESEAU
      D'ABORD, avec repli sur la reserve. Une meteo d'hier vaut mieux qu'une
      case vide, mais une meteo d'aujourd'hui vaut mieux qu'une meteo d'hier.

   LA CHOSE A NE PAS OUBLIER LE JOUR D'UNE PUBLICATION
   ---------------------------------------------------
   >>> CHANGEZ LE NUMERO « VERSION » CI-DESSOUS. <<<
   C'est le seul geste manuel de tout ce fichier. Le navigateur ne remplace ce
   gardien que s'il voit que son texte a change. Tant que le numero est le
   meme, vos clients gardent l'ancienne version, et vous croirez avoir publie.
   (Filet de securite : meme si vous oubliez, ce fichier surveille index.html
   en arriere-plan et previent la page quand il a change — voir « surveiller ».
   Mais c'est un filet, pas une methode.)
   ============================================================================ */

'use strict';

/* ===========================================================================
   PARTIE 1 — LE NUMERO DE VERSION ET LES TROIS RESERVES
   =========================================================================== */

/* >>> A CHANGER A CHAQUE PUBLICATION <<< (1.0.0 -> 1.0.1 -> 1.1.0 ...) */
var VERSION = '1.2.0+20260924T144709';   /* 1.2.0 : periodes de calendrier, liaison sans gel (23/09/2026) — 1.1.0 : synchronisation Google */

/* Le prefixe commun sert au menage : tout ce qui commence par « agendapro- »
   et qui n'est pas dans la liste du jour sera efface a l'activation. */
var PREFIXE = 'agendapro-';

/* Trois reserves separees, et non une seule, parce qu'elles ne se vident pas
   au meme rythme : la coquille se remplace a chaque publication, les donnees
   vieillissent en quelques heures, les polices ne changent jamais. */
var C_COQUILLE = PREFIXE + 'coquille-' + VERSION;
var C_DONNEES  = PREFIXE + 'donnees-'  + VERSION;
var C_POLICES  = PREFIXE + 'polices-1';   /* les polices ne changent jamais : pas retelechargees a chaque publication */
var MES_CACHES = [C_COQUILLE, C_DONNEES, C_POLICES];

/* La racine que ce gardien surveille. Elle vient du navigateur lui-meme, pas
   d'une adresse ecrite en dur : l'application fonctionne donc aussi bien a la
   racine d'un domaine que dans un sous-dossier. */
var BASE = self.registration.scope;
var ORIGINE = (function () {
  try { return new URL(BASE).origin; } catch (e) { return ''; }
})();

/* L'adresse du serveur Supabase nous est transmise dans l'adresse de ce
   fichier (sw.js?sb=https://xxx.supabase.co) par app/pwa/pwa.js. Pourquoi ?
   Parce qu'un service worker ne peut pas lire window.AP_CONFIG : il ne vit pas
   dans la page. C'est notre premiere barriere ; les regles generiques plus bas
   (chemins /rest/v1/, /auth/v1/...) en sont une deuxieme, au cas ou la
   configuration serait vide. */
var SUPABASE = (function () {
  try { return new URL(self.location.href).searchParams.get('sb') || ''; }
  catch (e) { return ''; }
})();


/* ===========================================================================
   PARTIE 2 — CE QU'ON MET EN RESERVE A L'INSTALLATION
   ---------------------------------------------------------------------------
   La « coquille » : tout ce qu'il faut pour que l'application s'affiche, sans
   la moindre donnee. Un fichier absent de cette liste n'est pas une erreur, il
   sera simplement mis en reserve a sa premiere utilisation.
   =========================================================================== */

var COQUILLE = [
  '',                               /* la racine : beaucoup de serveurs y servent index.html */
  'index.html',

  /* LE VERROU EN PREMIER, ET CE N'EST PAS UN DETAIL : si ces deux fichiers
     manquaient hors ligne alors qu'un mot de passe est defini, l'application
     refuserait de demarrer (elle ne peut pas dechiffrer sans eux). Ils font
     donc partie de la coquille au meme titre que index.html. */
  'app/lock/lock.js',
  'app/lock/lock.css',

  'app/config.js',
  'app/supabase-client.js',

  'app/auth/auth.js',
  'app/auth/auth.css',
  'app/auth/auth-ui.html',

  'app/sync/sync.js',
  'app/sync/migrate.js',

  'app/billing/billing.js',
  'app/billing/pricing.html',

  /* LA SYNCHRONISATION PAR GOOGLE AGENDA.
     Elle a sa place dans la coquille, et pas au rayon des extras : c'est elle
     qui fait que le telephone et le bureau montrent la meme chose. Sans ces
     quatre fichiers en reserve, l'artisan qui ouvre le programme dans le
     tunnel ou sur un chantier sans reseau retrouverait bien ses rendez-vous
     (ils sont deja dans le localStorage), mais il perdrait les boutons pour
     synchroniser des le retour du reseau. Le jeton, lui, n'est jamais mis en
     reserve : voir la regle plus bas, aucune reponse portant un jeton n'entre
     dans le cache. */
  'app/google/gauth.js',
  'app/google/gauth.css',
  'app/google/gsync.js',
  'app/google/gbridge.js',

  'app/pwa/pwa.js',
  'app/pwa/manifest.webmanifest',
  'app/pwa/icons/icon-192.svg',
  'app/pwa/icons/icon-512.svg',
  'app/pwa/icons/icon-maskable.svg',
  'app/pwa/icons/icon-192.png',
  'app/pwa/icons/icon-512.png',
  'app/pwa/icons/icon-maskable-512.png',
  'app/pwa/icons/apple-touch-icon.png'
];


/* ===========================================================================
   PARTIE 3 — LES LISTES QUI DECIDENT DE TOUT
   =========================================================================== */

/* INTERDIT DE RESERVE — le coeur de la regle numero un.
   Tout ce qui touche a l'identite, a l'argent ou aux donnees du client. */
var HOTES_INTERDITS = [
  'stripe.com', 'js.stripe.com', 'api.stripe.com', 'checkout.stripe.com', 'm.stripe.network',
  'accounts.google.com', 'oauth2.googleapis.com', 'www.googleapis.com', 'apis.google.com',
  'generativelanguage.googleapis.com', 'securetoken.googleapis.com'
];

/* Les mots qui, trouves dans une adresse, signalent un secret de passage.
   Exemple reel : l'appel a Gemini dans index.html transporte la cle de l'API
   dans l'adresse (…?key=AIza…). Mettre cette reponse en reserve reviendrait a
   ecrire la cle sur le disque du telephone. */
var PARAMS_SENSIBLES = [
  'access_token', 'refresh_token', 'id_token', 'provider_token',
  'code', 'key', 'apikey', 'api_key', 'token', 'secret', 'password'
];

/* AUTORISES — polices de caracteres. L'application utilise Cairo (arabe) et
   DM Sans (francais) : sans elles, hors ligne, tout le texte change de forme
   et la mise en page saute. */
var HOTES_POLICES = ['fonts.googleapis.com', 'fonts.gstatic.com'];

/* AUTORISE — la librairie Supabase, a une version FIGEE (voir
   app/supabase-client.js). On met en reserve le PROGRAMME, jamais ce qu'il
   transporte. Sans cela, l'ouverture hors ligne attend douze secondes que le
   telechargement expire avant de basculer en mode local. */
var HOTES_CDN = ['cdn.jsdelivr.net'];

/* AUTORISES — donnees publiques, sans compte et sans secret : la meteo.
   Reseau d'abord, reserve en repli. */
var HOTES_DONNEES = ['api.open-meteo.com'];


/* ===========================================================================
   PARTIE 4 — LES PETITES FONCTIONS DE DECISION
   =========================================================================== */

function hoteDansListe(hote, liste) {
  for (var i = 0; i < liste.length; i++) {
    if (hote === liste[i] || hote.slice(-(liste[i].length + 1)) === '.' + liste[i]) { return true; }
  }
  return false;
}

/* EST-CE UNE ADRESSE DU SERVEUR SUPABASE ?
   Trois filets, du plus precis au plus general, parce qu'on ne peut pas se
   permettre d'en rater un seul. */
function estSupabase(url) {
  if (SUPABASE && url.origin === SUPABASE) { return true; }
  if (/\.supabase\.(co|in|net)$/.test(url.hostname)) { return true; }
  /* Un domaine personnalise pose devant Supabase garde ses chemins d'origine. */
  if (/^\/(rest|auth|functions|realtime|storage|graphql)\/v[0-9]+\//.test(url.pathname)) { return true; }
  return false;
}

/* LA QUESTION LA PLUS IMPORTANTE DU FICHIER :
   « ai-je le droit de me meler de cette demande ? »
   Quand la reponse est non, on ne fait RIEN : pas de reserve, mais pas non
   plus d'interception. La demande part au reseau comme si ce gardien
   n'existait pas. C'est plus sur que d'intercepter « juste pour regarder ». */
function interdit(url, req) {
  /* Une ecriture (POST, PATCH, DELETE...) ne se met jamais en reserve. */
  if (req.method !== 'GET') { return true; }

  /* Extensions de navigateur, adresses internes... */
  if (url.protocol !== 'http:' && url.protocol !== 'https:') { return true; }

  if (estSupabase(url)) { return true; }
  if (hoteDansListe(url.hostname, HOTES_INTERDITS)) { return true; }

  /* Un secret dans l'adresse. */
  for (var i = 0; i < PARAMS_SENSIBLES.length; i++) {
    if (url.searchParams.has(PARAMS_SENSIBLES[i])) { return true; }
  }

  try {
    /* Une demande qui porte une autorisation est, par definition, personnelle. */
    if (req.headers.get('authorization') || req.headers.get('apikey')) { return true; }
    /* Un morceau de fichier (video, gros telechargement) : la reserve ne sait
       pas recoller les morceaux, et le navigateur s'en sort mieux seul. */
    if (req.headers.get('range')) { return true; }
  } catch (e) { /* entetes illisibles : on continue */ }

  /* La page a explicitement demande « pas de reserve ». On obeit. */
  if (req.cache === 'no-store') { return true; }

  return false;
}

/* Une reponse a-t-elle le droit d'etre gardee ? */
function gardable(rep, autoriserOpaque) {
  if (!rep) { return false; }

  /* « opaque » = reponse d'un autre domaine qu'on n'a pas le droit de lire
     (c'est le cas des polices chargees par une balise <link>). On ne peut
     meme pas savoir si c'est un succes ou une erreur 404. On ne l'accepte
     donc QUE pour les polices, ou le risque se limite a un caractere mal
     dessine jusqu'a la prochaine visite. */
  if (rep.type === 'opaque') { return autoriserOpaque === true; }

  if (rep.status !== 200) { return false; }

  /* Une reponse obtenue apres une redirection rejouerait la redirection a
     chaque sortie de reserve ; pour une navigation, cela casse la page. On la
     laisse passer sans la garder. */
  if (rep.redirected) { return false; }

  var cc = '';
  try { cc = rep.headers.get('cache-control') || ''; } catch (e) { }
  if (cc.indexOf('no-store') !== -1) { return false; }

  return true;
}

/* Rangement tolerant : si le disque est plein, on vide les donnees (les moins
   precieuses) et on n'insiste pas. Une reserve pleine ne doit jamais faire
   echouer l'affichage d'une page. */
function ranger(cache, req, rep) {
  return cache.put(req, rep).catch(function (e) {
    if (e && e.name === 'QuotaExceededError') {
      return caches.delete(C_DONNEES).catch(function () { });
    }
  });
}


/* ===========================================================================
   PARTIE 5 — LE FILET DE SECURITE : « index.html a change »
   ---------------------------------------------------------------------------
   Si le developpeur publie un nouvel index.html mais oublie de changer VERSION
   ci-dessus, le navigateur ne voit aucun changement dans ce gardien et ne
   propose aucune mise a jour. Ici, quand on rafraichit la coquille en
   arriere-plan, on compare trois marqueurs de la reponse (etag, date de
   derniere modification, taille). S'ils different de ce qui etait en reserve,
   on previent la page, qui affiche le meme bandeau « mise a jour disponible ».
   Prudence volontaire : si AUCUN des trois marqueurs n'est disponible, on ne
   dit rien plutot que de crier au loup a chaque visite.
   =========================================================================== */

function marqueurs(rep) {
  try {
    var e = rep.headers.get('etag');
    var m = rep.headers.get('last-modified');
    var l = rep.headers.get('content-length');
    if (!e && !m && !l) { return null; }
    return (e || '') + '|' + (m || '') + '|' + (l || '');
  } catch (err) { return null; }
}

function previenirLesPages(message) {
  return self.clients.matchAll({ type: 'window', includeUncontrolled: true })
    .then(function (pages) {
      for (var i = 0; i < pages.length; i++) {
        try { pages[i].postMessage(message); } catch (e) { }
      }
    })
    .catch(function () { });
}

function comparer(ancienne, nouvelle, adresse) {
  var a = marqueurs(ancienne), b = marqueurs(nouvelle);
  if (!a || !b || a === b) { return Promise.resolve(); }
  return previenirLesPages({ type: 'AP_SHELL_UPDATED', url: adresse, version: VERSION });
}


/* ===========================================================================
   PARTIE 6 — LES DEUX STRATEGIES
   =========================================================================== */

/* STRATEGIE A — RESERVE D'ABORD, puis rafraichissement silencieux.
   Reponse instantanee, hors ligne comprise. Le reseau travaille apres coup
   pour que la PROCHAINE ouverture soit a jour. */
function reserveDAbord(event, nomCache, options) {
  var req = event.request;
  var opts = options || {};

  return caches.open(nomCache).then(function (cache) {
    return cache.match(req, { ignoreSearch: !!opts.ignorerRecherche }).then(function (enReserve) {

      var allerAuReseau = fetch(req).then(function (rep) {
        if (gardable(rep, opts.opaqueOk)) {
          var tache = ranger(cache, req, rep.clone());
          if (enReserve && opts.surveiller) {
            tache = tache.then(function () { return comparer(enReserve, rep, req.url); });
          }
          event.waitUntil(tache);
        }
        return rep;
      }).catch(function () { return null; });

      if (enReserve) {
        /* On ne fait pas attendre l'utilisateur : la reserve repond tout de
           suite, le reseau continue son travail en arriere-plan. */
        event.waitUntil(allerAuReseau);
        return enReserve;
      }
      return allerAuReseau.then(function (rep) {
        return rep || pageDeSecours(req);
      });
    });
  });
}

/* STRATEGIE B — RESEAU D'ABORD, avec une limite de patience et un repli.
   Pour les donnees qui vieillissent. La limite de temps est essentielle : sur
   un reseau de campagne qui ne repond pas mais ne coupe pas non plus, une
   demande peut rester en suspens une minute entiere. Au-dela du delai on sort
   la version d'hier ; si le reseau finit par repondre, on la remplace en
   silence pour la fois suivante. */
/* D'OU EST VENUE LA DERNIERE PAGE SERVIE ? Le code (.html, .js) qu'elle
   demande ensuite doit venir de la MEME source : tout neuf (reseau) ou tout
   ancien (reserve). Sinon une page neuve pouvait tourner avec un gsync.js
   ancien, pris dans la reserve apres 3,5 s de reseau lent — deux versions
   melangees, le pire des cas. */
var PAGE = { source: 'reseau', quand: 0 };

/* cache:'no-cache' = on revalide TOUJOURS aupres du serveur (If-None-Match :
   304 sans corps si rien n'a change) au lieu de prendre la copie « encore
   fraiche » de la reserve HTTP du navigateur — GitHub Pages la declare bonne
   dix minutes (max-age=600), soit dix minutes de vieille page apres chaque
   publication. Une navigation ne se reconstruit pas avec new Request : on
   repart de son adresse. */
function requeteFraiche(req) {
  if (req.mode === 'navigate') {
    return fetch(req.url, { cache: 'no-cache', credentials: 'same-origin', redirect: 'follow' });
  }
  try { return fetch(new Request(req, { cache: 'no-cache' })); } catch (e) { return fetch(req); }
}

function reseauDAbord(event, nomCache, msMax, options) {
  var req = event.request;
  var opts = options || {};
  /* La cle de reserve : sans la partie « ?… » quand on le demande. Le
     raccourci de l'ecran d'accueil ouvre « index.html?source=pwa » : garde
     sous cette adresse-la, la copie ne serait jamais retrouvee par un
     « index.html » nu — et l'inverse. Une seule copie, une seule cle. */
  var cle = opts.ignorerRecherche ? new Request(req.url.split('?')[0].split('#')[0]) : req;

  return caches.open(nomCache).then(function (cache) {
    var chercher = function () { return cache.match(cle, { ignoreSearch: !!opts.ignorerRecherche }); };
    return new Promise(function (resolve) {
      var repondu = false, minuteur = null;
      var repondre = function (rep, source) {
        if (repondu) { return; }
        repondu = true;
        if (opts.noterSource) { PAGE = { source: source, quand: Date.now() }; }
        resolve(rep);
      };

      /* Le travail reseau est declare au navigateur TOUT DE SUITE (waitUntil),
         avant qu'un minuteur ne puisse repondre : sinon la copie fraiche
         arrivee apres la reserve n'etait rangee que « par chance », l'evenement
         etant deja clos. */
      var travail = requeteFraiche(req).then(function (rep) {
        clearTimeout(minuteur);
        var rangee = gardable(rep) ? ranger(cache, cle, rep.clone()) : Promise.resolve();
        repondre(rep, 'reseau');
        return rangee;
      }).catch(function () {
        clearTimeout(minuteur);
        if (repondu) { return; }
        return chercher().then(function (vieille) { repondre(vieille || pageDeSecours(req), 'reserve'); });
      });
      try { event.waitUntil(travail); } catch (e) { }

      minuteur = setTimeout(function () {
        if (repondu) { return; }
        chercher().then(function (vieille) {
          if (vieille) { repondre(vieille, 'reserve'); }
          /* Pas de vieille copie : on continue d'attendre le reseau, c'est
             tout ce qui nous reste. */
        });
      }, msMax || 6000);
    });
  });
}


/* ===========================================================================
   PARTIE 7 — LA PAGE DE SECOURS
   ---------------------------------------------------------------------------
   Elle ne sert que dans un cas precis et rare : premiere visite, pas de
   reseau, rien en reserve. Elle est ecrite ici en dur, bilingue, sans aucun
   fichier exterieur — car par definition, aucun fichier exterieur n'est
   disponible a ce moment-la.
   =========================================================================== */

function pageDeSecours(req) {
  var accepte = '';
  try { accepte = req.headers.get('accept') || ''; } catch (e) { }
  var estPage = (req.mode === 'navigate') || accepte.indexOf('text/html') !== -1;

  if (!estPage) {
    return new Response('', { status: 504, statusText: 'hors ligne' });
  }

  var html =
    '<!DOCTYPE html><html lang="ar" dir="rtl"><head><meta charset="utf-8">' +
    '<meta name="viewport" content="width=device-width,initial-scale=1">' +
    '<title>أجندة برو — دون اتصال</title><style>' +
    'body{margin:0;min-height:100vh;display:grid;place-items:center;background:#f5f7fa;color:#101a2b;' +
    'font-family:"Segoe UI",Tahoma,sans-serif;padding:24px}' +
    '@media(prefers-color-scheme:dark){body{background:#0f1520;color:#eef3fa}' +
    '.c{background:#151d2b!important;border-color:#25303f!important}}' +
    '.c{max-width:420px;background:#fff;border:1px solid #e3e9f0;border-radius:18px;padding:30px 26px;text-align:center}' +
    'h1{font-size:19px;margin:0 0 10px}p{font-size:14px;line-height:1.75;color:#54637c;margin:0 0 6px}' +
    'b{display:block;margin-top:18px;font-size:13px;direction:ltr}' +
    'button{margin-top:22px;min-height:44px;padding:0 22px;border:0;border-radius:12px;background:#0284c7;' +
    'color:#fff;font-size:14px;font-weight:600;cursor:pointer}' +
    '</style></head><body><div class="c">' +
    '<div style="font-size:40px">📡</div>' +
    '<h1>لا يوجد اتصال، ولا نسخة محفوظة بعد</h1>' +
    '<p>افتح التطبيق مرّة واحدة وأنت متصل بالإنترنت، وبعدها سيشتغل دون اتصال.</p>' +
    '<b>Pas de reseau, et rien encore en reserve.</b>' +
    '<p style="font-size:13px">Ouvrez l\'application une premiere fois avec du reseau : ensuite, elle fonctionnera hors ligne.</p>' +
    '<button onclick="location.reload()">إعادة المحاولة · Reessayer</button>' +
    '</div></body></html>';

  return new Response(html, {
    status: 200,
    headers: { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' }
  });
}


/* ===========================================================================
   PARTIE 8 — INSTALLATION
   =========================================================================== */

self.addEventListener('install', function (event) {
  event.waitUntil(
    caches.open(C_COQUILLE).then(function (cache) {
      /* Un fichier apres l'autre, et chaque echec est avale.
         Pourquoi ne pas utiliser cache.addAll() ? Parce qu'il est « tout ou
         rien » : un seul fichier absent de la liste (une icone .png pas encore
         fabriquee, par exemple) ferait echouer TOUTE l'installation, et
         l'application n'aurait plus aucun mode hors ligne. Silencieusement. */
      return Promise.all(COQUILLE.map(function (chemin) {
        var adresse;
        try { adresse = new URL(chemin, BASE).href; } catch (e) { return null; }
        /* cache:'reload' = on ignore la reserve HTTP du navigateur, pour etre
           certain de garder la version qui vient d'etre publiee et non une
           copie perimee. */
        return cache.add(new Request(adresse, { cache: 'reload' })).catch(function () { });
      }));
    }).catch(function () { })
  );

  /* VOLONTAIREMENT PAS DE self.skipWaiting() ICI.
     Prendre la place de l'ancien gardien pendant que le client remplit un
     formulaire, c'est recharger la page sous ses doigts. On attend donc qu'il
     appuie sur « Recharger » dans le bandeau (voir PARTIE 10). */
});


/* ===========================================================================
   PARTIE 9 — ACTIVATION ET MENAGE
   =========================================================================== */

self.addEventListener('activate', function (event) {
  event.waitUntil(
    caches.keys().then(function (noms) {
      return Promise.all(noms.map(function (nom) {
        /* On n'efface QUE nos propres reserves, et seulement celles des
           versions precedentes. Une autre application publiee sur le meme
           domaine garde les siennes. */
        if (nom.indexOf(PREFIXE) === 0 && MES_CACHES.indexOf(nom) === -1) {
          return caches.delete(nom);
        }
        return null;
      }));
    }).then(function () {
      /* On prend la main sur les onglets deja ouverts, sans attendre qu'ils
         soient fermes. */
      return self.clients.claim();
    }).then(function () {
      return previenirLesPages({ type: 'AP_ACTIVATED', version: VERSION });
    }).catch(function () { })
  );
});


/* ===========================================================================
   PARTIE 10 — LES MESSAGES VENANT DE LA PAGE
   =========================================================================== */

function repondre(event, message) {
  try {
    if (event.ports && event.ports[0]) { event.ports[0].postMessage(message); return; }
  } catch (e) { }
  previenirLesPages(message);
}

self.addEventListener('message', function (event) {
  var d = (event && event.data) || {};

  /* « L'utilisateur a appuye sur Recharger » : le nouveau gardien prend la
     place de l'ancien. La page s'en apercoit (controllerchange) et se
     recharge elle-meme. */
  if (d.type === 'AP_SKIP_WAITING') {
    self.skipWaiting();
    return;
  }

  /* « Quelle version es-tu ? » — sert a l'ecran de reglages. */
  if (d.type === 'AP_VERSION') {
    repondre(event, { type: 'AP_VERSION', version: VERSION, caches: MES_CACHES });
    return;
  }

  /* « Vide tout » — le bouton de depannage. On ne touche QU'A nos reserves ;
     le localStorage (les donnees du client, la file d'attente de synchro)
     n'est pas de notre ressort et reste intact. */
  if (d.type === 'AP_CLEAR') {
    event.waitUntil(
      caches.keys().then(function (noms) {
        return Promise.all(noms.map(function (nom) {
          return nom.indexOf(PREFIXE) === 0 ? caches.delete(nom) : null;
        }));
      }).then(function () {
        repondre(event, { type: 'AP_CLEARED', version: VERSION });
      }).catch(function () { })
    );
    return;
  }
});


/* ===========================================================================
   PARTIE 11 — L'AIGUILLAGE : que fait-on de chaque demande ?
   =========================================================================== */

self.addEventListener('fetch', function (event) {
  var req = event.request;
  var url;
  try { url = new URL(req.url); } catch (e) { return; }

  /* REGLE NUMERO UN. On ne se mele pas. Pas d'interception du tout : la
     demande part au reseau exactement comme si ce fichier n'existait pas. */
  if (interdit(url, req)) { return; }

  var memeOrigine = (url.origin === ORIGINE);
  var dansLApplication = memeOrigine && (req.url.indexOf(BASE) === 0);

  /* 1. UNE NAVIGATION (on ouvre l'application, on rafraichit la page).
        Reserve d'abord : l'application s'ouvre instantanement, meme dans un
        ascenseur. « ignorerRecherche » est indispensable : l'adresse de
        depart du raccourci est « index.html?action=add », qui ne
        correspondrait a aucune entree de la reserve sans cette tolerance. */
  /* RESEAU D'ABORD, ET NON PLUS RESERVE D'ABORD.
     Avec la reserve d'abord, une page publiee le matin n'arrivait sur le
     telephone qu'apres un rechargement… qui resservait la reserve : le
     bandeau « nouvelle version » revenait a chaque ouverture sans jamais
     rien changer. Desormais, en ligne, la page est TOUJOURS celle du
     serveur (3,5 s au plus, sinon la reserve) ; hors ligne, la reserve. */
  if (req.mode === 'navigate') {
    event.respondWith(
      reseauDAbord(event, C_COQUILLE, 3500, { ignorerRecherche: true, noterSource: true })
        .catch(function () { return pageDeSecours(req); })
    );
    return;
  }

  /* 2. LES POLICES DE CARACTERES (autre domaine, explicitement autorise). */
  if (hoteDansListe(url.hostname, HOTES_POLICES)) {
    event.respondWith(
      reserveDAbord(event, C_POLICES, { opaqueOk: true }).catch(function () { return fetch(req); })
    );
    return;
  }

  /* 3. LA LIBRAIRIE SUPABASE, a version figee. Le programme, pas les donnees. */
  if (hoteDansListe(url.hostname, HOTES_CDN)) {
    event.respondWith(
      reserveDAbord(event, C_COQUILLE, {}).catch(function () { return fetch(req); })
    );
    return;
  }

  /* 4. LES DONNEES PUBLIQUES (meteo) : reseau d'abord, repli sur la reserve. */
  if (hoteDansListe(url.hostname, HOTES_DONNEES)) {
    event.respondWith(reseauDAbord(event, C_DONNEES, 6000));
    return;
  }

  /* 5. UN AUTRE DOMAINE, NON AUTORISE : on ne s'en mele pas. Liste blanche et
        non liste noire — on ne met en reserve que ce qu'on a decide, jamais
        ce qu'on a simplement oublie d'interdire. */
  if (!memeOrigine) { return; }

  /* 6. UN FICHIER DE DONNEES DE L'APPLICATION (.json) : reseau d'abord. */
  if (/\.json($|\?)/.test(url.pathname + url.search)) {
    event.respondWith(reseauDAbord(event, C_DONNEES, 6000));
    return;
  }

  /* 7. UN MORCEAU DE LA COQUILLE : reserve d'abord.
        « surveiller » n'est actif que pour le code (.html et .js) : ce sont
        les seuls fichiers dont un changement justifie de proposer un
        rechargement au client. */
  /* Le CODE (.html, .js) suit la meme regle que la page : reseau d'abord.
     Sinon une page neuve tournerait avec de vieux fichiers .js pris dans la
     reserve — deux versions melangees, le pire des cas. Les images, polices
     et styles, eux, restent reserve d'abord : ils changent rarement et
     pesent lourd. */
  if (dansLApplication && /\.(html|js|mjs)$/i.test(url.pathname)) {
    /* La page en cours vient-elle de la reserve (hors ligne) ? Alors son code
       aussi, sans attendre le reseau. Vient-elle du reseau ? Alors son code
       doit venir du reseau, quitte a l'attendre (20 s) : jamais une page neuve
       avec un fichier ancien. */
    var horsLigne = (PAGE.source === 'reserve') && (Date.now() - PAGE.quand < 60000);
    event.respondWith(
      (horsLigne ? reserveDAbord(event, C_COQUILLE, {}) : reseauDAbord(event, C_COQUILLE, 20000))
        .catch(function () { return fetch(req); })
    );
    return;
  }
  if (dansLApplication &&
      /\.(css|svg|png|jpe?g|webp|gif|ico|woff2?|ttf|webmanifest|txt)$/i.test(url.pathname)) {
    event.respondWith(
      reserveDAbord(event, C_COQUILLE, {}).catch(function () { return fetch(req); })
    );
    return;
  }

  /* 8. TOUT LE RESTE DU MEME DOMAINE : reseau, et repli sur la reserve si on
        l'a deja vu passer. On ne met rien de nouveau en reserve : dans le
        doute, on ne garde pas. */
  event.respondWith(
    fetch(req).catch(function () {
      return caches.match(req).then(function (v) { return v || pageDeSecours(req); });
    })
  );
});
