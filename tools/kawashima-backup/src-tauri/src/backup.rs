use std::{
    fs::{self, File, OpenOptions},
    io::{BufRead, BufReader, BufWriter, Read, Write},
    path::{Component, Path, PathBuf},
    process::Command,
    str::FromStr,
    sync::{
        atomic::{AtomicBool, Ordering},
        Mutex,
    },
};

#[cfg(unix)]
use std::os::unix::fs::OpenOptionsExt;

use age::{secrecy::ExposeSecret, x25519, Decryptor, Encryptor};
use chrono::{Local, SecondsFormat, Utc};
use reqwest::header::HeaderMap;
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use sha2::{Digest, Sha256};
use tauri::{AppHandle, Emitter, Manager, State};

use super::{
    build_database_tls_connector, build_db_config, connection_mode_label, normalize_project_url,
    read_secret, sanitized_error, save_settings_to_disk, storage_headers, BackupToolSettings,
    ACCOUNT_DB_PASSWORD, ACCOUNT_SERVICE_ROLE_KEY, SUPABASE_ROOT_CA_PEM,
};

const ACCOUNT_ENCRYPTION_IDENTITY: &str = "backup-age-identity";
const HISTORY_FILE_NAME: &str = "backup-history.json";
const STORAGE_BUCKET: &str = "line-message-images";
const STORAGE_PAGE_SIZE: usize = 100;
const STORAGE_DOWNLOAD_ATTEMPTS: usize = 3;
const PROGRESS_EVENT: &str = "backup-progress";
const ARCHIVE_ROOT: &str = "kawashima-backup";
const DUMP_FILE_NAME: &str = "public.dump";
const REQUIRED_PG_DUMP_MAJOR: u32 = 17;
const MAX_RECOVERY_KEY_FILE_SIZE: u64 = 16 * 1024;

static BACKUP_RUNNING: AtomicBool = AtomicBool::new(false);

#[derive(Default)]
pub(crate) struct RecoveryKeyState(Mutex<Option<x25519::Identity>>);

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct EncryptionStatus {
    stored: bool,
    recovery_exported: bool,
    recipient: Option<String>,
    key_fingerprint: Option<String>,
    recovery_key_fingerprint: Option<String>,
    recovery_key_exported_at: Option<String>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct RecoveryKeyImportStatus {
    loaded: bool,
    valid: bool,
    fingerprint: String,
    matches_keychain: Option<bool>,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) enum VerificationKeySource {
    Keychain,
    Recovery,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct BackupVerificationResult {
    ok: bool,
    key_source: String,
    key_fingerprint: String,
    database_dump_present: bool,
    manifests_present: bool,
    storage_present: bool,
    verification_present: bool,
    temporary_files_removed: bool,
}

#[derive(Debug, Clone)]
struct VerifiedBackupStructure {
    database_dump_present: bool,
    manifests_present: bool,
    storage_present: bool,
    verification_present: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct BackupHistoryEntry {
    backup_id: String,
    started_at: String,
    completed_at: String,
    file_name: String,
    success: bool,
    error_summary: Option<String>,
    encrypted_size: u64,
    encrypted_sha256: String,
    database_ok: bool,
    storage_ok: bool,
    verification_ok: bool,
    local_copy_ok: bool,
    google_drive_copy_ok: bool,
    storage_object_count: usize,
    public_table_count: i64,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct BackupResult {
    history: BackupHistoryEntry,
    local_path: String,
    google_drive_path: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct BackupProgress {
    stage: String,
    status: String,
    message: String,
    current: Option<usize>,
    total: Option<usize>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct DatabaseManifest {
    created_at: String,
    postgres_version: String,
    connection_mode: String,
    schema: String,
    dump_file: String,
    dump_format: String,
    dump_size: u64,
    dump_sha256: String,
    public_table_count: i64,
    pg_dump_version: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct StorageObjectManifest {
    path: String,
    size: u64,
    sha256: String,
    content_type: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct StorageManifest {
    created_at: String,
    bucket: String,
    object_count: usize,
    objects: Vec<StorageObjectManifest>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct BackupManifest {
    format_version: u32,
    backup_id: String,
    created_at: String,
    application: String,
    database_manifest: String,
    storage_manifest: String,
    checksum_manifest: String,
    encryption: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct BackupReport {
    status: String,
    created_at: String,
    database_backup: bool,
    storage_backup: bool,
    manifests_created: bool,
    checksums_created: bool,
    expected_encrypted_destinations: usize,
}

#[derive(Debug, Clone)]
struct StorageObjectRef {
    path: String,
    content_type: Option<String>,
}

struct BackupRunGuard;

impl BackupRunGuard {
    fn acquire() -> Result<Self, String> {
        BACKUP_RUNNING
            .compare_exchange(false, true, Ordering::SeqCst, Ordering::SeqCst)
            .map_err(|_| "バックアップはすでに実行中です。".to_string())?;
        Ok(Self)
    }
}

impl Drop for BackupRunGuard {
    fn drop(&mut self) {
        BACKUP_RUNNING.store(false, Ordering::SeqCst);
    }
}

#[tauri::command]
pub(crate) fn backup_is_running() -> bool {
    BACKUP_RUNNING.load(Ordering::SeqCst)
}

#[tauri::command]
pub(crate) fn get_encryption_status(app: AppHandle) -> EncryptionStatus {
    encryption_status(&app)
}

#[tauri::command]
pub(crate) fn generate_encryption_identity(app: AppHandle) -> Result<EncryptionStatus, String> {
    if read_encryption_identity().is_ok() {
        return Err("暗号化鍵はすでに作成済みです。既存鍵を維持します。".to_string());
    }

    let identity = x25519::Identity::generate();
    super::write_secret(
        ACCOUNT_ENCRYPTION_IDENTITY,
        identity.to_string().expose_secret(),
    )?;
    let stored = read_encryption_identity()?;
    let status = encryption_status(&app);
    if !status.stored || stored.to_public().to_string().is_empty() {
        return Err("暗号化鍵をOS資格情報ストアへ保存後に確認できませんでした。".to_string());
    }
    Ok(status)
}

#[tauri::command]
pub(crate) fn export_recovery_key(
    app: AppHandle,
    path: String,
    mut settings: BackupToolSettings,
) -> Result<EncryptionStatus, String> {
    let identity = read_encryption_identity()?;
    let destination = PathBuf::from(path.trim());
    validate_recovery_destination(&destination, &settings)?;
    if let Some(parent) = destination.parent() {
        fs::create_dir_all(parent).map_err(|error| sanitized_error(error))?;
    }

    let mut options = OpenOptions::new();
    options.write(true).create_new(true);
    #[cfg(unix)]
    options.mode(0o600);
    let mut file = options
        .open(&destination)
        .map_err(|_| "復旧鍵の保存先には新しいファイルを指定してください。".to_string())?;
    writeln!(file, "# created by Kawashima Motors Backup Tool")
        .map_err(|error| sanitized_error(error))?;
    writeln!(file, "# public key: {}", identity.to_public())
        .map_err(|error| sanitized_error(error))?;
    writeln!(file, "{}", identity.to_string().expose_secret())
        .map_err(|error| sanitized_error(error))?;
    file.sync_all().map_err(|error| sanitized_error(error))?;
    set_private_file_permissions(&destination)?;

    let exported_identity = read_recovery_identity_file(&destination)?;
    let fingerprint = identity_fingerprint(&identity);
    if identity_fingerprint(&exported_identity) != fingerprint {
        let _ = fs::remove_file(&destination);
        return Err("書き出した復旧鍵を検証できませんでした。".to_string());
    }

    settings.encryption_recovery_exported = true;
    settings.recovery_key_fingerprint = Some(fingerprint);
    settings.recovery_key_exported_at = Some(Utc::now().to_rfc3339_opts(SecondsFormat::Secs, true));
    if let Err(error) = save_settings_to_disk(&app, &settings) {
        let _ = fs::remove_file(&destination);
        return Err(error);
    }
    Ok(encryption_status(&app))
}

#[tauri::command]
pub(crate) fn import_recovery_key(
    path: String,
    state: State<'_, RecoveryKeyState>,
) -> Result<RecoveryKeyImportStatus, String> {
    {
        let mut loaded = state
            .0
            .lock()
            .map_err(|_| "復旧鍵の状態を更新できませんでした。".to_string())?;
        *loaded = None;
    }
    let identity = read_recovery_identity_file(Path::new(path.trim()))?;
    let fingerprint = identity_fingerprint(&identity);
    let matches_keychain = read_encryption_identity()
        .ok()
        .map(|stored| identity_fingerprint(&stored) == fingerprint);
    let mut loaded = state
        .0
        .lock()
        .map_err(|_| "復旧鍵の状態を更新できませんでした。".to_string())?;
    *loaded = Some(identity);
    Ok(RecoveryKeyImportStatus {
        loaded: true,
        valid: true,
        fingerprint,
        matches_keychain,
    })
}

#[tauri::command]
pub(crate) fn register_imported_recovery_key(
    app: AppHandle,
    state: State<'_, RecoveryKeyState>,
) -> Result<EncryptionStatus, String> {
    let identity = state
        .0
        .lock()
        .map_err(|_| "復旧鍵の状態を読み込めませんでした。".to_string())?
        .as_ref()
        .cloned()
        .ok_or_else(|| "有効な復旧鍵を先に読み込んでください。".to_string())?;
    persist_and_verify_identity(
        &identity,
        |encoded| super::write_secret(ACCOUNT_ENCRYPTION_IDENTITY, encoded),
        read_encryption_identity,
    )?;
    Ok(encryption_status(&app))
}

#[tauri::command]
pub(crate) fn verify_backup_file(
    path: String,
    key_source: VerificationKeySource,
    state: State<'_, RecoveryKeyState>,
) -> Result<BackupVerificationResult, String> {
    let (identity, source_label) = match key_source {
        VerificationKeySource::Keychain => (read_encryption_identity()?, "Keychain"),
        VerificationKeySource::Recovery => {
            let identity = state
                .0
                .lock()
                .map_err(|_| "復旧鍵の状態を読み込めませんでした。".to_string())?
                .as_ref()
                .cloned()
                .ok_or_else(|| "有効な復旧鍵を先に読み込んでください。".to_string())?;
            (identity, "復旧鍵")
        }
    };
    verify_backup_file_with_identity(Path::new(path.trim()), &identity, source_label)
}

#[tauri::command]
pub(crate) fn load_backup_history(app: AppHandle) -> Result<Vec<BackupHistoryEntry>, String> {
    read_history(&app)
}

#[tauri::command]
pub(crate) async fn run_backup(
    app: AppHandle,
    settings: BackupToolSettings,
) -> Result<BackupResult, String> {
    let _guard = BackupRunGuard::acquire()?;
    let failed_started_at = Utc::now();
    let result = execute_backup(app.clone(), settings).await;
    if let Err(error) = &result {
        let now = Utc::now();
        let failed_entry = BackupHistoryEntry {
            backup_id: Local::now().format("%Y%m%d-%H%M%S-JST-failed").to_string(),
            started_at: failed_started_at.to_rfc3339_opts(SecondsFormat::Secs, true),
            completed_at: now.to_rfc3339_opts(SecondsFormat::Secs, true),
            file_name: "未生成".to_string(),
            success: false,
            error_summary: Some(safe_backup_error_summary(error)),
            encrypted_size: 0,
            encrypted_sha256: String::new(),
            database_ok: false,
            storage_ok: false,
            verification_ok: false,
            local_copy_ok: false,
            google_drive_copy_ok: false,
            storage_object_count: 0,
            public_table_count: 0,
        };
        let _ = append_history(&app, failed_entry);
        emit_progress(
            &app,
            "failed",
            "failed",
            "バックアップは完了していません。",
            None,
            None,
        );
    }
    result
}

async fn execute_backup(
    app: AppHandle,
    settings: BackupToolSettings,
) -> Result<BackupResult, String> {
    validate_backup_prerequisites(&app, &settings)?;
    emit_progress(
        &app,
        "preflight",
        "running",
        "事前確認を実行しています。",
        None,
        None,
    );

    let started_at = Utc::now();
    let local_started_at = Local::now();
    let backup_id = local_started_at.format("%Y%m%d-%H%M%S-JST").to_string();
    let archive_name = format!("kawashima-backup-{backup_id}.tar.age");
    let temp = tempfile::Builder::new()
        .prefix("kawashima-backup-")
        .tempdir()
        .map_err(|error| sanitized_error(error))?;
    let source_root = temp.path().join(ARCHIVE_ROOT);
    let database_dir = source_root.join("database");
    let storage_dir = source_root.join("storage").join(STORAGE_BUCKET);
    let manifests_dir = source_root.join("manifests");
    let verification_dir = source_root.join("verification");
    for directory in [
        &database_dir,
        &storage_dir,
        &manifests_dir,
        &verification_dir,
    ] {
        fs::create_dir_all(directory).map_err(|error| sanitized_error(error))?;
    }

    let db_password =
        read_secret(ACCOUNT_DB_PASSWORD).map_err(|_| "DBパスワードが未設定です。".to_string())?;
    let service_role_key = read_secret(ACCOUNT_SERVICE_ROLE_KEY)
        .map_err(|_| "Service Role Keyが未設定です。".to_string())?;
    let identity = read_encryption_identity()?;

    let db_info = query_database_metadata(&settings, &db_password).await?;
    let pg_dump_path = resolve_pg_dump_path(&app)?;
    let pg_dump_version = validate_pg_dump(&pg_dump_path)?;
    emit_progress(
        &app,
        "database",
        "running",
        "public schemaを取得しています。",
        None,
        None,
    );
    let dump_path = database_dir.join(DUMP_FILE_NAME);
    let ca_path = temp.path().join("supabase-root-2021.crt");
    fs::write(&ca_path, SUPABASE_ROOT_CA_PEM).map_err(|error| sanitized_error(error))?;
    run_pg_dump_process(&pg_dump_path, &settings, &db_password, &ca_path, &dump_path)?;
    let dump_size = file_size(&dump_path)?;
    let dump_sha256 = sha256_file(&dump_path)?;
    emit_progress(
        &app,
        "database",
        "complete",
        "データベース取得が完了しました。",
        None,
        None,
    );

    emit_progress(
        &app,
        "storage",
        "running",
        "画像ファイルの一覧を取得しています。",
        None,
        None,
    );
    let storage_objects =
        list_storage_objects(&settings.supabase_project_url, &service_role_key).await?;
    let storage_manifest_objects = download_storage_objects(
        &app,
        &settings.supabase_project_url,
        &service_role_key,
        &storage_dir,
        &storage_objects,
    )
    .await?;
    validate_storage_completion(&storage_objects, &storage_manifest_objects)?;
    emit_progress(
        &app,
        "storage",
        "complete",
        "画像ファイルの取得が完了しました。",
        Some(storage_manifest_objects.len()),
        Some(storage_manifest_objects.len()),
    );

    emit_progress(
        &app,
        "manifest",
        "running",
        "検証情報を作成しています。",
        None,
        None,
    );
    let created_at = Utc::now().to_rfc3339_opts(SecondsFormat::Secs, true);
    let database_manifest = DatabaseManifest {
        created_at: created_at.clone(),
        postgres_version: db_info.0,
        connection_mode: connection_mode_label(&settings.connection_mode).to_string(),
        schema: "public".to_string(),
        dump_file: format!("database/{DUMP_FILE_NAME}"),
        dump_format: "PostgreSQL custom".to_string(),
        dump_size,
        dump_sha256,
        public_table_count: db_info.1,
        pg_dump_version,
    };
    let storage_manifest = StorageManifest {
        created_at: created_at.clone(),
        bucket: STORAGE_BUCKET.to_string(),
        object_count: storage_manifest_objects.len(),
        objects: storage_manifest_objects,
    };
    let backup_manifest = BackupManifest {
        format_version: 1,
        backup_id: backup_id.clone(),
        created_at: created_at.clone(),
        application: "Kawashima Motors Backup Tool".to_string(),
        database_manifest: "manifests/database.json".to_string(),
        storage_manifest: "manifests/storage.json".to_string(),
        checksum_manifest: "verification/sha256sums.txt".to_string(),
        encryption: "age X25519".to_string(),
    };
    let backup_report = BackupReport {
        status: "success".to_string(),
        created_at: created_at.clone(),
        database_backup: true,
        storage_backup: true,
        manifests_created: true,
        checksums_created: true,
        expected_encrypted_destinations: 2,
    };
    write_json(&manifests_dir.join("database.json"), &database_manifest)?;
    write_json(&manifests_dir.join("storage.json"), &storage_manifest)?;
    write_json(&manifests_dir.join("backup.json"), &backup_manifest)?;
    write_json(&verification_dir.join("backup-report.json"), &backup_report)?;
    write_checksum_manifest(&source_root, &verification_dir.join("sha256sums.txt"))?;
    emit_progress(
        &app,
        "manifest",
        "complete",
        "検証情報を作成しました。",
        None,
        None,
    );

    emit_progress(
        &app,
        "archive",
        "running",
        "バックアップを1つにまとめています。",
        None,
        None,
    );
    let tar_path = temp.path().join(format!("{backup_id}.tar"));
    create_tar_archive(&source_root, &tar_path)?;
    emit_progress(
        &app,
        "archive",
        "complete",
        "バックアップをまとめました。",
        None,
        None,
    );

    emit_progress(
        &app,
        "encrypt",
        "running",
        "バックアップを暗号化しています。",
        None,
        None,
    );
    let encrypted_path = temp.path().join(&archive_name);
    encrypt_file(&tar_path, &encrypted_path, &identity)?;
    let encrypted_size = file_size(&encrypted_path)?;
    let encrypted_sha256 = sha256_file(&encrypted_path)?;
    emit_progress(
        &app,
        "encrypt",
        "complete",
        "暗号化が完了しました。",
        None,
        None,
    );

    emit_progress(
        &app,
        "verify",
        "running",
        "復号と整合性を検証しています。",
        None,
        None,
    );
    verify_encrypted_backup(&encrypted_path, &identity, temp.path())?;
    emit_progress(
        &app,
        "verify",
        "complete",
        "復号と整合性を確認しました。",
        None,
        None,
    );

    emit_progress(
        &app,
        "copy",
        "running",
        "2つの保存先へコピーしています。",
        None,
        None,
    );
    let (local_path, google_drive_path) =
        copy_to_destinations(&encrypted_path, &archive_name, &settings, &encrypted_sha256)?;
    emit_progress(
        &app,
        "copy",
        "complete",
        "2つの保存先へ保存しました。",
        None,
        None,
    );

    let completed_at = Utc::now();
    let history = BackupHistoryEntry {
        backup_id,
        started_at: started_at.to_rfc3339_opts(SecondsFormat::Secs, true),
        completed_at: completed_at.to_rfc3339_opts(SecondsFormat::Secs, true),
        file_name: archive_name,
        success: true,
        error_summary: None,
        encrypted_size,
        encrypted_sha256,
        database_ok: true,
        storage_ok: true,
        verification_ok: true,
        local_copy_ok: true,
        google_drive_copy_ok: true,
        storage_object_count: storage_manifest.object_count,
        public_table_count: database_manifest.public_table_count,
    };
    append_history(&app, history.clone())?;
    emit_progress(
        &app,
        "complete",
        "complete",
        "バックアップが正常に完了しました。",
        None,
        None,
    );

    Ok(BackupResult {
        history,
        local_path: local_path.to_string_lossy().to_string(),
        google_drive_path: google_drive_path.to_string_lossy().to_string(),
    })
}

fn encryption_status(app: &AppHandle) -> EncryptionStatus {
    let identity = read_encryption_identity().ok();
    let settings = super::load_settings_from_disk(app).unwrap_or_default();
    let key_fingerprint = identity.as_ref().map(identity_fingerprint);
    let recovery_exported = recovery_metadata_matches(&settings, key_fingerprint.as_deref());
    EncryptionStatus {
        stored: identity.is_some(),
        recovery_exported,
        recipient: identity.map(|value| value.to_public().to_string()),
        key_fingerprint,
        recovery_key_fingerprint: settings.recovery_key_fingerprint,
        recovery_key_exported_at: settings.recovery_key_exported_at,
    }
}

fn recovery_metadata_matches(settings: &BackupToolSettings, key_fingerprint: Option<&str>) -> bool {
    settings.encryption_recovery_exported
        && settings.recovery_key_exported_at.is_some()
        && settings.recovery_key_fingerprint.as_deref() == key_fingerprint
}

fn read_encryption_identity() -> Result<x25519::Identity, String> {
    let encoded = read_secret(ACCOUNT_ENCRYPTION_IDENTITY)
        .map_err(|_| "暗号化鍵が未設定です。".to_string())?;
    x25519::Identity::from_str(&encoded).map_err(|_| "暗号化鍵を読み込めませんでした。".to_string())
}

fn identity_fingerprint(identity: &x25519::Identity) -> String {
    sha256_bytes(identity.to_public().to_string().as_bytes())
}

fn persist_and_verify_identity<W, R>(
    identity: &x25519::Identity,
    write: W,
    read: R,
) -> Result<(), String>
where
    W: FnOnce(&str) -> Result<(), String>,
    R: FnOnce() -> Result<x25519::Identity, String>,
{
    let expected_fingerprint = identity_fingerprint(identity);
    let encoded = identity.to_string();
    write(encoded.expose_secret())?;
    let stored = read()?;
    if identity_fingerprint(&stored) != expected_fingerprint {
        return Err("復旧鍵をKeychainへ保存後に確認できませんでした。".to_string());
    }
    Ok(())
}

fn read_recovery_identity_file(path: &Path) -> Result<x25519::Identity, String> {
    if !path.is_file() {
        return Err("復旧鍵ファイルを読み込めませんでした。".to_string());
    }
    let metadata =
        fs::metadata(path).map_err(|_| "復旧鍵ファイルを読み込めませんでした。".to_string())?;
    if metadata.len() == 0 || metadata.len() > MAX_RECOVERY_KEY_FILE_SIZE {
        return Err("復旧鍵ファイルの形式が正しくありません。".to_string());
    }
    let content = fs::read_to_string(path)
        .map_err(|_| "復旧鍵ファイルを読み込めませんでした。".to_string())?;
    parse_recovery_identity(&content)
}

fn parse_recovery_identity(content: &str) -> Result<x25519::Identity, String> {
    let mut identities = content
        .lines()
        .map(str::trim)
        .filter(|line| line.starts_with("AGE-SECRET-KEY-"));
    let encoded = identities
        .next()
        .ok_or_else(|| "有効なage X25519復旧鍵ではありません。".to_string())?;
    if identities.next().is_some() {
        return Err("復旧鍵ファイルに複数の秘密鍵が含まれています。".to_string());
    }
    x25519::Identity::from_str(encoded)
        .map_err(|_| "有効なage X25519復旧鍵ではありません。".to_string())
}

fn validate_recovery_destination(path: &Path, settings: &BackupToolSettings) -> Result<(), String> {
    if path.as_os_str().is_empty() || path.file_name().is_none() {
        return Err("復旧鍵の保存先ファイルを指定してください。".to_string());
    }
    let parent = path
        .parent()
        .ok_or_else(|| "復旧鍵の保存先を確認してください。".to_string())?;
    let parent = parent
        .canonicalize()
        .map_err(|_| "復旧鍵の保存先フォルダを確認してください。".to_string())?;
    for backup_path in [&settings.local_backup_path, &settings.google_drive_path] {
        if backup_path.trim().is_empty() {
            continue;
        }
        if let Ok(root) = Path::new(backup_path).canonicalize() {
            if parent.starts_with(root) {
                return Err(
                    "復旧鍵はバックアップ保存先とは別の安全な場所へ保存してください。".to_string(),
                );
            }
        }
    }
    Ok(())
}

#[cfg(unix)]
fn set_private_file_permissions(path: &Path) -> Result<(), String> {
    use std::os::unix::fs::PermissionsExt;
    fs::set_permissions(path, fs::Permissions::from_mode(0o600))
        .map_err(|error| sanitized_error(error))
}

#[cfg(not(unix))]
fn set_private_file_permissions(_path: &Path) -> Result<(), String> {
    Ok(())
}

fn validate_backup_prerequisites(
    app: &AppHandle,
    settings: &BackupToolSettings,
) -> Result<(), String> {
    super::validate_settings(settings)?;
    if !settings.encryption_recovery_exported {
        return Err("暗号化の復旧鍵を先に書き出してください。".to_string());
    }
    read_secret(ACCOUNT_DB_PASSWORD).map_err(|_| "DBパスワードが未設定です。".to_string())?;
    read_secret(ACCOUNT_SERVICE_ROLE_KEY)
        .map_err(|_| "Service Role Keyが未設定です。".to_string())?;
    read_encryption_identity()?;
    let local = Path::new(settings.local_backup_path.trim());
    let drive = Path::new(settings.google_drive_path.trim());
    if !local.is_dir() || !drive.is_dir() {
        return Err("PC保存先とGoogle Drive同期フォルダを確認してください。".to_string());
    }
    let local = local
        .canonicalize()
        .map_err(|_| "PC保存先を確認してください。".to_string())?;
    let drive = drive
        .canonicalize()
        .map_err(|_| "Google Drive保存先を確認してください。".to_string())?;
    if local == drive {
        return Err("PC保存先とGoogle Drive保存先は別のフォルダを指定してください。".to_string());
    }
    resolve_pg_dump_path(app)?;
    Ok(())
}

async fn query_database_metadata(
    settings: &BackupToolSettings,
    password: &str,
) -> Result<(String, i64), String> {
    let config = build_db_config(settings, password)?;
    let (client, connection) = config
        .connect(build_database_tls_connector()?)
        .await
        .map_err(|error| sanitized_error(error))?;
    tauri::async_runtime::spawn(async move {
        let _ = connection.await;
    });
    let version: String = client
        .query_one("select version()", &[])
        .await
        .map_err(|error| sanitized_error(error))?
        .get(0);
    let table_count: i64 = client
        .query_one(
            "select count(*) from information_schema.tables where table_schema = 'public' and table_type = 'BASE TABLE'",
            &[],
        )
        .await
        .map_err(|error| sanitized_error(error))?
        .get(0);
    Ok((
        version
            .split_whitespace()
            .take(2)
            .collect::<Vec<_>>()
            .join(" "),
        table_count,
    ))
}

fn resolve_pg_dump_path(app: &AppHandle) -> Result<PathBuf, String> {
    let relative = if cfg!(target_os = "windows") {
        PathBuf::from("resources/bin/windows-x86_64/pg_dump.exe")
    } else if cfg!(all(target_os = "macos", target_arch = "aarch64")) {
        PathBuf::from("resources/bin/macos-aarch64/pg_dump")
    } else {
        return Err("このOS向けのpg_dump 17はまだ同梱されていません。".to_string());
    };
    let bundled = app
        .path()
        .resource_dir()
        .map_err(|error| sanitized_error(error))?
        .join(&relative);
    if bundled.is_file() {
        return Ok(bundled);
    }
    let development = Path::new(env!("CARGO_MANIFEST_DIR")).join(relative);
    if development.is_file() {
        return Ok(development);
    }
    Err("同梱されたpg_dump 17が見つかりません。".to_string())
}

fn validate_pg_dump(path: &Path) -> Result<String, String> {
    let output = Command::new(path)
        .arg("--version")
        .output()
        .map_err(|_| "pg_dumpを起動できませんでした。".to_string())?;
    if !output.status.success() {
        return Err("pg_dumpのバージョンを確認できませんでした。".to_string());
    }
    let version = String::from_utf8_lossy(&output.stdout).trim().to_string();
    let major = version
        .split_whitespace()
        .find_map(|part| part.split('.').next()?.parse::<u32>().ok())
        .ok_or_else(|| "pg_dumpのバージョン形式を確認できませんでした。".to_string())?;
    if major != REQUIRED_PG_DUMP_MAJOR {
        return Err(format!("pg_dump {REQUIRED_PG_DUMP_MAJOR}が必要です。"));
    }
    Ok(version)
}

fn run_pg_dump_process(
    executable: &Path,
    settings: &BackupToolSettings,
    password: &str,
    ca_path: &Path,
    output_path: &Path,
) -> Result<(), String> {
    let output = Command::new(executable)
        .args([
            "--format=custom",
            "--schema=public",
            "--no-owner",
            "--no-acl",
        ])
        .arg("--file")
        .arg(output_path)
        .env("PGHOST", settings.db_host.trim())
        .env("PGPORT", settings.db_port.trim())
        .env("PGDATABASE", settings.db_name.trim())
        .env("PGUSER", settings.db_user.trim())
        .env("PGPASSWORD", password)
        .env("PGSSLMODE", "verify-full")
        .env("PGSSLROOTCERT", ca_path)
        .env("PGAPPNAME", "kawashima_backup_tool_phase2")
        .env_remove("PGSERVICE")
        .env_remove("PGPASSFILE")
        .output()
        .map_err(|_| "pg_dumpを起動できませんでした。".to_string())?;
    if !output.status.success() {
        if output_path.exists() {
            let _ = fs::remove_file(output_path);
        }
        return Err(format!(
            "データベース取得に失敗しました。 {}",
            sanitized_error(String::from_utf8_lossy(&output.stderr))
        ));
    }
    if !output_path.is_file() || file_size(output_path)? == 0 {
        return Err("データベースファイルが生成されませんでした。".to_string());
    }
    Ok(())
}

async fn list_storage_objects(
    project_url: &str,
    service_role_key: &str,
) -> Result<Vec<StorageObjectRef>, String> {
    let project_url = normalize_project_url(project_url)?;
    let client = reqwest::Client::new();
    let headers = storage_headers(service_role_key)?;
    let mut objects = Vec::new();
    let mut folders = vec![String::new()];
    while let Some(prefix) = folders.pop() {
        let mut offset = 0usize;
        loop {
            let response = client
                .post(format!(
                    "{project_url}/storage/v1/object/list/{STORAGE_BUCKET}"
                ))
                .headers(headers.clone())
                .json(&json!({
                    "prefix": prefix,
                    "limit": STORAGE_PAGE_SIZE,
                    "offset": offset,
                    "sortBy": { "column": "name", "order": "asc" }
                }))
                .send()
                .await
                .map_err(|error| sanitized_error(error))?;
            if !response.status().is_success() {
                return Err(format!(
                    "Storage一覧の取得に失敗しました: {}",
                    response.status()
                ));
            }
            let entries: Vec<Value> = response
                .json()
                .await
                .map_err(|error| sanitized_error(error))?;
            if entries.is_empty() {
                break;
            }
            for entry in &entries {
                let name = entry.get("name").and_then(Value::as_str).unwrap_or("");
                if name.is_empty() {
                    continue;
                }
                let full_path = if prefix.is_empty() {
                    name.to_string()
                } else {
                    format!("{prefix}/{name}")
                };
                let is_folder = entry.get("id").and_then(Value::as_str).is_none()
                    && entry.get("metadata").is_none_or(Value::is_null);
                if is_folder {
                    folders.push(full_path);
                } else {
                    validate_object_path(&full_path)?;
                    let content_type = entry
                        .pointer("/metadata/mimetype")
                        .or_else(|| entry.pointer("/metadata/contentType"))
                        .and_then(Value::as_str)
                        .map(ToOwned::to_owned);
                    objects.push(StorageObjectRef {
                        path: full_path,
                        content_type,
                    });
                }
            }
            if entries.len() < STORAGE_PAGE_SIZE {
                break;
            }
            offset += STORAGE_PAGE_SIZE;
        }
    }
    objects.sort_by(|left, right| left.path.cmp(&right.path));
    Ok(objects)
}

async fn download_storage_objects(
    app: &AppHandle,
    project_url: &str,
    service_role_key: &str,
    storage_root: &Path,
    objects: &[StorageObjectRef],
) -> Result<Vec<StorageObjectManifest>, String> {
    let client = reqwest::Client::new();
    let headers = storage_headers(service_role_key)?;
    let base = normalize_project_url(project_url)?;
    let mut manifest = Vec::with_capacity(objects.len());
    for (index, object) in objects.iter().enumerate() {
        emit_progress(
            app,
            "storage",
            "running",
            "画像ファイルを取得しています。",
            Some(index + 1),
            Some(objects.len()),
        );
        let destination = storage_root.join(&object.path);
        if let Some(parent) = destination.parent() {
            fs::create_dir_all(parent).map_err(|error| sanitized_error(error))?;
        }
        let bytes =
            download_storage_object_with_retry(&client, &headers, &base, &object.path).await?;
        fs::write(&destination, &bytes).map_err(|error| sanitized_error(error))?;
        manifest.push(StorageObjectManifest {
            path: object.path.clone(),
            size: bytes.len() as u64,
            sha256: sha256_bytes(&bytes),
            content_type: object.content_type.clone(),
        });
    }
    Ok(manifest)
}

async fn download_storage_object_with_retry(
    client: &reqwest::Client,
    headers: &HeaderMap,
    project_url: &str,
    object_path: &str,
) -> Result<Vec<u8>, String> {
    let url = storage_download_url(project_url, object_path)?;
    let mut last_status = None;
    for attempt in 1..=STORAGE_DOWNLOAD_ATTEMPTS {
        match client
            .get(url.clone())
            .headers(headers.clone())
            .send()
            .await
        {
            Ok(response) if response.status().is_success() => {
                return response
                    .bytes()
                    .await
                    .map(|bytes| bytes.to_vec())
                    .map_err(|error| sanitized_error(error));
            }
            Ok(response) => last_status = Some(response.status().to_string()),
            Err(_) => last_status = Some("network error".to_string()),
        }
        if attempt < STORAGE_DOWNLOAD_ATTEMPTS {
            tokio::time::sleep(std::time::Duration::from_millis(250 * attempt as u64)).await;
        }
    }
    let _ = last_status;
    Err("Storageファイルの取得に失敗しました。接続を確認してください。".to_string())
}

fn storage_download_url(project_url: &str, object_path: &str) -> Result<reqwest::Url, String> {
    validate_object_path(object_path)?;
    let mut url = reqwest::Url::parse(project_url)
        .map_err(|_| "Supabase Project URLを確認してください。".to_string())?;
    {
        let mut segments = url
            .path_segments_mut()
            .map_err(|_| "Supabase Project URLを確認してください。".to_string())?;
        segments
            .clear()
            .extend(["storage", "v1", "object", "authenticated", STORAGE_BUCKET]);
        for segment in object_path.split('/') {
            segments.push(segment);
        }
    }
    Ok(url)
}

fn validate_object_path(path: &str) -> Result<(), String> {
    let candidate = Path::new(path);
    if candidate.is_absolute()
        || candidate
            .components()
            .any(|component| !matches!(component, Component::Normal(_)))
    {
        return Err("Storage object pathが安全ではありません。".to_string());
    }
    Ok(())
}

fn write_json(path: &Path, value: &impl Serialize) -> Result<(), String> {
    let bytes = serde_json::to_vec_pretty(value).map_err(|error| sanitized_error(error))?;
    fs::write(path, bytes).map_err(|error| sanitized_error(error))
}

fn write_checksum_manifest(root: &Path, destination: &Path) -> Result<(), String> {
    let mut files = Vec::new();
    collect_files(root, root, &mut files)?;
    files.retain(|(relative, _)| relative != Path::new("verification/sha256sums.txt"));
    files.sort_by(|left, right| left.0.cmp(&right.0));
    let mut output =
        BufWriter::new(File::create(destination).map_err(|error| sanitized_error(error))?);
    for (relative, absolute) in files {
        writeln!(
            output,
            "{}  {}",
            sha256_file(&absolute)?,
            relative.to_string_lossy()
        )
        .map_err(|error| sanitized_error(error))?;
    }
    output.flush().map_err(|error| sanitized_error(error))
}

fn collect_files(
    root: &Path,
    current: &Path,
    files: &mut Vec<(PathBuf, PathBuf)>,
) -> Result<(), String> {
    for entry in fs::read_dir(current).map_err(|error| sanitized_error(error))? {
        let entry = entry.map_err(|error| sanitized_error(error))?;
        let path = entry.path();
        if path.is_dir() {
            collect_files(root, &path, files)?;
        } else if path.is_file() {
            let relative = path
                .strip_prefix(root)
                .map_err(|error| sanitized_error(error))?
                .to_path_buf();
            files.push((relative, path));
        }
    }
    Ok(())
}

fn create_tar_archive(source_root: &Path, destination: &Path) -> Result<(), String> {
    let file = File::create(destination).map_err(|error| sanitized_error(error))?;
    let mut builder = tar::Builder::new(BufWriter::new(file));
    builder
        .append_dir_all(ARCHIVE_ROOT, source_root)
        .map_err(|error| sanitized_error(error))?;
    builder.finish().map_err(|error| sanitized_error(error))
}

fn encrypt_file(input: &Path, output: &Path, identity: &x25519::Identity) -> Result<(), String> {
    let recipient = identity.to_public();
    let encryptor = Encryptor::with_recipients(std::iter::once(&recipient as &dyn age::Recipient))
        .map_err(|error| sanitized_error(error))?;
    let source = File::open(input).map_err(|error| sanitized_error(error))?;
    let destination = BufWriter::new(File::create(output).map_err(|error| sanitized_error(error))?);
    let mut writer = encryptor
        .wrap_output(destination)
        .map_err(|error| sanitized_error(error))?;
    std::io::copy(&mut BufReader::new(source), &mut writer)
        .map_err(|error| sanitized_error(error))?;
    writer.finish().map_err(|error| sanitized_error(error))?;
    Ok(())
}

fn verify_backup_file_with_identity(
    encrypted: &Path,
    identity: &x25519::Identity,
    source_label: &str,
) -> Result<BackupVerificationResult, String> {
    if !encrypted.is_file() {
        return Err("暗号化バックアップファイルを読み込めませんでした。".to_string());
    }
    let temp = tempfile::tempdir().map_err(|error| sanitized_error(error))?;
    let temp_path = temp.path().to_path_buf();
    let structure = verify_encrypted_backup(encrypted, identity, temp.path())?;
    let fingerprint = identity_fingerprint(identity);
    drop(temp);
    if temp_path.exists() {
        return Err("復号確認用の一時ファイルを削除できませんでした。".to_string());
    }
    Ok(BackupVerificationResult {
        ok: true,
        key_source: source_label.to_string(),
        key_fingerprint: fingerprint,
        database_dump_present: structure.database_dump_present,
        manifests_present: structure.manifests_present,
        storage_present: structure.storage_present,
        verification_present: structure.verification_present,
        temporary_files_removed: true,
    })
}

fn verify_encrypted_backup(
    encrypted: &Path,
    identity: &x25519::Identity,
    temp_root: &Path,
) -> Result<VerifiedBackupStructure, String> {
    let decrypted_tar = temp_root.join("verification.tar");
    let encrypted_reader =
        BufReader::new(File::open(encrypted).map_err(|error| sanitized_error(error))?);
    let decryptor =
        Decryptor::new_buffered(encrypted_reader).map_err(|error| sanitized_error(error))?;
    let mut reader = decryptor
        .decrypt(std::iter::once(identity as &dyn age::Identity))
        .map_err(|error| sanitized_error(error))?;
    let mut output =
        BufWriter::new(File::create(&decrypted_tar).map_err(|error| sanitized_error(error))?);
    std::io::copy(&mut reader, &mut output).map_err(|error| sanitized_error(error))?;
    output.flush().map_err(|error| sanitized_error(error))?;

    let extract_dir = temp_root.join("verification-extracted");
    fs::create_dir_all(&extract_dir).map_err(|error| sanitized_error(error))?;
    let mut archive = tar::Archive::new(BufReader::new(
        File::open(&decrypted_tar).map_err(|error| sanitized_error(error))?,
    ));
    archive
        .unpack(&extract_dir)
        .map_err(|error| sanitized_error(error))?;
    let root = extract_dir.join(ARCHIVE_ROOT);
    let database_dump_present = root.join("database").join(DUMP_FILE_NAME).is_file();
    let manifests_present = [
        root.join("manifests/backup.json"),
        root.join("manifests/database.json"),
        root.join("manifests/storage.json"),
    ]
    .iter()
    .all(|path| path.is_file());
    let verification_present = [
        root.join("verification/sha256sums.txt"),
        root.join("verification/backup-report.json"),
    ]
    .iter()
    .all(|path| path.is_file());
    let storage = root.join("storage");
    let storage_present = storage.is_dir();
    if storage.exists() && !storage_present {
        return Err("復号後のStorage構造が正しくありません。".to_string());
    }
    if !database_dump_present || !manifests_present || !verification_present {
        return Err("復号後の必須ファイルが不足しています。".to_string());
    }
    verify_checksum_manifest(&root, &root.join("verification/sha256sums.txt"))?;
    Ok(VerifiedBackupStructure {
        database_dump_present,
        manifests_present,
        storage_present,
        verification_present,
    })
}

fn verify_checksum_manifest(root: &Path, manifest: &Path) -> Result<(), String> {
    let reader = BufReader::new(File::open(manifest).map_err(|error| sanitized_error(error))?);
    for line in reader.lines() {
        let line = line.map_err(|error| sanitized_error(error))?;
        let (expected, relative) = line
            .split_once("  ")
            .ok_or_else(|| "checksum manifestの形式が正しくありません。".to_string())?;
        validate_object_path(relative)?;
        let file = root.join(relative);
        if !file.is_file() || sha256_file(&file)? != expected {
            return Err("バックアップの整合性確認に失敗しました。".to_string());
        }
    }
    Ok(())
}

fn copy_to_destinations(
    source: &Path,
    file_name: &str,
    settings: &BackupToolSettings,
    expected_hash: &str,
) -> Result<(PathBuf, PathBuf), String> {
    let local = Path::new(&settings.local_backup_path).join(file_name);
    let drive = Path::new(&settings.google_drive_path).join(file_name);
    let mut completed = Vec::new();
    for destination in [&local, &drive] {
        if let Err(error) = copy_atomic_verified(source, destination, expected_hash) {
            for path in completed {
                let _ = fs::remove_file(path);
            }
            let _ = fs::remove_file(destination.with_extension("age.partial"));
            return Err(error);
        }
        completed.push(destination.to_path_buf());
    }
    Ok((local, drive))
}

fn validate_storage_completion(
    expected: &[StorageObjectRef],
    downloaded: &[StorageObjectManifest],
) -> Result<(), String> {
    if expected.len() != downloaded.len() {
        return Err("Storageファイルをすべて取得できませんでした。".to_string());
    }
    for expected_object in expected {
        let Some(actual) = downloaded
            .iter()
            .find(|item| item.path == expected_object.path)
        else {
            return Err("Storageファイルをすべて取得できませんでした。".to_string());
        };
        if actual.sha256.is_empty() {
            return Err("StorageファイルのSHA-256を確認できませんでした。".to_string());
        }
    }
    Ok(())
}

fn copy_atomic_verified(
    source: &Path,
    destination: &Path,
    expected_hash: &str,
) -> Result<(), String> {
    if destination.exists() {
        return Err("同名のバックアップがすでに存在します。".to_string());
    }
    let partial = destination.with_extension("age.partial");
    if partial.exists() {
        fs::remove_file(&partial).map_err(|error| sanitized_error(error))?;
    }
    let result = (|| {
        fs::copy(source, &partial).map_err(|error| sanitized_error(error))?;
        if file_size(source)? != file_size(&partial)? || sha256_file(&partial)? != expected_hash {
            return Err("保存先コピーの整合性確認に失敗しました。".to_string());
        }
        fs::rename(&partial, destination).map_err(|error| sanitized_error(error))?;
        Ok(())
    })();
    if result.is_err() {
        let _ = fs::remove_file(&partial);
    }
    result
}

fn history_path(app: &AppHandle) -> Result<PathBuf, String> {
    app.path()
        .app_config_dir()
        .map(|path| path.join(HISTORY_FILE_NAME))
        .map_err(|error| sanitized_error(error))
}

fn read_history(app: &AppHandle) -> Result<Vec<BackupHistoryEntry>, String> {
    let path = history_path(app)?;
    if !path.exists() {
        return Ok(Vec::new());
    }
    let content = fs::read_to_string(path).map_err(|error| sanitized_error(error))?;
    serde_json::from_str(&content).map_err(|error| sanitized_error(error))
}

fn append_history(app: &AppHandle, entry: BackupHistoryEntry) -> Result<(), String> {
    let mut history = read_history(app)?;
    history.insert(0, entry);
    let path = history_path(app)?;
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent).map_err(|error| sanitized_error(error))?;
    }
    let temp = path.with_extension("json.tmp");
    write_json(&temp, &history)?;
    fs::rename(temp, path).map_err(|error| sanitized_error(error))
}

fn emit_progress(
    app: &AppHandle,
    stage: &str,
    status: &str,
    message: &str,
    current: Option<usize>,
    total: Option<usize>,
) {
    let _ = app.emit(
        PROGRESS_EVENT,
        BackupProgress {
            stage: stage.to_string(),
            status: status.to_string(),
            message: message.to_string(),
            current,
            total,
        },
    );
}

fn file_size(path: &Path) -> Result<u64, String> {
    fs::metadata(path)
        .map(|metadata| metadata.len())
        .map_err(|error| sanitized_error(error))
}

fn sha256_file(path: &Path) -> Result<String, String> {
    let mut file = BufReader::new(File::open(path).map_err(|error| sanitized_error(error))?);
    let mut hasher = Sha256::new();
    let mut buffer = [0u8; 64 * 1024];
    loop {
        let count = file
            .read(&mut buffer)
            .map_err(|error| sanitized_error(error))?;
        if count == 0 {
            break;
        }
        hasher.update(&buffer[..count]);
    }
    Ok(format!("{:x}", hasher.finalize()))
}

fn sha256_bytes(bytes: &[u8]) -> String {
    format!("{:x}", Sha256::digest(bytes))
}

fn safe_backup_error_summary(error: &str) -> String {
    let sanitized = sanitized_error(error);
    if sanitized.contains("Storage") {
        "Storageバックアップに失敗しました。".to_string()
    } else if sanitized.contains("pg_dump")
        || sanitized.contains("データベース")
        || sanitized.contains("DB")
    {
        "データベースのバックアップに失敗しました。".to_string()
    } else if sanitized.contains("保存先") || sanitized.contains("コピー") {
        "バックアップ保存先への保存に失敗しました。".to_string()
    } else {
        "バックアップ処理に失敗しました。".to_string()
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use tempfile::TempDir;

    fn test_settings(root: &Path) -> BackupToolSettings {
        BackupToolSettings {
            supabase_project_url: "https://example.supabase.co".to_string(),
            db_host: "example.pooler.supabase.com".to_string(),
            db_port: "5432".to_string(),
            db_name: "postgres".to_string(),
            db_user: "postgres.example".to_string(),
            connection_mode: super::super::ConnectionMode::Session,
            local_backup_path: root.join("local").to_string_lossy().to_string(),
            google_drive_path: root.join("drive").to_string_lossy().to_string(),
            encryption_recovery_exported: true,
            recovery_key_fingerprint: None,
            recovery_key_exported_at: None,
        }
    }

    fn create_test_backup(root: &Path, identity: &x25519::Identity) -> PathBuf {
        let source = root.join("source").join(ARCHIVE_ROOT);
        fs::create_dir_all(source.join("database")).unwrap();
        fs::create_dir_all(source.join("manifests")).unwrap();
        fs::create_dir_all(source.join("storage").join(STORAGE_BUCKET)).unwrap();
        fs::create_dir_all(source.join("verification")).unwrap();
        fs::write(source.join("database").join(DUMP_FILE_NAME), b"test dump").unwrap();
        for name in ["backup.json", "database.json", "storage.json"] {
            fs::write(source.join("manifests").join(name), b"{}").unwrap();
        }
        fs::write(source.join("verification/backup-report.json"), b"{}").unwrap();
        write_checksum_manifest(&source, &source.join("verification/sha256sums.txt")).unwrap();
        let archive = root.join("test.tar");
        create_tar_archive(&source, &archive).unwrap();
        let encrypted = root.join("test.tar.age");
        encrypt_file(&archive, &encrypted, identity).unwrap();
        encrypted
    }

    #[test]
    fn age_round_trip_and_wrong_key_failure() {
        let temp = TempDir::new().unwrap();
        let input = temp.path().join("input.tar");
        let encrypted = temp.path().join("input.tar.age");
        fs::write(&input, b"backup contents").unwrap();
        let identity = x25519::Identity::generate();
        encrypt_file(&input, &encrypted, &identity).unwrap();
        let ciphertext = fs::read(&encrypted).unwrap();
        assert_eq!(
            age::decrypt(&identity, &ciphertext).unwrap(),
            b"backup contents"
        );
        assert!(age::decrypt(&x25519::Identity::generate(), &ciphertext).is_err());
    }

    #[test]
    fn valid_recovery_key_imports_and_invalid_key_is_rejected() {
        let identity = x25519::Identity::generate();
        let recovery = format!("# recovery key\n{}\n", identity.to_string().expose_secret());
        let imported = parse_recovery_identity(&recovery).unwrap();
        assert_eq!(
            identity_fingerprint(&imported),
            identity_fingerprint(&identity)
        );
        assert!(parse_recovery_identity("not-a-recovery-key").is_err());
        assert!(parse_recovery_identity("AGE-SECRET-KEY-INVALID").is_err());
    }

    #[test]
    fn recovery_key_fingerprint_detects_match_and_mismatch() {
        let first = x25519::Identity::generate();
        let same = x25519::Identity::from_str(first.to_string().expose_secret()).unwrap();
        let other = x25519::Identity::generate();
        assert_eq!(identity_fingerprint(&first), identity_fingerprint(&same));
        assert_ne!(identity_fingerprint(&first), identity_fingerprint(&other));
    }

    #[test]
    fn recovery_key_registration_writes_and_reads_back_the_same_identity() {
        use std::cell::RefCell;

        let identity = x25519::Identity::generate();
        let stored = RefCell::new(None::<String>);
        persist_and_verify_identity(
            &identity,
            |encoded| {
                stored.replace(Some(encoded.to_string()));
                Ok(())
            },
            || {
                let encoded = stored.borrow();
                x25519::Identity::from_str(encoded.as_deref().unwrap())
                    .map_err(|_| "test credential could not be parsed".to_string())
            },
        )
        .unwrap();

        let other = x25519::Identity::generate();
        assert!(persist_and_verify_identity(&identity, |_| Ok(()), || Ok(other)).is_err());
    }

    #[test]
    fn recovery_export_metadata_must_match_the_current_key() {
        let temp = TempDir::new().unwrap();
        let mut settings = test_settings(temp.path());
        settings.recovery_key_fingerprint = Some("current-fingerprint".to_string());
        settings.recovery_key_exported_at = Some("2026-08-25T12:00:00Z".to_string());
        assert!(recovery_metadata_matches(
            &settings,
            Some("current-fingerprint")
        ));
        assert!(!recovery_metadata_matches(
            &settings,
            Some("other-fingerprint")
        ));
        settings.recovery_key_exported_at = None;
        assert!(!recovery_metadata_matches(
            &settings,
            Some("current-fingerprint")
        ));
    }

    #[test]
    fn keychain_or_recovery_identity_can_verify_backup_and_wrong_key_fails() {
        let temp = TempDir::new().unwrap();
        let identity = x25519::Identity::generate();
        let recovery = x25519::Identity::from_str(identity.to_string().expose_secret()).unwrap();
        let encrypted = create_test_backup(temp.path(), &identity);

        let keychain_result =
            verify_backup_file_with_identity(&encrypted, &identity, "Keychain").unwrap();
        assert!(keychain_result.ok);
        assert!(keychain_result.temporary_files_removed);
        assert!(keychain_result.database_dump_present);
        assert!(keychain_result.manifests_present);
        assert!(keychain_result.storage_present);
        assert!(keychain_result.verification_present);

        let recovery_result =
            verify_backup_file_with_identity(&encrypted, &recovery, "復旧鍵").unwrap();
        assert!(recovery_result.ok);
        assert!(verify_backup_file_with_identity(
            &encrypted,
            &x25519::Identity::generate(),
            "復旧鍵",
        )
        .is_err());
    }

    #[test]
    fn checksum_manifest_detects_tampering() {
        let temp = TempDir::new().unwrap();
        let root = temp.path().join("root");
        fs::create_dir_all(root.join("verification")).unwrap();
        fs::write(root.join("data.txt"), b"original").unwrap();
        let manifest = root.join("verification/sha256sums.txt");
        write_checksum_manifest(&root, &manifest).unwrap();
        assert!(verify_checksum_manifest(&root, &manifest).is_ok());
        fs::write(root.join("data.txt"), b"changed").unwrap();
        assert!(verify_checksum_manifest(&root, &manifest).is_err());
    }

    #[test]
    fn storage_paths_reject_traversal() {
        assert!(validate_object_path("customers/image.webp").is_ok());
        assert!(validate_object_path("../secret").is_err());
        assert!(validate_object_path("/absolute").is_err());
    }

    #[test]
    fn storage_zero_objects_is_a_complete_backup() {
        assert!(validate_storage_completion(&[], &[]).is_ok());
    }

    #[test]
    fn storage_multiple_objects_require_every_path_and_hash() {
        let expected = vec![
            StorageObjectRef {
                path: "manual/a.jpg".to_string(),
                content_type: Some("image/jpeg".to_string()),
            },
            StorageObjectRef {
                path: "scheduled/b.webp".to_string(),
                content_type: Some("image/webp".to_string()),
            },
        ];
        let downloaded = vec![
            StorageObjectManifest {
                path: "manual/a.jpg".to_string(),
                size: 10,
                sha256: "aaa".to_string(),
                content_type: Some("image/jpeg".to_string()),
            },
            StorageObjectManifest {
                path: "scheduled/b.webp".to_string(),
                size: 20,
                sha256: "bbb".to_string(),
                content_type: Some("image/webp".to_string()),
            },
        ];
        assert!(validate_storage_completion(&expected, &downloaded).is_ok());
    }

    #[test]
    fn storage_midway_failure_is_not_complete() {
        let expected = vec![
            StorageObjectRef {
                path: "manual/a.jpg".to_string(),
                content_type: None,
            },
            StorageObjectRef {
                path: "manual/b.jpg".to_string(),
                content_type: None,
            },
        ];
        let downloaded = vec![StorageObjectManifest {
            path: "manual/a.jpg".to_string(),
            size: 10,
            sha256: "aaa".to_string(),
            content_type: None,
        }];
        assert!(validate_storage_completion(&expected, &downloaded).is_err());
    }

    #[test]
    fn verified_copy_is_atomic_and_has_no_partial_file() {
        let temp = TempDir::new().unwrap();
        let source = temp.path().join("source.age");
        let destination = temp.path().join("destination.age");
        fs::write(&source, b"encrypted").unwrap();
        let hash = sha256_file(&source).unwrap();
        copy_atomic_verified(&source, &destination, &hash).unwrap();
        assert_eq!(fs::read(&destination).unwrap(), b"encrypted");
        assert!(!temp.path().join("destination.age.partial").exists());
    }

    #[test]
    fn copy_failure_does_not_publish_partial_backup() {
        let temp = TempDir::new().unwrap();
        let source = temp.path().join("source.age");
        let destination = temp.path().join("destination.age");
        fs::write(&source, b"encrypted").unwrap();
        assert!(copy_atomic_verified(&source, &destination, "incorrect").is_err());
        assert!(!destination.exists());
        assert!(!temp.path().join("destination.age.partial").exists());
    }

    #[test]
    fn drive_copy_failure_rolls_back_local_copy() {
        let temp = TempDir::new().unwrap();
        let source = temp.path().join("source.age");
        fs::write(&source, b"encrypted").unwrap();
        fs::create_dir_all(temp.path().join("local")).unwrap();
        let mut settings = test_settings(temp.path());
        settings.google_drive_path = temp
            .path()
            .join("missing-drive")
            .to_string_lossy()
            .to_string();
        let hash = sha256_file(&source).unwrap();
        assert!(copy_to_destinations(&source, "backup.age", &settings, &hash).is_err());
        assert!(!temp.path().join("local/backup.age").exists());
    }

    #[test]
    fn temporary_plaintext_is_removed_when_tempdir_drops() {
        let path = {
            let temp = TempDir::new().unwrap();
            let path = temp.path().join("public.dump");
            fs::write(&path, b"plaintext").unwrap();
            path
        };
        assert!(!path.exists());
    }

    #[test]
    fn failure_history_summary_never_contains_original_detail() {
        let summary = safe_backup_error_summary("password=super-secret pg_dump failed");
        assert_eq!(summary, "バックアップ処理に失敗しました。");
        assert!(!summary.contains("super-secret"));
    }

    #[test]
    fn backup_guard_prevents_double_execution() {
        BACKUP_RUNNING.store(false, Ordering::SeqCst);
        let first = BackupRunGuard::acquire().unwrap();
        assert!(BackupRunGuard::acquire().is_err());
        drop(first);
        assert!(BackupRunGuard::acquire().is_ok());
        BACKUP_RUNNING.store(false, Ordering::SeqCst);
    }

    #[test]
    fn recovery_key_cannot_be_written_into_backup_destinations() {
        let temp = TempDir::new().unwrap();
        fs::create_dir_all(temp.path().join("local")).unwrap();
        fs::create_dir_all(temp.path().join("drive")).unwrap();
        let settings = test_settings(temp.path());
        assert!(
            validate_recovery_destination(&temp.path().join("local/key.txt"), &settings).is_err()
        );
        assert!(
            validate_recovery_destination(&temp.path().join("recovery.txt"), &settings).is_ok()
        );
    }

    #[test]
    fn manifest_serialization_contains_no_database_credentials() {
        let manifest = DatabaseManifest {
            created_at: "2026-08-25T00:00:00Z".to_string(),
            postgres_version: "PostgreSQL 17".to_string(),
            connection_mode: "Session pooler".to_string(),
            schema: "public".to_string(),
            dump_file: "database/public.dump".to_string(),
            dump_format: "PostgreSQL custom".to_string(),
            dump_size: 1,
            dump_sha256: "abc".to_string(),
            public_table_count: 10,
            pg_dump_version: "pg_dump 17".to_string(),
        };
        let serialized = serde_json::to_string(&manifest).unwrap();
        assert!(!serialized.contains("password"));
        assert!(!serialized.contains("service_role"));
        assert!(!serialized.contains("db_user"));
    }

    #[cfg(unix)]
    #[test]
    fn fake_pg_dump_success_and_failure_are_handled() {
        use std::os::unix::fs::PermissionsExt;
        let temp = TempDir::new().unwrap();
        fs::create_dir_all(temp.path().join("local")).unwrap();
        fs::create_dir_all(temp.path().join("drive")).unwrap();
        let settings = test_settings(temp.path());
        let ca = temp.path().join("ca.crt");
        fs::write(&ca, b"ca").unwrap();

        let success = temp.path().join("pg_dump-success");
        fs::write(&success, "#!/bin/sh\nwhile [ $# -gt 0 ]; do if [ \"$1\" = \"--file\" ]; then shift; printf dump > \"$1\"; fi; shift; done\n").unwrap();
        fs::set_permissions(&success, fs::Permissions::from_mode(0o755)).unwrap();
        let dump = temp.path().join("success.dump");
        assert!(run_pg_dump_process(&success, &settings, "secret", &ca, &dump).is_ok());

        let failure = temp.path().join("pg_dump-failure");
        fs::write(&failure, "#!/bin/sh\nexit 1\n").unwrap();
        fs::set_permissions(&failure, fs::Permissions::from_mode(0o755)).unwrap();
        assert!(run_pg_dump_process(
            &failure,
            &settings,
            "secret",
            &ca,
            &temp.path().join("fail.dump")
        )
        .is_err());
    }
}
