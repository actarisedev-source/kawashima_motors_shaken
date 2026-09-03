import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import test from "node:test";

const readSource = (path) => readFileSync(new URL(`../${path}`, import.meta.url), "utf8");

test("Windows資格情報は端末ローカル永続化と再読込検証を使う", () => {
  const source = readSource("tools/kawashima-backup/src-tauri/src/credential_store.rs");
  assert.match(source, /CRED_PERSIST_LOCAL_MACHINE/);
  assert.match(source, /write_secret_with_backend/);
  assert.match(source, /let mut verified = backend\.read/);
  assert.match(source, /AccessDenied/);
  assert.match(source, /BackendError/);
  assert.doesNotMatch(source, /CRED_PERSIST_ENTERPRISE/);
});

test("Windows PostgreSQL 17 runtimeと必要DLLを固定resourceから解決する", () => {
  const source = readSource("tools/kawashima-backup/src-tauri/src/postgres_runtime.rs");
  const manifest = JSON.parse(readSource("tools/kawashima-backup/src-tauri/resources/bin/windows-x86_64/runtime-manifest.json"));
  for (const file of manifest.files) {
    const url = new URL(`../tools/kawashima-backup/src-tauri/resources/bin/windows-x86_64/${file.name}`, import.meta.url);
    assert.equal(existsSync(url), true);
    assert.equal(createHash("sha256").update(readFileSync(url)).digest("hex"), file.sha256);
  }
  assert.match(source, /WINDOWS_REQUIRED_FILES/);
  assert.match(source, /validate_windows_runtime/);
  assert.match(source, /command\.env\("PATH", directory\)/);
  assert.doesNotMatch(source, /which pg_dump|where pg_dump/);
});

test("Windows ACL・限定retry・partial cleanupを実装する", () => {
  const source = readSource("tools/kawashima-backup/src-tauri/src/file_security.rs");
  assert.match(source, /FILE_PERSISTENT_ACLS/);
  assert.match(source, /ConvertStringSecurityDescriptorToSecurityDescriptorW/);
  assert.match(source, /FILE_OPERATION_ATTEMPTS: usize = 4/);
  assert.match(source, /MOVEFILE_WRITE_THROUGH/);
  assert.match(source, /cleanup_stale_temp_dirs/);
  assert.match(source, /remove_file_with_retry/);
});

test("6段階セットアップと完了後の簡易画面を分離する", () => {
  const frontend = readSource("tools/kawashima-backup/src/main.ts");
  const config = readSource("tools/kawashima-backup/src/lib/config.ts");
  assert.match(config, /setupSteps/);
  for (const label of ["システム確認", "バックアップ保存先", "ACTARISE接続設定", "暗号化設定", "動作確認", "セットアップ完了"]) {
    assert.match(config, new RegExp(label));
  }
  assert.match(frontend, /renderSetup/);
  assert.match(frontend, /renderNormal/);
  assert.match(frontend, /バックアップ開始/);
  assert.match(frontend, /クラウド同期完了は判定しません/);
});

test("ACTARISE保守操作はRust backendの短時間tokenで拒否できる", () => {
  const maintenance = readSource("tools/kawashima-backup/src-tauri/src/maintenance.rs");
  const backup = readSource("tools/kawashima-backup/src-tauri/src/backup.rs");
  assert.match(maintenance, /SESSION_LIFETIME/);
  assert.match(maintenance, /authorize/);
  assert.match(maintenance, /Argon2/);
  assert.match(backup, /maintenance::authorize/);
  assert.match(backup, /maintenance_token/);
  const rust = readSource("tools/kawashima-backup/src-tauri/src/lib.rs");
  assert.match(rust, /settings_for_protected_check/);
  assert.match(rust, /maintenance::authorize/);
  assert.match(backup, /load_settings_from_disk\(&app\)/);
  assert.doesNotMatch(backup, /run_backup\(\s*app: AppHandle,\s*settings:/);
});

test("復旧パスワードは復号確認時だけRustへ渡して保持しない", () => {
  const backup = readSource("tools/kawashima-backup/src-tauri/src/backup.rs");
  const frontend = readSource("tools/kawashima-backup/src/main.ts");
  assert.match(backup, /recovery_password: String/);
  assert.match(backup, /Zeroizing::new\(recovery_password\)/);
  assert.match(backup, /verify_backup_file_with_passphrase/);
  assert.match(frontend, /recovery-password/);
  assert.match(frontend, /input\.value = ""/);
});

test("endpointIdをmanifest・履歴・新形式ファイル名へ記録する", () => {
  const backup = readSource("tools/kawashima-backup/src-tauri/src/backup.rs");
  assert.match(backup, /archive_file_name\(&endpoint_id/);
  assert.match(backup, /kawashima-backup-\{endpoint_id\}-\{backup_id\}\.tar\.age/);
  assert.match(backup, /endpoint_id/);
  assert.match(backup, /format_version: 2/);
});

test("NSIS perMachine日本語インストーラーとWindows CIを構成する", () => {
  const tauri = JSON.parse(readSource("tools/kawashima-backup/src-tauri/tauri.windows.conf.json"));
  assert.equal(tauri.bundle.windows.nsis.installMode, "perMachine");
  assert.deepEqual(tauri.bundle.windows.nsis.languages, ["Japanese"]);
  const workflow = readSource(".github/workflows/backup-tool-windows.yml");
  assert.match(workflow, /windows-latest/);
  assert.match(workflow, /--bundles nsis/);
  assert.match(workflow, /upload-artifact/);
});

test("CSPとOS別resourceでデスクトップ配布物を最小化する", () => {
  const common = JSON.parse(readSource("tools/kawashima-backup/src-tauri/tauri.conf.json"));
  const macos = JSON.parse(readSource("tools/kawashima-backup/src-tauri/tauri.macos.conf.json"));
  const windows = JSON.parse(readSource("tools/kawashima-backup/src-tauri/tauri.windows.conf.json"));
  assert.notEqual(common.app.security.csp, null);
  assert.match(common.app.security.csp["connect-src"], /ipc:/);
  assert.doesNotMatch(JSON.stringify(common.bundle.resources), /macos-aarch64|windows-x86_64/);
  assert.match(JSON.stringify(macos.bundle.resources), /macos-aarch64/);
  assert.doesNotMatch(JSON.stringify(macos.bundle.resources), /windows-x86_64/);
  assert.match(JSON.stringify(windows.bundle.resources), /windows-x86_64/);
  assert.doesNotMatch(JSON.stringify(windows.bundle.resources), /macos-aarch64/);
});

test("ネイティブビルド前にWeb資産を生成してTauri埋込を更新する", () => {
  const packageJson = JSON.parse(readSource("tools/kawashima-backup/package.json"));
  const refresh = readSource("tools/kawashima-backup/scripts/refresh-tauri-build.mjs");
  assert.match(packageJson.scripts.build, /prepare:native/);
  assert.match(packageJson.scripts["prepare:native"], /build:web/);
  assert.match(refresh, /utimesSync/);
  assert.match(refresh, /src-tauri\/build\.rs/);
});

test("通常バックアップ端末にage秘密鍵の永続化経路を追加しない", () => {
  for (const path of [
    "tools/kawashima-backup/src-tauri/src/lib.rs",
    "tools/kawashima-backup/src-tauri/src/credential_store.rs",
    "tools/kawashima-backup/src/lib/config.ts",
  ]) {
    assert.doesNotMatch(readSource(path), /backup-age-identity|ACCOUNT_ENCRYPTION_IDENTITY/);
  }
});
