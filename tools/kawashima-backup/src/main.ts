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
  legacyServiceRoleKey: boolean;
  dbPasswordState: CredentialState;
  storageAuthPasswordState: CredentialState;
  legacyServiceRoleKeyState: CredentialState;
};
type SecretStatusResponse = Partial<SecretStatus> & {
  db_password?: boolean;
  storage_auth_password?: boolean;
  legacy_service_role_key?: boolean;
  db_password_state?: CredentialState;
  storage_auth_password_state?: CredentialState;
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
type EncryptionRecipientStatus = {
  configured: boolean; state: string; recipient: string | null; fingerprint: string | null;
  registeredAt: string | null; registeredByAppVersion: string | null;
  endpointId: string | null; algorithm: string;
  ceremonyCompleted: boolean; ceremonyKeyId: string | null;
  ceremonyCompletedAt: string | null; keyStatus: "active" | "retired" | null;
};
type RecoveryKeyImportStatus = {
  loaded: boolean; valid: boolean; fingerprint: string; matchesRecipient: boolean | null;
};
type BackupVerificationResult = {
  ok: boolean; keySource: string; keyFingerprint: string;
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
  keyId?: string; recipientFingerprint?: string;
};
type BackupResult = { history: BackupHistoryEntry; localPath: string; googleDrivePath: string };
type AppState = {
  settings: BackupToolSettings;
  setup: SetupStatus;
  maintenance: MaintenanceStatus;
  maintenanceToken: string | null;
  maintenanceOpen: boolean;
  secretStatus: SecretStatus;
  recipientStatus: EncryptionRecipientStatus;
  systemCheck: SystemCheckResult | null;
  recoveryKeyStatus: RecoveryKeyImportStatus | null;
  verificationResult: BackupVerificationResult | null;
  dbCheck: DbCheckResult | null;
  storageCheck: StorageCheckResult | null;
  localFolderCheck: FolderCheckResult | null;
  googleDriveFolderCheck: FolderCheckResult | null;
  history: BackupHistoryEntry[];
  progress: BackupProgress | null;
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
const emptyRecipient: EncryptionRecipientStatus = {
  configured: false, state: "missing", recipient: null, fingerprint: null,
  registeredAt: null, registeredByAppVersion: null, endpointId: null, algorithm: "age X25519",
  ceremonyCompleted: false, ceremonyKeyId: null, ceremonyCompletedAt: null, keyStatus: null,
};

let state: AppState = {
  settings: { ...emptySettings }, setup: emptySetup, maintenance: emptyMaintenance,
  maintenanceToken: null, maintenanceOpen: false,
  secretStatus: {
    dbPassword: false, storageAuthPassword: false, legacyServiceRoleKey: false,
    dbPasswordState: "missing", storageAuthPasswordState: "missing",
    legacyServiceRoleKeyState: "missing",
  },
  recipientStatus: emptyRecipient, systemCheck: null, recoveryKeyStatus: null,
  verificationResult: null, dbCheck: null, storageCheck: null,
  localFolderCheck: null, googleDriveFolderCheck: null, history: [], progress: null,
  busy: false, message: "",
};

const progressStages = [
  ["preflight", "事前確認"], ["database", "データベース"], ["storage", "画像ストレージ"],
  ["manifest", "検証情報"], ["archive", "アーカイブ"], ["encrypt", "暗号化"],
  ["verify", "整合性確認"], ["copy", "保存先コピー"], ["complete", "完了"],
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
const shortFingerprint = (value: string | null | undefined) => value ? `${value.slice(0, 10)}...${value.slice(-8)}` : "未設定";
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
  legacyServiceRoleKey: Boolean(status.legacyServiceRoleKey ?? status.legacy_service_role_key),
  dbPasswordState: status.dbPasswordState ?? status.db_password_state ?? "missing",
  storageAuthPasswordState:
    status.storageAuthPasswordState ?? status.storage_auth_password_state ?? "missing",
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
    dbHost: String(data.get("dbHost") ?? state.settings.dbHost),
    dbPort: String(data.get("dbPort") ?? state.settings.dbPort),
    dbName: String(data.get("dbName") ?? state.settings.dbName),
    dbUser: String(data.get("dbUser") ?? state.settings.dbUser),
    connectionMode: String(data.get("connectionMode") ?? state.settings.connectionMode) as BackupToolSettings["connectionMode"],
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
  try {
    const result = await runCommand<SecretStatusResponse>("save_secret_values", {
      dbPassword, storageAuthPassword, ...maintenanceArgs(),
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

async function registerRecipient() {
  const recipient = app.querySelector<HTMLInputElement>("#encryption-recipient")?.value ?? "";
  const endpointId = app.querySelector<HTMLInputElement>("#endpoint-id")?.value ?? "";
  try {
    state.recipientStatus = await runCommand("register_encryption_recipient", {
      recipient, endpointId, ...maintenanceArgs(),
    });
    state.settings = {
      ...state.settings,
      encryptionRecipient: state.recipientStatus.recipient,
      encryptionRecipientFingerprint: state.recipientStatus.fingerprint,
      encryptionRecipientRegisteredAt: state.recipientStatus.registeredAt,
      encryptionRecipientRegisteredByAppVersion: state.recipientStatus.registeredByAppVersion,
      endpointId: state.recipientStatus.endpointId,
      encryptionAlgorithm: state.recipientStatus.algorithm,
    };
    state.message = "暗号化設定を登録しました。復号用の秘密鍵はこの端末へ保存していません。";
  } catch (error) {
    state.message = redactSensitiveText(error);
  }
  render();
}

async function replaceRecipient() {
  if (!state.recipientStatus.fingerprint || !state.maintenanceToken) return;
  if (!await confirm("登録済み暗号化設定を変更します。既存バックアップとの一致を確認しましたか？", { title: "保守確認", kind: "warning" })) return;
  try {
    state.recipientStatus = await runCommand("replace_encryption_recipient", {
      recipient: app.querySelector<HTMLInputElement>("#maintenance-recipient")?.value ?? "",
      endpointId: app.querySelector<HTMLInputElement>("#maintenance-endpoint-id")?.value ?? "",
      expectedCurrentFingerprint: state.recipientStatus.fingerprint,
      confirmation: app.querySelector<HTMLInputElement>("#recipient-change-confirmation")?.value ?? "",
      ...maintenanceArgs(),
    });
    state.message = "暗号化設定を変更しました。新しい鍵式実施記録が登録されるまでバックアップは停止します。";
  } catch (error) {
    state.message = redactSensitiveText(error);
  }
  render();
}

const ceremonyTimestamp = (id: string) => {
  const value = app.querySelector<HTMLInputElement>(`#${id}`)?.value ?? "";
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? value : parsed.toISOString();
};

async function completeProductionKeyCeremony() {
  if (!state.maintenanceToken || !state.recipientStatus.configured) return;
  if (!await confirm(
    "Google Driveと外部媒体への保存、および両方からの再取得・復号を実際に完了した記録を登録します。",
    { title: "本番鍵式の実施記録", kind: "warning" },
  )) return;
  try {
    state.recipientStatus = await runCommand("complete_production_key_ceremony", {
      input: {
        keyId: app.querySelector<HTMLInputElement>("#ceremony-key-id")?.value ?? "",
        generatedAt: ceremonyTimestamp("ceremony-generated-at"),
        ageVersion: "v1.3.2",
        googleDriveStoredAt: ceremonyTimestamp("ceremony-google-stored-at"),
        externalMediaStoredAt: ceremonyTimestamp("ceremony-external-stored-at"),
        googleDriveVerifiedAt: ceremonyTimestamp("ceremony-google-verified-at"),
        externalMediaVerifiedAt: ceremonyTimestamp("ceremony-external-verified-at"),
        confirmation: app.querySelector<HTMLInputElement>("#ceremony-confirmation")?.value ?? "",
      },
      ...maintenanceArgs(),
    });
    state.settings = await runCommand("load_settings");
    state.message = "本番鍵式の実施記録と公開鍵台帳を登録しました。";
  } catch (error) {
    state.message = redactSensitiveText(error);
  }
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

async function importRecoveryKey() {
  if (!state.maintenanceToken) return;
  const selected = await open({ multiple: false, directory: false, filters: [{ name: "復旧鍵", extensions: ["txt", "key"] }] });
  if (typeof selected !== "string") return;
  try {
    const recoveryKeyStatus = await runCommand<RecoveryKeyImportStatus>("import_recovery_key", { path: selected, ...maintenanceArgs() });
    state.recoveryKeyStatus = recoveryKeyStatus;
    state.message = recoveryKeyStatus.matchesRecipient === false ? "復旧鍵は登録済み暗号化設定と一致しません。" : "有効な復旧鍵です。";
  } catch (error) {
    state.recoveryKeyStatus = null;
    state.message = redactSensitiveText(error);
  }
  render();
}

async function verifyBackup() {
  if (!state.maintenanceToken || !state.recoveryKeyStatus?.loaded) return;
  const selected = await open({ multiple: false, directory: false, filters: [{ name: "暗号化バックアップ", extensions: ["age"] }] });
  if (typeof selected !== "string") return;
  try {
    state.verificationResult = await runCommand("verify_backup_file", { path: selected, ...maintenanceArgs() });
    state.message = "復号・構造・SHA-256確認が完了し、一時領域を削除しました。";
  } catch (error) {
    state.verificationResult = null;
    state.message = redactSensitiveText(error);
  } finally {
    state.recoveryKeyStatus = null;
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
  state.busy = true;
  state.progress = { stage: "preflight", status: "running", message: "準備しています。", current: null, total: null };
  render();
  try {
    const result = await runCommand<BackupResult>("run_backup");
    state.history = await runCommand("load_backup_history");
    state.message = `バックアップが完了しました。${result.history.fileName}`;
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
    <label>接続方式<select name="connectionMode"><option value="direct" ${state.settings.connectionMode === "direct" ? "selected" : ""}>Direct</option><option value="session" ${state.settings.connectionMode === "session" ? "selected" : ""}>Session pooler</option></select></label>
    <label>DB host<input name="dbHost" value="${escapeHtml(state.settings.dbHost)}" /></label>
    <label>DB port<input name="dbPort" value="${escapeHtml(state.settings.dbPort)}" /></label>
    <label>Database<input name="dbName" value="${escapeHtml(state.settings.dbName)}" /></label>
    <label>DB user<input name="dbUser" value="${escapeHtml(state.settings.dbUser)}" /></label>
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
        <div class="secret-grid two-col"><label>DBパスワード ${credentialBadge(state.secretStatus.dbPassword, state.secretStatus.dbPasswordState)}<input id="db-password" type="password" autocomplete="new-password" /></label><label>Storage読取パスワード ${credentialBadge(state.secretStatus.storageAuthPassword, state.secretStatus.storageAuthPasswordState)}<input id="storage-auth-password" type="password" autocomplete="new-password" /></label></div>
        <div class="actions"><button id="save-settings" class="outline">接続先を保存</button><button id="save-secrets">資格情報を保存</button></div>`;
    case 4:
      return `<h2>暗号化・保守設定</h2><p class="note">テスト用公開鍵のみ使用してください。秘密鍵はこの端末へ保存しません。</p>
        <div class="two-col"><label>端末ID<input id="endpoint-id" value="${escapeHtml(state.recipientStatus.endpointId ?? "")}" placeholder="kawashima-windows-main" /></label><label>age公開鍵<input id="encryption-recipient" placeholder="age1..." /></label></div>
        <div class="two-col setup-lock"><label>ACTARISE保守パスコード ${badge(state.setup.maintenanceConfigured)}<input id="maintenance-passcode" type="password" autocomplete="new-password" /></label><div class="status-box"><strong>暗号化設定</strong>${badge(state.recipientStatus.configured, state.recipientStatus.configured ? "公開鍵設定済み" : "未設定")}<small>fingerprint ${escapeHtml(shortFingerprint(state.recipientStatus.fingerprint))}</small></div></div>
        <div class="actions"><button id="configure-maintenance" class="outline">保守ロックを設定</button><button id="register-recipient">暗号化設定を登録</button></div>`;
    case 5:
      return `<h2>動作確認</h2><p class="note">接続と保存先を読み取り・書込確認します。バックアップはまだ生成しません。</p>
        ${connectionFormMarkup()}<dl class="results"><div><dt>DB接続</dt><dd>${state.dbCheck ? badge(state.dbCheck.ok, state.dbCheck.message) : "未確認"}</dd></div><div><dt>画像Storage</dt><dd>${state.storageCheck ? badge(state.storageCheck.ok, state.storageCheck.message) : "未確認"}</dd></div><div><dt>PC保存先</dt><dd>${badge(Boolean(state.localFolderCheck?.ok))}</dd></div><div><dt>同期フォルダ</dt><dd>${badge(Boolean(state.googleDriveFolderCheck?.ok))}</dd></div></dl>
        <div class="actions"><button id="run-checks">接続・設定を確認</button></div>`;
    default:
      return `<h2>セットアップ完了</h2><p class="note">すべての設定を確認後、通常のバックアップ画面へ切り替えます。</p>
        <dl class="results"><div><dt>資格情報</dt><dd>${badge(state.secretStatus.dbPassword && state.secretStatus.storageAuthPassword)}</dd></div><div><dt>保存先</dt><dd>${badge(Boolean(state.localFolderCheck?.ok && state.googleDriveFolderCheck?.ok))}</dd></div><div><dt>暗号化設定</dt><dd>${badge(state.recipientStatus.configured)}</dd></div><div><dt>保守ロック</dt><dd>${badge(state.setup.maintenanceConfigured)}</dd></div></dl>
        <div class="actions"><button id="complete-setup">セットアップを完了</button></div>`;
  }
}

function pathRowsMarkup() {
  return `<div class="path-row"><div><strong>PC保存先</strong><p>${escapeHtml(state.settings.localBackupPath || "未設定")}</p></div><button id="pick-local" class="outline">フォルダを選択</button></div>
    <div class="path-row"><div><strong>Google Drive同期フォルダ</strong><p>${escapeHtml(state.settings.googleDrivePath || "未設定")}</p><small>ここへのコピー成功を確認します。クラウド同期完了は判定しません。</small></div><button id="pick-drive" class="outline">フォルダを選択</button></div>`;
}

function historyMarkup() {
  if (!state.history.length) return `<section class="panel"><h2>バックアップ履歴</h2><p class="empty">まだ履歴はありません。</p></section>`;
  return `<section class="panel"><div class="section-heading"><div><h2>バックアップ履歴</h2><p class="note">同期フォルダへのコピーとクラウド同期完了は別です。</p></div></div><div class="history-table-wrap"><table class="history-table"><thead><tr><th>完了日時</th><th>端末</th><th>鍵ID</th><th>結果</th><th>保存</th></tr></thead><tbody>${state.history.slice(0, 20).map((entry) => `<tr><td>${escapeHtml(new Date(entry.completedAt).toLocaleString("ja-JP"))}</td><td>${escapeHtml(entry.endpointId ?? "旧形式")}</td><td>${escapeHtml(entry.keyId || "旧形式")}</td><td>${entry.success ? "成功" : "失敗"}</td><td>${entry.googleDriveCopyOk ? "2か所へコピー済み / クラウド同期未確認" : "未完了"}</td></tr>`).join("")}</tbody></table></div></section>`;
}

function progressMarkup() {
  if (!state.progress) return "";
  const current = progressStages.findIndex(([stage]) => stage === state.progress?.stage);
  return `<section class="panel progress-panel"><h2>バックアップ処理中</h2><ol class="progress-list">${progressStages.map(([stage, label], index) => `<li class="${index < current ? "complete" : stage === state.progress?.stage ? state.progress.status : ""}"><span>${index + 1}</span>${label}</li>`).join("")}</ol><p class="message">${escapeHtml(state.progress.message)}</p></section>`;
}

function maintenanceMarkup() {
  if (!state.maintenanceOpen) return "";
  if (!state.maintenanceToken) {
    return `<section class="panel maintenance-panel"><h2>ACTARISE保守</h2><p class="note">資格情報・暗号化・保存先の変更には保守ロック解除が必要です。</p><div class="unlock-row"><input id="maintenance-unlock-passcode" type="password" autocomplete="current-password" placeholder="保守パスコード" /><button id="unlock-maintenance">保守ロックを解除</button></div></section>`;
  }
  return `<section class="panel maintenance-panel"><div class="section-heading"><div><h2>ACTARISE保守</h2><p class="note">バックエンド認証済みの短時間セッションです。</p></div><button id="lock-maintenance" class="outline">保守モードを閉じる</button></div>
    ${connectionFormMarkup()}<div class="secret-grid two-col"><label>DBパスワード ${credentialBadge(state.secretStatus.dbPassword, state.secretStatus.dbPasswordState)}<input id="db-password" type="password" autocomplete="new-password" /></label><label>Storage読取パスワード ${credentialBadge(state.secretStatus.storageAuthPassword, state.secretStatus.storageAuthPasswordState)}<input id="storage-auth-password" type="password" autocomplete="new-password" /></label></div>
    ${pathRowsMarkup()}<div class="actions"><button id="save-settings" class="outline">設定を保存</button><button id="save-secrets" class="outline">資格情報を保存</button><button id="run-checks">接続・設定を確認</button></div>
    <details class="maintenance-tools"><summary>旧資格情報の整理</summary><p class="note">旧Service Role Keyは通常処理に使用しません。新しいStorage接続確認後、明示操作でのみ削除できます。</p><div class="results"><div><dt>旧Service Role Key</dt><dd>${state.secretStatus.legacyServiceRoleKey ? badge(true, "保存済み（未使用）") : credentialBadge(false, state.secretStatus.legacyServiceRoleKeyState)}</dd></div></div><label>確認文字列<input id="legacy-service-role-confirmation" placeholder="旧Service Role Keyを削除する" /></label><div class="actions"><button id="delete-legacy-service-role" class="outline" ${state.secretStatus.legacyServiceRoleKey ? "" : "disabled"}>旧資格情報を削除</button></div></details>
    <details class="maintenance-tools"><summary>暗号化公開鍵を変更</summary><p class="warning">既存バックアップとの鍵不一致を招くため、fingerprintを確認した保守作業でのみ使用します。</p><div class="two-col"><label>新しい端末ID<input id="maintenance-endpoint-id" /></label><label>新しいage公開鍵<input id="maintenance-recipient" placeholder="age1..." /></label></div><label>確認文字列<input id="recipient-change-confirmation" placeholder="公開鍵を変更する" /></label><div class="actions"><button id="replace-recipient" class="outline">公開鍵を変更</button></div></details>
    <details class="maintenance-tools"><summary>本番鍵式の実施記録</summary><p class="warning">この記録は、人間が二経路への保存と復号を実施した事実を残すもので、安全性を自動保証するものではありません。</p><dl class="results"><div><dt>鍵式状態</dt><dd>${badge(state.recipientStatus.ceremonyCompleted, state.recipientStatus.ceremonyCompleted ? "完了記録あり" : "未完了")}</dd></div><div><dt>鍵ID</dt><dd>${escapeHtml(state.recipientStatus.ceremonyKeyId ?? "未登録")}</dd></div></dl><div class="two-col"><label>key ID<input id="ceremony-key-id" placeholder="kawashima-prod-2026-01" /></label><label>age version<input value="v1.3.2" readonly /></label><label>鍵生成日時<input id="ceremony-generated-at" type="datetime-local" /></label><label>Google Drive保管日時<input id="ceremony-google-stored-at" type="datetime-local" /></label><label>外部媒体保管日時<input id="ceremony-external-stored-at" type="datetime-local" /></label><label>Google Drive再取得・復号日時<input id="ceremony-google-verified-at" type="datetime-local" /></label><label>外部媒体再取得・復号日時<input id="ceremony-external-verified-at" type="datetime-local" /></label><label>確認文字列<input id="ceremony-confirmation" placeholder="復旧鍵の二経路保管と復号を確認した" /></label></div><div class="actions"><button id="complete-production-ceremony" ${state.recipientStatus.configured && !state.recipientStatus.ceremonyCompleted ? "" : "disabled"}>鍵式実施記録を登録</button></div></details>
    <div class="recovery-tools"><div><strong>復旧検証</strong><small>標準age CLIで暗号化identityをRAM上へ一時復号し、その平文identityだけを選択します。</small></div>${state.recoveryKeyStatus ? badge(state.recoveryKeyStatus.valid, state.recoveryKeyStatus.matchesRecipient ? "fingerprint一致" : "fingerprint不一致") : badge(false, "未読込")}<div class="actions"><button id="import-recovery-key" class="outline">RAM上の復旧鍵を選択</button><button id="verify-with-recovery" ${state.recoveryKeyStatus?.loaded ? "" : "disabled"}>復旧鍵で復号確認</button></div></div>
    ${state.verificationResult ? `<p class="message">DB・manifest・verification・pg_restore構造・SHA-256を確認し、一時ファイルを削除しました。</p>` : ""}
  </section>`;
}

function renderSetup() {
  app.innerHTML = `<main class="shell setup-shell"><header class="hero"><div><p class="brand">Kawashima Motors</p><h1>バックアップツール 初回セットアップ</h1><p class="lead">ACTARISE納品担当者が最初の1回だけ設定します。</p></div><span class="version">v${escapeHtml(state.setup.applicationVersion)}</span></header>${setupProgressMarkup()}<section class="panel setup-panel">${setupStepMarkup()}</section>${state.message ? `<p class="message" aria-live="polite">${escapeHtml(state.message)}</p>` : ""}<nav class="setup-nav"><button id="setup-prev" class="outline" ${state.setup.currentStep <= 1 ? "disabled" : ""}>戻る</button><button id="setup-next" ${state.setup.currentStep >= 6 ? "disabled" : ""}>次へ</button></nav></main>`;
}

function renderNormal() {
  const lastSuccess = state.history.find((entry) => entry.success);
  const canStart = state.setup.complete && state.secretStatus.dbPassword && state.secretStatus.storageAuthPassword
    && state.recipientStatus.configured && state.recipientStatus.ceremonyCompleted
    && Boolean(state.settings.localBackupPath && state.settings.googleDrivePath) && !state.busy;
  app.innerHTML = `<main class="shell"><header class="hero"><div><p class="brand">Kawashima Motors</p><h1>バックアップ</h1><p class="lead">業務データを2つの保存先へ保護します。</p></div><button id="toggle-maintenance" class="outline">ACTARISE保守</button></header>
    <section class="daily-dashboard"><div><span>現在の状態</span><strong>${state.busy ? "バックアップ中" : canStart ? "準備完了" : "設定を確認してください"}</strong></div><div><span>最終成功</span><strong>${lastSuccess ? escapeHtml(new Date(lastSuccess.completedAt).toLocaleString("ja-JP")) : "まだありません"}</strong></div><div><span>保存結果</span><strong>${lastSuccess?.localCopyOk && lastSuccess.googleDriveCopyOk ? "2か所へ保存済み" : "未確認"}</strong><small>クラウド同期完了は別途確認</small></div></section>
    <section class="panel start-panel"><div><h2>${state.busy ? "処理しています" : "バックアップを開始"}</h2><p class="note">完了するまでアプリを閉じないでください。</p></div><button id="start-backup" ${canStart ? "" : "disabled"}>${state.busy ? "実行中..." : "バックアップ開始"}</button></section>
    ${progressMarkup()}${historyMarkup()}${maintenanceMarkup()}${state.message ? `<p class="message" aria-live="polite">${escapeHtml(state.message)}</p>` : ""}</main>`;
}

function bindCommonEvents() {
  app.querySelector("#pick-local")?.addEventListener("click", () => void pickFolder("localBackupPath"));
  app.querySelector("#pick-drive")?.addEventListener("click", () => void pickFolder("googleDrivePath"));
  app.querySelector("#check-folders")?.addEventListener("click", () => void checkFolders());
  app.querySelector("#save-settings")?.addEventListener("click", () => void saveSettings());
  app.querySelector("#save-secrets")?.addEventListener("click", () => void saveSecrets());
  app.querySelector("#run-checks")?.addEventListener("click", () => void runConnectionChecks());
  app.querySelector("#register-recipient")?.addEventListener("click", () => void registerRecipient());
  app.querySelector("#configure-maintenance")?.addEventListener("click", () => void configureMaintenance());
  app.querySelector("#replace-recipient")?.addEventListener("click", () => void replaceRecipient());
  app.querySelector("#complete-production-ceremony")?.addEventListener("click", () => void completeProductionKeyCeremony());
  app.querySelector("#import-recovery-key")?.addEventListener("click", () => void importRecoveryKey());
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
  app.querySelector("#toggle-maintenance")?.addEventListener("click", () => { state.maintenanceOpen = !state.maintenanceOpen; render(); });
  app.querySelector("#unlock-maintenance")?.addEventListener("click", () => void unlockMaintenance());
  app.querySelector("#lock-maintenance")?.addEventListener("click", () => void lockMaintenance());
}

async function loadInitialState() {
  const [settings, setup, maintenance, secretStatus, recipientStatus, history, running] = await Promise.all([
    runCommand<BackupToolSettings>("load_settings"), runCommand<SetupStatus>("get_setup_status"),
    runCommand<MaintenanceStatus>("get_maintenance_status"), runCommand<SecretStatusResponse>("get_secret_status"),
    runCommand<EncryptionRecipientStatus>("get_encryption_recipient_status"),
    runCommand<BackupHistoryEntry[]>("load_backup_history"), runCommand<boolean>("backup_is_running"),
  ]);
  state = { ...state, settings: { ...emptySettings, ...settings }, setup, maintenance,
    secretStatus: normalizeSecretStatus(secretStatus), recipientStatus, history, busy: running };
}

void listen<BackupProgress>("backup-progress", ({ payload }) => {
  state.progress = payload;
  state.busy = payload.stage !== "complete" && payload.stage !== "failed";
  render();
});
window.addEventListener("beforeunload", (event) => { if (state.busy) event.preventDefault(); });
loadInitialState().catch((error) => { state.message = redactSensitiveText(error); }).finally(render);
