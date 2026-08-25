export const allowedConnectionModes = ["direct", "session"] as const;
export type ConnectionMode = (typeof allowedConnectionModes)[number];

export const storageBucketName = "line-message-images";

export type BackupToolSettings = {
  supabaseProjectUrl: string;
  dbHost: string;
  dbPort: string;
  dbName: string;
  dbUser: string;
  connectionMode: ConnectionMode;
  localBackupPath: string;
  googleDrivePath: string;
  encryptionRecoveryExported: boolean;
  recoveryKeyFingerprint: string | null;
  recoveryKeyExportedAt: string | null;
};

export const emptySettings: BackupToolSettings = {
  supabaseProjectUrl: "",
  dbHost: "",
  dbPort: "5432",
  dbName: "postgres",
  dbUser: "postgres",
  connectionMode: "direct",
  localBackupPath: "",
  googleDrivePath: "",
  encryptionRecoveryExported: false,
  recoveryKeyFingerprint: null,
  recoveryKeyExportedAt: null,
};

export const secretFieldNames = ["dbPassword", "serviceRoleKey"] as const;
export type SecretFieldName = (typeof secretFieldNames)[number];

const secretPatterns = [
  /((?:postgres|postgresql):\/\/)[^@\s]+@/gi,
  /(password=)[^;\s]+/gi,
  /(apikey=)[^&\s]+/gi,
  /(authorization:\s*bearer\s+)[^\s]+/gi,
  /(service[_-]?role[_-]?key["']?\s*[:=]\s*["']?)[^"',\s]+/gi,
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
    dbHost: input.dbHost.trim(),
    dbPort: input.dbPort.trim() || "5432",
    dbName: input.dbName.trim() || "postgres",
    dbUser: input.dbUser.trim(),
    connectionMode: validateConnectionMode(input.connectionMode),
    localBackupPath: input.localBackupPath.trim(),
    googleDrivePath: input.googleDrivePath.trim(),
    encryptionRecoveryExported: Boolean(input.encryptionRecoveryExported),
    recoveryKeyFingerprint: input.recoveryKeyFingerprint?.trim() || null,
    recoveryKeyExportedAt: input.recoveryKeyExportedAt?.trim() || null,
  };
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
  return [...secretFieldNames, "backupAgeIdentity", "recoveryKey", "privateKey", "secretKey"]
    .some((name) => Object.prototype.hasOwnProperty.call(settings, name));
}
