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
    assert.equal((statSync(executable).mode & 0o111) !== 0, true);
  }
  const tauri = readSource("tools/kawashima-backup/src-tauri/tauri.conf.json");
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

test("age X25519公開Recipientだけで暗号化し秘密鍵生成に依存しない", () => {
  const backup = readSource("tools/kawashima-backup/src-tauri/src/backup.rs");
  const cargo = readSource("tools/kawashima-backup/src-tauri/Cargo.toml");
  assert.match(cargo, /age = "0\.12\.1"/);
  assert.match(backup, /recipient: &x25519::Recipient/);
  assert.match(backup, /Encryptor::with_recipients/);
  assert.match(backup, /parse_encryption_recipient/);
  assert.doesNotMatch(backup, /generate_encryption_identity|ACCOUNT_ENCRYPTION_IDENTITY/);
  assert.doesNotMatch(backup, /danger_accept_invalid/);
});

test("公開鍵fingerprintとendpoint metadataを設定とmanifestへ記録する", () => {
  const backup = readSource("tools/kawashima-backup/src-tauri/src/backup.rs");
  const config = readSource("tools/kawashima-backup/src/lib/config.ts");
  for (const field of ["recipient_fingerprint", "endpoint_id", "application_version", "encryption_algorithm"]) {
    assert.match(backup, new RegExp(field));
  }
  assert.match(config, /encryptionRecipientFingerprint/);
  assert.match(config, /encryptionRecipientRegisteredAt/);
  assert.match(config, /encryptionRecipientRegisteredByAppVersion/);
  assert.match(config, /endpointId/);
});

test("異なる公開鍵の通常上書きを拒否し保守変更を分離する", () => {
  const backup = readSource("tools/kawashima-backup/src-tauri/src/backup.rs");
  const frontend = readSource("tools/kawashima-backup/src/main.ts");
  assert.match(backup, /異なる公開鍵またはendpointIdは通常登録では上書きできません/);
  assert.match(backup, /replace_encryption_recipient/);
  assert.match(backup, /expected_current_fingerprint/);
  assert.match(backup, /RECIPIENT_REPLACEMENT_CONFIRMATION/);
  assert.match(frontend, /保守担当者向け: 暗号化公開鍵を変更/);
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
  assert.match(frontend, /role="dialog"/);
  assert.match(frontend, /バックアップ履歴/);
  assert.match(frontend, /整合性確認/);
  assert.match(frontend, /Google Drive同期フォルダ/);
});

test("復旧鍵はRustメモリだけへ読み込み実値をUIへ返さない", () => {
  const backup = readSource("tools/kawashima-backup/src-tauri/src/backup.rs");
  const frontend = readSource("tools/kawashima-backup/src/main.ts");
  assert.match(backup, /fn import_recovery_key/);
  assert.match(backup, /x25519::Identity::from_str/);
  assert.match(backup, /RecoveryKeyState\(Mutex<Option<x25519::Identity>>\)/);
  assert.match(backup, /clear_imported_recovery_key/);
  assert.doesNotMatch(frontend, /readTextFile|AGE-SECRET-KEY-/);
});

test("復旧鍵を資格情報ストアへ再登録せず公開鍵とfingerprint比較する", () => {
  const backup = readSource("tools/kawashima-backup/src-tauri/src/backup.rs");
  const frontend = readSource("tools/kawashima-backup/src/main.ts");
  assert.match(backup, /matches_recipient/);
  assert.match(backup, /identity_fingerprint/);
  assert.doesNotMatch(backup, /register_imported_recovery_key/);
  assert.doesNotMatch(frontend, /Keychainへ再登録/);
});

test("復号確認はTempDirを全経路で解放し平文SHAとdump構造結果を返す", () => {
  const backup = readSource("tools/kawashima-backup/src-tauri/src/backup.rs");
  assert.match(backup, /tempfile::Builder::new\(\)/);
  assert.match(backup, /drop\(temp\)/);
  assert.match(backup, /temporary_files_removed/);
  assert.match(backup, /plaintext_archive_sha256/);
  assert.match(backup, /database_structure_valid/);
  assert.match(backup, /inspect_custom_dump/);
});

test("通常バックアップ端末の資格情報ストア対象はDBとStorage secretだけ", () => {
  const credentials = readSource("tools/kawashima-backup/src-tauri/src/credential_store.rs");
  assert.match(credentials, /ACCOUNT_DB_PASSWORD/);
  assert.match(credentials, /ACCOUNT_SERVICE_ROLE_KEY/);
  assert.doesNotMatch(credentials, /backup-age-identity/);
});

test("公開鍵設定と秘密鍵らしい値を区別し秘密鍵をフロントへ露出しない", () => {
  const frontend = readSource("tools/kawashima-backup/src/main.ts");
  assert.match(frontend, /age公開鍵/);
  assert.match(frontend, /fingerprint/);
  assert.doesNotMatch(frontend, /AGE-SECRET-KEY-|privateKey|secretKey/);
});
