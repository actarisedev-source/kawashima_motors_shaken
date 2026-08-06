begin;

alter table public.reservations
  add column if not exists loaner_car_requested boolean;

-- Keep the existing 15-argument function available for the current
-- Production deployment. Only this migration's 16-argument overload is
-- replaced when the migration is retried.
drop function if exists public.create_reservation_atomic(
  text, text, text, text, text, date, text, text, date, timestamptz,
  text, text, text, text, boolean, text
);

create function public.create_reservation_atomic(
  p_customer_name text,
  p_customer_kana text,
  p_phone text,
  p_normalized_phone text,
  p_gender text,
  p_birth_date date,
  p_vehicle_model text,
  p_license_plate text,
  p_shaken_expiry_date date,
  p_reserved_at timestamptz,
  p_note text,
  p_line_user_id text,
  p_line_display_name text,
  p_line_picture_url text,
  p_loaner_car_requested boolean,
  p_slot_type text default 'shaken'
)
returns table (
  reservation_id uuid,
  reservation_status text,
  confirmation_token text,
  customer_id uuid,
  vehicle_id uuid,
  line_linked boolean,
  line_link_warning text
)
language plpgsql
security definer
set search_path = pg_catalog, public, extensions
as $$
declare
  v_result record;
begin
  if p_loaner_car_requested is null then
    raise exception using
      errcode = 'P0001',
      message = 'reservation_invalid_loaner_car_requested';
  end if;

  -- PostgreSQL resolves this 15-argument call to the existing function.
  -- Its slot locking, holiday checks, customer/vehicle handling, and LINE
  -- linking logic remain the single implementation of reservation creation.
  select *
  into v_result
  from public.create_reservation_atomic(
    p_customer_name,
    p_customer_kana,
    p_phone,
    p_normalized_phone,
    p_gender,
    p_birth_date,
    p_vehicle_model,
    p_license_plate,
    p_shaken_expiry_date,
    p_reserved_at,
    p_note,
    p_line_user_id,
    p_line_display_name,
    p_line_picture_url,
    p_slot_type
  );

  update public.reservations
  set loaner_car_requested = p_loaner_car_requested
  where id = v_result.reservation_id;

  return query
  select
    v_result.reservation_id::uuid,
    v_result.reservation_status::text,
    v_result.confirmation_token::text,
    v_result.customer_id::uuid,
    v_result.vehicle_id::uuid,
    v_result.line_linked::boolean,
    v_result.line_link_warning::text;
end;
$$;

-- Do not alter the existing 15-argument function's privileges.
revoke all on function public.create_reservation_atomic(
  text, text, text, text, text, date, text, text, date, timestamptz,
  text, text, text, text, boolean, text
) from public, anon, authenticated;

grant execute on function public.create_reservation_atomic(
  text, text, text, text, text, date, text, text, date, timestamptz,
  text, text, text, text, boolean, text
) to service_role;

commit;
