-- SQL Editorで REPLACE_WITH_VERCEL_CRON_SECRET を
-- Vercel ProductionのCRON_SECRETと同じ値へ置き換えて実行してください。

create extension if not exists pg_cron with schema pg_catalog;
create extension if not exists pg_net with schema extensions;

select vault.create_secret(
  'https://kawashima-motors-shaken.vercel.app/api/cron/line-automations',
  'line_automations_cron_url',
  'LINE予約配信・自動配信Cron API URL'
);

select vault.create_secret(
  'REPLACE_WITH_VERCEL_CRON_SECRET',
  'line_automations_cron_secret',
  'Vercel CRON_SECRET'
);

select cron.unschedule(jobid)
from cron.job
where jobname = 'line-automations-hourly';

select cron.schedule(
  'line-automations-hourly',
  '0 * * * *',
  $cron$
    select net.http_get(
      url := (
        select decrypted_secret
        from vault.decrypted_secrets
        where name = 'line_automations_cron_url'
        limit 1
      ),
      headers := jsonb_build_object(
        'Authorization',
        'Bearer ' || (
          select decrypted_secret
          from vault.decrypted_secrets
          where name = 'line_automations_cron_secret'
          limit 1
        )
      ),
      timeout_milliseconds := 30000
    );
  $cron$
);
