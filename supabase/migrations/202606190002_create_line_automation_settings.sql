create table if not exists public.line_automation_settings (
  id uuid primary key default gen_random_uuid(),
  automation_type text not null unique,
  enabled boolean not null default false,
  title text not null,
  body text not null,
  send_time time not null default '09:00',
  last_run_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint line_automation_settings_type_check check (
    automation_type in (
      'shaken_60_days',
      'shaken_30_days',
      'reservation_previous_day'
    )
  )
);

alter table public.line_message_logs
  add column if not exists vehicle_id uuid references public.vehicles(id) on delete set null,
  add column if not exists reservation_id uuid references public.reservations(id) on delete set null,
  add column if not exists automation_type text,
  add column if not exists target_date date;

create index if not exists line_message_logs_automation_lookup_idx
  on public.line_message_logs (
    automation_type,
    target_date,
    customer_id,
    vehicle_id,
    reservation_id
  );

create unique index if not exists line_message_logs_automation_success_unique_idx
  on public.line_message_logs (
    automation_type,
    target_date,
    customer_id,
    coalesce(vehicle_id, '00000000-0000-0000-0000-000000000000'::uuid),
    coalesce(reservation_id, '00000000-0000-0000-0000-000000000000'::uuid)
  )
  where automation_type is not null and status = '成功';

alter table public.line_automation_settings enable row level security;

drop policy if exists "Allow service role full access to line_automation_settings"
  on public.line_automation_settings;

create policy "Allow service role full access to line_automation_settings"
  on public.line_automation_settings for all
  using (auth.role() = 'service_role')
  with check (auth.role() = 'service_role');

insert into public.line_automation_settings (
  automation_type,
  enabled,
  title,
  body,
  send_time
)
values
  (
    'shaken_60_days',
    false,
    '車検時期のご案内',
    E'{{name}} 様\n\n車検満了日まで約2か月となりました。\n\n車両：\n{{vehicle_name}}\n\n車検満了日：\n{{shaken_expiry_date}}\n\nご予約はこちら\nhttps://kawashima-motors-shaken.vercel.app/',
    '09:00'
  ),
  (
    'shaken_30_days',
    false,
    '車検時期のご案内',
    E'{{name}} 様\n\n車検満了日が近づいております。\n\n車両：\n{{vehicle_name}}\n\n車検満了日：\n{{shaken_expiry_date}}\n\nお早めのご予約をおすすめいたします。\n\nご予約はこちら\nhttps://kawashima-motors-shaken.vercel.app/',
    '09:00'
  ),
  (
    'reservation_previous_day',
    false,
    'ご予約確認',
    E'{{name}} 様\n\n明日は車検のご予約日です。\n\n予約日時：\n{{reservation_date}}\n\nご来店時は以下をお持ちください。\n\n・車検証\n・自賠責保険証明書\n・納税証明書（必要な場合）\n\nお気をつけてご来店ください。',
    '09:00'
  )
on conflict (automation_type) do nothing;
