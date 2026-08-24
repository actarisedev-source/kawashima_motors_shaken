import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import {
  allowedConnectionModes,
  hasSecretLikeValue,
  maskSecret,
  redactSensitiveText,
  sanitizeSettings,
  storageBucketName,
  validateConnectionMode,
  validateFolderPath,
} from "../tools/kawashima-backup/src/lib/config.ts";

const readSource = (path) =>
  readFileSync(new URL(`../${path}`, import.meta.url), "utf8");

test("バックアップツールはDirectとSession poolerだけを許可する", () => {
  assert.deepEqual(allowedConnectionModes, ["direct", "session"]);
  assert.equal(validateConnectionMode("direct"), "direct");
  assert.equal(validateConnectionMode("session"), "session");
  assert.throws(() => validateConnectionMode("transaction"), /Direct connection/);
});

test("通常設定にはsecret項目を含めない", () => {
  const sanitized = sanitizeSettings({
    supabaseProjectUrl: " https://example.supabase.co ",
    dbHost: " db.example ",
    dbPort: "",
    dbName: "",
    dbUser: " postgres ",
    connectionMode: "direct",
    localBackupPath: " /tmp/backup ",
    googleDrivePath: " /tmp/drive ",
  });

  assert.equal(sanitized.dbPort, "5432");
  assert.equal(sanitized.dbName, "postgres");
  assert.equal(hasSecretLikeValue(sanitized), false);
  assert.equal(hasSecretLikeValue({ dbPassword: "secret" }), true);
  assert.equal(hasSecretLikeValue({ serviceRoleKey: "secret" }), true);
});

test("secretマスキングとエラー文言のredactionを行う", () => {
  assert.equal(maskSecret("abcd"), "****");
  assert.equal(maskSecret("abcdef"), "ab****ef");
  assert.equal(
    redactSensitiveText("postgresql://postgres:secret@example/postgres"),
    "postgresql://[masked]example/postgres",
  );
  assert.equal(
    redactSensitiveText("Authorization: Bearer secret-token"),
    "Authorization: Bearer [masked]",
  );
  assert.equal(
    redactSensitiveText("service_role_key='abcdefg'"),
    "service_role_key='[masked]'",
  );
});

test("保存先validationは空とNUL文字を拒否する", () => {
  assert.equal(validateFolderPath(""), "保存先フォルダを選択してください。");
  assert.equal(validateFolderPath("abc\0def"), "保存先フォルダの形式が正しくありません。");
  assert.equal(validateFolderPath("/tmp"), null);
});

test("Storage bucket名はline-message-imagesに固定する", () => {
  assert.equal(storageBucketName, "line-message-images");
  const rust = readSource("tools/kawashima-backup/src-tauri/src/lib.rs");
  assert.match(rust, /bucket_name != "line-message-images"/);
  assert.doesNotMatch(rust, /upload\(/);
  assert.doesNotMatch(rust, /delete\(/);
  assert.doesNotMatch(rust, /move\(/);
});

test("Phase 1はpg_dumpやバックアップ生成を実行しない", () => {
  const rust = readSource("tools/kawashima-backup/src-tauri/src/lib.rs");
  const frontend = readSource("tools/kawashima-backup/src/main.ts");

  assert.doesNotMatch(rust, /pg_dump|pg_restore|Command::new/);
  assert.doesNotMatch(frontend, /バックアップ開始[^<]*<\/button>/);
  assert.match(frontend, /バックアップ機能は次の実装段階/);
});

test("secretはRust側でOS資格情報ストアへ保存する", () => {
  const rust = readSource("tools/kawashima-backup/src-tauri/src/lib.rs");
  const cargo = readSource("tools/kawashima-backup/src-tauri/Cargo.toml");
  assert.match(rust, /keyring::Entry/);
  assert.match(cargo, /features = \["apple-native", "windows-native"\]/);
  assert.match(rust, /KEYRING_SERVICE_NAME: &str = "jp\.actarise\.kawashima\.backup"/);
  assert.match(rust, /ACCOUNT_DB_PASSWORD: &str = "db-password"/);
  assert.match(rust, /ACCOUNT_SERVICE_ROLE_KEY: &str = "supabase-service-role-key"/);
  assert.match(rust, /SETTINGS_FILE_NAME/);
  assert.doesNotMatch(rust, /db_password.*serde_json::to_string/);
});

test("secret保存は保存後にKeychainから再読込してstatusだけ返す", () => {
  const rust = readSource("tools/kawashima-backup/src-tauri/src/lib.rs");
  const frontend = readSource("tools/kawashima-backup/src/main.ts");

  assert.match(rust, /fn save_secret_values\(db_password: String, service_role_key: String\) -> Result<SecretStatus, String>/);
  assert.match(rust, /let status = get_secret_status_from_keyring\(\);/);
  assert.match(rust, /should_save_db_password && !status\.db_password/);
  assert.match(rust, /should_save_service_role_key && !status\.service_role_key/);
  assert.match(frontend, /runCommand<SecretStatusResponse>\("save_secret_values"/);
  assert.match(frontend, /normalizeSecretStatus\(secretStatus\)/);
  assert.doesNotMatch(frontend, /state = \{ \.\.\.state, .*dbPassword/);
});

test("保存時と読込時のKeychain識別子は同じ定数を使う", () => {
  const rust = readSource("tools/kawashima-backup/src-tauri/src/lib.rs");
  assert.match(rust, /write_secret\(ACCOUNT_DB_PASSWORD, db_password\.trim\(\)\)/);
  assert.match(rust, /write_secret\(ACCOUNT_SERVICE_ROLE_KEY, service_role_key\.trim\(\)\)/);
  assert.match(rust, /read_secret\(ACCOUNT_DB_PASSWORD\)/);
  assert.match(rust, /read_secret\(ACCOUNT_SERVICE_ROLE_KEY\)/);
});
