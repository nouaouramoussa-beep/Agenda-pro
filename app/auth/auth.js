/* ============================================================================
   AGENDA PRO — app/auth/auth.js
   LA BRIQUE « COMPTES ».
   ----------------------------------------------------------------------------
   Ce qu'elle sait faire :
     1. inscription, connexion (mot de passe ou Google), deconnexion ;
     2. mot de passe oublie : envoi du lien, et l'ecran qui accueille le retour ;
     3. double authentification TOTP : activation avec QR code, verification,
        defi a la connexion, desactivation ;
     4. « se deconnecter de tous les appareils », cote serveur ET cote jeton ;
     5. suppression definitive du compte (RGPD), avec re-saisie de l'adresse ;
     6. export de ses donnees en JSON et en CSV (RGPD) ;
     7. une pastille d'etat dans la barre du haut, avec son menu ;
     8. le masquage des boutons d'ecriture pour un compte « viewer ».

   LA REGLE QUI PASSE AVANT TOUTES LES AUTRES
   ------------------------------------------
   Si app/config.js n'est pas rempli, ce fichier ne fait RIEN : pas d'ecran,
   pas de requete, pas un mot dans la console. L'application reste le tableau
   de bord local qu'elle est aujourd'hui. Et si le serveur est configure mais
   injoignable (atelier sans internet), elle affiche « hors ligne » et continue
   de travailler dans le localStorage. On ne casse jamais l'existant.

   OU EST LA VRAIE SECURITE ?
   --------------------------
   PAS ICI. Tout ce fichier tourne dans le navigateur du client : il est
   lisible, modifiable, contournable. Les regles qui protegent reellement les
   donnees sont les policies RLS du dossier saas/ du projet. Ce fichier ne fait
   que parler poliment au serveur et eviter d'afficher des boutons qui
   echoueraient. Chaque fois que vous lirez « le serveur decide », c'est litteral.
   ============================================================================ */

(function () {
  'use strict';

  var W = window;
  W.AP = W.AP || {};
  var AP = W.AP;

  /* Ou se trouve ce fichier ? On s'en sert pour retrouver auth.css et
     auth-ui.html qui sont a cote, ou que vous ayez range le dossier « app ». */
  var MOI = (document.currentScript && document.currentScript.src) || '';
  var DOSSIER = MOI ? MOI.replace(/[^\/]*$/, '') : 'app/auth/';


  /* =========================================================================
     PARTIE 1 — LES OUTILS PARTAGES (window.AP.ui)
     Ils appartiennent a toutes les briques, pas seulement aux comptes : la
     langue et les petits messages sont des sujets communs.
     ========================================================================= */

  AP.ui = AP.ui || {};
  var abonnesLangue = [];

  /* La langue en cours. On la lit sur la balise <html>, donc on suit
     automatiquement le bouton « عربي / FR » de l'application sans avoir a
     modifier sa fonction setLang. */
  function langue() {
    var l = (document.documentElement.lang || '').toLowerCase();
    if (l.indexOf('ar') === 0) { return 'ar'; }
    if (l) { return 'fr'; }
    return 'ar';   // l'arabe est la langue par defaut du produit
  }
  AP.ui.lang = langue;

  /* Une brique qui veut etre prevenue d'un changement de langue s'inscrit ici. */
  AP.ui.onLang = function (fn) {
    if (typeof fn === 'function') { abonnesLangue.push(fn); }
  };
  function prevenirLangue() {
    for (var i = 0; i < abonnesLangue.length; i++) {
      try { abonnesLangue[i](langue()); } catch (e) { /* une brique cassee n'en casse pas une autre */ }
    }
  }
  AP.ui.setLang = function (l) {
    var v = (l === 'fr') ? 'fr' : 'ar';
    document.documentElement.lang = v;
    document.documentElement.dir = (v === 'ar') ? 'rtl' : 'ltr';
    prevenirLangue();
  };

  /* Le guetteur : des que quelqu'un (l'application d'origine, ou nous) change
     l'attribut lang de <html>, on retraduit. Aucune modification du code
     existant n'est donc necessaire pour que nos ecrans suivent la langue. */
  try {
    new MutationObserver(prevenirLangue).observe(document.documentElement, {
      attributes: true, attributeFilter: ['lang', 'dir']
    });
  } catch (e) { /* navigateur tres ancien : tant pis, la langue suivra au rechargement */ }

  /* Le petit bandeau qui apparait en bas. On reutilise celui de
     l'application quand il existe, pour ne pas avoir deux styles de message. */
  AP.ui.toast = function (msg) {
    if (typeof W.toast === 'function') {
      try { W.toast(msg); return; } catch (e) { /* on continue avec le repli */ }
    }
    if (!document.body) { return; }
    var el = document.getElementById('apToastFallback');
    if (!el) {
      el = document.createElement('div');
      el.id = 'apToastFallback';
      el.style.cssText = 'position:fixed;inset-inline:16px auto;bottom:18px;z-index:400;' +
        'padding:11px 16px;border-radius:12px;font-size:13px;font-weight:600;' +
        'background:var(--surface);color:var(--txt);border:1px solid var(--line);' +
        'box-shadow:var(--shadow);opacity:0;transition:opacity .2s';
      document.body.appendChild(el);
    }
    el.textContent = msg;
    el.style.opacity = '1';
    clearTimeout(el._t);
    el._t = setTimeout(function () { el.style.opacity = '0'; }, 2600);
  };


  /* =========================================================================
     PARTIE 2 — LE DICTIONNAIRE
     Chaque texte visible existe en arabe et en francais. Aucune phrase n'est
     ecrite en dur ailleurs dans le fichier : pour corriger une formulation,
     c'est ici, et ici seulement.
     ========================================================================= */

  var D = {
    /* --- pastille et menu --- */
    signIn:        { ar: 'تسجيل الدخول',            fr: 'Se connecter' },
    signOut:       { ar: 'تسجيل الخروج',            fr: 'Se deconnecter' },
    signOutAll:    { ar: 'الخروج من كل الأجهزة',    fr: 'Deconnecter tous les appareils' },
    myAccount:     { ar: 'حسابي',                   fr: 'Mon compte' },
    exportMine:    { ar: 'تصدير بياناتي',           fr: 'Exporter mes donnees' },
    deleteAccount: { ar: 'حذف الحساب',              fr: 'Supprimer mon compte' },
    retry:         { ar: 'إعادة المحاولة',          fr: 'Reessayer' },
    offline:       { ar: 'دون اتصال',               fr: 'Hors ligne' },
    localMode:     { ar: 'محلي',                    fr: 'Local' },
    notSignedIn:   { ar: 'غير مسجَّل',              fr: 'Non connecte' },

    /* --- roles (le serveur en connait quatre) --- */
    roleOwner:    { ar: 'المالك',   fr: 'Proprietaire' },
    roleAdmin:    { ar: 'مشرف',     fr: 'Administrateur' },
    roleEmployee: { ar: 'عامل',     fr: 'Employe' },
    roleViewer:   { ar: 'مُطالِع',  fr: 'Lecteur' },

    /* --- connexion / inscription --- */
    signInTitle: { ar: 'الدخول إلى أجندة برو',  fr: 'Acces a Agenda Pro' },
    tabSignIn:   { ar: 'دخول',                   fr: 'Connexion' },
    tabSignUp:   { ar: 'حساب جديد',              fr: 'Creer un compte' },
    withGoogle:  { ar: 'المتابعة بحساب Google',  fr: 'Continuer avec Google' },
    or:          { ar: 'أو',                     fr: 'ou' },
    email:       { ar: 'البريد الإلكتروني',      fr: 'Adresse e-mail' },
    emailPh:     { ar: 'nom@exemple.dz',         fr: 'nom@exemple.dz' },
    password:    { ar: 'كلمة السر',              fr: 'Mot de passe' },
    fullName:    { ar: 'الاسم الكامل',           fr: 'Nom complet' },
    /* Exemple neutre : cette page est publique, aucun nom reel n'y figure. */
    fullNamePh:  { ar: 'مثال: محمد الأمين',      fr: 'Exemple : Mohamed Lamine' },
    pwdRule:     { ar: 'ثمانية محارف على الأقل. اختر جملة تتذكّرها بدل كلمة معقّدة تنساها.',
                   fr: 'Huit caracteres au minimum. Une phrase dont vous vous souvenez vaut mieux qu’un mot complique que vous oublierez.' },
    forgot:      { ar: 'نسيت كلمة السر؟',        fr: 'Mot de passe oublie ?' },
    cancel:      { ar: 'إلغاء',                  fr: 'Annuler' },
    close:       { ar: 'إغلاق',                  fr: 'Fermer' },
    later:       { ar: 'لاحقاً',                 fr: 'Plus tard' },
    save:        { ar: 'حفظ',                    fr: 'Enregistrer' },
    createAcct:  { ar: 'إنشاء الحساب',           fr: 'Creer le compte' },

    /* --- double authentification --- */
    totpCode:  { ar: 'الرمز المكوَّن من ستة أرقام', fr: 'Code a six chiffres' },
    totpHelp:  { ar: 'افتح تطبيق المصادقة في هاتفك (Google Authenticator، Aegis، FreeOTP…) وأدخل الرمز المعروض. يتغيّر كل ثلاثين ثانية.',
                 fr: 'Ouvrez l’application d’authentification de votre telephone (Google Authenticator, Aegis, FreeOTP…) et recopiez le code affiche. Il change toutes les trente secondes.' },
    mfaVerify: { ar: 'تحقَّق',  fr: 'Verifier' },

    /* --- mot de passe oublie --- */
    resetTitle: { ar: 'استعادة كلمة السر', fr: 'Reinitialiser le mot de passe' },
    resetHelp:  { ar: 'أدخل بريدك وسنرسل لك رابطاً. الرابط صالح لمدة قصيرة، ويجب فتحه في نفس المتصفّح الذي طلبته منه.',
                  fr: 'Indiquez votre adresse : nous vous envoyons un lien. Il n’est valable que peu de temps, et doit etre ouvert dans le meme navigateur que celui qui l’a demande.' },
    sendLink:   { ar: 'أرسل الرابط', fr: 'Envoyer le lien' },
    resetSent:  { ar: 'إذا كان هذا البريد مسجَّلاً لدينا، فقد وصلته رسالة. تحقَّق أيضاً من مجلّد الرسائل غير المرغوب فيها.',
                  fr: 'Si cette adresse est enregistree chez nous, un message vient de partir. Pensez a regarder dans les indesirables.' },

    /* --- nouveau mot de passe --- */
    newPwdTitle: { ar: 'اختر كلمة سر جديدة', fr: 'Choisissez un nouveau mot de passe' },
    newPwdHelp:  { ar: 'وصلت من رابط الاستعادة. اكتب كلمة السر الجديدة مرّتين، وسيتم تسجيل دخولك مباشرة.',
                   fr: 'Vous arrivez par le lien de reinitialisation. Saisissez deux fois le nouveau mot de passe : vous serez connecte dans la foulee.' },
    newPwd:      { ar: 'كلمة السر الجديدة', fr: 'Nouveau mot de passe' },
    newPwd2:     { ar: 'أعد كتابتها',       fr: 'Repetez-la' },
    pwdMismatch: { ar: 'الكلمتان غير متطابقتين.', fr: 'Les deux saisies ne sont pas identiques.' },
    pwdShort:    { ar: 'كلمة السر قصيرة جداً (ثمانية محارف على الأقل).',
                   fr: 'Mot de passe trop court (huit caracteres au minimum).' },
    pwdChanged:  { ar: 'تم تغيير كلمة السر ✓', fr: 'Mot de passe modifie ✓' },
    pwdReauth:   { ar: 'يطلب الخادم تأكيداً حديثاً لتغيير كلمة السر. استعمل رابط «نسيت كلمة السر؟» فهو يعمل في كل الحالات.',
                   fr: 'Le serveur reclame une confirmation recente pour changer le mot de passe. Passez par « Mot de passe oublie ? » : ce chemin fonctionne dans tous les cas.' },

    /* --- mon compte --- */
    identity: { ar: 'الهوية',       fr: 'Identite' },
    org:      { ar: 'المؤسسة',      fr: 'Organisation' },
    role:     { ar: 'الدور',        fr: 'Role' },
    since:    { ar: 'عضو منذ',      fr: 'Membre depuis' },
    phone:    { ar: 'الهاتف',       fr: 'Telephone' },
    pwdTitle: { ar: 'كلمة السر',    fr: 'Mot de passe' },
    saved:    { ar: 'تم الحفظ ✓',   fr: 'Enregistre ✓' },

    /* --- securite --- */
    security:   { ar: 'الأمان — التحقّق بخطوتين', fr: 'Securite — double authentification' },
    mfaWhy:     { ar: 'كلمة السر وحدها تُسرَق. مع التحقّق بخطوتين، من يسرقها لا يدخل: ينقصه هاتفك.',
                  fr: 'Un mot de passe, ca se vole. Avec la double authentification, celui qui le vole n’entre pas : il lui manque votre telephone.' },
    mfaState:   { ar: 'الحالة', fr: 'Etat' },
    mfaOn:      { ar: 'مفعَّل ✓',   fr: 'Active ✓' },
    mfaOff:     { ar: 'غير مفعَّل', fr: 'Non active' },
    mfaEnable:  { ar: 'تفعيل التحقّق بخطوتين', fr: 'Activer la double authentification' },
    mfaDisable: { ar: 'تعطيل',   fr: 'Desactiver' },
    mfaConfirm: { ar: 'تأكيد',   fr: 'Confirmer' },
    mfaScan:    { ar: 'امسح هذا الرمز بتطبيق المصادقة، ثم أدخل الرمز الذي يعرضه.',
                  fr: 'Scannez cette image avec votre application d’authentification, puis saisissez le code qu’elle affiche.' },
    mfaSecret:  { ar: 'أو أدخل هذا المفتاح يدوياً :', fr: 'Ou saisissez cette cle a la main :' },
    mfaAskCode: { ar: 'أدخل رمزاً حالياً لتأكيد التعطيل.',
                  fr: 'Saisissez un code en cours pour confirmer la desactivation.' },
    mfaDone:    { ar: 'تم تفعيل التحقّق بخطوتين ✓', fr: 'Double authentification activee ✓' },
    mfaRemoved: { ar: 'تم تعطيل التحقّق بخطوتين.',  fr: 'Double authentification desactivee.' },
    mfaNoBackup:{ ar: 'تنبيه مهم : لا يوفّر Supabase رموز طوارئ (backup codes) عبر واجهته. إذا ضاع هاتفك فلن تدخل إلا بتدخّل مسؤول الخدمة. احتفظ بالمفتاح المكتوب أعلاه في مكان آمن، أو سجّل هاتفين.',
                  fr: 'Avertissement : Supabase ne fournit pas de codes de secours par son interface. Si vous perdez votre telephone, seule une intervention de l’administrateur du service vous rendra l’acces. Gardez la cle ecrite ci-dessus en lieu sur, ou enregistrez deux telephones.' },

    /* --- appareils --- */
    devices:     { ar: 'الأجهزة المتّصلة', fr: 'Appareils connectes' },
    thisDevice:  { ar: 'هذا الجهاز',       fr: 'Cet appareil' },
    noDevices:   { ar: 'لا يوجد جهاز مسجَّل بعد.', fr: 'Aucun appareil enregistre pour l’instant.' },
    revokeHelp:  { ar: 'زر «الخروج من كل الأجهزة» يُنهي كل الجلسات، بما فيها هذه. ستحتاج إلى تسجيل الدخول من جديد. استعمله إذا ضاع هاتفك أو حاسوبك.',
                   fr: 'Le bouton « Deconnecter tous les appareils » met fin a toutes les sessions, y compris celle-ci : il faudra vous reconnecter. C’est le geste a faire si vous perdez un telephone ou un ordinateur.' },
    revokeDone:  { ar: 'أُنهيت كل الجلسات.', fr: 'Toutes les sessions ont ete fermees.' },
    revoked:     { ar: 'أُنهيت جلستك من جهاز آخر. سجِّل الدخول من جديد.',
                   fr: 'Votre session a ete fermee depuis un autre appareil. Reconnectez-vous.' },

    /* --- export --- */
    exportTitle: { ar: 'تصدير بياناتي (اللائحة العامة لحماية البيانات)', fr: 'Exporter mes donnees (RGPD)' },
    exportHelp:  { ar: 'ملف يحتوي على حسابك ومهامك وأجهزتك وسجلّ عملياتك. JSON للحفظ الكامل، CSV لفتحه في Excel. الخادم يسمح بتصدير واحد كل أربع وعشرين ساعة.',
                   fr: 'Un fichier contenant votre compte, vos taches, vos appareils et votre journal. JSON pour tout conserver, CSV pour l’ouvrir dans Excel. Le serveur n’autorise qu’un export toutes les vingt-quatre heures.' },
    exportDone:  { ar: 'نُزّل الملف ✓', fr: 'Fichier telecharge ✓' },
    exportLocal: { ar: 'تصدير محلي (من ذاكرة المتصفّح) لأنك غير متصل.',
                   fr: 'Export local (depuis la memoire du navigateur), faute de connexion.' },

    /* --- suppression --- */
    deleteTitle:      { ar: 'حذف الحساب نهائياً', fr: 'Supprimer le compte definitivement' },
    deleteWarn:       { ar: 'الحذف نهائي ولا رجعة فيه. لا يوجد سلّة مهملات.',
                        fr: 'La suppression est definitive : il n’y a pas de corbeille, rien ne se recupere.' },
    deleteOpen:       { ar: 'أريد حذف حسابي', fr: 'Je veux supprimer mon compte' },
    deleteList:       { ar: 'سيُحذف نهائياً : حسابك، ملفّك الشخصي، المؤسسات التي أنت مالكها الوحيد بكل مهامها، أجهزتك، وربط تقويم Google. سجلّ العمليات يُجهَّل. لا رجعة في ذلك.',
                        fr: 'Seront detruits : votre compte, votre profil, les organisations dont vous etes l’unique proprietaire avec toutes leurs taches, vos appareils et la connexion a Google Calendar. Le journal est anonymise. Rien de tout cela ne se recupere.' },
    deleteRetype:     { ar: 'أعد كتابة بريدك الإلكتروني للتأكيد', fr: 'Retapez votre adresse e-mail pour confirmer' },
    deleteUnderstand: { ar: 'أفهم أن هذا الإجراء نهائي ولا يمكن التراجع عنه.',
                        fr: 'Je comprends que cette action est definitive et irreversible.' },
    deleteForever:    { ar: 'احذف نهائياً', fr: 'Supprimer definitivement' },
    deleteMismatch:   { ar: 'البريد المكتوب لا يطابق بريد الحساب.', fr: 'L’adresse saisie ne correspond pas a celle du compte.' },
    deleteDone:       { ar: 'حُذف الحساب. إلى اللقاء.', fr: 'Compte supprime. Au revoir.' },
    deleteNoServer:   { ar: 'وظيفة الحذف على الخادم غير منشورة بعد. الحذف من المتصفّح ممنوع عمداً (انظر ملف التركيب). اتّصل بمسؤول الخدمة.',
                        fr: 'La fonction de suppression du serveur n’est pas encore publiee. La suppression depuis le navigateur est volontairement interdite (voir la notice). Contactez l’administrateur du service.' },
    confirmPwd:       { ar: 'كلمة السر (للتأكيد)', fr: 'Mot de passe (pour confirmer)' },
    confirmPwdHelp:   { ar: 'يطلب الخادم تأكيداً حديثاً للهوية قبل عملية بهذه الخطورة. إن كنت تدخل عبر Google فاترك الحقل فارغاً وأعد الدخول بـ Google أولاً.',
                        fr: 'Le serveur exige une preuve d’identite recente avant un geste aussi grave. Si vous entrez par Google, laissez le champ vide et reconnectez-vous d’abord avec Google.' },

    /* --- messages du serveur, traduits --- */
    errBadLogin:   { ar: 'البريد أو كلمة السر غير صحيح.', fr: 'Adresse ou mot de passe incorrect.' },
    errNotConfirm: { ar: 'لم يتم تأكيد بريدك بعد. افتح الرسالة التي وصلتك.',
                     fr: 'Votre adresse n’est pas encore confirmee : ouvrez le message recu.' },
    errExists:     { ar: 'هذا البريد مسجَّل من قبل. جرّب تسجيل الدخول.',
                     fr: 'Cette adresse a deja un compte. Essayez de vous connecter.' },
    errRate:       { ar: 'محاولات كثيرة. انتظر قليلاً ثم أعد المحاولة.',
                     fr: 'Trop de tentatives. Patientez un instant avant de reessayer.' },
    errBadCode:    { ar: 'الرمز غير صحيح أو انتهت صلاحيته.', fr: 'Code incorrect ou expire.' },
    errNetwork:    { ar: 'تعذّر الوصول إلى الخادم. تعمل الآن دون اتصال، وبياناتك محفوظة في المتصفّح.',
                     fr: 'Serveur injoignable. Vous travaillez hors ligne : vos donnees restent dans le navigateur.' },
    errLinkDead:   { ar: 'انتهت صلاحية الرابط أو سبق استعماله. اطلب رابطاً جديداً.',
                     fr: 'Lien expire ou deja utilise. Demandez-en un nouveau.' },
    errDenied:     { ar: 'الخادم رفض العملية. صلاحياتك لا تسمح بها.',
                     fr: 'Le serveur a refuse : vos droits ne permettent pas cette action.' },
    errOnce24:     { ar: 'سبق أن طلبت تصديراً خلال أربع وعشرين ساعة. أعد المحاولة غداً.',
                     fr: 'Un export a deja ete demande dans les vingt-quatre dernieres heures.' },
    errGeneric:    { ar: 'تعذّر إتمام العملية.', fr: 'L’operation n’a pas pu aboutir.' },
    checkMail:     { ar: 'تحقّق من بريدك : أرسلنا رسالة تأكيد.',
                     fr: 'Verifiez votre boite : un message de confirmation vient de partir.' },
    welcome:       { ar: 'مرحباً بك 👋', fr: 'Bienvenue 👋' },
    signedOut:     { ar: 'تم تسجيل الخروج.', fr: 'Vous etes deconnecte.' },
    viewerNotice:  { ar: 'دورك «مُطالِع» : يمكنك القراءة فقط. أزرار الإضافة والتعديل مخفيّة لأن الخادم سيرفضها.',
                     fr: 'Votre role est « Lecteur » : vous pouvez consulter, pas modifier. Les boutons d’ecriture sont masques parce que le serveur les refuserait.' },
    uiMissing:     { ar: 'واجهة الحساب غير محمَّلة : الصفحة مفتوحة من القرص مباشرة. الصق محتوى app/auth/auth-ui.html داخل index.html، أو افتح التطبيق عبر خادم ويب.',
                     fr: 'Les ecrans de compte ne sont pas charges : la page est ouverte directement depuis le disque. Collez le contenu de app/auth/auth-ui.html dans index.html, ou servez l’application par un serveur web.' }
  };

  /* Le traducteur. Une cle inconnue renvoie la cle elle-meme : le defaut se
     voit tout de suite a l'ecran au lieu de laisser un blanc mysterieux. */
  function M(cle) {
    var e = D[cle];
    if (!e) { return cle; }
    return e[langue()] || e.fr || cle;
  }


  /* =========================================================================
     PARTIE 3 — L'ETAT, ET L'API PUBLIQUE
     ========================================================================= */

  /* mode :
       'off'  config.js vide          -> application purement locale, silence total
       'down' configure mais injoignable -> pastille « hors ligne »
       'out'  serveur joignable, personne n'est connecte
       'in'   quelqu'un est connecte                                          */
  var S = {
    mode: 'off',
    user: null,        // { id, email }
    profile: null,     // ligne public.profiles
    org: null,         // { id, name, is_personal }
    role: null,        // owner | admin | employee | viewer
    access: true,      // org_has_access() : l'abonnement couvre-t-il l'ecriture ?
    factors: [],       // facteurs TOTP verifies
    aal: null,         // 'aal1' | 'aal2'
    sessionId: null,   // identifiant de CETTE session (lu dans le jeton)
    joinedAt: null,    // date d'entree dans l'organisation courante
    orgId: null        // raccourci vers org.id, attendu par la brique SYNCHRO
  };

  var sb = null;                 // le client Supabase, quand il existe
  var ecouteurs = {};            // bus d'evenements minuscule

  function surv(ev, fn) {
    (ecouteurs[ev] = ecouteurs[ev] || []).push(fn);
  }
  function emettre(ev, data) {
    var l = ecouteurs[ev] || [];
    for (var i = 0; i < l.length; i++) {
      try { l[i](data, S); } catch (e) { /* jamais bloquant */ }
    }
  }

  /* -------------------------------------------------------------------------
     LES DROITS COTE INTERFACE.
     A LIRE : cette fonction ne protege rien du tout. Le serveur decide, point.
     Les policies RLS (003_durcissement.sql, section 11) exigent
     has_role(org_id, ['owner','admin','employee']) ET org_has_access(org_id)
     pour toute ecriture ; un « viewer » qui forcerait l'affichage d'un bouton
     recevrait simplement une erreur 403 sans qu'aucune donnee ne bouge.
     Nous recopions la meme regle ici dans un seul but : NE PAS DONNER DE FAUX
     ESPOIRS. Montrer « Ajouter une tache » a quelqu'un qui n'a pas le droit
     d'ecrire, c'est lui faire saisir son travail pour rien.
     ------------------------------------------------------------------------- */
  function can(action) {
    /* Hors ligne ou application purement locale : on ne bride rien. Le
       tableau de bord doit rester exactement ce qu'il est aujourd'hui. */
    if (S.mode !== 'in') { return true; }
    var r = S.role;
    if (action === 'owner')  { return r === 'owner'; }
    if (action === 'manage') { return r === 'owner' || r === 'admin'; }
    /* 'write' par defaut */
    return (r === 'owner' || r === 'admin' || r === 'employee') && S.access !== false;
  }

  function appliquerDroits() {
    /* On tient S.orgId a jour ici, au seul endroit par lequel passent tous
       les changements d'etat : une copie mise a jour « a la main » dans trois
       fonctions differentes finit toujours par etre oubliee dans la
       quatrieme. */
    S.orgId = S.org ? S.org.id : null;
    var h = document.documentElement;
    h.setAttribute('data-ap-role', S.role || (S.mode === 'in' ? 'inconnu' : 'local'));
    h.setAttribute('data-ap-write', can('write') ? '1' : '0');
  }

  function nomRole(r) {
    if (r === 'owner')    { return M('roleOwner'); }
    if (r === 'admin')    { return M('roleAdmin'); }
    if (r === 'employee') { return M('roleEmployee'); }
    if (r === 'viewer')   { return M('roleViewer'); }
    return '';
  }

  /* L'API que les autres briques utiliseront. Elle existe TOUJOURS, meme en
     mode purement local : ainsi AP.sync ou AP.billing peuvent ecrire
     `if (AP.auth.can('write'))` sans jamais verifier que la brique est la. */
  AP.auth = {
    state: S,
    on: surv,
    can: can,
    isViewer: function () { return S.role === 'viewer'; },
    lang: langue,
    t: M,
    /* Les fonctions suivantes sont remplacees par les vraies des que le
       client Supabase existe. En local elles ne font rien, sans erreur. */
    open:          function () { },
    signOut:       function () { return Promise.resolve(); },
    refresh:       function () { return Promise.resolve(S); },
    exportJSON:    function () { return exportLocalJSON(); },
    exportCSV:     function () { return exportLocalCSV(); },
    deleteAccount: function () { return Promise.resolve(false); },

    /* --- LE CONTRAT AVEC LES AUTRES BRIQUES -----------------------------
       La brique SYNCHRONISATION interroge AP.auth de trois facons
       differentes (elle a ete ecrite sans savoir laquelle existerait).
       On fournit les trois, pour que les briques s'emboitent sans qu'aucune
       n'ait a etre retouchee :
         AP.auth.orgId()            -> l'identifiant de l'organisation active
         AP.auth.org.id             -> la meme chose, en propriete
         AP.auth.state.orgId        -> la meme chose, dans l'etat
         AP.auth.onChange(fn)       -> synonyme de on('change', fn)
       Hors ligne, orgId() renvoie null : la synchro sait alors qu'elle n'a
       rien a envoyer et laisse l'application travailler en local.          */
    orgId:    function () { return S.org ? S.org.id : null; },
    userId:   function () { return S.user ? S.user.id : null; },
    onChange: function (fn) { surv('change', fn); }
  };

  /* Proprietes vivantes : elles suivent l'etat sans qu'on ait a les recopier
     a chaque changement (une copie oubliee, c'est un bogue silencieux). */
  try {
    Object.defineProperty(AP.auth, 'org',  { get: function () { return S.org; },  enumerable: true });
    Object.defineProperty(AP.auth, 'user', { get: function () { return S.user; }, enumerable: true });
  } catch (e) { AP.auth.org = null; AP.auth.user = null; }


  /* =========================================================================
     PARTIE 4 — L'EXPORT QUI MARCHE MEME SANS SERVEUR
     Le droit a la portabilite (RGPD article 20) ne doit pas dependre d'une
     connexion : hors ligne, on exporte ce que contient le navigateur.
     ========================================================================= */

  function telecharger(nom, contenu, type) {
    try {
      var blob = new Blob([contenu], { type: type + ';charset=utf-8' });
      var url = URL.createObjectURL(blob);
      var a = document.createElement('a');
      a.href = url; a.download = nom;
      document.body.appendChild(a);
      a.click();
      setTimeout(function () {
        URL.revokeObjectURL(url);
        if (a.parentNode) { a.parentNode.removeChild(a); }
      }, 1500);
      return true;
    } catch (e) { return false; }
  }

  function horodatage() {
    var d = new Date(), p = function (n) { return (n < 10 ? '0' : '') + n; };
    return d.getFullYear() + p(d.getMonth() + 1) + p(d.getDate()) + '-' + p(d.getHours()) + p(d.getMinutes());
  }

  function donneesLocales() {
    var out = { format: 'agenda-pro/export-local-v1', exporte_le: new Date().toISOString() };
    try { out.donnees = JSON.parse(localStorage.getItem('agendapro_v1') || '{}'); } catch (e) { out.donnees = {}; }
    try { out.preferences = JSON.parse(localStorage.getItem('agendapro_v1_pref2') || '{}'); } catch (e) { out.preferences = {}; }
    return out;
  }

  function exportLocalJSON() {
    telecharger('agenda-pro-local-' + horodatage() + '.json',
      JSON.stringify(donneesLocales(), null, 2), 'application/json');
    AP.ui.toast(M('exportLocal'));
    return Promise.resolve(true);
  }

  /* Le CSV.
     Trois details qui font la difference a l'ouverture dans Excel :
       - le « BOM » en tete, sans quoi Excel affiche l'arabe en charabia ;
       - le point-virgule comme separateur, attendu par les Excel francais ;
       - les fins de ligne Windows.
     Un export contient plusieurs tableaux (taches, appareils, journal…). Un
     fichier .csv ne sait en representer qu'un seul : on les met donc a la
     suite, chacun precede d'une ligne « ## nom du tableau ». C'est un choix
     assume, explique dans la notice. */
  function versCSV(objet) {
    var SEP = ';', NL = '\r\n', lignes = [];
    /* Si le serveur renvoyait autre chose qu'un objet (panne, version future),
       on enveloppe plutot que de planter en pleine demande RGPD. */
    if (!objet || typeof objet !== 'object' || Array.isArray(objet)) {
      objet = { export: objet };
    }

    function esc(v) {
      if (v === null || v === undefined) { return ''; }
      if (typeof v === 'object') { v = JSON.stringify(v); }
      v = String(v);
      if (v.indexOf('"') >= 0 || v.indexOf(SEP) >= 0 || v.indexOf('\n') >= 0 || v.indexOf('\r') >= 0) {
        v = '"' + v.replace(/"/g, '""') + '"';
      }
      return v;
    }

    Object.keys(objet).forEach(function (cle) {
      var val = objet[cle];
      if (val === null || val === undefined) { return; }

      if (Array.isArray(val)) {
        lignes.push('## ' + cle);
        if (!val.length) { lignes.push('(vide)'); lignes.push(''); return; }
        var cols = [];
        val.forEach(function (row) {
          if (row && typeof row === 'object') {
            Object.keys(row).forEach(function (k) { if (cols.indexOf(k) < 0) { cols.push(k); } });
          }
        });
        if (!cols.length) { cols = ['valeur']; }
        lignes.push(cols.map(esc).join(SEP));
        val.forEach(function (row) {
          lignes.push(cols.map(function (k) {
            return esc(row && typeof row === 'object' ? row[k] : row);
          }).join(SEP));
        });
        lignes.push('');
      } else if (typeof val === 'object') {
        lignes.push('## ' + cle);
        lignes.push(esc('champ') + SEP + esc('valeur'));
        Object.keys(val).forEach(function (k) {
          lignes.push(esc(k) + SEP + esc(val[k]));
        });
        lignes.push('');
      } else {
        lignes.push('## ' + cle);
        lignes.push(esc(val));
        lignes.push('');
      }
    });

    return '\uFEFF' + lignes.join(NL);
  }

  function exportLocalCSV() {
    telecharger('agenda-pro-local-' + horodatage() + '.csv', versCSV(donneesLocales()), 'text/csv');
    AP.ui.toast(M('exportLocal'));
    return Promise.resolve(true);
  }


  /* =========================================================================
     PARTIE 5 — DEMARRAGE
     ========================================================================= */

  appliquerDroits();   /* en local : data-ap-write="1", rien n'est masque */

  /* Pas de supabase-client.js, ou config.js vide : on s'arrete ici. Aucun
     ecran, aucune requete, aucun message. C'est la consigne. */
  if (!AP.ready || !AP.status || !AP.status.configured) {
    return;
  }

  AP.ready.then(function (client) {
    sb = client;
    if (!sb) {
      /* Le serveur est configure mais la librairie n'a pas pu etre
         telechargee : on le DIT (pastille orange) au lieu de laisser croire
         que la synchronisation fonctionne. */
      S.mode = 'down';
      demarrerInterface();
      return;
    }
    brancherAPI();
    demarrerInterface();
  });


  /* =========================================================================
     PARTIE 6 — LES ECHANGES AVEC LE SERVEUR
     ========================================================================= */

  /* Lire le contenu du jeton d'acces. Il contient l'identifiant de session
     (utile pour reconnaitre CET appareil) et le niveau d'authentification
     (aal1 / aal2). On le lit sans rien verifier : la signature, elle, est
     verifiee par le serveur a chaque requete. Ici c'est juste de l'affichage. */
  function contenuJeton(token) {
    try {
      var p = token.split('.')[1].replace(/-/g, '+').replace(/_/g, '/');
      while (p.length % 4) { p += '='; }
      var bin = atob(p), oct = new Uint8Array(bin.length);
      for (var i = 0; i < bin.length; i++) { oct[i] = bin.charCodeAt(i); }
      return JSON.parse(new TextDecoder('utf-8').decode(oct));
    } catch (e) { return null; }
  }

  /* Traduire une erreur du serveur en une phrase comprehensible. */
  function messageErreur(err) {
    if (!err) { return M('errGeneric'); }
    var m = String(err.message || err.msg || err).toLowerCase();
    var code = String(err.code || err.status || '');

    if (m.indexOf('failed to fetch') >= 0 || m.indexOf('networkerror') >= 0 ||
        m.indexOf('load failed') >= 0)                       { return M('errNetwork'); }
    if (m.indexOf('invalid login credentials') >= 0)         { return M('errBadLogin'); }
    if (m.indexOf('email not confirmed') >= 0)               { return M('errNotConfirm'); }
    if (m.indexOf('already registered') >= 0 ||
        m.indexOf('already been registered') >= 0)           { return M('errExists'); }
    if (m.indexOf('rate limit') >= 0 || m.indexOf('too many') >= 0 ||
        m.indexOf('for security purposes') >= 0)             { return M('errRate'); }
    if (m.indexOf('invalid totp') >= 0 || m.indexOf('invalid code') >= 0 ||
        (m.indexOf('challenge') >= 0 && m.indexOf('expired') >= 0)) { return M('errBadCode'); }
    if (m.indexOf('expired') >= 0 || m.indexOf('invalid flow state') >= 0 ||
        m.indexOf('code verifier') >= 0)                     { return M('errLinkDead'); }
    if (code === '42501' || m.indexOf('permission denied') >= 0 ||
        m.indexOf('row-level security') >= 0)                { return M('errDenied'); }
    if (m.indexOf('deja ete demande') >= 0 ||
        m.indexOf('24 dernieres heures') >= 0)               { return M('errOnce24'); }
    if (m.indexOf('password') >= 0 && m.indexOf('short') >= 0) { return M('pwdShort'); }

    /* LE MESSAGE BRUT DU SERVEUR NE VA PLUS A L'ECRAN.
       L'ancienne version se terminait par « if (err.message.length < 300)
       return err.message; », sans aucune condition. Elle recopiait donc
       telle quelle n'importe quelle phrase venue de PostgREST, de Postgres ou
       d'une Edge Function : nom de fonction, nom de colonne, nom de
       contrainte, extrait de requete, chemin interne. C'est un plan des
       entrailles offert a quiconque provoque une erreur, et de surcroit en
       francais alors que l'arabe est la langue par defaut du produit.

       On traduit desormais par LISTE BLANCHE : seules les tournures que NOUS
       avons ecrites dans nos propres fonctions SQL sont reconnues, et chacune
       renvoie une cle du dictionnaire, donc une phrase bilingue. Tout le reste
       devient « errGeneric ». Le texte brut n'apparait qu'en mode debogage
       (AP_CONFIG.debug === true), c'est-a-dire sur le poste du developpeur. */
    var BLANCHE = [
      ['droits insuffisants',                 'errDenied'],
      ['seul un proprietaire',                'errDenied'],
      ['authentification requise',            'errDenied'],
      ['non authentifie',                     'errDenied'],
      ['requise pour',                        'errDenied'],   /* re-auth ou 2FA exigee par assert_sensitive_action */
      ['appartient a une autre organisation', 'errDenied'],
      ['places epuisees',                     'errDenied'],
      ['session revoquee',                    'revoked'],
      ['trop de tentatives',                  'errRate']
    ];
    for (var b = 0; b < BLANCHE.length; b++) {
      if (m.indexOf(BLANCHE[b][0]) >= 0) { return M(BLANCHE[b][1]); }
    }

    if (W.AP_CONFIG && W.AP_CONFIG.debug === true && err.message) {
      return String(err.message).slice(0, 300);
    }
    return M('errGeneric');
  }

  function urlSite() {
    var u = (W.AP_CONFIG && W.AP_CONFIG.siteUrl) || '';
    u = String(u).replace(/\/+$/, '');
    if (u) { return u; }
    return location.origin + location.pathname;   /* repli honnete */
  }

  /* --- fiche d'identite complete : profil, organisation, role, facteurs --- */
  async function chargerIdentite() {
    var ses = null;
    try {
      var r = await sb.auth.getSession();
      ses = r && r.data ? r.data.session : null;
    } catch (e) { ses = null; }

    if (!ses || !ses.user) {
      S.mode = 'out'; S.user = null; S.profile = null;
      S.org = null; S.role = null; S.factors = []; S.aal = null;
      appliquerDroits(); emettre('change', S);
      return S;
    }

    S.user = { id: ses.user.id, email: ses.user.email || '' };
    var jeton = contenuJeton(ses.access_token) || {};
    S.aal = jeton.aal || 'aal1';
    S.sessionId = jeton.session_id || null;

    try {
      /* Le profil. La policy profile_select exige session_is_live() : si la
         ligne ne revient pas alors que la session existe, c'est tres
         probablement que quelqu'un a clique « deconnecter tous les appareils »
         depuis un autre poste. On le verifie, et on le dit. */
      var pr = await sb.from('profiles')
        .select('id, full_name, phone, locale, timezone, default_org_id, mfa_enabled, created_at')
        .eq('id', S.user.id).maybeSingle();

      if (pr.error) { throw pr.error; }

      if (!pr.data) {
        var vivante = await sb.rpc('session_is_live');
        if (!vivante.error && vivante.data === false) {
          await sb.auth.signOut({ scope: 'local' });
          AP.ui.toast(M('revoked'));
          S.mode = 'out'; appliquerDroits(); emettre('change', S);
          return S;
        }
      }
      S.profile = pr.data || null;

      /* Appartenances : c'est members.role qui fait foi, cote serveur comme
         cote affichage. */
      var me = await sb.from('members').select('org_id, role, joined_at').eq('user_id', S.user.id);
      var lignes = (me && me.data) || [];
      var choisie = null;
      if (S.profile && S.profile.default_org_id) {
        for (var i = 0; i < lignes.length; i++) {
          if (lignes[i].org_id === S.profile.default_org_id) { choisie = lignes[i]; }
        }
      }
      if (!choisie && lignes.length) { choisie = lignes[0]; }
      S.role = choisie ? choisie.role : null;
      S.joinedAt = choisie ? choisie.joined_at : null;

      if (choisie) {
        var og = await sb.from('organizations')
          .select('id, name, slug, is_personal, trial_ends_at')
          .eq('id', choisie.org_id).maybeSingle();
        S.org = (og && og.data) || null;

        /* Le paywall : org_has_access() dit si l'organisation a le droit
           d'ECRIRE (abonnement, licence ou periode d'essai). La lecture, elle,
           n'est jamais coupee — y compris pour un impaye, qui doit pouvoir
           exporter ses donnees. */
        var acc = await sb.rpc('org_has_access', { p_org: choisie.org_id });
        S.access = acc.error ? true : (acc.data !== false);
      } else {
        S.org = null; S.access = true;
      }

      /* Facteurs TOTP. La colonne profiles.mfa_enabled n'est qu'un affichage
         et le navigateur n'a PAS le droit de l'ecrire (elle est gelee par le
         declencheur a2_freeze_identity) : la verite est ici. */
      try {
        var f = await sb.auth.mfa.listFactors();
        var tous = (f && f.data && (f.data.totp || f.data.all)) || [];
        S.factors = tous.filter(function (x) { return x.status === 'verified'; });
      } catch (e) { S.factors = []; }

      S.mode = 'in';
    } catch (e) {
      /* Une panne reseau ne doit pas deconnecter : on garde la session en
         memoire et on passe en « hors ligne ». */
      S.mode = 'down';
    }

    appliquerDroits();
    emettre('change', S);
    return S;
  }

  /* --- enregistrer CET appareil (pour « mes appareils » et la revocation) --- */
  function empreinte() {
    /* Une empreinte n'autorise RIEN (le SQL le dit noir sur blanc) : elle sert
       uniquement a reconnaitre un appareil dans la liste. On la calcule sans
       rien de personnel : plateforme, taille d'ecran, fuseau, langue. */
    var brut = [
      navigator.platform || '', screen.width + 'x' + screen.height,
      (Intl.DateTimeFormat().resolvedOptions() || {}).timeZone || '',
      navigator.language || ''
    ].join('|');
    var h = 5381;
    for (var i = 0; i < brut.length; i++) { h = ((h * 33) ^ brut.charCodeAt(i)) >>> 0; }
    return 'ap' + h.toString(16) + (brut.length).toString(16) + 'x';  /* >= 8 caracteres */
  }

  function plateforme() {
    var ua = (navigator.userAgent || '').toLowerCase();
    if (ua.indexOf('android') >= 0) { return 'android'; }
    if (/iphone|ipad|ipod/.test(ua)) { return 'ios'; }
    if (ua.indexOf('windows') >= 0)  { return 'windows'; }
    if (ua.indexOf('mac os') >= 0)   { return 'macos'; }
    if (ua.indexOf('linux') >= 0)    { return 'linux'; }
    return 'web';
  }

  function etiquetteAppareil() {
    var ua = navigator.userAgent || '';
    var nav = 'Navigateur';
    if (ua.indexOf('Edg/') >= 0)      { nav = 'Edge'; }
    else if (ua.indexOf('OPR/') >= 0) { nav = 'Opera'; }
    else if (ua.indexOf('Chrome/') >= 0)  { nav = 'Chrome'; }
    else if (ua.indexOf('Firefox/') >= 0) { nav = 'Firefox'; }
    else if (ua.indexOf('Safari/') >= 0)  { nav = 'Safari'; }
    return (nav + ' — ' + plateforme()).slice(0, 80);
  }

  async function enregistrerAppareil() {
    if (S.mode !== 'in' || !S.sessionId) { return; }
    var ligne = {
      user_id: S.user.id,
      org_id: S.org ? S.org.id : null,
      session_id: S.sessionId,
      label: etiquetteAppareil(),
      platform: plateforme(),
      user_agent: (navigator.userAgent || '').slice(0, 512),
      fingerprint: empreinte(),
      last_seen_at: new Date().toISOString()
    };
    try {
      var r = await sb.from('devices').insert(ligne);
      if (r.error && String(r.error.code) === '23505') {
        /* Deja inscrit pour cette session : on remonte juste la date. On
           n'utilise pas « upsert » parce qu'il tenterait de reecrire user_id,
           colonne volontairement retiree des droits d'ecriture. */
        await sb.from('devices').update({ last_seen_at: ligne.last_seen_at })
          .eq('user_id', S.user.id).eq('session_id', S.sessionId);
      }
    } catch (e) { /* jamais bloquant : c'est un confort, pas une fonction vitale */ }
  }


  /* =========================================================================
     PARTIE 7 — LES ACTIONS DE COMPTE (branchees sur AP.auth)
     ========================================================================= */

  function brancherAPI() {

    AP.auth.signUp = async function (email, motDePasse, nom) {
      var r = await sb.auth.signUp({
        email: String(email || '').trim(),
        password: motDePasse,
        options: {
          /* full_name est lu par le declencheur handle_new_user() cote base :
             c'est lui qui cree le profil, l'organisation personnelle, les deux
             sections d'origine et la ligne « proprietaire ». Nous n'avons donc
             rien a creer depuis le navigateur. */
          data: { full_name: String(nom || '').trim() },
          emailRedirectTo: urlSite()
        }
      });
      if (r.error) { throw r.error; }
      /* Si la confirmation par courriel est active, il n'y a pas encore de
         session : on renvoie l'information au lieu de faire croire que c'est
         fini. */
      return { session: r.data ? r.data.session : null };
    };

    AP.auth.signIn = async function (email, motDePasse) {
      var r = await sb.auth.signInWithPassword({
        email: String(email || '').trim(), password: motDePasse
      });
      if (r.error) { throw r.error; }
      /* Deuxieme facteur exige ? On le demande au serveur plutot que de le
         deviner : c'est lui qui sait si un facteur est enrole. */
      try {
        var a = await sb.auth.mfa.getAuthenticatorAssuranceLevel();
        if (a && a.data && a.data.nextLevel === 'aal2' && a.data.currentLevel !== 'aal2') {
          return { mfa: true };
        }
      } catch (e) { /* si l'appel echoue, on laisse passer : le serveur refusera
                       de toute facon les actions sensibles sans aal2 */ }
      return { mfa: false };
    };

    AP.auth.signInWithGoogle = async function () {
      var r = await sb.auth.signInWithOAuth({
        provider: 'google',
        options: {
          redirectTo: urlSite(),
          /* On ne demande ICI aucun droit sur l'agenda : la brique COMPTES ne
             sert qu'a identifier la personne. C'est la brique SYNCHRONISATION
             qui reclamera les autorisations Calendar, avec access_type=offline
             et prompt=consent, sans quoi Google ne delivre pas de jeton de
             rafraichissement. Melanger les deux demandes ferait peur a
             l'utilisateur des la premiere seconde. */
          queryParams: { prompt: 'select_account' }
        }
      });
      if (r.error) { throw r.error; }
      /* La page part chez Google : il n'y a rien a attendre ici. */
    };

    AP.auth.verifyTotp = async function (code) {
      var f = await sb.auth.mfa.listFactors();
      var liste = (f && f.data && (f.data.totp || f.data.all)) || [];
      var actif = null;
      for (var i = 0; i < liste.length; i++) {
        if (liste[i].status === 'verified') { actif = liste[i]; break; }
      }
      if (!actif) { throw new Error('aucun facteur'); }
      var r = await sb.auth.mfa.challengeAndVerify({ factorId: actif.id, code: String(code || '').trim() });
      if (r.error) { throw r.error; }
      return true;
    };

    /* Deconnexion de CET appareil seulement. En version 2 de la librairie, la
       portee par defaut est « global » : on la precise donc, sinon ce bouton
       ferait la meme chose que le suivant, ce qui surprendrait. */
    AP.auth.signOut = async function () {
      try { await sb.auth.signOut({ scope: 'local' }); } catch (e) { }
      return true;
    };

    /* Deconnexion de TOUS les appareils.
       L'ordre compte. On appelle d'ABORD la fonction serveur, tant qu'on est
       encore authentifie : c'est elle qui pose profiles.sessions_revoked_at,
       la date que session_is_live() compare a l'heure d'emission de chaque
       jeton. Sans elle, un jeton deja emis resterait valable jusqu'a son
       expiration (jusqu'a une heure), et le telephone vole continuerait de
       lire les donnees. signOut({scope:'global'}) seul ne suffit pas. */
    AP.auth.signOutEverywhere = async function () {
      var erreur = null;
      try {
        var r = await sb.rpc('revoke_all_sessions', { p_keep_current: false });
        if (r.error) { erreur = r.error; }
      } catch (e) { erreur = e; }
      try { await sb.auth.signOut({ scope: 'global' }); } catch (e) { }
      if (erreur) { throw erreur; }
      return true;
    };

    AP.auth.sendResetLink = async function (email) {
      var retour = urlSite();
      retour += (retour.indexOf('?') >= 0 ? '&' : '?') + 'ap=reset';
      var r = await sb.auth.resetPasswordForEmail(String(email || '').trim(), { redirectTo: retour });
      /* On ne revele JAMAIS si l'adresse existe : ce serait offrir a un
         inconnu la liste de vos clients. Meme message dans les deux cas. */
      if (r.error && String(r.error.message || '').toLowerCase().indexOf('rate') >= 0) { throw r.error; }
      return true;
    };

    AP.auth.updatePassword = async function (nouveau) {
      var r = await sb.auth.updateUser({ password: nouveau });
      if (r.error) { throw r.error; }
      return true;
    };

    AP.auth.updateProfile = async function (champs) {
      /* Seules ces colonnes sont accordees au navigateur (voir les GRANT de
         003_durcissement.sql, section 2.9). Envoyer autre chose ferait un 403. */
      var permis = {};
      ['full_name', 'phone', 'locale', 'timezone', 'default_org_id'].forEach(function (k) {
        if (champs && champs[k] !== undefined) { permis[k] = champs[k]; }
      });
      var r = await sb.from('profiles').update(permis).eq('id', S.user.id);
      if (r.error) { throw r.error; }
      await chargerIdentite();
      return true;
    };

    /* --- double authentification --------------------------------------- */
    AP.auth.mfa = {
      /* Preparer : on nettoie d'abord les tentatives inachevees, sinon
         Supabase refuse un nouvel enrolement (« factor already exists »). */
      start: async function () {
        try {
          var f = await sb.auth.mfa.listFactors();
          var liste = (f && f.data && (f.data.all || f.data.totp)) || [];
          for (var i = 0; i < liste.length; i++) {
            if (liste[i].status !== 'verified') {
              try { await sb.auth.mfa.unenroll({ factorId: liste[i].id }); } catch (e) { }
            }
          }
        } catch (e) { }
        var r = await sb.auth.mfa.enroll({
          factorType: 'totp',
          friendlyName: 'Agenda Pro ' + new Date().toISOString().slice(0, 16)
        });
        if (r.error) { throw r.error; }
        var d = r.data || {};
        return {
          id: d.id,
          qr: d.totp ? d.totp.qr_code : '',
          secret: d.totp ? d.totp.secret : '',
          uri: d.totp ? d.totp.uri : ''
        };
      },
      confirm: async function (factorId, code) {
        var r = await sb.auth.mfa.challengeAndVerify({ factorId: factorId, code: String(code || '').trim() });
        if (r.error) { throw r.error; }
        await chargerIdentite();
        return true;
      },
      /* Desactiver : Supabase exige une session de niveau aal2. On demande
         donc un code en cours AVANT de retirer le facteur. C'est aussi une
         protection : un jeton vole ne doit pas pouvoir enlever la serrure. */
      disable: async function (code) {
        var f = await sb.auth.mfa.listFactors();
        var liste = (f && f.data && (f.data.totp || f.data.all)) || [];
        var actif = null;
        for (var i = 0; i < liste.length; i++) {
          if (liste[i].status === 'verified') { actif = liste[i]; break; }
        }
        if (!actif) { return true; }
        if (code) {
          var v = await sb.auth.mfa.challengeAndVerify({ factorId: actif.id, code: String(code).trim() });
          if (v.error) { throw v.error; }
        }
        var r = await sb.auth.mfa.unenroll({ factorId: actif.id });
        if (r.error) { throw r.error; }
        await chargerIdentite();
        return true;
      }
    };

    AP.auth.devices = async function () {
      var r = await sb.rpc('my_devices');
      if (r.error) { throw r.error; }
      return r.data || [];
    };

    /* --- export RGPD --------------------------------------------------- */
    AP.auth.serverExport = async function () {
      var r = await sb.rpc('gdpr_export_account');
      if (r.error) { throw r.error; }
      return r.data;
    };

    AP.auth.exportJSON = async function () {
      if (S.mode !== 'in') { return exportLocalJSON(); }
      var d = await AP.auth.serverExport();
      telecharger('agenda-pro-' + horodatage() + '.json', JSON.stringify(d, null, 2), 'application/json');
      return true;
    };

    AP.auth.exportCSV = async function () {
      if (S.mode !== 'in') { return exportLocalCSV(); }
      var d = await AP.auth.serverExport();
      telecharger('agenda-pro-' + horodatage() + '.csv', versCSV(d), 'text/csv');
      return true;
    };

    /* --- suppression definitive ---------------------------------------- */
    /* LE NOM EXACT DE LA FONCTION DE SUPPRESSION, VERIFIE DANS LE SQL.
       La suppression RGPD est la fonction SQL public.gdpr_delete_account(
       p_force boolean default false) — definie en saas/001_schema_rls.sql
       (ligne 1752) et refaite en saas/003_durcissement.sql (ligne 913).
       C'est le SEUL nom qui existe cote serveur.

       La version precedente appelait une Edge Function 'compte-supprimer' qui
       n'est ecrite NULLE PART dans le depot : ni dans app/edge/ (qui ne
       contient que checkout, google-oauth, google-sync, license-verify et
       portal), ni dans supabase/functions/, ni dans supabase/config.toml, ni
       dans la liste de deploiement de DEPLOIEMENT.md. Cet appel ne pouvait
       donc QUE echouer, et il masquait le vrai appel derriere un repli.

       On appelle donc directement la fonction SQL, sous son nom exact. Le
       fichier 003 lui retire volontairement le droit d'execution pour
       « authenticated » (un jeton vole de quinze minutes effacerait sinon
       l'entreprise entiere) : tant que l'exploitant n'a pas re-accorde ce
       droit — ou publie une Edge Function service_role qui la rappelle —
       PostgREST repond « permission denied » et nous le DISONS honnetement,
       au lieu de faire semblant. */
    AP.auth.deleteAccount = async function (emailSaisi) {
      if (S.mode !== 'in') { return false; }
      var attendu = String((S.user && S.user.email) || '').trim().toLowerCase();
      if (String(emailSaisi || '').trim().toLowerCase() !== attendu || !attendu) {
        throw new Error(M('deleteMismatch'));
      }
      var echec = null;
      try {
        var d = await sb.rpc('gdpr_delete_account', { p_force: false });
        if (!d.error) { return true; }
        echec = d.error;
      } catch (e2) { echec = e2; }

      var msg = String((echec && (echec.message || echec)) || '').toLowerCase();
      if (msg.indexOf('not found') >= 0 || msg.indexOf('404') >= 0 ||
          msg.indexOf('permission denied') >= 0 || msg.indexOf('42501') >= 0 ||
          msg.indexOf('pgrst202') >= 0) {
        throw new Error(M('deleteNoServer'));
      }
      throw (echec || new Error(M('errGeneric')));
    };

    AP.auth.refresh = chargerIdentite;

    /* --- le serveur nous parle ----------------------------------------- */
    sb.auth.onAuthStateChange(function (event) {
      /* On repousse le traitement d'un battement : la librairie deconseille
         d'appeler d'autres fonctions Supabase depuis l'interieur de ce
         rappel, cela peut bloquer le renouvellement du jeton. */
      setTimeout(async function () {
        if (event === 'PASSWORD_RECOVERY') {
          await chargerIdentite();
          rafraichirPastille();
          ouvrir('apmNewPwd');
          return;
        }
        await chargerIdentite();
        rafraichirPastille();
        if (event === 'SIGNED_IN') { enregistrerAppareil(); }
      }, 0);
    });
  }


  /* =========================================================================
     PARTIE 8 — L'INTERFACE
     ========================================================================= */

  /* Vrai quand le morceau de page (auth-ui.html) est bien en place. Faux
     quand on a du se rabattre sur la pastille de secours : dans ce cas il n'y
     a aucune fenetre a ouvrir, et il vaut mieux le dire que de laisser
     l'utilisateur cliquer dans le vide. */
  var interfaceComplete = true;

  function $(id) { return document.getElementById(id); }

  function ouvrir(id) {
    var m = $(id); if (!m) { return; }
    m.classList.add('show');
  }
  function fermer(id) {
    var m = $(id); if (!m) { return; }
    m.classList.remove('show');
  }
  function msg(id, texte, genre) {
    var e = $(id); if (!e) { return; }
    if (!texte) { e.hidden = true; e.textContent = ''; return; }
    e.hidden = false;
    e.textContent = texte;
    e.className = 'ap-msg' + (e.classList.contains('inline') ? ' inline' : '') + (genre ? ' ' + genre : '');
  }
  function occupe(btn, oui) {
    if (!btn) { return; }
    btn.classList.toggle('ap-busy', !!oui);
  }

  /* --- injection de la feuille de style et du morceau de page ------------- */

  function injecterCSS() {
    if (document.querySelector('link[data-ap-css]')) { return; }
    var l = document.createElement('link');
    l.rel = 'stylesheet';
    l.href = DOSSIER + 'auth.css';
    l.setAttribute('data-ap-css', '1');
    document.head.appendChild(l);
  }

  function injecterHTML() {
    /* Deja colle dans index.html : rien a telecharger, et ca marche meme en
       « file:// ». C'est le chemin recommande. */
    if ($('apAuthRoot')) { return Promise.resolve(true); }
    return fetch(DOSSIER + 'auth-ui.html')
      .then(function (r) { return r.ok ? r.text() : Promise.reject(new Error('http ' + r.status)); })
      .then(function (html) {
        var d = document.createElement('div');
        d.innerHTML = html;
        while (d.firstChild) { document.body.appendChild(d.firstChild); }
        return true;
      })
      .catch(function () {
        /* Impossible de lire le fichier voisin (page ouverte depuis le disque,
           ou fichier absent). On ne laisse pas l'utilisateur sans rien : on
           fabrique une pastille minimale qui explique la situation. */
        interfaceComplete = false;
        pastilleDeSecours();
        return false;
      });
  }

  function pastilleDeSecours() {
    if ($('apBadge')) { return; }
    var d = document.createElement('div');
    d.className = 'ap-badge ap-floating';
    d.id = 'apBadge';
    d.innerHTML = '<button type="button" class="tbtn ap-badge-btn" id="apBadgeBtn">' +
      '<span class="ap-dot" id="apDot"></span>' +
      '<span class="ap-badge-lbl" id="apBadgeLbl"></span></button>';
    document.body.appendChild(d);
  }

  /* --- traduction du morceau de page ------------------------------------- */

  function traduire() {
    /* On balaie TOUTE la page, et non le seul bloc apAuthRoot : la pastille
       en est extraite pour rejoindre la barre du haut, et ses libelles
       doivent continuer de suivre la langue. Aucun autre element de
       l'application ne porte data-apt, il n'y a donc pas de risque de
       collision. */
    var r = document;
    r.querySelectorAll('[data-apt]').forEach(function (e) {
      e.textContent = M(e.getAttribute('data-apt'));
    });
    r.querySelectorAll('[data-apt-ph]').forEach(function (e) {
      e.placeholder = M(e.getAttribute('data-apt-ph'));
    });
    rafraichirPastille();
  }

  /* --- la pastille -------------------------------------------------------- */

  function rafraichirPastille() {
    var badge = $('apBadge'); if (!badge) { return; }
    var lbl = $('apBadgeLbl'), rle = $('apRoleLbl');
    badge.hidden = false;
    badge.setAttribute('data-state', S.mode === 'in' ? 'in' : (S.mode === 'down' ? 'down' : 'out'));
    badge.setAttribute('data-role', S.role || '');

    if (S.mode === 'in') {
      var nom = (S.profile && S.profile.full_name) || (S.user && S.user.email) || '';
      if (lbl) { lbl.textContent = nom; }
      if (rle) { rle.hidden = !S.role; rle.textContent = nomRole(S.role); }
      var mm = $('apMenuMail');
      if (mm) { mm.textContent = (S.user && S.user.email) || ''; }
    } else if (S.mode === 'down') {
      if (lbl) { lbl.textContent = M('offline'); }
      if (rle) { rle.hidden = true; }
    } else {
      if (lbl) { lbl.textContent = M('notSignedIn'); }
      if (rle) { rle.hidden = true; }
    }

    /* Les entrees du menu selon l'etat. */
    var menu = $('apMenu');
    if (menu) {
      menu.querySelectorAll('[data-ap-when]').forEach(function (e) {
        var q = e.getAttribute('data-ap-when');
        var voir = (q === 'in' && S.mode === 'in') ||
                   (q === 'out' && S.mode === 'out') ||
                   (q === 'down' && S.mode === 'down');
        e.hidden = !voir;
      });
    }
  }

  function placerPastille() {
    var badge = $('apBadge'); if (!badge) { return; }
    var barre = document.querySelector('header .tools') || document.querySelector('.tools');
    if (barre) {
      barre.appendChild(badge);
      badge.classList.remove('ap-floating');
    } else {
      /* Pas de barre d'outils reconnue : plutot que de disparaitre, la
         pastille se pose en haut de l'ecran. */
      badge.classList.add('ap-floating');
    }
  }


  /* =========================================================================
     PARTIE 9 — LES BRANCHEMENTS (qui fait quoi quand on clique)
     ========================================================================= */

  var ongletCourant = 'in';     /* 'in' connexion, 'up' inscription */
  var mfaEnCours = null;        /* { id } pendant un enrolement */
  var mfaMode = 'enroll';       /* 'enroll' ou 'disable' */

  function brancherInterface() {

    /* ---- pastille et menu ---- */
    var btn = $('apBadgeBtn');
    if (btn) {
      btn.addEventListener('click', function (e) {
        e.stopPropagation();
        var m = $('apMenu');
        if (!m) { return; }
        if (S.mode === 'out') { m.hidden = true; ouvrirConnexion(); return; }
        m.hidden = !m.hidden;
      });
    }
    document.addEventListener('click', function () {
      var m = $('apMenu'); if (m && !m.hidden) { m.hidden = true; }
    });
    var menu = $('apMenu');
    if (menu) {
      menu.addEventListener('click', function (e) { e.stopPropagation(); });
      menu.querySelectorAll('[data-ap-act]').forEach(function (b) {
        b.addEventListener('click', function () {
          menu.hidden = true;
          actionMenu(b.getAttribute('data-ap-act'));
        });
      });
    }

    /* ---- fermeture des fenetres ---- */
    document.querySelectorAll('[data-ap-close]').forEach(function (b) {
      b.addEventListener('click', function () { fermer(b.getAttribute('data-ap-close')); });
    });
    document.querySelectorAll('.ap-modal').forEach(function (m) {
      m.addEventListener('click', function (e) { if (e.target === m) { m.classList.remove('show'); } });
    });
    document.addEventListener('keydown', function (e) {
      if (e.key === 'Escape') {
        document.querySelectorAll('.ap-modal.show').forEach(function (m) { m.classList.remove('show'); });
      }
    });

    /* ---- l'oeil qui devoile les mots de passe ---- */
    document.querySelectorAll('[data-ap-eye]').forEach(function (b) {
      b.addEventListener('click', function () {
        var i = $(b.getAttribute('data-ap-eye'));
        if (!i) { return; }
        i.type = (i.type === 'password') ? 'text' : 'password';
      });
    });

    /* ---- onglets connexion / inscription ---- */
    document.querySelectorAll('[data-ap-tab]').forEach(function (t) {
      t.addEventListener('click', function () { basculerOnglet(t.getAttribute('data-ap-tab')); });
    });

    /* ---- connexion ---- */
    var go = $('apAuthGo');
    if (go) { go.addEventListener('click', validerAuth); }
    ['apEmail', 'apPwd', 'apName', 'apTotp'].forEach(function (id) {
      var e = $(id);
      if (e) {
        e.addEventListener('keydown', function (ev) { if (ev.key === 'Enter') { validerAuth(); } });
      }
    });
    var gg = $('apGoogleBtn');
    if (gg) {
      gg.addEventListener('click', async function () {
        occupe(gg, true);
        try { await AP.auth.signInWithGoogle(); }
        catch (e) { occupe(gg, false); msg('apAuthMsg', messageErreur(e), 'bad'); }
      });
    }
    var fg = $('apForgotBtn');
    if (fg) {
      fg.addEventListener('click', function () {
        var e = $('apEmail'), r = $('apResetMail');
        if (e && r) { r.value = e.value; }
        msg('apResetMsg', '');
        fermer('apmAuth'); ouvrir('apmReset');
      });
    }

    /* ---- lien de reinitialisation ---- */
    var rg = $('apResetGo');
    if (rg) {
      rg.addEventListener('click', async function () {
        var v = ($('apResetMail') || {}).value || '';
        if (!v.trim()) { return; }
        occupe(rg, true);
        try {
          await AP.auth.sendResetLink(v);
          msg('apResetMsg', M('resetSent'), 'ok');
        } catch (e) { msg('apResetMsg', messageErreur(e), 'bad'); }
        occupe(rg, false);
      });
    }

    /* ---- nouveau mot de passe (retour du lien) ---- */
    var np = $('apNewPwdGo');
    if (np) {
      np.addEventListener('click', async function () {
        var a = ($('apNewPwd') || {}).value || '', b = ($('apNewPwd2') || {}).value || '';
        if (a.length < 8) { msg('apNewPwdMsg', M('pwdShort'), 'bad'); return; }
        if (a !== b)      { msg('apNewPwdMsg', M('pwdMismatch'), 'bad'); return; }
        occupe(np, true);
        try {
          await AP.auth.updatePassword(a);
          msg('apNewPwdMsg', M('pwdChanged'), 'ok');
          setTimeout(function () { fermer('apmNewPwd'); AP.ui.toast(M('pwdChanged')); }, 900);
        } catch (e) {
          msg('apNewPwdMsg', messageErreur(e), 'bad');
        }
        occupe(np, false);
      });
    }

    /* ---- mon compte ---- */
    var save = $('apAccSave');
    if (save) {
      save.addEventListener('click', async function () {
        occupe(save, true);
        try {
          await AP.auth.updateProfile({
            full_name: (($('apAccName') || {}).value || '').trim() || null,
            phone: (($('apAccPhone') || {}).value || '').trim() || null
          });
          msg('apAccMsg', M('saved'), 'ok');
          rafraichirPastille();
        } catch (e) { msg('apAccMsg', messageErreur(e), 'bad'); }
        occupe(save, false);
      });
    }

    var chg = $('apChgPwdGo');
    if (chg) {
      chg.addEventListener('click', async function () {
        var a = (($('apChgPwd') || {}).value || ''), b = (($('apChgPwd2') || {}).value || '');
        if (a.length < 8) { msg('apChgPwdMsg', M('pwdShort'), 'bad'); return; }
        if (a !== b)      { msg('apChgPwdMsg', M('pwdMismatch'), 'bad'); return; }
        occupe(chg, true);
        try {
          await AP.auth.updatePassword(a);
          $('apChgPwd').value = ''; $('apChgPwd2').value = '';
          msg('apChgPwdMsg', M('pwdChanged'), 'ok');
        } catch (e) {
          var t = String((e && e.message) || '').toLowerCase();
          msg('apChgPwdMsg', t.indexOf('reauth') >= 0 ? M('pwdReauth') : messageErreur(e), 'bad');
        }
        occupe(chg, false);
      });
    }

    /* ---- double authentification ---- */
    var ms = $('apMfaStart');
    if (ms) {
      ms.addEventListener('click', async function () {
        mfaMode = 'enroll';
        occupe(ms, true); msg('apMfaMsg', '');
        try {
          var d = await AP.auth.mfa.start();
          mfaEnCours = d;
          var img = $('apMfaQr');
          if (img) { img.src = d.qr || ''; img.parentNode.hidden = !d.qr; }
          var sec = $('apMfaSecret');
          if (sec) { sec.textContent = d.secret || ''; }
          var box = document.querySelector('#apMfaEnroll .ap-secret');
          if (box) { box.hidden = !d.secret; }
          $('apMfaEnroll').hidden = false;
          $('apMfaButtons').hidden = true;
          msg('apMfaMsg', M('mfaScan'), '');
          var c = $('apMfaCode'); if (c) { c.value = ''; c.focus(); }
        } catch (e) { msg('apMfaMsg', messageErreur(e), 'bad'); }
        occupe(ms, false);
      });
    }

    var mo = $('apMfaOff');
    if (mo) {
      mo.addEventListener('click', function () {
        mfaMode = 'disable';
        mfaEnCours = null;
        var q = document.querySelector('#apMfaEnroll .ap-qr');
        if (q) { q.hidden = true; }
        var box = document.querySelector('#apMfaEnroll .ap-secret');
        if (box) { box.hidden = true; }
        $('apMfaEnroll').hidden = false;
        $('apMfaButtons').hidden = true;
        msg('apMfaMsg', M('mfaAskCode'), '');
        var c = $('apMfaCode'); if (c) { c.value = ''; c.focus(); }
      });
    }

    var mc = $('apMfaCancel');
    if (mc) {
      mc.addEventListener('click', function () {
        $('apMfaEnroll').hidden = true;
        $('apMfaButtons').hidden = false;
        msg('apMfaMsg', '');
        mfaEnCours = null;
      });
    }

    var mk = $('apMfaConfirm');
    if (mk) {
      mk.addEventListener('click', async function () {
        var code = (($('apMfaCode') || {}).value || '').trim();
        if (code.length < 6) { msg('apMfaMsg', M('errBadCode'), 'bad'); return; }
        occupe(mk, true);
        try {
          if (mfaMode === 'disable') {
            await AP.auth.mfa.disable(code);
            msg('apMfaMsg', M('mfaRemoved'), 'ok');
          } else {
            /* Garde-fou : sans enrolement en cours il n'y a pas de facteur a
               confirmer. Cela arrive si la page a ete rechargee entre-temps. */
            if (!mfaEnCours || !mfaEnCours.id) { throw new Error(M('errGeneric')); }
            await AP.auth.mfa.confirm(mfaEnCours.id, code);
            msg('apMfaMsg', M('mfaDone'), 'ok');
          }
          $('apMfaEnroll').hidden = true;
          $('apMfaButtons').hidden = false;
          mfaEnCours = null;
          majEcranCompte();
        } catch (e) { msg('apMfaMsg', messageErreur(e), 'bad'); }
        occupe(mk, false);
      });
    }

    /* ---- appareils ---- */
    var ra = $('apRevokeAll');
    if (ra) {
      ra.addEventListener('click', async function () {
        occupe(ra, true);
        try {
          await AP.auth.signOutEverywhere();
          AP.ui.toast(M('revokeDone'));
          fermer('apmAccount');
          await chargerIdentite();
          rafraichirPastille();
        } catch (e) { AP.ui.toast(messageErreur(e)); }
        occupe(ra, false);
      });
    }

    /* ---- export ---- */
    var ej = $('apExpJson'), ec = $('apExpCsv');
    if (ej) { ej.addEventListener('click', function () { lancerExport('json', ej); }); }
    if (ec) { ec.addEventListener('click', function () { lancerExport('csv', ec); }); }

    /* ---- suppression ---- */
    var dopen = $('apDelOpen');
    if (dopen) {
      dopen.addEventListener('click', function () {
        fermer('apmAccount');
        preparerSuppression();
        ouvrir('apmDelete');
      });
    }
    var dmail = $('apDelMail'), dok = $('apDelOk'), dgo = $('apDelGo');
    function verifSuppression() {
      if (!dgo) { return; }
      var att = String((S.user && S.user.email) || '').trim().toLowerCase();
      var vu = String((dmail && dmail.value) || '').trim().toLowerCase();
      dgo.disabled = !(att && vu === att && dok && dok.checked);
    }
    if (dmail) { dmail.addEventListener('input', verifSuppression); }
    if (dok)   { dok.addEventListener('change', verifSuppression); }
    if (dgo) {
      dgo.addEventListener('click', async function () {
        occupe(dgo, true); msg('apDelMsg', '');
        try {
          /* Le serveur exige une preuve d'identite RECENTE (moins de cinq
             minutes) avant de detruire un compte : c'est la fonction
             assert_sensitive_action du fichier SQL. On la fournit en
             re-authentifiant ici meme. */
          var pwd = (($('apDelPwd') || {}).value || '');
          if (pwd) { await AP.auth.signIn(S.user.email, pwd); }
          var code = (($('apDelTotp') || {}).value || '').trim();
          if (code) { await AP.auth.verifyTotp(code); }

          await AP.auth.deleteAccount((dmail && dmail.value) || '');
          AP.ui.toast(M('deleteDone'));
          try { await sb.auth.signOut({ scope: 'local' }); } catch (e) { }
          setTimeout(function () { location.reload(); }, 1200);
        } catch (e) {
          msg('apDelMsg', messageErreur(e), 'bad');
        }
        occupe(dgo, false);
      });
    }
  }

  function actionMenu(quoi) {
    if (quoi === 'open-auth')  { ouvrirConnexion(); return; }
    if (quoi === 'retry')      { location.reload(); return; }
    if (quoi === 'account')    { ouvrirCompte(); return; }
    if (quoi === 'export')     { ouvrirCompte(); return; }
    if (quoi === 'signout') {
      AP.auth.signOut().then(function () {
        AP.ui.toast(M('signedOut'));
        chargerIdentite().then(rafraichirPastille);
      });
      return;
    }
    if (quoi === 'signoutall') {
      AP.auth.signOutEverywhere().then(function () {
        AP.ui.toast(M('revokeDone'));
        chargerIdentite().then(rafraichirPastille);
      }).catch(function (e) { AP.ui.toast(messageErreur(e)); });
      return;
    }
    if (quoi === 'delete') { preparerSuppression(); ouvrir('apmDelete'); return; }
  }

  function basculerOnglet(t) {
    ongletCourant = (t === 'up') ? 'up' : 'in';
    document.querySelectorAll('[data-ap-tab]').forEach(function (b) {
      b.classList.toggle('on', b.getAttribute('data-ap-tab') === ongletCourant);
    });
    var fn = $('apFldName'); if (fn) { fn.hidden = (ongletCourant !== 'up'); }
    var ph = $('apPwdHint'); if (ph) { ph.hidden = (ongletCourant !== 'up'); }
    var ft = $('apFldTotp'); if (ft) { ft.hidden = true; }
    var pw = $('apPwd');
    if (pw) { pw.setAttribute('autocomplete', ongletCourant === 'up' ? 'new-password' : 'current-password'); }
    var go = $('apAuthGo');
    if (go) { go.textContent = (ongletCourant === 'up') ? M('createAcct') : M('signIn'); }
    msg('apAuthMsg', '');
  }

  function ouvrirConnexion() {
    if (!interfaceComplete || !$('apmAuth')) { AP.ui.toast(M('uiMissing')); return; }
    basculerOnglet('in');
    msg('apAuthMsg', '');
    ouvrir('apmAuth');
    var e = $('apEmail'); if (e) { setTimeout(function () { e.focus(); }, 60); }
  }

  async function validerAuth() {
    var go = $('apAuthGo');
    var email = (($('apEmail') || {}).value || '').trim();
    var pwd = (($('apPwd') || {}).value || '');
    var totpVisible = $('apFldTotp') && !$('apFldTotp').hidden;

    msg('apAuthMsg', '');
    occupe(go, true);
    try {
      if (totpVisible) {
        await AP.auth.verifyTotp((($('apTotp') || {}).value || ''));
        fermer('apmAuth');
        AP.ui.toast(M('welcome'));
      } else if (ongletCourant === 'up') {
        if (pwd.length < 8) { throw new Error(M('pwdShort')); }
        var r = await AP.auth.signUp(email, pwd, (($('apName') || {}).value || ''));
        if (!r.session) {
          msg('apAuthMsg', M('checkMail'), 'ok');
        } else {
          fermer('apmAuth');
          AP.ui.toast(M('welcome'));
        }
      } else {
        var res = await AP.auth.signIn(email, pwd);
        if (res.mfa) {
          $('apFldTotp').hidden = false;
          msg('apAuthMsg', M('totpHelp'), '');
          var c = $('apTotp'); if (c) { c.value = ''; c.focus(); }
        } else {
          fermer('apmAuth');
          AP.ui.toast(M('welcome'));
        }
      }
    } catch (e) {
      msg('apAuthMsg', messageErreur(e), 'bad');
    }
    occupe(go, false);
  }

  function dateCourte(v) {
    if (!v) { return '—'; }
    try { return new Date(v).toLocaleDateString(langue() === 'ar' ? 'ar-DZ' : 'fr-DZ'); }
    catch (e) { return String(v).slice(0, 10); }
  }

  function ouvrirCompte() {
    if (!interfaceComplete || !$('apmAccount')) { AP.ui.toast(M('uiMissing')); return; }
    majEcranCompte();
    ouvrir('apmAccount');
  }

  async function majEcranCompte() {
    if (S.mode !== 'in') { return; }
    var p = S.profile || {};
    if ($('apAccMail'))  { $('apAccMail').textContent = (S.user && S.user.email) || ''; }
    if ($('apAccOrg'))   { $('apAccOrg').textContent = (S.org && S.org.name) || '—'; }
    if ($('apAccRole'))  { $('apAccRole').textContent = nomRole(S.role) || '—'; }
    if ($('apAccSince')) { $('apAccSince').textContent = dateCourte(S.joinedAt || p.created_at); }
    if ($('apAccName'))  { $('apAccName').value = p.full_name || ''; }
    if ($('apAccPhone')) { $('apAccPhone').value = p.phone || ''; }
    msg('apAccMsg', ''); msg('apChgPwdMsg', ''); msg('apExpMsg', '');

    var actif = S.factors && S.factors.length > 0;
    if ($('apMfaState')) { $('apMfaState').textContent = actif ? M('mfaOn') : M('mfaOff'); }
    if ($('apMfaStart')) { $('apMfaStart').hidden = actif; }
    if ($('apMfaOff'))   { $('apMfaOff').hidden = !actif; }
    if ($('apMfaEnroll')){ $('apMfaEnroll').hidden = true; }
    if ($('apMfaButtons')){ $('apMfaButtons').hidden = false; }

    /* Les appareils. En cas de panne reseau on n'affiche rien plutot qu'une
       erreur rouge : la liste n'est pas vitale. */
    var box = $('apDevList');
    if (box) {
      box.innerHTML = '';
      try {
        var liste = await AP.auth.devices();
        if (!liste.length) {
          box.innerHTML = '<div class="ap-dev"><span>' + M('noDevices') + '</span></div>';
        } else {
          liste.forEach(function (d) {
            var el = document.createElement('div');
            el.className = 'ap-dev';
            var main = document.createElement('div');
            main.className = 'ap-dev-main';
            var b = document.createElement('b'); b.textContent = d.label || '—';
            var s = document.createElement('small');
            s.textContent = (d.platform || '') + ' · ' + dateCourte(d.last_seen_at);
            main.appendChild(b); main.appendChild(s);
            el.appendChild(main);
            if (d.is_current) {
              var t = document.createElement('span');
              t.className = 'ap-here'; t.textContent = M('thisDevice');
              el.appendChild(t);
            }
            box.appendChild(el);
          });
        }
      } catch (e) { /* silencieux */ }
    }
  }

  async function lancerExport(format, bouton) {
    occupe(bouton, true); msg('apExpMsg', '');
    try {
      if (format === 'csv') { await AP.auth.exportCSV(); }
      else { await AP.auth.exportJSON(); }
      msg('apExpMsg', M('exportDone'), 'ok');
    } catch (e) {
      msg('apExpMsg', messageErreur(e), 'bad');
    }
    occupe(bouton, false);
  }

  function preparerSuppression() {
    msg('apDelMsg', '');
    if ($('apDelMail')) { $('apDelMail').value = ''; }
    if ($('apDelPwd'))  { $('apDelPwd').value = ''; }
    if ($('apDelTotp')) { $('apDelTotp').value = ''; }
    if ($('apDelOk'))   { $('apDelOk').checked = false; }
    if ($('apDelGo'))   { $('apDelGo').disabled = true; }
    /* Le champ du code n'apparait que si un facteur est reellement enrole. */
    var ft = $('apDelTotpFld');
    if (ft) { ft.hidden = !(S.factors && S.factors.length); }
  }


  /* =========================================================================
     PARTIE 10 — LE RETOUR DES LIENS (mot de passe oublie, Google)
     ========================================================================= */

  function traiterAdresseDeRetour() {
    var q = location.search || '', h = location.hash || '';

    /* Lien perime ou deja utilise : Supabase le dit dans l'adresse. */
    if (h.indexOf('error') >= 0 || q.indexOf('error') >= 0) {
      if (h.indexOf('expired') >= 0 || h.indexOf('invalid') >= 0 ||
          q.indexOf('expired') >= 0 || q.indexOf('invalid') >= 0) {
        AP.ui.toast(M('errLinkDead'));
      }
      nettoyerAdresse();
      return;
    }

    var estReset = (q.indexOf('ap=reset') >= 0) || (h.indexOf('type=recovery') >= 0);
    if (estReset) {
      /* On laisse a la librairie le temps d'echanger le code contre une
         session avant de nettoyer l'adresse et d'ouvrir l'ecran. Si l'echange
         a echoue (lien perime, ou ouvert dans un autre navigateur que celui
         qui l'a demande), il n'y a pas de session : inutile d'afficher un
         formulaire qui echouera, on le dit franchement. */
      setTimeout(async function () {
        await chargerIdentite();
        rafraichirPastille();
        nettoyerAdresse();
        if (S.mode === 'in' && interfaceComplete) {
          msg('apNewPwdMsg', '');
          ouvrir('apmNewPwd');
        } else {
          AP.ui.toast(M('errLinkDead'));
        }
      }, 800);
    } else if (q.indexOf('code=') >= 0 || h.indexOf('access_token=') >= 0) {
      /* Retour de Google : on nettoie simplement l'adresse pour que le code
         ne traine pas dans l'historique du navigateur. */
      setTimeout(nettoyerAdresse, 900);
    }
  }

  function nettoyerAdresse() {
    try {
      var propre = location.origin + location.pathname;
      history.replaceState({}, document.title, propre);
    } catch (e) { }
  }


  /* =========================================================================
     PARTIE 11 — MISE EN ROUTE
     ========================================================================= */

  /* Attendre que <body> existe. Necessaire si la balise <script> est placee
     dans le <head> : sans cela, document.body vaut null et l'injection du
     morceau de page echoue silencieusement. */
  function pretDOM() {
    if (document.body) { return Promise.resolve(); }
    return new Promise(function (ok) {
      document.addEventListener('DOMContentLoaded', function () { ok(); }, { once: true });
    });
  }

  async function demarrerInterface() {
    await pretDOM();
    injecterCSS();
    await injecterHTML();
    traduire();
    placerPastille();
    brancherInterface();

    AP.ui.onLang(function () {
      traduire();
      /* Les libelles calcules (bouton principal, etat de la 2FA) ne portent
         pas de data-apt : on les refait a la main. */
      basculerOnglet(ongletCourant);
      if ($('apmAccount') && $('apmAccount').classList.contains('show')) { majEcranCompte(); }
    });

    if (sb) {
      AP.auth.open = ouvrirConnexion;
      await chargerIdentite();
      rafraichirPastille();
      if (S.mode === 'in') {
        enregistrerAppareil();
        if (S.role === 'viewer') { AP.ui.toast(M('viewerNotice')); }
      }
      traiterAdresseDeRetour();

      /* Le reseau revient : on retente une lecture d'identite. */
      W.addEventListener('online', function () { chargerIdentite().then(rafraichirPastille); });
      W.addEventListener('offline', function () {
        S.mode = 'down'; appliquerDroits(); rafraichirPastille();
      });
    } else {
      rafraichirPastille();
    }
  }

})();
