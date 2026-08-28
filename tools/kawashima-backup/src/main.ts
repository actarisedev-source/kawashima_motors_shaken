import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { confirm, open } from "@tauri-apps/plugin-dialog";
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

type CredentialState = "stored" | "missing" | "corrupt" | "accessDenied" | "backendError";
type SecretStatus = Record<SecretFieldName, boolean> & {
  dbPasswordState: CredentialState;
  serviceRoleKeyState: CredentialState;
};
type SecretStatusResponse = Partial<SecretStatus> & {
  db_password?: boolean;
  service_role_key?: boolean;
  db_password_state?: CredentialState;
  service_role_key_state?: CredentialState;
};
type EncryptionRecipientStatus = {
  configured: boolean;
  state: string;
  recipient: string | null;
  fingerprint: string | null;
  registeredAt: string | null;
  registeredByAppVersion: string | null;
  endpointId: string | null;
  algorithm: string;
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
  success: boolean; errorSummary: string | null;
  encryptedSize: number; encryptedSha256: string; databaseOk: boolean; storageOk: boolean;
  verificationOk: boolean; localCopyOk: boolean; googleDriveCopyOk: boolean;
  storageObjectCount: number; publicTableCount: number;
  endpointId?: string; recipientFingerprint?: string;
  plaintextArchiveSha256?: string; applicationVersion?: string;
};
type BackupResult = { history: BackupHistoryEntry; localPath: string; googleDrivePath: string };
type AppState = {
  settings: BackupToolSettings;
  secretStatus: SecretStatus;
  recipientStatus: EncryptionRecipientStatus;
  recoveryKeyStatus: RecoveryKeyImportStatus | null;
  verificationResult: BackupVerificationResult | null;
  dbCheck: DbCheckResult | null;
  storageCheck: StorageCheckResult | null;
  localFolderCheck: FolderCheckResult | null;
  googleDriveFolderCheck: FolderCheckResult | null;
  history: BackupHistoryEntry[];
  progress: BackupProgress | null;
  busy: boolean;
  confirmOpen: boolean;
  message: string;
};

const app = document.querySelector<HTMLDivElement>("#app");
if (!app) throw new Error("App root was not found.");

let state: AppState = {
  settings: { ...emptySettings },
  secretStatus: {
    dbPassword: false,
    serviceRoleKey: false,
    dbPasswordState: "missing",
    serviceRoleKeyState: "missing",
  },
  recipientStatus: {
    configured: false,
    state: "missing",
    recipient: null,
    fingerprint: null,
    registeredAt: null,
    registeredByAppVersion: null,
    endpointId: null,
    algorithm: "age X25519",
  },
  recoveryKeyStatus: null,
  verificationResult: null,
  dbCheck: null,
  storageCheck: null,
  localFolderCheck: null,
  googleDriveFolderCheck: null,
  history: [],
  progress: null,
  busy: false,
  confirmOpen: false,
  message: "",
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

const normalizeSecretStatus = (status: SecretStatusResponse): SecretStatus => ({
  dbPassword: Boolean(status.dbPassword ?? status.db_password),
  serviceRoleKey: Boolean(status.serviceRoleKey ?? status.service_role_key),
  dbPasswordState: status.dbPasswordState ?? status.db_password_state ?? "missing",
  serviceRoleKeyState: status.serviceRoleKeyState ?? status.service_role_key_state ?? "missing",
});

const failedDbCheck = (error: unknown): DbCheckResult => ({
  ok: false, connectionMode: state.settings.connectionMode, ssl: false, postgresVersion: null,
  publicSchemaReadable: false, message: redactSensitiveText(error),
});
const failedStorageCheck = (error: unknown): StorageCheckResult => ({
  ok: false, bucketExists: false, bucketPublic: null, objectCountEstimate: null,
  message: redactSensitiveText(error),
});

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
    encryptionRecipient: state.settings.encryptionRecipient,
    encryptionRecipientFingerprint: state.settings.encryptionRecipientFingerprint,
    encryptionRecipientRegisteredAt: state.settings.encryptionRecipientRegisteredAt,
    encryptionRecipientRegisteredByAppVersion: state.settings.encryptionRecipientRegisteredByAppVersion,
    endpointId: state.settings.endpointId,
    encryptionAlgorithm: state.settings.encryptionAlgorithm,
    encryptionRecoveryExported: state.settings.encryptionRecoveryExported,
    recoveryKeyFingerprint: state.settings.recoveryKeyFingerprint,
    recoveryKeyExportedAt: state.settings.recoveryKeyExportedAt,
  });
};

const setBusy = (busy: boolean, message = "") => {
  state = { ...state, busy, message };
  render();
};

const pickFolder = async (target: "localBackupPath" | "googleDrivePath") => {
  const selected = await open({ directory: true, multiple: false });
  if (typeof selected !== "string") return;
  state = {
    ...state,
    settings: { ...state.settings, [target]: selected },
    [target === "localBackupPath" ? "localFolderCheck" : "googleDriveFolderCheck"]: null,
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
  try {
    const secretStatus = await runCommand<SecretStatusResponse>("save_secret_values", { dbPassword, serviceRoleKey });
    state = {
      ...state,
      secretStatus: normalizeSecretStatus(secretStatus),
      dbCheck: null,
      storageCheck: null,
      message: "秘密情報をOS資格情報ストアへ保存しました。",
    };
  } catch (error) {
    state = { ...state, message: redactSensitiveText(error) };
  }
  render();
};

const applyRecipientStatus = (recipientStatus: EncryptionRecipientStatus, message: string) => {
  state = {
    ...state,
    recipientStatus,
    settings: {
      ...state.settings,
      encryptionRecipient: recipientStatus.recipient,
      encryptionRecipientFingerprint: recipientStatus.fingerprint,
      encryptionRecipientRegisteredAt: recipientStatus.registeredAt,
      encryptionRecipientRegisteredByAppVersion: recipientStatus.registeredByAppVersion,
      endpointId: recipientStatus.endpointId,
      encryptionAlgorithm: recipientStatus.algorithm,
    },
    recoveryKeyStatus: null,
    verificationResult: null,
    message,
  };
};

const registerEncryptionRecipient = async () => {
  const recipient = (app.querySelector<HTMLInputElement>("#encryption-recipient")?.value ?? "").trim();
  const endpointId = (app.querySelector<HTMLInputElement>("#endpoint-id")?.value ?? "").trim();
  try {
    const recipientStatus = await runCommand<EncryptionRecipientStatus>("register_encryption_recipient", {
      recipient,
      endpointId,
    });
    applyRecipientStatus(recipientStatus, "暗号化公開鍵を登録しました。秘密鍵はこの端末へ保存していません。");
  } catch (error) {
    state = { ...state, message: redactSensitiveText(error) };
  }
  render();
};

const replaceEncryptionRecipient = async () => {
  const recipient = (app.querySelector<HTMLInputElement>("#maintenance-recipient")?.value ?? "").trim();
  const endpointId = (app.querySelector<HTMLInputElement>("#maintenance-endpoint-id")?.value ?? "").trim();
  const confirmation = (app.querySelector<HTMLInputElement>("#recipient-change-confirmation")?.value ?? "").trim();
  if (!state.recipientStatus.fingerprint) return;
  const approved = await confirm(
    "登録済みの暗号化公開鍵を変更します。既存バックアップの復号可能性に影響するため、保守担当者だけが実行してください。",
    { title: "暗号化公開鍵の変更", kind: "warning" },
  );
  if (!approved) return;
  try {
    const recipientStatus = await runCommand<EncryptionRecipientStatus>("replace_encryption_recipient", {
      recipient,
      endpointId,
      expectedCurrentFingerprint: state.recipientStatus.fingerprint,
      confirmation,
    });
    applyRecipientStatus(recipientStatus, "保守確認により暗号化公開鍵を変更しました。");
  } catch (error) {
    state = { ...state, message: redactSensitiveText(error) };
  }
  render();
};

const importRecoveryKey = async () => {
  const path = await open({
    directory: false,
    multiple: false,
    filters: [{ name: "Recovery key", extensions: ["txt"] }],
  });
  if (typeof path !== "string") return;
  try {
    const recoveryKeyStatus = await runCommand<RecoveryKeyImportStatus>("import_recovery_key", { path });
    state = {
      ...state,
      recoveryKeyStatus,
      verificationResult: null,
      message: recoveryKeyStatus.matchesRecipient === false
        ? "有効な復旧鍵ですが、登録済み公開鍵とは一致しません。"
        : "有効な復旧鍵を読み込みました。",
    };
  } catch (error) {
    state = { ...state, recoveryKeyStatus: null, verificationResult: null, message: redactSensitiveText(error) };
  }
  render();
};

const clearRecoveryKey = async () => {
  try {
    await runCommand("clear_imported_recovery_key");
    state = { ...state, recoveryKeyStatus: null, verificationResult: null, message: "復旧鍵をアプリのメモリから解放しました。" };
  } catch (error) {
    state = { ...state, message: redactSensitiveText(error) };
  }
  render();
};

const verifyBackup = async () => {
  const path = await open({
    directory: false,
    multiple: false,
    filters: [{ name: "Encrypted backup", extensions: ["age"] }],
  });
  if (typeof path !== "string") return;
  setBusy(true, "暗号化バックアップを一時領域で復号確認しています...");
  try {
    const verificationResult = await runCommand<BackupVerificationResult>("verify_backup_file", { path });
    state = {
      ...state,
      busy: false,
      verificationResult,
      message: `${verificationResult.keySource}で復号・構造・チェックサムを確認しました。一時ファイルは削除済みです。`,
    };
  } catch (error) {
    state = { ...state, busy: false, verificationResult: null, message: redactSensitiveText(error) };
  }
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
  state = { ...state, localFolderCheck, googleDriveFolderCheck, message: "2つの保存先を確認しました。" };
  render();
};

const runChecks = async () => {
  updateSettingsFromForm();
  setBusy(true, "接続と設定を確認しています...");
  try {
    await runCommand("save_settings", { settings: state.settings });
    const [dbResult, storageResult, localFolderResult, googleDriveFolderResult] = await Promise.allSettled([
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
    const dbCheck = dbResult.status === "fulfilled" ? dbResult.value : failedDbCheck(dbResult.reason);
    const storageCheck = storageResult.status === "fulfilled" ? storageResult.value : failedStorageCheck(storageResult.reason);
    const localFolderCheck = localFolderResult.status === "fulfilled" ? localFolderResult.value : null;
    const googleDriveFolderCheck = googleDriveFolderResult.status === "fulfilled" ? googleDriveFolderResult.value : null;
    state = {
      ...state,
      dbCheck,
      storageCheck,
      localFolderCheck,
      googleDriveFolderCheck,
      busy: false,
      message: dbCheck.ok && storageCheck.ok && localFolderCheck?.ok && googleDriveFolderCheck?.ok
        ? "バックアップの事前確認が完了しました。"
        : "接続確認が完了しました。要確認の項目があります。",
    };
  } catch (error) {
    state = { ...state, busy: false, message: redactSensitiveText(error) };
  }
  render();
};

const backupReady = () => Boolean(
  state.secretStatus.dbPassword && state.secretStatus.serviceRoleKey
  && state.recipientStatus.configured
  && state.dbCheck?.ok && state.storageCheck?.ok
  && state.localFolderCheck?.ok && state.googleDriveFolderCheck?.ok && !state.busy,
);

const openBackupConfirmation = () => {
  if (!backupReady()) return;
  state = { ...state, confirmOpen: true, message: "" };
  render();
};
const closeBackupConfirmation = () => {
  state = { ...state, confirmOpen: false };
  render();
};

const startBackup = async () => {
  state = {
    ...state,
    confirmOpen: false,
    busy: true,
    progress: { stage: "preflight", status: "running", message: "バックアップを開始します。", current: null, total: null },
    message: "バックアップを実行しています。アプリを終了しないでください。",
  };
  render();
  try {
    await runCommand("save_settings", { settings: state.settings });
    const result = await runCommand<BackupResult>("run_backup", { settings: state.settings });
    state = {
      ...state,
      busy: false,
      history: [result.history, ...state.history.filter((item) => item.backupId !== result.history.backupId)],
      message: "バックアップが正常に完了し、PCとGoogle Drive同期フォルダへ保存されました。",
    };
  } catch (error) {
    const history = await runCommand<BackupHistoryEntry[]>("load_backup_history").catch(() => state.history);
    state = { ...state, busy: false, history, message: redactSensitiveText(error) };
  }
  render();
};

const badge = (ok: boolean | null | undefined, label?: string) => {
  if (ok === true) return `<span class="badge ok">✓ ${escapeHtml(label ?? "確認済み")}</span>`;
  if (ok === false) return `<span class="badge error">! ${escapeHtml(label ?? "要確認")}</span>`;
  return `<span class="badge muted">未確認</span>`;
};

const formatBytes = (bytes: number) => {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
};

const shortFingerprint = (value: string | null | undefined) => value ? `${value.slice(0, 16)}...` : "未確認";

const credentialLabel = (stored: boolean, credentialState: CredentialState) => {
  if (stored) return "✓ 設定済み";
  if (credentialState === "corrupt") return "破損を検出";
  if (credentialState === "accessDenied") return "アクセス拒否";
  if (credentialState === "backendError") return "資格情報ストア異常";
  return "未設定";
};

const progressMarkup = () => {
  if (!state.progress && !state.busy) return "";
  const activeIndex = state.progress ? progressStages.findIndex(([key]) => key === state.progress?.stage) : -1;
  return `
    <section class="panel progress-panel" aria-live="polite">
      <div class="section-heading"><div><h2>進捗</h2><p class="note">${escapeHtml(state.progress?.message ?? "準備中です。")}</p></div>${state.busy ? '<span class="spinner" aria-label="処理中"></span>' : ""}</div>
      <ol class="progress-list">
        ${progressStages.map(([, label], index) => {
          const complete = index < activeIndex || state.progress?.status === "complete" && index === activeIndex;
          const failed = index === activeIndex && state.progress?.status === "failed";
          const active = index === activeIndex && !complete && !failed;
          return `<li class="${complete ? "complete" : failed ? "failed" : active ? "active" : ""}"><span>${complete ? "✓" : failed ? "!" : index + 1}</span>${label}</li>`;
        }).join("")}
      </ol>
      ${state.progress?.total ? `<p class="progress-count">${state.progress.current ?? 0} / ${state.progress.total} 件</p>` : ""}
    </section>`;
};

const historyMarkup = () => `
  <section class="panel">
    <div class="section-heading"><div><h2>バックアップ履歴</h2><p class="note">履歴は自動削除しません。</p></div><span class="count">${state.history.length}件</span></div>
    ${state.history.length === 0 ? '<p class="empty">まだバックアップ履歴はありません。</p>' : `
      <div class="history-table-wrap"><table class="history-table">
        <thead><tr><th>結果</th><th>完了日時</th><th>ファイル</th><th>容量</th><th>DB</th><th>画像</th><th>検証</th><th>保存先</th></tr></thead>
        <tbody>${state.history.map((item) => `<tr>
          <td>${item.success ? '<span class="badge ok">成功</span>' : '<span class="badge error">未完了</span>'}${item.errorSummary ? `<small>${escapeHtml(item.errorSummary)}</small>` : ""}</td>
          <td>${escapeHtml(new Date(item.completedAt).toLocaleString("ja-JP"))}</td>
          <td><strong>${escapeHtml(item.fileName)}</strong><small>SHA-256 ${escapeHtml(item.encryptedSha256.slice(0, 12))}...</small></td>
          <td>${formatBytes(item.encryptedSize)}</td><td>${item.databaseOk ? `✓ ${item.publicTableCount}表` : "!"}</td>
          <td>${item.storageOk ? `✓ ${item.storageObjectCount}件` : "!"}</td><td>${item.verificationOk ? "✓" : "!"}</td>
          <td>${item.localCopyOk && item.googleDriveCopyOk ? "✓ 2か所" : "!"}</td>
        </tr>`).join("")}</tbody>
      </table></div>`}
  </section>`;

const confirmationMarkup = () => state.confirmOpen ? `
  <div class="modal-backdrop" role="presentation">
    <section class="confirm-dialog" role="dialog" aria-modal="true" aria-labelledby="confirm-title">
      <h2 id="confirm-title">バックアップを開始しますか？</h2>
      <p>public schemaと画像ストレージを読み取り、暗号化した1つのファイルを2つの保存先へ作成します。</p>
      <dl class="confirm-paths">
        <div><dt>PC</dt><dd>${escapeHtml(state.settings.localBackupPath)}</dd></div>
        <div><dt>Google Drive</dt><dd>${escapeHtml(state.settings.googleDrivePath)}</dd></div>
      </dl>
      <p class="warning">完了するまでアプリを終了しないでください。データベースやStorageへの書き込みは行いません。</p>
      <div class="actions"><button id="cancel-backup" type="button" class="outline">キャンセル</button><button id="confirm-backup" type="button">バックアップ開始</button></div>
    </section>
  </div>` : "";

const render = () => {
  const ready = backupReady();
  const lastSuccessfulBackup = state.history.find((item) => item.success);
  const nextRecommended = lastSuccessfulBackup
    ? new Date(new Date(lastSuccessfulBackup.completedAt).getTime() + 30 * 24 * 60 * 60 * 1000).toLocaleDateString("ja-JP")
    : null;
  app.innerHTML = `
    <section class="shell">
      <header class="hero">
        <div><p class="brand">Kawashima Motors</p><h1>バックアップツール</h1><p class="lead">データベースと画像を暗号化し、PCとGoogle Drive同期フォルダへ保存します。</p></div>
        <button id="start-backup" type="button" ${ready ? "" : "disabled"}>${state.busy ? "バックアップ中..." : "バックアップ開始"}</button>
      </header>

      <section class="status-grid">
        <article><span>データベース</span>${badge(state.dbCheck?.ok)}<small>${escapeHtml(state.dbCheck?.postgresVersion ?? "PostgreSQL version 未確認")}</small></article>
        <article><span>画像ストレージ</span>${badge(state.storageCheck?.ok)}<small>${state.storageCheck?.objectCountEstimate == null ? "件数未確認" : `約${state.storageCheck.objectCountEstimate}件`}</small></article>
        <article><span>暗号化</span>${badge(state.recipientStatus.configured, state.recipientStatus.configured ? "公開鍵設定済み" : undefined)}<small>${escapeHtml(shortFingerprint(state.recipientStatus.fingerprint))}</small></article>
        <article><span>PC保存先</span>${badge(state.localFolderCheck?.ok ?? false)}</article>
        <article><span>Google Drive</span>${badge(state.googleDriveFolderCheck?.ok ?? false)}</article>
      </section>

      <section class="last-backup-band">
        <div><span>前回バックアップ</span><strong>${lastSuccessfulBackup ? `${escapeHtml(new Date(lastSuccessfulBackup.completedAt).toLocaleString("ja-JP"))} 成功` : "未実施"}</strong></div>
        <div><span>次回推奨</span><strong>${escapeHtml(nextRecommended ?? "初回バックアップを実施してください")}</strong></div>
      </section>

      ${progressMarkup()}

      <form id="settings-form" class="panel">
        <div class="section-heading"><div><h2>接続設定</h2><p class="note">秘密情報は設定ファイルへ保存しません。</p></div><button id="run-checks" type="button" class="outline" ${state.busy ? "disabled" : ""}>${state.busy ? "確認中..." : "接続・設定を確認"}</button></div>
        <div class="two-col">
          <label>Supabase Project URL<input name="supabaseProjectUrl" value="${escapeHtml(state.settings.supabaseProjectUrl)}" placeholder="https://...supabase.co" /></label>
          <label>接続方式<select name="connectionMode"><option value="direct" ${state.settings.connectionMode === "direct" ? "selected" : ""}>Direct connection</option><option value="session" ${state.settings.connectionMode === "session" ? "selected" : ""}>Session pooler</option></select></label>
          <label>DB host<input name="dbHost" value="${escapeHtml(state.settings.dbHost)}" autocomplete="off" /></label>
          <label>DB port<input name="dbPort" value="${escapeHtml(state.settings.dbPort)}" inputmode="numeric" /></label>
          <label>Database<input name="dbName" value="${escapeHtml(state.settings.dbName)}" /></label>
          <label>DB user<input name="dbUser" value="${escapeHtml(state.settings.dbUser)}" autocomplete="off" /></label>
        </div>
        <div class="actions"><button id="save-settings" type="button" class="outline">通常設定を保存</button></div>
      </form>

      <section class="panel">
        <h2>秘密情報</h2><p class="note">DBパスワードとService Role KeyはOS資格情報ストアへ保存し、画面や設定ファイルへ再表示しません。</p>
        <div class="two-col secret-grid">
          <label>DBパスワード <span>${escapeHtml(credentialLabel(state.secretStatus.dbPassword, state.secretStatus.dbPasswordState))}</span><input id="dbPassword" type="password" autocomplete="new-password" /></label>
          <label>Service Role Key <span>${escapeHtml(credentialLabel(state.secretStatus.serviceRoleKey, state.secretStatus.serviceRoleKeyState))}</span><input id="serviceRoleKey" type="password" autocomplete="new-password" /></label>
        </div>
        <div class="actions"><button id="save-secrets" type="button" class="outline">秘密情報を安全に保存</button></div>
      </section>

      <section class="panel encryption-panel">
        <div><h2>バックアップ暗号化</h2><p class="note">age X25519公開鍵で暗号化します。通常バックアップ端末には復号用秘密鍵を保存しません。</p></div>
        <div class="encryption-actions">
          <div><strong>暗号化公開鍵</strong>${badge(state.recipientStatus.configured, state.recipientStatus.configured ? "設定済み" : undefined)}<small>fingerprint ${escapeHtml(shortFingerprint(state.recipientStatus.fingerprint))}</small></div>
          <div><strong>バックアップ端末</strong>${badge(state.recipientStatus.configured, state.recipientStatus.endpointId ?? undefined)}<small>${state.recipientStatus.registeredAt ? `${escapeHtml(new Date(state.recipientStatus.registeredAt).toLocaleString("ja-JP"))} / app ${escapeHtml(state.recipientStatus.registeredByAppVersion ?? "不明")}` : "ACTARISEの初回設定で登録します。"}</small></div>
          ${state.recipientStatus.configured ? "" : `<div class="two-col recipient-form"><label>endpointId<input id="endpoint-id" autocomplete="off" placeholder="kawashima-windows-main" /></label><label>age公開鍵<input id="encryption-recipient" autocomplete="off" placeholder="age1..." /></label></div><div class="actions compact"><button id="register-recipient" type="button">公開鍵を登録</button></div>`}
        </div>
        ${state.recipientStatus.configured ? `<details class="maintenance-tools"><summary>保守担当者向け: 暗号化公開鍵を変更</summary><p class="warning">既存バックアップとの鍵不一致を招くため、fingerprintを確認した保守作業でのみ使用します。</p><div class="two-col"><label>新しいendpointId<input id="maintenance-endpoint-id" autocomplete="off" /></label><label>新しいage公開鍵<input id="maintenance-recipient" autocomplete="off" placeholder="age1..." /></label></div><label>確認文字列<input id="recipient-change-confirmation" autocomplete="off" placeholder="公開鍵を変更する" /></label><div class="actions compact"><button id="replace-recipient" type="button" class="outline">公開鍵を変更</button></div></details>` : ""}
        <div class="recovery-tools">
          <div>
            <strong>復旧鍵の確認</strong>
            ${state.recoveryKeyStatus?.valid ? badge(true, "有効な復旧鍵です") : '<span class="badge muted">未読込</span>'}
            <small>${state.recoveryKeyStatus ? `fingerprint ${escapeHtml(shortFingerprint(state.recoveryKeyStatus.fingerprint))}` : "秘密鍵の実値は画面へ表示しません。"}</small>
          </div>
          <div>
            <strong>登録公開鍵との一致</strong>
            ${state.recoveryKeyStatus?.matchesRecipient === true ? badge(true, "fingerprint一致") : state.recoveryKeyStatus?.matchesRecipient === false ? badge(false, "fingerprint不一致") : '<span class="badge muted">比較前</span>'}
            <small>復旧鍵は確認中だけアプリのメモリに保持します。</small>
          </div>
          <div class="actions compact">
            <button id="import-recovery-key" type="button" class="outline">復旧鍵を読み込む</button>
            <button id="clear-recovery-key" type="button" class="outline" ${state.recoveryKeyStatus?.loaded ? "" : "disabled"}>メモリから解放</button>
          </div>
        </div>
        <div class="recovery-tools verification-tools">
          <div>
            <strong>暗号化バックアップの復号確認</strong>
            ${state.verificationResult?.ok ? badge(true, `${state.verificationResult.keySource}で確認済み`) : '<span class="badge muted">未確認</span>'}
            <small>${state.verificationResult ? `DB・manifest・verification・pg_restore構造確認済み / Storage ${state.verificationResult.storagePresent ? "あり" : "なし"} / SHA-256 ${escapeHtml(shortFingerprint(state.verificationResult.plaintextArchiveSha256))} / 一時ファイル削除済み` : "読み込んだ復旧鍵で一時領域へ復号し、構造とチェックサムだけを確認します。復元は行いません。"}</small>
          </div>
          <div class="actions compact">
            <button id="verify-with-recovery" type="button" class="outline" ${state.recoveryKeyStatus?.loaded && !state.busy ? "" : "disabled"}>復旧鍵で復号確認</button>
          </div>
        </div>
      </section>

      <section class="panel">
        <h2>保存先</h2>
        <div class="path-row"><div><strong>PC保存先</strong><p>${escapeHtml(state.settings.localBackupPath || "未設定")}</p></div><button id="pick-local" type="button" class="outline">フォルダを選択</button></div>
        <div class="path-row"><div><strong>Google Drive保存先</strong><p>${escapeHtml(state.settings.googleDrivePath || "未設定")}</p><small>Google Drive for desktopの同期フォルダへ保存します。</small></div><button id="pick-drive" type="button" class="outline">フォルダを選択</button></div>
        <div class="actions"><button id="check-folders" type="button" class="outline">保存先を確認</button></div>
      </section>

      <section class="panel">
        <h2>接続確認結果</h2>
        <dl class="results">
          <div><dt>DB接続</dt><dd>${state.dbCheck ? `${state.dbCheck.ok ? "✓" : "!"} ${escapeHtml(state.dbCheck.message)}` : "未確認"}</dd></div>
          <div><dt>public schema</dt><dd>${state.dbCheck ? (state.dbCheck.publicSchemaReadable ? "✓ 読み取り可能" : "! 未確認") : "未確認"}</dd></div>
          <div><dt>Storage bucket</dt><dd>${state.storageCheck ? `${state.storageCheck.bucketExists ? "✓" : "!"} ${storageBucketName}` : "未確認"}</dd></div>
          <div><dt>保存先</dt><dd>${state.localFolderCheck?.ok && state.googleDriveFolderCheck?.ok ? "✓ 2か所確認済み" : "未確認"}</dd></div>
        </dl>
      </section>

      ${historyMarkup()}
      ${state.message ? `<p class="message" aria-live="polite">${escapeHtml(state.message)}</p>` : ""}
    </section>
    ${confirmationMarkup()}
  `;

  app.querySelector("#save-settings")?.addEventListener("click", () => void saveSettings());
  app.querySelector("#save-secrets")?.addEventListener("click", () => void saveSecrets());
  app.querySelector("#register-recipient")?.addEventListener("click", () => void registerEncryptionRecipient());
  app.querySelector("#replace-recipient")?.addEventListener("click", () => void replaceEncryptionRecipient());
  app.querySelector("#import-recovery-key")?.addEventListener("click", () => void importRecoveryKey());
  app.querySelector("#clear-recovery-key")?.addEventListener("click", () => void clearRecoveryKey());
  app.querySelector("#verify-with-recovery")?.addEventListener("click", () => void verifyBackup());
  app.querySelector("#pick-local")?.addEventListener("click", () => void pickFolder("localBackupPath"));
  app.querySelector("#pick-drive")?.addEventListener("click", () => void pickFolder("googleDrivePath"));
  app.querySelector("#check-folders")?.addEventListener("click", () => void checkFolders());
  app.querySelector("#run-checks")?.addEventListener("click", () => void runChecks());
  app.querySelector("#start-backup")?.addEventListener("click", openBackupConfirmation);
  app.querySelector("#cancel-backup")?.addEventListener("click", closeBackupConfirmation);
  app.querySelector("#confirm-backup")?.addEventListener("click", () => void startBackup());
};

async function loadInitialState() {
  const [settings, secretStatus, recipientStatus, history, running] = await Promise.all([
    runCommand<BackupToolSettings>("load_settings"),
    runCommand<SecretStatusResponse>("get_secret_status"),
    runCommand<EncryptionRecipientStatus>("get_encryption_recipient_status"),
    runCommand<BackupHistoryEntry[]>("load_backup_history"),
    runCommand<boolean>("backup_is_running"),
  ]);
  state = {
    ...state,
    settings: { ...emptySettings, ...settings },
    secretStatus: normalizeSecretStatus(secretStatus),
    recipientStatus,
    history,
    busy: running,
    message: running ? "バックアップ処理を確認しています。" : "",
  };
}

void listen<BackupProgress>("backup-progress", ({ payload }) => {
  const progress = payload.stage === "failed" && state.progress
    ? { ...state.progress, status: "failed", message: payload.message }
    : payload;
  state = { ...state, progress, busy: payload.stage !== "complete" && payload.stage !== "failed" };
  render();
});

window.addEventListener("beforeunload", (event) => {
  if (state.busy) event.preventDefault();
});

loadInitialState()
  .catch((error) => { state = { ...state, message: redactSensitiveText(error) }; })
  .finally(render);
