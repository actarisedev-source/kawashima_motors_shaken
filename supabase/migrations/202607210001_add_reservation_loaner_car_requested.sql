begin;

alter table public.reservations
  add column if not exists loaner_car_requested boolean;

-- Remove this migration's public signature when the migration is retried.
drop function if exists public.create_reservation_atomic(
  text, text, text, text, text, date, text, text, date, timestamptz, text, text, text, text, boolean, text
);

-- Keep the existing atomic reservation and customer update logic intact.
do $$
begin
  if to_regprocedure(
    'public.create_reservation_atomic(text,text,text,text,text,date,text,text,date,timestamp with time zone,text,text,text,text,text)'
  ) is not null
  and to_regprocedure(
    'public.create_reservation_atomic_customer_core(text,text,text,text,text,date,text,text,date,timestamp with time zone,text,text,text,text,text)'
  ) is null then
    alter function public.create_reservation_atomic(
      text, text, text, text, text, date, text, text, date, timestamptz, text, text, text, text, text
    ) rename to create_reservation_atomic_customer_core;
  end if;
end;
$$;

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

  select *
  into v_result
  from public.create_reservation_atomic_customer_core(
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

revoke all on function public.create_reservation_atomic_customer_core(
  text, text, text, text, text, date, text, text, date, timestamptz, text, text, text, text, text
) from public, anon, authenticated, service_role;

revoke all on function public.create_reservation_atomic(
  text, text, text, text, text, date, text, text, date, timestamptz, text, text, text, text, boolean, text
) from public, anon, authenticated;

grant execute on function public.create_reservation_atomic(
  text, text, text, text, text, date, text, text, date, timestamptz, text, text, text, text, boolean, text
) to service_role;

update public.line_automation_settings
set body = replace(
  body,
  E'ナンバー\n{{plate_number}}\n\n━━━━━━━━━━━━━━',
  E'ナンバー\n{{plate_number}}\n\n代車希望\n{{loaner_car_requested}}\n\n━━━━━━━━━━━━━━'
),
updated_at = now()
where automation_type = 'reservation_completion'
  and body not like '%{{loaner_car_requested}}%';

commit;
