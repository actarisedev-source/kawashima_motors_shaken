begin;

create extension if not exists btree_gist with schema extensions;

create table public.loaner_assignments (
  id uuid primary key default gen_random_uuid(),
  loaner_vehicle_id uuid not null
    references public.loaner_vehicles(id) on delete restrict,
  reservation_id uuid not null
    references public.reservations(id) on delete restrict,
  customer_id uuid
    references public.customers(id) on delete set null,
  scheduled_start_at timestamptz not null,
  scheduled_end_at timestamptz not null,
  actual_returned_at timestamptz,
  status text not null default 'scheduled',
  memo text,
  snapshot_customer_name text not null,
  snapshot_phone text not null,
  snapshot_reserved_at timestamptz not null,
  snapshot_staff_name text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint loaner_assignments_period_check
    check (scheduled_start_at < scheduled_end_at),
  constraint loaner_assignments_status_check
    check (status in ('scheduled', 'checked_out', 'returned', 'cancelled')),
  constraint loaner_assignments_snapshot_customer_name_not_blank
    check (btrim(snapshot_customer_name) <> ''),
  constraint loaner_assignments_snapshot_staff_name_not_blank
    check (btrim(snapshot_staff_name) <> ''),
  constraint loaner_assignments_no_active_overlap
    exclude using gist (
      loaner_vehicle_id with =,
      tstzrange(scheduled_start_at, scheduled_end_at, '[)') with &&
    )
    where (status in ('scheduled', 'checked_out'))
);

create index loaner_assignments_reservation_created_idx
  on public.loaner_assignments (reservation_id, created_at desc);

create index loaner_assignments_customer_created_idx
  on public.loaner_assignments (customer_id, created_at desc);

create index loaner_assignments_vehicle_period_idx
  on public.loaner_assignments (
    loaner_vehicle_id,
    scheduled_start_at,
    scheduled_end_at
  );

create index loaner_assignments_status_start_idx
  on public.loaner_assignments (status, scheduled_start_at);

create trigger loaner_assignments_set_updated_at
before update on public.loaner_assignments
for each row execute function public.set_updated_at();

alter table public.loaner_assignments enable row level security;

revoke all privileges on table public.loaner_assignments
  from public, anon, authenticated;

grant all privileges on table public.loaner_assignments to service_role;

create function public.assign_loaner(
  p_loaner_vehicle_id uuid,
  p_reservation_id uuid,
  p_scheduled_start_at timestamptz,
  p_scheduled_end_at timestamptz,
  p_snapshot_staff_name text,
  p_memo text default null
)
returns setof public.loaner_assignments
language plpgsql
security definer
set search_path = pg_catalog, public, extensions
as $$
declare
  v_customer_id uuid;
  v_customer_name text;
  v_phone text;
  v_reserved_at timestamptz;
  v_assignment public.loaner_assignments;
begin
  if p_loaner_vehicle_id is null
    or p_reservation_id is null
    or p_scheduled_start_at is null
    or p_scheduled_end_at is null
    or p_scheduled_start_at >= p_scheduled_end_at
    or nullif(btrim(p_snapshot_staff_name), '') is null then
    raise exception using
      errcode = 'P0001',
      message = 'loaner_assignment_invalid_input';
  end if;

  perform pg_advisory_xact_lock(
    hashtextextended('loaner-assignment:' || p_loaner_vehicle_id::text, 0)
  );

  if not exists (
    select 1
    from public.loaner_vehicles lv
    where lv.id = p_loaner_vehicle_id
      and lv.is_active
  ) then
    raise exception using
      errcode = 'P0001',
      message = 'loaner_vehicle_unavailable';
  end if;

  select r.customer_id, c.name, coalesce(c.phone, ''), r.reserved_at
  into v_customer_id, v_customer_name, v_phone, v_reserved_at
  from public.reservations r
  join public.customers c on c.id = r.customer_id
  where r.id = p_reservation_id;

  if not found then
    raise exception using
      errcode = 'P0001',
      message = 'loaner_reservation_not_found';
  end if;

  if exists (
    select 1
    from public.loaner_assignments la
    where la.loaner_vehicle_id = p_loaner_vehicle_id
      and la.status in ('scheduled', 'checked_out')
      and tstzrange(la.scheduled_start_at, la.scheduled_end_at, '[)')
        && tstzrange(p_scheduled_start_at, p_scheduled_end_at, '[)')
  ) then
    raise exception using
      errcode = 'P0001',
      message = 'loaner_assignment_overlap';
  end if;

  insert into public.loaner_assignments (
    loaner_vehicle_id,
    reservation_id,
    customer_id,
    scheduled_start_at,
    scheduled_end_at,
    status,
    memo,
    snapshot_customer_name,
    snapshot_phone,
    snapshot_reserved_at,
    snapshot_staff_name
  ) values (
    p_loaner_vehicle_id,
    p_reservation_id,
    v_customer_id,
    p_scheduled_start_at,
    p_scheduled_end_at,
    'scheduled',
    nullif(btrim(p_memo), ''),
    v_customer_name,
    v_phone,
    v_reserved_at,
    btrim(p_snapshot_staff_name)
  )
  returning * into v_assignment;

  return next v_assignment;
exception
  when exclusion_violation then
    raise exception using
      errcode = 'P0001',
      message = 'loaner_assignment_overlap';
end;
$$;

create function public.change_loaner(
  p_assignment_id uuid,
  p_loaner_vehicle_id uuid,
  p_scheduled_start_at timestamptz,
  p_scheduled_end_at timestamptz,
  p_snapshot_staff_name text,
  p_memo text default null
)
returns setof public.loaner_assignments
language plpgsql
security definer
set search_path = pg_catalog, public, extensions
as $$
declare
  v_current public.loaner_assignments;
  v_assignment public.loaner_assignments;
begin
  if p_assignment_id is null
    or p_loaner_vehicle_id is null
    or p_scheduled_start_at is null
    or p_scheduled_end_at is null
    or p_scheduled_start_at >= p_scheduled_end_at
    or nullif(btrim(p_snapshot_staff_name), '') is null then
    raise exception using
      errcode = 'P0001',
      message = 'loaner_assignment_invalid_input';
  end if;

  select *
  into v_current
  from public.loaner_assignments
  where id = p_assignment_id
  for update;

  if not found then
    raise exception using
      errcode = 'P0001',
      message = 'loaner_assignment_not_found';
  end if;

  if v_current.status <> 'scheduled' then
    raise exception using
      errcode = 'P0001',
      message = 'loaner_assignment_not_changeable';
  end if;

  perform pg_advisory_xact_lock(
    hashtextextended('loaner-assignment:' || p_loaner_vehicle_id::text, 0)
  );

  if not exists (
    select 1
    from public.loaner_vehicles lv
    where lv.id = p_loaner_vehicle_id
      and lv.is_active
  ) then
    raise exception using
      errcode = 'P0001',
      message = 'loaner_vehicle_unavailable';
  end if;

  update public.loaner_assignments
  set status = 'cancelled'
  where id = v_current.id;

  if exists (
    select 1
    from public.loaner_assignments la
    where la.loaner_vehicle_id = p_loaner_vehicle_id
      and la.status in ('scheduled', 'checked_out')
      and tstzrange(la.scheduled_start_at, la.scheduled_end_at, '[)')
        && tstzrange(p_scheduled_start_at, p_scheduled_end_at, '[)')
  ) then
    raise exception using
      errcode = 'P0001',
      message = 'loaner_assignment_overlap';
  end if;

  insert into public.loaner_assignments (
    loaner_vehicle_id,
    reservation_id,
    customer_id,
    scheduled_start_at,
    scheduled_end_at,
    status,
    memo,
    snapshot_customer_name,
    snapshot_phone,
    snapshot_reserved_at,
    snapshot_staff_name
  ) values (
    p_loaner_vehicle_id,
    v_current.reservation_id,
    v_current.customer_id,
    p_scheduled_start_at,
    p_scheduled_end_at,
    'scheduled',
    nullif(btrim(p_memo), ''),
    v_current.snapshot_customer_name,
    v_current.snapshot_phone,
    v_current.snapshot_reserved_at,
    btrim(p_snapshot_staff_name)
  )
  returning * into v_assignment;

  return next v_assignment;
exception
  when exclusion_violation then
    raise exception using
      errcode = 'P0001',
      message = 'loaner_assignment_overlap';
end;
$$;

create function public.release_loaner(
  p_assignment_id uuid,
  p_actual_returned_at timestamptz default now()
)
returns setof public.loaner_assignments
language plpgsql
security definer
set search_path = pg_catalog, public, extensions
as $$
declare
  v_assignment public.loaner_assignments;
begin
  if p_assignment_id is null or p_actual_returned_at is null then
    raise exception using
      errcode = 'P0001',
      message = 'loaner_assignment_invalid_input';
  end if;

  select *
  into v_assignment
  from public.loaner_assignments
  where id = p_assignment_id
  for update;

  if not found then
    raise exception using
      errcode = 'P0001',
      message = 'loaner_assignment_not_found';
  end if;

  if v_assignment.status not in ('scheduled', 'checked_out') then
    raise exception using
      errcode = 'P0001',
      message = 'loaner_assignment_not_releasable';
  end if;

  update public.loaner_assignments
  set status = 'returned',
      actual_returned_at = p_actual_returned_at
  where id = v_assignment.id
  returning * into v_assignment;

  return next v_assignment;
end;
$$;

revoke all on function public.assign_loaner(
  uuid, uuid, timestamptz, timestamptz, text, text
) from public, anon, authenticated;

revoke all on function public.change_loaner(
  uuid, uuid, timestamptz, timestamptz, text, text
) from public, anon, authenticated;

revoke all on function public.release_loaner(
  uuid, timestamptz
) from public, anon, authenticated;

grant execute on function public.assign_loaner(
  uuid, uuid, timestamptz, timestamptz, text, text
) to service_role;

grant execute on function public.change_loaner(
  uuid, uuid, timestamptz, timestamptz, text, text
) to service_role;

grant execute on function public.release_loaner(
  uuid, timestamptz
) to service_role;

commit;
