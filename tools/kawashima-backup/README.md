# Kawashima Backup Tool

## Supabase database TLS

The desktop app loads the operating system trust store into Rustls and adds the
Supabase Root 2021 CA for verified PostgreSQL connections. Rustls avoids the
macOS Security Framework's certificate-validity-period policy while keeping
certificate-chain, hostname, and SNI verification enabled.

- Official guidance: https://supabase.com/docs/guides/platform/ssl-enforcement
- Official distribution: https://supabase-downloads.s3-ap-southeast-1.amazonaws.com/prod/ssl/prod-ca-2021.crt
- Subject: `CN=Supabase Root 2021 CA, O=Supabase Inc`
- SHA-256 fingerprint: `80:70:25:AD:50:D4:ED:21:9D:2C:9C:7D:29:9C:00:4F:82:4E:B0:0C:F7:F6:5A:FE:F6:07:D0:7B:72:E6:CA:FA`
- Valid until: 2031-04-26

Do not replace this certificate with a generated or unverified certificate.

## Phase 2 backup format

Phase 2 creates one `kawashima-backup-YYYYMMDD-HHMMSS-JST.tar.age` artifact.
The encrypted tar contains:

- `database/public.dump`: PostgreSQL custom-format dump of the `public` schema
- `storage/line-message-images/`: all objects downloaded from the private bucket
- `manifests/backup.json`, `database.json`, and `storage.json`
- `verification/sha256sums.txt`

The app decrypts every newly-created artifact into a temporary directory and verifies
all checksums before publishing it to the local and Google Drive sync folders. Partial
files are not retained as successful backups. Backup history is retained locally and
is not automatically deleted.

## Encryption and recovery

Backups use the standard age file format with an X25519 identity. The private identity
is stored in the operating system credential store under service
`jp.actarise.kawashima.backup` and account `backup-age-identity`; it is never returned
to the frontend. Before the first backup, the operator must export a recovery-key file
to a location outside both backup destinations and keep it securely offline.

The recovery-key file can be imported without exposing its secret value to the frontend.
The app validates its X25519 identity, compares the derived public-key fingerprint with
the current Keychain identity, and only replaces the Keychain identity after an explicit
operator confirmation. Either the Keychain identity or an imported recovery key can be
used to decrypt an encrypted backup into a temporary directory for structure and checksum
verification. Temporary verification files are removed when verification finishes; this
is normal filesystem cleanup and is not described as guaranteed secure deletion.

Recovery export metadata stores only the public-key SHA-256 fingerprint and export time.
It records that a matching key was exported, but cannot prove that the recovery-key file
still exists. Database and Storage restore remain out of scope for Phase 2.

## Bundled pg_dump

The macOS arm64 app bundles PostgreSQL 17 `pg_dump` and its non-system runtime
libraries under `src-tauri/resources/bin/macos-aarch64`. The files are packaged from
the Homebrew `postgresql@17` formula with `scripts/package-pg-dump-macos.sh`; upstream
license notices are included beside the binary. The app passes credentials only through
the child-process environment and uses `sslmode=verify-full` with the official Supabase
Root 2021 CA. Windows packaging remains a separate Phase 2 distribution task.

Relevant upstream documentation:

- PostgreSQL 17 pg_dump: https://www.postgresql.org/docs/17/app-pgdump.html
- age format / implementation: https://github.com/str4d/rage
- Supabase Storage downloads: https://supabase.com/docs/guides/storage/serving/downloads
