import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const readSource = (path) => readFileSync(new URL(`../${path}`, import.meta.url), "utf8");

test("Phase 3B候補アプリ版は0.4.0で統一する", () => {
  const packageJson = JSON.parse(readSource("tools/kawashima-backup/package.json"));
  const tauri = JSON.parse(readSource("tools/kawashima-backup/src-tauri/tauri.conf.json"));
  const cargo = readSource("tools/kawashima-backup/src-tauri/Cargo.toml");
  assert.equal(packageJson.version, "0.4.0");
  assert.equal(tauri.version, "0.4.0");
  assert.match(cargo, /version = "0\.4\.0"/);
});

test("Rust coreからOS資格情報・ファイル・PostgreSQL runtimeを分離する", () => {
  const lib = readSource("tools/kawashima-backup/src-tauri/src/lib.rs");
  assert.match(lib, /mod credential_store;/);
  assert.match(lib, /mod file_security;/);
  assert.match(lib, /mod postgres_runtime;/);
  const runtime = readSource("tools/kawashima-backup/src-tauri/src/postgres_runtime.rs");
  assert.match(runtime, /target_os = "windows"/);
  assert.match(runtime, /target_os = "macos"/);
  assert.match(runtime, /windows-x86_64/);
  assert.match(runtime, /macos-aarch64/);
});

test("通常バックアップ経路はbackup-age-identityを参照しない", () => {
  for (const path of [
    "tools/kawashima-backup/src-tauri/src/lib.rs",
    "tools/kawashima-backup/src-tauri/src/backup.rs",
    "tools/kawashima-backup/src-tauri/src/credential_store.rs",
    "tools/kawashima-backup/src/main.ts",
  ]) {
    assert.doesNotMatch(readSource(path), /backup-age-identity/);
  }
});

test("credential異常は未登録・破損・拒否・backendを区別する", () => {
  const credentials = readSource("tools/kawashima-backup/src-tauri/src/credential_store.rs");
  for (const state of ["Missing", "Corrupt", "AccessDenied", "BackendError"]) {
    assert.match(credentials, new RegExp(state));
  }
  assert.match(credentials, /自動上書きせず/);
});

test("秘密鍵文字列を設定・UI・manifest構造へ含めない", () => {
  const config = readSource("tools/kawashima-backup/src/lib/config.ts");
  const frontend = readSource("tools/kawashima-backup/src/main.ts");
  const backup = readSource("tools/kawashima-backup/src-tauri/src/backup.rs");
  const settingsType = config.slice(config.indexOf("export type BackupToolSettings"), config.indexOf("export const emptySettings"));
  assert.doesNotMatch(settingsType, /backupAgeIdentity/);
  assert.doesNotMatch(frontend, /AGE-SECRET-KEY-/);
  const manifest = backup.slice(backup.indexOf("struct BackupManifest"), backup.indexOf("struct BackupReport"));
  assert.doesNotMatch(manifest, /identity|private|secret/i);
  assert.match(manifest, /EncryptionManifest/);
  assert.match(manifest, /scheme/);
});
