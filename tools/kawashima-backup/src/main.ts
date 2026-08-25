import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { confirm, open, save } from "@tauri-apps/plugin-dialog";
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
type SecretStatusResponse = Partial<SecretStatus> & {
  db_password?: boolean;
  service_role_key?: boolean;
};
type EncryptionStatus = {
  stored: boolean;
  recoveryExported: boolean;
  recipient: string | null;
  keyFingerprint: string | null;
  recoveryKeyFingerprint: string | null;
  recoveryKeyExportedAt: string | null;
};
type RecoveryKeyImportStatus = {
  loaded: boolean; valid: boolean; fingerprint: string; matchesKeychain: boolean | null;
};
type BackupVerificationResult = {
  ok: boolean; keySource: string; keyFingerprint: string;
  databaseDumpPresent: boolean; manifestsPresent: boolean; storagePresent: boolean;
  verificationPresent: boolean; temporaryFilesRemoved: boolean;
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
};
type BackupResult = { history: BackupHistoryEntry; localPath: string; googleDrivePath: string };
type AppState = {
  settings: BackupToolSettings;
  secretStatus: SecretStatus;
  encryptionStatus: EncryptionStatus;
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
  secretStatus: { dbPassword: false, serviceRoleKey: false },
  encryptionStatus: {
    stored: false,
    recoveryExported: false,
    recipient: null,
    keyFingerprint: null,
    recoveryKeyFingerprint: null,
    recoveryKeyExportedAt: null,
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
  ["verify", "復号検証"], ["copy", "保存先コピー"], ["complete", "完了"],
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

const generateEncryptionKey = async () => {
  try {
    const encryptionStatus = await runCommand<EncryptionStatus>("generate_encryption_identity");
    state = { ...state, encryptionStatus, message: "暗号化鍵をOS資格情報ストアへ作成しました。復旧鍵を書き出してください。" };
  } catch (error) {
    state = { ...state, message: redactSensitiveText(error) };
  }
  render();
};

const exportRecoveryKey = async () => {
  const path = await save({
    defaultPath: "kawashima-backup-recovery-key.txt",
    filters: [{ name: "Recovery key", extensions: ["txt"] }],
  });
  if (!path) return;
  try {
    const encryptionStatus = await runCommand<EncryptionStatus>("export_recovery_key", {
      path,
      settings: state.settings,
    });
    state = {
      ...state,
      encryptionStatus,
      settings: {
        ...state.settings,
        encryptionRecoveryExported: encryptionStatus.recoveryExported,
        recoveryKeyFingerprint: encryptionStatus.recoveryKeyFingerprint,
        recoveryKeyExportedAt: encryptionStatus.recoveryKeyExportedAt,
      },
      message: "復旧鍵を保存しました。バックアップとは別の安全な場所で保管してください。",
    };
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
      message: recoveryKeyStatus.matchesKeychain === false
        ? "有効な復旧鍵ですが、現在のKeychain鍵とは一致しません。"
        : "有効な復旧鍵を読み込みました。",
    };
  } catch (error) {
    state = { ...state, recoveryKeyStatus: null, verificationResult: null, message: redactSensitiveText(error) };
  }
  render();
};

const registerRecoveryKey = async () => {
  if (!state.recoveryKeyStatus?.loaded) return;
  const approved = await confirm(
    "読み込んだ復旧鍵をKeychainへ登録します。現在の暗号化鍵がある場合は置き換わります。続行しますか？",
    { title: "Keychainへ再登録", kind: "warning" },
  );
  if (!approved) return;
  try {
    const encryptionStatus = await runCommand<EncryptionStatus>("register_imported_recovery_key");
    state = {
      ...state,
      encryptionStatus,
      recoveryKeyStatus: { ...state.recoveryKeyStatus, matchesKeychain: true },
      settings: {
        ...state.settings,
        encryptionRecoveryExported: encryptionStatus.recoveryExported,
        recoveryKeyFingerprint: encryptionStatus.recoveryKeyFingerprint,
        recoveryKeyExportedAt: encryptionStatus.recoveryKeyExportedAt,
      },
      message: "復旧鍵をKeychainへ再登録し、再読込を確認しました。",
    };
  } catch (error) {
    state = { ...state, message: redactSensitiveText(error) };
  }
  render();
};

const verifyBackup = async (keySource: "keychain" | "recovery") => {
  const path = await open({
    directory: false,
    multiple: false,
    filters: [{ name: "Encrypted backup", extensions: ["age"] }],
  });
  if (typeof path !== "string") return;
  setBusy(true, "暗号化バックアップを一時領域で復号確認しています...");
  try {
    const verificationResult = await runCommand<BackupVerificationResult>("verify_backup_file", {
      path,
      keySource,
    });
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
  && state.encryptionStatus.stored && state.encryptionStatus.recoveryExported
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
        <article><span>暗号化</span>${badge(state.encryptionStatus.stored && state.encryptionStatus.recoveryExported, state.encryptionStatus.recoveryExported ? "復旧鍵保管済み" : undefined)}</article>
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
          <label>DBパスワード <span>${state.secretStatus.dbPassword ? "✓ 設定済み" : "未設定"}</span><input id="dbPassword" type="password" autocomplete="new-password" /></label>
          <label>Service Role Key <span>${state.secretStatus.serviceRoleKey ? "✓ 設定済み" : "未設定"}</span><input id="serviceRoleKey" type="password" autocomplete="new-password" /></label>
        </div>
        <div class="actions"><button id="save-secrets" type="button" class="outline">秘密情報を安全に保存</button></div>
      </section>

      <section class="panel encryption-panel">
        <div><h2>バックアップ暗号化</h2><p class="note">age X25519暗号化を使用します。秘密鍵はOS資格情報ストアに保持し、画面には表示しません。</p></div>
        <div class="encryption-actions">
          <div><strong>暗号化鍵</strong>${badge(state.encryptionStatus.stored, state.encryptionStatus.stored ? "設定済み" : undefined)}<small>fingerprint ${escapeHtml(shortFingerprint(state.encryptionStatus.keyFingerprint))}</small></div>
          <div><strong>復旧鍵</strong>${badge(state.encryptionStatus.recoveryExported, state.encryptionStatus.recoveryExported ? "書き出し済み" : undefined)}<small>${state.encryptionStatus.recoveryExported ? `書き出し済み（存在確認はできません） ${escapeHtml(state.encryptionStatus.recoveryKeyExportedAt ? new Date(state.encryptionStatus.recoveryKeyExportedAt).toLocaleString("ja-JP") : "")}` : "バックアップ保存先とは別の安全な場所へ保管します。"}</small></div>
          <div class="actions compact">${state.encryptionStatus.stored ? "" : '<button id="generate-key" type="button">暗号化鍵を作成</button>'}<button id="export-key" type="button" class="outline" ${state.encryptionStatus.stored ? "" : "disabled"}>復旧鍵を書き出す</button></div>
        </div>
        <div class="recovery-tools">
          <div>
            <strong>復旧鍵の確認</strong>
            ${state.recoveryKeyStatus?.valid ? badge(true, "有効な復旧鍵です") : '<span class="badge muted">未読込</span>'}
            <small>${state.recoveryKeyStatus ? `fingerprint ${escapeHtml(shortFingerprint(state.recoveryKeyStatus.fingerprint))}` : "秘密鍵の実値は画面へ表示しません。"}</small>
          </div>
          <div>
            <strong>Keychainの鍵</strong>
            ${state.recoveryKeyStatus?.matchesKeychain === true ? badge(true, "復旧鍵と一致") : state.recoveryKeyStatus?.matchesKeychain === false ? badge(false, "復旧鍵と不一致") : '<span class="badge muted">比較前</span>'}
            <small>再登録は確認後にだけ実行します。</small>
          </div>
          <div class="actions compact">
            <button id="import-recovery-key" type="button" class="outline">復旧鍵を読み込む</button>
            <button id="register-recovery-key" type="button" class="outline" ${state.recoveryKeyStatus?.loaded ? "" : "disabled"}>この復旧鍵をKeychainへ再登録</button>
          </div>
        </div>
        <div class="recovery-tools verification-tools">
          <div>
            <strong>暗号化バックアップの復号確認</strong>
            ${state.verificationResult?.ok ? badge(true, `${state.verificationResult.keySource}で確認済み`) : '<span class="badge muted">未確認</span>'}
            <small>${state.verificationResult ? `DB・manifest・verification確認済み / Storage ${state.verificationResult.storagePresent ? "あり" : "なし"} / 一時ファイル削除済み` : "一時領域で復号し、構造とチェックサムだけを確認します。復元は行いません。"}</small>
          </div>
          <div class="actions compact">
            <button id="verify-with-keychain" type="button" class="outline" ${state.encryptionStatus.stored && !state.busy ? "" : "disabled"}>Keychain鍵で復号確認</button>
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
  app.querySelector("#generate-key")?.addEventListener("click", () => void generateEncryptionKey());
  app.querySelector("#export-key")?.addEventListener("click", () => void exportRecoveryKey());
  app.querySelector("#import-recovery-key")?.addEventListener("click", () => void importRecoveryKey());
  app.querySelector("#register-recovery-key")?.addEventListener("click", () => void registerRecoveryKey());
  app.querySelector("#verify-with-keychain")?.addEventListener("click", () => void verifyBackup("keychain"));
  app.querySelector("#verify-with-recovery")?.addEventListener("click", () => void verifyBackup("recovery"));
  app.querySelector("#pick-local")?.addEventListener("click", () => void pickFolder("localBackupPath"));
  app.querySelector("#pick-drive")?.addEventListener("click", () => void pickFolder("googleDrivePath"));
  app.querySelector("#check-folders")?.addEventListener("click", () => void checkFolders());
  app.querySelector("#run-checks")?.addEventListener("click", () => void runChecks());
  app.querySelector("#start-backup")?.addEventListener("click", openBackupConfirmation);
  app.querySelector("#cancel-backup")?.addEventListener("click", closeBackupConfirmation);
  app.querySelector("#confirm-backup")?.addEventListener("click", () => void startBackup());
};

async function loadInitialState() {
  const [settings, secretStatus, encryptionStatus, history, running] = await Promise.all([
    runCommand<BackupToolSettings>("load_settings"),
    runCommand<SecretStatusResponse>("get_secret_status"),
    runCommand<EncryptionStatus>("get_encryption_status"),
    runCommand<BackupHistoryEntry[]>("load_backup_history"),
    runCommand<boolean>("backup_is_running"),
  ]);
  state = {
    ...state,
    settings: { ...emptySettings, ...settings },
    secretStatus: normalizeSecretStatus(secretStatus),
    encryptionStatus,
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
