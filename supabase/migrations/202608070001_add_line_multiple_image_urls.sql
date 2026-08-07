begin;

alter table public.line_message_logs
  add column if not exists image_urls text[] not null default '{}'::text[];

alter table public.line_scheduled_messages
  add column if not exists image_urls text[] not null default '{}'::text[];

update public.line_message_logs
set image_urls = array[image_url]
where image_url is not null
  and cardinality(image_urls) = 0;

update public.line_scheduled_messages
set image_urls = array[image_url]
where image_url is not null
  and cardinality(image_urls) = 0;

alter table public.line_message_logs
  add constraint line_message_logs_image_urls_max_four_check
  check (
    cardinality(image_urls) <= 4
    and array_position(image_urls, null) is null
  );

alter table public.line_scheduled_messages
  add constraint line_scheduled_messages_image_urls_max_four_check
  check (
    cardinality(image_urls) <= 4
    and array_position(image_urls, null) is null
  );

comment on column public.line_message_logs.image_urls is
  'LINEへ送信した画像URL。配列順が送信順。最大4件。';

comment on column public.line_scheduled_messages.image_urls is
  '予約配信する画像URL。配列順が送信順。最大4件。';

commit;
