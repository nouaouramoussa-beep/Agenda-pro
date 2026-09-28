/* ============================================================================
   AGENDA PRO — app/microsoft/mauth.js
   LA BRIQUE « CONNEXION MICROSOFT », SANS SERVEUR.
   ----------------------------------------------------------------------------
   Le jumeau de app/google/gauth.js, pour Outlook / Microsoft 365. Meme
   philosophie, memes regles, et deux differences assumees :

   1. LECTURE SEULE, POUR DE BON. Cette brique ne demande jamais le droit
      d'ecrire dans le calendrier ou les taches de l'artisan, et ne le
      demandera jamais sans un nouveau chantier explicite. On ne recopie donc
      PAS ici la « regle d'ecriture » de gauth.js (PARTIE 3) : il n'y a rien a
      proteger, puisqu'il n'y a rien a modifier. C'est le choix le plus sur
      pour une premiere liaison avec le VRAI compte Microsoft de l'artisan.

   2. PAS DE BIBLIOTHEQUE MICROSOFT CHARGEE DANS LA PAGE. Google fournit un
      petit client de jetons (« Google Identity Services ») qui gere lui-meme
      la fenetre surgissante. Microsoft n'a pas d'equivalent aussi leger sans
      charger toute la bibliotheque MSAL. On fait donc la meme chose qu'elle
      ferait, a la main : une fenetre surgissante (ou un cadre invisible pour
      le renouvellement silencieux) vers login.microsoftonline.com, protegee
      par PKCE, qui revient sur app/microsoft/callback.html — une page NUE qui
      ne fait que transmettre le resultat et se refermer. Voir ce fichier.

   LE JETON NE VA JAMAIS DANS localStorage, POUR LES MEMES RAISONS QUE gauth.js
   (relire ce fichier-la si besoin). Meme regle pour le refresh token dans le
   navigateur : contrairement au bureau (voir electron-microsoft.js), on n'en
   garde AUCUN ici, meme si Microsoft en renvoyait un — le renouvellement
   silencieux se fait par un cadre invisible avec prompt=none, exactement
   comme la Voie A de gauth.js.

   TANT QU'AUCUN microsoftClientId N'EST CONNU (app/config.js, puis le
   panneau de reglages), CE FICHIER NE FAIT RIEN.

   CE QU'IL PUBLIE : window.AP.mauth, et rien d'autre dans le global.
   ============================================================================ */

(function () {
  'use strict';

  var W = window;
  W.AP = W.AP || {};
  var AP = W.AP;

  if (AP.mauth) { return; }

  var CFG = W.AP_CONFIG || {};
  var MOI = (document.currentScript && document.currentScript.src) || '';
  var DOSSIER = MOI ? MOI.replace(/[^\/]*$/, '') : 'app/microsoft/';


  /* =========================================================================
     PARTIE 1 — LES CONSTANTES
     ========================================================================= */

  var AUTORITE = 'https://login.microsoftonline.com/common/oauth2/v2.0';
  var AUTORISATION = AUTORITE + '/authorize';
  var ECHANGE = AUTORITE + '/token';
  var GRAPH = 'https://graph.microsoft.com/v1.0';

  /* Lecture seule, un point c'est tout. openid+profile : pour que Microsoft
     nous rende un nom lisible sans appel supplementaire. offline_access :
     necessaire pour que le BUREAU obtienne un refresh token (VOIE B) ; sur le
     web, on le recoit peut-etre aussi, et on le jette sans le lire (PARTIE 8). */
  var PORTEES = ['openid', 'profile', 'offline_access', 'User.Read', 'Calendars.Read', 'Tasks.Read'];

  var MARGE_MS = 5 * 60 * 1000;         // renouvellement 5 min avant l'expiration
  var DELAI_POPUP_MS = 3 * 60 * 1000;   // 3 min pour dire oui dans la fenetre
  var DELAI_SILENCE_MS = 12 * 1000;     // 12 s pour le cadre invisible, pas plus

  var CLE_REGLAGES = 'agendapro_m_reglages_v1';


  /* =========================================================================
     PARTIE 2 — LE DICTIONNAIRE
     ========================================================================= */

  var T = {
    ar: {
      connecter:    'ربط مع Microsoft (Outlook)',
      connecte:     'مرتبط بـ Microsoft',
      connexion:    'جارٍ الربط…',
      deconnecter:  'قطع الربط',
      deconnecte:   'تم قطع الربط مع Microsoft',
      expire:       'انتهت صلاحية الربط مع Microsoft',
      reconnecter:  'إعادة الربط',
      plusTard:     'لاحقًا',
      bandeau:      'انتهت مهلة الربط مع Microsoft. أعد الربط لمتابعة القراءة.',
      refuse:       'تم إلغاء الربط. البرنامج يواصل العمل محليًا كالمعتاد.',
      erreur:       'تعذّر الربط مع Microsoft. حاول مرة أخرى لاحقًا.',
      lecture:      'قراءة فقط',
      bureauAbsent: 'الربط مع Microsoft من تطبيق سطح المكتب يحتاج تحديث البرنامج.',
      pasConfig:    'لم يتم إعداد Microsoft بعد.',
      compteInconnu:'حساب Microsoft'
    },
    fr: {
      connecter:    'Connecter Microsoft (Outlook)',
      connecte:     'Connecte a Microsoft',
      connexion:    'Connexion…',
      deconnecter:  'Deconnecter',
      deconnecte:   'Liaison Microsoft coupee',
      expire:       'La liaison Microsoft a expire',
      reconnecter:  'Se reconnecter',
      plusTard:     'Plus tard',
      bandeau:      'La liaison avec Microsoft a expire. Reconnectez-vous pour continuer la lecture.',
      refuse:       'Connexion annulee. Le programme continue en local, comme avant.',
      erreur:       'Connexion a Microsoft impossible. Reessayez plus tard.',
      lecture:      'lecture seule',
      bureauAbsent: 'La connexion Microsoft depuis l\'application de bureau demande une mise a jour du programme.',
      pasConfig:    'Microsoft n\'est pas encore configure.',
      compteInconnu:'compte Microsoft'
    }
  };

  function langue() {
    if (AP.ui && typeof AP.ui.lang === 'function') { return AP.ui.lang(); }
    var l = (document.documentElement.lang || '').toLowerCase();
    return (l.indexOf('fr') === 0) ? 'fr' : 'ar';
  }
  function M(cle) { var d = T[langue()] || T.ar; return d[cle] || T.ar[cle] || ''; }
  function toast(msg) {
    if (AP.ui && typeof AP.ui.toast === 'function') { AP.ui.toast(msg); return; }
    if (typeof W.toast === 'function') { try { W.toast(msg); } catch (e) { } }
  }
  function journal() {
    if (!CFG.microsoftDebug) { return; }
    try { console.log.apply(console, ['[mauth]'].concat([].slice.call(arguments))); } catch (e) { }
  }


  /* =========================================================================
     PARTIE 3 — L'IDENTIFIANT DU CLIENT, DEUX SOURCES (comme gauth.js)
     ========================================================================= */

  function idClient() {
    var officiel = CFG.microsoftClientId;
    if (officiel && String(officiel).trim()) { return String(officiel).trim(); }
    try {
      var brut = W.localStorage.getItem(CLE_REGLAGES);
      if (!brut) { return ''; }
      var r = JSON.parse(brut);
      return (r && r.clientId) ? String(r.clientId).trim() : '';
    } catch (e) { return ''; }
  }


  /* =========================================================================
     PARTIE 4 — L'ETAT, EN MEMOIRE SEULEMENT
     ========================================================================= */

  var S = {
    configure: !!idClient(),
    environnement: 'web',
    connecte: false,
    connexionEnCours: false,
    renouvellementEnCours: false,
    besoinReconnexion: false,
    courriel: '',
    portees: [],
    _jeton: '',
    _expireA: 0
  };

  var abonnes = [];
  var attentes = [];
  var minuteur = null;

  function prevenir() {
    var e = etat();
    for (var i = 0; i < abonnes.length; i++) { try { abonnes[i](e); } catch (err) { } }
    majPastille();
  }
  function valide() { return !!S._jeton && (Date.now() < S._expireA - 1000); }

  function poserJeton(reponse) {
    S._jeton = reponse.access_token || '';
    var secondes = parseInt(reponse.expires_in, 10);
    if (!(secondes > 0)) { secondes = 3600; }
    S._expireA = Date.now() + secondes * 1000;
    S.portees = String(reponse.scope || '').split(/\s+/).filter(Boolean);
    S.connecte = true;
    S.besoinReconnexion = false;
    try {
      var rg = JSON.parse(W.localStorage.getItem(CLE_REGLAGES) || '{}') || {};
      if (!rg.dejaConnecte) { rg.dejaConnecte = true; W.localStorage.setItem(CLE_REGLAGES, JSON.stringify(rg)); }
    } catch (e) { }
    cacherBandeau();
    armerRenouvellement();
    journal('jeton pose, expire dans', secondes, 's');
    reveillerLesAttentes(S._jeton);
    prevenir();
  }

  function oublierJeton() {
    S._jeton = ''; S._expireA = 0; S.portees = []; S.connecte = false;
    if (minuteur) { clearTimeout(minuteur); minuteur = null; }
  }

  function reveillerLesAttentes(jetonOuNull) {
    var liste = attentes; attentes = [];
    for (var i = 0; i < liste.length; i++) { try { liste[i](jetonOuNull); } catch (e) { } }
  }


  /* =========================================================================
     PARTIE 5 — QUEL ENVIRONNEMENT ?
     ========================================================================= */

  function pontBureau() {
    var d = W.AP_DESKTOP;
    if (!d || d.estBureau !== true) { return null; }
    if (typeof d.microsoftConnecter !== 'function' || typeof d.microsoftJeton !== 'function') { return null; }
    return d;
  }
  function detecterEnvironnement() {
    if (W.AP_DESKTOP && W.AP_DESKTOP.estBureau === true) {
      S.environnement = pontBureau() ? 'bureau' : 'bureau-sans-pont';
    } else { S.environnement = 'web'; }
    journal('environnement:', S.environnement);
  }


  /* =========================================================================
     PARTIE 6 — PKCE, A LA MAIN
     ========================================================================= */

  function octetsAlea(n) {
    var a = new Uint8Array(n);
    (W.crypto || W.msCrypto).getRandomValues(a);
    return a;
  }
  function base64url(octets) {
    var s = '';
    for (var i = 0; i < octets.length; i++) { s += String.fromCharCode(octets[i]); }
    return W.btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  }
  function chaineAlea(n) { return base64url(octetsAlea(n)); }

  function verifieurEtDefi() {
    var verifieur = chaineAlea(48);
    return W.crypto.subtle.digest('SHA-256', new TextEncoder().encode(verifieur)).then(function (empreinte) {
      return { verifieur: verifieur, defi: base64url(new Uint8Array(empreinte)) };
    });
  }


  /* =========================================================================
     PARTIE 7 — LA FENETRE (interactive) ET LE CADRE INVISIBLE (silencieux)
     ---------------------------------------------------------------------
     Les deux passent par la meme page nue, app/microsoft/callback.html, qui
     transmet { source:'ap-ms-auth', code, state, error } par postMessage et
     se retire. On les distingue par l'origine ET par le marqueur `source`,
     jamais par un canal qui laisserait n'importe quel script de la page
     usurper la reponse de Microsoft.
     ========================================================================= */

  var ORIGINE = W.location.origin;
  function adresseRappel() { return ORIGINE + DOSSIER + 'callback.html'; }

  function adresseAutorisation(defi, etatValeur, silencieux, loginHint) {
    var p = new URLSearchParams({
      client_id: idClient(),
      response_type: 'code',
      redirect_uri: adresseRappel(),
      response_mode: 'query',
      scope: PORTEES.join(' '),
      state: etatValeur,
      code_challenge: defi,
      code_challenge_method: 'S256'
    });
    if (silencieux) { p.set('prompt', 'none'); } else { p.set('prompt', 'select_account'); }
    if (loginHint) { p.set('login_hint', loginHint); }
    return AUTORISATION + '?' + p.toString();
  }

  function attendreMessage(filtreEtat, delaiMs) {
    return new Promise(function (resoudre) {
      var fini = false;
      function fermer(r) { if (fini) { return; } fini = true; W.removeEventListener('message', ecouter); resoudre(r); }
      function ecouter(ev) {
        if (ev.origin !== ORIGINE) { return; }
        var d = ev.data;
        if (!d || d.source !== 'ap-ms-auth' || d.state !== filtreEtat) { return; }
        fermer(d);
      }
      W.addEventListener('message', ecouter);
      setTimeout(function () { fermer(null); }, delaiMs);
    });
  }

  function demanderCodeInteractif() {
    return verifieurEtDefi().then(function (pkce) {
      var etatValeur = chaineAlea(16);
      var url = adresseAutorisation(pkce.defi, etatValeur, false, S.courriel || undefined);
      var large = 520, haut = 620;
      var fenetre;
      try {
        fenetre = W.open(url, 'ap-ms-auth',
          'width=' + large + ',height=' + haut + ',left=' + Math.max(0, (screen.width - large) / 2) +
          ',top=' + Math.max(0, (screen.height - haut) / 2));
      } catch (e) { fenetre = null; }
      if (!fenetre) { journal('fenetre surgissante bloquee'); return null; }

      return attendreMessage(etatValeur, DELAI_POPUP_MS).then(function (msg) {
        try { fenetre.close(); } catch (e) { }
        if (!msg || msg.error || !msg.code) {
          if (msg && msg.error) { journal('autorisation refusee:', msg.error, msg.errorDescription); }
          return null;
        }
        return { code: msg.code, verifieur: pkce.verifieur };
      });
    });
  }

  function demanderCodeSilencieux() {
    return verifieurEtDefi().then(function (pkce) {
      var etatValeur = chaineAlea(16);
      var url = adresseAutorisation(pkce.defi, etatValeur, true, S.courriel || undefined);
      var cadre = document.createElement('iframe');
      cadre.style.display = 'none';
      cadre.setAttribute('aria-hidden', 'true');
      cadre.src = url;
      (document.body || document.documentElement).appendChild(cadre);

      return attendreMessage(etatValeur, DELAI_SILENCE_MS).then(function (msg) {
        try { cadre.remove(); } catch (e) { }
        if (!msg || msg.error || !msg.code) { return null; }
        return { code: msg.code, verifieur: pkce.verifieur };
      });
    });
  }

  function echangerCode(code, verifieur) {
    var corps = new URLSearchParams({
      client_id: idClient(),
      scope: PORTEES.join(' '),
      code: code,
      redirect_uri: adresseRappel(),
      grant_type: 'authorization_code',
      code_verifier: verifieur
    });
    return fetch(ECHANGE, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: corps.toString()
    }).then(function (r) { return r.json().then(function (j) { return { ok: r.ok, corps: j }; }); })
      .then(function (res) {
        if (!res.ok || !res.corps || !res.corps.access_token) { return null; }
        /* On ne garde JAMAIS le refresh_token ici, meme si Microsoft en rend
           un : voir la note de tete de fichier. On ne recopie que ce qui sert. */
        return { access_token: res.corps.access_token, expires_in: res.corps.expires_in, scope: res.corps.scope };
      }).catch(function (e) { journal('echange du code:', e && e.message); return null; });
  }

  function lireLeCompte() {
    return fetch(GRAPH + '/me?$select=mail,userPrincipalName', { headers: { Authorization: 'Bearer ' + S._jeton } })
      .then(function (r) { return r.ok ? r.json() : null; })
      .then(function (d) {
        if (d) { S.courriel = d.mail || d.userPrincipalName || ''; prevenir(); }
      }).catch(function () { });
  }


  /* =========================================================================
     PARTIE 8 — LE RENOUVELLEMENT, ET LA FILE QUI ATTEND (comme gauth.js)
     ========================================================================= */

  function armerRenouvellement() {
    if (minuteur) { clearTimeout(minuteur); minuteur = null; }
    var dans = S._expireA - Date.now() - MARGE_MS;
    if (dans < 1000) { dans = 1000; }
    minuteur = setTimeout(function () { renouveler(); }, dans);
  }

  function renouveler() {
    if (S.renouvellementEnCours) { return Promise.resolve(valide()); }
    if (!S.connecte && !S._jeton) { return Promise.resolve(false); }
    S.renouvellementEnCours = true; prevenir();

    var pont = pontBureau();
    var demande = pont
      ? pont.microsoftJeton()
      : demanderCodeSilencieux().then(function (r) { return r ? echangerCode(r.code, r.verifieur) : null; });

    return demande.then(function (r) {
      S.renouvellementEnCours = false;
      if (r && r.access_token) { poserJeton(r); return true; }
      journal('renouvellement silencieux refuse — invite affichee');
      S.besoinReconnexion = true; S._jeton = ''; S._expireA = 0;
      montrerBandeau(); prevenir();
      return false;
    }).catch(function () {
      S.renouvellementEnCours = false; S.besoinReconnexion = true;
      montrerBandeau(); prevenir();
      return false;
    });
  }


  /* =========================================================================
     PARTIE 9 — LE BANDEAU (non bloquant), memes principes que gauth.js
     ========================================================================= */

  var bandeau = null, cssPosee = false;
  function poserCss() {
    if (cssPosee) { return; }
    cssPosee = true;
    try {
      var l = document.createElement('link');
      l.rel = 'stylesheet'; l.href = DOSSIER + '../google/gauth.css';
      document.head.appendChild(l);
    } catch (e) { }
  }
  function montrerBandeau() {
    if (!document.body) { return; }
    poserCss();
    if (bandeau) { bandeau.classList.add('on'); return; }
    bandeau = document.createElement('div');
    bandeau.className = 'ap-g-bandeau on';
    bandeau.setAttribute('role', 'status');
    var txt = document.createElement('span'); txt.className = 'ap-g-bandeau-txt'; txt.textContent = M('bandeau');
    var ok = document.createElement('button'); ok.className = 'ap-g-btn primaire'; ok.textContent = M('reconnecter');
    ok.onclick = function () { connecter({ interactif: true }); };
    var plusTard = document.createElement('button'); plusTard.className = 'ap-g-btn'; plusTard.textContent = M('plusTard');
    plusTard.onclick = function () { cacherBandeau(); };
    bandeau.appendChild(txt); bandeau.appendChild(ok); bandeau.appendChild(plusTard);
    document.body.appendChild(bandeau);
  }
  function cacherBandeau() { if (bandeau) { bandeau.classList.remove('on'); } }


  /* =========================================================================
     PARTIE 10 — LA PASTILLE
     ========================================================================= */

  var pastille = null;
  function creerPastille(conteneur) {
    if (!S.configure) { return null; }
    if (pastille) {
      if (conteneur && pastille.parentNode !== conteneur) { conteneur.appendChild(pastille); }
      return pastille;
    }
    poserCss();
    pastille = document.createElement('button');
    pastille.className = 'tbtn ap-g-pastille';
    pastille.type = 'button';
    pastille.onclick = function () { if (S.connecte) { ouvrirMenu(); } else { connecter({ interactif: true }); } };
    if (conteneur) { conteneur.appendChild(pastille); }
    majPastille();
    if (AP.ui && typeof AP.ui.onLang === 'function') { AP.ui.onLang(majPastille); }
    return pastille;
  }
  function majPastille() {
    if (!pastille) { return; }
    var point, texte;
    if (S.connexionEnCours) { point = '◌'; texte = M('connexion'); }
    else if (S.besoinReconnexion) { point = '⚠️'; texte = M('expire'); }
    else if (S.connecte) { point = '🟦'; texte = S.courriel || M('connecte'); }
    else { point = '🗓️'; texte = M('connecter'); }
    pastille.textContent = point + ' ' + texte;
    pastille.classList.toggle('alerte', !!S.besoinReconnexion);
    pastille.classList.toggle('actif', !!S.connecte && !S.besoinReconnexion);
    pastille.title = S.connecte ? (S.courriel || M('compteInconnu')) + ' — ' + M('lecture') : M('connecter');
  }
  function ouvrirMenu() {
    var ancien = document.getElementById('apMMenu');
    if (ancien) { ancien.remove(); return; }
    poserCss();
    var m = document.createElement('div'); m.id = 'apMMenu'; m.className = 'ap-g-menu';
    var t = document.createElement('div'); t.className = 'ap-g-menu-t'; t.textContent = S.courriel || M('compteInconnu');
    var p = document.createElement('div'); p.className = 'ap-g-menu-p'; p.textContent = M('lecture');
    var d = document.createElement('button'); d.className = 'ap-g-btn'; d.textContent = M('deconnecter');
    d.onclick = function () { m.remove(); deconnecter(); };
    m.appendChild(t); m.appendChild(p); m.appendChild(d);
    document.body.appendChild(m);
    if (pastille) {
      var r = pastille.getBoundingClientRect();
      m.style.top = (r.bottom + 8) + 'px';
      if (langue() === 'ar') { m.style.right = Math.max(8, W.innerWidth - r.right) + 'px'; }
      else { m.style.left = Math.max(8, r.left) + 'px'; }
    }
    setTimeout(function () {
      document.addEventListener('click', function fermer(e) {
        if (m.contains(e.target) || (pastille && pastille.contains(e.target))) { return; }
        m.remove(); document.removeEventListener('click', fermer);
      });
    }, 0);
  }
  function accrocherPastille() {
    if (!S.configure) { return; }
    var barre = document.querySelector('header .tools') || document.querySelector('.tools');
    if (barre) { creerPastille(barre); }
  }


  /* =========================================================================
     PARTIE 11 — CONNECTER, DECONNECTER
     ========================================================================= */

  function connecter(opts) {
    opts = opts || {};
    if (!S.configure) { return Promise.resolve(false); }
    if (S.connexionEnCours) { return Promise.resolve(S.connecte); }

    if (S.environnement === 'bureau-sans-pont') {
      toast(M('bureauAbsent'));
      return Promise.resolve(false);
    }

    S.connexionEnCours = true; prevenir();
    var pont = pontBureau();
    var demande = pont
      ? pont.microsoftConnecter()
      : demanderCodeInteractif().then(function (r) { return r ? echangerCode(r.code, r.verifieur) : null; });

    return demande.then(function (r) {
      S.connexionEnCours = false;
      if (r && r.access_token) {
        poserJeton(r);
        return lireLeCompte().then(function () { return true; });
      }
      prevenir();
      if (opts.interactif !== false) { toast(M('refuse')); }
      return false;
    }).catch(function (e) {
      S.connexionEnCours = false; prevenir();
      journal('connexion:', e && e.message);
      if (opts.interactif !== false) { toast(M('erreur')); }
      return false;
    });
  }

  function deconnecter() {
    var pont = pontBureau();
    oublierJeton();
    S.besoinReconnexion = false; S.courriel = '';
    cacherBandeau();
    reveillerLesAttentes(null);
    prevenir();
    toast(M('deconnecte'));
    try { if (pont && typeof pont.microsoftDeconnecter === 'function') { pont.microsoftDeconnecter(); } } catch (e) { }
    return Promise.resolve(true);
  }


  /* =========================================================================
     PARTIE 12 — LE JETON, TEL QUE msync.js LE DEMANDE (comme gauth.js)
     ========================================================================= */

  function jeton(opts) {
    opts = opts || {};
    var attendre = (opts.attendre !== false);
    if (!S.configure) { return Promise.resolve(null); }
    if (valide()) { return Promise.resolve(S._jeton); }
    if (!S.connecte && !S.besoinReconnexion) { return Promise.resolve(null); }
    return renouveler().then(function (ok) {
      if (ok && valide()) { return S._jeton; }
      if (!attendre) { return null; }
      montrerBandeau();
      return new Promise(function (resoudre) { attentes.push(resoudre); });
    });
  }

  function enveloppe(j) {
    return { token: j, expires_in: Math.max(1, Math.round((S._expireA - Date.now()) / 1000)), scope: S.portees.join(' ') };
  }

  function fournisseur(opts) {
    opts = opts || {};
    if (opts.refuse && opts.refuse === S._jeton) { S._jeton = ''; S._expireA = 0; }
    return jeton({ attendre: false }).then(function (j) {
      if (j) { return enveloppe(j); }
      if (opts.interactif) {
        return connecter({ interactif: true }).then(function (ok) {
          if (!ok || !valide()) { throw new Error('autorisation interrompue'); }
          return enveloppe(S._jeton);
        });
      }
      return jeton({ attendre: true }).then(function (j2) {
        if (!j2) { throw new Error('liaison Microsoft absente'); }
        return enveloppe(j2);
      });
    });
  }


  /* =========================================================================
     PARTIE 13 — APPELER GRAPH : LECTURE SEULE (pas de garde d'ecriture — voir
     la note de tete de fichier, il n'y a rien a proteger).
     ========================================================================= */

  function appel(chemin, options) {
    options = options || {};
    var url = /^https?:/.test(chemin) ? chemin : (GRAPH + chemin);
    function envoyer(leJeton, deuxiemeEssai) {
      return fetch(url, { method: 'GET', headers: { Authorization: 'Bearer ' + leJeton } }).then(function (r) {
        if (r.status === 401 && !deuxiemeEssai) {
          S._jeton = ''; S._expireA = 0;
          return renouveler().then(function () {
            return jeton().then(function (neuf) {
              if (!neuf) { throw nommer(new Error('jeton indisponible'), 'AP_SANS_JETON'); }
              return envoyer(neuf, true);
            });
          });
        }
        if (r.status === 429) {
          var e = nommer(new Error('Microsoft demande de ralentir (429)'), 'AP_TROP_VITE');
          e.statut = 429; throw e;
        }
        if (!r.ok) {
          return r.text().then(function (t) {
            var e = nommer(new Error('Microsoft a refuse (' + r.status + ')'), 'AP_MICROSOFT');
            e.statut = r.status; e.detail = t; throw e;
          });
        }
        if (r.status === 204) { return null; }
        return r.json().catch(function () { return null; });
      });
    }
    function nommer(e, nom) { e.name = nom; return e; }
    return jeton({ attendre: options.attendre !== false }).then(function (j) {
      if (!j) { throw nommer(new Error('pas de liaison Microsoft'), 'AP_SANS_JETON'); }
      return envoyer(j, false);
    });
  }


  /* =========================================================================
     PARTIE 14 — L'ETAT PUBLIC
     ========================================================================= */

  function etat() {
    return {
      configure: S.configure,
      environnement: S.environnement,
      connecte: S.connecte,
      connexionEnCours: S.connexionEnCours,
      renouvellementEnCours: S.renouvellementEnCours,
      besoinReconnexion: S.besoinReconnexion,
      courriel: S.courriel,
      portees: S.portees.slice(),
      peutLire: S.connecte && !S.besoinReconnexion,
      expireDans: S._expireA ? Math.max(0, S._expireA - Date.now()) : 0
    };
  }
  function onChange(fn) {
    if (typeof fn !== 'function') { return function () { }; }
    abonnes.push(fn);
    try { fn(etat()); } catch (e) { }
    return function () { var i = abonnes.indexOf(fn); if (i >= 0) { abonnes.splice(i, 1); } };
  }


  /* =========================================================================
     PARTIE 15 — L'API PUBLIQUE
     ========================================================================= */

  AP.mauth = {
    connecter: connecter,
    deconnecter: deconnecter,
    jeton: jeton,
    etat: etat,
    onChange: onChange,
    appel: appel,
    fournisseur: fournisseur,
    pastille: creerPastille,
    reconfigurer: reconfigurer,
    PORTEES: PORTEES.slice(),
    pret: null
  };


  /* =========================================================================
     PARTIE 16 — LE DEMARRAGE (silencieux, comme gauth.js)
     ========================================================================= */

  function demarrage() {
    if (!S.configure) { journal('aucun microsoftClientId — brique au repos'); return Promise.resolve(etat()); }
    detecterEnvironnement();
    return new Promise(function (resoudre) {
      function demarrer() {
        accrocherPastille();
        var pont = pontBureau();
        if (pont) {
          pont.microsoftJeton().then(function (r) {
            if (r && r.access_token) { poserJeton(r); return lireLeCompte(); }
          }).catch(function () { }).then(function () { prevenir(); resoudre(etat()); });
          return;
        }
        if (S.environnement === 'bureau-sans-pont') { prevenir(); resoudre(etat()); return; }

        var dejaLie = false;
        try { var rg0 = JSON.parse(W.localStorage.getItem(CLE_REGLAGES) || '{}'); dejaLie = !!(rg0 && rg0.dejaConnecte); } catch (e) { }
        if (!dejaLie) { journal('appareil jamais relie — pas de reprise silencieuse'); prevenir(); resoudre(etat()); return; }

        demanderCodeSilencieux().then(function (r) { return r ? echangerCode(r.code, r.verifieur) : null; })
          .then(function (r) {
            if (r && r.access_token) { poserJeton(r); return lireLeCompte(); }
            journal('pas de session Microsoft silencieuse — on reste en local');
          }).catch(function () { }).then(function () { prevenir(); resoudre(etat()); });
      }
      if (document.readyState === 'loading') { document.addEventListener('DOMContentLoaded', demarrer); }
      else { demarrer(); }
    });
  }

  AP.mauth.pret = demarrage();

  function reconfigurer() {
    var avant = S.configure;
    S.configure = !!idClient();
    if (S.configure === avant) { return AP.mauth.pret; }
    if (!S.configure) { prevenir(); return AP.mauth.pret; }
    journal('identifiant Microsoft trouve — la brique se reveille');
    AP.mauth.pret = demarrage();
    prevenir();
    return AP.mauth.pret;
  }

  document.addEventListener('visibilitychange', function () {
    if (document.visibilityState !== 'visible') { return; }
    if (!S.connecte) { return; }
    if (!valide() || (S._expireA - Date.now()) < MARGE_MS) { renouveler(); }
  });

})();
