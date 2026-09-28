/* ============================================================================
   AGENDA PRO — app/microsoft/electron-microsoft.js
   LA CONNEXION MICROSOFT DU COTE DU PROGRAMME DE BUREAU.
   Ce fichier tourne dans le PROCESSUS PRINCIPAL d'Electron, pas dans la page.
   Le jumeau de app/google/electron-google.js — memes principes, une seule
   vraie difference, agreable celle-la : AUCUN CLIENT SECRET.

   Pour un client Microsoft de type « Application mobile et de bureau »,
   Microsoft ne remet meme pas de secret : PKCE a lui seul protege l'echange.
   On enregistre exactement l'URI de redirection « http://localhost » (sans
   port — Microsoft accepte alors n'importe quel port au moment de la
   connexion, la meme souplesse que Google offre a 127.0.0.1 pour son propre
   type « Application de bureau »).

   CE QUE CE FICHIER GARDE SUR LE DISQUE : le refresh token, et lui seul,
   chiffre par safeStorage (le coffre de Windows), dans microsoft-liaison.dat.
   Le jeton d'acces reste en memoire ici, jamais sur le disque — meme regle
   que pour Google, pour les memes raisons (voir gauth.js).

   LECTURE SEULE : les portees demandees (PARTIE 1) ne comportent aucun droit
   d'ecriture. Ce fichier ne touche a rien dans le calendrier ni les taches de
   l'artisan — il obtient un laissez-passer, un point c'est tout.

   COMMENT S'EN SERVIR : app/microsoft/CONSOLE-MICROSOFT.md.
   ============================================================================ */

'use strict';

const http = require('http');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const { ipcMain, shell, safeStorage, app } = require('electron');

const AUTORITE = 'https://login.microsoftonline.com/common/oauth2/v2.0';
const AUTORISATION = AUTORITE + '/authorize';
const ECHANGE = AUTORITE + '/token';
const QUI_SUIS_JE = 'https://graph.microsoft.com/v1.0/me?$select=mail,userPrincipalName';

/* Lecture seule, fixee une fois pour toutes : ce pont n'accepte pas qu'on lui
   demande autre chose (voir PORTEES_PERMISES, en bas de fichier). */
const PORTEES = ['openid', 'profile', 'offline_access', 'User.Read', 'Calendars.Read', 'Tasks.Read'];

const DELAI_MS = 5 * 60 * 1000;


function installerMicrosoft(options) {
  const clientId = (options && options.clientId) || '';
  const bavard = !!(options && options.bavard);

  function journal() {
    if (!bavard) { return; }
    try { console.log.apply(console, ['[microsoft]'].concat([].slice.call(arguments))); } catch (e) { }
  }

  if (!clientId) {
    journal('aucun identifiant de bureau — pont Microsoft non installe');
    return false;
  }

  let jetonAcces = '';
  let expireA = 0;
  let porteesAccordees = [];
  let courriel = '';
  let flotEnCours = null;


  /* ---------------------------------------------------------------------
     LE COFFRE : le refresh token, chiffre par Windows.
     --------------------------------------------------------------------- */

  function cheminCoffre() { return path.join(app.getPath('userData'), 'microsoft-liaison.dat'); }

  function ecrireCoffre(refresh) {
    try {
      if (!refresh) { return false; }
      if (!safeStorage.isEncryptionAvailable()) {
        journal('safeStorage indisponible — rien n\'est garde sur le disque');
        return false;
      }
      fs.writeFileSync(cheminCoffre(), safeStorage.encryptString(refresh), { mode: 0o600 });
      return true;
    } catch (e) { journal('ecriture du coffre impossible:', e.message); return false; }
  }
  function lireCoffre() {
    try {
      if (!safeStorage.isEncryptionAvailable()) { return ''; }
      const f = cheminCoffre();
      if (!fs.existsSync(f)) { return ''; }
      return safeStorage.decryptString(fs.readFileSync(f));
    } catch (e) {
      journal('coffre illisible — on repart de zero');
      try { fs.unlinkSync(cheminCoffre()); } catch (e2) { }
      return '';
    }
  }
  function viderCoffre() { try { fs.unlinkSync(cheminCoffre()); } catch (e) { } }


  /* ---------------------------------------------------------------------
     PKCE — a l'identique de electron-google.js.
     --------------------------------------------------------------------- */

  function base64url(buf) { return buf.toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, ''); }
  function fabriquerPkce() {
    const verifier = base64url(crypto.randomBytes(48));
    const challenge = base64url(crypto.createHash('sha256').update(verifier).digest());
    return { verifier, challenge };
  }


  /* ---------------------------------------------------------------------
     LE PETIT SERVEUR D'UN INSTANT — a l'identique de electron-google.js.
     Ecoute sur 127.0.0.1 uniquement ; on donne « localhost » a Microsoft
     dans l'adresse de retour, comme sa documentation le demande pour ce
     type de client (voir la note de tete de fichier).
     --------------------------------------------------------------------- */

  function pageDeRetour(ok) {
    const titre = ok ? 'C\'est fait — تم' : 'Annule — أُلغي';
    const texte = ok
      ? 'Vous pouvez fermer cet onglet et revenir a Agenda Pro.<br>يمكنك إغلاق هذه الصفحة والعودة إلى البرنامج.'
      : 'La connexion n\'a pas abouti.<br>لم يكتمل الربط.';
    return '<!DOCTYPE html><html lang="fr"><head><meta charset="utf-8">' +
      '<meta http-equiv="Content-Security-Policy" content="default-src \'none\'; style-src \'unsafe-inline\'">' +
      '<title>Agenda Pro</title><style>' +
      'body{font-family:system-ui,sans-serif;background:#f5f7fa;color:#101a2b;display:flex;' +
      'align-items:center;justify-content:center;height:100vh;margin:0;text-align:center}' +
      'div{max-width:420px;padding:28px 30px;background:#fff;border:1px solid #e3e9f0;border-radius:14px}' +
      'h1{font-size:19px;margin:0 0 10px}p{font-size:14px;line-height:1.7;color:#54637c;margin:0}' +
      '</style></head><body><div><h1>' + titre + '</h1><p>' + texte + '</p></div></body></html>';
  }

  function ouvrirServeurRetour(etatAttendu) {
    return new Promise(function (resoudrePort, rejeterPort) {
      let fini = false;
      let minuteur = null;
      let donnerLeCode = null;
      const attendre = new Promise(function (r) { donnerLeCode = r; });

      function terminer(code) {
        if (fini) { return; }
        fini = true;
        if (minuteur) { clearTimeout(minuteur); minuteur = null; }
        try { serveur.close(); } catch (e) { }
        donnerLeCode(code || null);
      }

      const serveur = http.createServer(function (requete, reponse) {
        let code = '';
        let ok = false;
        let estLeRetour = false;
        try {
          const u = new URL(requete.url, 'http://localhost');
          if (u.pathname === '/retour') {
            estLeRetour = true;
            if (u.searchParams.get('state') === etatAttendu) {
              code = u.searchParams.get('code') || '';
              ok = !!code;
            }
          }
        } catch (e) { }

        reponse.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' });
        reponse.end(pageDeRetour(ok));
        /* SEULE la vraie requete de retour cloture le serveur. Une requete
           quelconque arrivant avant elle (favicon.ico demande par le
           navigateur, un autre logiciel local, une page web qui balaierait
           les ports ephemeres) ne doit ni fermer le port ni resoudre
           `attendre` : sinon la VRAIE reponse de Microsoft, arrivant apres,
           trouverait porte close et la liaison echouerait sans raison
           comprehensible pour l'artisan. */
        if (estLeRetour) { terminer(code); }
      });

      serveur.on('error', function (e) { if (!fini) { rejeterPort(e); } terminer(null); });

      serveur.listen(0, '127.0.0.1', function () {
        const port = serveur.address().port;
        journal('petit serveur de retour sur 127.0.0.1:' + port);
        minuteur = setTimeout(function () { journal('personne n\'est revenu au bout de 5 minutes'); terminer(null); }, DELAI_MS);
        resoudrePort({ port: port, attendre: attendre, fermer: function () { terminer(null); } });
      });
    });
  }


  /* ---------------------------------------------------------------------
     PARLER A MICROSOFT
     --------------------------------------------------------------------- */

  async function posterFormulaire(url, champs) {
    const corps = new URLSearchParams(champs).toString();
    const r = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: corps });
    const texte = await r.text();
    let json = null;
    try { json = JSON.parse(texte); } catch (e) { }
    if (!r.ok) {
      journal('Microsoft a refuse (' + r.status + ') :', (json && json.error) || texte.slice(0, 200));
      return null;
    }
    return json;
  }

  async function ranger(reponse) {
    if (!reponse || !reponse.access_token) { return null; }
    jetonAcces = reponse.access_token;
    const secondes = parseInt(reponse.expires_in, 10) || 3600;
    expireA = Date.now() + secondes * 1000;
    porteesAccordees = String(reponse.scope || '').split(/\s+/).filter(Boolean);
    if (reponse.refresh_token) { ecrireCoffre(reponse.refresh_token); }
    if (!courriel) { courriel = await lireCourriel(); }
    return {
      access_token: jetonAcces,
      expires_in: Math.max(1, Math.round((expireA - Date.now()) / 1000)),
      scope: porteesAccordees.join(' '),
      email: courriel
    };
  }

  async function lireCourriel() {
    try {
      const r = await fetch(QUI_SUIS_JE, { headers: { Authorization: 'Bearer ' + jetonAcces } });
      if (!r.ok) { return ''; }
      const d = await r.json();
      return (d && (d.mail || d.userPrincipalName)) || '';
    } catch (e) { return ''; }
  }


  /* ---------------------------------------------------------------------
     LA CONNEXION COMPLETE
     --------------------------------------------------------------------- */

  async function connecter() {
    if (flotEnCours) { return flotEnCours; }

    flotEnCours = (async function () {
      const pkce = fabriquerPkce();
      const etat = base64url(crypto.randomBytes(24));

      let retour;
      try { retour = await ouvrirServeurRetour(etat); }
      catch (e) { journal('impossible d\'ouvrir le petit serveur:', e.message); return null; }

      const redirection = 'http://localhost:' + retour.port + '/retour';

      const adresse = AUTORISATION + '?' + new URLSearchParams({
        client_id: clientId,
        redirect_uri: redirection,
        response_type: 'code',
        scope: PORTEES.join(' '),
        state: etat,
        code_challenge: pkce.challenge,
        code_challenge_method: 'S256',
        prompt: 'select_account'
      }).toString();

      journal('ouverture du navigateur de l\'artisan');
      try { await shell.openExternal(adresse); }
      catch (e) { journal('impossible d\'ouvrir le navigateur:', e.message); retour.fermer(); return null; }

      const code = await retour.attendre;
      if (!code) { return null; }

      const reponse = await posterFormulaire(ECHANGE, {
        client_id: clientId,
        scope: PORTEES.join(' '),
        code: code,
        code_verifier: pkce.verifier,
        grant_type: 'authorization_code',
        redirect_uri: redirection
      });

      courriel = '';
      return await ranger(reponse);
    })();

    try { return await flotEnCours; }
    finally { flotEnCours = null; }
  }


  /* ---------------------------------------------------------------------
     LE JETON SILENCIEUX
     --------------------------------------------------------------------- */

  async function jetonSilencieux() {
    if (jetonAcces && Date.now() < expireA - 60000) {
      return {
        access_token: jetonAcces,
        expires_in: Math.max(1, Math.round((expireA - Date.now()) / 1000)),
        scope: porteesAccordees.join(' '),
        email: courriel
      };
    }
    const refresh = lireCoffre();
    if (!refresh) { return null; }

    const reponse = await posterFormulaire(ECHANGE, {
      client_id: clientId,
      refresh_token: refresh,
      grant_type: 'refresh_token',
      scope: PORTEES.join(' ')
    });

    if (!reponse) {
      viderCoffre();
      jetonAcces = ''; expireA = 0; porteesAccordees = [];
      return null;
    }
    return await ranger(reponse);
  }


  /* ---------------------------------------------------------------------
     LA DECONNEXION — pas de revocation en un appel unique chez Microsoft
     comme chez Google : on efface le coffre, ce qui suffit (le refresh
     token, sans lieu ou vivre, ne sert plus a rien).
     --------------------------------------------------------------------- */

  async function deconnecter() {
    jetonAcces = ''; expireA = 0; porteesAccordees = []; courriel = '';
    viderCoffre();
    return true;
  }


  /* ---------------------------------------------------------------------
     LE SEUL CANAL — trois intentions precises, comme electron-google.js.
     --------------------------------------------------------------------- */

  ipcMain.handle('ap:microsoft-connecter', async function () {
    try { return await connecter(); }
    catch (e) { journal('connexion:', e.message); return null; }
  });

  ipcMain.handle('ap:microsoft-jeton', async function () {
    try { return await jetonSilencieux(); }
    catch (e) { journal('jeton:', e.message); return null; }
  });

  ipcMain.handle('ap:microsoft-deconnecter', async function () {
    try { return await deconnecter(); }
    catch (e) { return false; }
  });

  journal('pont Microsoft installe');
  return true;
}

module.exports = { installerMicrosoft };
