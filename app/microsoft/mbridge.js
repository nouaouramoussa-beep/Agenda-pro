/* ============================================================================
   AGENDA PRO — app/microsoft/mbridge.js
   LE PONT ENTRE msync.js ET LE TABLEAU DE BORD (index.html).

   Le jumeau de app/google/gbridge.js, avec deux differences assumees :

   1. LECTURE SEULE — pas de garde d'ecriture a mettre a l'epreuve (verrouRegle
      chez Google), puisqu'il n'y a rien a proteger : ce pont n'ecrit jamais
      chez Microsoft. Pas de compteur « annotations envoyees » non plus.

   2. LA NOUVELLE CASE A COCHER : « quelles sources afficher ». Une fois
      Microsoft branche EN PLUS de Google, l'artisan peut vouloir ne voir que
      l'un des deux, ou les deux ensemble — PARTIE 9. Le choix est un simple
      reglage local (agendapro_source_v1), applique en dernier, une fois que
      les deux ponts (Google et Microsoft) ont fini d'injecter et de retirer
      leurs doublons.

   TANT QUE L'ARTISAN N'A PAS BRANCHE MICROSOFT, CE FICHIER NE FAIT RIEN.
   CE QU'IL PUBLIE : window.AP.mbridge, et rien d'autre dans le global.
   ============================================================================ */

(function () {
  'use strict';

  var W = window;
  W.AP = W.AP || {};
  var AP = W.AP;
  if (AP.mbridge) { return; }

  var VERSION = '1.0.0';
  var K_PONT = 'agendapro_m_pont_v1';
  var MODES = ['remplacer', 'doublons', 'aucun'];

  /* Les origines ecrites en dur dans index.html — la meme liste que
     app/google/gbridge.js, recopiee ici parce qu'elle n'est publiee nulle
     part : les deux ponts font le meme menage, chacun pour sa source. */
  var EN_DUR = ['principal', 'famille', 'feries'];

  /* La cle du choix « quelles sources afficher » — PARTIE 9. Volontairement
     PAS prefixee agendapro_m_ : ce reglage ne concerne pas que Microsoft, il
     concerne les DEUX ponts, et doit survivre a un « delier » de l'un ou de
     l'autre. */
  var K_SOURCE = 'agendapro_source_v1';


  /* =========================================================================
     PARTIE 1 — LE DICTIONNAIRE
     ========================================================================= */

  var T = {
    ar: {
      titre:        'Microsoft (Outlook)',
      sousTitre:    'تقويم Outlook ومهام Microsoft To Do، إلى جانب Google',

      pasConfig:    'لم يُضبط معرّف Microsoft بعد.',
      pasConfigAide:'الصق هنا «معرّف التطبيق» (Application ID) من Azure Portal. يبقى محفوظًا على هذا الجهاز وحده.',
      champId:      'معرّف التطبيق (Application/Client ID)',
      enregistrer:  'حفظ',
      idInvalide:   'هذا لا يبدو معرّف تطبيق صالحًا.',
      idEnregistre: 'تم حفظ المعرّف. اضغط «اربط» الآن.',

      nonLie:       'غير مربوط — البرنامج يعمل محليًا كما في السابق.',
      lie:          'مربوط',
      lieA:         'مربوط بـ <b>{x}</b>',
      lier:         'اربط',
      delier:       'افصل',
      synchroniser: 'زامن الآن',
      enCours:      'جارٍ…',

      jamaisSync:   'لم تتم أي مزامنة بعد',
      derniere:     'آخر مزامنة {x}',
      tNow:         'قبل لحظات',
      tMin:         'منذ {n} دقيقة',
      tHour:        'منذ {n} ساعة',
      tDay:         'منذ {n} يوم',

      titreAgendas: 'التقاويم والقوائم التي يتابعها البرنامج',
      aideAgendas:  'اختر ما تريد رؤيته في اللوحة: تقاويم Outlook وقوائم Microsoft To Do.',
      aucunAgenda:  'لم تختر شيئًا بعد — لا شيء سيظهر حتى تختار عنصرًا واحدًا على الأقل.',
      principal:    'الرئيسي',
      tagCal:       'تقويم',
      tagListe:     'مهام',
      chargerListe: 'تحديث القائمة',
      listeKo:      'تعذّر جلب القائمة من Microsoft.',

      travail:      'جارٍ المزامنة مع Microsoft…',
      lus:          'عناصر مقروءة',
      masques:      'مكرّرات مخفية',
      fini:         'انتهت المزامنة',
      rienAFaire:   'لا شيء للمزامنة — اختر تقويمًا أو قائمة أولًا.',
      echec:        'فشلت المزامنة',
      msgMicrosoft: 'رسالة Microsoft:',
      horsLigne:    'لا يوجد اتصال بالإنترنت. أعد المحاولة عند عودة الشبكة.',

      titreDur:     'المواعيد المكتوبة داخل البرنامج',
      aideDur:      'هذه {n} موعدًا كُتبت داخل الملف. ماذا نفعل بها الآن؟',
      modeRemplacer:'Microsoft هو المرجع — أخفِ ما غطّته المزامنة',
      modeDoublons: 'أخفِ المكرّر فقط',
      modeAucun:    'أظهر كل شيء (للمقارنة)',
      compteMasque: '{n} موعدًا مخفيًا حاليًا',
      compteZero:   'لا شيء مخفي حاليًا',
      annonce:      'Microsoft صار مرجعًا إضافيًا: أُخفي {n} موعدًا كانت مكتوبة داخل البرنامج.',

      delierTitre:  'فصل Microsoft؟',
      delierTexte:  'سيتوقف البرنامج عن قراءة تقويمك ومهامك من Microsoft. لن يُحذف أي شيء هناك، ولن تُفقد ملاحظاتك المحفوظة على هذا الجهاز.',
      delie:        'تم فصل Microsoft. البرنامج يعمل محليًا.',

      fermer:       'إغلاق',
      regleKo:      'تعذّر تفعيل المزامنة مع Microsoft.',

      /* --- PARTIE 9 : quelles sources afficher --- */
      srcTitre:     'المصادر المعروضة',
      srcAide:      'اختر ما تريد رؤيته في اللوحة: تقويم Google، تقويم Microsoft، أو كلاهما معًا.',
      srcTous:      'كلاهما',
      srcGoogle:    'Google فقط',
      srcMicrosoft: 'Microsoft فقط'
    },
    fr: {
      titre:        'Microsoft (Outlook)',
      sousTitre:    'Le calendrier Outlook et les taches Microsoft To Do, a cote de Google',

      pasConfig:    'L\'identifiant Microsoft n\'est pas encore renseigne.',
      pasConfigAide:'Collez ici l\'« ID d\'application » pris sur le Portail Azure. Il reste sur cet appareil.',
      champId:      'ID d\'application (Application/Client ID)',
      enregistrer:  'Enregistrer',
      idInvalide:   'Cela ne ressemble pas a un identifiant d\'application valide.',
      idEnregistre: 'Identifiant enregistre. Cliquez « Lier » maintenant.',

      nonLie:       'Non lie — le programme travaille en local, comme avant.',
      lie:          'Lie',
      lieA:         'Lie a <b>{x}</b>',
      lier:         'Lier',
      delier:       'Delier',
      synchroniser: 'Synchroniser',
      enCours:      'En cours…',

      jamaisSync:   'aucune synchronisation pour l\'instant',
      derniere:     'derniere synchro {x}',
      tNow:         'a l\'instant',
      tMin:         'il y a {n} min',
      tHour:        'il y a {n} h',
      tDay:         'il y a {n} j',

      titreAgendas: 'Les agendas et listes que le programme suit',
      aideAgendas:  'Cochez ce que vous voulez voir dans le tableau de bord : calendriers Outlook et listes Microsoft To Do.',
      aucunAgenda:  'Rien de coche — rien ne s\'affichera tant que vous ne cochez pas au moins un element.',
      principal:    'principal',
      tagCal:       'calendrier',
      tagListe:     'taches',
      chargerListe: 'Actualiser la liste',
      listeKo:      'La liste n\'a pas pu etre lue depuis Microsoft.',

      travail:      'Synchronisation avec Microsoft…',
      lus:          'elements lus',
      masques:      'doublons masques',
      fini:         'Synchronisation terminee',
      rienAFaire:   'Rien a synchroniser — cochez un calendrier ou une liste d\'abord.',
      echec:        'Synchronisation impossible',
      msgMicrosoft: 'Message de Microsoft :',
      horsLigne:    'Pas de connexion internet. Reessayez au retour du reseau.',

      titreDur:     'Les rendez-vous ecrits dans le programme',
      aideDur:      'Voici {n} rendez-vous ecrits dans le fichier. Qu\'en fait-on maintenant ?',
      modeRemplacer:'Microsoft fait foi — cacher ce que la synchronisation couvre',
      modeDoublons: 'Cacher seulement les doublons averes',
      modeAucun:    'Tout afficher (pour comparer)',
      compteMasque: '{n} rendez-vous caches actuellement',
      compteZero:   'Rien de cache actuellement',
      annonce:      'Microsoft est devenu une reference supplementaire : {n} rendez-vous ecrits dans le programme ont ete caches.',

      delierTitre:  'Delier Microsoft ?',
      delierTexte:  'Le programme cessera de lire votre calendrier et vos taches Microsoft. RIEN n\'est efface la-bas, et vos notes gardees sur cet appareil restent.',
      delie:        'Microsoft est delie. Le programme travaille en local.',

      fermer:       'Fermer',
      regleKo:      'Impossible d\'activer la synchronisation Microsoft.',

      srcTitre:     'Sources affichees',
      srcAide:      'Choisissez ce que le tableau de bord affiche : le calendrier Google, celui de Microsoft, ou les deux ensemble.',
      srcTous:      'Les deux',
      srcGoogle:    'Google seul',
      srcMicrosoft: 'Microsoft seul'
    }
  };

  function langue() {
    if (AP.ui && typeof AP.ui.lang === 'function') { return AP.ui.lang(); }
    var l = (document.documentElement.lang || '').toLowerCase();
    return (l.indexOf('fr') === 0) ? 'fr' : 'ar';
  }
  function M(cle, vars) {
    var d = T[langue()] || T.ar;
    var s = d[cle] || T.ar[cle] || '';
    if (vars) { Object.keys(vars).forEach(function (k) { s = s.split('{' + k + '}').join(String(vars[k])); }); }
    return s;
  }
  function propre(s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }
  function depuis(ms) {
    if (!ms) { return ''; }
    var d = Date.now() - ms; if (d < 0) { d = 0; }
    var mn = Math.floor(d / 60000);
    if (mn < 1) { return M('tNow'); }
    if (mn < 60) { return M('tMin', { n: mn }); }
    var h = Math.floor(mn / 60);
    if (h < 24) { return M('tHour', { n: h }); }
    return M('tDay', { n: Math.floor(h / 24) });
  }
  function jget(cle, defaut) {
    try { var v = localStorage.getItem(cle); return v ? JSON.parse(v) : defaut; } catch (e) { return defaut; }
  }
  function jset(cle, v) { try { localStorage.setItem(cle, JSON.stringify(v)); return true; } catch (e) { return false; } }

  function dire() {
    if (!actif()) { return; }
    try { console.log.apply(console, ['[pont Microsoft]'].concat([].slice.call(arguments))); } catch (e) { }
  }
  function avert(msg) { try { console.warn('[pont Microsoft] ' + msg); } catch (e) { } }
  function toast(msg) {
    if (P.toast) { try { P.toast(msg); return; } catch (e) { } }
    try {
      var e = document.getElementById('toast');
      if (!e) { return; }
      e.textContent = msg; e.classList.add('show');
      clearTimeout(toast._t);
      toast._t = setTimeout(function () { e.classList.remove('show'); }, 2600);
    } catch (er) { }
  }


  /* =========================================================================
     PARTIE 2 — LE PONT VERS index.html (identique au principe de gbridge.js)
     ========================================================================= */

  var P = { store: null, state: null, lsSet: null, buildTasks: null, render: null, toast: null, TASKS: null, SUBS: null, rebuildBoards: null };
  var branche = false;

  function brancher(pont) {
    pont = pont || {};
    ['store', 'state', 'lsSet', 'buildTasks', 'render', 'toast', 'TASKS', 'SUBS', 'rebuildBoards']
      .forEach(function (k) { if (pont[k] !== undefined) { P[k] = pont[k]; } });
    branche = true;
    if (clientId()) { try { joindreLesBriques(); } catch (e) { avert('raccordement : ' + e.message); } }
    demarrer();
    return AP.mbridge;
  }

  function taches() {
    if (!P.TASKS) { return null; }
    try { var l = P.TASKS(); return (l && typeof l.splice === 'function') ? l : null; } catch (e) { return null; }
  }

  function clientId() {
    try {
      var c = W.AP_CONFIG || {};
      if (c.microsoftClientId) { return String(c.microsoftClientId).trim(); }
      var r = jget('agendapro_m_reglages_v1', {}) || {};
      return String(r.clientId || '').trim();
    } catch (e) { return ''; }
  }

  function infoMoteur() {
    if (!(AP.msync && typeof AP.msync.info === 'function')) { return null; }
    try { return AP.msync.info(); } catch (e) { return null; }
  }
  function infoCompte() {
    if (!(AP.mauth && typeof AP.mauth.etat === 'function')) { return null; }
    try { return AP.mauth.etat(); } catch (e) { return null; }
  }
  function actif() {
    if (!clientId()) { return false; }
    var i = infoMoteur();
    if (!i) { return false; }
    return !!(i.connecte || i.taches > 0);
  }

  var jointes = false;
  function joindreLesBriques() {
    if (jointes) { return true; }
    if (!(AP.msync && AP.mauth)) { return false; }
    if (typeof AP.msync.setTokenProvider === 'function' && typeof AP.mauth.fournisseur === 'function') {
      try { AP.msync.setTokenProvider(AP.mauth.fournisseur); dire('un seul jeton Microsoft pour tout le produit.'); }
      catch (e) { avert('setTokenProvider : ' + e.message); }
    }
    ecouterLaReconnexion();
    jointes = true;
    return true;
  }

  var ecouteReco = false;
  function ecouterLaReconnexion() {
    if (ecouteReco) { return; }
    if (!(AP.mauth && typeof AP.mauth.onChange === 'function')) { return; }
    ecouteReco = true;
    var etaitRelie = false;
    AP.mauth.onChange(function (e) {
      if (!e) { return; }
      if (e.besoinReconnexion || !e.connecte) { etaitRelie = false; return; }
      if (etaitRelie) { return; }
      etaitRelie = true;
      dire('compte Microsoft relie — le moteur se met au travail.');
      try {
        Promise.resolve(AP.msync.reveiller()).catch(function (er) { avert('reprise : ' + (er && er.message)); });
      } catch (er) { avert('reprise : ' + er.message); }
    });
  }


  /* =========================================================================
     PARTIE 3 — LES DOUBLONS (le jumeau de gbridge.js, source Microsoft)
     ========================================================================= */

  function reglagesPont() { return Object.assign({ mode: 'remplacer', annonce: 0 }, jget(K_PONT, {})); }
  function poserReglagesPont(patch) { var r = Object.assign(reglagesPont(), patch || {}); jset(K_PONT, r); return r; }

  function normTitre(s) {
    return String(s == null ? '' : s)
      .replace(/[​-‏‪-‮﻿]/g, '')
      .replace(/[ـ]/g, '')
      .replace(/[ً-ٰ]/g, '')
      .replace(/[\uD800-\uDBFF][\uDC00-\uDFFF]/g, '')
      .replace(/[←-⯿☀-➿️⃣©®]/g, '')
      .replace(/[أإآ]/g, 'ا').replace(/[ة]/g, 'ه').replace(/[ى]/g, 'ي')
      .replace(/[•·‣▪◦*\-–—_.,;:!?()\[\]{}'"«»“”‘’\/\\|+]/g, ' ')
      .replace(/\s+/g, ' ').trim().toLowerCase();
  }
  function clesNaturelles(t) {
    var jour = t.date || '', h = t.allDay ? '' : (t.start || ''), out = [];
    [t.title && t.title.ar, t.title && t.title.fr, t.raw].forEach(function (titre) {
      var n = normTitre(titre); if (n) { out.push(jour + '|' + h + '|' + n); }
    });
    return out;
  }
  function jourPlus(n) {
    var d = new Date(); d.setHours(12, 0, 0, 0); d.setDate(d.getDate() + n);
    var m = String(d.getMonth() + 1), j = String(d.getDate());
    return d.getFullYear() + '-' + (m.length < 2 ? '0' + m : m) + '-' + (j.length < 2 ? '0' + j : j);
  }

  var DERNIER_MASQUE = 0;
  var DERNIERE_REPRISE = 0;

  function dedoublonner() {
    DERNIER_MASQUE = 0;
    var liste = taches();
    if (!liste || !liste.length) { return 0; }
    var i = infoMoteur();
    if (!i || !i.connecte) { return 0; }
    var mode = reglagesPont().mode;
    if (mode === 'aucun') { return 0; }

    var idsM = {}, clesM = {}, nM = 0;
    liste.forEach(function (t) {
      if (!t || t.src !== 'microsoft') { return; }
      nM++;
      if (t.mev) { idsM[t.mev] = t; }
      clesNaturelles(t).forEach(function (c) { if (!clesM[c]) { clesM[c] = t; } });
    });
    if (!nM) { return 0; }

    var f = i.fenetre || { passe: 90, futur: 400 };
    var borneBasse = jourPlus(-Math.abs(f.passe || 90));
    var borneHaute = jourPlus(Math.abs(f.futur || 400));
    var remplace = (mode === 'remplacer') && !!i.derniereLecture && !i.erreur && !!i.derniereComplete;

    var candidats = [];
    for (var k = liste.length - 1; k >= 0; k--) {
      var t = liste[k];
      if (!t || EN_DUR.indexOf(t.src) < 0) { continue; }
      var jumeau = null;
      var cles = clesNaturelles(t);
      for (var c = 0; c < cles.length; c++) { if (clesM[cles[c]]) { jumeau = clesM[cles[c]]; break; } }
      var dansLaFenetre = remplace && t.src !== 'feries' && t.date >= borneBasse && t.date <= borneHaute;
      if (!jumeau && !dansLaFenetre) { continue; }
      candidats.push({ k: k, t: t, jumeau: jumeau });
    }

    var sansPreuve = 0;
    candidats.forEach(function (c) { if (!c.jumeau) { sansPreuve++; } });
    var refuseLeBloc = (sansPreuve > 50 && nM < 5);
    if (refuseLeBloc) {
      avert('Microsoft n\'a rendu que ' + nM + ' element(s) : on ne masque pas pour autant les ' + sansPreuve + ' rendez-vous sans jumeau.');
    }

    var aReprendre = [], masques = 0;
    candidats.forEach(function (c) {
      if (!c.jumeau && refuseLeBloc) { return; }
      if (c.jumeau) { aReprendre.push([c.t, c.jumeau]); }
      liste.splice(c.k, 1);
      masques++;
    });

    DERNIER_MASQUE = masques;
    if (aReprendre.length) { reprendreLeTravail(aReprendre); }
    if (masques && !reglagesPont().annonce) {
      poserReglagesPont({ annonce: 1 });
      setTimeout(function () { toast(M('annonce', { n: masques })); }, 400);
    }
    return masques;
  }

  function reprendreLeTravail(paires) {
    if (!P.store || !P.lsSet) { return; }
    var champs = ['status', 'notes', 'cat', 'sub', 'contact', 'place'];
    /* Un instantane PAR CHAMP de ce qui a deja ete recopie, pas un simple
       « fait/pas fait » pour toute la paire. Un rendez-vous en dur peut
       reapparaitre temporairement (calendrier Microsoft decoche puis
       recoche) : si l'artisan le modifie pendant cette fenetre, la valeur de
       vieux.id change, differe de l'instantane, et repart vers neuf.id au
       prochain passage — au lieu d'etre ignoree pour toujours parce que
       « cette paire a deja ete traitee une fois ». */
    var suivis = reglagesPont().reprises || {};
    var change = false, n = 0;
    paires.forEach(function (paire) {
      var vieux = paire[0], neuf = paire[1];
      var marque = vieux.id + '>' + neuf.id;
      var snap = suivis[marque] || {};
      var repris = false;
      champs.forEach(function (ch) {
        var table = P.store[ch];
        if (!table || typeof table !== 'object') { return; }
        var actuel = table[vieux.id];
        if (actuel === undefined) { return; }
        if (snap[ch] === actuel) { return; }
        table[neuf.id] = actuel;
        snap[ch] = actuel;
        repris = true;
      });
      if (repris) { suivis[marque] = snap; change = true; n++; }
    });
    if (change) { poserReglagesPont({ reprises: suivis }); }
    if (n) {
      try { P.lsSet(); } catch (e) { }
      DERNIERE_REPRISE += n;
      dire('travail repris sur ' + n + ' rendez-vous.');
    }
  }

  function compterEnDur() {
    var l = taches(); if (!l) { return 0; }
    var n = 0; l.forEach(function (t) { if (t && EN_DUR.indexOf(t.src) >= 0) { n++; } });
    return n;
  }

  function injecterMicrosoft() {
    var liste = taches();
    if (!liste || !(AP.msync && typeof AP.msync.tasks === 'function')) { return; }
    var mtasks = AP.msync.tasks();
    for (var i = 0; i < mtasks.length; i++) { liste.push(mtasks[i]); }
  }


  /* =========================================================================
     PARTIE 4 — LA VISIBILITE DES SOURCES (Google / Microsoft / les deux)
     ---------------------------------------------------------------------
     LA DEMANDE DE L'ARTISAN, EN UNE PHRASE : « soit Google, soit Microsoft,
     soit les deux — que je choisisse ce qui s'affiche ». Ce choix n'efface
     rien : il retire, du tableau final, ce qui vient de la source ecartee. Un
     rendez-vous ecrit dans le programme (EN_DUR) n'est jamais concerne — ce
     reglage ne parle que des DEUX PONTS EXTERNES.

     APPLIQUE EN DERNIER, DANS L'ENVELOPPE DE CE FICHIER — PARTIE 5 — parce que
     ce fichier se charge apres gbridge.js : quand les deux ponts sont actifs,
     c'est forcement lui qui repeint APRES l'injection et le demasquage des
     deux sources. Un seul geste voit donc le tableau complet.
     ========================================================================= */

  function lireSource() { try { return localStorage.getItem(K_SOURCE) || 'tous'; } catch (e) { return 'tous'; } }
  function ecrireSource(v) {
    if (['tous', 'google', 'microsoft'].indexOf(v) < 0) { return; }
    try { localStorage.setItem(K_SOURCE, v); } catch (e) { }
  }
  function appliquerFiltreSource(liste) {
    var choix = lireSource();
    if (choix === 'tous' || !liste) { return 0; }
    var retires = 0;
    for (var k = liste.length - 1; k >= 0; k--) {
      var t = liste[k];
      if (t && (t.src === 'google' || t.src === 'microsoft') && t.src !== choix) { liste.splice(k, 1); retires++; }
    }
    return retires;
  }


  /* =========================================================================
     PARTIE 5 — L'ENVELOPPE AUTOUR DE buildTasks() (le jumeau de gbridge.js)
     ========================================================================= */

  var enveloppePosee = false;
  function envelopperBuildTasks() {
    if (enveloppePosee) { return; }
    var orig = W.buildTasks;
    if (typeof orig !== 'function' || orig.__apPontM) { return; }
    /* L'INDIRECTION QUI GARDE CETTE ENVELOPPE TOUJOURS LA PLUS EXTERIEURE.
       Google et Microsoft se branchent chacun au moment ou l'artisan clique
       « Lier », pas forcement dans l'ordre des balises <script> : un artisan
       qui n'utilise QUE Microsoft depuis des semaines pose cette enveloppe en
       premier ; le jour ou il lie enfin Google, gbridge.js lirait alors CETTE
       enveloppe comme son « orig » et se poserait PAR-DESSUS elle — le filtre
       de sources (PARTIE 4) tournerait alors AVANT que Google n'ait injecte
       ses rendez-vous, et ne les verrait jamais. `interne.fn` est le crochet
       que gbridge.js sait retrouver (orig.__apPontMInterne) pour s'inserer A
       L'INTERIEUR au lieu de s'envelopper PAR-DESSUS, quel que soit l'ordre
       reel de connexion. */
    var interne = { fn: orig };
    var neuf = function () {
      var r = interne.fn.apply(this, arguments);
      try {
        injecterMicrosoft();
        dedoublonner();
        appliquerFiltreSource(taches());
      } catch (e) { avert('buildTasks : ' + e.message); }
      return r;
    };
    neuf.__apPontM = true;
    neuf.__apPontMInterne = interne;
    W.buildTasks = neuf;
    enveloppePosee = true;
    dire('buildTasks enveloppe — Microsoft entre dans la liste, les doublons en sortent, la source choisie s\'applique.');
  }


  /* =========================================================================
     PARTIE 6 — LE PANNEAU
     ========================================================================= */

  var elPanneau = null;

  function poserStyle() {
    if (document.getElementById('apmPontCss')) { return; }
    var s = document.createElement('style');
    s.id = 'apmPontCss';
    s.textContent = [
      '.apg-modes{display:flex;flex-direction:column;gap:7px;margin-top:4px}',
      '.apg-modes label{display:flex;align-items:flex-start;gap:8px;font-size:12.5px;cursor:pointer;line-height:1.5}',
      '.apg-modes input{margin-top:2px;accent-color:var(--brand2);flex:none;cursor:pointer}',
      '.apm-src{display:flex;flex-wrap:wrap;gap:8px;margin-top:8px}',
      '.apm-src button{flex:1 1 100px}'
    ].join('\n');
    document.head.appendChild(s);
  }

  function construire() {
    if (elPanneau) { return elPanneau; }
    poserStyle();
    var d = document.createElement('div');
    d.className = 'modal'; d.id = 'apmPanneau';
    d.innerHTML =
      '<div class="modal-in wide">' +
        '<div class="modal-h"><h3 id="apmTitre"></h3><button class="tbtn" type="button" id="apmX">✕</button></div>' +
        '<div class="modal-b" id="apmCorps"></div>' +
        '<div class="modal-f"><button class="mb" type="button" id="apmFermer"></button></div>' +
      '</div>';
    document.body.appendChild(d);
    d.addEventListener('click', function (e) { if (e.target === d) { fermer(); } });
    d.querySelector('#apmX').addEventListener('click', fermer);
    d.querySelector('#apmFermer').addEventListener('click', fermer);
    elPanneau = d;
    return d;
  }

  function ouvrir() {
    construire(); dessiner();
    elPanneau.classList.add('show');
    var i = infoMoteur();
    if (i && i.connecte && (!i.agendas || !i.agendas.length)) { chargerAgendas(); }
    return true;
  }
  function fermer() { if (elPanneau) { elPanneau.classList.remove('show'); } }

  function bouton(txt, prim, fn, id) {
    var b = document.createElement('button');
    b.type = 'button'; b.className = prim ? 'mb pri' : 'mb'; b.textContent = txt;
    if (id) { b.id = id; }
    b.addEventListener('click', fn);
    return b;
  }
  function sec(html) { var s = document.createElement('div'); s.className = 'apg-sec'; s.innerHTML = html; return s; }
  function chiffre(n, lbl) {
    var d = document.createElement('div'); d.className = 'apg-ch';
    d.innerHTML = '<b>' + propre(String(n)) + '</b><span>' + propre(lbl) + '</span>';
    return d;
  }
  function tag(txt) { var e = document.createElement('span'); e.className = 'apg-tag'; e.textContent = txt; return e; }
  function hachage(s) {
    var h = 0; s = String(s || '');
    for (var i = 0; i < s.length; i++) { h = ((h << 5) - h + s.charCodeAt(i)) | 0; }
    return h;
  }

  function dessiner() {
    if (!elPanneau) { return; }
    var corps = elPanneau.querySelector('#apmCorps');
    if (!corps) { return; }
    elPanneau.querySelector('#apmTitre').textContent = M('titre');
    elPanneau.querySelector('#apmFermer').textContent = M('fermer');
    corps.textContent = '';

    var i = infoMoteur() || {};
    var c = infoCompte() || {};
    var id = clientId();

    if (!id) { corps.appendChild(sectionIdentifiant()); return; }
    corps.appendChild(sectionEtat(i, c));
    if (i.connecte) { corps.appendChild(sectionAgendas(i)); }
    if (i.connecte) { corps.appendChild(sectionSources()); }
    if (i.connecte) { corps.appendChild(sectionEnDur()); }
  }

  function sectionIdentifiant() {
    var s = sec('<p class="apg-h">' + propre(M('pasConfig')) + '</p><p class="apg-aide">' + propre(M('pasConfigAide')) + '</p>');
    var champ = document.createElement('input');
    champ.type = 'text'; champ.className = 'apg-in'; champ.placeholder = M('champId');
    champ.autocomplete = 'off'; champ.spellcheck = false;
    s.appendChild(champ);
    var bas = document.createElement('div'); bas.className = 'apg-bas';
    bas.appendChild(bouton(M('enregistrer'), true, function () {
      var v = (champ.value || '').trim();
      if (!/^[0-9a-fA-F-]{20,}$/.test(v)) { toast(M('idInvalide')); return; }
      var r = jget('agendapro_m_reglages_v1', {}) || {}; r.clientId = v; jset('agendapro_m_reglages_v1', r);
      try { if (AP.mauth && typeof AP.mauth.reconfigurer === 'function') { AP.mauth.reconfigurer(); } } catch (e) { }
      toast(M('idEnregistre'));
      dessiner();
    }));
    s.appendChild(bas);
    return s;
  }

  function sectionEtat(i, c) {
    var s = sec('');
    var ligne = document.createElement('div'); ligne.className = 'apg-etat';
    var pt = document.createElement('span'); pt.className = 'apg-dot' + (i.erreur ? ' bad' : (i.connecte ? ' on' : ' warn'));
    ligne.appendChild(pt);
    var txt = document.createElement('div');
    if (!i.connecte) { txt.innerHTML = propre(M('nonLie')); }
    else {
      var qui = c.courriel ? M('lieA', { x: propre(c.courriel) }) : M('lie');
      var quand = i.derniereLecture ? M('derniere', { x: propre(depuis(i.derniereLecture)) }) : M('jamaisSync');
      txt.innerHTML = qui + ' — ' + propre(quand);
    }
    ligne.appendChild(txt); s.appendChild(ligne);

    if (i.connecte) {
      var ch = document.createElement('div'); ch.className = 'apg-chif';
      ch.appendChild(chiffre(i.taches || 0, M('lus')));
      ch.appendChild(chiffre(DERNIER_MASQUE, M('masques')));
      s.appendChild(ch);
    }
    if (i.erreur) {
      var d = document.createElement('div'); d.className = 'apg-err';
      d.innerHTML = '<b>' + propre(M('echec')) + '</b><br>' + propre(M('msgMicrosoft')) + '<code>' + propre(i.erreur) + '</code>';
      s.appendChild(d);
    }

    var bas = document.createElement('div'); bas.className = 'apg-bas';
    if (!i.connecte) { bas.appendChild(bouton(M('lier'), true, lier, 'apmLier')); }
    else {
      bas.appendChild(bouton(M('synchroniser'), true, function () { actualiser({ depuisPanneau: true }); }, 'apmSync'));
      bas.appendChild(bouton(M('delier'), false, demanderDelier));
    }
    s.appendChild(bas);
    return s;
  }

  function sectionAgendas(i) {
    var s = sec('<p class="apg-h">' + propre(M('titreAgendas')) + '</p><p class="apg-aide">' + propre(M('aideAgendas')) + '</p>');
    var liste = i.agendas || [];
    if (!liste.length) {
      var p = document.createElement('p'); p.className = 'apg-aide'; p.textContent = M('listeKo');
      s.appendChild(p);
      var bas0 = document.createElement('div'); bas0.className = 'apg-bas';
      bas0.appendChild(bouton(M('chargerListe'), false, chargerAgendas));
      s.appendChild(bas0);
      return s;
    }
    var suivis = i.suivis || [];
    if (!suivis.length) {
      var av = document.createElement('p'); av.className = 'apg-aide'; av.style.color = 'var(--warn)'; av.textContent = M('aucunAgenda');
      s.appendChild(av);
    }
    liste.forEach(function (a) {
      var row = document.createElement('div'); row.className = 'apg-cal';
      var cb = document.createElement('input'); cb.type = 'checkbox'; cb.checked = (i.suivis || []).indexOf(a.id) >= 0;
      cb.id = 'apmCal_' + Math.abs(hachage(a.id));
      cb.addEventListener('change', function () {
        try { AP.msync.suivre(a.id, cb.checked); } catch (e) { avert('suivre : ' + e.message); }
        if (cb.checked) { actualiser({ depuisPanneau: true, complet: true }); }
        else { rendre(); dessiner(); }
      });
      row.appendChild(cb);
      var lab = document.createElement('label'); lab.setAttribute('for', cb.id);
      var nom = document.createElement('span'); nom.className = 'apg-nom'; nom.textContent = a.nom || a.id;
      lab.appendChild(nom);
      if (a.principal) { lab.appendChild(tag(M('principal'))); }
      lab.appendChild(tag(a.type === 'liste' ? M('tagListe') : M('tagCal')));
      row.appendChild(lab);
      s.appendChild(row);
    });
    var bas = document.createElement('div'); bas.className = 'apg-bas';
    bas.appendChild(bouton(M('chargerListe'), false, chargerAgendas));
    s.appendChild(bas);
    return s;
  }

  function sectionSources() {
    var s = sec('<p class="apg-h">' + propre(M('srcTitre')) + '</p><p class="apg-aide">' + propre(M('srcAide')) + '</p>');
    var choix = lireSource();
    var bar = document.createElement('div'); bar.className = 'apm-src';
    [['tous', M('srcTous')], ['google', M('srcGoogle')], ['microsoft', M('srcMicrosoft')]].forEach(function (opt) {
      bar.appendChild(bouton(opt[1], choix === opt[0], function () {
        ecrireSource(opt[0]);
        rendre();
        dessiner();
      }));
    });
    s.appendChild(bar);
    return s;
  }

  function sectionEnDur() {
    var s = sec('');
    var total = compterEnDur();
    s.innerHTML = '<p class="apg-h">' + propre(M('titreDur')) + '</p><p class="apg-aide">' + propre(M('aideDur', { n: total + DERNIER_MASQUE })) + '</p>';
    var modes = document.createElement('div'); modes.className = 'apg-modes';
    var courant = reglagesPont().mode;
    [['remplacer', M('modeRemplacer')], ['doublons', M('modeDoublons')], ['aucun', M('modeAucun')]].forEach(function (opt) {
      var lab = document.createElement('label');
      var r = document.createElement('input'); r.type = 'radio'; r.name = 'apmMode'; r.checked = (courant === opt[0]);
      r.addEventListener('change', function () { poserReglagesPont({ mode: opt[0] }); rendre(); dessiner(); });
      var txt = document.createElement('span'); txt.textContent = opt[1];
      lab.appendChild(r); lab.appendChild(txt); modes.appendChild(lab);
    });
    s.appendChild(modes);
    var p = document.createElement('p'); p.className = 'apg-aide';
    p.textContent = DERNIER_MASQUE ? M('compteMasque', { n: DERNIER_MASQUE }) : M('compteZero');
    s.appendChild(p);
    return s;
  }


  /* =========================================================================
     PARTIE 7 — LES ACTIONS
     ========================================================================= */

  var enTrain = false;

  function lier() {
    if (!joindreLesBriques()) { return Promise.resolve(false); }
    var b = document.getElementById('apmLier');
    if (b) { b.disabled = true; b.textContent = M('enCours'); }
    return Promise.resolve()
      .then(function () { return AP.mauth.connecter({ interactif: true }); })
      .then(function () { demarrer(); dessiner(); return true; })
      .catch(function (e) { avert('liaison : ' + (e && e.message)); dessiner(); return false; })
      .then(function (r) {
        var b2 = document.getElementById('apmLier');
        if (b2) { b2.disabled = false; b2.textContent = M('lier'); }
        return r;
      });
  }

  function chargerAgendas() {
    if (!(AP.msync && typeof AP.msync.chargerAgendas === 'function')) { return Promise.resolve([]); }
    return Promise.resolve()
      .then(function () { return AP.msync.chargerAgendas(); })
      .then(function (l) { dessiner(); return l; })
      .catch(function (e) { avert('liste : ' + (e && e.message)); dessiner(); return []; });
  }

  function actualiser(opts) {
    opts = opts || {};
    if (!joindreLesBriques()) { return Promise.resolve(false); }
    var i = infoMoteur() || {};
    if (!i.connecte) { ouvrir(); return Promise.resolve(false); }
    if (!i.suivis || !i.suivis.length) { toast(M('rienAFaire')); ouvrir(); return Promise.resolve(false); }
    if (enTrain) { return Promise.resolve(false); }
    enTrain = true;

    var bSync = document.getElementById('apmSync');
    if (bSync) { bSync.disabled = true; bSync.textContent = M('enCours'); }
    if (!opts.silencieux) { toast(M('travail')); }

    if (typeof navigator !== 'undefined' && navigator.onLine === false) {
      enTrain = false;
      if (bSync) { bSync.disabled = false; bSync.textContent = M('synchroniser'); }
      toast(M('horsLigne')); dessiner();
      return Promise.resolve(false);
    }

    return Promise.resolve()
      .then(function () { return AP.msync.pull({ complet: !!opts.complet }); })
      .then(function () {
        var ap = infoMoteur() || {};
        rendre();
        if (ap.erreur) { toast(M('echec') + ' — ' + ap.erreur); return false; }
        var bouts = [(ap.taches || 0) + ' ' + M('lus')];
        if (DERNIER_MASQUE) { bouts.push(DERNIER_MASQUE + ' ' + M('masques')); }
        toast(M('fini') + ' — ' + bouts.join(' · '));
        return true;
      })
      .catch(function (e) {
        var msg = (e && e.message) ? String(e.message) : '';
        avert('synchronisation : ' + msg);
        toast(M('echec') + (msg ? ' — ' + msg : ''));
        return false;
      })
      .then(function (r) {
        enTrain = false;
        var b2 = document.getElementById('apmSync');
        if (b2) { b2.disabled = false; b2.textContent = M('synchroniser'); }
        dessiner();
        return r;
      });
  }

  function demanderDelier() {
    if (!W.confirm(M('delierTitre') + '\n\n' + M('delierTexte'))) { return; }
    /* Le filtre de sources (PARTIE 4) ne se desactive jamais tout seul : s'il
       vaut « microsoft seul », le delier maintenant ferait disparaitre Google
       de l'ecran (plus aucun rendez-vous Microsoft pour remplacer ceux qu'on
       masque), sans que rien ne l'explique. On revient a « les deux » avant
       de vider le moteur, pour que le tout premier rendu qui suit voie deja
       le bon reglage. */
    if (lireSource() === 'microsoft') { ecrireSource('tous'); }
    try { AP.msync.deconnecter(); } catch (e) { avert('deconnecter (moteur) : ' + e.message); }
    try { if (AP.mauth && AP.mauth.deconnecter) { AP.mauth.deconnecter(); } } catch (e) { avert('deconnecter (compte) : ' + e.message); }
    DERNIER_MASQUE = 0;
    rendre(); dessiner();
    toast(M('delie'));
  }

  function rendre() {
    try { if (typeof W.buildTasks === 'function') { W.buildTasks(); } else if (P.buildTasks) { P.buildTasks(); } }
    catch (e) { avert('buildTasks : ' + e.message); }
    try { if (typeof W.render === 'function') { W.render(); } else if (P.render) { P.render(); } }
    catch (e) { avert('render : ' + e.message); }
  }


  /* =========================================================================
     PARTIE 8 — LE DEMARRAGE
     ========================================================================= */

  /* Le geste de recategoriser une tache (le bouton qui fait tourner la
     section, moveCat() dans index.html) n'ecrit que dans `store.cat`, jamais
     dans l'ombre de msync.js. Sans ce raccord, le choix de l'artisan sur une
     tache Microsoft serait efface au prochain pull() : msync.tacheDe() relit
     `cat: etat.sc || parAgenda.sec || 'perso'`, et `etat.sc` resterait vide
     pour toujours. On raccroche donc moveCat() ici, exactement comme
     gsync.js le fait deja pour Google — la meme case a cocher doit se
     comporter pareil, quelle que soit la source de la tache. */
  function estMtache(id) {
    if (typeof id !== 'string' || id.indexOf('m|') !== 0) { return false; }
    /* Le prefixe seul ne suffit pas : pendant qu'un pull() suit plusieurs
       agendas en sequence, une tache peut avoir deja disparu de msync.js
       (supprimee cote Microsoft) avant que buildTasks() ne redessine l'ecran
       — la carte, elle, reste affichee jusqu'a ce redessin. Un clic sur
       « recategoriser » pendant cette fenetre ne doit pas ecrire une ombre
       fantome pour un id que le moteur ne connait deja plus. */
    var evs = (AP.msync && AP.msync._ && typeof AP.msync._.evenements === 'function') ? AP.msync._.evenements() : null;
    return !!(evs && evs[id]);
  }
  function raccrocherMoveCat() {
    if (typeof W.moveCat !== 'function' || W.moveCat.__apm) { return; }
    var orig = W.moveCat;
    var neuf = function () {
      var r = orig.apply(this, arguments);
      try {
        var id = arguments[0];
        if (estMtache(id) && P.store && P.store.cat && AP.msync && typeof AP.msync.setSection === 'function') {
          AP.msync.setSection(id, P.store.cat[id] || null);
        }
      } catch (e) { avert('moveCat : ' + e.message); }
      return r;
    };
    neuf.__apm = true;
    W.moveCat = neuf;
  }

  var demarre = false;
  function demarrer() {
    if (!branche) { return false; }
    if (!actif()) { return false; }
    if (demarre) { return true; }
    if (!joindreLesBriques()) { return false; }
    demarre = true;
    raccrocherMoveCat();
    envelopperBuildTasks();
    dire('en place (v' + VERSION + ').');
    if (AP.mauth && typeof AP.mauth.pret === 'object' && AP.mauth.pret && typeof AP.mauth.pret.then === 'function') {
      AP.mauth.pret.then(function () { try { AP.msync.reveiller(); } catch (e) { } });
    } else {
      try { AP.msync.reveiller(); } catch (e) { }
    }
    return true;
  }


  /* =========================================================================
     PARTIE 9 — L'API PUBLIQUE
     ========================================================================= */

  AP.mbridge = {
    version: VERSION,
    brancher: brancher,
    ouvrir: ouvrir,
    fermer: fermer,
    lier: lier,
    delier: demanderDelier,
    agendas: chargerAgendas,
    actualiser: actualiser,
    rendre: rendre,
    dedoublonner: dedoublonner,
    mode: function (m) {
      if (m === undefined) { return reglagesPont().mode; }
      if (MODES.indexOf(m) < 0) { return reglagesPont().mode; }
      poserReglagesPont({ mode: m }); rendre();
      return m;
    },
    source: function (v) {
      if (v === undefined) { return lireSource(); }
      ecrireSource(v); rendre();
      return lireSource();
    },
    etat: function () {
      var i = infoMoteur() || {};
      var c = infoCompte() || {};
      return {
        disponible: !!(AP.msync && AP.mauth),
        configure: !!clientId(),
        connecte: !!i.connecte,
        courriel: c.courriel || '',
        agendas: (i.agendas || []).length,
        suivis: (i.suivis || []).length,
        taches: i.taches || 0,
        derniere: i.derniereLecture || 0,
        depuis: depuis(i.derniereLecture || 0),
        masques: DERNIER_MASQUE,
        erreur: i.erreur || null,
        enCours: enTrain,
        source: lireSource()
      };
    },
    tr: M
  };

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', function () { demarrer(); });
  } else {
    setTimeout(demarrer, 0);
  }

})();
