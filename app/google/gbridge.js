/* ============================================================================
   AGENDA PRO — app/google/gbridge.js
   LE BRANCHEMENT : ce qui relie les deux briques Google au tableau de bord,
   et ce que l'artisan voit.
   ----------------------------------------------------------------------------

   ###########################################################################
   #  LA REGLE QUI PASSE AVANT TOUT LE RESTE — L'AGENDA N'EST PAS A NOUS     #
   #  --------------------------------------------------------------------   #
   #  Cet agenda Google est le VRAI agenda de l'artisan. Le programme n'a     #
   #  PAS le droit de toucher a :                                            #
   #                                                                         #
   #      summary       (le titre du rendez-vous)                            #
   #      description   (le texte du rendez-vous)                            #
   #      start / end   (la date et l'heure)                                 #
   #      attendees     (les personnes invitees)                             #
   #      recurrence    (« tous les lundis »)                                #
   #                                                                         #
   #  Il n'ecrit QUE dans extendedProperties.private.                        #
   #                                                                         #
   #  ET CE FICHIER-CI N'ECRIT MEME PAS CELA. Relisez-le : il n'y a pas un   #
   #  seul fetch(), pas un seul appel a AP.gauth.appel(), pas un seul        #
   #  AP.gsync.setStatus() declenche par le programme. Les seules ecritures   #
   #  que ce fichier peut provoquer sont celles que l'artisan declenche en    #
   #  cochant une case dans le tableau de bord : elles partent par les        #
   #  fonctions de index.html, que app/google/gsync.js enveloppe deja.        #
   #                                                                         #
   #  CE FICHIER NE FAIT QUE TROIS CHOSES :                                   #
   #    1. il branche les briques entre elles ;                              #
   #    2. il lit, il affiche, il compte ;                                   #
   #    3. il ecrit dans le localStorage de CET appareil.                    #
   #                                                                         #
   #  ET CETTE REGLE N'EST PAS QU'UN COMMENTAIRE. PARTIE 3 installe un       #
   #  garde-fou (verrouRegle) qui, au demarrage, verifie que corpsSur() du   #
   #  moteur refuse bien un titre. Si un jour quelqu'un affaiblit le moteur, #
   #  le pont REFUSE de se brancher et le dit — au lieu de laisser partir    #
   #  une modification dans le vrai agenda de l'artisan.                     #
   ###########################################################################


   A QUOI SERT CE FICHIER, EN UNE PHRASE
   -------------------------------------
   app/google/gauth.js sait obtenir un jeton. app/google/gsync.js sait lire et
   annoter les rendez-vous. Ni l'un ni l'autre ne connait index.html. Ce
   fichier-ci fait les presentations, et il s'occupe des quatre choses que
   l'artisan verra vraiment :

     1. LES DOUBLONS. Les 765 rendez-vous ecrits en dur dans index.html
        servent de contenu tant que Google n'est pas branche. Le jour ou il
        l'est, le meme rendez-vous risque d'apparaitre deux fois : une fois
        en dur, une fois venu de Google. PARTIE 5 s'en occupe.

     2. LE PANNEAU GOOGLE. Lier, choisir les agendas a suivre, voir l'etat
        reel, synchroniser, delier. PARTIE 7.

     3. LE BOUTON « تحديث البيانات / Actualiser » de la barre du haut, qui
        doit enfin faire ce qu'il promet. PARTIE 8.

     4. LE RETOUR VISUEL HONNETE pendant la synchronisation : combien de
        rendez-vous lus, combien d'annotations envoyees, combien attendent
        encore — et, quand ca rate, LE VRAI MESSAGE DE GOOGLE. PARTIE 8.


   LA REGLE DU PROJET, RESPECTEE ICI COMME AILLEURS
   ------------------------------------------------
   TANT QUE L'ARTISAN N'A PAS BRANCHE GOOGLE, CE FICHIER NE FAIT RIEN.
   Pas de style ajoute, pas de fonction enveloppee, pas une ligne de console,
   pas un element dans la page, pas une milliseconde de calcul au rendu.
   C'est verifiable en une ligne : PARTIE 10 s'arrete sur `if (!actif())`.
   Le seul morceau qui existe toujours est AP.gbridge.ouvrir(), et il ne
   fabrique son panneau que lorsque l'artisan clique dessus.

   LA COUCHE SUPABASE N'EST NI CASSEE NI SUPPRIMEE
   -----------------------------------------------
   app/auth, app/sync et app/billing restent en place, intacts. Ce fichier ne
   leur prend rien, ne leur parle pas, et ne desactive rien chez eux. Le jour
   ou le quota Supabase sera regle, l'autre synchronisation reviendra A COTE
   de celle-ci. Les deux ecrivent dans le meme `store` local, par les memes
   fonctions de index.html : il n'y a rien a defaire ici pour la rebrancher.

   STYLE : JavaScript de navigateur, sans build, sans framework, sans npm.
   Variables CSS et classes de l'application. Tout texte visible en arabe ET
   en francais. Commentaires en francais, pour un lecteur qui n'est pas
   developpeur.

   CE QU'IL PUBLIE : window.AP.gbridge, et rien d'autre dans le global.
   ============================================================================ */

(function () {
  'use strict';

  var W = window;
  W.AP = W.AP || {};
  var AP = W.AP;

  /* Double inclusion de la balise <script> : on ne refait rien. */
  if (AP.gbridge) { return; }

  var VERSION = '1.0.0';


  /* =========================================================================
     PARTIE 1 — LES CONSTANTES ET LE DICTIONNAIRE
     Tout ce qui pourrait avoir besoin d'etre change un jour est ici, en haut.
     Chaque texte visible existe en arabe et en francais ; aucune phrase n'est
     ecrite en dur ailleurs dans le fichier.
     ========================================================================= */

  /* Le seul endroit du localStorage qui appartienne a ce fichier. On n'ecrit
     jamais dans les cles de gsync (agendapro_g_*) ni dans celles de setup. */
  var K_PONT = 'agendapro_g_pont_v1';

  /* Les trois facons de traiter les 765 rendez-vous ecrits en dur.
       'remplacer' : DEFAUT, et c'est ce que l'artisan a demande. Une fois la
                     premiere synchronisation reussie, Google est la source de
                     verite : les rendez-vous en dur qui tombent dans la
                     periode couverte par Google s'effacent. Ceux qui sont
                     en dehors (2027, par exemple, que Google ne lit pas
                     encore) RESTENT — on ne fait pas disparaitre du contenu
                     qu'on n'a pas remplace.
       'doublons'  : on ne cache que les doublons averes.
       'aucun'     : on ne cache rien. Utile une journee, pour comparer. */
  var MODES = ['remplacer', 'doublons', 'aucun'];

  /* Les origines qui viennent du fichier index.html lui-meme. Une tache
     'manuel' est une tache que l'artisan a tapee a la main : elle n'est
     JAMAIS cachee, meme si elle ressemble a un rendez-vous de Google. */
  var EN_DUR = ['principal', 'famille', 'feries'];   /* feries : sinon chaque jour ferie etait double des que l'agenda des fetes est suivi */

  var T = {
    ar: {
      titre:        'أجندة Google',
      sousTitre:    'المزامنة بين المكتب والهاتف عبر تقويم Google',

      /* --- l'etat de la liaison --- */
      pasConfig:    'لم يُضبط معرّف Google بعد.',
      pasConfigAide:'الصق هنا «معرّف العميل» (Client ID) المأخوذ من console.cloud.google.com. يبقى محفوظًا على هذا الجهاز وحده.',
      champId:      'معرّف العميل (ينتهي بـ apps.googleusercontent.com)',
      enregistrer:  'حفظ',
      idInvalide:   'هذا ليس معرّف عميل Google. يجب أن ينتهي بـ apps.googleusercontent.com',
      idEnregistre: 'تم حفظ المعرّف. اضغط «اربط» الآن.',

      nonLie:       'غير مربوط — البرنامج يعمل محليًا كما في السابق.',
      lie:          'مربوط',
      lieA:         'مربوط بـ <b>{x}</b>',
      lier:         'اربط',
      relier:       'أعد الربط',
      delier:       'افصل',
      synchroniser: 'زامن الآن',
      enCours:      'جارٍ…',

      jamaisSync:   'لم تتم أي مزامنة بعد',
      derniere:     'آخر مزامنة {x}',
      classementIci:'التصنيف (مؤسسة/شخصي) يُرسَل من هذا الجهاز: {n} سلسلة',
      classementOk: 'التصنيف وصل من الحاسوب: {n} سلسلة — {x}',
      classementNon:'التصنيف لم يصل بعد: اربط الحاسوب بـ Google مرة واحدة (مع Drive) ثم اضغط 🔄 هنا',
      classementDriveManque:'هذا الجهاز رُبط قبل إضافة هذه الخاصية، فلم يُمنح إذن Drive بعد — اضغط الزر لمنحه (لن تفقد ربط التقويم).',
      classementDriveManqueIci:'التصنيف لا يصل إلى الأجهزة الأخرى: هذا الجهاز (الذي يحمل بياناتك) لم يُمنح إذن Drive بعد — اضغط الزر لتفعيله.',
      classementActiver:'تفعيل تصنيف الأقسام',
      classementEnCours:'جارٍ الطلب من Google…',
      classementEchec:'رُفض الإذن أو أُغلقت النافذة — أعد المحاولة',
      tNow:         'قبل لحظات',
      tMin:         'منذ {n} دقيقة',
      tHour:        'منذ {n} ساعة',
      tDay:         'منذ {n} يوم',

      /* --- le choix des agendas --- */
      titreAgendas: 'التقاويم التي يتابعها البرنامج',
      aideAgendas:  'اختر التقاويم التي تريد رؤيتها في اللوحة. البرنامج يقرأ فقط ما تختاره.',
      aucunAgenda:  'لم تختر أي تقويم بعد — لا شيء سيظهر حتى تختار واحدًا على الأقل.',
      lectureSeule: 'قراءة فقط',
      principal:    'الرئيسي',
      chargerListe: 'تحديث قائمة التقاويم',
      listeKo:      'تعذّر جلب قائمة التقاويم. يمكنك متابعة تقويمك الرئيسي فقط في الأثناء.',
      listeKoBtn:   'تابِع التقويم الرئيسي',

      /* --- afficher les details dans la description visible --- */
      titreDetails: 'إظهار التفاصيل داخل الموعد',
      aideDetails:  'عند التفعيل، تُكتب الحالة والوثائق المؤشّرة والملاحظة داخل «وصف» الموعد الحقيقي في Google، وتظهر هناك — على هاتفك وفي تطبيق Google Agenda نفسه. تنبيه: تصبح مرئية لأي شخص يرى هذا الموعد، بمن فيهم المدعوّون في اجتماع مشترك. النص الذي كتبته أنت أو غيرك في الوصف لا يُمحى أبداً.',
      caseDetails:  'إظهار الحالة والوثائق والملاحظة في وصف الموعد داخل Google',
      detailsActives:  'تم التفعيل — ستظهر التفاصيل في وصف المواعيد التالية.',
      detailsDesactives: 'تم الإيقاف — التفاصيل السابقة تبقى في الوصف حتى تعديل تالٍ.',

      /* --- Google Tasks (app/google/gtasks.js) --- */
      titreTaches:  'قوائم مهام Google Tasks',
      aideTaches:   'اختر القوائم التي تريد رؤيتها في اللوحة، إلى جانب المواعيد.',
      aucuneTache:  'لم تختر أي قائمة بعد.',
      chargerTaches:'تحديث قائمة المهام',
      tachesKo:     'تعذّر جلب قوائم المهام من Google.',
      porteeTaches: 'لم يُمنح البرنامج بعدُ إذن قراءة مهامك في Google Tasks. اضغط الزر أدناه ووافق في نافذة Google — مرة واحدة فقط.',
      autoriserTaches: 'السماح بقراءة المهام',
      resumeTaches: 'وصلت {n}: منها {s} بدون تاريخ و{f} منجزة.',
      tachesLues:   'Google Tasks : {n}',
      bandeauTaches: 'مهامك في Google Tasks لا تظهر بعد: البرنامج يحتاج إذناً بقراءتها.',
      plusTardTaches: 'لاحقاً',

      /* --- ecrire dans Google Tasks : statut، عنوان، ملاحظة (app/google/gtasks.js) --- */
      titreEcritureTaches: 'كتابة التغييرات في Google Tasks الحقيقي',
      aideEcritureTaches: 'عند التفعيل: الضغط على «✓ مكتملة»، أو تعديل العنوان أو الملاحظة لمهمة مصدرها Google Tasks داخل هذا البرنامج، يُكتب أيضاً في تطبيق Google Tasks الحقيقي (على هاتفك وفي كل مكان). لا يُنشئ البرنامج أي مهمة ولا يحذف أي مهمة. يتطلب موافقة إضافية من Google تظهر مرة واحدة فقط.',
      tachesArrivees: 'وصلت مهامك من Google Tasks: {n}.',
      tachesChargement: 'جارٍ جلب مهامك من Google Tasks…',
      resumeZero:   'لم تصل أي مهمة بعد — القوائم المختارة فارغة.',
      tachesEnAttente: 'تغييرات بانتظار الإرسال إلى Google Tasks: {n}',
      bandeauTachesErreur: 'مهامك في Google Tasks لم تصل: {e}',
      ouvrirReglagesTaches: 'فتح الإعدادات',
      caseEcritureTaches: 'كتابة الإتمام والعنوان والملاحظة في Google Tasks الحقيقي',
      ecritureTachesActivee: 'تم التفعيل — التغييرات القادمة ستظهر في Google Tasks.',
      ecritureTachesDesactivee: 'تم الإيقاف — لن تُكتب التغييرات في Google Tasks بعد الآن.',
      ecritureTachesRefusee: 'تم رفض الإذن أو إغلاق النافذة — لم يتم التفعيل.',
      ecritureSansPermis: 'الكتابة في Google Tasks مفعّلة، لكن إذن Google لم يعد موجوداً (بعد فصل الحساب وإعادة ربطه مثلاً). التغييرات تبقى هنا فقط حتى تعيد منح الإذن.',
      ecritureRedemander: 'إعادة منح الإذن',

      /* --- le retour honnete pendant la synchronisation --- */
      travail:      'جارٍ المزامنة مع Google…',
      lus:          'مواعيد مقروءة',
      ecrits:       'تعديلات مُرسلة',
      attente:      'في الانتظار',
      masques:      'مكرّرات مخفية',
      fini:         'انتهت المزامنة',
      rienAFaire:   'لا شيء للمزامنة — اختر تقويمًا أولًا.',
      echec:        'فشلت المزامنة',
      msgGoogle:    'رسالة Google:',
      horsLigne:    'لا يوجد اتصال بالإنترنت. عملك محفوظ وسيُرسل عند عودة الشبكة.',

      /* --- les evenements en dur --- */
      titreDur:     'المواعيد المكتوبة داخل البرنامج',
      aideDur:      'هذه {n} موعدًا كُتبت داخل الملف قبل ربط Google. ماذا نفعل بها الآن؟',
      modeRemplacer:'Google هو المرجع — أخفِ ما غطّته المزامنة',
      modeDoublons: 'أخفِ المكرّر فقط',
      modeAucun:    'أظهر كل شيء (للمقارنة)',
      compteMasque: '{n} موعدًا مخفيًا حاليًا',
      compteZero:   'لا شيء مخفي حاليًا',
      annonce:      'Google صار المرجع: أُخفي {n} موعدًا كانت مكتوبة داخل البرنامج. يمكنك إرجاعها من «أجندة Google».',
      repris:       'نُقلت الحالة والوثائق من {n} موعدًا مكتوبًا إلى الموعد المقابل في Google.',

      /* --- délier --- */
      delierTitre:  'فصل Google؟',
      delierTexte:  'سيتوقف البرنامج عن قراءة تقويمك. لن يُحذف أي شيء من تقويم Google، ولن تُفقد ملاحظاتك المحفوظة على هذا الجهاز. المواعيد المكتوبة داخل البرنامج تعود للظهور.',
      delierOui:    'نعم، افصل',
      annuler:      'إلغاء',
      delie:        'تم فصل Google. البرنامج يعمل محليًا.',

      fermer:       'إغلاق',
      journalVoir:  'سجل التنبيهات ({n})',
      regleKo:      'تعذّر تفعيل المزامنة: حماية الكتابة في المحرّك ليست سليمة. لم يُربط شيء — وهذا هو التصرّف الصحيح.'
    },
    fr: {
      titre:        'Agenda Google',
      sousTitre:    'La synchronisation entre le bureau et le telephone, par Google Agenda',

      pasConfig:    'L\'identifiant Google n\'est pas encore renseigne.',
      pasConfigAide:'Collez ici l\'« ID client » pris sur console.cloud.google.com. Il reste sur cet appareil.',
      champId:      'ID client (se termine par apps.googleusercontent.com)',
      enregistrer:  'Enregistrer',
      idInvalide:   'Ce n\'est pas un ID client Google. Il doit finir par apps.googleusercontent.com',
      idEnregistre: 'Identifiant enregistre. Cliquez « Lier » maintenant.',

      nonLie:       'Non lie — le programme travaille en local, comme avant.',
      lie:          'Lie',
      lieA:         'Lie a <b>{x}</b>',
      lier:         'Lier',
      relier:       'Se reconnecter',
      delier:       'Delier',
      synchroniser: 'Synchroniser',
      enCours:      'En cours…',

      jamaisSync:   'aucune synchronisation pour l\'instant',
      derniere:     'derniere synchro {x}',
      classementIci:'Le classement (entreprise / personnel) part de cet appareil : {n} serie(s)',
      classementOk: 'Classement recu du bureau : {n} serie(s) — {x}',
      classementNon:'Classement pas encore recu : reliez le bureau a Google une fois (avec Drive), puis 🔄 ici',
      classementDriveManque:'Cet appareil a ete relie avant cette fonction : la permission Drive lui manque encore — cliquez pour l\'accorder (le calendrier reste relie).',
      classementDriveManqueIci:'Le classement ne part vers aucun autre appareil : CET appareil (qui porte vos donnees) n\'a pas la permission Drive — cliquez pour l\'activer.',
      classementActiver:'Activer le classement',
      classementEnCours:'Demande a Google…',
      classementEchec:'Permission refusee ou fenetre fermee — reessayez',
      tNow:         'a l\'instant',
      tMin:         'il y a {n} min',
      tHour:        'il y a {n} h',
      tDay:         'il y a {n} j',

      titreAgendas: 'Les agendas que le programme suit',
      aideAgendas:  'Cochez les agendas que vous voulez voir dans le tableau de bord. Le programme ne lit que ceux-la.',
      aucunAgenda:  'Aucun agenda coche — rien ne s\'affichera tant que vous n\'en cochez pas au moins un.',
      lectureSeule: 'lecture seule',
      principal:    'principal',
      chargerListe: 'Actualiser la liste des agendas',
      listeKo:      'La liste des agendas n\'a pas pu etre lue. Vous pouvez suivre votre agenda principal en attendant.',
      listeKoBtn:   'Suivre l\'agenda principal',

      /* --- afficher les details dans la description visible --- */
      titreDetails: 'Afficher les details dans le rendez-vous',
      aideDetails:  'Une fois active, le statut, les documents coches et la note sont ecrits dans la « description » reelle du rendez-vous chez Google, et y apparaissent — sur votre telephone et dans l\'application Google Agenda elle-meme. Attention : ce texte devient visible pour quiconque voit ce rendez-vous, invites compris pour une reunion partagee. Le texte deja ecrit par vous ou par quelqu\'un d\'autre dans la description n\'est jamais efface.',
      caseDetails:  'Afficher le statut, les documents et la note dans la description Google',
      detailsActives:  'Active — les details apparaitront dans la description des prochains rendez-vous modifies.',
      detailsDesactives: 'Desactive — les details deja ecrits restent dans la description jusqu\'a la prochaine modification.',

      /* --- Google Tasks (app/google/gtasks.js) --- */
      titreTaches:  'Listes Google Tasks',
      aideTaches:   'Cochez les listes que vous voulez voir dans le tableau de bord, a cote des rendez-vous.',
      aucuneTache:  'Aucune liste cochee pour l\'instant.',
      chargerTaches:'Actualiser la liste des taches',
      tachesKo:     'La liste des taches n\'a pas pu etre lue depuis Google.',
      porteeTaches: 'Le programme n\'a pas encore le droit de lire vos taches Google Tasks. Cliquez le bouton ci-dessous et acceptez dans la fenetre Google — une seule fois.',
      autoriserTaches: 'Autoriser la lecture des taches',
      resumeTaches: '{n} tache(s) recue(s) : {s} sans date et {f} terminee(s).',
      tachesLues:   'Google Tasks : {n}',
      bandeauTaches: 'Vos taches Google Tasks ne s\'affichent pas encore : le programme a besoin du droit de les lire.',
      plusTardTaches: 'Plus tard',

      /* --- ecrire dans Google Tasks : statut, titre, note (app/google/gtasks.js) --- */
      titreEcritureTaches: 'Ecrire les changements dans Google Tasks',
      aideEcritureTaches: 'Une fois active : cliquer « ✓ Terminée », ou modifier le titre ou la note d\'une tache venue de Google Tasks dans ce programme s\'ecrit aussi dans l\'application Google Tasks reelle (sur votre telephone, partout). Le programme ne cree ni ne supprime jamais une tache. Necessite une autorisation Google supplementaire, demandee une seule fois.',
      tachesArrivees: 'Vos taches Google Tasks sont arrivees : {n}.',
      tachesChargement: 'Lecture de vos taches Google Tasks…',
      resumeZero:   'Aucune tache recue pour l\'instant — les listes choisies sont vides.',
      tachesEnAttente: 'Changements en attente d\'envoi vers Google Tasks : {n}',
      bandeauTachesErreur: 'Vos taches Google Tasks ne sont pas arrivees : {e}',
      ouvrirReglagesTaches: 'Ouvrir les reglages',
      caseEcritureTaches: 'Ecrire l\'achevement, le titre et la note dans Google Tasks reel',
      ecritureTachesActivee: 'Active — les prochains changements apparaitront dans Google Tasks.',
      ecritureTachesDesactivee: 'Desactive — les changements ne seront plus ecrits dans Google Tasks.',
      ecritureTachesRefusee: 'Autorisation refusee ou fenetre fermee — rien n\'a ete active.',
      ecritureSansPermis: 'L\'ecriture dans Google Tasks est activee, mais l\'autorisation de Google n\'existe plus (apres avoir delie puis relie le compte, par exemple). Les changements restent ici jusqu\'a ce que vous la redonniez.',
      ecritureRedemander: 'Redonner l\'autorisation',

      travail:      'Synchronisation avec Google…',
      lus:          'rendez-vous lus',
      ecrits:       'annotations envoyees',
      attente:      'en attente',
      masques:      'doublons masques',
      fini:         'Synchronisation terminee',
      rienAFaire:   'Rien a synchroniser — choisissez d\'abord un agenda.',
      echec:        'La synchronisation a echoue',
      msgGoogle:    'Message de Google :',
      horsLigne:    'Pas de connexion. Votre travail est garde et partira au retour du reseau.',

      titreDur:     'Les rendez-vous ecrits dans le programme',
      aideDur:      'Ce sont les {n} rendez-vous inscrits dans le fichier avant la liaison Google. Qu\'en fait-on ?',
      modeRemplacer:'Google fait foi — masquer ce que la synchro couvre',
      modeDoublons: 'Masquer seulement les doublons',
      modeAucun:    'Tout afficher (pour comparer)',
      compteMasque: '{n} rendez-vous masques en ce moment',
      compteZero:   'rien n\'est masque en ce moment',
      annonce:      'Google fait foi desormais : {n} rendez-vous ecrits dans le programme ont ete masques. Vous pouvez les faire revenir depuis « Agenda Google ».',
      repris:       'Le statut et les documents de {n} rendez-vous ecrits dans le programme ont ete repris sur leur equivalent Google.',

      delierTitre:  'Delier Google ?',
      delierTexte:  'Le programme cessera de lire votre agenda. RIEN n\'est efface chez Google, et vos notes gardees sur cet appareil restent. Les rendez-vous ecrits dans le programme reviennent a l\'affichage.',
      delierOui:    'Oui, delier',
      annuler:      'Annuler',
      delie:        'Google est delie. Le programme travaille en local.',

      fermer:       'Fermer',
      journalVoir:  'Journal des avertissements ({n})',
      regleKo:      'Synchronisation non activee : la protection d\'ecriture du moteur n\'est pas saine. Rien n\'a ete branche — et c\'est le bon comportement.'
    }
  };

  function langue() {
    var l = (document.documentElement.lang || '').toLowerCase();
    return (l.indexOf('fr') === 0) ? 'fr' : 'ar';   // l'arabe est la langue par defaut
  }

  /* M('cle', {x:'valeur'}) — les accolades sont remplacees. */
  function M(cle, vars) {
    var d = T[langue()] || T.ar;
    var s = d[cle] || T.ar[cle] || '';
    if (vars) {
      Object.keys(vars).forEach(function (k) { s = s.split('{' + k + '}').join(vars[k]); });
    }
    return s;
  }

  /* Un texte venu de l'exterieur (le nom d'un agenda, un message de Google)
     ne doit jamais entrer dans du HTML sans passer par ici. */
  function propre(s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }

  /* « il y a 3 min », en langage courant. */
  function depuis(ms) {
    if (!ms) { return ''; }
    var d = Date.now() - ms;
    if (d < 0) { d = 0; }
    var mn = Math.floor(d / 60000);
    if (mn < 1)  { return M('tNow'); }
    if (mn < 60) { return M('tMin',  { n: mn }); }
    var h = Math.floor(mn / 60);
    if (h < 24)  { return M('tHour', { n: h }); }
    return M('tDay', { n: Math.floor(h / 24) });
  }

  function jget(cle, defaut) {
    try { var v = localStorage.getItem(cle); return v ? JSON.parse(v) : defaut; }
    catch (e) { return defaut; }
  }
  function jset(cle, valeur) {
    try { localStorage.setItem(cle, JSON.stringify(valeur)); return true; }
    catch (e) { return false; }
  }

  /* Le journal de CE fichier. Muet tant que Google n'est pas branche : c'est
     la regle du projet, et une console qui parle a quelqu'un qui n'a rien
     demande est exactement ce qu'on s'interdit. */
  function dire() {
    if (!actif()) { return; }
    try {
      var a = ['[pont Google]'].concat([].slice.call(arguments));
      console.log.apply(console, a);
    } catch (e) { }
  }
  function avert(msg) {
    try { console.warn('[pont Google] ' + msg); } catch (e) { }
  }

  function toast(msg) {
    if (P.toast) { try { P.toast(msg); return; } catch (e) { } }
    try {
      var e = document.getElementById('toast');
      if (!e) { return; }
      e.textContent = msg; e.classList.add('show');
      clearTimeout(toast._t);
      toast._t = setTimeout(function () { e.classList.remove('show'); }, 2600);
    } catch (e2) { }
  }


  /* =========================================================================
     PARTIE 2 — LE PONT VERS index.html
     ---------------------------------------------------------------------
     `store`, `state`, `TASKS` et `SUBS` sont declares avec let/const dans le
     grand bloc de script de index.html. Ces declarations sont visibles par
     tous les blocs de script de la page, mais elles n'existent PAS sur
     window : aucun fichier externe ne peut les atteindre. index.html nous les
     passe donc a la main, par AP.gbridge.brancher().
     ========================================================================= */

  var P = {
    store: null, state: null, lsSet: null, buildTasks: null,
    render: null, toast: null, TASKS: null, SUBS: null, rebuildBoards: null
  };

  var branche = false;

  function brancher(pont) {
    pont = pont || {};
    ['store', 'state', 'lsSet', 'buildTasks', 'render', 'toast', 'TASKS', 'SUBS', 'rebuildBoards']
      .forEach(function (k) { if (pont[k] !== undefined) { P[k] = pont[k]; } });
    branche = true;

    /* On repasse exactement le meme pont au moteur : il a besoin des memes
       choses, et deux ponts differents seraient deux occasions de diverger. */
    if (AP.gsync && typeof AP.gsync.bind === 'function') {
      try { AP.gsync.bind(P); } catch (e) { avert('bind du moteur : ' + e.message); }
    }
    /* Le meme pont, pour les listes Google Tasks (app/google/gtasks.js) :
       il n'a besoin que de TASKS et toast, pas du reste. */
    if (AP.gtasks && typeof AP.gtasks.bind === 'function') {
      try { AP.gtasks.bind({ TASKS: P.TASKS, toast: P.toast, store: P.store, lsSet: P.lsSet }); } catch (e) { avert('bind des taches : ' + e.message); }
    }

    /* LE DEMARRAGE DU MOTEUR — SANS LUI, RIEN NE REPART TOUT SEUL.
       C'est AP.gsync.init() qui, pour un artisan DEJA connecte une fois,
       redemande un jeton en silence, relit la liste des agendas, relance la
       premiere lecture et arme la minuterie de cinq minutes. Sans cet appel,
       le programme se contenterait de ce qu'il avait en reserve et n'irait
       plus jamais voir Google de lui-meme : l'artisan devrait appuyer sur
       « Actualiser » a chaque ouverture, ce qui est exactement ce dont il se
       plaignait.

       ON NE L'APPELLE QUE S'IL Y A UN IDENTIFIANT GOOGLE. La premiere ligne
       de init() ecrit dans la console ; pour quelqu'un qui n'a jamais
       entendu parler de Google, ce serait deja un message de trop. Et quand
       l'identifiant existe mais que l'artisan ne s'est jamais connecte,
       init() s'arrete de lui-meme sans ouvrir la moindre fenetre. */
    /* LE RACCORDEMENT, AVANT LE DEMARRAGE DU MOTEUR — ET C'EST TOUT L'INTERET.
       joindreLesBriques() etait bien ecrit, mais il n'etait atteint que par
       demarrer(), APRES AP.gsync.init(). Or init() est precisement l'endroit
       ou le moteur va chercher son premier jeton. Il partait donc le chercher
       tout seul, avec sa propre librairie et sa propre horloge, pendant que
       gauth en tenait une autre : deux fenetres Google, deux expirations qui
       ne s'accordent pas — et, sur le bureau, un moteur muet, puisque la
       librairie de Google ne sait pas travailler sur un port tire au hasard.
       Une seule autorite pour le jeton, celle de gauth, et elle doit etre en
       place AVANT qu'on demande quoi que ce soit au moteur. C'est la ligne
       documentee dans app/google/CONSOLE-GOOGLE.md. */
    if (clientId()) {
      try { joindreLesBriques(); } catch (e) { avert('raccordement des briques : ' + e.message); }
    }

    if (clientId() && AP.gsync && typeof AP.gsync.init === 'function') {
      try { AP.gsync.init(); } catch (e) { avert('demarrage du moteur : ' + e.message); }
    }

    demarrer();
    return AP.gbridge;
  }

  function taches() {
    if (!P.TASKS) { return null; }
    try { var l = P.TASKS(); return (l && typeof l.splice === 'function') ? l : null; }
    catch (e) { return null; }
  }


  /* =========================================================================
     PARTIE 3 — LE BRANCHEMENT DES DEUX BRIQUES, ET LE GARDE-FOU
     ---------------------------------------------------------------------
     UN SEUL JETON DANS TOUT LE PRODUIT.
     app/google/gsync.js sait obtenir un jeton tout seul, et app/google/
     gauth.js sait le faire aussi — mieux, puisque lui seul sait parler au
     processus principal d'Electron (le programme installe) et lui seul sait
     ATTENDRE sans rien perdre quand le jeton expire.

     Deux briques qui gardent chacune leur jeton, ce sont deux fenetres de
     Google qui s'ouvrent l'une apres l'autre, deux horloges d'expiration qui
     ne sont pas d'accord, et un bogue que personne ne retrouve. On les branche
     donc par la porte prevue pour cela :

         AP.gsync.setTokenProvider(AP.gauth.fournisseur);

     A partir de la, gauth detient le jeton, gsync fait le travail.
     ========================================================================= */

  /* LE GARDE-FOU. On ne se branche pas sur un moteur dont la protection
     d'ecriture serait cassee. On la met donc a l'epreuve, une fois, au
     demarrage : on lui donne un corps de requete qui contient un titre et une
     heure, et on verifie qu'il les RETIRE. S'il les laisse passer, on ne
     branche rien et on le dit. Mieux vaut un programme qui ne synchronise pas
     qu'un programme qui reecrit le vrai agenda de l'artisan. */
  function verrouRegle() {
    if (!(AP.gsync && AP.gsync._ && typeof AP.gsync._.corpsSur === 'function')) {
      /* Pas de fonction a mettre a l'epreuve : on ne peut rien affirmer, donc
         on ne se branche pas. Le silence n'est pas une preuve d'innocence. */
      return false;
    }

    /* L'ESSAI NE DOIT DERANGER PERSONNE, ET IL NE DOIT RIEN LAISSER DERRIERE.
       Quand corpsSur() retire un champ, il fait deux choses tres justes un
       jour de vraie tentative : il previent l'artisan par un message a
       l'ecran, et il inscrit le refus au journal des avertissements. Ici, ce
       n'est pas un incident, c'est NOTRE essai. Un garde-fou qui affole celui
       qu'il protege, et qui remplit son journal de fausses alertes, n'est pas
       un garde-fou : c'est un defaut de plus.
       On coupe donc le message le temps de l'essai, et on remet le journal
       dans l'etat exact ou on l'a trouve. La trace dans la console, elle,
       reste : elle ne derange personne et elle prouve que l'essai a eu lieu —
       c'est pour cela qu'on l'annonce juste avant. */
    var KJ = 'agendapro_g_journal_v1';
    var journalAvant = null, journalLu = false;
    try { journalAvant = localStorage.getItem(KJ); journalLu = true; } catch (e) { }

    var muet = (typeof P.toast === 'function' && typeof AP.gsync.bind === 'function');
    if (muet) { try { AP.gsync.bind({ toast: null }); } catch (e) { muet = false; } }

    dire('essai du garde-fou d\'ecriture — l\'avertissement qui suit est attendu.');

    var ok = false;
    try {
      var essai = AP.gsync._.corpsSur({
        summary: 'ESSAI — ce titre ne doit jamais sortir',
        start: { dateTime: '2026-01-01T09:00:00Z' },
        attendees: [{ email: 'personne@exemple.dz' }],
        extendedProperties: { private: { ap: '{"v":1}' } }
      });
      ok = !!(essai && !('summary' in essai) && !('start' in essai) &&
              !('attendees' in essai) && ('extendedProperties' in essai));
    } catch (e) { ok = false; }

    /* On remet tout comme avant, meme si l'essai a echoue. */
    if (journalLu) {
      try {
        if (journalAvant === null) { localStorage.removeItem(KJ); }
        else { localStorage.setItem(KJ, journalAvant); }
      } catch (e) { }
    }
    if (muet) { try { AP.gsync.bind({ toast: P.toast }); } catch (e) { } }

    dire('garde-fou d\'ecriture : ' + (ok ? 'sain.' : 'DEFAILLANT — on ne branche rien.'));
    return ok;
  }

  /* LA PERMISSION QUI MANQUE, ET POURQUOI ON LA CORRIGE ICI.
     gauth demande a Google « calendar.events.readonly » : le droit de lire les
     RENDEZ-VOUS. Mais pour afficher a l'artisan LA LISTE DE SES AGENDAS — et
     donc lui laisser choisir lesquels suivre — Google exige une permission
     differente, « calendar.readonly », qui couvre la liste ET les rendez-vous.
     gsync, lui, demandait deja la bonne.

     Les deux briques ont ete ecrites en meme temps et ne se sont pas mises
     d'accord sur ce point : c'est exactement le genre d'ecart qu'un pont
     existe pour rattraper. On elargit donc la permission de lecture AVANT la
     premiere demande d'autorisation.

     Est-ce qu'on en demande trop a l'artisan ? Non : « calendar.readonly »
     reste une permission de LECTURE. Elle ne permet toujours rien ecrire.
     Le droit d'ecriture reste une demande separee, faite plus tard, le jour
     ou l'artisan coche sa premiere case. */
  function corrigerPermissionLecture() {
    try {
      var g = AP.gauth;
      if (!g || !g.PORTEE) { return; }
      var etat = (typeof g.etat === 'function') ? g.etat() : null;
      /* Deja connecte : Google a deja accorde ce qu'il a accorde. On ne
         change rien a chaud, cela ne servirait qu'a brouiller l'affichage.
         La liste des agendas se rattrapera au prochain « Lier ». */
      if (etat && etat.connecte) { return; }
      if (g.PORTEE.lecture === 'https://www.googleapis.com/auth/calendar.events.readonly') {
        g.PORTEE.lecture = 'https://www.googleapis.com/auth/calendar.readonly';
        dire('permission de lecture elargie a calendar.readonly (pour la liste des agendas)');
      }
    } catch (e) { avert('permission de lecture : ' + e.message); }
  }

  var jointes = false;

  function joindreLesBriques() {
    if (jointes) { return true; }
    if (!(AP.gsync && AP.gauth)) { return false; }

    if (!verrouRegle()) {
      avert('REGLE DE SECURITE — le garde-fou d\'ecriture du moteur n\'a pas passe l\'essai. Le pont ne se branche pas.');
      toast(M('regleKo'));
      return false;
    }

    corrigerPermissionLecture();

    if (typeof AP.gsync.setTokenProvider === 'function' && typeof AP.gauth.fournisseur === 'function') {
      try {
        AP.gsync.setTokenProvider(AP.gauth.fournisseur);
        dire('un seul jeton pour tout le produit : celui de gauth.');
      } catch (e) { avert('setTokenProvider : ' + e.message); }
    }

    ecouterLaReconnexion();

    jointes = true;
    return true;
  }

  /* LE GESTE DU MILIEU, CELUI QUI MANQUAIT.
     Depuis que le jeton appartient a gauth, il n'arrive plus forcement au
     moment ou le moteur le demande : la reprise silencieuse de gauth aboutit
     une demi-seconde plus tard, et apres un refus de Google elle n'aboutit
     qu'une fois l'artisan revenu du bandeau. Personne n'etait charge de
     prevenir le moteur que le moment etait venu — il restait muet en attendant
     un signal deja passe, et la file d'envoi attendait avec lui.

     On ecoute donc l'etat du compte, et au passage a « relie » on remet le
     moteur au travail : ce qui attend part d'abord, la lecture vient ensuite.
     Le sens compte — envoyer avant de lire, c'est ne pas relire par-dessus ce
     qu'on n'a pas encore envoye. */
  var ecouteReco = false;

  function ecouterLaReconnexion() {
    if (ecouteReco) { return; }
    if (!(AP.gauth && typeof AP.gauth.onChange === 'function')) { return; }
    ecouteReco = true;

    var etaitRelie = false;
    AP.gauth.onChange(function (e) {
      if (!e) { return; }
      if (e.besoinReconnexion || !e.connecte) { etaitRelie = false; return; }
      if (etaitRelie) { return; }              // on ne repart qu'au passage
      etaitRelie = true;
      /* Relie PENDANT la session (par la pastille du haut, par exemple) :
         demarrer() n'avait pas tourne au chargement, et sans lui le panneau,
         le bandeau et l'annonce du resultat des taches restaient sourds. */
      try { demarrer(); } catch (err) { }
      dire('compte Google relie — le moteur se met au travail.');
      try {
        Promise.resolve(AP.gsync.vider())
          .then(function () {
            if (typeof AP.gsync.reveiller === 'function') { return AP.gsync.reveiller(); }
            return AP.gsync.pull();
          })
          .catch(function (err) { avert('reprise : ' + (err && err.message)); });
      } catch (err) { avert('reprise : ' + err.message); }
      /* Les listes Google Tasks partagent le meme jeton : meme signal de
         depart, sans bouton separe — voir app/google/gtasks.js. */
      try {
        if (AP.gtasks && typeof AP.gtasks.reveiller === 'function') { AP.gtasks.reveiller(); }
      } catch (err) { avert('reprise des taches : ' + err.message); }
    });
  }


  /* =========================================================================
     PARTIE 4 — « GOOGLE EST-IL BRANCHE ? »
     ---------------------------------------------------------------------
     Une seule fonction repond a cette question, et tout le fichier s'y fie.
     Elle doit rester bon marche : elle est appelee a chaque rendu.
     ========================================================================= */

  function clientId() {
    try {
      var c = W.AP_CONFIG || {};
      if (c.googleClientId) { return String(c.googleClientId).trim(); }
      var r = jget('agendapro_g_reglages_v1', {}) || {};
      return String(r.clientId || '').trim();
    } catch (e) { return ''; }
  }

  function infoMoteur() {
    if (!(AP.gsync && typeof AP.gsync.info === 'function')) { return null; }
    try { return AP.gsync.info(); } catch (e) { return null; }
  }

  function infoCompte() {
    if (!(AP.gauth && typeof AP.gauth.etat === 'function')) { return null; }
    try { return AP.gauth.etat(); } catch (e) { return null; }
  }

  /* ACTIF = il y a un identifiant Google ET le moteur tient au moins un
     rendez-vous, ou bien l'artisan s'est deja connecte une fois. Tant que
     c'est faux, ce fichier ne touche a rien dans la page. */
  function actif() {
    if (!clientId()) { return false; }
    var i = infoMoteur();
    if (!i) { return false; }
    return !!(i.connecte || i.taches > 0);
  }


  /* =========================================================================
     PARTIE 5 — LES DOUBLONS, ET CE QU'ON FAIT DES 765 RENDEZ-VOUS EN DUR
     ---------------------------------------------------------------------
     LE PROBLEME, EN UNE PHRASE. Les rendez-vous ecrits en dur dans index.html
     et ceux qui arrivent de Google decrivent souvent LE MEME rendez-vous. Sans
     rien faire, l'artisan le verrait deux fois, avec deux cases a cocher
     differentes — la pire des situations, puisqu'il ne saurait pas laquelle
     compte.

     COMMENT ON RECONNAIT QUE C'EST LE MEME. Deux moyens, du plus sur au moins
     sur, et on s'arrete au premier qui repond :

       1. L'IDENTIFIANT GOOGLE, quand il est la. 22 des rendez-vous « famille »
          portent un lien de la forme
              https://www.google.com/<le chemin de l evenement>?eid=XXXXXXXX
          Le morceau `eid` est un encodage (base64) de deux valeurs collees :
          « identifiant-de-l-evenement identifiant-de-l-agenda ». On le decode,
          on garde la premiere, et on la compare a l'identifiant que Google
          nous renvoie. Quand les deux sont egaux, il n'y a aucun doute
          possible : c'est le meme rendez-vous.

          IL FAUT LE DIRE FRANCHEMENT : ces identifiants n'existent que pour
          22 rendez-vous sur 765. Les 713 autres, et les 30 du calendrier
          principal, n'ont dans le fichier que leur date et leur heure. Le
          moyen n° 1 ne peut donc pas suffire, quoi qu'on en espere.

       2. LA CONCORDANCE NATURELLE : meme jour, meme heure de debut, et meme
          titre une fois nettoye (sans emoji, sans puce, sans voyelles arabes,
          sans double espace, sans majuscules). Pour un rendez-vous qui dure
          toute la journee, l'heure ne compte pas.

     ET POUR TOUT LE RESTE : LE MODE. Une fois la premiere synchronisation
     reussie, Google devient la source de verite. Les rendez-vous en dur qui
     tombent DANS LA PERIODE que Google vient de lire s'effacent, meme sans
     jumeau : s'ils n'y sont plus chez Google, c'est qu'ils n'y sont plus.
     Ceux qui tombent EN DEHORS de cette periode restent : on ne fait pas
     disparaitre du contenu qu'on n'a pas remplace. C'est le mode
     « remplacer », et l'artisan peut en changer dans le panneau.

     UNE TACHE TAPEE A LA MAIN N'EST JAMAIS CACHEE. Jamais, dans aucun mode.
     ========================================================================= */

  function reglagesPont() {
    var r = jget(K_PONT, null) || {};
    if (MODES.indexOf(r.mode) < 0) { r.mode = 'remplacer'; }
    r.reprises = r.reprises || {};    // les reprises de travail deja faites
    return r;
  }
  function poserReglagesPont(patch) {
    var r = Object.assign(reglagesPont(), patch || {});
    jset(K_PONT, r);
    return r;
  }

  /* Le titre, reduit a ce qui compte pour le comparer. On retire ce qu'un
     humain ne considere pas comme une difference : les emoji, les puces, les
     marques de direction du texte arabe, les voyelles, les espaces en trop. */
  function normTitre(s) {
    return String(s == null ? '' : s)
      .replace(/[​-‏‪-‮⁦-⁩﻿]/g, '')  // marques invisibles
      .replace(/[ـ]/g, '')                                        // tatweel arabe
      .replace(/[ً-ْٰ]/g, '')                           // voyelles arabes
      .replace(/[\uD800-\uDBFF][\uDC00-\uDFFF]/g, '')                  // emoji (paires)
      .replace(/[←-⯿☀-➿︎️⃣©®]/g, '')
      .replace(/[أإآ]/g, 'ا')                      // alif, toutes ses formes
      .replace(/[ة]/g, 'ه')                                  // ta marbouta / ha
      .replace(/[ى]/g, 'ي')                                  // alif maqsura / ya
      .replace(/[•·‣▪◦*\-–—_.,;:!?()\[\]{}'"«»“”‘’\/\\|+]/g, ' ')
      .replace(/\s+/g, ' ')
      .trim()
      .toLowerCase();
  }

  /* L'identifiant Google cache dans un lien « ?eid=… ».
     Le contenu decode ressemble a :
         "<identifiant-evenement>_<AAAAMMJJ> <identifiant-agenda>"
     On ne garde que le premier morceau : l'identifiant de l'evenement. Le
     suffixe « _20260828 » est celui de l'occurrence du jour, et c'est
     exactement la forme que Google nous renvoie quand on lui demande de
     deplier les repetitions (singleEvents=true) : les deux se comparent
     directement, sans rien retirer. */
  function eidDe(lien) {
    var m = /[?&]eid=([^&#\s]+)/.exec(String(lien || ''));
    if (!m) { return null; }
    var b = m[1].replace(/-/g, '+').replace(/_/g, '/');
    while (b.length % 4) { b += '='; }
    try {
      var txt = atob(b);
      var p = txt.split(' ');
      var id = (p[0] || '').trim();
      return id || null;
    } catch (e) { return null; }
  }

  /* La cle « meme jour, meme heure, meme titre ». On en fabrique deux par
     tache (une par langue) parce qu'un rendez-vous ecrit en dur porte un titre
     arabe ET un titre francais, alors que Google n'en a qu'un. */
  function clesNaturelles(t) {
    var jour = t.date || '';
    var h = t.allDay ? '' : (t.start || '');
    var out = [];
    [t.title && t.title.ar, t.title && t.title.fr, t.raw].forEach(function (titre) {
      var n = normTitre(titre);
      if (n) { out.push(jour + '|' + h + '|' + n); }
    });
    return out;
  }

  function jourPlus(n) {
    var d = new Date();
    d.setHours(12, 0, 0, 0);          // midi : a l'abri des changements d'heure
    d.setDate(d.getDate() + n);
    var m = String(d.getMonth() + 1), j = String(d.getDate());
    return d.getFullYear() + '-' + (m.length < 2 ? '0' + m : m) + '-' + (j.length < 2 ? '0' + j : j);
  }

  /* Combien de rendez-vous en dur sont masques en ce moment. Pour le panneau :
     un chiffre qu'on affiche vaut mieux qu'une disparition qu'on subit. */
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

    /* On rassemble d'abord tout ce que Google nous a donne. */
    var idsGoogle = {};        // identifiant d'evenement -> tache Google
    var clesGoogle = {};       // jour|heure|titre        -> tache Google
    var nGoogle = 0;
    liste.forEach(function (t) {
      if (!t || t.src !== 'google') { return; }
      /* Une tache Google Tasks (« g|t| ») n'est ni la preuve d'un rendez-vous
         ni son jumeau : une tache sans date porte le jour d'aujourd'hui comme
         simple repli, et cacherait chaque jour un rendez-vous different ; et
         leur nombre ferait sauter les deux filets de securite (nGoogle). */
      if (typeof t.id === 'string' && t.id.indexOf('g|t|') === 0) { return; }
      nGoogle++;
      if (t.gev) { idsGoogle[t.gev] = t; }
      clesNaturelles(t).forEach(function (c) { if (!clesGoogle[c]) { clesGoogle[c] = t; } });
    });

    /* Aucune tache Google dans la liste : il n'y a rien a remplacer, et cacher
       les rendez-vous en dur laisserait l'artisan devant un ecran vide. On ne
       touche a rien. C'est le filet de securite le plus important de la
       fonction. */
    if (!nGoogle) { return 0; }

    /* La periode que Google vient de lire, pour le mode « remplacer ». */
    var f = i.fenetre || { passe: 90, futur: 400 };
    var borneBasse = jourPlus(-Math.abs(f.passe || 90));
    var borneHaute = jourPlus(Math.abs(f.futur || 400));
    /* LE MODE « REMPLACER » NE S'APPLIQUE QU'APRES UNE LECTURE PROPRE.
       Quatre conditions, et les quatre comptent :
         - le mode est bien celui-la ;
         - une lecture a REELLEMENT eu lieu (derniereLecture) ;
         - elle n'a pas fini en erreur ;
         - et une lecture COMPLETE a eu lieu (derniereComplete).

       LA QUATRIEME EST CELLE QUI MANQUAIT, ET ELLE COUTAIT CHER. Une lecture
       incrementale ne rapporte QUE le delta du syncToken : le matin, Google
       rendait cinq rendez-vous — parfois un seul. Les trois premieres
       conditions etaient remplies, et « Google fait foi sur cette periode »
       effacait cent soixante-quinze cartes sur la foi d'une poignee de lignes.
       Or ce mode ne dit pas « Google a parle », il dit « Google m'a donne
       TOUTE la periode ». Seule une lecture complete autorise cette phrase. */
    var remplace = (mode === 'remplacer') && !!i.derniereLecture && !i.erreur && !!i.derniereComplete;
    if (mode === 'remplacer' && !remplace && i.derniereLecture) {
      dire('lecture partielle : les rendez-vous du programme restent affiches (le mode « remplacer » attend une lecture complete).');
    }

    var aReprendre = [];
    var masques = 0;
    var candidats = [];        // du dernier vers le premier, pour splicer sans decaler

    for (var k = liste.length - 1; k >= 0; k--) {
      var t = liste[k];
      if (!t || EN_DUR.indexOf(t.src) < 0) { continue; }   // manuel et google : on ne touche pas

      var jumeau = null;

      /* 1. L'identifiant Google, quand le fichier en porte un. */
      var eid = eidDe(t.link);
      if (eid && idsGoogle[eid]) { jumeau = idsGoogle[eid]; }

      /* 2. La concordance naturelle. */
      if (!jumeau) {
        var cles = clesNaturelles(t);
        for (var c = 0; c < cles.length; c++) {
          if (clesGoogle[cles[c]]) { jumeau = clesGoogle[cles[c]]; break; }
        }
      }

      /* 3. Le mode « remplacer » : dans la periode couverte, Google fait foi. */
      /* Les jours feries ecrits dans le programme ne s effacent que devant leur
         JUMEAU Google (agenda des fetes suivi) : la regle « Google fait foi sur
         la periode » ne les concerne pas, sinon ils disparaitraient des que
         l agenda des fetes n est pas coche. */
      var dansLaFenetre = remplace && t.src !== 'feries' && t.date >= borneBasse && t.date <= borneHaute;

      if (!jumeau && !dansLaFenetre) { continue; }

      candidats.push({ k: k, t: t, jumeau: jumeau });
    }

    /* LE SECOND FILET, POUR LE JOUR OU LA PREMIERE CONDITION SERAIT CONTOURNEE.
       Un jumeau, c'est une PREUVE : ce rendez-vous-la est bien chez Google, on
       peut cacher la copie du programme sans rien perdre. « Dans la fenetre »
       n'est pas une preuve, c'est un raisonnement — et un raisonnement tenu a
       partir de trois evenements pour en effacer deux cents ne tient pas
       debout. Quand les chiffres sont a ce point disproportionnes, on garde ce
       qu'on a et on le dit : un tableau trop plein se corrige d'un clic, un
       tableau vide fait perdre une matinee. */
    var sansPreuve = 0;
    candidats.forEach(function (c) { if (!c.jumeau) { sansPreuve++; } });
    var refuseLeBloc = (sansPreuve > 50 && nGoogle < 5);
    if (refuseLeBloc) {
      avert('Google n\'a rendu que ' + nGoogle + ' rendez-vous : on ne masque pas pour autant les '
            + sansPreuve + ' rendez-vous du programme qui n\'ont pas de jumeau. Ils restent affiches.');
    }

    candidats.forEach(function (c) {
      if (!c.jumeau && refuseLeBloc) { return; }
      if (c.jumeau) { aReprendre.push([c.t, c.jumeau]); }
      liste.splice(c.k, 1);
      masques++;
    });

    DERNIER_MASQUE = masques;
    if (aReprendre.length) { reprendreLeTravail(aReprendre); }

    /* ON NE FAIT PAS DISPARAITRE 765 RENDEZ-VOUS SANS LE DIRE.
       Une fois, et une seule dans la vie de l'installation : la premiere fois
       que des rendez-vous ecrits dans le programme sont masques, on annonce le
       chiffre et on dit ou les faire revenir. Une disparition qu'on explique
       n'est pas la meme chose qu'une disparition qu'on subit — et c'est
       exactement ce qui separe un programme dans lequel on a confiance d'un
       programme qu'on soupconne d'avoir perdu le travail. */
    if (masques && !reglagesPont().annonce) {
      poserReglagesPont({ annonce: 1 });
      setTimeout(function () { toast(M('annonce', { n: masques })); }, 400);
    }

    return masques;
  }

  /* ------------------------------------------------------------------------
     LA REPRISE DU TRAVAIL DEJA FAIT — le detail qui evite une colere.
     Le statut, les cases cochees et les notes sont ranges dans `store` sous
     L'IDENTIFIANT DE LA TACHE. Or la tache en dur s'appelle « f|17|2026-09-01 »
     et son jumeau Google s'appelle « g|1a2b3c4d|c9i36d35… ». Le jour ou
     l'artisan branche Google, sa tache en dur disparait de l'affichage — et
     avec elle, sans cette fonction, les cases qu'il avait cochees dessus.

     On recopie donc, UNE SEULE FOIS par paire, et SEULEMENT dans le sens
     « en dur -> Google », et SEULEMENT quand la case d'arrivee est vide. On
     n'ecrase jamais quelque chose qui existe deja du cote Google : ce qui
     vient de Google a voyage entre les appareils, il est plus recent par
     nature.

     CE QUE CETTE FONCTION N'ECRIT PAS : rien ne part vers Google. Elle ne
     touche QUE le localStorage de cet appareil. Si l'artisan veut que ces
     reprises montent dans son agenda, il lui suffira de recocher la case :
     c'est alors son geste a lui, et gsync l'enverra.
     ------------------------------------------------------------------------ */
  function reprendreLeTravail(paires) {
    if (!P.store || !P.lsSet) { return; }
    var r = reglagesPont();
    var faites = r.reprises || {};
    var champs = ['status', 'checks', 'notes', 'cat', 'contact', 'place'];
    var n = 0, change = false;

    paires.forEach(function (pr) {
      var vieux = pr[0], neuf = pr[1];
      if (!vieux || !neuf || !neuf.id) { return; }
      var marque = vieux.id + '>' + neuf.id;
      if (faites[marque]) { return; }          // deja fait un autre jour
      faites[marque] = 1; change = true;

      var repris = false;
      champs.forEach(function (ch) {
        var table = P.store[ch];
        if (!table || typeof table !== 'object') { return; }
        if (table[neuf.id] !== undefined) { return; }   // Google a deja une valeur : elle gagne
        if (table[vieux.id] === undefined) { return; }
        table[neuf.id] = table[vieux.id];
        repris = true;
      });
      if (repris) { n++; }
    });

    if (change) { poserReglagesPont({ reprises: faites }); }
    if (n) {
      try { P.lsSet(); } catch (e) { }
      DERNIERE_REPRISE += n;
      dire('travail repris sur ' + n + ' rendez-vous.');
      toast(M('repris', { n: n }));
    }
  }


  /* =========================================================================
     PARTIE 6 — L'ENVELOPPE AUTOUR DE buildTasks()
     ---------------------------------------------------------------------
     POURQUOI ICI ET PAS DANS buildTasks() DIRECTEMENT. On pourrait ajouter
     une ligne dans index.html, juste avant le tri final :

         if (window.AP && AP.gsync) out.push.apply(out, AP.gsync.tasks());

     Elle marcherait — mais elle ne suffirait pas : le retrait des doublons
     doit venir APRES que les taches de Google sont entrees dans la liste, et
     buildTasks() n'est pas le seul a la reconstruire. Le moteur la
     reconstruit lui-meme apres chaque lecture. En enveloppant la fonction une
     fois pour toutes, on tient les deux chemins d'un seul geste, et
     index.html n'a pas une ligne de logique de plus a porter.

     ET ON NE L'ENVELOPPE QUE SI GOOGLE EST BRANCHE. Un artisan qui ne s'est
     jamais connecte garde le buildTasks() d'origine, a l'identique, sans une
     seule instruction de plus au rendu.
     ========================================================================= */

  var enveloppePosee = false;
  /* Le classement COMPLET des rendez-vous ecrits dans le programme, releve
     avant que dedoublonner() ne retire ceux que Google couvre : pris apres,
     le paquet retrecissait a chaque lecture et le telephone perdait des
     classements deja recus. */
  var PAQUET_ENTIER = null;

  function envelopperBuildTasks() {
    if (enveloppePosee) { return; }
    var orig = W.buildTasks;
    if (typeof orig !== 'function' || orig.__apPont) { return; }

    var neuf = function () {
      var r = orig.apply(this, arguments);
      try {
        PAQUET_ENTIER = paquetClassement() || PAQUET_ENTIER;
        if (AP.gsync && typeof AP.gsync.injecter === 'function') { AP.gsync.injecter(); }
        dedoublonner();
      } catch (e) { avert('buildTasks : ' + e.message); }
      return r;
    };
    neuf.__apPont = true;

    /* MICROSOFT A PU SE BRANCHER EN PREMIER (un artisan qui n'utilisait que
       lui depuis des semaines, avant de lier Google aujourd'hui). Son
       enveloppe (app/microsoft/mbridge.js) DOIT rester la plus exterieure —
       c'est elle qui applique en dernier le choix « quelles sources afficher »,
       et il doit voir les rendez-vous Google deja injectes. On s'insere donc
       A L'INTERIEUR de son crochet plutot que de l'envelopper depuis
       l'exterieur — ce qui inverserait l'ordre sans que rien ne le signale.

       ATTENTION AU PIEGE : `neuf` ci-dessus appelle `orig`, qui est
       l'enveloppe de Microsoft (puisque `orig = window.buildTasks` valait
       deja son enveloppe). Si on branchait cette version de `neuf` DANS le
       crochet de Microsoft, Microsoft appellerait `neuf`, qui rappellerait
       Microsoft, qui rappellerait `neuf` — une boucle sans fin. On refabrique
       donc une SECONDE enveloppe, qui appelle directement ce que Microsoft
       appelait JUSQU'ICI (la fonction brute), et c'est CELLE-LA qu'on branche
       dans le crochet. */
    if (orig.__apPontM && orig.__apPontMInterne) {
      var interieur = orig.__apPontMInterne;
      var brut = interieur.fn;
      var neufInterne = function () {
        var r = brut.apply(this, arguments);
        try {
          PAQUET_ENTIER = paquetClassement() || PAQUET_ENTIER;
          if (AP.gsync && typeof AP.gsync.injecter === 'function') { AP.gsync.injecter(); }
          dedoublonner();
        } catch (e) { avert('buildTasks : ' + e.message); }
        return r;
      };
      neufInterne.__apPont = true;
      interieur.fn = neufInterne;
    } else {
      W.buildTasks = neuf;
    }
    enveloppePosee = true;
    dire('buildTasks enveloppe — les rendez-vous de Google entrent dans la liste, les doublons en sortent.');
  }


  /* =========================================================================
     PARTIE 7 — LE PANNEAU GOOGLE
     ---------------------------------------------------------------------
     Il n'existe dans la page que lorsque l'artisan l'ouvre. Il utilise les
     classes de l'application (.modal, .modal-in, .mb, .tbtn) et ses variables
     de couleur : il suit donc le theme clair et le theme sombre sans une
     ligne de plus, et il parlera francais le jour ou l'artisan changera de
     langue.
     ========================================================================= */

  var elPanneau = null;

  function poserStyle() {
    if (document.getElementById('apgPontCss')) { return; }
    var s = document.createElement('style');
    s.id = 'apgPontCss';
    s.textContent = [
      '.apg-sec{border:1px solid var(--line);border-radius:var(--r2);padding:14px;background:var(--surface2)}',
      '.apg-sec + .apg-sec{margin-top:12px}',
      '.apg-h{font-size:13px;font-weight:700;margin:0 0 6px}',
      '.apg-aide{font-size:12px;color:var(--txt2);margin:0 0 10px;line-height:1.6}',
      '.apg-cal{display:flex;align-items:center;gap:9px;padding:7px 2px;font-size:13px}',
      '.apg-cal input{width:16px;height:16px;accent-color:var(--brand2);flex:none;cursor:pointer}',
      '.apg-cal label{flex:1;cursor:pointer;display:flex;align-items:center;gap:7px;min-width:0}',
      '.apg-nom{overflow:hidden;text-overflow:ellipsis;white-space:nowrap}',
      '.apg-pt{width:9px;height:9px;border-radius:50%;flex:none;border:1px solid var(--line2)}',
      '.apg-tag{font-size:10px;font-weight:700;padding:2px 7px;border-radius:999px;background:var(--bg2);color:var(--txt3);flex:none}',
      '.apg-etat{display:flex;align-items:center;gap:10px;font-size:13px}',
      '.apg-dot{width:10px;height:10px;border-radius:50%;background:var(--line2);flex:none}',
      '.apg-dot.on{background:var(--ok)}.apg-dot.warn{background:var(--warn)}.apg-dot.bad{background:var(--bad)}',
      '.apg-chif{display:flex;flex-wrap:wrap;gap:8px;margin-top:10px}',
      '.apg-ch{flex:1 1 90px;border:1px solid var(--line);border-radius:12px;padding:9px 10px;background:var(--surface);text-align:center}',
      '.apg-ch b{display:block;font-size:18px;font-weight:800;color:var(--txt)}',
      '.apg-ch span{font-size:11px;color:var(--txt2)}',
      '.apg-err{margin-top:10px;border:1px solid var(--bad);border-radius:12px;padding:10px 12px;background:var(--surface);font-size:12px;line-height:1.6;color:var(--txt)}',
      '.apg-err b{color:var(--bad)}',
      '.apg-err code{display:block;margin-top:5px;font-family:ui-monospace,Menlo,Consolas,monospace;font-size:11px;color:var(--txt2);word-break:break-word;white-space:pre-wrap}',
      '.apg-in{width:100%;padding:10px 12px;border-radius:12px;border:1px solid var(--line2);background:var(--surface);color:var(--txt);font-size:13px}',
      '.apg-modes{display:flex;flex-direction:column;gap:7px;margin-top:4px}',
      '.apg-modes label{display:flex;align-items:flex-start;gap:8px;font-size:12.5px;cursor:pointer;line-height:1.5}',
      '.apg-modes input{margin-top:2px;accent-color:var(--brand2);flex:none;cursor:pointer}',
      '.apg-bas{display:flex;flex-wrap:wrap;gap:8px;margin-top:12px}'
    ].join('\n');
    document.head.appendChild(s);
  }

  function construire() {
    if (elPanneau) { return elPanneau; }
    poserStyle();
    var d = document.createElement('div');
    d.className = 'modal';
    d.id = 'apgPanneau';
    d.innerHTML =
      '<div class="modal-in wide">' +
        '<div class="modal-h">' +
          '<h3 id="apgTitre"></h3>' +
          '<button class="tbtn" type="button" id="apgX">✕</button>' +
        '</div>' +
        '<div class="modal-b" id="apgCorps"></div>' +
        '<div class="modal-f">' +
          '<button class="mb" type="button" id="apgFermer"></button>' +
        '</div>' +
      '</div>';
    document.body.appendChild(d);
    d.addEventListener('click', function (e) { if (e.target === d) { fermer(); } });
    d.querySelector('#apgX').addEventListener('click', fermer);
    d.querySelector('#apgFermer').addEventListener('click', fermer);
    elPanneau = d;
    return d;
  }

  function ouvrir() {
    construire();
    dessiner();
    elPanneau.classList.add('show');
    /* Si on est lie mais qu'on n'a pas encore la liste des agendas, on va la
       chercher : l'artisan vient d'ouvrir le panneau pour choisir, autant
       qu'il trouve quelque chose a cocher. */
    var i = infoMoteur();
    if (i && i.connecte && (!i.agendas || !i.agendas.length)) { chargerAgendas(); }
    /* Les listes Google Tasks : chargees d'office SEULEMENT si la permission
       de les lire est deja la. Sinon, jamais de fenetre Google ouverte parce
       que l'artisan a simplement ouvert ce panneau (sur le bureau, c'etait
       son navigateur qui s'ouvrait, a chaque ouverture) : la section affiche
       le message et LE bouton « السماح بقراءة المهام ». */
    var it = infoTaches();
    if (i && i.connecte && it && it.connecte && (!it.listes || !it.listes.length)) {
      AP.gtasks.chargerListes().then(function () { dessiner(); });
    }
    return true;
  }
  function fermer() { if (elPanneau) { elPanneau.classList.remove('show'); } majBandeauTaches(); }

  function bouton(txt, prim, fn, id) {
    var b = document.createElement('button');
    b.type = 'button';
    b.className = prim ? 'mb pri' : 'mb';
    b.textContent = txt;
    if (id) { b.id = id; }
    b.addEventListener('click', fn);
    return b;
  }

  function dessiner() {
    if (!elPanneau) { return; }
    var corps = elPanneau.querySelector('#apgCorps');
    if (!corps) { return; }
    elPanneau.querySelector('#apgTitre').textContent = M('titre');
    elPanneau.querySelector('#apgFermer').textContent = M('fermer');
    corps.textContent = '';

    var i = infoMoteur() || {};
    var c = infoCompte() || {};
    var id = clientId();

    /* --- 1. Pas d'identifiant Google : rien d'autre n'a de sens ---------- */
    if (!id) {
      corps.appendChild(sectionIdentifiant());
      return;
    }

    /* --- 2. L'etat de la liaison ---------------------------------------- */
    corps.appendChild(sectionEtat(i, c));
    if (i.connecte) { corps.appendChild(sectionDetailsVisibles()); }

    /* --- 3. Les agendas a suivre ---------------------------------------- */
    if (i.connecte) { corps.appendChild(sectionAgendas(i)); }
    if (i.connecte && AP.gtasks) { corps.appendChild(sectionListesTaches()); }
    if (i.connecte && AP.gtasks) { corps.appendChild(sectionEcritureTaches()); }

    /* --- 4. Les rendez-vous ecrits en dur ------------------------------- */
    if (i.connecte) { corps.appendChild(sectionEnDur()); }
  }

  /* --- 7.1 L'identifiant Google ------------------------------------------
     On ne force personne a ouvrir app/config.js dans un editeur de texte pour
     coller une valeur. Elle est gardee sur CET appareil, dans les reglages du
     moteur — celui-la meme qui sait deja la relire. */
  function sectionIdentifiant() {
    var s = document.createElement('div');
    s.className = 'apg-sec';
    s.innerHTML = '<p class="apg-h">' + propre(M('pasConfig')) + '</p>' +
                  '<p class="apg-aide">' + propre(M('pasConfigAide')) + '</p>';
    var champ = document.createElement('input');
    champ.type = 'text';
    champ.className = 'apg-in';
    champ.placeholder = M('champId');
    champ.autocomplete = 'off';
    champ.spellcheck = false;
    s.appendChild(champ);

    var bas = document.createElement('div');
    bas.className = 'apg-bas';
    bas.appendChild(bouton(M('enregistrer'), true, function () {
      var v = (champ.value || '').trim();
      if (!/\.apps\.googleusercontent\.com$/.test(v)) { toast(M('idInvalide')); return; }
      var r = jget('agendapro_g_reglages_v1', {}) || {};
      r.clientId = v;
      jset('agendapro_g_reglages_v1', r);

      /* Prevenir la brique d'authentification. Elle ne relit pas les reglages
         toute seule : sans cet appel, l'identifiant est bien range mais rien
         ne se reveille avant le prochain rechargement de la page. */
      try {
        if (AP.gauth && typeof AP.gauth.reconfigurer === 'function') { AP.gauth.reconfigurer(); }
      } catch (e) { }
      toast(M('idEnregistre'));
      /* Le moteur lit son identifiant a chaque appel : il n'y a rien a
         redemarrer. On redessine, et le bouton « Lier » apparait. */
      dessiner();
    }));
    s.appendChild(bas);
    return s;
  }

  /* --- 7.2 L'etat reel de la liaison ------------------------------------- */
  function sectionEtat(i, c) {
    var s = document.createElement('div');
    s.className = 'apg-sec';

    var ligne = document.createElement('div');
    ligne.className = 'apg-etat';
    var pt = document.createElement('span');
    pt.className = 'apg-dot' + (i.erreur ? ' bad' : (i.connecte ? ' on' : ' warn'));
    ligne.appendChild(pt);

    var txt = document.createElement('div');
    if (!i.connecte) {
      txt.innerHTML = propre(M('nonLie'));
    } else {
      var qui = c.courriel ? M('lieA', { x: propre(c.courriel) }) : M('lie');
      var quand = i.derniereLecture ? M('derniere', { x: propre(depuis(i.derniereLecture)) }) : M('jamaisSync');
      txt.innerHTML = qui + ' — ' + propre(quand);
    }
    ligne.appendChild(txt);
    s.appendChild(ligne);

    /* Les chiffres. Ils ne sont pas decoratifs : ce sont eux qui disent a
       l'artisan si quelque chose attend encore de partir. */
    if (i.connecte) {
      var ch = document.createElement('div');
      ch.className = 'apg-chif';
      ch.appendChild(chiffre(i.taches || 0, M('lus')));
      ch.appendChild(chiffre(ENVOI_SESSION, M('ecrits')));
      ch.appendChild(chiffre(i.enAttente || 0, M('attente')));
      ch.appendChild(chiffre(DERNIER_MASQUE, M('masques')));
      s.appendChild(ch);

      /* D'ou vient le classement des sections ? Sans cette ligne, un
         telephone qui range tout dans « personnel » ne dit pas pourquoi. */
      if (AP.gsync && typeof AP.gsync.classement === 'function') {
        var cl = AP.gsync.classement();
        var enDur = (taches() || []).some(function (t) { return t && EN_DUR.indexOf(t.src) >= 0; });
        /* l appareil source compte ce qu il ENVOIE (photo vivante), l autre ce qu il a RECU */
        var nbCl = enDur ? Object.keys(PAQUET_ENTIER || paquetClassement() || {}).length : Object.keys(cl.s || {}).length;
        /* « i.drive » vient du dernier jeton EFFECTIVEMENT obtenu, pas
           seulement du reglage local — un renouvellement silencieux qui
           echoue doit aussi se voir ici. */
        /* AUCUN role n'echappe a la regle : sans le droit Drive, l'appareil
           SOURCE ne peut pas ECRIRE le fichier (ecrireNuage echoue en
           silence), l'appareil qui REÇOIT ne peut pas le LIRE. Avant ce
           correctif, un appareil source sans ce droit affichait quand meme
           « envoye : N series » — un faux succes qui cachait le vrai blocage. */
        var manqueDrive = !i.drive;
        var lc = document.createElement('div');
        lc.className = 'apg-etat apg-classement';
        var pc = document.createElement('span');
        pc.className = 'apg-dot' + (manqueDrive ? ' warn' : ((enDur || nbCl) ? ' on' : ' warn'));
        var tc = document.createElement('div');
        tc.textContent = manqueDrive ? (enDur ? M('classementDriveManqueIci') : M('classementDriveManque'))
                       : enDur ? M('classementIci', { n: nbCl })
                       : (nbCl ? M('classementOk', { n: nbCl, x: depuis(cl.q || 0) }) : M('classementNon'));
        lc.appendChild(pc); lc.appendChild(tc);
        s.appendChild(lc);
        /* Le geste qui manque, a portee de main — pas une explication qu'il
           faut aller retraduire en clic ailleurs. */
        if (manqueDrive && AP.gsync && typeof AP.gsync.demanderDrive === 'function') {
          var lb = document.createElement('div');
          lb.className = 'apg-bas';
          lb.appendChild(bouton(M('classementActiver'), false, function (ev) {
            var btn = ev.currentTarget; btn.disabled = true; var avant = btn.textContent; btn.textContent = M('classementEnCours');
            AP.gsync.demanderDrive().then(function (ok) {
              if (!ok) { btn.disabled = false; btn.textContent = M('classementEchec'); setTimeout(function () { dessiner(); }, 1800); }
              else { dessiner(); }
            }).catch(function () { btn.disabled = false; btn.textContent = M('classementEchec'); });
          }));
          s.appendChild(lb);
        }
      }
    }

    if (i.erreur) { s.appendChild(bloc_erreur(i.erreur)); }

    var bas = document.createElement('div');
    bas.className = 'apg-bas';
    if (!i.connecte) {
      bas.appendChild(bouton(M('lier'), true, lier, 'apgLier'));
    } else {
      bas.appendChild(bouton(M('synchroniser'), true, function () { actualiser({ depuisPanneau: true }); }, 'apgSync'));
      bas.appendChild(bouton(M('delier'), false, demanderDelier));
    }
    s.appendChild(bas);
    return s;
  }

  function chiffre(n, lbl) {
    var d = document.createElement('div');
    d.className = 'apg-ch';
    d.innerHTML = '<b>' + propre(String(n)) + '</b><span>' + propre(lbl) + '</span>';
    return d;
  }

  /* --- 7.1 bis « إظهار التفاصيل » — la seule case qui touche a un champ
     visible d'un vrai rendez-vous (voir gsync.js, envoyerEtat()). Fausse par
     defaut : l'artisan doit cocher lui-meme, en connaissance de cause. */
  function sectionDetailsVisibles() {
    var s = document.createElement('div');
    s.className = 'apg-sec';
    s.innerHTML = '<p class="apg-h">' + propre(M('titreDetails')) + '</p>' +
                  '<p class="apg-aide">' + propre(M('aideDetails')) + '</p>';

    var row = document.createElement('div');
    row.className = 'apg-cal';
    var cb = document.createElement('input');
    cb.type = 'checkbox';
    cb.checked = !!(AP.gsync && AP.gsync.reglages && AP.gsync.reglages().afficherDetails);
    cb.id = 'apgDetailsVisibles';
    cb.addEventListener('change', function () {
      try { AP.gsync.poserReglages({ afficherDetails: cb.checked }); } catch (e) { avert('afficherDetails : ' + e.message); }
      toast(cb.checked ? M('detailsActives') : M('detailsDesactives'));
    });
    row.appendChild(cb);
    var lab = document.createElement('label');
    lab.setAttribute('for', cb.id);
    var span = document.createElement('span'); span.className = 'apg-nom'; span.textContent = M('caseDetails');
    lab.appendChild(span);
    row.appendChild(lab);
    s.appendChild(row);
    return s;
  }

  /* LE VRAI MESSAGE DE GOOGLE, PAS UN « erreur » MUET.
     C'est le point 4 du cahier des charges, et il compte : « erreur » ne
     permet a personne de comprendre s'il faut recommencer, attendre, ou
     appeler quelqu'un. « Request had insufficient authentication scopes », si. */
  function bloc_erreur(msg) {
    var d = document.createElement('div');
    d.className = 'apg-err';
    d.innerHTML = '<b>' + propre(M('echec')) + '</b><br>' +
                  propre(M('msgGoogle')) +
                  '<code>' + propre(msg) + '</code>';
    return d;
  }

  /* --- 7.3 Les agendas a suivre ------------------------------------------ */
  function sectionAgendas(i) {
    var s = document.createElement('div');
    s.className = 'apg-sec';
    s.innerHTML = '<p class="apg-h">' + propre(M('titreAgendas')) + '</p>' +
                  '<p class="apg-aide">' + propre(M('aideAgendas')) + '</p>';

    var liste = i.agendas || [];
    if (!liste.length) {
      var p = document.createElement('p');
      p.className = 'apg-aide';
      p.textContent = M('listeKo');
      s.appendChild(p);
      var bas0 = document.createElement('div');
      bas0.className = 'apg-bas';
      bas0.appendChild(bouton(M('chargerListe'), false, chargerAgendas));
      /* LE REPLI QUI SAUVE LA JOURNEE. Quand Google refuse la liste des
         agendas (une permission accordee autrefois, plus etroite que celle
         qu'on demande aujourd'hui), l'artisan n'est pas coince : son agenda
         principal s'appelle toujours « primary », et la permission de lire
         les rendez-vous suffit pour lui. */
      bas0.appendChild(bouton(M('listeKoBtn'), true, function () {
        try { AP.gsync.suivre('primary', true); } catch (e) { }
        dessiner();
        actualiser({ depuisPanneau: true, complet: true });
      }));
      s.appendChild(bas0);
      return s;
    }

    var suivis = i.suivis || [];
    if (!suivis.length) {
      var av = document.createElement('p');
      av.className = 'apg-aide';
      av.style.color = 'var(--warn)';
      av.textContent = M('aucunAgenda');
      s.appendChild(av);
    }

    liste.forEach(function (a) {
      var row = document.createElement('div');
      row.className = 'apg-cal';

      var cb = document.createElement('input');
      cb.type = 'checkbox';
      cb.checked = !!a.suivi;
      cb.id = 'apgCal_' + Math.abs(hachage(a.id));
      cb.addEventListener('change', function () {
        try { AP.gsync.suivre(a.id, cb.checked); } catch (e) { avert('suivre : ' + e.message); }
        if (cb.checked) { actualiser({ depuisPanneau: true, complet: true }); }
        else { rendre(); dessiner(); }
      });
      row.appendChild(cb);

      var lab = document.createElement('label');
      lab.setAttribute('for', cb.id);
      var pt = document.createElement('span');
      pt.className = 'apg-pt';
      if (a.couleur) { pt.style.background = a.couleur; }
      lab.appendChild(pt);
      var nom = document.createElement('span');
      nom.className = 'apg-nom';
      nom.textContent = a.nom || a.id;
      lab.appendChild(nom);
      if (a.principal) { lab.appendChild(tag(M('principal'))); }
      if (a.enLecture) { lab.appendChild(tag(M('lectureSeule'))); }
      row.appendChild(lab);

      s.appendChild(row);
    });

    var bas = document.createElement('div');
    bas.className = 'apg-bas';
    bas.appendChild(bouton(M('chargerListe'), false, chargerAgendas));
    s.appendChild(bas);
    return s;
  }

  function tag(txt) {
    var e = document.createElement('span');
    e.className = 'apg-tag';
    e.textContent = txt;
    return e;
  }

  function hachage(s) {
    var h = 0;
    s = String(s || '');
    for (var i = 0; i < s.length; i++) { h = ((h << 5) - h + s.charCodeAt(i)) | 0; }
    return h;
  }

  /* --- 7.3 bis Les listes Google Tasks (app/google/gtasks.js) -------------
     Le meme compte, une API differente : pas de bouton lier/delier ici, les
     listes apparaissent des que Google est branche. */
  function infoTaches() {
    if (!(AP.gtasks && typeof AP.gtasks.info === 'function')) { return null; }
    try { return AP.gtasks.info(); } catch (e) { return null; }
  }

  /* LE BOUTON « السماح بقراءة المهام » (panneau et bandeau). Il demande la
     permission de LIRE les taches — jamais celle d'ecrire (gauth.js,
     porteesVoulues) —, charge les listes, et suit le resultat jusqu'au bout :
     quand la lecture qui suit est finie, un message dit combien de taches
     sont arrivees, ou pourquoi aucune (voir ecouter(), AP.gtasks.on). */
  var attenteResultatTaches = false;
  /* Qui attend la fin de la lecture des taches en cours (actualiser). Filet :
     une minute au plus, pour ne jamais rester bloque. */
  var ATTENTES_FIN = [];
  function attendreFinTaches() {
    return new Promise(function (ok) {
      var fini = false;
      function fin() { if (!fini) { fini = true; ok(); } }
      ATTENTES_FIN.push(fin);
      setTimeout(fin, 60000);
    });
  }
  /* Pourquoi la derniere fenetre Google s'est fermee (gauth.js). Quand gauth
     a deja affiche la vraie raison, on ne l'ecrase pas par un message
     generique, et un simple « fenetre deja ouverte » n'est pas un refus. */
  function raisonGoogle() { return (AP.gauth && typeof AP.gauth.dernierRefus === 'function') ? AP.gauth.dernierRefus() : null; }
  function raisonDejaDite() { var r = raisonGoogle(); return r === 'fenetre-ouverte' || r === 'autre-compte' || r === 'bureau-absent'; }
  function chargerListesTaches() {
    if (!(AP.gtasks && typeof AP.gtasks.chargerListes === 'function')) { return Promise.resolve([]); }
    var it0 = infoTaches();
    var manque = it0 && !it0.connecte && AP.gauth && typeof AP.gauth.demanderTaches === 'function';
    var pret = manque ? AP.gauth.demanderTaches() : Promise.resolve(true);
    return pret
      .then(function (ok) {
        if (manque && !ok) {
          /* Seul un vrai refus range le bandeau pour la session ; une fenetre
             deja ouverte ou un autre compte choisi le laissent revenir. */
          if (!raisonDejaDite()) { bandeauTachesRange = true; }
          majBandeauTaches(); dessiner(); return [];
        }
        attenteResultatTaches = !!manque;
        return AP.gtasks.chargerListes().then(function (l) {
          var it1 = infoTaches() || {};
          /* Permission tout juste accordee et des listes deja suivies (rien
             de nouveau a suivre, donc aucune lecture lancee) : on lit. */
          if (manque && !it1.enCours && (it1.suivis || []).length) { AP.gtasks.pull({ complet: true }); it1 = infoTaches() || {}; }
          /* Aucune lecture ne suivra (rien a lire, ou echec) : le message
             tombe maintenant plutot que jamais. */
          if (!it1.enCours) { annoncerResultatTaches(); }
          dessiner();
          return l;
        });
      })
      .catch(function (e) { avert('liste des taches : ' + (e && e.message)); dessiner(); return []; });
  }
  function annoncerResultatTaches() {
    if (!attenteResultatTaches) { return; }
    attenteResultatTaches = false;
    var it = infoTaches() || {};
    if (it.erreur) { toast(M('echec') + ' — ' + it.erreur); }
    else if ((it.suivis || []).length) {
      toast(it.taches ? M('tachesArrivees', { n: langue() === 'ar' ? nbMaham(it.taches) : it.taches }) : M('resumeZero'));
    }
  }

  /* Le compte en arabe, avec le bon accord, sur les DEUX derniers chiffres
     (103 مهام, 111 مهمة) : 1 مهمة واحدة, 2 مهمتان, 3-10 مهام, sinon مهمة. */
  function nbMaham(n) {
    var r = n % 100;
    if (n === 1) { return 'مهمة واحدة'; }
    if (n === 2) { return 'مهمتان'; }
    if (r >= 3 && r <= 10) { return n + ' مهام'; }
    return n + ' مهمة';
  }

  function sectionListesTaches() {
    var it = infoTaches();
    if (!it) { return document.createDocumentFragment(); }

    var s = document.createElement('div');
    s.className = 'apg-sec';
    s.innerHTML = '<p class="apg-h">' + propre(M('titreTaches')) + '</p>' +
                  '<p class="apg-aide">' + propre(M('aideTaches')) + '</p>';

    /* La permission de LIRE les taches n'a jamais ete donnee (compte lie
       avant l'arrivee de Google Tasks) : on le dit tel quel, avec LE bouton
       qui la demande — et rien d'autre : pas de cadre rouge « فشلت
       المزامنة » en plus, ce n'est pas une panne. */
    if (!it.connecte) {
      var pp = document.createElement('p');
      pp.className = 'apg-aide';
      pp.style.color = 'var(--warn)';
      pp.textContent = M('porteeTaches');
      s.appendChild(pp);
      var basP = document.createElement('div');
      basP.className = 'apg-bas';
      basP.appendChild(bouton(M('autoriserTaches'), true, chargerListesTaches));
      s.appendChild(basP);
      return s;
    }

    /* Une vraie erreur : le texte de Google tel quel seulement quand c'en est
       un ; nos propres messages (hors ligne, patience) en simple ligne. */
    if (it.erreur) {
      if (it.codeErreur === 'autre') { s.appendChild(bloc_erreur(it.erreur)); }
      else {
        var pe = document.createElement('p'); pe.className = 'apg-aide'; pe.style.color = 'var(--warn)';
        pe.textContent = it.erreur;
        s.appendChild(pe);
      }
    }

    var liste = it.listes || [];
    if (!liste.length) {
      var p = document.createElement('p');
      p.className = 'apg-aide';
      p.textContent = it.enCours ? M('tachesChargement') : M('tachesKo');
      s.appendChild(p);
      var bas0 = document.createElement('div');
      bas0.className = 'apg-bas';
      bas0.appendChild(bouton(M('chargerTaches'), false, chargerListesTaches));
      s.appendChild(bas0);
      return s;
    }

    /* Ce qui est arrive, en chiffres : la preuve, sous les yeux de
       l'artisan, que ses taches sont bien la. */
    if ((it.suivis || []).length) {
      var txtRes = '';
      if (it.enCours && !it.taches) { txtRes = M('tachesChargement'); }
      /* Zero tache ET une erreur : c'est l'erreur (deja affichee au-dessus)
         qui explique, pas des « listes vides » qui seraient faux. */
      else if (!it.taches) { txtRes = it.erreur ? '' : M('resumeZero'); }
      else { txtRes = M('resumeTaches', { n: langue() === 'ar' ? nbMaham(it.taches) : it.taches, s: it.sansDate || 0, f: it.faites || 0 }); }
      if (txtRes) {
        var res = document.createElement('p');
        res.className = 'apg-aide';
        res.textContent = txtRes;
        s.appendChild(res);
      }
    }
    if (it.enAttente) {
      var pa = document.createElement('p'); pa.className = 'apg-aide';
      pa.textContent = M('tachesEnAttente', { n: it.enAttente });
      s.appendChild(pa);
    }

    var suivis = it.suivis || [];
    if (!suivis.length) {
      var av = document.createElement('p'); av.className = 'apg-aide'; av.style.color = 'var(--warn)';
      av.textContent = M('aucuneTache');
      s.appendChild(av);
    }

    liste.forEach(function (l) {
      var row = document.createElement('div');
      row.className = 'apg-cal';
      var cb = document.createElement('input');
      cb.type = 'checkbox';
      cb.checked = !!l.suivi;
      cb.id = 'apgTaches_' + Math.abs(hachage(l.id));
      cb.addEventListener('change', function () {
        try { AP.gtasks.suivre(l.id, cb.checked); } catch (e) { avert('suivre (taches) : ' + e.message); }
        if (cb.checked) { AP.gtasks.pull({ complet: true }).then(function () { rendre({ fond: true }); dessiner(); }); }
        else { rendre(); dessiner(); }
      });
      row.appendChild(cb);
      var lab = document.createElement('label');
      lab.setAttribute('for', cb.id);
      var nom = document.createElement('span'); nom.className = 'apg-nom'; nom.textContent = l.nom || l.id;
      lab.appendChild(nom);
      row.appendChild(lab);
      s.appendChild(row);
    });

    var bas = document.createElement('div'); bas.className = 'apg-bas';
    bas.appendChild(bouton(M('chargerTaches'), false, chargerListesTaches));
    s.appendChild(bas);
    return s;
  }

  /* --- 7.3 ter Ecrire dans Google Tasks (statut, titre, note) -------------
     Case a cocher, meme esprit que sectionDetailsVisibles() : desactivee par
     defaut, et la premiere activation declenche le consentement Google
     supplementaire (AP.gtasks.demanderEcriture(), qui repose sur
     AP.gauth.demanderTachesEcriture()) — jamais en silence. */
  function sectionEcritureTaches() {
    var it = infoTaches();
    if (!it || !it.connecte) { return document.createDocumentFragment(); }

    var s = document.createElement('div');
    s.className = 'apg-sec';
    s.innerHTML = '<p class="apg-h">' + propre(M('titreEcritureTaches')) + '</p>' +
                  '<p class="apg-aide">' + propre(M('aideEcritureTaches')) + '</p>';

    /* La case montre ce qui est VRAI : cochee seulement si le reglage est
       active ET que Google a encore accorde la permission. Reglage active
       sans permission (compte delie puis relie, acces retire chez Google) :
       une ligne le dit, avec le bouton qui la redemande. */
    var sansPermis = !!(it.ecrireVersGoogle && !it.ecritureAutorisee);
    if (sansPermis) {
      var pw = document.createElement('p'); pw.className = 'apg-aide'; pw.style.color = 'var(--warn)';
      pw.textContent = M('ecritureSansPermis');
      s.appendChild(pw);
      var bw = document.createElement('div'); bw.className = 'apg-bas';
      bw.appendChild(bouton(M('ecritureRedemander'), true, function () {
        AP.gtasks.demanderEcriture().then(function (ok) {
          if (ok) { toast(M('ecritureTachesActivee')); }
          else if (!raisonDejaDite()) { toast(M('ecritureTachesRefusee')); }
          rendre(); dessiner();
        });
      }));
      s.appendChild(bw);
    }

    var row = document.createElement('div');
    row.className = 'apg-cal';
    var cb = document.createElement('input');
    cb.type = 'checkbox';
    cb.checked = !!(it.ecrireVersGoogle && it.ecritureAutorisee);
    cb.id = 'apgEcritureTaches';
    cb.addEventListener('change', function () {
      if (!cb.checked) {
        var abandonnees = 0;
        try { abandonnees = AP.gtasks.couperEcriture(); } catch (e) { avert('ecrireVersGoogle : ' + e.message); }
        /* couperEcriture() a deja dit ce qu'il advenait des changements en
           attente ; sinon, le message habituel. */
        if (!abandonnees) { toast(M('ecritureTachesDesactivee')); }
        /* Les cartes repassent en lecture seule TOUT DE SUITE : sinon leurs
           champs restaient ouverts et ce qu'on y tapait se perdait. */
        rendre();
        dessiner();
        return;
      }
      cb.disabled = true;
      AP.gtasks.demanderEcriture().then(function (ok) {
        /* gauth a peut-etre deja dit la vraie raison (fenetre deja ouverte,
           autre compte) : ne pas l'ecraser par « تم رفض الإذن ». */
        if (ok) { toast(M('ecritureTachesActivee')); }
        else if (!raisonDejaDite()) { toast(M('ecritureTachesRefusee')); }
        rendre();
        dessiner();
      });
    });
    row.appendChild(cb);
    var lab = document.createElement('label');
    lab.setAttribute('for', cb.id);
    var span = document.createElement('span'); span.className = 'apg-nom'; span.textContent = M('caseEcritureTaches');
    lab.appendChild(span);
    row.appendChild(lab);
    s.appendChild(row);
    return s;
  }

  /* --- 7.4 Les 765 rendez-vous ecrits en dur ------------------------------ */
  function sectionEnDur() {
    var s = document.createElement('div');
    s.className = 'apg-sec';
    var total = compterEnDur();
    s.innerHTML = '<p class="apg-h">' + propre(M('titreDur')) + '</p>' +
                  '<p class="apg-aide">' + propre(M('aideDur', { n: total + DERNIER_MASQUE })) + '</p>';

    var modes = document.createElement('div');
    modes.className = 'apg-modes';
    var actuel = reglagesPont().mode;
    [['remplacer', M('modeRemplacer')], ['doublons', M('modeDoublons')], ['aucun', M('modeAucun')]]
      .forEach(function (m) {
        var lab = document.createElement('label');
        var r = document.createElement('input');
        r.type = 'radio'; r.name = 'apgMode'; r.value = m[0];
        r.checked = (actuel === m[0]);
        r.addEventListener('change', function () {
          if (!r.checked) { return; }
          poserReglagesPont({ mode: m[0] });
          rendre();
          dessiner();
        });
        lab.appendChild(r);
        var t = document.createElement('span');
        t.textContent = m[1];
        lab.appendChild(t);
        modes.appendChild(lab);
      });
    s.appendChild(modes);

    var p = document.createElement('p');
    p.className = 'apg-aide';
    p.style.marginTop = '10px';
    p.style.marginBottom = '0';
    p.textContent = DERNIER_MASQUE ? M('compteMasque', { n: DERNIER_MASQUE }) : M('compteZero');
    s.appendChild(p);
    return s;
  }

  function compterEnDur() {
    var l = taches();
    if (!l) { return 0; }
    var n = 0;
    l.forEach(function (t) { if (t && EN_DUR.indexOf(t.src) >= 0) { n++; } });
    return n;
  }


  /* =========================================================================
     PARTIE 8 — LES ACTIONS : LIER, SYNCHRONISER, DELIER
     ---------------------------------------------------------------------
     C'est ici que le bouton « تحديث البيانات / Actualiser » de la barre du
     haut aboutit, et c'est ici que se joue le point 4 du cahier des charges :
     un retour visuel HONNETE. Pas de roue qui tourne sur un echec, pas de
     « termine » sur une synchronisation qui n'a rien lu.
     ========================================================================= */

  /* Le nombre d'annotations reellement parties depuis l'ouverture de la page.
     On le remet a zero au debut de chaque synchronisation declenchee a la
     main : l'artisan veut savoir ce que CE clic a fait. */
  var ENVOI_SESSION = 0;
  var enTrain = false;

  function lier() {
    if (!joindreLesBriques()) { return Promise.resolve(false); }
    var b = document.getElementById('apgLier');
    if (b) { b.disabled = true; b.textContent = M('enCours'); }

    return Promise.resolve()
      .then(function () { return AP.gsync.connecter(); })
      .then(function () {
        demarrer();
        dessiner();
        return true;
      })
      .catch(function (e) {
        /* gauth a deja dit calmement a l'artisan que la fenetre a ete fermee
           ou refusee. On n'en rajoute pas : on redessine avec le vrai etat. */
        avert('liaison : ' + (e && e.message));
        dessiner();
        return false;
      })
      .then(function (r) {
        var b2 = document.getElementById('apgLier');
        if (b2) { b2.disabled = false; b2.textContent = M('lier'); }
        return r;
      });
  }

  function chargerAgendas() {
    if (!(AP.gsync && typeof AP.gsync.chargerAgendas === 'function')) { return Promise.resolve([]); }
    return Promise.resolve()
      .then(function () { return AP.gsync.chargerAgendas(); })
      .then(function (l) { dessiner(); return l; })
      .catch(function (e) {
        avert('liste des agendas : ' + (e && e.message));
        dessiner();
        return [];
      });
  }

  /* LA VRAIE SYNCHRONISATION.
     AP.gsync.pull() renvoie `false` dans trois cas qui ne sont PAS des pannes :
     pas de liaison, aucun agenda coche, une lecture deja en cours. On ne peut
     donc pas se contenter de son retour pour choisir le message : on regarde
     l'etat reel du moteur avant et apres. Une pastille verte posee sur un
     echec serait pire que pas de pastille du tout. */
  function actualiser(opts) {
    opts = opts || {};
    if (!joindreLesBriques()) { return Promise.resolve(false); }

    var i = infoMoteur() || {};

    /* Pas encore lie : le bouton du haut doit ouvrir la porte, pas se taire. */
    if (!i.connecte) { ouvrir(); return Promise.resolve(false); }

    /* Lie, mais rien de coche : on le dit, et on ouvre la ou il faut cocher.
       Des listes Google Tasks cochees suffisent : un artisan qui ne suit que
       ses taches doit pouvoir les rafraichir aussi. */
    var itT = infoTaches() || {};
    var calendriers = !!(i.suivis && i.suivis.length);
    if (!calendriers && !(itT.suivis && itT.suivis.length)) {
      toast(M('rienAFaire'));
      ouvrir();
      return Promise.resolve(false);
    }

    if (enTrain) { return Promise.resolve(false); }
    enTrain = true;
    ENVOI_SESSION = 0;
    DERNIERE_REPRISE = 0;

    var bSync = document.getElementById('apgSync');
    if (bSync) { bSync.disabled = true; bSync.textContent = M('enCours'); }
    if (!opts.silencieux) { toast(M('travail')); }

    /* Hors ligne : on le dit tout de suite et franchement, au lieu de laisser
       l'artisan regarder une roue tourner jusqu'au message de Google. */
    if (typeof navigator !== 'undefined' && navigator.onLine === false) {
      enTrain = false;
      if (bSync) { bSync.disabled = false; bSync.textContent = M('synchroniser'); }
      toast(M('horsLigne'));
      dessiner();
      return Promise.resolve(false);
    }

    return Promise.resolve()
      .then(function () { return calendriers ? AP.gsync.pull({ complet: !!opts.complet }) : null; })
      .then(function () {
        /* Les listes Google Tasks suivies : un seul geste de synchronisation
           rafraichit les deux, comme l'artisan s'y attend. On ATTEND leur
           lecture, pour que le compte-rendu dise aussi combien de taches sont
           arrivees. Une erreur ici ne fait pas echouer celui du calendrier. */
        if (!(AP.gtasks && typeof AP.gtasks.pull === 'function')) { return null; }
        /* Une lecture des taches tourne deja (reveil, relecture des cinq
           minutes) : on attend SA fin, au lieu d'annoncer l'ancien chiffre. */
        if ((infoTaches() || {}).enCours) { return attendreFinTaches(); }
        return Promise.resolve(AP.gtasks.pull({ complet: !!opts.complet })).catch(function () { return null; });
      })
      .then(function () {
        var ap = infoMoteur() || {};
        rendre({ fond: true });

        var it2 = infoTaches();
        var tachesSuivies = !!(it2 && it2.suivis && it2.suivis.length);
        /* Permission de lecture absente : c'est un echec a dire, pas un
           « انتهت المزامنة » avec l'ancien chiffre. */
        var errT = tachesSuivies ? (it2.erreur || (!it2.connecte ? M('porteeTaches') : null)) : null;
        if (calendriers && ap.erreur) {
          toast(M('echec') + ' — ' + ap.erreur);
          return false;
        }
        /* Seulement des taches, et leur lecture a echoue : c'est un echec, pas
           un « انتهت المزامنة » avec l'ancien chiffre. */
        if (!calendriers && errT) {
          toast(M('echec') + ' — ' + errT);
          return false;
        }

        /* Le compte-rendu, en clair, et seulement des chiffres vrais. */
        var bouts = [];
        if (calendriers) { bouts.push((ap.taches || 0) + ' ' + M('lus')); }
        if (tachesSuivies) { bouts.push(errT ? ('Google Tasks : ' + M('echec') + ' — ' + errT) : M('tachesLues', { n: it2.taches })); }
        if (ENVOI_SESSION)    { bouts.push(ENVOI_SESSION + ' ' + M('ecrits')); }
        if (ap.enAttente)     { bouts.push(ap.enAttente + ' ' + M('attente')); }
        if (DERNIER_MASQUE)   { bouts.push(DERNIER_MASQUE + ' ' + M('masques')); }
        toast(M('fini') + ' — ' + bouts.join(' · '));
        return true;
      })
      .catch(function (e) {
        /* LE VRAI MESSAGE, tel que Google l'a ecrit. */
        var msg = (e && e.message) ? String(e.message) : '';
        avert('synchronisation : ' + msg);
        toast(M('echec') + (msg ? ' — ' + msg : ''));
        return false;
      })
      .then(function (r) {
        enTrain = false;
        var b2 = document.getElementById('apgSync');
        if (b2) { b2.disabled = false; b2.textContent = M('synchroniser'); }
        dessiner();
        return r;
      });
  }

  function demanderDelier() {
    /* On demande, et on dit exactement ce qui va se passer — y compris ce qui
       NE va PAS se passer : rien n'est efface chez Google. */
    if (!W.confirm(M('delierTitre') + '\n\n' + M('delierTexte'))) { return; }
    /* Le choix « quelles sources afficher » (app/microsoft/mbridge.js) ne se
       desactive jamais tout seul : s'il vaut « google seul », delier Google
       maintenant ferait disparaitre Microsoft de l'ecran sans explication. On
       revient a « les deux » avant de vider le moteur. */
    try {
      if (AP.mbridge && typeof AP.mbridge.source === 'function' && AP.mbridge.source() === 'google') {
        AP.mbridge.source('tous');
      }
    } catch (e) { }
    try { AP.gsync.deconnecter(); } catch (e) { avert('deconnecter (moteur) : ' + e.message); }
    try { if (AP.gtasks && typeof AP.gtasks.deconnecter === 'function') { AP.gtasks.deconnecter(); } }
    catch (e) { avert('deconnecter (taches) : ' + e.message); }
    try { if (AP.gauth && AP.gauth.deconnecter) { AP.gauth.deconnecter(); } }
    catch (e) { avert('deconnecter (compte) : ' + e.message); }
    DERNIER_MASQUE = 0;
    ENVOI_SESSION = 0;
    rendre();
    dessiner();
    toast(M('delie'));
  }

  /* LE BANDEAU « GOOGLE TASKS N'EST PAS ENCORE AUTORISE ».
     Un compte lie AVANT l'arrivee de Google Tasks n'a jamais donne le droit
     de lire les taches, et rien ne pouvait le lui demander en silence (voir
     gauth.js, porteesVoulues). Sans ce bandeau, la seule porte etait cachee
     au fond du panneau Google : l'artisan cherchait ses taches « partout »
     sans les trouver. Il apparait sur l'ecran principal, un bouton suffit, et
     « لاحقاً » le range pour la session. */
  var bandeauTaches = null, bandeauTachesRange = false, modeBandeau = '';
  function textesBandeauTaches() {
    if (!bandeauTaches) { return; }
    var e = bandeauTaches.children;
    if (modeBandeau === 'erreur') {
      e[0].textContent = M('bandeauTachesErreur', { e: (infoTaches() || {}).erreur || '' });
      e[1].textContent = M('ouvrirReglagesTaches');
    } else {
      e[0].textContent = M('bandeauTaches');
      e[1].textContent = M('autoriserTaches');
    }
    e[2].textContent = M('plusTardTaches');
  }
  /* Deux cas, et deux seulement :
     - 'portee' : Google est lie mais la lecture des taches n'est pas
       permise — un bouton la demande ;
     - 'erreur' : permise, des listes suivies, mais AUCUNE tache n'est
       arrivee a cause d'une erreur (API non activee, par exemple) — le
       bandeau le dit au lieu de disparaitre en silence, et ouvre le panneau. */
  function majBandeauTaches() {
    try {
      var g = (AP.gauth && typeof AP.gauth.etat === 'function') ? AP.gauth.etat() : null;
      var it = infoTaches();
      var mode = '';
      if (g && g.connecte && !g.besoinReconnexion && it && !bandeauTachesRange) {
        if (!it.connecte) { mode = 'portee'; }
        else if (it.erreur && (it.suivis || []).length && !it.taches && !it.enCours) { mode = 'erreur'; }
      }
      /* Le panneau ouvert montre deja l'erreur dans sa section : le bandeau
         ne le couvre pas. Il reviendra a la fermeture si l'erreur demeure. */
      if (mode === 'erreur' && elPanneau && elPanneau.classList.contains('show')) { mode = ''; }
      if (!mode) { if (bandeauTaches) { bandeauTaches.classList.remove('on'); } return; }
      if (!document.body) { return; }
      if (!bandeauTaches) {
        bandeauTaches = document.createElement('div');
        bandeauTaches.className = 'ap-g-bandeau';
        bandeauTaches.style.borderColor = 'var(--warn)';
        bandeauTaches.setAttribute('role', 'status');
        var txt = document.createElement('span');
        txt.className = 'ap-g-bandeau-txt';
        var ok = document.createElement('button');
        ok.className = 'ap-g-btn primaire';
        ok.onclick = function () {
          if (modeBandeau === 'erreur') { bandeauTaches.classList.remove('on'); ouvrir(); return; }
          bandeauTaches.classList.remove('on');
          chargerListesTaches().then(majBandeauTaches);
        };
        var tard = document.createElement('button');
        tard.className = 'ap-g-btn';
        tard.onclick = function () { bandeauTachesRange = true; bandeauTaches.classList.remove('on'); };
        bandeauTaches.appendChild(txt);
        bandeauTaches.appendChild(ok);
        bandeauTaches.appendChild(tard);
        if (AP.bandeaux && typeof AP.bandeaux.poser === 'function') { AP.bandeaux.poser(bandeauTaches); }
        else { document.body.appendChild(bandeauTaches); }
        /* La langue change : les textes suivent (et seulement les textes —
           la visibilite, elle, ne bouge pas en plein consentement). */
        if (AP.ui && typeof AP.ui.onLang === 'function') { AP.ui.onLang(textesBandeauTaches); }
      }
      modeBandeau = mode;
      textesBandeauTaches();
      bandeauTaches.classList.add('on');
    } catch (e) { avert('bandeau des taches : ' + e.message); }
  }

  /* Reconstruire la liste et repeindre, dans le bon ordre. C'est l'enveloppe
     de la PARTIE 6 qui remet les taches de Google et retire les doublons. */
  /* opts.fond : un redessin demande par l'arriere-plan (fin de lecture,
     changement d'etat du compte) passe par renderFond (index.html), qui
     attend que l'artisan ait quitte le champ ou il ecrit. Ses propres gestes
     redessinent tout de suite. */
  var ECRIVABLE_PEINT = null;
  function ecrivableMaintenant() { var it = infoTaches(); return !!(it && it.ecrireVersGoogle && it.ecritureAutorisee); }
  function rendre(opts) {
    opts = opts || {};
    try {
      if (typeof W.buildTasks === 'function') { W.buildTasks(); }
      else if (P.buildTasks) { P.buildTasks(); }
    } catch (e) { avert('buildTasks : ' + e.message); }
    try {
      if (opts.fond && typeof W.renderFond === 'function') { W.renderFond(); }
      else if (typeof W.render === 'function') { W.render(); }
      else if (P.render) { P.render(); }
    } catch (e) { avert('render : ' + e.message); }
    ECRIVABLE_PEINT = ecrivableMaintenant();
    majBandeauTaches();
  }


  /* =========================================================================
     PARTIE 9 — CE QU'ON ECOUTE CHEZ LES DEUX AUTRES BRIQUES
     ---------------------------------------------------------------------
     Le moteur previent quand il a lu, quand il a envoye, quand la file
     d'attente bouge. On s'en sert pour deux choses, et deux seulement :
     tenir les compteurs du panneau a jour, et redessiner ce qui est ouvert.
     ========================================================================= */

  /* LE CLASSEMENT DU BUREAU, DEPOSE POUR LE TELEPHONE.
     Pour chaque serie de rendez-vous ecrite dans le programme (donnees en
     dur), on retient [section, sous-categorie, routine] sous l'identifiant
     Google de la serie — rien de lisible, pas un titre. gsync le depose dans
     le dossier prive de l'application sur le Drive ; le telephone, qui n'a
     que Google, range alors ses rendez-vous comme le bureau. Une fois par
     jour, ou des que le classement change. */
  /* Empreinte courte (FNV-1a, la meme que dans gsync) : sert seulement a
     savoir si le classement a change depuis le dernier depot. */
  function h32(str) {
    var x = 2166136261; str = String(str == null ? '' : str);
    for (var i = 0; i < str.length; i++) { x ^= str.charCodeAt(i); x = (x * 16777619) >>> 0; }
    return x.toString(36);
  }
  function paquetClassement() {
    var liste = taches(); if (!liste) { return null; }
    var s = {}, n = 0;
    liste.forEach(function (t) {
      if (!t || EN_DUR.indexOf(t.src) < 0) { return; }
      var id = t.gid || eidDe(t.link); if (!id) { return; }
      /* On ne retire que le suffixe d'occurrence (_AAAAMMJJ ou
         _AAAAMMJJTHHMMSSZ) : un identifiant Google peut lui-meme commencer
         par « _ » (evenements importes), split('_') le jetait. */
      var serie = String(id).replace(/_\d{8}(T\d{6}Z)?$/, ''); if (!serie) { return; }
      if (s[serie]) { return; }
      /* la section telle que l'artisan la voit (deplacements compris) */
      var cat = (typeof W.catOf === 'function') ? W.catOf(t) : t.cat;
      s[serie] = [cat || 'perso', t.sub || 'perso', t.routine ? 1 : 0]; n++;
    });
    return n ? s : null;
  }
  function deposerClassement() {
    try {
      if (!AP.gsync || typeof AP.gsync.classementMonter !== 'function') { return; }
      var i = infoMoteur();
      /* Sans la permission Drive, rien ne peut monter : on le dit UNE fois
         par appareil, pas a chaque lecture. */
      if (!i || !i.drive) {
        if (!reglagesPont().driveDit) { poserReglagesPont({ driveDit: 1 }); dire('classement : la permission Drive manque, il reste local.'); }
        return;
      }
      var s = PAQUET_ENTIER || paquetClassement(); if (!s) { return; }
      var empreinte = h32(JSON.stringify(s));
      var r = reglagesPont();
      var recent = (Date.now() - (r.classementQuand || 0)) < 24 * 60 * 60 * 1000;
      if (r.classementEmpreinte === empreinte && recent) {
        /* Deja depose : on ne remonte pas, mais la copie LOCALE est remise a
           jour (les jumeaux Google du bureau en dependent). */
        AP.gsync.classementMonter({ s: s }, { sansDrive: true });
        return;
      }
      AP.gsync.classementMonter({ s: s }).then(function (ok) {
        if (ok) { poserReglagesPont({ classementEmpreinte: empreinte, classementQuand: Date.now() }); }
      }).catch(function () { });
    } catch (e) { avert('classement : ' + e.message); }
  }

  var ecoutePosee = false;

  function ecouter() {
    if (ecoutePosee) { return; }
    ecoutePosee = true;

    if (AP.gsync && typeof AP.gsync.on === 'function') {
      AP.gsync.on('lecture', function (d) {
        /* Le moteur a DEJA reconstruit et redessine (gsync.rendre passe par
           notre buildTasks enveloppe, donc injecter + dedoublonner sont faits).
           Refaire rendre() ici doublait tout le travail — c etait le gel a la
           liaison. On ne rafraichit que le panneau, s il est ouvert. */
        if (elPanneau && elPanneau.classList.contains('show')) { dessiner(); }
        if (d && d.fin) { setTimeout(deposerClassement, 1500); }
      });
      AP.gsync.on('envoye', function (d) {
        ENVOI_SESSION += (d && d.total) || 0;
        if (elPanneau && elPanneau.classList.contains('show')) { dessiner(); }
      });
      AP.gsync.on('file', function () {
        if (elPanneau && elPanneau.classList.contains('show')) { dessiner(); }
      });
      AP.gsync.on('agendas', function () {
        if (elPanneau && elPanneau.classList.contains('show')) { dessiner(); }
      });
    }

    if (AP.gauth && typeof AP.gauth.onChange === 'function') {
      AP.gauth.onChange(function () {
        if (elPanneau && elPanneau.classList.contains('show')) { dessiner(); }
      });
    }
  }


  /* =========================================================================
     PARTIE 10 — LE DEMARRAGE
     ---------------------------------------------------------------------
     RIEN NE CHANGE POUR QUELQU'UN QUI N'A PAS BRANCHE GOOGLE. C'est le point
     5 du cahier des charges, et c'est le chemin qu'il faut verifier en
     premier. Il tient dans la ligne `if (!actif()) { return; }` ci-dessous :
     au-dessus, on n'a rien fait ; en dessous, on enveloppe, on ecoute, on
     dessine. Entre les deux, un artisan qui n'a jamais vu Google ne passe pas.
     ========================================================================= */

  var demarre = false;

  function demarrer() {
    if (!branche) { return false; }      // index.html ne nous a pas encore passe ses variables
    if (!actif()) { return false; }      // Google n'est pas branche : ON NE FAIT RIEN
    if (demarre) { return true; }

    if (!joindreLesBriques()) { return false; }

    demarre = true;
    envelopperBuildTasks();
    ecouter();
    rendre();
    /* L'etat du compte change : le bandeau suit, et si les cartes Google
       Tasks passent d'ecrivables a lecture seule (ou l'inverse), on les
       redessine aussitot. */
    if (AP.gauth && typeof AP.gauth.onChange === 'function') {
      try {
        AP.gauth.onChange(function () {
          /* Compare a ce qui est REELLEMENT peint (ECRIVABLE_PEINT), pas a
             l'evenement precedent : sinon un renouvellement de jeton, une
             heure apres un changement de la case, redessinait pour rien. */
          if (ECRIVABLE_PEINT !== null && ecrivableMaintenant() !== ECRIVABLE_PEINT) { rendre({ fond: true }); }
          else { majBandeauTaches(); }
        });
      } catch (e) { }
    }
    /* Une lecture des taches vient de finir : le panneau ouvert se redessine
       avec les vrais chiffres, le bandeau se met a jour, et si l'artisan
       attendait le resultat de sa permission, on le lui dit. */
    if (AP.gtasks && typeof AP.gtasks.on === 'function') {
      try {
        AP.gtasks.on(function (ev) {
          if (ev && ev.fin) {
            annoncerResultatTaches();
            var l = ATTENTES_FIN; ATTENTES_FIN = []; l.forEach(function (f) { try { f(); } catch (e) { } });
          }
          majBandeauTaches();
          if (elPanneau && elPanneau.classList.contains('show')) { dessiner(); }
        });
      } catch (e) { }
    }
    dire('en place (v' + VERSION + ').');
    return true;
  }


  /* =========================================================================
     PARTIE 11 — L'API PUBLIQUE
     ---------------------------------------------------------------------
     app/setup/setup.js s'en sert pour la ligne « أجندة Google » du panneau
     « الربط والحساب », et index.html pour le branchement.
     ========================================================================= */

  AP.gbridge = {
    version: VERSION,

    /* index.html nous passe ses variables locales. */
    brancher: brancher,

    /* Le panneau Google : agendas a suivre, etat, synchronisation. */
    ouvrir: ouvrir,
    fermer: fermer,

    /* Les actions, telles que setup.js et le bouton du haut les appellent. */
    lier: lier,
    delier: demanderDelier,
    actualiser: actualiser,
    agendas: chargerAgendas,

    /* La reconstruction de la liste : taches Google injectees, doublons
       retires, puis rendu. */
    /* Deposer maintenant le classement du bureau sur le Drive (voir deposerClassement). */
    classer: deposerClassement,
    rendre: rendre,

    /* Le retrait des doublons, expose pour un test a la console. Il ne fait
       que retirer des elements de la liste affichee : rien n'est efface, ni
       dans le fichier, ni chez Google. */
    dedoublonner: dedoublonner,

    /* Le mode de traitement des rendez-vous ecrits en dur. */
    mode: function (m) {
      if (m === undefined) { return reglagesPont().mode; }
      if (MODES.indexOf(m) < 0) { return reglagesPont().mode; }
      poserReglagesPont({ mode: m });
      rendre();
      return m;
    },

    /* TOUT ce que setup.js a besoin de savoir pour ecrire sa ligne, en un
       seul objet et en lecture seule. */
    etat: function () {
      var i = infoMoteur() || {};
      var c = infoCompte() || {};
      var t = infoTaches() || {};
      var tachesSuivies = (t.connecte && t.suivis) ? t.suivis.length : 0;
      var derniere = Math.max(i.derniereLecture || 0, tachesSuivies ? (t.derniereLecture || 0) : 0);
      return {
        /* Des listes Google Tasks suivies comptent comme « quelque chose de
           suivi » : un artisan qui ne suit que ses taches n'a rien a regler. */
        tachesSuivies: tachesSuivies,
        tachesNb:      t.taches || 0,
        tachesErreur:  tachesSuivies ? (t.erreur || null) : null,
        derniereTout:  derniere,
        depuisTout:    depuis(derniere),
        disponible: !!(AP.gsync && AP.gauth),
        configure:  !!clientId(),
        connecte:   !!i.connecte,
        courriel:   c.courriel || '',
        agendas:    (i.agendas || []).length,
        suivis:     (i.suivis  || []).length,
        taches:     i.taches || 0,
        enAttente:  i.enAttente || 0,
        derniere:   i.derniereLecture || 0,
        depuis:     depuis(i.derniereLecture || 0),
        masques:    DERNIER_MASQUE,
        erreur:     i.erreur || null,
        enCours:    enTrain
      };
    },

    /* Le dictionnaire, pour que setup.js n'ecrive pas ses propres phrases
       arabes a cote des notres : deux formulations du meme etat, c'est la
       garantie qu'un jour l'une des deux mentira. */
    tr: M
  };

  /* Si index.html nous a charges APRES avoir appele brancher() — ce qui ne
     devrait pas arriver, mais l'ordre des balises se modifie un jour ou
     l'autre — on rattrape au chargement de la page. */
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', function () { demarrer(); });
  } else {
    setTimeout(demarrer, 0);
  }

})();
