export const allowedConnectionModes = ["direct", "session"] as const;
export type ConnectionMode = (typeof allowedConnectionModes)[number];

export const storageBucketName = "line-message-images";

export type PublicKeyStatus = "active" | "retired";

export type PublicKeyLedgerEntry = {
  keyId: string;
  publicRecipient: string;
  fingerprint: string;
  generatedAt: string;
  ageVersion: string;
  purpose: string;
  status: PublicKeyStatus;
  retiredAt: string | null;
};

export type ProductionKeyCeremonyMetadata = {
  keyId: string;
  publicRecipient: string;
  recipientFingerprint: string;
  generatedAt: string;
  ageVersion: string;
  googleDriveStoredAt: string;
  externalMediaStoredAt: string;
  googleDriveVerifiedAt: string;
  externalMediaVerifiedAt: string;
  completedAt: string;
  recordedByAppVersion: string;
};

export type BackupToolSettings = {
  supabaseProjectUrl: string;
  supabasePublishableKey: string;
  storageAuthEmail: string;
  dbHost: string;
  dbPort: string;
  dbName: string;
  dbUser: string;
  connectionMode: ConnectionMode;
  localBackupPath: string;
  googleDrivePath: string;
  encryptionRecipient: string | null;
  encryptionRecipientFingerprint: string | null;
  encryptionRecipientRegisteredAt: string | null;
  encryptionRecipientRegisteredByAppVersion: string | null;
  endpointId: string | null;
  encryptionAlgorithm: string | null;
  publicKeyLedger: PublicKeyLedgerEntry[];
  productionKeyCeremony: ProductionKeyCeremonyMetadata | null;
  setupComplete: boolean;
  setupStep: number;
  setupCompletedAt: string | null;
};

export const emptySettings: BackupToolSettings = {
  supabaseProjectUrl: "",
  supabasePublishableKey: "",
  storageAuthEmail: "",
  dbHost: "",
  dbPort: "5432",
  dbName: "postgres",
  dbUser: "postgres",
  connectionMode: "direct",
  localBackupPath: "",
  googleDrivePath: "",
  encryptionRecipient: null,
  encryptionRecipientFingerprint: null,
  encryptionRecipientRegisteredAt: null,
  encryptionRecipientRegisteredByAppVersion: null,
  endpointId: null,
  encryptionAlgorithm: null,
  publicKeyLedger: [],
  productionKeyCeremony: null,
  setupComplete: false,
  setupStep: 1,
  setupCompletedAt: null,
};

export const secretFieldNames = ["dbPassword", "storageAuthPassword", "serviceRoleKey"] as const;
export type SecretFieldName = (typeof secretFieldNames)[number];

const secretPatterns = [
  /()AGE-SECRET-KEY-[A-Z0-9-]+/g,
  /((?:postgres|postgresql):\/\/)[^@\s]+@/gi,
  /(password=)[^;\s]+/gi,
  /(apikey=)[^&\s]+/gi,
  /(authorization:\s*bearer\s+)[^\s]+/gi,
  /(access[_-]?token["']?\s*[:=]\s*["']?)[^"',\s]+/gi,
  /(storage[_-]?auth[_-]?password["']?\s*[:=]\s*["']?)[^"',\s]+/gi,
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
    dbHost: input.dbHost.trim(),
    dbPort: input.dbPort.trim() || "5432",
    dbName: input.dbName.trim() || "postgres",
    dbUser: input.dbUser.trim(),
    connectionMode: validateConnectionMode(input.connectionMode),
    localBackupPath: input.localBackupPath.trim(),
    googleDrivePath: input.googleDrivePath.trim(),
    encryptionRecipient: input.encryptionRecipient?.trim() || null,
    encryptionRecipientFingerprint: input.encryptionRecipientFingerprint?.trim() || null,
    encryptionRecipientRegisteredAt: input.encryptionRecipientRegisteredAt?.trim() || null,
    encryptionRecipientRegisteredByAppVersion:
      input.encryptionRecipientRegisteredByAppVersion?.trim() || null,
    endpointId: input.endpointId?.trim() || null,
    encryptionAlgorithm: input.encryptionAlgorithm?.trim() || null,
    publicKeyLedger: Array.isArray(input.publicKeyLedger) ? input.publicKeyLedger : [],
    productionKeyCeremony: input.productionKeyCeremony ?? null,
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
    "passphrase",
    "privateKey",
    "secretKey",
  ]
    .some((name) => Object.prototype.hasOwnProperty.call(settings, name));
}
