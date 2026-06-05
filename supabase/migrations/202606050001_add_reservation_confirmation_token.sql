create extension if not exists "pgcrypto";

alter table reservations
add column if not exists confirmation_token text default encode(gen_random_bytes(32), 'hex');

update reservations
set confirmation_token = encode(gen_random_bytes(32), 'hex')
where confirmation_token is null;

alter table reservations
alter column confirmation_token set not null;

alter table reservations
alter column confirmation_token set default encode(gen_random_bytes(32), 'hex');

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'reservations_confirmation_token_unique'
  ) then
    alter table reservations
    add constraint reservations_confirmation_token_unique unique (confirmation_token);
  end if;
end $$;
