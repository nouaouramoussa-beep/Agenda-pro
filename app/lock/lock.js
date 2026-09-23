/* ============================================================================
   AGENDA PRO — app/lock/lock.js
   LE VERROU PAR MOT DE PASSE MAITRE (« super pass »), ENTIEREMENT LOCAL.

   ----------------------------------------------------------------------------
   POURQUOI UN ECRAN « TAPEZ LE MOT DE PASSE » NE PROTEGE RIEN DU TOUT
   ----------------------------------------------------------------------------
   Imaginons le verrou que tout le monde ecrit en premier :

       if (saisie === localStorage.getItem('motDePasse')) { montrerLeTableau(); }

   Ce code ne protege absolument rien, et voici pourquoi, dans l'ordre :

   1. Le mot de passe est ECRIT sur le disque. N'importe qui ouvre les outils
      du navigateur (F12 > Application > Stockage local) et le LIT. En clair.
      Meme range, meme hache, meme decoupe en morceaux : il est la.
   2. Meme sans le mot de passe, LES DONNEES sont a cote, en clair, dans le
      meme stockage local. On n'a donc meme pas besoin de passer le verrou :
      on lit directement les statuts, les notes, les contacts, les taches.
   3. La comparaison se fait dans une page que le visiteur controle. Il lui
      suffit de taper « montrerLeTableau() » dans la console, ou de supprimer
      la ligne du « if », ou d'enregistrer la page et de la modifier.

   Autrement dit : un tel ecran est un RIDEAU. Il cache la vue, il n'empeche
   personne d'entrer. Il rassure son proprietaire, ce qui est pire que rien.

   CE QUE FAIT CE FICHIER A LA PLACE
   ---------------------------------
   Il n'y a rien a comparer, parce que le mot de passe n'est stocke NULLE PART,
   ni en clair ni hache. Ce qui est ecrit sur le disque, ce sont :

       - un SEL aleatoire de 16 octets (public, sans valeur en soi) ;
       - les DONNEES CHIFFREES, et rien d'autre.

   Le mot de passe sert uniquement, le temps d'un calcul, a FABRIQUER la cle
   (PBKDF2-SHA256, 210 000 tours) qui dechiffre les donnees (AES-GCM 256 bits).
   Mauvais mot de passe = mauvaise cle = AES-GCM refuse de dechiffrer tout
   seul, parce qu'il verifie une empreinte d'authenticite avant de rendre quoi
   que ce soit. Il n'y a donc aucun « if » a contourner : sans le bon mot de
   passe, les octets sur le disque sont du bruit, pour tout le monde, y compris
   pour celui qui a ecrit ce fichier.

   LA CONTREPARTIE, ET ELLE EST TOTALE
   -----------------------------------
   Mot de passe oublie = donnees perdues. Definitivement. Il n'y a pas de
   « mot de passe oublie ? », pas de question secrete, pas de courriel de
   secours : tout cela supposerait une copie de la cle quelque part, c'est a
   dire exactement le trou qu'on vient de boucher. L'ecran d'activation le dit
   en gros, en gras, et propose de telecharger une sauvegarde avant.

   CE QUE CE VERROU NE FAIT PAS (a dire honnetement)
   -------------------------------------------------
   - Il protege les donnees AU REPOS, quand le programme est ferme ou
     verrouille. Il ne protege pas contre quelqu'un qui s'installe devant un
     ecran deja ouvert — d'ou le verrouillage automatique.
   - Il ne protege pas contre un programme malveillant installe sur la machine
     qui lirait la frappe au clavier.
   - Le compteur d'essais ralentit un humain, pas une machine : celui qui
     recopie le fichier chiffre peut essayer chez lui autant qu'il veut. La
     vraie protection contre cela, c'est le COUT du PBKDF2 (210 000 tours par
     essai) et surtout la longueur de votre mot de passe.

   CE QUI EST CHIFFRE
   ------------------
   Toutes les clefs du stockage local qui commencent par « agendapro_v1 » :
   statuts, cases cochees, notes, contacts, lieux, taches ajoutees, sections,
   categories, ainsi que la clef Gemini et les caches du jour.
   UNE SEULE reste en clair, « agendapro_v1_pref2 » : elle ne contient que la
   langue, le theme et l'etat plie/deplie des bulles. Elle doit rester lisible
   AVANT le mot de passe, sinon l'ecran de verrouillage lui-meme ne saurait pas
   s'il doit s'afficher en arabe ou en francais, ni en clair ou en sombre.
   Aucune donnee personnelle ne s'y trouve.

   PUBLIE : window.AP.lock (et rien d'autre dans le global).
   ============================================================================ */

;(function (global) {
  'use strict';

  /* ==========================================================================
     0. ESPACE DE NOMS COMMUN
     Les autres briques (comptes, synchronisation, facturation) utilisent deja
     window.AP. On s'y ajoute sans jamais l'ecraser.
     ====================================================================== */
  var AP = (global.AP = global.AP || {});

  /* ==========================================================================
     1. CONSTANTES
     ====================================================================== */

  /* Clef CLAIRE : le sel, les reglages, le compteur d'essais. Rien de secret
     ne s'y trouve — un sel n'a de valeur que combine au mot de passe. */
  var META_KEY = 'agendapro_lock_v1';

  /* Clef CHIFFREE : toutes les donnees du tableau, en un seul bloc. */
  var BLOB_KEY = 'agendapro_lock_blob_v1';

  /* Toute clef du stockage local qui commence par ceci est protegee... */
  var PREFIXE  = 'agendapro_v1';
  /* ...sauf celles-ci, qui doivent rester lisibles avant le mot de passe. */
  /* Les reglages de raccordement (adresse du site, banniere deja vue) ne sont
     pas des donnees de l'artisan et sont lus par setup.js AVANT le mot de
     passe : verrou pose, ils rendaient null et les briques demarraient a vide. */
  var EN_CLAIR = ['agendapro_v1_pref2', 'agendapro_v1_setup_config', 'agendapro_v1_setup_banniere'];

  /* Parametres de chiffrement. 210 000 tours est la recommandation OWASP pour
     PBKDF2-SHA256 ; sur un telephone de 2020 cela coute environ un quart de
     seconde, ce qui est invisible a l'ouverture et tres cher pour qui essaie
     des millions de mots de passe. */
  var ITER     = 210000;
  var SEL_LEN  = 16;   /* octets — sel du PBKDF2, tire au hasard une fois     */
  var IV_LEN   = 12;   /* octets — vecteur d'initialisation AES-GCM, NEUF a   */
                       /*          CHAQUE ecriture (voir sceller())           */
  var MIN_LEN  = 8;    /* longueur minimale acceptee a l'activation           */

  /* Compteur d'essais : au-dela de 5 echecs, on fait attendre, et l'attente
     double a chaque nouvel echec, plafonnee a 5 minutes. */
  var ESSAIS_LIBRES = 5;
  var ATTENTE_BASE  = 5000;
  var ATTENTE_MAX   = 300000;

  /* ==========================================================================
     2. PETITS OUTILS (aucun ne touche a la page : ils servent aussi aux tests
        sous node, ou il n'y a ni document ni localStorage)
     ====================================================================== */

  function sousCrypto() {
    return (global.crypto && global.crypto.subtle) ? global.crypto.subtle : null;
  }
  function aleatoire(n) {
    var u = new Uint8Array(n);
    global.crypto.getRandomValues(u);
    return u;
  }
  function versOctets(txt) {
    return new TextEncoder().encode(txt);
  }
  function versTexte(buf) {
    return new TextDecoder().decode(buf);
  }
  /* base64 : btoa/atob dans le navigateur, Buffer sous node (pour les tests). */
  function b64(u8) {
    if (typeof btoa === 'function') {
      var s = '';
      for (var i = 0; i < u8.length; i++) s += String.fromCharCode(u8[i]);
      return btoa(s);
    }
    return Buffer.from(u8).toString('base64');
  }
  function deb64(str) {
    if (typeof atob === 'function') {
      var bin = atob(str), u = new Uint8Array(bin.length);
      for (var i = 0; i < bin.length; i++) u[i] = bin.charCodeAt(i);
      return u;
    }
    return new Uint8Array(Buffer.from(str, 'base64'));
  }

  /* Une clef du stockage local est-elle protegee par le verrou ? */
  function estGeree(k) {
    if (!k) return false;
    k = String(k);
    if (k === META_KEY || k === BLOB_KEY) return false;
    if (k.indexOf(PREFIXE) !== 0) return false;
    return EN_CLAIR.indexOf(k) < 0;
  }

  /* Solidite d'un mot de passe, de 0 (inutilisable) a 4 (bon). Volontairement
     simple : il s'agit d'orienter, pas de noter. */
  function solidite(p) {
    if (!p) return 0;
    var mauvais = /^(0*|1*|a*|123456|1234567|12345678|azerty|qwerty|password|motdepasse|000000|111111|abcdef)$/i;
    if (mauvais.test(p)) return 0;
    var s = 0;
    if (p.length >= 8)  s++;
    if (p.length >= 12) s++;
    if (p.length >= 16) s++;
    if (/[a-z]/.test(p) && /[A-Z]/.test(p)) s++;
    if (/[0-9]/.test(p)) s++;
    if (/[^A-Za-z0-9]/.test(p)) s++;
    if (p.length < MIN_LEN) s = Math.min(s, 1);
    return Math.max(0, Math.min(4, s));
  }

  /* ==========================================================================
     3. LE COEUR : DERIVATION, CHIFFREMENT, DECHIFFREMENT
     ----------------------------------------------------------------------
     Ces quatre fonctions ne connaissent ni la page, ni le stockage local :
     on leur passe tout. C'est ce qui permet de les essayer sous node.
     ====================================================================== */

  /* Mot de passe + sel  ->  cle AES-GCM 256.
     extractable = false : meme le code de cette page ne peut pas relire les
     octets de la cle une fois qu'elle est fabriquee. */
  function deriverCle(motDePasse, sel, iterations) {
    var sc = sousCrypto();
    if (!sc) return Promise.reject(new Error('NOCRYPTO'));
    return sc.importKey('raw', versOctets(String(motDePasse)), { name: 'PBKDF2' }, false, ['deriveKey'])
      .then(function (brut) {
        return sc.deriveKey(
          { name: 'PBKDF2', salt: sel, iterations: iterations || ITER, hash: 'SHA-256' },
          brut,
          { name: 'AES-GCM', length: 256 },
          false,
          ['encrypt', 'decrypt']
        );
      });
  }

  /* Objet JavaScript -> enveloppe {v, iv, ct} prete a etre ecrite.
     LE VECTEUR D'INITIALISATION EST TIRE ICI, DONC A CHAQUE ECRITURE. Reutiliser
     un IV avec la meme cle en AES-GCM est la faute classique qui casse tout :
     deux messages chiffres avec le meme couple (cle, IV) se trahissent l'un
     l'autre. Un IV neuf a chaque fois coute 12 octets et supprime le probleme. */
  function sceller(cle, objet) {
    var iv = aleatoire(IV_LEN);
    return sousCrypto()
      .encrypt({ name: 'AES-GCM', iv: iv }, cle, versOctets(JSON.stringify(objet)))
      .then(function (ct) {
        return { v: 1, alg: 'AES-GCM', iv: b64(iv), ct: b64(new Uint8Array(ct)) };
      });
  }

  /* Enveloppe -> objet. Leve une exception si la cle est fausse : c'est AES-GCM
     lui-meme qui refuse, sur son empreinte d'authenticite. On ne compare rien,
     on ne teste rien, il n'y a pas de « if » a sauter. */
  function ouvrirEnveloppe(cle, env) {
    if (!env || !env.ct || !env.iv) return Promise.reject(new Error('COFFRE_ILLISIBLE'));
    return sousCrypto()
      .decrypt({ name: 'AES-GCM', iv: deb64(env.iv) }, cle, deb64(env.ct))
      .then(function (clair) { return JSON.parse(versTexte(clair)); });
  }

  /* ==========================================================================
     4. LE COEUR, SUITE : ACTIVER, OUVRIR, CHANGER, RETIRER
     ----------------------------------------------------------------------
     « ls » est le stockage local a utiliser. En vrai c'est le localStorage du
     navigateur ; dans les tests, c'est un faux stockage en memoire. Aucune de
     ces fonctions ne touche a la page.
     ====================================================================== */

  /* Photo de toutes les clefs protegees, telles qu'elles sont AUJOURD'HUI. */
  function lireClair(ls) {
    var out = {}, i, k;
    for (i = 0; i < ls.length; i++) {
      k = ls.key(i);
      if (estGeree(k)) out[k] = ls.getItem(k);
    }
    return out;
  }

  /* Deux photos sont-elles identiques, clef par clef, caractere par caractere ?
     Sert a VERIFIER une migration avant d'effacer quoi que ce soit. */
  function memePhoto(a, b) {
    var ka = Object.keys(a).sort(), kb = Object.keys(b).sort(), i;
    if (ka.length !== kb.length) return false;
    for (i = 0; i < ka.length; i++) {
      if (ka[i] !== kb[i]) return false;
      if (a[ka[i]] !== b[kb[i]]) return false;
    }
    return true;
  }

  function lireMeta(ls) {
    try { return JSON.parse(ls.getItem(META_KEY) || 'null'); } catch (e) { return null; }
  }
  function ecrireMeta(ls, meta) {
    ls.setItem(META_KEY, JSON.stringify(meta));
  }

  /* --- ACTIVATION (la migration sans perte) --------------------------------
     L'ordre des operations est le point important du fichier. On n'efface
     JAMAIS le clair avant d'avoir relu, redechiffre et recompare le coffre
     qu'on vient d'ecrire. Si la moindre etape echoue, on retire ce qu'on a
     ecrit et on laisse les donnees exactement comme on les a trouvees. */
  function activer(ls, motDePasse, reglages) {
    var photo, sel, meta, avantBlob, avantMeta;
    return Promise.resolve().then(function () {
      /* On note l'etat de depart AVANT le moindre refus : le rattrapage en bas
         de fonction remet ces deux valeurs, et il doit remettre les BONNES.
         (Les noter plus bas, apres les verifications, voulait dire qu'un refus
         immediat les laissait vides — et que le rattrapage effacait alors un
         coffre parfaitement valide. C'est arrive, les essais l'ont vu.) */
      avantBlob = ls.getItem(BLOB_KEY);
      avantMeta = ls.getItem(META_KEY);

      if (!sousCrypto()) throw new Error('NOCRYPTO');
      if (!motDePasse || String(motDePasse).length < MIN_LEN) throw new Error('TROP_COURT');
      if (lireMeta(ls)) throw new Error('DEJA_ACTIF');

      /* 1. On prend la photo du clair. */
      photo = lireClair(ls);

      /* 2. Sel neuf, puis cle. */
      sel = aleatoire(SEL_LEN);
      return deriverCle(motDePasse, sel, ITER);
    })
    .then(function (cle) {
      /* 3. On chiffre la photo entiere en un seul bloc. */
      return sceller(cle, photo).then(function (env) { return { cle: cle, env: env }; });
    })
    .then(function (r) {
      /* 4. On ECRIT le coffre et la fiche. Le clair est toujours la, intact. */
      ls.setItem(BLOB_KEY, JSON.stringify(r.env));
      meta = {
        v: 1,
        sel: b64(sel),
        iter: ITER,
        cree: Date.now(),
        autoMin: (reglages && typeof reglages.autoMin === 'number') ? reglages.autoMin : 15,
        surMasquage: !!(reglages && reglages.surMasquage),
        essais: 0,
        attendreJusqu: 0
      };
      ecrireMeta(ls, meta);

      /* 5. ON RELIT DEPUIS LE STOCKAGE, on refabrique la cle depuis la fiche
            relue, et on redechiffre. Ce n'est pas de la mefiance excessive :
            un stockage plein (quota depasse) accepte parfois l'ecriture a
            moitie, et c'est exactement le moment ou on s'apprete a effacer
            l'original. */
      var metaRelu = lireMeta(ls);
      var envRelu  = JSON.parse(ls.getItem(BLOB_KEY) || 'null');
      if (!metaRelu || !envRelu) throw new Error('RELECTURE');
      return deriverCle(motDePasse, deb64(metaRelu.sel), metaRelu.iter)
        .then(function (cle2) { return ouvrirEnveloppe(cle2, envRelu); })
        .then(function (verif) {
          if (!memePhoto(photo, verif)) throw new Error('VERIFICATION');
          /* 6. Tout concorde : on peut enfin effacer le clair. */
          Object.keys(photo).forEach(function (k) { ls.removeItem(k); });
          return { cle: r.cle, meta: metaRelu, mem: photo };
        });
    })
    .catch(function (e) {
      /* On remet le stockage dans l'etat exact ou on l'a trouve. Le clair n'a
         pas ete touche : il ne s'efface qu'a l'etape 6. */
      try {
        if (avantBlob === null || avantBlob === undefined) ls.removeItem(BLOB_KEY); else ls.setItem(BLOB_KEY, avantBlob);
        if (avantMeta === null || avantMeta === undefined) ls.removeItem(META_KEY); else ls.setItem(META_KEY, avantMeta);
      } catch (x) { /* rien de mieux a faire ici */ }
      throw e;
    });
  }

  /* --- OUVERTURE ----------------------------------------------------------- */
  function ouvrirCoffre(ls, motDePasse) {
    return Promise.resolve().then(function () {
      if (!sousCrypto()) throw new Error('NOCRYPTO');
      var meta = lireMeta(ls);
      if (!meta) throw new Error('PAS_DE_VERROU');
      var env = JSON.parse(ls.getItem(BLOB_KEY) || 'null');
      if (!env) throw new Error('COFFRE_ILLISIBLE');
      return deriverCle(motDePasse, deb64(meta.sel), meta.iter).then(function (cle) {
        return ouvrirEnveloppe(cle, env).then(function (mem) {
          return { cle: cle, meta: meta, mem: mem };
        });
      });
    });
  }

  /* --- CHANGEMENT DE MOT DE PASSE ------------------------------------------
     Nouveau sel, nouvelle cle, nouveau chiffrement. On verifie avant de
     remplacer, et en cas de pepin on remet l'ancien coffre. */
  function changer(ls, ancien, nouveau) {
    var avantBlob = ls.getItem(BLOB_KEY), avantMeta = ls.getItem(META_KEY), contenu, sel, meta;
    return ouvrirCoffre(ls, ancien).then(function (r) {
      if (!nouveau || String(nouveau).length < MIN_LEN) throw new Error('TROP_COURT');
      contenu = r.mem;
      sel = aleatoire(SEL_LEN);
      return deriverCle(nouveau, sel, ITER);
    })
    .then(function (cle) {
      return sceller(cle, contenu).then(function (env) { return { cle: cle, env: env }; });
    })
    .then(function (r) {
      var ancienneMeta = lireMeta(ls) || {};
      ls.setItem(BLOB_KEY, JSON.stringify(r.env));
      meta = {
        v: 1, sel: b64(sel), iter: ITER,
        cree: ancienneMeta.cree || Date.now(),
        change: Date.now(),
        autoMin: typeof ancienneMeta.autoMin === 'number' ? ancienneMeta.autoMin : 15,
        surMasquage: !!ancienneMeta.surMasquage,
        essais: 0, attendreJusqu: 0
      };
      ecrireMeta(ls, meta);
      /* Verification par relecture complete, comme a l'activation. */
      return ouvrirCoffre(ls, nouveau).then(function (v) {
        if (!memePhoto(contenu, v.mem)) throw new Error('VERIFICATION');
        return { cle: r.cle, meta: v.meta, mem: v.mem };
      });
    })
    .catch(function (e) {
      try {
        if (avantBlob === null || avantBlob === undefined) ls.removeItem(BLOB_KEY); else ls.setItem(BLOB_KEY, avantBlob);
        if (avantMeta === null || avantMeta === undefined) ls.removeItem(META_KEY); else ls.setItem(META_KEY, avantMeta);
      } catch (x) {}
      throw e;
    });
  }

  /* --- RETRAIT -------------------------------------------------------------
     Tout dechiffrer, tout reecrire en clair, RELIRE pour verifier, et
     seulement alors supprimer le coffre. Si la verification echoue, on efface
     le clair a moitie ecrit et on garde le coffre : mieux vaut rester
     verrouille que se retrouver avec deux moities. */
  function retirer(ls, motDePasse) {
    var contenu;
    return ouvrirCoffre(ls, motDePasse).then(function (r) {
      contenu = r.mem;
      Object.keys(contenu).forEach(function (k) { ls.setItem(k, contenu[k]); });
      var relu = lireClair(ls);
      if (!memePhoto(contenu, relu)) {
        Object.keys(contenu).forEach(function (k) { try { ls.removeItem(k); } catch (x) {} });
        throw new Error('VERIFICATION');
      }
      ls.removeItem(BLOB_KEY);
      ls.removeItem(META_KEY);
      return contenu;
    });
  }

  /* Le coeur, expose pour les essais sous node (voir le bas du fichier). */
  var COEUR = {
    META_KEY: META_KEY, BLOB_KEY: BLOB_KEY, PREFIXE: PREFIXE, EN_CLAIR: EN_CLAIR,
    ITER: ITER, MIN_LEN: MIN_LEN,
    estGeree: estGeree, solidite: solidite,
    deriverCle: deriverCle, sceller: sceller, ouvrirEnveloppe: ouvrirEnveloppe,
    lireClair: lireClair, memePhoto: memePhoto, lireMeta: lireMeta,
    activer: activer, ouvrirCoffre: ouvrirCoffre, changer: changer, retirer: retirer
  };

  /* ==========================================================================
     5. A PARTIR D'ICI : LA PAGE
     Si on n'est pas dans un navigateur (tests node), on s'arrete la.
     ====================================================================== */
  var DANS_LA_PAGE = (typeof document !== 'undefined' && !!document.documentElement);

  if (!DANS_LA_PAGE) {
    AP.lock = { coeur: COEUR };
    if (typeof module === 'object' && module.exports) module.exports = COEUR;
    return;
  }

  /* ==========================================================================
     6. LES MOTS, EN ARABE ET EN FRANCAIS
     Tout texte visible est ici, dans les deux langues, sans exception.
     ====================================================================== */
  var MOTS = {
    ar: {
      /* --- ecran de verrouillage --- */
      ecranTitre:  'البرنامج مُقفَل',
      ecranSous:   'أدخل كلمة السر الرئيسية لفتح لوحة القيادة.',
      champ:       'كلمة السر الرئيسية',
      ouvrir:      'فتح',
      travail:     'جارٍ فكّ التشفير…',
      mauvais:     'كلمة سر خاطئة',
      essaiN:      'كلمة سر خاطئة — المحاولة رقم {n}',
      attendre:    'انتظر {s} ثانية قبل المحاولة من جديد',
      ecranNote:   'البيانات مشفَّرة على هذا الجهاز. لا توجد نسخة من كلمة السر في أي مكان، ولا يمكن لأحد استرجاعها.',
      pasDeCrypto: 'هذا المتصفح لا يوفّر التعشير (Web Crypto). افتح البرنامج عبر https أو عبر الخادم المحلي، لا عبر رابط ملف عادي.',
      coffreCasse: 'تعذّرت قراءة الصندوق المشفَّر. لا تحذف شيئاً: استعن بنسخة الأمان.',
      filtreKo:    'هذا المتصفح لا يسمح بحماية التخزين المحلي. لم يُفعَّل القفل حفاظاً على وضوح الأمر.',

      /* --- barre du حاسوب --- */
      btnSecu:     'الأمان',
      btnQuit:     'أقفل الآن',

      /* --- fenetre de securite --- */
      titreFen:    'الأمان وكلمة السر',
      ok:          'حسناً',
      fermer:      'إغلاق',

      /* volet « definir » */
      defTitre:    'تفعيل القفل بكلمة سر',
      defIntro:    'كلمة سر واحدة تفتح البرنامج وتشفّر كل ما فيه على هذا الجهاز. لا حساب، لا إنترنت، لا خادم.',
      avertTitre:  'اقرأ هذا قبل التفعيل',
      avertTexte:  'إذا نسيتَ كلمة السر فبياناتك <b>ضائعة</b> — لا أحد يستطيع استرجاعها، <b>ولا نحن</b>. هذا هو ثمن التشفير الحقيقي: لا توجد نسخة من المفتاح في أي مكان.',
      sauveBtn:    '⬇️ نزّل نسخة أمان قبل التفعيل',
      sauveFait:   'نُزّلت نسخة الأمان ✓ احفظها في مكان آمن.',
      champNouv:   'كلمة السر الجديدة',
      champConf:   'أعد كتابتها',
      force0:      'ضعيفة جداً',
      force1:      'ضعيفة',
      force2:      'متوسطة',
      force3:      'جيدة',
      force4:      'قوية',
      forceMin:    'ثمانية أحرف على الأقل',
      chkCompris:  'فهمت: إذا نسيت كلمة السر ضاعت بياناتي نهائياً.',
      activer:     'فعّل القفل',
      actifOk:     'تم التفعيل ✓ بياناتك مشفَّرة الآن على هذا الجهاز.',
      errCourt:    'كلمة السر قصيرة — ثمانية أحرف على الأقل.',
      errDiff:     'الكلمتان غير متطابقتين.',
      errChk:      'أكّد أنك فهمت التحذير أولاً.',
      errRien:     'لم يتغيّر شيء. بياناتك سليمة كما كانت.',

      /* volet « gerer » */
      etatOn:      'القفل مفعَّل — بياناتك مشفَّرة على هذا الجهاز.',
      secChang:    'تغيير كلمة السر',
      champAnc:    'كلمة السر الحالية',
      changer:     'غيّر كلمة السر',
      changeOk:    'تم تغيير كلمة السر ✓',
      errAnc:      'كلمة السر الحالية خاطئة.',
      secRegl:     'الإقفال التلقائي',
      lblAuto:     'أقفل بعد مدّة بلا استعمال',
      auto5:       'بعد 5 دقائق',
      auto15:      'بعد 15 دقيقة',
      auto60:      'بعد ساعة',
      auto0:       'أبداً',
      lblMasq:     'أقفل أيضاً عند مغادرة الصفحة أو تبديل التبويب',
      reglOk:      'حُفظت الإعدادات ✓',
      secRet:      'إزالة القفل',
      retIntro:    'إزالة القفل تفكّ تشفير كل شيء وتعيده نصّاً عادياً على هذا الجهاز. لن يُطلب منك أي مفتاح بعد ذلك.',
      retirer:     'أزل القفل نهائياً',
      retConf:     'هل تريد فعلاً إزالة القفل؟ ستصبح البيانات مقروءة لأي شخص يفتح هذا المتصفح.',
      retOk:       'أُزيل القفل ✓ البيانات الآن نصّ عادي.',
      quitConf:    'سيُغلق البرنامج ويُطلب منك كلمة السر. هل تتابع؟'
    },
    fr: {
      ecranTitre:  'Programme verrouille',
      ecranSous:   'Entrez le mot de passe maitre pour ouvrir le tableau de bord.',
      champ:       'Mot de passe maitre',
      ouvrir:      'Ouvrir',
      travail:     'Dechiffrement en cours…',
      mauvais:     'Mot de passe incorrect',
      essaiN:      'Mot de passe incorrect — essai n° {n}',
      attendre:    'Attendez {s} secondes avant de reessayer',
      ecranNote:   'Les donnees sont chiffrees sur cet appareil. Aucune copie du mot de passe n\'existe nulle part, et personne ne peut le retrouver.',
      pasDeCrypto: 'Ce navigateur ne fournit pas Web Crypto. Ouvrez le programme en https ou par le serveur local, pas par un simple lien de fichier.',
      coffreCasse: 'Le coffre chiffre est illisible. N\'effacez rien : reprenez votre sauvegarde.',
      filtreKo:    'Ce navigateur ne permet pas de proteger le stockage local. Le verrou n\'a pas ete active, pour ne pas faire croire a une protection qui n\'existerait pas.',

      btnSecu:     'Securite',
      btnQuit:     'Verrouiller',

      titreFen:    'Securite et mot de passe',
      ok:          'OK',
      fermer:      'Fermer',

      defTitre:    'Activer le verrou par mot de passe',
      defIntro:    'Un seul mot de passe ouvre le programme et chiffre tout ce qu\'il contient, sur cet appareil. Aucun compte, aucun internet, aucun serveur.',
      avertTitre:  'A lire avant d\'activer',
      avertTexte:  'Si vous oubliez ce mot de passe, vos donnees sont <b>PERDUES</b> — personne ne peut les recuperer, <b>pas meme nous</b>. C\'est le prix du vrai chiffrement : il n\'existe aucune copie de la cle, nulle part.',
      sauveBtn:    '⬇️ Telecharger une sauvegarde avant d\'activer',
      sauveFait:   'Sauvegarde telechargee ✓ Rangez-la en lieu sur.',
      champNouv:   'Nouveau mot de passe',
      champConf:   'Repetez-le',
      force0:      'Tres faible',
      force1:      'Faible',
      force2:      'Moyen',
      force3:      'Bon',
      force4:      'Solide',
      forceMin:    'Huit caracteres au minimum',
      chkCompris:  'J\'ai compris : mot de passe oublie = donnees perdues pour toujours.',
      activer:     'Activer le verrou',
      actifOk:     'Verrou actif ✓ Vos donnees sont chiffrees sur cet appareil.',
      errCourt:    'Mot de passe trop court — huit caracteres au minimum.',
      errDiff:     'Les deux mots de passe ne sont pas identiques.',
      errChk:      'Confirmez d\'abord que vous avez compris l\'avertissement.',
      errRien:     'Rien n\'a change. Vos donnees sont intactes.',

      etatOn:      'Verrou actif — vos donnees sont chiffrees sur cet appareil.',
      secChang:    'Changer le mot de passe',
      champAnc:    'Mot de passe actuel',
      changer:     'Changer le mot de passe',
      changeOk:    'Mot de passe change ✓',
      errAnc:      'Le mot de passe actuel est incorrect.',
      secRegl:     'Verrouillage automatique',
      lblAuto:     'Verrouiller apres une periode sans activite',
      auto5:       'Au bout de 5 minutes',
      auto15:      'Au bout de 15 minutes',
      auto60:      'Au bout d\'une heure',
      auto0:       'Jamais',
      lblMasq:     'Verrouiller aussi en quittant la page ou en changeant d\'onglet',
      reglOk:      'Reglages enregistres ✓',
      secRet:      'Retirer le verrou',
      retIntro:    'Retirer le verrou dechiffre tout et le remet en clair sur cet appareil. Plus aucun mot de passe ne sera demande ensuite.',
      retirer:     'Retirer le verrou',
      retConf:     'Retirer vraiment le verrou ? Les donnees redeviendront lisibles par toute personne qui ouvre ce navigateur.',
      retOk:       'Verrou retire ✓ Les donnees sont de nouveau en clair.',
      quitConf:    'Le programme va se fermer et redemander le mot de passe. Continuer ?'
    }
  };

  /* Langue courante : elle vient des preferences, qui restent volontairement
     en clair (voir l'en-tete du fichier). Par defaut : arabe, comme le reste. */
  function langue() {
    try {
      var p = JSON.parse(RAW.getItem('agendapro_v1_pref2') || '{}');
      return (p && p.lang === 'fr') ? 'fr' : 'ar';
    } catch (e) { return 'ar'; }
  }
  function m(clef, remplacements) {
    var s = (MOTS[langue()] || MOTS.ar)[clef] || clef;
    if (remplacements) {
      Object.keys(remplacements).forEach(function (k) {
        s = s.split('{' + k + '}').join(remplacements[k]);
      });
    }
    return s;
  }

  /* ==========================================================================
     7. LE STOCKAGE FILTRE
     ----------------------------------------------------------------------
     Le tableau de bord lit et ecrit localStorage de facon SYNCHRONE
     (lsGet / lsSet), alors que le chiffrement, lui, est forcement ASYNCHRONE.
     On ne peut donc pas chiffrer « au moment du setItem ».

     La solution : une fois le mot de passe donne, le contenu dechiffre vit en
     MEMOIRE (l'objet MEM). On remplace window.localStorage par un objet qui
     repond a la place du vrai pour les clefs protegees. Chaque ecriture va
     dans MEM, et declenche aussitot un rechiffrement du bloc entier (quelques
     dixiemes de milliseconde : la partie couteuse, PBKDF2, n'a lieu qu'une
     fois, a l'ouverture).

     Le vrai stockage, lui, ne contient jamais que du chiffre.
     ====================================================================== */

  /* Le VRAI stockage, capture AVANT tout detournement. Dans une fenetre privee
     tres restrictive, y acceder leve une exception : on retombe alors sur un
     stockage de secours en memoire, et le verrou se comporte comme s'il
     n'avait jamais ete pose (le tableau de bord, lui, ne memorise rien non
     plus dans ce cas — ce n'est pas notre affaire). */
  var RAW;
  try {
    RAW = global.localStorage;
    RAW.getItem('agendapro_v1');
  } catch (e) {
    RAW = (function () {
      var o = Object.create(null);
      return {
        getItem: function (k) { return Object.prototype.hasOwnProperty.call(o, k) ? o[k] : null; },
        setItem: function (k, v) { o[k] = String(v); },
        removeItem: function (k) { delete o[k]; },
        clear: function () { Object.keys(o).forEach(function (k) { delete o[k]; }); },
        key: function (i) { return Object.keys(o)[i] != null ? Object.keys(o)[i] : null; },
        get length() { return Object.keys(o).length; }
      };
    })();
  }
  var MEM = Object.create(null);    /* les clefs protegees, en clair, en RAM  */
  var CLE = null;                   /* la cle AES du moment, jamais ecrite    */
  var META = null;
  var VERROUILLE = false;
  var filtreInstalle = false;

  function listeClefs() {
    var out = [], i, k;
    for (i = 0; i < RAW.length; i++) {
      k = RAW.key(i);
      if (!estGeree(k)) out.push(k);
    }
    return out.concat(Object.keys(MEM));
  }

  function installerFiltre() {
    if (filtreInstalle) return true;
    var faux = {
      getItem: function (k) {
        k = String(k);
        if (!estGeree(k)) return RAW.getItem(k);
        return Object.prototype.hasOwnProperty.call(MEM, k) ? MEM[k] : null;
      },
      setItem: function (k, v) {
        k = String(k);
        if (!estGeree(k)) { RAW.setItem(k, String(v)); return; }
        MEM[k] = String(v);
        planifierEcriture();
      },
      removeItem: function (k) {
        k = String(k);
        if (!estGeree(k)) { RAW.removeItem(k); return; }
        delete MEM[k];
        planifierEcriture();
      },
      /* « tout effacer » doit vraiment tout effacer : la memoire, le coffre ET
         la fiche du verrou. Sinon on laisserait un coffre orphelin sans son
         sel — des octets que plus personne au monde ne pourrait ouvrir, et un
         programme qui redemanderait un mot de passe pour rien. */
      clear: function () {
        Object.keys(MEM).forEach(function (k) { delete MEM[k]; });
        RAW.clear();
        CLE = null; META = null;
      },
      key: function (i) { var l = listeClefs(); return i < l.length ? l[i] : null; },
      get length() { return listeClefs().length; }
    };
    try {
      Object.defineProperty(global, 'localStorage', {
        configurable: true, enumerable: true,
        get: function () { return faux; }
      });
      /* On verifie que le remplacement a bien pris : sur un navigateur qui
         refuserait, on prefere le savoir tout de suite plutot que d'annoncer
         une protection qui n'existe pas. */
      if (global.localStorage !== faux) return false;
    } catch (e) { return false; }
    filtreInstalle = true;
    return true;
  }

  /* Retirer le filtre et reverser en clair ce qu'il retenait en memoire.
     Sert uniquement quand une activation echoue a mi-chemin : le clair ne doit
     alors etre ni perdu, ni coince dans un objet que plus personne n'ecrit. */
  function desinstallerFiltre() {
    if (!filtreInstalle) return;
    try {
      Object.keys(MEM).forEach(function (k) { RAW.setItem(k, MEM[k]); });
    } catch (e) { console.error('[verrou] retour en clair :', e); }
    try {
      Object.defineProperty(global, 'localStorage', {
        configurable: true, enumerable: true,
        get: function () { return RAW; }
      });
      filtreInstalle = false;
    } catch (e) { /* on garde le filtre : au moins les lectures marchent */ }
    Object.keys(MEM).forEach(function (k) { delete MEM[k]; });
  }

  /* --- ecriture differee, mais immediate en pratique -----------------------
     Les ecritures s'enchainent une par une (jamais deux chiffrements en
     parallele sur le meme bloc) et se regroupent : dix modifications de suite
     ne provoquent pas dix ecritures, mais une ou deux. */
  var ecritureEnCours = null, ecritureDemandee = false, ecritureCassee = false;

  function planifierEcriture() {
    if (!CLE) return;                      /* rien a chiffrer sans cle        */
    ecritureDemandee = true;
    if (ecritureEnCours) return;
    ecritureEnCours = (function boucle() {
      ecritureDemandee = false;
      var instantane = {};
      Object.keys(MEM).forEach(function (k) { instantane[k] = MEM[k]; });
      return sceller(CLE, instantane)
        .then(function (env) { RAW.setItem(BLOB_KEY, JSON.stringify(env)); })
        .then(function () {
          if (ecritureDemandee) return boucle();
          ecritureEnCours = null;
        })
        .catch(function (e) {
          ecritureEnCours = null;
          if (!ecritureCassee) {
            ecritureCassee = true;
            console.error('[verrou] enregistrement impossible :', e);
            if (typeof global.toast === 'function') global.toast('✗ ' + String(e.message || e));
          }
        });
    })();
  }
  function attendreEcritures() {
    if (!ecritureEnCours) return Promise.resolve();
    return ecritureEnCours.then(function () { return attendreEcritures(); });
  }

  /* ==========================================================================
     8. DEMARRAGE DIFFERE DU TABLEAU DE BORD
     index.html appelle AP.lock.deferBoot(init). S'il n'y a pas de mot de passe,
     init part tout de suite et rien n'a change. S'il y en a un, init attend le
     dechiffrement : le tableau ne se construit donc jamais sur des donnees
     vides, et il n'y a rien a afficher tant que le mot de passe n'est pas
     donne.
     ====================================================================== */
  var BOOT = null, DEMARRE = false;

  function deferBoot(fn) {
    if (typeof fn !== 'function') return;
    if (!VERROUILLE) { DEMARRE = true; fn(); return; }
    BOOT = fn;
  }
  function demarrerApp() {
    if (DEMARRE || !BOOT) return;
    DEMARRE = true;
    /* Si le demarrage du tableau echoue, ce n'est pas au verrou de masquer le
       probleme : on ecrit la pile d'appels en clair dans la console, sinon on
       chercherait pendant des heures une panne qui n'a rien a voir avec lui. */
    try { BOOT(); } catch (e) { console.error('[verrou] le demarrage du tableau a echoue :\n' + ((e && e.stack) || e)); }
    BOOT = null;
    habillerBoutons();
  }

  /* ==========================================================================
     9. L'ECRAN DE VERROUILLAGE
     Construit tout de suite (le script est place en haut du <body>), pour
     qu'aucune image du tableau ne soit jamais peinte a l'ecran.
     ====================================================================== */
  var ecran = null;

  function construireEcran() {
    if (ecran) return ecran;
    var d = document.createElement('div');
    d.id = 'apLock';
    d.className = 'ap-lock';
    d.setAttribute('role', 'dialog');
    d.setAttribute('aria-modal', 'true');
    d.innerHTML =
      '<div class="ap-lock-card">' +
        '<div class="ap-lock-logo">🔒</div>' +
        '<h2 id="apLockTitre"></h2>' +
        '<p class="ap-lock-sub" id="apLockSous"></p>' +
        '<form id="apLockForm" autocomplete="off">' +
          '<label class="ap-pwrow">' +
            '<input type="password" id="apLockPw" autocomplete="current-password" ' +
                   'autocapitalize="off" autocorrect="off" spellcheck="false">' +
            '<button type="button" class="ap-eye" id="apLockEye" tabindex="-1">👁</button>' +
          '</label>' +
          '<div class="ap-lock-err" id="apLockErr"></div>' +
          '<button type="submit" class="mb pri ap-lock-go" id="apLockGo"></button>' +
        '</form>' +
        '<p class="ap-lock-foot" id="apLockNote"></p>' +
      '</div>';
    (document.body || document.documentElement).appendChild(d);
    ecran = d;

    d.querySelector('#apLockEye').addEventListener('click', function () {
      var i = d.querySelector('#apLockPw');
      i.type = (i.type === 'password') ? 'text' : 'password';
      i.focus();
    });
    d.querySelector('#apLockForm').addEventListener('submit', function (e) {
      e.preventDefault();
      essayerOuvrir();
    });
    remplirEcran();
    return d;
  }

  function remplirEcran() {
    if (!ecran) return;
    ecran.querySelector('#apLockTitre').textContent = m('ecranTitre');
    ecran.querySelector('#apLockSous').textContent  = m('ecranSous');
    ecran.querySelector('#apLockPw').placeholder    = m('champ');
    ecran.querySelector('#apLockGo').textContent    = m('ouvrir');
    ecran.querySelector('#apLockNote').textContent  = m('ecranNote');
  }

  function messageEcran(txt, genre) {
    if (!ecran) return;
    var e = ecran.querySelector('#apLockErr');
    e.textContent = txt || '';
    e.className = 'ap-lock-err' + (genre ? ' ' + genre : '');
  }

  /* Attente apres echecs. Le compteur est ecrit en clair et se remet a zero
     si on efface le stockage : c'est un ralentisseur pour un humain presse,
     pas une serrure. La vraie depense, c'est le PBKDF2. */
  function attenteRestante() {
    if (!META || !META.attendreJusqu) return 0;
    return Math.max(0, META.attendreJusqu - Date.now());
  }
  var compteARebours = null;
  function afficherAttente() {
    clearInterval(compteARebours);
    var maj = function () {
      var r = attenteRestante();
      if (r <= 0) {
        clearInterval(compteARebours);
        messageEcran('');
        ecran.querySelector('#apLockGo').disabled = false;
        return;
      }
      ecran.querySelector('#apLockGo').disabled = true;
      messageEcran(m('attendre', { s: Math.ceil(r / 1000) }), 'wait');
    };
    maj();
    compteARebours = setInterval(maj, 500);
  }

  function essayerOuvrir() {
    if (attenteRestante() > 0) { afficherAttente(); return; }
    var champ = ecran.querySelector('#apLockPw');
    var bouton = ecran.querySelector('#apLockGo');
    var pw = champ.value;
    if (!pw) { champ.focus(); return; }

    bouton.disabled = true;
    messageEcran(m('travail'), 'wait');

    /* Le PBKDF2 occupe le fil d'execution : on laisse au navigateur une image
       pour afficher « dechiffrement en cours » avant de le lancer. */
    setTimeout(function () {
      ouvrirCoffre(RAW, pw).then(function (r) {
        CLE = r.cle; META = r.meta;
        Object.keys(MEM).forEach(function (k) { delete MEM[k]; });
        Object.keys(r.mem).forEach(function (k) { MEM[k] = r.mem[k]; });
        META.essais = 0; META.attendreJusqu = 0;
        try { ecrireMeta(RAW, META); } catch (e) {}
        champ.value = '';
        pw = null;
        VERROUILLE = false;
        document.documentElement.classList.remove('ap-locked');
        ecran.hidden = true;
        demarrerApp();
        armerAutoVerrou();
      }).catch(function (e) {
        bouton.disabled = false;
        var code = String(e && e.message);
        if (code === 'NOCRYPTO')             { messageEcran(m('pasDeCrypto')); return; }
        if (code === 'COFFRE_ILLISIBLE' ||
            code === 'PAS_DE_VERROU')        { messageEcran(m('coffreCasse')); return; }
        /* Tout le reste = mauvaise cle : AES-GCM a refuse. */
        META = META || lireMeta(RAW) || {};
        META.essais = (META.essais || 0) + 1;
        if (META.essais > ESSAIS_LIBRES) {
          var n = META.essais - ESSAIS_LIBRES;
          META.attendreJusqu = Date.now() + Math.min(ATTENTE_MAX, ATTENTE_BASE * Math.pow(2, n - 1));
        }
        try { ecrireMeta(RAW, META); } catch (x) {}
        champ.select();
        if (attenteRestante() > 0) afficherAttente();
        else messageEcran(m('essaiN', { n: META.essais }));
      });
    }, 30);
  }

  /* ==========================================================================
     10. VERROUILLER
     On RECHARGE la page. C'est volontaire et c'est la seule facon honnete :
     a ce stade les donnees dechiffrees sont dans des variables JavaScript
     (store, TASKS…) et dessinees dans la page. Poser un voile par-dessus les
     y laisserait, a portee d'un F12. Un rechargement vide tout, et l'ecran de
     verrouillage revient sur une page neuve.
     ====================================================================== */
  function verrouillerMaintenant(sansQuestion) {
    if (!estActif()) return;
    if (!sansQuestion && !global.confirm(m('quitConf'))) return;
    attendreEcritures().then(function () {
      global.location.reload();
    }, function () { global.location.reload(); });
  }

  /* --- verrouillage automatique -------------------------------------------
     Trois declencheurs, tous reglables :
       - une duree sans activite (5, 15, 60 minutes, ou jamais) ;
       - le depart de la page ou le changement d'onglet, si demande ;
       - le bouton « verrouiller » de la barre du haut, a tout moment.
     Les ecouteurs d'activite sont poses une seule fois et retires
     proprement : armer deux fois de suite ne doit pas les empiler. */
  var MINUTES_EVTS = ['pointerdown', 'keydown', 'wheel', 'touchstart'];
  var minuterie = null;
  var ecoutersPoses = false;

  function relancerMinuterie() {
    clearTimeout(minuterie);
    var minutes = (META && typeof META.autoMin === 'number') ? META.autoMin : 15;
    if (minutes > 0) {
      minuterie = setTimeout(function () { verrouillerMaintenant(true); }, minutes * 60000);
    }
  }
  function armerAutoVerrou() {
    desarmerAutoVerrou();
    if (!estActif() || VERROUILLE) return;
    var minutes = (META && typeof META.autoMin === 'number') ? META.autoMin : 15;
    if (minutes > 0) {
      MINUTES_EVTS.forEach(function (ev) {
        document.addEventListener(ev, relancerMinuterie, { passive: true });
      });
      ecoutersPoses = true;
      relancerMinuterie();
    }
    if (META && META.surMasquage) {
      document.addEventListener('visibilitychange', surMasquage);
    }
  }
  function surMasquage() {
    if (document.visibilityState === 'hidden' && estActif() && !VERROUILLE) {
      verrouillerMaintenant(true);
    }
  }
  function desarmerAutoVerrou() {
    clearTimeout(minuterie);
    minuterie = null;
    if (ecoutersPoses) {
      MINUTES_EVTS.forEach(function (ev) {
        document.removeEventListener(ev, relancerMinuterie);
      });
      ecoutersPoses = false;
    }
    document.removeEventListener('visibilitychange', surMasquage);
  }

  /* Dernier filet : quand la page se ferme, on tente d'ecrire ce qui reste.
     Le chiffrement etant asynchrone, rien ne garantit que le navigateur nous
     en laisse le temps — c'est pour cela que chaque modification declenche
     deja son enregistrement immediatement, et non au bout d'un delai. */
  global.addEventListener('pagehide', function () { planifierEcriture(); });

  /* ==========================================================================
     11. LA FENETRE DE SECURITE (definir / changer / regler / retirer)
     Construite a la demande, avec les classes de l'application.
     ====================================================================== */
  var fen = null;

  function construireFenetre() {
    if (fen) return fen;
    var d = document.createElement('div');
    d.className = 'modal';
    d.id = 'mApLock';
    d.innerHTML =
    '<div class="modal-in">' +
      '<div class="modal-h"><h3 id="apFTitre"></h3>' +
        '<button class="tbtn" id="apFX">✕</button></div>' +
      '<div class="modal-b">' +

        /* ---------- volet DEFINIR ---------- */
        '<div class="ap-pane" id="apPaneDef">' +
          '<div class="ap-sec-h" id="apDefTitre"></div>' +
          '<div class="note-line" id="apDefIntro"></div>' +
          '<div class="ap-warn">' +
            '<div class="ap-warn-h">⚠️ <span id="apAvertTitre"></span></div>' +
            '<div id="apAvertTexte"></div>' +
          '</div>' +
          '<button class="mb ap-wide" id="apSauve"></button>' +
          '<div class="fld"><label id="apLblNouv"></label>' +
            '<label class="ap-pwrow"><input type="password" id="apNouv" autocomplete="new-password">' +
            '<button type="button" class="ap-eye" data-oeil="apNouv" tabindex="-1">👁</button></label></div>' +
          '<div class="ap-str"><div class="ap-str-bar" id="apStrBar"><i></i><i></i><i></i><i></i></div>' +
            '<div class="ap-str-txt" id="apStrTxt"></div></div>' +
          '<div class="fld"><label id="apLblConf"></label>' +
            '<label class="ap-pwrow"><input type="password" id="apConf" autocomplete="new-password">' +
            '<button type="button" class="ap-eye" data-oeil="apConf" tabindex="-1">👁</button></label></div>' +
          '<label class="chk"><input type="checkbox" id="apChk"><span id="apChkTxt"></span></label>' +
          '<div class="ap-msg" id="apDefMsg"></div>' +
          '<button class="mb pri ap-wide" id="apActiver"></button>' +
        '</div>' +

        /* ---------- volet GERER ---------- */
        '<div class="ap-pane" id="apPaneGer">' +
          '<div class="ap-state"><span class="ap-dot"></span><span id="apEtat"></span></div>' +

          '<div class="ap-sec-h" id="apSecChang"></div>' +
          '<div class="fld"><label id="apLblAnc"></label>' +
            '<label class="ap-pwrow"><input type="password" id="apAnc" autocomplete="current-password">' +
            '<button type="button" class="ap-eye" data-oeil="apAnc" tabindex="-1">👁</button></label></div>' +
          '<div class="fld"><label id="apLblNouv2"></label>' +
            '<label class="ap-pwrow"><input type="password" id="apNouv2" autocomplete="new-password">' +
            '<button type="button" class="ap-eye" data-oeil="apNouv2" tabindex="-1">👁</button></label></div>' +
          '<div class="ap-str"><div class="ap-str-bar" id="apStrBar2"><i></i><i></i><i></i><i></i></div>' +
            '<div class="ap-str-txt" id="apStrTxt2"></div></div>' +
          '<div class="fld"><label id="apLblConf2"></label>' +
            '<label class="ap-pwrow"><input type="password" id="apConf2" autocomplete="new-password">' +
            '<button type="button" class="ap-eye" data-oeil="apConf2" tabindex="-1">👁</button></label></div>' +
          '<button class="mb ap-wide" id="apChanger"></button>' +

          '<div class="ap-sec-h" id="apSecRegl"></div>' +
          '<div class="fld"><label id="apLblAuto"></label>' +
            '<select id="apAuto">' +
              '<option value="5"></option><option value="15"></option>' +
              '<option value="60"></option><option value="0"></option>' +
            '</select></div>' +
          '<label class="chk"><input type="checkbox" id="apMasq"><span id="apMasqTxt"></span></label>' +

          '<div class="ap-sec-h" id="apSecRet"></div>' +
          '<div class="note-line" id="apRetIntro"></div>' +
          '<div class="fld"><label id="apLblRet"></label>' +
            '<label class="ap-pwrow"><input type="password" id="apRetPw" autocomplete="current-password">' +
            '<button type="button" class="ap-eye" data-oeil="apRetPw" tabindex="-1">👁</button></label></div>' +
          '<button class="mb ap-wide ap-danger" id="apRetirer"></button>' +
          '<div class="ap-msg" id="apGerMsg"></div>' +
        '</div>' +

      '</div>' +
      '<div class="modal-f"><button class="mb pri" id="apFOk"></button></div>' +
    '</div>';
    document.body.appendChild(d);
    fen = d;

    /* fermeture : croix, bouton OK, clic sur le fond, touche Echap */
    d.querySelector('#apFX').addEventListener('click', fermerFenetre);
    d.querySelector('#apFOk').addEventListener('click', fermerFenetre);
    d.addEventListener('click', function (e) { if (e.target === d) fermerFenetre(); });

    /* oeils « voir le mot de passe » */
    d.querySelectorAll('.ap-eye[data-oeil]').forEach(function (b) {
      b.addEventListener('click', function () {
        var i = d.querySelector('#' + b.dataset.oeil);
        i.type = (i.type === 'password') ? 'text' : 'password';
        i.focus();
      });
    });

    /* jauges de solidite */
    d.querySelector('#apNouv').addEventListener('input', function () {
      jauge(this.value, '#apStrBar', '#apStrTxt');
    });
    d.querySelector('#apNouv2').addEventListener('input', function () {
      jauge(this.value, '#apStrBar2', '#apStrTxt2');
    });

    d.querySelector('#apSauve').addEventListener('click', telechargerSauvegarde);
    d.querySelector('#apActiver').addEventListener('click', uiActiver);
    d.querySelector('#apChanger').addEventListener('click', uiChanger);
    d.querySelector('#apRetirer').addEventListener('click', uiRetirer);
    d.querySelector('#apAuto').addEventListener('change', uiReglages);
    d.querySelector('#apMasq').addEventListener('change', uiReglages);

    return d;
  }

  function jauge(valeur, selBar, selTxt) {
    var s = solidite(valeur);
    var bar = fen.querySelector(selBar);
    bar.className = 'ap-str-bar' + (valeur ? ' s' + Math.max(1, s) : '');
    fen.querySelector(selTxt).textContent =
      !valeur ? m('forceMin') : m('force' + s);
  }

  function remplirFenetre() {
    if (!fen) return;
    var q = function (s) { return fen.querySelector(s); };
    var actif = estActif();

    q('#apFTitre').textContent   = m('titreFen');
    q('#apFOk').textContent      = m('fermer');

    q('#apPaneDef').classList.toggle('on', !actif);
    q('#apPaneGer').classList.toggle('on', actif);

    /* volet definir */
    q('#apDefTitre').textContent   = m('defTitre');
    q('#apDefIntro').textContent   = m('defIntro');
    q('#apAvertTitre').textContent = m('avertTitre');
    q('#apAvertTexte').innerHTML   = m('avertTexte');   /* contient <b>, texte du fichier */
    q('#apSauve').textContent      = m('sauveBtn');
    q('#apLblNouv').textContent    = m('champNouv');
    q('#apLblConf').textContent    = m('champConf');
    q('#apChkTxt').textContent     = m('chkCompris');
    q('#apActiver').textContent    = m('activer');
    jauge(q('#apNouv').value, '#apStrBar', '#apStrTxt');

    /* volet gerer */
    q('#apEtat').textContent      = m('etatOn');
    q('#apSecChang').textContent  = m('secChang');
    q('#apLblAnc').textContent    = m('champAnc');
    q('#apLblNouv2').textContent  = m('champNouv');
    q('#apLblConf2').textContent  = m('champConf');
    q('#apChanger').textContent   = m('changer');
    q('#apSecRegl').textContent   = m('secRegl');
    q('#apLblAuto').textContent   = m('lblAuto');
    var o = q('#apAuto').options;
    o[0].textContent = m('auto5'); o[1].textContent = m('auto15');
    o[2].textContent = m('auto60'); o[3].textContent = m('auto0');
    q('#apMasqTxt').textContent   = m('lblMasq');
    q('#apSecRet').textContent    = m('secRet');
    q('#apRetIntro').textContent  = m('retIntro');
    q('#apLblRet').textContent    = m('champAnc');
    q('#apRetirer').textContent   = m('retirer');
    jauge(q('#apNouv2').value, '#apStrBar2', '#apStrTxt2');

    if (actif && META) {
      q('#apAuto').value = String(typeof META.autoMin === 'number' ? META.autoMin : 15);
      q('#apMasq').checked = !!META.surMasquage;
    }
  }

  function ouvrirFenetre() {
    construireFenetre();
    remplirFenetre();
    message('#apDefMsg', '', '');
    message('#apGerMsg', '', '');
    fen.classList.add('show');
  }
  function fermerFenetre() {
    if (!fen) return;
    fen.classList.remove('show');
    ['#apNouv', '#apConf', '#apAnc', '#apNouv2', '#apConf2', '#apRetPw'].forEach(function (s) {
      var i = fen.querySelector(s); if (i) i.value = '';
    });
  }
  function message(sel, txt, genre) {
    if (!fen) return;
    var e = fen.querySelector(sel);
    if (!e) return;
    e.textContent = txt || '';
    e.className = 'ap-msg' + (genre ? ' ' + genre : '');
  }

  /* --- la sauvegarde proposee AVANT d'activer ------------------------------
     Le fichier produit est exactement l'objet que le tableau de bord sait
     relire par son bouton « restaurer » : c'est le contenu de la clef
     agendapro_v1, sans emballage. On ne met rien d'autre dedans pour qu'il
     reste directement reutilisable. */
  function telechargerSauvegarde() {
    var brut = null;
    try { brut = (filtreInstalle ? MEM[PREFIXE] : RAW.getItem(PREFIXE)); } catch (e) {}
    var txt = brut || '{}';
    var nom = 'agendapro-sauvegarde-' + new Date().toISOString().slice(0, 10) + '.json';
    try {
      var b = new Blob([txt], { type: 'application/json' });
      var u = URL.createObjectURL(b);
      var a = document.createElement('a');
      a.href = u; a.download = nom; a.click();
      URL.revokeObjectURL(u);
      message('#apDefMsg', m('sauveFait'), 'ok');
    } catch (e) {
      message('#apDefMsg', String(e.message || e), 'bad');
    }
  }

  function uiActiver() {
    var q = function (s) { return fen.querySelector(s); };
    var pw = q('#apNouv').value, c = q('#apConf').value;
    if (!sousCrypto())            { message('#apDefMsg', m('pasDeCrypto'), 'bad'); return; }
    if (!pw || pw.length < MIN_LEN) { message('#apDefMsg', m('errCourt'), 'bad'); return; }
    if (pw !== c)                 { message('#apDefMsg', m('errDiff'), 'bad'); return; }
    if (!q('#apChk').checked)     { message('#apDefMsg', m('errChk'), 'bad'); return; }

    /* Le filtre doit etre en place AVANT que le clair ne disparaisse, sinon le
       tableau de bord continuerait d'ecrire en clair juste apres. Mais on ne
       peut pas l'installer sur une memoire vide : pendant la seconde que dure
       le calcul de la cle, le tableau lirait du neant et pourrait reecrire un
       contenu vide par-dessus. On recopie donc d'abord le clair en memoire,
       ET SEULEMENT ENSUITE on detourne le stockage. Si le navigateur refuse le
       detournement, on n'active rien du tout et on le dit. */
    var photo = lireClair(RAW);
    Object.keys(photo).forEach(function (k) { MEM[k] = photo[k]; });
    if (!installerFiltre()) { message('#apDefMsg', m('filtreKo'), 'bad'); return; }

    q('#apActiver').disabled = true;
    message('#apDefMsg', m('travail'), '');
    setTimeout(function () {
      activer(RAW, pw, { autoMin: 15, surMasquage: false }).then(function (r) {
        CLE = r.cle; META = r.meta;
        /* MEM est peut-etre DEJA plus a jour que r.mem (une case cochee
           pendant le calcul). On ne l'ecrase pas : on complete, puis on
           enregistre, ce qui rechiffre l'etat reel du moment. */
        Object.keys(r.mem).forEach(function (k) {
          if (!Object.prototype.hasOwnProperty.call(MEM, k)) MEM[k] = r.mem[k];
        });
        planifierEcriture();
        q('#apNouv').value = ''; q('#apConf').value = ''; q('#apChk').checked = false;
        q('#apActiver').disabled = false;
        document.documentElement.classList.add('ap-on');
        remplirFenetre();
        message('#apDefMsg', '', '');           /* on efface « en cours… »   */
        message('#apGerMsg', m('actifOk'), 'ok');
        armerAutoVerrou();
        habillerBoutons();
      }).catch(function (e) {
        /* Rien n'a ete efface (activer() ne touche au clair qu'en toute
           derniere etape, apres verification). On remet donc simplement le
           stockage normal et on rend la memoire au clair. */
        desinstallerFiltre();
        q('#apActiver').disabled = false;
        var code = String(e && e.message);
        message('#apDefMsg',
          (code === 'TROP_COURT' ? m('errCourt') :
           code === 'NOCRYPTO'   ? m('pasDeCrypto') :
           m('errRien') + ' (' + code + ')'), 'bad');
      });
    }, 30);
  }

  function uiChanger() {
    var q = function (s) { return fen.querySelector(s); };
    var anc = q('#apAnc').value, nv = q('#apNouv2').value, c = q('#apConf2').value;
    if (!nv || nv.length < MIN_LEN) { message('#apGerMsg', m('errCourt'), 'bad'); return; }
    if (nv !== c)                   { message('#apGerMsg', m('errDiff'), 'bad'); return; }
    q('#apChanger').disabled = true;
    message('#apGerMsg', m('travail'), '');
    setTimeout(function () {
      changer(RAW, anc, nv).then(function (r) {
        CLE = r.cle; META = r.meta;
        q('#apAnc').value = ''; q('#apNouv2').value = ''; q('#apConf2').value = '';
        q('#apChanger').disabled = false;
        jauge('', '#apStrBar2', '#apStrTxt2');
        message('#apGerMsg', m('changeOk'), 'ok');
      }).catch(function (e) {
        q('#apChanger').disabled = false;
        var code = String(e && e.message);
        message('#apGerMsg',
          (code === 'TROP_COURT' ? m('errCourt') : m('errAnc')), 'bad');
      });
    }, 30);
  }

  function uiRetirer() {
    var q = function (s) { return fen.querySelector(s); };
    if (!global.confirm(m('retConf'))) return;
    q('#apRetirer').disabled = true;
    message('#apGerMsg', m('travail'), '');
    setTimeout(function () {
      retirer(RAW, q('#apRetPw').value).then(function () {
        CLE = null; META = null;
        q('#apRetPw').value = '';
        q('#apRetirer').disabled = false;
        document.documentElement.classList.remove('ap-on');
        desarmerAutoVerrou();
        remplirFenetre();
        message('#apDefMsg', m('retOk'), 'ok');
        habillerBoutons();
        /* Les donnees sont de nouveau en clair dans le vrai stockage. Le
           filtre, lui, retient encore une copie en memoire : plutot que de
           vivre avec deux exemplaires, on recharge la page une seconde plus
           tard — le temps que le message soit lu — et tout repart propre. */
        setTimeout(function () { global.location.reload(); }, 1200);
      }).catch(function (e) {
        q('#apRetirer').disabled = false;
        message('#apGerMsg', m('errAnc'), 'bad');
      });
    }, 30);
  }

  function uiReglages() {
    if (!estActif() || !META) return;
    META.autoMin = parseInt(fen.querySelector('#apAuto').value, 10) || 0;
    META.surMasquage = fen.querySelector('#apMasq').checked;
    try { ecrireMeta(RAW, META); } catch (e) {}
    desarmerAutoVerrou();
    armerAutoVerrou();
    message('#apGerMsg', m('reglOk'), 'ok');
  }

  /* ==========================================================================
     12. LES DEUX BOUTONS DE LA BARRE DU HAUT
     Poses dans .tools, avec la classe .tbtn de l'application. Ils sont crees
     en JavaScript pour que index.html n'ait presque rien a changer.
     ====================================================================== */
  function poserBoutons() {
    var outils = document.querySelector('.topbar .tools');
    if (!outils || document.getElementById('btnLockCfg')) return;

    var cfg = document.createElement('button');
    cfg.className = 'tbtn'; cfg.id = 'btnLockCfg';
    cfg.innerHTML = '<span class="ap-badge">🔐</span> <span data-lk="btnSecu"></span>';
    cfg.addEventListener('click', ouvrirFenetre);

    var now = document.createElement('button');
    now.className = 'tbtn'; now.id = 'btnLockNow';
    now.innerHTML = '🔒 <span data-lk="btnQuit"></span>';
    now.addEventListener('click', function () { verrouillerMaintenant(false); });

    /* Juste avant le bouton d'impression, a la fin de la barre. */
    outils.appendChild(cfg);
    outils.appendChild(now);
    habillerBoutons();
  }
  function habillerBoutons() {
    document.querySelectorAll('[data-lk]').forEach(function (e) {
      e.textContent = m(e.getAttribute('data-lk'));
    });
  }

  /* Le tableau de bord rappelle applyI18n() a chaque changement de langue.
     On s'y accroche pour retraduire nos propres textes au meme instant. */
  function suivreLaLangue() {
    var original = global.applyI18n;
    if (typeof original !== 'function') return;
    global.applyI18n = function () {
      var r = original.apply(this, arguments);
      try { habillerBoutons(); remplirEcran(); if (fen) remplirFenetre(); } catch (e) {}
      return r;
    };
  }

  /* ==========================================================================
     13. MISE EN ROUTE
     ====================================================================== */
  function estActif() { return !!lireMeta(RAW); }

  (function demarrage() {
    META = lireMeta(RAW);

    if (!META) {
      /* AUCUN MOT DE PASSE : on ne fait rien du tout. Pas d'ecran, pas de
         filtre sur le stockage, pas une milliseconde de retard. Le programme
         se comporte exactement comme avant ce fichier. */
      VERROUILLE = false;
    } else {
      /* Un coffre existe. On masque la page AVANT qu'elle ne se peigne, on
         installe le filtre (memoire vide : le tableau ne verra rien tant que
         le mot de passe n'est pas donne) et on affiche l'ecran. */
      VERROUILLE = true;
      document.documentElement.classList.add('ap-locked', 'ap-on');
      /* Langue et theme : ils viennent des preferences restees en clair, pour
         que l'ecran de verrouillage s'affiche comme le reste du programme. */
      try {
        var p = JSON.parse(RAW.getItem('agendapro_v1_pref2') || '{}');
        if (p.theme) document.documentElement.setAttribute('data-theme', p.theme);
        if (p.lang) {
          document.documentElement.lang = p.lang;
          document.documentElement.dir = (p.lang === 'ar') ? 'rtl' : 'ltr';
        }
      } catch (e) {}

      construireEcran();

      if (!installerFiltre()) {
        messageEcran(m('filtreKo'));
        ecran.querySelector('#apLockGo').disabled = true;
      } else if (!sousCrypto()) {
        messageEcran(m('pasDeCrypto'));
        ecran.querySelector('#apLockGo').disabled = true;
      } else if (attenteRestante() > 0) {
        afficherAttente();
      }
      setTimeout(function () {
        var i = ecran.querySelector('#apLockPw'); if (i) i.focus();
      }, 60);
    }

    function quandLaPageEstLa() {
      poserBoutons();
      suivreLaLangue();
      if (!VERROUILLE && estActif()) armerAutoVerrou();
    }
    if (document.readyState === 'loading') {
      document.addEventListener('DOMContentLoaded', quandLaPageEstLa);
    } else {
      quandLaPageEstLa();
    }
  })();

  /* ==========================================================================
     14. CE QUI EST PUBLIE
     ====================================================================== */
  AP.lock = {
    /* appele par index.html : demarre le tableau tout de suite, ou apres le
       mot de passe */
    deferBoot: deferBoot,
    /* etat et actions */
    estActif: estActif,
    estVerrouille: function () { return VERROUILLE; },
    verrouiller: function () { verrouillerMaintenant(true); },
    reglages: ouvrirFenetre,
    /* pour les essais et le diagnostic */
    coeur: COEUR
  };

})(typeof window !== 'undefined' ? window : globalThis);
