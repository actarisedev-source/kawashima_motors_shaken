\set ON_ERROR_STOP on

drop policy if exists "backup endpoint windows read line images" on storage.objects;
drop policy if exists "backup endpoint mac read line images" on storage.objects;
drop policy if exists "backup endpoint windows read line bucket" on storage.buckets;
drop policy if exists "backup endpoint mac read line bucket" on storage.buckets;

create policy "backup endpoint windows read line images"
on storage.objects
for select
to authenticated
using (
  bucket_id = 'line-message-images'
  and auth.uid() = :'win_uid'::uuid
);

create policy "backup endpoint mac read line images"
on storage.objects
for select
to authenticated
using (
  bucket_id = 'line-message-images'
  and auth.uid() = :'mac_uid'::uuid
);

create policy "backup endpoint windows read line bucket"
on storage.buckets
for select
to authenticated
using (
  id = 'line-message-images'
  and auth.uid() = :'win_uid'::uuid
);

create policy "backup endpoint mac read line bucket"
on storage.buckets
for select
to authenticated
using (
  id = 'line-message-images'
  and auth.uid() = :'mac_uid'::uuid
);
