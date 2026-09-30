/* ============================================================================
   AGENDA PRO — app/google/gtasks.js
   LES LISTES DE Google Tasks (le petit panneau « Taches » a cote de Google
   Agenda), publie sous window.AP.gtasks.

   LE MEME COMPTE, LA MEME LIAISON, UNE API DIFFERENTE. Google Agenda et
   Google Tasks partagent le meme compte mais pas la meme porte : ce fichier
   ne refait PAS sa propre connexion — il se branche sur celle que
   app/google/gauth.js tient deja (AP.gauth.appel), exactement comme
   app/google/gsync.js le fait pour le calendrier. Il n'y a donc ni bouton
   « lier » ni bouton « delier » ici : des que Google est branche, les listes
   de taches apparaissent dans le meme panneau.

   LECTURE SEULE PAR DEFAUT — ET UNE SEULE EXCEPTION, ELLE AUSSI VOULUE.
   Ce fichier ne cree rien et ne supprime rien dans Google Tasks. Il peut, en
   revanche, PATCHER une tache existante (achevement, titre, note) — mais
   seulement si l'artisan a explicitement coche « ecrire dans Google Tasks »
   (app/google/gbridge.js, sectionEcritureTaches()), ce qui demande d'abord une
   autorisation Google supplementaire (PORTEE.tachesEcriture, gauth.js). Sans
   cette case cochee, ce fichier se comporte exactement comme avant : un
   statut ou une note poses ICI restent sur cet appareil. Voir PARTIE 10 bis.

   TANT QU'AUCUN googleClientId N'EST CONNU ET QUE GOOGLE N'EST PAS BRANCHE,
   CE FICHIER NE FAIT RIEN.
   ============================================================================ */

(function () {
  'use strict';

  var W = window;
  W.AP = W.AP || {};
  var AP = W.AP;
  if (AP.gtasks) { return; }

  var CFG = W.AP_CONFIG || {};


  /* =========================================================================
     PARTIE 1 — LE DICTIONNAIRE
     ========================================================================= */

  var T = {
    ar: {
      pasConfigure: 'لم يتم إعداد Google بعد.', liste: 'قائمة مهام',
      ecritureKo: 'تعذّر إرسال التغيير إلى Google Tasks.',
      err_portee: 'لم يُمنح إذن قراءة Google Tasks بعد — اضغط «السماح بقراءة المهام» ووافق في نافذة Google.',
      err_api: 'خدمة Google Tasks API غير مفعّلة في مشروع Google Cloud — فعّلها من «المكتبة» ثم أعد المحاولة.',
      err_quota: 'Google يطلب التمهّل قليلاً — ستُعاد القراءة تلقائياً بعد دقائق.',
      err_reseau: 'لا يوجد اتصال بالإنترنت — ستُعاد القراءة عند عودته.',
      err_sansJeton: 'الربط مع Google غير جاهز الآن — إن ظهر شريط «أعد الربط» فاضغطه.',
      err_serveur: 'خوادم Google تواجه عطلاً مؤقتاً — ستُعاد المحاولة تلقائياً.',
      err_refus403: 'رفض Google الوصول إلى هذه القائمة أو المهمة (403).',
      ecritureKoNote: 'رفض Google هذا التغيير — حُفظ نصّك في «ملاحظات» هذه البطاقة حتى لا يضيع.',
      conflit: 'تغيّرت هذه المهمة في Google بعد تعديلك دون اتصال — لم يُكتب فوقها؛ نصّك محفوظ في «ملاحظات» البطاقة.',
      ecriturePermis: 'خانة «الكتابة في Google Tasks» مفعّلة لكن الإذن لم يعد موجوداً — افتح «التقاويم والمهام» وأعد تفعيلها.',
      attenteCoupee: 'أُوقفت الكتابة: التعديلات التي لم تُرسل بعد لن تُرسل؛ الملاحظات منها حُفظت في «ملاحظات» بطاقاتها.',
      ecritureOff: 'الكتابة في Google Tasks غير مفعّلة — لم يُرسل هذا التغيير.',
      ecritureOffNote: 'الكتابة في Google Tasks غير مفعّلة — حُفظ نصّك في «ملاحظات» هذه البطاقة فقط.',
      ecritureOffEtoile: 'الكتابة في Google Tasks غير مفعّلة — النجمة تُكتب في اسم المهمة داخل Google Tasks، فشغّل الكتابة أولاً.',
      enAttente: 'لم يُرسل الآن — سيُرسل تلقائياً إلى Google Tasks عند عودة الاتصال أو بعد إعادة الربط.',
      nouvelleListe: 'قائمة جديدة في Google Tasks تُعرض الآن: {n}',
      crea_titre: 'اكتب عنوان المهمة أولاً.',
      crea_trop: 'النص طويل جداً: Google Tasks يقبل 1024 حرفاً للعنوان و8192 للتفاصيل.',
      crea_date: 'التاريخ غير صحيح.',
      crea_liste: 'اختر قائمة من قوائم Google Tasks المعروضة في البرنامج.',
      crea_permission: 'لم يُمنح إذن الكتابة في Google Tasks — لم تُنشأ المهمة.',
      crea_reseau: 'لا يوجد اتصال بالإنترنت الآن — لم تُنشأ المهمة، ونصّك ما زال في النموذج.',
      crea_sansJeton: 'الربط مع Google غير جاهز الآن — لم تُنشأ المهمة. إن ظهر شريط «أعد الربط» فاضغطه، ثم أعد المحاولة.',
      crea_quota: 'Google يطلب التمهّل — لم تُنشأ المهمة، أعد المحاولة بعد دقيقة.',
      crea_serveur: 'عطل مؤقت عند Google — لم تُنشأ المهمة، أعد المحاولة.',
      crea_portee: 'إذن الكتابة في Google Tasks غير موجود — لم تُنشأ المهمة.',
      crea_api: 'خدمة Google Tasks API غير مفعّلة في مشروع Google Cloud.',
      crea_refus: 'رفض Google إنشاء المهمة.',
      crea_attente: 'لهذه المهمة تعديل لم يُرسل بعد — انتظر حتى يُرسل ثم انقلها.',
      depl_refus: 'رفض Google نقل هذه المهمة (المهام المتكرّرة أو المُسندة من Docs لا تُنقل بين القوائم).',
      depl_reseau: 'لا يوجد اتصال بالإنترنت — لم تُنقل المهمة.',
      depl_sansJeton: 'الربط مع Google غير جاهز — اضغط «أعد الربط» ثم أعد المحاولة. لم تُنقل المهمة.',
      depl_serveur: 'عطل مؤقت عند Google — لم تُنقل المهمة، أعد المحاولة.',
      depl_quota: 'Google يطلب التمهّل — أعد المحاولة بعد دقيقة.',
      depl_incertain: 'انقطع الاتصال أثناء النقل: قد تكون المهمة نُقلت. انتظر لحظة حتى تُعاد القراءة من Google.',
      depl_attente: 'لهذه المهمة (أو لإحدى مهامها الفرعية) تعديل لم يُرسل بعد — انتظر حتى يُرسل ثم انقلها.',
      depl_liste: 'هذه القائمة غير معروضة في البرنامج.',
      depl_disparue: 'هذه المهمة لم تعد موجودة في Google Tasks.',
      depl_portee: 'إذن الكتابة في Google Tasks غير موجود — لم تُنقل المهمة.',
      depl_api: 'خدمة Google Tasks API غير مفعّلة في مشروع Google Cloud.',
      crea_incertain: 'انقطع الاتصال بعد الإرسال: قد تكون المهمة أُنشئت في Google Tasks. انتظر لحظة حتى تظهر قبل أن تعيد الإرسال، حتى لا تتكرر.'
    },
    fr: {
      pasConfigure: 'Google n\'est pas encore configure.', liste: 'Liste de taches',
      ecritureKo: 'Le changement n\'a pas pu etre envoye a Google Tasks.',
      err_portee: 'La lecture de Google Tasks n\'est pas encore autorisee — cliquez « Autoriser la lecture des taches » et acceptez dans la fenetre Google.',
      err_api: 'L\'API Google Tasks n\'est pas activee dans le projet Google Cloud — activez-la dans la « Bibliotheque », puis reessayez.',
      err_quota: 'Google demande de patienter un peu — la lecture reprendra toute seule dans quelques minutes.',
      err_reseau: 'Pas de connexion internet — la lecture reprendra a son retour.',
      err_sansJeton: 'La liaison Google n\'est pas prete — si le bandeau « Reconnecter » apparait, cliquez-le.',
      err_serveur: 'Les serveurs de Google ont une panne passagere — nouvel essai automatique.',
      err_refus403: 'Google refuse l\'acces a cette liste ou a cette tache (403).',
      ecritureKoNote: 'Google a refuse ce changement — votre texte a ete garde dans les « Notes » de cette carte pour ne pas le perdre.',
      conflit: 'Cette tache a change chez Google apres votre modification hors ligne — rien n\'a ete ecrase ; votre texte est garde dans les « Notes » de la carte.',
      ecriturePermis: 'La case « Ecrire dans Google Tasks » est cochee mais l\'autorisation n\'existe plus — ouvrez « Agendas et taches » et reactivez-la.',
      attenteCoupee: 'Ecriture coupee : les modifications pas encore envoyees ne le seront pas ; les notes ont ete gardees dans les « Notes » de leurs cartes.',
      ecritureOff: 'L\'ecriture dans Google Tasks est desactivee — ce changement n\'a pas ete envoye.',
      ecritureOffNote: 'L\'ecriture dans Google Tasks est desactivee — votre texte a ete garde dans les « Notes » de cette carte seulement.',
      ecritureOffEtoile: 'L\'ecriture dans Google Tasks est desactivee — l\'etoile s\'ecrit dans le nom de la tache chez Google : activez d\'abord l\'ecriture.',
      enAttente: 'Pas envoye pour l\'instant — il partira tout seul vers Google Tasks au retour de la connexion ou apres reconnexion.',
      nouvelleListe: 'Nouvelle liste Google Tasks, affichee maintenant : {n}',
      crea_titre: 'Ecrivez d\'abord le titre de la tache.',
      crea_trop: 'Texte trop long : Google Tasks accepte 1024 caracteres pour le titre et 8192 pour les details.',
      crea_date: 'Date invalide.',
      crea_liste: 'Choisissez une liste Google Tasks affichee dans le programme.',
      crea_permission: 'L\'ecriture dans Google Tasks n\'est pas autorisee — la tache n\'a pas ete creee.',
      crea_reseau: 'Pas de connexion internet — la tache n\'a pas ete creee ; votre texte est toujours dans le formulaire.',
      crea_sansJeton: 'La liaison Google n\'est pas prete — la tache n\'a pas ete creee. Reessayez dans un instant.',
      crea_quota: 'Google demande de patienter — la tache n\'a pas ete creee, reessayez dans une minute.',
      crea_serveur: 'Panne passagere chez Google — la tache n\'a pas ete creee, reessayez.',
      crea_portee: 'Pas d\'autorisation d\'ecriture Google Tasks — la tache n\'a pas ete creee.',
      crea_api: 'L\'API Google Tasks n\'est pas activee dans le projet Google Cloud.',
      crea_refus: 'Google a refuse de creer la tache.',
      crea_attente: 'Cette tache a une modification pas encore envoyee — attendez qu\'elle parte, puis deplacez-la.',
      depl_refus: 'Google refuse de deplacer cette tache (les taches repetees ou confiees depuis Docs ne changent pas de liste).',
      depl_reseau: 'Pas de connexion internet — la tache n\'a pas ete deplacee.',
      depl_sansJeton: 'La liaison Google n\'est pas prete — cliquez « Reconnecter » puis reessayez. Tache non deplacee.',
      depl_serveur: 'Panne passagere chez Google — tache non deplacee, reessayez.',
      depl_quota: 'Google demande de patienter — reessayez dans une minute.',
      depl_incertain: 'Connexion coupee pendant le deplacement : la tache a peut-etre ete deplacee. Patientez, la liste va etre relue.',
      depl_attente: 'Cette tache (ou une de ses sous-taches) a une modification pas encore envoyee — attendez qu\'elle parte, puis deplacez-la.',
      depl_liste: 'Cette liste n\'est pas affichee dans le programme.',
      depl_disparue: 'Cette tache n\'existe plus dans Google Tasks.',
      depl_portee: 'Pas d\'autorisation d\'ecriture Google Tasks — tache non deplacee.',
      depl_api: 'L\'API Google Tasks n\'est pas activee dans le projet Google Cloud.',
      crea_incertain: "Connexion coupee apres l'envoi : la tache a peut-etre ete creee dans Google Tasks. Attendez qu'elle apparaisse avant de renvoyer, pour eviter un doublon."
    }
  };
  function langue() {
    if (AP.ui && typeof AP.ui.lang === 'function') { return AP.ui.lang(); }
    var l = (document.documentElement.lang || '').toLowerCase();
    return (l.indexOf('fr') === 0) ? 'fr' : 'ar';
  }
  function tr(cle) { var d = T[langue()] || T.ar; return d[cle] || T.ar[cle] || ''; }
  function dire() {
    if (!CFG.googleDebug) { return; }
    try { console.log.apply(console, ['[gtasks]'].concat([].slice.call(arguments))); } catch (e) { }
  }
  function avert(m) { try { console.warn('[gtasks] ' + m); } catch (e) { } }


  /* =========================================================================
     PARTIE 2 — LE RANGEMENT SUR LE DISQUE
     ---------------------------------------------------------------------
     Des cles a NOUS, distinctes de celles de gsync.js (agendapro_g_reglages_v1
     etc.) : les deux fichiers ne doivent jamais se marcher dessus en ecrivant
     au meme endroit.
     ========================================================================= */

  var K = {
    cfg:   'agendapro_g_listes_v1',
    curs:  'agendapro_g_taches_curseurs_v1',
    ev:    'agendapro_g_taches_ev_v1',
    ombre: 'agendapro_g_taches_ombre_v1',
    attente: 'agendapro_g_taches_attente_v1'
  };

  function jget(cle, repli) {
    try { var v = JSON.parse(localStorage.getItem(cle)); return (v == null) ? repli : v; }
    catch (e) { return repli; }
  }
  function jset(cle, v) { try { localStorage.setItem(cle, JSON.stringify(v)); return true; } catch (e) { return false; } }

  function clientId() {
    return (CFG.googleClientId || jget('agendapro_g_reglages_v1', {}).clientId || '').trim();
  }

  var DEFAUTS = { listes: {}, ecrireVersGoogle: false };
  /* Relus sur le disque a chaque appel : un autre onglet peut les avoir
     changes (couper l'ecriture, par exemple), et un cache ici les aurait
     ecrases. Ce n'est plus couteux : tacheDe() recoit les reglages une seule
     fois par construction (contexte()).
     SECOURS : si le disque est plein, le choix de l'artisan tient quand meme
     pour la session, au lieu d'etre perdu a la lecture suivante. */
  var SECOURS = null;
  function reglages() {
    var r = SECOURS || jget(K.cfg, {}) || {};
    return Object.assign({}, DEFAUTS, r, { listes: Object.assign({}, r.listes || {}) });
  }
  function poserReglages(patch) {
    var r = Object.assign(reglages(), patch || {});
    if (jset(K.cfg, r)) { SECOURS = null; }
    else {
      SECOURS = Object.assign({}, r, { listes: Object.assign({}, r.listes || {}) });
      avert('reglages des taches non enregistres (stockage plein) — gardes pour cette session');
    }
    return r;
  }


  /* =========================================================================
     PARTIE 3 — L'ETAT EN MEMOIRE
     ---------------------------------------------------------------------
     TACHES[idTache] = { liste, jour, tache } : `jour` est la VRAIE echeance
     (YYYY-MM-DD) ou null. Jamais de date de repli ici : elle serait figee sur
     le disque et deviendrait « hier » des le lendemain. Le repli se calcule
     a chaque construction, dans tacheDe().
     SCHEMA : quand il change, la lecture suivante est complete — c'est ce
     qui fait revenir les taches que l'ancienne version ecartait (sans date,
     achevees), et que la lecture par « updatedMin » ne ramenerait jamais.
     ========================================================================= */

  var SCHEMA = 2;
  var UN_JOUR = 24 * 3600 * 1000;
  var LISTES = [];        // [{id, nom, suivi}]
  var TACHES = {};
  /* ETAT.curs : les curseurs de lecture par liste. Ils vivent DANS la meme
     sauvegarde que les taches (ranger), jamais a part : un curseur ne peut
     ainsi jamais etre en avance sur les taches gardees — ni apres une
     interruption, ni quand un autre onglet ecrit sa propre copie. */
  function etatVide() { return { derniereLecture: 0, derniereComplete: 0, erreur: null, brut: null, curs: {} }; }
  var ETAT = etatVide();
  /* Des donnees laissees par une version d'AVANT le schema 2 (qui ecartait
     les taches achevees) : voir lireListe, la reprise des statuts herites. */
  var HERITE = false;
  /* Decalage entre l'horloge de ce PC et celle de Google, appris a chaque
     ecriture reussie : les comparaisons de temps se font sur l'heure de
     Google, pas sur une horloge de PC en avance ou en retard. */
  var DECALAGE = 0;
  function maintenantGoogle() { return Date.now() + DECALAGE; }

  /* Disque plein : on reessaie avec une copie reduite (les taches achevees
     sans leurs notes ni liens, MARQUEES sansNotes, et une lecture complete
     exigee au prochain demarrage), puis, si cela ne passe toujours pas, on
     EFFACE l'ancienne copie. Garder une copie perimee serait pire que rien :
     chaque demarrage la comparerait a Google et croirait voir des
     changements qui n'en sont pas (et effacerait des statuts a tort).
     Rend true, 'compact' ou false. */
  function ranger() {
    if (jset(K.ev, { listes: LISTES, taches: TACHES, etat: ETAT })) { return true; }
    var petit = {};
    Object.keys(TACHES).forEach(function (id) {
      var e = TACHES[id], t = e.tache;
      petit[id] = (t.status === 'completed')
        ? { liste: e.liste, jour: e.jour, sansNotes: true, tache: { id: t.id, title: t.title, status: t.status, due: t.due,
            completed: t.completed, updated: t.updated, parent: t.parent, position: t.position, webViewLink: t.webViewLink } }
        : e;
    });
    if (jset(K.ev, { listes: LISTES, taches: petit, etat: Object.assign({}, ETAT, { derniereComplete: 0, curs: {} }) })) { return 'compact'; }
    try { localStorage.removeItem(K.ev); } catch (e) { }
    avert('reserve des taches pleine — relecture complete au prochain passage');
    return false;
  }
  function restaurer() {
    var p = jget(K.ev, null);
    if (!p) { return; }
    LISTES = p.listes || [];
    TACHES = p.taches || {};
    ETAT = Object.assign(etatVide(), p.etat || {});
    if (!ETAT.curs || typeof ETAT.curs !== 'object') { ETAT.curs = {}; }
    HERITE = !!(p.etat && p.etat.schema === undefined && p.taches && Object.keys(p.taches).length);
  }
  restaurer();
  try { localStorage.removeItem(K.curs); } catch (e) { }   /* l'ancienne cle des curseurs, remplacee par ETAT.curs */

  /* L'ERREUR EST RANGEE COMME UN CODE, PAS COMME UNE PHRASE : la phrase est
     fabriquee a l'affichage, dans la langue du moment. Et jamais le
     « Google demande de ralentir (403) » que gauth.js donne a TOUT 403. */
  var CODES = { portee: 1, api: 1, quota: 1, reseau: 1, sansJeton: 1, serveur: 1 };
  /* Ce qui passera plus tard (on garde et on reessaie) ; le reste est un
     refus definitif. Une panne passagere de Google (5xx, 408) en fait partie. */
  var REESSAYABLES = { reseau: 1, sansJeton: 1, quota: 1, serveur: 1 };
  function classerErreur(e) {
    if (!e) { return null; }
    var d = String(e.detail || '') + ' ' + String(e.message || '');
    if (e.statut === 403 && /SCOPE_INSUFFICIENT|insufficient/i.test(d)) { return 'portee'; }
    if (e.statut === 403 && /accessNotConfigured|SERVICE_DISABLED|has not been used|is disabled/i.test(d)) { return 'api'; }
    /* Un 403 n'est « ralentis » que si Google le dit : un « pas le droit »
       (politique de l'organisation, tache confiee depuis Docs) ne passera
       jamais mieux en insistant — il ne doit pas tourner en attente sans fin. */
    if (e.statut === 403 && !/ratelimit|userratelimit|quotaexceeded|dailylimit|usagelimits|resource_exhausted/i.test(d)) { return 'autre'; }
    if (e.statut === 403 || e.statut === 429 || e.name === 'AP_TROP_VITE') { return 'quota'; }
    if (e.statut >= 500 || e.statut === 408) { return 'serveur'; }
    if (e.name === 'AP_SANS_JETON') { return 'sansJeton'; }
    if (e.name === 'TypeError' || (typeof navigator !== 'undefined' && navigator.onLine === false)) { return 'reseau'; }
    return 'autre';
  }
  function noterErreur(e) {
    ETAT.erreur = classerErreur(e);
    ETAT.brut = e ? String(e.message || e) : null;
    /* gauth nomme TOUT 403 « Google demande de ralentir » : pour un refus qui
       n'en est pas un, on garde la raison donnee par Google, sinon un texte
       traduit. */
    if (ETAT.erreur === 'autre' && e && e.statut === 403) {
      var raison = '';
      try { var j = JSON.parse(e.detail || '{}'); raison = (j && j.error && j.error.message) || ''; } catch (x) { }
      ETAT.brut = tr('err_refus403') + (raison ? ' (' + raison + ')' : '');
    }
  }
  function texteErreur() {
    if (!ETAT.erreur) { return null; }
    if (CODES[ETAT.erreur]) { return tr('err_' + ETAT.erreur); }
    return ETAT.brut || (ETAT.erreur !== 'autre' ? String(ETAT.erreur) : '');
  }

  function pad2(n) { return (n < 10 ? '0' : '') + n; }
  function jourLocal(x) { return x.getFullYear() + '-' + pad2(x.getMonth() + 1) + '-' + pad2(x.getDate()); }
  /* « completed » est un instant UTC : le couper donnerait le jour UTC, qui
     n'est pas celui de l'artisan entre minuit et 1 h. « due », lui, est une
     date pure (minuit UTC, heure sans valeur selon la doc) : on la coupe. */
  function jourDeInstant(ts) { var x = new Date(ts); return isNaN(x) ? null : jourLocal(x); }

  /* Ce qu'on garde d'une tache : de quoi l'afficher, rien de plus. */
  var GARDES = ['id', 'title', 'notes', 'status', 'due', 'completed', 'updated', 'parent',
                'position', 'hidden', 'links', 'webViewLink', 'assignmentInfo'];
  function allegee(t) {
    var o = {};
    GARDES.forEach(function (k) { if (t[k] !== undefined && t[k] !== null) { o[k] = t[k]; } });
    return o;
  }
  function entreeDe(idListe, t) {
    return { liste: idListe, jour: t.due ? String(t.due).slice(0, 10) : null, tache: allegee(t) };
  }

  function h32(s) {
    var x = 2166136261; s = String(s == null ? '' : s);
    for (var i = 0; i < s.length; i++) { x ^= s.charCodeAt(i); x = (x * 16777619) >>> 0; }
    return x.toString(36);
  }
  function idDeTache(idListe, tache) { return 'g|t|' + h32(idListe) + '|' + tache.id; }


  /* =========================================================================
     PARTIE 4 — PARLER A GOOGLE TASKS, PAR LA PORTE DE gauth.js
     ---------------------------------------------------------------------
     AP.gauth.appel() n'applique sa regle d'ecriture qu'aux adresses
     /calendar/v3/calendars/.../events — une adresse tasks.googleapis.com n'y
     correspond jamais, et un GET n'a de toute facon jamais besoin de passer
     cette regle (elle se retire d'elle-meme devant toute lecture). On y gagne
     le renouvellement de jeton et le 401 rattrape, sans rien reecrire ici.
     ========================================================================= */

  var TASKS_API = 'https://www.googleapis.com/tasks/v1';

  function api(chemin, params) {
    if (!(AP.gauth && typeof AP.gauth.appel === 'function')) {
      return Promise.reject(new Error('gauth absent'));
    }
    var url = TASKS_API + chemin;
    if (params) { url += '?' + new URLSearchParams(params).toString(); }
    return AP.gauth.appel(url, { methode: 'GET' });
  }

  function toutesLesPages(chemin, params) {
    var out = [];
    function page(pageToken) {
      var p = Object.assign({}, params || {});
      if (pageToken) { p.pageToken = pageToken; }
      return api(chemin, p).then(function (d) {
        out = out.concat((d && d.items) || []);
        if (d && d.nextPageToken) { return page(d.nextPageToken); }
        return out;
      });
    }
    return page(null);
  }


  /* =========================================================================
     PARTIE 5 — LES LISTES DE TACHES
     ========================================================================= */

  function listes() { return LISTES.slice(); }
  function nomListe(id) {
    for (var i = 0; i < LISTES.length; i++) { if (LISTES[i].id === id) { return LISTES[i].nom; } }
    return id;
  }

  /* TOUTE LISTE NOUVELLE EST SUIVIE. Ne pas montrer une liste tant que
     l'artisan ne l'a pas cochee revenait a cacher ses taches derriere un
     reglage qu'il ne savait pas exister — la premiere fois pour toutes ses
     listes, puis pour chaque liste creee plus tard sur le telephone.
     « vues » retient les listes deja rencontrees : seule une liste JAMAIS vue
     est suivie d'office ; un choix de l'artisan (decocher) reste respecte.
     Reprise d'une version plus ancienne (pas de « vues ») : les listes
     presentes gardent exactement leur etat d'avant. */
  function chargerListes() {
    if (!clientId()) { return Promise.resolve([]); }
    /* Une ancienne erreur ne doit pas survivre a une nouvelle tentative —
       sauf pendant une lecture en cours, dont l'echec doit rester visible. */
    if (!enCours) { ETAT.erreur = null; ETAT.brut = null; }
    return toutesLesPages('/users/@me/lists', { maxResults: 100 }).then(function (items) {
      var r = reglages();
      var premiereFois = !Object.keys(r.listes || {}).length;
      var reprise = !r.vues && !premiereFois;
      var vues = Object.assign({}, r.vues || {});
      var listesR = Object.assign({}, r.listes);
      var nouvelles = [];
      /* Reprise : seules les listes que l'ancienne version a REELLEMENT vues
         gardent leur etat d'avant ; une liste creee depuis est nouvelle. */
      var connuesAvant = null;
      if (reprise && LISTES.length) {
        connuesAvant = {};
        LISTES.forEach(function (x) { connuesAvant[x.id] = 1; });
        Object.keys(r.listes || {}).forEach(function (id) { connuesAvant[id] = 1; });
      }
      LISTES = (items || []).map(function (l) {
        var nom = l.title || l.id;
        var pref = r.listes[l.id];
        var suivi;
        if (vues[l.id] || (reprise && (!connuesAvant || connuesAvant[l.id]))) { suivi = !!(pref && pref.suivi); }
        else {
          suivi = pref ? !!pref.suivi : true;
          if (!pref) { listesR[l.id] = { suivi: true, nom: nom }; if (!premiereFois) { nouvelles.push(nom); } }
        }
        vues[l.id] = 1;
        return { id: l.id, nom: nom, suivi: suivi };
      });
      var avantVues = Object.keys(r.vues || {}).length;
      var aSuivre = Object.keys(listesR).length !== Object.keys(r.listes).length;
      if (aSuivre || Object.keys(vues).length !== avantVues) { poserReglages({ listes: listesR, vues: vues }); }
      ranger();
      if (nouvelles.length && P.toast) { try { P.toast(tr('nouvelleListe').replace('{n}', nouvelles.join('، '))); } catch (e) { } }
      emettre({ listes: true });
      /* Une liste qui vient d'etre suivie n'a pas de curseur : la lecture
         normale la lit en entier. La premiere fois, lecture complete. */
      if (aSuivre) { pull(premiereFois ? { complet: true } : {}); }
      return listes();
    }).catch(function (e) {
      noterErreur(e);
      ranger();
      dire('chargerListes:', e && e.message);
      emettre({ listes: true, erreur: true });
      return listes();
    });
  }

  function listesSuivies() {
    var r = reglages(); var out = [];
    Object.keys(r.listes || {}).forEach(function (id) { if (r.listes[id] && r.listes[id].suivi) { out.push(id); } });
    return out;
  }

  function suivre(idListe, oui) {
    var r = reglages();
    var l = Object.assign({}, r.listes[idListe] || {}, { suivi: !!oui });
    if (!l.nom) { l.nom = nomListe(idListe); }
    var listesR = Object.assign({}, r.listes, {}); listesR[idListe] = l;
    poserReglages({ listes: listesR });
    LISTES.forEach(function (x) { if (x.id === idListe) { x.suivi = !!oui; } });
    if (!oui) {
      Object.keys(TACHES).forEach(function (id) { if (TACHES[id].liste === idListe) { delete TACHES[id]; } });
      delete ETAT.curs[idListe];
      ranger();
    }
    return true;
  }


  /* =========================================================================
     PARTIE 6 — LES OMBRES (les choix de l'artisan, par-dessus Google Tasks)
     ========================================================================= */

  /* En memoire, ecrites en differe : le meme remede que gsync.js (ses
     OMBRES), pour la meme maladie — un JSON.parse du paquet entier par tache
     et par reconstruction, qui gelait l'ecran des que l'historique grossit. */
  /* ECRITURE PAR FUSION : on ne reecrit jamais le paquet entier tel qu'on le
     garde en memoire (un autre onglet a pu y ajouter ses propres choix entre
     temps) ; on relit le disque, on y applique NOS changements en attente, et
     on ecrit le resultat. */
  var OMBRES = null, EN_SUSPENS = {}, OMBRES_MINUTERIE = null;
  function ombres() {
    if (!OMBRES) {
      OMBRES = jget(K.ombre, {}) || {};
      Object.keys(EN_SUSPENS).forEach(function (id) { OMBRES[id] = Object.assign({}, OMBRES[id] || {}, EN_SUSPENS[id]); });
    }
    return OMBRES;
  }
  function ecrireOmbres() {
    if (OMBRES_MINUTERIE) { clearTimeout(OMBRES_MINUTERIE); OMBRES_MINUTERIE = null; }
    var ids = Object.keys(EN_SUSPENS);
    if (!ids.length) { return; }
    var o = jget(K.ombre, {}) || {};
    ids.forEach(function (id) { o[id] = Object.assign({}, o[id] || {}, EN_SUSPENS[id]); });
    if (jset(K.ombre, o)) { EN_SUSPENS = {}; OMBRES = o; }
  }
  function poserOmbre(idTache, patch) {
    var o = ombres(); o[idTache] = Object.assign({}, o[idTache] || {}, patch);
    EN_SUSPENS[idTache] = Object.assign({}, EN_SUSPENS[idTache] || {}, patch);
    if (!OMBRES_MINUTERIE) { OMBRES_MINUTERIE = setTimeout(ecrireOmbres, 0); }
    return true;
  }
  try {
    W.addEventListener('pagehide', ecrireOmbres);
    W.addEventListener('beforeunload', ecrireOmbres);
    document.addEventListener('visibilitychange', function () { if (document.visibilityState === 'hidden') { ecrireOmbres(); } });
    /* Un autre onglet a change les reglages ou les ombres : on relira, et
       les cartes suivent (une ecriture coupee la-bas l'est aussi ici). */
    W.addEventListener('storage', function (ev) {
      if (ev.key === K.ombre) { OMBRES = null; }
      if (ev.key === K.attente) { ATTENTE = jget(K.attente, {}) || {}; }
      /* L'autre onglet a lu et enregistre plus recent que nous : on reprend
         sa copie (taches ET curseurs ensemble), sauf en pleine lecture — ce
         sera fait a la fin de celle-ci. */
      if (ev.key === K.ev) { if (enCours) { rechargerApres = true; } else { restaurer(); garderCreees(); } }
      if (ev.key === K.cfg || ev.key === K.ombre || ev.key === K.attente || ev.key === K.ev) { reconstruire(); }
    });
  } catch (e) { }

  /* Qui veut savoir qu'une lecture vient de finir (le panneau Google, pour
     se redessiner avec les vrais chiffres). */
  var ECOUTEURS = [];
  function on(fn) { if (typeof fn === 'function') { ECOUTEURS.push(fn); } }
  function emettre(ev) { ECOUTEURS.forEach(function (f) { try { f(ev || {}); } catch (e) { } }); }

  /* Reconstruire la liste, puis repeindre SANS arracher un champ en cours
     de frappe : index.html fournit renderFond(), qui attend que le champ
     soit quitte (et son texte enregistre) avant de redessiner. */
  function reconstruire() {
    try { if (typeof W.buildTasks === 'function') { W.buildTasks(); } } catch (e) { }
    try {
      if (typeof W.renderFond === 'function') { W.renderFond(); }
      else if (typeof W.render === 'function') { W.render(); }
    } catch (e) { }
  }
  function setSection(idTache, val) { return poserOmbre(idTache, { sc: val }); }
  function setSousCat(idTache, val) { return poserOmbre(idTache, { sb: val }); }


  /* =========================================================================
     PARTIE 7 — LA LECTURE
     ---------------------------------------------------------------------
     Pas de syncToken comme le calendrier : l'API Tasks offre `updatedMin`, ce
     qui suffit ici puisqu'on ne fait que lire. Une marge d'une minute absorbe
     le decalage d'horloge entre cet appareil et Google — mieux vaut relire
     une tache une fois de trop que d'en manquer une.
     ========================================================================= */

  /* LE STATUT DE L'ARTISAN CONTRE CELUI DE GOOGLE (trancherStatut).
     Quand l'achevement change chez Google (coche ou decoche sur le
     telephone), l'ecran suit Google — le statut pose ici est retire — SAUF si
     l'artisan a pose le sien NETTEMENT apres (plus d'une minute, sur l'heure
     de Google : stAt) ; alors son choix est garde, et renvoye a Google si
     l'ecriture est activee (A_RENVOYER). Dans le doute, Google fait foi : un
     choix ancien ne doit jamais defaire ce qui vient d'etre fait sur le
     telephone. Le moment du changement Google : l'heure d'achevement pour un
     achevement, la date de modification pour une reouverture.
     Tant qu'une de NOS ecritures est en vol (EN_VOL), une lecture n'y touche
     pas : sa reponse fera foi. GEN change a chaque deliaison : une lecture ou
     une ecriture partie avant ne remet rien en place apres. */
  var STATUTS_TOUCHES = false, A_RENVOYER = {}, EN_VOL = {}, SAUTEES = {}, GEN = 0, rechargerApres = false;
  function oublierStatutLocal(idTache) {
    if (P.store && P.store.status && P.store.status[idTache] !== undefined) {
      delete P.store.status[idTache];
      STATUTS_TOUCHES = true;
    }
  }
  function trancherStatut(idTache, ancienne, t) {
    var faitN = t.status === 'completed';
    if (!ancienne || ((ancienne.status === 'completed') === faitN)) { return; }
    var om = ombres()[idTache] || {};
    var local = (P.store && P.store.status) ? P.store.status[idTache] : undefined;
    var tG = Date.parse(faitN && t.completed ? t.completed : t.updated) || 0;
    if (local !== undefined && om.stAt && tG + 60000 < om.stAt) { A_RENVOYER[idTache] = 1; return; }
    oublierStatutLocal(idTache);
    if (om.faitIci || om.faitLe) { poserOmbre(idTache, { faitIci: false, faitLe: null }); }
  }

  function lireListe(idListe, complet, gen) {
    /* showHidden : sans lui, les taches achevees DANS les applications de
       Google (telephone, Gmail) ne reviennent jamais — la doc le dit en toutes
       lettres. showAssigned : les taches confiees depuis Docs ou Chat. */
    var params = { showCompleted: true, showHidden: true, showDeleted: true, showAssigned: true, maxResults: 100 };
    if (!complet && ETAT.curs[idListe]) { params.updatedMin = ETAT.curs[idListe]; }

    /* Une minute de marge, sur l'heure de Google. */
    var avant = new Date(maintenantGoogle() - 60000).toISOString();
    return toutesLesPages('/lists/' + encodeURIComponent(idListe) + '/tasks', params).then(function (items) {
      /* Delie, ou liste decochee, PENDANT la lecture : on ne remet rien. */
      if (gen !== GEN || listesSuivies().indexOf(idListe) < 0) { return 0; }
      var changes = 0;
      var connues = {}, recues = {};
      Object.keys(TACHES).forEach(function (id) { if (TACHES[id].liste === idListe) { connues[id] = TACHES[id]; } });
      if (complet) { Object.keys(connues).forEach(function (id) { delete TACHES[id]; }); }
      (items || []).forEach(function (t) {
        var idTache = idDeTache(idListe, t);
        var eAncienne = connues[idTache], ancienne = eAncienne && eAncienne.tache;
        /* Supprimee chez Google : elle sort, et ce qui attendait d'etre envoye
           pour elle n'a plus d'objet. */
        if (t.deleted) {
          if (TACHES[idTache] || ancienne) { changes++; }
          delete TACHES[idTache];
          delete CREEES[idTache];
          /* ce qui attendait pour elle ne partira plus : le texte tape est
             garde, visible, avant de retirer l'entree */
          var aSup = (jget(K.attente, {}) || {})[idTache] || ATTENTE[idTache];
          if (aSup) { garderOrphelin(idTache, aSup, (ancienne && ancienne.title) || t.title); retirerAttente(idTache, null); }
          return;
        }
        recues[idTache] = 1;
        /* relue chez Google a cet identifiant : il est vivant, plus « deplace » */
        if (complet) { delete DEPLACEES[idTache]; }
        /* Une de nos ecritures est en vol : sa reponse fera foi. On note que
           cette lecture l'a sautee (si l'ecriture echoue, la liste sera relue
           en entier). Une lecture plus ancienne que ce qu'une ecriture a deja
           rapporte ne l'ecrase pas non plus. */
        if (ancienne && EN_VOL[idTache]) { TACHES[idTache] = eAncienne; SAUTEES[idTache] = idListe; return; }
        if (ancienne && ancienne.updated && t.updated && t.updated < ancienne.updated) { TACHES[idTache] = eAncienne; return; }
        if (!ancienne || ancienne.updated !== t.updated || (eAncienne && eAncienne.sansNotes)) { changes++; }
        TACHES[idTache] = entreeDe(idListe, t);
        var fait = t.status === 'completed';
        var local = (P.store && P.store.status) ? P.store.status[idTache] : undefined;
        if (ancienne) { trancherStatut(idTache, ancienne, t); }
        else if (HERITE && fait && local && local !== 'done') {
          /* Reprise d'une ancienne version, qui ne gardait jamais les taches
             achevees : un statut « en attente » pose alors sur une tache
             ouverte, puis achevee sur le telephone, n'a plus lieu d'etre. */
          oublierStatutLocal(idTache);
        }
      });
      /* Une tache creee ICI pendant que cette lecture etait en route : la
         reponse de Google est partie avant elle, une lecture complete la
         retirerait de l'ecran jusqu'a la suivante. On la garde (dix minutes
         au plus : au-dela, c'est Google qui fait foi). */
      Object.keys(CREEES).forEach(function (id) {
        var c = CREEES[id];
        if (!c || c.liste !== idListe) { return; }
        if (recues[id] || Date.now() - c.t > 600000) { delete CREEES[id]; return; }
        if (complet && connues[id] && !TACHES[id]) { TACHES[id] = connues[id]; recues[id] = 1; }
      });
      if (complet) { Object.keys(connues).forEach(function (id) { if (!recues[id]) { changes++; } }); }
      /* Taches et curseur dans la MEME sauvegarde : l'un ne peut pas etre en
         avance sur l'autre. */
      if (STATUTS_TOUCHES) { STATUTS_TOUCHES = false; changes++; try { if (P.lsSet) { P.lsSet(); } } catch (e) { } }
      ETAT.curs[idListe] = avant;
      ranger();
      return changes;
    });
  }

  var enCours = false;
  var enAttente = false;      // false | 'leger' | 'complet'
  function pull(opts) {
    opts = opts || {};
    if (!clientId()) { return Promise.resolve(false); }
    /* Une lecture demandee PENDANT qu'une autre tourne n'est jamais perdue :
       elle repart des que la chaine en cours s'acheve (complete si l'une des
       demandes l'etait). Sinon une liste tout juste suivie, ou tout juste
       cochee, restait vide jusqu'au cycle suivant. */
    if (enCours) { enAttente = (enAttente === 'complet' || opts.complet) ? 'complet' : 'leger'; return Promise.resolve(false); }
    var ids = listesSuivies();
    if (!ids.length) { return Promise.resolve(false); }

    enCours = true; ETAT.erreur = null; ETAT.brut = null;
    var echec = false;
    /* Les listes REELLEMENT relues par cette lecture : ce qui attend d'etre
       envoye n'est compare (controle de conflit) qu'a un etat frais. */
    var lues = {};
    /* Quel que soit le chemin qui a lance cette lecture (reveil, bouton du
       bandeau, case cochee), ce qu'elle rapporte doit pouvoir entrer dans
       TASKS : l'enveloppe est posee ici aussi (sans effet si elle l'est deja). */
    envelopper();
    var gen0 = GEN;
    /* Complete : si on la demande, apres une mise a jour du programme
       (SCHEMA), ou une fois par jour — ce qui rattrape aussi les deplacements
       entre listes et les « effacer les taches terminees », que la lecture par
       date de modification ne voit pas. */
    var complet = !!opts.complet || ETAT.schema !== SCHEMA || (Date.now() - (ETAT.derniereComplete || 0) > UN_JOUR);
    var changes = 0;

    var suivi = {}; ids.forEach(function (id) { suivi[id] = 1; });
    Object.keys(TACHES).forEach(function (id) { if (!suivi[TACHES[id].liste]) { delete TACHES[id]; changes++; } });

    var chaine = Promise.resolve();
    ids.forEach(function (id) {
      chaine = chaine.then(function () {
        if (gen0 !== GEN || listesSuivies().indexOf(id) < 0) { return 0; }
        return lireListe(id, complet, gen0).then(function (n) { changes += (n || 0); lues[id] = 1; }, function (e) {
          noterErreur(e); echec = true;
          dire('pull(' + id + '):', e && e.message);
          /* 404 : cette liste n'existe plus chez Google (supprimee depuis un
             telephone, par exemple). On ne la retentera pas indefiniment —
             ses taches sortent de la reserve et elle est desabonnee, pour que
             la case a cocher correspondante (qui a de toute facon deja
             disparu du panneau, Google ne la listant plus) ne reste pas
             suivie sans que rien ne puisse jamais plus l'arreter. */
          if (e && e.statut === 404) {
            abandonnerAttenteListe(id);
            Object.keys(TACHES).forEach(function (tid) { if (TACHES[tid].liste === id) { delete TACHES[tid]; changes++; } });
            delete ETAT.curs[id];
            var r = reglages();
            if (r.listes[id] && r.listes[id].suivi) {
              var listesR = Object.assign({}, r.listes);
              listesR[id] = Object.assign({}, listesR[id], { suivi: false });
              poserReglages({ listes: listesR });
            }
          }
        });
      });
    });

    function terminer() {
      /* Delie pendant la lecture : rien de ce compte n'est garde ni montre. */
      if (gen0 !== GEN) { enCours = false; emettre({ fin: true }); return false; }
      var suivis2 = {}; listesSuivies().forEach(function (id) { suivis2[id] = 1; });
      Object.keys(TACHES).forEach(function (id) { if (!suivis2[TACHES[id].liste]) { delete TACHES[id]; changes++; } });
      ETAT.derniereLecture = Date.now();
      if (complet && !echec) { ETAT.derniereComplete = Date.now(); ETAT.schema = SCHEMA; HERITE = false; }
      ranger();
      if (STATUTS_TOUCHES) { STATUTS_TOUCHES = false; changes++; try { if (P.lsSet) { P.lsSet(); } } catch (e) { } }
      /* ENSUITE ce qui attendait d'etre envoye : apres la lecture, donc sur
         l'etat frais de Google (voir viderAttente, le controle de conflit). */
      return viderAttente(lues, complet).then(function () {
        enCours = false;
        if (rechargerApres) { rechargerApres = false; restaurer(); garderCreees(); changes++; }
        /* Repeindre seulement si quelque chose a change (ou si le jour a
           tourne : les taches sans date se recalent sur aujourd'hui). Une
           relecture qui ne rapporte rien ne doit pas arracher le champ ou
           l'artisan est en train d'ecrire. */
        if (changes || complet || jourLocal(new Date()) !== DERNIER_JOUR) { reconstruire(); }
        renvoyerChoix();
        emettre({ fin: true, n: Object.keys(TACHES).length, erreur: texteErreur() });
        if (enAttente) { var c = enAttente === 'complet'; enAttente = false; pull({ complet: c }); }
        return !echec;
      });
    }
    return chaine.then(terminer, function (e) { noterErreur(e); echec = true; return terminer(); });
  }


  /* =========================================================================
     PARTIE 8 — TRANSFORMER UNE TACHE GOOGLE EN « tache » DU PROGRAMME
     ---------------------------------------------------------------------
     La meme forme de sortie que gsync.js (voir sa PARTIE 8), src:'google' y
     compris, pour suivre le meme choix « Google / Microsoft / les deux »
     (app/microsoft/mbridge.js, PARTIE 4). Une tache n'est PAS un rendez-vous :
     elle ne remplace jamais un rendez-vous ecrit en dur (gbridge.js,
     dedoublonner(), ecarte les identifiants « g|t| »).

     LE CONTRAT AVEC index.html (champs en plus de ceux de gsync) :
       gtache        toujours vrai — « ceci vient de Google Tasks »
       sansDate      pas d'echeance chez Google. `date` n'est alors qu'un
                     repli (aujourd'hui, ou le jour d'achevement) : index.html
                     ne s'en sert jamais comme d'une echeance.
       gFait         achevee chez Google (statusOf() la montre « منجزة »,
                     sauf si l'artisan a pose lui-meme un autre statut ici)
       gDue, gFaitLe, gMaj    echeance (YYYY-MM-DD), achevement et derniere
                     modification (RFC 3339, convertis en heure locale a
                     l'affichage)
       gParent, gEnfants      la tache mere et les sous-taches
       gLiens, gAssign        liens attaches, origine d'une tache confiee
       srch          texte en plus pour la recherche
       notesModifiables       faux pour une tache confiee depuis Docs (la doc
                     de Google : elle ne peut pas avoir de notes)
     ========================================================================= */

  function httpsOuRien(u) { u = String(u || ''); return /^https:\/\//i.test(u) ? u : ''; }
  /* L'ETOILE — Google ne donne l'etoile de Google Tasks a AUCUN programme
     (ni en lecture ni en ecriture : pas de champ « starred » dans son API).
     L'artisan a choisi l'etoile DANS LE NOM : « ⭐ » en tete du titre, que
     l'on voit dans Google Tasks sur le telephone, et qu'un « ⭐ » tape la-bas
     allume ici. Le programme montre le nom SANS ce signe, et l'etoile a
     part (le bouton ☆/★ de la ligne). */
  /* Toutes les etoiles de tete comptent pour UNE (« ⭐⭐ عاجل ») ; une etoile
     mise en FIN de nom (le curseur y tombe sur le telephone) compte aussi,
     et revient en tete a la prochaine ecriture. */
  var ETOILE_DEBUT = /^\s*(?:\u2B50\uFE0F?\s*)+/;
  var ETOILE_FIN = /(?:\s*\u2B50\uFE0F?)+\s*$/;
  function estEtoile(titre) { titre = String(titre == null ? '' : titre); return ETOILE_DEBUT.test(titre) || ETOILE_FIN.test(titre); }
  function sansEtoile(titre) { return String(titre == null ? '' : titre).replace(ETOILE_DEBUT, '').replace(ETOILE_FIN, '').trim(); }
  function avecEtoile(titre) { var n = sansEtoile(titre); return n ? ('\u2B50 ' + n) : '\u2B50'; }
  /* Le nom avec l'etoile de « modele » : ses etoiles de tete telles quelles
     (« ⭐⭐ » reste « ⭐⭐ »), sinon une seule. */
  function poserEtoile(nom, allumee, modele) {
    nom = sansEtoile(nom);
    if (!allumee) { return nom; }
    var m = String(modele == null ? '' : modele).match(ETOILE_DEBUT);
    var pre = (m && m[0].trim()) || '\u2B50';
    return nom ? (pre + ' ' + nom) : pre;
  }
  /* Deux titres qui disent la meme chose (meme nom, meme etoile). */
  function memeTitre(a, b) { return sansEtoile(a) === sansEtoile(b) && estEtoile(a) === estEtoile(b); }
  /* Le titre avec ou sans l'etoile ; null s'il n'y a rien a changer. */
  function titreEtoile(actuel, veut) {
    var allumer = (veut === undefined) ? !estEtoile(actuel) : !!veut;
    if (allumer === estEtoile(actuel)) { return null; }
    return poserEtoile(actuel, allumer, actuel);
  }
  /* Le titre tel qu'on le montre : sans l'etoile, ou « (بدون عنوان) ». */
  function titreDe(t, lg) { return sansEtoile(t.title) || (lg === 'fr' ? '(sans titre)' : '(بدون عنوان)'); }

  /* Tout ce qui est commun a toutes les taches d'une meme construction, lu
     UNE fois : reglages, ombres, permission d'ecrire, le jour d'aujourd'hui,
     et l'index meres -> filles (sinon chaque tache cherchait ses filles dans
     toutes les autres : N x N). */
  function contexte() {
    var r = reglages();
    var parGoogle = {}, enfants = {};
    Object.keys(TACHES).forEach(function (id) { var e = TACHES[id]; parGoogle[e.liste + '|' + e.tache.id] = id; });
    Object.keys(TACHES).forEach(function (id) {
      var e = TACHES[id]; if (!e.tache.parent) { return; }
      var p = parGoogle[e.liste + '|' + e.tache.parent];
      if (p) { (enfants[p] = enfants[p] || []).push(id); }
    });
    DERNIER_JOUR = jourLocal(new Date());
    return {
      r: r, o: ombres(), lg: langue(), aujourdhui: DERNIER_JOUR,
      peutEcrire: !!(r.ecrireVersGoogle && peutEcrire()),
      attente: ATTENTE,
      parGoogle: parGoogle, enfants: enfants
    };
  }
  var DERNIER_JOUR = '';

  function tacheDe(idTache, ctx) {
    var e = TACHES[idTache]; if (!e) { return null; }
    ctx = ctx || contexte();
    var t = e.tache;
    var etat = ctx.o[idTache] || {};
    var parListe = ctx.r.listes[e.liste] || {};
    /* Une modification pas encore partie (hors ligne, reconnexion) est
       montree telle que l'artisan l'a tapee — jamais l'ancien texte. */
    var att = (ctx.peutEcrire && ctx.attente && ctx.attente[idTache]) || null;
    var tp = TAPE[idTache] || null;
    var brut = (att && att.title !== undefined) ? att.title : String(t.title || '');
    var etoile = (tp && tp.etoile) ? tp.etoile.v : estEtoile(brut);
    var titre = sansEtoile((tp && tp.title) ? tp.title.v : brut) || titreDe({}, ctx.lg);
    var notes = (tp && tp.notes) ? tp.notes.v : ((att && att.notes !== undefined) ? att.notes : (t.notes || ''));
    var fait = (att && att.fait !== undefined) ? !!att.fait : (t.status === 'completed');
    /* L'echeance changee ici et pas encore partie : montree telle quelle. */
    var jour = (att && att.due !== undefined) ? (att.due || null) : e.jour;
    var sansDate = !jour;
    /* Le jour ou ELLE a ete achevee : chez Google, ou ici (ombre faitLe, pour
       une tache sans date marquee « منجزة » dans ce programme). Sinon, pour
       une tache ouverte sans date, aujourd'hui — un simple repli. */
    var date = jour || (fait && t.completed && jourDeInstant(t.completed)) || etat.faitLe || ctx.aujourdhui;
    var idMere = t.parent ? ctx.parGoogle[e.liste + '|' + t.parent] : null;
    var filles = (ctx.enfants[idTache] || []).map(function (c) {
      var tc = TACHES[c].tache;
      return { id: c, titre: titreDe(tc, ctx.lg), fait: tc.status === 'completed', pos: tc.position || '' };
    }).sort(function (a, b) { return a.pos < b.pos ? -1 : (a.pos > b.pos ? 1 : 0); });
    var liens = (t.links || []).filter(function (l) { return l && l.link; })
      .map(function (l) { return { type: l.type || '', description: l.description || '', link: l.link }; });
    var ai = t.assignmentInfo || null;
    var nom = nomListe(e.liste);
    return {
      id: idTache,
      sk: idTache,
      src: 'google',
      gtache: true,
      title: { ar: titre, fr: titre },
      raw: '',
      /* Leur propre section, « مهام Google Tasks » (index.html, SEC_GTASKS),
         a cote de l'Entreprise et du Personnel. Un deplacement fait par
         l'artisan (etat.sc) l'emporte toujours. */
      cat: etat.sc || parListe.sec || 'gtasks',
      sub: etat.sb || parListe.sub || 'perso',
      date: date,
      start: '', end: '',
      endDate: date,
      allDay: true,
      sansDate: sansDate,
      gFait: fait,
      /* L'etoile, lue dans le nom (voir ETOILE_RE) */
      gEtoile: etoile,
      gDue: jour || null,
      gFaitLe: fait ? (t.completed || null) : null,
      gFaitIci: etat.faitLe || null,
      gEnAttente: !!att,
      gMaj: t.updated || null,
      gParent: idMere ? { id: idMere, titre: titreDe(TACHES[idMere].tache, ctx.lg) } : null,
      /* Pour la vue « حسب القائمة » (index.html) : la liste Google, la place
         dans la liste (l'ordre choisi par l'artisan dans Google Tasks), la
         tache mere — la meme disposition que dans Google Tasks. */
      gListe: e.liste,
      gPos: t.position || '',
      gParentId: idMere || null,
      gEnfants: filles.length ? filles : null,
      gLiens: liens.length ? liens : null,
      gAssign: ai ? { type: ai.surfaceType || '', lien: httpsOuRien(ai.linkToTask) } : null,
      srch: liens.map(function (l) { return l.description; }).concat(filles.map(function (f) { return f.titre; })).concat(etoile ? ['\u2B50'] : []).join(' '),
      desc: String(notes).trim(),
      org: { ar: nom, fr: nom },
      loc: '',
      routine: false,
      /* Le vrai lien de la tache dans Google Tasks — jamais selfLink, qui
         est une adresse d'API (une page d'erreur dans le navigateur). */
      link: httpsOuRien(t.webViewLink) || httpsOuRien(ai && ai.linkToTask),
      gcal: e.liste,
      gev: t.id,
      /* Vrai seulement si l'artisan a coche ET obtenu « ecrire dans Google
         Tasks » (PARTIE 10 bis) : index.html s'en sert pour decider d'ouvrir
         le titre et la note en modification plutot qu'en simple lecture. */
      peutEcrireSource: ctx.peutEcrire,
      /* Pas de champ de note ouvert sur une note INCONNUE (copie reduite faute
         de place) : un champ vide modifiable ecraserait la vraie note. */
      notesModifiables: !(ai && ai.surfaceType === 'DOCUMENT') && !e.sansNotes
    };
  }

  function tasks() {
    var out = [], ctx = contexte();
    Object.keys(TACHES).forEach(function (id) { var t = tacheDe(id, ctx); if (t) { out.push(t); } });
    return out;
  }


  /* =========================================================================
     PARTIE 9 — L'INJECTION DANS buildTasks() (le jumeau de gsync.js, PARTIE 17)
     ---------------------------------------------------------------------
     Une enveloppe DE PLUS autour de window.buildTasks. gsync.js en pose deja
     une ; celle-ci s'ajoute a la chaine sans jamais la remplacer (elle
     n'ecrase W.buildTasks que si personne ne l'a encore enveloppe). L'ordre
     entre les deux n'a pas d'importance : chacune reconnait SES propres
     entrees par le prefixe de leur identifiant (« g| » pour gsync, « g|t| »
     pour celle-ci) avant de retirer un doublon, jamais celles de l'autre.
     ========================================================================= */

  var P = { TASKS: null, toast: null, store: null, lsSet: null };
  function bind(p) {
    p = p || {};
    if (p.TASKS !== undefined) { P.TASKS = p.TASKS; }
    if (p.toast !== undefined) { P.toast = p.toast; }
    if (p.store !== undefined) { P.store = p.store; }
    if (p.lsSet !== undefined) { P.lsSet = p.lsSet; }
    /* Des taches gardees de la derniere fois : on les montre des maintenant,
       comme gsync.js montre sa reserve, sans attendre que Google reponde
       (hors ligne, jeton lent, reconnexion demandee). Le rendu suit : c'est
       gbridge.js (demarrer -> rendre) qui repeint juste apres ce bind. */
    if (P.TASKS && Object.keys(TACHES).length) { envelopper(); }
    return AP.gtasks;
  }

  function injecter() {
    if (!P.TASKS) { return 0; }
    var liste = P.TASKS();
    if (!liste || typeof liste.push !== 'function') { return 0; }
    var deja = {};
    for (var i = liste.length - 1; i >= 0; i--) {
      var id = liste[i] && liste[i].id;
      if (typeof id === 'string' && id.indexOf('g|t|') === 0) {
        if (deja[id]) { liste.splice(i, 1); } else { deja[id] = 1; }
      }
    }
    var ajoutees = 0;
    tasks().forEach(function (t) { if (!deja[t.id]) { liste.push(t); ajoutees++; } });
    /* Le meme ordre que gsync.js (date, puis heure) : poussees en queue, les
       taches Google sortaient en dernier partout ou l'ordre de TASKS compte
       (« a venir », l'ordre des cartes, l'export). A date egale, les taches
       sans date passent apres. */
    if (ajoutees) {
      liste.sort(function (a, b) {
        if (a.date !== b.date) { return String(a.date).localeCompare(String(b.date)); }
        return ((a.sansDate ? 1 : 0) - (b.sansDate ? 1 : 0)) || String(a.start || '').localeCompare(String(b.start || ''));
      });
    }
    return ajoutees;
  }

  /* Le geste de recategoriser une tache (le bouton qui fait tourner la
     section, moveCat() dans index.html) n'ecrit que dans `store.cat`, un
     objet local que ce fichier ne voit jamais. Sans ce raccord, le choix de
     l'artisan sur une tache Google Tasks serait efface au prochain pull() :
     tacheDe() (PARTIE 8) relit `cat: etat.sc || parListe.sec || 'gtasks'`, et
     `etat.sc` (l'ombre) resterait vide pour toujours. On raccroche donc
     moveCat() ici, exactement comme gsync.js le fait deja pour le
     calendrier — la meme case a cocher doit se comporter pareil, quelle que
     soit la source de la tache. */
  function estGtache(id) { return typeof id === 'string' && id.indexOf('g|t|') === 0 && !!TACHES[id]; }
  function raccrocherMoveCat() {
    if (typeof W.moveCat !== 'function' || W.moveCat.__apgt) { return; }
    var orig = W.moveCat;
    var neuf = function () {
      var r = orig.apply(this, arguments);
      try {
        var id = arguments[0];
        if (estGtache(id) && P.store && P.store.cat) { setSection(id, P.store.cat[id] || null); }
      } catch (e) { avert('moveCat : ' + e.message); }
      return r;
    };
    neuf.__apgt = true;
    W.moveCat = neuf;
  }

  var enveloppe = false;
  function envelopper() {
    if (enveloppe) { return; }
    enveloppe = true;
    raccrocherMoveCat();
    raccrocherStatut();
    if (typeof W.buildTasks !== 'function' || W.buildTasks.__apgt) { return; }
    var orig = W.buildTasks;

    /* MICROSOFT A PU SE BRANCHER EN PREMIER (app/microsoft/mbridge.js).
       L'envelopper depuis l'exterieur cacherait ses marqueurs
       __apPontM/__apPontMInterne a app/google/gbridge.js, qui les cherche
       ensuite sur window.buildTasks pour savoir s'il doit s'inserer A
       L'INTERIEUR du crochet Microsoft plutot que de l'envelopper depuis
       l'exterieur (voir gbridge.js, envelopperBuildTasks()). Si ces
       marqueurs disparaissent derriere notre propre enveloppe, gbridge se
       pose alors par-dessus TOUT — y compris par-dessus le filtre de
       sources de mbridge — et ce filtre cesse de voir quoi que ce soit
       d'injecte apres lui pour le reste de la session. On s'insere donc,
       nous aussi, A L'INTERIEUR du crochet Microsoft quand il existe deja,
       exactement comme gbridge.js le fait. */
    if (orig.__apPontM && orig.__apPontMInterne) {
      var interieur = orig.__apPontMInterne;
      var brut = interieur.fn;
      var neufInterne = function () {
        var r = brut.apply(this, arguments);
        try { injecter(); } catch (e) { avert('injection : ' + e.message); }
        return r;
      };
      neufInterne.__apgt = true;
      interieur.fn = neufInterne;
      return;
    }

    var neuf = function () {
      var r = orig.apply(this, arguments);
      try { injecter(); } catch (e) { avert('injection : ' + e.message); }
      return r;
    };
    neuf.__apgt = true;
    W.buildTasks = neuf;
  }


  /* =========================================================================
     PARTIE 10 — SE METTRE AU TRAVAIL QUAND GOOGLE EST BRANCHE
     ========================================================================= */

  function deconnecter() {
    GEN++;                      /* toute lecture ou ecriture en vol ne remettra plus rien */
    LISTES = []; TACHES = {};
    ETAT = etatVide();
    /* Ce qui attendait d'etre envoye ne partira plus (compte delie) : les
       notes sont gardees dans les notes locales des cartes, comme la
       confirmation de « فك الربط » le promet. */
    var d0 = jget(K.attente, {}) || {};
    Object.keys(d0).forEach(function (id) { garderEnNotes(id, d0[id]); });
    ATTENTE = {}; jset(K.attente, {});
    EN_VOL = {}; A_RENVOYER = {}; FILE = {}; SAUTEES = {}; CREEES = {};
    ranger();
    try { if (typeof W.buildTasks === 'function') { W.buildTasks(); } } catch (e) { }
    return true;
  }

  /* La portee complete « tasks » couvre aussi la lecture : un artisan qui,
     sur l'ecran detaille de Google, n'aurait garde qu'elle doit pouvoir lire. */
  function porteeLecture(g) {
    var P0 = AP.gauth && AP.gauth.PORTEE;
    return !!(P0 && g && Array.isArray(g.portees) &&
      (g.portees.indexOf(P0.taches) >= 0 || g.portees.indexOf(P0.tachesEcriture) >= 0));
  }
  function etatCompte() { return (AP.gauth && typeof AP.gauth.etat === 'function') ? AP.gauth.etat() : null; }
  function lectureAutorisee() {
    var g = etatCompte();
    return !!(g && g.connecte && !g.besoinReconnexion && porteeLecture(g));
  }

  /* Une tache ajoutee sur le telephone apparait d'elle-meme, sans avoir a
     appuyer sur « مزامنة » : une relecture legere toutes les cinq minutes,
     seulement quand la fenetre est visible, la connexion presente et la
     lecture permise. */
  var minuterie = null;
  function armerMinuterie() {
    if (minuterie) { return; }
    minuterie = setInterval(function () {
      try {
        if (document.visibilityState === 'hidden') { return; }
        if (typeof navigator !== 'undefined' && navigator.onLine === false) { return; }
        if (!listesSuivies().length || !lectureAutorisee()) { return; }
        pull();
      } catch (e) { }
    }, 5 * 60 * 1000);
    /* Au retour sur la fenetre (reduite, autre onglet) : une relecture si la
       derniere date de plus d'une minute — la page ne montre pas des heures
       durant ce qui a change sur le telephone. */
    document.addEventListener('visibilitychange', function () {
      try {
        if (document.visibilityState !== 'visible') { return; }
        if (Date.now() - (ETAT.derniereLecture || 0) < 60000) { return; }
        if (typeof navigator !== 'undefined' && navigator.onLine === false) { return; }
        if (!listesSuivies().length || !lectureAutorisee()) { return; }
        pull();
      } catch (e) { }
    });
  }

  var reveilEnCours = false;
  function reveiller() {
    if (reveilEnCours) { return Promise.resolve(false); }
    if (!clientId()) { return Promise.resolve(false); }
    reveilEnCours = true;
    envelopper();
    armerMinuterie();
    ecouterRetour();
    return chargerListes().then(function () { return pull({ complet: false }); })
      .then(function () { reveilEnCours = false; return true; })
      .catch(function (e) { reveilEnCours = false; dire('reveil:', e && e.message); return false; });
  }

  function info() {
    /* « connecte » ne suffit pas : un artisan peut avoir refuse Google Tasks
       en particulier sur l'ecran de consentement (consentement granulaire,
       voir gauth.js) tout en restant connecte pour le calendrier. On verifie
       donc la portee REELLEMENT accordee (etat().portees), exactement comme
       gauth.js le fait deja pour peutEcrire — jamais juste « connecte ».
       Les comptes viennent de TACHES directement : fabriquer toutes les
       taches juste pour les compter coutait deux ou trois reconstructions a
       chaque dessin du panneau. */
    var g = etatCompte();
    var connecte = !!(g && g.connecte && porteeLecture(g));
    var nb = 0, sansDate = 0, faites = 0;
    Object.keys(TACHES).forEach(function (id) {
      var e = TACHES[id]; nb++;
      if (e.tache.status === 'completed') { faites++; } else if (!e.jour) { sansDate++; }
    });
    return {
      configure: !!clientId(),
      connecte: connecte,
      listes: LISTES.slice(),
      suivis: listesSuivies(),
      taches: nb,
      sansDate: sansDate,
      faites: faites,
      enCours: enCours,
      derniereLecture: ETAT.derniereLecture,
      derniereComplete: ETAT.derniereComplete,
      erreur: texteErreur(),
      codeErreur: ETAT.erreur || null,
      enAttente: Object.keys(ATTENTE).length,
      ecrireVersGoogle: !!reglages().ecrireVersGoogle,
      ecritureAutorisee: peutEcrire()
    };
  }


  /* =========================================================================
     PARTIE 10 bis — ECRIRE DANS GOOGLE TASKS (statut, titre, note)
     ---------------------------------------------------------------------
     Une exception unique, voulue et bornee, a la regle « lecture seule » du
     haut de ce fichier. Rien ne part tant que l'artisan n'a pas coche
     explicitement « ecrire dans Google Tasks » (app/google/gbridge.js,
     sectionEcritureTaches()) ET que Google n'a pas accorde
     PORTEE.tachesEcriture (gauth.js) — les deux conditions, verifiees ici a
     chaque appel. Le gardien final reste malgre tout gauth.js :
     verifierEcriture() n'accepte que title/notes/status/completed, et
     seulement avec la permission explicite (sa PARTIE 3).
     ========================================================================= */

  /* AUTORISE, ET DISPONIBLE : deux questions differentes.
     - Autorise : la case est cochee et Google a accorde « tasks ». Les champs
       du titre et de la note s'ouvrent alors en modification.
     - Disponible : un jeton valide et une connexion, la tout de suite. Sinon
       (hors ligne, reconnexion demandee), la modification n'est PAS perdue :
       elle attend sur le disque (ATTENTE) et part toute seule plus tard. */
  function porteeEcriture(g) {
    var P0 = AP.gauth && AP.gauth.PORTEE;
    return !!(P0 && g && Array.isArray(g.portees) && g.portees.indexOf(P0.tachesEcriture) >= 0);
  }
  function peutEcrire() {
    var g = etatCompte();
    return !!(g && (g.connecte || g.besoinReconnexion) && porteeEcriture(g));
  }
  function envoiPossible() {
    var g = etatCompte();
    if (typeof navigator !== 'undefined' && navigator.onLine === false) { return false; }
    return !!(g && g.connecte && !g.besoinReconnexion && porteeEcriture(g));
  }
  function ecritureCochee() { return !!reglages().ecrireVersGoogle; }
  function dire2(cle) { try { if (P.toast) { P.toast(tr(cle)); } } catch (e) { } }
  /* Case cochee mais permission disparue (compte delie puis relie, acces
     retire dans le compte Google) : on le dit, une fois par session, au lieu
     de garder les changements pour soi sans un mot. */
  var permisSignale = false;
  function signalerPermis() { if (!permisSignale) { permisSignale = true; dire2('ecriturePermis'); } }

  /* Le geste qui declenche l'ecran de consentement supplementaire — appele
     par gbridge.js quand l'artisan coche la case pour la premiere fois. */
  function demanderEcriture() {
    if (!(AP.gauth && typeof AP.gauth.demanderTachesEcriture === 'function')) { return Promise.resolve(false); }
    return AP.gauth.demanderTachesEcriture().then(function (ok) {
      poserReglages({ ecrireVersGoogle: !!ok });
      if (ok) { permisSignale = false; }
      reconstruire();
      return ok;
    });
  }

  /* UNE SEULE FILE PAR TACHE : statut, titre, note, et l'envoi de ce qui
     attendait passent tous par elle, chacun decide APRES que le precedent a
     rapporte l'etat de Google. Deux clics rapides, ou une correction tapee
     pendant qu'un envoi est en route, laissaient sinon Google et l'ecran en
     desaccord pour de bon. */
  var FILE = {};
  function enFile(idTache, fn) {
    var p = (FILE[idTache] || Promise.resolve()).then(fn, fn);
    FILE[idTache] = p.then(function () { }, function () { });
    return p;
  }

  /* LES MODIFICATIONS QUI ATTENDENT (hors ligne, reconnexion, panne passagere
     de Google). Sur le disque, et ecrites PAR FUSION (relire, modifier notre
     entree, reecrire) : un autre onglet ne les efface pas. Par tache :
       { liste, gid, title, notes, fait, completed,
         oTitle, oNotes, oFait }   (les o* : la valeur chez Google au moment
                                    ou l'artisan a modifie — ce qui permet de
                                    voir si quelqu'un d'autre l'a changee depuis)
     Montrees telles quelles sur la carte (tacheDe) ; envoyees apres la
     lecture suivante (viderAttente). */
  var ATTENTE = jget(K.attente, {}) || {};
  function ecrireAttente(maj) {
    var d = jget(K.attente, {}) || {};
    maj(d);
    if (jset(K.attente, d)) { ATTENTE = d; } else { maj(ATTENTE); }
  }
  function mettreEnAttente(idTache, champs, seulementManquants, envoye) {
    var e = TACHES[idTache];
    var t = e ? e.tache : {};
    ecrireAttente(function (d) {
      var a = d[idTache] || {};
      if (!a.liste && e) { a.liste = e.liste; a.gid = t.id; }
      if ('title' in champs && (!seulementManquants || a.title === undefined)) {
        if (a.title === undefined) { a.oTitle = String(t.title || ''); }
        a.title = champs.title;
        if (envoye !== undefined) { a.envoye = envoye; }
        if (a.oTitle !== undefined && memeTitre(a.title, a.oTitle) && (a.envoye === undefined || memeTitre(a.title, a.envoye))) { delete a.title; delete a.oTitle; delete a.envoye; }
      }
      if ('notes' in champs && (!seulementManquants || a.notes === undefined)) {
        if (a.notes === undefined) { a.oNotes = String(t.notes || ''); }
        a.notes = champs.notes;
      }
      if ('status' in champs && (!seulementManquants || a.fait === undefined)) {
        if (a.fait === undefined) { a.oFait = t.status === 'completed'; }
        a.fait = (champs.status === 'completed');
        /* L'heure du CLIC, pas celle de l'envoi : achevee lundi hors ligne,
           elle reste achevee lundi, meme envoyee mercredi. */
        a.completed = a.fait ? (champs.completed || new Date().toISOString()) : null;
      }
      /* L'echeance : un jour (YYYY-MM-DD) ou '' pour « sans date ». oDue :
         celle de Google au moment du changement, meme controle de conflit. */
      if ('due' in champs && (!seulementManquants || a.due === undefined)) {
        if (a.due === undefined) { a.oDue = jourDue(t.due); }
        a.due = jourDue(champs.due);
      }
      if (a.title === undefined && a.notes === undefined && a.fait === undefined && a.due === undefined) { delete d[idTache]; }
      else { d[idTache] = a; }
    });
  }
  /* Un « due » de Google (minuit UTC) ou d'un champ, ramene a 'YYYY-MM-DD'
     ou '' : la seule forme qu'on compare et qu'on garde. */
  function jourDue(v) { v = String(v == null ? '' : v); return /^\d{4}-\d{2}-\d{2}/.test(v) ? v.slice(0, 10) : ''; }
  function dueDe(jour) { return jour ? (jour + 'T00:00:00.000Z') : null; }
  function retirerAttente(idTache, champs) {
    if (!ATTENTE[idTache] && !(jget(K.attente, {}) || {})[idTache]) { return; }
    ecrireAttente(function (d) {
      var a = d[idTache]; if (!a) { return; }
      if (!champs) { delete d[idTache]; return; }
      if ('title' in champs) { delete a.title; delete a.oTitle; delete a.envoye; }
      if ('notes' in champs) { delete a.notes; delete a.oNotes; }
      if ('status' in champs) { delete a.fait; delete a.completed; delete a.oFait; }
      if ('due' in champs) { delete a.due; delete a.oDue; }
      if (a.title === undefined && a.notes === undefined && a.fait === undefined && a.due === undefined) { delete d[idTache]; }
    });
  }
  /* Le texte d'une note qui n'a pas pu partir va dans les notes LOCALES de la
     carte : jamais perdu, et jamais recopie deux fois. */
  function garderNoteLocale(idTache, texte) {
    texte = String(texte == null ? '' : texte).trim();
    if (!texte || typeof W.setNote !== 'function') { return; }
    var ancien = (P.store && P.store.notes && P.store.notes[idTache]) || '';
    if (ancien.indexOf(texte) >= 0) { return; }
    try { W.setNote(idTache, ancien ? (ancien + '\n' + texte) : texte); } catch (e) { }
  }

  function finVol(idTache) {
    EN_VOL[idTache] = (EN_VOL[idTache] || 1) - 1;
    if (EN_VOL[idTache] <= 0) { delete EN_VOL[idTache]; }
  }

  /* Rend true (parti), 'attente' (garde pour plus tard) ou false (refuse).
     opts.silencieux : pas de message « garde pour plus tard » (envoi de la
     file) ; opts.deFile : c'est l'envoi d'une entree en attente. */
  function ecrireDansGoogle(idTache, champs, opts) {
    opts = opts || {};
    var e = TACHES[idTache]; if (!e) { return Promise.resolve(false); }
    if (!ecritureCochee() || !peutEcrire()) { return Promise.resolve(false); }
    if (!(AP.gauth && typeof AP.gauth.appel === 'function')) { return Promise.resolve(false); }
    if (!envoiPossible()) {
      mettreEnAttente(idTache, champs, opts.deFile);
      if (!opts.silencieux) { dire2('enAttente'); }
      reconstruire();
      return Promise.resolve('attente');
    }
    /* La valeur la plus recente gagne : ce qui attendait pour ces MEMES
       champs est depasse, et ne doit plus partir apres elle. */
    if (!opts.deFile) { retirerAttente(idTache, champs); }
    var gen = GEN;
    var chemin = '/lists/' + encodeURIComponent(e.liste) + '/tasks/' + encodeURIComponent(e.tache.id);
    EN_VOL[idTache] = (EN_VOL[idTache] || 0) + 1;
    return AP.gauth.appel(TASKS_API + chemin, {
      methode: 'PATCH',
      corps: champs,
      permission: AP.gauth.PERMISSION_EXPLICITE,
      /* Jamais suspendu en memoire en attendant un jeton : sans jeton, la
         modification va dans ATTENTE, qui survit a une fermeture. */
      attendre: false
    }).then(function (frais) {
      finVol(idTache);
      /* Delie pendant l'envoi : rien de cet ancien compte n'est garde. */
      if (gen !== GEN) { return false; }
      if (frais && frais.updated) { var tf = Date.parse(frais.updated); if (tf) { DECALAGE = tf - Date.now(); } }
      var cur = TACHES[idTache];
      if (frais && frais.id && cur) {
        var c = cur.tache;
        /* Une reponse plus ancienne que ce qu'on a deja n'ecrase rien. */
        if (!(c.updated && frais.updated && frais.updated < c.updated)) {
          /* La reponse d'une note ou d'un titre peut reveler un achevement
             fait ailleurs entre temps : meme arbitrage qu'a la lecture. */
          if (!('status' in champs)) { trancherStatut(idTache, c, frais); }
          TACHES[idTache] = entreeDe(cur.liste, frais);
          if (CREEES[idTache]) { CREEES[idTache].e = TACHES[idTache]; }
          ranger();
          if (STATUTS_TOUCHES) { STATUTS_TOUCHES = false; try { if (P.lsSet) { P.lsSet(); } } catch (er) { } }
        }
      }
      delete SAUTEES[idTache];
      reconstruire();
      return true;
    }).catch(function (err) {
      finVol(idTache);
      if (gen !== GEN) { return false; }
      var code = classerErreur(err);
      avert('ecriture vers Google Tasks : ' + (err && err.message));
      if (REESSAYABLES[code]) {
        /* la requete est peut-etre arrivee chez Google (reponse perdue) : on
           garde ce qui a ete envoye comme reference possible */
        mettreEnAttente(idTache, champs, opts.deFile, ('title' in champs) ? champs.title : undefined);
        if (!opts.silencieux) { dire2('enAttente'); }
        reconstruire();
        return 'attente';
      }
      /* Refus definitif : on le dit TOUJOURS (meme pendant l'envoi de la
         file), et le texte d'une note n'est jamais perdu. */
      var noteG = String((TACHES[idTache] && TACHES[idTache].tache.notes) || '').trim();
      var tG = String((TACHES[idTache] && TACHES[idTache].tache.title) || '').trim();
      var aGarder = {};
      if ('notes' in champs && String(champs.notes || '').trim() && String(champs.notes).trim() !== noteG) { aGarder.notes = champs.notes; }
      if ('title' in champs && String(champs.title || '').trim() && String(champs.title).trim() !== tG && sansEtoile(champs.title) !== sansEtoile(tG)) { aGarder.title = champs.title; }
      if ('due' in champs) { aGarder.due = jourDue(champs.due); }
      if (Object.keys(aGarder).length) {
        garderEnNotes(idTache, aGarder);
        dire2('ecritureKoNote');
      } else {
        dire2('ecritureKo');
      }
      /* Une lecture avait saute cette tache a cause de cet envoi : la liste
         sera relue en entier, pour ne rien manquer de ce qu'elle apportait. */
      if (SAUTEES[idTache]) { delete ETAT.curs[SAUTEES[idTache]]; delete SAUTEES[idTache]; ranger(); }
      reconstruire();
      return false;
    });
  }

  /* L'ENVOI DE CE QUI ATTENDAIT — appele a la FIN d'une lecture, donc sur
     l'etat frais de Google, et par la file de chaque tache. Chaque entree est
     RECLAMEE sur le disque (lue et retiree dans le meme pas) : un deuxieme
     onglet ne l'enverra pas aussi.
     Controle de conflit, champ par champ : si Google a change ce champ depuis
     la modification hors ligne (sa valeur n'est plus celle d'alors, oX), on
     n'ecrase rien — une note est gardee dans les notes locales, et on le dit.
     Une tache absente de la liste lue (liste decochee) : l'entree attend. */
  /* Ce qui attendait d'etre envoye et ne partira plus (liste supprimee,
     tache disparue, compte delie) : le texte tape n'est jamais perdu, il va
     dans les notes locales de la carte — note, titre et date. */
  /* Ce qui attendait n'etait qu'une etoile (le nom n'a pas change) : rien
     de tape a garder. */
  function etoileSeule(a) { return !!a && a.title !== undefined && a.oTitle !== undefined && sansEtoile(a.title) === sansEtoile(a.oTitle); }
  function garderEnNotes(id, a) {
    if (!a) { return; }
    if (a.notes !== undefined) { garderNoteLocale(id, a.notes); }
    if (a.title !== undefined && !etoileSeule(a)) { garderNoteLocale(id, (langue() === 'fr' ? 'Titre propose : ' : 'العنوان المقترح: ') + a.title); }
    if (a.due !== undefined) { garderNoteLocale(id, (langue() === 'fr' ? 'Date proposee : ' : 'التاريخ المقترح: ') + (a.due || '—')); }
  }
  /* La tache (ou sa liste) n'existe plus : sa carte ne reviendra pas, ecrire
     dans ses notes serait « garder » la ou personne ne regarde. Le texte va
     dans une tache du programme, visible, et on le dit. */
  function garderOrphelin(id, a, titreConnu) {
    if (!a) { return; }
    var e = TACHES[id];
    var titre = titreConnu || (e && e.tache && e.tache.title) || a.oTitle || a.title || '';
    var lignes = [];
    if (a.title !== undefined && !etoileSeule(a)) { lignes.push((langue() === 'fr' ? 'Titre : ' : 'العنوان: ') + a.title); }
    if (a.due !== undefined) { lignes.push((langue() === 'fr' ? 'Date : ' : 'التاريخ: ') + (a.due || '—')); }
    if (a.notes !== undefined && String(a.notes).trim()) { lignes.push(String(a.notes)); }
    if (!lignes.length) { return; }
    if (typeof W.garderTexteOrphelin === 'function') {
      try { W.garderTexteOrphelin(titre, lignes.join('\n')); return; } catch (er) { avert('garderTexteOrphelin : ' + er.message); }
    }
    garderEnNotes(id, a);
  }
  function abandonnerAttenteListe(idListe) {
    var d = jget(K.attente, {}) || {};
    Object.keys(d).forEach(function (tid) { if (d[tid] && d[tid].liste === idListe) { garderOrphelin(tid, d[tid]); retirerAttente(tid, null); } });
  }
  function viderAttente(lues, complet) {
    var ids = Object.keys(jget(K.attente, {}) || {});
    if (!ids.length || !ecritureCochee() || !envoiPossible()) { return Promise.resolve(); }
    var conflit = false;
    return Promise.all(ids.map(function (id) {
      return enFile(id, function () {
        var e = TACHES[id];
        if (!e) {
          /* La tache n'est plus la. Sa liste a ete relue EN ENTIER sans elle
             (supprimee ou deplacee sur le telephone), ou la liste n'existe
             plus : l'entree ne partira jamais — on garde le texte et on la
             retire. Liste simplement decochee : l'entree attend. */
          var a0 = (jget(K.attente, {}) || {})[id];
          var existe = a0 && a0.liste && LISTES.some(function (l) { return l.id === a0.liste; });
          if (a0 && ((complet && lues && lues[a0.liste]) || (a0.liste && !existe && LISTES.length))) {
            garderOrphelin(id, a0); retirerAttente(id, null);
          }
          return;
        }
        /* Sa liste n'a pas pu etre relue : Google a peut-etre change cette
           tache entre-temps, et on ne le verrait pas. L'entree attend. */
        if (lues && !lues[e.liste]) { return; }
        var a = null;
        ecrireAttente(function (d) { a = d[id] || null; delete d[id]; });
        if (!a) { return; }
        var t = e.tache, champs = {};
        var titreG = String(t.title || ''), noteG = String(t.notes || ''), faitG = t.status === 'completed';
        if (a.title !== undefined && !memeTitre(a.title, titreG)) {
          /* la reference : ce qui a peut-etre deja ete ecrit (envoye) si
             Google l'a, sinon Google au moment du geste */
          var applique = a.envoye !== undefined && (memeTitre(titreG, a.envoye) ||
            (sansEtoile(a.envoye) !== sansEtoile(a.oTitle) && sansEtoile(titreG) === sansEtoile(a.envoye)));
          var refT = applique ? a.envoye : a.oTitle;
          if (refT !== undefined && !memeTitre(titreG, refT)) {
            /* Google a change ce titre depuis. Deux cas se fusionnent sans
               rien perdre : ici seule l'etoile a change (on la pose sur le
               nom de Google) ; la-bas seule l'etoile a change (on garde le nom
               tape ici avec l'etoile de Google). Sinon : vrai conflit. */
            var nomIci = sansEtoile(a.title), nomAvant = sansEtoile(refT), nomG = sansEtoile(titreG);
            /* le nom : celui d'ici s'il a change ici, sinon celui de Google ;
               change des deux cotes et differemment : vrai conflit */
            var nom = (nomIci === nomAvant) ? nomG : ((nomG === nomAvant || nomG === nomIci) ? nomIci : null);
            /* l'etoile : celle d'ici si elle a change ici, sinon celle de Google */
            var etIci = estEtoile(a.title), etG = estEtoile(titreG);
            var et = (etIci !== estEtoile(refT)) ? etIci : etG;
            var fusion = (nom === null) ? null : poserEtoile(nom, et, etG ? titreG : a.title);
            if (fusion !== null && !memeTitre(fusion, titreG)) { champs.title = fusion; }
            else if (fusion === null) { conflit = true; garderNoteLocale(id, (langue() === 'fr' ? 'Titre propose : ' : 'العنوان المقترح: ') + a.title); }
          }
          else { champs.title = a.title; }
        }
        if (a.notes !== undefined && String(a.notes).trim() !== noteG.trim()) {
          if ((a.oNotes !== undefined && noteG.trim() !== String(a.oNotes).trim()) || e.sansNotes) { garderNoteLocale(id, a.notes); conflit = true; }
          else { champs.notes = a.notes; }
        }
        if (a.fait !== undefined && a.fait !== faitG) {
          if (a.oFait !== undefined && faitG !== a.oFait) { conflit = true; }
          else {
            champs.status = a.fait ? 'completed' : 'needsAction';
            champs.completed = a.fait ? (a.completed || new Date().toISOString()) : null;
          }
        }
        var dueG = jourDue(t.due);
        if (a.due !== undefined && a.due !== dueG) {
          if (a.oDue !== undefined && dueG !== a.oDue) { conflit = true; garderNoteLocale(id, (langue() === 'fr' ? 'Date proposee : ' : 'التاريخ المقترح: ') + (a.due || '—')); }
          else { champs.due = dueDe(a.due); }
        }
        if (!Object.keys(champs).length) { return; }
        return ecrireDansGoogle(id, champs, { silencieux: true, deFile: true }).then(function (r) {
          if (r === true && 'status' in champs) {
            var fr = TACHES[id];
            poserOmbre(id, { faitIci: !!a.fait, stAt: (fr && Date.parse(fr.tache.updated)) || maintenantGoogle() });
          }
        });
      });
    })).then(function () { if (conflit) { dire2('conflit'); } }, function () { });
  }

  /* Google ne connait que deux etats : achevee ou non.
     - « منجزة » -> completed ;
     - en attente / reportee / urgente -> needsAction (pas achevee) ;
     - « إرجاع » (remise a zero) ne rouvre une tache chez Google QUE si c'est
       ce programme qui l'avait achevee (ombre faitIci) : sinon il oublie
       seulement le statut local. Une tache cochee sur le telephone ne doit
       jamais etre rouverte par un « إرجاع » donne ici.
     On n'ecrit QUE si l'etat change vraiment chez Google : re-cocher une
     tache deja achevee ecrasait sa vraie date d'achevement par « maintenant ». */
  function ecrireStatut(idTache, v, avant) {
    if (!estGtache(idTache)) { return Promise.resolve(false); }
    if (!ecritureCochee()) { return Promise.resolve(false); }   // statut local seulement, voulu
    if (!peutEcrire()) { signalerPermis(); return Promise.resolve(false); }
    return enFile(idTache, function () {
      var idTache0 = idTache; idTache = idActuel(idTache0);   // la tache a pu changer de liste en attendant
      if (!TACHES[idTache]) { return false; }
      var att = ATTENTE[idTache];
      var faitChezGoogle = (att && att.fait !== undefined) ? att.fait : (TACHES[idTache].tache.status === 'completed');
      var veutFait;
      if (v === 'done') { veutFait = true; }
      else if (v === null || v === undefined) {
        if (avant !== 'done' || !(ombres()[idTache] || {}).faitIci) { return false; }
        veutFait = false;
      } else { veutFait = false; }
      if (veutFait === faitChezGoogle) { return false; }
      var champs = veutFait
        ? { status: 'completed', completed: new Date().toISOString() }
        : { status: 'needsAction', completed: null };
      return ecrireDansGoogle(idTache, champs).then(function (r) {
        if (r === true) {
          /* Le choix est desormais date par GOOGLE (sa reponse), pas par
             l'horloge de ce PC. */
          var fr = TACHES[idTache];
          poserOmbre(idTache, { faitIci: veutFait, stAt: (fr && Date.parse(fr.tache.updated)) || maintenantGoogle() });
        } else if (r === 'attente') {
          poserOmbre(idTache, { faitIci: veutFait });
        }
        return r;
      });
    });
  }

  /* Un choix garde contre un changement plus ancien de Google (voir
     trancherStatut) est renvoye, maintenant que l'etat de Google est frais. */
  function renvoyerChoix() {
    var ids = Object.keys(A_RENVOYER); A_RENVOYER = {};
    if (!ids.length || !ecritureCochee() || !peutEcrire()) { return; }
    ids.forEach(function (id) {
      var s = (P.store && P.store.status) ? P.store.status[id] : undefined;
      if (s !== undefined && estGtache(id)) { ecrireStatut(id, s, s); }
    });
  }

  /* Ecriture refusee (case decochee, ou permission disparue) : on le DIT, et
     le texte d'une note n'est jamais perdu — il va dans les notes locales de
     la carte. La carte se redessine ensuite en lecture seule. */
  function refuserModif(idTache, champ, v) {
    if (champ === 'notes') { garderNoteLocale(idTache, v); }
    if (ecritureCochee()) { permisSignale = false; signalerPermis(); }
    else { dire2(champ === 'notes' ? 'ecritureOffNote' : (champ === 'etoile' ? 'ecritureOffEtoile' : 'ecritureOff')); }
    setTimeout(reconstruire, 0);
  }

  /* DEPLACEES[ancien] = nouvel identifiant (tache changee de liste). Un geste
     fait sur l'ancien (champ ouvert pendant le deplacement, file d'attente)
     suit la tache au lieu d'etre jete. */
  var DEPLACEES = {};
  function idActuel(id) {
    var n = 0;
    while (DEPLACEES[id] && n++ < 10) {
      var suite = DEPLACEES[id];
      /* l'ancien identifiant est de nouveau vivant et la cible ne l'est pas :
         la tache est revenue a sa place — la redirection est perimee */
      if (TACHES[id] && !TACHES[suite]) { delete DEPLACEES[id]; break; }
      id = suite;
    }
    return id;
  }
  /* La tache a disparu avant que le geste parte : le texte tape est garde,
     visible, au lieu d'un abandon muet. */
  function perdueGarder(id, a) { garderOrphelin(id, a); }

  /* CE QUI VIENT D'ETRE TAPE (ou choisi) et part vers Google : montre tel
     quel (tacheDe) pendant tout l'envoi — relecture puis ecriture —, jamais
     l'ancien texte qu'un redessin remontrerait entre-temps. */
  var TAPE = {}, TAPE_N = 0;
  function detaper(id, champs, n) {
    if (!TAPE[id]) { id = idActuel(id); }            // la tache a change de liste pendant l'envoi
    var t = TAPE[id]; if (!t) { return; }
    Object.keys(champs).forEach(function (k) { if (t[k] && t[k].n === n) { delete t[k]; } });
    if (!Object.keys(t).length) { delete TAPE[id]; }
    reconstruire();
  }
  function avecTape(id, champs, fabrique) {
    var n = ++TAPE_N, t = TAPE[id] = TAPE[id] || {};
    Object.keys(champs).forEach(function (k) { t[k] = { v: champs[k], n: n }; });
    /* la liste des taches est refaite tout de suite : n'importe quel dessin
       (meme sans relecture) montre deja ce qui vient d'etre tape ou choisi.
       L'etoile se redessine aussitot ; un texte tape, lui, est deja a
       l'ecran (son champ) : pas de redessin qui ferait perdre le focus. */
    if (champs.etoile !== undefined) { reconstruire(); }
    else { try { if (typeof W.buildTasks === 'function') { W.buildTasks(); } } catch (e) { } }
    var p;
    try { p = fabrique(); } catch (e) { detaper(id, champs, n); throw e; }
    return p.then(function (r) { detaper(id, champs, n); return r; }, function (e) { detaper(id, champs, n); throw e; });
  }

  /* RELIRE UNE TACHE juste avant d'ecrire son titre : l'etoile et le nom
     partent de la valeur de GOOGLE, jamais d'une copie vieille de quelques
     minutes (un nom change sur le telephone n'est pas ecrase par un clic
     sur l'etoile ici, une etoile posee la-bas ne tombe pas quand on corrige
     le nom ici). Rend l'entree fraiche ; { deplacee: nouvelId } si la tache a
     change de liste pendant la relecture ; null si elle n'existe plus ;
     rejette si Google n'a pas pu repondre (ou si le compte a change).
     LECTURE : une tache mere ne se deplace pas pendant qu'une de ses filles
     est relue (deplacerVersListe). */
  var LECTURE = {};
  function lireFraiche(cur) {
    var e = TACHES[cur]; if (!e) { return Promise.resolve(null); }
    if (!(AP.gauth && typeof AP.gauth.appel === 'function')) { return Promise.reject(new Error('gauth absent')); }
    var gen = GEN;
    var chemin = '/lists/' + encodeURIComponent(e.liste) + '/tasks/' + encodeURIComponent(e.tache.id);
    LECTURE[cur] = (LECTURE[cur] || 0) + 1;
    function fin() { LECTURE[cur] = (LECTURE[cur] || 1) - 1; if (LECTURE[cur] <= 0) { delete LECTURE[cur]; } }
    return AP.gauth.appel(TASKS_API + chemin, { methode: 'GET', attendre: false }).then(function (frais) {
      fin();
      if (gen !== GEN) { throw new Error('compte change'); }
      var c = TACHES[cur];
      if (!c) { return DEPLACEES[cur] ? { deplacee: idActuel(cur) } : null; }
      if (!frais || !frais.id) { return c; }
      if (frais.deleted) { return null; }
      if (!(c.tache.updated && frais.updated && frais.updated < c.tache.updated)) {
        trancherStatut(cur, c.tache, frais);
        TACHES[cur] = entreeDe(c.liste, frais);
        if (CREEES[cur]) { CREEES[cur].e = TACHES[cur]; }
        ranger();
      }
      return TACHES[cur];
    }, function (err) {
      fin();
      if (gen !== GEN) { throw err; }
      if (DEPLACEES[cur] && !TACHES[cur]) { return { deplacee: idActuel(cur) }; }
      if (err && (err.statut === 404 || err.statut === 410)) { return null; }
      throw err;
    });
  }

  /* Un geste sur le titre qui ATTEND (hors ligne, un nom deja en attente,
     Google injoignable) : ajoute a l'attente avec sa reference (oTitle), que
     viderAttente enverra avec son controle et sa fusion. En ligne, la
     relecture suivante est demandee tout de suite. */
  function titreEnAttente(cur, titre, panne) {
    mettreEnAttente(cur, { title: titre });
    if (panne || !envoiPossible()) { dire2('enAttente'); } else { setTimeout(function () { pull(); }, 0); }
    reconstruire();
    return 'attente';
  }

  function ecrireTitre(idTache, v) {
    var id0 = idTache;
    idTache = idActuel(idTache);
    var tape = String(v == null ? '' : v).trim();
    if (!estGtache(idTache)) { if (id0 !== idTache && sansEtoile(tape)) { perdueGarder(id0, { title: tape }); } return Promise.resolve(false); }
    if (!sansEtoile(tape)) { setTimeout(reconstruire, 0); return Promise.resolve(false); }
    if (!ecritureCochee() || !peutEcrire()) { refuserModif(idTache, 'title', tape); return Promise.resolve(false); }
    return avecTape(idTache, { title: tape }, function () { return enFile(idTache, function () {
      var cur = idActuel(idTache);
      if (!TACHES[cur]) { perdueGarder(idTache, { title: tape }); return false; }
      /* L'etoile suit la tache, pas le champ : une tache etoilee garde ses
         « ⭐ » quand on corrige son nom. Un « ⭐ » tape dans le nom l'allume.
         Reference : ce qui attend encore (le dernier geste d'ici), sinon
         Google tel qu'il est A L'INSTANT. null : rien a ecrire (« ⭐باب »
         tape sur le telephone et « ⭐ باب » sont la meme chose). */
      function calcul(ref) {
        var titre = estEtoile(ref) ? poserEtoile(tape, true, ref) : (estEtoile(tape) ? avecEtoile(tape) : tape);
        return (titre === ref || memeTitre(titre, ref)) ? null : titre;
      }
      var att = ATTENTE[cur];
      if (att && att.title !== undefined) { var ta = calcul(att.title); return ta === null ? false : titreEnAttente(cur, ta); }
      var local = String(TACHES[cur].tache.title || '').trim();
      if (!envoiPossible()) { var t0 = calcul(local); return t0 === null ? false : ecrireDansGoogle(cur, { title: t0 }); }
      return lireFraiche(cur).then(function (e2) {
        if (e2 && e2.deplacee) {
          if (estGtache(e2.deplacee)) { return ecrireTitre(e2.deplacee, tape); }
          garderEnNotes(e2.deplacee, { title: tape }); dire2('ecritureKoNote'); return false;
        }
        if (!e2) { perdueGarder(idTache, { title: tape }); reconstruire(); return false; }
        var t2 = calcul(String(e2.tache.title || '').trim());
        return t2 === null ? false : ecrireDansGoogle(cur, { title: t2 });
      }, function (err) {
        /* compte delie pendant la relecture : le nom tape est garde */
        if (!TACHES[cur]) { if (sansEtoile(tape) !== sansEtoile(local)) { garderEnNotes(idTache, { title: tape }); } return false; }
        /* Google injoignable : le nom attend, la fusion gardera l'etoile de Google */
        if (REESSAYABLES[classerErreur(err)]) { var tr = calcul(local); return tr === null ? false : titreEnAttente(cur, tr, classerErreur(err)); }
        var t3 = calcul(local); return t3 === null ? false : ecrireDansGoogle(cur, { title: t3 });
      });
    }); });
  }

  /* L'ETOILE, par son bouton : allumee = « ⭐ » en tete du nom dans Google
     Tasks, eteinte = le nom sans ce signe. Meme chemin que le nom : la file
     de la tache, l'attente hors ligne, le controle de conflit. veut : true
     (allumer), false (eteindre), absent (inverser). */
  function basculerEtoile(idTache, veut) {
    idTache = idActuel(idTache);
    if (!estGtache(idTache)) { return Promise.resolve(false); }
    if (!ecritureCochee() || !peutEcrire()) { refuserModif(idTache, 'etoile'); return Promise.resolve(false); }
    var a0 = ATTENTE[idTache];
    var vu = (a0 && a0.title !== undefined) ? a0.title : String(TACHES[idTache].tache.title || '');
    var allumer = (veut === undefined) ? !estEtoile(vu) : !!veut;
    return avecTape(idTache, { etoile: allumer }, function () { return enFile(idTache, function () {
      var cur = idActuel(idTache);
      if (!TACHES[cur]) { return false; }
      var att = ATTENTE[cur];
      if ((att && att.title !== undefined) || !envoiPossible()) {
        var t1 = titreEtoile((att && att.title !== undefined) ? att.title : String(TACHES[cur].tache.title || ''), allumer);
        return t1 === null ? false : titreEnAttente(cur, t1);
      }
      /* En ligne : le titre de Google A L'INSTANT, seule l'etoile change.
         (Une tache sans nom se rallume ou s'eteint aussi : '' etait son nom.) */
      return lireFraiche(cur).then(function (e2) {
        if (e2 && e2.deplacee) {
          if (estGtache(e2.deplacee)) { return basculerEtoile(e2.deplacee, allumer); }
          dire2('ecritureKo'); return false;
        }
        if (!e2) { return false; }
        var t2 = titreEtoile(String(e2.tache.title || ''), allumer);
        return t2 === null ? false : ecrireDansGoogle(cur, { title: t2 });
      }, function (err) {
        if (!TACHES[cur]) { return false; }
        if (REESSAYABLES[classerErreur(err)]) {
          var t3 = titreEtoile(String(TACHES[cur].tache.title || ''), allumer);
          return t3 === null ? false : titreEnAttente(cur, t3, classerErreur(err));
        }
        avert('relecture avant l\'etoile : ' + (err && err.message));
        dire2('ecritureKo'); return false;
      });
    }); });
  }

  /* L'ECHEANCE (« التاريخ ») d'une tache Google Tasks : un jour, ou vide pour
     « sans date ». Google ne garde que la DATE — pas d'heure (sa doc : la
     partie horaire est ignoree a l'ecriture). Meme chemin que le titre : la
     file de la tache, l'attente hors ligne, le controle de conflit. */
  function ecrireEcheance(idTache, v) {
    idTache = idActuel(idTache);
    if (!estGtache(idTache)) { return Promise.resolve(false); }
    var jour = String(v == null ? '' : v).trim();
    if (jour && !/^\d{4}-\d{2}-\d{2}$/.test(jour)) { setTimeout(reconstruire, 0); return Promise.resolve(false); }
    /* Une annee en cours de frappe (0002, 0202…) n'est pas une date voulue. */
    if (jour && +jour.slice(0, 4) < 1900) { return Promise.resolve(false); }
    if (!ecritureCochee() || !peutEcrire()) { refuserModif(idTache, 'due', jour); return Promise.resolve(false); }
    return enFile(idTache, function () {
      var cur = idActuel(idTache);
      var e = TACHES[cur];
      if (!e) { perdueGarder(idTache, { due: jour }); return false; }
      var att = ATTENTE[cur];
      var actuel = (att && att.due !== undefined) ? att.due : jourDue(e.tache.due);
      if (jour === actuel) { return false; }
      return ecrireDansGoogle(cur, { due: dueDe(jour) });
    });
  }

  function ecrireNote(idTache, v) {
    var id0 = idTache;
    idTache = idActuel(idTache);
    var note = String(v == null ? '' : v);
    if (!estGtache(idTache)) { if (id0 !== idTache && note.trim()) { perdueGarder(id0, { notes: note }); } return Promise.resolve(false); }
    if (!ecritureCochee() || !peutEcrire()) { refuserModif(idTache, 'notes', note); return Promise.resolve(false); }
    return avecTape(idTache, { notes: note }, function () { return enFile(idTache, function () {
      var cur = idActuel(idTache);
      var e = TACHES[cur];
      if (!e) { perdueGarder(idTache, { notes: note }); return false; }
      /* Note inconnue (copie reduite) : on n'ecrase pas l'inconnu. */
      if (e.sansNotes) { garderNoteLocale(cur, note); dire2('ecritureKoNote'); return false; }
      var att = ATTENTE[cur];
      var actuel = (att && att.notes !== undefined) ? att.notes : String(e.tache.notes || '');
      if (note.trim() === String(actuel).trim()) { return false; }
      return ecrireDansGoogle(cur, { notes: note });
    }); });
  }

  /* CREER UNE TACHE DANS GOOGLE TASKS — le formulaire « إضافة » d'index.html,
     section « مهام Google Tasks ». Les regles de Google Tasks, appliquees
     ICI et non devinees par Google :
       - un titre obligatoire (1024 caracteres au plus) ;
       - une note facultative (8192 au plus) ;
       - une DATE facultative, sans heure : Google Tasks n'en garde pas ;
       - ni repetition, ni lieu, ni invites, ni rappel : Google Tasks ne les
         connait pas par son API ;
       - des sous-taches : chaque ligne devient une VRAIE sous-tache Google
         (parent), dans l'ordre ecrit (previous).
     Un geste de l'artisan, donc : la permission « tasks » est demandee s'il
     le faut, SANS toucher a la case « ecrire les changements » (qui reste son
     choix pour les modifications). Pas de file hors ligne pour une creation :
     rejouee plus tard, elle risquerait de creer deux fois la meme tache —
     on dit plutot que ca n'est pas parti, et le formulaire garde son texte.
     Rend { id, sous: n, sousKo: n } ; rejette une Error dont .code dit
     pourquoi (titre, trop, liste, date, permission, reseau, ou le code de
     classerErreur). */
  var MAX_TITRE = 1024, MAX_NOTES = 8192;
  var CREEES = {};
  function erreurCreation(code, cause) {
    var e = new Error(tr('crea_' + code) || (cause && cause.message) || code);
    e.code = code; if (cause) { e.cause = cause; }
    return e;
  }
  /* Une tache creee ici, remise en memoire si une copie venue d'un autre
     onglet (restaurer) l'a fait disparaitre avant que Google ne la relise. */
  function garderCreees() {
    Object.keys(CREEES).forEach(function (id) {
      var c = CREEES[id];
      if (!c || !c.e || TACHES[id]) { return; }
      /* La copie chargee a lu cette liste APRES la creation (son curseur est
         plus recent) : si la tache n'y est pas, c'est qu'elle a ete supprimee
         — Google fait foi. Liste plus suivie : pareil. */
      var lue = Date.parse(ETAT.curs[c.liste] || '') || 0;
      if (Date.now() - c.t >= 600000 || listesSuivies().indexOf(c.liste) < 0 || (c.tG && lue >= c.tG + 180000)) { delete CREEES[id]; return; }
      TACHES[id] = c.e;
    });
  }
  function creerTache(o) {
    o = o || {};
    var titre = String(o.titre == null ? '' : o.titre).trim();
    var notes = String(o.notes == null ? '' : o.notes).replace(/\s+$/, '');
    var jour = String(o.date == null ? '' : o.date).trim();
    var liste = String(o.liste || '');
    var sous = (Array.isArray(o.sous) ? o.sous : []).map(function (s) { return String(s == null ? '' : s).trim(); })
      .filter(Boolean);
    if (!titre) { return Promise.reject(erreurCreation('titre')); }
    if (titre.length > MAX_TITRE || notes.length > MAX_NOTES || sous.some(function (s) { return s.length > MAX_TITRE; })) {
      return Promise.reject(erreurCreation('trop'));
    }
    if (jour && !/^\d{4}-\d{2}-\d{2}$/.test(jour)) { return Promise.reject(erreurCreation('date')); }
    /* Une liste SUIVIE : sinon la tache partirait dans Google et ne
       reviendrait jamais a l'ecran. */
    if (!liste || listesSuivies().indexOf(liste) < 0) { return Promise.reject(erreurCreation('liste')); }
    if (!(AP.gauth && typeof AP.gauth.appel === 'function')) { return Promise.reject(erreurCreation('permission')); }
    var gen = GEN;
    var permis = peutEcrire() ? Promise.resolve(true)
      : (typeof AP.gauth.demanderTachesEcriture === 'function' ? AP.gauth.demanderTachesEcriture() : Promise.resolve(false));
    return permis.then(function (ok) {
      if (!ok || !peutEcrire()) { throw erreurCreation('permission'); }
      if (!envoiPossible()) {
        var g0 = etatCompte();
        throw erreurCreation((g0 && g0.besoinReconnexion) ? 'sansJeton' : 'reseau');
      }
      if (gen !== GEN) { throw erreurCreation('permission'); }
      var chemin = TASKS_API + '/lists/' + encodeURIComponent(liste) + '/tasks';
      function poster(corps, params) {
        var url = chemin + (params ? '?' + new URLSearchParams(params).toString() : '');
        /* attendre:false : sans jeton, echec tout de suite (message), jamais
           une creation suspendue qui partirait des heures plus tard. */
        return AP.gauth.appel(url, { methode: 'POST', corps: corps, permission: AP.gauth.PERMISSION_EXPLICITE, attendre: false });
      }
      function absorber(frais) {
        if (!frais || !frais.id || gen !== GEN) { return null; }
        if (frais.updated) { var tf = Date.parse(frais.updated); if (tf) { DECALAGE = tf - Date.now(); } }
        var id = idDeTache(liste, frais);
        TACHES[id] = entreeDe(liste, frais);
        CREEES[id] = { liste: liste, t: Date.now(), tG: Date.parse(frais.updated || '') || maintenantGoogle(), e: TACHES[id] };
        return id;
      }
      var corps = { title: titre };
      /* o.parent : l'identifiant GOOGLE de la tache mere (ajouter une
         sous-tache sous une tache existante) ; o.apres : la sous-tache apres
         laquelle la placer (sinon Google la met en tete). */
      var placeMere = null;
      if (o.parent) { placeMere = { parent: String(o.parent) }; if (o.apres) { placeMere.previous = String(o.apres); } }
      if (notes) { corps.notes = notes; }
      if (jour) { corps.due = dueDe(jour); }
      return poster(corps, placeMere).then(function (frais) {
        var id = absorber(frais);
        /* Google a repondu avec la tache, mais le compte a ete delie entre-
           temps : elle EXISTE — ne pas dire « pas creee ». */
        /* Pas de tache lisible dans la reponse (corps perdu, ou compte delie
           entre-temps) : Google l'a PEUT-ETRE creee — jamais « refus ». On
           relit pour la montrer si elle existe. */
        if (!id) {
          if (gen === GEN) { setTimeout(function () { pull({ complet: true }); }, 1500); }
          throw erreurCreation('incertain');
        }
        ranger(); reconstruire();
        /* Les sous-taches, une par une et dans l'ordre : chacune apres la
           precedente (previous), sinon Google les empile a l'envers. */
        var res = { id: id, sous: 0, sousKo: 0, ko: [], incertaines: [] };
        var prec = null, chaine = Promise.resolve();
        sous.forEach(function (s) {
          chaine = chaine.then(function () {
            if (gen !== GEN) { res.sousKo++; res.ko.push(s); return; }
            var p = { parent: frais.id }; if (prec) { p.previous = prec; }
            return poster({ title: s }, p).then(function (f2) {
              if (absorber(f2)) { prec = f2.id; res.sous++; }
              else { res.incertaines.push(s); }      // repondu sans tache lisible : peut-etre creee
            }, function (e) {
              avert('sous-tache : ' + (e && e.message));
              var c = classerErreur(e), avant = e && (e.name === 'AP_SANS_JETON' || e.name === 'AP_REGLE_ECRITURE');
              if (!avant && (c === 'reseau' || c === 'serveur')) { res.incertaines.push(s); }
              else { res.sousKo++; res.ko.push(s); }
            });
          });
        });
        return chaine.then(function () {
          /* Les sous-taches qui n'ont pas pu etre creees ne sont pas perdues :
             leurs titres vont dans les notes de la carte de la tache mere. */
          if (res.ko.length) { garderNoteLocale(id, (langue() === 'fr' ? 'Sous-taches non creees :\n' : 'مهام فرعية لم تُنشأ:\n') + res.ko.join('\n')); }
          /* Parties sans reponse sure : peut-etre creees. On le dit comme tel
             (pas « non creees », qui pousserait a les recreer) et on relit. */
          if (res.incertaines.length) {
            garderNoteLocale(id, (langue() === 'fr' ? 'Sous-taches peut-etre creees (a verifier) :\n' : 'مهام فرعية ربما أُنشئت (تحقّق منها):\n') + res.incertaines.join('\n'));
            setTimeout(function () { pull({ complet: true }); }, 1500);
          }
          ranger(); reconstruire();
          emettre({ creation: true, id: id });
          return res;
        });
      }, function (e) {
        var code = classerErreur(e);
        avert('creation Google Tasks : ' + (e && e.message));
        /* Parti mais sans reponse sure (coupure pendant l'attente, panne
           de Google apres l'envoi) : la tache a PU etre creee. On le dit
           tel quel, et on relit la liste — un nouvel envoi ferait un
           doublon. Un echec AVANT l'envoi (pas de jeton) reste sur. */
        var avantEnvoi = e && (e.name === 'AP_SANS_JETON' || e.name === 'AP_REGLE_ECRITURE');
        if (!avantEnvoi && (code === 'reseau' || code === 'serveur')) {
          setTimeout(function () { pull({ complet: true }); }, 1500);
          throw erreurCreation('incertain', e);
        }
        throw erreurCreation(code === 'autre' ? 'refus' : code, e);
      });
    });
  }

  /* LE ROND DE GOOGLE TASKS : cocher = terminee, decocher = rouverte — dans
     les deux sens, comme dans Google Tasks (ecrireStatut, lui, ne rouvre
     qu'une tache que ce programme avait terminee : il sert les statuts du
     programme, pas ce rond). L'ecran suit alors Google : le statut pose ici
     pour cette tache est retire. */
  function basculerFait(idTache, fait, sansFilles) {
    idTache = idActuel(idTache);
    if (!estGtache(idTache)) { return Promise.resolve(false); }
    if (!ecritureCochee() || !peutEcrire()) { refuserModif(idTache, 'status'); return Promise.resolve(false); }
    /* le statut pose ICI (en attente, reportee…) cede la place a celui de
       Google — mais il est rendu si Google refuse */
    var ancienStatut = (P.store && P.store.status) ? P.store.status[idTache] : undefined;
    if (ancienStatut !== undefined) {
      delete P.store.status[idTache];
      try { if (P.lsSet) { P.lsSet(); } } catch (e) { }
    }
    function rendreStatut() {
      var k = idActuel(idTache);
      if (ancienStatut !== undefined && P.store && P.store.status && P.store.status[k] === undefined) {
        P.store.status[k] = ancienStatut;
        try { if (P.lsSet) { P.lsSet(); } } catch (e) { }
      }
    }
    return enFile(idTache, function () {
      var cur = idActuel(idTache);
      var e = TACHES[cur]; if (!e) { rendreStatut(); return false; }
      var att = ATTENTE[cur];
      var faitG = (att && att.fait !== undefined) ? att.fait : (e.tache.status === 'completed');
      if (faitG === !!fait) { reconstruire(); return false; }
      var champs = fait ? { status: 'completed', completed: new Date().toISOString() } : { status: 'needsAction', completed: null };
      return ecrireDansGoogle(cur, champs).then(function (r) {
        var fr = TACHES[cur];
        if (r === true) { poserOmbre(cur, { faitIci: !!fait, stAt: (fr && Date.parse(fr.tache.updated)) || maintenantGoogle(), faitLe: null }); }
        else if (r === 'attente') { poserOmbre(cur, { faitIci: !!fait }); }
        else if (r === false) { rendreStatut(); }
        /* Google Tasks : terminer une tache termine ses sous-taches */
        if (fait && r !== false && !sansFilles) {
          Object.keys(TACHES).forEach(function (id) {
            var x = TACHES[id];
            if (x.liste === e.liste && x.tache.parent === e.tache.id && x.tache.status !== 'completed') { basculerFait(id, true, true); }
          });
        }
        reconstruire();
        return r;
      });
    });
  }

  /* « Deplacer vers une autre liste » de Google Tasks : la tache (et ses
     sous-taches, que Google emporte avec elle) change de liste CHEZ GOOGLE.
     Son identifiant dans ce programme contient la liste : ce que le
     programme savait d'elle (section, note locale…) suit vers le nouvel
     identifiant. Une modification encore en attente d'envoi : on la laisse
     partir d'abord (refus avec message). */
  function erreurDepl(code, cause) {
    var e = new Error(tr('depl_' + code) || (cause && cause.message) || code);
    e.code = 'depl_' + code; if (cause) { e.cause = cause; }
    return e;
  }
  function fillesDe(e) {
    return Object.keys(TACHES).filter(function (id) { var x = TACHES[id]; return x.liste === e.liste && x.tache.parent === e.tache.id; });
  }
  function deplacerVersListe(idTache, cible) {
    idTache = idActuel(idTache);
    if (!TACHES[idTache]) { return Promise.reject(erreurDepl('disparue')); }
    if (!ecritureCochee() || !peutEcrire()) { refuserModif(idTache, 'status'); return Promise.resolve(false); }
    if (listesSuivies().indexOf(cible) < 0) { return Promise.reject(erreurDepl('liste')); }
    return enFile(idTache, function () {
      /* relu ICI, au moment de partir : un deplacement precedent a pu passer */
      var e = TACHES[idTache];
      if (!e) { throw erreurDepl('disparue'); }
      if (e.liste === cible) { return false; }
      var filles = fillesDe(e);
      if (ATTENTE[idTache] || filles.some(function (id) { return ATTENTE[id] || EN_VOL[id] || LECTURE[id]; })) { throw erreurDepl('attente'); }
      if (!envoiPossible()) { var g0 = etatCompte(); throw erreurDepl((g0 && g0.besoinReconnexion) ? 'sansJeton' : 'reseau'); }
      var gen = GEN, source = e.liste, gid = e.tache.id;
      var url = TASKS_API + '/lists/' + encodeURIComponent(source) + '/tasks/' + encodeURIComponent(gid) +
        '/move?' + new URLSearchParams({ destinationTasklist: cible }).toString();
      /* ce que le programme sait de la mere ET de ses sous-taches passe a leurs
         nouveaux identifiants (Google garde les memes ids de taches) */
      function migrerTout() {
        var neuf = idDeTache(cible, { id: gid });
        filles.forEach(function (fid) {
          var fx = TACHES[fid]; var nf = idDeTache(cible, { id: fx ? fx.tache.id : String(fid).split('|').pop() });
          if (fx && !TACHES[nf]) { TACHES[nf] = entreeDe(cible, Object.assign({}, fx.tache)); }
          if (TAPE[fid]) { TAPE[nf] = TAPE[fid]; delete TAPE[fid]; }
          migrerCles(fid, nf); DEPLACEES[fid] = nf; delete DEPLACEES[nf]; delete CREEES[fid]; delete TACHES[fid];
        });
        if (TAPE[idTache]) { TAPE[neuf] = TAPE[idTache]; delete TAPE[idTache]; }
        migrerCles(idTache, neuf); DEPLACEES[idTache] = neuf; delete DEPLACEES[neuf]; delete CREEES[idTache];
        return neuf;
      }
      EN_VOL[idTache] = (EN_VOL[idTache] || 0) + 1;
      return AP.gauth.appel(url, { methode: 'POST', permission: AP.gauth.PERMISSION_EXPLICITE, attendre: false }).then(function (frais) {
        finVol(idTache);
        delete SAUTEES[idTache];
        if (gen !== GEN) { return false; }
        var t2 = (frais && frais.id) ? frais : Object.assign({}, e.tache);
        var neuf = migrerTout();
        delete TACHES[idTache];
        TACHES[neuf] = entreeDe(cible, t2);
        delete ETAT.curs[source]; delete ETAT.curs[cible];
        ranger(); reconstruire();
        setTimeout(function () { pull({ complet: true }); }, 600);
        return neuf;
      }, function (err) {
        finVol(idTache);
        if (gen === GEN && SAUTEES[idTache]) { delete ETAT.curs[SAUTEES[idTache]]; delete SAUTEES[idTache]; ranger(); }
        var code = classerErreur(err);
        avert('deplacement Google Tasks : ' + (err && err.message));
        var avantEnvoi = err && (err.name === 'AP_SANS_JETON' || err.name === 'AP_REGLE_ECRITURE');
        if (!avantEnvoi && (code === 'reseau' || code === 'serveur')) {
          /* parti sans reponse sure : Google l'a PEUT-ETRE deplacee. On relit
             tout ; si elle est bien dans la liste d'arrivee, ce que le
             programme savait d'elle la suit. */
          setTimeout(function () {
            delete ETAT.curs[source]; delete ETAT.curs[cible];
            pull({ complet: true }).then(function () {
              if (gen !== GEN) { return; }
              var neuf = idDeTache(cible, { id: gid });
              if (TACHES[neuf] && !TACHES[idTache]) { migrerTout(); ranger(); reconstruire(); }
            });
          }, 1500);
          throw erreurDepl('incertain', err);
        }
        throw erreurDepl(code === 'autre' ? 'refus' : code, err);
      });
    });
  }
  /* Ce que le programme sait d'une tache, range sous son identifiant : suit
     la tache quand son identifiant change (changement de liste). */
  function migrerCles(ancien, neuf) {
    var st = P.store;
    if (st) {
      ['status', 'notes', 'checks', 'cat', 'subOf', 'titleOf', 'contact', 'place'].forEach(function (k) {
        if (st[k] && st[k][ancien] !== undefined) { st[k][neuf] = st[k][ancien]; delete st[k][ancien]; }
      });
      try { if (P.lsSet) { P.lsSet(); } } catch (e) { }
    }
    var o = ombres();
    if (o[ancien]) { poserOmbre(neuf, o[ancien]); }
    if (CREEES[ancien]) { delete CREEES[ancien]; }
  }

  /* La case « ecrire dans Google Tasks » decochee : ce qui attendait ne
     partira pas (il ne doit jamais partir des semaines plus tard, par-dessus
     des changements faits entre temps sur le telephone). Les notes sont
     gardees dans les notes locales. Rend le nombre d'entrees abandonnees. */
  function couperEcriture() {
    var d = jget(K.attente, {}) || {};
    var n = Object.keys(d).length;
    Object.keys(d).forEach(function (id) { garderEnNotes(id, d[id]); });
    ATTENTE = {}; jset(K.attente, {});
    poserReglages({ ecrireVersGoogle: false });
    if (n) { dire2('attenteCoupee'); }
    reconstruire();
    return n;
  }

  /* Le geste « cocher termine » (setStatus() dans index.html) n'a, lui non
     plus, aucun crochet natif vers ce fichier : on l'enveloppe, exactement
     comme raccrocherMoveCat() le fait deja pour moveCat(). estGtache() rend
     cet appel sans effet pour toute tache qui ne vient pas de Google Tasks.
     Il note aussi, dans l'ombre de la tache :
       stAt   quand l'artisan a pose ce statut, sur l'heure de Google (voir
              trancherStatut) ;
       faitLe le jour ou une tache SANS DATE a ete marquee « منجزة » ici —
              efface a toute reouverture, et jamais reutilise apres elle. */
  function raccrocherStatut() {
    if (typeof W.setStatus !== 'function' || W.setStatus.__apgt) { return; }
    var orig = W.setStatus;
    var neuf = function () {
      var id = arguments[0], v = arguments[1];
      var avant = (P.store && P.store.status) ? P.store.status[id] : undefined;
      var r = orig.apply(this, arguments);
      try {
        if (estGtache(id)) {
          var patch = { stAt: (v === null || v === undefined) ? 0 : maintenantGoogle() };
          var e = TACHES[id];
          if (!e.jour) {
            if (v !== 'done') { patch.faitLe = null; }
            else if (e.tache.status !== 'completed') {
              var ofl = (ombres()[id] || {}).faitLe;
              patch.faitLe = (avant === 'done' && ofl) ? ofl : jourLocal(new Date());
            }
          }
          poserOmbre(id, patch);
          if ('faitLe' in patch) { reconstruire(); }
          ecrireStatut(id, v, avant);
        }
      } catch (err) { avert('setStatus : ' + err.message); }
      return r;
    };
    neuf.__apgt = true;
    W.setStatus = neuf;
  }

  /* Le retour de la connexion (ou du jeton) relance une lecture, qui envoie
     ensuite ce qui attendait — sans attendre la relecture des cinq minutes. */
  var ecouteRetour = false;
  function ecouterRetour() {
    if (ecouteRetour) { return; }
    ecouteRetour = true;
    try {
      W.addEventListener('online', function () { if (Object.keys(ATTENTE).length) { pull(); } });
      if (AP.gauth && typeof AP.gauth.onChange === 'function') {
        AP.gauth.onChange(function (g) {
          if (g && g.connecte && !g.besoinReconnexion && Object.keys(ATTENTE).length) { pull(); }
        });
      }
    } catch (e) { }
  }


  /* =========================================================================
     PARTIE 11 — L'API PUBLIQUE
     ========================================================================= */

  AP.gtasks = {
    bind: bind,
    chargerListes: chargerListes,
    listes: listes,
    listesSuivies: listesSuivies,
    suivre: suivre,
    setSection: setSection,
    setSousCat: setSousCat,
    pull: pull,
    reveiller: reveiller,
    envelopper: envelopper,
    tasks: tasks,
    deconnecter: deconnecter,
    reglages: reglages,
    poserReglages: poserReglages,
    info: info,
    tr: tr,
    on: on,
    demanderEcriture: demanderEcriture,
    couperEcriture: couperEcriture,
    ecrireStatut: ecrireStatut,
    ecrireTitre: ecrireTitre,
    basculerEtoile: basculerEtoile,
    estEtoile: estEtoile,
    sansEtoile: sansEtoile,
    ecrireNote: ecrireNote,
    ecrireEcheance: ecrireEcheance,
    basculerFait: basculerFait,
    idActuel: idActuel,
    deplacerVersListe: deplacerVersListe,
    creerTache: creerTache,
    listesSuivies: listesSuivies,
    _: { tacheDe: tacheDe, taches: function () { return TACHES; } }
  };

})();
