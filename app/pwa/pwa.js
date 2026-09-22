/* ============================================================================
   AGENDA PRO — app/pwa/pwa.js
   LA BRIQUE « TELEPHONE » : installation, mise a jour, tactile.
   ----------------------------------------------------------------------------
   CE QU'ELLE FAIT, EN SIX POINTS :
     1. declare le manifeste et suit la couleur du theme clair/sombre ;
     2. enregistre le gardien hors ligne (app/pwa/sw.js) ;
     3. surveille les nouvelles versions et propose « une mise a jour est
        disponible » avec un bouton qui recharge proprement ;
     4. propose d'ajouter l'application a l'ecran d'accueil — et explique la
        manoeuvre a la main sur iPhone, ou Safari refuse de la proposer ;
     5. agrandit les zones de tap a 44 px et ajoute un retour vibrant ;
     6. ouvre directement le bon ecran quand on arrive par un raccourci.

   LA REGLE QUI PASSE AVANT TOUTES LES AUTRES
   ------------------------------------------
   Ce fichier ne doit JAMAIS empecher l'application de s'ouvrir. Pas de
   service worker (vieux navigateur, page ouverte depuis un fichier local,
   site en http) : on ne dit rien, on ne casse rien, l'application reste le
   tableau de bord local qu'elle est aujourd'hui. Chaque appel un peu
   aventureux de ce fichier est donc entoure d'un try/catch, et aucun message
   rouge ne part dans la console d'un client.

   CE QU'IL PUBLIE : window.AP.pwa, et rien d'autre dans le global.

   EN QUOI CETTE BRIQUE TOUCHE-T-ELLE A LA SECURITE ?
   -------------------------------------------------
   Par ce qu'elle NE fait pas. Le gardien hors ligne pourrait, techniquement,
   garder une copie de tout ce qui passe — y compris les reponses du serveur
   Supabase et les jetons de connexion. Ce serait une faute grave : un jeton
   recopie sur le disque survit a la deconnexion, alors que session_is_live()
   (dans saas/003_durcissement.sql) a justement ete ecrit pour tuer les jetons
   emis avant une deconnexion globale. La liste des interdictions est dans
   app/pwa/sw.js, PARTIE 3. Ce fichier-ci se contente de lui transmettre
   l'adresse exacte du serveur Supabase pour qu'il puisse la reconnaitre.
   ============================================================================ */

(function () {
  'use strict';

  var W = window;
  W.AP = W.AP || {};
  var AP = W.AP;

  /* Double inclusion de la balise <script> : on ne refait rien. */
  if (AP.pwa) { return; }

  var CFG = W.AP_CONFIG || {};

  /* Ou se trouve ce fichier ? On s'en sert pour retrouver le manifeste et les
     icones, ou que vous ayez range le dossier « app ». */
  var MOI = (document.currentScript && document.currentScript.src) || '';
  var DOSSIER = MOI ? MOI.replace(/[^\/]*$/, '') : 'app/pwa/';
  /* La racine de l'application = le dossier au-dessus de app/pwa/. */
  var RACINE = DOSSIER.replace(/app\/pwa\/?$/, '');


  /* =========================================================================
     PARTIE 1 — LE DICTIONNAIRE
     Chaque texte visible existe en arabe et en francais. Aucune phrase n'est
     ecrite en dur ailleurs dans le fichier : pour corriger une formulation,
     c'est ici, et ici seulement.
     ========================================================================= */

  var D = {
    /* --- mise a jour --- */
    majTitre:  { ar: 'تحديث جديد متوفّر',
                 fr: 'Une mise a jour est disponible' },
    majTexte:  { ar: 'نسخة أحدث من أجندة برو جاهزة. أعِد التحميل لاستعمالها — كل ما هو محفوظ يبقى في مكانه.',
                 fr: 'Une version plus recente d’Agenda Pro est prete. Rechargez pour l’utiliser : tout ce qui est enregistre reste en place.' },
    majBouton: { ar: 'إعادة التحميل',  fr: 'Recharger' },
    majPlusTard: { ar: 'لاحقاً',       fr: 'Plus tard' },
    majFaite:  { ar: 'تم التحديث',     fr: 'Mise a jour effectuee' },

    /* --- installation --- */
    insTitre:  { ar: 'ثبّت أجندة برو على هاتفك',
                 fr: 'Installez Agenda Pro sur votre telephone' },
    insTexte:  { ar: 'يفتح بضغطة واحدة من الشاشة الرئيسية، بدون شريط عنوان، ويشتغل حتى بدون إنترنت.',
                 fr: 'Il s’ouvre d’une pression depuis l’ecran d’accueil, sans barre d’adresse, et fonctionne meme sans internet.' },
    insBouton: { ar: 'تثبيت',          fr: 'Installer' },
    insJamais: { ar: 'لا تقترح مجدداً', fr: 'Ne plus proposer' },
    insMerci:  { ar: 'تم التثبيت. شكراً!', fr: 'Installe. Merci !' },
    insImpossible: { ar: 'المتصفّح لا يسمح بالتثبيت من هنا.',
                     fr: 'Ce navigateur ne permet pas l’installation depuis ici.' },

    /* --- instructions iPhone / iPad --- */
    iosTitre: { ar: 'الإضافة إلى الشاشة الرئيسية',
                fr: 'Ajouter a l’ecran d’accueil' },
    iosIntro: { ar: 'متصفّح آبل لا يعرض زرّ التثبيت. العملية يدوية، وتستغرق خمس ثوانٍ، وتُنجَز مرّة واحدة:',
                fr: 'Le navigateur d’Apple n’affiche pas de bouton d’installation. La manoeuvre est manuelle, prend cinq secondes, et ne se fait qu’une fois :' },
    iosPas1:  { ar: 'اضغط زرّ المشاركة (مربّع فيه سهم للأعلى) في أسفل الشاشة.',
                fr: 'Appuyez sur le bouton Partager (un carre avec une fleche vers le haut), en bas de l’ecran.' },
    iosPas2:  { ar: 'انزل في القائمة واختر « إضافة إلى الشاشة الرئيسية ».',
                fr: 'Descendez dans la liste et choisissez « Sur l’ecran d’accueil ».' },
    iosPas3:  { ar: 'اضغط « إضافة » في الأعلى على اليمين. تظهر الأيقونة مع باقي التطبيقات.',
                fr: 'Appuyez sur « Ajouter », en haut a droite. L’icone se range avec vos autres applications.' },
    iosNote:  { ar: 'ملاحظة: يجب أن تكون في متصفّح Safari. إذا فتحت الرابط من داخل فيسبوك أو واتساب، اضغط أولاً « فتح في Safari ».',
                fr: 'Attention : il faut etre dans Safari. Si vous avez ouvert le lien depuis Facebook ou WhatsApp, faites d’abord « Ouvrir dans Safari ».' },
    fermer:   { ar: 'إغلاق',  fr: 'Fermer' },

    /* --- depannage (appele depuis les reglages) --- */
    videFait: { ar: 'تم مسح الذاكرة المؤقّتة. بياناتك لم تُمَس.',
                fr: 'Reserve hors ligne videe. Vos donnees n’ont pas ete touchees.' }
  };

  /* La langue en cours, lue sur la balise <html> : on suit donc
     automatiquement le bouton « عربي / FR » de l'application, sans avoir a
     modifier une seule ligne de index.html. */
  function langue() {
    if (AP.ui && typeof AP.ui.lang === 'function') {
      try { return AP.ui.lang(); } catch (e) { }
    }
    var l = (document.documentElement.lang || '').toLowerCase();
    if (l.indexOf('ar') === 0) { return 'ar'; }
    if (l) { return 'fr'; }
    return 'ar';   /* l'arabe est la langue par defaut du produit */
  }
  function T(cle) {
    var e = D[cle];
    return e ? (e[langue()] || e.ar) : cle;
  }

  /* Le petit message en bas. On reutilise celui de l'application quand il
     existe, pour ne pas avoir deux styles de message a l'ecran. */
  function dire(msg) {
    if (AP.ui && typeof AP.ui.toast === 'function') { try { AP.ui.toast(msg); return; } catch (e) { } }
    if (typeof W.toast === 'function') { try { W.toast(msg); return; } catch (e) { } }
  }

  /* On attend que le corps de la page existe avant d'y poser quoi que ce
     soit : ce fichier peut etre charge dans le <head>. */
  function quandPret(fn) {
    if (document.body) { try { fn(); } catch (e) { } return; }
    document.addEventListener('DOMContentLoaded', function () { try { fn(); } catch (e) { } });
  }

  /* Attendre qu'une fonction de index.html existe (elles sont definies plus
     bas dans la page que nos balises <script>). On essaie pendant huit
     secondes, puis on abandonne en silence. */
  function attendre(condition, alors, msMax) {
    var fin = Date.now() + (msMax || 8000);
    (function essai() {
      var ok = false;
      try { ok = !!condition(); } catch (e) { }
      if (ok) { try { alors(); } catch (e) { } return; }
      if (Date.now() < fin) { setTimeout(essai, 120); }
    })();
  }


  /* =========================================================================
     PARTIE 2 — CE QUE L'ON RETIENT D'UNE VISITE A L'AUTRE
     Une seule cle de localStorage, prefixee comme l'existant pour qu'une
     sauvegarde manuelle du navigateur emporte tout d'un bloc.
     ========================================================================= */

  var CLE = 'agendapro_v1_pwa';

  function reglages() {
    try {
      var r = JSON.parse(localStorage.getItem(CLE) || '{}');
      return (r && typeof r === 'object') ? r : {};
    } catch (e) { return {}; }
  }
  function ecrireReglages(o) {
    try { localStorage.setItem(CLE, JSON.stringify(o)); } catch (e) { /* mode prive : tant pis */ }
  }
  function regler(champ, valeur) {
    var r = reglages(); r[champ] = valeur; ecrireReglages(r);
  }


  /* =========================================================================
     PARTIE 3 — LE BULLETIN DE SANTE PUBLIC
     Lisible a tout moment dans la console : AP.pwa.status
     ========================================================================= */

  var S = {
    supporte: false,      /* le navigateur connait-il les service workers ? */
    securise: false,      /* https ou localhost ? (obligatoire) */
    enregistre: false,    /* le gardien est-il en place ? */
    controle: false,      /* est-ce lui qui sert la page en ce moment ? */
    versionSw: null,      /* le numero declare par app/pwa/sw.js */
    majEnAttente: false,  /* une nouvelle version attend le feu vert */
    installable: false,   /* le navigateur nous a propose d'installer */
    installee: false,     /* on tourne depuis l'ecran d'accueil */
    ios: false,           /* iPhone / iPad : installation manuelle */
    tactile: false,       /* ecran tactile : adaptations appliquees */
    haptique: false,      /* le telephone sait vibrer */
    anneau: null,         /* rapport de la verification au pouce */
    raison: 'demarrage'   /* en clair, pourquoi on en est la */
  };


  /* =========================================================================
     PARTIE 4 — LE MANIFESTE, LES COULEURS ET LES BALISES D'APPLE
     ---------------------------------------------------------------------------
     Tout est pose par du code, et uniquement si ce n'est pas deja dans
     index.html. Ainsi la brique fonctionne meme si l'on a oublie d'ajouter
     une balise a la main, et elle n'en pose jamais deux.
     ========================================================================= */

  function baliseLien(rel, href, attrs) {
    var existe = document.querySelector('link[rel="' + rel + '"]');
    if (existe) { return existe; }
    var l = document.createElement('link');
    l.rel = rel; l.href = href;
    if (attrs) { for (var k in attrs) { if (attrs.hasOwnProperty(k)) { l.setAttribute(k, attrs[k]); } } }
    (document.head || document.documentElement).appendChild(l);
    return l;
  }
  function baliseMeta(nom, contenu) {
    var m = document.querySelector('meta[name="' + nom + '"]');
    if (!m) {
      m = document.createElement('meta');
      m.setAttribute('name', nom);
      (document.head || document.documentElement).appendChild(m);
    }
    m.setAttribute('content', contenu);
    return m;
  }

  /* LA COULEUR DE LA BARRE D'ETAT DU TELEPHONE.
     Le manifeste ne connait qu'UNE couleur, figee une fois pour toutes. Or
     l'application bascule clair/sombre a la demande. La seule facon de suivre
     ce basculement est de mettre a jour la balise <meta name="theme-color">
     en direct — c'est ce que fait cette fonction, et c'est un guetteur pose
     sur l'attribut data-theme de <html> qui la declenche.
     On lit la vraie variable --bg de l'application plutot que de recopier un
     code couleur : le jour ou la charte change, cette ligne suit toute seule. */
  function majCouleurTheme() {
    var couleur = '';
    try {
      couleur = getComputedStyle(document.documentElement).getPropertyValue('--bg').trim();
    } catch (e) { }
    if (!couleur) {
      var sombre = document.documentElement.getAttribute('data-theme') === 'dark';
      couleur = sombre ? '#0f1520' : '#f5f7fa';
    }
    baliseMeta('theme-color', couleur);
  }

  function poserLesBalises() {
    /* Le manifeste : la carte d'identite de l'application pour le telephone. */
    baliseLien('manifest', DOSSIER + 'manifest.webmanifest');

    /* L'icone de l'ecran d'accueil sur iPhone. iOS ignore le SVG : sans ce
       fichier .png, il met une vignette de la page a la place de l'icone.
       Voir app/pwa/icons/README.md pour le fabriquer. */
    baliseLien('apple-touch-icon', DOSSIER + 'icons/apple-touch-icon.png');

    /* Ouverture en plein ecran depuis l'ecran d'accueil. */
    baliseMeta('mobile-web-app-capable', 'yes');
    baliseMeta('apple-mobile-web-app-capable', 'yes');
    /* « default » et non « black-translucent » : ce dernier fait passer la
       page SOUS l'horloge et la batterie, ce qui mange la barre du haut de
       l'application. */
    baliseMeta('apple-mobile-web-app-status-bar-style', 'default');
    baliseMeta('apple-mobile-web-app-title', 'أجندة برو');

    majCouleurTheme();

    /* Le guetteur : des que l'application bascule clair/sombre, la barre
       d'etat du telephone suit. Aucune modification de toggleTheme() dans
       index.html n'est necessaire. */
    try {
      new MutationObserver(majCouleurTheme).observe(document.documentElement, {
        attributes: true, attributeFilter: ['data-theme']
      });
    } catch (e) { /* tres vieux navigateur : la couleur restera celle du depart */ }
  }


  /* =========================================================================
     PARTIE 5 — LE STYLE
     Deux blocs : nos bandeaux, et les adaptations tactiles. On reutilise les
     variables et les classes de l'application (--surface, --line, .mb, .modal)
     pour ne pas inventer une seconde charte graphique.
     ========================================================================= */

  var CSS = [
    /* ---------- le bandeau (mise a jour / installation) ---------- */
    '#apPwaBar{position:fixed;z-index:190;display:none;align-items:center;gap:12px;',
    '  inset-block-end:calc(16px + env(safe-area-inset-bottom,0px));',
    '  inset-inline:16px;margin-inline:auto;max-width:560px;',
    '  padding:13px 15px;border-radius:16px;background:var(--surface,#fff);color:var(--txt,#101a2b);',
    '  border:1px solid var(--line,#e3e9f0);box-shadow:var(--shadow,0 12px 30px -18px rgba(0,0,0,.4));',
    '  animation:apPwaMonte .3s ease}',
    '#apPwaBar.on{display:flex}',
    '#apPwaBar .apb-ic{font-size:22px;flex:0 0 auto;line-height:1}',
    '#apPwaBar .apb-txt{flex:1;min-width:0}',
    '#apPwaBar .apb-t{display:block;font-size:13.5px;font-weight:700;margin-bottom:2px}',
    '#apPwaBar .apb-d{display:block;font-size:11.8px;line-height:1.55;color:var(--txt2,#54637c)}',
    '#apPwaBar .apb-btns{display:flex;gap:8px;flex:0 0 auto}',
    '#apPwaBar .mb{min-height:44px;display:inline-flex;align-items:center;justify-content:center;white-space:nowrap}',
    '@keyframes apPwaMonte{from{opacity:0;transform:translateY(18px)}}',
    '@media(prefers-reduced-motion:reduce){#apPwaBar{animation:none}}',
    /* Sur un telephone etroit, les boutons passent sous le texte : un bouton
       de 44 px ecrase sinon le message qui explique a quoi il sert. */
    '@media(max-width:560px){',
    '  #apPwaBar{flex-wrap:wrap}',
    '  #apPwaBar .apb-btns{width:100%}',
    '  #apPwaBar .apb-btns .mb{flex:1}',
    '}',
    '@media print{#apPwaBar,#apPwaIos{display:none!important}}',

    /* ---------- la fenetre d'explication iPhone ---------- */
    '#apPwaIos .apios-l{margin:0;padding:0;list-style:none;display:flex;flex-direction:column;gap:12px}',
    '#apPwaIos .apios-l li{display:flex;gap:11px;align-items:flex-start;font-size:13px;line-height:1.65}',
    '#apPwaIos .apios-n{flex:0 0 auto;width:26px;height:26px;border-radius:50%;display:grid;place-items:center;',
    '  background:var(--brandSoft,#e6f5fe);color:var(--brand2,#0284c7);font-size:12px;font-weight:700}',

    /* ---------- ADAPTATIONS TACTILES ----------
       « pointer: coarse » veut dire : le doigt, pas la souris. Rien de ce qui
       suit ne s'applique donc sur un ordinateur — le rendu que vous
       connaissez ne bouge pas d'un pixel.
       Pourquoi 44 px ? C'est la taille retenue par Apple et Google apres
       mesure de la pulpe d'un doigt adulte. En dessous, on vise a cote, et
       sur un chantier, avec des mains sales et des gants, c'est pire.

       REGLE DE BON VOISINAGE : ici on AGRANDIT, mais on ne DECLARE JAMAIS de
       `display` sur une classe qui appartient a l'application ou a une autre
       brique. Un `display` explicite, meme sans !important, l'emporte sur le
       `display:none` que le navigateur applique a l'attribut `hidden` (celui-ci
       vient de la feuille par defaut, la plus faible de toutes). Les briques
       COMPTES et VENTE masquent des `.mb` et des `.chip` avec `hidden` : leur
       poser un `display:inline-flex` d'ici ferait reapparaitre sur telephone —
       et sur telephone SEULEMENT — des boutons reserves au proprietaire, et
       decalerait les elements de l'anneau, que le developpeur ne verrait
       jamais sur son ordinateur.
       Le `min-height` seul suffit : <button> centre nativement son contenu
       verticalement et horizontalement, et `.lchip`/`.seclab` declarent deja
       `display:inline-flex` dans index.html. Le seul cas qui reclame vraiment
       un `display`, c'est `<a class="act link">`, un element inline sur lequel
       `min-height` n'a aucun effet : il est traite a part, et protege par
       `:not([hidden])`. */
    '@media(pointer:coarse){',
    '  .tbtn,.datepill{min-height:44px;height:44px}',
    '  .langsw{height:50px}',                        /* 44 de bouton + 2x3 de marge interne */
    '  .mb,.btn-add,.sec-btn{min-height:44px}',
    '  .chip,.gs,.act,.lchip,.seclab{min-height:40px}',
    '  a.act:not([hidden]){display:inline-flex;align-items:center;justify-content:center}',
    '  .day{min-height:54px}',
    '  .mini,.addsub input,.addsub button,.notes{min-height:42px}',
    '  .fld input,.fld select{min-height:46px}',
    '  .search input{min-height:44px}',
    /*   LE DETAIL QUI CHANGE TOUT SUR IPHONE : en dessous de 16 px, Safari
         zoome automatiquement sur le champ des qu'on le touche, et la page
         reste zoomee ensuite. L'utilisateur croit que l'application a
         deraille. Seize pixels dans les champs, et le probleme disparait. */
    '  .fld input,.fld select,.fld textarea,.search input,.notes,.mini,.addsub input,.gemin{font-size:16px}',
    /*   Supprime le delai de 300 ms que les navigateurs gardaient pour voir
         si l'on allait faire un double-tap. L'interface parait deux fois plus
         vive sans qu'une seule ligne de logique ne change. */
    '  button,a,.orb,.pan-orb,.board-orb,.day,.card,.chip,.act,.ring-node{touch-action:manipulation}',
    /*   Les bulles de l'anneau ne descendent jamais sous 44 px, quelle que
         soit la largeur de l'ecran. */
    '  .wrap.ring .orb,.wrap.ring .pan-orb,.wrap.ring .board-orb{min-width:44px;min-height:44px}',
    /*   Une fenetre modale au doigt : les boutons du bas prennent toute la
         largeur, dans l ordre inverse pour que l action principale tombe
         sous le pouce. */
    '  .modal-f{gap:10px}',
    '}',
    '@media(pointer:coarse) and (max-width:560px){',
    '  .modal-f{flex-direction:column-reverse}',
    '  .modal-f .mb{width:100%}',
    '  .modal-in{max-height:92vh}',
    '}'
  ].join('\n');

  function poserLeStyle() {
    if (document.getElementById('apPwaStyle')) { return; }
    var s = document.createElement('style');
    s.id = 'apPwaStyle';
    s.textContent = CSS;
    (document.head || document.documentElement).appendChild(s);
  }


  /* =========================================================================
     PARTIE 6 — LE BANDEAU, UN SEUL POUR DEUX USAGES
     ========================================================================= */

  var bar = null, barMode = null;

  function construireBandeau() {
    if (bar) { return bar; }
    bar = document.createElement('div');
    bar.id = 'apPwaBar';
    bar.setAttribute('role', 'status');
    bar.setAttribute('aria-live', 'polite');
    bar.innerHTML =
      '<span class="apb-ic" id="apPwaIc">🔄</span>' +
      '<span class="apb-txt"><b class="apb-t" id="apPwaT"></b><span class="apb-d" id="apPwaD"></span></span>' +
      '<span class="apb-btns">' +
      '  <button type="button" class="mb" id="apPwaNon"></button>' +
      '  <button type="button" class="mb pri" id="apPwaOui"></button>' +
      '</span>';
    document.body.appendChild(bar);
    return bar;
  }

  function montrerBandeau(mode) {
    quandPret(function () {
      construireBandeau();
      barMode = mode;
      var ic = document.getElementById('apPwaIc');
      var t = document.getElementById('apPwaT');
      var d = document.getElementById('apPwaD');
      var oui = document.getElementById('apPwaOui');
      var non = document.getElementById('apPwaNon');

      if (mode === 'maj') {
        ic.textContent = '🔄';
        t.textContent = T('majTitre');
        d.textContent = T('majTexte');
        oui.textContent = T('majBouton');
        non.textContent = T('majPlusTard');
        oui.onclick = function () { AP.pwa.applyUpdate(); };
        non.onclick = function () { cacherBandeau(); };
      } else {
        ic.textContent = '📲';
        t.textContent = T('insTitre');
        d.textContent = T('insTexte');
        oui.textContent = T('insBouton');
        non.textContent = T('insJamais');
        oui.onclick = function () { AP.pwa.install(); };
        non.onclick = function () { regler('choix', 'jamais'); cacherBandeau(); };
      }
      bar.classList.add('on');
    });
  }

  function cacherBandeau() {
    if (bar) { bar.classList.remove('on'); }
    barMode = null;
  }

  /* Si la langue change pendant que le bandeau est affiche, on le retraduit. */
  try {
    new MutationObserver(function () {
      if (barMode) { montrerBandeau(barMode); }
    }).observe(document.documentElement, { attributes: true, attributeFilter: ['lang', 'dir'] });
  } catch (e) { }


  /* =========================================================================
     PARTIE 7 — LE GARDIEN HORS LIGNE (service worker)
     ========================================================================= */

  var reg = null;               /* l'enregistrement, quand il existe */
  var onADemandeLaMaj = false;  /* l'utilisateur a-t-il appuye sur « Recharger » ? */
  var rechargeLancee = false;   /* pour ne jamais recharger deux fois */
  var dernierControle = 0;

  /* L'adresse du serveur Supabase, transmise au gardien pour qu'il sache
     reconnaitre — et donc refuser de garder — tout ce qui en vient. */
  function parametreSupabase() {
    try {
      if (!CFG.supabaseUrl) { return ''; }
      return '?sb=' + encodeURIComponent(new URL(CFG.supabaseUrl).origin);
    } catch (e) { return ''; }
  }

  function enregistrer() {
    if (!('serviceWorker' in navigator)) { S.raison = 'navigateur-trop-ancien'; return; }
    S.supporte = true;

    /* Un service worker exige une connexion sure. Ouvert depuis un fichier
       (file://) ou depuis un site en http, il est simplement interdit : ce
       n'est pas une panne, c'est une regle du web. */
    if (!W.isSecureContext) {
      S.raison = (location.protocol === 'file:') ? 'fichier-local' : 'connexion-non-securisee';
      return;
    }
    S.securise = true;

    var q = parametreSupabase();

    /* Deux tentatives, dans cet ordre.
       1. LA BONNE : le fichier de trois lignes copie a la racine (voir
          app/pwa/sw-racine.js). Un gardien ne surveille que son propre
          dossier : depuis la racine, il couvre toute l'application.
       2. LE REPLI : le vrai fichier, avec une portee elargie a la racine.
          Cela ne marche que si le serveur envoie l'entete
          « Service-Worker-Allowed: / ». Beaucoup d'hebergements ne le font
          pas — d'ou la premiere methode, qui ne depend de personne. */
    navigator.serviceWorker.register(RACINE + 'sw.js' + q, { scope: RACINE })
      .then(pretAvecLeGardien)
      .catch(function () {
        return navigator.serviceWorker.register(DOSSIER + 'sw.js' + q, { scope: RACINE })
          .then(pretAvecLeGardien);
      })
      .catch(function () {
        /* Ni l'un ni l'autre. On ne dit RIEN a l'utilisateur : l'application
           fonctionne, elle perd seulement le hors-ligne. La raison est
           lisible dans la console par celui qui la cherche. */
        S.raison = 'sw-non-enregistre : copier app/pwa/sw-racine.js a la racine sous le nom sw.js';
      });

    /* Quand le nouveau gardien prend la place de l'ancien. */
    navigator.serviceWorker.addEventListener('controllerchange', function () {
      S.controle = true;
      if (onADemandeLaMaj) {
        if (rechargeLancee) { return; }
        rechargeLancee = true;
        try { location.reload(); } catch (e) { }
        return;
      }
      /* Le changement vient d'un AUTRE onglet : cette page-ci tourne encore
         avec l'ancien code. On ne la recharge pas sous les doigts de
         l'utilisateur — on lui propose. */
      if (!barMode) { S.majEnAttente = true; montrerBandeau('maj'); }
    });

    /* Les messages venant du gardien. */
    navigator.serviceWorker.addEventListener('message', function (ev) {
      var d = (ev && ev.data) || {};
      if (d.type === 'AP_SHELL_UPDATED') {
        /* Le filet de securite : index.html a change sur le serveur alors que
           le numero de version du gardien, lui, n'a pas bouge. La reserve
           vient d'etre rafraichie ; un simple rechargement suffit. */
        S.majEnAttente = true;
        if (!barMode) { montrerBandeau('maj'); }
      }
      if (d.type === 'AP_VERSION') { S.versionSw = d.version; }
    });
  }

  function pretAvecLeGardien(r) {
    if (!r) { return; }
    reg = r;
    S.enregistre = true;
    S.raison = 'pret';
    S.controle = !!navigator.serviceWorker.controller;

    /* Une version est deja la, en salle d'attente (l'utilisateur a ferme la
       page la derniere fois sans recharger). */
    if (r.waiting && navigator.serviceWorker.controller) {
      S.majEnAttente = true;
      montrerBandeau('maj');
    }

    /* Une version arrive pendant que la page est ouverte. */
    r.addEventListener('updatefound', function () {
      var nouveau = r.installing;
      if (!nouveau) { return; }
      nouveau.addEventListener('statechange', function () {
        /* « installed » + un gardien deja en place = c'est une MISE A JOUR.
           Sans ce second test, on afficherait le bandeau au tout premier
           chargement, alors qu'il n'y a rien a mettre a jour. */
        if (nouveau.state === 'installed' && navigator.serviceWorker.controller) {
          S.majEnAttente = true;
          montrerBandeau('maj');
        }
      });
    });

    /* On demande son numero de version, pour l'ecran de reglages. */
    demanderVersion();

    /* Quand chercher une mise a jour ? Le navigateur le fait de lui-meme a
       chaque navigation, mais une application installee reste ouverte des
       jours entiers sans jamais naviguer. On complete donc :
         - au retour sur l'application (elle etait en arriere-plan) ;
         - au retour du reseau ;
         - et toutes les demi-heures.
       Le tout limite a une verification par quart d'heure : inutile de
       reveiller le reseau d'un forfait compte a la minute. */
    document.addEventListener('visibilitychange', function () {
      if (!document.hidden) { verifierMaj(); }
    });
    W.addEventListener('online', verifierMaj);
    setInterval(verifierMaj, 30 * 60 * 1000);
  }

  function verifierMaj(force) {
    if (!reg) { return Promise.resolve(false); }
    var n = Date.now();
    if (!force && (n - dernierControle) < 15 * 60 * 1000) { return Promise.resolve(false); }
    dernierControle = n;
    return reg.update().then(function () { return true; }).catch(function () { return false; });
  }

  function demanderVersion() {
    try {
      var actif = navigator.serviceWorker.controller || (reg && (reg.active || reg.waiting));
      if (!actif || typeof actif.postMessage !== 'function' ||
          typeof MessageChannel === 'undefined') { return Promise.resolve(null); }
      return new Promise(function (resolve) {
        var canal = new MessageChannel();
        var fini = false;
        canal.port1.onmessage = function (ev) {
          if (fini) { return; }
          fini = true;
          var d = (ev && ev.data) || {};
          S.versionSw = d.version || null;
          resolve(S.versionSw);
        };
        /* Ce try/catch n'est pas de la mefiance gratuite : cette promesse ne
           doit JAMAIS etre rejetee. Une promesse rejetee que personne
           n'attrape affiche une erreur rouge dans la console du client, pour
           un renseignement de confort dont l'application se passe tres bien. */
        try {
          actif.postMessage({ type: 'AP_VERSION' }, [canal.port2]);
        } catch (e) {
          fini = true; resolve(S.versionSw); return;
        }
        setTimeout(function () { if (!fini) { fini = true; resolve(S.versionSw); } }, 3000);
      });
    } catch (e) { return Promise.resolve(null); }
  }


  /* =========================================================================
     PARTIE 8 — L'INVITE D'INSTALLATION
     ---------------------------------------------------------------------------
     Regle de politesse, et regle commerciale : on ne demande pas a quelqu'un
     d'installer une application qu'il vient de decouvrir. On attend sa
     deuxieme visite et une vingtaine de secondes de travail. Un refus est
     respecte quatorze jours ; « ne plus proposer » l'est pour toujours.
     ========================================================================= */

  var invitation = null;    /* l'evenement mis de cote par le navigateur */
  var JOURS = 24 * 60 * 60 * 1000;

  function estInstallee() {
    try {
      if (W.navigator.standalone === true) { return true; }   /* iPhone */
      if (W.matchMedia) {
        if (W.matchMedia('(display-mode: standalone)').matches) { return true; }
        if (W.matchMedia('(display-mode: minimal-ui)').matches) { return true; }
        if (W.matchMedia('(display-mode: fullscreen)').matches) { return true; }
      }
    } catch (e) { }
    return false;
  }

  function estApple() {
    try {
      var ua = navigator.userAgent || '';
      if (/iPhone|iPad|iPod/.test(ua)) { return true; }
      /* iPad recent : il se fait passer pour un Mac. Le nombre de points de
         contact le trahit — un Mac n'a pas d'ecran tactile. */
      if (/Macintosh/.test(ua) && navigator.maxTouchPoints > 1) { return true; }
    } catch (e) { }
    return false;
  }

  function peutProposer() {
    if (estInstallee()) { return false; }
    var r = reglages();
    if (r.choix === 'jamais' || r.choix === 'fait') { return false; }
    if (r.refusLe && (Date.now() - r.refusLe) < 14 * JOURS) { return false; }
    if ((r.visites || 0) < 2) { return false; }   /* pas des la premiere visite */
    return true;
  }

  function compterLaVisite() {
    var r = reglages();
    r.visites = (r.visites || 0) + 1;
    ecrireReglages(r);
  }

  function ecouterInstallation() {
    /* ANDROID / CHROME / EDGE : le navigateur nous previent qu'il est pret a
       proposer l'installation. On l'empeche d'afficher SA banniere pour
       pouvoir afficher la notre, au bon moment et dans la bonne langue. */
    W.addEventListener('beforeinstallprompt', function (e) {
      try { e.preventDefault(); } catch (err) { }
      invitation = e;
      S.installable = true;
      if (peutProposer()) {
        setTimeout(function () {
          if (!barMode && peutProposer()) { montrerBandeau('install'); }
        }, 20000);
      }
    });

    W.addEventListener('appinstalled', function () {
      invitation = null;
      S.installee = true;
      regler('choix', 'fait');
      cacherBandeau();
      dire(T('insMerci'));
    });

    /* IPHONE / IPAD : Safari n'envoie jamais beforeinstallprompt. Sans ce
       cas particulier, l'artisan qui travaille sur iPhone n'apprendrait
       jamais que l'application peut s'installer. */
    if (estApple() && !estInstallee()) {
      S.ios = true;
      setTimeout(function () {
        if (!barMode && peutProposer()) { montrerBandeau('install'); }
      }, 20000);
    }
  }

  /* La fenetre d'explication iPhone, batie avec les classes de modale de
     l'application pour avoir exactement la meme allure que le reste. */
  function ouvrirModaleIos() {
    quandPret(function () {
      var m = document.getElementById('apPwaIos');
      if (!m) {
        m = document.createElement('div');
        m.id = 'apPwaIos';
        m.className = 'modal';
        m.innerHTML =
          '<div class="modal-in">' +
          '  <div class="modal-h"><h3 id="apiosT"></h3></div>' +
          '  <div class="modal-b">' +
          '    <div class="note-line" id="apiosI"></div>' +
          '    <ul class="apios-l">' +
          '      <li><span class="apios-n">1</span><span id="apiosP1"></span></li>' +
          '      <li><span class="apios-n">2</span><span id="apiosP2"></span></li>' +
          '      <li><span class="apios-n">3</span><span id="apiosP3"></span></li>' +
          '    </ul>' +
          '    <div class="note-line" id="apiosN"></div>' +
          '  </div>' +
          '  <div class="modal-f"><button type="button" class="mb pri" id="apiosX"></button></div>' +
          '</div>';
        document.body.appendChild(m);
        document.getElementById('apiosX').onclick = function () { m.classList.remove('show'); };
        /* Un clic sur le fond noir ferme aussi, comme les autres modales. */
        m.addEventListener('click', function (ev) {
          if (ev.target === m) { m.classList.remove('show'); }
        });
      }
      document.getElementById('apiosT').textContent = T('iosTitre');
      document.getElementById('apiosI').textContent = T('iosIntro');
      document.getElementById('apiosP1').textContent = T('iosPas1');
      document.getElementById('apiosP2').textContent = T('iosPas2');
      document.getElementById('apiosP3').textContent = T('iosPas3');
      document.getElementById('apiosN').textContent = T('iosNote');
      document.getElementById('apiosX').textContent = T('fermer');
      m.classList.add('show');
      cacherBandeau();
    });
  }


  /* =========================================================================
     PARTIE 9 — LE TACTILE : vibration et verification de l'anneau
     ========================================================================= */

  /* Les vibrations disponibles. Tres courtes : au-dela de trente millisecondes
     ce n'est plus une confirmation, c'est une alarme. */
  var VIBRATIONS = {
    leger: 10,
    ok: 16,
    attention: [18, 60, 18],
    erreur: [30, 55, 30]
  };

  function haptiqueActive() {
    var r = reglages();
    return r.haptique !== false;   /* active par defaut */
  }

  function vibrer(genre) {
    if (!S.haptique || !haptiqueActive()) { return false; }
    try { return navigator.vibrate(VIBRATIONS[genre] || VIBRATIONS.leger); }
    catch (e) { return false; }
  }

  /* Les elements qui meritent un retour au doigt : ceux qui CHANGENT quelque
     chose. On ne fait pas vibrer un simple lien, sinon le telephone bourdonne
     en permanence et l'utilisateur coupe la fonction. */
  var SEL_HAPTIQUE = '.orb,.pan-orb,.board-orb,.btn-add,.mb,.act,.chip,.gs,.tbtn,.sec-btn,.day,[data-haptique]';

  function brancherHaptique() {
    try { S.haptique = (typeof navigator.vibrate === 'function'); } catch (e) { S.haptique = false; }
    if (!S.haptique) { return; }
    /* Un seul ecouteur pour toute la page, pose en phase de capture et
       « passive » : il ne peut ni bloquer le defilement, ni ralentir un clic. */
    document.addEventListener('pointerdown', function (ev) {
      try {
        var cible = ev.target && ev.target.closest && ev.target.closest(SEL_HAPTIQUE);
        if (!cible) { return; }
        vibrer(cible.getAttribute('data-haptique') || 'leger');
      } catch (e) { }
    }, { passive: true, capture: true });
  }

  /* VERIFICATION DE L'ANNEAU DE BULLES AU POUCE.
     Ce n'est pas un reglage, c'est un CONTROLE : il mesure ce qui est
     reellement affiche et dit si l'anneau reste utilisable d'une main. On ne
     montre rien a l'utilisateur ; le rapport se lit dans la console avec
     AP.pwa.checkRing(), et il est range dans AP.pwa.status.anneau.
     Pourquoi automatiser ce controle ? Parce que l'anneau se calcule en
     pourcentage de la largeur (clamp(...vw...)) : un telephone plus etroit
     que prevu peut le retrecir sous le seuil des 44 px sans que personne ne
     s'en apercoive avant une reclamation. */
  function verifierAnneau() {
    var rapport = {
      quand: new Date().toISOString(),
      largeurEcran: W.innerWidth || 0,
      hauteurEcran: W.innerHeight || 0,
      bulles: 0,
      tropPetites: [],
      horsEcran: [],
      chevauchements: [],
      horsZonePouce: 0,
      verdict: ''
    };

    var noeuds;
    try {
      noeuds = document.querySelectorAll('.wrap.ring .orb, .wrap.ring .pan-orb, .wrap.ring .board-orb');
    } catch (e) { noeuds = []; }

    var mesures = [];
    for (var i = 0; i < noeuds.length; i++) {
      var r = noeuds[i].getBoundingClientRect();
      if (!r.width && !r.height) { continue; }   /* bulle repliee ou masquee */
      var nom = noeuds[i].id || noeuds[i].className || ('bulle ' + (i + 1));
      mesures.push({ nom: String(nom).slice(0, 40), r: r });
    }
    rapport.bulles = mesures.length;

    /* La zone confortable du pouce sur un telephone tenu d'une main : les
       deux tiers du bas de l'ecran. Au-dessus, il faut se contorsionner ou
       changer de main. */
    var seuilPouce = (rapport.hauteurEcran || 0) * 0.34;

    for (var j = 0; j < mesures.length; j++) {
      var m = mesures[j], b = m.r;
      var cote = Math.min(b.width, b.height);

      if (cote < 44) {
        rapport.tropPetites.push(m.nom + ' = ' + Math.round(cote) + 'px');
      }
      if (b.left < 0 || b.right > rapport.largeurEcran) {
        rapport.horsEcran.push(m.nom);
      }
      if (b.top + b.height / 2 < seuilPouce) {
        rapport.horsZonePouce++;
      }
      for (var k = j + 1; k < mesures.length; k++) {
        var c = mesures[k].r;
        var dx = (b.left + b.width / 2) - (c.left + c.width / 2);
        var dy = (b.top + b.height / 2) - (c.top + c.height / 2);
        var d = Math.sqrt(dx * dx + dy * dy);
        /* Deux bulles rondes se touchent quand la distance entre leurs
           centres passe sous la somme de leurs rayons. On laisse deux pixels
           de tolerance pour les arrondis d'affichage. */
        if (d < (b.width / 2 + c.width / 2 - 2)) {
          rapport.chevauchements.push(m.nom + ' / ' + mesures[k].nom);
        }
      }
    }

    var soucis = rapport.tropPetites.length + rapport.horsEcran.length + rapport.chevauchements.length;
    if (!rapport.bulles) {
      rapport.verdict = (langue() === 'ar')
        ? 'لا توجد فقاعات معروضة (الحلقة مغلقة أو الشاشة عريضة).'
        : 'Aucune bulle affichee (anneau replie, ou grand ecran).';
    } else if (!soucis) {
      rapport.verdict = (langue() === 'ar')
        ? 'الحلقة سليمة: كل الفقاعات ٤٤ بكسل فأكثر، داخل الشاشة، بدون تداخل.'
        : 'Anneau conforme : toutes les bulles font 44 px ou plus, tiennent dans l’ecran, et ne se chevauchent pas.';
    } else {
      rapport.verdict = (langue() === 'ar')
        ? ('انتباه: ' + soucis + ' مشكلة في الحلقة — انظر التفاصيل.')
        : ('Attention : ' + soucis + ' probleme(s) sur l’anneau — voir le detail.');
    }

    S.anneau = rapport;
    return rapport;
  }


  /* =========================================================================
     PARTIE 10 — LES RACCOURCIS DE L'ICONE
     Un appui long sur l'icone de l'application ouvre un petit menu :
     « nouvelle tache » et « aujourd'hui ». Ces deux entrees arrivent ici sous
     la forme index.html?action=add ou ?action=today.
     ========================================================================= */

  function traiterRaccourci() {
    var p, action;
    try {
      p = new URLSearchParams(location.search);
      action = p.get('action');
    } catch (e) { return; }
    if (!action) { return; }

    /* On nettoie l'adresse tout de suite : sinon, un simple rafraichissement
       de la page rouvrirait le formulaire d'ajout, ce qui est deroutant. */
    try {
      p.delete('action'); p.delete('source');
      var reste = p.toString();
      history.replaceState(null, '', location.pathname + (reste ? '?' + reste : '') + location.hash);
    } catch (e) { }

    if (action === 'add') {
      /* openAdd() est declaree dans index.html, plus bas que nos balises
         <script> : on attend qu'elle existe au lieu de supposer. */
      attendre(function () { return typeof W.openAdd === 'function'; },
        function () { W.openAdd(); vibrer('ok'); });
      return;
    }

    if (action === 'today') {
      attendre(function () { return typeof W.pickDay === 'function'; }, function () {
        var d = new Date();
        var m = String(d.getMonth() + 1); if (m.length < 2) { m = '0' + m; }
        var j = String(d.getDate()); if (j.length < 2) { j = '0' + j; }
        var jour = d.getFullYear() + '-' + m + '-' + j;
        /* pickDay bascule : si aujourd'hui est DEJA selectionne, l'appeler le
           deselectionnerait — exactement le contraire de ce qu'on demande. */
        if (!document.querySelector('.day.today.sel')) {
          try { W.pickDay(jour); } catch (e) { }
        }
        setTimeout(function () {
          var el = document.querySelector('.day.today') || document.querySelector('.datepill');
          if (el && el.scrollIntoView) {
            try { el.scrollIntoView({ block: 'center', inline: 'center', behavior: 'smooth' }); }
            catch (e2) { el.scrollIntoView(); }
          }
        }, 250);
        vibrer('ok');
      });
    }
  }


  /* =========================================================================
     PARTIE 11 — CE QUE LA BRIQUE PUBLIE
     Ces fonctions sont faites pour etre appelees depuis l'ecran de reglages
     de l'application, ou a la main dans la console.
     ========================================================================= */

  AP.pwa = {

    status: S,

    /* Est-on lance depuis l'ecran d'accueil (et non dans un onglet) ? */
    isStandalone: estInstallee,

    /* Chercher une mise a jour tout de suite. Rend une promesse. */
    update: function () { return verifierMaj(true); },

    /* Appliquer la mise a jour en attente : on demande au nouveau gardien de
       prendre la place, et c'est l'evenement « controllerchange » qui
       declenchera le rechargement. Pourquoi ne pas recharger directement ?
       Parce que la page serait alors rechargee AVANT que le nouveau gardien
       soit en place : on rechargerait l'ancienne version, et le bandeau
       reapparaitrait aussitot. Un grand classique. */
    applyUpdate: function () {
      onADemandeLaMaj = true;
      cacherBandeau();
      try {
        if (reg && reg.waiting) {
          reg.waiting.postMessage({ type: 'AP_SKIP_WAITING' });
          /* Ceinture et bretelles : si rien ne bouge en trois secondes (un
             gardien bloque, un navigateur capricieux), on recharge quand
             meme. Mieux vaut un rechargement de trop qu'un bandeau qui ne
             disparait jamais. */
          setTimeout(function () {
            if (!rechargeLancee) { rechargeLancee = true; try { location.reload(); } catch (e) { } }
          }, 3000);
          return;
        }
      } catch (e) { }
      rechargeLancee = true;
      try { location.reload(); } catch (e) { }
    },

    /* Proposer l'installation. Sur iPhone, ouvre les explications. */
    install: function () {
      if (estInstallee()) { return Promise.resolve('deja-installee'); }

      if (invitation) {
        cacherBandeau();
        try {
          invitation.prompt();
          return invitation.userChoice.then(function (choix) {
            invitation = null;
            if (choix && choix.outcome === 'accepted') {
              regler('choix', 'fait');
              return 'acceptee';
            }
            regler('refusLe', Date.now());
            return 'refusee';
          }).catch(function () { return 'echec'; });
        } catch (e) { return Promise.resolve('echec'); }
      }

      if (estApple()) { ouvrirModaleIos(); return Promise.resolve('instructions-ios'); }

      dire(T('insImpossible'));
      return Promise.resolve('indisponible');
    },

    /* Le retour vibrant : AP.pwa.haptic('ok' | 'leger' | 'attention' | 'erreur') */
    haptic: vibrer,
    setHaptic: function (actif) { regler('haptique', !!actif); return !!actif; },

    /* Le controle de l'anneau au pouce. */
    checkRing: verifierAnneau,

    /* Le numero de version du gardien (promesse). */
    version: demanderVersion,

    /* DEPANNAGE — vide la reserve hors ligne, et RIEN d'autre.
       Ne touche ni au localStorage, ni aux donnees, ni a la file d'attente de
       synchronisation : ce bouton repare un affichage, il ne perd jamais de
       travail. */
    clearCache: function () {
      return new Promise(function (resolve) {
        var fini = function (ok) { dire(T('videFait')); resolve(ok); };
        try {
          var actif = navigator.serviceWorker && navigator.serviceWorker.controller;
          if (actif && typeof actif.postMessage === 'function' && typeof MessageChannel !== 'undefined') {
            var canal = new MessageChannel();
            canal.port1.onmessage = function () { fini(true); };
            actif.postMessage({ type: 'AP_CLEAR' }, [canal.port2]);
            setTimeout(function () { fini(true); }, 3000);
            return;
          }
          /* Pas de gardien : on vide nous-memes ce qui porte notre prefixe. */
          if (W.caches && caches.keys) {
            caches.keys().then(function (noms) {
              return Promise.all(noms.map(function (n) {
                return n.indexOf('agendapro-') === 0 ? caches.delete(n) : null;
              }));
            }).then(function () { fini(true); }).catch(function () { fini(false); });
            return;
          }
          fini(false);
        } catch (e) { fini(false); }
      });
    },

    /* Retirer completement le gardien (a n'utiliser qu'en cas de probleme). */
    unregister: function () {
      if (!reg) { return Promise.resolve(false); }
      return reg.unregister().then(function (ok) {
        S.enregistre = !ok; S.raison = 'desenregistre';
        return ok;
      }).catch(function () { return false; });
    }
  };


  /* =========================================================================
     PARTIE 12 — LE DEMARRAGE
     ========================================================================= */

  (function demarrer() {
    /* Le style et les balises d'abord : ils ne dependent d'aucun reseau et
       fonctionnent meme dans un navigateur qui ignore tout des service
       workers, ou sur un fichier ouvert en local. */
    poserLeStyle();
    quandPret(poserLesBalises);

    try {
      S.tactile = !!(W.matchMedia && W.matchMedia('(pointer: coarse)').matches);
      S.installee = estInstallee();
      S.ios = estApple();
    } catch (e) { }

    compterLaVisite();
    brancherHaptique();
    ecouterInstallation();
    enregistrer();

    /* Le raccourci s'occupe d'une page deja affichee : on attend donc le
       chargement complet pour ne pas ouvrir une fenetre par-dessus une page
       a moitie dessinee. */
    if (document.readyState === 'complete') { traiterRaccourci(); }
    else { W.addEventListener('load', traiterRaccourci); }

    /* Le controle de l'anneau : seulement au doigt, et une seule fois, apres
       que la mise en page se soit stabilisee. Silencieux par construction. */
    if (S.tactile) {
      setTimeout(function () { try { verifierAnneau(); } catch (e) { } }, 1800);
    }
  })();

})();
