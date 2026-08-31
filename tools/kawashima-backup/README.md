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

## Phase 3B backup format

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

## Phase 4B production-key ceremony decision

No production age key has been generated. The approved ceremony uses the official
`FiloSottile/age` v1.3.2 stable release and the classic X25519 mode accepted by this
application. Key generation will run on an ACTARISE-controlled x86_64 computer booted
into an offline Linux live environment, with networking disabled, swap disabled,
internal disks left unmounted, and the plaintext identity kept only on a RAM-backed
filesystem. The normal ACTARISE Mac and the Kawashima Windows endpoint are not key-
generation environments and will receive only the public recipient.

Pinned production ceremony artifact:

- Source: https://github.com/FiloSottile/age/releases/tag/v1.3.2
- Archive: `age-v1.3.2-linux-amd64.tar.gz`
- Archive SHA-256: `cbe24006683f8eb669266162894b9a522a1af52f2665fbc63a4bb032ed26ac10`
- `age-keygen` SHA-256: `0a0009db842259d6717f7eeb30acb6b90d2a2eb924c6acd0a0db0ca1f1537899`
- Architecture: Linux x86-64, statically linked

Before the ceremony, both the published SHA-256 and the release Sigsum proof must be
verified using the public keys and procedure in the upstream `SIGSUM.md`. The operator
records the release URL, archive and executable hashes, Sigsum result, UTC time, and
operator names in the ceremony record. A checksum match without a valid Sigsum proof is
not sufficient to proceed.

The identity is generated into RAM with restrictive permissions and is never printed,
copied to the clipboard, placed in shell history, or written to an internal disk. It is
wrapped with age passphrase encryption before leaving RAM. Three byte-identical encrypted
copies are written to removable media from different purchase batches: one in the
ACTARISE fire-resistant safe, one in the Kawashima Motors locked safe, and one in a
separate off-site safe. Their SHA-256 hashes are recorded and each copy is tested before
the live environment is powered off. The passphrase is held separately in the ACTARISE
managed password vault with MFA, with a sealed emergency record stored away from all
three media. No passphrase is written on a recovery medium.

The canonical public-key fingerprint is lowercase SHA-256 of the exact canonical
`age1...` recipient string with no trailing newline. The full 64-hex value is checked at
generation, after recovery-media verification, during registration of endpoint IDs
`kawashima-windows-main` and `actarise-mac-secondary`, and in the first backup manifest.
The encrypted recovery media never becomes a normal backup destination.

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
recipient, recovery verification, and destination changes require an Argon2-verified backend
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
