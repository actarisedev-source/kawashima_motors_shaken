alter table public.customers
add column if not exists name_kana text,
add column if not exists memo text;

alter table public.vehicles
add column if not exists memo text;
