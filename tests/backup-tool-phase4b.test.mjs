import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const readSource = (path) => readFileSync(new URL(`../${path}`, import.meta.url), "utf8");

test("本番バックアップは標準age passphrase方式を使用する", () => {
  const backup = readSource("tools/kawashima-backup/src-tauri/src/backup.rs");
  for (const marker of [
    'ENCRYPTION_ALGORITHM: &str = "age-passphrase"',
    "Encryptor::with_user_passphrase",
    "age::scrypt::Identity::new",
    "validate_recovery_password",
  ]) {
    assert.match(backup, new RegExp(marker.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
  }
  assert.doesNotMatch(backup, /Encryptor::with_recipients|x25519|parse_encryption_recipient/);
});

test("公開鍵台帳とProduction Key Ceremonyを設定から外す", () => {
  const rust = readSource("tools/kawashima-backup/src-tauri/src/lib.rs");
  const config = readSource("tools/kawashima-backup/src/lib/config.ts");
  const settings = `${rust}\n${config}`;
  assert.doesNotMatch(settings, /PublicKeyLedgerEntry|ProductionKeyCeremonyMetadata/);
  assert.doesNotMatch(settings, /publicKeyLedger|productionKeyCeremony|encryptionRecipient/);
  assert.match(settings, /endpointId/);
  assert.match(settings, /age-passphrase/);
});

test("manifestは非秘密の暗号化方式metadataだけを保存する", () => {
  const backup = readSource("tools/kawashima-backup/src-tauri/src/backup.rs");
  const manifest = backup.slice(
    backup.indexOf("struct BackupManifest"),
    backup.indexOf("struct BackupReport"),
  );
  assert.match(manifest, /EncryptionManifest/);
  assert.match(manifest, /scheme/);
  assert.match(manifest, /format/);
  assert.match(manifest, /version/);
  assert.doesNotMatch(manifest, /passphrase|password|fingerprint|recipient|identity|private|secret/i);
});

test("復旧パスワードは都度入力し保存しない", () => {
  const frontend = readSource("tools/kawashima-backup/src/main.ts");
  const backup = readSource("tools/kawashima-backup/src-tauri/src/backup.rs");
  const credentials = readSource("tools/kawashima-backup/src-tauri/src/credential_store.rs");
  assert.match(frontend, /Apple Passwords/);
  assert.match(frontend, /backup-recovery-password/);
  assert.match(frontend, /recovery-password/);
  assert.match(frontend, /input\.value = ""/);
  assert.match(backup, /Zeroizing::new\(recovery_password\)/);
  assert.doesNotMatch(credentials, /recovery-password|passphrase|backup-age-identity/);
});

test("通常UIに旧X25519専門用語を残さない", () => {
  const frontend = readSource("tools/kawashima-backup/src/main.ts");
  assert.match(frontend, /復旧パスワード/);
  assert.doesNotMatch(frontend, /公開鍵|recipient|fingerprint|key ceremony|identity|本番鍵式|復旧鍵/);
});

test("READMEは運用者向けpassphrase復旧フローを説明する", () => {
  const readme = readSource("tools/kawashima-backup/README.md");
  assert.match(readme, /標準ageのpassphrase方式/);
  assert.match(readme, /Apple Passwords/);
  assert.match(readme, /川島モータース バックアップ復旧パスワード/);
  assert.match(readme, /バックアップファイルを選ぶ/);
  assert.match(readme, /標準age CLI/);
  assert.doesNotMatch(readme, /Production Key Ceremony|public-key ledger|X25519本番秘密鍵/);
});
