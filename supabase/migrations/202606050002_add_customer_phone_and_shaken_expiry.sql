alter table customers
add column if not exists normalized_phone text;

alter table vehicles
add column if not exists shaken_expiry_date date;

update customers
set normalized_phone = regexp_replace(coalesce(phone, ''), '\D', '', 'g')
where normalized_phone is null
  and phone is not null
  and regexp_replace(coalesce(phone, ''), '\D', '', 'g') <> '';

create or replace function set_customer_normalized_phone()
returns trigger
language plpgsql
as $$
begin
  new.normalized_phone = nullif(regexp_replace(coalesce(new.phone, ''), '\D', '', 'g'), '');
  return new;
end;
$$;

drop trigger if exists customers_set_normalized_phone on customers;

create trigger customers_set_normalized_phone
before insert or update of phone on customers
for each row execute function set_customer_normalized_phone();

create unique index if not exists customers_normalized_phone_unique_idx
on customers(normalized_phone)
where normalized_phone is not null and normalized_phone <> '';

create index if not exists vehicles_customer_model_plate_idx
on vehicles(customer_id, model_name, plate_number);

create index if not exists vehicles_shaken_expiry_date_idx
on vehicles(shaken_expiry_date);
