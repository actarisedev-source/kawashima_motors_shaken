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

## Phase 3A backup format

The backup core creates one `kawashima-backup-YYYYMMDD-HHMMSS-JST.tar.age` artifact.
The encrypted tar contains:

- `database/public.dump`: PostgreSQL custom-format dump of the `public` schema
- `storage/line-message-images/`: all objects downloaded from the private bucket
- `manifests/backup.json`, `database.json`, and `storage.json`
- `verification/sha256sums.txt`

Before encryption, the app verifies the PostgreSQL custom dump with PostgreSQL 17
`pg_restore --list`, records the plaintext archive SHA-256, and writes the configured
endpoint ID, application version, age algorithm, and recipient fingerprint to the
manifest. The age envelope and encrypted artifact checksum are verified before atomic
publication to the local and Google Drive sync folders. Partial files are not retained
as successful backups. Backup history is retained locally and is not automatically
deleted.

## Encryption and recovery

Backups use the standard age file format and encrypt directly to one validated X25519
recipient (`age1...`). The same public recipient can be configured on macOS and Windows
backup endpoints. Normal backup endpoints do not generate or store the matching private
identity. The registered recipient fingerprint, registration time, registering app
version, endpoint ID, and algorithm are stored as non-secret settings. A different
recipient cannot replace an existing registration through the normal setup operation;
replacement requires a separate maintenance operation, the current fingerprint, an
exact confirmation phrase, and an OS confirmation dialog.

An offline recovery-key file can be imported temporarily without exposing its secret
value to the frontend. The app validates its X25519 identity, compares the derived
public-key fingerprint with the registered recipient, and can use a matching imported
key to decrypt an artifact into a temporary directory for structure, checksum,
`pg_restore --list`, and plaintext archive SHA-256 verification. The imported identity
is memory-only and has an explicit release action. It is never registered in Keychain
or Windows Credential Manager by the normal backup application.

Temporary verification files are removed when verification finishes, including failure
paths; this is normal filesystem cleanup and is not described as guaranteed secure
deletion. Database and Storage restore remain out of scope for Phase 3A.

## Bundled PostgreSQL tools

The macOS arm64 app bundles PostgreSQL 17 `pg_dump`, `pg_restore`, and their non-system runtime
libraries under `src-tauri/resources/bin/macos-aarch64`. The files are packaged from
the Homebrew `postgresql@17` formula with `scripts/package-pg-dump-macos.sh`; upstream
license notices are included beside the binaries. The app passes credentials only through
the child-process environment and uses `sslmode=verify-full` with the official Supabase
Root 2021 CA. Windows runtime packaging remains a Phase 3B task; the core resolves tools
through a platform adapter and never falls back to an arbitrary system `PATH` binary.

Relevant upstream documentation:

- PostgreSQL 17 pg_dump: https://www.postgresql.org/docs/17/app-pgdump.html
- PostgreSQL 17 pg_restore: https://www.postgresql.org/docs/17/app-pgrestore.html
- age format / implementation: https://github.com/str4d/rage
- Supabase Storage downloads: https://supabase.com/docs/guides/storage/serving/downloads
