begin;

alter table public.customers
  add column if not exists gender text;

alter table public.customers
  add column if not exists birth_date date;

alter table public.customers
  alter column gender set default '未設定';

alter table public.customers
  drop constraint if exists customers_gender_check;

alter table public.customers
  add constraint customers_gender_check
  check (gender is null or gender in ('男性', '女性', '未設定'));

-- Remove this migration's public signature when the migration is retried.
drop function if exists public.create_reservation_atomic(
  text, text, text, text, text, date, text, text, date, timestamptz, text, text, text, text, text
);

-- Keep the proven reservation transaction intact and expose it only as an
-- internal core function. This avoids copying slot, holiday, LINE, and locking
-- logic into a second implementation.
do $$
begin
  if to_regprocedure(
    'public.create_reservation_atomic(text,text,text,text,text,text,date,timestamp with time zone,text,text,text,text,text)'
  ) is not null
  and to_regprocedure(
    'public.create_reservation_atomic_core(text,text,text,text,text,text,date,timestamp with time zone,text,text,text,text,text)'
  ) is null then
    alter function public.create_reservation_atomic(
      text, text, text, text, text, text, date, timestamptz, text, text, text, text, text
    ) rename to create_reservation_atomic_core;
  end if;
end;
$$;

-- If both names existed for any reason, remove the obsolete public overload.
drop function if exists public.create_reservation_atomic(
  text, text, text, text, text, text, date, timestamptz, text, text, text, text, text
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
  if p_gender is not null and p_gender not in ('男性', '女性') then
    raise exception using errcode = 'P0001', message = 'reservation_invalid_gender';
  end if;

  if p_birth_date is not null
    and p_birth_date > (now() at time zone 'Asia/Tokyo')::date then
    raise exception using errcode = 'P0001', message = 'reservation_invalid_birth_date';
  end if;

  select *
  into v_result
  from public.create_reservation_atomic_core(
    p_customer_name,
    p_customer_kana,
    p_phone,
    p_normalized_phone,
    coalesce(nullif(btrim(p_vehicle_model), ''), '未登録'),
    p_license_plate,
    p_shaken_expiry_date,
    p_reserved_at,
    p_note,
    p_line_user_id,
    p_line_display_name,
    p_line_picture_url,
    p_slot_type
  );

  update public.customers
  set gender = coalesce(p_gender, gender, '未設定'),
      birth_date = coalesce(p_birth_date, birth_date)
  where id = v_result.customer_id;

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

revoke all on function public.create_reservation_atomic_core(
  text, text, text, text, text, text, date, timestamptz, text, text, text, text, text
) from public, anon, authenticated, service_role;

revoke all on function public.create_reservation_atomic(
  text, text, text, text, text, date, text, text, date, timestamptz, text, text, text, text, text
) from public, anon, authenticated;

grant execute on function public.create_reservation_atomic(
  text, text, text, text, text, date, text, text, date, timestamptz, text, text, text, text, text
) to service_role;

commit;
