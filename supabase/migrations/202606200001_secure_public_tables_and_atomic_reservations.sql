create extension if not exists "pgcrypto";

-- Remove every existing policy, including policies that may have been created
-- manually in the Supabase SQL Editor under an unknown name.
do $$
declare
  policy_record record;
begin
  for policy_record in
    select tablename, policyname
    from pg_policies
    where schemaname = 'public'
      and tablename in (
        'customers',
        'vehicles',
        'reservations',
        'holidays',
        'slot_settings',
        'special_slot_settings'
      )
  loop
    execute format(
      'drop policy if exists %I on public.%I',
      policy_record.policyname,
      policy_record.tablename
    );
  end loop;
end;
$$;

alter table public.customers enable row level security;
alter table public.vehicles enable row level security;
alter table public.reservations enable row level security;
alter table public.holidays enable row level security;
alter table public.slot_settings enable row level security;
alter table public.special_slot_settings enable row level security;

revoke all privileges on table public.customers from public, anon, authenticated;
revoke all privileges on table public.vehicles from public, anon, authenticated;
revoke all privileges on table public.reservations from public, anon, authenticated;
revoke all privileges on table public.holidays from public, anon, authenticated;
revoke all privileges on table public.slot_settings from public, anon, authenticated;
revoke all privileges on table public.special_slot_settings from public, anon, authenticated;

grant all privileges on table public.customers to service_role;
grant all privileges on table public.vehicles to service_role;
grant all privileges on table public.reservations to service_role;
grant all privileges on table public.holidays to service_role;
grant all privileges on table public.slot_settings to service_role;
grant all privileges on table public.special_slot_settings to service_role;

create policy "Service role only customers"
on public.customers for all to service_role
using (true) with check (true);

create policy "Service role only vehicles"
on public.vehicles for all to service_role
using (true) with check (true);

create policy "Service role only reservations"
on public.reservations for all to service_role
using (true) with check (true);

create policy "Service role only holidays"
on public.holidays for all to service_role
using (true) with check (true);

create policy "Service role only slot settings"
on public.slot_settings for all to service_role
using (true) with check (true);

create policy "Service role only special slot settings"
on public.special_slot_settings for all to service_role
using (true) with check (true);

alter table public.reservations
  add column if not exists note text;

create or replace function public.create_reservation_atomic(
  p_customer_name text,
  p_customer_kana text,
  p_phone text,
  p_normalized_phone text,
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
  v_date date;
  v_time text;
  v_weekday integer;
  v_capacity integer;
  v_reserved_count integer;
  v_customer_id uuid;
  v_customer_line_user_id text;
  v_vehicle_id uuid;
  v_confirmation_token text;
  v_effective_line_user_id text := nullif(btrim(p_line_user_id), '');
  v_line_warning text;
  v_line_linked boolean := false;
  v_line_customer_id uuid;
  v_has_special_day boolean;
begin
  if nullif(btrim(p_customer_name), '') is null
    or nullif(btrim(p_phone), '') is null
    or nullif(btrim(p_normalized_phone), '') is null
    or nullif(btrim(p_vehicle_model), '') is null
    or p_reserved_at is null then
    raise exception using errcode = 'P0001', message = 'reservation_invalid_input';
  end if;

  v_date := (p_reserved_at at time zone 'Asia/Tokyo')::date;
  v_time := to_char(p_reserved_at at time zone 'Asia/Tokyo', 'HH24:MI');
  v_weekday := extract(dow from v_date)::integer;

  if v_time not in ('09:00', '10:00', '11:00', '13:00', '14:00', '15:00', '16:00') then
    raise exception using errcode = 'P0001', message = 'reservation_invalid_time';
  end if;

  -- Serialize every request for the same one-hour slot until this transaction ends.
  perform pg_advisory_xact_lock(
    hashtextextended('reservation-slot:' || p_slot_type || ':' || v_date || ':' || v_time, 0)
  );

  -- These locks also serialize duplicate customer and LINE-link creation across
  -- different reservation slots.
  perform pg_advisory_xact_lock(
    hashtextextended('reservation-phone:' || p_normalized_phone, 0)
  );
  if v_effective_line_user_id is not null then
    perform pg_advisory_xact_lock(
      hashtextextended('reservation-line:' || v_effective_line_user_id, 0)
    );
  end if;

  if exists (
    select 1
    from public.holidays h
    where (h.type = 'single' and h.date = v_date)
       or (h.type = 'weekly' and h.weekday = v_weekday)
  ) then
    raise exception using errcode = 'P0001', message = 'reservation_holiday';
  end if;

  select exists (
    select 1
    from public.special_slot_settings s
    where s.slot_type = p_slot_type
      and s.date = v_date
  ) into v_has_special_day;

  if v_has_special_day then
    select coalesce((
      select s.capacity
      from public.special_slot_settings s
      where s.slot_type = p_slot_type
        and s.date = v_date
        and s.time = v_time
      limit 1
    ), 0) into v_capacity;
  else
    select coalesce((
      select s.capacity
      from public.slot_settings s
      where s.slot_type = p_slot_type
        and s.weekday = v_weekday
        and s.time = v_time
      limit 1
    ), 1) into v_capacity;
  end if;

  if v_capacity <= 0 then
    raise exception using errcode = 'P0001', message = 'reservation_slot_stopped';
  end if;

  select count(*)::integer
  into v_reserved_count
  from public.reservations r
  where r.status <> 'キャンセル'
    and r.reserved_at >= p_reserved_at
    and r.reserved_at < p_reserved_at + interval '1 hour';

  if v_reserved_count >= v_capacity then
    raise exception using errcode = 'P0001', message = 'reservation_slot_full';
  end if;

  select c.id, c.line_user_id
  into v_customer_id, v_customer_line_user_id
  from public.customers c
  where c.normalized_phone = p_normalized_phone
  limit 1;

  if v_effective_line_user_id is not null then
    select c.id
    into v_line_customer_id
    from public.customers c
    where c.line_user_id = v_effective_line_user_id
    limit 1;

    if v_line_customer_id is not null
      and (v_customer_id is null or v_line_customer_id <> v_customer_id) then
      v_line_warning := 'このLINEアカウントは別の顧客情報と連携済みのため、予約のみ受け付けました。';
      v_effective_line_user_id := null;
    end if;
  end if;

  if v_customer_id is null then
    insert into public.customers (
      name,
      name_kana,
      phone,
      normalized_phone,
      line_user_id,
      line_display_name,
      line_picture_url,
      line_linked_at,
      line_status
    ) values (
      btrim(p_customer_name),
      nullif(btrim(p_customer_kana), ''),
      btrim(p_phone),
      p_normalized_phone,
      v_effective_line_user_id,
      case when v_effective_line_user_id is not null then nullif(btrim(p_line_display_name), '') end,
      case when v_effective_line_user_id is not null then nullif(btrim(p_line_picture_url), '') end,
      case when v_effective_line_user_id is not null then now() end,
      case when v_effective_line_user_id is not null then '連携済み' else '未連携' end
    )
    returning id, line_user_id into v_customer_id, v_customer_line_user_id;
  else
    if nullif(btrim(p_customer_kana), '') is not null then
      update public.customers
      set name_kana = btrim(p_customer_kana)
      where id = v_customer_id;
    end if;

    if v_effective_line_user_id is not null and v_customer_line_user_id is null then
      update public.customers
      set line_user_id = v_effective_line_user_id,
          line_display_name = nullif(btrim(p_line_display_name), ''),
          line_picture_url = nullif(btrim(p_line_picture_url), ''),
          line_linked_at = now(),
          line_status = '連携済み'
      where id = v_customer_id
        and line_user_id is null
      returning line_user_id into v_customer_line_user_id;
    elsif v_effective_line_user_id is not null
      and v_customer_line_user_id <> v_effective_line_user_id then
      v_line_warning := 'この顧客情報は別のLINEアカウントと連携済みのため、予約のみ受け付けました。';
    end if;
  end if;

  v_line_linked := v_customer_line_user_id is not null;

  select v.id
  into v_vehicle_id
  from public.vehicles v
  where v.customer_id = v_customer_id
    and v.model_name = btrim(p_vehicle_model)
    and v.plate_number is not distinct from nullif(btrim(p_license_plate), '')
  order by v.created_at
  limit 1;

  if v_vehicle_id is null then
    insert into public.vehicles (
      customer_id,
      model_name,
      plate_number,
      shaken_expiry_date
    ) values (
      v_customer_id,
      btrim(p_vehicle_model),
      nullif(btrim(p_license_plate), ''),
      p_shaken_expiry_date
    )
    returning id into v_vehicle_id;
  elsif p_shaken_expiry_date is not null then
    update public.vehicles
    set shaken_expiry_date = p_shaken_expiry_date
    where id = v_vehicle_id;
  end if;

  v_confirmation_token := encode(gen_random_bytes(32), 'hex');

  insert into public.reservations (
    customer_id,
    vehicle_id,
    reserved_at,
    confirmation_token,
    status,
    note
  ) values (
    v_customer_id,
    v_vehicle_id,
    p_reserved_at,
    v_confirmation_token,
    '受付中',
    nullif(btrim(p_note), '')
  )
  returning id into reservation_id;

  reservation_status := '受付中';
  confirmation_token := v_confirmation_token;
  customer_id := v_customer_id;
  vehicle_id := v_vehicle_id;
  line_linked := v_line_linked;
  line_link_warning := v_line_warning;
  return next;
end;
$$;

revoke all on function public.create_reservation_atomic(
  text, text, text, text, text, text, date, timestamptz, text, text, text, text, text
) from public, anon, authenticated;

grant execute on function public.create_reservation_atomic(
  text, text, text, text, text, text, date, timestamptz, text, text, text, text, text
) to service_role;
