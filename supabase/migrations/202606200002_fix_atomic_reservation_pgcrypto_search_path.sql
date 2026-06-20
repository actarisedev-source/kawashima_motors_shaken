-- Supabase installs pgcrypto in the extensions schema. Keep the RPC's fixed
-- search path while allowing its confirmation token generator to resolve.
alter function public.create_reservation_atomic(
  text, text, text, text, text, text, date, timestamptz, text, text, text, text, text
)
set search_path = pg_catalog, public, extensions;
