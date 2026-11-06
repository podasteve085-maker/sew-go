# Notifications en arrière-plan

Le service envoie les rappels de rendez-vous et de livraison à J-1 et le jour J,
même lorsque l’application est fermée. Les dates sont évaluées dans le fuseau
`Africa/Ouagadougou`. Les alertes ne contiennent pas de nom ni d’autre donnée
personnelle du client.

## Mise en service

Cette configuration est requise une seule fois par environnement Supabase :

1. Générez une paire de clés VAPID sur votre poste avec
   `npx web-push generate-vapid-keys`. Gardez la clé privée hors du dépôt et ne
   la partagez pas. La clé publique peut être utilisée dans l’application.
2. Définissez les secrets de la fonction Edge :

   ```sh
   supabase secrets set \
     VAPID_PUBLIC_KEY='<clé publique>' \
     VAPID_PRIVATE_KEY='<clé privée>' \
     VAPID_SUBJECT='mailto:<adresse de contact>' \
     PUSH_CRON_SECRET='<secret aléatoire long>'
   ```

   Supabase fournit déjà `SUPABASE_URL` et `SUPABASE_SERVICE_ROLE_KEY` aux
   fonctions Edge. Ne copiez jamais la clé de service dans l’application.
3. Ajoutez `VITE_WEB_PUSH_PUBLIC_KEY` à l’environnement de compilation de
   l’application avec la même clé publique. Cette clé est publique; la clé
   privée VAPID ne doit jamais y être ajoutée.
4. Appliquez la migration :
   `supabase db push` après avoir lié le bon projet, ou exécutez le fichier SQL
   de migration dans l’éditeur SQL Supabase.
5. Déployez la fonction :
   `supabase functions deploy push-reminders`.
6. Activez `pg_cron`, `pg_net` et `supabase_vault` dans le projet, puis
   enregistrez l’URL et le même secret `PUSH_CRON_SECRET` dans Vault. Dans
   l’éditeur SQL Supabase, remplacez les valeurs entre chevrons sans les
   inclure dans Git :

   ```sql
   select vault.create_secret(
     'https://xqlseyenwraopjfjsejh.supabase.co',
     'project_url'
   );
   select vault.create_secret('<même secret PUSH_CRON_SECRET>', 'push_cron_secret');
   ```

   Si un secret de ce nom existe déjà, mettez-le à jour au lieu de le créer une
   seconde fois.
7. Planifiez l’appel serveur toutes les 15 minutes :

   ```sql
   select cron.schedule(
     'push-reminders-every-15-minutes',
     '*/15 * * * *',
     $job$
       select net.http_post(
         url := (
           select decrypted_secret
           from vault.decrypted_secrets
           where name = 'project_url'
         ) || '/functions/v1/push-reminders',
         headers := jsonb_build_object(
           'Content-Type', 'application/json',
           'x-cron-secret', (
             select decrypted_secret
             from vault.decrypted_secrets
             where name = 'push_cron_secret'
           )
         ),
         body := '{}'::jsonb
       );
     $job$
   );
   ```

   Vérifiez ensuite le job avec
   `select jobid, schedule, active from cron.job where jobname = 'push-reminders-every-15-minutes';`.

## Utilisation et limites du navigateur

Chaque utilisateur doit autoriser les notifications sur son appareil une fois,
avec une connexion Internet, depuis le centre « Rappels & Notifications ».
L’appareil doit aussi être connecté à Internet au moment de recevoir l’alerte.
Sur iPhone/iPad, les notifications Web nécessitent généralement l’application
installée sur l’écran d’accueil et une version iOS compatible. Une permission
refusée, un appareil désinstallé ou une connexion coupée au-delà de la durée
de conservation du service push empêchent la livraison.

Le service Worker affiche les notifications reçues et utilise une étiquette
stable pour remplacer une alerte identique au lieu d’en afficher plusieurs.
La table de livraison et sa fonction de réservation rendent les appels répétés
du planificateur idempotents et permettent de reprendre les échecs temporaires.
