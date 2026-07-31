begin;

create table public.loaner_vehicles (
  id uuid primary key default gen_random_uuid(),
  vehicle_name text not null,
  display_name text not null,
  plate_number text not null,
  category text not null,
  is_active boolean not null default true,
  sort_order integer not null default 0,
  memo text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint loaner_vehicles_vehicle_name_not_blank
    check (btrim(vehicle_name) <> ''),
  constraint loaner_vehicles_display_name_not_blank
    check (btrim(display_name) <> ''),
  constraint loaner_vehicles_plate_number_not_blank
    check (btrim(plate_number) <> ''),
  constraint loaner_vehicles_category_check
    check (category in ('rental', 'owned', 'sales')),
  constraint loaner_vehicles_sort_order_check
    check (sort_order >= 0)
);

create unique index loaner_vehicles_display_name_unique_idx
  on public.loaner_vehicles (lower(btrim(display_name)));

create unique index loaner_vehicles_plate_number_unique_idx
  on public.loaner_vehicles (
    lower(
      regexp_replace(
        translate(plate_number, '　‐‑‒–—―ー', ' --------'),
        '[[:space:]-]+',
        '',
        'g'
      )
    )
  );

create index loaner_vehicles_sort_order_display_name_idx
  on public.loaner_vehicles (sort_order, display_name);

create index loaner_vehicles_category_active_idx
  on public.loaner_vehicles (category, is_active);

create trigger loaner_vehicles_set_updated_at
before update on public.loaner_vehicles
for each row execute function public.set_updated_at();

alter table public.loaner_vehicles enable row level security;

revoke all privileges on table public.loaner_vehicles
  from public, anon, authenticated;

grant all privileges on table public.loaner_vehicles to service_role;

commit;
