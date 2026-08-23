import { invoke } from "@tauri-apps/api/core";
import { open } from "@tauri-apps/plugin-dialog";
import {
  emptySettings,
  redactSensitiveText,
  sanitizeSettings,
  storageBucketName,
  validateFolderPath,
  type BackupToolSettings,
  type SecretFieldName,
} from "./lib/config";
import "./styles.css";

type SecretStatus = Record<SecretFieldName, boolean>;

type DbCheckResult = {
  ok: boolean;
  connectionMode: string;
  ssl: boolean;
  postgresVersion: string | null;
  publicSchemaReadable: boolean;
  message: string;
};

type StorageCheckResult = {
  ok: boolean;
  bucketExists: boolean;
  bucketPublic: boolean | null;
  objectCountEstimate: number | null;
  message: string;
};

type FolderCheckResult = {
  ok: boolean;
  path: string;
  writable: boolean;
  message: string;
};

type AppState = {
  settings: BackupToolSettings;
  secretStatus: SecretStatus;
  dbCheck: DbCheckResult | null;
  storageCheck: StorageCheckResult | null;
  localFolderCheck: FolderCheckResult | null;
  googleDriveFolderCheck: FolderCheckResult | null;
  busy: boolean;
  message: string;
};

const app = document.querySelector<HTMLDivElement>("#app");
if (!app) throw new Error("App root was not found.");

let state: AppState = {
  settings: { ...emptySettings },
  secretStatus: { dbPassword: false, serviceRoleKey: false },
  dbCheck: null,
  storageCheck: null,
  localFolderCheck: null,
  googleDriveFolderCheck: null,
  busy: false,
  message: "",
};

const runCommand = async <T>(name: string, args?: Record<string, unknown>): Promise<T> => {
  try {
    return await invoke<T>(name, args);
  } catch (error) {
    throw new Error(redactSensitiveText(error));
  }
};

const setBusy = (busy: boolean, message = "") => {
  state = { ...state, busy, message };
  render();
};

const updateSettingsFromForm = () => {
  const form = app.querySelector<HTMLFormElement>("#settings-form");
  if (!form) return;
  const formData = new FormData(form);
  state.settings = sanitizeSettings({
    supabaseProjectUrl: String(formData.get("supabaseProjectUrl") ?? ""),
    dbHost: String(formData.get("dbHost") ?? ""),
    dbPort: String(formData.get("dbPort") ?? ""),
    dbName: String(formData.get("dbName") ?? ""),
    dbUser: String(formData.get("dbUser") ?? ""),
    connectionMode: String(formData.get("connectionMode") ?? "direct") as BackupToolSettings["connectionMode"],
    localBackupPath: state.settings.localBackupPath,
    googleDrivePath: state.settings.googleDrivePath,
  });
};

const pickFolder = async (target: "localBackupPath" | "googleDrivePath") => {
  const selected = await open({ directory: true, multiple: false });
  if (typeof selected !== "string") return;
  state = {
    ...state,
    settings: { ...state.settings, [target]: selected },
  };
  render();
};

const saveSettings = async () => {
  updateSettingsFromForm();
  await runCommand("save_settings", { settings: state.settings });
  state = { ...state, message: "通常設定を保存しました。" };
  render();
};

const saveSecrets = async () => {
  const dbPassword = (app.querySelector<HTMLInputElement>("#dbPassword")?.value ?? "").trim();
  const serviceRoleKey = (app.querySelector<HTMLInputElement>("#serviceRoleKey")?.value ?? "").trim();
  await runCommand("save_secret_values", { dbPassword, serviceRoleKey });
  await loadInitialState();
  state = { ...state, message: "秘密情報をOS資格情報ストアへ保存しました。" };
  render();
};

const checkFolders = async () => {
  updateSettingsFromForm();
  const localError = validateFolderPath(state.settings.localBackupPath);
  const driveError = validateFolderPath(state.settings.googleDrivePath);
  if (localError || driveError) {
    state = { ...state, message: localError ?? driveError ?? "" };
    render();
    return;
  }
  const [localFolderCheck, googleDriveFolderCheck] = await Promise.all([
    runCommand<FolderCheckResult>("check_folder", { path: state.settings.localBackupPath }),
    runCommand<FolderCheckResult>("check_folder", { path: state.settings.googleDrivePath }),
  ]);
  state = { ...state, localFolderCheck, googleDriveFolderCheck };
  render();
};

const runChecks = async () => {
  updateSettingsFromForm();
  setBusy(true, "接続と設定を確認しています...");
  try {
    await runCommand("save_settings", { settings: state.settings });
    const [dbCheck, storageCheck, localFolderCheck, googleDriveFolderCheck] = await Promise.all([
      runCommand<DbCheckResult>("check_database", { settings: state.settings }),
      runCommand<StorageCheckResult>("check_storage", {
        projectUrl: state.settings.supabaseProjectUrl,
        bucketName: storageBucketName,
      }),
      state.settings.localBackupPath
        ? runCommand<FolderCheckResult>("check_folder", { path: state.settings.localBackupPath })
        : Promise.resolve(null),
      state.settings.googleDrivePath
        ? runCommand<FolderCheckResult>("check_folder", { path: state.settings.googleDrivePath })
        : Promise.resolve(null),
    ]);
    state = {
      ...state,
      dbCheck,
      storageCheck,
      localFolderCheck,
      googleDriveFolderCheck,
      busy: false,
      message: "読み取り専用の確認が完了しました。",
    };
  } catch (error) {
    state = { ...state, busy: false, message: redactSensitiveText(error) };
  }
  render();
};

const badge = (ok: boolean | null | undefined, label?: string) => {
  if (ok === true) return `<span class="badge ok">✓ ${label ?? "確認済み"}</span>`;
  if (ok === false) return `<span class="badge error">! ${label ?? "要確認"}</span>`;
  return `<span class="badge muted">未確認</span>`;
};

const render = () => {
  app.innerHTML = `
    <section class="shell">
      <header class="hero">
        <div>
          <p class="brand">Kawashima Motors</p>
          <h1>バックアップツール</h1>
          <p class="lead">Phase 1: 設定保存と読み取り専用の接続確認だけを行います。</p>
        </div>
        <button id="disabled-backup" class="secondary" disabled>バックアップ機能は次の実装段階で利用可能になります</button>
      </header>

      <section class="status-grid">
        <article><span>Supabase</span>${badge(Boolean(state.settings.supabaseProjectUrl), state.settings.supabaseProjectUrl ? "設定済み" : undefined)}</article>
        <article><span>データベース</span>${badge(state.dbCheck?.ok)}<small>${state.dbCheck?.postgresVersion ?? "PostgreSQL version 未確認"}</small></article>
        <article><span>画像ストレージ</span>${badge(state.storageCheck?.ok)}<small>${state.storageCheck?.objectCountEstimate == null ? "件数未確認" : `約${state.storageCheck.objectCountEstimate}件`}</small></article>
        <article><span>PC保存先</span>${badge(state.localFolderCheck?.ok ?? Boolean(state.settings.localBackupPath), state.settings.localBackupPath ? "設定済み" : undefined)}</article>
        <article><span>Google Drive保存先</span>${badge(state.googleDriveFolderCheck?.ok ?? Boolean(state.settings.googleDrivePath), state.settings.googleDrivePath ? "同期フォルダ指定済み" : undefined)}</article>
      </section>

      <form id="settings-form" class="panel">
        <h2>バックアップ設定</h2>
        <div class="two-col">
          <label>Supabase Project URL<input name="supabaseProjectUrl" value="${state.settings.supabaseProjectUrl}" placeholder="https://...supabase.co" /></label>
          <label>接続方式<select name="connectionMode">
            <option value="direct" ${state.settings.connectionMode === "direct" ? "selected" : ""}>Direct connection</option>
            <option value="session" ${state.settings.connectionMode === "session" ? "selected" : ""}>Session pooler</option>
          </select></label>
          <label>DB host<input name="dbHost" value="${state.settings.dbHost}" autocomplete="off" /></label>
          <label>DB port<input name="dbPort" value="${state.settings.dbPort}" inputmode="numeric" /></label>
          <label>Database<input name="dbName" value="${state.settings.dbName}" /></label>
          <label>DB user<input name="dbUser" value="${state.settings.dbUser}" autocomplete="off" /></label>
        </div>
        <div class="actions">
          <button id="save-settings" type="button">通常設定を保存</button>
        </div>
      </form>

      <section class="panel">
        <h2>秘密情報</h2>
        <p class="note">DBパスワードとService Role KeyはOS資格情報ストアへ保存し、画面や設定ファイルへ再表示しません。</p>
        <div class="two-col">
          <label>DBパスワード <span>${state.secretStatus.dbPassword ? "● 設定済み" : "未設定"}</span><input id="dbPassword" type="password" autocomplete="new-password" /></label>
          <label>Service Role Key <span>${state.secretStatus.serviceRoleKey ? "● 設定済み" : "未設定"}</span><input id="serviceRoleKey" type="password" autocomplete="new-password" /></label>
        </div>
        <div class="actions">
          <button id="save-secrets" type="button">秘密情報を安全に保存</button>
        </div>
      </section>

      <section class="panel">
        <h2>保存先</h2>
        <div class="path-row"><div><strong>PC保存先</strong><p>${state.settings.localBackupPath || "未設定"}</p></div><button id="pick-local" type="button">フォルダを選択</button></div>
        <div class="path-row"><div><strong>Google Drive保存先</strong><p>${state.settings.googleDrivePath || "未設定"}</p><small>クラウド同期完了ではなく、同期フォルダ指定の確認です。</small></div><button id="pick-drive" type="button">フォルダを選択</button></div>
        <div class="actions">
          <button id="check-folders" type="button">保存先を確認</button>
        </div>
      </section>

      <section class="panel">
        <h2>接続確認</h2>
        <dl class="results">
          <div><dt>DB接続</dt><dd>${state.dbCheck ? `${state.dbCheck.ok ? "✓" : "!"} ${state.dbCheck.message}` : "未確認"}</dd></div>
          <div><dt>接続方式</dt><dd>${state.dbCheck?.connectionMode ?? state.settings.connectionMode}</dd></div>
          <div><dt>public schema</dt><dd>${state.dbCheck ? (state.dbCheck.publicSchemaReadable ? "✓ 読み取り可能" : "! 未確認") : "未確認"}</dd></div>
          <div><dt>Storage bucket</dt><dd>${state.storageCheck ? `${state.storageCheck.bucketExists ? "✓" : "!"} ${storageBucketName}` : "未確認"}</dd></div>
        </dl>
        <div class="actions">
          <button id="run-checks" type="button" ${state.busy ? "disabled" : ""}>${state.busy ? "確認中..." : "接続・設定を確認"}</button>
        </div>
      </section>

      ${state.message ? `<p class="message">${state.message}</p>` : ""}
    </section>
  `;

  app.querySelector("#save-settings")?.addEventListener("click", () => void saveSettings());
  app.querySelector("#save-secrets")?.addEventListener("click", () => void saveSecrets());
  app.querySelector("#pick-local")?.addEventListener("click", () => void pickFolder("localBackupPath"));
  app.querySelector("#pick-drive")?.addEventListener("click", () => void pickFolder("googleDrivePath"));
  app.querySelector("#check-folders")?.addEventListener("click", () => void checkFolders());
  app.querySelector("#run-checks")?.addEventListener("click", () => void runChecks());
};

async function loadInitialState() {
  const [settings, secretStatus] = await Promise.all([
    runCommand<BackupToolSettings>("load_settings"),
    runCommand<SecretStatus>("get_secret_status"),
  ]);
  state = { ...state, settings: { ...emptySettings, ...settings }, secretStatus };
}

loadInitialState()
  .catch((error) => {
    state = { ...state, message: redactSensitiveText(error) };
  })
  .finally(render);
