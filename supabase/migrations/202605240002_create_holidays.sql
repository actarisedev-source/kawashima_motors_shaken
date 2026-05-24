create table if not exists public.holidays (
  id uuid primary key default gen_random_uuid(),
  type text not null check (type in ('single', 'weekly')),
  date date,
  weekday integer check (weekday between 0 and 6),
  label text,
  created_at timestamptz not null default now(),
  constraint holidays_single_date_required check (
    (type = 'single' and date is not null and weekday is null)
    or
    (type = 'weekly' and weekday is not null and date is null)
  )
);

create unique index if not exists holidays_single_date_unique
on public.holidays (date)
where type = 'single';

create unique index if not exists holidays_weekly_weekday_unique
on public.holidays (weekday)
where type = 'weekly';

alter table public.holidays enable row level security;

drop policy if exists "Allow anon read holidays" on public.holidays;
create policy "Allow anon read holidays"
on public.holidays
for select
to anon, authenticated
using (true);

drop policy if exists "Allow anon manage holidays" on public.holidays;
create policy "Allow anon manage holidays"
on public.holidays
for all
to anon, authenticated
using (true)
with check (true);

grant select, insert, delete on public.holidays to anon, authenticated;
