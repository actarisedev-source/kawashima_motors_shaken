import assert from "node:assert/strict";
import { existsSync, readFileSync, statSync } from "node:fs";
import test from "node:test";

const readSource = (path) => readFileSync(new URL(`../${path}`, import.meta.url), "utf8");

test("PostgreSQL 17をpublic schema専用custom形式で取得して構造検査する", () => {
  const runtime = readSource("tools/kawashima-backup/src-tauri/src/postgres_runtime.rs");
  assert.match(runtime, /REQUIRED_POSTGRES_TOOL_MAJOR: u32 = 17/);
  assert.match(runtime, /"--format=custom"/);
  assert.match(runtime, /"--schema=public"/);
  assert.match(runtime, /"--no-owner"/);
  assert.match(runtime, /"--no-acl"/);
  assert.match(runtime, /"PGSSLMODE", "verify-full"/);
  assert.match(runtime, /"PGSSLROOTCERT"/);
  assert.match(runtime, /\.arg\("--list"\)/);
});

test("macOS arm64向けpg_dumpとpg_restoreを実行可能な状態で同梱する", () => {
  for (const tool of ["pg_dump", "pg_restore"]) {
    const executable = new URL(`../tools/kawashima-backup/src-tauri/resources/bin/macos-aarch64/${tool}`, import.meta.url);
    assert.equal(existsSync(executable), true);
    if (process.platform !== "win32") {
      assert.equal((statSync(executable).mode & 0o111) !== 0, true);
    }
  }
  const tauri = readSource("tools/kawashima-backup/src-tauri/tauri.macos.conf.json");
  assert.match(tauri, /resources\/bin\/macos-aarch64\/\*\*\/\*/);
});

test("Storage全件一覧・認証済みdownload・3回retryを実装する", () => {
  const backup = readSource("tools/kawashima-backup/src-tauri/src/backup.rs");
  assert.match(backup, /object\/list\/\{STORAGE_BUCKET\}/);
  assert.match(backup, /"authenticated", STORAGE_BUCKET/);
  assert.match(backup, /STORAGE_DOWNLOAD_ATTEMPTS: usize = 3/);
  assert.match(backup, /download_storage_object_with_retry/);
  assert.doesNotMatch(backup, /storage\/v1\/object\/(?:move|copy)/);
});

test("標準age passphrase方式で暗号化し公開鍵生成に依存しない", () => {
  const backup = readSource("tools/kawashima-backup/src-tauri/src/backup.rs");
  const cargo = readSource("tools/kawashima-backup/src-tauri/Cargo.toml");
  assert.match(cargo, /age = "0\.12\.1"/);
  assert.match(backup, /Encryptor::with_user_passphrase/);
  assert.match(backup, /age::scrypt::Identity::new/);
  assert.match(backup, /validate_recovery_password/);
  assert.doesNotMatch(backup, /generate_encryption_identity|ACCOUNT_ENCRYPTION_IDENTITY|x25519::Identity::generate/);
  assert.doesNotMatch(backup, /danger_accept_invalid/);
});

test("暗号化方式とendpoint metadataを設定とmanifestへ記録する", () => {
  const backup = readSource("tools/kawashima-backup/src-tauri/src/backup.rs");
  const config = readSource("tools/kawashima-backup/src/lib/config.ts");
  for (const field of ["endpoint_id", "application_version", "encryption_algorithm", "encryption_scheme"]) {
    assert.match(backup, new RegExp(field));
  }
  assert.match(config, /endpointId/);
  assert.match(config, /encryptionAlgorithm/);
  assert.doesNotMatch(config, /encryptionRecipient|publicKeyLedger|productionKeyCeremony/);
});

test("旧公開鍵変更と本番鍵式UIを残さない", () => {
  const backup = readSource("tools/kawashima-backup/src-tauri/src/backup.rs");
  const frontend = readSource("tools/kawashima-backup/src/main.ts");
  assert.doesNotMatch(backup, /replace_encryption_recipient|complete_production_key_ceremony|parse_encryption_recipient/);
  assert.match(frontend, /ACTARISE保守/);
  assert.doesNotMatch(frontend, /暗号化公開鍵を変更|本番鍵式|fingerprint|age公開鍵|recipient/);
  assert.match(frontend, /confirm\(/);
});

test("2保存先はpartialコピー・hash検証・非上書きpublishで公開する", () => {
  const backup = readSource("tools/kawashima-backup/src-tauri/src/backup.rs");
  const fileSecurity = readSource("tools/kawashima-backup/src-tauri/src/file_security.rs");
  assert.match(backup, /copy_atomic_verified/);
  assert.match(backup, /with_extension\("age\.partial"\)/);
  assert.match(backup, /sha256_file\(&partial\)/);
  assert.match(backup, /file_security::publish_new_file/);
  assert.match(fileSecurity, /destination\.exists\(\)/);
});

test("二重実行と実行中終了を防止する", () => {
  const backup = readSource("tools/kawashima-backup/src-tauri/src/backup.rs");
  const rust = readSource("tools/kawashima-backup/src-tauri/src/lib.rs");
  const frontend = readSource("tools/kawashima-backup/src/main.ts");
  assert.match(backup, /compare_exchange\(false, true/);
  assert.match(rust, /RunEvent::ExitRequested/);
  assert.match(rust, /api\.prevent_exit\(\)/);
  assert.match(frontend, /beforeunload/);
});

test("履歴に秘密情報を保存せず自動削除しない", () => {
  const backup = readSource("tools/kawashima-backup/src-tauri/src/backup.rs");
  assert.match(backup, /HISTORY_FILE_NAME: &str = "backup-history\.json"/);
  assert.match(backup, /history\.insert\(0, entry\)/);
  assert.doesNotMatch(backup, /history\.(?:truncate|pop|remove)/);
  const historyStruct = backup.slice(backup.indexOf("struct BackupHistoryEntry"), backup.indexOf("struct BackupResult"));
  assert.doesNotMatch(historyStruct, /password|service_role|db_user|db_host/i);
});

test("進捗・確認ダイアログ・履歴を画面に表示する", () => {
  const frontend = readSource("tools/kawashima-backup/src/main.ts");
  assert.match(frontend, /backup-progress/);
  assert.match(frontend, /confirm\(/);
  assert.match(frontend, /バックアップ履歴/);
  assert.match(frontend, /整合性確認/);
  assert.match(frontend, /Google Drive同期フォルダ/);
});

test("復旧パスワードは都度入力し設定やUI stateへ保持しない", () => {
  const backup = readSource("tools/kawashima-backup/src-tauri/src/backup.rs");
  const frontend = readSource("tools/kawashima-backup/src/main.ts");
  assert.match(backup, /recovery_password: String/);
  assert.match(backup, /Zeroizing::new\(recovery_password\)/);
  assert.match(frontend, /backup-recovery-password/);
  assert.match(frontend, /recovery-password/);
  assert.match(frontend, /input\.value = ""/);
  assert.doesNotMatch(frontend, /readTextFile|AGE-SECRET-KEY-/);
});

test("復旧パスワードを資格情報ストアへ保存しない", () => {
  const backup = readSource("tools/kawashima-backup/src-tauri/src/backup.rs");
  const frontend = readSource("tools/kawashima-backup/src/main.ts");
  assert.doesNotMatch(backup, /write_secret_explicit\([^)]*(passphrase|recovery)/i);
  assert.doesNotMatch(frontend, /Keychainへ再登録|Credential Managerへ保存/);
  assert.match(frontend, /Apple Passwords/);
});

test("復号確認はTempDirを全経路で解放し平文SHAとdump構造結果を返す", () => {
  const backup = readSource("tools/kawashima-backup/src-tauri/src/backup.rs");
  assert.match(backup, /PrivateTempDir::new/);
  assert.match(backup, /temp\.close\(\)/);
  assert.match(backup, /temporary_files_removed/);
  assert.match(backup, /plaintext_archive_sha256/);
  assert.match(backup, /database_structure_valid/);
  assert.match(backup, /inspect_custom_dump/);
});

test("通常バックアップ端末の資格情報ストア対象はDBとStorage secretだけ", () => {
  const credentials = readSource("tools/kawashima-backup/src-tauri/src/credential_store.rs");
  assert.match(credentials, /ACCOUNT_DB_PASSWORD/);
  assert.match(credentials, /ACCOUNT_STORAGE_AUTH_PASSWORD/);
  assert.doesNotMatch(credentials, /backup-age-identity|recovery-password|passphrase/);
});

test("通常画面に公開鍵・秘密鍵の専門語を露出しない", () => {
  const frontend = readSource("tools/kawashima-backup/src/main.ts");
  assert.match(frontend, /復旧パスワード/);
  assert.doesNotMatch(frontend, /AGE-SECRET-KEY-|privateKey|secretKey|fingerprint|age公開鍵|本番鍵式/);
});
