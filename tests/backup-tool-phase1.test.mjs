import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { X509Certificate } from "node:crypto";
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
    encryptionRecipient: null,
    encryptionRecipientFingerprint: null,
    encryptionRecipientRegisteredAt: null,
    encryptionRecipientRegisteredByAppVersion: null,
    endpointId: null,
    encryptionAlgorithm: null,
    publicKeyLedger: [],
    productionKeyCeremony: null,
  });

  assert.equal(sanitized.dbPort, "5432");
  assert.equal(sanitized.dbName, "postgres");
  assert.equal(hasSecretLikeValue(sanitized), false);
  assert.equal(hasSecretLikeValue({ dbPassword: "secret" }), true);
  assert.equal(hasSecretLikeValue({ serviceRoleKey: "secret" }), true);
  assert.equal(hasSecretLikeValue({ recoveryKey: "secret" }), true);
  assert.equal(hasSecretLikeValue({ recoveryPassphrase: "secret" }), true);
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
  assert.equal(
    redactSensitiveText("recovery_passphrase='abcdefg'"),
    "recovery_passphrase='[masked]'",
  );
  assert.equal(
    redactSensitiveText("identity=AGE-SECRET-KEY-1TESTVALUE"),
    "identity=[masked]",
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
  assert.match(rust, /STORAGE_BUCKET_NAME: &str = "line-message-images"/);
  assert.doesNotMatch(rust, /upload\(/);
  assert.doesNotMatch(rust, /delete\(/);
  assert.doesNotMatch(rust, /move\(/);
});

test("Phase 1の接続確認とPhase 2のバックアップ処理を分離する", () => {
  const rust = readSource("tools/kawashima-backup/src-tauri/src/lib.rs");
  const backup = readSource("tools/kawashima-backup/src-tauri/src/backup.rs");
  const runtime = readSource("tools/kawashima-backup/src-tauri/src/postgres_runtime.rs");
  const frontend = readSource("tools/kawashima-backup/src/main.ts");

  assert.doesNotMatch(rust, /pg_restore/);
  assert.match(backup, /postgres_runtime::run_pg_dump/);
  assert.match(runtime, /inspect_custom_dump/);
  assert.match(frontend, /バックアップ開始/);
});

test("secretはRust側でOS資格情報ストアへ保存する", () => {
  const rust = readSource("tools/kawashima-backup/src-tauri/src/lib.rs");
  const credentials = readSource("tools/kawashima-backup/src-tauri/src/credential_store.rs");
  const cargo = readSource("tools/kawashima-backup/src-tauri/Cargo.toml");
  assert.match(credentials, /use keyring::\{Entry/);
  assert.match(cargo, /features = \["apple-native"\]/);
  assert.match(cargo, /windows-sys/);
  assert.match(credentials, /CredReadW/);
  assert.match(credentials, /CredWriteW/);
  assert.match(credentials, /CRED_PERSIST_LOCAL_MACHINE/);
  assert.match(credentials, /SERVICE_NAME: &str = "jp\.actarise\.kawashima\.backup"/);
  assert.match(credentials, /ACCOUNT_DB_PASSWORD: &str = "db-password"/);
  assert.match(credentials, /ACCOUNT_SERVICE_ROLE_KEY: &str = "supabase-service-role-key"/);
  assert.match(rust, /SETTINGS_FILE_NAME/);
  assert.doesNotMatch(rust, /db_password.*serde_json::to_string/);
});

test("secret保存は保存後にKeychainから再読込してstatusだけ返す", () => {
  const rust = readSource("tools/kawashima-backup/src-tauri/src/lib.rs");
  const credentials = readSource("tools/kawashima-backup/src-tauri/src/credential_store.rs");
  const frontend = readSource("tools/kawashima-backup/src/main.ts");

  assert.match(rust, /fn save_secret_values\(/);
  assert.match(rust, /credential_store::write_secret_explicit/);
  assert.match(rust, /let status = get_secret_status_from_keyring\(\);/);
  assert.match(credentials, /let mut verified = backend\.read\(account\)/);
  assert.match(frontend, /runCommand<SecretStatusResponse>\("save_secret_values"/);
  assert.match(frontend, /normalizeSecretStatus\(secretStatus\)/);
  assert.doesNotMatch(frontend, /state = \{ \.\.\.state, .*dbPassword/);
});

test("保存時と読込時のKeychain識別子は同じ定数を使う", () => {
  const rust = readSource("tools/kawashima-backup/src-tauri/src/lib.rs");
  assert.match(rust, /write_secret_explicit\(ACCOUNT_DB_PASSWORD, db_password\.trim\(\)\)/);
  assert.match(rust, /ACCOUNT_STORAGE_AUTH_PASSWORD,/);
  assert.match(rust, /read_secret\(ACCOUNT_DB_PASSWORD, "DBパスワード"\)/);
  assert.match(rust, /read_secret\(\s*ACCOUNT_STORAGE_AUTH_PASSWORD,/);
});

test("Supabase公式CAを追加し証明書検証を維持する", () => {
  const rust = readSource("tools/kawashima-backup/src-tauri/src/lib.rs");
  const tauri = readSource("tools/kawashima-backup/src-tauri/tauri.conf.json");
  const pem = readSource("tools/kawashima-backup/src-tauri/resources/prod-ca-2021.crt");
  const certificate = new X509Certificate(pem);

  assert.match(certificate.subject, /CN=Supabase Root 2021 CA/);
  assert.equal(certificate.fingerprint256, "80:70:25:AD:50:D4:ED:21:9D:2C:9C:7D:29:9C:00:4F:82:4E:B0:0C:F7:F6:5A:FE:F6:07:D0:7B:72:E6:CA:FA");
  assert.match(rust, /rustls_native_certs::load_native_certs\(\)/);
  assert.match(rust, /rustls_pemfile::certs\(&mut Cursor::new\(SUPABASE_ROOT_CA_PEM\)\)/);
  assert.match(rust, /roots\s*\.add\(certificate\)/);
  assert.match(rust, /ClientConfig::builder\(\)/);
  assert.match(rust, /with_root_certificates\(roots\)/);
  assert.match(tauri, /resources\/prod-ca-2021\.crt/);
  assert.doesNotMatch(rust, /danger_accept_invalid_certs/);
  assert.doesNotMatch(rust, /danger_accept_invalid_hostnames/);
  assert.doesNotMatch(rust, /config_no_verify/);
  assert.doesNotMatch(rust, /\.dangerous\(\)/);
});

test("DBとStorageの接続確認結果を独立して反映する", () => {
  const frontend = readSource("tools/kawashima-backup/src/main.ts");

  assert.match(frontend, /Promise\.allSettled/);
  assert.match(frontend, /db\.status === "fulfilled"/);
  assert.match(frontend, /storage\.status === "fulfilled"/);
  assert.match(frontend, /message: redactSensitiveText\(db\.reason\)/);
  assert.match(frontend, /message: redactSensitiveText\(storage\.reason\)/);
});
