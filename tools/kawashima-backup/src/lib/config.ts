export const allowedConnectionModes = ["direct", "session"] as const;
export type ConnectionMode = (typeof allowedConnectionModes)[number];

export const storageBucketName = "line-message-images";

export type BackupToolSettings = {
  supabaseProjectUrl: string;
  supabasePublishableKey: string;
  storageAuthEmail: string;
  storageRestoreAuthEmail: string;
  dbHost: string;
  dbPort: string;
  dbName: string;
  dbUser: string;
  dbRestoreUser: string;
  connectionMode: ConnectionMode;
  localBackupPath: string;
  googleDrivePath: string;
  endpointId: string | null;
  encryptionAlgorithm: string | null;
  setupComplete: boolean;
  setupStep: number;
  setupCompletedAt: string | null;
};

export const emptySettings: BackupToolSettings = {
  supabaseProjectUrl: "",
  supabasePublishableKey: "",
  storageAuthEmail: "",
  storageRestoreAuthEmail: "",
  dbHost: "",
  dbPort: "5432",
  dbName: "postgres",
  dbUser: "postgres",
  dbRestoreUser: "",
  connectionMode: "direct",
  localBackupPath: "",
  googleDrivePath: "",
  endpointId: null,
  encryptionAlgorithm: "age-passphrase",
  setupComplete: false,
  setupStep: 1,
  setupCompletedAt: null,
};

export const secretFieldNames = [
  "dbPassword",
  "storageAuthPassword",
  "dbRestorePassword",
  "storageRestoreAuthPassword",
  "serviceRoleKey",
] as const;
export type SecretFieldName = (typeof secretFieldNames)[number];

const secretPatterns = [
  /()AGE-SECRET-KEY-[A-Z0-9-]+/g,
  /((?:postgres|postgresql):\/\/)[^@\s]+@/gi,
  /(password=)[^;\s]+/gi,
  /(apikey=)[^&\s]+/gi,
  /(authorization:\s*bearer\s+)[^\s]+/gi,
  /(access[_-]?token["']?\s*[:=]\s*["']?)[^"',\s]+/gi,
  /(storage[_-]?auth[_-]?password["']?\s*[:=]\s*["']?)[^"',\s]+/gi,
  /(storage[_-]?restore[_-]?auth[_-]?password["']?\s*[:=]\s*["']?)[^"',\s]+/gi,
  /(db[_-]?restore[_-]?password["']?\s*[:=]\s*["']?)[^"',\s]+/gi,
  /(service[_-]?role[_-]?key["']?\s*[:=]\s*["']?)[^"',\s]+/gi,
  /((?:recovery[_-]?)?passphrase["']?\s*[:=]\s*["']?)[^"',\s]+/gi,
];

export function isConnectionMode(value: string): value is ConnectionMode {
  return allowedConnectionModes.includes(value as ConnectionMode);
}

export function validateConnectionMode(value: string): ConnectionMode {
  if (!isConnectionMode(value)) {
    throw new Error("Direct connection または Session pooler を選択してください。");
  }
  return value;
}

export function sanitizeSettings(input: BackupToolSettings): BackupToolSettings {
  return {
    supabaseProjectUrl: input.supabaseProjectUrl.trim(),
    supabasePublishableKey: input.supabasePublishableKey?.trim() ?? "",
    storageAuthEmail: input.storageAuthEmail?.trim() ?? "",
    storageRestoreAuthEmail: input.storageRestoreAuthEmail?.trim() ?? "",
    dbHost: input.dbHost.trim(),
    dbPort: input.dbPort.trim() || "5432",
    dbName: input.dbName.trim() || "postgres",
    dbUser: input.dbUser.trim(),
    dbRestoreUser: input.dbRestoreUser?.trim() ?? "",
    connectionMode: validateConnectionMode(input.connectionMode),
    localBackupPath: input.localBackupPath.trim(),
    googleDrivePath: input.googleDrivePath.trim(),
    endpointId: input.endpointId?.trim() || null,
    encryptionAlgorithm: "age-passphrase",
    setupComplete: Boolean(input.setupComplete),
    setupStep: normalizeSetupStep(input.setupStep),
    setupCompletedAt: input.setupCompletedAt?.trim() || null,
  };
}

export const setupSteps = [
  "システム確認",
  "バックアップ保存先",
  "ACTARISE接続設定",
  "暗号化設定",
  "動作確認",
  "セットアップ完了",
] as const;

export function normalizeSetupStep(value: number): number {
  if (!Number.isFinite(value)) return 1;
  return Math.min(setupSteps.length, Math.max(1, Math.trunc(value)));
}

export function validateFolderPath(path: string): string | null {
  if (!path.trim()) return "保存先フォルダを選択してください。";
  if (path.includes("\0")) return "保存先フォルダの形式が正しくありません。";
  return null;
}

export function maskSecret(value: string): string {
  if (!value) return "";
  if (value.length <= 4) return "****";
  return `${value.slice(0, 2)}****${value.slice(-2)}`;
}

export function redactSensitiveText(value: unknown): string {
  let text = value instanceof Error ? value.message : String(value ?? "");
  for (const pattern of secretPatterns) {
    text = text.replace(pattern, (_match, prefix = "") => `${prefix}[masked]`);
  }
  return text;
}

export function hasSecretLikeValue(settings: Record<string, unknown>): boolean {
  return [
    ...secretFieldNames,
    "backupAgeIdentity",
    "ageIdentity",
    "recoveryKey",
    "recoveryPassphrase",
    "recoveryPassword",
    "passphrase",
    "privateKey",
    "secretKey",
  ]
    .some((name) => Object.prototype.hasOwnProperty.call(settings, name));
}
