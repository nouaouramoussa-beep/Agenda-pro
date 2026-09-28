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

   LECTURE SEULE, ET C'EST UN CHOIX ASSUME. Ce fichier n'ecrit rien dans
   Google Tasks — ne coche rien, ne cree rien, ne modifie rien la-bas. Les
   memes raisons que pour app/microsoft/msync.js : c'est exactement ce qui a
   ete demande (voir les taches ici, a cote des rendez-vous), et une regle
   d'ecriture digne de ce nom est un chantier a part entiere qu'on ne bricole
   pas pour gagner du temps sur le VRAI compte de l'artisan. Un statut ou une
   note poses ICI sur une tache Google Tasks reste sur cet appareil, comme
   pour tout ce que ce produit ne renvoie pas encore.

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
    ar: { pasConfigure: 'لم يتم إعداد Google بعد.', liste: 'قائمة مهام' },
    fr: { pasConfigure: 'Google n\'est pas encore configure.', liste: 'Liste de taches' }
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
    ombre: 'agendapro_g_taches_ombre_v1'
  };

  function jget(cle, repli) {
    try { var v = JSON.parse(localStorage.getItem(cle)); return (v == null) ? repli : v; }
    catch (e) { return repli; }
  }
  function jset(cle, v) { try { localStorage.setItem(cle, JSON.stringify(v)); return true; } catch (e) { return false; } }

  function clientId() {
    return (CFG.googleClientId || jget('agendapro_g_reglages_v1', {}).clientId || '').trim();
  }

  var DEFAUTS = { listes: {} };
  function reglages() {
    var r = jget(K.cfg, {});
    return Object.assign({}, DEFAUTS, r, { listes: Object.assign({}, (r && r.listes) || {}) });
  }
  function poserReglages(patch) {
    var r = Object.assign(reglages(), patch || {});
    jset(K.cfg, r);
    return r;
  }


  /* =========================================================================
     PARTIE 3 — L'ETAT EN MEMOIRE
     ========================================================================= */

  var LISTES = [];        // [{id, nom, suivi}]
  var TACHES = {};        // idTache -> { liste, jour, tache }
  var ETAT = { derniereLecture: 0, derniereComplete: 0, erreur: null };

  function ranger() { jset(K.ev, { listes: LISTES, taches: TACHES, etat: ETAT }); }
  function restaurer() {
    var p = jget(K.ev, null);
    if (!p) { return; }
    LISTES = p.listes || [];
    TACHES = p.taches || {};
    ETAT = Object.assign({ derniereLecture: 0, derniereComplete: 0, erreur: null }, p.etat || {});
  }
  restaurer();

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

  function chargerListes() {
    if (!clientId()) { return Promise.resolve([]); }
    return toutesLesPages('/users/@me/lists', { maxResults: 100 }).then(function (items) {
      var r = reglages();
      LISTES = (items || []).map(function (l) {
        return { id: l.id, nom: l.title || l.id, suivi: !!(r.listes[l.id] || {}).suivi };
      });
      ranger();
      return listes();
    }).catch(function (e) {
      ETAT.erreur = e && e.message;
      dire('chargerListes:', e && e.message);
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
      var c = jget(K.curs, {}); delete c[idListe]; jset(K.curs, c);
      ranger();
    }
    return true;
  }


  /* =========================================================================
     PARTIE 6 — LES OMBRES (les choix de l'artisan, par-dessus Google Tasks)
     ========================================================================= */

  function ombres() { return jget(K.ombre, {}); }
  function poserOmbre(idTache, patch) {
    var o = ombres(); o[idTache] = Object.assign({}, o[idTache] || {}, patch); jset(K.ombre, o);
    return true;
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

  function lireListe(idListe, complet) {
    var curseurs = jget(K.curs, {});
    var params = { showCompleted: true, showHidden: true, showDeleted: true, maxResults: 100 };
    if (!complet && curseurs[idListe]) { params.updatedMin = curseurs[idListe]; }

    var avant = new Date(Date.now() - 60000).toISOString();   // marge d'une minute
    return toutesLesPages('/lists/' + encodeURIComponent(idListe) + '/tasks', params).then(function (items) {
      if (complet) {
        Object.keys(TACHES).forEach(function (id) { if (TACHES[id].liste === idListe) { delete TACHES[id]; } });
      }
      (items || []).forEach(function (t) {
        var idTache = idDeTache(idListe, t);
        /* Une tache supprimee, terminee, ou sans echeance n'a pas de case dans
           un programme organise par jour : elle sort de la reserve (ou n'y
           entre jamais). Elle reste intacte dans Google Tasks. */
        if (t.deleted || t.status === 'completed' || !t.due) { delete TACHES[idTache]; return; }
        TACHES[idTache] = { liste: idListe, jour: String(t.due).slice(0, 10), tache: t };
      });
      curseurs[idListe] = avant; jset(K.curs, curseurs);
      return items.length;
    });
  }

  var enCours = false;
  var enAttente = false;
  function pull(opts) {
    opts = opts || {};
    if (!clientId()) { return Promise.resolve(false); }
    /* Une synchronisation complete demandee PENDANT qu'une autre tourne deja
       (deux listes cochees coup sur coup) n'est pas ignoree pour de bon : on
       la note, et elle repart d'elle-meme des que la chaine en cours
       s'acheve — sinon la deuxieme liste cochee resterait vide en silence
       jusqu'au prochain cycle periodique. */
    if (enCours) { if (opts.complet) { enAttente = true; } return Promise.resolve(false); }
    var ids = listesSuivies();
    if (!ids.length) { return Promise.resolve(false); }

    enCours = true; ETAT.erreur = null;
    var complet = !!opts.complet;

    var suivi = {}; ids.forEach(function (id) { suivi[id] = 1; });
    Object.keys(TACHES).forEach(function (id) { if (!suivi[TACHES[id].liste]) { delete TACHES[id]; } });

    var chaine = Promise.resolve();
    ids.forEach(function (id) {
      chaine = chaine.then(function () {
        return lireListe(id, complet).catch(function (e) {
          ETAT.erreur = e && e.message;
          dire('pull(' + id + '):', e && e.message);
          /* 404 : cette liste n'existe plus chez Google (supprimee depuis un
             telephone, par exemple). On ne la retentera pas indefiniment —
             ses taches sortent de la reserve et elle est desabonnee, pour que
             la case a cocher correspondante (qui a de toute facon deja
             disparu du panneau, Google ne la listant plus) ne reste pas
             suivie sans que rien ne puisse jamais plus l'arreter. */
          if (e && e.statut === 404) {
            Object.keys(TACHES).forEach(function (tid) { if (TACHES[tid].liste === id) { delete TACHES[tid]; } });
            var c = jget(K.curs, {}); delete c[id]; jset(K.curs, c);
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

    return chaine.then(function () {
      enCours = false;
      ETAT.derniereLecture = Date.now();
      if (complet && !ETAT.erreur) { ETAT.derniereComplete = Date.now(); }
      ranger();
      try { if (typeof W.buildTasks === 'function') { W.buildTasks(); } } catch (e) { }
      if (enAttente) { enAttente = false; pull({ complet: true }); }
      return true;
    }, function (e) {
      enCours = false; ETAT.erreur = e && e.message; ranger();
      if (enAttente) { enAttente = false; pull({ complet: true }); }
      return false;
    });
  }


  /* =========================================================================
     PARTIE 8 — TRANSFORMER UNE TACHE GOOGLE EN « tache » DU PROGRAMME
     ---------------------------------------------------------------------
     La meme forme de sortie que gsync.js (voir sa PARTIE 8), src:'google' y
     compris : une tache Google Tasks doit pouvoir remplacer un rendez-vous
     ecrit en dur exactement comme un evenement Google le fait deja
     (app/google/gbridge.js, dedoublonner()), et suivre le meme choix
     « Google / Microsoft / les deux » (app/microsoft/mbridge.js, PARTIE 4).
     ========================================================================= */

  function tacheDe(idTache) {
    var e = TACHES[idTache]; if (!e) { return null; }
    var t = e.tache;
    var etat = ombres()[idTache] || {};
    var parListe = (reglages().listes[e.liste] || {});
    var titre = (t.title || '').trim() || (langue() === 'fr' ? '(sans titre)' : '(بدون عنوان)');
    return {
      id: idTache,
      sk: idTache,
      src: 'google',
      title: { ar: titre, fr: titre },
      raw: titre,
      cat: etat.sc || parListe.sec || 'perso',
      sub: etat.sb || parListe.sub || 'perso',
      date: e.jour,
      start: '', end: '',
      endDate: e.jour,
      allDay: true,
      desc: (t.notes || '').trim(),
      org: { ar: nomListe(e.liste), fr: nomListe(e.liste) },
      loc: '',
      routine: false,
      link: t.selfLink || '',
      gcal: e.liste,
      gev: t.id
    };
  }

  function tasks() {
    var out = [];
    Object.keys(TACHES).forEach(function (id) { var t = tacheDe(id); if (t) { out.push(t); } });
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

  var P = { TASKS: null, toast: null, store: null };
  function bind(p) {
    p = p || {};
    if (p.TASKS !== undefined) { P.TASKS = p.TASKS; }
    if (p.toast !== undefined) { P.toast = p.toast; }
    if (p.store !== undefined) { P.store = p.store; }
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
    return ajoutees;
  }

  /* Le geste de recategoriser une tache (le bouton qui fait tourner la
     section, moveCat() dans index.html) n'ecrit que dans `store.cat`, un
     objet local que ce fichier ne voit jamais. Sans ce raccord, le choix de
     l'artisan sur une tache Google Tasks serait efface au prochain pull() :
     tacheDe() (PARTIE 8) relit `cat: etat.sc || parListe.sec || 'perso'`, et
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
    LISTES = []; TACHES = {};
    ETAT = { derniereLecture: 0, derniereComplete: 0, erreur: null };
    jset(K.curs, {});
    ranger();
    try { if (typeof W.buildTasks === 'function') { W.buildTasks(); } } catch (e) { }
    return true;
  }

  var reveilEnCours = false;
  function reveiller() {
    if (reveilEnCours) { return Promise.resolve(false); }
    if (!clientId()) { return Promise.resolve(false); }
    reveilEnCours = true;
    envelopper();
    return chargerListes().then(function () { return pull({ complet: false }); })
      .then(function () { reveilEnCours = false; return true; })
      .catch(function (e) { reveilEnCours = false; dire('reveil:', e && e.message); return false; });
  }

  function info() {
    /* « connecte » ne suffit pas : un artisan peut avoir refuse Google Tasks
       en particulier sur l'ecran de consentement (consentement granulaire,
       voir gauth.js) tout en restant connecte pour le calendrier. On verifie
       donc la portee REELLEMENT accordee (etat().portees), exactement comme
       gauth.js le fait deja pour peutEcrire — jamais juste « connecte ». */
    var g = (AP.gauth && typeof AP.gauth.etat === 'function') ? AP.gauth.etat() : null;
    var connecte = !!(g && g.connecte && AP.gauth.PORTEE && Array.isArray(g.portees) &&
      g.portees.indexOf(AP.gauth.PORTEE.taches) >= 0);
    return {
      configure: !!clientId(),
      connecte: connecte,
      listes: LISTES.slice(),
      suivis: listesSuivies(),
      taches: tasks().length,
      derniereLecture: ETAT.derniereLecture,
      derniereComplete: ETAT.derniereComplete,
      erreur: ETAT.erreur
    };
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
    _: { tacheDe: tacheDe, taches: function () { return TACHES; } }
  };

})();
