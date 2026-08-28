import assert from "node:assert/strict";
import { existsSync, readFileSync, statSync } from "node:fs";
import test from "node:test";

const readSource = (path) => readFileSync(new URL(`../${path}`, import.meta.url), "utf8");

test("pg_dump 17をpublic schema専用のcustom形式で実行する", () => {
  const backup = readSource("tools/kawashima-backup/src-tauri/src/backup.rs");
  assert.match(backup, /REQUIRED_PG_DUMP_MAJOR: u32 = 17/);
  assert.match(backup, /"--format=custom"/);
  assert.match(backup, /"--schema=public"/);
  assert.match(backup, /"--no-owner"/);
  assert.match(backup, /"--no-acl"/);
  assert.match(backup, /"PGSSLMODE", "verify-full"/);
  assert.match(backup, /"PGSSLROOTCERT"/);
  assert.doesNotMatch(backup, /pg_restore/);
});

test("macOS arm64向けpg_dumpと実行ライブラリを同梱する", () => {
  const executable = new URL("../tools/kawashima-backup/src-tauri/resources/bin/macos-aarch64/pg_dump", import.meta.url);
  assert.equal(existsSync(executable), true);
  assert.equal((statSync(executable).mode & 0o111) !== 0, true);
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

test("age X25519暗号化と復号検証を必須にする", () => {
  const backup = readSource("tools/kawashima-backup/src-tauri/src/backup.rs");
  const cargo = readSource("tools/kawashima-backup/src-tauri/Cargo.toml");
  assert.match(cargo, /age = "0\.12\.1"/);
  assert.match(backup, /x25519::Identity::generate/);
  assert.match(backup, /Encryptor::with_recipients/);
  assert.match(backup, /verify_encrypted_backup/);
  assert.match(backup, /verify_checksum_manifest/);
  assert.match(backup, /backup-report\.json/);
  assert.match(backup, /status: "success"\.to_string\(\)/);
  assert.doesNotMatch(backup, /danger_accept_invalid/);
});

test("暗号化秘密鍵をUIへ返さずKeychain識別子を固定する", () => {
  const backup = readSource("tools/kawashima-backup/src-tauri/src/backup.rs");
  const frontend = readSource("tools/kawashima-backup/src/main.ts");
  assert.match(backup, /ACCOUNT_ENCRYPTION_IDENTITY: &str = "backup-age-identity"/);
  assert.match(backup, /struct EncryptionStatus/);
  assert.doesNotMatch(frontend, /AGE-SECRET-KEY-/);
  assert.doesNotMatch(frontend, /privateKey|secretKey/);
  assert.match(frontend, /fingerprint/);
});

test("2保存先はpartialコピー・hash検証・renameで公開する", () => {
  const backup = readSource("tools/kawashima-backup/src-tauri/src/backup.rs");
  assert.match(backup, /copy_atomic_verified/);
  assert.match(backup, /with_extension\("age\.partial"\)/);
  assert.match(backup, /sha256_file\(&partial\)/);
  assert.match(backup, /fs::rename\(&partial, destination\)/);
  assert.match(backup, /fs::remove_file\(path\)/);
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
  assert.match(frontend, /復号検証/);
  assert.match(frontend, /Google Drive同期フォルダ/);
});

test("復旧鍵はRust側だけで読み込み、形式検証後も実値をUIへ返さない", () => {
  const backup = readSource("tools/kawashima-backup/src-tauri/src/backup.rs");
  const frontend = readSource("tools/kawashima-backup/src/main.ts");
  assert.match(backup, /fn import_recovery_key/);
  assert.match(backup, /x25519::Identity::from_str/);
  assert.match(backup, /RecoveryKeyState\(Mutex<Option<x25519::Identity>>\)/);
  assert.match(backup, /\*loaded = None/);
  assert.match(backup, /struct RecoveryKeyImportStatus/);
  assert.doesNotMatch(frontend, /readTextFile|AGE-SECRET-KEY-/);
});

test("復旧鍵のKeychain再登録は明示確認し、保存後に再読込検証する", () => {
  const backup = readSource("tools/kawashima-backup/src-tauri/src/backup.rs");
  const frontend = readSource("tools/kawashima-backup/src/main.ts");
  assert.match(frontend, /confirm\(/);
  assert.match(frontend, /register_imported_recovery_key/);
  assert.match(backup, /write_secret\(/);
  assert.match(backup, /persist_and_verify_identity/);
  assert.match(backup, /identity_fingerprint\(&stored\) != expected_fingerprint/);
});

test("復旧鍵ファイルはUnixで作成時点から0600にする", () => {
  const backup = readSource("tools/kawashima-backup/src-tauri/src/backup.rs");
  assert.match(backup, /OpenOptionsExt/);
  assert.match(backup, /options\.mode\(0o600\)/);
});

test("Keychain鍵と復旧鍵の一致は公開鍵fingerprintだけで比較する", () => {
  const backup = readSource("tools/kawashima-backup/src-tauri/src/backup.rs");
  assert.match(backup, /fn identity_fingerprint/);
  assert.match(backup, /identity\.to_public\(\)\.to_string\(\)/);
  assert.match(backup, /matches_keychain/);
  assert.match(backup, /recovery_key_fingerprint/);
  assert.match(backup, /recovery_key_exported_at/);
});

test("Keychainまたは読み込んだ復旧鍵で一時領域へ復号検証してcleanupする", () => {
  const backup = readSource("tools/kawashima-backup/src-tauri/src/backup.rs");
  assert.match(backup, /enum VerificationKeySource/);
  assert.match(backup, /VerificationKeySource::Keychain/);
  assert.match(backup, /VerificationKeySource::Recovery/);
  assert.match(backup, /TempDir::new/);
  assert.match(backup, /drop\(temp\)/);
  assert.match(backup, /temporary_files_removed/);
  assert.doesNotMatch(backup, /pg_restore/);
});

test("復旧鍵書き出し状態は現在鍵のfingerprintと日時で判定する", () => {
  const backup = readSource("tools/kawashima-backup/src-tauri/src/backup.rs");
  const config = readSource("tools/kawashima-backup/src/lib/config.ts");
  assert.match(backup, /fn recovery_metadata_matches/);
  assert.match(backup, /recovery_key_fingerprint/);
  assert.match(backup, /recovery_key_exported_at/);
  assert.match(config, /recoveryKeyFingerprint/);
  assert.match(config, /recoveryKeyExportedAt/);
});
