\set ON_ERROR_STOP on

select format('drop owned by %I', :'win_role')
where exists (select 1 from pg_roles where rolname = :'win_role')
\gexec
select format('drop owned by %I', :'mac_role')
where exists (select 1 from pg_roles where rolname = :'mac_role')
\gexec
select format('drop role if exists %I', :'win_role') \gexec
select format('drop role if exists %I', :'mac_role') \gexec

select format(
  'create role %I login password %L bypassrls nosuperuser nocreatedb nocreaterole noreplication connection limit 2',
  :'win_role',
  :'win_password'
) \gexec
select format(
  'create role %I login password %L bypassrls nosuperuser nocreatedb nocreaterole noreplication connection limit 2',
  :'mac_role',
  :'mac_password'
) \gexec

select format('alter role %I set default_transaction_read_only = on', :'win_role') \gexec
select format('alter role %I set default_transaction_read_only = on', :'mac_role') \gexec
select format('grant connect on database %I to %I', current_database(), :'win_role') \gexec
select format('grant connect on database %I to %I', current_database(), :'mac_role') \gexec
select format('grant usage on schema public to %I', :'win_role') \gexec
select format('grant usage on schema public to %I', :'mac_role') \gexec
select format('grant select on all tables in schema public to %I', :'win_role') \gexec
select format('grant select on all tables in schema public to %I', :'mac_role') \gexec
select format('grant select on all sequences in schema public to %I', :'win_role') \gexec
select format('grant select on all sequences in schema public to %I', :'mac_role') \gexec

-- Apply equivalent default privileges for every role that owns public objects.
select format(
  'alter default privileges for role %I in schema public grant select on tables to %I',
  owner_name,
  :'win_role'
)
from (
  select distinct pg_get_userbyid(c.relowner) as owner_name
  from pg_class c
  join pg_namespace n on n.oid = c.relnamespace
  where n.nspname = 'public'
) owners
where owner_name is not null
\gexec
select format(
  'alter default privileges for role %I in schema public grant select on tables to %I',
  owner_name,
  :'mac_role'
)
from (
  select distinct pg_get_userbyid(c.relowner) as owner_name
  from pg_class c
  join pg_namespace n on n.oid = c.relnamespace
  where n.nspname = 'public'
) owners
where owner_name is not null
\gexec

select format(
  'alter default privileges for role %I in schema public grant select on sequences to %I',
  owner_name,
  :'win_role'
)
from (
  select distinct pg_get_userbyid(c.relowner) as owner_name
  from pg_class c
  join pg_namespace n on n.oid = c.relnamespace
  where n.nspname = 'public'
) owners
where owner_name is not null
\gexec
select format(
  'alter default privileges for role %I in schema public grant select on sequences to %I',
  owner_name,
  :'mac_role'
)
from (
  select distinct pg_get_userbyid(c.relowner) as owner_name
  from pg_class c
  join pg_namespace n on n.oid = c.relnamespace
  where n.nspname = 'public'
) owners
where owner_name is not null
\gexec
