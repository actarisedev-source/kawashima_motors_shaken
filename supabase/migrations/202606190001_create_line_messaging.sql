alter table public.customers
  add column if not exists gender text not null default '未設定';

alter table public.customers
  drop constraint if exists customers_gender_check;

alter table public.customers
  add constraint customers_gender_check
  check (gender in ('男性', '女性', '未設定'));

create table if not exists public.line_message_logs (
  id uuid primary key default gen_random_uuid(),
  customer_id uuid not null references public.customers(id) on delete cascade,
  line_user_id text not null,
  target_type text not null,
  title text not null,
  body text not null,
  status text not null check (status in ('成功', '失敗')),
  error_message text,
  sent_at timestamptz,
  created_at timestamptz not null default now()
);

create index if not exists line_message_logs_customer_id_idx
  on public.line_message_logs (customer_id);

create index if not exists line_message_logs_created_at_idx
  on public.line_message_logs (created_at desc);

alter table public.line_message_logs enable row level security;

drop policy if exists "Allow service role full access to line_message_logs"
  on public.line_message_logs;

create policy "Allow service role full access to line_message_logs"
  on public.line_message_logs for all
  using (auth.role() = 'service_role')
  with check (auth.role() = 'service_role');
