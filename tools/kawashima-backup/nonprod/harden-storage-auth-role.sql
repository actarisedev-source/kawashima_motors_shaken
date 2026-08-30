\set ON_ERROR_STOP on

-- The endpoint Auth users need only storage.objects access through the endpoint
-- policies. Remove legacy public-schema grants from the shared authenticated role.
revoke all privileges on all tables in schema public from authenticated;
revoke all privileges on all sequences in schema public from authenticated;
