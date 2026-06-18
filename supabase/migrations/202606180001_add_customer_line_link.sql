alter table public.customers
  add column if not exists line_user_id text,
  add column if not exists line_linked_at timestamptz,
  add column if not exists line_display_name text,
  add column if not exists line_picture_url text,
  add column if not exists line_status text not null default '未連携';

create unique index if not exists customers_line_user_id_unique
  on public.customers (line_user_id)
  where line_user_id is not null;

update public.customers
set line_status = '連携済み'
where line_user_id is not null
  and line_status = '未連携';
