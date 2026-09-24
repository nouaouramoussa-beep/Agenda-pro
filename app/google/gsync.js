/* ============================================================================
   AGENDA PRO — app/google/gsync.js
   LE MOTEUR DE SYNCHRONISATION GOOGLE.
   ============================================================================

   ##########################################################################
   #  REGLE DE SECURITE ABSOLUE — ELLE PASSE AVANT TOUT LE RESTE.           #
   #                                                                        #
   #  Cet agenda est le VRAI agenda de l'artisan. Ce programme n'ecrit       #
   #  JAMAIS dans summary (le titre), description, start, end, attendees,    #
   #  recurrence, location, reminders ni status d'un evenement qui existe    #
   #  deja. Il n'ecrit QUE dans extendedProperties.private — une zone        #
   #  invisible dans l'application Google Agenda.                            #
   #                                                                        #
   #  DEUX EXCEPTIONS, ET DEUX SEULEMENT :                                   #
   #    1. une tache que l'artisan cree lui-meme depuis le programme ;       #
   #    2. une modification qu'il demande explicitement, sur une tache qui   #
   #       vient du programme.                                               #
   #  Tout le reste est en LECTURE SEULE.                                    #
   #                                                                        #
   #  CETTE REGLE N'EST PAS QU'UN COMMENTAIRE. Elle est appliquee par        #
   #  corpsSur() (section 3), le seul passage par lequel un corps de requete #
   #  peut sortir d'ici. Tout champ non autorise est RETIRE avant l'envoi et #
   #  inscrit au journal. Si un jour quelqu'un ajoute une ligne qui essaie   #
   #  d'ecrire un titre, ce n'est pas un commentaire qui l'arretera : c'est  #
   #  corpsSur().                                                            #
   ##########################################################################

   A QUOI SERT CE FICHIER
   ----------------------
   Google Agenda sait deja faire voyager les EVENEMENTS entre l'ordinateur de
   bureau et le telephone. Ce qu'il ne sait pas faire, c'est transporter ce que
   l'artisan ajoute par-dessus : le statut (fait / en attente / en retard /
   reporte), la check-list de documents cochee, les notes, le contact, le lieu,
   la sous-categorie, la section. Ces choses-la n'existent pas dans un agenda.

   La solution retenue : les ranger DANS L'EVENEMENT LUI-MEME, dans
   extendedProperties.private. C'est un petit casier prive attache a chaque
   evenement, que l'application Google Agenda n'affiche nulle part, et que
   Google recopie tout seul entre tous les appareils. Gratuitement, sans
   serveur, sans compte a gerer.

   Resultat : c'est GOOGLE qui devient la source de verite. Le bureau et le
   telephone lisent et ecrivent au meme endroit. Le localStorage ne sert plus
   que de copie locale, pour que tout reste lisible hors ligne.

   CE FICHIER NE TOUCHE PAS A LA COUCHE SUPABASE
   ---------------------------------------------
   app/auth, app/sync et app/billing restent en place, intacts, en sommeil.
   Le jour ou le quota Supabase sera regle, l'autre synchronisation reviendra
   A COTE de celle-ci, pas a sa place : les deux se branchent sur la meme
   petite interface (section 15, AP.moteurs). Rien ne sera a reecrire.

   COMMENT ON S'EN SERT (trois lignes, dans index.html)
   ----------------------------------------------------
       <script src="app/google/gsync.js"></script>      <!-- apres sync.js -->
       AP.gsync.bind({ store:store, state:state, lsSet:lsSet,
                       buildTasks:buildTasks, render:render, toast:toast,
                       TASKS:function(){return TASKS;}, SUBS:SUBS });
       AP.gsync.init();

   Et, pour que les evenements Google apparaissent dans la liste, UNE ligne a
   ajouter dans buildTasks() de index.html, juste avant le tri final :

       if (window.AP && AP.gsync) out.push.apply(out, AP.gsync.tasks());

   Tant que cette ligne n'est pas la, le moteur se debrouille seul : il
   enveloppe window.buildTasks et remet ses taches dans la liste apres coup
   (section 16). Ca marche, mais la ligne est plus propre et plus rapide.

   CE QUE LE MOTEUR PUBLIE
   -----------------------
     AP.gsync.init()                demarre (n'ecrit RIEN dans l'agenda)
     AP.gsync.bind(pont)            relie le moteur aux variables de index.html
     AP.gsync.connecter()           ouvre la fenetre d'autorisation Google
     AP.gsync.deconnecter()         oublie le jeton, garde la copie locale
     AP.gsync.agendas()             la liste des agendas du compte
     AP.gsync.suivre(id, oui)       suivre / ne plus suivre un agenda
     AP.gsync.pull()                relit les changements (LECTURE SEULE)
     AP.gsync.tasks()               les taches Google, forme de index.html
     AP.gsync.setStatus/... etc.    les ecritures, sur action de l'artisan
     AP.gsync.creerTache(...)       cree un vrai evenement (exception n°1)
     AP.gsync.modifierTache(...)    modifie un evenement (exception n°2)
     AP.gsync.file()                ce qui attend le retour du reseau
     AP.gsync.journal()             conflits, refus d'ecriture, notes trop
                                    longues — lisible par un humain
     AP.gsync.info()                etat courant, pour l'ecran de reglages
     AP.gsync.setTokenProvider(fn)  pour fournir le jeton autrement (bureau)

   STYLE : JavaScript de navigateur, sans build, sans framework, sans npm.
   Les commentaires sont en francais et s'adressent a quelqu'un qui n'est pas
   developpeur. Tout ce qui s'affiche existe en arabe ET en francais.
   ============================================================================ */

(function () {
  'use strict';

  var AP = (window.AP = window.AP || {});
  var CFG = window.AP_CONFIG || {};

  /* ==========================================================================
     0. LES CONSTANTES ET LES REGLAGES
     ========================================================================== */

  var VERSION = '1.0.0';

  /* Les tiroirs du localStorage. Prefixe « agendapro_g_ » pour ne JAMAIS
     entrer en collision avec ceux de la couche Supabase (« agendapro_sync_ »)
     ni avec ceux du tableau de bord (« agendapro_v1 »). */
  var K = {
    cfg:     'agendapro_g_reglages_v1',   // agendas suivis, fenetre, defauts
    jetons:  'agendapro_g_curseurs_v1',   // un syncToken par agenda
    evs:     'agendapro_g_evenements_v1', // LA RESERVE : les evenements deja lus
    ombre:   'agendapro_g_ombre_v1',      // dernier etat connu + horodatages
    file:    'agendapro_g_file_v1',       // la file d'attente hors ligne
    journal: 'agendapro_g_journal_v1',    // conflits, refus, avertissements
    classement: 'agendapro_g_classement_v1' // section / sous-categorie / routine par serie, venus du bureau
  };

  /* LES PERMISSIONS DEMANDEES A GOOGLE — le strict minimum, pas une de plus.
       calendar.readonly  : pour voir la liste des agendas du compte.
       calendar.events    : pour lire les evenements ET ecrire dans leur
                            casier prive. Google ne propose pas de permission
                            plus etroite ; c'est corpsSur() qui fait le travail
                            de restriction, du cote du programme.
       drive.appdata      : le dossier invisible ou vont les reglages qui
                            n'appartiennent a aucun evenement (section 13).
                            Facultative : si l'artisan la refuse, les reglages
                            restent sur l'appareil et le moteur le dit. */
  var PERM_BASE  = 'https://www.googleapis.com/auth/calendar.readonly ' +
                   'https://www.googleapis.com/auth/calendar.events';
  var PERM_DRIVE = 'https://www.googleapis.com/auth/drive.appdata';

  var API      = 'https://www.googleapis.com/calendar/v3';
  var DRIVE    = 'https://www.googleapis.com/drive/v3';
  var DRIVE_UP = 'https://www.googleapis.com/upload/drive/v3';
  var GIS_SRC  = 'https://accounts.google.com/gsi/client';

  /* LE NOM DU CASIER dans extendedProperties.private.
     Court volontairement : le nom d'une cle compte dans le plafond de Google
     (44 caracteres maximum par cle), et il y en a potentiellement 17. */
  var CLE = 'ap';

  /* LES LIMITES REELLES DE GOOGLE, ET LA MARGE QU'ON SE GARDE.
     Google annonce : 1024 caracteres par valeur, 44 par cle, 300 proprietes
     au maximum, et un total d'environ 32 Ko par evenement.
     On mesure en OCTETS et pas en caracteres, parce qu'une lettre arabe ou un
     emoji pese 2 a 4 octets : compter les caracteres ferait passer un texte
     arabe pour deux fois plus court qu'il ne l'est, et Google refuserait.
     On s'arrete a 900 octets par morceau : la marge absorbe les surprises
     d'encodage sans jamais frôler le mur. */
  var MAX_OCTETS   = 900;
  var MAX_MORCEAUX = 16;          // 16 x 900 = ~14 Ko, large sous les 32 Ko

  /* La fenetre de temps regardee par defaut : 90 jours en arriere (pour que
     les retards restent visibles, comme dans le tableau de bord) et 400 jours
     en avant (un peu plus d'un an). Reglable. */
  var DEFAUTS = {
    joursPasses:  90,
    joursFuturs:  400,
    agendas:      {},        // { idAgenda: { suivi:1, sec:'ent', sub:'perso' } }
    agendaEcrit:  'primary', // ou vont les taches creees depuis le programme
    refaireApres: 7          // jours : au-dela, on refait une lecture complete
  };

  /* ==========================================================================
     1. LES PETITS OUTILS
     ========================================================================== */

  function jget(cle, repli) {
    try {
      var r = localStorage.getItem(cle);
      if (r == null) return repli;
      var v = JSON.parse(r);
      return (v == null) ? repli : v;
    } catch (e) { return repli; }
  }
  function jset(cle, valeur) {
    try { localStorage.setItem(cle, JSON.stringify(valeur)); return true; }
    catch (e) { avert('ecriture locale impossible (' + cle + ') : ' + e.message); return false; }
  }

  function avert(m) { try { console.warn('[AP.gsync] ' + m); } catch (e) {} }
  function dire(m)  { try { console.info('[AP.gsync] ' + m); } catch (e) {} }

  /* La langue en cours. On la prend au pont si index.html nous l'a tendu,
     sinon on se rabat sur l'arabe, qui est la langue par defaut du produit. */
  function langue() {
    try { if (P.state && P.state.lang) return P.state.lang === 'fr' ? 'fr' : 'ar'; } catch (e) {}
    return 'ar';
  }

  /* TOUS LES TEXTES VISIBLES, EN ARABE ET EN FRANCAIS. Aucun texte affiche
     n'est ecrit ailleurs que dans cette table. */
  var TXT = {
    pasConfigure:  { ar: 'لم يتم إدخال معرّف Google بعد.', fr: "L'identifiant Google n'est pas encore renseigné." },
    connexion:     { ar: 'جارٍ الاتصال بـ Google…', fr: 'Connexion à Google…' },
    connecte:      { ar: 'تم الربط مع Google ✅', fr: 'Google est relié ✅' },
    refuse:        { ar: 'تم رفض الإذن من Google.', fr: "L'autorisation Google a été refusée." },
    deconnecte:    { ar: 'تم قطع الربط مع Google.', fr: 'Le lien avec Google est coupé.' },
    lecture:       { ar: 'جارٍ قراءة الأجندة…', fr: "Lecture de l'agenda…" },
    lu:            { ar: 'تمت قراءة الأجندة ✅', fr: 'Agenda lu ✅' },
    horsLigne:     { ar: 'لا يوجد اتصال — سيتم الإرسال لاحقاً.', fr: 'Pas de réseau — ce sera envoyé plus tard.' },
    envoye:        { ar: 'تم الحفظ في الأجندة ✅', fr: "Enregistré dans l'agenda ✅" },
    fileVidee:     { ar: 'تم إرسال كل التعديلات المؤجَّلة ✅', fr: 'Toutes les modifications en attente sont parties ✅' },
    tropLong:      { ar: 'الملاحظة طويلة جداً لتُحفظ في الأجندة. لم يُحذف أي شيء: بقيت على هذا الجهاز. اختصرها قليلاً.',
                     fr: "La note est trop longue pour tenir dans l'agenda. Rien n'est perdu : elle reste sur cet appareil. Raccourcissez-la un peu." },
    conflit:       { ar: 'تم دمج تعديلٍ قادم من جهاز آخر.', fr: "Une modification venue d'un autre appareil a été fusionnée." },
    aRenvoyer:     { ar: 'توجد تعديلات محلية أحدث لم تُرسَل بعد.', fr: "Des modifications locales plus récentes n'ont pas encore été envoyées." },
    reglagesLocaux:{ ar: 'إذن Drive غير ممنوح: الإعدادات محفوظة على هذا الجهاز فقط.',
                     fr: "Permission Drive non accordée : les réglages restent sur cet appareil seulement." },
    refusEcriture: { ar: 'مُنع تعديل غير مسموح به على الأجندة.', fr: "Une écriture non autorisée dans l'agenda a été bloquée." },
    reSync:        { ar: 'انتهت صلاحية المؤشّر — جارٍ إعادة القراءة كاملة.', fr: 'Le repère a expiré — relecture complète en cours.' },
    quota:         { ar: 'Google يطلب التمهّل — سنعيد المحاولة بعد قليل.', fr: 'Google demande de ralentir — nouvelle tentative dans un instant.' }
  };
  function tr(cle) {
    var e = TXT[cle];
    if (!e) return cle;
    return e[langue()] || e.fr || e.ar;
  }
  /* Un message a l'artisan : par le toast du tableau de bord si le pont
     existe, sinon dans la console. Jamais d'alert(), qui bloque tout. */
  function say(cle) {
    var m = tr(cle);
    try { if (P.toast) { P.toast(m); return; } } catch (e) {}
    dire(m);
  }

  /* Une empreinte courte et stable d'un texte (algorithme FNV-1a, 32 bits).
     Elle sert de cle compacte pour les horodatages de la check-list : un
     libelle comme « piece administrative n° 3 » devient « 1k4p9z », sept fois plus
     court. Sur une liste de quelques dizaines de lignes, deux libelles
     differents qui tomberaient sur la meme empreinte, c'est une chance sur
     plusieurs millions : le risque est negligeable, et la consequence serait
     une case cochee au mauvais endroit, pas une perte de donnees. */
  function h32(s) {
    var x = 2166136261; s = String(s == null ? '' : s);
    for (var i = 0; i < s.length; i++) { x ^= s.charCodeAt(i); x = (x * 16777619) >>> 0; }
    return x.toString(36);
  }

  /* Le poids reel d'un texte une fois encode par le reseau. */
  function octets(s) {
    s = String(s == null ? '' : s);
    try { return new TextEncoder().encode(s).length; } catch (e) {}
    try { return unescape(encodeURIComponent(s)).length; } catch (e) {}
    return s.length * 3;   // pire des cas, on surestime : on ne depassera pas
  }

  /* L'HEURE. Deux appareils n'ont jamais exactement la meme heure, et c'est
     l'heure qui decide qui gagne en cas de conflit. On corrige donc la notre
     avec celle que Google renvoie dans l'en-tete « Date » de chaque reponse.
     Sans cette correction, un telephone en avance de trois minutes gagnerait
     tous les conflits, meme quand c'est le bureau qui a raison. */
  var ECART = 0;
  function noterHeure(enTeteDate) {
    if (!enTeteDate) return;
    var t = Date.parse(enTeteDate);
    if (!isNaN(t)) ECART = t - Date.now();
  }
  function maintenant() { return Date.now() + ECART; }

  var pad = function (n) { return String(n).padStart(2, '0'); };

  /* Une date Google (« 2026-09-29 » ou « 2026-09-29T08:00:00+01:00 ») devient
     la paire que index.html attend : une date « AAAA-MM-JJ » et une heure
     « HH:MM », toutes deux dans le fuseau de l'appareil. */
  function jourDe(g) {
    if (!g) return null;
    if (g.date) return g.date;                       // evenement « toute la journee »
    if (!g.dateTime) return null;
    var d = new Date(g.dateTime);
    if (isNaN(d.getTime())) return null;
    return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate());
  }
  function heureDe(g) {
    if (!g || !g.dateTime) return '';
    var d = new Date(g.dateTime);
    if (isNaN(d.getTime())) return '';
    return pad(d.getHours()) + ':' + pad(d.getMinutes());
  }
  function isoJour(d) { return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate()); }
  function plusJours(d, n) { var x = new Date(d); x.setDate(x.getDate() + n); return x; }

  function pause(ms) { return new Promise(function (r) { setTimeout(r, ms); }); }
  function egal(a, b) {
    if (a === b) return true;
    if (a == null && b == null) return true;
    if (a == null || b == null) return false;
    if (typeof a === 'object' || typeof b === 'object') {
      try { return JSON.stringify(a) === JSON.stringify(b); } catch (e) { return false; }
    }
    return String(a) === String(b);
  }

  /* Le journal : conflits fusionnes, ecritures refusees, notes trop longues.
     Il est fait pour etre LU par un humain dans l'ecran de reglages, pas pour
     etre analyse par une machine. On garde les 200 dernieres lignes. */
  function noter(genre, texte, extra) {
    var j = jget(K.journal, []);
    if (!Array.isArray(j)) j = [];
    j.push({ q: new Date(maintenant()).toISOString(), g: genre, t: String(texte || ''), x: extra || null });
    if (j.length > 200) j = j.slice(-200);
    jset(K.journal, j);
    emettre('journal', { genre: genre, texte: texte });
  }

  /* Un tout petit systeme d'abonnements, pour que l'ecran de reglages puisse
     suivre ce qui se passe sans interroger le moteur en boucle. */
  var abonnes = {};
  function on(evt, fn)  { (abonnes[evt] = abonnes[evt] || []).push(fn); return function () { off(evt, fn); }; }
  function off(evt, fn) { var a = abonnes[evt] || []; var i = a.indexOf(fn); if (i >= 0) a.splice(i, 1); }
  function emettre(evt, d) {
    (abonnes[evt] || []).forEach(function (f) { try { f(d); } catch (e) { avert('abonne ' + evt + ' : ' + e.message); } });
    (abonnes['*']  || []).forEach(function (f) { try { f(evt, d); } catch (e) {} });
  }

  /* ==========================================================================
     2. LE PONT VERS index.html
     --------------------------------------------------------------------------
     Dans index.html, `store`, `state`, `TASKS` et `SUBS` sont declares avec
     let/const au premier niveau d'un <script>. Contrairement a `var`, ces
     declarations-la n'existent PAS sur window : aucun fichier separe ne peut
     les atteindre. index.html doit donc nous les tendre une fois, exactement
     comme il le fait deja pour AP.sync. C'est la meme forme de pont, volontai-
     rement : un seul objet peut etre passe aux deux moteurs.

     Sans pont, le moteur continue de fonctionner (lecture, file d'attente,
     ecritures) mais ne peut plus rafraichir l'affichage. C'est une degradation,
     jamais une panne.
     ========================================================================== */

  var P = {
    store: null, state: null, lsSet: null, buildTasks: null,
    render: null, toast: null, TASKS: null, SUBS: null, rebuildBoards: null
  };

  function bind(pont) {
    pont = pont || {};
    ['store', 'state', 'lsSet', 'buildTasks', 'render', 'toast', 'TASKS', 'SUBS', 'rebuildBoards']
      .forEach(function (k) { if (pont[k] !== undefined) P[k] = pont[k]; });
    emettre('pont', {});
    return AP.gsync;
  }
  function sauverLocal() { try { if (P.lsSet) P.lsSet(); } catch (e) {} }
  function repeindre() {
    try { if (P.render) P.render(); } catch (e) { avert('render : ' + e.message); }
  }

  /* ==========================================================================
     3. LE GARDE-FOU D'ECRITURE — LE COEUR DE LA REGLE DE SECURITE
     --------------------------------------------------------------------------
     RIEN ne part vers Google sans passer par ici. Un corps de requete arrive,
     un corps NETTOYE en ressort. Ce qui n'est pas explicitement autorise est
     retire, et le retrait est inscrit au journal — on ne fait pas semblant que
     tout s'est bien passe.

     Par defaut, un seul champ est autorise : extendedProperties. C'est le
     casier prive. Le titre, la description, les horaires, les invites, la
     recurrence, le lieu, les rappels de l'artisan ne peuvent PAS sortir d'ici.

     Les deux exceptions de la regle passent par `permis`, une liste de champs
     que l'appelant autorise NOMMEMENT, et seulement depuis creerTache() et
     modifierTache(). Aucune autre fonction du fichier ne remplit `permis`.
     ========================================================================== */

  var CHAMPS_LIBRES = ['extendedProperties'];

  function corpsSur(corps, permis) {
    var sortie = {}, refuses = [];
    Object.keys(corps || {}).forEach(function (k) {
      if (CHAMPS_LIBRES.indexOf(k) >= 0) { sortie[k] = corps[k]; return; }
      if (permis && permis.indexOf(k) >= 0) { sortie[k] = corps[k]; return; }
      refuses.push(k);
    });
    if (refuses.length) {
      noter('refus', 'champs retires avant envoi : ' + refuses.join(', '), { permis: permis || [] });
      avert('REGLE DE SECURITE — champs retires avant envoi : ' + refuses.join(', '));
      say('refusEcriture');
    }
    return sortie;
  }

  /* Deuxieme verrou, pour le point 7 du cahier des charges : « rien n'est
     ecrit dans l'agenda tant que l'artisan n'a pas agi ». Toute ecriture porte
     une origine. Si cette origine n'est pas « artisan », l'envoi est refuse,
     meme si le corps est parfaitement propre. Une simple ouverture du
     programme ne peut donc RIEN modifier : aucune fonction de lecture ne
     fabrique d'entree d'origine « artisan ». */
  function origineValide(entree) {
    if (!entree || entree.par !== 'artisan') {
      noter('refus', 'ecriture sans action de l\'artisan — bloquee', entree || null);
      avert('REGLE DE SECURITE — ecriture refusee : elle ne vient pas d\'une action de l\'artisan.');
      return false;
    }
    return true;
  }

  /* ==========================================================================
     4. LE JETON GOOGLE
     --------------------------------------------------------------------------
     Un jeton d'acces est un laissez-passer valable environ une heure. Il n'est
     JAMAIS range dans le localStorage : un jeton ecrit sur le disque est un
     jeton qu'un autre programme peut lire. Il vit en memoire, et disparait
     quand on ferme la page. Google sait le redonner sans rien demander a
     l'artisan tant que l'autorisation reste accordee.

     DEUX FACONS DE L'OBTENIR :
     1) LA VOIE NORMALE (navigateur, telephone, PWA) : la petite librairie
        officielle de Google, « Google Identity Services ». Elle ouvre la
        fenetre d'autorisation, puis rend le jeton. Aucun secret n'est stocke
        dans la page — c'est exactement pour ce cas qu'elle existe.
     2) LA VOIE INJECTEE : AP.gsync.setTokenProvider(fn). La version bureau
        (Electron) charge la page depuis http://127.0.0.1 sur un port tire au
        hasard a chaque demarrage. Or Google exige que l'adresse d'origine soit
        inscrite a l'avance, port compris : la voie normale ne peut donc pas
        marcher telle quelle dans la fenetre du programme installe. Le
        programme de bureau fera l'autorisation de son cote (boucle locale +
        PKCE, ou port fixe) et nous passera le jeton par cette porte. Le moteur
        n'a pas a savoir d'ou vient le jeton — c'est tout l'interet.
     ========================================================================== */

  var JETON = { valeur: null, finit: 0, permsDrive: false, refuse: null };
  var fournisseur = null;   // fn({interactif, permissions, refuse}) -> {token, expires_in}

  function setTokenProvider(fn) {
    fournisseur = (typeof fn === 'function') ? fn : null;
    dire('fournisseur de jeton ' + (fournisseur ? 'installe' : 'retire'));
    return AP.gsync;
  }

  function clientId() {
    return (CFG.googleClientId || jget(K.cfg, {}).clientId || '').trim();
  }

  var gisPret = null;
  function chargerGIS() {
    if (gisPret) return gisPret;
    gisPret = new Promise(function (ok, non) {
      if (window.google && window.google.accounts && window.google.accounts.oauth2) return ok();
      var s = document.createElement('script');
      s.src = GIS_SRC; s.async = true; s.defer = true;
      s.onload = function () { ok(); };
      s.onerror = function () { non(new Error('la librairie Google n\'a pas pu etre chargee')); };
      document.head.appendChild(s);
    });
    return gisPret;
  }

  /* La voie normale. `interactif` a true ouvre la fenetre d'autorisation ;
     a false, Google renouvelle en silence si c'est possible et echoue sinon. */
  function fournisseurGIS(opts) {
    var id = clientId();
    if (!id) return Promise.reject(new Error(tr('pasConfigure')));
    return chargerGIS().then(function () {
      return new Promise(function (ok, non) {
        var client = window.google.accounts.oauth2.initTokenClient({
          client_id: id,
          scope: opts.permissions,
          callback: function (r) {
            if (r && r.access_token) ok({ token: r.access_token, expires_in: r.expires_in || 3600, scope: r.scope || '' });
            else non(new Error((r && r.error) || 'jeton non obtenu'));
          },
          error_callback: function (e) { non(new Error((e && e.type) || 'autorisation interrompue')); }
        });
        client.requestAccessToken({ prompt: opts.interactif ? 'consent' : '' });
      });
    });
  }

  function jetonValide(opts) {
    opts = opts || {};
    var marge = 60000;   // on renouvelle une minute avant l'echeance
    if (JETON.valeur && JETON.finit - marge > Date.now() && !opts.force) {
      return Promise.resolve(JETON.valeur);
    }
    var perms = PERM_BASE + (opts.avecDrive || reglages().driveOk ? ' ' + PERM_DRIVE : '');
    var f = fournisseur || fournisseurGIS;

    /* LE JETON QUE GOOGLE VIENT DE REFUSER, RENVOYE A SON PROPRIETAIRE.
       C'est la seule facon pour le detenteur du jeton d'apprendre qu'il est
       mort AVANT son heure — un acces revoque depuis le compte Google, un mot
       de passe change. Son horloge, elle, le croyait encore bon pour une
       heure : sans cette ligne il nous rendait exactement le meme jeton mort,
       et les deux tentatives echouaient de la meme facon. */
    var mort = JETON.refuse; JETON.refuse = null;

    return Promise.resolve(f({
      interactif: !!opts.interactif, permissions: perms, refuse: mort || undefined
    })).then(function (r) {
      if (!r || !r.token) throw new Error('jeton vide');
      JETON.valeur = r.token;
      JETON.finit  = Date.now() + ((r.expires_in || 3600) * 1000);
      JETON.permsDrive = String(r.scope || '').indexOf('drive.appdata') >= 0;
      emettre('jeton', { ok: true, drive: JETON.permsDrive });
      return JETON.valeur;
    }, function (e) {
      /* PAS DE JETON : CE N'EST PAS LA FAUTE DE CE QU'ON VOULAIT ENVOYER.
         On marque l'erreur pour que la file d'attente le sache : elle ne doit
         ni compter un essai, ni jeter l'entree, ni la rejouer en double. */
      var err = (e instanceof Error) ? e : new Error(String(e && e.message || e || 'jeton refuse'));
      err.jeton = true;
      emettre('jeton', { ok: false });
      throw err;
    });
  }
  function oublierJeton() { JETON.valeur = null; JETON.finit = 0; }

  /* GOOGLE RANGE DEUX CHOSES TRES DIFFERENTES SOUS LE MEME 403 : « tu vas trop
     vite » — on attend et on recommence — et « ton jeton ne vaut plus rien » —
     attendre n'y changera jamais rien. Les confondre, c'est faire cinq essais
     inutiles puis abandonner en silence. On les separe donc ici, sur la raison
     que Google donne lui-meme dans le corps de la reponse. */
  function refusAuth(statut, data) {
    if (statut === 401) return true;
    if (statut !== 403) return false;
    var err = (data && data.error) || {};
    var raisons = [];
    (err.errors || []).forEach(function (x) { raisons.push(String(x && x.reason || '')); });
    var t = (raisons.join(' ') + ' ' + (err.status || '') + ' ' + (err.message || '')).toLowerCase();
    if (/ratelimit|quota|backenderror/.test(t)) return false;
    return /autherror|insufficientpermissions|permission_denied|unauthenticated|invalid.{0,3}credential|access.{0,3}denied|forbidden/.test(t);
  }

  function connecte() { return !!JETON.valeur || !!reglages().dejaConnecte; }

  /* ==========================================================================
     5. L'APPEL RESEAU
     --------------------------------------------------------------------------
     Un seul passage pour toutes les requetes, avec les quatre situations que
     Google impose de gerer :
       401  le jeton a expire        -> on en redemande un, une seule fois
       403/429 « ralentis »          -> on attend, de plus en plus longtemps
       410  le repere a expire       -> on le dit a l'appelant, qui relira tout
       5xx  panne passagere          -> on attend, on recommence
     ========================================================================== */

  function ErreurGone(msg) { var e = new Error(msg || 'GONE'); e.gone = true; return e; }

  function api(chemin, opts) {
    opts = opts || {};
    var essais = 0, maxEssais = 5;
    /* Un compteur SEPARE pour le refus de jeton : sans lui, un renouvellement
       consommait un cran de l'attente qui double, et un vrai « ralentis »
       arrive ensuite repartait deja a mi-chemin. */
    var essaisAuth = 0;

    function tour() {
      return jetonValide({ interactif: false, force: opts.forceJeton && essais > 0 }).then(function (jeton) {
        var url = (opts.absolu ? chemin : API + chemin);
        if (opts.params) {
          var q = [];
          Object.keys(opts.params).forEach(function (k) {
            var v = opts.params[k];
            if (v === undefined || v === null || v === '') return;
            q.push(encodeURIComponent(k) + '=' + encodeURIComponent(v));
          });
          if (q.length) url += (url.indexOf('?') >= 0 ? '&' : '?') + q.join('&');
        }
        var init = {
          method: opts.methode || 'GET',
          headers: Object.assign({ Authorization: 'Bearer ' + jeton }, opts.entetes || {})
        };
        if (opts.corps !== undefined) {
          if (!init.headers['Content-Type']) init.headers['Content-Type'] = 'application/json; charset=UTF-8';
          init.body = (typeof opts.corps === 'string') ? opts.corps : JSON.stringify(opts.corps);
        }
        return fetch(url, init).then(function (r) {
          noterHeure(r.headers.get('Date'));
          if (r.status === 204) return null;
          return r.text().then(function (txt) {
            var data = null;
            if (txt) { try { data = JSON.parse(txt); } catch (e) { data = { brut: txt }; } }
            if (r.ok) return data;

            var msg = (data && data.error && (data.error.message || data.error)) || ('HTTP ' + r.status);

            if (r.status === 410) throw ErreurGone(msg);

            if (refusAuth(r.status, data)) {
              /* LE JETON EST REFUSE. On ne se contente pas de l'oublier de
                 notre cote — cela ne suffisait pas, puisque celui qui nous le
                 donne le croyait encore bon et nous rendait le meme. On le lui
                 RENVOIE : a lui de le jeter, d'en redemander un neuf, et, si
                 Google refuse aussi celui-la, de lever « reconnexion
                 necessaire » et d'afficher le bandeau. L'artisan doit toujours
                 avoir un chemin de sortie visible. */
              oublierJeton();
              if (essaisAuth === 0) {
                essaisAuth++;
                JETON.refuse = jeton;
                return tour();
              }
              var eAuth = new Error(msg);
              eAuth.statut = r.status; eAuth.data = data; eAuth.auth = true;
              noter('auth', 'Google refuse le jeton (HTTP ' + r.status + ') : ' + msg);
              throw eAuth;
            }
            if ((r.status === 403 || r.status === 429 || r.status >= 500) && essais < maxEssais) {
              essais++;
              if (r.status === 403 || r.status === 429) say('quota');
              // attente qui double a chaque fois, avec un grain de hasard pour
              // que le bureau et le telephone ne reviennent pas ensemble
              var attente = Math.min(30000, 600 * Math.pow(2, essais)) + Math.floor(Math.random() * 400);
              return pause(attente).then(tour);
            }
            var err = new Error(msg);
            err.statut = r.status; err.data = data;
            throw err;
          });
        });
      });
    }
    return tour();
  }

  /* ==========================================================================
     6. LES AGENDAS DU COMPTE
     --------------------------------------------------------------------------
     L'artisan choisit lui-meme lesquels il veut suivre. Aucun agenda n'est
     suivi tant qu'il n'a rien coche : un compte Google traine souvent des
     agendas d'anniversaires, de jours feries, d'abonnements sportifs, qui
     n'ont rien a faire dans un tableau de bord de travail.
     ========================================================================== */

  function reglages() {
    var r = jget(K.cfg, null);
    if (!r || typeof r !== 'object') r = {};
    var out = Object.assign({}, DEFAUTS, r);
    /* On recopie la liste des agendas au lieu de la partager : sans cette
       ligne, cocher un agenda modifierait DEFAUTS lui-meme, et le « reglage
       par defaut » du programme se mettrait a contenir les choix de l'artisan.
       Le genre de bogue qu'on ne voit qu'apres une remise a zero. */
    out.agendas = Object.assign({}, (r.agendas && typeof r.agendas === 'object') ? r.agendas : {});
    return out;
  }
  function poserReglages(patch) {
    var r = Object.assign(reglages(), patch || {});
    jset(K.cfg, r);
    emettre('reglages', r);
    return r;
  }

  var AGENDAS = [];
  function agendas() { return AGENDAS.slice(); }

  function chargerAgendas() {
    return api('/users/me/calendarList', { params: { minAccessRole: 'reader', maxResults: 250, showHidden: false } })
      .then(function (d) {
        AGENDAS = ((d && d.items) || []).map(function (c) {
          return {
            id: c.id,
            nom: c.summaryOverride || c.summary || c.id,
            couleur: c.backgroundColor || '',
            /* Les rappels « par defaut » de l'agenda : un evenement qui dit
               « useDefault » n'en porte aucun lui-meme, ce sont ceux-ci. */
            rappels: (c.defaultReminders || []).map(function (r) { return { method: r.method, minutes: r.minutes }; }),
            principal: !!c.primary,
            /* « lecture seule » au sens de Google : on ne pourra meme pas y
               ecrire le casier prive. On le sait a l'avance, ce qui evite de
               proposer a l'artisan des cases a cocher qui echoueraient. */
            enLecture: (c.accessRole !== 'owner' && c.accessRole !== 'writer'),
            suivi: !!(reglages().agendas[c.id] || {}).suivi
          };
        });
        emettre('agendas', AGENDAS.slice());
        return agendas();
      });
  }

  function suivre(idAgenda, oui, defauts) {
    var r = reglages();
    var a = r.agendas[idAgenda] || {};
    a.suivi = !!oui;
    if (defauts && defauts.sec) a.sec = defauts.sec;
    if (defauts && defauts.sub) a.sub = defauts.sub;
    r.agendas[idAgenda] = a;
    poserReglages({ agendas: r.agendas });
    AGENDAS.forEach(function (c) { if (c.id === idAgenda) c.suivi = !!oui; });
    if (!oui) {
      /* On ne suit plus : on retire ses taches de l'affichage et on oublie son
         repere de lecture. On NE TOUCHE PAS a l'agenda lui-meme. */
      var curseurs = jget(K.jetons, {}); delete curseurs[idAgenda]; jset(K.jetons, curseurs);
      Object.keys(EVENEMENTS).forEach(function (id) {
        if (EVENEMENTS[id].cal === idAgenda) delete EVENEMENTS[id];
      });
      /* La reserve suit le meme sort que la memoire : un agenda qu'on ne suit
         plus ne doit pas revenir tout seul a la prochaine ouverture. */
      ranger();
      rendre();
    }
    return reglages();
  }
  function agendasSuivis() {
    var r = reglages(); var out = [];
    Object.keys(r.agendas || {}).forEach(function (id) { if (r.agendas[id] && r.agendas[id].suivi) out.push(id); });
    return out;
  }

  /* ==========================================================================
     7. LA LECTURE
     --------------------------------------------------------------------------
     Premiere lecture : on demande une fenetre de temps (90 jours en arriere,
     400 en avant) et Google nous rend, a la fin, un « syncToken » — un repere.
     Lectures suivantes : on ne redemande QUE ce qui a change depuis le repere.
     C'est ce qui rend la synchronisation instantanee et quasi gratuite.

     TROIS PIEGES QUE GOOGLE POSE, ET QU'ON DESAMORCE ICI :

     1. Le repere expire (erreur 410). Ca arrive apres une longue absence, ou
        quand Google reorganise ses donnees. On efface le repere et on relit
        tout. Ce n'est pas une panne, c'est prevu.

     2. Avec un repere, Google REFUSE qu'on redonne timeMin et timeMax. Le
        repere garde en memoire la fenetre de la premiere lecture. On ne peut
        donc pas faire glisser la fenetre vers l'avant sans tout relire : c'est
        pour ca qu'on refait une lecture complete tous les 7 jours (reglable).
        Sinon, au bout de quelques mois, l'horizon resterait bloque la ou il
        etait le premier jour.

     3. showDeleted doit etre a true, sinon on n'apprend JAMAIS qu'un evenement
        a ete supprime, et des taches fantomes resteraient a l'ecran pour
        toujours. Et ce reglage doit etre le meme a la premiere lecture et aux
        suivantes, sinon Google renvoie des resultats incoherents.

     singleEvents=true demande a Google de deplier les repetitions : au lieu
     d'un « tous les 29 du mois », on recoit chaque occurrence, avec sa propre
     date. C'est exactement ce dont le tableau de bord a besoin — il raisonne
     en « une tache = un jour ».
     ========================================================================== */

  /* Les evenements en memoire, ranges par identifiant de tache. */
  var EVENEMENTS = {};
  var ETAT = { enCours: false, derniereLecture: 0, derniereComplete: 0, erreur: null };

  function curseurs()          { var c = jget(K.jetons, {}); return (c && typeof c === 'object') ? c : {}; }
  function poserCurseur(id, t) { var c = curseurs(); if (t) c[id] = { t: t, q: maintenant() }; else delete c[id]; jset(K.jetons, c); }

  /* --------------------------------------------------------------------------
     LA RESERVE — LES EVENEMENTS LUS, RANGES A COTE DES CURSEURS
     --------------------------------------------------------------------------
     CE QUI N'ALLAIT PAS. `EVENEMENTS` ne vivait qu'en memoire. A chaque
     ouverture du programme la liste repartait vide — mais le curseur, lui,
     etait garde sur le disque. init() demandait donc a Google le SEUL DELTA du
     syncToken : cinq rendez-vous au lieu de sept cent soixante-dix-sept, et
     cinq cartes au lieu de cent soixante-quinze. C'est ce que l'artisan voyait
     chaque matin. Un curseur qu'on garde sans garder ce qu'il a deja rapporte
     n'est pas un curseur : c'est un trou.

     ON GARDE DONC LES DEUX ENSEMBLE, et on relit la reserve au demarrage,
     AVANT le reseau : le tableau de bord est plein des la premiere seconde,
     meme sans connexion.

     ON NE GARDE PAS L'EVENEMENT ENTIER. Google en renvoie une trentaine de
     champs (etag, iCalUID, creator, organizer, sequence, reminders, eventType,
     originalStartTime...) dont ce fichier ne lit JAMAIS un seul. On ne garde
     que les huit reellement relus — id, summary, description, start, end,
     recurringEventId, htmlLink, et le casier prive.

     CE QUE CELA PESE, MESURE SUR 777 EVENEMENTS REPRESENTATIFS (titres arabes
     et francais, un tiers de repetitions, un casier prive sur deux) :

         forme brute, telle que recue ....  894 Ko  (1700 Ko au compteur Chrome)
         forme reduite, celle d'ici ......  563 Ko  (1039 Ko au compteur Chrome)

     Chrome compte le localStorage en UTF-16, soit deux octets par caractere :
     c'est le second chiffre qui compte, et il represente 20 % du plafond usuel
     de 5 Mo. C'est tenable, mais ce n'est pas rien. Si le navigateur refuse
     quand meme — quota partage, mode prive, disque plein — ON ALLEGE PAR
     PALIERS plutot que d'abandonner : d'abord le lien vers Google (16 %), puis
     la description (14 %), puis la fenetre reduite a -30/+120 jours. Et si
     rien ne passe, on efface la reserve : le filet de la « lecture complete
     quand la liste est vide » prend alors le relais, et l'artisan ne voit
     jamais un tableau vide.
     -------------------------------------------------------------------------- */

  var RESERVE_V = 2;   /* 2 : la reserve garde lieu, rappels, invites, pieces jointes (23/09/2026) — l'ancienne est relue en entier */
  var NOMS = {};        // id d'agenda -> nom, pour l'affichage apres rechargement
  var RAPPELS = {};     // id d'agenda -> rappels par defaut ([{method, minutes}]), idem

  function evReduit(ev, o) {
    o = o || {};
    var r = { id: ev.id };
    if (ev.summary) r.summary = ev.summary;
    if (ev.description && !o.sansDesc) r.description = ev.description;
    if (ev.start) r.start = ev.start;
    if (ev.end) r.end = ev.end;
    if (ev.recurringEventId) r.recurringEventId = ev.recurringEventId;
    if (ev.htmlLink && !o.sansLien) r.htmlLink = ev.htmlLink;
    /* Ce que la carte affiche dans « informations Google » : sans ces
       lignes, tout cela disparaissait au rechargement suivant. */
    if (ev.location) r.location = ev.location;
    if (ev.reminders) r.reminders = { useDefault: ev.reminders.useDefault !== false,
                                      overrides: (ev.reminders.overrides || []).map(function (x) { return { method: x.method, minutes: x.minutes }; }) };
    if (ev.eventType && ev.eventType !== 'default') r.eventType = ev.eventType;
    if (!o.sansDesc) {
      if (ev.attendees && ev.attendees.length) r.attendees = ev.attendees.map(function (a) { return { email: a.email, displayName: a.displayName, self: !!a.self }; });
      if (ev.attachments && ev.attachments.length) r.attachments = ev.attachments.map(function (a) { return { title: a.title, fileUrl: a.fileUrl }; });
    }
    var priv = ev.extendedProperties && ev.extendedProperties.private;
    if (priv && Object.keys(priv).length) r.extendedProperties = { private: priv };
    return r;
  }

  function paquetReserve(o) {
    o = o || {};
    var ev = {};
    Object.keys(EVENEMENTS).forEach(function (id) {
      var e = EVENEMENTS[id];
      if (!e || !e.ev || !e.ev.id || !e.jour) return;
      if (o.depuis && e.jour < o.depuis) return;
      if (o.jusqua && e.jour > o.jusqua) return;
      ev[id] = { cal: e.cal, jour: e.jour, ev: evReduit(e.ev, o) };
    });
    /* LES DEUX FAITS QUI VONT AVEC CES EVENEMENTS, et qui doivent voyager avec
       eux : « une lecture a eu lieu » et « une lecture COMPLETE a eu lieu ».
       Sans eux, le pont refuserait au demarrage de retirer les doublons, et
       l'artisan verrait chaque rendez-vous deux fois. */
    return {
      v: RESERVE_V,
      lecture: ETAT.derniereLecture || 0,
      complet: ETAT.derniereComplete || 0,
      agendas: AGENDAS.length
        ? AGENDAS.map(function (a) { return { id: a.id, nom: a.nom, rappels: a.rappels || [] }; })
        : Object.keys(NOMS).map(function (id) { return { id: id, nom: NOMS[id], rappels: RAPPELS[id] || [] }; }),
      ev: ev
    };
  }

  function ranger() {
    if (!clientId()) return false;              // silence au repos : rien a ranger
    var court = {
      sansLien: true, sansDesc: true,
      depuis: isoJour(plusJours(new Date(), -30)),
      jusqua: isoJour(plusJours(new Date(), 120))
    };
    var paliers = [{}, { sansLien: true }, { sansLien: true, sansDesc: true }, court];
    for (var i = 0; i < paliers.length; i++) {
      if (jset(K.evs, paquetReserve(paliers[i]))) {
        if (i) dire('reserve rangee au palier ' + (i + 1) + ' (le navigateur a refuse le palier ' + i + ').');
        return true;
      }
    }
    try { localStorage.removeItem(K.evs); } catch (e) { }
    noter('avert', 'la reserve d\'evenements ne tient pas dans ce navigateur — lecture complete au prochain demarrage');
    return false;
  }

  var RESERVE_LUE = false;

  function restaurer() {
    if (RESERVE_LUE) return 0;
    RESERVE_LUE = true;
    var p = jget(K.evs, null);
    if (!p || typeof p !== 'object' || p.v !== RESERVE_V || !p.ev) return 0;

    var r = reglages();
    var t0 = isoJour(plusJours(new Date(), -(r.joursPasses || 90)));
    var t1 = isoJour(plusJours(new Date(),  (r.joursFuturs || 400)));
    var suivi = {};
    agendasSuivis().forEach(function (id) { suivi[id] = 1; });

    var n = 0;
    Object.keys(p.ev).forEach(function (id) {
      var e = p.ev[id];
      if (!e || !e.ev || !e.ev.id || !e.jour) return;
      if (!suivi[e.cal]) return;                     // agenda qu'on ne suit plus
      if (e.jour < t0 || e.jour > t1) return;        // sorti de la fenetre
      EVENEMENTS[id] = { cal: e.cal, ev: e.ev, jour: e.jour };
      n++;
    });
    (p.agendas || []).forEach(function (a) { if (a && a.id) { NOMS[a.id] = a.nom || a.id; RAPPELS[a.id] = a.rappels || []; } });
    if (n) {
      ETAT.derniereLecture  = p.lecture || 0;
      ETAT.derniereComplete = p.complet || 0;
      dire('reserve relue : ' + n + ' rendez-vous retrouves avant meme le reseau.');
    }
    return n;
  }

  function doitRelireTout(idAgenda) {
    var c = curseurs()[idAgenda];
    if (!c || !c.t) return true;
    var jours = reglages().refaireApres || 7;
    return (maintenant() - (c.q || 0)) > jours * 86400000;
  }

  function lireAgenda(idAgenda, forcerComplet) {
    var r = reglages();
    var complet = forcerComplet || doitRelireTout(idAgenda);
    var repere  = complet ? null : (curseurs()[idAgenda] || {}).t;

    var base = { singleEvents: true, showDeleted: true, maxResults: 250 };
    if (!complet && repere) {
      base.syncToken = repere;                       // pas de timeMin/timeMax ici : Google les refuse
    } else {
      var t0 = plusJours(new Date(), -(r.joursPasses || 90));
      var t1 = plusJours(new Date(),  (r.joursFuturs || 400));
      t0.setHours(0, 0, 0, 0); t1.setHours(23, 59, 59, 0);
      base.timeMin = t0.toISOString();
      base.timeMax = t1.toISOString();
    }

    var recus = [], pageToken = null, nouveauRepere = null;

    function page() {
      var params = Object.assign({}, base);
      if (pageToken) params.pageToken = pageToken;
      return api('/calendars/' + encodeURIComponent(idAgenda) + '/events', { params: params })
        .then(function (d) {
          ((d && d.items) || []).forEach(function (ev) { recus.push(ev); });
          if (d && d.nextPageToken) { pageToken = d.nextPageToken; return page(); }
          nouveauRepere = (d && d.nextSyncToken) || null;
          return null;
        });
    }

    return page().then(function () {
      if (complet) {
        /* Lecture complete : tout ce qui n'est pas revenu n'existe plus dans
           la fenetre. On repart d'une ardoise propre pour cet agenda. */
        Object.keys(EVENEMENTS).forEach(function (id) {
          if (EVENEMENTS[id].cal === idAgenda) delete EVENEMENTS[id];
        });
      }
      var regl = reglages();
      recus.forEach(function (ev) { absorber(idAgenda, ev, regl); });
      ecrireOmbres();
      if (nouveauRepere) poserCurseur(idAgenda, nouveauRepere);
      if (complet) ETAT.derniereComplete = maintenant();
      return recus.length;
    }, function (e) {
      if (e && e.gone) {
        /* 410 : le repere a expire. On efface et on relit tout, une fois. */
        say('reSync'); noter('info', 'repere expire pour ' + idAgenda + ' — relecture complete');
        poserCurseur(idAgenda, null);
        if (!forcerComplet) return lireAgenda(idAgenda, true);
      }
      throw e;
    });
  }

  /* Un evenement recu de Google entre ici. Trois cas :
       - annule / supprime      -> on retire la tache de l'affichage
       - hors de la fenetre     -> on l'ignore (la lecture incrementale peut
                                   ramener des evenements tres eloignes)
       - normal                 -> on le garde, on lit son casier prive */
  function absorber(idAgenda, ev, regl) {
    if (!ev || !ev.id) return;
    var idTache = idDe(idAgenda, ev);

    if (ev.status === 'cancelled') {
      /* On oublie l'evenement et son ombre. On NE SUPPRIME PAS ce que
         l'artisan avait ecrit dans store (statut, notes) : si l'evenement
         revient — Google restaure parfois une suppression — tout retrouve sa
         place. Une poignee de lignes orphelines dans le localStorage ne gene
         personne et ne s'affiche nulle part. */
      delete EVENEMENTS[idTache];
      var o = ombres(); if (o[idTache]) { delete o[idTache]; poserOmbres(o); }
      return;
    }
    var jour = jourDe(ev.start);
    if (!jour) return;                       // evenement sans date exploitable

    var r = regl || reglages();
    var t0 = isoJour(plusJours(new Date(), -(r.joursPasses || 90)));
    var t1 = isoJour(plusJours(new Date(),  (r.joursFuturs || 400)));
    if (jour < t0 || jour > t1) { delete EVENEMENTS[idTache]; return; }

    EVENEMENTS[idTache] = { cal: idAgenda, ev: ev, jour: jour };
    fusionnerAvecLocal(idTache, idAgenda, ev);
  }

  /* L'IDENTIFIANT D'UNE TACHE GOOGLE.
     Il doit etre le MEME sur le bureau et sur le telephone, sinon les deux
     appareils rangeraient le meme evenement a deux endroits differents dans
     store et rien ne se retrouverait. On le fabrique donc uniquement a partir
     de choses que Google garantit stables : l'agenda et l'identifiant de
     l'evenement (qui, pour une occurrence de repetition, contient deja la
     date : « abc123_20260929T070000Z »). */
  function idDe(idAgenda, ev)  { return 'g|' + h32(idAgenda) + '|' + ev.id; }
  /* La « serie » : pour une repetition, toutes les occurrences la partagent.
     C'est la cle sous laquelle index.html range le contact et le lieu — des
     informations qui appartiennent au rendez-vous recurrent, pas a la date. */
  function serieDe(idAgenda, ev) { return 'g:' + h32(idAgenda) + ':' + (ev.recurringEventId || ev.id); }

  /* ==========================================================================
     8. DE L'EVENEMENT GOOGLE A LA TACHE DU TABLEAU DE BORD
     --------------------------------------------------------------------------
     La forme de sortie n'est pas inventee : c'est exactement celle que
     buildTasks() fabrique dans index.html, champ pour champ. Si un jour cette
     forme change la-bas, elle doit changer ici.
        id, sk, src, title{ar,fr}, raw, cat, sub, date, start, end,
        allDay, desc, org, routine, link
     ========================================================================== */

  function tacheDe(idTache, regl) {
    var e = EVENEMENTS[idTache];
    if (!e) return null;
    var ev = e.ev;
    var etat = (ombres()[idTache] || {}).e || {};
    var parAgenda = ((regl || reglages()).agendas[e.cal] || {});
    var titre = (ev.summary || '').trim() || (langue() === 'fr' ? '(sans titre)' : '(بدون عنوان)');
    var toutLeJour = !!(ev.start && ev.start.date);
    var finJour = jourDe(ev.end);
    /* Journee entiere : Google donne la fin EXCLUSIVE (le lendemain). La page,
       elle, ecrit « se termine le » avec le dernier jour reel. */
    if (toutLeJour && finJour) { try { finJour = isoJour(plusJours(new Date(finJour + 'T00:00:00'), -1)); } catch (e) { } }
    var dfin = (finJour && finJour > e.jour) ? finJour : null;

    /* Les rappels : ceux de l'evenement, sinon ceux de son agenda. */
    var rap = null;
    if (ev.reminders && ev.reminders.useDefault === false) rap = (ev.reminders.overrides || []).slice();
    else rap = rappelsDefaut(e.cal);
    if (!rap || !rap.length) rap = null;
    var inv = (ev.attendees || []).map(function (a) { return a.displayName || a.email; }).filter(Boolean);
    var pj  = (ev.attachments || []).map(function (a) { return a.title || a.fileUrl; }).filter(Boolean);

    /* Le classement venu du bureau (section, sous-categorie, routine) pour
       cette serie — voir classementDescendre(). L'ombre (ce que l'artisan a
       choisi lui-meme) passe toujours devant. */
    var cl = (classement().s || {})[ev.recurringEventId || ev.id] || null;

    return {
      id:     idTache,
      sk:     serieDe(e.cal, ev),
      src:    'google',
      /* Un evenement n'a qu'un titre, le meme dans les deux langues : on ne
         va pas inventer une traduction que l'artisan n'a pas ecrite. */
      title:  { ar: titre, fr: titre },
      raw:    titre,
      cat:    etat.sc || (cl && cl[0]) || parAgenda.sec || 'perso',
      sub:    etat.sb || (cl && cl[1]) || parAgenda.sub || 'perso',
      date:   e.jour,
      start:  heureDe(ev.start),
      end:    heureDe(ev.end),
      endDate: dfin || e.jour,
      allDay: toutLeJour,
      desc:   (ev.description || '').trim(),
      org:    { ar: nomAgenda(e.cal), fr: nomAgenda(e.cal) },
      loc:    (ev.location || '').trim(),
      rap:    rap,
      inv:    inv.length ? inv : null,
      pj:     pj.length ? pj : null,
      fete:   ev.eventType === 'birthday',
      /* « routine » masque la tache quand l'artisan a decoche les routines.
         Une repetition tres frequente en est une ; un rendez-vous unique, non.
         Le choix de l'artisan (ombre) d'abord, puis le classement du bureau. */
      routine: !!ev.recurringEventId && ((etat.rt !== undefined && etat.rt !== null) ? !!etat.rt : !!(cl && cl[2])),
      link:   ev.htmlLink || lienJour(e.jour),
      /* Reperes internes, ignores par index.html mais precieux ici. */
      gcal:   e.cal,
      gev:    ev.id,
      gfin:   dfin
    };
  }
  function rappelsDefaut(id) {
    for (var i = 0; i < AGENDAS.length; i++) if (AGENDAS[i].id === id) return (AGENDAS[i].rappels || []).slice();
    return (RAPPELS[id] || []).slice();
  }
  function nomAgenda(id) {
    for (var i = 0; i < AGENDAS.length; i++) if (AGENDAS[i].id === id) return AGENDAS[i].nom;
    /* La liste des agendas arrive du reseau et repart a chaque ouverture. La
       reserve, elle, garde les noms : sans cette ligne, l'artisan verrait
       l'adresse electronique brute de l'agenda a la place de son nom
       (son libelle) tant que Google n'a pas repondu. */
    return NOMS[id] || id;
  }
  function lienJour(d) {
    var p = String(d).split('-');
    return 'https://calendar.google.com/calendar/u/0/r/day/' + p[0] + '/' + Number(p[1]) + '/' + Number(p[2]);
  }

  /* La liste complete, triee comme index.html trie la sienne. */
  function tasks() {
    var out = [], regl = reglages();
    Object.keys(EVENEMENTS).forEach(function (id) { var t = tacheDe(id, regl); if (t) out.push(t); });
    return out.sort(function (a, b) {
      return a.date === b.date ? (a.start || '').localeCompare(b.start || '') : a.date.localeCompare(b.date);
    });
  }

  /* ==========================================================================
     9. LE CASIER PRIVE : ECRIRE ET RELIRE L'ETAT
     --------------------------------------------------------------------------
     LE FORMAT, VOLONTAIREMENT COURT. Chaque octet compte : Google n'accepte
     que 1024 caracteres par valeur.
        v   version du format          st  statut (done/waiting/postponed/overdue)
        ck  check-list { l:libelles, d:coches, a:{empreinte:heure} }
        nt  notes                      ct  contact         pl  lieu
        sb  sous-categorie             sc  section         rt  routine (0/1)
        at  l'heure de derniere modification, CHAMP PAR CHAMP
        ow  1 si la tache a ete creee depuis le programme

     LE DECOUPAGE, ET POURQUOI ON NE PERD RIEN.
     Si le tout tient dans 900 octets, une seule cle : « ap ».
     Sinon, « ap » ne contient plus que le nombre de morceaux (« #3 »), et le
     texte est coupe en « ap1 », « ap2 », « ap3 ». A la relecture, on recolle.
     Le decoupage respecte les caracteres : une lettre arabe ou un emoji ne
     sera jamais coupe en deux entre deux morceaux — ce qui produirait un
     carre noir a la place de la lettre.
     Au-dela de 16 morceaux (environ 14 Ko), ON REFUSE, et on le DIT a
     l'artisan. On ne coupe jamais sa note en silence : perdre la moitie d'une
     note sans prevenir serait bien pire qu'un message d'avertissement.
     ========================================================================== */

  function encoder(etat) {
    var p = { v: 1 };
    if (etat.st) p.st = etat.st;
    if (etat.nt) p.nt = etat.nt;
    if (etat.ct) p.ct = etat.ct;
    if (etat.pl) p.pl = etat.pl;
    if (etat.sb) p.sb = etat.sb;
    if (etat.sc) p.sc = etat.sc;
    if (etat.rt) p.rt = 1;
    if (etat.ow) p.ow = 1;
    if (etat.ck && ((etat.ck.l || []).length || (etat.ck.d || []).length)) {
      p.ck = { l: etat.ck.l || [], d: etat.ck.d || [] };
      if (etat.ck.a && Object.keys(etat.ck.a).length) p.ck.a = etat.ck.a;
    }
    if (etat.at && Object.keys(etat.at).length) p.at = etat.at;
    return JSON.stringify(p);
  }

  /* Couper un texte en morceaux d'au plus `max` OCTETS, sans jamais couper un
     caractere en deux (les emojis occupent deux positions en JavaScript : on
     recule d'un cran si on tombe entre les deux). */
  function decouper(txt, max) {
    var morceaux = [], i = 0, n = txt.length;
    while (i < n) {
      var lo = 1, hi = Math.min(n - i, max), pris = 1;
      while (lo <= hi) {
        var mid = (lo + hi) >> 1;
        if (octets(txt.substr(i, mid)) <= max) { pris = mid; lo = mid + 1; }
        else hi = mid - 1;
      }
      /* Ne pas couper entre les deux moities d'un emoji. */
      var c = txt.charCodeAt(i + pris - 1);
      if (c >= 0xD800 && c <= 0xDBFF && (i + pris) < n) pris--;
      if (pris < 1) pris = 1;
      morceaux.push(txt.substr(i, pris));
      i += pris;
    }
    return morceaux;
  }

  /* Fabrique les proprietes a envoyer. Renvoie soit {props}, soit {trop:true}
     quand meme le decoupage ne suffit pas. `privActuel` sert a effacer les
     morceaux devenus inutiles : sans ca, un « ap4 » resterait la apres que la
     note a ete raccourcie, et la relecture recollerait n'importe quoi. */
  function proprietes(privActuel, etat) {
    var json = encoder(etat);
    var props = {};
    if (octets(json) <= MAX_OCTETS) {
      props[CLE] = json;
    } else {
      var m = decouper(json, MAX_OCTETS);
      if (m.length > MAX_MORCEAUX) return { trop: true, octets: octets(json), morceaux: m.length };
      props[CLE] = '#' + m.length;
      for (var i = 0; i < m.length; i++) props[CLE + (i + 1)] = m[i];
    }
    Object.keys(privActuel || {}).forEach(function (k) {
      if (/^ap\d+$/.test(k) && !(k in props)) props[k] = null;   // null = « efface cette cle »
    });
    return { props: props };
  }

  function lireCasier(ev) {
    var priv = (ev && ev.extendedProperties && ev.extendedProperties.private) || null;
    if (!priv) return null;
    var t = priv[CLE];
    if (t == null || t === '') return null;
    if (String(t).charAt(0) === '#') {
      var n = parseInt(String(t).slice(1), 10) || 0;
      var buf = '';
      for (var i = 1; i <= n; i++) {
        var m = priv[CLE + i];
        if (m == null) {
          /* Un morceau manque : un envoi a ete coupe en plein milieu. On ne
             devine pas, on ne detruit pas — on le note et on ignore ce casier.
             La copie locale reste la seule verite pour cet evenement, et la
             prochaine ecriture de l'artisan remettra tout d'aplomb. */
          noter('avert', 'casier incomplet (morceau ' + i + '/' + n + ' manquant) : ' + ev.id);
          return null;
        }
        buf += m;
      }
      t = buf;
    }
    try { return JSON.parse(t); } catch (e) {
      noter('avert', 'casier illisible sur ' + ev.id + ' — ignore');
      return null;
    }
  }

  /* ==========================================================================
     10. LES CONFLITS — LE DERNIER QUI ECRIT GAGNE, MAIS CHAMP PAR CHAMP
     --------------------------------------------------------------------------
     LE PROBLEME, EN UNE PHRASE : le matin, l'artisan coche « extrait de
     roles » sur son telephone ; a midi, au bureau, il coche « timbre fiscal »
     sur le meme dossier. Si on comparait les deux versions en bloc, la plus
     recente ecraserait l'autre et l'une des deux cases serait perdue.

     LA SOLUTION : chaque champ porte SA PROPRE heure de derniere modification
     (le petit dictionnaire « at »). On compare champ par champ. Le statut du
     telephone peut gagner pendant que la note du bureau gagne aussi.

     ET POUR LA CHECK-LIST, ON DESCEND ENCORE D'UN CRAN : chaque case a son
     heure a elle (« ck.a », rangee sous l'empreinte du libelle). Les deux
     cases cochees ce jour-la survivent toutes les deux, parce qu'elles n'ont
     jamais ete comparees l'une a l'autre — seulement chacune avec elle-meme.

     La liste des libelles, elle, se compare en bloc (« at.cl ») : une liste
     est un tout, et fusionner deux listes differentes produirait des doublons
     et des lignes ressuscitees que personne n'a demandees.

     « L'OMBRE » est notre copie du dernier etat connu, avec les heures. C'est
     elle qui permet de savoir, au retour du reseau, si c'est nous ou l'autre
     appareil qui avons bouge.
     ========================================================================== */

  /* LES OMBRES VIVENT EN MEMOIRE.
     Avant : chaque evenement recu relisait le paquet entier des ombres
     (JSON.parse) puis le re-ecrivait en entier (JSON.stringify) — et chaque
     tache affichee le relisait encore. Cinq mille rendez-vous, c'est cinq
     mille lectures et cinq mille ecritures d'un paquet de cinq mille lignes :
     des dizaines de millions de lignes serialisees. C'etait LE gel a la
     liaison, et la lenteur a chaque clic ensuite (chaque reconstruction de
     la liste repassait par la).
     Maintenant : le paquet est lu une fois, garde en memoire, et ecrit au
     plus une fois par tour de boucle (setTimeout 0), ou tout de suite quand
     la page se cache ou qu'une lecture se termine. */
  var OMBRES = null, OMBRES_SALE = false, OMBRES_MINUTERIE = null;
  function ombres() {
    if (OMBRES === null) { var o = jget(K.ombre, {}); OMBRES = (o && typeof o === 'object') ? o : {}; }
    return OMBRES;
  }
  function ecrireOmbres() {
    if (OMBRES_MINUTERIE) { clearTimeout(OMBRES_MINUTERIE); OMBRES_MINUTERIE = null; }
    if (!OMBRES_SALE) return;
    OMBRES_SALE = false;
    jset(K.ombre, OMBRES || {});
  }
  function poserOmbres(o) {
    OMBRES = (o && typeof o === 'object') ? o : {};
    OMBRES_SALE = true;
    if (!OMBRES_MINUTERIE) OMBRES_MINUTERIE = setTimeout(ecrireOmbres, 0);
  }
  try {
    window.addEventListener('pagehide', ecrireOmbres);
    window.addEventListener('beforeunload', ecrireOmbres);
    document.addEventListener('visibilitychange', function () { if (document.hidden) ecrireOmbres(); });
  } catch (e) {}
  function ombreDe(id)   { var o = ombres(); return o[id] || { e: {}, at: {} }; }
  function poserOmbre(id, etat) { var o = ombres(); o[id] = { e: etat, q: maintenant() }; poserOmbres(o); }

  var CHAMPS_SIMPLES = ['st', 'nt', 'ct', 'pl', 'sb', 'sc', 'rt'];

  function fusionner(local, distant) {
    local   = local   || {}; distant = distant || {};
    var aL = local.at || {}, aD = distant.at || {};
    var out = { at: {} }, versLocal = false, versDistant = false;

    CHAMPS_SIMPLES.forEach(function (f) {
      var tL = aL[f] || 0, tD = aD[f] || 0;
      if (tD > tL) {
        out[f] = distant[f]; out.at[f] = tD;
        if (!egal(local[f], distant[f])) versLocal = true;
      } else {
        out[f] = local[f]; if (tL) out.at[f] = tL;
        if (tL > tD && !egal(local[f], distant[f])) versDistant = true;
      }
      if (out[f] === undefined || out[f] === null || out[f] === '') delete out[f];
    });
    if (local.ow || distant.ow) out.ow = 1;

    /* --- la check-list --------------------------------------------------- */
    var clL = (local.ck   && local.ck.l)   || [];
    var clD = (distant.ck && distant.ck.l) || [];
    var tclL = aL.cl || 0, tclD = aD.cl || 0;
    var liste = (tclD > tclL) ? clD : clL;
    if (tclD > tclL && !egal(clL, clD)) versLocal = true;
    if (tclL > tclD && !egal(clL, clD)) versDistant = true;
    out.at.cl = Math.max(tclL, tclD) || undefined;

    var dL = (local.ck   && local.ck.d) || [];
    var dD = (distant.ck && distant.ck.d) || [];
    var hL = (local.ck   && local.ck.a) || {};
    var hD = (distant.ck && distant.ck.a) || {};
    var coches = [], heures = {};

    liste.forEach(function (lab) {
      var k  = h32(lab);
      var tL = hL[k] || 0, tD = hD[k] || 0;
      var etatL = dL.indexOf(lab) >= 0, etatD = dD.indexOf(lab) >= 0;
      var gagnant;
      if (tD > tL)      gagnant = etatD;
      else if (tL > tD) gagnant = etatL;
      else              gagnant = etatL || etatD;   // jamais touchee des deux cotes
      if (gagnant) coches.push(lab);
      var t = Math.max(tL, tD); if (t) heures[k] = t;
      if (tD > tL && etatL !== gagnant) versLocal = true;
      if (tL > tD && etatD !== gagnant) versDistant = true;
    });
    if (liste.length || coches.length) out.ck = { l: liste, d: coches, a: heures };
    if (out.at.cl === undefined) delete out.at.cl;

    return { etat: out, versLocal: versLocal, versDistant: versDistant };
  }

  /* Au retour d'une lecture : on confronte ce que Google nous dit a ce que
     l'appareil sait, et on range le resultat dans `store`, la ou index.html
     ira le chercher. ATTENTION : cette fonction N'ECRIT RIEN dans l'agenda.
     Si l'appareil a du plus recent, on le SIGNALE seulement (point 7). */
  var A_RENVOYER = {};

  function fusionnerAvecLocal(idTache, idAgenda, ev) {
    var distant = lireCasier(ev) || { at: {} };
    var local   = etatLocalDe(idTache, idAgenda, ev);
    var f       = fusionner(local, distant);

    poserOmbre(idTache, f.etat);
    appliquerDansStore(idTache, serieDe(idAgenda, ev), f.etat);

    if (f.versLocal) {
      noter('fusion', 'modification venue d\'un autre appareil sur ' + (ev.summary || ev.id));
      emettre('fusion', { id: idTache });
    }
    if (f.versDistant) {
      /* L'appareil a du plus recent que l'agenda. Le plus souvent c'est une
         modification faite hors ligne : elle est deja dans la file d'attente
         et partira toute seule. Si elle n'y est pas (etat plus ancien que ce
         moteur, ou file videe a la main), on ne part PAS ecrire tout seul :
         on l'inscrit ici et l'artisan declenche l'envoi quand il veut. */
      if (!dansLaFile(idAgenda, ev.id)) {
        A_RENVOYER[idTache] = { cal: idAgenda, ev: ev.id };
        emettre('aRenvoyer', { total: Object.keys(A_RENVOYER).length });
      }
    }
  }

  /* L'etat tel que l'appareil le connait : l'ombre (qui porte les heures) plus
     ce que `store` contient reellement, au cas ou l'artisan aurait modifie
     quelque chose pendant que le moteur dormait. */
  function etatLocalDe(idTache, idAgenda, ev) {
    var o = ombreDe(idTache);
    var e = Object.assign({ at: {} }, o.e || {});
    e.at = Object.assign({}, (o.e && o.e.at) || {});
    if (!P.store) return e;
    var sk = serieDe(idAgenda, ev);
    var s = P.store;
    /* On ne remonte l'horloge de personne : si store contient autre chose que
       l'ombre sans qu'aucune heure ne l'explique, on considere que c'est une
       modification faite a l'instant meme ou le moteur s'est reveille. */
    var maj = function (champ, valeur) {
      if (valeur === undefined) return;
      var v = (valeur === null || valeur === '') ? undefined : valeur;
      if (egal(e[champ], v)) return;
      e[champ] = v;
      if (!e.at[champ]) e.at[champ] = maintenant();
    };
    maj('st', (s.status || {})[idTache]);
    maj('nt', (s.notes  || {})[idTache]);
    maj('ct', (s.contact|| {})[sk]);
    maj('pl', (s.place  || {})[sk]);
    maj('sc', (s.cat    || {})[idTache]);
    var c = (s.checks || {})[idTache];
    if (c && (c.list || c.done)) {
      var listeA = (e.ck && e.ck.l) || [], donesA = (e.ck && e.ck.d) || [];
      if (!egal(listeA, c.list || []) || !egal(donesA.slice().sort(), (c.done || []).slice().sort())) {
        var heures = Object.assign({}, (e.ck && e.ck.a) || {});
        (c.list || []).forEach(function (lab) {
          var etaitCoche = donesA.indexOf(lab) >= 0, estCoche = (c.done || []).indexOf(lab) >= 0;
          if (etaitCoche !== estCoche && !heures[h32(lab)]) heures[h32(lab)] = maintenant();
        });
        e.ck = { l: (c.list || []).slice(), d: (c.done || []).slice(), a: heures };
        if (!egal(listeA, c.list || []) && !e.at.cl) e.at.cl = maintenant();
      }
    }
    return e;
  }

  /* Le chemin inverse : l'etat fusionne redescend dans `store`, aux endroits
     exacts ou index.html va le lire. Les cles ne sont pas les memes partout —
     le statut et les notes sont ranges par tache, le contact et le lieu par
     serie. On respecte ce decoupage : le changer casserait le tableau de bord. */
  function appliquerDansStore(idTache, sk, etat) {
    if (!P.store) return;
    var s = P.store;
    s.status = s.status || {}; s.notes = s.notes || {}; s.checks = s.checks || {};
    s.cat = s.cat || {}; s.contact = s.contact || {}; s.place = s.place || {};

    if (etat.st) s.status[idTache] = etat.st; else delete s.status[idTache];
    if (etat.nt) s.notes[idTache]  = etat.nt; else delete s.notes[idTache];
    if (etat.sc) s.cat[idTache]    = etat.sc; else delete s.cat[idTache];
    if (etat.ct) s.contact[sk]     = etat.ct;
    if (etat.pl) s.place[sk]       = etat.pl;
    if (etat.ck && (etat.ck.l || []).length) s.checks[idTache] = { list: etat.ck.l.slice(), done: (etat.ck.d || []).slice() };
    sauverLocal();
  }

  /* ==========================================================================
     11. L'ECRITURE — events.patch, JAMAIS events.update
     --------------------------------------------------------------------------
     POURQUOI PATCH ET PAS UPDATE, EN UNE PHRASE : update remplace l'evenement
     ENTIER par ce qu'on envoie. Tout ce qu'on n'aurait pas recopie — le titre,
     les invites, les rappels, la repetition — serait efface. patch ne touche
     QUE les champs envoyes. Comme on n'envoie que extendedProperties, c'est le
     seul champ qui bouge. Dans un agenda de travail reel, cette distinction
     est la difference entre un outil et un accident.

     Detail utile : sur une carte de proprietes, patch ajoute et remplace cle
     par cle ; il n'efface pas celles qu'on ne mentionne pas. Pour retirer une
     cle devenue inutile, il faut l'envoyer explicitement a null — c'est ce que
     fait proprietes() pour les morceaux « ap2 », « ap3 »… en trop.
     ========================================================================== */

  function envoyerEtat(idAgenda, idEvenement, etat, privActuel) {
    var p = proprietes(privActuel, etat);
    if (p.trop) {
      noter('trop-long', 'etat trop volumineux pour l\'evenement ' + idEvenement,
            { octets: p.octets, morceaux: p.morceaux });
      say('tropLong');
      /* RIEN N'EST PERDU : la copie locale garde le texte entier. On refuse
         seulement de l'envoyer a Google, qui le refuserait de toute facon. */
      return Promise.reject(Object.assign(new Error('trop long'), { tropLong: true }));
    }
    var corps = corpsSur({ extendedProperties: { private: p.props } }, null);
    return api('/calendars/' + encodeURIComponent(idAgenda) + '/events/' + encodeURIComponent(idEvenement),
      { methode: 'PATCH', corps: corps, params: { sendUpdates: 'none' } });
  }

  /* ==========================================================================
     12. LA FILE D'ATTENTE HORS LIGNE
     --------------------------------------------------------------------------
     Dans un atelier, le reseau va et vient. Une case cochee sans reseau ne
     doit pas etre perdue, et ne doit pas non plus partir en double au retour.

     DANS L'ORDRE : la file est une liste, on la vide du debut vers la fin.
     SANS DOUBLON : deux modifications du meme evenement ne font pas deux
     lignes. La seconde vient completer la premiere, a la place que la premiere
     occupait deja. C'est le bon comportement : ce qu'on envoie n'est pas « un
     geste » mais « l'etat complet du casier », donc seul le dernier compte.
     ========================================================================== */

  function file()       { var f = jget(K.file, []); return Array.isArray(f) ? f : []; }
  function poserFile(f) { jset(K.file, f); emettre('file', { enAttente: f.length }); }
  function dansLaFile(cal, ev) {
    return file().some(function (e) { return e.cal === cal && e.ev === ev; });
  }

  function enfiler(cal, ev, etat, privActuel) {
    var f = file();
    var i = -1;
    for (var k = 0; k < f.length; k++) if (f[k].cal === cal && f[k].ev === ev) { i = k; break; }
    /* « DIFFEREE » : cette entree ne peut pas partir tout de suite. C'est le
       seul renseignement qui manquait pour savoir, au moment de l'envoi, s'il
       faut d'abord aller relire ce que Google porte (voir vider()). Une entree
       qui herite d'une entree differee le reste : l'artisan peut tres bien
       cocher une deuxieme case avant que le reseau ne revienne. */
    var horsLigne = (typeof navigator !== 'undefined' && navigator.onLine === false);
    var entree = {
      n: (i >= 0 ? f[i].n : 'e' + maintenant().toString(36) + Math.random().toString(36).slice(2, 6)),
      cal: cal, ev: ev, etat: etat, priv: privActuel || null,
      par: 'artisan',                       // l'origine, verifiee a l'envoi
      q: maintenant(), essais: (i >= 0 ? f[i].essais : 0),
      differe: ((i >= 0 && f[i].differe) || horsLigne || !connecte()) ? 1 : 0
    };
    if (i >= 0) f[i] = entree; else f.push(entree);
    poserFile(f);
    delete A_RENVOYER['g|' + h32(cal) + '|' + ev];
    return entree;
  }

  /* UNE ENTREE QUI A ATTENDU. Trois signes, et un seul suffit : elle a ete
     posee hors ligne, elle a deja echoue une fois, ou elle dort depuis plus de
     dix secondes. Les trois disent la meme chose — le monde a pu bouger entre
     le geste de l'artisan et le depart de son envoi. */
  var DELAI_IMMEDIAT = 10000;
  function differee(e) {
    if (!e) return false;
    if (e.differe) return true;
    if ((e.essais || 0) > 0) return true;
    return (maintenant() - (e.q || 0)) > DELAI_IMMEDIAT;
  }

  /* ------------------------------------------------------------------------
     RELIRE AVANT D'ENVOYER — LA REGLE DU CHAMP PAR CHAMP VAUT AUSSI ICI.
     Ce qui se perdait : le bureau hors ligne coche « Extrait de roles », le
     telephone hors ligne coche « Timbre fiscal ». Au retour du reseau, chaque
     appareil envoyait SON etat local complet, et le second effacait le premier.
     La regle « dernier ecrivain gagne au niveau du CHAMP » existait pour la
     lecture (fusionner(), section 10) mais la file, elle, passait a cote.

     On relit donc l'evenement chez Google JUSTE AVANT l'envoi, et on fusionne
     coche par coche avec les horodatages individuels qui sont deja la. Puis on
     envoie le resultat fusionne, et on le range aussi chez nous : l'appareil
     doit montrer ce qu'il vient d'envoyer, pas ce qu'il croyait avant.

     ON NE RELIT PAS POUR RIEN. Une case cochee reseau au vert part sans
     detour : son entree a moins de dix secondes, rien n'a pu bouger entre
     temps, et doubler chaque envoi d'une lecture couterait une seconde a
     chaque clic.
     ------------------------------------------------------------------------ */
  function preparerEnvoi(e) {
    if (!differee(e)) return Promise.resolve({ etat: e.etat, priv: e.priv, fusion: false });
    return api('/calendars/' + encodeURIComponent(e.cal) + '/events/' + encodeURIComponent(e.ev), {})
      .then(function (ev) {
        if (!ev || !ev.id) return { etat: e.etat, priv: e.priv, fusion: false };
        var distant = lireCasier(ev) || { at: {} };
        var f = fusionner(e.etat || {}, distant);
        var idTache = idDe(e.cal, ev);
        var sk = serieDe(e.cal, ev);
        poserOmbre(idTache, f.etat);
        appliquerDansStore(idTache, sk, f.etat);
        if (EVENEMENTS[idTache]) { EVENEMENTS[idTache].ev = evReduit(ev); }
        if (f.versLocal) {
          noter('fusion', 'envoi differe fusionne avec ce que Google portait : ' + (ev.summary || ev.id));
          emettre('fusion', { id: idTache });
        }
        return {
          etat: f.etat,
          priv: (ev.extendedProperties && ev.extendedProperties.private) || null,
          fusion: !!f.versLocal
        };
      }, function (err) {
        /* L'evenement n'existe plus chez Google : il n'y a plus de casier ou
           poser quoi que ce soit. On le dit au journal et on laisse l'appelant
           retirer l'entree — insister dix fois ne ferait que bloquer le reste
           de la file. */
        if (err && (err.gone || err.statut === 404)) {
          noter('echec', 'rendez-vous disparu chez Google — envoi abandonne : ' + e.ev, e);
          return null;
        }
        throw err;
      });
  }

  var videEnCours = false;
  function vider() {
    if (videEnCours) return Promise.resolve(0);
    var f = file();
    if (!f.length) return Promise.resolve(0);
    if (typeof navigator !== 'undefined' && navigator.onLine === false) { say('horsLigne'); return Promise.resolve(0); }
    if (!connecte()) return Promise.resolve(0);

    videEnCours = true;
    var partis = 0, fusions = 0;

    function retirer(e) {
      var f3 = file();
      var j = f3.findIndex(function (x) { return x.n === e.n; });
      if (j >= 0) f3.splice(j, 1);
      poserFile(f3);
    }

    function suivante() {
      var f2 = file();
      if (!f2.length) return Promise.resolve();
      var e = f2[0];
      if (!origineValide(e)) { f2.shift(); poserFile(f2); return suivante(); }

      return preparerEnvoi(e).then(function (prep) {
        if (!prep) { retirer(e); return suivante(); }      // evenement disparu
        if (prep.fusion) fusions++;
        return envoyerEtat(e.cal, e.ev, prep.etat, prep.priv).then(function () {
          var f3 = file();
          /* On retire par numero, pas par position : pendant l'envoi, l'artisan
             a pu cocher autre chose et la file a pu bouger. Et on ne retire que
             si l'entree est restee celle qu'on a envoyee — sinon ce qu'il
             vient de cocher partirait a la poubelle sans etre jamais parti. */
          var j = f3.findIndex(function (x) { return x.n === e.n; });
          if (j >= 0 && egal(f3[j].etat, e.etat)) f3.splice(j, 1);
          poserFile(f3);
          partis++;
          return suivante();
        });
      }, function (err) {
        var f3 = file();
        var j = f3.findIndex(function (x) { return x.n === e.n; });
        if (err && err.tropLong) {
          if (j >= 0) f3.splice(j, 1);          // inutile d'insister, on a prevenu
          poserFile(f3);
          return suivante();
        }
        /* PAS DE JETON, OU UN JETON REFUSE : CE N'EST PAS LA FAUTE DE CETTE
           ENTREE. On ne compte pas d'essai — sinon dix expirations suffiraient
           a jeter le travail de l'artisan — on ne retire rien, et on arrete la
           file ici. Elle repartira d'elle-meme a la reconnexion, dans l'ordre
           et sans doublon, parce que ce qu'on envoie est un ETAT et non un
           geste. Le bandeau, lui, est deja a l'ecran : gauth l'a leve. */
        if (err && (err.auth || err.jeton)) {
          if (j >= 0) { f3[j].differe = 1; f3[j].raison = String(err && err.message || err); poserFile(f3); }
          noter('auth', 'file en attente d\'une liaison Google valide — ' + f3.length + ' envoi(s) gardes');
          say('horsLigne');
          throw err;
        }
        if (j >= 0) {
          f3[j].essais = (f3[j].essais || 0) + 1;
          f3[j].differe = 1;
          f3[j].raison = String(err && err.message || err);
          /* Apres dix echecs, on met de cote au lieu de bloquer tout le reste
             (un evenement supprime entre-temps, par exemple). */
          if (f3[j].essais >= 10) { noter('echec', 'abandon apres 10 essais : ' + f3[j].raison, f3[j]); f3.splice(j, 1); }
          poserFile(f3);
        }
        throw err;
      });
    }

    function finir() {
      videEnCours = false;
      /* Une fusion a change ce que l'appareil sait : il faut le montrer, et le
         ranger dans la reserve pour la prochaine ouverture. */
      if (fusions) { ranger(); rendre(); }
    }

    return suivante().then(function () {
      finir();
      if (partis) { say('fileVidee'); emettre('envoye', { total: partis }); }
      return partis;
    }, function (err) {
      finir();
      avert('file : ' + (err && err.message));
      return partis;
    });
  }

  /* ==========================================================================
     13. LES REGLAGES QUI N'APPARTIENNENT A AUCUN EVENEMENT
     --------------------------------------------------------------------------
     Les sections et les categories que l'artisan cree lui-meme, ses
     preferences : rien de tout cela ne concerne un evenement en particulier.
     Il n'y a donc pas de casier ou les ranger.

     DEUX SOLUTIONS ETAIENT POSSIBLES. VOICI CELLE QU'ON A CHOISIE, ET POURQUOI.

     REJETE — un evenement technique cache dans l'agenda.
     C'est la solution la plus simple a ecrire : un evenement en l'an 1970,
     marque « ne pas toucher », qui contiendrait les reglages. Mais c'est un
     evenement. Il apparaitra dans l'application Google Agenda du telephone.
     Il ressortira dans les recherches. Il se retrouvera dans les exports. Et
     le jour ou l'artisan fera le menage dans son agenda, il le supprimera —
     legitimement, puisqu'il ne l'a pas cree — et ses sections disparaitront
     sans que personne comprenne pourquoi. Sa regle est qu'on ne salit pas son
     agenda : un evenement fantome, c'est exactement ce qu'elle interdit.

     RETENU — un fichier invisible dans Google Drive (appDataFolder).
     C'est un dossier prive que Google reserve a chaque application. Il
     n'apparait NULLE PART dans Drive : ni dans la liste des fichiers, ni dans
     la recherche, ni dans la corbeille. Seule cette application peut le lire
     et l'ecrire ; aucune autre, meme du meme compte. Il suit le compte, donc
     le bureau et le telephone y trouvent la meme chose. L'agenda, lui, reste
     absolument propre.

     LE PRIX A PAYER : une permission de plus a accorder (drive.appdata). Elle
     est etroite — elle ne donne acces a RIEN d'autre dans Drive, pas un seul
     fichier de l'artisan. Et si elle est refusee, ce n'est pas grave : les
     reglages restent sur l'appareil, le moteur le dit clairement, et tout le
     reste continue de fonctionner.
     ========================================================================== */

  var FICHIER_REGLAGES = 'agendapro-reglages.json';
  var FICHIER_CLASSEMENT = 'agendapro-classement.json';
  var idFichiers = {};      // nom de fichier -> id Drive, une fois trouve

  function driveDisponible() { return JETON.permsDrive || reglages().driveOk; }

  function trouverFichier(nom) {
    nom = nom || FICHIER_REGLAGES;
    if (idFichiers[nom]) return Promise.resolve(idFichiers[nom]);
    return api(DRIVE + '/files', {
      absolu: true,
      params: { spaces: 'appDataFolder', q: "name='" + nom + "'", fields: 'files(id,name,modifiedTime)', pageSize: 10 }
    }).then(function (d) {
      var f = (d && d.files && d.files[0]) || null;
      idFichiers[nom] = f ? f.id : null;
      return idFichiers[nom];
    });
  }

  function lireNuage(nom) {
    if (!driveDisponible()) return Promise.resolve(null);
    return trouverFichier(nom).then(function (id) {
      if (!id) return null;
      return api(DRIVE + '/files/' + id, { absolu: true, params: { alt: 'media' } });
    }).catch(function (e) { avert('lecture de ' + nom + ' : ' + (e && e.message)); return null; });
  }
  function lireReglagesNuage() { return lireNuage(FICHIER_REGLAGES); }
  function ecrireReglagesNuage(objet) { return ecrireNuage(FICHIER_REGLAGES, objet); }

  function ecrireNuage(nom, objet, deuxieme) {
    if (!driveDisponible()) { say('reglagesLocaux'); return Promise.resolve(false); }
    var contenu = JSON.stringify(Object.assign({ v: 1, q: maintenant() }, objet || {}));
    return trouverFichier(nom).then(function (id) {
      if (id) {
        return api(DRIVE_UP + '/files/' + id, {
          absolu: true, methode: 'PATCH', params: { uploadType: 'media' },
          entetes: { 'Content-Type': 'application/json; charset=UTF-8' }, corps: contenu
        }).then(function () { return true; }).catch(function (e) {
          /* Le fichier a ete supprime du Drive entre-temps : son identifiant
             est mort. On l'oublie et on recree le fichier — une fois. */
          if (!deuxieme && e && (e.statut === 404 || /404|not found/i.test(String(e.message || '')))) {
            idFichiers[nom] = null;
            return ecrireNuage(nom, objet, true);
          }
          throw e;
        });
      }
      /* Creation : Google veut les informations du fichier et son contenu dans
         un meme envoi, separes par une frontiere choisie par nous. */
      var f = '-------agendapro' + maintenant().toString(36);
      var meta = JSON.stringify({ name: nom, parents: ['appDataFolder'], mimeType: 'application/json' });
      var corps =
        '--' + f + '\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n' + meta + '\r\n' +
        '--' + f + '\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n' + contenu + '\r\n' +
        '--' + f + '--';
      return api(DRIVE_UP + '/files', {
        absolu: true, methode: 'POST', params: { uploadType: 'multipart', fields: 'id' },
        entetes: { 'Content-Type': 'multipart/related; boundary=' + f }, corps: corps
      }).then(function (d) { idFichiers[nom] = d && d.id; return true; });
    }).catch(function (e) { avert('ecriture de ' + nom + ' : ' + (e && e.message)); return false; });
  }

  /* ==========================================================================
     LE CLASSEMENT PARTAGE.
     Le bureau connait, pour chaque serie de rendez-vous, sa section
     (entreprise / personnel), sa sous-categorie et si c'est une routine :
     c'est ecrit dans ses propres donnees. Le telephone, lui, ne recoit de
     Google que des rendez-vous nus, et rangeait tout dans « personnel ».
     Le bureau depose donc ce classement — des identifiants de series et
     trois lettres, rien de lisible — dans le dossier prive de l'application
     sur le Drive de l'artisan ; le telephone le reprend a la liaison et une
     fois par jour. Aucun serveur a nous, rien de public.
     ========================================================================== */
  var CLASSEMENT = null;
  function classement() {
    if (CLASSEMENT === null) {
      var c = jget(K.classement, null);
      CLASSEMENT = (c && c.s && typeof c.s === 'object') ? c : { v: 1, q: 0, s: {} };
    }
    return CLASSEMENT;
  }
  function classementMonter(paquet, opts) {
    opts = opts || {};
    if (paquet && paquet.s && typeof paquet.s === 'object' && Object.keys(paquet.s).length) {
      var avant = JSON.stringify(classement().s);
      CLASSEMENT = { v: 1, q: maintenant(), s: paquet.s };
      jset(K.classement, CLASSEMENT);
      /* les jumeaux Google du bureau prennent leur section sans attendre */
      if (JSON.stringify(paquet.s) !== avant) rendre();
    }
    var c = classement();
    if (!Object.keys(c.s).length) return Promise.resolve(false);
    /* Sans la permission Drive : le classement reste local, et on ne le
       repete pas a chaque lecture — le pont le dit une fois. */
    if (opts.sansDrive || !driveDisponible()) return Promise.resolve(false);
    return ecrireNuage(FICHIER_CLASSEMENT, { s: c.s }).then(function (ok) {
      if (ok) dire('classement depose sur le Drive : ' + Object.keys(c.s).length + ' serie(s).');
      return ok;
    });
  }
  function classementDescendre() {
    if (!driveDisponible()) return Promise.resolve(false);
    return lireNuage(FICHIER_CLASSEMENT).then(function (d) {
      if (!d || !d.s || typeof d.s !== 'object') return false;
      var avant = JSON.stringify(classement().s);
      CLASSEMENT = { v: 1, q: maintenant(), s: d.s };
      jset(K.classement, CLASSEMENT);
      dire('classement repris du Drive : ' + Object.keys(d.s).length + ' serie(s).');
      if (JSON.stringify(d.s) !== avant) rendre();
      return true;
    });
  }
  /* A la fin d'une lecture : on reprend le classement s'il manque ou s'il
     date de plus d'un jour. Sans reseau ni Drive, rien ne se passe. */
  /* Demande la permission Drive maintenant, sur un geste de l'artisan (le
     bouton l'appelle directement : Google exige un clic, pas un appel en
     arriere-plan). Si Google l'accorde, on va aussitot chercher le
     classement — inutile d'attendre le prochain cycle. */
  function demanderDrive() {
    return jetonValide({ interactif: true, avecDrive: true, force: true }).then(function () {
      poserReglages({ driveOk: JETON.permsDrive });
      if (!JETON.permsDrive) return false;
      return classementDescendre().then(function () { return true; });
    });
  }
  function classementRafraichir() {
    var c = classement();
    if (Object.keys(c.s).length && (maintenant() - (c.q || 0)) < 24 * 60 * 60 * 1000) return;
    classementDescendre().catch(function () { });
  }

  /* Ce qu'on fait monter : uniquement ce que l'artisan a cree lui-meme. */
  function reglagesLocaux() {
    var s = P.store || {};
    return {
      sections: (s.sections || []).slice(),
      subs:     (s.subs || []).slice(),
      pref:     { agendas: reglages().agendas, agendaEcrit: reglages().agendaEcrit,
                  joursPasses: reglages().joursPasses, joursFuturs: reglages().joursFuturs }
    };
  }

  function reglagesMonter() { return ecrireReglagesNuage(reglagesLocaux()); }

  function reglagesDescendre() {
    return lireReglagesNuage().then(function (d) {
      if (!d || !P.store) return false;
      var s = P.store, change = false;
      /* On ajoute ce qui manque, on ne supprime jamais : une section effacee
         ici effacerait des taches la-bas. Une suppression volontaire se fait
         dans le tableau de bord, des deux cotes. */
      ['sections', 'subs'].forEach(function (quoi) {
        var ici = s[quoi] = s[quoi] || [];
        (d[quoi] || []).forEach(function (x) {
          if (!x || !x.id) return;
          if (!ici.some(function (y) { return y.id === x.id; })) { ici.push(x); change = true; }
        });
      });
      if (d.pref) poserReglages(d.pref);
      if (change) {
        sauverLocal();
        try { if (P.rebuildBoards) P.rebuildBoards(); else repeindre(); } catch (e) {}
      }
      return change;
    });
  }

  /* ==========================================================================
     14. LES ECRITURES DE L'ARTISAN
     --------------------------------------------------------------------------
     Toutes passent par ici, et toutes se ressemblent : on modifie la copie
     locale, on horodate LE CHAMP concerne, on range dans la file, on essaie
     d'envoyer. Si le reseau manque, la file garde tout pour plus tard.
     ========================================================================== */

  function ecrire(idTache, modif) {
    var e = EVENEMENTS[idTache];
    if (!e) return false;                        // pas une tache Google : rien a faire
    var o = ombreDe(idTache);
    var etat = Object.assign({ at: {} }, o.e || {});
    etat.at = Object.assign({}, (o.e && o.e.at) || {});

    modif(etat, maintenant());

    poserOmbre(idTache, etat);
    appliquerDansStore(idTache, serieDe(e.cal, e.ev), etat);
    var priv = (e.ev.extendedProperties && e.ev.extendedProperties.private) || null;
    enfiler(e.cal, e.ev.id, etat, priv);
    vider();
    return true;
  }

  function setStatus(idTache, statut) {
    return ecrire(idTache, function (etat, q) {
      if (statut) etat.st = statut; else delete etat.st;
      etat.at.st = q;
    });
  }
  function setNote(idTache, texte) {
    return ecrire(idTache, function (etat, q) {
      if (texte) etat.nt = String(texte); else delete etat.nt;
      etat.at.nt = q;
    });
  }
  /* La check-list. `liste` est l'ordre des libelles, `coches` ceux qui sont
     faits. On horodate SEULEMENT les cases qui viennent de changer : c'est
     exactement ce qui permet a deux appareils de cocher deux lignes
     differentes sans se marcher dessus. */
  function setChecklist(idTache, liste, coches) {
    return ecrire(idTache, function (etat, q) {
      var avant = (etat.ck && etat.ck.d) || [];
      var listeAvant = (etat.ck && etat.ck.l) || [];
      var heures = Object.assign({}, (etat.ck && etat.ck.a) || {});
      (liste || []).forEach(function (lab) {
        var etaitCoche = avant.indexOf(lab) >= 0, estCoche = (coches || []).indexOf(lab) >= 0;
        if (etaitCoche !== estCoche) heures[h32(lab)] = q;
      });
      etat.ck = { l: (liste || []).slice(), d: (coches || []).slice(), a: heures };
      if (!egal(listeAvant, liste || [])) etat.at.cl = q;
    });
  }
  function setContact(idTache, v) { return ecrire(idTache, function (e, q) { if (v) e.ct = String(v); else delete e.ct; e.at.ct = q; }); }
  function setLieu(idTache, v)    { return ecrire(idTache, function (e, q) { if (v) e.pl = String(v); else delete e.pl; e.at.pl = q; }); }
  function setSousCat(idTache, v) { return ecrire(idTache, function (e, q) { if (v) e.sb = String(v); else delete e.sb; e.at.sb = q; }); }
  function setSection(idTache, v) { return ecrire(idTache, function (e, q) { if (v) e.sc = String(v); else delete e.sc; e.at.sc = q; }); }
  function setRoutine(idTache, v) { return ecrire(idTache, function (e, q) { e.rt = v ? 1 : 0; e.at.rt = q; }); }

  /* Renvoyer ce que l'appareil avait de plus recent et qui n'etait pas dans la
     file (voir section 10). C'est une action de l'artisan, donc autorisee. */
  function renvoyerLocaux() {
    var ids = Object.keys(A_RENVOYER);
    ids.forEach(function (id) {
      var e = EVENEMENTS[id];
      if (!e) { delete A_RENVOYER[id]; return; }
      var o = ombreDe(id);
      enfiler(e.cal, e.ev.id, o.e || {}, (e.ev.extendedProperties && e.ev.extendedProperties.private) || null);
      delete A_RENVOYER[id];
    });
    return vider().then(function () { return ids.length; });
  }

  /* --- EXCEPTION N°1 : une tache que l'artisan cree lui-meme ---------------
     C'est le seul endroit du fichier ou summary, start et end sont autorises,
     et c'est legitime : cet evenement n'existait pas avant, l'artisan vient de
     le creer. On le marque « ow:1 » dans son casier, ce qui permettra plus
     tard de savoir qu'il vient du programme. */
  function creerTache(t) {
    t = t || {};
    var titre = String(t.titre || t.title || '').trim();
    if (!titre) return Promise.reject(new Error('titre vide'));
    var cal = t.agenda || reglages().agendaEcrit || 'primary';
    var debut, fin;
    if (t.heure) {
      debut = { dateTime: new Date(t.date + 'T' + t.heure + ':00').toISOString() };
      var f = new Date(t.date + 'T' + (t.fin || t.heure) + ':00');
      if (!t.fin) f.setHours(f.getHours() + 1);
      fin = { dateTime: f.toISOString() };
    } else {
      var d1 = new Date(t.date + 'T00:00:00'); d1.setDate(d1.getDate() + 1);
      debut = { date: t.date };
      fin   = { date: isoJour(d1) };          // Google veut une fin exclusive
    }
    var etat = { at: {} };
    var q = maintenant();
    if (t.statut) { etat.st = t.statut; etat.at.st = q; }
    if (t.notes)  { etat.nt = t.notes;  etat.at.nt = q; }
    if (t.sub)    { etat.sb = t.sub;    etat.at.sb = q; }
    if (t.sec)    { etat.sc = t.sec;    etat.at.sc = q; }
    if (t.liste && t.liste.length) { etat.ck = { l: t.liste.slice(), d: [], a: {} }; etat.at.cl = q; }
    etat.ow = 1;

    var p = proprietes(null, etat);
    if (p.trop) { say('tropLong'); return Promise.reject(new Error('trop long')); }

    var corps = corpsSur({
      summary: titre,
      description: String(t.desc || ''),
      start: debut, end: fin,
      extendedProperties: { private: p.props }
    }, ['summary', 'description', 'start', 'end']);      // <- l'exception, nommee

    noter('creation', 'tache creee par l\'artisan : ' + titre, { agenda: cal });
    return api('/calendars/' + encodeURIComponent(cal) + '/events',
      { methode: 'POST', corps: corps, params: { sendUpdates: 'none' } })
      .then(function (ev) {
        absorber(cal, ev);
        rendre();
        say('envoye');
        return tacheDe(idDe(cal, ev));
      });
  }

  /* --- EXCEPTION N°2 : une modification demandee explicitement -------------
     Deux verrous, pas un :
       - l'appelant doit passer explicite:true (c'est l'ecran qui le met, apres
         avoir demande a l'artisan) ;
       - l'evenement doit avoir ete cree par le programme (ow:1), SAUF si
         l'appelant passe aussi forcer:true, ce qui n'existe que pour le cas ou
         l'artisan veut vraiment retoucher un evenement qu'il a ecrit a la main
         dans Google. Dans ce cas, le journal garde une trace nominative. */
  function modifierTache(idTache, champs, opts) {
    opts = opts || {};
    var e = EVENEMENTS[idTache];
    if (!e) return Promise.reject(new Error('tache inconnue'));
    if (opts.explicite !== true) {
      noter('refus', 'modification sans demande explicite — bloquee : ' + idTache);
      return Promise.reject(new Error('modification non demandee explicitement'));
    }
    var casier = lireCasier(e.ev) || {};
    if (!casier.ow && opts.forcer !== true) {
      noter('refus', 'modification d\'un evenement non cree par le programme — bloquee : ' + (e.ev.summary || idTache));
      return Promise.reject(new Error('cet evenement n\'a pas ete cree par le programme'));
    }
    var brut = {}, permis = [];
    if (champs.titre !== undefined) { brut.summary = String(champs.titre); permis.push('summary'); }
    if (champs.desc  !== undefined) { brut.description = String(champs.desc); permis.push('description'); }
    if (champs.date) {
      if (champs.heure) {
        brut.start = { dateTime: new Date(champs.date + 'T' + champs.heure + ':00').toISOString() };
        var f = new Date(champs.date + 'T' + (champs.fin || champs.heure) + ':00');
        if (!champs.fin) f.setHours(f.getHours() + 1);
        brut.end = { dateTime: f.toISOString() };
      } else {
        var d1 = new Date(champs.date + 'T00:00:00'); d1.setDate(d1.getDate() + 1);
        brut.start = { date: champs.date }; brut.end = { date: isoJour(d1) };
      }
      permis.push('start', 'end');
    }
    var corps = corpsSur(brut, permis);
    noter('modification', 'modification explicite de ' + (e.ev.summary || idTache), { champs: permis, force: !!opts.forcer });
    return api('/calendars/' + encodeURIComponent(e.cal) + '/events/' + encodeURIComponent(e.ev.id),
      { methode: 'PATCH', corps: corps, params: { sendUpdates: 'none' } })
      .then(function (ev) { absorber(e.cal, ev); rendre(); say('envoye'); return true; });
  }

  /* ==========================================================================
     15. L'ADAPTATEUR
     --------------------------------------------------------------------------
     L'artisan l'a demande en toutes lettres : « plus tard on ajoutera
     l'autre ». Ce moteur-ci ne s'installe donc pas a la place unique : il
     s'inscrit dans un petit annuaire, AP.moteurs, sous une forme que n'importe
     quel autre moteur peut prendre.

     TROIS VERBES, PAS UN DE PLUS :
        lire()                     va chercher ce qui a change
        ecrire(idTache, champs)    enregistre une modification de l'artisan
        reglages.lire()/.ecrire()  ce qui n'appartient a aucun evenement

     Le jour ou la synchronisation Supabase revient, elle s'inscrit a cote avec
     les memes trois verbes. Le tableau de bord appellera les deux, ou l'un, ou
     l'autre, sans qu'une ligne de ce fichier ait a changer.
     ========================================================================== */

  var moteur = {
    nom: 'google',
    version: VERSION,
    capacites: { evenements: true, reglages: true, horsLigne: true, tempsReel: false },
    pret: function () { return connecte() && agendasSuivis().length > 0; },
    lire: function () { return pull(); },
    ecrire: function (idTache, champs) {
      champs = champs || {};
      var fait = false;
      if ('statut'  in champs) fait = setStatus(idTache, champs.statut)    || fait;
      if ('notes'   in champs) fait = setNote(idTache, champs.notes)       || fait;
      if ('contact' in champs) fait = setContact(idTache, champs.contact)  || fait;
      if ('lieu'    in champs) fait = setLieu(idTache, champs.lieu)        || fait;
      if ('sub'     in champs) fait = setSousCat(idTache, champs.sub)      || fait;
      if ('sec'     in champs) fait = setSection(idTache, champs.sec)      || fait;
      if ('liste'   in champs) fait = setChecklist(idTache, champs.liste, champs.coches || []) || fait;
      return fait;
    },
    taches:   function () { return tasks(); },
    reglages: { lire: reglagesDescendre, ecrire: reglagesMonter }
  };
  AP.moteurs = AP.moteurs || {};
  AP.moteurs.google = moteur;

  /* ==========================================================================
     16. LE BRANCHEMENT SUR LE TABLEAU DE BORD
     --------------------------------------------------------------------------
     Bonne nouvelle : dans index.html, les FONCTIONS declarees au premier
     niveau (setStatus, setNote, setCheck, setMeta, moveCat, buildTasks)
     existent bien sur window — seules les variables let/const n'y sont pas.
     On peut donc les envelopper : la fonction d'origine fait son travail
     habituel, puis on ajoute le notre. Zero ligne a modifier dans index.html.

     On n'enveloppe QU'UNE FOIS, et seulement quand un agenda est reellement
     suivi : un moteur endormi ne doit rien changer au comportement du
     tableau de bord.
     ========================================================================== */

  var enveloppe = false;
  function envelopper() {
    if (enveloppe) return;
    enveloppe = true;

    var paires = [
      ['setStatus', function (a) { if (estGoogle(a[0])) setStatus(a[0], a[1]); }],
      ['setNote',   function (a) { if (estGoogle(a[0])) setNote(a[0], a[1]); }],
      ['moveCat',   function (a) { if (estGoogle(a[0])) setSection(a[0], (P.store && P.store.cat) ? P.store.cat[a[0]] : null); }]
    ];
    paires.forEach(function (p) {
      var nom = p[0], apres = p[1], orig = window[nom];
      if (typeof orig !== 'function' || orig.__apg) return;
      var neuf = function () {
        var r = orig.apply(this, arguments);
        try { apres(arguments); } catch (e) { avert(nom + ' : ' + e.message); }
        return r;
      };
      neuf.__apg = true;
      window[nom] = neuf;
    });

    /* setCheck(it, i, on) recoit la TACHE, pas son identifiant. On relit la
       liste apres coup dans store : elle y est deja, index.html vient de
       l'ecrire. */
    if (typeof window.setCheck === 'function' && !window.setCheck.__apg) {
      var oSC = window.setCheck;
      var nSC = function (it, i, on) {
        var r = oSC.apply(this, arguments);
        try {
          if (it && estGoogle(it.id) && P.store && P.store.checks) {
            var c = P.store.checks[it.id] || {};
            setChecklist(it.id, c.list || [], c.done || []);
          }
        } catch (e) { avert('setCheck : ' + e.message); }
        return r;
      };
      nSC.__apg = true; window.setCheck = nSC;
    }
    ['addCheck', 'delCheck'].forEach(function (nom) {
      var o = window[nom];
      if (typeof o !== 'function' || o.__apg) return;
      var n = function (it) {
        var r = o.apply(this, arguments);
        try {
          if (it && estGoogle(it.id) && P.store && P.store.checks) {
            var c = P.store.checks[it.id] || {};
            setChecklist(it.id, c.list || [], c.done || []);
          }
        } catch (e) { avert(nom + ' : ' + e.message); }
        return r;
      };
      n.__apg = true; window[nom] = n;
    });

    /* setMeta(kind, sk, v) : contact et lieu, ranges par SERIE. On retrouve
       toutes les taches de cette serie et on ecrit sur celle qui porte la
       serie — pour une repetition, Google fait redescendre la propriete sur
       toutes les occurrences. */
    if (typeof window.setMeta === 'function' && !window.setMeta.__apg) {
      var oSM = window.setMeta;
      var nSM = function (genre, sk, v) {
        var r = oSM.apply(this, arguments);
        try {
          if (String(sk).indexOf('g:') === 0) {
            Object.keys(EVENEMENTS).forEach(function (id) {
              var e = EVENEMENTS[id];
              if (serieDe(e.cal, e.ev) !== sk) return;
              if (genre === 'contact') setContact(id, v);
              if (genre === 'place')   setLieu(id, v);
            });
          }
        } catch (e) { avert('setMeta : ' + e.message); }
        return r;
      };
      nSM.__apg = true; window.setMeta = nSM;
    }

    /* buildTasks() : index.html reconstruit sa liste et y oublie forcement les
       taches Google, qu'il ne connait pas. On les y remet juste apres.
       Si un jour la ligne recommandee est ajoutee dans buildTasks(), ce bout
       de code s'en apercoit (les taches sont deja la) et ne fait rien. */
    if (typeof window.buildTasks === 'function' && !window.buildTasks.__apg) {
      var oBT = window.buildTasks;
      var nBT = function () {
        var r = oBT.apply(this, arguments);
        try { injecter(); } catch (e) { avert('injection : ' + e.message); }
        return r;
      };
      nBT.__apg = true; window.buildTasks = nBT;
    }
  }

  function estGoogle(id) { return typeof id === 'string' && id.indexOf('g|') === 0 && !!EVENEMENTS[id]; }

  /* Verser nos taches dans le tableau `TASKS` que le pont nous tend. On ecrit
     DANS le tableau existant (push), on ne le remplace pas : index.html en
     garde la reference dans sa variable `let TASKS`. */
  function injecter() {
    if (!P.TASKS) return 0;
    var liste = P.TASKS();
    if (!liste || typeof liste.push !== 'function') return 0;
    var deja = {};
    for (var i = liste.length - 1; i >= 0; i--) {
      if (liste[i] && liste[i].src === 'google') {
        if (deja[liste[i].id]) liste.splice(i, 1); else deja[liste[i].id] = 1;
      }
    }
    var ajoutees = 0;
    tasks().forEach(function (t) { if (!deja[t.id]) { liste.push(t); ajoutees++; } });
    liste.sort(function (a, b) {
      return a.date === b.date ? (a.start || '').localeCompare(b.start || '') : a.date.localeCompare(b.date);
    });
    return ajoutees;
  }

  /* Reconstruire et reafficher, dans le bon ordre. */
  function rendre() {
    try {
      if (P.buildTasks) P.buildTasks();     // recalcule la liste de index.html
      /* Si buildTasks est celui que le pont a enveloppe, il vient DEJA
         d injecter les taches Google (et de dedoublonner) : refaire injecter()
         ici retriait dix mille lignes pour rien. On ne le fait que pour un
         buildTasks nu. */
      if (!(P.buildTasks && P.buildTasks.__apPont)) injecter();
      repeindre();
    } catch (e) { avert('rendre : ' + e.message); }
  }

  /* ==========================================================================
     17. LE CYCLE DE VIE
     --------------------------------------------------------------------------
     POINT 7 DU CAHIER DES CHARGES, VERIFIABLE LIGNE A LIGNE : ni init(), ni
     connecter(), ni pull(), ni aucune fonction de cette section n'appelle
     envoyerEtat(). Le seul chemin vers une ecriture part de ecrire(), qui part
     de setStatus/setNote/setChecklist/..., qui partent d'un geste de
     l'artisan. Ouvrir le programme ne modifie AUCUN evenement.
     ========================================================================== */

  var minuterie = null;

  function pull(opts) {
    opts = opts || {};
    if (ETAT.enCours) return Promise.resolve(false);
    var ids = agendasSuivis();
    if (!ids.length) return Promise.resolve(false);
    if (!connecte()) return Promise.resolve(false);

    /* LA LISTE EST VIDE : ON RELIT TOUT, ET PAS LE SEUL DELTA.
       Le curseur du syncToken ne rapporte QUE ce qui a change depuis la
       derniere fois. Demander un delta quand on ne tient rien, c'est repartir
       de cinq rendez-vous au lieu de sept cent soixante-dix-sept. La reserve
       evite normalement d'en arriver la ; ce filet est pour les jours ou elle
       n'a pas pu etre ecrite — navigation privee, quota plein, stockage coupe.
       UNE SEULE FOIS PAR SESSION : un agenda reellement vide ne doit pas
       declencher une lecture complete toutes les cinq minutes. */
    var complet = !!opts.complet;
    if (!complet && !Object.keys(EVENEMENTS).length && !ETAT.derniereComplete) {
      complet = true;
      dire('aucun rendez-vous en memoire — lecture complete plutot que le simple delta.');
    }

    ETAT.enCours = true; ETAT.erreur = null;
    emettre('lecture', { debut: true });

    var chaine = Promise.resolve();
    ids.forEach(function (id) {
      chaine = chaine.then(function () { return lireAgenda(id, complet); })
        .catch(function (e) {
          ETAT.erreur = String(e && e.message || e);
          noter('echec', 'lecture de ' + id + ' : ' + ETAT.erreur);
        });
    });

    return chaine.then(function () {
      ETAT.enCours = false;
      ETAT.derniereLecture = maintenant();
      poserReglages({ dejaConnecte: true });
      /* On range AVANT de dessiner : si la page est fermee dans la seconde,
         ce qui vient d'etre lu est deja a l'abri pour demain matin. */
      ecrireOmbres();
      ranger();
      /* On laisse le navigateur respirer entre l ecriture de la reserve et
         le dessin : la page repond, puis se redessine. Le pont (gbridge)
         n appelle plus rendre() de son cote sur 'lecture fin' : UNE passe. */
      setTimeout(function () {
        rendre();
        emettre('lecture', { fin: true, taches: Object.keys(EVENEMENTS).length });
        classementRafraichir();
      }, 0);
      /* La file part APRES la lecture : ce qui attendait depuis hors ligne est
         alors compare a l'etat le plus frais, et ne repart pas a l'aveugle. */
      return vider().then(function () { return true; });
    }, function (e) {
      ETAT.enCours = false; ETAT.erreur = String(e && e.message || e);
      return false;
    });
  }

  function connecter() {
    say('connexion');
    return jetonValide({ interactif: true, avecDrive: true }).then(function () {
      poserReglages({ dejaConnecte: true, driveOk: JETON.permsDrive });
      say('connecte');
      return chargerAgendas();
    }).then(function (liste) {
      envelopper();
      demarrerMinuterie();
      /* Premiere lecture seulement si l'artisan a deja choisi ses agendas.
         Sinon on lui rend la liste et on attend qu'il coche. */
      if (agendasSuivis().length) { reglagesDescendre(); classementDescendre().catch(function () { }); pull({ complet: true }); }
      return liste;
    }, function (e) {
      avert('connexion : ' + (e && e.message));
      say('refuse');
      throw e;
    });
  }

  function deconnecter() {
    oublierJeton();
    poserReglages({ dejaConnecte: false });
    if (minuterie) { clearInterval(minuterie); minuterie = null; }
    EVENEMENTS = {};
    ETAT.derniereLecture = 0; ETAT.derniereComplete = 0;
    ranger();                     // la reserve se vide avec la memoire
    say('deconnecte');
    rendre();
    /* On ne touche NI a la file d'attente NI aux ombres : si l'artisan se
       reconnecte, ce qu'il a fait hors ligne partira enfin. */
    return true;
  }

  function demarrerMinuterie() {
    if (minuterie) return;
    /* Toutes les cinq minutes : assez pour que le bureau voie vite ce que le
       telephone a fait, assez peu pour ne pas user la batterie ni le quota. */
    minuterie = setInterval(function () {
      if (document.hidden) return;
      pull();
    }, 5 * 60 * 1000);

    /* Au retour du reseau : on vide la file, puis on relit. */
    window.addEventListener('online', function () { vider().then(function () { pull(); }); });
    /* Quand l'artisan revient sur la page apres l'avoir laissee de cote. */
    document.addEventListener('visibilitychange', function () {
      if (!document.hidden && (maintenant() - ETAT.derniereLecture) > 60000) pull();
    });
  }

  function init() {
    if (AP.gsync.__demarre) return AP.gsync;
    AP.gsync.__demarre = true;
    dire('moteur Google ' + VERSION + ' — en place.');

    if (!clientId()) { dire(tr('pasConfigure') + ' Le moteur reste en sommeil.'); return AP.gsync; }
    if (!reglages().dejaConnecte) { dire('jamais connecte — on attend AP.gsync.connecter().'); return AP.gsync; }

    /* LE TABLEAU DE BORD EST PLEIN AVANT MEME QUE LE RESEAU AIT REPONDU.
       C'est la premiere chose qu'on fait, et elle ne demande rien a personne :
       on relit la reserve. Sans elle, l'artisan ouvrait son programme sur cinq
       rendez-vous, et attendait que Google veuille bien lui rendre le reste —
       ou, quand le delta ne rapportait rien, il attendait pour toujours. */
    if (restaurer()) { envelopper(); rendre(); }

    /* Deja connecte une fois : on tente un jeton SILENCIEUX. S'il vient,
       tout repart tout seul ; s'il ne vient pas, on ne derange pas l'artisan
       avec une fenetre qu'il n'a pas demandee — un bouton est la pour ca. */
    jetonValide({ interactif: false }).then(function () {
      return reveiller();
    }).catch(function (e) {
      dire('reprise silencieuse impossible (' + (e && e.message) + ') — on retentera des que la liaison sera prete.');
      emettre('jeton', { ok: false });
    });
    return AP.gsync;
  }

  /* SE METTRE AU TRAVAIL, MAINTENANT QUE LE JETON EST LA.
     Depuis que le jeton appartient a gauth et non plus a ce fichier, il
     n'arrive plus forcement pendant init() : la reprise silencieuse de gauth
     peut aboutir une demi-seconde plus tard, ou seulement quand l'artisan a
     repondu au bandeau. Sans cette porte, le moteur restait muet en attendant
     un evenement qui etait deja passe. Le pont l'appelle des que le compte
     annonce « relie ». */
  var reveilEnCours = false;
  function reveiller() {
    if (reveilEnCours) return Promise.resolve(false);
    if (!clientId() || !reglages().dejaConnecte) return Promise.resolve(false);
    reveilEnCours = true;
    envelopper();
    demarrerMinuterie();
    return chargerAgendas().then(function () {
      reglagesDescendre();
      return pull();
    }).then(function () {
      reveilEnCours = false;
      return true;
    }, function (e) {
      reveilEnCours = false;
      dire('reveil du moteur : ' + (e && e.message));
      return false;
    });
  }

  /* ==========================================================================
     18. L'ETAT COURANT, POUR L'ECRAN DE REGLAGES
     ========================================================================== */
  function info() {
    return {
      version: VERSION,
      configure: !!clientId(),
      connecte: connecte(),
      drive: driveDisponible(),
      agendas: agendas(),
      suivis: agendasSuivis(),
      taches: Object.keys(EVENEMENTS).length,
      enAttente: file().length,
      aRenvoyer: Object.keys(A_RENVOYER).length,
      derniereLecture: ETAT.derniereLecture || 0,
      derniereComplete: ETAT.derniereComplete || 0,
      ecartHorloge: ECART,
      erreur: ETAT.erreur,
      fenetre: { passe: reglages().joursPasses, futur: reglages().joursFuturs }
    };
  }

  /* ==========================================================================
     19. LA SURFACE PUBLIQUE
     ========================================================================== */
  AP.gsync = Object.assign(AP.gsync || {}, {
    init: init,
    bind: bind,
    on: on, off: off,

    connecter: connecter,
    deconnecter: deconnecter,
    reveiller: reveiller,
    setTokenProvider: setTokenProvider,

    agendas: agendas,
    chargerAgendas: chargerAgendas,
    suivre: suivre,
    reglages: reglages,
    poserReglages: poserReglages,

    pull: pull,
    tasks: tasks,
    injecter: injecter,

    setStatus: setStatus,
    setNote: setNote,
    setChecklist: setChecklist,
    setContact: setContact,
    setLieu: setLieu,
    setSousCat: setSousCat,
    setSection: setSection,
    setRoutine: setRoutine,

    creerTache: creerTache,
    modifierTache: modifierTache,

    file: file,
    vider: vider,
    renvoyerLocaux: renvoyerLocaux,
    aRenvoyer: function () { return Object.assign({}, A_RENVOYER); },

    reglagesMonter: reglagesMonter,
    reglagesDescendre: reglagesDescendre,
    classement: classement,
    classementMonter: classementMonter,
    classementDescendre: classementDescendre,
    demanderDrive: demanderDrive,

    journal: function () { return jget(K.journal, []); },
    viderJournal: function () { jset(K.journal, []); return true; },

    info: info,
    i18n: TXT,
    tr: tr,

    /* Exposes parce qu'un ecran de reglages ou un test en a besoin. Ce ne sont
       pas des portes derobees : aucune n'ecrit dans l'agenda. */
    _: {
      encoder: encoder, decouper: decouper, proprietes: proprietes,
      lireCasier: lireCasier, fusionner: fusionner, corpsSur: corpsSur,
      h32: h32, octets: octets, idDe: idDe, serieDe: serieDe,
      tacheDe: tacheDe, evenements: function () { return EVENEMENTS; },
      ranger: ranger, restaurer: restaurer, evReduit: evReduit,
      refusAuth: refusAuth, differee: differee
    }
  });

})();
