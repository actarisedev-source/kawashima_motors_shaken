import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const readSource = (path) => readFileSync(new URL(`../${path}`, import.meta.url), "utf8");

test("本番バックアップは公開鍵台帳と鍵式metadataの一致を要求する", () => {
  const backup = readSource("tools/kawashima-backup/src-tauri/src/backup.rs");
  for (const marker of [
    "validate_backup_encryption_authorization",
    "production_key_ceremony",
    "public_key_ledger",
    "APPROVED_PRODUCTION_AGE_VERSION",
    "PublicKeyStatus::Active",
    "retired鍵では新しいバックアップを作成できません",
  ]) {
    assert.match(backup, new RegExp(marker));
  }
  assert.match(backup, /ceremony\.recipient_fingerprint != fingerprint/);
  assert.match(backup, /ledger\.public_recipient != recipient\.to_string\(\)/);
});

test("公開鍵台帳はローテーション追跡用の公開metadataだけを保持する", () => {
  const rust = readSource("tools/kawashima-backup/src-tauri/src/lib.rs");
  const config = readSource("tools/kawashima-backup/src/lib/config.ts");
  for (const field of [
    "key_id",
    "public_recipient",
    "fingerprint",
    "generated_at",
    "age_version",
    "purpose",
    "status",
    "retired_at",
  ]) {
    assert.match(rust, new RegExp(field));
  }
  const settings = config.slice(
    config.indexOf("export type BackupToolSettings"),
    config.indexOf("export const emptySettings"),
  );
  assert.match(settings, /publicKeyLedger/);
  assert.match(settings, /productionKeyCeremony/);
  assert.doesNotMatch(settings, /passphrase|privateKey|secretKey|backupAgeIdentity/);
});

test("recipient変更は旧鍵をretiredにして鍵式完了記録を無効化する", () => {
  const backup = readSource("tools/kawashima-backup/src-tauri/src/backup.rs");
  const registration = backup.slice(
    backup.indexOf("fn apply_recipient_registration"),
    backup.indexOf("fn recipient_registration_exists_and_matches"),
  );
  assert.match(registration, /retire_other_active_ledger_keys/);
  assert.match(registration, /production_key_ceremony = None/);
  assert.match(registration, /PublicKeyStatus::Retired/);
});

test("manifestと履歴にkey IDとfingerprintを保存し秘密情報を含めない", () => {
  const backup = readSource("tools/kawashima-backup/src-tauri/src/backup.rs");
  const manifest = backup.slice(
    backup.indexOf("struct BackupManifest"),
    backup.indexOf("struct BackupReport"),
  );
  assert.match(manifest, /encryption_key_id/);
  assert.match(manifest, /encryption_recipient_fingerprint/);
  assert.doesNotMatch(manifest, /identity|passphrase|private|secret/i);

  const history = backup.slice(
    backup.indexOf("struct BackupHistoryEntry"),
    backup.indexOf("struct BackupResult"),
  );
  assert.match(history, /key_id/);
  assert.match(history, /recipient_fingerprint/);
});

test("鍵式登録APIは秘密鍵とpassphraseを受け取らない", () => {
  const backup = readSource("tools/kawashima-backup/src-tauri/src/backup.rs");
  const input = backup.slice(
    backup.indexOf("struct CompleteProductionKeyCeremonyInput"),
    backup.indexOf("struct ValidatedEncryptionContext"),
  );
  assert.match(input, /google_drive_stored_at/);
  assert.match(input, /external_media_verified_at/);
  assert.doesNotMatch(input, /identity|passphrase|private|secret/i);
  assert.match(backup, /CEREMONY_COMPLETION_CONFIRMATION/);
});

test("READMEは暗号化identityをRAM上へ復号してからアプリへ渡す", () => {
  const readme = readSource("tools/kawashima-backup/README.md");
  assert.match(readme, /does not open a passphrase-encrypted identity file/);
  assert.match(readme, /RAM-backed volume/);
  assert.match(readme, /Google Drive/);
  assert.match(readme, /external SSD or USB/);
  assert.doesNotMatch(readme.slice(readme.indexOf("## Phase 4B"), readme.indexOf("## Bundled PostgreSQL")), /OneDrive/);
});

test("age秘密鍵をKeychainまたは通常端末へ保存しない", () => {
  const credentials = readSource("tools/kawashima-backup/src-tauri/src/credential_store.rs");
  const backup = readSource("tools/kawashima-backup/src-tauri/src/backup.rs");
  assert.doesNotMatch(credentials, /ACCOUNT_(?:AGE|ENCRYPTION|RECOVERY).*IDENTITY/);
  assert.doesNotMatch(backup, /write_secret_explicit\([^)]*(?:identity|recovery|age)/i);
});
