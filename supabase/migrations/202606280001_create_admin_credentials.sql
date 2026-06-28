create table if not exists public.admin_credentials (
  id text primary key,
  password_hash text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint admin_credentials_primary_only check (id = 'primary')
);

alter table public.admin_credentials enable row level security;

revoke all on table public.admin_credentials from anon, authenticated;
grant select, insert, update on table public.admin_credentials to service_role;

comment on table public.admin_credentials is
  'Stores the hashed password for the single-store administrator account.';
