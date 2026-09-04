-- Review template for the separately approved production restore Storage policies.
-- Do not run this file until the restore-only Supabase Auth user's UID has
-- been confirmed in Supabase Dashboard. This grants no DELETE access and never
-- grants access to buckets other than line-message-images.
--
-- Usage:
--   psql "$DB_URL" -v restore_uid='00000000-0000-0000-0000-000000000000' -f storage-restore-policies.sql

\set ON_ERROR_STOP on

select format(
  'create policy %I on storage.buckets for select to authenticated using (id = %L and auth.uid() = %L::uuid)',
  'restore endpoint read line bucket',
  'line-message-images',
  :'restore_uid'
)
where not exists (
  select 1
  from pg_policies
  where schemaname = 'storage'
    and tablename = 'buckets'
    and policyname = 'restore endpoint read line bucket'
)
\gexec

select format(
  'create policy %I on storage.objects for select to authenticated using (bucket_id = %L and auth.uid() = %L::uuid)',
  'restore endpoint read line images',
  'line-message-images',
  :'restore_uid'
)
where not exists (
  select 1
  from pg_policies
  where schemaname = 'storage'
    and tablename = 'objects'
    and policyname = 'restore endpoint read line images'
)
\gexec

select format(
  'create policy %I on storage.objects for insert to authenticated with check (bucket_id = %L and auth.uid() = %L::uuid)',
  'restore endpoint insert line images',
  'line-message-images',
  :'restore_uid'
)
where not exists (
  select 1
  from pg_policies
  where schemaname = 'storage'
    and tablename = 'objects'
    and policyname = 'restore endpoint insert line images'
)
\gexec

select format(
  'create policy %I on storage.objects for update to authenticated using (bucket_id = %L and auth.uid() = %L::uuid) with check (bucket_id = %L and auth.uid() = %L::uuid)',
  'restore endpoint update line images',
  'line-message-images',
  :'restore_uid',
  'line-message-images',
  :'restore_uid'
)
where not exists (
  select 1
  from pg_policies
  where schemaname = 'storage'
    and tablename = 'objects'
    and policyname = 'restore endpoint update line images'
)
\gexec
