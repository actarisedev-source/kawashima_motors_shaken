# Phase 4A-2 non-production verification

This directory contains local-only verification assets for the least-privilege
backup design. They must never be run against a hosted Supabase project.

The runner refuses any database URL except `127.0.0.1:55422`. It generates
ephemeral, distinct endpoint passwords in memory, creates local Auth users and
test objects, verifies read-only behavior, then removes the local fixtures.
No generated password, JWT, service-role key, or object payload is written to
the repository or verification report.

`harden-storage-auth-role.sql` is the proposed privilege cleanup for the shared
`authenticated` role. The endpoint users require no `public` schema grants;
their only data path is the two explicit `storage.objects` SELECT policies.

Run after starting the local Supabase CLI stack:

```sh
./tools/kawashima-backup/nonprod/verify-least-privilege.sh
```

The committed SQL files are deployment proposals and test fixtures, not
production migrations. Production application requires a separate reviewed
change window after Phase 4A-2.
