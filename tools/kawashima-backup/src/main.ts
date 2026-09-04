import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { confirm, open } from "@tauri-apps/plugin-dialog";
import {
  emptySettings,
  redactSensitiveText,
  sanitizeSettings,
  setupSteps,
  type BackupToolSettings,
} from "./lib/config";
import "./styles.css";

type CredentialState = "stored" | "missing" | "corrupt" | "accessDenied" | "backendError";
type SecretStatus = {
  dbPassword: boolean;
  storageAuthPassword: boolean;
  dbRestorePassword: boolean;
  storageRestoreAuthPassword: boolean;
  legacyServiceRoleKey: boolean;
  dbPasswordState: CredentialState;
  storageAuthPasswordState: CredentialState;
  dbRestorePasswordState: CredentialState;
  storageRestoreAuthPasswordState: CredentialState;
  legacyServiceRoleKeyState: CredentialState;
};
type SecretStatusResponse = Partial<SecretStatus> & {
  db_password?: boolean;
  storage_auth_password?: boolean;
  db_restore_password?: boolean;
  storage_restore_auth_password?: boolean;
  legacy_service_role_key?: boolean;
  db_password_state?: CredentialState;
  storage_auth_password_state?: CredentialState;
  db_restore_password_state?: CredentialState;
  storage_restore_auth_password_state?: CredentialState;
  legacy_service_role_key_state?: CredentialState;
};
type SetupStatus = {
  complete: boolean;
  currentStep: number;
  totalSteps: number;
  maintenanceConfigured: boolean;
  platform: string;
  applicationVersion: string;
};
type MaintenanceStatus = { configured: boolean; state: CredentialState; unlocked: boolean };
type SystemCheckResult = {
  ok: boolean; platform: string; applicationVersion: string;
  postgresRuntimeReady: boolean; privateAclReady: boolean; message: string;
};
type EncryptionStatus = {
  configured: boolean; state: string; algorithm: string; credentialMode: string;
  endpointId: string | null;
};
type BackupVerificationResult = {
  ok: boolean;
  databaseDumpPresent: boolean; manifestsPresent: boolean; storagePresent: boolean;
  verificationPresent: boolean; databaseStructureValid: boolean;
  plaintextArchiveSha256: string; temporaryFilesRemoved: boolean;
};
type DbCheckResult = {
  ok: boolean; connectionMode: string; ssl: boolean; postgresVersion: string | null;
  publicSchemaReadable: boolean; message: string;
};
type StorageCheckResult = {
  ok: boolean; bucketExists: boolean; bucketPublic: boolean | null;
  objectCountEstimate: number | null; message: string;
};
type FolderCheckResult = { ok: boolean; path: string; writable: boolean; message: string };
type BackupProgress = {
  stage: string; status: string; message: string; current: number | null; total: number | null;
};
type BackupHistoryEntry = {
  backupId: string; startedAt: string; completedAt: string; fileName: string;
  success: boolean; errorSummary: string | null; encryptedSize: number;
  databaseOk: boolean; storageOk: boolean; verificationOk: boolean;
  localCopyOk: boolean; googleDriveCopyOk: boolean; googleDriveSyncStatus?: string;
  storageObjectCount: number; publicTableCount: number; endpointId?: string;
  encryptionScheme?: string;
};
type BackupResult = { history: BackupHistoryEntry; localPath: string; googleDrivePath: string };
type RestoreResult = {
  restoreId: string; preRestoreBackupId: string; dbRestored: boolean; storageRestored: boolean;
  verificationOk: boolean; restoredStorageObjects: number; checkedTableCount: number;
};
type AppState = {
  settings: BackupToolSettings;
  setup: SetupStatus;
  maintenance: MaintenanceStatus;
  maintenanceToken: string | null;
  maintenanceOpen: boolean;
  secretStatus: SecretStatus;
  encryptionStatus: EncryptionStatus;
  systemCheck: SystemCheckResult | null;
  verificationResult: BackupVerificationResult | null;
  dbCheck: DbCheckResult | null;
  storageCheck: StorageCheckResult | null;
  localFolderCheck: FolderCheckResult | null;
  googleDriveFolderCheck: FolderCheckResult | null;
  history: BackupHistoryEntry[];
  progress: BackupProgress | null;
  restoreFilePath: string;
  busy: boolean;
  message: string;
};

const appRoot = document.querySelector<HTMLDivElement>("#app");
if (!appRoot) throw new Error("App root was not found.");
const app: HTMLDivElement = appRoot;

const emptySetup: SetupStatus = {
  complete: false, currentStep: 1, totalSteps: 6,
  maintenanceConfigured: false, platform: "", applicationVersion: "0.4.0",
};
const emptyMaintenance: MaintenanceStatus = { configured: false, state: "missing", unlocked: false };
const emptyEncryption: EncryptionStatus = {
  configured: true, state: "configured", algorithm: "age-passphrase",
  credentialMode: "enteredPerBackup", endpointId: null,
};

let state: AppState = {
  settings: { ...emptySettings }, setup: emptySetup, maintenance: emptyMaintenance,
  maintenanceToken: null, maintenanceOpen: false,
  secretStatus: {
    dbPassword: false, storageAuthPassword: false, dbRestorePassword: false,
    storageRestoreAuthPassword: false, legacyServiceRoleKey: false,
    dbPasswordState: "missing", storageAuthPasswordState: "missing",
    dbRestorePasswordState: "missing", storageRestoreAuthPasswordState: "missing",
    legacyServiceRoleKeyState: "missing",
  },
  encryptionStatus: emptyEncryption, systemCheck: null,
  verificationResult: null, dbCheck: null, storageCheck: null,
  localFolderCheck: null, googleDriveFolderCheck: null, history: [], progress: null,
  restoreFilePath: "",
  busy: false, message: "",
};

const backupProgressStages = [
  ["preflight", "事前確認"], ["database", "データベース"], ["storage", "画像ストレージ"],
  ["manifest", "検証情報"], ["archive", "アーカイブ"], ["encrypt", "暗号化"],
  ["verify", "整合性確認"], ["copy", "保存先コピー"], ["complete", "完了"],
] as const;
const restoreProgressStages = [
  ["restoreVerify", "復旧ファイル確認"], ["safetyBackup", "安全バックアップ"],
  ["storageRestore", "画像復旧"], ["dbRestore", "DB復旧"], ["postVerify", "復旧後確認"],
  ["complete", "完了"],
] as const;

const runCommand = async <T>(name: string, args?: Record<string, unknown>): Promise<T> => {
  try {
    return await invoke<T>(name, args);
  } catch (error) {
    throw new Error(redactSensitiveText(error));
  }
};
const escapeHtml = (value: unknown) => String(value ?? "")
  .replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;")
  .replaceAll('"', "&quot;").replaceAll("'", "&#039;");
const badge = (ok: boolean, label?: string) => `<span class="badge ${ok ? "ok" : "muted"}">${ok ? "✓" : "!"} ${escapeHtml(label ?? (ok ? "確認済み" : "未確認"))}</span>`;
const credentialStateLabels: Record<CredentialState, string> = {
  stored: "登録済み",
  missing: "未登録",
  corrupt: "破損",
  accessDenied: "アクセス拒否",
  backendError: "確認失敗",
};
const credentialBadge = (stored: boolean, status: CredentialState) =>
  badge(stored, credentialStateLabels[status]);
const normalizeSecretStatus = (status: SecretStatusResponse): SecretStatus => ({
  dbPassword: Boolean(status.dbPassword ?? status.db_password),
  storageAuthPassword: Boolean(status.storageAuthPassword ?? status.storage_auth_password),
  dbRestorePassword: Boolean(status.dbRestorePassword ?? status.db_restore_password),
  storageRestoreAuthPassword:
    Boolean(status.storageRestoreAuthPassword ?? status.storage_restore_auth_password),
  legacyServiceRoleKey: Boolean(status.legacyServiceRoleKey ?? status.legacy_service_role_key),
  dbPasswordState: status.dbPasswordState ?? status.db_password_state ?? "missing",
  storageAuthPasswordState:
    status.storageAuthPasswordState ?? status.storage_auth_password_state ?? "missing",
  dbRestorePasswordState:
    status.dbRestorePasswordState ?? status.db_restore_password_state ?? "missing",
  storageRestoreAuthPasswordState:
    status.storageRestoreAuthPasswordState ?? status.storage_restore_auth_password_state ?? "missing",
  legacyServiceRoleKeyState:
    status.legacyServiceRoleKeyState ?? status.legacy_service_role_key_state ?? "missing",
});
const maintenanceArgs = () => ({ maintenanceToken: state.maintenanceToken });

function updateSettingsFromForm() {
  const form = app.querySelector<HTMLFormElement>("#settings-form");
  if (!form) return;
  const data = new FormData(form);
  state.settings = sanitizeSettings({
    ...state.settings,
    supabaseProjectUrl: String(data.get("supabaseProjectUrl") ?? state.settings.supabaseProjectUrl),
    supabasePublishableKey:
      String(data.get("supabasePublishableKey") ?? state.settings.supabasePublishableKey),
    storageAuthEmail: String(data.get("storageAuthEmail") ?? state.settings.storageAuthEmail),
    storageRestoreAuthEmail:
      String(data.get("storageRestoreAuthEmail") ?? state.settings.storageRestoreAuthEmail),
    dbHost: String(data.get("dbHost") ?? state.settings.dbHost),
    dbPort: String(data.get("dbPort") ?? state.settings.dbPort),
    dbName: String(data.get("dbName") ?? state.settings.dbName),
    dbUser: String(data.get("dbUser") ?? state.settings.dbUser),
    dbRestoreUser: String(data.get("dbRestoreUser") ?? state.settings.dbRestoreUser),
    connectionMode: String(data.get("connectionMode") ?? state.settings.connectionMode) as BackupToolSettings["connectionMode"],
    endpointId: String(data.get("endpointId") ?? state.settings.endpointId ?? ""),
    encryptionAlgorithm: "age-passphrase",
  });
}

async function saveSettings() {
  try {
    updateSettingsFromForm();
    await runCommand("save_settings", { settings: state.settings, ...maintenanceArgs() });
    state.message = "設定を保存しました。";
  } catch (error) {
    state.message = redactSensitiveText(error);
  }
  render();
}

async function saveSecrets() {
  const dbPassword = app.querySelector<HTMLInputElement>("#db-password")?.value ?? "";
  const storageAuthPassword =
    app.querySelector<HTMLInputElement>("#storage-auth-password")?.value ?? "";
  const dbRestorePassword =
    app.querySelector<HTMLInputElement>("#db-restore-password")?.value ?? "";
  const storageRestoreAuthPassword =
    app.querySelector<HTMLInputElement>("#storage-restore-auth-password")?.value ?? "";
  try {
    const result = await runCommand<SecretStatusResponse>("save_secret_values", {
      dbPassword, storageAuthPassword, dbRestorePassword, storageRestoreAuthPassword,
      ...maintenanceArgs(),
    });
    state.secretStatus = normalizeSecretStatus(result);
    state.message = "接続資格情報をOS資格情報ストアへ保存し、再読込を確認しました。";
  } catch (error) {
    state.message = redactSensitiveText(error);
  }
  render();
}

async function deleteLegacyServiceRoleKey() {
  if (!state.maintenanceToken || !state.secretStatus.legacyServiceRoleKey) return;
  if (!await confirm("旧Service Role KeyをOS資格情報ストアから削除します。新しいStorage接続確認は完了していますか？", {
    title: "旧資格情報の削除", kind: "warning",
  })) return;
  const confirmation =
    app.querySelector<HTMLInputElement>("#legacy-service-role-confirmation")?.value ?? "";
  try {
    const result = await runCommand<SecretStatusResponse>("delete_legacy_service_role_key", {
      confirmation, ...maintenanceArgs(),
    });
    state.secretStatus = normalizeSecretStatus(result);
    state.message = "旧Service Role Keyを明示操作により削除しました。";
  } catch (error) {
    state.message = redactSensitiveText(error);
  }
  render();
}

async function pickFolder(target: "localBackupPath" | "googleDrivePath") {
  const selected = await open({ directory: true, multiple: false });
  if (typeof selected !== "string") return;
  state.settings = { ...state.settings, [target]: selected };
  if (target === "localBackupPath") state.localFolderCheck = null;
  else state.googleDriveFolderCheck = null;
  render();
}

async function checkFolders() {
  try {
    const [local, drive] = await Promise.all([
      runCommand<FolderCheckResult>("check_folder", { path: state.settings.localBackupPath, ...maintenanceArgs() }),
      runCommand<FolderCheckResult>("check_folder", { path: state.settings.googleDrivePath, ...maintenanceArgs() }),
    ]);
    state.localFolderCheck = local;
    state.googleDriveFolderCheck = drive;
    state.message = local.ok && drive.ok ? "2つの保存先を確認しました。" : "保存先を確認してください。";
  } catch (error) {
    state.message = redactSensitiveText(error);
  }
  render();
}

async function runConnectionChecks() {
  updateSettingsFromForm();
  try {
    await runCommand("save_settings", { settings: state.settings, ...maintenanceArgs() });
  } catch (error) {
    state.message = redactSensitiveText(error);
    render();
    return;
  }
  const [db, storage] = await Promise.allSettled([
    runCommand<DbCheckResult>("check_database", maintenanceArgs()),
    runCommand<StorageCheckResult>("check_storage", maintenanceArgs()),
  ]);
  state.dbCheck = db.status === "fulfilled" ? db.value : {
    ok: false, connectionMode: state.settings.connectionMode, ssl: false, postgresVersion: null,
    publicSchemaReadable: false, message: redactSensitiveText(db.reason),
  };
  state.storageCheck = storage.status === "fulfilled" ? storage.value : {
    ok: false, bucketExists: false, bucketPublic: null, objectCountEstimate: null,
    message: redactSensitiveText(storage.reason),
  };
  state.message = state.dbCheck.ok && state.storageCheck.ok ? "接続確認が完了しました。" : "確認できない項目があります。";
  render();
}

async function configureMaintenance() {
  const passcode = app.querySelector<HTMLInputElement>("#maintenance-passcode")?.value ?? "";
  try {
    state.maintenance = await runCommand("configure_maintenance_passcode", { passcode, ...maintenanceArgs() });
    state.setup = await runCommand("get_setup_status");
    state.message = "ACTARISE保守ロックを設定しました。";
  } catch (error) {
    state.message = redactSensitiveText(error);
  }
  render();
}

async function unlockMaintenance() {
  const passcode = app.querySelector<HTMLInputElement>("#maintenance-unlock-passcode")?.value ?? "";
  try {
    state.maintenanceToken = await runCommand("unlock_maintenance", { passcode });
    state.maintenance = await runCommand("get_maintenance_status");
    state.maintenanceOpen = true;
    state.message = "保守モードを開きました。15分後に自動的に無効になります。";
  } catch (error) {
    state.message = redactSensitiveText(error);
  }
  render();
}

async function lockMaintenance() {
  try {
    await runCommand("lock_maintenance");
    state.maintenanceToken = null;
    state.maintenanceOpen = false;
    state.maintenance = await runCommand("get_maintenance_status");
  } catch (error) {
    state.message = redactSensitiveText(error);
  }
  render();
}

async function verifyBackup() {
  if (!state.maintenanceToken) return;
  const selected = await open({ multiple: false, directory: false, filters: [{ name: "暗号化バックアップ", extensions: ["age"] }] });
  if (typeof selected !== "string") return;
  const input = app.querySelector<HTMLInputElement>("#recovery-password");
  const recoveryPassword = input?.value ?? "";
  if (input) input.value = "";
  try {
    state.verificationResult = await runCommand("verify_backup_file", {
      path: selected, recoveryPassword, ...maintenanceArgs(),
    });
    state.message = "復号・構造・SHA-256確認が完了し、一時領域を削除しました。";
  } catch (error) {
    state.verificationResult = null;
    state.message = redactSensitiveText(error);
  }
  render();
}

async function moveSetup(step: number) {
  try {
    state.setup = await runCommand("set_setup_step", { step });
  } catch (error) {
    state.message = redactSensitiveText(error);
  }
  render();
}

async function completeSetup() {
  try {
    state.setup = await runCommand("complete_setup");
    state.settings = await runCommand("load_settings");
    state.message = "初回セットアップが完了しました。";
  } catch (error) {
    state.message = redactSensitiveText(error);
  }
  render();
}

async function startBackup() {
  if (!await confirm("バックアップを開始します。完了するまでアプリを閉じないでください。", { title: "バックアップ開始", kind: "info" })) return;
  const input = app.querySelector<HTMLInputElement>("#backup-recovery-password");
  const recoveryPassword = input?.value ?? "";
  if (input) input.value = "";
  state.busy = true;
  state.progress = { stage: "preflight", status: "running", message: "準備しています。", current: null, total: null };
  render();
  try {
    const result = await runCommand<BackupResult>("run_backup", { recoveryPassword });
    state.history = await runCommand("load_backup_history");
    state.message = `バックアップが完了しました。${result.history.fileName}`;
  } catch (error) {
    state.message = redactSensitiveText(error);
  } finally {
    state.busy = false;
    render();
  }
}

async function pickRestoreFile() {
  const selected = await open({
    multiple: false,
    directory: false,
    filters: [{ name: "暗号化バックアップ", extensions: ["age"] }],
  });
  if (typeof selected !== "string") return;
  state.restoreFilePath = selected;
  state.message = "復旧するバックアップファイルを選択しました。";
  render();
}

async function startRestore() {
  if (!state.restoreFilePath) {
    await pickRestoreFile();
    if (!state.restoreFilePath) return;
  }
  const input = app.querySelector<HTMLInputElement>("#restore-recovery-password");
  const recoveryPassword = input?.value ?? "";
  if (input) input.value = "";
  if (!await confirm("選択したバックアップ時点へ業務データを戻します。現在の状態は復旧前に自動バックアップされます。復旧を開始しますか？", {
    title: "データ復旧", kind: "warning",
  })) return;
  state.busy = true;
  state.progress = {
    stage: "restoreVerify",
    status: "running",
    message: "復旧ファイルを確認しています。",
    current: null,
    total: null,
  };
  render();
  try {
    const result = await runCommand<RestoreResult>("run_restore", {
      backupPath: state.restoreFilePath,
      recoveryPassword,
    });
    state.history = await runCommand("load_backup_history");
    state.message = `復旧が完了しました。復旧前安全バックアップ: ${result.preRestoreBackupId}`;
    state.restoreFilePath = "";
  } catch (error) {
    state.message = redactSensitiveText(error);
  } finally {
    state.busy = false;
    render();
  }
}

function setupProgressMarkup() {
  return `<ol class="setup-progress">${setupSteps.map((label, index) => {
    const step = index + 1;
    return `<li class="${step === state.setup.currentStep ? "active" : step < state.setup.currentStep ? "complete" : ""}"><span>${step}</span>${escapeHtml(label)}</li>`;
  }).join("")}</ol>`;
}

function connectionFormMarkup() {
  return `<form id="settings-form" class="form-grid">
    <label>接続先URL<input name="supabaseProjectUrl" value="${escapeHtml(state.settings.supabaseProjectUrl)}" /></label>
    <label>Supabase Publishable Key<input name="supabasePublishableKey" value="${escapeHtml(state.settings.supabasePublishableKey)}" /></label>
    <label>Storage読取ユーザー<input name="storageAuthEmail" type="email" value="${escapeHtml(state.settings.storageAuthEmail)}" /></label>
    <label>Storage復旧ユーザー<input name="storageRestoreAuthEmail" type="email" value="${escapeHtml(state.settings.storageRestoreAuthEmail)}" /></label>
    <label>接続方式<select name="connectionMode"><option value="direct" ${state.settings.connectionMode === "direct" ? "selected" : ""}>Direct</option><option value="session" ${state.settings.connectionMode === "session" ? "selected" : ""}>Session pooler</option></select></label>
    <label>端末ID<input name="endpointId" value="${escapeHtml(state.settings.endpointId ?? "")}" placeholder="kawashima-windows-main" /></label>
    <label>DB host<input name="dbHost" value="${escapeHtml(state.settings.dbHost)}" /></label>
    <label>DB port<input name="dbPort" value="${escapeHtml(state.settings.dbPort)}" /></label>
    <label>Database<input name="dbName" value="${escapeHtml(state.settings.dbName)}" /></label>
    <label>DB user<input name="dbUser" value="${escapeHtml(state.settings.dbUser)}" /></label>
    <label>DB復旧ユーザー<input name="dbRestoreUser" value="${escapeHtml(state.settings.dbRestoreUser)}" placeholder="未設定時はDB userを使用" /></label>
  </form>`;
}

function setupStepMarkup() {
  switch (state.setup.currentStep) {
    case 1:
      return `<h2>システム確認</h2><p class="note">このPCで安全にバックアップを実行できるか確認します。</p>
        <dl class="results"><div><dt>OS</dt><dd>${escapeHtml(state.systemCheck?.platform ?? state.setup.platform)}</dd></div><div><dt>アプリ</dt><dd>${escapeHtml(state.setup.applicationVersion)}</dd></div><div><dt>バックアップエンジン</dt><dd>${state.systemCheck ? badge(state.systemCheck.postgresRuntimeReady) : "未確認"}</dd></div><div><dt>一時領域保護</dt><dd>${state.systemCheck ? badge(state.systemCheck.privateAclReady) : "未確認"}</dd></div></dl>
        <div class="actions"><button id="check-system">システムを確認</button></div>`;
    case 2:
      return `<h2>バックアップ保存先</h2>${pathRowsMarkup()}<div class="actions"><button id="check-folders">保存先を確認</button></div>`;
    case 3:
      return `<h2>ACTARISE 接続設定</h2><p class="note">この画面は納品担当者が設定します。秘密情報はOS資格情報ストアだけに保存されます。</p>${connectionFormMarkup()}
        <div class="secret-grid two-col"><label>DBパスワード ${credentialBadge(state.secretStatus.dbPassword, state.secretStatus.dbPasswordState)}<input id="db-password" type="password" autocomplete="new-password" /></label><label>Storage読取パスワード ${credentialBadge(state.secretStatus.storageAuthPassword, state.secretStatus.storageAuthPasswordState)}<input id="storage-auth-password" type="password" autocomplete="new-password" /></label><label>DB復旧用パスワード ${credentialBadge(state.secretStatus.dbRestorePassword, state.secretStatus.dbRestorePasswordState)}<input id="db-restore-password" type="password" autocomplete="new-password" /></label><label>Storage復旧用パスワード ${credentialBadge(state.secretStatus.storageRestoreAuthPassword, state.secretStatus.storageRestoreAuthPasswordState)}<input id="storage-restore-auth-password" type="password" autocomplete="new-password" /></label></div>
        <div class="actions"><button id="save-settings" class="outline">接続先を保存</button><button id="save-secrets">資格情報を保存</button></div>`;
    case 4:
      return `<h2>暗号化・保守設定</h2><p class="note">バックアップは復旧パスワードで暗号化します。復旧パスワードはApple Passwordsで人間が管理し、このアプリには保存しません。</p>
        ${connectionFormMarkup()}
        <div class="two-col setup-lock"><label>ACTARISE保守パスコード ${badge(state.setup.maintenanceConfigured)}<input id="maintenance-passcode" type="password" autocomplete="new-password" /></label><div class="status-box"><strong>暗号化方式</strong>${badge(state.encryptionStatus.configured, "復旧パスワード方式")}<small>標準age互換</small></div></div>
        <div class="actions"><button id="save-settings" class="outline">設定を保存</button><button id="configure-maintenance">保守ロックを設定</button></div>`;
    case 5:
      return `<h2>動作確認</h2><p class="note">接続と保存先を読み取り・書込確認します。バックアップはまだ生成しません。</p>
        ${connectionFormMarkup()}<dl class="results"><div><dt>DB接続</dt><dd>${state.dbCheck ? badge(state.dbCheck.ok, state.dbCheck.message) : "未確認"}</dd></div><div><dt>画像Storage</dt><dd>${state.storageCheck ? badge(state.storageCheck.ok, state.storageCheck.message) : "未確認"}</dd></div><div><dt>PC保存先</dt><dd>${badge(Boolean(state.localFolderCheck?.ok))}</dd></div><div><dt>同期フォルダ</dt><dd>${badge(Boolean(state.googleDriveFolderCheck?.ok))}</dd></div></dl>
        <div class="actions"><button id="run-checks">接続・設定を確認</button></div>`;
    default:
      return `<h2>セットアップ完了</h2><p class="note">すべての設定を確認後、通常のバックアップ画面へ切り替えます。</p>
        <dl class="results"><div><dt>資格情報</dt><dd>${badge(state.secretStatus.dbPassword && state.secretStatus.storageAuthPassword)}</dd></div><div><dt>保存先</dt><dd>${badge(Boolean(state.localFolderCheck?.ok && state.googleDriveFolderCheck?.ok))}</dd></div><div><dt>暗号化方式</dt><dd>${badge(state.encryptionStatus.configured, "復旧パスワード方式")}</dd></div><div><dt>保守ロック</dt><dd>${badge(state.setup.maintenanceConfigured)}</dd></div></dl>
        <div class="actions"><button id="complete-setup">セットアップを完了</button></div>`;
  }
}

function pathRowsMarkup() {
  return `<div class="path-row"><div><strong>PC保存先</strong><p>${escapeHtml(state.settings.localBackupPath || "未設定")}</p></div><button id="pick-local" class="outline">フォルダを選択</button></div>
    <div class="path-row"><div><strong>Google Drive同期フォルダ</strong><p>${escapeHtml(state.settings.googleDrivePath || "未設定")}</p><small>ここへのコピー成功を確認します。クラウド同期完了は判定しません。</small></div><button id="pick-drive" class="outline">フォルダを選択</button></div>`;
}

function historyMarkup() {
  if (!state.history.length) return `<section class="panel"><h2>バックアップ履歴</h2><p class="empty">まだ履歴はありません。</p></section>`;
  return `<section class="panel"><div class="section-heading"><div><h2>バックアップ履歴</h2><p class="note">同期フォルダへのコピーとクラウド同期完了は別です。</p></div></div><div class="history-table-wrap"><table class="history-table"><thead><tr><th>完了日時</th><th>端末</th><th>暗号化</th><th>結果</th><th>保存</th></tr></thead><tbody>${state.history.slice(0, 20).map((entry) => `<tr><td>${escapeHtml(new Date(entry.completedAt).toLocaleString("ja-JP"))}</td><td>${escapeHtml(entry.endpointId ?? "旧形式")}</td><td>${escapeHtml(entry.encryptionScheme ?? "age-passphrase")}</td><td>${entry.success ? "成功" : "失敗"}</td><td>${entry.googleDriveCopyOk ? "2か所へコピー済み / クラウド同期未確認" : "未完了"}</td></tr>`).join("")}</tbody></table></div></section>`;
}

function progressMarkup() {
  if (!state.progress) return "";
  const stages = restoreProgressStages.some(([stage]) => stage === state.progress?.stage)
    ? restoreProgressStages
    : backupProgressStages;
  const current = stages.findIndex(([stage]) => stage === state.progress?.stage);
  const title = stages === restoreProgressStages ? "復旧処理中" : "バックアップ処理中";
  return `<section class="panel progress-panel"><h2>${title}</h2><ol class="progress-list ${stages === restoreProgressStages ? "restore-progress-list" : ""}">${stages.map(([stage, label], index) => `<li class="${index < current ? "complete" : stage === state.progress?.stage ? state.progress.status : ""}"><span>${index + 1}</span>${label}</li>`).join("")}</ol>${state.progress.current && state.progress.total ? `<p class="progress-count">${state.progress.current} / ${state.progress.total}</p>` : ""}<p class="message">${escapeHtml(state.progress.message)}</p></section>`;
}

function maintenanceMarkup() {
  if (!state.maintenanceOpen) return "";
  if (!state.maintenanceToken) {
    return `<section class="panel maintenance-panel"><h2>ACTARISE保守</h2><p class="note">資格情報・暗号化・保存先の変更には保守ロック解除が必要です。</p><div class="unlock-row"><input id="maintenance-unlock-passcode" type="password" autocomplete="current-password" placeholder="保守パスコード" /><button id="unlock-maintenance">保守ロックを解除</button></div></section>`;
  }
  return `<section class="panel maintenance-panel"><div class="section-heading"><div><h2>ACTARISE保守</h2><p class="note">バックエンド認証済みの短時間セッションです。</p></div><button id="lock-maintenance" class="outline">保守モードを閉じる</button></div>
    ${connectionFormMarkup()}<div class="secret-grid two-col"><label>DBパスワード ${credentialBadge(state.secretStatus.dbPassword, state.secretStatus.dbPasswordState)}<input id="db-password" type="password" autocomplete="new-password" /></label><label>Storage読取パスワード ${credentialBadge(state.secretStatus.storageAuthPassword, state.secretStatus.storageAuthPasswordState)}<input id="storage-auth-password" type="password" autocomplete="new-password" /></label><label>DB復旧用パスワード ${credentialBadge(state.secretStatus.dbRestorePassword, state.secretStatus.dbRestorePasswordState)}<input id="db-restore-password" type="password" autocomplete="new-password" /></label><label>Storage復旧用パスワード ${credentialBadge(state.secretStatus.storageRestoreAuthPassword, state.secretStatus.storageRestoreAuthPasswordState)}<input id="storage-restore-auth-password" type="password" autocomplete="new-password" /></label></div>
    ${pathRowsMarkup()}<div class="actions"><button id="save-settings" class="outline">設定を保存</button><button id="save-secrets" class="outline">資格情報を保存</button><button id="run-checks">接続・設定を確認</button></div>
    <details class="maintenance-tools"><summary>旧資格情報の整理</summary><p class="note">旧Service Role Keyは通常処理に使用しません。新しいStorage接続確認後、明示操作でのみ削除できます。</p><div class="results"><div><dt>旧Service Role Key</dt><dd>${state.secretStatus.legacyServiceRoleKey ? badge(true, "保存済み（未使用）") : credentialBadge(false, state.secretStatus.legacyServiceRoleKeyState)}</dd></div></div><label>確認文字列<input id="legacy-service-role-confirmation" placeholder="旧Service Role Keyを削除する" /></label><div class="actions"><button id="delete-legacy-service-role" class="outline" ${state.secretStatus.legacyServiceRoleKey ? "" : "disabled"}>旧資格情報を削除</button></div></details>
    <div class="recovery-tools"><div><strong>復旧確認</strong><small>暗号化バックアップを選び、復旧パスワードで復号・検証します。</small></div><label>復旧パスワード<input id="recovery-password" type="password" autocomplete="current-password" /></label><div class="actions"><button id="verify-with-recovery">バックアップを選択して確認</button></div></div>
    ${state.verificationResult ? `<p class="message">DB・manifest・verification・pg_restore構造・SHA-256を確認し、一時ファイルを削除しました。</p>` : ""}
  </section>`;
}

function renderSetup() {
  app.innerHTML = `<main class="shell setup-shell"><header class="hero"><div><p class="brand">Kawashima Motors</p><h1>バックアップツール 初回セットアップ</h1><p class="lead">ACTARISE納品担当者が最初の1回だけ設定します。</p></div><span class="version">v${escapeHtml(state.setup.applicationVersion)}</span></header>${setupProgressMarkup()}<section class="panel setup-panel">${setupStepMarkup()}</section>${state.message ? `<p class="message" aria-live="polite">${escapeHtml(state.message)}</p>` : ""}<nav class="setup-nav"><button id="setup-prev" class="outline" ${state.setup.currentStep <= 1 ? "disabled" : ""}>戻る</button><button id="setup-next" ${state.setup.currentStep >= 6 ? "disabled" : ""}>次へ</button></nav></main>`;
}

function renderNormal() {
  const lastSuccess = state.history.find((entry) => entry.success);
  const busyLabel = state.progress && restoreProgressStages.some(([stage]) => stage === state.progress?.stage)
    ? "復旧中"
    : "バックアップ中";
  const canStart = state.setup.complete && state.secretStatus.dbPassword && state.secretStatus.storageAuthPassword
    && state.encryptionStatus.configured
    && Boolean(state.settings.localBackupPath && state.settings.googleDrivePath) && !state.busy;
  const canRestore = state.setup.complete && state.encryptionStatus.configured && !state.busy;
  const restoreFileName = state.restoreFilePath.split(/[\\/]/).pop() || "";
  app.innerHTML = `<main class="shell"><header class="hero"><div><p class="brand">Kawashima Motors</p><h1>バックアップ</h1><p class="lead">業務データを2つの保存先へ保護します。</p></div><button id="toggle-maintenance" class="outline">ACTARISE保守</button></header>
    <section class="daily-dashboard"><div><span>現在の状態</span><strong>${state.busy ? busyLabel : canStart ? "準備完了" : "設定を確認してください"}</strong></div><div><span>最終成功</span><strong>${lastSuccess ? escapeHtml(new Date(lastSuccess.completedAt).toLocaleString("ja-JP")) : "まだありません"}</strong></div><div><span>保存結果</span><strong>${lastSuccess?.localCopyOk && lastSuccess.googleDriveCopyOk ? "2か所へ保存済み" : "未確認"}</strong><small>クラウド同期完了は別途確認</small></div></section>
    <section class="operation-grid"><div class="panel operation-panel"><div><h2>${state.busy ? "処理しています" : "バックアップを開始"}</h2><p class="note">Apple Passwordsの復旧パスワードを入力します。アプリには保存しません。</p></div><label>復旧パスワード<input id="backup-recovery-password" type="password" autocomplete="current-password" /></label><button id="start-backup" ${canStart ? "" : "disabled"}>${state.busy ? "実行中..." : "バックアップ開始"}</button></div>
    <div class="panel operation-panel restore-panel"><div><h2>データを復旧</h2><p class="note">PostgreSQL public schemaと画像Storageを、選択したバックアップ時点へ戻します。</p></div><button id="pick-restore-file" class="outline" ${canRestore ? "" : "disabled"}>${restoreFileName ? "別のファイルを選択" : "データを復旧"}</button>${restoreFileName ? `<div class="selected-file"><span>選択中</span><strong>${escapeHtml(restoreFileName)}</strong></div><label>復旧パスワード<input id="restore-recovery-password" type="password" autocomplete="current-password" /></label><button id="start-restore" ${canRestore ? "" : "disabled"}>${state.busy ? "実行中..." : "復旧開始"}</button>` : ""}</div></section>
    ${progressMarkup()}${historyMarkup()}${maintenanceMarkup()}${state.message ? `<p class="message" aria-live="polite">${escapeHtml(state.message)}</p>` : ""}</main>`;
}

function bindCommonEvents() {
  app.querySelector("#pick-local")?.addEventListener("click", () => void pickFolder("localBackupPath"));
  app.querySelector("#pick-drive")?.addEventListener("click", () => void pickFolder("googleDrivePath"));
  app.querySelector("#check-folders")?.addEventListener("click", () => void checkFolders());
  app.querySelector("#save-settings")?.addEventListener("click", () => void saveSettings());
  app.querySelector("#save-secrets")?.addEventListener("click", () => void saveSecrets());
  app.querySelector("#run-checks")?.addEventListener("click", () => void runConnectionChecks());
  app.querySelector("#configure-maintenance")?.addEventListener("click", () => void configureMaintenance());
  app.querySelector("#verify-with-recovery")?.addEventListener("click", () => void verifyBackup());
  app.querySelector("#delete-legacy-service-role")?.addEventListener("click", () => void deleteLegacyServiceRoleKey());
}

function render() {
  if (state.setup.complete) renderNormal();
  else renderSetup();
  bindCommonEvents();
  app.querySelector("#check-system")?.addEventListener("click", async () => {
    try {
      state.systemCheck = await runCommand("check_system");
    } catch (error) {
      state.message = redactSensitiveText(error);
    }
    render();
  });
  app.querySelector("#setup-prev")?.addEventListener("click", () => void moveSetup(state.setup.currentStep - 1));
  app.querySelector("#setup-next")?.addEventListener("click", () => void moveSetup(state.setup.currentStep + 1));
  app.querySelector("#complete-setup")?.addEventListener("click", () => void completeSetup());
  app.querySelector("#start-backup")?.addEventListener("click", () => void startBackup());
  app.querySelector("#pick-restore-file")?.addEventListener("click", () => void pickRestoreFile());
  app.querySelector("#start-restore")?.addEventListener("click", () => void startRestore());
  app.querySelector("#toggle-maintenance")?.addEventListener("click", () => { state.maintenanceOpen = !state.maintenanceOpen; render(); });
  app.querySelector("#unlock-maintenance")?.addEventListener("click", () => void unlockMaintenance());
  app.querySelector("#lock-maintenance")?.addEventListener("click", () => void lockMaintenance());
}

async function loadInitialState() {
  const [settings, setup, maintenance, secretStatus, encryptionStatus, history, backupRunning, restoreRunning] = await Promise.all([
    runCommand<BackupToolSettings>("load_settings"), runCommand<SetupStatus>("get_setup_status"),
    runCommand<MaintenanceStatus>("get_maintenance_status"), runCommand<SecretStatusResponse>("get_secret_status"),
    runCommand<EncryptionStatus>("get_encryption_status"),
    runCommand<BackupHistoryEntry[]>("load_backup_history"), runCommand<boolean>("backup_is_running"),
    runCommand<boolean>("restore_is_running"),
  ]);
  state = { ...state, settings: { ...emptySettings, ...settings }, setup, maintenance,
    secretStatus: normalizeSecretStatus(secretStatus), encryptionStatus, history,
    busy: backupRunning || restoreRunning };
}

void listen<BackupProgress>("backup-progress", ({ payload }) => {
  state.progress = payload;
  state.busy = payload.stage !== "complete" && payload.stage !== "failed";
  render();
});
window.addEventListener("beforeunload", (event) => { if (state.busy) event.preventDefault(); });
loadInitialState().catch((error) => { state.message = redactSensitiveText(error); }).finally(render);
