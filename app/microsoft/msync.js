/* ============================================================================
   AGENDA PRO — app/microsoft/msync.js
   LE MOTEUR DE LECTURE MICROSOFT (Outlook / Microsoft 365 — calendrier ET
   Microsoft To Do), publie sous window.AP.msync.

   Le jumeau de app/google/gsync.js, en plus modeste et volontairement plus
   modeste : CE FICHIER NE FAIT QUE LIRE. Il n'ecrit rien chez Microsoft, ne
   cree aucune tache, ne coche rien la-bas. Trois raisons a ce choix :

     1. C'est exactement ce que l'artisan a demande : voir ses rendez-vous et
        ses taches Microsoft a cote de ceux de Google, pas les modifier.
     2. Une regle d'ecriture digne de ce nom (comme celle de gauth.js, PARTIE
        3) est un chantier a part entiere ; l'improviser pour gagner du temps
        reviendrait a bricoler avec le VRAI compte Microsoft de l'artisan.
     3. Moins de portees demandees (aucune ecriture), c'est un ecran de
        consentement plus court et plus rassurant la premiere fois.

   Les statuts, notes et documents coches que l'artisan pose ICI sur une tache
   venue de Microsoft restent locaux a l'appareil (comme pour un rendez-vous
   Google avant l'ecriture) — voir ombres(), PARTIE 6. Rien ne repart vers
   Microsoft. Si ce chantier est demande un jour, il aura sa propre regle
   d'ecriture, aussi stricte que celle de Google.

   TANT QU'AUCUN microsoftClientId N'EST CONNU, CE FICHIER NE FAIT RIEN.
   ============================================================================ */

(function () {
  'use strict';

  var W = window;
  W.AP = W.AP || {};
  var AP = W.AP;
  if (AP.msync) { return; }

  var CFG = W.AP_CONFIG || {};


  /* =========================================================================
     PARTIE 1 — LE DICTIONNAIRE
     ========================================================================= */

  var T = {
    ar: {
      pasConfigure: 'لم يتم إعداد Microsoft بعد.',
      calendrier:   'تقويم',
      liste:        'قائمة مهام (To Do)'
    },
    fr: {
      pasConfigure: 'Microsoft n\'est pas encore configure.',
      calendrier:   'Calendrier',
      liste:        'Liste de taches (To Do)'
    }
  };
  function langue() {
    if (AP.ui && typeof AP.ui.lang === 'function') { return AP.ui.lang(); }
    var l = (document.documentElement.lang || '').toLowerCase();
    return (l.indexOf('fr') === 0) ? 'fr' : 'ar';
  }
  function tr(cle) { var d = T[langue()] || T.ar; return d[cle] || T.ar[cle] || ''; }
  function dire() {
    if (!CFG.microsoftDebug) { return; }
    try { console.log.apply(console, ['[msync]'].concat([].slice.call(arguments))); } catch (e) { }
  }


  /* =========================================================================
     PARTIE 2 — LE RANGEMENT SUR LE DISQUE
     ---------------------------------------------------------------------
     Les memes cles que mauth.js pour clientId/dejaConnecte : une seule verite
     partagee, comme Google le fait deja pour gauth.js/gsync.js.
     ========================================================================= */

  var K = {
    reglages: 'agendapro_m_reglages_v1',
    evs:      'agendapro_m_evenements_v1',
    ombre:    'agendapro_m_ombre_v1',
    jetons:   'agendapro_m_curseurs_v1',
    journal:  'agendapro_m_journal_v1'
  };

  function jget(cle, defaut) {
    try { var v = JSON.parse(W.localStorage.getItem(cle)); return (v == null) ? defaut : v; }
    catch (e) { return defaut; }
  }
  function jset(cle, val) {
    try { W.localStorage.setItem(cle, JSON.stringify(val)); return true; }
    catch (e) { return false; }
  }

  var DEFAUTS = { dejaConnecte: false, agendas: {}, joursPasses: 90, joursFuturs: 400 };

  function reglages() {
    var r = jget(K.reglages, {});
    return Object.assign({}, DEFAUTS, r, { agendas: Object.assign({}, DEFAUTS.agendas, r.agendas || {}) });
  }
  function poserReglages(patch) {
    var r = Object.assign({}, jget(K.reglages, {}), patch || {});
    jset(K.reglages, r);
    return reglages();
  }

  function clientId() {
    return (CFG.microsoftClientId || jget(K.reglages, {}).clientId || '').trim();
  }


  /* =========================================================================
     PARTIE 3 — L'ETAT EN MEMOIRE : AGENDAS CONNUS, EVENEMENTS TENUS
     ========================================================================= */

  var AGENDAS = [];              // [{id, nom, type:'calendrier'|'liste', principal}]
  var EVENEMENTS = {};           // idTache -> { cal, type, item }
  var ETAT = { derniereLecture: 0, derniereComplete: 0, erreur: null };

  function ranger() {
    jset(K.evs, { agendas: AGENDAS, evs: EVENEMENTS, etat: ETAT });
  }
  function restaurer() {
    var p = jget(K.evs, null);
    if (!p) { return; }
    AGENDAS = p.agendas || [];
    EVENEMENTS = p.evs || {};
    ETAT = Object.assign({ derniereLecture: 0, derniereComplete: 0, erreur: null }, p.etat || {});
  }
  restaurer();


  /* =========================================================================
     PARTIE 4 — LE JETON, FOURNI PAR mauth.js (meme prise que Google)
     ========================================================================= */

  var fournisseur = null;
  function setTokenProvider(fn) {
    fournisseur = (typeof fn === 'function') ? fn : null;
    dire('fournisseur de jeton', fournisseur ? 'installe' : 'retire');
    return AP.msync;
  }

  function jetonValide(opts) {
    if (!fournisseur) { return Promise.reject(new Error(tr('pasConfigure'))); }
    return fournisseur(opts || {}).then(function (r) {
      if (!r || !r.token) { throw new Error('jeton Microsoft indisponible'); }
      return r.token;
    });
  }

  /* Un GET Graph, avec le renouvellement-et-un-seul-nouvel-essai comme chez
     Google. `outlook.timezone` normalise TOUTES les heures en UTC : sans ce
     reglage, Graph rend les heures dans le fuseau du calendrier, avec des
     noms de fuseaux Windows (« Arab Standard Time ») qu'il faudrait ensuite
     retraduire. En UTC, `new Date(iso + 'Z')` suffit et rend l'heure LOCALE
     de l'appareil — exactement ce que le reste du programme attend. */
  function appelGraph(url, opts) {
    opts = opts || {};
    function envoyer(jeton, deuxiemeEssai) {
      var entetes = { Authorization: 'Bearer ' + jeton };
      if (opts.horloge !== false) { entetes.Prefer = 'outlook.timezone="UTC"'; }
      return fetch(url, { headers: entetes }).then(function (r) {
        if (r.status === 401 && !deuxiemeEssai) {
          return jetonValide({ interactif: false, refuse: jeton }).then(function (neuf) {
            return envoyer(neuf, true);
          });
        }
        if (!r.ok) {
          return r.text().then(function (t) {
            var e = new Error('Microsoft a refuse (' + r.status + ')');
            e.name = 'AP_MICROSOFT'; e.statut = r.status; e.detail = t;
            throw e;
          });
        }
        return r.json();
      });
    }
    return jetonValide({ interactif: false }).then(function (j) { return envoyer(j, false); });
  }

  function toutesLesPages(premiereUrl, cleValeur) {
    var out = [];
    function page(url) {
      return appelGraph(url).then(function (r) {
        out = out.concat(r[cleValeur] || r.value || []);
        var suite = r['@odata.nextLink'];
        if (suite) { return page(suite); }
        return r['@odata.deltaLink'] || null;
      });
    }
    return page(premiereUrl).then(function (deltaLink) { return { items: out, deltaLink: deltaLink }; });
  }


  /* =========================================================================
     PARTIE 5 — DECOUVRIR LES AGENDAS ET LES LISTES
     ========================================================================= */

  function chargerAgendas() {
    if (!clientId()) { return Promise.resolve([]); }
    return Promise.all([
      appelGraph('https://graph.microsoft.com/v1.0/me/calendars?$select=id,name,isDefaultCalendar&$top=100'),
      appelGraph('https://graph.microsoft.com/v1.0/me/todo/lists?$select=id,displayName,wellknownListName&$top=100')
    ]).then(function (r) {
      var cals = (r[0] && r[0].value) || [];
      var listes = (r[1] && r[1].value) || [];
      AGENDAS = cals.map(function (c) {
        return { id: c.id, nom: c.name, type: 'calendrier', principal: !!c.isDefaultCalendar };
      }).concat(listes.map(function (l) {
        return { id: l.id, nom: l.displayName, type: 'liste', principal: l.wellknownListName === 'defaultList' };
      }));
      ranger();
      return AGENDAS.slice();
    }).catch(function (e) {
      ETAT.erreur = e && e.message;
      dire('chargerAgendas:', e && e.message);
      return AGENDAS.slice();
    });
  }

  function agendas() { return AGENDAS.slice(); }
  function nomAgenda(id) {
    var a = AGENDAS.filter(function (x) { return x.id === id; })[0];
    return a ? a.nom : id;
  }
  function typeAgenda(id) {
    var a = AGENDAS.filter(function (x) { return x.id === id; })[0];
    return a ? a.type : null;
  }

  function agendasSuivis() {
    var r = reglages(); var out = [];
    Object.keys(r.agendas || {}).forEach(function (id) { if (r.agendas[id] && r.agendas[id].suivi) { out.push(id); } });
    return out;
  }

  function suivre(id, oui, defaut) {
    var r = reglages();
    var a = Object.assign({}, r.agendas[id] || {}, { suivi: !!oui });
    if (oui && defaut) { a.sec = defaut.sec || a.sec || 'perso'; a.sub = defaut.sub || a.sub || 'perso'; }
    if (!a.nom) { a.nom = nomAgenda(id); }
    if (!a.type) { a.type = typeAgenda(id); }
    var agendasR = Object.assign({}, r.agendas, {}); agendasR[id] = a;
    poserReglages({ agendas: agendasR });
    if (!oui) {
      // On oublie ce qu'on tenait de cet agenda, et son curseur de reprise :
      // la prochaine fois qu'il sera suivi, on repartira d'une lecture neuve.
      Object.keys(EVENEMENTS).forEach(function (k) { if (EVENEMENTS[k].cal === id) { delete EVENEMENTS[k]; } });
      var j = jget(K.jetons, {}); delete j[id]; jset(K.jetons, j);
      ranger();
    }
    return true;
  }

  function setSectionAgenda(id, sec, sub) {
    var r = reglages();
    var a = Object.assign({}, r.agendas[id] || {}, { sec: sec, sub: sub });
    var agendasR = Object.assign({}, r.agendas, {}); agendasR[id] = a;
    poserReglages({ agendas: agendasR });
    return true;
  }


  /* =========================================================================
     PARTIE 6 — LES OMBRES (les choix de l'artisan, par-dessus Microsoft)
     ========================================================================= */

  function ombres() { return jget(K.ombre, {}); }
  function poserOmbre(idTache, patch) {
    var o = ombres();
    o[idTache] = Object.assign({}, o[idTache] || {}, patch);
    jset(K.ombre, o);
    return true;
  }
  function setSection(idTache, val) { return poserOmbre(idTache, { sc: val }); }
  function setSousCat(idTache, val) { return poserOmbre(idTache, { sb: val }); }


  /* =========================================================================
     PARTIE 7 — LECTURE : LE CALENDRIER (delta), LA LISTE DE TACHES (delta)
     ========================================================================= */

  function jourPlusISO(n) {
    var d = new Date(); d.setHours(0, 0, 0, 0); d.setDate(d.getDate() + n);
    return d.toISOString().replace(/\.\d+Z$/, 'Z');
  }

  function syncCalendrier(id, complet) {
    var jetons = jget(K.jetons, {});
    var url = (!complet && jetons[id]) ? jetons[id] : null;
    if (!url) {
      var r = reglages();
      var debut = jourPlusISO(-Math.abs(r.joursPasses || 90));
      var fin = jourPlusISO(Math.abs(r.joursFuturs || 400));
      url = 'https://graph.microsoft.com/v1.0/me/calendars/' + encodeURIComponent(id) + '/calendarView/delta' +
        '?startDateTime=' + encodeURIComponent(debut) + '&endDateTime=' + encodeURIComponent(fin) +
        '&$select=subject,start,end,isAllDay,bodyPreview,location,webLink,seriesMasterId,type' +
        '&$top=250';
    }
    return toutesLesPages(url).then(function (res) {
      res.items.forEach(function (ev) {
        var idTache = 'm|' + id + '|' + ev.id;
        if (ev['@removed']) { delete EVENEMENTS[idTache]; return; }
        /* L'objet « seriesMaster » lui-meme (pas une occurrence) apparait dans
           le delta quand l'artisan modifie toute une serie recurrente (« celui-
           ci et les suivants », un nouveau motif de repetition). Sa date est
           l'ancre de la serie — parfois des annees dans le passe — et non le
           jour reel de la modification : le ranger produirait une case
           fantome, mal datee, sans lien apparent avec ce que l'artisan vient
           de faire. Les occurrences individuelles de la serie continuent
           d'arriver normalement, avec leur propre date. */
        if (ev.type === 'seriesMaster') { delete EVENEMENTS[idTache]; return; }
        EVENEMENTS[idTache] = { cal: id, type: 'evenement', item: ev };
      });
      if (res.deltaLink) { jetons[id] = res.deltaLink; jset(K.jetons, jetons); }
      return res.items.length;
    });
  }

  function syncListe(id, complet) {
    var jetons = jget(K.jetons, {});
    var url = (!complet && jetons[id]) ? jetons[id]
      : 'https://graph.microsoft.com/v1.0/me/todo/lists/' + encodeURIComponent(id) + '/tasks/delta' +
        '?$select=title,status,dueDateTime,body,isReminderOn&$top=250';
    return toutesLesPages(url).then(function (res) {
      res.items.forEach(function (t) {
        var idTache = 'm|' + id + '|' + t.id;
        if (t['@removed']) { delete EVENEMENTS[idTache]; return; }
        EVENEMENTS[idTache] = { cal: id, type: 'tache', item: t };
      });
      if (res.deltaLink) { jetons[id] = res.deltaLink; jset(K.jetons, jetons); }
      return res.items.length;
    });
  }

  var enCours = false;
  function pull(opts) {
    opts = opts || {};
    if (!clientId()) { return Promise.resolve(false); }
    if (enCours) { return Promise.resolve(false); }
    var ids = agendasSuivis();
    if (!ids.length) { return Promise.resolve(false); }

    enCours = true;
    ETAT.erreur = null;
    var complet = !!opts.complet;

    /* Menage : un agenda retire des reglages ailleurs (autre onglet) ne doit
       pas laisser ses rendez-vous a l'ecran. */
    var suivi = {}; ids.forEach(function (id) { suivi[id] = 1; });
    Object.keys(EVENEMENTS).forEach(function (k) { if (!suivi[EVENEMENTS[k].cal]) { delete EVENEMENTS[k]; } });

    var chaine = Promise.resolve();
    ids.forEach(function (id) {
      chaine = chaine.then(function () {
        var t = typeAgenda(id) || (reglages().agendas[id] || {}).type;
        return (t === 'liste' ? syncListe(id, complet) : syncCalendrier(id, complet))
          .catch(function (e) { ETAT.erreur = e && e.message; dire('pull(' + id + '):', e && e.message); });
      });
    });

    return chaine.then(function () {
      enCours = false;
      ETAT.derniereLecture = Date.now();
      if (complet && !ETAT.erreur) { ETAT.derniereComplete = Date.now(); }
      ranger();
      try { if (typeof W.buildTasks === 'function') { W.buildTasks(); } } catch (e) { }
      return true;
    }, function (e) {
      enCours = false; ETAT.erreur = e && e.message; ranger();
      return false;
    });
  }


  /* =========================================================================
     PARTIE 8 — TRANSFORMER UN EVENEMENT / UNE TACHE EN « tache » DU PROGRAMME
     ========================================================================= */

  function jourDeISO(iso) { return String(iso || '').slice(0, 10); }
  function heureLocale(iso) {
    try {
      var d = new Date(/Z$|[+-]\d\d:\d\d$/.test(iso) ? iso : (iso + 'Z'));
      var h = d.getHours(), m = d.getMinutes();
      return (h < 10 ? '0' : '') + h + ':' + (m < 10 ? '0' : '') + m;
    } catch (e) { return ''; }
  }
  function jourLocal(iso) {
    try {
      var d = new Date(/Z$|[+-]\d\d:\d\d$/.test(iso) ? iso : (iso + 'Z'));
      var m = d.getMonth() + 1, j = d.getDate();
      return d.getFullYear() + '-' + (m < 10 ? '0' : '') + m + '-' + (j < 10 ? '0' : '') + j;
    } catch (e) { return jourDeISO(iso); }
  }

  function tacheEvenement(idTache, e, regl) {
    var ev = e.item;
    var etat = (ombres()[idTache] || {});
    var parAgenda = (regl.agendas[e.cal] || {});
    var titre = (ev.subject || '').trim() || (langue() === 'fr' ? '(sans titre)' : '(بدون عنوان)');
    var toutLeJour = !!ev.isAllDay;

    var jour = toutLeJour ? jourDeISO(ev.start && ev.start.dateTime) : jourLocal(ev.start && ev.start.dateTime);
    var finJourBrut = toutLeJour ? jourDeISO(ev.end && ev.end.dateTime) : null;
    /* Meme convention que Google : Microsoft donne aussi la fin EXCLUSIVE
       d'un evenement d'une journee entiere (le lendemain). */
    var dfin = null;
    if (toutLeJour && finJourBrut && finJourBrut > jour) {
      try { dfin = jourDeISO(new Date(new Date(finJourBrut + 'T00:00:00Z').getTime() - 86400000).toISOString()); }
      catch (er) { dfin = null; }
    }

    return {
      id: idTache,
      sk: 'm|' + (ev.seriesMasterId || ev.id) + '|' + e.cal,
      src: 'microsoft',
      title: { ar: titre, fr: titre },
      raw: titre,
      cat: etat.sc || parAgenda.sec || 'perso',
      sub: etat.sb || parAgenda.sub || 'perso',
      date: jour,
      start: toutLeJour ? '' : heureLocale(ev.start && ev.start.dateTime),
      end: toutLeJour ? '' : heureLocale(ev.end && ev.end.dateTime),
      endDate: dfin || jour,
      allDay: toutLeJour,
      desc: (ev.bodyPreview || '').trim(),
      org: { ar: nomAgenda(e.cal), fr: nomAgenda(e.cal) },
      loc: (ev.location && ev.location.displayName) || '',
      routine: !!ev.seriesMasterId,
      link: ev.webLink || '',
      mcal: e.cal,
      mev: ev.id
    };
  }

  function tacheDeTodo(idTache, e, regl) {
    var t = e.item;
    /* Une tache Microsoft To Do sans echeance n'a pas de case dans un
       programme organise par jour : on ne l'affiche pas (elle reste dans
       Microsoft To Do, intacte). Une tache deja terminee non plus : elle est
       faite, elle n'a plus sa place dans le planning. */
    if (!t.dueDateTime || !t.dueDateTime.dateTime) { return null; }
    if (t.status === 'completed') { return null; }

    var etat = (ombres()[idTache] || {});
    var parAgenda = (regl.agendas[e.cal] || {});
    var titre = (t.title || '').trim() || (langue() === 'fr' ? '(sans titre)' : '(بدون عنوان)');
    /* Volontairement JOUR SEUL, jamais d'heure : la date d'echeance d'une
       tache voyage avec le fuseau de l'appareil qui l'a posee, et Microsoft
       ne l'homogeneise pas comme il le fait pour le calendrier. Une tache est
       un « a faire ce jour-la », pas un rendez-vous a une minute pres. */
    var jour = jourDeISO(t.dueDateTime.dateTime);

    return {
      id: idTache,
      sk: idTache,
      src: 'microsoft',
      title: { ar: titre, fr: titre },
      raw: titre,
      cat: etat.sc || parAgenda.sec || 'perso',
      sub: etat.sb || parAgenda.sub || 'perso',
      date: jour,
      start: '', end: '',
      endDate: jour,
      allDay: true,
      desc: (t.body && t.body.content || '').trim(),
      org: { ar: nomAgenda(e.cal), fr: nomAgenda(e.cal) },
      loc: '',
      routine: false,
      link: '',
      mcal: e.cal,
      mev: t.id
    };
  }

  function tacheDe(idTache) {
    var e = EVENEMENTS[idTache];
    if (!e) { return null; }
    var regl = reglages();
    return (e.type === 'liste' || e.type === 'tache')
      ? tacheDeTodo(idTache, e, regl)
      : tacheEvenement(idTache, e, regl);
  }

  function tasks() {
    var out = [];
    Object.keys(EVENEMENTS).forEach(function (id) { var t = tacheDe(id); if (t) { out.push(t); } });
    return out;
  }


  /* =========================================================================
     PARTIE 9 — DEMARRAGE, RENSEIGNEMENTS, DECONNEXION
     ========================================================================= */

  var reveilEnCours = false;
  function reveiller() {
    if (reveilEnCours) { return Promise.resolve(false); }
    if (!clientId() || !reglages().dejaConnecte) { return Promise.resolve(false); }
    reveilEnCours = true;
    return chargerAgendas().then(function () { return pull({ complet: false }); })
      .then(function () { reveilEnCours = false; return true; })
      .catch(function (e) { reveilEnCours = false; dire('reveil:', e && e.message); return false; });
  }

  function deconnecter() {
    EVENEMENTS = {}; AGENDAS = [];
    ETAT = { derniereLecture: 0, derniereComplete: 0, erreur: null };
    jset(K.jetons, {});
    /* agendas: {} EFFACE la table des agendas suivis, pas seulement le drapeau
       de connexion. Sans cela, un artisan qui delie puis relie un AUTRE compte
       Microsoft (autre entreprise, autre boite mail) repartirait avec les
       VIEUX identifiants de calendrier/liste — qui n'existent pas chez le
       nouveau compte — et pull() echouerait sur chacun d'eux en silence. */
    poserReglages({ dejaConnecte: false, agendas: {} });
    ranger();
    try { if (typeof W.buildTasks === 'function') { W.buildTasks(); } } catch (e) { }
    return true;
  }

  function info() {
    return {
      configure: !!clientId(),
      connecte: !!reglages().dejaConnecte,
      agendas: AGENDAS.slice(),
      suivis: agendasSuivis(),
      /* tasks().length, pas Object.keys(EVENEMENTS).length : ce dernier
         compte aussi les taches To Do sans echeance et les taches terminees,
         que tacheDe() ecarte volontairement (PARTIE 8) — le panneau afficherait
         sinon un total qui ne correspond a rien de visible a l'ecran. */
      taches: tasks().length,
      derniereLecture: ETAT.derniereLecture,
      derniereComplete: ETAT.derniereComplete,
      erreur: ETAT.erreur,
      fenetre: { passe: reglages().joursPasses, futur: reglages().joursFuturs }
    };
  }


  /* =========================================================================
     PARTIE 10 — L'API PUBLIQUE
     ========================================================================= */

  AP.msync = {
    setTokenProvider: setTokenProvider,
    chargerAgendas: chargerAgendas,
    agendas: agendas,
    agendasSuivis: agendasSuivis,
    suivre: suivre,
    setSectionAgenda: setSectionAgenda,
    setSection: setSection,
    setSousCat: setSousCat,
    pull: pull,
    reveiller: reveiller,
    tasks: tasks,
    deconnecter: deconnecter,
    reglages: reglages,
    poserReglages: poserReglages,
    info: info,
    tr: tr,
    _: { tacheDe: tacheDe, evenements: function () { return EVENEMENTS; } }
  };

})();
