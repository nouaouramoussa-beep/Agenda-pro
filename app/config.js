/* ============================================================================
   AGENDA PRO — app/config.js
   LE SEUL FICHIER A REMPLIR A LA MAIN.
   ----------------------------------------------------------------------------
   Pourquoi un seul fichier ? Parce que le jour ou vous changez de projet
   Supabase, ou passez Stripe du mode test au mode reel, vous ne devez avoir
   qu'UN endroit a modifier. Si une adresse ou une cle se retrouvait recopiee
   dans trois fichiers, il y en aurait toujours un qui garderait l'ancienne
   valeur, et le bogue serait invisible.

   REGLE DE SECURITE QUI NE SE DISCUTE PAS
   ---------------------------------------
   Tout ce qui est ecrit ici part dans le navigateur de vos clients. N'importe
   qui peut l'y lire (clic droit, « code source »). On n'y met donc QUE des
   valeurs publiques :
     - supabaseUrl        : l'adresse de votre base. Publique par nature.
     - supabaseAnonKey    : la cle « anon ». Elle ne donne AUCUN droit par
                            elle-meme : c'est la securite au niveau des lignes
                            (RLS) posee dans les fichiers SQL qui decide de
                            tout. Elle est faite pour etre publique.
     - stripePublishableKey : la cle « pk_… ». Publique, elle aussi (elle ne
                            sert qu'a ouvrir la page de paiement).
     - siteUrl            : l'adresse de votre application, utilisee pour les
                            retours de connexion Google et des liens de
                            reinitialisation de mot de passe.
     - googleClientId     : l'identifiant public de votre application Google.

   NE JAMAIS ECRIRE ICI (ni dans aucun fichier du navigateur) :
     la cle service_role de Supabase, la cle secrete Stripe (sk_…), le secret
     du webhook Stripe, le client secret Google. Ces quatre valeurs vivent
     uniquement dans Supabase > Settings > Edge Functions > Secrets.
   ============================================================================ */

window.AP_CONFIG = {

  /* Supabase > Settings > API > « Project URL ».
     Exemple : 'https://abcdefghijklm.supabase.co'
     LAISSER VIDE tant que vous n'etes pas pret : l'application continue de
     fonctionner exactement comme aujourd'hui, en local, sans compte. */
  supabaseUrl: '',

  /* Supabase > Settings > API > « Project API keys » > anon / public.
     C'est une longue chaine qui commence par « eyJ… ». */
  supabaseAnonKey: '',

  /* Stripe > Developpeurs > Cles API > « Cle publiable ».
     Commence par 'pk_test_' en essai, 'pk_live_' en production.
     Sert uniquement a la brique FACTURATION ; la brique COMPTES l'ignore. */
  stripePublishableKey: '',

  /* L'adresse exacte ou votre application est publiee, SANS barre oblique
     finale. Exemple : 'https://agenda.exemple.dz'
     Elle sert de point de retour a Google et aux liens de reinitialisation.
     Cette meme adresse doit etre inscrite dans
     Supabase > Authentication > URL Configuration > Redirect URLs,
     sinon Supabase refusera de renvoyer l'utilisateur chez vous.
     Laisse vide, on retombe sur l'adresse de la page en cours. */
  /* LAISSEE VIDE VOLONTAIREMENT. Les trois briques qui la lisent retombent
     toutes sur location.origin + location.pathname, c'est-a-dire exactement
     la meme adresse, calculee au moment ou la page s'ouvre. L'ecrire ici
     n'apporterait rien et publierait le nom de l'artisan dans un fichier
     mis en ligne. */
  siteUrl: '',

  /* Google Cloud Console > Identifiants > ID client OAuth 2.0.
     Ressemble a '1234567890-abc123.apps.googleusercontent.com'.
     ATTENTION : la connexion Google passe par Supabase, qui detient de son
     cote le « client secret ». Cette valeur-ci n'est utile qu'a la brique
     SYNCHRONISATION (pour demander l'acces a l'agenda). La brique COMPTES
     fonctionne sans elle. */
  googleClientId: '600479837599-dlefudbicp4vc18nrn149hrck7rm7q01.apps.googleusercontent.com',

  /* Azure Portal > Inscriptions d'applications > (votre application) > ID
     d'application (client). Ressemble a '3f2e1a9b-....-....-....-............'.
     A CREER VOUS-MEME (comme pour Google) : la marche a suivre exacte est
     dans app/microsoft/CONSOLE-MICROSOFT.md — elle donne les deux plateformes
     a inscrire (Application monopage, pour ce champ-ci ; Applications mobiles
     et de bureau, pour app/desktop/microsoft.local.json) et les permissions a
     cocher (Calendars.Read, Tasks.Read, offline_access, User.Read).
     LAISSER VIDE tant que vous n'etes pas pret : comme pour Google, tant que
     ce champ est vide, la brique Microsoft ne fait rien — aucune requete,
     aucun element ajoute a la page. */
  microsoftClientId: ''
};
