/* ============================================================================
   AGENDA PRO — app/sync/migrate.js
   LE DEMENAGEMENT : DU NAVIGATEUR VERS LE NUAGE, SANS RIEN PERDRE.
   ----------------------------------------------------------------------------
   CE QUE FAIT CE FICHIER, EN LANGAGE ORDINAIRE
   -------------------------------------------
   L'artisan travaille depuis des mois dans Agenda Pro. Tout ce qu'il a fait —
   ses statuts, ses cases cochees, ses notes, ses contacts, ses lieux, les
   taches qu'il a ajoutees, les sections et categories qu'il a creees — vit
   dans la memoire de SON navigateur, sur CE poste. Le jour ou il se connecte
   pour la premiere fois, il faut emmener tout cela dans le nuage.

   TROIS PROMESSES, DANS CET ORDRE
   -------------------------------
     1. ON SAUVEGARDE D'ABORD. Un fichier JSON complet est telecharge sur le
        disque de l'artisan AVANT la moindre ecriture. Tant qu'il n'est pas
        telecharge, le bouton « Demarrer » reste desactive. Ce n'est pas une
        precaution de style : c'est le filet qui permet de tout recommencer.
     2. ON NE SUPPRIME RIEN. Le localStorage n'est jamais vide, jamais nettoye,
        meme apres un transfert reussi. Si le nuage tombe demain, l'application
        retrouve ses donnees exactement la ou elles etaient.
     3. ON PEUT RECOMMENCER. Chaque tache recoit un identifiant calcule a
        partir de son identifiant local : deux transferts produisent donc les
        MEMES identifiants, et la base refuse poliment le doublon. Une
        migration interrompue par une coupure reseau se reprend ou elle en
        etait, sans creer de copies.

   CE QU'ON NE PEUT PAS FAIRE, ET POURQUOI
   ---------------------------------------
   Le socle SQL (fichier 003) interdit au navigateur d'ecrire les colonnes
   `source`, `external_id`, `calendar_id`, `created_by` et `created_at` d'une
   tache : un declencheur les repose systematiquement. Toutes les taches
   transferees arrivent donc dans le nuage marquees « manual ». C'est voulu
   par le socle, et c'est meme une bonne nouvelle : la synchronisation Google
   ne touche JAMAIS une tache « manual », donc elle ne pourra jamais ecraser
   le travail que l'on vient de remonter.
   ============================================================================ */

(function () {
  'use strict';

  var AP = (window.AP = window.AP || {});
  if (!AP.sync || !AP.sync._) {
    // sync.js doit etre charge AVANT ce fichier : il publie l'espace de noms,
    // les outils d'identifiants et le pont vers index.html.
    try { console.warn('[AP.sync.migrate] app/sync/sync.js doit etre charge en premier.'); } catch (e) {}
    return;
  }
  var X = AP.sync._;          // outils internes partages, pas de second global
  var jget = X.jget, jset = X.jset, warn = X.warn, say = X.say;

  /* ==========================================================================
     0. DICTIONNAIRE BILINGUE
     ========================================================================== */
  var TXT = {
    title:      { ar: 'نقل بياناتك إلى السحابة',                fr: 'Transférer vos données vers le nuage' },
    intro:      { ar: 'وجدنا عملاً محفوظاً على هذا الجهاز. سننقله إلى حسابك حتى تجده على الهاتف وعلى المكتب.',
                  fr: "Nous avons trouvé du travail enregistré sur cet appareil. Nous allons le transférer vers votre compte pour le retrouver sur le téléphone et au bureau." },
    inventory:  { ar: 'ما سيُنقل',                              fr: 'Ce qui sera transféré' },
    iStatus:    { ar: 'حالات المهام',                           fr: 'Statuts de tâches' },
    iChecks:    { ar: 'قوائم الوثائق',                          fr: 'Listes de documents' },
    iNotes:     { ar: 'ملاحظات',                                fr: 'Notes' },
    iCustom:    { ar: 'مهام أضفتها بنفسك',                      fr: 'Tâches ajoutées à la main' },
    iSections:  { ar: 'أقسام خاصة بك',                          fr: 'Sections personnalisées' },
    iSubs:      { ar: 'فئات خاصة بك',                           fr: 'Catégories personnalisées' },
    iContacts:  { ar: 'جهات اتصال وأماكن',                      fr: 'Contacts et lieux' },
    iMoved:     { ar: 'مهام نقلتها إلى قسم آخر',                fr: 'Tâches reclassées à la main' },
    backupT:    { ar: '1 — احفظ نسخة على جهازك',                fr: '1 — Enregistrez une copie sur votre disque' },
    backupD:    { ar: 'ملف واحد يحتوي كل شيء. لن يبدأ النقل قبل تنزيله.',
                  fr: 'Un seul fichier qui contient tout. Le transfert ne démarre pas avant son téléchargement.' },
    backupBtn:  { ar: '⤓ تنزيل النسخة الاحتياطية',              fr: '⤓ Télécharger la sauvegarde' },
    backupOk:   { ar: '✓ تم تنزيل النسخة',                      fr: '✓ Sauvegarde téléchargée' },
    runT:       { ar: '2 — ابدأ النقل',                         fr: '2 — Lancez le transfert' },
    runD:       { ar: 'لن نحذف أي شيء من هذا الجهاز. يمكنك إعادة المحاولة في أي وقت.',
                  fr: "Rien ne sera effacé de cet appareil. Vous pouvez recommencer à tout moment." },
    start:      { ar: 'ابدأ النقل',                             fr: 'Démarrer le transfert' },
    cancel:     { ar: 'ليس الآن',                               fr: 'Pas maintenant' },
    close:      { ar: 'إغلاق',                                  fr: 'Fermer' },
    working:    { ar: 'جارٍ النقل…',                            fr: 'Transfert en cours…' },
    stepSec:    { ar: 'الأقسام',                                fr: 'Les sections' },
    stepCat:    { ar: 'الفئات',                                 fr: 'Les catégories' },
    stepTask:   { ar: 'المهام',                                 fr: 'Les tâches' },
    stepState:  { ar: 'الحالات والملاحظات',                     fr: 'Les statuts et les notes' },
    doneT:      { ar: 'تم النقل',                               fr: 'Transfert terminé' },
    doneD:      { ar: 'كل شيء في حسابك الآن. بياناتك المحلية بقيت كما هي.',
                  fr: "Tout est dans votre compte. Vos données locales sont restées intactes." },
    failT:      { ar: 'توقف النقل',                             fr: 'Le transfert s’est arrêté' },
    failD:      { ar: 'لم يُفقد شيء. أعد المحاولة عند عودة الاتصال.',
                  fr: "Rien n’est perdu. Réessayez quand la connexion sera revenue." },
    retry:      { ar: 'إعادة المحاولة',                         fr: 'Réessayer' },
    already:    { ar: 'سبق أن نُقلت بيانات هذا الجهاز.',        fr: 'Les données de cet appareil ont déjà été transférées.' },
    nothing:    { ar: 'لا يوجد ما يُنقل.',                      fr: 'Il n’y a rien à transférer.' },
    noSession:  { ar: 'سجّل الدخول أولاً.',                     fr: 'Connectez-vous d’abord.' },
    skipped:    { ar: 'عناصر لم تُنقل (انظر التفاصيل)',         fr: 'Éléments non transférés (voir le détail)' },
    partial:    { ar: 'لم نتمكن من إنشاء الأقسام: ليست لديك الصلاحية. وُضعت المهام في القسم الافتراضي.',
                  fr: "Sections non créées : droits insuffisants. Les tâches ont été placées dans la section par défaut." }
  };
  function tr(k) { var e = TXT[k]; var l = X.lang(); return e ? (e[l] || e.fr) : k; }

  /* ==========================================================================
     1. ETAT DE LA MIGRATION (journal rejouable)
     ========================================================================== */
  var JKEY = 'agendapro_v1_migration';
  function journal() { var j = jget(JKEY, null); return (j && typeof j === 'object') ? j : null; }
  function saveJournal(j) { jset(JKEY, j); }

  function alreadyDone(orgId) {
    var j = journal();
    return !!(j && j.finishedAt && j.orgId === orgId);
  }

  /* ==========================================================================
     2. INVENTAIRE : QU'Y A-T-IL A DEMENAGER ?
     --------------------------------------------------------------------------
     On lit le « store » de l'application (le meme objet que index.html range
     sous la cle agendapro_v1). On compte chaque famille, pour pouvoir le dire
     a l'artisan AVANT de commencer. Personne ne doit lancer une operation dont
     il ne sait pas ce qu'elle touche.
     ========================================================================== */
  function readStore() {
    // Priorite au store vivant passe par le pont : il contient les
    // modifications de la seconde qui vient de s'ecouler.
    var live = deref(X.bridge && X.bridge.store);
    if (live) return live;
    return jget('agendapro_v1', null) || {};
  }

  /* Le pont accepte soit une valeur, soit une petite fonction qui la renvoie.
     La forme « fonction » est indispensable pour tout ce que index.html
     REASSIGNE (TASKS), sans quoi on travaillerait sur une photo perimee. */
  function deref(v) { return (typeof v === 'function') ? v() : v; }

  function inventory() {
    var s = readStore();
    var n = function (o) { return o ? Object.keys(o).length : 0; };
    return {
      status:   n(s.status),
      checks:   n(s.checks),
      notes:    n(s.notes),
      cat:      n(s.cat),
      contact:  n(s.contact) + n(s.place),
      custom:   (s.custom || []).length,
      sections: (s.sections || []).length,
      subs:     (s.subs || []).length
    };
  }
  function isEmpty(inv) {
    return !(inv.status || inv.checks || inv.notes || inv.cat || inv.contact || inv.custom || inv.sections || inv.subs);
  }

  /* ==========================================================================
     3. LA SAUVEGARDE TELECHARGEE
     --------------------------------------------------------------------------
     On ne sauvegarde pas seulement le store principal : on ramasse aussi les
     autres cles de DONNEES du navigateur (preferences, meteo, pensee du jour,
     file d'attente, correspondances). Un seul fichier, relisible a l'oeil nu,
     qui permet de tout remettre en place avec un copier-coller si un jour il
     le fallait.
     En revanche on ne ramasse PLUS « toutes les cles agendapro_* » : la liste
     est desormais explicite (CLES_SAUVEGARDE ci-dessous), parce que ce prefixe
     attrapait aussi la session Supabase et la cle d'API Gemini. Le detail est
     ecrit au-dessus de la liste.
     ========================================================================== */
  /* LISTE BLANCHE DES CLES SAUVEGARDEES — NE PAS REMPLACER PAR UN PREFIXE.
     Le balayage large d'origine (indexOf('agendapro') === 0) ramassait aussi
     deux cles qui ne sont PAS des donnees metier et qui sont des SECRETS :

       - 'agendapro_auth'        : le storageKey du client Supabase
                                   (app/supabase-client.js). Il contient
                                   l'access_token ET le refresh_token de la
                                   session en cours. Le fichier de sauvegarde
                                   est OBLIGATOIRE avant la migration et il est
                                   produit alors qu'une session est ouverte :
                                   le refresh_token partait donc en clair dans
                                   le dossier Telechargements, lisible au
                                   Bloc-notes, et permettait de rouvrir le
                                   compte indefiniment (il annulait le travail
                                   de session_is_live() de la 003).
       - 'agendapro_v1_gemkey'   : la cle d'API Gemini de l'utilisateur, une
                                   cle facturable. Une cle d'API ne doit jamais
                                   sortir du navigateur, ni dans un fichier, ni
                                   vers le serveur.

     Toute nouvelle cle de DONNEES doit etre ajoutee ici explicitement. Toute
     nouvelle cle de SECRET doit simplement ne pas y figurer. */
  var CLES_SAUVEGARDE = [
    'agendapro_v1',             // le store principal : statuts, cases, notes, taches, sections, categories
    'agendapro_v1_pref2',       // preferences d'affichage
    'agendapro_v1_wx',          // cache meteo
    'agendapro_v1_daily',       // pensee du jour
    'agendapro_v1_gemmodel',    // modele d'IA choisi (un nom, pas un secret)
    'agendapro_v1_pwa',         // etat de l'invite d'installation
    'agendapro_v1_migration',   // etat de cette migration
    'agendapro_v1_syncmap',     // correspondance identifiant local <-> identifiant nuage
    'agendapro_v1_queue',       // ecritures en attente de reseau
    'agendapro_v1_queue_ko',    // ecritures definitivement refusees
    'agendapro_v1_conflits',    // journal des conflits
    'agendapro_v1_curseur',     // date de la derniere ligne vue par table
    'agendapro_v1_org',         // organisation active memorisee
    'agendapro_v1_decalage'     // decalage d'horloge appareil / serveur
  ];

  function snapshot() {
    var out = { produit: 'Agenda Pro', type: 'sauvegarde-avant-migration', date: new Date().toISOString(), cles: {} };
    try {
      for (var i = 0; i < CLES_SAUVEGARDE.length; i++) {
        var k = CLES_SAUVEGARDE[i];
        var raw = localStorage.getItem(k);
        if (raw === null) { continue; }   // cle absente sur ce poste : normal
        try { out.cles[k] = JSON.parse(raw); } catch (e) { out.cles[k] = raw; }
      }
    } catch (e) { warn('lecture localStorage pour sauvegarde : ' + e.message); }
    return out;
  }

  function downloadBackup() {
    var data = snapshot();
    var blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json;charset=utf-8' });
    var url = URL.createObjectURL(blob);
    var a = document.createElement('a');
    var d = new Date();
    a.href = url;
    a.download = 'agenda-pro-sauvegarde-' + d.getFullYear() + pad(d.getMonth() + 1) + pad(d.getDate()) +
                 '-' + pad(d.getHours()) + pad(d.getMinutes()) + '.json';
    document.body.appendChild(a);
    a.click();
    setTimeout(function () { document.body.removeChild(a); URL.revokeObjectURL(url); }, 2000);
    return a.download;
  }
  function pad(n) { return String(n).padStart(2, '0'); }

  /* ==========================================================================
     4. NETTOYAGE DES VALEURS POUR LA BASE
     --------------------------------------------------------------------------
     Le socle SQL est severe : longueurs maximales, formats de couleur, format
     de telephone, cles en minuscules… Une seule valeur mal formee fait
     echouer tout un lot de 100 taches. On nettoie donc AVANT d'envoyer, et on
     tronque plutot que d'abandonner : mieux vaut une description coupee a
     20 000 caracteres qu'une tache perdue.
     ========================================================================== */
  function clip(v, max) {
    if (v == null) return null;
    var s = String(v).trim();
    if (!s) return null;
    return s.length > max ? s.slice(0, max) : s;
  }
  function keyify(v, fallback) {
    // Les cles de section et de categorie doivent respecter ^[a-z0-9_]{2,40}$.
    // « voyagePro » deviendrait donc invalide : on normalise sans etat d'ame.
    var s = String(v || '').toLowerCase().replace(/[^a-z0-9_]+/g, '_').replace(/^_+|_+$/g, '');
    if (s.length < 2) s = (fallback || 'x') + (s || '');
    if (s.length < 2) s = 'x' + s;
    return s.slice(0, 40);
  }
  function colorify(v, fallback) {
    var s = String(v || '').trim();
    return /^#[0-9a-fA-F]{6}$/.test(s) ? s.toLowerCase() : fallback;
  }
  function iconify(v, fallback) {
    var s = String(v == null ? '' : v);
    if (!s) return fallback;
    return Array.from(s).slice(0, 8).join('');   // le CHECK plafonne a 16 caracteres
  }
  function phoneify(v) {
    // contact_phone ~ '^\+?[0-9 ().-]{6,32}$' — tout le reste est refuse.
    var s = String(v || '').trim();
    return /^\+?[0-9 ().\-]{6,32}$/.test(s) ? s : null;
  }

  /* Date + heure locales -> horodatage absolu.
     L'application range « 2026-03-14 » et « 09:30 » separement, dans le fuseau
     de l'artisan. new Date(annee, mois-1, jour, h, m) interprete justement ces
     nombres dans le fuseau local du navigateur : c'est exactement ce qu'on
     veut, et toISOString() les convertit ensuite en UTC pour la base. */
  function stamp(day, time) {
    if (!day || !/^\d{4}-\d{2}-\d{2}$/.test(day)) return null;
    var p = day.split('-').map(Number);
    var hh = 0, mm = 0;
    if (time && /^\d{1,2}:\d{2}/.test(time)) { var t = time.split(':'); hh = Number(t[0]); mm = Number(t[1]); }
    var d = new Date(p[0], p[1] - 1, p[2], hh, mm, 0, 0);
    return isNaN(d) ? null : d.toISOString();
  }

  /* ==========================================================================
     5. LE PLAN DE DEMENAGEMENT
     --------------------------------------------------------------------------
     Quatre etapes, dans cet ordre obligatoire : une tache ne peut pointer vers
     une section qui n'existe pas encore, et un etat ne peut pointer vers une
     tache qui n'existe pas encore (le declencheur tg_check_same_org du socle
     verifie tout cela ligne par ligne).
     ========================================================================== */
  var REPORT = null;

  async function buildPlan(orgId, opts) {
    var s = readStore();
    // TASKS est RECONSTRUIT par buildTasks() a chaque rendu (« TASKS = out »),
    // donc la reference donnee au pont vieillit. On accepte donc aussi une
    // petite fonction qui va chercher la valeur du moment : c'est la forme a
    // privilegier dans index.html.
    var TASKS = deref((opts && opts.TASKS) || (X.bridge && X.bridge.TASKS)) || null;
    var SUBS  = deref((opts && opts.SUBS)  || (X.bridge && X.bridge.SUBS))  || {};
    var report = { skipped: [], notes: [] };

    /* --- 5.1 SECTIONS -------------------------------------------------------
       Les deux sections d'origine existent DEJA dans le nuage : le declencheur
       handle_new_user les cree a l'inscription, sous les cles « entreprise »
       et « personnel ». L'application locale, elle, les appelle « ent » et
       « perso ». On rapproche les deux, puis on ajoute les sections que
       l'artisan a creees lui-meme. */
    var secKeyOf = {}; // id local -> cle nuage
    secKeyOf['ent'] = 'entreprise';
    secKeyOf['perso'] = 'personnel';
    var newSections = [];
    (s.sections || []).forEach(function (sec, i) {
      if (!sec || !sec.id || secKeyOf[sec.id]) return;
      var key = keyify(sec.id, 'sec');
      secKeyOf[sec.id] = key;
      newSections.push({
        org_id: orgId, key: key,
        name_ar: clip(sec.ar, 80) || key,
        name_fr: clip(sec.fr, 80) || clip(sec.ar, 80) || key,
        icon: iconify(sec.ic, 'DOSSIER'),
        color: colorify(sec.c, '#a855f7'),
        position: 10 + i
      });
    });

    /* --- 5.2 CATEGORIES -----------------------------------------------------
       « routine » existe deja dans le nuage. Les autres categories d'origine
       de l'application (impots, banque, sante…) n'y sont pas : ce sont des
       constantes du fichier HTML. On ne cree que celles qui servent
       reellement a une tache que l'on transfere — inutile d'encombrer la base
       avec douze categories vides. */
    var catKeyOf = {};
    var newCats = [];
    var wantedSubs = {};

    /* --- 5.3 TACHES ---------------------------------------------------------
       On ne remonte PAS les centaines d'echeances du calendrier integre a la
       page : elles sont identiques sur tous les appareils, puisqu'elles sont
       ecrites dans index.html. On remonte :
         (a) toutes les taches ajoutees a la main (store.custom) ;
         (b) toutes les taches du calendrier integre SUR LESQUELLES l'artisan a
             travaille : un statut, une note, une case cochee, un
             reclassement, un contact ou un lieu.
       Une tache du calendrier integre sans aucun travail dessus n'a rien a
       perdre : ne pas la remonter ne fait perdre strictement rien, et evite
       de gonfler la base et la facture. */
    var touched = {};
    ['status', 'notes', 'cat'].forEach(function (k) {
      Object.keys(s[k] || {}).forEach(function (id) { touched[id] = 1; });
    });
    Object.keys(s.checks || {}).forEach(function (id) { touched[id] = 1; });

    var byId = {};
    if (TASKS && TASKS.length) TASKS.forEach(function (t) { byId[t.id] = t; });

    // Les contacts et les lieux sont ranges par « serie » (sk), pas par tache :
    // un contact vaut pour toutes les occurrences d'une meme echeance. On les
    // rabat donc sur chaque tache de la serie concernee.
    var seriesContact = s.contact || {}, seriesPlace = s.place || {};
    Object.keys(seriesContact).concat(Object.keys(seriesPlace)).forEach(function (sk) {
      if (!TASKS) return;
      TASKS.forEach(function (t) { if (t.sk === sk) touched[t.id] = 1; });
    });

    var tasks = [], states = [], mapPairs = [];
    var defaultSection = 'entreprise';

    // (a) taches ajoutees a la main
    var customs = s.custom || [];
    for (var ci = 0; ci < customs.length; ci++) {
      var c = customs[ci];
      if (!c || !c.id) continue;
      if (c.cloud) { mapPairs.push([c.id, c.cloud]); continue; }   // deja dans le nuage
      var cid = await X.uuid5(orgId, 'task:' + c.id);
      var csec = secKeyOf[(s.cat && s.cat[c.id]) || c.cat] || defaultSection;
      var csub = c.sub ? keyify(c.sub, 'cat') : null;
      if (csub) wantedSubs[csub] = c.sub;
      tasks.push({
        id: cid, org_id: orgId,
        __sectionKey: csec, __categoryKey: csub,
        title: clip(c.title, 300) || '—',
        description: clip(c.notes, 20000),
        location: clip(seriesPlace[c.id] || seriesPlace['c:' + c.id], 300),
        contact_name: clip(seriesContact[c.id] || seriesContact['c:' + c.id], 120),
        contact_phone: phoneify(seriesContact[c.id] || seriesContact['c:' + c.id]),
        starts_at: stamp(c.date, c.time),
        ends_at: null,
        all_day: !c.time,
        due_at: stamp(c.date, c.time),
        recurrence_rule: null
      });
      mapPairs.push([c.id, cid]);
    }

    // (b) taches du calendrier integre portant du travail
    var touchedIds = Object.keys(touched);
    for (var ti = 0; ti < touchedIds.length; ti++) {
      var lid = touchedIds[ti];
      if (customs.some(function (x) { return x.id === lid; })) continue;   // deja traitee
      var it = byId[lid];
      if (!it) {
        // On n'a pas le detail de la tache (TASKS non fourni, ou echeance
        // disparue d'une version a l'autre). On ne l'invente pas : on la
        // signale dans le rapport, et la sauvegarde JSON la conserve.
        report.skipped.push({ id: lid, raison: 'tache introuvable dans le calendrier de cette version' });
        continue;
      }
      var tid = await X.uuid5(orgId, 'task:' + lid);
      var secKey = secKeyOf[(s.cat && s.cat[lid]) || it.cat] || defaultSection;
      var subKey = it.sub ? keyify(it.sub, 'cat') : null;
      if (subKey) wantedSubs[subKey] = it.sub;
      var contact = seriesContact[it.sk] || null, place = seriesPlace[it.sk] || null;
      tasks.push({
        id: tid, org_id: orgId,
        __sectionKey: secKey, __categoryKey: subKey,
        title: clip((it.title && (it.title.fr || it.title.ar)) || it.raw, 300) || '—',
        description: clip(it.desc, 20000),
        location: clip(place, 300),
        contact_name: clip(contact, 120),
        contact_phone: phoneify(contact),
        starts_at: stamp(it.date, it.start),
        ends_at: it.end ? stamp(it.date, it.end) : null,
        all_day: !!it.allDay || !it.start,
        due_at: stamp(it.date, it.start),
        recurrence_rule: null
      });
      mapPairs.push([lid, tid]);
    }

    // Les categories reellement utilisees, plus celles creees par l'artisan.
    (s.subs || []).forEach(function (sub) { if (sub && sub.id) wantedSubs[keyify(sub.id, 'cat')] = sub.id; });
    var subMeta = {};
    (s.subs || []).forEach(function (sub) { if (sub && sub.id) subMeta[keyify(sub.id, 'cat')] = sub; });

    Object.keys(wantedSubs).forEach(function (key, i) {
      if (key === 'routine') { catKeyOf[key] = key; return; }   // deja dans le nuage
      var origin = wantedSubs[key];
      var m = subMeta[key] || SUBS[origin] || {};
      catKeyOf[key] = key;
      newCats.push({
        org_id: orgId, section_id: null, key: key,
        name_ar: clip(m.ar, 80) || key,
        name_fr: clip(m.fr, 80) || clip(m.ar, 80) || key,
        icon: iconify(m.ic, 'ETIQUETTE'),
        color: colorify(m.c, '#64748b'),
        position: 10 + i,
        hidden_by_default: key === 'routine'
      });
    });

    /* --- 5.4 ETATS (le travail de l'artisan) -------------------------------- */
    for (var mi = 0; mi < mapPairs.length; mi++) {
      var pair = mapPairs[mi], localId = pair[0], cloudId = pair[1];
      var st = (s.status || {})[localId] || null;
      var note = (s.notes || {})[localId] || null;
      var chk = (s.checks || {})[localId] || null;
      if (!st && !note && !chk) {
        // Meme sans travail dessus, on cree une ligne d'etat vide : elle sert
        // d'ancrage au temps reel et evite un aller-retour a la premiere
        // modification faite depuis le telephone.
        states.push({ task_id: cloudId, org_id: orgId, status: 'todo', checklist: [X.metaEntry(null, localId)], notes: null, progress: 0, completed_at: null });
        continue;
      }
      var list = (chk && chk.list) || [];
      var done = (chk && chk.done) || [];
      var checklist = list.map(function (label) {
        var key = String(label);
        return { id: key, label_ar: key, label_fr: key, done: done.indexOf(key) >= 0 };
      });
      // L'entree technique : elle transporte le statut LOCAL exact (« waiting »
      // et « postponed » tombent tous deux sur « blocked » dans la base) et
      // l'identifiant local, ce qui rend l'aller-retour fidele au mot pres.
      checklist.push(X.metaEntry(st, localId));
      var dbStatus = st ? (X.UP[st] || 'todo') : 'todo';
      states.push({
        task_id: cloudId, org_id: orgId,
        status: dbStatus,
        checklist: checklist,
        notes: clip(note, 20000),
        progress: list.length ? Math.round(done.length * 100 / list.length) : 0,
        completed_at: dbStatus === 'done' ? new Date().toISOString() : null
      });
    }

    return {
      orgId: orgId,
      sections: newSections, categories: newCats,
      tasks: tasks, states: states, mapPairs: mapPairs,
      secKeyOf: secKeyOf, report: report
    };
  }

  /* ==========================================================================
     6. EXECUTION, PAR LOTS, REPRENABLE
     --------------------------------------------------------------------------
     On envoie par paquets de 100 lignes. Trop gros, la requete depasse le
     temps imparti sur une connexion 3G algerienne ; trop petit, on multiplie
     les allers-retours. 100 est un compromis eprouve.

     `ignoreDuplicates: true` produit en SQL un « ON CONFLICT DO NOTHING ».
     C'est la SEULE forme utilisable ici : un vrai upsert exigerait le droit de
     MODIFIER les colonnes envoyees, or le socle 003 a retire au navigateur le
     droit d'UPDATE sur org_id, key, id, created_at… La requete serait refusee
     avec un « permission denied for column » incomprehensible.
     ========================================================================== */
  var BATCH = 100;

  async function runPlan(plan, onStep) {
    var c = X.sb();
    if (!c) throw new Error('client Supabase absent');
    var j = journal() || { startedAt: new Date().toISOString(), orgId: plan.orgId, steps: {} };
    j.orgId = plan.orgId; j.steps = j.steps || {};
    var rep = plan.report;

    /* --- sections --- */
    onStep({ step: 'sections', pct: 5 });
    if (!j.steps.sections && plan.sections.length) {
      var rs = await c.from('sections').upsert(plan.sections, { onConflict: 'org_id,key', ignoreDuplicates: true });
      if (rs.error) {
        // Droits insuffisants (employe ou lecteur) : on n'echoue pas pour
        // autant, les taches iront dans la section par defaut.
        if (String(rs.error.code) === '42501' || /row-level security|permission/i.test(rs.error.message || '')) {
          // Les sections n'ont pas pu etre creees : les taches iront dans la
          // section par defaut. C'est le calcul « secIds[cle] || repli » plus
          // bas qui s'en charge tout seul, puisque la cle sera absente.
          rep.notes.push(tr('partial'));
        } else throw new Error('sections : ' + rs.error.message);
      }
    }
    j.steps.sections = true; saveJournal(j);

    /* --- categories --- */
    onStep({ step: 'categories', pct: 15 });
    if (!j.steps.categories && plan.categories.length) {
      var rc = await c.from('categories').upsert(plan.categories, { onConflict: 'org_id,key', ignoreDuplicates: true });
      if (rc.error) {
        if (String(rc.error.code) === '42501' || /row-level security|permission/i.test(rc.error.message || '')) {
          rep.notes.push(tr('partial'));
        } else throw new Error('categories : ' + rc.error.message);
      }
    }
    j.steps.categories = true; saveJournal(j);

    /* --- relecture des identifiants reels de sections et categories ---------
       On a envoye des CLES (« entreprise », « sec1 ») ; la base repond avec des
       uuid. Il faut la table de correspondance avant d'ecrire les taches. */
    var secIds = {}, catIds = {};
    var qs = await c.from('sections').select('id,key').eq('org_id', plan.orgId);
    if (qs.error) throw new Error('lecture sections : ' + qs.error.message);
    (qs.data || []).forEach(function (r) { secIds[r.key] = r.id; });
    var qc = await c.from('categories').select('id,key').eq('org_id', plan.orgId);
    if (qc.error) throw new Error('lecture categories : ' + qc.error.message);
    (qc.data || []).forEach(function (r) { catIds[r.key] = r.id; });

    var fallbackSection = secIds['entreprise'] || secIds['personnel'] || null;

    /* --- taches --- */
    var rows = plan.tasks.map(function (t) {
      var o = {};
      Object.keys(t).forEach(function (k) { if (k.indexOf('__') !== 0) o[k] = t[k]; });
      o.section_id  = secIds[t.__sectionKey] || fallbackSection;
      o.category_id = t.__categoryKey ? (catIds[t.__categoryKey] || null) : null;
      return o;
    });
    var doneT = (j.steps.tasks && j.steps.tasks.batches) || [];
    for (var i = 0; i < rows.length; i += BATCH) {
      var idx = i / BATCH;
      onStep({ step: 'tasks', pct: 20 + Math.round(50 * i / Math.max(1, rows.length)) });
      if (doneT.indexOf(idx) >= 0) continue;
      var rt = await c.from('tasks').upsert(rows.slice(i, i + BATCH), { onConflict: 'id', ignoreDuplicates: true });
      if (rt.error) throw new Error('taches (lot ' + (idx + 1) + ') : ' + rt.error.message);
      doneT.push(idx);
      j.steps.tasks = { batches: doneT }; saveJournal(j);
    }
    j.steps.tasks = { batches: doneT, ok: true }; saveJournal(j);

    /* --- etats --- */
    var doneS = (j.steps.states && j.steps.states.batches) || [];
    for (var k2 = 0; k2 < plan.states.length; k2 += BATCH) {
      var idx2 = k2 / BATCH;
      onStep({ step: 'states', pct: 72 + Math.round(25 * k2 / Math.max(1, plan.states.length)) });
      if (doneS.indexOf(idx2) >= 0) continue;
      var rst = await c.from('task_state').upsert(plan.states.slice(k2, k2 + BATCH), { onConflict: 'task_id', ignoreDuplicates: true });
      if (rst.error) throw new Error('etats (lot ' + (idx2 + 1) + ') : ' + rst.error.message);
      doneS.push(idx2);
      j.steps.states = { batches: doneS }; saveJournal(j);
    }
    j.steps.states = { batches: doneS, ok: true }; saveJournal(j);

    /* --- table de correspondance + marquage des taches manuelles ------------
       On ecrit la correspondance identifiant local <-> uuid : c'est elle qui
       permettra au temps reel de savoir quelle bulle rafraichir. */
    plan.mapPairs.forEach(function (p) { X.link(p[0], p[1]); });
    X.saveMap();
    try {
      var st = readStore();
      (st.custom || []).forEach(function (cc) {
        var u = X.cloudIdOf(cc.id); if (u) cc.cloud = u;
      });
      if (X.bridge && typeof X.bridge.lsSet === 'function') X.bridge.lsSet();
    } catch (e) { warn('marquage des taches manuelles : ' + e.message); }

    // On repart de zero cote curseur : le rattrapage relira tout une fois,
    // ce qui garantit que l'ecran affiche bien ce qui est REELLEMENT en base.
    jset(X.K.cursor, {});

    j.finishedAt = new Date().toISOString();
    j.counts = { sections: plan.sections.length, categories: plan.categories.length, tasks: plan.tasks.length, states: plan.states.length };
    j.report = rep;
    saveJournal(j);
    REPORT = { counts: j.counts, report: rep };
    onStep({ step: 'done', pct: 100 });
    return j;
  }

  /* ==========================================================================
     7. L'ECRAN DE CONFIRMATION
     --------------------------------------------------------------------------
     On reutilise scrupuleusement l'habillage de l'application : .modal,
     .modal-in, .modal-h, .modal-b, .modal-f, .mb, .fld, .row2, .note-line, et
     les variables de couleur. Aucune seconde charte graphique n'est inventee.
     Les marges utilisent les proprietes logiques (margin-inline, inset-inline)
     pour que tout se reflete automatiquement en arabe.
     ========================================================================== */
  var el = null, backupDone = false;

  function h(tag, attrs, html) {
    var e = document.createElement(tag);
    if (attrs) Object.keys(attrs).forEach(function (k) {
      if (k === 'style') e.setAttribute('style', attrs[k]); else e.setAttribute(k, attrs[k]);
    });
    if (html != null) e.innerHTML = html;
    return e;
  }
  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c];
    });
  }

  function line(label, n) {
    if (!n) return '';
    return '<div style="display:flex;justify-content:space-between;gap:12px;padding:6px 0;border-bottom:1px solid var(--line)">' +
           '<span style="color:var(--txt2)">' + esc(label) + '</span>' +
           '<strong style="color:var(--txt);font-variant-numeric:tabular-nums">' + n + '</strong></div>';
  }

  function open(opts) {
    opts = opts || {};
    close();
    var inv = inventory();
    backupDone = false;

    var body =
      '<p style="margin:0 0 6px;color:var(--txt2);font-size:13px;line-height:1.75">' + esc(tr('intro')) + '</p>' +
      '<div class="fld"><label>' + esc(tr('inventory')) + '</label><div style="font-size:12.5px">' +
        line(tr('iCustom'),   inv.custom) +
        line(tr('iStatus'),   inv.status) +
        line(tr('iChecks'),   inv.checks) +
        line(tr('iNotes'),    inv.notes) +
        line(tr('iMoved'),    inv.cat) +
        line(tr('iContacts'), inv.contact) +
        line(tr('iSections'), inv.sections) +
        line(tr('iSubs'),     inv.subs) +
      '</div></div>' +
      '<div class="fld"><label>' + esc(tr('backupT')) + '</label>' +
        '<div class="note-line">' + esc(tr('backupD')) + '</div>' +
        '<button class="mb" id="apm_backup" style="margin-top:8px">' + esc(tr('backupBtn')) + '</button>' +
        '<span id="apm_backup_ok" style="margin-inline-start:10px;color:var(--ok);font-size:12px;display:none">' + esc(tr('backupOk')) + '</span>' +
      '</div>' +
      '<div class="fld"><label>' + esc(tr('runT')) + '</label>' +
        '<div class="note-line">' + esc(tr('runD')) + '</div>' +
      '</div>' +
      '<div id="apm_prog" style="display:none">' +
        '<div style="font-size:12.5px;color:var(--txt2);margin-bottom:6px" id="apm_prog_lbl">' + esc(tr('working')) + '</div>' +
        '<div style="height:8px;border-radius:99px;background:var(--surface2);overflow:hidden">' +
          '<div id="apm_bar" style="height:100%;width:0;background:var(--brand2);transition:width .25s"></div>' +
        '</div>' +
      '</div>' +
      '<div id="apm_result"></div>';

    el = h('div', { class: 'modal show', id: 'apm_modal', role: 'dialog', 'aria-modal': 'true' });
    el.innerHTML =
      '<div class="modal-in">' +
        '<div class="modal-h"><h3>' + esc(tr('title')) + '</h3></div>' +
        '<div class="modal-b" id="apm_body">' + body + '</div>' +
        '<div class="modal-f">' +
          '<button class="mb" id="apm_cancel">' + esc(tr('cancel')) + '</button>' +
          '<button class="mb pri" id="apm_start" disabled style="opacity:.5;cursor:not-allowed">' + esc(tr('start')) + '</button>' +
        '</div>' +
      '</div>';
    document.body.appendChild(el);

    var $ = function (id) { return el.querySelector('#' + id); };

    $('apm_backup').addEventListener('click', function () {
      var name = downloadBackup();
      backupDone = true;
      $('apm_backup_ok').style.display = 'inline';
      $('apm_backup_ok').textContent = tr('backupOk') + ' — ' + name;
      var b = $('apm_start');
      b.disabled = false; b.style.opacity = '1'; b.style.cursor = 'pointer';
    });
    $('apm_cancel').addEventListener('click', close);
    $('apm_start').addEventListener('click', function () { start(opts, $); });

    return el;
  }

  function close() {
    if (el && el.parentNode) el.parentNode.removeChild(el);
    el = null;
  }

  async function start(opts, $) {
    if (!backupDone) return;   // ceinture : le bouton est deja desactive
    $('apm_start').disabled = true; $('apm_start').style.opacity = '.5';
    $('apm_cancel').disabled = true;
    $('apm_prog').style.display = 'block';

    var labels = { sections: tr('stepSec'), categories: tr('stepCat'), tasks: tr('stepTask'), states: tr('stepState'), done: tr('doneT') };
    function step(s) {
      $('apm_bar').style.width = (s.pct || 0) + '%';
      $('apm_prog_lbl').textContent = (labels[s.step] || tr('working')) + ' — ' + (s.pct || 0) + '%';
    }

    try {
      var orgId = X.orgId();
      var sess = await X.session();
      if (!sess || !orgId) throw new Error(tr('noSession'));

      var plan = await buildPlan(orgId, opts);
      await runPlan(plan, step);

      var extra = '';
      if (plan.report.notes.length) extra += '<div class="note-line" style="margin-top:8px">' + plan.report.notes.map(esc).join('<br>') + '</div>';
      if (plan.report.skipped.length) {
        extra += '<div class="note-line" style="margin-top:8px">' + esc(tr('skipped')) + ' : ' + plan.report.skipped.length +
                 '<br><span style="color:var(--txt3);font-size:11px">' +
                 esc(plan.report.skipped.slice(0, 8).map(function (x) { return x.id; }).join(', ')) +
                 (plan.report.skipped.length > 8 ? ' …' : '') + '</span></div>';
      }
      $('apm_result').innerHTML =
        '<div class="note-line" style="border-color:var(--ok)"><strong>' + esc(tr('doneT')) + '</strong><br>' + esc(tr('doneD')) + '</div>' + extra;
      $('apm_cancel').disabled = false;
      $('apm_cancel').textContent = tr('close');

      // On repart proprement : rattrapage complet puis redessin.
      try { await AP.sync.pull(); } catch (e) {}
      X.repaint();
      say(tr('doneT'));
    } catch (e) {
      warn('migration : ' + (e && e.message));
      $('apm_result').innerHTML =
        '<div class="note-line" style="border-color:var(--bad)"><strong>' + esc(tr('failT')) + '</strong><br>' +
        esc(tr('failD')) + '<br><span style="color:var(--txt3);font-size:11px">' + esc(String(e && e.message)) + '</span></div>';
      $('apm_cancel').disabled = false;
      $('apm_start').disabled = false; $('apm_start').style.opacity = '1';
      $('apm_start').textContent = tr('retry');
    }
  }

  /* ==========================================================================
     8. DECLENCHEMENT AUTOMATIQUE
     --------------------------------------------------------------------------
     On ne surgit PAS au milieu du travail de l'artisan. La regle :
       - il faut une session ouverte ET une organisation connue,
       - il faut quelque chose a demenager,
       - il ne faut pas que ce soit deja fait pour cette organisation,
       - et on laisse 1,5 seconde a l'application pour finir de s'afficher,
         sinon la fenetre apparait sur un ecran encore vide et inquiete.

     LA FAUTE QUI RENDAIT TOUT CECI INUTILE — A NE JAMAIS REFAIRE.
     -------------------------------------------------------------
     maybeOffer() n'etait appele qu'UNE fois, depuis le bloc en ligne place a
     la toute fin de index.html. A cet instant precis, app/supabase-client.js
     n'a pas encore fini de fabriquer le client (il va chercher la librairie
     sur le reseau : plusieurs centaines de millisecondes, parfois douze
     secondes). X.session() passe donc par sb() === null et renvoie null :
     la premiere ligne de maybeOffer renvoyait false, a chaque chargement,
     sans exception. Et comme RIEN ne rappelait maybeOffer apres la connexion,
     la fenetre de transfert ne pouvait JAMAIS s'ouvrir : le proprietaire se
     connectait, ses 765 taches restaient sur son disque, il publiait la
     version vide et ne retrouvait rien sur son telephone.

     La reponse est arm() : on ne « tente sa chance » plus une seule fois au
     chargement, on s'ABONNE aux moments ou une session peut apparaitre —
     AP.auth.onChange (la brique COMPTES, qui sait quand l'identite ET
     l'organisation sont connues) et onAuthStateChange du client Supabase
     (le filet, si la brique COMPTES manque). arm() est idempotent : on peut
     l'appeler de partout sans jamais poser deux fois les memes ecouteurs.
     ========================================================================== */

  /* L'INVENTAIRE DE REFERENCE : ce que cet appareil contenait A L'OUVERTURE
     de la page, avant qu'une seule ligne ne redescende du compte.
     Pourquoi ce n'est pas un detail : maintenant que l'offre part vraiment
     apres la connexion, elle court avec le rattrapage (catchUp) qui remplit
     le store avec les taches DU COMPTE. Si l'on posait la question « y a-t-il
     quelque chose a monter ? » sur le store vivant, un telephone tout neuf
     qui vient de telecharger ses taches croirait avoir du travail local a
     transferer. On decide donc sur la photo prise a l'ouverture, qui elle ne
     ment pas : vide a l'ouverture = rien a demenager, point. */
  var INV0 = null;
  function baseline() { if (!INV0) INV0 = inventory(); return INV0; }

  /* Vrai s'il reste, sur CET appareil, du travail qui n'est pas encore monte.
     setup.js s'en sert pour n'afficher son bouton que quand il a un sens. */
  function hasLocalData() { return !isEmpty(baseline()); }

  /* Une seule fenetre a la fois. arm() peut declencher plusieurs tentatives
     rapprochees (la brique COMPTES emet « change » a chaque rafraichissement
     d'identite) : sans ce verrou, open() rebatirait la fenetre par-dessus une
     migration en cours et effacerait la barre de progression.
     `enCours` couvre le trou que `offering` ne peut pas couvrir : maybeOffer
     est asynchrone, et entre son `await X.session()` et la pose de `offering`
     une seconde tentative aurait tout le temps de passer le controle. */
  var offering = false, enCours = false;

  async function maybeOffer(opts) {
    opts = opts || {};
    if (el || offering || enCours) return false;   // deja ouverte, ou sur le point de l'etre
    enCours = true;
    try {
      var sess = await X.session();
      var org = X.orgId();
      if (!sess || !org) return false;
      if (!opts.force && alreadyDone(org)) return false;
      /* En automatique on juge sur la photo d'ouverture ; sur un clic
         explicite de l'artisan, on juge sur ce qu'il y a vraiment, maintenant. */
      var inv = opts.force ? inventory() : baseline();
      if (isEmpty(inv)) {
        // Rien a transferer : on note quand meme que c'est regle, pour ne
        // jamais reposer la question a cet artisan.
        if (!opts.force) {
          saveJournal({ startedAt: new Date().toISOString(), finishedAt: new Date().toISOString(), orgId: org, counts: {}, vide: true });
        }
        return false;
      }
      offering = true;
      var delai = (typeof opts.delay === 'number') ? opts.delay : 1500;
      setTimeout(function () { offering = false; open(opts); }, delai);
      return true;
    } catch (e) {
      offering = false; warn('maybeOffer : ' + e.message); return false;
    } finally { enCours = false; }
  }

  /* --------------------------------------------------------------------------
     arm() — POSER LES ECOUTEURS, UNE SEULE FOIS.
     index.html l'appelle apres AP.sync.bind()/init(), et ce fichier l'appelle
     aussi tout seul en fin de chargement : deux appels, un seul armement.
     Sans compte configure, AP.ready vaut null, AP.auth reste en mode local et
     maybeOffer s'arrete des sa premiere ligne : aucun ecouteur ne coute rien,
     rien ne s'affiche, rien ne part sur le reseau. Le programme est exactement
     ce qu'il est aujourd'hui.
     -------------------------------------------------------------------------- */
  var armed = false;
  function arm(opts) {
    if (armed) return false;
    armed = true;

    /* La photo d'ouverture se prend MAINTENANT, pendant que le store ne
       contient encore que le travail local. */
    baseline();

    /* ANTI-RAFALE QUI NE PERD AUCUN EVENEMENT.
       « change » peut arriver trois fois en une seconde (identite,
       organisation, droits), et le rappel du client Supabase se superpose
       aux siens. Une seule tentative suffit — mais attention au piege :
       un anti-rafale qui JETTE les appels trop rapproches peut jeter
       precisement celui qui annonce la session (au rechargement d'une page
       ou l'artisan est deja connecte, AP.ready et « change » tombent a
       quelques dizaines de millisecondes l'un de l'autre). On ne jette donc
       rien : on REPOUSSE. Le dernier evenement d'une rafale est toujours
       honore, une fois, apres la rafale. */
    var dernier = 0, reporte = null;
    function relancer() {
      var reste = 400 - (Date.now() - dernier);
      if (reste > 0) {
        if (reporte) return;                       // un report suffit
        reporte = setTimeout(function () { reporte = null; relancer(); }, reste + 30);
        return;
      }
      dernier = Date.now();
      maybeOffer(opts || {});
    }

    /* 1. LA BRIQUE COMPTES — la source de verite. Elle emet « change » quand
          elle a fini de charger l'identite : a cet instant la session est
          ouverte ET X.orgId() renvoie enfin quelque chose. */
    try {
      if (AP.auth && typeof AP.auth.onChange === 'function') { AP.auth.onChange(relancer); }
      else if (AP.auth && typeof AP.auth.on === 'function')  { AP.auth.on('change', relancer); }
    } catch (e) {}

    /* 2. LE FILET — le client Supabase lui-meme, si la brique COMPTES manque
          ou tombe en panne. On attend AP.ready : avant elle, sb() est null. */
    var pret = (window.AP && window.AP.ready) ? window.AP.ready : Promise.resolve(null);
    pret.then(function () {
      try {
        var c = X.sb();
        if (c && c.auth && c.auth.onAuthStateChange) {
          c.auth.onAuthStateChange(function (evt) {
            if (evt === 'SIGNED_OUT') return;
            /* La librairie deconseille d'appeler d'autres fonctions Supabase
               depuis l'interieur de ce rappel : on repousse d'un battement. */
            setTimeout(relancer, 0);
          });
        }
      } catch (e) {}
      /* Session deja restauree au chargement (le cas ordinaire : l'artisan
         revient sur une page ou il etait deja connecte). */
      relancer();
    }, function () { /* pas de client : on reste en local, sans bruit */ });

    return true;
  }

  /* ==========================================================================
     9. SURFACE PUBLIQUE (sous AP.sync, pas de second global)
     ========================================================================== */
  AP.sync.migrate = {
    open: open,
    close: close,
    maybeOffer: maybeOffer,
    arm: arm,
    hasLocalData: hasLocalData,
    inventory: inventory,
    backup: downloadBackup,
    snapshot: snapshot,
    done: function () { var j = journal(); return !!(j && j.finishedAt); },
    journal: journal,
    report: function () { return REPORT || (journal() || {}).report || null; },
    /* Remise a zero du marquage : utile au support (« il a change
       d'organisation, il faut refaire le transfert »). Ne touche a AUCUNE
       donnee, ni locale ni distante. */
    reset: function () { jset(JKEY, null); return true; },
    i18n: TXT
  };

  /* ==========================================================================
     10. ARMEMENT AUTOMATIQUE
     --------------------------------------------------------------------------
     index.html appelle arm() lui aussi, juste apres avoir passe le pont a la
     synchronisation — c'est la que la photo d'ouverture est la plus juste.
     On arme quand meme ici, en dernier recours : une page qui oublierait
     l'appel (ou une ancienne copie de index.html) doit malgre tout proposer le
     transfert le jour ou son proprietaire se connecte. arm() etant idempotent,
     le second appel ne fait rien du tout.
     ========================================================================== */
  arm();

})();
