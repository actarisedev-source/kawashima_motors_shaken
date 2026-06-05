create extension if not exists "pgcrypto";

create type reservation_status as enum (
  '受付中',
  '確定',
  '完了',
  'キャンセル'
);

create table tenants (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  slug text not null unique,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table customers (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants(id) on delete cascade,
  name text not null,
  name_kana text,
  phone text,
  normalized_phone text,
  line_user_id text,
  line_display_name text,
  memo text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint customers_tenant_id_id_unique unique (tenant_id, id),
  constraint customers_tenant_line_user_unique unique (tenant_id, line_user_id)
);

create table vehicles (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants(id) on delete cascade,
  customer_id uuid not null,
  model_name text not null,
  plate_number text,
  license_plate text,
  shaken_expiry_date date,
  inspection_expires_on date,
  memo text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint vehicles_tenant_id_id_unique unique (tenant_id, id),
  constraint vehicles_customer_same_tenant_fk
    foreign key (tenant_id, customer_id)
    references customers(tenant_id, id)
    on delete cascade
);

create table reservations (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants(id) on delete cascade,
  customer_id uuid not null,
  vehicle_id uuid not null,
  reserved_at timestamptz not null,
  confirmation_token text not null default encode(gen_random_bytes(32), 'hex'),
  status reservation_status not null default '受付中',
  note text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint reservations_tenant_id_id_unique unique (tenant_id, id),
  constraint reservations_customer_same_tenant_fk
    foreign key (tenant_id, customer_id)
    references customers(tenant_id, id)
    on delete restrict,
  constraint reservations_vehicle_same_tenant_fk
    foreign key (tenant_id, vehicle_id)
    references vehicles(tenant_id, id)
    on delete restrict
);

create table line_profiles (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants(id) on delete cascade,
  customer_id uuid,
  line_user_id text not null,
  display_name text,
  picture_url text,
  followed_at timestamptz,
  unfollowed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint line_profiles_customer_same_tenant_fk
    foreign key (tenant_id, customer_id)
    references customers(tenant_id, id)
    on delete set null (customer_id),
  constraint line_profiles_tenant_line_user_unique unique (tenant_id, line_user_id)
);

create table notification_templates (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants(id) on delete cascade,
  key text not null,
  name text not null,
  body text not null,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint notification_templates_tenant_key_unique unique (tenant_id, key)
);

create table notification_logs (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants(id) on delete cascade,
  customer_id uuid,
  vehicle_id uuid,
  reservation_id uuid,
  line_user_id text,
  template_key text,
  body text not null,
  status text not null default 'queued',
  sent_at timestamptz,
  error_message text,
  created_at timestamptz not null default now(),
  constraint notification_logs_customer_same_tenant_fk
    foreign key (tenant_id, customer_id)
    references customers(tenant_id, id)
    on delete set null (customer_id),
  constraint notification_logs_vehicle_same_tenant_fk
    foreign key (tenant_id, vehicle_id)
    references vehicles(tenant_id, id)
    on delete set null (vehicle_id),
  constraint notification_logs_reservation_same_tenant_fk
    foreign key (tenant_id, reservation_id)
    references reservations(tenant_id, id)
    on delete set null (reservation_id)
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

create trigger tenants_set_updated_at
before update on tenants
for each row execute function set_updated_at();

create trigger customers_set_updated_at
before update on customers
for each row execute function set_updated_at();

create or replace function set_customer_normalized_phone()
returns trigger
language plpgsql
as $$
begin
  new.normalized_phone = nullif(regexp_replace(coalesce(new.phone, ''), '\D', '', 'g'), '');
  return new;
end;
$$;

create trigger customers_set_normalized_phone
before insert or update of phone on customers
for each row execute function set_customer_normalized_phone();

create trigger vehicles_set_updated_at
before update on vehicles
for each row execute function set_updated_at();

create trigger reservations_set_updated_at
before update on reservations
for each row execute function set_updated_at();

create trigger line_profiles_set_updated_at
before update on line_profiles
for each row execute function set_updated_at();

create trigger notification_templates_set_updated_at
before update on notification_templates
for each row execute function set_updated_at();

create index customers_tenant_id_idx on customers(tenant_id);
create index customers_phone_idx on customers(phone);
create unique index customers_normalized_phone_unique_idx
on customers(normalized_phone)
where normalized_phone is not null and normalized_phone <> '';
create index customers_line_user_id_idx on customers(line_user_id);

create index vehicles_tenant_id_idx on vehicles(tenant_id);
create index vehicles_customer_id_idx on vehicles(customer_id);
create index vehicles_customer_model_plate_idx on vehicles(customer_id, model_name, plate_number);
create index vehicles_shaken_expiry_date_idx on vehicles(shaken_expiry_date);
create index vehicles_inspection_expires_on_idx on vehicles(inspection_expires_on);

create index reservations_tenant_reserved_at_idx on reservations(tenant_id, reserved_at);
create index reservations_customer_id_idx on reservations(customer_id);
create index reservations_vehicle_id_idx on reservations(vehicle_id);
create index reservations_status_idx on reservations(status);
create unique index reservations_confirmation_token_idx on reservations(confirmation_token);

create index line_profiles_tenant_id_idx on line_profiles(tenant_id);
create index line_profiles_customer_id_idx on line_profiles(customer_id);
create index line_profiles_line_user_id_idx on line_profiles(line_user_id);

create index notification_logs_tenant_created_at_idx on notification_logs(tenant_id, created_at desc);
create index notification_logs_customer_id_idx on notification_logs(customer_id);
create index notification_logs_reservation_id_idx on notification_logs(reservation_id);

alter table tenants enable row level security;
alter table customers enable row level security;
alter table vehicles enable row level security;
alter table reservations enable row level security;
alter table line_profiles enable row level security;
alter table notification_templates enable row level security;
alter table notification_logs enable row level security;

-- Initial development policies.
-- Replace these with tenant-aware Supabase Auth policies before production.
create policy "Allow service role full access to tenants"
on tenants for all
using (auth.role() = 'service_role')
with check (auth.role() = 'service_role');

create policy "Allow service role full access to customers"
on customers for all
using (auth.role() = 'service_role')
with check (auth.role() = 'service_role');

create policy "Allow service role full access to vehicles"
on vehicles for all
using (auth.role() = 'service_role')
with check (auth.role() = 'service_role');

create policy "Allow service role full access to reservations"
on reservations for all
using (auth.role() = 'service_role')
with check (auth.role() = 'service_role');

create policy "Allow service role full access to line_profiles"
on line_profiles for all
using (auth.role() = 'service_role')
with check (auth.role() = 'service_role');

create policy "Allow service role full access to notification_templates"
on notification_templates for all
using (auth.role() = 'service_role')
with check (auth.role() = 'service_role');

create policy "Allow service role full access to notification_logs"
on notification_logs for all
using (auth.role() = 'service_role')
with check (auth.role() = 'service_role');
