/* ============================================================================
   AGENDA PRO — app/sync/sync.js
   LA BRIQUE « SYNCHRONISATION », COTE NAVIGATEUR.
   ----------------------------------------------------------------------------
   A QUOI SERT CE FICHIER, EN UNE PHRASE
   -------------------------------------
   Il fait circuler le travail de l'artisan entre son telephone, son bureau et
   le nuage, SANS jamais empecher l'application de fonctionner quand il n'y a
   pas de reseau.

   LA REGLE QUI PASSE AVANT TOUTES LES AUTRES
   ------------------------------------------
   Si Supabase est injoignable, mal configure, ou si personne n'est connecte,
   ce fichier NE FAIT RIEN. Pas d'erreur rouge, pas d'ecran bloque : Agenda Pro
   continue de tourner sur localStorage, exactement comme avant. Tout ce qui
   suit est ecrit dans cet esprit : chaque acces reseau est enveloppe, chaque
   lecture de localStorage est enveloppee, et la moindre panne fait retomber
   l'application en mode « local » au lieu de la casser.

   CE QUE CE FICHIER PUBLIE (et rien d'autre dans le global)
   ---------------------------------------------------------
     AP.sync.init()              demarre la brique (a appeler une fois)
     AP.sync.bind(pont)          relie la brique aux variables de index.html
     AP.sync.connectGoogle()     branche l'agenda Google du client
     AP.sync.runNow()            declenche une synchronisation Google
     AP.sync.push(...)           enregistre une ecriture (file d'attente incluse)
     AP.sync.setStatus/Note/...  raccourcis metier prets a l'emploi
     AP.sync.pull()              rattrapage manuel depuis le nuage
     AP.sync.conflicts()         journal des conflits, lisible par l'humain
     AP.sync.info()              etat courant, pour l'ecran de reglages
     AP.sync.migrate             rempli par app/sync/migrate.js

   POURQUOI UN « PONT » (AP.sync.bind) ?
   -------------------------------------
   Dans index.html, `store` et `state` sont declares avec `let` au premier
   niveau d'un <script>. Contrairement a `var`, un `let` de premier niveau
   n'est PAS accessible depuis un autre fichier : il n'existe pas sur `window`.
   Aucun contournement propre n'existe. index.html doit donc nous tendre la
   main une fois, avec AP.sync.bind({...}). Sans ce pont, la brique continue de
   fonctionner (file d'attente, envois, temps reel) mais ne peut pas rafraichir
   l'affichage : c'est une degradation, jamais une panne.
   ============================================================================ */

(function () {
  'use strict';

  var AP  = (window.AP = window.AP || {});
  var CFG = window.AP_CONFIG || {};

  /* ==========================================================================
     0. DICTIONNAIRE BILINGUE
     --------------------------------------------------------------------------
     Chaque texte visible existe en arabe et en francais. La langue affichee
     suit document.documentElement.lang, que index.html met deja a jour quand
     l'utilisateur bascule AR / FR : on n'a donc aucun interrupteur a ajouter.
     ========================================================================== */
  var TXT = {
    modeLocal:    { ar: 'محلي — العمل محفوظ على هذا الجهاز',        fr: 'Local — travail enregistré sur cet appareil' },
    modeLive:     { ar: 'متصل — المزامنة فورية',                    fr: 'Connecté — synchronisation immédiate' },
    modeOffline:  { ar: 'بدون شبكة — سيُرسل عند العودة',            fr: 'Sans réseau — envoi à la reconnexion' },
    modeSync:     { ar: 'جارٍ المزامنة…',                           fr: 'Synchronisation en cours…' },
    modeError:    { ar: 'تعذّرت المزامنة',                          fr: 'Synchronisation impossible' },
    queued:       { ar: 'في الانتظار: %n تعديل',                    fr: '%n modification(s) en attente' },
    queueSent:    { ar: 'تم إرسال كل التعديلات',                    fr: 'Toutes les modifications sont parties' },
    queueBlocked: { ar: 'تعديل مرفوض — انظر السجل',                 fr: 'Une modification a été refusée — voir le journal' },
    noAccess:     { ar: 'الاشتراك منتهٍ: القراءة متاحة، الكتابة لا', fr: 'Abonnement expiré : lecture possible, écriture refusée' },
    sessionOld:   { ar: 'انتهت الجلسة — أعد الاتصال',               fr: 'Session expirée — reconnectez-vous' },
    gConnect:     { ar: 'ربط تقويم Google',                         fr: 'Connecter Google Agenda' },
    gConnecting:  { ar: 'جارٍ فتح صفحة Google…',                    fr: 'Ouverture de la page Google…' },
    gFinishing:   { ar: 'جارٍ إنهاء ربط Google…',                   fr: 'Finalisation de la connexion Google…' },
    gOk:          { ar: 'تم ربط تقويم Google',                      fr: 'Google Agenda est connecté' },
    gFail:        { ar: 'فشل ربط Google',                           fr: 'Échec de la connexion Google' },
    /* Les echecs du retour de Google, un par un. Un message vague (« echec »)
       laisse l'artisan sans rien a faire ; chacun de ceux-ci dit ce qui s'est
       passe ET quoi tenter ensuite. */
    gDenied:      { ar: 'تم رفض إذن Google',                        fr: 'Autorisation Google refusée' },
    gStateBad:    { ar: 'انتهت صلاحية الطلب — أعد المحاولة',        fr: 'Demande expirée ou invalide — recommencez' },
    gNonceLost:   { ar: 'هذا المتصفح لا يعرف هذا الربط — أعده من هنا', fr: 'Ce navigateur ne reconnaît pas ce branchement — recommencez depuis cet appareil' },
    gRefused:     { ar: 'رفض الخادم إنهاء الربط — أعد المحاولة',    fr: 'Le serveur a refusé de finaliser — recommencez' },
    gConfig:      { ar: 'إعداد Google ناقص على الخادم',             fr: 'Configuration Google incomplète côté serveur' },
    gNoStore:     { ar: 'تخزين المتصفح مقفل — تعذّر ربط Google',    fr: 'Stockage du navigateur bloqué — connexion Google impossible' },
    gRevoked:     { ar: 'أُلغي إذن Google — أعد الربط',             fr: 'Autorisation Google retirée — reconnectez' },
    syncDone:     { ar: 'تمت المزامنة: %n عنصر',                    fr: 'Synchronisation terminée : %n élément(s)' },
    syncFail:     { ar: 'تعذّرت مزامنة Google',                     fr: 'La synchronisation Google a échoué' },
    conflict:     { ar: 'تعارض: نسخة أحدث موجودة في السحابة',       fr: 'Conflit : une version plus récente existait dans le nuage' },
    conflictKept: { ar: 'احتفظنا بنسختك القديمة في السجل',          fr: 'Votre version a été conservée dans le journal' },
    clockSkew:    { ar: 'ساعة الجهاز غير مضبوطة — قد يسوء الترتيب', fr: "L'horloge de l'appareil est décalée — l'ordre peut être faussé" },
    notLogged:    { ar: 'غير متصل بحساب',                           fr: 'Aucun compte connecté' }
  };

  function lang() {
    var l = (document.documentElement.getAttribute('lang') || 'ar').slice(0, 2).toLowerCase();
    return l === 'fr' ? 'fr' : 'ar';
  }
  function tr(key, vars) {
    var e = TXT[key];
    var s = e ? (e[lang()] || e.fr || e.ar) : key;
    if (vars) { for (var k in vars) if (Object.prototype.hasOwnProperty.call(vars, k)) s = s.split('%' + k).join(vars[k]); }
    return s;
  }

  /* ==========================================================================
     1. RANGEMENT LOCAL
     --------------------------------------------------------------------------
     Tout ce que la brique retient vit dans localStorage, a cote du « store »
     de l'application. Chaque cle est prefixee comme l'existant (agendapro_v1_)
     pour qu'une sauvegarde manuelle du navigateur emporte tout d'un bloc.
     ========================================================================== */
  var K = {
    map:       'agendapro_v1_syncmap',    // correspondance identifiant local <-> identifiant nuage
    queue:     'agendapro_v1_queue',      // ecritures en attente de reseau
    parked:    'agendapro_v1_queue_ko',   // ecritures definitivement refusees
    conflicts: 'agendapro_v1_conflits',   // journal des conflits, pour l'humain
    cursor:    'agendapro_v1_curseur',    // date de la derniere ligne vue par table
    classmap:  'agendapro_v1_classement',  // identifiant nuage de section/categorie -> cle locale
    org:       'agendapro_v1_org',        // organisation active (memorisee)
    skew:      'agendapro_v1_decalage'    // decalage horloge appareil / serveur
  };

  function jget(key, fallback) {
    try { var r = localStorage.getItem(key); return r ? JSON.parse(r) : fallback; }
    catch (e) { return fallback; }
  }
  function jset(key, value) {
    try { localStorage.setItem(key, JSON.stringify(value)); return true; }
    catch (e) {
      // QuotaExceededError, navigation privee, stockage bloque… On ne casse pas
      // l'application pour autant : on perd la memoire, pas les donnees en cours.
      warn('ecriture localStorage impossible (' + key + ') : ' + (e && e.message));
      return false;
    }
  }

  function warn(msg) { try { console.warn('[AP.sync] ' + msg); } catch (e) {} }
  function info(msg) { try { console.info('[AP.sync] ' + msg); } catch (e) {} }

  /* ==========================================================================
     2. ETAT INTERNE
     ========================================================================== */
  var S = {
    mode:     'local',   // 'local' (hors nuage) | 'cloud'
    net:      true,      // reseau vu par le navigateur
    link:     'closed',  // etat du canal temps reel
    orgId:    null,
    userId:   null,
    busy:     false,     // un envoi de file est deja en cours
    retry:    0,         // compteur de tentatives de reconnexion
    timer:    null,
    channel:  null,
    lastErr:  null,
    skew:     0          // millisecondes a ajouter a Date.now() pour parler « heure serveur »
  };

  /* Le pont vers index.html. Tout est facultatif : la brique verifie avant
     chaque usage. */
  var B = { store: null, state: null, lsSet: null, buildTasks: null, render: null, toast: null,
            TASKS: null, SUBS: null,
            /* rebuildBoards : mergeSubs() + buildBoardsDOM() + applyI18n() +
               applyPanels() + render(), c'est-a-dire tout ce qu'il faut pour
               qu'une section ou une categorie arrivee du compte devienne
               VISIBLE. Sans lui, store.sections se remplit et l'ecran ne bouge
               pas. */
            rebuildBoards: null };

  function say(msg) {
    // Message a l'utilisateur : on emprunte le bandeau « toast » existant.
    if (typeof B.toast === 'function') { try { B.toast(msg); return; } catch (e) {} }
    if (typeof window.toast === 'function') { try { window.toast(msg); return; } catch (e) {} }
    info(msg);
  }

  /* Rafraichissement de l'ecran, groupe : dix changements temps reel qui
     arrivent en rafale ne doivent pas provoquer dix redessins. */
  var paintTimer = null;
  function repaint() {
    if (paintTimer) return;
    paintTimer = setTimeout(function () {
      paintTimer = null;
      try { if (typeof B.lsSet === 'function') B.lsSet(); } catch (e) {}
      try { if (typeof B.buildTasks === 'function') B.buildTasks(); } catch (e) {}
      try { if (typeof B.render === 'function') B.render(); } catch (e) {}
      emit('paint', {});
    }, 60);
  }

  /* Petit bus d'evenements : l'interface (AP.ui) peut s'y abonner pour afficher
     une pastille d'etat, sans que cette brique connaisse le HTML. */
  var subs = {};
  function on(evt, fn) { (subs[evt] = subs[evt] || []).push(fn); return function () { off(evt, fn); }; }
  function off(evt, fn) { var a = subs[evt] || []; var i = a.indexOf(fn); if (i >= 0) a.splice(i, 1); }
  function emit(evt, data) {
    (subs[evt] || []).forEach(function (fn) { try { fn(data); } catch (e) { warn('abonne ' + evt + ' : ' + e.message); } });
    (subs['*'] || []).forEach(function (fn) { try { fn(evt, data); } catch (e) {} });
  }

  /* ==========================================================================
     3. ACCES AU CLIENT SUPABASE
     --------------------------------------------------------------------------
     On n'en cree JAMAIS un second : app/supabase-client.js en publie un seul,
     window.AP.sb. Si ce fichier n'est pas charge, ou si config.js est vide,
     sb() renvoie null et toute la brique reste silencieusement en mode local.
     ========================================================================== */
  function sb() { return (window.AP && window.AP.sb) || null; }

  function haveCloud() { return !!(sb() && CFG.supabaseUrl && CFG.supabaseAnonKey); }

  async function session() {
    var c = sb(); if (!c) return null;
    try {
      var r = await c.auth.getSession();
      return (r && r.data && r.data.session) || null;
    } catch (e) { return null; }
  }

  /* L'organisation active. La brique COMPTES (AP.auth) est la source de
     verite ; on garde une copie locale pour le cas ou elle n'est pas chargee. */
  function orgId() {
    if (AP.auth) {
      try {
        if (typeof AP.auth.orgId === 'function') { var v = AP.auth.orgId(); if (v) return v; }
        if (AP.auth.org && AP.auth.org.id) return AP.auth.org.id;
        if (AP.auth.state && AP.auth.state.orgId) return AP.auth.state.orgId;
      } catch (e) {}
    }
    return jget(K.org, null);
  }

  /* ==========================================================================
     4. HORLOGE : LE DECALAGE ENTRE L'APPAREIL ET LE SERVEUR
     --------------------------------------------------------------------------
     Toute la resolution de conflit compare « quand j'ai tape » avec « quand le
     serveur a enregistre ». Si l'horloge du telephone retarde de trois heures,
     toutes ses modifications paraissent vieilles et perdent systematiquement.
     On mesure donc le decalage a chaque reponse du serveur qui porte une date,
     et on l'ajoute a nos horodatages avant toute comparaison.
     ========================================================================== */
  S.skew = Number(jget(K.skew, 0)) || 0;

  function noteServerTime(isoString) {
    if (!isoString) return;
    var t = Date.parse(isoString);
    if (!t) return;
    var d = t - Date.now();
    // Moyenne glissante : une mesure isolee peut etre faussee par la latence.
    S.skew = Math.round(S.skew * 0.7 + d * 0.3);
    jset(K.skew, S.skew);
    if (Math.abs(S.skew) > 120000) warn(tr('clockSkew') + ' (' + Math.round(S.skew / 1000) + ' s)');
  }
  function nowServer() { return Date.now() + S.skew; }

  /* ==========================================================================
     5. CORRESPONDANCE DES IDENTIFIANTS
     --------------------------------------------------------------------------
     L'application locale nomme ses taches « p|permis|2026-03-01 », « f|12|… »
     ou « c3 ». Le nuage, lui, n'accepte que des uuid. On garde donc les deux
     sens de la traduction. Cette table est ecrite par migrate.js a la
     premiere connexion, puis entretenue ici.
     ========================================================================== */
  var MAP = jget(K.map, null) || { toCloud: {}, toLocal: {} };

  function saveMap() { jset(K.map, MAP); }
  function cloudIdOf(localId) { return MAP.toCloud[localId] || null; }
  function localIdOf(cloudId) { return MAP.toLocal[cloudId] || null; }
  function link(localId, cloudId) {
    if (!localId || !cloudId) return;
    MAP.toCloud[localId] = cloudId;
    MAP.toLocal[cloudId] = localId;
    saveMap();
  }

  /* --------------------------------------------------------------------------
     uuid déterministe : le meme identifiant local donne TOUJOURS le meme uuid.
     C'est ce qui rend la migration rejouable sans creer de doublons : reinserer
     la meme tache echoue sur la cle primaire, et on ignore proprement.
     On suit la recette officielle de l'uuid « version 5 » (SHA-1 du couple
     espace-de-noms + nom). Si le navigateur ne fournit pas crypto.subtle
     (page ouverte en file:// par exemple), on retombe sur un brassage simple :
     moins solide contre les collisions volontaires, mais ici personne
     n'essaie de nous attaquer avec son propre identifiant de tache.
     -------------------------------------------------------------------------- */
  function hexToBytes(h) {
    var out = []; h = h.replace(/-/g, '');
    for (var i = 0; i < h.length; i += 2) out.push(parseInt(h.substr(i, 2), 16));
    return out;
  }
  function bytesToUuid(b) {
    var h = [];
    for (var i = 0; i < 16; i++) { var s = b[i].toString(16); h.push(s.length === 1 ? '0' + s : s); }
    return h.slice(0, 4).join('') + '-' + h.slice(4, 6).join('') + '-' + h.slice(6, 8).join('') +
           '-' + h.slice(8, 10).join('') + '-' + h.slice(10, 16).join('');
  }
  async function uuid5(namespaceUuid, name) {
    var nameBytes = new TextEncoder().encode(String(name));
    var nsBytes = hexToBytes(namespaceUuid);
    var buf = new Uint8Array(nsBytes.length + nameBytes.length);
    buf.set(nsBytes, 0); buf.set(nameBytes, nsBytes.length);
    var b;
    if (window.crypto && window.crypto.subtle && window.crypto.subtle.digest) {
      var d = await window.crypto.subtle.digest('SHA-1', buf);
      b = Array.prototype.slice.call(new Uint8Array(d), 0, 16);
    } else {
      b = weakDigest16(buf);
    }
    b[6] = (b[6] & 0x0f) | 0x50;   // version 5
    b[8] = (b[8] & 0x3f) | 0x80;   // variante RFC 4122
    return bytesToUuid(b);
  }
  function weakDigest16(bytes) {
    // Quatre compteurs FNV-1a decales : suffisant pour fabriquer 16 octets
    // stables a partir d'une chaine, sans dependance externe.
    var out = [], seeds = [0x811c9dc5, 0x01000193, 0x9e3779b9, 0x85ebca6b];
    for (var s = 0; s < 4; s++) {
      var h = seeds[s] >>> 0;
      for (var i = 0; i < bytes.length; i++) { h ^= bytes[i]; h = Math.imul(h, 16777619) >>> 0; }
      out.push((h >>> 24) & 255, (h >>> 16) & 255, (h >>> 8) & 255, h & 255);
    }
    return out;
  }

  /* ==========================================================================
     6. TRADUCTION DES STATUTS
     --------------------------------------------------------------------------
     L'application locale connait : done, waiting, postponed, overdue (et
     « rien », qui veut dire « a faire »). La base, elle, impose une liste
     fermee : todo, doing, blocked, done, canceled.
     La correspondance ci-dessous n'est pas bijective (waiting et postponed
     tombent tous deux sur « blocked »). Pour ne RIEN perdre, on range la
     valeur locale exacte dans une entree reservee de la check-list, marquee
     ap_meta, que l'interface ne montre jamais. Au retour, cette entree est
     prioritaire : l'aller-retour est donc fidele au mot pres.
     ========================================================================== */
  var META_ID = '__ap';
  var UP = { done: 'done', waiting: 'blocked', postponed: 'blocked', overdue: 'doing', pending: 'todo', passed: 'canceled' };
  var DOWN = { done: 'done', blocked: 'waiting', doing: 'overdue', todo: null, canceled: 'postponed' };

  function metaEntry(localStatus, localId) {
    return {
      id: META_ID, ap_meta: true, done: false,
      label_ar: '(بيانات داخلية — لا تُعرض)', label_fr: '(donnée interne — non affichée)',
      local_status: localStatus || null, local_id: localId || null
    };
  }
  function isMeta(x) { return !!(x && (x.ap_meta === true || x.id === META_ID)); }

  /* ==========================================================================
     7. LA FILE D'ATTENTE HORS LIGNE
     --------------------------------------------------------------------------
     Principe : on n'ecrit JAMAIS directement dans le nuage depuis l'interface.
     On depose l'ecriture dans une file rangee dans localStorage, puis on tente
     de la vider. Sans reseau, la file gonfle ; au retour du reseau, elle se
     vide dans l'ordre. L'utilisateur n'a rien a faire, et rien n'est perdu si
     le navigateur est ferme entre-temps.

     Chaque entree porte un horodatage PAR CHAMP (ts). C'est lui qui permet la
     resolution de conflit « dernier ecrivain gagne, champ par champ ».
     ========================================================================== */
  function loadQueue() { var q = jget(K.queue, []); return Array.isArray(q) ? q : []; }
  function saveQueue(q) { jset(K.queue, q); emit('queue', { pending: q.length }); }

  function park(entry, reason) {
    var p = jget(K.parked, []); if (!Array.isArray(p)) p = [];
    entry.parkedAt = new Date().toISOString();
    entry.reason = reason || entry.lastError || '?';
    p.push(entry);
    if (p.length > 200) p = p.slice(-200);
    jset(K.parked, p);
    say(tr('queueBlocked'));
    emit('parked', { entry: entry });
  }

  /* push() est LE point d'entree de toute ecriture.
     table  : 'tasks' | 'task_state' | 'sections' | 'categories'
     op     : 'insert' | 'update' | 'delete'
     key    : { id: uuid } ou { task_id: uuid }
     patch  : les champs a ecrire
     Retour : rien. L'ecriture est acquittee plus tard, c'est volontaire :
              l'interface ne doit jamais attendre le reseau. */
  function push(table, op, key, patch, opts) {
    opts = opts || {};
    var at = nowServer();
    var ts = {};
    Object.keys(patch || {}).forEach(function (f) { ts[f] = at; });
    var entry = {
      qid: 'q' + at + '_' + Math.random().toString(36).slice(2, 8),
      table: table, op: op, key: key || {}, patch: patch || {}, ts: ts, at: at,
      org: orgId(), tries: 0, lastError: null, soft: !!opts.soft
    };
    if (S.mode !== 'cloud') return entry;      // hors nuage : on n'accumule rien
    var q = loadQueue(); q.push(entry); saveQueue(q);
    flush();
    return entry;
  }

  /* Vidage de la file. Deux garde-fous :
       - on traite DANS L'ORDRE et on s'arrete a la premiere erreur reseau,
         sinon une creation pourrait partir apres la modification qui la suit ;
       - une entree qui echoue huit fois pour une raison definitive (droits,
         abonnement expire) est mise de cote au lieu de bloquer tout le monde. */
  async function flush() {
    if (S.busy || S.mode !== 'cloud' || !S.net) return;
    var c = sb(); if (!c) return;
    S.busy = true;
    try {
      var q = loadQueue();
      while (q.length) {
        var entry = q[0];
        var verdict;
        try { verdict = await applyOne(entry); }
        catch (e) { verdict = { ok: false, fatal: false, msg: String((e && e.message) || e) }; }

        if (verdict.ok) { q.shift(); saveQueue(q); continue; }

        entry.tries = (entry.tries || 0) + 1;
        entry.lastError = verdict.msg || '?';
        if (verdict.fatal || entry.tries >= 8) { q.shift(); saveQueue(q); park(entry, entry.lastError); continue; }
        saveQueue(q);
        setMode('cloud', 'error');
        break;   // erreur passagere : on reessaiera au prochain reveil
      }
      if (!q.length) emit('queue', { pending: 0 });
    } finally {
      S.busy = false;
      emit('status', info_());
    }
  }

  /* --------------------------------------------------------------------------
     RESOLUTION DE CONFLIT — LA REGLE, ECRITE NOIR SUR BLANC
     --------------------------------------------------------------------------
     REGLE : « dernier ecrivain gagne, CHAMP PAR CHAMP, a l'horodatage. »

     Concretement, quand une modification hors ligne remonte :
       1. on relit la ligne telle qu'elle est dans le nuage ;
       2. pour CHAQUE champ de notre modification, on compare l'heure a
          laquelle l'utilisateur a tape (corrigee du decalage d'horloge) avec
          updated_at de la ligne distante ;
       3. si notre frappe est la plus recente, notre valeur part ;
          sinon on abandonne CE champ, et lui seul ;
       4. la check-list est traitee case par case, pas en bloc ;
       5. toute valeur abandonnee est ecrite dans un journal local
          (AP.sync.conflicts()) : rien n'est detruit en silence.

     Exemple concret. Le patron, sur son telephone, coche « Devis » a 9 h 05.
     Sur le bureau hors ligne, l'employe ecrit une note a 9 h 02 et coche
     « Facture » a 9 h 07. Au retour du reseau : la note de 9 h 02 est plus
     ancienne que la ligne distante (9 h 05) — elle est refusee et journalisee ;
     « Facture » de 9 h 07 est plus recent — la case part ; « Devis » cochee par
     le telephone reste cochee. Resultat : les deux cases sont cochees.

     LES LIMITES, SANS LES CACHER
     ----------------------------
     a) updated_at appartient a la LIGNE, pas au champ. Si le telephone a
        seulement change le statut a 9 h 05, une note de bureau ecrite a 9 h 02
        est quand meme refusee, alors que personne n'avait touche a la note.
        On perd une modification legitime — d'ou le journal, qui permet de la
        remettre en un clic. La seule correction de fond serait une colonne
        d'horodatage par champ dans la base : c'est une migration SQL, pas du
        JavaScript.
     b) Le classement repose sur des horloges. Un telephone regle 3 heures en
        arriere ferait perdre toutes ses modifications. On mesure donc le
        decalage a chaque reponse du serveur et on le compense ; au-dela de
        deux minutes d'ecart on previent dans la console.
     c) Deux modifications dans la MEME seconde ne sont pas departageables :
        Postgres horodate a la microseconde, le navigateur a la milliseconde.
        Dans ce cas, c'est celle qui arrive au serveur en dernier qui gagne.
     d) Un texte libre (une note) ne se fusionne pas : c'est tout l'un ou tout
        l'autre. On ne tente aucune fusion automatique de phrases, qui
        produirait un charabia impossible a relire pour l'artisan.
     e) Une SUPPRESSION gagne toujours sur une modification concurrente : une
        tache effacee ailleurs ne ressuscite pas parce qu'on a corrige son
        titre hors ligne.
     -------------------------------------------------------------------------- */

  function journalConflict(entry, lost) {
    var j = jget(K.conflicts, []); if (!Array.isArray(j)) j = [];
    j.push({
      at: new Date().toISOString(),
      table: entry.table, key: entry.key,
      local_id: entry.key && entry.key.id ? localIdOf(entry.key.id) : null,
      lost: lost
    });
    if (j.length > 300) j = j.slice(-300);
    jset(K.conflicts, j);
    emit('conflict', { table: entry.table, lost: lost });
    say(tr('conflict') + ' — ' + tr('conflictKept'));
  }

  /* Fusion des check-lists, case par case.
     - une case presente des deux cotes : la plus recente decide de son etat ;
     - une case ajoutee chez nous et inconnue du nuage : c'est un AJOUT, jamais
       un conflit, on la garde toujours ;
     - une case presente seulement dans le nuage : quelqu'un l'a ajoutee, on la
       garde aussi. On ne supprime une case que si la suppression est la plus
       recente. */
  function mergeChecklist(cloudList, mineList, mineAt, cloudAt) {
    cloudList = Array.isArray(cloudList) ? cloudList : [];
    mineList  = Array.isArray(mineList)  ? mineList  : [];
    var out = [], seen = {};
    var byIdCloud = {}, byIdMine = {};
    cloudList.forEach(function (x) { if (x && x.id != null) byIdCloud[x.id] = x; });
    mineList.forEach(function (x) { if (x && x.id != null) byIdMine[x.id] = x; });

    cloudList.forEach(function (cx) {
      var id = cx.id; seen[id] = 1;
      var mx = byIdMine[id];
      if (!mx) {
        // Absente chez nous. Suppression volontaire seulement si notre version
        // est la plus recente ; sinon on la conserve.
        if (mineAt >= cloudAt) return;    // on l'a supprimee apres : on la laisse tomber
        out.push(cx); return;
      }
      out.push(mineAt >= cloudAt ? mergeOne(mx, cx) : mergeOne(cx, mx));
    });
    mineList.forEach(function (mx) {
      if (mx && mx.id != null && !seen[mx.id]) out.push(mx);  // ajout pur
    });
    return out;
  }
  function mergeOne(winner, loser) {
    var o = {};
    ['id', 'label_ar', 'label_fr', 'done', 'ap_meta', 'local_status', 'local_id'].forEach(function (f) {
      o[f] = (winner[f] !== undefined ? winner[f] : loser[f]);
    });
    if (o.ap_meta === undefined) delete o.ap_meta;
    if (o.local_status === undefined) delete o.local_status;
    if (o.local_id === undefined) delete o.local_id;
    return o;
  }

  /* Une entree de file, appliquee au nuage. */
  async function applyOne(entry) {
    var c = sb(); if (!c) return { ok: false, fatal: false, msg: 'client absent' };

    if (entry.op === 'delete') {
      var dres = await c.from(entry.table).delete().match(entry.key);
      if (dres.error) return classify(dres.error);
      return { ok: true };
    }

    if (entry.op === 'insert') {
      // ignoreDuplicates : une reinsertion apres coupure ne doit pas echouer.
      // (En SQL : ON CONFLICT DO NOTHING — qui ne reclame AUCUN droit
      //  d'UPDATE, contrairement a un vrai upsert. Le socle 003 a retire les
      //  droits d'UPDATE colonne par colonne : c'est la seule forme qui passe.)
      var conflictCol = entry.table === 'task_state' ? 'task_id'
                      : (entry.table === 'sections' || entry.table === 'categories') ? 'org_id,key' : 'id';
      var ires = await c.from(entry.table).upsert(entry.patch, { onConflict: conflictCol, ignoreDuplicates: true });
      if (ires.error) return classify(ires.error);
      return { ok: true };
    }

    /* --- op === 'update' : c'est ici que se joue la resolution de conflit --- */
    var sel = await c.from(entry.table).select('*').match(entry.key).maybeSingle();
    if (sel.error && sel.error.code !== 'PGRST116') return classify(sel.error);
    var cur = sel.data || null;

    if (!cur) {
      // La ligne n'existe pas (ou plus). Deux cas :
      //  - task_state : normal, l'etat n'a jamais ete cree -> on insere.
      //  - tasks : la tache a ete supprimee ailleurs -> la suppression gagne.
      if (entry.table === 'task_state' && entry.key.task_id) {
        var row = Object.assign({ task_id: entry.key.task_id, org_id: entry.org || orgId() }, entry.patch);
        var r2 = await c.from('task_state').upsert(row, { onConflict: 'task_id', ignoreDuplicates: true });
        if (r2.error) return classify(r2.error);
        return { ok: true };
      }
      return { ok: true };   // rien a faire, ce n'est pas une erreur
    }

    noteServerTime(cur.updated_at);
    var cloudAt = Date.parse(cur.updated_at) || 0;
    var keep = {}, lost = {}, n = 0;

    Object.keys(entry.patch).forEach(function (f) {
      var mineAt = entry.ts[f] || entry.at;
      if (f === 'checklist') { keep[f] = mergeChecklist(cur[f], entry.patch[f], mineAt, cloudAt); n++; return; }
      if (mineAt >= cloudAt) { keep[f] = entry.patch[f]; n++; }
      else if (JSON.stringify(cur[f]) !== JSON.stringify(entry.patch[f])) {
        lost[f] = { mienne: entry.patch[f], nuage: cur[f], quand: new Date(mineAt).toISOString(), nuageQuand: cur.updated_at };
      }
    });

    if (Object.keys(lost).length) journalConflict(entry, lost);
    if (!n) return { ok: true };

    var ures = await c.from(entry.table).update(keep).match(entry.key).select('updated_at').maybeSingle();
    if (ures.error) return classify(ures.error);
    if (ures.data) noteServerTime(ures.data.updated_at);
    return { ok: true };
  }

  /* Traduction d'une erreur PostgREST en decision : « on reessaie » ou
     « inutile d'insister ». C'est ce qui evite une file qui tourne en rond. */
  function classify(err) {
    var code = (err && err.code) || '';
    var msg  = (err && (err.message || err.details)) || String(err);
    // Violations de cle : la ligne existe deja. Une file rejouee deux fois
    // apres une coupure passe par la : c'est un SUCCES, pas une erreur.
    if (code === '23505') return { ok: true };
    // Droits refuses par la RLS : abonnement expire, session revoquee, role
    // insuffisant. Reessayer cent fois ne changera rien.
    if (code === '42501' || code === 'PGRST301' || /row-level security/i.test(msg)) {
      S.lastErr = msg;
      say(/abonnement|org_has_access|access/i.test(msg) ? tr('noAccess') : tr('sessionOld'));
      return { ok: false, fatal: true, msg: msg };
    }
    // Colonne interdite au navigateur (le socle 003 en a retire beaucoup) :
    // c'est un bogue de notre cote, inutile de le rejouer. Le message est
    // explicite, on le laisse remonter tel quel dans le journal.
    if (/permission denied for (column|table|relation)/i.test(msg)) return { ok: false, fatal: true, msg: msg };
    // Contrainte metier (CHECK, longueur, format) : la donnee est mauvaise.
    if (code && code.charAt(0) === '2' && code !== '23505') return { ok: false, fatal: true, msg: msg };
    // Tout le reste (reseau, 5xx, delai depasse) : on reessaiera.
    return { ok: false, fatal: false, msg: msg };
  }

  /* ==========================================================================
     8. RACCOURCIS METIER
     --------------------------------------------------------------------------
     index.html n'a pas a connaitre la forme des lignes de la base. Il appelle
     ces trois fonctions avec SES identifiants a lui, et la brique traduit.
     Chacune est sans effet si l'on n'est pas dans le nuage : c'est ce qui
     garantit que le mode hors ligne reste identique a l'existant.
     ========================================================================== */
  function setStatus(localTaskId, localStatus) {
    if (S.mode !== 'cloud') return;
    var id = cloudIdOf(localTaskId); if (!id) return;
    var st = localStatus ? (UP[localStatus] || 'todo') : 'todo';
    var patch = { status: st, completed_at: st === 'done' ? new Date(nowServer()).toISOString() : null };
    // On glisse la valeur locale exacte dans l'entree reservee de la check-list.
    patch.checklist = withMeta(localTaskId, localStatus);
    push('task_state', 'update', { task_id: id }, patch);
  }

  function setNote(localTaskId, text) {
    if (S.mode !== 'cloud') return;
    var id = cloudIdOf(localTaskId); if (!id) return;
    push('task_state', 'update', { task_id: id }, { notes: String(text == null ? '' : text).slice(0, 20000) });
  }

  function setChecklist(localTaskId, list, doneKeys) {
    if (S.mode !== 'cloud') return;
    var id = cloudIdOf(localTaskId); if (!id) return;
    var done = doneKeys || [];
    var arr = (list || []).map(function (label, i) {
      var key = (typeof label === 'object' && label) ? (label.id || String(i)) : String(label);
      var txt = (typeof label === 'object' && label) ? (label.label_fr || label.label_ar || '') : String(label);
      return { id: key, label_ar: txt, label_fr: txt, done: done.indexOf(key) >= 0 };
    });
    var meta = currentMeta(localTaskId);
    if (meta) arr.push(meta);
    var total = arr.filter(function (x) { return !isMeta(x); }).length;
    var nd = arr.filter(function (x) { return !isMeta(x) && x.done; }).length;
    push('task_state', 'update', { task_id: id }, {
      checklist: arr,
      progress: total ? Math.round(nd * 100 / total) : 0
    });
  }

  function setTaskFields(localTaskId, fields) {
    if (S.mode !== 'cloud') return;
    var id = cloudIdOf(localTaskId); if (!id) return;
    // On ne laisse partir QUE les colonnes que le socle 003 autorise au
    // navigateur : toute autre provoquerait « permission denied for column ».
    var allowed = ['section_id', 'category_id', 'title', 'description', 'location', 'contact_name',
                   'contact_phone', 'starts_at', 'ends_at', 'all_day', 'due_at', 'recurrence_rule',
                   'assigned_to', 'deleted_at'];
    var patch = {};
    Object.keys(fields || {}).forEach(function (f) { if (allowed.indexOf(f) >= 0) patch[f] = fields[f]; });
    if (!Object.keys(patch).length) return;
    push('tasks', 'update', { id: id }, patch);
  }

  function deleteTask(localTaskId) {
    if (S.mode !== 'cloud') return;
    var id = cloudIdOf(localTaskId); if (!id) return;
    // Suppression douce : on pose deleted_at. La vraie suppression est
    // reservee aux responsables et detruirait l'historique de travail.
    push('tasks', 'update', { id: id }, { deleted_at: new Date(nowServer()).toISOString() });
  }

  function withMeta(localTaskId, localStatus) {
    var list = readLocalChecklistForCloud(localTaskId);
    list = list.filter(function (x) { return !isMeta(x); });
    list.push(metaEntry(localStatus, localTaskId));
    return list;
  }
  function currentMeta(localTaskId) {
    var st = null;
    try { if (B.store && B.store.status) st = B.store.status[localTaskId] || null; } catch (e) {}
    return metaEntry(st, localTaskId);
  }
  function readLocalChecklistForCloud(localTaskId) {
    try {
      var c = B.store && B.store.checks && B.store.checks[localTaskId];
      if (!c || !c.list) return [];
      var done = c.done || [];
      return c.list.map(function (label, i) {
        var key = String(label);
        return { id: key, label_ar: key, label_fr: key, done: done.indexOf(key) >= 0 };
      });
    } catch (e) { return []; }
  }

  /* ==========================================================================
     9. LE TEMPS REEL
     --------------------------------------------------------------------------
     On s'abonne aux changements de deux tables seulement : tasks (le contenu)
     et task_state (le travail de l'utilisateur). Le filtre org_id garantit
     qu'on ne recoit que son organisation — et la RLS le garantit une seconde
     fois du cote serveur, ce qui est la vraie barriere.

     POINT CAPITAL, SOUVENT OUBLIE : le temps reel NE REJOUE PAS ce qui s'est
     passe pendant la coupure. Apres chaque (re)connexion il faut donc aller
     chercher soi-meme les lignes modifiees depuis la derniere fois. C'est le
     role de catchUp(). Sans lui, un telephone reste avec des donnees vieilles
     de plusieurs heures sans que rien ne le signale.
     ========================================================================== */
  function stopRealtime() {
    if (S.timer) { clearTimeout(S.timer); S.timer = null; }
    var c = sb();
    if (S.channel && c) { try { c.removeChannel(S.channel); } catch (e) {} }
    S.channel = null; S.link = 'closed';
  }

  function startRealtime() {
    var c = sb();
    if (!c || !S.orgId || S.mode !== 'cloud') return;
    stopRealtime();
    var ch = c.channel('ap-org-' + S.orgId);
    ['tasks', 'task_state'].forEach(function (table) {
      ch.on('postgres_changes',
            { event: '*', schema: 'public', table: table, filter: 'org_id=eq.' + S.orgId },
            function (payload) { onRemote(table, payload); });
    });
    ch.subscribe(function (status) {
      S.link = status;
      if (status === 'SUBSCRIBED') {
        S.retry = 0;
        setMode('cloud', 'live');
        catchUp();     // rattrapage de ce qui a bouge pendant la coupure
        flush();       // et envoi de ce qui attendait
      } else if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT' || status === 'CLOSED') {
        setMode('cloud', 'error');
        scheduleReconnect();
      }
      emit('status', info_());
    });
    S.channel = ch;
  }

  /* Reconnexion : on rallonge l'attente a chaque echec (1 s, 2 s, 4 s… 30 s max)
     avec un grain de hasard, pour que cent telephones qui perdent le reseau en
     meme temps ne reviennent pas tous a la meme seconde. */
  function scheduleReconnect() {
    if (S.timer) return;
    var wait = Math.min(30000, 1000 * Math.pow(2, Math.min(S.retry, 5))) + Math.floor(Math.random() * 700);
    S.retry++;
    info('reconnexion dans ' + Math.round(wait / 1000) + ' s');
    S.timer = setTimeout(function () {
      S.timer = null;
      if (navigator.onLine) startRealtime(); else scheduleReconnect();
    }, wait);
  }

  function onRemote(table, payload) {
    try {
      var evt = payload.eventType || payload.type;
      var row = payload['new'] && Object.keys(payload['new']).length ? payload['new'] : payload.old;
      if (!row) return;
      noteServerTime(row.updated_at);
      bumpCursor(table, row.updated_at);
      if (evt === 'DELETE') { applyDeletion(table, payload.old); }
      else if (table === 'tasks') applyTaskRow(row);
      else if (table === 'task_state') applyStateRow(row);
      repaint();
    } catch (e) { warn('changement distant ignore : ' + e.message); }
  }

  /* ==========================================================================
     10. RATTRAPAGE (catch-up)
     --------------------------------------------------------------------------
     On retient, par table, la date de la ligne la plus recente deja vue. Au
     retour du reseau on demande tout ce qui est plus recent, page par page.
     ========================================================================== */
  function cursors() { var c = jget(K.cursor, {}); return (c && typeof c === 'object') ? c : {}; }
  function bumpCursor(table, iso) {
    if (!iso) return;
    var c = cursors();
    if (!c[table] || iso > c[table]) { c[table] = iso; jset(K.cursor, c); }
  }

  /* L'ORDRE DES TABLES N'EST PAS DECORATIF.
     sections et categories descendent AVANT tasks, pour deux raisons :
       1. une tache porte un section_id et un category_id : sans la table des
          sections deja lue, on ne sait pas dans quelle carte la ranger, et
          elle tombe dans la section par defaut (c'est le defaut qui faisait
          que l'artisan retrouvait ses taches « sans place ») ;
       2. buildBoardsDOM() dessine une carte par section : les cartes doivent
          exister avant que les taches n'y soient reparties.
     task_state passe en dernier : un etat ne veut rien dire sans sa tache. */
  var CATCHUP_TABLES = ['sections', 'categories', 'tasks', 'task_state'];

  function applyRow(table, row) {
    if (table === 'sections')        applySectionRow(row);
    else if (table === 'categories') applyCategoryRow(row);
    else if (table === 'tasks')      applyTaskRow(row);
    else                             applyStateRow(row);
  }

  /* ==========================================================================
     LA PAGINATION DU RATTRAPAGE — POURQUOI ELLE EST ECRITE AINSI
     --------------------------------------------------------------------------
     Il y a deux facons de parcourir un grand resultat, et la version
     precedente les MELANGEAIT : elle repoussait le curseur « since » a la date
     de la derniere ligne recue ET incrementait le decalage « offset » au meme
     tour de boucle. Le second appel repartait donc d'un ensemble deja reduit
     aux lignes restantes, mais en sautant ses 500 premieres : sur un compte de
     777 taches, un appareil neuf recevait 500 lignes puis 0, et il fallait une
     seconde connexion pour voir le reste. Un seul des deux doit bouger.

     CHOIX RETENU : le curseur reste FIXE pendant tout le parcours d'une table,
     et seul le decalage avance. Le curseur n'est repousse qu'UNE fois, a la
     fin, quand la table entiere est passee.

     Pourquoi pas l'inverse (avancer « since » seul, sans decalage) : parce que
     plusieurs lignes peuvent partager la meme milliseconde — c'est le cas des
     lignes creees en lot par le transfert initial, qui en ecrit des centaines
     dans la meme seconde. « plus grand que la derniere date vue » sauterait
     alors toutes les soeurs de cette milliseconde, ou, si l'on utilisait « plus
     grand ou egal », redemanderait eternellement la meme page. Une pagination
     par date seule n'est sure qu'avec une cle secondaire dans la comparaison,
     ce que PostgREST n'exprime pas simplement.

     Ce que le decalage seul exige en revanche, c'est un TRI TOTAL : deux
     lignes de meme updated_at doivent toujours sortir dans le meme ordre d'une
     page a l'autre, sinon une ligne peut etre servie deux fois et une autre
     jamais. D'ou le seconde critere .order('id') : l'identifiant est unique,
     le tri devient sans ex aequo, et le decoupage en pages est exact.

     Le curseur n'est repousse qu'a la fin d'une table lue en entier : si le
     reseau lache au milieu, on ne garde aucun progres partiel et le prochain
     rattrapage recommence la table depuis l'ancien curseur. Reappliquer une
     ligne deja appliquee est sans effet (toutes les fonctions apply* sont
     idempotentes), tandis qu'un curseur avance trop tot ferait manquer des
     lignes pour de bon. Le doute profite donc a la relecture.
     ========================================================================== */
  async function catchUp() {
    var c = sb(); if (!c || !S.orgId) return;
    var cur = cursors();
    var PAGE = 500;
    var MAX_PAGES = 200;          // borne dure : 100 000 lignes par table et par passage
    setMode('cloud', 'sync');
    try {
      for (var i = 0; i < CATCHUP_TABLES.length; i++) {
        var table = CATCHUP_TABLES[i];
        var since = cur[table] || '1970-01-01T00:00:00Z';
        var page = 0;
        var vuMax = null;         // la date la plus recente reellement recue
        var complet = true;
        while (page < MAX_PAGES) {
          var r = await c.from(table).select('*')
                   .eq('org_id', S.orgId)
                   .gt('updated_at', since)          // FIXE pendant tout le parcours
                   .order('updated_at', { ascending: true })
                   .order('id', { ascending: true }) // tri total : pas d'ex aequo
                   .range(page * PAGE, page * PAGE + PAGE - 1);
          if (r.error) {
            // Une table absente (socle plus ancien) ne doit pas faire echouer
            // le reste du rattrapage : on la signale et on passe a la suivante.
            warn('rattrapage ' + table + ' : ' + r.error.message);
            complet = false; break;
          }
          var rows = r.data || [];
          for (var k = 0; k < rows.length; k++) {
            applyRow(table, rows[k]);
            if (rows[k].updated_at && (!vuMax || rows[k].updated_at > vuMax)) vuMax = rows[k].updated_at;
          }
          if (rows.length < PAGE) break;   // derniere page : elle n'est pas pleine
          page++;
          if (page >= MAX_PAGES) {
            warn('rattrapage ' + table + ' : plus de ' + (MAX_PAGES * PAGE)
                 + ' lignes, la suite viendra au prochain passage');
            // Ici on avance quand meme le curseur, sinon le prochain passage
            // relirait indefiniment les memes 100 000 premieres lignes.
            complet = true;
          }
        }
        if (complet && vuMax) bumpCursor(table, vuMax);
      }
      /* On ne reconstruit les cartes QUE si une section ou une categorie a
         reellement bouge : buildBoardsDOM() reecrit tout le bloc des tableaux,
         et le faire a chaque battement de coeur ferait clignoter l'ecran pour
         rien. */
      if (classDirty) { classDirty = false; rebuildBoards(); }
      repaint();
      setMode('cloud', 'live');
    } catch (e) {
      warn('rattrapage interrompu : ' + e.message);
      setMode('cloud', 'error');
    }
  }

  /* ==========================================================================
     11. APPLICATION DES CHANGEMENTS DANS L'INTERFACE, SANS RECHARGEMENT
     --------------------------------------------------------------------------
     On ecrit dans le « store » de index.html, puis on redemande un rendu. Il
     n'y a pas de F5, pas de clignotement : l'application redessine ses bulles
     avec les nouvelles valeurs.

     Deux familles de taches :
       - celles qui existent deja en local (calendrier integre a la page,
         ou tache ajoutee a la main sur cet appareil) : on ne touche qu'a leur
         ETAT (statut, cases, note) ;
       - celles qui n'existent pas ici (creees sur le telephone, ou importees
         de Google par l'Edge Function) : on les materialise dans
         store.custom, la liste des taches manuelles, pour que buildTasks()
         les prenne en compte sans qu'on ait a toucher a son code.

     ---------------------------------------------------------------------------
     LES SECTIONS ET LES CATEGORIES — L'ORGANISATION, PAS SEULEMENT LE CONTENU
     ---------------------------------------------------------------------------
     Le transfert initial les envoie (« sections recus=2 ; categories recus=15 »)
     mais rien ne les faisait redescendre : l'artisan retrouvait ses taches sur
     un appareil neuf, sans les cartes qu'il avait creees, et les taches rangees
     dans une section personnalisee tombaient toutes dans la section par defaut.
     Elles descendent desormais dans le meme rattrapage que les taches, et avant
     elles.

     Deux traductions a faire au passage :
       - le nuage range par IDENTIFIANT (section_id, category_id, des uuid),
         l'application locale par CLE COURTE ('sec1', 'devis'). On garde donc la
         correspondance uuid -> cle locale dans le localStorage, pour que les
         taches qui arriveront plus tard, par le temps reel, sachent encore ou
         se ranger ;
       - les deux sections d'origine existent des les deux cotes : le nuage les
         appelle 'entreprise' et 'personnel' (marquees is_builtin), la page les
         appelle 'ent' et 'perso'. On les rapproche au lieu de les dupliquer.
         Meme chose pour les douze categories d'origine de la page, presentes
         dans la constante SUBS : on ne les recopie pas dans store.subs, sans
         quoi elles deviendraient supprimables et changeraient d'etiquette.
     ========================================================================== */

  /* Les deux sections d'origine, des deux cotes du pont. */
  var SEC_NATIVES = { entreprise: 'ent', personnel: 'perso' };
  /* Icones sentinelles : le socle SQL n'accepte que 16 caracteres et le
     transfert y met un mot quand l'emoji manque. On refait le chemin inverse,
     sinon la carte afficherait le mot « DOSSIER ». */
  var ICONES_REPLI = { DOSSIER: '📁', ETIQUETTE: '🏷️' };

  /* Passe a vrai des qu'une section ou une categorie est creee ou modifiee par
     ce qui redescend du compte. Lu et remis a faux par catchUp(). */
  var classDirty = false;

  function classMap() {
    var m = jget(K.classmap, null);
    if (!m || typeof m !== 'object') m = {};
    if (!m.sec || typeof m.sec !== 'object') m.sec = {};
    if (!m.cat || typeof m.cat !== 'object') m.cat = {};
    return m;
  }
  function classLink(kind, cloudId, localKey) {
    if (!cloudId || !localKey) return;
    var m = classMap();
    if (m[kind][cloudId] === localKey) return;
    m[kind][cloudId] = localKey;
    jset(K.classmap, m);
  }
  function localSectionOf(cloudId) { return cloudId ? (classMap().sec[cloudId] || null) : null; }
  function localCategoryOf(cloudId) { return cloudId ? (classMap().cat[cloudId] || null) : null; }

  /* Les categories d'origine de la page vivent dans la constante SUBS, pas dans
     store.subs. keyify() du transfert a pu changer leur casse ('voyagePro' est
     parti en 'voyagepro') : on compare donc sans tenir compte de la casse, pour
     ne pas fabriquer un doublon de ce qui existe deja. */
  function builtinSubKey(key) {
    var subs = B.SUBS;
    if (!subs || typeof subs !== 'object') return null;
    var bas = String(key || '').toLowerCase();
    var noms = Object.keys(subs);
    for (var i = 0; i < noms.length; i++) {
      if (noms[i].toLowerCase() === bas && !subs[noms[i]].custom) return noms[i];
    }
    return null;
  }

  function applySectionRow(row) {
    if (!B.store || !row || !row.key) return;
    // Section d'origine : deja presente dans la page (SEC_BUILTIN), on ne fait
    // qu'enregistrer la correspondance pour le rangement des taches.
    if (row.is_builtin || SEC_NATIVES[row.key]) {
      classLink('sec', row.id, SEC_NATIVES[row.key] || 'ent');
      return;
    }
    var arr = B.store.sections || (B.store.sections = []);
    var vue = {
      id:  row.key,
      ar:  row.name_ar || row.key,
      fr:  row.name_fr || row.name_ar || row.key,
      ic:  ICONES_REPLI[row.icon] || row.icon || '📁',
      c:   row.color || '#a855f7'
    };
    var trouve = false;
    for (var i = 0; i < arr.length; i++) {
      if (arr[i] && arr[i].id === vue.id) {
        if (arr[i].ar !== vue.ar || arr[i].fr !== vue.fr || arr[i].ic !== vue.ic || arr[i].c !== vue.c) classDirty = true;
        arr[i].ar = vue.ar; arr[i].fr = vue.fr; arr[i].ic = vue.ic; arr[i].c = vue.c; trouve = true; break;
      }
    }
    if (!trouve) { arr.push(vue); classDirty = true; }
    classLink('sec', row.id, vue.id);
  }

  function applyCategoryRow(row) {
    if (!B.store || !row || !row.key) return;
    var natif = builtinSubKey(row.key);
    if (natif) { classLink('cat', row.id, natif); return; }   // categorie d'origine : rien a creer
    var arr = B.store.subs || (B.store.subs = []);
    var vue = {
      id:  row.key,
      ar:  row.name_ar || row.key,
      fr:  row.name_fr || row.name_ar || row.key,
      ic:  ICONES_REPLI[row.icon] || row.icon || '🏷️',
      c:   row.color || '#64748b'
    };
    var trouve = false;
    for (var i = 0; i < arr.length; i++) {
      if (arr[i] && arr[i].id === vue.id) {
        if (arr[i].ar !== vue.ar || arr[i].fr !== vue.fr || arr[i].ic !== vue.ic || arr[i].c !== vue.c) classDirty = true;
        arr[i].ar = vue.ar; arr[i].fr = vue.fr; arr[i].ic = vue.ic; arr[i].c = vue.c; trouve = true; break;
      }
    }
    if (!trouve) { arr.push(vue); classDirty = true; }
    classLink('cat', row.id, vue.id);
  }

  /* Le store ne suffit pas : tant que mergeSubs() et buildBoardsDOM() n'ont pas
     tourne, SUBS ignore les nouvelles categories et aucune carte n'existe pour
     les nouvelles sections. index.html expose ce rappel par le pont ; s'il
     manque (pont d'une version anterieure), on se rabat sur un rendu simple,
     qui au moins ne laisse pas la page dans un etat faux. */
  function rebuildBoards() {
    if (typeof B.rebuildBoards === 'function') {
      try { B.rebuildBoards(); return; } catch (e) { warn('reconstruction des cartes : ' + e.message); }
    }
    try { if (typeof B.render === 'function') B.render(); } catch (e) {}
  }

  function applyTaskRow(row) {
    if (!B.store) return;
    var localId = localIdOf(row.id);

    if (row.deleted_at) {
      if (localId) removeLocalTask(localId);
      return;
    }
    if (!localId) { localId = adoptCloudTask(row); if (!localId) return; }

    // Tache materialisee par nous : on tient ses champs a jour.
    var arr = B.store.custom || (B.store.custom = []);
    for (var i = 0; i < arr.length; i++) {
      if (arr[i].id === localId) {
        arr[i].title = row.title || arr[i].title;
        arr[i].date  = isoDay(row.starts_at || row.due_at) || arr[i].date;
        arr[i].time  = row.all_day ? '' : isoTime(row.starts_at);
        arr[i].notes = row.description || '';
        arr[i].cloud = row.id;
        /* Le classement du nuage fait foi : c'est lui qu'on met a jour quand
           l'artisan deplace une tache (setTaskFields envoie section_id et
           category_id). On ne l'ecrase que si l'on SAIT traduire l'identifiant
           — une section inconnue ici laisse la tache ou elle est plutot que de
           la jeter dans la section par defaut. */
        var sLoc = localSectionOf(row.section_id);
        if (sLoc) arr[i].cat = sLoc;
        var cLoc = localCategoryOf(row.category_id);
        if (cLoc) arr[i].sub = cLoc;
        break;
      }
    }
  }

  function adoptCloudTask(row) {
    if (!B.store) return null;
    var localId = 'cl_' + String(row.id).replace(/-/g, '').slice(0, 12);
    var arr = B.store.custom || (B.store.custom = []);
    if (!arr.some(function (x) { return x.id === localId; })) {
      arr.push({
        id: localId,
        title: row.title || '—',
        // La section du nuage si on sait la traduire (les sections descendent
        // avant les taches, dans le meme rattrapage), sinon la section par
        // defaut comme avant.
        cat:  localSectionOf(row.section_id) || 'ent',
        sub:  localCategoryOf(row.category_id) || (row.source === 'google' ? 'routine' : 'perso'),
        date: isoDay(row.starts_at || row.due_at) || isoDay(new Date().toISOString()),
        time: row.all_day ? '' : isoTime(row.starts_at),
        notes: row.description || '',
        cloud: row.id
      });
    }
    link(localId, row.id);
    return localId;
  }

  function removeLocalTask(localId) {
    if (!B.store) return;
    if (Array.isArray(B.store.custom)) {
      B.store.custom = B.store.custom.filter(function (x) { return x.id !== localId; });
    }
    // On efface aussi l'etat local devenu orphelin, pour ne pas laisser de
    // statut fantome dans le navigateur.
    ['status', 'checks', 'notes', 'cat'].forEach(function (k) {
      try { if (B.store[k]) delete B.store[k][localId]; } catch (e) {}
    });
  }

  function applyStateRow(row) {
    if (!B.store) return;
    var localId = localIdOf(row.task_id);
    var meta = null;
    if (Array.isArray(row.checklist)) {
      for (var i = 0; i < row.checklist.length; i++) if (isMeta(row.checklist[i])) { meta = row.checklist[i]; break; }
    }
    if (!localId && meta && meta.local_id) { localId = meta.local_id; link(localId, row.task_id); }
    if (!localId) return;   // tache pas encore vue ici : elle arrivera par tasks

    // Statut : la valeur locale exacte, si elle a ete conservee, fait autorite.
    var st = (meta && meta.local_status !== undefined) ? meta.local_status : DOWN[row.status];
    B.store.status = B.store.status || {};
    if (st) B.store.status[localId] = st; else delete B.store.status[localId];

    // Note.
    B.store.notes = B.store.notes || {};
    if (row.notes) B.store.notes[localId] = row.notes; else delete B.store.notes[localId];

    // Cases cochees. On retire l'entree technique avant de la donner a
    // l'interface, qui ne doit jamais l'afficher.
    if (Array.isArray(row.checklist)) {
      var visible = row.checklist.filter(function (x) { return !isMeta(x); });
      B.store.checks = B.store.checks || {};
      B.store.checks[localId] = {
        list: visible.map(function (x) { return x.label_fr || x.label_ar || String(x.id); }),
        done: visible.filter(function (x) { return x.done; })
                     .map(function (x) { return x.label_fr || x.label_ar || String(x.id); })
      };
    }
  }

  function applyDeletion(table, oldRow) {
    if (!oldRow) return;
    if (table === 'tasks') {
      var lid = localIdOf(oldRow.id);
      if (lid) { removeLocalTask(lid); delete MAP.toCloud[lid]; delete MAP.toLocal[oldRow.id]; saveMap(); }
    }
  }

  function isoDay(iso) {
    if (!iso) return null;
    var d = new Date(iso); if (isNaN(d)) return null;
    return d.getFullYear() + '-' + pad2(d.getMonth() + 1) + '-' + pad2(d.getDate());
  }
  function isoTime(iso) {
    if (!iso) return '';
    var d = new Date(iso); if (isNaN(d)) return '';
    return pad2(d.getHours()) + ':' + pad2(d.getMinutes());
  }
  function pad2(n) { return String(n).padStart(2, '0'); }

  /* ==========================================================================
     12. GOOGLE — LE CHEMIN EXACT DU REFRESH TOKEN
     --------------------------------------------------------------------------
     C'EST LE POINT LE PLUS SENSIBLE DE TOUTE L'APPLICATION. Le « refresh
     token » Google est une cle permanente : qui le detient lit l'agenda du
     client jusqu'a revocation. Il ne doit JAMAIS exister dans un navigateur,
     ni dans une variable JavaScript, ni dans localStorage, ni dans une URL.

     LE CHEMIN, ETAPE PAR ETAPE (c'est celui qu'on implemente) :

       1. Le navigateur appelle l'Edge Function google-oauth, action « start »,
          avec son jeton Supabase. Il ne transmet aucun secret. La fonction
          repond trois choses : l'adresse de consentement, l'identifiant de la
          ligne `calendars` qu'elle vient de creer, et un NONCE.
       2. LE NAVIGATEUR RANGE CE NONCE DANS SON sessionStorage, sous la cle
          « ap_gcal_nonce », AVANT de partir chez Google. Ce geste minuscule
          est ce qui distingue « un etat que nous avons emis » de « un etat que
          nous avons emis A CE NAVIGATEUR-CI » : voir l'attaque CSRF OAuth
          decrite en tete de edge/google-oauth/index.ts. Si le rangement
          echoue (navigation privee verrouillee, stockage bloque), ON NE PART
          PAS chez Google : le branchement serait refuse au retour, et
          l'artisan aurait consenti pour rien.
       3. L'Edge Function a fabrique l'adresse de consentement Google
          (access_type=offline, prompt=consent) et un jeton d'etat SIGNE qui
          contient l'identifiant de l'utilisateur, celui de l'organisation,
          celui de la ligne `calendars` et le nonce. Le « redirect_uri »
          pointe sur l'EDGE FUNCTION ELLE-MEME, pas sur l'application.
       4. Le navigateur se rend chez Google. L'artisan accepte.
       5. Google renvoie le navigateur sur l'Edge Function avec un « code ».
          Ce code passe donc par le navigateur — c'est inevitable dans le web,
          et sans danger : il est a usage unique et ne vaut rien sans le
          « client secret », qui n'existe que du cote serveur.
          L'EDGE FUNCTION NE DEPOSE RIEN A CE MOMENT-LA : aucune session
          Supabase n'existe sur ce retour, donc elle ne sait pas qui est
          devant l'ecran. Elle se contente de renvoyer le navigateur sur
          l'application avec le FRAGMENT
          « #ap_gcal=finish&ap_code=…&ap_state=… ».
       6. La page relit le nonce dans son sessionStorage et rappelle l'Edge
          Function EN POST ET AVEC SON JETON SUPABASE :
          { action:'finish', code, state, nonce }. Le serveur verifie alors
          quatre choses — signature de l'etat, non-expiration, appelant ===
          state.u, et nonce identique — avant de faire quoi que ce soit.
       7. Alors seulement l'Edge Function echange le code contre le refresh
          token EN SERVEUR A SERVEUR, puis appelle la fonction SQL
          public.calendar_set_refresh_token(), qui range le jeton dans le
          coffre (vault, chiffrement AES-256-GCM) et n'enregistre que le
          numero de casier — dans le schema `private`, hors de portee de
          PostgREST.

     LE REFRESH TOKEN N'A DONC JAMAIS TOUCHE LE NAVIGATEUR. Il naît chez
     Google, voyage vers Deno, et meurt dans le coffre.

     CE QUI TRAVERSE LE NAVIGATEUR, ET OU ON LE RANGE
     ------------------------------------------------
       * le NONCE      -> sessionStorage, et nulle part ailleurs. Il meurt
                          avec l'onglet, ne se partage pas entre onglets, et
                          ne survit pas a la fermeture du navigateur : c'est
                          exactement la duree de vie d'un branchement OAuth.
       * le CODE et l'ETAT -> DANS UNE VARIABLE, LE TEMPS D'UN APPEL. JAMAIS
                          dans localStorage, jamais dans le « store », jamais
                          dans un journal. Ils arrivent par le fragment, sont
                          lus une fois, et le fragment est efface de la barre
                          d'adresse dans la foulee (history.replaceState) pour
                          qu'un simple rechargement ne les rejoue pas.
       * le REFRESH TOKEN -> RIEN. Il n'entre jamais ici.

     POURQUOI PAS signInWithOAuth() DE SUPABASE POUR L'AGENDA ?
     ---------------------------------------------------------
     Parce que Supabase place `provider_token` et `provider_refresh_token`
     DANS LA SESSION du navigateur. C'est pratique, c'est documente, et c'est
     exactement ce que le cahier des charges interdit ici. On garde donc
     signInWithOAuth pour l'IDENTITE (« se connecter avec Google », gere par
     AP.auth), et on utilise le chemin ci-dessus pour l'AGENDA.
     La fonction rescueProviderToken() plus bas existe pour le cas ou la
     connexion aurait malgre tout ete faite avec les portees Calendar : elle
     met le jeton a l'abri au plus vite. C'est un rattrapage, pas le chemin
     recommande — un jeton qui a touche le navigateur doit etre revoque puis
     redemande proprement.
     ========================================================================== */
  function fnUrl(name) {
    var base = (CFG.supabaseUrl || '').replace(/\/+$/, '');
    return base ? base + '/functions/v1/' + name : null;
  }

  /* La cle du nonce. sessionStorage, ET SURTOUT PAS localStorage : le nonce ne
     doit pas survivre a la fermeture du navigateur, ne doit pas etre partage
     avec les autres onglets, et ne doit rien laisser derriere lui si le
     branchement est abandonne en cours de route. Les trois fonctions
     ci-dessous sont enveloppees parce que sessionStorage LEVE une exception —
     il ne renvoie pas null — quand le stockage est refuse (navigation privee
     verrouillee, reglage « bloquer les donnees des sites »). */
  var SS_NONCE = 'ap_gcal_nonce';

  function ssGet(key) { try { return sessionStorage.getItem(key); } catch (e) { return null; } }
  function ssSet(key, value) {
    try {
      sessionStorage.setItem(key, value);
      // On RELIT : certains navigateurs acceptent l'ecriture sans rien garder.
      return sessionStorage.getItem(key) === value;
    } catch (e) {
      warn('sessionStorage indisponible (' + key + ') : ' + (e && e.message));
      return false;
    }
  }
  function ssDel(key) { try { sessionStorage.removeItem(key); } catch (e) {} }

  /* Sortir le VRAI message du serveur (meme piege que dans billing.js) : quand
     une Edge Function repond autre chose qu'un 2xx, la librairie Supabase ne
     remet qu'un « Edge Function returned a non-2xx status code ». Le corps
     utile — et le code HTTP, qui nous dit s'il s'agit d'une session perdue ou
     d'un refus — est range dans e.context. */
  async function detailFn(e) {
    var out = { status: 0, message: String((e && e.message) || ''), raison: '' };
    try {
      var ctx = e && e.context;
      if (ctx) {
        out.status = Number(ctx.status) || 0;
        if (typeof ctx.json === 'function') {
          var b = await ctx.json();
          if (b && b.error)  out.message = String(b.error);
          if (b && b.raison) out.raison  = String(b.raison);
        }
      }
    } catch (x) { /* corps illisible : le message generique fera l'affaire */ }
    return out;
  }

  async function connectGoogle(opts) {
    opts = opts || {};
    var c = sb(); var s = await session();
    if (!c || !s) { say(tr('notLogged')); return false; }
    var org = orgId();
    if (!org) { say(tr('notLogged')); return false; }
    say(tr('gConnecting'));
    try {
      var r = await c.functions.invoke('google-oauth', {
        body: {
          action: 'start',
          org_id: org,
          // Ou revenir une fois le branchement termine.
          return_to: (CFG.siteUrl || location.origin + location.pathname),
          calendar_id: opts.googleCalendarId || 'primary',
          // Lecture seule par defaut : on ne demande jamais plus que necessaire.
          write: !!opts.write
        }
      });
      if (r.error) {
        var d = await detailFn(r.error);
        throw new Error(d.message || 'start refuse');
      }
      var url   = r.data && r.data.url;
      var nonce = r.data && r.data.nonce;
      if (!url) throw new Error('adresse de consentement absente');
      // Sans nonce, l'action « finish » refusera le depot (403) au retour :
      // autant s'arreter ici plutot que d'envoyer l'artisan consentir pour
      // rien. Ce cas signale une Edge Function google-oauth trop ancienne.
      if (!nonce) throw new Error('nonce absent de la reponse « start » : fonction google-oauth a redeployer');

      // LE GESTE QUI LIE LE FLUX A CE NAVIGATEUR. Il a lieu AVANT le depart :
      // une fois parti chez Google, on ne repasse plus par ici.
      if (!ssSet(SS_NONCE, String(nonce))) {
        say(tr('gNoStore'));
        emit('google', { ok: false, raison: 'stockage' });
        return false;
      }

      location.href = url;      // on quitte la page : Google prend la main
      return true;
    } catch (e) {
      ssDel(SS_NONCE);          // rien ne doit trainer apres un depart rate
      warn('connectGoogle : ' + e.message);
      say(tr('gFail'));
      emit('google', { ok: false, raison: 'start', message: e.message });
      return false;
    }
  }

  /* Lecture d'un fragment « a=1&b=2 », a la main.
     Pourquoi pas URLSearchParams ? Parce qu'il traduit un « + » litteral en
     ESPACE. Un code d'autorisation ou un jeton d'etat abime de cette facon
     serait refuse par Google ou par la verification de signature, avec un
     message incomprehensible. decodeURIComponent, lui, ne touche qu'aux
     sequences %XX — exactement ce que l'Edge Function a produit avec
     encodeURIComponent. */
  function readFragment(hash) {
    var out = {};
    String(hash || '').replace(/^#/, '').split('&').forEach(function (pair) {
      if (!pair) return;
      var i = pair.indexOf('=');
      var k = i < 0 ? pair : pair.slice(0, i);
      var v = i < 0 ? ''   : pair.slice(i + 1);
      try { out[decodeURIComponent(k)] = decodeURIComponent(v); }
      catch (e) { out[k] = v; }      // fragment bricole : on garde le brut
    });
    return out;
  }

  /* Effacer le fragment de la barre d'adresse, sans recharger la page et sans
     ajouter une entree dans l'historique (replaceState, pas pushState : le
     bouton « precedent » ne doit pas ramener le code). */
  function cleanUrl() {
    try { history.replaceState(null, '', location.pathname + location.search); }
    catch (e) { warn('nettoyage de l\'adresse impossible : ' + (e && e.message)); }
  }

  /* Au retour de Google la page vient d'etre rechargee : le client Supabase
     peut avoir besoin d'un instant pour relire sa session dans le stockage.
     On lui laisse quelques secondes plutot que d'annoncer un echec a l'artisan
     alors que tout allait bien. */
  async function waitSession(tries, wait) {
    tries = tries || 8; wait = wait || 400;
    for (var i = 0; i < tries; i++) {
      var s = await session();
      if (s) return s;
      await new Promise(function (r) { setTimeout(r, wait); });
    }
    return null;
  }

  /* --------------------------------------------------------------------------
     LE RETOUR DE GOOGLE
     --------------------------------------------------------------------------
     L'application est rechargee avec l'un de ces fragments :
       #ap_gcal=finish&ap_code=…&ap_state=…   le consentement a eu lieu ;
                                              TOUT RESTE A FAIRE, et c'est a
                                              nous de le faire (appel POST
                                              authentifie « finish »).
       #ap_gcal=err&raison=refus|etat|config  l'Edge Function s'est arretee
                                              avant meme de nous rendre la main.

     TROIS REGLES, DANS CET ORDRE :
       1. on lit le code et l'etat EN MEMOIRE, et on n'en fait aucune copie
          persistante — surtout pas dans localStorage ;
       2. on efface le fragment TOUT DE SUITE : un rechargement (F5, retour
          arriere, restauration d'onglet) ne doit jamais rejouer un code deja
          consomme, ni afficher deux fois le meme message ;
       3. quoi qu'il arrive, l'artisan voit un message. Un branchement qui
          echoue en silence, c'est un artisan qui reclique dix fois puis
          telephone.
     -------------------------------------------------------------------------- */
  var fragmentLu = false;

  async function readReturnFragment() {
    var h = location.hash || '';
    if (h.indexOf('ap_gcal=') < 0) return;
    if (fragmentLu) return;          // init() peut nous appeler par deux chemins
    fragmentLu = true;

    var f = readFragment(h);
    var etape = f.ap_gcal || '';

    // Le code et l'etat ne vivront que dans ces deux variables, le temps d'un
    // appel reseau. Rien ne les ecrit nulle part.
    var code  = f.ap_code  || '';
    var state = f.ap_state || '';
    var nonce = ssGet(SS_NONCE);

    cleanUrl();                      // AVANT tout appel reseau : voir regle 2

    /* --- L'Edge Function s'est arretee avant de nous rendre la main -------- */
    if (etape === 'err') {
      ssDel(SS_NONCE);
      var raison = f.raison || '';
      say(raison === 'refus'  ? tr('gDenied')
        : raison === 'etat'   ? tr('gStateBad')
        : raison === 'config' ? tr('gConfig')
        : tr('gFail'));
      warn('retour Google en echec (raison : ' + (raison || 'non precisee') + ')');
      emit('google', { ok: false, raison: raison || 'inconnu' });
      return;
    }

    /* --- Ancien contrat : le depot avait deja eu lieu cote serveur --------- */
    // Ce fragment n'est plus emis par la version durcie de google-oauth. On le
    // tolere le temps d'un deploiement (l'ancienne fonction peut encore etre
    // en ligne), mais on le signale : tant qu'il apparait, la faille CSRF
    // OAuth decrite dans edge/google-oauth/index.ts n'est PAS fermee en
    // production.
    if (etape === 'ok') {
      ssDel(SS_NONCE);
      warn('retour « ap_gcal=ok » : ancienne version de google-oauth encore deployee — a redeployer.');
      say(tr('gOk'));
      emit('google', { ok: true, ancien: true });
      setTimeout(function () { runNow(); }, 800);
      return;
    }

    if (etape !== 'finish') {
      ssDel(SS_NONCE);
      warn('fragment ap_gcal inconnu : « ' + etape + ' »');
      say(tr('gFail'));
      emit('google', { ok: false, raison: 'fragment' });
      return;
    }

    /* --- Nouveau contrat : c'est a nous de finaliser ----------------------- */
    if (!code || !state) {
      ssDel(SS_NONCE);
      warn('retour Google incomplet : ' + (!code ? 'code' : 'etat') + ' absent du fragment.');
      say(tr('gFail'));
      emit('google', { ok: false, raison: 'fragment' });
      return;
    }

    // Pas de nonce : le flux a ete demarre ailleurs (autre onglet, autre
    // appareil, stockage vide entre-temps)… ou bien quelqu'un essaie de nous
    // faire finaliser un branchement que nous n'avons pas demande. Dans les
    // deux cas le serveur refuserait ; on s'arrete ici, en l'expliquant.
    if (!nonce) {
      say(tr('gNonceLost'));
      warn('nonce absent du sessionStorage : branchement non demarre par ce navigateur, ou stockage efface.');
      emit('google', { ok: false, raison: 'nonce' });
      return;
    }

    say(tr('gFinishing'));

    var c = sb();
    var s = c ? await waitSession() : null;
    if (!c || !s) {
      ssDel(SS_NONCE);
      say(c ? tr('sessionOld') : tr('gFail'));
      warn('finalisation impossible : ' + (c ? 'aucune session Supabase au retour de Google.'
                                             : 'client Supabase absent (config.js ou reseau).'));
      emit('google', { ok: false, raison: c ? 'session' : 'client' });
      return;
    }

    // USAGE UNIQUE. Le nonce quitte le stockage AVANT l'appel, et non apres :
    // si l'appel n'aboutit pas (onglet ferme, reseau coupe en plein vol), le
    // code Google est de toute facon consomme ou perdu. Laisser le nonce
    // derriere nous n'aiderait personne et lui donnerait une seconde vie.
    ssDel(SS_NONCE);

    var branche = false, calId = null;
    try {
      var r = await c.functions.invoke('google-oauth', {
        body: { action: 'finish', code: code, state: state, nonce: nonce }
      });
      if (r.error) {
        var d = await detailFn(r.error);
        var e2 = new Error(d.message || 'finish refuse');
        e2.status = d.status; e2.raison = d.raison;
        throw e2;
      }
      if (r.data && r.data.error) throw new Error(String(r.data.error));

      say(tr('gOk'));
      calId   = (r.data && r.data.calendar_id) || null;
      branche = true;
      emit('google', { ok: true, calendar_id: calId });
    } catch (e) {
      warn('finalisation Google : ' + e.message);
      say(e.status === 401 ? tr('sessionOld')
        : e.status === 403 ? tr('gRefused')
        : e.status === 400 && e.raison !== 'echange' ? tr('gStateBad')
        : tr('gFail'));
      emit('google', { ok: false, raison: 'finish', status: e.status || 0, message: e.message });
    } finally {
      // On ne garde rien en memoire une fois l'affaire reglee.
      code = ''; state = ''; nonce = '';
    }

    if (!branche) return;

    // PREMIERE SYNCHRONISATION. runNow() rend la main sans rien faire tant que
    // la brique n'est pas passee en mode nuage — et au retour de Google, la
    // page vient d'etre rechargee : attach() est peut-etre encore en route. On
    // lui laisse le temps d'aboutir, sinon l'agenda tout juste branche
    // resterait vide jusqu'a la prochaine ouverture de l'application, ce qui
    // ressemble beaucoup a un branchement rate.
    for (var k = 0; k < 10; k++) {
      try { await attach(); } catch (e4) {}
      if (S.mode === 'cloud') break;
      await new Promise(function (res) { setTimeout(res, 300); });
    }
    runNow(calId);
  }

  /* Rattrapage : Supabase a mis un provider_refresh_token dans la session.
     On le met a l'abri immediatement, puis on previent. */
  async function rescueProviderToken() {
    var s = await session();
    if (!s || !s.provider_refresh_token) return false;
    warn('un refresh token Google a ete expose au navigateur par signInWithOAuth ; mise a l\'abri puis A REVOQUER.');
    try {
      var c = sb();
      var r = await c.functions.invoke('google-oauth', {
        body: { action: 'adopt', org_id: orgId(), refresh_token: s.provider_refresh_token, calendar_id: 'primary' }
      });
      if (r.error) throw new Error(r.error.message);
      say(tr('gOk'));
      return true;
    } catch (e) { warn('adoption du jeton : ' + e.message); return false; }
  }

  /* Declenchement d'une synchronisation Google. L'Edge Function fait tout le
     travail ; le navigateur ne voit passer qu'un compte-rendu chiffre en
     nombres. Elle peut repondre « more:true » quand l'agenda est enorme : on
     rappelle alors, jusqu'a cinq fois, pour ne pas tourner sans fin. */
  async function runNow(calendarId) {
    var c = sb(); if (!c || S.mode !== 'cloud') return null;
    setMode('cloud', 'sync');
    var total = 0, pass = 0, out = null;
    try {
      do {
        var r = await c.functions.invoke('google-sync', {
          body: { org_id: S.orgId, calendar_id: calendarId || null }
        });
        if (r.error) throw new Error(r.error.message || 'synchro refusee');
        out = r.data || {};
        total += Number(out.written || 0);
        pass++;
        if (out.revoked) { say(tr('gRevoked')); break; }
      } while (out && out.more && pass < 5);
      say(tr('syncDone', { n: total }));
      await catchUp();
      return out;
    } catch (e) {
      warn('runNow : ' + e.message);
      say(tr('syncFail'));
      setMode('cloud', 'error');
      return null;
    }
  }

  /* ==========================================================================
     13. CYCLE DE VIE
     ========================================================================== */
  function setMode(mode, link) {
    S.mode = mode;
    if (link) S.link = link;
    emit('status', info_());
  }

  function info_() {
    var q = loadQueue();
    return {
      mode: S.mode, link: S.link, net: S.net, org: S.orgId, user: S.userId,
      pending: q.length, parked: (jget(K.parked, []) || []).length,
      conflicts: (jget(K.conflicts, []) || []).length,
      skewMs: S.skew, lastError: S.lastErr,
      label: S.mode !== 'cloud' ? tr('modeLocal')
           : !S.net ? tr('modeOffline')
           : S.link === 'sync' ? tr('modeSync')
           : S.link === 'SUBSCRIBED' || S.link === 'live' ? tr('modeLive')
           : tr('modeError')
    };
  }

  /* attach() est rejouable : on peut l'appeler autant de fois qu'on veut. Il
     regarde l'etat du monde (client present ? session ouverte ? organisation
     connue ?) et bascule la brique dans le bon mode. */
  var attaching = false;
  async function attach() {
    if (attaching) return;
    attaching = true;
    try {
      if (!haveCloud()) { setMode('local', 'closed'); return; }
      var s = await session();
      if (!s || !s.user) { stopRealtime(); setMode('local', 'closed'); return; }
      var org = orgId();
      if (!org) { stopRealtime(); setMode('local', 'closed'); return; }

      var changed = (S.orgId !== org) || (S.userId !== s.user.id) || (S.mode !== 'cloud');
      S.orgId = org; S.userId = s.user.id;
      jset(K.org, org);
      setMode('cloud', S.link);

      // Le temps reel doit connaitre le jeton courant, sinon la RLS le rejette
      // apres un renouvellement de session.
      try { var c = sb(); if (c && c.realtime && s.access_token) c.realtime.setAuth(s.access_token); } catch (e) {}

      if (changed || !S.channel) startRealtime();

      /* LE RAPATRIEMENT NE DOIT PAS DEPENDRE DU TEMPS REEL.
         --------------------------------------------------
         catchUp() n'etait declenche que depuis le rappel d'abonnement, quand
         le canal passait a SUBSCRIBED, et depuis runNow(). Sur un telephone,
         l'abonnement temps reel est precisement ce qui tarde ou echoue :
         reseau mobile capricieux, navigateur mis en arriere-plan, canal
         refuse. L'utilisateur voyait alors une application VIDE alors que
         toutes ses donnees etaient dans son compte — le pire des messages,
         parce qu'il ressemble a une perte de donnees.
         Des qu'une session est disponible, on va donc chercher nous-memes ce
         qui est deja dans le compte. Le temps reel redevient ce qu'il aurait
         toujours du etre : un COMPLEMENT pour les mises a jour qui arrivent
         ensuite, jamais la condition du premier chargement.
         On ne l'attend pas (attach() n'a aucune raison d'etre retarde, et le
         verrou `attaching` doit se relacher tout de suite), et on ne le
         refait pas a chaque battement de coeur quand le canal est deja vivant
         — dans ce cas le temps reel fait deja le travail. Le curseur par
         table rend de toute facon les rattrapages suivants quasi gratuits :
         on ne demande que les lignes plus recentes que la derniere vue. */
      var canalVivant = (S.link === 'SUBSCRIBED' || S.link === 'live');
      if (changed || !canalVivant) {
        Promise.resolve().then(catchUp).catch(function (e) {
          warn('rattrapage : ' + (e && e.message));
        });
      }

      flush();
    } finally { attaching = false; }
  }

  /* Le pont. index.html appelle ceci UNE fois, depuis son propre <script>,
     parce que `store`, `state`, `TASKS` et `SUBS` y sont declares avec `let`
     ou `const` : ils n'existent pas sur window et personne ne peut les
     atteindre de l'exterieur. TASKS et SUBS ne servent qu'a la migration
     (retrouver le titre et la date d'une echeance du calendrier integre) ;
     sans eux la brique fonctionne, la migration se contente d'etre moins
     complete et le dit dans son rapport. */
  function bind(pont) {
    pont = pont || {};
    ['store', 'state', 'lsSet', 'buildTasks', 'render', 'toast', 'TASKS', 'SUBS',
     'rebuildBoards'].forEach(function (k) {
      if (pont[k] !== undefined) B[k] = pont[k];
    });
    emit('bound', {});
    return AP.sync;
  }

  var started = false;
  function init(opts) {
    if (started) return AP.sync;
    started = true;
    opts = opts || {};
    if (opts.bridge) bind(opts.bridge);

    S.net = navigator.onLine !== false;

    window.addEventListener('online',  function () { S.net = true;  emit('status', info_()); attach(); });
    window.addEventListener('offline', function () { S.net = false; setMode(S.mode, 'closed'); });

    // Reveil d'onglet : le navigateur a pu couper la connexion en arriere-plan
    // sans prevenir. On verifie a chaque retour a l'ecran.
    document.addEventListener('visibilitychange', function () {
      if (document.visibilityState === 'visible') { attach(); }
    });

    // Battement de coeur : filet contre tous les cas non couverts ci-dessus
    // (veille prolongee du telephone, reseau qui revient sans evenement).
    setInterval(function () { if (S.mode === 'cloud' && S.net) flush(); }, 20000);
    setInterval(function () { attach(); }, 60000);

    /* ATTENTE DU CLIENT SUPABASE — NE PAS SUPPRIMER.
       app/supabase-client.js cree le client de facon ASYNCHRONE (il va
       chercher la librairie sur le reseau). Au premier chargement,
       window.AP.sb vaut donc encore null pendant plusieurs centaines de
       millisecondes, voire douze secondes. Si l'on s'abonne tout de suite,
       sb() renvoie null, onAuthStateChange n'est JAMAIS enregistre, et comme
       init() est protege par `if (started) return;` il ne repassera jamais :
       au renouvellement du jeton (une heure), realtime.setAuth() n'est plus
       appele, la RLS rejette le canal et plus aucune modification distante
       n'arrive — en silence. On attend donc la promesse AP.ready, exactement
       comme auth.js et billing.js. Les ecouteurs reseau ci-dessus, eux,
       n'ont besoin d'aucun client : ils restent poses immediatement. */
    var pret = (window.AP && window.AP.ready) ? window.AP.ready : Promise.resolve(null);
    pret.then(function () {
      // Changement de compte / d'organisation, si la brique COMPTES nous previent.
      try {
        var c = sb();
        if (c && c.auth && c.auth.onAuthStateChange) {
          c.auth.onAuthStateChange(function (evt, sess) {
            if (evt === 'SIGNED_OUT') { stopRealtime(); setMode('local', 'closed'); return; }
            try { if (c.realtime && sess && sess.access_token) c.realtime.setAuth(sess.access_token); } catch (e) {}
            attach();
          });
        }
        if (AP.auth && typeof AP.auth.onChange === 'function') AP.auth.onChange(function () { attach(); });
      } catch (e) {}

      // readReturnFragment() est asynchrone (il finalise le branchement Google
      // par un appel reseau). On ne l'attend pas — attach() n'a aucune raison
      // d'etre retarde — mais on rattrape sa promesse : une promesse rejetee
      // sans filet remonte dans la console comme une erreur non geree, et fait
      // croire a une panne alors que la brique tourne.
      readReturnFragment().catch(function (e) { warn('retour Google : ' + (e && e.message)); });
      attach();
    }, function () {
      // Meme si la promesse est rejetee, la brique doit rester utilisable en
      // mode local : attach() bascule proprement sur 'local'.
      try {
        readReturnFragment().catch(function (e) { warn('retour Google : ' + (e && e.message)); });
        attach();
      } catch (e) {}
    });

    return AP.sync;
  }

  /* ==========================================================================
     14. SURFACE PUBLIQUE
     ========================================================================== */
  AP.sync = Object.assign(AP.sync || {}, {
    init: init,
    bind: bind,
    on: on, off: off,
    info: info_,
    push: push,
    flush: flush,
    pull: catchUp,
    connectGoogle: connectGoogle,
    rescueProviderToken: rescueProviderToken,
    runNow: runNow,

    setStatus: setStatus,
    setNote: setNote,
    setChecklist: setChecklist,
    setTaskFields: setTaskFields,
    deleteTask: deleteTask,

    conflicts: function () { return jget(K.conflicts, []); },
    clearConflicts: function () { jset(K.conflicts, []); emit('conflict', { cleared: true }); },
    parked: function () { return jget(K.parked, []); },
    retryParked: function () {
      var p = jget(K.parked, []) || []; if (!p.length) return 0;
      var q = loadQueue();
      p.forEach(function (e) { e.tries = 0; delete e.parkedAt; delete e.reason; q.push(e); });
      saveQueue(q); jset(K.parked, []); flush();
      return p.length;
    },

    // Internes exposes parce que migrate.js en a besoin (meme espace de noms,
    // pas de second global).
    _: {
      uuid5: uuid5, map: MAP, link: link, saveMap: saveMap, cloudIdOf: cloudIdOf, localIdOf: localIdOf,
      UP: UP, DOWN: DOWN, metaEntry: metaEntry, isMeta: isMeta,
      sb: sb, session: session, orgId: orgId, jget: jget, jset: jset, K: K,
      tr: tr, lang: lang, say: say, warn: warn, state: S, bridge: B,
      bumpCursor: bumpCursor, nowServer: nowServer, repaint: repaint, classify: classify
    },
    i18n: TXT,
    tr: tr
  });

})();
