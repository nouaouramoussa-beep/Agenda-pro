/* ============================================================================
   AGENDA PRO — app/billing/billing.js
   LA BRIQUE « VENTE ».
   ----------------------------------------------------------------------------
   Ce qu'elle sait faire :
     1. afficher la grille tarifaire, en arabe et en francais, en dinar et en
        euro : essai gratuit, formule Solo, formule Equipe (par siege), et la
        licence a vie payee une seule fois ;
     2. ouvrir la page de paiement Stripe (Edge Function « checkout ») ;
     3. ouvrir le portail client Stripe pour changer de carte ou resilier
        (Edge Function « portal ») ;
     4. afficher un bandeau d'etat : compte a rebours d'essai, retard de
        paiement, acces expire ;
     5. appliquer le BLOCAGE DOUX quand l'acces expire : l'application passe en
        lecture seule, elle ne se ferme pas ;
     6. saisir et activer une cle de licence (Edge Function « license-verify ») ;
     7. gerer l'equipe : inviter par e-mail, changer un role, retirer une
        personne, et montrer les sieges occupes face aux sieges payes.

   LA REGLE QUI PASSE AVANT TOUTES LES AUTRES
   ------------------------------------------
   Si app/config.js est vide, ou si le serveur est injoignable, ce fichier ne
   fait RIEN : pas de bandeau, pas de pastille, pas de requete, pas un mot dans
   la console. L'application reste le tableau de bord local qu'elle est
   aujourd'hui, avec ses donnees dans le navigateur. On ne facture pas quelqu'un
   qui travaille hors ligne, et surtout on ne casse jamais l'existant.

   OU EST LA VRAIE SECURITE ? PAS ICI.
   -----------------------------------
   Tout ce fichier tourne dans le navigateur du client : il est lisible,
   modifiable, contournable. Quelqu'un qui bricole la console peut faire
   reapparaitre les boutons d'ecriture — et le serveur les refusera quand meme,
   parce que les policies RLS du dossier saas/ du projet (003_durcissement.sql,
   section 11) exigent public.org_has_access(org_id) pour toute ECRITURE.
   Ce fichier ne fait donc que deux choses honnetes : parler poliment au
   serveur, et eviter d'afficher des boutons qui echoueraient.

   LE CHOIX DE PRODUIT LE PLUS IMPORTANT : LE BLOCAGE EST *DOUX*
   -------------------------------------------------------------
   Quand l'abonnement s'arrete, on coupe l'ECRITURE, jamais la LECTURE.
   L'artisan continue de consulter ses chantiers, ses clients, ses telephones,
   et d'exporter ses donnees. Trois raisons, dans cet ordre :
     * ce sont SES donnees. Les retenir en otage pour faire payer, c'est du
       chantage, et cela se raconte dans un metier ou tout le monde se connait ;
     * le RGPD (article 20, portabilite) suppose que l'interesse puisse
       recuperer ses donnees. Un mur de paiement qui empeche l'export est un
       probleme juridique, pas seulement un probleme de gout ;
     * commercialement, un client qui voit encore son travail revient payer.
       Un client devant une porte fermee s'en va et refait tout ailleurs.
   Le SQL applique exactement la meme regle, cote serveur. Ce fichier ne fait
   que la rendre lisible a l'ecran.

   CE QU'IL PUBLIE : window.AP.billing, et rien d'autre dans le global.
   ============================================================================ */

(function () {
  'use strict';

  var W = window;
  W.AP = W.AP || {};
  var AP = W.AP;

  /* Ou se trouve ce fichier ? On s'en sert pour retrouver pricing.html, qui
     est range a cote, ou que vous ayez mis le dossier « app ». */
  var MOI = (document.currentScript && document.currentScript.src) || '';
  var DOSSIER = MOI ? MOI.replace(/[^\/]*$/, '') : 'app/billing/';

  var CFG = W.AP_CONFIG || {};


  /* =========================================================================
     PARTIE 1 — LES PRIX
     ============================ A AJUSTER ==================================
     TOUT CE QUI SE CHANGE EN CAS DE CHANGEMENT DE TARIF EST ICI, ET NULLE PART
     AILLEURS. Ne modifiez jamais un montant ailleurs dans le fichier : il y en
     aurait toujours un qui garderait l'ancienne valeur.

     ATTENTION, LE PIEGE QUI COUTE DE L'ARGENT
     -----------------------------------------
     Les montants ci-dessous ne sont QUE L'AFFICHAGE. Ce qui est reellement
     debite, c'est le « Price » cree dans votre tableau de bord Stripe, dont
     l'identifiant (price_...) vit dans les SECRETS des Edge Functions, jamais
     ici. Consequence : si vous changez un prix ici sans le changer dans
     Stripe, le client verra un montant et en paiera un autre. C'est le genre
     d'erreur qui se decouvre par une reclamation.
     => Regle : on change TOUJOURS les deux, Stripe d'abord, ce fichier ensuite.

     POURQUOI LES IDENTIFIANTS DE PRIX NE SONT PAS DANS CE FICHIER
     -------------------------------------------------------------
     Parce que le navigateur est aux mains du client. S'il choisissait
     lui-meme l'identifiant du tarif, il enverrait celui de la formule a
     1 200 DA pour obtenir la formule a 39 000 DA. Le navigateur n'envoie donc
     que trois mots : la formule, la periode, la monnaie. C'est le SERVEUR qui
     traduit ces trois mots en identifiant de tarif, a partir de SES variables
     d'environnement. Un client qui bricole la requete ne peut se tromper que
     de formule affichee, jamais de prix reel.

     LA MONNAIE
     ----------
     Le dinar algerien (DZD) et l'euro (EUR) sont deux « Price » DIFFERENTS
     dans Stripe : un objet Price porte sa monnaie et ne peut pas en changer.
     Il faut donc, pour chaque ligne de ce tableau, creer autant de Price que
     de monnaies proposees. La liste des variables a remplir est imprimee par
     AP.billing.checklist() dans la console — appelez-la une fois, elle vous
     donne les noms exacts a creer dans Supabase.
     ========================================================================= */

  var PRIX = {

    /* La periode d'essai. Elle n'est PAS geree par Stripe : c'est la colonne
       organizations.trial_ends_at, posee par le SQL a la creation du compte
       (30 jours par defaut, migration 003 section 4.1). Ce nombre-ci ne sert
       donc qu'a l'affichage de la grille. Si vous changez la duree reelle,
       changez-la dans le SQL, puis recopiez-la ici. */
    essaiJours: 30,

    /* Seuil du compte a rebours : en dessous de ce nombre de jours restants,
       le bandeau d'essai apparait. Au-dela, on se tait. */
    alerteJours: 7,

    /* Les formules. « dbPlan » est la valeur ecrite en base : la contrainte
       subscriptions_plan_ck du socle n'accepte QUE 'solo', 'pro' ou
       'entreprise'. Le nom commercial (« Equipe ») est libre, la valeur
       technique ne l'est pas. */
    formules: [
      {
        id: 'solo',
        dbPlan: 'solo',
        mode: 'subscription',     // abonnement recurrent
        parSiege: false,
        sieges: 1,
        populaire: false,
        /* Montants AFFICHES. Entiers, dans l'unite courante (pas en centimes) :
           1200 DZD, 8 EUR. Stripe, lui, raisonne en plus petite unite. */
        montants: {
          mois: { DZD: 1200, EUR: 8 },
          an:   { DZD: 12000, EUR: 80 }     // deux mois offerts
        },
        avantages: ['featTasks', 'featGoogle', 'featDevices', 'featSupport']
      },
      {
        id: 'equipe',
        dbPlan: 'pro',
        mode: 'subscription',
        parSiege: true,           // le montant est MULTIPLIE par le nombre de sieges
        sieges: 2,                // proposition de depart dans le formulaire
        populaire: true,
        montants: {
          mois: { DZD: 900, EUR: 6 },
          an:   { DZD: 9000, EUR: 60 }
        },
        avantages: ['featAllSolo', 'featSeats', 'featRoles', 'featAudit']
      },
      {
        id: 'avie',
        dbPlan: 'pro',
        mode: 'payment',          // paiement unique, pas d'abonnement
        parSiege: false,
        sieges: 3,                // postes autorises par la cle
        populaire: false,
        montants: {
          unique: { DZD: 39000, EUR: 249 }
        },
        avantages: ['featOnce', 'featKey', 'featOffline', 'featUpdates']
      }
    ],

    /* Duree de validite d'une cle a vie. null = perpetuelle.
       Si vous mettez une date, le webhook la recopie dans licenses.expires_at
       et la cle cesse de fonctionner ce jour-la, meme hors ligne. */
    aVieExpire: null,

    /* Combien de postes une cle a vie peut activer. Le SQL plafonne a 1000.
       Le webhook lit cette valeur dans les metadonnees de la session de
       paiement, que l'Edge Function « checkout » lui transmet. */
    aVieMaxPostes: 3
  };

  /* Mise en forme d'un montant. On n'utilise pas les chiffres arabo-indiens
     (٠١٢٣) meme en arabe : les artisans lisent les prix en chiffres latins sur
     tous leurs documents commerciaux, et melanger les deux cree des erreurs de
     saisie. */
  function montant(valeur, devise) {
    var n = Number(valeur) || 0;
    var s;
    try {
      s = n.toLocaleString('fr-FR', { maximumFractionDigits: 0 });
    } catch (e) {
      s = String(n);
    }
    return (devise === 'EUR') ? (s + ' €') : (s + ' DA');
  }


  /* =========================================================================
     PARTIE 2 — LE DICTIONNAIRE
     Chaque texte visible existe en arabe et en francais. Aucune phrase n'est
     ecrite en dur ailleurs : pour corriger une formulation, c'est ici.
     ========================================================================= */

  var D = {
    /* --- pastille et menu --- */
    chipTrial:    { ar: 'تجربة',        fr: 'Essai' },
    chipActive:   { ar: 'مشترك',        fr: 'Abonne' },
    chipLate:     { ar: 'دفعة متأخّرة', fr: 'Paiement en retard' },
    chipExpired:  { ar: 'انتهى الاشتراك', fr: 'Acces expire' },
    chipLife:     { ar: 'رخصة دائمة',   fr: 'Licence a vie' },
    chipFree:     { ar: 'مجاني',        fr: 'Gratuit' },
    menuPricing:  { ar: 'الأسعار والاشتراك', fr: 'Tarifs et abonnement' },
    menuTeam:     { ar: 'أعضاء الفريق',      fr: 'Membres de l’equipe' },
    menuLicense:  { ar: 'إدخال مفتاح رخصة',  fr: 'Saisir une cle de licence' },
    menuPortal:   { ar: 'إدارة البطاقة والفوترة', fr: 'Carte et facturation' },
    menuRefresh:  { ar: 'تحديث الحالة',      fr: 'Actualiser l’etat' },

    /* --- bandeau --- */
    bnTrialTitle: { ar: 'فترة التجربة',  fr: 'Periode d’essai' },
    bnTrialSub:   { ar: 'تبقّى {n} يوم. بعدها يصبح الحساب للقراءة فقط، ولا تضيع أيّ بيانات.',
                    fr: 'Il reste {n} jour(s). Ensuite le compte passe en lecture seule, et aucune donnee n’est perdue.' },
    bnTrialLast:  { ar: 'ينتهي اليوم. اشترك الآن حتى تواصل التسجيل والتعديل.',
                    fr: 'Elle se termine aujourd’hui. Abonnez-vous pour continuer a saisir et modifier.' },
    bnLateTitle:  { ar: 'لم تُقبل آخر دفعة', fr: 'Le dernier paiement n’est pas passe' },
    bnLateSub:    { ar: 'لا شيء مقطوع بعد. حدّث بطاقتك قبل أن يتوقّف الحساب عن قبول التعديلات.',
                    fr: 'Rien n’est coupe pour l’instant. Mettez votre carte a jour avant que le compte cesse d’accepter les modifications.' },
    bnOverTitle:  { ar: 'الحساب في وضع القراءة فقط', fr: 'Compte en lecture seule' },
    bnOverSub:    { ar: 'بياناتك كلّها موجودة ويمكنك قراءتها وتصديرها. التسجيل والتعديل يعودان فور الاشتراك.',
                    fr: 'Toutes vos donnees sont la : vous pouvez les consulter et les exporter. La saisie et la modification reviennent des l’abonnement.' },
    bnKeyTitle:   { ar: 'رخصة في انتظار التفعيل', fr: 'Une licence attend d’etre activee' },
    bnKeySub:     { ar: 'أُصدرت رخصة لمؤسّستك (تبدأ بـ {p}) ولم تُفعَّل بعد. أدخل المفتاح الذي وصلك. إن لم يصلك، اتّصل بنا: المفتاح لا يُخزَّن عندنا ويجب إعادة إصداره.',
                    fr: 'Une licence a ete emise pour votre organisation (elle commence par {p}) mais n’est pas encore activee. Saisissez la cle recue. Si vous ne l’avez pas recue, contactez-nous : la cle n’est pas conservee chez nous et doit etre reemise.' },
    bnKeyGo:      { ar: 'إدخال المفتاح', fr: 'Saisir la cle' },
    bnSubscribe:  { ar: 'اشترك',        fr: 'S’abonner' },
    bnFix:        { ar: 'تحديث البطاقة', fr: 'Mettre a jour la carte' },

    /* --- grille tarifaire --- */
    pricingTitle: { ar: 'الأسعار', fr: 'Tarifs' },
    pricingIntro: { ar: 'اختر ما يناسب ورشتك. يمكنك تغيير الصيغة أو إيقافها في أيّ وقت، ولا تُحذف بياناتك أبداً عند التوقّف: يصبح الحساب للقراءة فقط.',
                    fr: 'Choisissez ce qui correspond a votre atelier. Vous pouvez changer de formule ou arreter a tout moment : a l’arret, rien n’est efface, le compte passe simplement en lecture seule.' },
    pricingLegal: { ar: 'الأسعار المعروضة إرشادية ويحدّدها الخادم عند الدفع. الدفع يتمّ لدى Stripe؛ لا يمرّ رقم بطاقتك عبر هذا التطبيق أبداً.',
                    fr: 'Les montants affiches sont indicatifs : le tarif reellement applique est celui que le serveur transmet a Stripe. Le paiement se fait chez Stripe ; le numero de votre carte ne passe jamais par cette application.' },
    cycleMonth:   { ar: 'شهرياً',  fr: 'Par mois' },
    cycleYear:    { ar: 'سنوياً',  fr: 'Par an' },
    perMonth:     { ar: '/ شهر',   fr: '/ mois' },
    perYear:      { ar: '/ سنة',   fr: '/ an' },
    perSeatMonth: { ar: '/ مقعد / شهر', fr: '/ siege / mois' },
    perSeatYear:  { ar: '/ مقعد / سنة',  fr: '/ siege / an' },
    onceOnly:     { ar: 'دفعة واحدة', fr: 'une seule fois' },
    saveYear:     { ar: 'شهران مجاناً', fr: 'deux mois offerts' },
    popular:      { ar: 'الأكثر طلباً', fr: 'Le plus demande' },
    total:        { ar: 'المجموع',  fr: 'Total' },
    seatsLabel:   { ar: 'عدد المقاعد', fr: 'Nombre de sieges' },
    seatsHelp:    { ar: 'مقعد لكلّ شخص يفتح التطبيق بحسابه. يمكنك زيادتها لاحقاً من نافذة الفوترة.',
                    fr: 'Un siege par personne qui ouvre l’application avec son compte. Vous pourrez en ajouter plus tard depuis la fenetre de facturation.' },
    choose:       { ar: 'اختيار',    fr: 'Choisir' },
    current:      { ar: 'صيغتك الحالية', fr: 'Votre formule actuelle' },
    haveKey:      { ar: 'لديّ مفتاح رخصة', fr: 'J’ai une cle de licence' },
    close:        { ar: 'إغلاق',    fr: 'Fermer' },
    cancel:       { ar: 'إلغاء',    fr: 'Annuler' },

    /* --- noms et arguments des formules --- */
    planTrial:  { ar: 'تجربة مجانية', fr: 'Essai gratuit' },
    planSolo:   { ar: 'فردي',        fr: 'Solo' },
    planEquipe: { ar: 'فريق',        fr: 'Equipe' },
    planAvie:   { ar: 'رخصة دائمة',  fr: 'Licence a vie' },
    descSolo:   { ar: 'لحرفيّ يعمل وحده.', fr: 'Pour l’artisan qui travaille seul.' },
    descEquipe: { ar: 'لورشة بعدّة أشخاص، الحساب بالمقعد.', fr: 'Pour un atelier a plusieurs, facture au siege.' },
    descAvie:   { ar: 'دفعة واحدة، مفتاح يعمل حتى دون إنترنت.', fr: 'Un seul paiement, une cle qui fonctionne meme sans internet.' },
    descTrial:  { ar: '{n} يوماً بكلّ الميزات، دون بطاقة بنكية.', fr: '{n} jours avec toutes les fonctions, sans carte bancaire.' },

    featTasks:   { ar: 'المهام والأقسام والتقويم بلا حدود', fr: 'Taches, sections et calendrier sans limite' },
    featGoogle:  { ar: 'مزامنة Google Calendar',           fr: 'Synchronisation Google Calendar' },
    featDevices: { ar: 'أجهزة متعدّدة بنفس الحساب',        fr: 'Plusieurs appareils avec le meme compte' },
    featSupport: { ar: 'دعم بالعربية والفرنسية',           fr: 'Assistance en arabe et en francais' },
    featAllSolo: { ar: 'كلّ ما في صيغة «فردي»',            fr: 'Tout ce que contient la formule Solo' },
    featSeats:   { ar: 'مقعد لكلّ عامل، بالدعوة',          fr: 'Un siege par employe, sur invitation' },
    featRoles:   { ar: 'أدوار: مالك، مشرف، عامل، مُطالِع', fr: 'Roles : proprietaire, admin, employe, lecteur' },
    featAudit:   { ar: 'سجلّ العمليات ومن فعل ماذا',       fr: 'Journal des operations : qui a fait quoi' },
    featOnce:    { ar: 'دفعة واحدة، بلا تجديد شهري',       fr: 'Un paiement, aucun renouvellement' },
    featKey:     { ar: 'مفتاح شخصي يُفعَّل في التطبيق',     fr: 'Une cle personnelle a activer dans l’application' },
    featOffline: { ar: 'يعمل على أجهزة الورشة دون اتصال',  fr: 'Fonctionne sur les postes d’atelier hors ligne' },
    featUpdates: { ar: 'تحديثات الإصدار الحالي',           fr: 'Mises a jour de la version en cours' },

    /* --- cle de licence --- */
    licTitle:    { ar: 'مفتاح الرخصة', fr: 'Cle de licence' },
    licHelp:     { ar: 'أدخل المفتاح الذي وصلك بعد الشراء. سيتحقّق منه الخادم أوّلاً، ثمّ يربطه بمؤسّستك. المفتاح لا يُحفظ في هذا المتصفّح.',
                   fr: 'Saisissez la cle recue apres l’achat. Le serveur la verifie d’abord, puis la rattache a votre organisation. La cle n’est pas conservee dans ce navigateur.' },
    licKey:      { ar: 'المفتاح', fr: 'La cle' },
    licKeyPh:    { ar: 'AGP1-XXXX-XXXX-…', fr: 'AGP1-XXXX-XXXX-…' },
    licFormat:   { ar: 'أحرف كبيرة وأرقام وشُرَط. يمكنك اللصق كما هو، وسنتكفّل بالباقي.',
                   fr: 'Majuscules, chiffres et tirets. Collez-la telle quelle, on s’occupe du reste.' },
    licCheck:    { ar: 'تحقّق فقط', fr: 'Verifier seulement' },
    licActivate: { ar: 'تفعيل',    fr: 'Activer' },
    licPlan:     { ar: 'الصيغة',   fr: 'Formule' },
    licSeats:    { ar: 'المقاعد',  fr: 'Sieges' },
    licExpires:  { ar: 'تنتهي في', fr: 'Expire le' },
    licNever:    { ar: 'بلا نهاية', fr: 'Jamais' },
    licValid:    { ar: 'المفتاح صالح ✓ اضغط «تفعيل» لربطه بمؤسّستك.',
                   fr: 'Cle valide ✓ Appuyez sur « Activer » pour la rattacher a votre organisation.' },
    licDone:     { ar: 'تمّ تفعيل الرخصة ✓', fr: 'Licence activee ✓' },
    licBad:      { ar: 'مفتاح غير صالح أو مستعمَل من قبل.', fr: 'Cle invalide ou deja utilisee.' },
    licExpired:  { ar: 'انتهت صلاحية هذا المفتاح.', fr: 'Cette cle a expire.' },
    licTooMany:  { ar: 'بلغ هذا المفتاح أقصى عدد من الأجهزة.', fr: 'Cette cle a atteint son nombre maximal d’appareils.' },
    licPersonal: { ar: 'تُفعَّل الرخصة على مؤسّسة عمل، لا على المساحة الشخصية. أنشئ مؤسّسة أوّلاً.',
                   fr: 'Une licence s’active sur une organisation de travail, pas sur l’espace personnel. Creez d’abord une organisation.' },
    licOwner:    { ar: 'المالك وحده يفعّل رخصة.', fr: 'Seul le proprietaire peut activer une licence.' },
    licReauth:   { ar: 'يطلب الخادم تأكيداً حديثاً للهوية. سجّل الخروج ثمّ الدخول، وأعد المحاولة.',
                   fr: 'Le serveur demande une preuve d’identite recente. Deconnectez-vous, reconnectez-vous, puis reessayez.' },
    licSlow:     { ar: 'محاولات كثيرة. أعد المحاولة بعد ساعة.', fr: 'Trop de tentatives. Reessayez dans une heure.' },

    /* --- equipe --- */
    teamTitle:    { ar: 'أعضاء الفريق', fr: 'Membres de l’equipe' },
    seatsUsed:    { ar: 'المقاعد المستعملة', fr: 'Sieges occupes' },
    seatsOf:      { ar: '{a} من {b}', fr: '{a} sur {b}' },
    seatsFull:    { ar: 'المقاعد ممتلئة. زِد عددها من نافذة الفوترة قبل دعوة شخص آخر.',
                    fr: 'Les sieges sont pleins. Augmentez-en le nombre depuis la fenetre de facturation avant d’inviter quelqu’un.' },
    seatsTrial:   { ar: 'أثناء التجربة: خمسة مقاعد، حتى تجرّب العمل الجماعي.',
                    fr: 'Pendant l’essai : cinq sieges, pour que vous puissiez tester le travail a plusieurs.' },
    seatsUnknown: { ar: 'عدد المقاعد المدفوعة يظهر للمالك وحده؛ الخادم لا يكشف الاشتراك لغيره.',
                    fr: 'Le nombre de sieges payes n’est visible que du proprietaire : le serveur ne montre l’abonnement a personne d’autre.' },
    seatsCount:   { ar: 'الدعوات المعلّقة لا تحجز مقعداً؛ يُحسب المقعد عند دخول الشخص فعلاً.',
                    fr: 'Une invitation en attente ne reserve pas de siege : le siege se compte quand la personne entre reellement.' },
    inviteTitle:  { ar: 'دعوة زميل', fr: 'Inviter un collegue' },
    inviteMail:   { ar: 'البريد الإلكتروني', fr: 'Adresse e-mail' },
    inviteMailPh: { ar: 'karim@exemple.dz', fr: 'karim@exemple.dz' },
    inviteRole:   { ar: 'الدور', fr: 'Role' },
    inviteSend:   { ar: 'إنشاء الدعوة', fr: 'Creer l’invitation' },
    inviteHow:    { ar: 'مهمّ: لا يرسل النظام بريداً بنفسه. بعد إنشاء الدعوة، أخبر زميلك أن ينشئ حساباً بنفس البريد ثمّ يفتح «أعضاء الفريق» ليقبلها. الدعوة صالحة سبعة أيّام.',
                    fr: 'Important : le systeme n’envoie pas de courriel tout seul. Une fois l’invitation creee, dites a votre collegue de creer un compte avec cette meme adresse, puis d’ouvrir « Membres de l’equipe » pour l’accepter. L’invitation vaut sept jours.' },
    inviteDone:   { ar: 'أُنشئت الدعوة ✓ أخبر زميلك.', fr: 'Invitation creee ✓ Prevenez votre collegue.' },
    inviteDup:    { ar: 'يوجد دعوة سارية لهذا البريد. أُعيد إنشاؤها بتاريخ جديد.',
                    fr: 'Une invitation existait deja pour cette adresse : elle a ete refaite avec une nouvelle date.' },
    inviteNoAcc:  { ar: 'الدعوات متوقّفة ما دام الاشتراك منتهياً. جدّد الاشتراك ثمّ أعد المحاولة.',
                    fr: 'Les invitations sont suspendues tant que l’abonnement est expire. Renouvelez, puis reessayez.' },
    inviteDenied: { ar: 'المالك والمشرف وحدهما يدعوان.', fr: 'Seuls le proprietaire et l’administrateur invitent.' },
    pendingTitle: { ar: 'دعوات في الانتظار', fr: 'Invitations en attente' },
    membersTitle: { ar: 'الأعضاء الحاليّون', fr: 'Membres actuels' },
    membersHelp:  { ar: 'لا يعرض الخادم بريد زملائك (حماية للخصوصية)، بل اسمهم فقط. تغيير دور أو إزالة عضو يسري فوراً على كلّ أجهزته.',
                    fr: 'Le serveur ne montre pas l’adresse de vos collegues (protection de la vie privee), seulement leur nom. Changer un role ou retirer quelqu’un prend effet immediatement sur tous ses appareils.' },
    myInvTitle:   { ar: 'دعوات موجّهة إليك', fr: 'Invitations qui vous concernent' },
    accept:       { ar: 'قبول',  fr: 'Accepter' },
    remove:       { ar: 'إزالة', fr: 'Retirer' },
    revoke:       { ar: 'إلغاء الدعوة', fr: 'Annuler l’invitation' },
    you:          { ar: 'أنت',   fr: 'vous' },
    noMembers:    { ar: 'أنت وحدك في هذه المؤسّسة.', fr: 'Vous etes seul dans cette organisation.' },
    noPending:    { ar: 'لا توجد دعوة معلّقة.', fr: 'Aucune invitation en attente.' },
    roleOwner:    { ar: 'المالك',   fr: 'Proprietaire' },
    roleAdmin:    { ar: 'مشرف',     fr: 'Administrateur' },
    roleEmployee: { ar: 'عامل',     fr: 'Employe' },
    roleViewer:   { ar: 'مُطالِع',  fr: 'Lecteur' },
    confirmRemove:{ ar: 'إزالة {n} من المؤسّسة؟ ستُغلق جلساته فوراً. لا تُحذف مهامّه.',
                    fr: 'Retirer {n} de l’organisation ? Ses sessions seront fermees immediatement. Ses taches ne sont pas effacees.' },
    memberGone:   { ar: 'أُزيل العضو.', fr: 'Membre retire.' },
    roleChanged:  { ar: 'تم تغيير الدور ✓', fr: 'Role modifie ✓' },
    lastOwner:    { ar: 'يجب أن يبقى للمؤسّسة مالك واحد على الأقل.',
                    fr: 'Une organisation doit toujours garder au moins un proprietaire.' },

    /* --- messages generaux --- */
    ownerOnly:  { ar: 'المالك وحده يتصرّف في الاشتراك.', fr: 'Seul le proprietaire agit sur l’abonnement.' },
    alreadySub: { ar: 'يوجد اشتراك جارٍ. غيّر الصيغة أو عدد المقاعد من نافذة الفوترة بدل إنشاء اشتراك ثانٍ.',
                  fr: 'Un abonnement est deja en cours. Changez de formule ou de nombre de sieges depuis la fenetre de facturation, plutot que d’en creer un second.' },
    noOrg:      { ar: 'لا توجد مؤسّسة نشطة.', fr: 'Aucune organisation active.' },
    goPay:      { ar: 'جارٍ فتح صفحة الدفع…', fr: 'Ouverture de la page de paiement…' },
    goPortal:   { ar: 'جارٍ فتح نافذة الفوترة…', fr: 'Ouverture de la fenetre de facturation…' },
    payBack:    { ar: 'شكراً. قد يتأخّر تحديث الحالة دقيقة، إذ ينتظر الخادم إشعار Stripe.',
                  fr: 'Merci. L’etat peut mettre une minute a se mettre a jour : le serveur attend la notification de Stripe.' },
    payCancel:  { ar: 'أُلغي الدفع. لم يُخصم شيء.', fr: 'Paiement abandonne. Rien n’a ete debite.' },
    errNet:     { ar: 'تعذّر الوصول إلى الخادم. تعمل الآن دون اتصال.',
                  fr: 'Serveur injoignable. Vous travaillez hors ligne.' },
    errNoFn:    { ar: 'وظيفة الدفع غير منشورة على الخادم بعد. راجع دليل التركيب.',
                  fr: 'La fonction de paiement n’est pas encore publiee sur le serveur. Voir la notice d’installation.' },
    errGeneric: { ar: 'تعذّر إتمام العملية.', fr: 'L’operation n’a pas pu aboutir.' },
    readonly:   { ar: 'وضع القراءة فقط: الاشتراك منتهٍ. بياناتك سليمة.',
                  fr: 'Lecture seule : l’abonnement est expire. Vos donnees sont intactes.' }
  };

  function lang() {
    if (AP.ui && typeof AP.ui.lang === 'function') { return AP.ui.lang(); }
    var l = (document.documentElement.lang || '').toLowerCase();
    if (l.indexOf('ar') === 0) { return 'ar'; }
    return l ? 'fr' : 'ar';
  }

  /* Le traducteur. Une cle inconnue renvoie la cle elle-meme : le defaut se
     voit tout de suite a l'ecran, au lieu de laisser un blanc mysterieux.
     Le second argument remplace {n}, {a}, {b} dans la phrase. */
  function T(cle, vars) {
    var e = D[cle];
    var s = e ? (e[lang()] || e.fr || cle) : cle;
    if (vars) {
      for (var k in vars) {
        if (Object.prototype.hasOwnProperty.call(vars, k)) {
          s = s.split('{' + k + '}').join(String(vars[k]));
        }
      }
    }
    return s;
  }

  function nomRole(r) {
    if (r === 'owner')    { return T('roleOwner'); }
    if (r === 'admin')    { return T('roleAdmin'); }
    if (r === 'employee') { return T('roleEmployee'); }
    if (r === 'viewer')   { return T('roleViewer'); }
    return r || '';
  }

  function nomFormule(id) {
    if (id === 'solo')   { return T('planSolo'); }
    if (id === 'equipe') { return T('planEquipe'); }
    if (id === 'avie')   { return T('planAvie'); }
    return id || '';
  }

  function toast(m) {
    if (AP.ui && typeof AP.ui.toast === 'function') { AP.ui.toast(m); return; }
    if (typeof W.toast === 'function') { try { W.toast(m); } catch (e) { } }
  }


  /* =========================================================================
     PARTIE 3 — L'ETAT, ET L'API PUBLIQUE
     ========================================================================= */

  /* etat :
       'local'   config.js vide  -> silence total, aucune vente
       'offline' configure mais injoignable
       'anon'    serveur joignable, personne n'est connecte
       'trial'   periode d'essai en cours
       'active'  abonnement paye et a jour (ou en essai Stripe)
       'late'    past_due : retard tolere, rien n'est coupe
       'life'    licence active (achat unique)
       'over'    plus d'acces en ecriture -> lecture seule                    */
  var S = {
    etat: 'local',
    orgId: null,
    orgNom: null,
    estProprietaire: false,
    acces: true,          // org_has_access() : l'ecriture est-elle permise ?
    essaiFin: null,       // Date, ou null
    joursRestants: null,
    abonnement: null,     // ligne public.subscriptions (proprietaire seulement)
    licence: null,        // ligne public.licenses ACTIVE (proprietaire seul)
    licenceEmise: null,   // licence fabriquee mais jamais activee ('issued')
    siegesPayes: 1,
    siegesUtilises: 1,
    invitationsEnAttente: 0,
    devise: 'DZD',
    cycle: 'mois'
  };

  var sb = null;              // le client Supabase partage, quand il existe
  var ecouteurs = {};         // bus d'evenements minuscule

  function surv(ev, fn) { (ecouteurs[ev] = ecouteurs[ev] || []).push(fn); }
  function emettre(ev) {
    var l = ecouteurs[ev] || [];
    for (var i = 0; i < l.length; i++) {
      try { l[i](S); } catch (e) { /* une brique cassee n'en casse pas une autre */ }
    }
  }

  /* L'API existe TOUJOURS, meme en mode purement local : les autres briques
     peuvent ecrire `if (AP.billing.canWrite())` sans jamais verifier que la
     brique est chargee. */
  AP.billing = {
    state: S,
    on: surv,
    t: T,
    lang: lang,
    prix: PRIX,

    /* Vrai si l'ecriture est permise. Hors ligne et en local : toujours vrai,
       parce que l'application doit rester ce qu'elle est aujourd'hui. */
    canWrite: function () {
      if (S.etat === 'local' || S.etat === 'offline' || S.etat === 'anon') { return true; }
      return S.acces !== false;
    },

    /* Remplacees par les vraies des que le client Supabase existe. */
    refresh:      function () { return Promise.resolve(S); },
    openPricing:  function () { },
    openTeam:     function () { },
    openLicense:  function () { },
    checkout:     function () { return Promise.resolve(false); },
    portal:       function () { return Promise.resolve(false); },
    redeem:       function () { return Promise.resolve(false); },
    seats:        function () { return { payes: S.siegesPayes, utilises: S.siegesUtilises, attente: S.invitationsEnAttente }; },

    /* Aide au deploiement : imprime dans la console la liste exacte des
       variables d'environnement a creer pour les Edge Functions, deduite de la
       constante PRIX. On evite ainsi la faute de frappe sur un nom, qui se
       traduirait par « tarif introuvable » au moment de payer. */
    checklist: function () {
      var out = [];
      for (var i = 0; i < PRIX.formules.length; i++) {
        var f = PRIX.formules[i];
        for (var cy in f.montants) {
          if (!Object.prototype.hasOwnProperty.call(f.montants, cy)) { continue; }
          for (var dv in f.montants[cy]) {
            if (!Object.prototype.hasOwnProperty.call(f.montants[cy], dv)) { continue; }
            out.push('STRIPE_PRICE_' + f.id.toUpperCase() + '_' + cy.toUpperCase() + '_' + dv +
                     '   (' + montant(f.montants[cy][dv], dv) + ')');
          }
        }
      }
      try { console.log('Variables a creer dans Supabase > Edge Functions > Secrets :\n' + out.join('\n')); } catch (e) { }
      return out;
    }
  };


  /* =========================================================================
     PARTIE 4 — CE QUE LE SERVEUR NOUS DIT
     ----------------------------------------------------------------------
     RAPPEL DES REGLES POSEES PAR LE SQL, QU'IL FAUT CONNAITRE POUR LIRE LA
     SUITE (elles expliquent chaque « if » de cette partie) :

       * public.subscriptions n'est visible QUE du proprietaire
         (policy subscription_select : has_role(org_id, ['owner'])).
         Un administrateur ne verra donc jamais le montant paye. C'est
         volontaire : l'argent regarde le patron.
       * public.licenses : meme chose, proprietaire seulement.
       * organizations.trial_ends_at est visible de TOUT membre : c'est donc
         sur cette colonne que repose le bandeau des employes.
       * public.org_has_access(org) est LA fonction qui fait autorite. Elle
         repond « oui » si l'organisation a un abonnement vivant, ou une
         licence active, ou un essai en cours. Elle exige d'etre membre :
         impossible d'espionner la solvabilite d'un concurrent.
       * aucune ecriture n'est possible dans subscriptions ni licenses depuis
         le navigateur : les droits SQL eux-memes ont ete retires. Seul le
         webhook Stripe, en service_role, ecrit la-dedans.
     ========================================================================= */

  function jours(d) {
    if (!d) { return null; }
    var ms = d.getTime() - Date.now();
    return Math.ceil(ms / 86400000);
  }

  async function lireEtat() {
    if (!sb) { S.etat = 'local'; appliquer(); return S; }

    var a = (AP.auth && AP.auth.state) || null;

    /* La brique COMPTES sait deja si quelqu'un est connecte : on ne refait pas
       le travail, et surtout on ne cree pas un second client Supabase. */
    if (!a || a.mode === 'off') { S.etat = 'local'; appliquer(); return S; }
    if (a.mode === 'down')      { S.etat = 'offline'; appliquer(); return S; }
    if (a.mode !== 'in')        { S.etat = 'anon'; appliquer(); return S; }

    S.orgId = (a.org && a.org.id) || null;
    S.orgNom = (a.org && a.org.name) || null;
    S.estProprietaire = (a.role === 'owner');

    if (!S.orgId) { S.etat = 'anon'; appliquer(); return S; }

    try {
      /* 1) L'acces, par la seule fonction qui fait autorite. */
      var acc = await sb.rpc('org_has_access', { p_org: S.orgId });
      S.acces = acc.error ? true : (acc.data !== false);

      /* 2) La fin d'essai. Elle est deja chargee par la brique COMPTES ; on la
            relit quand meme si elle manque (ordre de chargement des briques). */
      var fin = a.org && a.org.trial_ends_at;
      if (!fin) {
        var og = await sb.from('organizations').select('trial_ends_at').eq('id', S.orgId).maybeSingle();
        fin = og && og.data && og.data.trial_ends_at;
      }
      S.essaiFin = fin ? new Date(fin) : null;
      S.joursRestants = jours(S.essaiFin);

      /* 3) L'abonnement et la licence : proprietaire seulement. On n'essaie
            meme pas pour les autres — une requete qui renvoie zero ligne a
            cause d'une policy ressemble a une panne, et on finit par croire
            que le client n'a pas paye. */
      S.abonnement = null;
      S.licence = null;
      S.licenceEmise = null;
      if (S.estProprietaire) {
        var ab = await sb.from('subscriptions')
          .select('status, plan, seats, current_period_end, cancel_at_period_end, trial_end, stripe_price_id')
          .eq('org_id', S.orgId).maybeSingle();
        S.abonnement = (ab && ab.data) || null;

        /* On lit TOUTES les licences de l'organisation, pas seulement les
           actives. Pourquoi : apres l'achat d'une cle a vie, le webhook cree
           la ligne avec le statut 'issued' (fabriquee, pas encore activee).
           Tant que personne ne saisit la cle, org_has_access() repond non et
           le client a paye sans rien obtenir. On veut pouvoir le DIRE a
           l'ecran plutot que de le laisser dans le noir. */
        var li = await sb.from('licenses')
          .select('id, plan, seats, status, expires_at, key_prefix, max_activations')
          .eq('org_id', S.orgId);
        var licences = (li && li.data) || [];
        S.licence = null;
        S.licenceEmise = null;
        for (var n2 = 0; n2 < licences.length; n2++) {
          if (licences[n2].status === 'active') { S.licence = licences[n2]; }
          else if (licences[n2].status === 'issued') { S.licenceEmise = licences[n2]; }
        }
      }

      /* 4) Les sieges. On recopie EXACTEMENT la regle du declencheur
            tg_members_check_seats (migration 003, section 5), sans quoi
            l'ecran annoncerait « il reste une place » et le serveur
            refuserait l'arrivee du collegue. */
      var payes = 0;
      if (S.abonnement && ['trialing', 'active', 'past_due'].indexOf(S.abonnement.status) >= 0) {
        payes = Math.max(payes, Number(S.abonnement.seats) || 0);
      }
      if (S.licence) { payes = Math.max(payes, Number(S.licence.seats) || 0); }
      if (!payes) {
        payes = (S.essaiFin && S.essaiFin.getTime() > Date.now()) ? 5 : 1;
      }
      /* HONNETETE DE L'AFFICHAGE : seul le proprietaire voit la ligne
         d'abonnement (policy subscription_select). Pour un administrateur, le
         calcul ci-dessus retomberait sur « 1 siege » et l'ecran annoncerait
         « 4 sur 1 », ce qui est faux et inquietant. On prefere dire qu'on ne
         sait pas plutot que d'inventer un chiffre. */
      S.siegesPayes = S.estProprietaire ? payes : null;

      var mem = await sb.from('members').select('user_id', { count: 'exact', head: true }).eq('org_id', S.orgId);
      S.siegesUtilises = (mem && typeof mem.count === 'number') ? mem.count : 1;

      var inv = await sb.from('invitations').select('id', { count: 'exact', head: true })
        .eq('org_id', S.orgId).is('accepted_at', null);
      S.invitationsEnAttente = (inv && typeof inv.count === 'number') ? inv.count : 0;

      /* 5) Le verdict affiche. */
      if (!S.acces) {
        S.etat = 'over';
      } else if (S.licence) {
        S.etat = 'life';
      } else if (S.abonnement && S.abonnement.status === 'past_due') {
        S.etat = 'late';
      } else if (S.abonnement && ['active', 'trialing'].indexOf(S.abonnement.status) >= 0) {
        S.etat = 'active';
      } else if (S.essaiFin && S.essaiFin.getTime() > Date.now()) {
        S.etat = 'trial';
      } else {
        /* Acces accorde sans abonnement visible : c'est le cas d'un employe,
           qui ne voit pas la ligne d'abonnement de son patron. On n'affiche
           donc rien d'alarmant. */
        S.etat = 'active';
      }
    } catch (e) {
      /* Une panne reseau ne doit jamais faire croire a une fin d'abonnement :
         on repasse simplement « hors ligne » et on laisse tout ouvert. */
      S.etat = 'offline';
      S.acces = true;
    }

    appliquer();
    return S;
  }

  /* Repercute l'etat sur la page : un attribut sur <html>, que votre CSS peut
     utiliser librement, et le rafraichissement de nos ecrans. */
  function appliquer() {
    var h = document.documentElement;
    h.setAttribute('data-ap-billing', S.etat);
    h.setAttribute('data-ap-access', AP.billing.canWrite() ? '1' : '0');
    majPastille();
    majBandeau();
    emettre('change');
  }


  /* =========================================================================
     PARTIE 5 — LE STYLE
     On n'ajoute QUE ce qui n'existe pas dans index.html, et uniquement avec
     vos variables de couleur. Les proprietes sont « logiques »
     (margin-inline, inset-inline, padding-inline) : elles se retournent
     toutes seules en arabe, sans une ligne de CSS en double.
     ========================================================================= */

  function injecterCSS() {
    if (document.getElementById('apbCss')) { return; }
    var s = document.createElement('style');
    s.id = 'apbCss';
    s.textContent = [
      /* LES SELECTEURS DESCENDANTS NE SONT PAS DECORATIFS.
         placerPastille() sort #apbChip — et le menu #apbMenu qu'il contient —
         de #apBillRoot pour l'installer dans .tools, et placerBandeau() sort
         #apbBanner du meme conteneur. Apres ces deplacements, le selecteur
         « #apBillRoot [hidden] » ne couvre plus rien, et les selecteurs
         « .apb-chip[hidden] » / « .apb-menu[hidden] » ne visent que l'element
         lui-meme, jamais ses enfants. Or « .apb-mi{display:flex} » plus bas
         l'emporte sur le display:none que le navigateur applique a l'attribut
         hidden (feuille par defaut, la plus faible de toutes) : l'entree
         « Facturation », masquee par majPastille() avec e.hidden = true pour
         un employe, restait donc VISIBLE, et le clic finissait sur un 403.
         On couvre donc aussi les descendants des trois blocs deplaces, comme
         auth.css le fait deja avec « .ap-menu [hidden] ». */
      '#apBillRoot [hidden], .apb-chip[hidden], .apb-chip [hidden],' +
        '.apb-banner[hidden], .apb-banner [hidden],' +
        '.apb-menu[hidden], .apb-menu [hidden]{display:none !important}',

      /* --- pastille --- */
      '.apb-chip{position:relative;display:inline-flex}',
      '.apb-chip-btn{display:inline-flex;align-items:center;gap:7px;max-width:min(38vw,220px)}',
      '.apb-chip-lbl{overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-size:12px;font-weight:600}',
      '.apb-caret{font-size:10px;color:var(--txt3)}',
      '.apb-dot{width:8px;height:8px;border-radius:50%;background:var(--txt3);flex:none}',
      '.apb-chip[data-etat="trial"]  .apb-dot{background:var(--brand)}',
      '.apb-chip[data-etat="active"] .apb-dot{background:var(--ok)}',
      '.apb-chip[data-etat="life"]   .apb-dot{background:var(--ok)}',
      '.apb-chip[data-etat="late"]   .apb-dot{background:var(--warn)}',
      '.apb-chip[data-etat="over"]   .apb-dot{background:var(--bad)}',

      '.apb-menu{position:absolute;inset-inline-end:0;top:calc(100% + 7px);z-index:210;min-width:230px;' +
        'padding:6px;border-radius:14px;border:1px solid var(--line);background:var(--surface);box-shadow:var(--shadow)}',
      '.apb-mi{display:flex;width:100%;align-items:center;gap:10px;padding:9px 11px;border:0;background:none;' +
        'border-radius:10px;font-size:12.5px;font-weight:600;color:var(--txt2);text-align:start;cursor:pointer}',
      '.apb-mi:hover{background:var(--surface2);color:var(--txt)}',
      '.apb-mi-head{padding:8px 11px 6px;font-size:11px;color:var(--txt3);border-bottom:1px solid var(--line);margin-bottom:4px}',
      '.apb-sep{height:1px;background:var(--line);margin:4px 2px}',

      /* --- bandeau --- */
      /* Le bandeau vit DEHORS de .wrap (voir placerBandeau) : il porte donc
         lui-meme la largeur et les gouttieres que .wrap lui donnait avant. */
      '.apb-banner{display:flex;align-items:center;gap:12px;' +
        'margin-block:14px 0;margin-inline:auto;max-width:1432px;width:calc(100% - 48px);padding:12px 14px;' +
        'border-radius:var(--r2);border:1px solid var(--line);background:var(--surface);box-shadow:var(--shadow);position:relative}',
      '.apb-banner[data-ton="warn"]{border-color:color-mix(in srgb,var(--warn) 42%,var(--line));' +
        'background:color-mix(in srgb,var(--warn) 8%,var(--surface))}',
      '.apb-banner[data-ton="bad"]{border-color:color-mix(in srgb,var(--bad) 42%,var(--line));' +
        'background:color-mix(in srgb,var(--bad) 8%,var(--surface))}',
      '.apb-banner-ic{font-size:20px;flex:none}',
      '.apb-banner-txt{flex:1;min-width:0;display:flex;flex-direction:column;gap:2px}',
      '.apb-banner-txt b{font-size:13px;color:var(--txt)}',
      '.apb-banner-txt span{font-size:11.8px;line-height:1.7;color:var(--txt2)}',
      '.apb-banner-go{flex:none}',
      '.apb-banner-x{border:0;background:none;color:var(--txt3);font-size:13px;cursor:pointer;padding:2px 4px;flex:none}',
      '@media(max-width:620px){.apb-banner{flex-wrap:wrap}.apb-banner-go{inline-size:100%}}',

      /* --- grille tarifaire --- */
      '.apb-wide{max-width:920px}',
      '.apb-switches{display:flex;gap:10px;flex-wrap:wrap;align-items:center}',
      '.apb-seg{display:inline-flex;padding:3px;border-radius:12px;background:var(--bg2);border:1px solid var(--line)}',
      '.apb-segb{border:0;background:none;padding:7px 14px;border-radius:9px;font-size:12px;font-weight:700;' +
        'color:var(--txt3);cursor:pointer}',
      '.apb-segb.on{background:var(--surface);color:var(--brand2);box-shadow:0 1px 2px rgba(16,26,43,.08)}',
      '.apb-grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(230px,1fr));gap:12px}',
      '.apb-plan{position:relative;display:flex;flex-direction:column;gap:10px;padding:16px;border-radius:var(--r2);' +
        'border:1px solid var(--line);background:var(--surface2)}',
      '.apb-plan.pop{border-color:var(--brand);background:var(--surface)}',
      '.apb-tag{position:absolute;inset-block-start:-9px;inset-inline-start:14px;padding:3px 9px;border-radius:8px;' +
        'font-size:10px;font-weight:800;background:var(--brand2);color:#fff}',
      '.apb-plan h4{margin:0;font-size:15px;font-weight:800;color:var(--txt)}',
      '.apb-plan .apb-desc{font-size:11.6px;line-height:1.7;color:var(--txt2);min-height:34px}',
      '.apb-price{display:flex;align-items:baseline;gap:6px;flex-wrap:wrap}',
      '.apb-price b{font-size:24px;font-weight:800;color:var(--txt);letter-spacing:-.5px}',
      '.apb-price small{font-size:11.5px;color:var(--txt3);font-weight:600}',
      '.apb-total{font-size:11.5px;color:var(--brand2);font-weight:700}',
      '.apb-feats{list-style:none;margin:0;padding:0;display:flex;flex-direction:column;gap:6px}',
      '.apb-feats li{font-size:11.6px;line-height:1.6;color:var(--txt2);padding-inline-start:18px;position:relative}',
      '.apb-feats li::before{content:"✓";position:absolute;inset-inline-start:0;color:var(--ok);font-weight:800}',
      '.apb-plan .mb{inline-size:100%;margin-block-start:auto}',
      '.apb-cur{font-size:11px;color:var(--txt3);font-weight:700;text-align:center}',

      /* --- cartes, listes, jauge --- */
      '.apb-card{display:flex;flex-direction:column;gap:9px;padding:14px;border-radius:var(--r2);' +
        'border:1px solid var(--line);background:var(--surface2)}',
      '.apb-card-h{font-size:12.5px;color:var(--txt)}',
      '.apb-kv{display:flex;justify-content:space-between;gap:10px;font-size:12px;color:var(--txt2)}',
      '.apb-kv b{color:var(--txt);font-weight:700;text-align:end}',
      '.apb-gauge{height:8px;border-radius:99px;background:var(--bg2);overflow:hidden;border:1px solid var(--line)}',
      '.apb-gauge i{display:block;height:100%;background:var(--brand);transition:inline-size .25s}',
      '.apb-gauge i[data-plein="1"]{background:var(--warn)}',
      '.apb-hint{font-size:11px;line-height:1.65;color:var(--txt3)}',
      '.apb-list{display:flex;flex-direction:column;gap:7px}',
      '.apb-row{display:flex;align-items:center;gap:10px;padding:9px 11px;border-radius:11px;' +
        'border:1px solid var(--line);background:var(--surface)}',
      '.apb-row .apb-main{flex:1;min-width:0}',
      '.apb-row b{display:block;font-size:12.5px;color:var(--txt);font-weight:600;' +
        'overflow:hidden;text-overflow:ellipsis;white-space:nowrap}',
      '.apb-row small{font-size:11px;color:var(--txt3)}',
      '.apb-row select{height:32px;border-radius:9px;border:1px solid var(--line);background:var(--surface2);' +
        'font-size:11.5px;padding-inline:8px;color:var(--txt)}',
      '.apb-x{border:0;background:none;color:var(--bad);font-size:12px;font-weight:700;cursor:pointer;padding:4px 6px}',
      '.apb-actions{display:flex;gap:8px;flex-wrap:wrap;align-items:center}',
      '.apb-empty{font-size:11.6px;color:var(--txt3);padding:6px 2px}',

      /* --- messages --- */
      '.apb-msg{padding:9px 12px;border-radius:11px;font-size:12px;line-height:1.65;' +
        'border:1px solid var(--line);background:var(--bg2);color:var(--txt2)}',
      '.apb-msg.ok{color:var(--ok);background:color-mix(in srgb,var(--ok) 10%,transparent);' +
        'border-color:color-mix(in srgb,var(--ok) 34%,var(--line))}',
      '.apb-msg.bad{color:var(--bad);background:color-mix(in srgb,var(--bad) 10%,transparent);' +
        'border-color:color-mix(in srgb,var(--bad) 34%,var(--line))}',
      '.apb-msg[hidden]{display:none}',
      '.apb-key{font-family:ui-monospace,SFMono-Regular,Menlo,monospace;letter-spacing:1px;text-transform:uppercase}',
      '.apb-busy{opacity:.6;pointer-events:none}',

      /* --- le blocage doux, cote affichage --- */
      /* On n'ecrit AUCUNE regle qui cacherait le contenu : la lecture reste
         entiere. On se contente de griser les boutons d'ecriture QUE
         l'application aura bien voulu marquer « data-ap-write-btn ». Rien
         n'est casse si vous ne marquez rien. */
      'html[data-ap-access="0"] [data-ap-write-btn]{opacity:.45;pointer-events:none}'
    ].join('\n');
    document.head.appendChild(s);
  }


  /* =========================================================================
     PARTIE 6 — LE MORCEAU DE PAGE
     ========================================================================= */

  var interfaceComplete = true;

  function $(id) { return document.getElementById(id); }
  function ouvrir(id) { var m = $(id); if (m) { m.classList.add('show'); } }
  function fermer(id) { var m = $(id); if (m) { m.classList.remove('show'); } }

  function msg(id, texte, genre) {
    var e = $(id); if (!e) { return; }
    if (!texte) { e.hidden = true; e.textContent = ''; return; }
    e.hidden = false;
    e.textContent = texte;
    e.className = 'apb-msg' + (genre ? ' ' + genre : '');
  }
  function occupe(btn, oui) { if (btn) { btn.classList.toggle('apb-busy', !!oui); } }

  function injecterHTML() {
    if ($('apBillRoot')) { return Promise.resolve(true); }
    return fetch(DOSSIER + 'pricing.html')
      .then(function (r) { return r.ok ? r.text() : Promise.reject(new Error('http ' + r.status)); })
      .then(function (html) {
        var d = document.createElement('div');
        d.innerHTML = html;
        while (d.firstChild) { document.body.appendChild(d.firstChild); }
        return true;
      })
      .catch(function () {
        /* Page ouverte depuis le disque, ou fichier absent : on ne laisse pas
           l'utilisateur sans rien. Le bandeau, lui, est fabrique a la main —
           c'est le seul element vraiment indispensable. */
        interfaceComplete = false;
        return false;
      });
  }

  function traduire() {
    document.querySelectorAll('[data-apbt]').forEach(function (e) {
      e.textContent = T(e.getAttribute('data-apbt'));
    });
    document.querySelectorAll('[data-apbt-ph]').forEach(function (e) {
      e.placeholder = T(e.getAttribute('data-apbt-ph'));
    });
  }


  /* =========================================================================
     PARTIE 7 — LA PASTILLE
     ========================================================================= */

  function libellePastille() {
    if (S.etat === 'trial') {
      var n = S.joursRestants;
      return T('chipTrial') + (n !== null && n >= 0 ? ' · ' + n + ' j' : '');
    }
    if (S.etat === 'life')   { return T('chipLife'); }
    if (S.etat === 'late')   { return T('chipLate'); }
    if (S.etat === 'over')   { return T('chipExpired'); }
    if (S.etat === 'active') { return T('chipActive'); }
    return T('chipFree');
  }

  function majPastille() {
    var chip = $('apbChip'); if (!chip) { return; }
    var visible = ['trial', 'active', 'late', 'over', 'life'].indexOf(S.etat) >= 0;
    chip.hidden = !visible;
    if (!visible) { return; }
    chip.setAttribute('data-etat', S.etat);
    var l = $('apbChipLbl'); if (l) { l.textContent = libellePastille(); }
    var h = $('apbMenuHead');
    if (h) { h.textContent = (S.orgNom || '') + (S.estProprietaire ? ' — ' + T('roleOwner') : ''); }
    var m = $('apbMenu');
    if (m) {
      m.querySelectorAll('[data-apb-when="owner"]').forEach(function (e) {
        e.hidden = !S.estProprietaire;
      });
    }
  }

  function placerPastille() {
    var chip = $('apbChip'); if (!chip) { return; }
    var barre = document.querySelector('header .tools') || document.querySelector('.tools');
    if (barre) { barre.appendChild(chip); }
  }


  /* =========================================================================
     PARTIE 8 — LE BANDEAU
     ========================================================================= */

  var bandeauMasque = false;      // masque a la main pour cette visite

  function majBandeau() {
    var b = $('apbBanner');
    if (!b) { return; }

    var titre = '', sous = '', ton = '', bouton = '', ic = '⏳', act = 'pricing';

    if (S.etat === 'trial' && S.joursRestants !== null && S.joursRestants <= PRIX.alerteJours) {
      titre = T('bnTrialTitle');
      sous = (S.joursRestants <= 0) ? T('bnTrialLast') : T('bnTrialSub', { n: S.joursRestants });
      ton = (S.joursRestants <= 2) ? 'warn' : '';
      bouton = T('bnSubscribe'); ic = '⏳'; act = 'pricing';
    } else if (S.etat === 'late') {
      titre = T('bnLateTitle'); sous = T('bnLateSub'); ton = 'warn';
      bouton = T('bnFix'); ic = '💳'; act = 'portal';
    } else if (S.etat === 'over') {
      titre = T('bnOverTitle'); sous = T('bnOverSub'); ton = 'bad';
      bouton = T('bnSubscribe'); ic = '🔒'; act = 'pricing';
    }

    /* Cas particulier, et il vaut de l'argent : une cle a ete FABRIQUEE pour
       cette organisation (statut 'issued') mais personne ne l'a encore
       saisie. Le client a paye. Ce message passe avant tous les autres. */
    if (S.licenceEmise && !S.licence) {
      titre = T('bnKeyTitle');
      sous = T('bnKeySub', { p: S.licenceEmise.key_prefix || '' });
      ton = 'warn'; bouton = T('bnKeyGo'); ic = '🔑'; act = 'license';
    }

    /* Rien a dire : on se tait. Un bandeau permanent devient invisible, et le
       jour ou il annonce un vrai probleme plus personne ne le lit. */
    if (!titre) { b.hidden = true; return; }

    /* Le blocage doux, lui, n'est PAS masquable : il explique pourquoi les
       boutons ne repondent plus. Le reste, oui. */
    if (bandeauMasque && S.etat !== 'over') { b.hidden = true; return; }

    b.hidden = false;
    b.setAttribute('data-ton', ton);
    $('apbBannerIc').textContent = ic;
    $('apbBannerTitle').textContent = titre;
    $('apbBannerSub').textContent = sous;
    var go = $('apbBannerGo');
    go.textContent = bouton;
    go.setAttribute('data-apb-act', act);
    $('apbBannerX').hidden = (S.etat === 'over');
  }

  function placerBandeau() {
    var b = $('apbBanner'); if (!b) { return; }
    /* ON NE S'INSERE PAS DANS .wrap — ET CE N'EST PAS UN DETAIL.
       L'ancienne version posait le bandeau comme PREMIER ENFANT EN FLUX de
       .wrap. Or, en mode anneau, toute la geometrie de .wrap est calculee en
       absolu depuis son propre haut : .boards est en position:absolute a
       top:26px, et l'anneau (.wrap.ring::before, les .ring-node, #pan_brief)
       est pose a top:calc(var(--mainsH) + var(--rr) + 100px), ou --mainsH est
       mesure par syncMains() a partir de la SEULE hauteur de .boards, jamais
       de son decalage vertical. Un bloc en flux ajoute en tete de .wrap
       decale donc le contenu sans que l'anneau en sache rien : le cercle
       pointille et la bulle centrale restent en place pendant que les cartes
       glissent. Et hors mode anneau, .wrap est un conteneur flex : le bandeau
       y devenait un element flex a cote des panneaux.
       On se pose donc JUSTE AVANT .wrap, entre la barre du haut et le
       contenu : le bandeau reste en haut de page, dans le flux normal, sans
       position fixe (un bandeau flottant masque toujours quelque chose sur un
       telephone) et sans jamais entrer dans la boite dont l'anneau depend. */
    var cible = document.querySelector('main') ||
                document.querySelector('.wrap') ||
                document.querySelector('#app');
    if (cible && cible.parentNode) { cible.parentNode.insertBefore(b, cible); return; }
    document.body.appendChild(b);
  }


  /* =========================================================================
     PARTIE 9 — LA GRILLE TARIFAIRE
     ========================================================================= */

  function suffixe(f) {
    if (f.mode === 'payment') { return T('onceOnly'); }
    if (f.parSiege) { return (S.cycle === 'an') ? T('perSeatYear') : T('perSeatMonth'); }
    return (S.cycle === 'an') ? T('perYear') : T('perMonth');
  }

  function cycleDe(f) {
    /* Une formule a paiement unique n'a qu'un seul « cycle ». */
    return (f.mode === 'payment') ? 'unique' : S.cycle;
  }

  function nbSieges(f) {
    if (!f.parSiege) { return f.sieges || 1; }
    var i = $('apbSeats');
    var n = i ? (parseInt(i.value, 10) || 1) : (f.sieges || 1);
    return Math.max(1, Math.min(200, n));
  }

  function dessinerGrille() {
    var g = $('apbGrid'); if (!g) { return; }
    g.innerHTML = '';

    /* La carte « essai », d'abord, et seulement si l'essai court encore.
       Proposer un essai a quelqu'un qui l'a deja consomme est une promesse
       que le serveur ne tiendra pas. */
    if (S.etat === 'trial' && S.joursRestants !== null && S.joursRestants > 0) {
      var c0 = document.createElement('div');
      c0.className = 'apb-plan';
      c0.innerHTML =
        '<h4>' + esc(T('planTrial')) + '</h4>' +
        '<div class="apb-desc">' + esc(T('descTrial', { n: PRIX.essaiJours })) + '</div>' +
        '<div class="apb-price"><b>' + esc(String(S.joursRestants)) + '</b>' +
        '<small>' + esc(lang() === 'ar' ? 'يوم متبقٍ' : 'jour(s) restant(s)') + '</small></div>' +
        '<ul class="apb-feats"><li>' + esc(T('featTasks')) + '</li><li>' + esc(T('featGoogle')) + '</li></ul>' +
        '<button type="button" class="mb" disabled>' + esc(T('current')) + '</button>';
      g.appendChild(c0);
    }

    for (var i = 0; i < PRIX.formules.length; i++) {
      g.appendChild(carteFormule(PRIX.formules[i]));
    }

    /* Le champ « nombre de sieges » ne sert qu'aux formules par siege. */
    var fld = $('apbSeatsFld');
    if (fld) {
      var besoin = PRIX.formules.some(function (f) { return f.parSiege; });
      fld.hidden = !besoin;
    }
  }

  function esc(s) {
    return String(s === null || s === undefined ? '' : s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }

  function carteFormule(f) {
    var cy = cycleDe(f);
    var tarifs = f.montants[cy] || {};
    var pu = tarifs[S.devise];
    var d = document.createElement('div');
    d.className = 'apb-plan' + (f.populaire ? ' pop' : '');

    var html = '';
    if (f.populaire) { html += '<span class="apb-tag">' + esc(T('popular')) + '</span>'; }
    html += '<h4>' + esc(nomFormule(f.id)) + '</h4>';
    html += '<div class="apb-desc">' + esc(T('desc' + f.id.charAt(0).toUpperCase() + f.id.slice(1))) + '</div>';

    if (pu === undefined || pu === null) {
      /* Monnaie non prevue pour cette formule : on le dit au lieu d'afficher
         « undefined DA ». */
      html += '<div class="apb-price"><small>' +
        esc(lang() === 'ar' ? 'غير متوفّر بهذه العملة' : 'Non disponible dans cette monnaie') +
        '</small></div>';
    } else {
      html += '<div class="apb-price"><b>' + esc(montant(pu, S.devise)) + '</b>' +
              '<small>' + esc(suffixe(f)) + '</small></div>';
      if (f.parSiege) {
        /* Le total, calcule sous les yeux du client. Un prix « par siege »
           sans total est la premiere source de reclamation : on croit payer
           900 DA et on en paie 2 700. */
        var n = nbSieges(f);
        var parPeriode = (S.cycle === 'an') ? T('perYear') : T('perMonth');
        html += '<div class="apb-total">' + esc(T('total')) + ' (' + n + ') : ' +
                esc(montant(pu * n, S.devise)) + ' ' + esc(parPeriode) + '</div>';
      }
      if (S.cycle === 'an' && f.mode === 'subscription') {
        html += '<div class="apb-total">' + esc(T('saveYear')) + '</div>';
      }
    }

    html += '<ul class="apb-feats">';
    for (var k = 0; k < f.avantages.length; k++) {
      html += '<li>' + esc(T(f.avantages[k])) + '</li>';
    }
    html += '</ul>';

    /* Formule deja en cours : on ne propose pas de la racheter. */
    var deja = (S.abonnement && S.abonnement.plan === f.dbPlan &&
                ['active', 'trialing', 'past_due'].indexOf(S.abonnement.status) >= 0) ||
               (S.licence && f.mode === 'payment');

    if (deja) {
      html += '<button type="button" class="mb" disabled>' + esc(T('current')) + '</button>';
    } else if (pu === undefined || pu === null) {
      html += '<button type="button" class="mb" disabled>' + esc(T('choose')) + '</button>';
    } else {
      html += '<button type="button" class="mb pri" data-apb-buy="' + esc(f.id) + '">' +
              esc(T('choose')) + '</button>';
    }

    d.innerHTML = html;
    return d;
  }


  /* =========================================================================
     PARTIE 10 — LES APPELS AU SERVEUR (paiement, portail, licence)
     ----------------------------------------------------------------------
     Les trois Edge Functions font le vrai travail. Le navigateur ne connait
     ni la cle secrete Stripe, ni le secret de signature des licences, ni
     l'identifiant du tarif : il envoie une demande, il recoit une adresse.
     ========================================================================= */

  function retourVers() {
    /* Ou Stripe doit renvoyer le client. On prefere l'adresse declaree dans
       config.js : c'est elle qui figure dans la liste blanche du serveur. */
    return CFG.siteUrl || (location.origin + location.pathname);
  }

  /* Sortir le VRAI message du serveur.
     Piege de la librairie Supabase : quand une Edge Function repond autre
     chose qu'un code 2xx, l'erreur remise au navigateur dit seulement
     « Edge Function returned a non-2xx status code ». Le corps de la reponse,
     lui — celui qui contient la phrase utile — est range dans e.context.
     Sans ce petit detour, tous les problemes se ressemblent a l'ecran et le
     client ne sait jamais quoi faire. */
  async function detail(e) {
    try {
      if (e && e.context && typeof e.context.json === 'function') {
        var b = await e.context.json();
        return { code: (b && b.code) || '', message: (b && b.error) || '' };
      }
    } catch (x) { /* corps illisible : on retombe sur le message generique */ }
    return { code: '', message: String((e && e.message) || '') };
  }

  /* Un code renvoye par le serveur a toujours priorite : il est traduit, donc
     lisible en arabe comme en francais. */
  function texteDeCode(code) {
    if (code === 'personal_org')      { return T('licPersonal'); }
    if (code === 'already_subscribed'){ return T('alreadySub'); }
    return '';
  }

  function traduireErreur(e) {
    var m = String((e && (e.message || e.error_description || e)) || '').toLowerCase();
    if (!m) { return T('errGeneric'); }
    if (m.indexOf('failed to fetch') >= 0 || m.indexOf('network') >= 0 ||
        m.indexOf('load failed') >= 0) { return T('errNet'); }
    if (m.indexOf('404') >= 0 || m.indexOf('not found') >= 0 ||
        m.indexOf('function not found') >= 0) { return T('errNoFn'); }
    if (m.indexOf('proprietaire') >= 0 || m.indexOf('owner') >= 0 ||
        m.indexOf('insufficient') >= 0 || m.indexOf('403') >= 0) { return T('ownerOnly'); }
    if (m.indexOf('personnel') >= 0 || m.indexOf('personal') >= 0) { return T('licPersonal'); }
    if (m.indexOf('recente') >= 0 || m.indexOf('authentification') >= 0 ||
        m.indexOf('deux facteurs') >= 0) { return T('licReauth'); }
    if (m.indexOf('trop de tentatives') >= 0) { return T('licSlow'); }
    return T('errGeneric');
  }

  /* Le message final affiche : le code traduit s'il existe, sinon la phrase
     francaise du serveur quand l'interface est en francais (elle est precise
     et dit quoi faire), sinon la traduction generique. */
  async function messageErreur(e) {
    var d = await detail(e);
    var parCode = texteDeCode(d.code);
    if (parCode) { return parCode; }
    if (lang() === 'fr' && d.message && d.message.length > 3 &&
        d.message.indexOf('non-2xx') < 0) { return d.message; }
    return traduireErreur({ message: d.message || String((e && e.message) || '') });
  }

  /* --- ouvrir la page de paiement ---------------------------------------- */
  async function checkout(formuleId, opts) {
    opts = opts || {};
    if (!sb) { return false; }
    if (!S.orgId) { toast(T('noOrg')); return false; }
    if (!S.estProprietaire) { toast(T('ownerOnly')); return false; }

    var f = null;
    for (var i = 0; i < PRIX.formules.length; i++) {
      if (PRIX.formules[i].id === formuleId) { f = PRIX.formules[i]; }
    }
    if (!f) { return false; }

    toast(T('goPay'));
    try {
      var r = await sb.functions.invoke('checkout', {
        body: {
          org_id: S.orgId,
          /* Trois mots seulement : le serveur fait la traduction en tarif
             Stripe. Le navigateur ne choisit jamais un prix. */
          formule: f.id,
          cycle: cycleDe(f),
          devise: opts.devise || S.devise,
          sieges: nbSieges(f),
          langue: lang(),
          /* Metadonnees utiles au webhook pour une cle a vie. Elles sont
             RECOPIEES par le serveur apres verification : on ne lui fait pas
             confiance sur parole. */
          licence_max_postes: PRIX.aVieMaxPostes,
          licence_expire: PRIX.aVieExpire,
          retour_ok: retourVers() + '#ap_pay=ok',
          retour_annule: retourVers() + '#ap_pay=annule'
        }
      });
      if (r.error) { throw r.error; }
      var url = r.data && r.data.url;
      if (!url) { throw new Error('adresse de paiement absente'); }
      location.href = url;         // on quitte la page : Stripe prend la main
      return true;
    } catch (e) {
      msg('apbPricingMsg', await messageErreur(e), 'bad');
      return false;
    }
  }

  /* --- ouvrir le portail client ------------------------------------------ */
  async function portal() {
    if (!sb) { return false; }
    if (!S.orgId) { toast(T('noOrg')); return false; }
    if (!S.estProprietaire) { toast(T('ownerOnly')); return false; }

    toast(T('goPortal'));
    try {
      var r = await sb.functions.invoke('portal', {
        body: { org_id: S.orgId, langue: lang(), retour: retourVers() }
      });
      if (r.error) { throw r.error; }
      var d = r.data || {};

      /* « no_customer » n'est pas une panne : cette organisation n'a
         simplement jamais rien paye, il n'y a donc aucune fiche a gerer chez
         Stripe. On ouvre la grille tarifaire, qui est ce que la personne
         cherchait en realite. */
      if (d.code === 'no_customer') { ouvrirTarifs(); return false; }

      if (!d.url) { throw new Error('adresse du portail absente'); }
      location.href = d.url;
      return true;
    } catch (e) {
      toast(await messageErreur(e));
      return false;
    }
  }

  /* --- verifier une cle (sans rien engager) ------------------------------- */
  async function verifierCle(cle) {
    if (!sb) { return null; }
    var r = await sb.functions.invoke('license-verify', {
      body: { action: 'check', key: cle }
    });
    if (r.error) { throw r.error; }
    return r.data || null;
  }

  /* --- activer une cle sur l'organisation --------------------------------- */
  async function redeem(cle) {
    if (!sb) { return false; }
    if (!S.orgId) { msg('apbLicMsg', T('noOrg'), 'bad'); return false; }

    try {
      var r = await sb.functions.invoke('license-verify', {
        body: { action: 'redeem', key: cle, org_id: S.orgId }
      });
      if (r.error) { throw r.error; }
      var d = r.data || {};
      if (!d.valid) {
        var raison = d.reason || 'invalid';
        msg('apbLicMsg',
            raison === 'expired' ? T('licExpired') :
            raison === 'too_many_devices' ? T('licTooMany') :
            raison === 'personal_org' ? T('licPersonal') :
            raison === 'not_owner' ? T('licOwner') :
            raison === 'reauth' ? T('licReauth') :
            raison === 'rate' ? T('licSlow') : T('licBad'),
            'bad');
        return false;
      }
      msg('apbLicMsg', T('licDone'), 'ok');
      toast(T('licDone'));
      /* On relit l'etat : l'acces vient peut-etre de s'ouvrir. */
      await lireEtat();
      if (AP.auth && typeof AP.auth.refresh === 'function') { try { await AP.auth.refresh(); } catch (e) { } }
      return true;
    } catch (e) {
      msg('apbLicMsg', await messageErreur(e), 'bad');
      return false;
    }
  }


  /* =========================================================================
     PARTIE 11 — L'EQUIPE
     ----------------------------------------------------------------------
     CE QUE LE SQL IMPOSE, ET QU'IL FAUT AVOIR EN TETE :
       * On n'inscrit JAMAIS quelqu'un de force. La policy member_insert exige
         « members.user_id = auth.uid() » : chaque personne cree SA propre
         ligne d'appartenance, et seulement si une invitation a son adresse
         l'attend (public.invitation_matches). Cet ecran cree donc une
         INVITATION, pas un membre.
       * Le serveur n'envoie aucun courriel. Il n'y a pas de fonction SQL pour
         cela, et l'envoi d'e-mail d'invitation de Supabase reclame la cle
         service_role, qui n'existe pas dans le navigateur. On l'ecrit noir sur
         blanc a l'ecran plutot que de laisser croire a un envoi.
       * On ne peut pas MODIFIER une invitation : le droit SQL n'a ete accorde
         que sur INSERT, SELECT et DELETE. « Renvoyer » une invitation, c'est
         donc la supprimer puis la recreer — sans quoi la contrainte d'unicite
         (org_id, email) fait echouer la seconde.
       * Inviter exige org_has_access(org) : une organisation dont l'essai est
         fini ne peut plus agrandir l'equipe. C'est coherent avec le blocage
         doux, et cet ecran l'explique au lieu d'afficher une erreur brute.
     ========================================================================= */

  async function chargerEquipe() {
    if (!sb || !S.orgId) { return; }
    var liste = $('apbTeamList');
    var pend = $('apbPendingList');
    if (!liste) { return; }

    liste.innerHTML = '';
    if (pend) { pend.innerHTML = ''; }

    var moi = (AP.auth && AP.auth.userId && AP.auth.userId()) || null;
    var peutGerer = (S.estProprietaire || (AP.auth && AP.auth.state && AP.auth.state.role === 'admin'));

    try {
      /* Les membres. On croise deux sources :
           - public.members  : l'appartenance et le role (visible de tout membre)
           - org_colleagues(): le nom affichable, par une fonction dediee qui
             ne renvoie QUE ce qui sert a afficher. Le serveur ne donne pas
             l'adresse e-mail des collegues : c'est une donnee personnelle, et
             la liste des adresses d'une entreprise a de la valeur. */
      var m = await sb.from('members').select('user_id, role, joined_at').eq('org_id', S.orgId);
      var noms = {};
      try {
        var c = await sb.rpc('org_colleagues', { p_org: S.orgId });
        ((c && c.data) || []).forEach(function (p) { noms[p.id] = p.full_name || ''; });
      } catch (e) { /* le nom n'est qu'un confort */ }

      var lignes = (m && m.data) || [];
      S.siegesUtilises = lignes.length || 1;

      if (!lignes.length) {
        liste.innerHTML = '<div class="apb-empty">' + esc(T('noMembers')) + '</div>';
      }

      lignes.sort(function (a, b) {
        var ordre = { owner: 0, admin: 1, employee: 2, viewer: 3 };
        return (ordre[a.role] || 9) - (ordre[b.role] || 9);
      });

      lignes.forEach(function (li) {
        var estMoi = (li.user_id === moi);
        var row = document.createElement('div');
        row.className = 'apb-row';

        var nom = noms[li.user_id] || (estMoi ? T('you') : '—');
        var sous = nomRole(li.role) + (estMoi ? ' · ' + T('you') : '');

        var h = '<div class="apb-main"><b>' + esc(nom) + '</b><small>' + esc(sous) + '</small></div>';

        /* Changer un role. Le serveur refuse (policy member_update) :
             - si l'on n'est ni proprietaire ni administrateur ;
             - si l'on touche SA PROPRE ligne de proprietaire (pas
               d'auto-decapitation de l'organisation) ;
             - si un administrateur touche la ligne d'un proprietaire.
           On grise donc exactement les memes cas, pour ne pas donner de faux
           espoirs. */
        var modifiable = peutGerer && !(estMoi && li.role === 'owner') &&
                         (li.role !== 'owner' || S.estProprietaire);

        if (modifiable) {
          h += '<select data-apb-role="' + esc(li.user_id) + '">' +
               opt('owner', li.role, S.estProprietaire) +
               opt('admin', li.role, true) +
               opt('employee', li.role, true) +
               opt('viewer', li.role, true) +
               '</select>';
          if (!(estMoi && li.role === 'owner')) {
            h += '<button type="button" class="apb-x" data-apb-del="' + esc(li.user_id) +
                 '" data-apb-nom="' + esc(nom) + '">' + esc(T('remove')) + '</button>';
          }
        }

        row.innerHTML = h;
        liste.appendChild(row);
      });

      /* Les invitations en attente de cette organisation. */
      var inv = await sb.from('invitations')
        .select('id, email, role, expires_at, accepted_at')
        .eq('org_id', S.orgId).is('accepted_at', null);
      var attente = (inv && inv.data) || [];
      S.invitationsEnAttente = attente.length;

      var carte = $('apbPendingCard');
      if (carte) { carte.hidden = !attente.length; }
      if (pend && attente.length) {
        attente.forEach(function (iv) {
          var row = document.createElement('div');
          row.className = 'apb-row';
          var perime = iv.expires_at && (new Date(iv.expires_at).getTime() < Date.now());
          row.innerHTML =
            '<div class="apb-main"><b dir="ltr">' + esc(iv.email) + '</b><small>' +
            esc(nomRole(iv.role)) + (perime ? ' · ' + esc(lang() === 'ar' ? 'منتهية' : 'perimee') : '') +
            '</small></div>' +
            (peutGerer ? '<button type="button" class="apb-x" data-apb-unvite="' + esc(iv.id) + '">' +
                         esc(T('revoke')) + '</button>' : '');
          pend.appendChild(row);
        });
      }

      majJauge();
      await chargerMesInvitations();
    } catch (e) {
      msg('apbTeamMsg', traduireErreur(e), 'bad');
    }
  }

  function opt(valeur, courant, autorise) {
    if (!autorise) { return ''; }
    return '<option value="' + valeur + '"' + (courant === valeur ? ' selected' : '') + '>' +
           esc(nomRole(valeur)) + '</option>';
  }

  function majJauge() {
    var connu = (typeof S.siegesPayes === 'number' && S.siegesPayes > 0);
    var plein = connu && (S.siegesUtilises >= S.siegesPayes);

    var u = $('apbSeatUsed');
    if (u) { u.textContent = T('seatsOf', { a: S.siegesUtilises, b: connu ? S.siegesPayes : '—' }); }

    var g = $('apbGauge');
    if (g) {
      var pct = connu
        ? Math.max(0, Math.min(100, Math.round(S.siegesUtilises * 100 / S.siegesPayes)))
        : 0;
      g.style.inlineSize = pct + '%';
      g.setAttribute('data-plein', plein ? '1' : '0');
    }

    var n = $('apbSeatNote');
    if (n) {
      var txt = T('seatsCount');
      if (!connu) { txt = T('seatsUnknown') + ' ' + txt; }
      else if (plein) { txt = T('seatsFull') + ' ' + txt; }
      else if (S.etat === 'trial') { txt = T('seatsTrial') + ' ' + txt; }
      n.textContent = txt;
    }
    /* Inviter alors que l'acces est coupe echouerait cote serveur : on prefere
       l'expliquer avant le clic. */
    var go = $('apbInviteGo');
    if (go) { go.disabled = !AP.billing.canWrite(); }
    if (!AP.billing.canWrite()) { msg('apbInviteMsg', T('inviteNoAcc'), 'bad'); }
  }

  /* Les invitations qui me sont adressees, a moi, depuis une AUTRE
     organisation. La policy invitation_select me les montre par mon adresse. */
  async function chargerMesInvitations() {
    var carte = $('apbMyInvCard'), liste = $('apbMyInvList');
    if (!carte || !liste || !sb) { return; }
    liste.innerHTML = '';
    try {
      var r = await sb.from('invitations')
        .select('id, org_id, role, expires_at')
        .is('accepted_at', null);
      var mesInv = ((r && r.data) || []).filter(function (iv) { return iv.org_id !== S.orgId; });
      carte.hidden = !mesInv.length;
      mesInv.forEach(function (iv) {
        var row = document.createElement('div');
        row.className = 'apb-row';
        row.innerHTML =
          '<div class="apb-main"><b>' + esc(nomRole(iv.role)) + '</b><small dir="ltr">' +
          esc(iv.org_id.slice(0, 8)) + '…</small></div>' +
          '<button type="button" class="mb pri" data-apb-join="' + esc(iv.org_id) +
          '" data-apb-jrole="' + esc(iv.role) + '">' + esc(T('accept')) + '</button>';
        liste.appendChild(row);
      });
    } catch (e) { carte.hidden = true; }
  }

  async function inviter(email, role) {
    if (!sb || !S.orgId) { return false; }
    email = String(email || '').trim().toLowerCase();
    if (!/^[^@\s]{1,64}@[^@\s]{3,190}\.[a-z]{2,24}$/i.test(email)) {
      msg('apbInviteMsg', lang() === 'ar' ? 'بريد غير صالح.' : 'Adresse e-mail invalide.', 'bad');
      return false;
    }
    var moi = (AP.auth && AP.auth.userId && AP.auth.userId()) || null;
    var sept = new Date(Date.now() + 7 * 86400000).toISOString();

    try {
      var r = await sb.from('invitations').insert({
        org_id: S.orgId, email: email, role: role || 'employee',
        invited_by: moi, expires_at: sept
      });

      /* 23505 = doublon. Le droit UPDATE n'a pas ete accorde sur cette table :
         on supprime l'ancienne et on recree, ce qui repousse la date. */
      if (r.error && String(r.error.code) === '23505') {
        await sb.from('invitations').delete().eq('org_id', S.orgId).eq('email', email);
        r = await sb.from('invitations').insert({
          org_id: S.orgId, email: email, role: role || 'employee',
          invited_by: moi, expires_at: sept
        });
        if (!r.error) { msg('apbInviteMsg', T('inviteDup'), 'ok'); }
      }
      if (r.error) { throw r.error; }

      if (!$('apbInviteMsg') || $('apbInviteMsg').hidden) { msg('apbInviteMsg', T('inviteDone'), 'ok'); }
      var c = $('apbInviteMail'); if (c) { c.value = ''; }
      await chargerEquipe();
      return true;
    } catch (e) {
      /* 42501 / « row-level security » : la policy a refuse. Deux causes
         possibles, et il faut les distinguer pour ne pas faire perdre une
         heure au client. */
      var m = String((e && e.message) || '').toLowerCase();
      if (m.indexOf('row-level') >= 0 || m.indexOf('policy') >= 0) {
        msg('apbInviteMsg', AP.billing.canWrite() ? T('inviteDenied') : T('inviteNoAcc'), 'bad');
      } else {
        msg('apbInviteMsg', traduireErreur(e), 'bad');
      }
      return false;
    }
  }

  async function changerRole(userId, role) {
    if (!sb || !S.orgId) { return false; }
    try {
      var r = await sb.from('members').update({ role: role })
        .eq('org_id', S.orgId).eq('user_id', userId);
      if (r.error) { throw r.error; }
      toast(T('roleChanged'));
      await chargerEquipe();
      return true;
    } catch (e) {
      msg('apbTeamMsg', traduireErreur(e), 'bad');
      await chargerEquipe();
      return false;
    }
  }

  async function retirer(userId) {
    if (!sb || !S.orgId) { return false; }
    try {
      /* ORDRE IMPORTANT : on coupe d'abord les sessions, ON RETIRE ENSUITE.
         revoke_member_sessions() verifie que la personne EST membre ; appelee
         apres la suppression, elle echouerait, et l'ex-salarie garderait son
         acces jusqu'a l'expiration de son jeton. */
      try { await sb.rpc('revoke_member_sessions', { p_org: S.orgId, p_user: userId }); }
      catch (e) { /* si elle echoue, la suppression reste la bonne chose a faire */ }

      var r = await sb.from('members').delete().eq('org_id', S.orgId).eq('user_id', userId);
      if (r.error) { throw r.error; }
      toast(T('memberGone'));
      await chargerEquipe();
      await lireEtat();
      return true;
    } catch (e) {
      var m = String((e && e.message) || '');
      msg('apbTeamMsg', m.indexOf('proprietaire') >= 0 ? T('lastOwner') : traduireErreur(e), 'bad');
      return false;
    }
  }

  /* Accepter une invitation recue : on cree SA PROPRE ligne d'appartenance.
     C'est exactement ce que la policy member_insert autorise, et rien d'autre. */
  async function rejoindre(orgId, role) {
    if (!sb) { return false; }
    var moi = (AP.auth && AP.auth.userId && AP.auth.userId()) || null;
    if (!moi) { return false; }
    try {
      var r = await sb.from('members').insert({ org_id: orgId, user_id: moi, role: role });
      if (r.error) { throw r.error; }
      toast(lang() === 'ar' ? 'انضممت إلى المؤسّسة ✓' : 'Vous avez rejoint l’organisation ✓');
      if (AP.auth && typeof AP.auth.refresh === 'function') { try { await AP.auth.refresh(); } catch (e) { } }
      await lireEtat();
      await chargerEquipe();
      return true;
    } catch (e) {
      /* Le declencheur des sieges parle explicitement de « Places epuisees ». */
      var m = String((e && e.message) || '');
      msg('apbTeamMsg', m.indexOf('Places') >= 0 ? T('seatsFull') : traduireErreur(e), 'bad');
      return false;
    }
  }


  /* =========================================================================
     PARTIE 12 — LES BRANCHEMENTS
     ========================================================================= */

  function action(nom) {
    if (nom === 'pricing') { ouvrirTarifs(); }
    else if (nom === 'team') { ouvrirEquipe(); }
    else if (nom === 'license') { msg('apbLicMsg', ''); ouvrir('apbmLicense'); }
    else if (nom === 'portal') { portal(); }
    else if (nom === 'refresh') { lireEtat().then(function () { toast(T('menuRefresh')); }); }
  }

  function ouvrirTarifs() {
    msg('apbPricingMsg', '');
    dessinerGrille();
    ouvrir('apbmPricing');
  }

  function ouvrirEquipe() {
    msg('apbTeamMsg', '');
    msg('apbInviteMsg', '');
    ouvrir('apbmTeam');
    chargerEquipe();
  }

  function brancher() {

    /* --- pastille et menu --- */
    var b = $('apbChipBtn');
    if (b) {
      b.addEventListener('click', function (e) {
        e.stopPropagation();
        var m = $('apbMenu'); if (m) { m.hidden = !m.hidden; }
      });
    }
    document.addEventListener('click', function (ev) {
      var t = ev.target;
      /* Un clic DANS le menu ne le referme pas ici : l'action s'en charge
         juste apres. Sans ce test, le menu disparaitrait avant que le clic
         n'ait produit son effet sur certains navigateurs. */
      if (t && t.closest && t.closest('#apbMenu')) { return; }
      var m = $('apbMenu'); if (m && !m.hidden) { m.hidden = true; }
    });
    /* ATTENTION, PIEGE CLASSIQUE : on ne met PAS de stopPropagation sur le
       menu. Cela empecherait le grand ecouteur ci-dessous — pose sur le
       document — de voir les clics sur les entrees du menu, et aucune ne
       fonctionnerait. On filtre donc dans l'ecouteur de fermeture. */

    /* --- toutes les actions, en un seul ecouteur --- */
    /* Un ecouteur unique pose sur le document survit au redessin des cartes et
       des listes : sans cela, chaque rafraichissement obligerait a rebrancher
       les boutons, et on en oublierait un. */
    document.addEventListener('click', function (ev) {
      var t = ev.target;
      if (!t || !t.closest) { return; }

      var a = t.closest('[data-apb-act]');
      if (a) { var m2 = $('apbMenu'); if (m2) { m2.hidden = true; } action(a.getAttribute('data-apb-act')); return; }

      var x = t.closest('[data-apb-close]');
      if (x) { fermer(x.getAttribute('data-apb-close')); return; }

      var buy = t.closest('[data-apb-buy]');
      if (buy) { occupe(buy, true); checkout(buy.getAttribute('data-apb-buy')).then(function () { occupe(buy, false); }); return; }

      var cyc = t.closest('[data-apb-cycle]');
      if (cyc) {
        S.cycle = cyc.getAttribute('data-apb-cycle');
        var g1 = $('apbCycle');
        if (g1) { g1.querySelectorAll('.apb-segb').forEach(function (e2) { e2.classList.toggle('on', e2 === cyc); }); }
        dessinerGrille(); return;
      }

      var cur = t.closest('[data-apb-cur]');
      if (cur) {
        S.devise = cur.getAttribute('data-apb-cur');
        var g2 = $('apbDevise');
        if (g2) { g2.querySelectorAll('.apb-segb').forEach(function (e3) { e3.classList.toggle('on', e3 === cur); }); }
        dessinerGrille(); return;
      }

      var del = t.closest('[data-apb-del]');
      if (del) {
        var nom = del.getAttribute('data-apb-nom') || '';
        if (W.confirm(T('confirmRemove', { n: nom }))) { retirer(del.getAttribute('data-apb-del')); }
        return;
      }

      var unv = t.closest('[data-apb-unvite]');
      if (unv) {
        sb.from('invitations').delete().eq('id', unv.getAttribute('data-apb-unvite'))
          .then(function () { chargerEquipe(); });
        return;
      }

      var join = t.closest('[data-apb-join]');
      if (join) { rejoindre(join.getAttribute('data-apb-join'), join.getAttribute('data-apb-jrole')); return; }
    });

    /* --- le role change dans une liste deroulante --- */
    document.addEventListener('change', function (ev) {
      var t = ev.target;
      if (t && t.getAttribute && t.getAttribute('data-apb-role')) {
        changerRole(t.getAttribute('data-apb-role'), t.value);
      }
      if (t && t.id === 'apbSeats') { dessinerGrille(); }
    });

    /* --- fermeture des fenetres --- */
    document.querySelectorAll('.apb-modal').forEach(function (m) {
      m.addEventListener('click', function (e) { if (e.target === m) { m.classList.remove('show'); } });
    });
    document.addEventListener('keydown', function (e) {
      if (e.key === 'Escape') {
        document.querySelectorAll('.apb-modal.show').forEach(function (m) { m.classList.remove('show'); });
      }
    });

    /* --- bandeau --- */
    var bx = $('apbBannerX');
    if (bx) { bx.addEventListener('click', function () { bandeauMasque = true; majBandeau(); }); }

    /* --- invitation --- */
    var ig = $('apbInviteGo');
    if (ig) {
      ig.addEventListener('click', function () {
        occupe(ig, true);
        inviter(($('apbInviteMail') || {}).value, ($('apbInviteRole') || {}).value)
          .then(function () { occupe(ig, false); });
      });
    }

    /* --- licence --- */
    var lc = $('apbLicCheck');
    if (lc) {
      lc.addEventListener('click', async function () {
        var k = (($('apbKey') || {}).value || '').trim();
        if (!k) { return; }
        occupe(lc, true); msg('apbLicMsg', '');
        try {
          var d = await verifierCle(k);
          var carte = $('apbLicCard');
          if (d && d.valid) {
            msg('apbLicMsg', T('licValid'), 'ok');
            if (carte) {
              carte.hidden = false;
              $('apbLicPlan').textContent = d.plan || '—';
              $('apbLicSeats').textContent = d.seats || '—';
              $('apbLicExp').textContent = d.expires_at
                ? new Date(d.expires_at).toLocaleDateString(lang() === 'ar' ? 'ar-DZ' : 'fr-FR')
                : T('licNever');
            }
          } else {
            if (carte) { carte.hidden = true; }
            msg('apbLicMsg', (d && d.reason === 'expired') ? T('licExpired') : T('licBad'), 'bad');
          }
        } catch (e) { msg('apbLicMsg', traduireErreur(e), 'bad'); }
        occupe(lc, false);
      });
    }
    var lg = $('apbLicGo');
    if (lg) {
      lg.addEventListener('click', function () {
        var k = (($('apbKey') || {}).value || '').trim();
        if (!k) { return; }
        occupe(lg, true);
        redeem(k).then(function () { occupe(lg, false); });
      });
    }
    var hk = $('apbHaveKey');
    if (hk) { hk.addEventListener('click', function () { fermer('apbmPricing'); msg('apbLicMsg', ''); ouvrir('apbmLicense'); }); }
  }

  /* Le retour de Stripe. L'adresse porte « #ap_pay=ok » ou « #ap_pay=annule ».
     On dit ce qui s'est passe, on nettoie l'adresse (sinon le message revient
     a chaque rafraichissement), et on relit l'etat un peu plus tard : le
     webhook de Stripe peut mettre quelques secondes a arriver. */
  function lireRetour() {
    var h = location.hash || '';
    if (h.indexOf('ap_pay=') < 0) { return; }
    var ok = /ap_pay=ok/.test(h);
    toast(ok ? T('payBack') : T('payCancel'));
    try { history.replaceState(null, '', location.pathname + location.search); } catch (e) { }
    if (ok) {
      setTimeout(function () { lireEtat(); }, 2500);
      setTimeout(function () { lireEtat(); }, 9000);
    }
  }


  /* =========================================================================
     PARTIE 13 — MISE EN ROUTE
     ========================================================================= */

  function pretDOM() {
    if (document.body) { return Promise.resolve(); }
    return new Promise(function (ok) {
      document.addEventListener('DOMContentLoaded', function () { ok(); }, { once: true });
    });
  }

  async function demarrer() {
    /* AP.ready vient de app/supabase-client.js. Elle n'est JAMAIS rejetee :
       elle donne le client, ou null. Null = mode local, et on s'arrete la. */
    var client = null;
    try { client = AP.ready ? await AP.ready : null; } catch (e) { client = null; }

    if (!client) {
      /* Silence total. Pas de pastille, pas de bandeau, pas de console.
         L'application reste exactement ce qu'elle est aujourd'hui. */
      S.etat = 'local';
      document.documentElement.setAttribute('data-ap-billing', 'local');
      document.documentElement.setAttribute('data-ap-access', '1');
      return;
    }
    sb = client;

    await pretDOM();
    injecterCSS();
    await injecterHTML();
    if (!interfaceComplete) {
      /* Le morceau de page n'a pas pu etre charge : on ne bloque rien, mais on
         garde l'API utilisable par les autres briques et par la console. */
      AP.billing.refresh = lireEtat;
      await lireEtat();
      return;
    }

    traduire();
    placerPastille();
    placerBandeau();
    brancher();

    /* Les vraies fonctions remplacent les coquilles vides. */
    AP.billing.refresh = lireEtat;
    AP.billing.openPricing = ouvrirTarifs;
    AP.billing.openTeam = ouvrirEquipe;
    AP.billing.openLicense = function () { msg('apbLicMsg', ''); ouvrir('apbmLicense'); };
    AP.billing.checkout = checkout;
    AP.billing.portal = portal;
    AP.billing.redeem = redeem;
    AP.billing.invite = inviter;
    AP.billing.setRole = changerRole;
    AP.billing.removeMember = retirer;
    AP.billing.join = rejoindre;

    /* La langue change : on retraduit, et on redessine les libelles calcules
       (les prix, les noms de formule) qui ne portent pas de data-apbt. */
    if (AP.ui && typeof AP.ui.onLang === 'function') {
      AP.ui.onLang(function () {
        traduire();
        majPastille();
        majBandeau();
        if ($('apbmPricing') && $('apbmPricing').classList.contains('show')) { dessinerGrille(); }
        if ($('apbmTeam') && $('apbmTeam').classList.contains('show')) { chargerEquipe(); }
      });
    }

    /* La brique COMPTES nous previent quand quelqu'un se connecte, se
       deconnecte ou change d'organisation. On ne sonde pas le serveur en
       boucle : on ecoute. */
    if (AP.auth && typeof AP.auth.on === 'function') {
      AP.auth.on('change', function () { lireEtat(); });
    }

    await lireEtat();
    lireRetour();

    /* Le reseau revient : on retente une lecture. */
    W.addEventListener('online', function () { lireEtat(); });
    W.addEventListener('offline', function () {
      S.etat = 'offline'; S.acces = true; appliquer();
    });

    /* Un rappel tranquille une fois par heure, pour que le compte a rebours
       d'essai se mette a jour sur un poste laisse ouvert toute la journee. */
    setInterval(function () { if (S.etat !== 'local') { lireEtat(); } }, 3600000);
  }

  demarrer();

})();
