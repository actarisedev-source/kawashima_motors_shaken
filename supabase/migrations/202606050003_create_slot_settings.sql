create extension if not exists "pgcrypto";

drop index if exists public.reservations_reserved_at_active_unique;

create index if not exists reservations_reserved_at_active_idx
on public.reservations (reserved_at)
where status <> 'キャンセル';

create table if not exists slot_settings (
  id uuid primary key default gen_random_uuid(),
  slot_type text not null default 'shaken',
  weekday integer not null check (weekday between 0 and 6),
  time text not null check (time in ('09:00', '10:00', '11:00', '13:00', '14:00', '15:00', '16:00')),
  capacity integer not null default 1 check (capacity between 0 and 10),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint slot_settings_unique unique (slot_type, weekday, time)
);

create table if not exists special_slot_settings (
  id uuid primary key default gen_random_uuid(),
  slot_type text not null default 'shaken',
  date date not null,
  time text not null check (time in ('09:00', '10:00', '11:00', '13:00', '14:00', '15:00', '16:00')),
  capacity integer not null default 1 check (capacity between 0 and 10),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint special_slot_settings_unique unique (slot_type, date, time)
);

create or replace function set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists slot_settings_set_updated_at on slot_settings;
create trigger slot_settings_set_updated_at
before update on slot_settings
for each row execute function set_updated_at();

drop trigger if exists special_slot_settings_set_updated_at on special_slot_settings;
create trigger special_slot_settings_set_updated_at
before update on special_slot_settings
for each row execute function set_updated_at();

create index if not exists slot_settings_slot_type_weekday_idx
on slot_settings(slot_type, weekday);

create index if not exists special_slot_settings_slot_type_date_idx
on special_slot_settings(slot_type, date);

alter table slot_settings enable row level security;
alter table special_slot_settings enable row level security;

drop policy if exists "Allow public slot_settings access" on slot_settings;
create policy "Allow public slot_settings access"
on slot_settings for all
using (true)
with check (true);

drop policy if exists "Allow public special_slot_settings access" on special_slot_settings;
create policy "Allow public special_slot_settings access"
on special_slot_settings for all
using (true)
with check (true);

insert into slot_settings (slot_type, weekday, time, capacity)
select 'shaken', weekdays.weekday, slots.time, 1
from generate_series(0, 6) as weekdays(weekday)
cross join (
  values
    ('09:00'),
    ('10:00'),
    ('11:00'),
    ('13:00'),
    ('14:00'),
    ('15:00'),
    ('16:00')
) as slots(time)
on conflict (slot_type, weekday, time) do nothing;
