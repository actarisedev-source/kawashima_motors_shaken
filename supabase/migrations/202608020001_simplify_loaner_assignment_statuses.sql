begin;

update public.loaner_assignments
set status = 'checked_out'
where status = 'scheduled';

drop function if exists public.checkout_loaner(uuid);

alter table public.loaner_assignments
  drop constraint loaner_assignments_no_active_overlap;

drop index public.loaner_assignments_active_reservation_unique_idx;

alter table public.loaner_assignments
  drop constraint loaner_assignments_status_check;

alter table public.loaner_assignments
  alter column status set default 'checked_out';

alter table public.loaner_assignments
  add constraint loaner_assignments_status_check
    check (status in ('checked_out', 'returned', 'cancelled'));

alter table public.loaner_assignments
  add constraint loaner_assignments_no_active_overlap
    exclude using gist (
      loaner_vehicle_id with =,
      tstzrange(scheduled_start_at, scheduled_end_at, '[)') with &&
    )
    where (status = 'checked_out');

create unique index loaner_assignments_active_reservation_unique_idx
  on public.loaner_assignments (reservation_id)
  where reservation_id is not null
    and status = 'checked_out';

comment on column public.loaner_assignments.status is
'状態:
checked_out=貸出中
returned=返却済み
cancelled=キャンセル';

create or replace function public.assign_loaner(
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
  v_reservation_status text;
  v_loaner_car_requested boolean;
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
    hashtextextended('loaner-reservation:' || p_reservation_id::text, 0)
  );
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

  select
    r.customer_id,
    c.name,
    coalesce(c.phone, ''),
    r.reserved_at,
    r.status,
    r.loaner_car_requested
  into
    v_customer_id,
    v_customer_name,
    v_phone,
    v_reserved_at,
    v_reservation_status,
    v_loaner_car_requested
  from public.reservations r
  join public.customers c on c.id = r.customer_id
  where r.id = p_reservation_id
  for update of r;

  if not found then
    raise exception using
      errcode = 'P0001',
      message = 'loaner_reservation_not_found';
  end if;

  if v_reservation_status = 'キャンセル' then
    raise exception using
      errcode = 'P0001',
      message = 'loaner_reservation_cancelled';
  end if;

  if v_loaner_car_requested is distinct from true then
    raise exception using
      errcode = 'P0001',
      message = 'loaner_reservation_not_requesting';
  end if;

  if exists (
    select 1
    from public.loaner_assignments la
    where la.loaner_vehicle_id = p_loaner_vehicle_id
      and la.status = 'checked_out'
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
    'checked_out',
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

create or replace function public.change_loaner(
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
  v_reservation_id uuid;
  v_reservation_status text;
  v_loaner_car_requested boolean;
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

  select reservation_id
  into v_reservation_id
  from public.loaner_assignments
  where id = p_assignment_id;

  if not found then
    raise exception using
      errcode = 'P0001',
      message = 'loaner_assignment_not_found';
  end if;

  perform pg_advisory_xact_lock(
    hashtextextended('loaner-reservation:' || v_reservation_id::text, 0)
  );

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

  if v_current.status <> 'checked_out' then
    raise exception using
      errcode = 'P0001',
      message = 'loaner_assignment_not_changeable';
  end if;

  select r.status, r.loaner_car_requested
  into v_reservation_status, v_loaner_car_requested
  from public.reservations r
  where r.id = v_current.reservation_id
  for update;

  if not found then
    raise exception using
      errcode = 'P0001',
      message = 'loaner_reservation_not_found';
  end if;

  if v_reservation_status = 'キャンセル' then
    raise exception using
      errcode = 'P0001',
      message = 'loaner_reservation_cancelled';
  end if;

  if v_loaner_car_requested is distinct from true then
    raise exception using
      errcode = 'P0001',
      message = 'loaner_reservation_not_requesting';
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
  set status = 'cancelled',
      actual_returned_at = null
  where id = v_current.id;

  if exists (
    select 1
    from public.loaner_assignments la
    where la.loaner_vehicle_id = p_loaner_vehicle_id
      and la.status = 'checked_out'
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
    'checked_out',
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

create or replace function public.release_loaner(
  p_assignment_id uuid,
  p_actual_returned_at timestamptz default now()
)
returns setof public.loaner_assignments
language plpgsql
security definer
set search_path = pg_catalog, public, extensions
as $$
declare
  v_reservation_id uuid;
  v_assignment public.loaner_assignments;
begin
  if p_assignment_id is null or p_actual_returned_at is null then
    raise exception using
      errcode = 'P0001',
      message = 'loaner_assignment_invalid_input';
  end if;

  select reservation_id
  into v_reservation_id
  from public.loaner_assignments
  where id = p_assignment_id;

  if not found then
    raise exception using
      errcode = 'P0001',
      message = 'loaner_assignment_not_found';
  end if;

  perform pg_advisory_xact_lock(
    hashtextextended('loaner-reservation:' || v_reservation_id::text, 0)
  );

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

  if v_assignment.status <> 'checked_out' then
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

create or replace function public.set_reservation_loaner_request(
  p_reservation_id uuid,
  p_requested boolean
)
returns setof public.reservations
language plpgsql
security definer
set search_path = pg_catalog, public, extensions
as $$
declare
  v_reservation public.reservations;
  v_assignment public.loaner_assignments;
begin
  if p_reservation_id is null or p_requested is null then
    raise exception using
      errcode = 'P0001',
      message = 'loaner_request_invalid_input';
  end if;

  perform pg_advisory_xact_lock(
    hashtextextended('loaner-reservation:' || p_reservation_id::text, 0)
  );

  select *
  into v_reservation
  from public.reservations
  where id = p_reservation_id
  for update;

  if not found then
    raise exception using
      errcode = 'P0001',
      message = 'loaner_reservation_not_found';
  end if;

  if v_reservation.status = 'キャンセル' then
    raise exception using
      errcode = 'P0001',
      message = 'loaner_reservation_cancelled';
  end if;

  select *
  into v_assignment
  from public.loaner_assignments
  where reservation_id = p_reservation_id
    and status = 'checked_out'
  order by created_at desc
  limit 1
  for update;

  if not p_requested and v_assignment.id is not null then
    update public.loaner_assignments
    set status = 'cancelled',
        actual_returned_at = null
    where id = v_assignment.id;
  end if;

  update public.reservations
  set loaner_car_requested = p_requested
  where id = p_reservation_id
  returning * into v_reservation;

  return next v_reservation;
end;
$$;

create or replace function public.cancel_reservation_with_loaner(
  p_reservation_id uuid,
  p_expected_status text default null
)
returns setof public.reservations
language plpgsql
security definer
set search_path = pg_catalog, public, extensions
as $$
declare
  v_reservation public.reservations;
  v_assignment public.loaner_assignments;
begin
  if p_reservation_id is null then
    raise exception using
      errcode = 'P0001',
      message = 'reservation_cancel_invalid_input';
  end if;

  perform pg_advisory_xact_lock(
    hashtextextended('loaner-reservation:' || p_reservation_id::text, 0)
  );

  select *
  into v_reservation
  from public.reservations
  where id = p_reservation_id
  for update;

  if not found then
    raise exception using
      errcode = 'P0001',
      message = 'loaner_reservation_not_found';
  end if;

  if v_reservation.status = 'キャンセル' then
    return next v_reservation;
    return;
  end if;

  if p_expected_status is not null
    and v_reservation.status <> p_expected_status then
    raise exception using
      errcode = 'P0001',
      message = 'reservation_status_changed';
  end if;

  select *
  into v_assignment
  from public.loaner_assignments
  where reservation_id = p_reservation_id
    and status = 'checked_out'
  order by created_at desc
  limit 1
  for update;

  if v_assignment.id is not null then
    update public.loaner_assignments
    set status = 'cancelled',
        actual_returned_at = null
    where id = v_assignment.id;
  end if;

  update public.reservations
  set status = 'キャンセル'
  where id = p_reservation_id
  returning * into v_reservation;

  return next v_reservation;
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
revoke all on function public.set_reservation_loaner_request(
  uuid, boolean
) from public, anon, authenticated;
revoke all on function public.cancel_reservation_with_loaner(
  uuid, text
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
grant execute on function public.set_reservation_loaner_request(
  uuid, boolean
) to service_role;
grant execute on function public.cancel_reservation_with_loaner(
  uuid, text
) to service_role;

commit;
