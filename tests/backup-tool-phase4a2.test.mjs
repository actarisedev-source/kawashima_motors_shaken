import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const readSource = (path) => readFileSync(new URL(`../${path}`, import.meta.url), "utf8");

test("通常バックアップはService Role Keyを読まずAuth JWTを使う", () => {
  const backup = readSource("tools/kawashima-backup/src-tauri/src/backup.rs");
  const execute = backup.slice(backup.indexOf("async fn execute_backup"), backup.indexOf("fn validate_backup_prerequisites"));
  assert.match(execute, /storage_auth::authenticate/);
  assert.match(execute, /ACCOUNT_STORAGE_AUTH_PASSWORD/);
  assert.doesNotMatch(execute, /ACCOUNT_SERVICE_ROLE_KEY|Service Role Key|service_role_key/);
});

test("Storage Authはpublishable keyとユーザーJWTを分離しJWTを永続化しない", () => {
  const auth = readSource("tools/kawashima-backup/src-tauri/src/storage_auth.rs");
  const settings = readSource("tools/kawashima-backup/src-tauri/src/lib.rs");
  const history = readSource("tools/kawashima-backup/src-tauri/src/backup.rs");
  assert.match(auth, /grant_type=password/);
  assert.match(auth, /PasswordGrantRequest/);
  assert.match(auth, /Zeroizing<String>/);
  assert.match(auth, /AUTHORIZATION/);
  assert.match(auth, /Bearer \{access_token\}/);
  assert.doesNotMatch(
    auth,
    /#\[derive\([^\]]*Serialize[^\]]*\)\]\s*pub\(crate\) struct StorageAccessToken/,
  );
  assert.doesNotMatch(settings, /access_token:\s*String/);
  assert.doesNotMatch(history.slice(0, history.indexOf("struct BackupRunGuard")), /access_token|user_jwt/i);
});

test("AuthパスワードはOS資格情報ストアだけに保存する", () => {
  const credentials = readSource("tools/kawashima-backup/src-tauri/src/credential_store.rs");
  const settings = readSource("tools/kawashima-backup/src/lib/config.ts");
  assert.match(credentials, /ACCOUNT_STORAGE_AUTH_PASSWORD: &str = "supabase-storage-auth-password"/);
  assert.match(credentials, /CredWriteW/);
  assert.match(credentials, /set_password/);
  const settingsType = settings.slice(settings.indexOf("export type BackupToolSettings"), settings.indexOf("export const emptySettings"));
  assert.doesNotMatch(settingsType, /storageAuthPassword|serviceRoleKey|accessToken/);
});

test("旧Service Role Keyは通常処理で使わず明示保守操作だけで削除する", () => {
  const rust = readSource("tools/kawashima-backup/src-tauri/src/lib.rs");
  const credentials = readSource("tools/kawashima-backup/src-tauri/src/credential_store.rs");
  assert.match(credentials, /ACCOUNT_SERVICE_ROLE_KEY/);
  assert.match(rust, /fn delete_legacy_service_role_key/);
  assert.match(rust, /旧Service Role Keyを削除する/);
  assert.match(rust, /recently_succeeded/);
  assert.doesNotMatch(rust, /write_secret_explicit\(credential_store::ACCOUNT_SERVICE_ROLE_KEY/);
});

test("端末別Storage policyは対象bucketのSELECTだけを許可する", () => {
  const policy = readSource("tools/kawashima-backup/nonprod/storage-endpoint-policies.sql");
  assert.match(policy, /for select\s+to authenticated/gi);
  assert.match(policy, /on storage\.objects/);
  assert.match(policy, /on storage\.buckets/);
  assert.match(policy, /bucket_id = 'line-message-images'/);
  assert.match(policy, /id = 'line-message-images'/);
  assert.match(policy, /auth\.uid\(\) = :'win_uid'::uuid/);
  assert.match(policy, /auth\.uid\(\) = :'mac_uid'::uuid/);
  assert.doesNotMatch(policy, /for (?:insert|update|delete|all)/i);
});

test("空bucketと権限喪失をbucket metadata確認で区別する", () => {
  const auth = readSource("tools/kawashima-backup/src-tauri/src/storage_auth.rs");
  const backup = readSource("tools/kawashima-backup/src-tauri/src/backup.rs");
  const rust = readSource("tools/kawashima-backup/src-tauri/src/lib.rs");
  assert.match(auth, /fn verify_bucket_access/);
  assert.match(auth, /storage\/v1\/bucket\/\{bucket\}/);
  assert.match(backup, /verify_bucket_access/);
  assert.match(rust, /verify_bucket_access/);
});

test("Storage Authユーザーからpublic schema権限を除去する", () => {
  const hardening = readSource("tools/kawashima-backup/nonprod/harden-storage-auth-role.sql");
  assert.match(hardening, /revoke all privileges on all tables in schema public from authenticated/i);
  assert.match(hardening, /revoke all privileges on all sequences in schema public from authenticated/i);
});

test("端末別DBロールはBYPASSRLS付きread-onlyで強い属性を持たない", () => {
  const roles = readSource("tools/kawashima-backup/nonprod/create-backup-roles.sql");
  for (const attribute of ["bypassrls", "nosuperuser", "nocreatedb", "nocreaterole", "noreplication"]) {
    assert.match(roles, new RegExp(attribute, "i"));
  }
  assert.match(roles, /default_transaction_read_only = on/i);
  assert.match(roles, /grant select on all tables/i);
  assert.match(roles, /grant select on all sequences/i);
  assert.doesNotMatch(roles, /grant (?:insert|update|delete|truncate|create|execute)/i);
});

test("非本番runnerはlocal固定で書込み拒否・dump比較・端末失効を検証する", () => {
  const runner = readSource("tools/kawashima-backup/nonprod/verify-least-privilege.sh");
  assert.match(runner, /127\.0\.0\.1:55422/);
  assert.match(runner, /Refusing non-local database URL/);
  for (const operation of ["insert", "update", "delete", "truncate", "create table", "alter table", "drop table"]) {
    assert.match(runner.toLowerCase(), new RegExp(operation));
  }
  assert.match(runner, /pgDumpLogicalTocEqual/);
  assert.match(runner, /drop policy "backup endpoint windows/);
  assert.match(runner, /drop policy "backup endpoint mac/);
});

test("通常画面は秘密情報・技術資格情報を表示しない", () => {
  const frontend = readSource("tools/kawashima-backup/src/main.ts");
  const normal = frontend.slice(frontend.indexOf("function renderNormal"), frontend.indexOf("function bindCommonEvents"));
  assert.doesNotMatch(normal, /Service Role|JWT|DBパスワード|Authパスワード|Storage読取パスワード/);
  assert.match(normal, /バックアップ開始/);
});

test("セットアップと保守画面は資格情報の状態だけを区別して表示する", () => {
  const frontend = readSource("tools/kawashima-backup/src/main.ts");
  for (const label of ["登録済み", "未登録", "破損", "アクセス拒否", "確認失敗"]) {
    assert.match(frontend, new RegExp(label));
  }
  assert.match(frontend, /credentialBadge/);
  assert.doesNotMatch(frontend, /value="\$\{[^}]*storageAuthPassword/);
});

test("SBOM workflowはWeb・Desktop・CargoをCycloneDX JSONで分離生成する", () => {
  const workflow = readSource(".github/workflows/backup-tool-sbom.yml");
  for (const label of ["web-npm", "desktop-npm", "cargo-rust"]) {
    assert.match(workflow, new RegExp(label));
  }
  assert.match(workflow, /cyclonedx-json/g);
  assert.match(workflow, /upload-artifact/);
});
