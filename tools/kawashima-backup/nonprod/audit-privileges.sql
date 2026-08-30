\set ON_ERROR_STOP on

select p.oid::regprocedure::text as executable_security_definer
from pg_proc p
join pg_namespace n on n.oid = p.pronamespace
where n.nspname = 'public'
  and p.prosecdef
  and (
    has_function_privilege(:'win_role', p.oid, 'execute')
    or has_function_privilege(:'mac_role', p.oid, 'execute')
  );

select grantee, table_schema, table_name, privilege_type
from information_schema.role_table_grants
where grantee = 'authenticated'
  and table_schema = 'public'
order by table_name, privilege_type;

select p.oid::regprocedure::text as authenticated_security_definer
from pg_proc p
join pg_namespace n on n.oid = p.pronamespace
where n.nspname = 'public'
  and p.prosecdef
  and (
    has_function_privilege('authenticated', p.oid, 'execute')
    or has_function_privilege('public', p.oid, 'execute')
  )
order by 1;
