/* ============================================================================
   AGENDA PRO — app/setup/setup.js
   LE PANNEAU « الربط والحساب / Connexion », ET L'HONNETETE DU BOUTON
   « تحديث البيانات / Actualiser ».
   ----------------------------------------------------------------------------
   LE PROBLEME QU'IL REGLE, DIT PAR L'UTILISATEUR
   ----------------------------------------------
     « je l'ai trouve pas connecte du tout, il n'y a AUCUNE case pour la
       connexion », et « la fonction de mise a jour ne met pas a jour ».

   Il a raison sur les deux points, et les deux ont la meme cause.

   1) Les briques SaaS (auth, sync, billing) ont une regle de politesse :
      tant que app/config.js est vide, elles ne montrent RIEN. Bonne regle
      pour un fichier qu'on distribue... mais elle produit une application
      qui n'offre aucun chemin pour sortir de cet etat. Les valeurs ne
      pouvaient etre saisies qu'en ouvrant app/config.js dans un editeur de
      texte. On ne demande pas cela a un artisan.

   2) Le bouton « Actualiser » ouvrait une fenetre d'aide qui explique
      comment demander une mise a jour a quelqu'un d'autre. Il porte une
      fleche circulaire et le mot « actualiser » : il promet une action
      qu'il n'accomplit pas.

   CE FICHIER EST DONC LA PORTE D'ENTREE.
   Il est visible meme quand tout est vide — c'est precisement quand tout est
   vide qu'on en a besoin.

   DEUX MOMENTS D'EXECUTION, ET C'EST VOULU
   ----------------------------------------
   Ce fichier est charge JUSTE APRES app/config.js et JUSTE AVANT
   app/supabase-client.js. Pourquoi cette place exacte ? Parce qu'il fait
   deux choses a deux instants differents :

     - TOUT DE SUITE (partie 0) : il verse dans window.AP_CONFIG les valeurs
       que l'artisan a saisies dans le panneau et qui dorment dans le
       localStorage. supabase-client.js, qui s'execute juste apres, les lit
       comme si elles avaient toujours ete dans config.js. C'est ce qui rend
       la saisie effective SANS ouvrir le moindre fichier.

     - PLUS TARD (parties 1 a 6) : une fois le DOM pret, il pose le bouton,
       le panneau et le bandeau.

   CE QU'IL NE FAIT PAS, VOLONTAIREMENT
   ------------------------------------
     - Il ne reimplemente ni la connexion (AP.auth.open), ni la
       synchronisation (AP.sync.runNow), ni le branchement Google
       (AP.sync.connectGoogle), ni le verrou (AP.lock). Il APPELLE ces
       briques et AFFICHE leur etat. Un panneau de reglages qui refait le
       travail des briques finit toujours par mentir sur leur etat.
     - Il ne stocke aucun secret. L'adresse Supabase et la cle « anon » sont
       publiques par nature (voir l'en-tete de app/config.js) : elles partent
       de toute facon dans le navigateur. Rien d'autre n'est enregistre ici.
     - Il ne s'ouvre jamais tout seul, sauf le bandeau du tout premier
       demarrage, refermable definitivement.
   ============================================================================ */

(function () {
  'use strict';

  var W  = window;
  var AP = (W.AP = W.AP || {});

  /* Ou suis-je ? On s'en sert pour retrouver setup.css a cote, quel que soit
     l'endroit ou le dossier « app » a ete range. Meme procede que auth.js. */
  var MOI     = (document.currentScript && document.currentScript.src) || '';
  var DOSSIER = MOI ? MOI.replace(/[^\/]*$/, '') : 'app/setup/';


  /* =========================================================================
     PARTIE 0 — LE RANGEMENT, ET LA CONFIGURATION APPLIQUEE TOUT DE SUITE
     ========================================================================= */

  var K = {
    cfg:    'agendapro_v1_setup_config',   // { supabaseUrl, supabaseAnonKey, siteUrl }
    banner: 'agendapro_v1_setup_banniere', // '1' = bandeau du premier jour deja referme
    gcal:   'agendapro_v1_setup_google'    // { lieLe, derniereSynchro, calendrier }
  };

  function jget(cle, defaut) {
    try { var v = localStorage.getItem(cle); return v ? JSON.parse(v) : defaut; }
    catch (e) { return defaut; }
  }
  function jset(cle, valeur) {
    try { localStorage.setItem(cle, JSON.stringify(valeur)); return true; }
    catch (e) {
      /* Navigation privee, quota plein, stockage bloque par la politique du
         telephone. On perd la memoire du reglage, jamais les donnees en
         cours : le panneau le dira a l'ecran plutot que d'echouer en silence. */
      return false;
    }
  }

  /* Un reglage saisi dans le panneau l'emporte sur app/config.js.
     Pourquoi ce sens-la ? Parce que taper une valeur dans le panneau est le
     geste le plus recent et le plus explicite de l'artisan. Et parce qu'il
     peut toujours revenir en arriere : le bouton « Effacer » vide le
     localStorage et redonne la main a config.js. L'inverse — config.js qui
     ecrase la saisie — donnerait un champ qui « ne prend pas », c'est-a-dire
     exactement le sentiment d'application cassee qu'on veut faire cesser. */
  function appliquerConfigLocale() {
    var perso = jget(K.cfg, null);
    if (!perso || typeof perso !== 'object') { return; }
    W.AP_CONFIG = W.AP_CONFIG || {};
    ['supabaseUrl', 'supabaseAnonKey', 'siteUrl'].forEach(function (champ) {
      var v = perso[champ];
      if (typeof v === 'string' && v.trim()) { W.AP_CONFIG[champ] = v.trim(); }
    });
  }

  /* C'EST ICI QUE TOUT SE JOUE : cet appel a lieu au chargement du script,
     donc AVANT app/supabase-client.js. Le decaler dans un DOMContentLoaded
     serait trop tard — le client Supabase aurait deja constate une
     configuration vide et se serait tu pour de bon. */
  appliquerConfigLocale();


  /* =========================================================================
     PARTIE 1 — LE DICTIONNAIRE
     Chaque texte visible existe en arabe ET en francais. Aucune phrase n'est
     ecrite en dur plus bas : pour corriger une formulation, c'est ici.
     ========================================================================= */

  var TXT = {

    /* --- le bouton et le titre --- */
    btn:        { ar: 'الربط والحساب',            fr: 'Connexion' },
    title:      { ar: 'الربط والحساب',            fr: 'Liaison et compte' },
    close:      { ar: 'إغلاق',                     fr: 'Fermer' },
    done:       { ar: 'تم',                        fr: 'Terminé' },

    /* --- le bandeau du premier demarrage --- */
    bannerTxt:  { ar: 'لم يتم ربط أجندتك بعد. يعمل البرنامج محلياً على هذا الجهاز فقط.',
                  fr: 'Votre agenda n’est pas encore lié. Le programme fonctionne en local, sur cet appareil seulement.' },
    bannerGo:   { ar: 'الربط الآن',               fr: 'Lier maintenant' },
    bannerNo:   { ar: 'لاحقاً',                    fr: 'Plus tard' },

    /* --- l'avertissement « pourquoi suis-je ici ? » --- */
    whyRefresh: { ar: 'للتحديث تلقائياً، يجب أولاً ربط أجندتك. الزر أعلاه لا يستطيع جلب أي شيء ما دام لا يوجد أي ربط.',
                  fr: 'Pour actualiser automatiquement, il faut d’abord lier votre agenda. Le bouton du haut ne peut rien aller chercher tant qu’aucune liaison n’existe.' },

    /* --- les intitules des quatre lignes --- */
    hState:     { ar: 'حالة الربط',                fr: 'État des liaisons' },
    nAccount:   { ar: 'الحساب على الإنترنت',       fr: 'Compte en ligne' },
    nMigrate:   { ar: 'بياناتي المحلية',            fr: 'Mes données locales' },
    nGoogle:    { ar: 'أجندة Google',              fr: 'Agenda Google' },
    nGemini:    { ar: 'Gemini (جملة اليوم)',       fr: 'Gemini (phrase du jour)' },
    nLock:      { ar: 'كلمة سر البرنامج',          fr: 'Mot de passe du programme' },

    /* --- le transfert des donnees de CET appareil vers le compte ---------
       Cette ligne n'apparait que dans un seul cas : il y a du travail
       enregistre sur cet appareil ET une session ouverte. Autrement dit,
       elle ne s'adresse qu'a l'artisan qui vient de se connecter depuis sa
       copie locale — celui dont les donnees doivent monter. Ailleurs (un
       telephone tout neuf, un poste sans compte), elle n'existe pas. */
    migReady:   { ar: 'يوجد عمل محفوظ على هذا الجهاز لم يُرفع بعد إلى حسابك.',
                  fr: 'Du travail est enregistré sur cet appareil et n’est pas encore monté dans votre compte.' },
    migBtn:     { ar: 'رفع بياناتي المحلية',        fr: 'Transférer mes données locales' },
    migDone:    { ar: 'تم رفع بيانات هذا الجهاز إلى حسابك.',
                  fr: 'Les données de cet appareil ont été transférées dans votre compte.' },
    migAgain:   { ar: 'إعادة الرفع',                fr: 'Refaire le transfert' },

    /* --- compte en ligne --- */
    accNone:    { ar: 'غير مهيّأ — املأ الحقلين أسفله',
                  fr: 'Non configuré — remplissez les deux champs ci-dessous' },
    accDown:    { ar: 'مهيّأ، لكن الخادم غير متاح — العمل محفوظ على هذا الجهاز',
                  fr: 'Configuré, serveur injoignable — le travail reste sur cet appareil' },
    accOut:     { ar: 'مهيّأ، غير متصل',           fr: 'Configuré, non connecté' },
    accWait:    { ar: 'مهيّأ — جارٍ الاتصال…',      fr: 'Configuré — connexion en cours…' },
    accIn:      { ar: 'متصل باسم <b>{x}</b>',      fr: 'Connecté en tant que <b>{x}</b>' },
    accSignIn:  { ar: 'تسجيل الدخول',              fr: 'Se connecter' },
    accMine:    { ar: 'حسابي',                     fr: 'Mon compte' },

    /* --- agenda Google --- */
    gNoAcc:     { ar: 'لا يمكن الربط ما دام الحساب على الإنترنت غير مهيّأ',
                  fr: 'Pas de liaison possible tant que le compte en ligne n’est pas configuré' },
    gNoLog:     { ar: 'لا يمكن الربط ما دمت غير متصل بحسابك',
                  fr: 'Pas de liaison possible tant que vous n’êtes pas connecté à votre compte' },
    gReady:     { ar: 'جاهز للربط',                fr: 'Prêt à lier' },
    gLinked:    { ar: 'مربوط — آخر مزامنة {x}',    fr: 'Lié — dernière synchro {x}' },
    gLinkedNo:  { ar: 'مربوط — لم تتم أي مزامنة بعد',
                  fr: 'Lié — aucune synchronisation effectuée pour l’instant' },
    gLink:      { ar: 'ربط',                       fr: 'Lier' },
    gSync:      { ar: 'زامن الآن',                 fr: 'Synchroniser' },
    gSyncing:   { ar: 'جارٍ…',                     fr: 'En cours…' },
    gForget:    { ar: 'إلغاء الربط على هذا الجهاز', fr: 'Oublier sur cet appareil' },

    /* --- agenda Google, PAR GOOGLE LUI-MEME (app/google/) ----------------
       Les phrases ci-dessus datent de l'epoque ou la liaison Google passait
       par le serveur Supabase : elles disaient, a juste titre alors, que rien
       n'etait possible sans compte en ligne. CE N'EST PLUS VRAI. Depuis que
       app/google/ existe, l'artisan lie son agenda directement, sans serveur
       et sans compte — c'est exactement ce qu'il a demande.
       On garde les anciennes phrases : le jour ou la couche Supabase se
       reveillera, elle retrouvera sa ligne intacte a cote de celle-ci. */
    gdOff:      { ar: 'غير مربوط — اربط أجندة Google لتتزامن مع الهاتف',
                  fr: 'Non lie — liez Google Agenda pour synchroniser avec le telephone' },
    gdSetup:    { ar: 'يحتاج معرّف Google — اضغط «الإعداد»',
                  fr: 'Il manque l’identifiant Google — cliquez « Reglage »' },
    gdNoCal:    { ar: 'مربوط — لكن لم تختر أي تقويم بعد',
                  fr: 'Lie — mais aucun agenda n’est coche pour l’instant' },
    gdOn:       { ar: 'مربوط بـ <b>{m}</b> — {n} تقويم، آخر مزامنة {x}',
                  fr: 'Lie a <b>{m}</b> — {n} agenda(s), derniere synchro {x}' },
    gdOnNo:     { ar: 'مربوط — {n} تقويم، لم تتم أي مزامنة بعد',
                  fr: 'Lie — {n} agenda(s), aucune synchronisation pour l’instant' },
    gdWait:     { ar: 'مربوط — {n} تعديلًا في انتظار الشبكة',
                  fr: 'Lie — {n} modification(s) attendent le reseau' },
    gdErr:      { ar: 'مربوط — آخر محاولة فشلت: {x}',
                  fr: 'Lie — la derniere tentative a echoue : {x}' },
    gdLink:     { ar: 'اربط',                      fr: 'Lier' },
    gdSetupBtn: { ar: 'الإعداد',                   fr: 'Reglage' },
    gdCals:     { ar: 'التقاويم',                  fr: 'Agendas' },
    gdSync:     { ar: 'زامن الآن',                 fr: 'Synchroniser' },
    gdForget:   { ar: 'افصل',                      fr: 'Delier' },

    /* --- Gemini --- */
    gemOff:     { ar: 'غير مهيّأ — جملة اليوم تعمل بدونه، لكن بدون ذكاء',
                  fr: 'Non configuré — la phrase du jour fonctionne sans, mais sans intelligence' },
    gemOn:      { ar: 'مهيّأ',                     fr: 'Configuré' },
    gemGo:      { ar: 'الإعداد',                   fr: 'Réglage' },

    /* --- verrou --- */
    lockOn:     { ar: 'محدّدة — يُطلب فتح القفل عند التشغيل',
                  fr: 'Définie — le programme demande le déverrouillage au démarrage' },
    lockOff:    { ar: 'غير محدّدة — يفتح البرنامج مباشرة',
                  fr: 'Non définie — le programme s’ouvre directement' },
    lockGo:     { ar: 'تغيير',                     fr: 'Modifier' },

    /* --- les champs --- */
    hFields:    { ar: 'عنوان القاعدة ومفتاحها',    fr: 'Adresse de la base et sa clé' },
    fUrl:       { ar: 'عنوان Supabase',            fr: 'Adresse Supabase' },
    fKey:       { ar: 'المفتاح العلني (anon)',     fr: 'Clé publique (anon)' },
    fSite:      { ar: 'عنوان البرنامج على الويب (اختياري)',
                  fr: 'Adresse du programme sur le web (facultatif)' },
    fSiteHint:  { ar: 'اتركه فارغاً وسيستعمل البرنامج عنوان الصفحة الحالية. املأه فقط إذا نشرت البرنامج على عنوان ثابت.',
                  fr: 'Laissez vide : le programme utilisera l’adresse de la page en cours. Ne le remplissez que si vous avez publié le programme à une adresse fixe.' },
    fPublic:    { ar: 'هاتان القيمتان علنيتان بطبيعتهما: أي زائر يستطيع قراءتهما في مصدر الصفحة. الحماية الحقيقية في قواعد RLS على الخادم، وليست هنا. لا تكتب هنا أبداً مفتاح service_role.',
                  fr: 'Ces deux valeurs sont publiques par nature : n’importe qui peut les lire dans le code source de la page. La vraie protection, ce sont les règles RLS du serveur, pas ce champ. N’écrivez jamais ici la clé service_role.' },
    save:       { ar: 'حفظ وإعادة التشغيل',        fr: 'Enregistrer et relancer' },
    clear:      { ar: 'مسح',                       fr: 'Effacer' },
    savedOk:    { ar: 'تم الحفظ. تُعاد الصفحة الآن لتطبيق الربط…',
                  fr: 'Enregistré. La page se recharge pour appliquer la liaison…' },
    clearedOk:  { ar: 'تم المسح. تُعاد الصفحة الآن…',
                  fr: 'Effacé. La page se recharge…' },
    badUrl:     { ar: 'العنوان يجب أن يبدأ بـ https:// وينتهي بـ .supabase.co (بدون خط مائل في آخره).',
                  fr: 'L’adresse doit commencer par https:// et finir par .supabase.co (sans barre oblique finale).' },
    badKey:     { ar: 'المفتاح العلني سلسلة طويلة تبدأ بـ eyJ. تحقّق من أنك نسخت المفتاح كاملاً.',
                  fr: 'La clé publique est une longue chaîne qui commence par eyJ. Vérifiez que vous l’avez copiée en entier.' },
    badStore:   { ar: 'تعذّر الحفظ: المتصفح يمنع التخزين (تصفّح خفي أو إعدادات مشدّدة). جرّب في نافذة عادية.',
                  fr: 'Enregistrement impossible : le navigateur bloque le stockage (navigation privée ou réglages stricts). Essayez dans une fenêtre normale.' },
    emptyBoth:  { ar: 'املأ الحقلين معاً: العنوان والمفتاح.',
                  fr: 'Remplissez les deux champs ensemble : l’adresse et la clé.' },

    /* --- le guide --- */
    guide:      { ar: '📖 كيف أربط كل هذا؟ (ثلاث خطوات)', fr: '📖 Comment lier tout ceci ? (trois étapes)' },

    s1t:        { ar: '<b>أنشئ قاعدتك على Supabase.</b> افتح <a href="https://supabase.com" target="_blank" rel="noopener">supabase.com</a>، اضغط <b>Start your project</b>، ثم <b>New project</b>. اختر اسماً وكلمة سر للقاعدة، والمنطقة الأقرب إليك. انتظر دقيقتين.',
                  fr: '<b>Créez votre base sur Supabase.</b> Ouvrez <a href="https://supabase.com" target="_blank" rel="noopener">supabase.com</a>, cliquez <b>Start your project</b>, puis <b>New project</b>. Choisissez un nom, un mot de passe de base et la région la plus proche. Patientez deux minutes.' },
    s1s:        { ar: 'ما تراه على الشاشة: صفحة فيها اسم مشروعك ودائرة خضراء صغيرة مكتوب بجانبها Active.',
                  fr: 'Ce que vous voyez à l’écran : une page avec le nom de votre projet et une petite pastille verte « Active ».' },

    s2t:        { ar: '<b>انسخ العنوان والمفتاح.</b> في نفس الموقع: <span class="aps-code">Settings</span> ← <span class="aps-code">API</span>. انسخ <b>Project URL</b> إلى الحقل <b>«عنوان Supabase»</b> أعلاه، و<b>anon public</b> إلى الحقل <b>«المفتاح العلني»</b>. ثم اضغط <b>حفظ وإعادة التشغيل</b>.',
                  fr: '<b>Recopiez l’adresse et la clé.</b> Sur le même site : <span class="aps-code">Settings</span> → <span class="aps-code">API</span>. Copiez <b>Project URL</b> dans le champ <b>« Adresse Supabase »</b> ci-dessus, et <b>anon public</b> dans le champ <b>« Clé publique »</b>. Puis cliquez <b>Enregistrer et relancer</b>.' },
    s2s:        { ar: 'ما تراه على الشاشة: سطر Project URL يبدأ بـ https، وتحته مربّع anon public فيه سلسلة طويلة جداً تبدأ بـ eyJ.',
                  fr: 'Ce que vous voyez à l’écran : une ligne « Project URL » qui commence par https, et dessous un encadré « anon public » avec une très longue chaîne commençant par eyJ.' },

    s3t:        { ar: '<b>اربط أجندة Google.</b> بعد إعادة التشغيل، سجّل الدخول من هذه النافذة نفسها، ثم اضغط <b>ربط</b> في سطر «أجندة Google». يطلب منك Google الموافقة ثم يعيدك إلى هنا. إن أردت مشروع Google خاصاً بك، أنشئه في <a href="https://console.cloud.google.com" target="_blank" rel="noopener">console.cloud.google.com</a> ← <span class="aps-code">APIs &amp; Services</span> ← <span class="aps-code">Credentials</span>.',
                  fr: '<b>Liez l’agenda Google.</b> Après le redémarrage, connectez-vous depuis cette même fenêtre, puis cliquez <b>Lier</b> sur la ligne « Agenda Google ». Google vous demande votre accord et vous ramène ici. Si vous voulez votre propre projet Google, créez-le sur <a href="https://console.cloud.google.com" target="_blank" rel="noopener">console.cloud.google.com</a> → <span class="aps-code">APIs &amp; Services</span> → <span class="aps-code">Credentials</span>.' },
    s3s:        { ar: 'ما تراه على الشاشة: صفحة Google تسألك عن الإذن بقراءة أجندتك، ثم تعود إلى هذه الصفحة والنقطة أمام «أجندة Google» صارت خضراء.',
                  fr: 'Ce que vous voyez à l’écran : une page Google qui demande l’autorisation de lire votre agenda, puis un retour ici avec la pastille « Agenda Google » passée au vert.' },

    /* --- le temps ecoule, en langage courant --- */
    tNow:       { ar: 'قبل لحظات',                 fr: 'à l’instant' },
    tMin:       { ar: 'منذ {n} دقيقة',             fr: 'il y a {n} min' },
    tHour:      { ar: 'منذ {n} ساعة',              fr: 'il y a {n} h' },
    tDay:       { ar: 'منذ {n} يوم',               fr: 'il y a {n} j' },

    /* --- messages courts --- */
    syncOk:     { ar: 'تمت المزامنة',              fr: 'Synchronisation terminée' },
    syncKo:     { ar: 'تعذّرت المزامنة — انظر سطر أجندة Google',
                  fr: 'Synchronisation impossible — voyez la ligne Agenda Google' },
    forgotten:  { ar: 'تم نسيان الربط على هذا الجهاز فقط. الربط على الخادم لم يُلمس.',
                  fr: 'Liaison oubliée sur cet appareil seulement. La liaison côté serveur n’a pas été touchée.' }
  };

  function lang() {
    var l = (document.documentElement.lang || '').toLowerCase();
    return (l.indexOf('fr') === 0) ? 'fr' : 'ar';   // l'arabe est la langue par defaut
  }

  /* T('cle', {x: 'valeur'}) — les accolades sont remplacees. */
  function T(cle, vars) {
    var e = TXT[cle];
    var s = e ? (e[lang()] || e.ar || '') : '';
    if (vars) {
      Object.keys(vars).forEach(function (k) {
        s = s.split('{' + k + '}').join(vars[k]);
      });
    }
    return s;
  }

  /* Un texte venu de l'exterieur (une adresse de courriel) ne doit jamais
     etre injecte tel quel dans du HTML. */
  function esc(s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }

  function depuis(iso) {
    var t = Date.parse(iso || '');
    if (!t) { return null; }
    var min = Math.floor((Date.now() - t) / 60000);
    if (min < 1)  { return T('tNow'); }
    if (min < 60) { return T('tMin',  { n: min }); }
    if (min < 1440) { return T('tHour', { n: Math.floor(min / 60) }); }
    return T('tDay', { n: Math.floor(min / 1440) });
  }


  /* =========================================================================
     PARTIE 2 — L'ETAT REEL
     --------------------------------------------------------------------------
     Une seule fonction, en lecture seule, qui INTERROGE les briques au lieu
     de tenir un etat parallele. Un panneau de reglages qui garde sa propre
     copie de la verite finit toujours par afficher une pastille verte alors
     que rien ne marche.
     ========================================================================= */

  function cfg() { return W.AP_CONFIG || {}; }

  function etat() {
    var c   = cfg();
    var pret = !!(c.supabaseUrl && c.supabaseAnonKey);

    /* --- compte en ligne ---------------------------------------------- */
    /* AP.auth.state.mode : 'off' pas configure | 'down' injoignable
       | 'out' personne n'est connecte | 'in' quelqu'un l'est.
       On y ajoute un cinquieme cas qui n'appartient qu'a l'affichage :
       'wait'. La brique COMPTES lit son identite par le reseau ; entre le
       premier trait dessine et sa reponse, son mode vaut encore 'off'.
       Sans ce cas, le panneau annoncerait « non configure » a quelqu'un qui
       vient justement de saisir ses cles : le pire message possible. */
    var briquePresente = !!(AP.auth && AP.auth.state);
    var mode = briquePresente ? AP.auth.state.mode : 'off';
    if (!pret)                  { mode = 'off';  }
    else if (!briquePresente)   { mode = 'down'; }   // auth.js absent ou casse
    else if (mode === 'off')    { mode = 'wait'; }   // reponse pas encore arrivee
    var mail = (AP.auth && AP.auth.state && AP.auth.state.user && AP.auth.state.user.email) || '';

    /* --- agenda Google ------------------------------------------------- */
    /* La liaison elle-meme vit sur le serveur (table des jetons Google).
       Ce que nous gardons ici n'est qu'un souvenir local : « ce navigateur
       a vu la liaison aboutir, le tel jour ». Il sert a choisir la phrase et
       le bouton, jamais a autoriser quoi que ce soit — le serveur decide. */
    var g = jget(K.gcal, null) || {};

    /* --- Gemini --------------------------------------------------------- */
    var gem = '';
    try { gem = localStorage.getItem('agendapro_v1_gemkey') || ''; } catch (e) { gem = ''; }

    /* --- verrou ---------------------------------------------------------- */
    /* On n'implemente RIEN ici. Si la brique verrou existe, on lui demande
       poliment si un mot de passe est pose ; sinon la ligne disparait. */
    var lock = null;
    if (AP.lock) {
      var pose = null;
      try {
        if (typeof AP.lock.isSet === 'function')         { pose = !!AP.lock.isSet(); }
        else if (typeof AP.lock.hasPassword === 'function') { pose = !!AP.lock.hasPassword(); }
        else if (AP.lock.state && typeof AP.lock.state.set === 'boolean') { pose = AP.lock.state.set; }
      } catch (e) { pose = null; }
      lock = { present: true, pose: pose };
    }

    /* --- agenda Google par Google lui-meme (app/google/) ---------------
       La brique pont publie tout ce que cette ligne a besoin de savoir dans
       un seul objet, en lecture seule. Quand elle n'est pas chargee, on
       retombe sur l'ancien comportement, sans un message de plus. */
    var gdir = null;
    if (AP.gbridge && typeof AP.gbridge.etat === 'function') {
      try { gdir = AP.gbridge.etat(); } catch (e) { gdir = null; }
    }

    return {
      pret:   pret,
      mode:   mode,
      mail:   mail,
      google: { lie: !!g.lieLe, derniere: g.derniereSynchro || null },
      gdirect: gdir,
      gemini: !!gem,
      lock:   lock,
      /* La question a laquelle tout le reste repond : y a-t-il, oui ou non,
         de quoi aller chercher quelque chose quelque part ?
         DEUX REPONSES POSSIBLES DESORMAIS, et c'est tout le changement :
         soit la liaison Google directe (sans serveur, sans compte — la voie
         que l'artisan a choisie), soit l'ancienne liaison par le serveur.
         L'une OU l'autre suffit : le bouton « Actualiser » du haut a quelque
         chose a aller chercher des que l'une des deux repond. */
      liaison: (!!gdir && gdir.connecte && gdir.suivis > 0) ||
               (pret && mode === 'in' && !!g.lieLe)
    };
  }


  /* =========================================================================
     PARTIE 3 — LA CONSTRUCTION DU PANNEAU
     ========================================================================= */

  var elModal = null, elBouton = null, elBandeau = null;

  function injecterCSS() {
    if (document.getElementById('apsCss')) { return; }
    var l = document.createElement('link');
    l.id = 'apsCss'; l.rel = 'stylesheet'; l.href = DOSSIER + 'setup.css';
    document.head.appendChild(l);
  }

  function $(id) { return document.getElementById(id); }

  /* --- 3.1 Le bouton de la barre du haut --------------------------------
     TOUJOURS pose, meme quand rien n'est configure. C'est le coeur du
     correctif : l'artisan doit voir une porte avant d'avoir la cle.      */
  function poserBouton() {
    if ($('apsOpen')) { return; }
    var barre = document.querySelector('header .tools');
    if (!barre) { return; }

    var b = document.createElement('button');
    b.id = 'apsOpen';
    b.type = 'button';
    b.className = 'tbtn aps-open';
    b.innerHTML = '<span class="aps-dot"></span>🔗 <span class="aps-lbl"></span>';
    b.addEventListener('click', function () { ouvrir(); });

    /* On le place en tete des outils : c'est le premier geste d'une
       nouvelle installation, il ne doit pas etre le dernier bouton. */
    barre.insertBefore(b, barre.firstChild);
    elBouton = b;
  }

  /* --- 3.2 Le panneau ---------------------------------------------------- */
  function poserModale() {
    if ($('apsModal')) { return; }

    var d = document.createElement('div');
    d.className = 'modal';
    d.id = 'apsModal';
    d.innerHTML =
      '<div class="modal-in">' +
        '<div class="modal-h">' +
          '<h3 id="apsTitle"></h3>' +
          '<button type="button" class="tbtn" id="apsX">✕</button>' +
        '</div>' +
        '<div class="modal-b">' +

          '<div class="aps-why" id="apsWhy"></div>' +

          '<div class="aps-h" id="apsHState"></div>' +
          '<div class="aps-rows" id="apsRows"></div>' +

          '<hr class="aps-sep">' +

          '<div class="aps-h" id="apsHFields"></div>' +
          '<div class="fld aps-mono">' +
            '<label id="apsLUrl"></label>' +
            '<input type="text" id="apsUrl" spellcheck="false" autocomplete="off" ' +
                   'dir="ltr" placeholder="https://xxxxxxxx.supabase.co">' +
          '</div>' +
          '<div class="fld aps-mono">' +
            '<label id="apsLKey"></label>' +
            '<input type="text" id="apsKey" spellcheck="false" autocomplete="off" ' +
                   'dir="ltr" placeholder="eyJ…">' +
          '</div>' +
          '<div class="fld aps-mono">' +
            '<label id="apsLSite"></label>' +
            '<input type="text" id="apsSite" spellcheck="false" autocomplete="off" ' +
                   'dir="ltr" placeholder="https://…">' +
            '<div class="aps-hint" id="apsSiteHint"></div>' +
          '</div>' +
          '<div class="note-line" id="apsPublic"></div>' +
          '<div class="aps-msg" id="apsMsg"></div>' +

          '<details class="aps-guide">' +
            '<summary id="apsGuide"></summary>' +
            '<div class="aps-steps">' +
              '<div class="aps-step"><div class="aps-num">1</div><div class="aps-txt">' +
                '<span id="apsS1t"></span><span class="aps-see" id="apsS1s"></span></div></div>' +
              '<div class="aps-step"><div class="aps-num">2</div><div class="aps-txt">' +
                '<span id="apsS2t"></span><span class="aps-see" id="apsS2s"></span></div></div>' +
              '<div class="aps-step"><div class="aps-num">3</div><div class="aps-txt">' +
                '<span id="apsS3t"></span><span class="aps-see" id="apsS3s"></span></div></div>' +
            '</div>' +
          '</details>' +

        '</div>' +
        '<div class="modal-f">' +
          '<button type="button" class="mb" id="apsClear"></button>' +
          '<button type="button" class="mb" id="apsClose"></button>' +
          '<button type="button" class="mb pri" id="apsSave"></button>' +
        '</div>' +
      '</div>';

    document.body.appendChild(d);
    elModal = d;

    $('apsX').addEventListener('click', fermer);
    $('apsClose').addEventListener('click', fermer);
    $('apsSave').addEventListener('click', enregistrer);
    $('apsClear').addEventListener('click', effacer);

    /* Cliquer le fond noir ferme, comme partout ailleurs dans l'application. */
    d.addEventListener('click', function (ev) { if (ev.target === d) { fermer(); } });

    /* Echap ferme, pour le poste de bureau. */
    document.addEventListener('keydown', function (ev) {
      if (ev.key === 'Escape' && d.classList.contains('show')) { fermer(); }
    });
  }


  /* --- 3.3 Les quatre lignes d'etat -------------------------------------
     Chaque ligne se resume a : quelle pastille, quelle phrase, quel bouton.
     On le calcule dans une petite fonction par ligne, pour que la phrase et
     le bouton ne puissent jamais se contredire (le bouton « Lier » affiche
     a cote de « pas de liaison possible » serait le meilleur moyen de
     refaire perdre confiance).                                            */

  function ligneCompte(E) {
    if (!E.pret)           { return { dot: '',     say: T('accNone'), act: [] }; }
    if (E.mode === 'wait') { return { dot: 'warn', say: T('accWait'), act: [] }; }
    if (E.mode === 'down') { return { dot: 'warn', say: T('accDown'), act: [] }; }
    if (E.mode === 'in')  {
      return { dot: 'on', say: T('accIn', { x: esc(E.mail) }),
               act: [{ lbl: T('accMine'), fn: ouvrirCompte }] };
    }
    return { dot: 'warn', say: T('accOut'),
             act: [{ lbl: T('accSignIn'), fn: ouvrirCompte, pri: true }] };
  }

  /* --- LE TRANSFERT DES DONNEES LOCALES ------------------------------------
     La fenetre de transfert s'ouvre normalement toute seule a la premiere
     connexion (app/sync/migrate.js, arm()). Mais un automatisme qu'on ne peut
     pas rappeler a la main est un automatisme dont on depend : s'il est passe
     trop tot, si l'artisan a ferme la fenetre sans repondre, ou s'il veut
     simplement verifier, il doit exister un endroit clair ou cliquer. C'est
     cette ligne.
     Elle n'apparait QUE s'il y a quelque chose a transferer et une session
     ouverte — sinon elle ne dirait rien a personne et inquieterait tout le
     monde.                                                                  */
  function ligneMigration(E) {
    var m = (AP.sync && AP.sync.migrate) || null;
    if (!m || typeof m.open !== 'function') { return null; }
    if (!E.pret || E.mode !== 'in')         { return null; }   // pas de session : rien a dire

    var reste = false, fait = false;
    try { reste = (typeof m.hasLocalData === 'function') ? !!m.hasLocalData() : false; } catch (e) { reste = false; }
    try { fait  = (typeof m.done === 'function') ? !!m.done() : false; } catch (e) { fait = false; }

    if (!reste && !fait) { return null; }   // rien sur cet appareil, rien a raconter

    if (reste && !fait) {
      return { dot: 'warn', say: T('migReady'),
               act: [{ lbl: T('migBtn'), fn: transfererLocal, pri: true }] };
    }
    return { dot: 'on', say: T('migDone'),
             act: reste ? [{ lbl: T('migAgain'), fn: transfererLocal }] : [] };
  }

  /* LA LIGNE « أجندة Google », VERSION VIVANTE.
     --------------------------------------------------------------------------
     CE QU'ELLE DISAIT HIER, ET POURQUOI CE N'EST PLUS VRAI.
     Cette ligne annoncait « pas de liaison possible tant que le compte en
     ligne n'est pas configure ». C'etait exact quand la liaison Google passait
     par le serveur Supabase, qui gardait les jetons. Ce n'est plus le cas :
     app/google/ lie l'agenda DIRECTEMENT, depuis le navigateur, sans serveur,
     sans compte et sans abonnement. Laisser cette phrase serait dire a
     l'artisan qu'il ne peut pas faire ce qu'il vient justement de faire.

     L'ANCIENNE VOIE N'EST PAS SUPPRIMEE POUR AUTANT. Si la brique pont n'est
     pas chargee, la fonction retombe mot pour mot sur le comportement d'hier,
     juste en dessous. Le jour ou la couche Supabase se reveillera, les deux
     voies cohabiteront sans que rien soit a reecrire ici.
     -------------------------------------------------------------------------- */
  function ligneGoogleDirect(G) {
    /* Pas d'identifiant Google : la seule action qui ait un sens est d'aller
       le saisir. On ouvre le panneau de la brique, qui a le champ. */
    if (!G.configure) {
      return { dot: 'warn', say: T('gdSetup'),
               act: [{ lbl: T('gdSetupBtn'), fn: ouvrirGoogle, pri: true }] };
    }

    if (!G.connecte) {
      return { dot: '', say: T('gdOff'),
               act: [{ lbl: T('gdLink'), fn: lierGoogleDirect, pri: true }] };
    }

    /* Lie, mais rien de coche : c'est l'etat le plus trompeur de tous, parce
       que tout a l'air en place et que rien n'arrive. On le dit, et on met en
       avant le bouton qui mene aux cases a cocher. */
    if (!G.suivis) {
      return { dot: 'warn', say: T('gdNoCal'),
               act: [
                 { lbl: T('gdCals'),   fn: ouvrirGoogle, pri: true },
                 { lbl: T('gdForget'), fn: delierGoogleDirect }
               ] };
    }

    /* Lie et actif. La phrase dit l'essentiel : qui, combien, et quand.
       Trois cas viennent avant, parce qu'ils sont plus urgents a savoir. */
    var say;
    var pastille = 'on';
    if (G.erreur) {
      pastille = 'bad';
      say = T('gdErr', { x: esc(G.erreur) });
    } else if (G.enAttente) {
      pastille = 'warn';
      say = T('gdWait', { n: G.enAttente });
    } else if (!G.derniere) {
      pastille = 'warn';
      say = T('gdOnNo', { n: G.suivis });
    } else {
      say = T('gdOn', { m: esc(G.courriel || "—"), n: G.suivis, x: esc(G.depuis) });
    }

    return {
      dot: pastille,
      say: say,
      act: [
        { lbl: G.enCours ? T('gSyncing') : T('gdSync'), fn: synchroniserGoogle, pri: true, id: 'apsGSyncBtn' },
        { lbl: T('gdCals'),   fn: ouvrirGoogle },
        { lbl: T('gdForget'), fn: delierGoogleDirect }
      ]
    };
  }

  function ligneGoogle(E) {
    /* LA VOIE D'AUJOURD'HUI D'ABORD : Google en direct, sans serveur. */
    if (E.gdirect && E.gdirect.disponible) { return ligneGoogleDirect(E.gdirect); }

    /* LA VOIE D'HIER, intacte, pour le jour ou Supabase reviendra. */
    if (!E.pret)           { return { dot: '', say: T('gNoAcc'), act: [] }; }
    if (E.mode === 'wait') { return { dot: '', say: T('accWait'), act: [] }; }
    if (E.mode !== 'in')   { return { dot: '', say: T('gNoLog'), act: [] }; }

    if (!E.google.lie) {
      return { dot: 'warn', say: T('gReady'),
               act: [{ lbl: T('gLink'), fn: lierGoogle, pri: true }] };
    }
    var quand = depuis(E.google.derniere);
    return {
      dot: 'on',
      say: quand ? T('gLinked', { x: quand }) : T('gLinkedNo'),
      act: [
        { lbl: T('gSync'),   fn: synchroniser, pri: true, id: 'apsSyncBtn' },
        { lbl: T('gForget'), fn: oublierGoogle }
      ]
    };
  }

  function ligneGemini(E) {
    return {
      dot: E.gemini ? 'on' : '',
      say: E.gemini ? T('gemOn') : T('gemOff'),
      act: [{ lbl: T('gemGo'), fn: allerGemini }]
    };
  }

  function ligneVerrou(E) {
    if (!E.lock) { return null; }               // brique absente : pas de ligne
    if (E.lock.pose === null) { return null; }  // brique presente mais muette
    return {
      dot: E.lock.pose ? 'on' : '',
      say: E.lock.pose ? T('lockOn') : T('lockOff'),
      act: (AP.lock && typeof AP.lock.open === 'function')
             ? [{ lbl: T('lockGo'), fn: function () { try { AP.lock.open(); } catch (e) {} } }]
             : []
    };
  }

  function dessinerLignes() {
    var hote = $('apsRows'); if (!hote) { return; }
    var E = etat();

    var lignes = [
      { nom: T('nAccount'), l: ligneCompte(E) },
      { nom: T('nMigrate'), l: ligneMigration(E) },
      { nom: T('nGoogle'),  l: ligneGoogle(E) },
      { nom: T('nGemini'),  l: ligneGemini(E) },
      { nom: T('nLock'),    l: ligneVerrou(E) }
    ].filter(function (x) { return !!x.l; });

    hote.textContent = '';

    lignes.forEach(function (x) {
      var row = document.createElement('div');
      row.className = 'aps-row';

      var dot = document.createElement('div');
      dot.className = 'aps-dot' + (x.l.dot ? ' ' + x.l.dot : '');
      row.appendChild(dot);

      var body = document.createElement('div');
      body.className = 'aps-body';
      /* Le nom est un de NOS textes, la phrase aussi : le seul fragment
         venu de l'exterieur (l'adresse de courriel) a deja ete echappe. */
      body.innerHTML = '<div class="aps-name">' + x.nom + '</div>' +
                       '<div class="aps-say">' + x.l.say + '</div>';
      row.appendChild(body);

      var act = document.createElement('div');
      act.className = 'aps-act';
      (x.l.act || []).forEach(function (a) {
        var b = document.createElement('button');
        b.type = 'button';
        b.className = a.pri ? 'mb pri' : 'tbtn';
        b.textContent = a.lbl;
        if (a.id) { b.id = a.id; }
        b.addEventListener('click', a.fn);
        act.appendChild(b);
      });
      row.appendChild(act);

      hote.appendChild(row);
    });

    majPastilleBouton(E);
  }

  /* La pastille du bouton de la barre du haut : verte si tout tourne, orange
     s'il reste un geste a faire, grise si rien n'est configure. */
  function majPastilleBouton(E) {
    if (!elBouton) { return; }
    E = E || etat();
    var d = elBouton.querySelector('.aps-dot');
    if (!d) { return; }
    /* Vert : quelque chose est reellement lie. Orange : il reste un geste a
       faire — un compte configure sans session, OU un identifiant Google
       renseigne sans liaison. Gris : rien n'est configure, et c'est un etat
       parfaitement normal pour qui travaille en local. */
    var aFaire = E.pret || !!(E.gdirect && E.gdirect.configure && !E.gdirect.connecte)
                        || !!(E.gdirect && E.gdirect.connecte && !E.gdirect.suivis);
    d.className = 'aps-dot' + (E.liaison ? ' on' : (aFaire ? ' warn' : ''));
  }


  /* --- 3.4 Les textes du panneau, retraduits a chaque changement de langue */
  function traduire() {
    if (elBouton) {
      var lbl = elBouton.querySelector('.aps-lbl');
      if (lbl) { lbl.textContent = T('btn'); }
      elBouton.setAttribute('title', T('title'));
      elBouton.setAttribute('aria-label', T('title'));
    }
    if (!elModal) { return; }

    var simples = {
      apsTitle: 'title', apsHState: 'hState', apsHFields: 'hFields',
      apsLUrl: 'fUrl', apsLKey: 'fKey', apsLSite: 'fSite',
      apsSiteHint: 'fSiteHint', apsPublic: 'fPublic',
      apsSave: 'save', apsClear: 'clear', apsClose: 'close',
      apsGuide: 'guide', apsWhy: 'whyRefresh',
      apsS1s: 's1s', apsS2s: 's2s', apsS3s: 's3s'
    };
    Object.keys(simples).forEach(function (id) {
      var e = $(id); if (e) { e.textContent = T(simples[id]); }
    });

    /* Les trois etapes contiennent des liens et du gras : ce sont nos
       propres chaines, jamais une saisie utilisateur. */
    ['s1t', 's2t', 's3t'].forEach(function (k) {
      var e = $('aps' + k.charAt(0).toUpperCase() + k.slice(1));
      if (e) { e.innerHTML = T(k); }
    });

    dessinerLignes();
  }

  /* Expose la traduction aux autres briques et a la console, sans leur
     donner acces au dictionnaire lui-meme (qu'elles pourraient modifier). */
  function traduireS(cle, vars) { return T(cle, vars); }


  /* =========================================================================
     PARTIE 4 — LES ACTIONS
     ========================================================================= */

  function toast(msg) {
    if (AP.ui && typeof AP.ui.toast === 'function') { AP.ui.toast(msg); return; }
    if (typeof W.toast === 'function') { try { W.toast(msg); return; } catch (e) {} }
  }

  function message(texte, ok) {
    var m = $('apsMsg'); if (!m) { return; }
    m.textContent = texte;
    m.className = 'aps-msg show ' + (ok ? 'ok' : 'bad');
  }
  function effacerMessage() {
    var m = $('apsMsg'); if (m) { m.className = 'aps-msg'; m.textContent = ''; }
  }

  /* --- 4.1 Ouvrir et fermer ---------------------------------------------- */
  function ouvrir(pourquoi) {
    poserModale();
    traduire();

    /* Les champs affichent ce qui est REELLEMENT en vigueur, y compris une
       valeur venue de config.js : sinon l'artisan croit les champs vides
       alors que l'application est configuree. */
    var c = cfg();
    if ($('apsUrl'))  { $('apsUrl').value  = c.supabaseUrl     || ''; }
    if ($('apsKey'))  { $('apsKey').value  = c.supabaseAnonKey || ''; }
    if ($('apsSite')) { $('apsSite').value = c.siteUrl         || ''; }
    effacerMessage();

    var why = $('apsWhy');
    if (why) { why.classList.toggle('show', pourquoi === 'refresh'); }

    elModal.classList.add('show');
  }

  function fermer() {
    if (elModal) { elModal.classList.remove('show'); }
  }

  /* --- 4.2 Enregistrer les cles ------------------------------------------
     C'est LE point du correctif : ces valeurs ne devaient plus jamais
     obliger a ouvrir app/config.js dans un editeur de texte.              */
  function enregistrer() {
    var url  = ($('apsUrl')  ? $('apsUrl').value  : '').trim().replace(/\/+$/, '');
    var key  = ($('apsKey')  ? $('apsKey').value  : '').trim();
    var site = ($('apsSite') ? $('apsSite').value : '').trim().replace(/\/+$/, '');

    if (!url && !key) { message(T('emptyBoth'), false); return; }

    /* Verifications volontairement indulgentes : elles attrapent la faute de
       frappe evidente (une barre oblique de trop, une cle coupee au copier),
       pas davantage. Le vrai juge est le serveur ; refuser une adresse
       valide parce qu'elle sort de notre modele serait pire que tout. */
    if (!/^https:\/\/[^\s/]+\.supabase\.co$/i.test(url)) { message(T('badUrl'), false); return; }
    if (!/^eyJ[\w-]{10,}\./.test(key))                   { message(T('badKey'), false); return; }

    var ok = jset(K.cfg, { supabaseUrl: url, supabaseAnonKey: key, siteUrl: site });
    if (!ok) { message(T('badStore'), false); return; }

    message(T('savedOk'), true);

    /* Pourquoi recharger la page plutot que « brancher a chaud » ?
       Parce que supabase-client.js, auth.js et sync.js decident de leur
       mode UNE fois, au chargement, et n'ont pas de marche arriere. Les
       reveiller a chaud demanderait de defaire leur etat interne : c'est
       exactement le genre de raccourci qui produit une application a moitie
       connectee, la pire des situations. Un rechargement propre est plus
       lent d'une seconde et parfaitement previsible. */
    setTimeout(function () { W.location.reload(); }, 900);
  }

  function effacer() {
    try { localStorage.removeItem(K.cfg); } catch (e) { }
    message(T('clearedOk'), true);
    setTimeout(function () { W.location.reload(); }, 700);
  }

  /* --- 4.3 Le compte ------------------------------------------------------
     On n'ouvre pas notre propre formulaire de connexion : la brique COMPTES
     en a deja un, avec le mot de passe oublie, la double authentification et
     la suppression RGPD. On lui passe la main.                            */
  function ouvrirCompte() {
    if (AP.auth && typeof AP.auth.open === 'function') {
      fermer();
      try { AP.auth.open(); } catch (e) { ouvrir(); }
    }
  }

  /* --- 4.3 bis Le transfert des donnees locales ---------------------------
     On n'ecrit RIEN ici : la fenetre de transfert (sauvegarde obligatoire
     avant la moindre ecriture, inventaire detaille, rapport final) appartient
     a app/sync/migrate.js. On ferme notre panneau et on lui passe la main,
     exactement comme on le fait pour la connexion.
     On appelle open() et NON maybeOffer() : maybeOffer est le juge de
     l'ouverture AUTOMATIQUE (est-ce deja fait ? faut-il attendre que la page
     finisse de s'afficher ?). Ici l'artisan a clique : il n'y a plus rien a
     juger, et le refaire une seconde fois est justement ce qu'il demande.
     La fenetre, elle, garde toutes ses securites — la sauvegarde reste
     obligatoire avant le moindre envoi.                                     */
  function transfererLocal() {
    var m = (AP.sync && AP.sync.migrate) || null;
    if (!m || typeof m.open !== 'function') { return; }
    fermer();
    try { m.open({}); } catch (e) { ouvrir(); }
  }

  /* --- 4.4 Google ---------------------------------------------------------
     connectGoogle() quitte la page pour aller chez Google : inutile de
     prevoir un « apres », il n'y en a pas dans cette vie du script.       */
  function lierGoogle() {
    if (!(AP.sync && typeof AP.sync.connectGoogle === 'function')) { return; }
    try { AP.sync.connectGoogle({}); } catch (e) { }
  }

  function oublierGoogle() {
    try { localStorage.removeItem(K.gcal); } catch (e) { }
    toast(T('forgotten'));
    dessinerLignes();
  }

  /* --- 4.4 bis Google EN DIRECT (app/google/) -----------------------------
     La voie d'aujourd'hui : l'agenda est lie depuis le navigateur, sans
     serveur et sans compte. On ne reimplemente RIEN ici — meme discipline que
     partout ailleurs dans ce fichier : on appelle la brique et on affiche son
     etat. Les quatre fonctions ci-dessous tiennent en trois lignes chacune,
     et c'est exactement ce qu'on veut : le jour ou la brique change, cette
     page n'aura rien a apprendre.
     ------------------------------------------------------------------------ */

  function pont() { return (AP.gbridge && AP.gbridge.etat) ? AP.gbridge : null; }

  /* Le panneau Google (choix des agendas, etat detaille, message d'erreur de
     Google en toutes lettres) appartient a la brique. On ferme le notre et on
     lui passe la main, comme on le fait deja pour la connexion et pour le
     transfert des donnees locales. */
  function ouvrirGoogle() {
    var b = pont(); if (!b) { return; }
    fermer();
    try { b.ouvrir(); } catch (e) { ouvrir(); }
  }

  function lierGoogleDirect() {
    var b = pont(); if (!b) { return; }
    /* On ouvre le panneau de la brique AVANT de demander la liaison : la
       fenetre de Google va s'ouvrir par-dessus, et quand elle se refermera
       l'artisan doit retomber sur les cases a cocher, pas sur rien. */
    fermer();
    try { b.ouvrir(); b.lier(); } catch (e) { }
  }

  function delierGoogleDirect() {
    var b = pont(); if (!b) { return; }
    try { b.delier(); } catch (e) { }
    dessinerLignes();
  }

  /* LA VRAIE SYNCHRONISATION GOOGLE.
     AP.gbridge.actualiser() rend une promesse qui vaut true seulement quand la
     lecture a REELLEMENT abouti. On ne repeint donc la ligne qu'a la fin, avec
     l'etat reel : une pastille verte posee sur un echec serait pire que pas de
     pastille du tout. Le detail des chiffres et le message exact de Google
     s'affichent dans le panneau de la brique — pas ici, ou ils tiendraient mal
     sur une ligne. */
  function synchroniserGoogle() {
    var b = pont(); if (!b) { return; }

    var bt = $('apsGSyncBtn');
    if (bt) { bt.disabled = true; bt.textContent = T('gSyncing'); }

    Promise.resolve()
      .then(function () { return b.actualiser({ depuisPanneau: false }); })
      .catch(function () { return false; })
      .then(function () { dessinerLignes(); });
  }

  /* La VRAIE synchronisation. AP.sync.runNow() renvoie null en cas d'echec
     ou quand la brique n'est pas en mode « cloud » : on ne marque donc
     l'horodatage que sur un retour non nul. Une pastille verte posee sur un
     echec serait pire que pas de pastille du tout. */
  function synchroniser() {
    if (!(AP.sync && typeof AP.sync.runNow === 'function')) { return; }

    var b = $('apsSyncBtn');
    if (b) { b.disabled = true; b.textContent = T('gSyncing'); }

    Promise.resolve()
      .then(function () { return AP.sync.runNow(); })
      .then(function (r) {
        if (r) {
          var g = jget(K.gcal, {}) || {};
          g.derniereSynchro = new Date().toISOString();
          jset(K.gcal, g);
          toast(T('syncOk'));
        } else {
          toast(T('syncKo'));
        }
      })
      .catch(function () { toast(T('syncKo')); })
      .then(function () { dessinerLignes(); });
  }

  /* --- 4.5 Gemini ---------------------------------------------------------
     Le reglage existe deja, en bas de l'application. On ne le recopie pas :
     on y conduit. Deux champs de cle Gemini a deux endroits, c'est la
     garantie qu'un jour l'un des deux affichera une valeur perimee.       */
  function allerGemini() {
    fermer();
    var pan = $('pan_foot');
    if (pan && pan.classList.contains('collapsed') && typeof W.togPanel === 'function') {
      try { W.togPanel('foot'); } catch (e) { }
    }
    setTimeout(function () {
      var champ = $('gemKey');
      if (!champ) { return; }
      try { champ.scrollIntoView({ behavior: 'smooth', block: 'center' }); } catch (e) { }
      try { champ.focus(); } catch (e) { }
    }, 260);
  }


  /* =========================================================================
     PARTIE 5 — LE BOUTON « ACTUALISER », RENDU HONNETE
     --------------------------------------------------------------------------
     LE CHOIX, ET POURQUOI.
     Deux options se presentaient : griser le bouton avec une infobulle, ou
     le laisser cliquable et l'amener ici. On a retenu la SECONDE.

     Un bouton grise avec une infobulle est un cul-de-sac sur un telephone :
     il n'y a pas de survol, donc pas d'infobulle, donc un bouton mort sans
     explication. Et surtout, la plainte d'origine est « il n'y a AUCUNE case
     pour la connexion » : ce bouton est justement l'endroit ou l'artisan va
     spontanement quand il veut que ses donnees bougent. En faire le chemin
     vers le panneau resout les deux problemes d'un seul geste, au lieu
     d'ajouter un second obstacle.

     Le bouton dit donc desormais la verite dans les deux cas :
       - aucune liaison  -> il ouvre ce panneau, avec en tete la phrase
                            « pour actualiser automatiquement, il faut
                              d'abord lier votre agenda » ;
       - liaison en place -> il lance la VRAIE synchronisation (AP.sync.runNow).
     ========================================================================= */

  function actualiser() {
    var E = etat();

    /* LA VOIE D'AUJOURD'HUI, ET ELLE PASSE EN PREMIER.
       C'est la plainte n° 1 de l'artisan : ce bouton porte une fleche
       circulaire et le mot « actualiser », et il n'actualisait rien. Quand la
       brique pont est la, il lance MAINTENANT une vraie lecture de Google
       Agenda — la meme que le bouton « Synchroniser » du panneau, au meme
       endroit, avec les memes chiffres et le meme message d'erreur.

       On ne teste PAS E.liaison ici, et c'est voulu : AP.gbridge.actualiser()
       sait deja quoi faire dans chacun des trois cas, et il le fait mieux que
       nous. Pas encore lie -> il ouvre le panneau de liaison. Lie mais aucun
       agenda coche -> il le dit et ouvre la ou l'on coche. Lie et coche -> il
       synchronise. Refaire ce tri ici serait le refaire a moitie.

       ELLE NE PASSE EN PREMIER QUE SI GOOGLE EXISTE POUR CET ARTISAN.
       C'est la condition qui evite une regression tres facile a commettre :
       quelqu'un qui n'a JAMAIS entendu parler de Google mais qui a un compte
       en ligne configure doit continuer a voir sa synchronisation d'hier
       quand il appuie sur ce bouton. Tant qu'aucun identifiant Google n'est
       renseigne et qu'aucune liaison n'existe, on ne detourne rien. */
    var G = E.gdirect;
    if (G && G.disponible && (G.configure || G.connecte)) {
      var b = pont();
      if (b) {
        try { b.actualiser({ depuisPanneau: false }); return; }
        catch (e) { /* on retombe sur la voie d'hier, juste en dessous */ }
      }
    }

    /* LA VOIE D'HIER, intacte : la synchronisation par le serveur Supabase. */
    if (E.liaison) {
      toast(T('gSyncing'));
      synchroniser();
      return;
    }

    /* Pas de liaison du tout : on n'ouvre plus la notice qui explique comment
       demander une mise a jour a quelqu'un d'autre. On ouvre la porte. */
    ouvrir('refresh');
  }


  /* =========================================================================
     PARTIE 6 — LE BANDEAU DU PREMIER DEMARRAGE
     --------------------------------------------------------------------------
     UNE seule fois dans la vie de l'installation. Il ne s'ouvre pas, il ne
     recouvre rien, il ne vole pas le clavier : il signale, et il se tait
     pour toujours des qu'on le referme. Le panneau, lui, ne s'ouvre JAMAIS
     de lui-meme.
     ========================================================================= */

  function poserBandeau() {
    var deja = false;
    try { deja = localStorage.getItem(K.banner) === '1'; } catch (e) { deja = true; }
    if (deja) { return; }

    var E = etat();
    if (E.pret) {
      /* Deja configure (par config.js, ou sur un autre appareil du meme
         navigateur) : il n'y a rien a annoncer, on classe le bandeau. */
      try { localStorage.setItem(K.banner, '1'); } catch (e) { }
      return;
    }

    var entete = document.querySelector('header');
    var apres  = entete && entete.nextElementSibling;
    if (!entete) { return; }

    var d = document.createElement('div');
    d.className = 'aps-banner';
    d.id = 'apsBanner';
    d.innerHTML =
      '<span class="aps-b-ic">🔗</span>' +
      '<span class="aps-b-txt" id="apsBTxt"></span>' +
      '<span class="aps-b-act">' +
        '<button type="button" class="mb pri" id="apsBGo"></button>' +
        '<button type="button" class="mb" id="apsBNo"></button>' +
      '</span>';

    if (apres) { entete.parentNode.insertBefore(d, apres); }
    else { entete.parentNode.appendChild(d); }
    elBandeau = d;

    function textes() {
      if ($('apsBTxt')) { $('apsBTxt').textContent = T('bannerTxt'); }
      if ($('apsBGo'))  { $('apsBGo').textContent  = T('bannerGo'); }
      if ($('apsBNo'))  { $('apsBNo').textContent  = T('bannerNo'); }
    }
    textes();
    surLangue(textes);

    function classer() {
      try { localStorage.setItem(K.banner, '1'); } catch (e) { }
      if (d.parentNode) { d.parentNode.removeChild(d); }
      elBandeau = null;
    }

    $('apsBGo').addEventListener('click', function () { classer(); ouvrir(); });
    $('apsBNo').addEventListener('click', classer);
  }


  /* =========================================================================
     PARTIE 7 — LA LANGUE, ET LE DEMARRAGE
     ========================================================================= */

  var abonnesLangue = [];
  function surLangue(fn) { abonnesLangue.push(fn); }
  function prevenirLangue() {
    abonnesLangue.forEach(function (fn) { try { fn(); } catch (e) { } });
  }

  /* On suit le bouton « عربي / FR » de l'application sans toucher a sa
     fonction setLang : elle change document.documentElement.lang, et on
     regarde cet attribut. Si AP.ui existe (auth.js charge), on s'y abonne
     aussi — les deux chemins sont sans effet l'un sur l'autre. */
  function ecouterLangue() {
    try {
      new MutationObserver(prevenirLangue).observe(document.documentElement, {
        attributes: true, attributeFilter: ['lang', 'dir']
      });
    } catch (e) { }
    if (AP.ui && typeof AP.ui.onLang === 'function') {
      try { AP.ui.onLang(prevenirLangue); } catch (e) { }
    }
  }

  function brancherBriques() {
    /* La brique COMPTES previent quand quelqu'un se connecte ou se
       deconnecte : la ligne « compte » doit suivre sans rechargement. */
    if (AP.auth && typeof AP.auth.on === 'function') {
      try { AP.auth.on('change', function () { if (elModal) { dessinerLignes(); } else { majPastilleBouton(); } }); }
      catch (e) { }
    }

    if (AP.sync && typeof AP.sync.on === 'function') {
      /* Retour de chez Google : c'est le seul endroit ou l'on apprend que la
         liaison a abouti. On note le jour, et la pastille passe au vert. */
      try {
        AP.sync.on('google', function (d) {
          if (!d || !d.ok) { return; }
          var g = jget(K.gcal, {}) || {};
          g.lieLe = g.lieLe || new Date().toISOString();
          if (d.calendar_id) { g.calendrier = d.calendar_id; }
          jset(K.gcal, g);
          if (elModal) { dessinerLignes(); } else { majPastilleBouton(); }
        });
      } catch (e) { }

      try {
        AP.sync.on('status', function () {
          if (elModal && elModal.classList.contains('show')) { dessinerLignes(); }
          else { majPastilleBouton(); }
        });
      } catch (e) { }
    }

    /* LE MOTEUR GOOGLE EN DIRECT (app/google/gsync.js).
       Meme besoin, meme reponse : quand il a fini de lire, quand il a envoye
       des annotations, ou quand la file d'attente bouge, la ligne « أجندة
       Google » doit suivre sans qu'on recharge la page. On s'abonne au moteur
       lui-meme et non au pont : le pont ne fait que passer, et un abonnement
       qui passe par deux intermediaires est un abonnement qu'on oublie de
       defaire. */
    if (AP.gsync && typeof AP.gsync.on === 'function') {
      ['lecture', 'envoye', 'file', 'agendas', 'jeton'].forEach(function (evt) {
        try {
          AP.gsync.on(evt, function () {
            if (elModal && elModal.classList.contains('show')) { dessinerLignes(); }
            else { majPastilleBouton(); }
          });
        } catch (e) { }
      });
    }
  }

  function demarrer() {
    injecterCSS();
    poserBouton();
    traduire();          // pose le libelle du bouton, meme panneau non construit
    ecouterLangue();
    surLangue(traduire);
    brancherBriques();
    majPastilleBouton();
    poserBandeau();

    /* La brique COMPTES lit son identite de facon asynchrone : au premier
       affichage, mode vaut encore 'out' alors que la session existe. Deux
       rafraichissements espaces suffisent a rattraper ce decalage sans
       installer une minuterie permanente. */
    setTimeout(function () { majPastilleBouton(); if (elModal) { dessinerLignes(); } }, 1200);
    setTimeout(function () { majPastilleBouton(); if (elModal) { dessinerLignes(); } }, 4000);
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', demarrer);
  } else {
    demarrer();
  }


  /* =========================================================================
     PARTIE 8 — LA SURFACE PUBLIQUE
     --------------------------------------------------------------------------
     Elle est definie MAINTENANT, a l'execution du script, et non dans
     demarrer(). index.html appelle APSetup.refresh() depuis un attribut
     onclick : si l'objet n'existait qu'apres DOMContentLoaded, un clic
     precoce tomberait dans le vide.
     ========================================================================= */

  W.APSetup = {
    open:    ouvrir,          // ouvrir()  ou  ouvrir('refresh')
    close:   fermer,
    refresh: actualiser,      // ce que fait desormais le bouton « Actualiser »
    state:   etat,            // lecture seule, pour la console ou un test
    sync:    synchroniser,
    t:       traduireS
  };

  AP.setup = W.APSetup;

})();
