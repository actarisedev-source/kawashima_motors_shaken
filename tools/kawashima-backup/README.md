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

## Operator workflow

### 通常バックアップ

1. アプリを開く。
2. Apple Passwordsの「川島モータース バックアップ復旧パスワード」を確認する。
3. アプリの復旧パスワード欄へ入力する。
4. 「バックアップ開始」を押す。
5. 完了表示と履歴を確認する。

The recovery password is entered for each backup run. It is not saved in the
application settings, Git, manifests, reports, logs, Google Drive, or source code.
ACTARISE operators store it as a human-managed Apple Passwords item named
`川島モータース バックアップ復旧パスワード`.

### 復旧

1. バックアップファイルを選ぶ。
2. Apple Passwordsから復旧パスワードを確認して入力する。
3. 「復旧開始」を押す。
4. 確認ダイアログで開始する。
5. アプリが復号、manifest、hash、PostgreSQL dump structureを検証する。
6. 現在の本番状態を復旧前安全バックアップとして暗号化保存する。
7. `public` schemaと`line-message-images`を復旧する。
8. 復旧後のDB table countとStorage object SHA-256を確認する。

If the application is unavailable, the `.tar.age` backup can still be decrypted with
the 標準age CLI passphrase mode and the recovery password from Apple Passwords.

The restore feature is intentionally scoped to the business data already captured by
the backup artifact: PostgreSQL `public` schema and Supabase Storage
`line-message-images`. Supabase Auth users, Storage policies, API keys, project
settings, Edge Functions, and environment variables are operational prerequisites and
are not reconstructed from the backup file.

Before any restore write, the app must successfully decrypt the selected `.tar.age`
file, verify the manifest files, verify every SHA-256 entry, inspect the custom dump
with bundled PostgreSQL 17 `pg_restore --list`, and confirm the backup format version.
If any check fails, the app stops before writing to production DB or Storage.

Database restore is a full replacement restore for the dump's `public` schema content,
not a merge. The app uses bundled `pg_restore` with `--clean`, `--if-exists`,
`--no-owner`, `--no-acl`, `--single-transaction`, `--exit-on-error`, and
`--schema=public`. This targets `public` only and does not restore `auth`, `storage`,
or other Supabase-managed schemas.

Storage restore uploads/upserts only manifest-listed objects into
`line-message-images`. Objects that currently exist but are not listed in the selected
backup manifest are not deleted in this first restore version, and no DELETE permission
is required.

## Backup format

The backup core creates one
`kawashima-backup-ENDPOINT-ID-YYYYMMDD-HHMMSS-JST.tar.age` artifact. Phase 3A and
older filenames remain readable because restore verification does not infer metadata
from the filename; endpoint metadata is authoritative inside the encrypted manifest.
The encrypted tar contains:

- `database/public.dump`: PostgreSQL custom-format dump of the `public` schema
- `storage/line-message-images/`: all objects discovered through the endpoint's
  read-only Storage policy
- `manifests/backup.json`, `database.json`, and `storage.json`
- `verification/sha256sums.txt`

New backups also record per-table row counts in `manifests/database.json` as
`tableCounts`. Restore verification uses them when present and falls back to the legacy
`publicTableCount` for older compatible backups.

Before encryption, the app verifies the PostgreSQL custom dump with PostgreSQL 17
`pg_restore --list`, records the plaintext archive SHA-256, and writes the configured
endpoint ID, application version, and non-secret age encryption metadata to the
manifest. The age envelope, passphrase decryptability, and encrypted artifact checksum are verified before atomic
publication to the local and Google Drive sync folders. Partial files are not retained
as successful backups. Backup history is retained locally and is not automatically
deleted.

## Encryption and recovery

Backups use the standard age file format with standard age passphrase encryption
(`age-passphrase`, 標準ageのpassphrase方式). The application uses the Rust age library
to create an ordinary age scrypt-recipient file, not a custom encryption format. The
manifest records only:

```yaml
encryption:
  scheme: age-passphrase
  format: age
  version: 1
```

The recovery password itself, a password hash, and any value that would weaken
decryption are not written to the manifest, backup report, settings, history, logs, or
Google Drive. The application also does not store the recovery password in Keychain or
Windows Credential Manager. For this monthly manual operation, entering the recovery
password each time is simpler to audit and avoids placing another long-lived copy of the
recovery password on the backup endpoint.

Temporary plaintext database dumps, Storage files, and tar archives exist only in the
application's private temporary work directory while a backup or verification is running.
They are removed on completion or failure as ordinary filesystem cleanup. This is not a
guarantee of secure deletion.

Google Drive receives only the encrypted `.tar.age` artifact. Plain database dumps,
plain Storage files, and recovery passwords must not be copied to Google Drive. External
SSD/USB media are no longer part of the recovery-secret custody model and are not a
backup prerequisite.

Sigsum verification of an external age binary is not required for normal backup
operation, because the application encrypts and decrypts through its bundled Rust
dependency. A standard age CLI remains useful for disaster recovery or independent
compatibility testing; when a downloaded CLI is used for an operational recovery drill,
verify its release through the upstream project's current guidance.

## Bundled PostgreSQL tools

The macOS arm64 app bundles PostgreSQL 17 `pg_dump`, `pg_restore`, and their non-system runtime
libraries under `src-tauri/resources/bin/macos-aarch64`. The files are packaged from
the Homebrew `postgresql@17` formula with `scripts/package-pg-dump-macos.sh`; upstream
license notices are included beside the binaries. Windows x64 bundles the EDB official
PostgreSQL 17.11 command-line binaries, their required DLLs, a SHA-256 runtime manifest,
and upstream notices under `src-tauri/resources/bin/windows-x86_64`. The source archive is
the PostgreSQL Windows binary ZIP linked by the PostgreSQL project for embedding in another
installer. The app launches these binaries by absolute path, verifies every packaged file,
sets the child working directory and Windows child `PATH` to the runtime directory, and never
falls back to a system PostgreSQL installation. The app passes credentials only through
the child-process environment and uses `sslmode=verify-full` with the official Supabase
Root 2021 CA.

Tauri platform configuration files package only the runtime for the target OS:
`tauri.macos.conf.json` includes the macOS arm64 runtime and
`tauri.windows.conf.json` includes the Windows x64 runtime. The common CA remains in both
packages. The desktop webview also uses a restrictive CSP that permits local application
assets and Tauri IPC without enabling arbitrary remote content.

`npm run build` generates and checks the web frontend before refreshing the Tauri build
script timestamp. This forces Cargo to re-embed the current frontend even when a previous
`cargo check` cached an older `dist` directory; it avoids shipping stale UI assets on either
platform.

## Windows desktop behavior

Windows x64 credentials use Generic Credentials with `CRED_PERSIST_LOCAL_MACHINE`; values
remain scoped to the same Windows user and computer instead of requesting enterprise roaming.
Writes are read back and compared before success is returned. Missing, corrupt, denied, and
backend failure states remain distinct and are never treated as permission to overwrite.
The Windows CI job also round-trips a uniquely named synthetic Generic Credential and removes
it immediately; it never addresses the production credential account names.

Private files are created with a protected current-user-only DACL. FAT/exFAT and other volumes
without `FILE_PERSISTENT_ACLS` are rejected for secret-file operations. Temporary-directory
cleanup, partial publication, and replacement use bounded retries for transient Windows file
locks. This is normal cleanup and is not claimed to be secure deletion.

Tauri is configured for an unsigned Japanese NSIS x64 test installer using `perMachine`
installation under Program Files. Application settings and Windows Credentials live outside
the installation directory and are not removed by installer replacement. For the current
direct ACTARISE installation at one Kawashima Motors site, the approved Phase 4A operating
decision is to deploy an unsigned installer only after an ACTARISE operator compares its
SHA-256 with the release ledger. SmartScreen warnings are expected and must not be bypassed
without that comparison. Paid code signing must be reconsidered before any public,
multi-customer, or commercial distribution.

## Setup and maintenance boundary

The shared macOS/Windows UI has a six-step ACTARISE setup wizard. After completion the normal
screen exposes only backup start, current state, last success, and save results. Credential,
recovery verification, and destination changes require an Argon2-verified backend
maintenance session. The opaque session token is memory-only and expires after 15 minutes;
CSS visibility is not used as the authorization boundary.

Copying to a Google Drive for desktop sync folder is reported only as a local file-copy result.
The app does not claim that Google Drive cloud synchronization has completed.

## Least-privilege endpoint credentials

Normal backups no longer use a Supabase Service Role Key. Each endpoint uses its own
Supabase Auth user, a publishable key, and an Auth password stored only in Keychain or
Windows Credential Manager. The password grant returns a short-lived user JWT that remains
in Rust memory for the Storage operation and is not written to settings, manifests, history,
logs, or frontend state. Separate `storage.objects` SELECT policies permit each endpoint
to list only `line-message-images`; no write policy is granted.

The legacy `supabase-service-role-key` credential account is retained for older installed
versions but is not read by the normal backup path. It is never migrated, overwritten, or
deleted automatically. The new app can remove it only from an unlocked maintenance session,
after a recent successful check with the replacement credentials and an exact confirmation
phrase.

Database dumps use separate Windows and macOS login roles with `BYPASSRLS`, schema usage,
table/sequence SELECT, and `default_transaction_read_only=on`. They are not superusers and
receive no mutation, DDL, or function-execution grant. The reproducible local-only role,
Storage policy, revocation, privilege-audit, and logical dump comparison assets are under
`nonprod/`; the runner refuses non-loopback database endpoints.

Production restore requires separately provisioned restore credentials. The read-only
backup Storage Auth user must not be reused for restore. The restore Storage Auth user
needs only `storage.buckets` SELECT and `storage.objects` SELECT/INSERT/UPDATE for
`line-message-images`; it does not need DELETE and must not receive access to any other
bucket. A review template for those policies lives at
`operations/storage-restore-policies.sql` and is not applied by the application.

DB restore can use the configured DB user only when ACTARISE has confirmed it can restore
`public` safely. Otherwise configure a dedicated restore DB user and store its password
only in the OS credential store. Restore passwords and the recovery password are not
stored in settings, manifests, reports, logs, Git, Google Drive, or console output.

Each restore writes a local `restore-journal.json` entry with non-secret metadata:
restore ID, selected backup file name, encrypted backup SHA-256, pre-restore safety
backup ID, DB/Storage/verification status, timestamps, and sanitized error summary.

`line-message-images` remains a public bucket for existing LINE delivery URLs. RLS controls
object discovery by the backup tool, but cannot revoke access to an already-known public
object URL. Endpoint policy removal immediately stops listing and therefore stops the normal
backup workflow. Changing the bucket to private would require a separately reviewed LINE URL
delivery design.

## SBOM

The `Backup Tool SBOM` GitHub Actions workflow generates separate CycloneDX JSON inventories
for the root web npm lockfile, desktop npm lockfile, and Cargo lockfile, then publishes them as
one CI artifact. These unsigned build-preparation artifacts contain dependency metadata only;
the workflow leaves room for a later Windows signing stage after the native build.

Relevant upstream documentation:

- PostgreSQL 17 pg_dump: https://www.postgresql.org/docs/17/app-pgdump.html
- PostgreSQL 17 pg_restore: https://www.postgresql.org/docs/17/app-pgrestore.html
- age format / implementation: https://github.com/str4d/rage
- Supabase Storage downloads: https://supabase.com/docs/guides/storage/serving/downloads
