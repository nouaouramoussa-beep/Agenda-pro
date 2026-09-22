/* ============================================================================
   AGENDA PRO — app/pwa/sw-racine.js
   LE FICHIER DE TROIS LIGNES A COPIER A LA RACINE, SOUS LE NOM « sw.js ».
   ----------------------------------------------------------------------------
   POURQUOI CE FICHIER EXISTE-T-IL ? (la regle la plus surprenante du web)
   Un service worker ne peut surveiller QUE le dossier ou il est range, et ce
   qu'il y a en dessous. Notre vrai gardien est range dans app/pwa/ : il ne
   surveillerait donc que app/pwa/, c'est-a-dire rien d'utile. index.html, qui
   est a la racine, lui echapperait completement, et le mode hors ligne ne
   fonctionnerait pas du tout.

   La solution tient en une ligne : on pose a la racine un fichier qui ne fait
   rien d'autre que charger le vrai. Comme c'est LUI qui est enregistre, c'est
   sa position a lui qui compte, et toute l'application est couverte.

   CE QU'IL FAUT FAIRE, UNE SEULE FOIS
   -----------------------------------
   Copier ce fichier a cote de index.html en le renommant « sw.js » :

       Copy-Item app\pwa\sw-racine.js sw.js     (depuis la racine du projet)

   Et le recopier a chaque publication ? NON. Ce fichier-ci ne change jamais.
   C'est app/pwa/sw.js, charge par la ligne ci-dessous, qui contient tout.

   ET SI J'OUBLIE ?
   L'application marche quand meme, en ligne, exactement comme aujourd'hui.
   Elle perd seulement le hors-ligne et la mise a jour automatique. Et
   app/pwa/pwa.js le dira clairement dans AP.pwa.status.raison.
   ============================================================================ */

importScripts('app/pwa/sw.js');
