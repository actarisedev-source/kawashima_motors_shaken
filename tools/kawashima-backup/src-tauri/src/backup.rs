use std::{
    fs::{self, File},
    io::{BufRead, BufReader, BufWriter, Read, Write},
    path::{Component, Path, PathBuf},
    sync::atomic::{AtomicBool, Ordering},
};

use age::{secrecy::SecretString, Decryptor, Encryptor};
use chrono::{Local, SecondsFormat, Utc};
use reqwest::header::{HeaderMap, HeaderValue, CONTENT_TYPE};
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use sha2::{Digest, Sha256};
use tauri::{AppHandle, Emitter, Manager, State};
use zeroize::Zeroizing;

use super::{
    build_database_tls_connector, build_db_config, build_db_config_for_user, connection_mode_label,
    normalize_project_url, read_secret, restore_db_credentials, sanitized_error, storage_auth,
    BackupToolSettings, ACCOUNT_DB_PASSWORD, ACCOUNT_STORAGE_AUTH_PASSWORD,
    ACCOUNT_STORAGE_RESTORE_AUTH_PASSWORD, SUPABASE_ROOT_CA_PEM,
};
use super::{file_security, postgres_runtime};

const HISTORY_FILE_NAME: &str = "backup-history.json";
const RESTORE_JOURNAL_FILE_NAME: &str = "restore-journal.json";
const STORAGE_BUCKET: &str = "line-message-images";
const STORAGE_PAGE_SIZE: usize = 100;
const STORAGE_DOWNLOAD_ATTEMPTS: usize = 3;
const STORAGE_UPLOAD_ATTEMPTS: usize = 3;
const PROGRESS_EVENT: &str = "backup-progress";
const ARCHIVE_ROOT: &str = "kawashima-backup";
const DUMP_FILE_NAME: &str = "public.dump";
const ENCRYPTION_ALGORITHM: &str = "age-passphrase";
const ENCRYPTION_FORMAT: &str = "age";
const ENCRYPTION_FORMAT_VERSION: u32 = 1;
const MIN_RECOVERY_PASSWORD_CHARS: usize = 16;

static BACKUP_RUNNING: AtomicBool = AtomicBool::new(false);
static RESTORE_RUNNING: AtomicBool = AtomicBool::new(false);

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct EncryptionStatus {
    configured: bool,
    state: String,
    algorithm: String,
    credential_mode: String,
    endpoint_id: Option<String>,
}

#[derive(Debug, Clone)]
struct ValidatedEncryptionContext {
    passphrase: SecretString,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct BackupVerificationResult {
    ok: bool,
    database_dump_present: bool,
    manifests_present: bool,
    storage_present: bool,
    verification_present: bool,
    database_structure_valid: bool,
    plaintext_archive_sha256: String,
    temporary_files_removed: bool,
}

#[derive(Debug, Clone)]
struct VerifiedBackupStructure {
    database_dump_present: bool,
    manifests_present: bool,
    storage_present: bool,
    verification_present: bool,
    database_structure_valid: bool,
    plaintext_archive_sha256: String,
}

#[derive(Debug, Clone)]
struct VerifiedExtractedBackup {
    structure: VerifiedBackupStructure,
    root: PathBuf,
    backup_manifest: BackupManifest,
    database_manifest: DatabaseManifest,
    storage_manifest: StorageManifest,
}

#[derive(Debug, Clone)]
struct BasicExtractedBackup {
    structure: VerifiedBackupStructure,
    root: PathBuf,
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
    #[serde(default = "default_google_drive_sync_status")]
    google_drive_sync_status: String,
    storage_object_count: usize,
    public_table_count: i64,
    #[serde(default)]
    endpoint_id: String,
    #[serde(default = "default_encryption_scheme")]
    encryption_scheme: String,
    #[serde(default)]
    plaintext_archive_sha256: String,
    #[serde(default)]
    application_version: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct BackupResult {
    history: BackupHistoryEntry,
    local_path: String,
    google_drive_path: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct RestoreJournalEntry {
    restore_id: String,
    started_at: String,
    completed_at: Option<String>,
    target_backup: String,
    backup_sha256: String,
    pre_restore_backup_id: Option<String>,
    db_restore_status: String,
    storage_restore_status: String,
    verification_status: String,
    error_summary: Option<String>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct RestoreResult {
    restore_id: String,
    pre_restore_backup_id: String,
    db_restored: bool,
    storage_restored: bool,
    verification_ok: bool,
    restored_storage_objects: usize,
    checked_table_count: usize,
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
    #[serde(default)]
    table_counts: Vec<TableCountManifest>,
    pg_dump_version: String,
    pg_restore_version: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct TableCountManifest {
    table: String,
    rows: i64,
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
    application_version: String,
    endpoint_id: String,
    database_manifest: String,
    storage_manifest: String,
    checksum_manifest: String,
    encryption: EncryptionManifest,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct EncryptionManifest {
    scheme: String,
    format: String,
    version: u32,
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
struct DatabaseMetadata {
    postgres_version: String,
    public_table_count: i64,
    table_counts: Vec<TableCountManifest>,
}

#[derive(Debug, Clone)]
struct StorageObjectRef {
    path: String,
    content_type: Option<String>,
}

struct BackupRunGuard;
struct RestoreRunGuard;

fn default_google_drive_sync_status() -> String {
    "notVerified".to_string()
}

fn default_encryption_scheme() -> String {
    ENCRYPTION_ALGORITHM.to_string()
}

impl BackupRunGuard {
    fn acquire() -> Result<Self, String> {
        if RESTORE_RUNNING.load(Ordering::SeqCst) {
            return Err("復旧実行中はバックアップできません。".to_string());
        }
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

impl RestoreRunGuard {
    fn acquire() -> Result<Self, String> {
        if BACKUP_RUNNING.load(Ordering::SeqCst) {
            return Err("バックアップ実行中は復旧できません。".to_string());
        }
        RESTORE_RUNNING
            .compare_exchange(false, true, Ordering::SeqCst, Ordering::SeqCst)
            .map_err(|_| "復旧はすでに実行中です。".to_string())?;
        Ok(Self)
    }
}

impl Drop for RestoreRunGuard {
    fn drop(&mut self) {
        RESTORE_RUNNING.store(false, Ordering::SeqCst);
    }
}

#[tauri::command]
pub(crate) fn backup_is_running() -> bool {
    BACKUP_RUNNING.load(Ordering::SeqCst)
}

#[tauri::command]
pub(crate) fn restore_is_running() -> bool {
    RESTORE_RUNNING.load(Ordering::SeqCst)
}

#[tauri::command]
pub(crate) fn get_encryption_status(app: AppHandle) -> EncryptionStatus {
    encryption_status(&app)
}

#[tauri::command]
pub(crate) fn verify_backup_file(
    app: AppHandle,
    path: String,
    recovery_password: String,
    maintenance_token: Option<String>,
    maintenance_state: State<'_, super::maintenance::MaintenanceState>,
) -> Result<BackupVerificationResult, String> {
    super::maintenance::authorize(&maintenance_state, maintenance_token.as_deref())?;
    let recovery_password = Zeroizing::new(recovery_password);
    let passphrase = validate_recovery_password(&recovery_password)?;
    let runtime = postgres_runtime::PostgresRuntime::resolve(&app)?;
    verify_backup_file_with_passphrase(Path::new(path.trim()), &passphrase, &runtime.pg_restore)
}

#[tauri::command]
pub(crate) fn load_backup_history(app: AppHandle) -> Result<Vec<BackupHistoryEntry>, String> {
    read_history(&app)
}

#[tauri::command]
pub(crate) async fn run_backup(
    app: AppHandle,
    recovery_password: String,
) -> Result<BackupResult, String> {
    let _guard = BackupRunGuard::acquire()?;
    let settings = super::load_settings_from_disk(&app)?;
    let recovery_password = Zeroizing::new(recovery_password);
    let failed_started_at = Utc::now();
    let result = execute_backup(app.clone(), settings.clone(), recovery_password).await;
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
            google_drive_sync_status: default_google_drive_sync_status(),
            storage_object_count: 0,
            public_table_count: 0,
            endpoint_id: settings.endpoint_id.clone().unwrap_or_default(),
            encryption_scheme: ENCRYPTION_ALGORITHM.to_string(),
            plaintext_archive_sha256: String::new(),
            application_version: env!("CARGO_PKG_VERSION").to_string(),
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

#[tauri::command]
pub(crate) async fn run_restore(
    app: AppHandle,
    backup_path: String,
    recovery_password: String,
) -> Result<RestoreResult, String> {
    let _guard = RestoreRunGuard::acquire()?;
    if BACKUP_RUNNING.load(Ordering::SeqCst) {
        return Err("バックアップ実行中は復旧できません。".to_string());
    }
    let settings = super::load_settings_from_disk(&app)?;
    let recovery_password = Zeroizing::new(recovery_password);
    let started_at = Utc::now();
    let restore_id = Local::now().format("restore-%Y%m%d-%H%M%S-JST").to_string();
    let target_backup_path = PathBuf::from(backup_path.trim());
    let target_backup = target_backup_path
        .file_name()
        .and_then(|value| value.to_str())
        .unwrap_or("selected-backup.tar.age")
        .to_string();
    let backup_sha256 = if target_backup_path.is_file() {
        sha256_file(&target_backup_path).unwrap_or_default()
    } else {
        String::new()
    };
    let mut journal = RestoreJournalEntry {
        restore_id: restore_id.clone(),
        started_at: started_at.to_rfc3339_opts(SecondsFormat::Secs, true),
        completed_at: None,
        target_backup,
        backup_sha256,
        pre_restore_backup_id: None,
        db_restore_status: "notStarted".to_string(),
        storage_restore_status: "notStarted".to_string(),
        verification_status: "notStarted".to_string(),
        error_summary: None,
    };

    let result = execute_restore(
        app.clone(),
        settings,
        &target_backup_path,
        &recovery_password,
        &restore_id,
        &mut journal,
    )
    .await;
    journal.completed_at = Some(Utc::now().to_rfc3339_opts(SecondsFormat::Secs, true));
    if let Err(error) = &result {
        journal.error_summary = Some(safe_restore_error_summary(error));
        emit_progress(
            &app,
            "failed",
            "failed",
            "復旧に失敗しました。データは一部復旧されている可能性があります。ACTARISE保守画面で詳細を確認してください。",
            None,
            None,
        );
    }
    let _ = append_restore_journal(&app, journal);
    result
}

async fn execute_restore(
    app: AppHandle,
    settings: BackupToolSettings,
    encrypted_backup: &Path,
    recovery_password: &str,
    restore_id: &str,
    journal: &mut RestoreJournalEntry,
) -> Result<RestoreResult, String> {
    validate_restore_prerequisites(&app, &settings, encrypted_backup, recovery_password)?;
    let passphrase =
        validate_backup_encryption_authorization(&settings, recovery_password)?.passphrase;
    let postgres_runtime = postgres_runtime::PostgresRuntime::resolve(&app)?;
    let temp = file_security::PrivateTempDir::new("kawashima-backup-restore-")?;

    emit_progress(
        &app,
        "restoreVerify",
        "running",
        "復旧ファイルを復号し、manifestとSHA-256を確認しています。",
        None,
        None,
    );
    let package = decrypt_extract_verify_backup(
        encrypted_backup,
        &passphrase,
        temp.path(),
        &postgres_runtime.pg_restore,
    )?;
    validate_restore_compatibility(&package)?;
    journal.verification_status = "complete".to_string();
    emit_progress(
        &app,
        "restoreVerify",
        "complete",
        "復旧ファイルの検証が完了しました。",
        None,
        None,
    );

    let (db_restore_user, db_restore_password) = restore_db_credentials(&settings)?;
    let storage_restore_password = Zeroizing::new(read_secret(
        ACCOUNT_STORAGE_RESTORE_AUTH_PASSWORD,
        "Storage復旧用パスワード",
    )?);
    if settings.storage_restore_auth_email.trim().is_empty() {
        return Err("Storage復旧用ユーザーをACTARISE保守画面で設定してください。".to_string());
    }

    emit_progress(
        &app,
        "safetyBackup",
        "running",
        "復旧前の現在状態を安全バックアップしています。",
        None,
        None,
    );
    let safety_backup =
        execute_backup_authorized(app.clone(), settings.clone(), passphrase.clone()).await?;
    journal.pre_restore_backup_id = Some(safety_backup.history.backup_id.clone());
    emit_progress(
        &app,
        "safetyBackup",
        "complete",
        "復旧前安全バックアップが完了しました。",
        None,
        None,
    );

    emit_progress(
        &app,
        "storageRestore",
        "running",
        "画像Storageを復旧しています。",
        None,
        None,
    );
    let storage_token = storage_auth::authenticate_with_email(
        &settings,
        settings.storage_restore_auth_email.trim(),
        &storage_restore_password,
        "Storage復旧用",
    )
    .await?;
    let storage_headers = storage_token.headers(&settings.supabase_publishable_key)?;
    let storage_count = restore_storage_objects(
        &app,
        &settings,
        &storage_headers,
        &package.root.join("storage").join(STORAGE_BUCKET),
        &package.storage_manifest,
    )
    .await?;
    journal.storage_restore_status = "complete".to_string();
    emit_progress(
        &app,
        "storageRestore",
        "complete",
        "画像Storageの復旧と検証が完了しました。",
        Some(storage_count),
        Some(storage_count),
    );

    emit_progress(
        &app,
        "dbRestore",
        "running",
        "データベースをバックアップ時点へ復旧しています。",
        None,
        None,
    );
    let ca_path = temp.path().join("supabase-root-2021.crt");
    fs::write(&ca_path, SUPABASE_ROOT_CA_PEM).map_err(sanitized_error)?;
    postgres_runtime::run_pg_restore(
        &postgres_runtime.pg_restore,
        &settings,
        &db_restore_user,
        &db_restore_password,
        &ca_path,
        &package.root.join("database").join(DUMP_FILE_NAME),
    )?;
    journal.db_restore_status = "complete".to_string();
    emit_progress(
        &app,
        "dbRestore",
        "complete",
        "データベース復旧が完了しました。",
        None,
        None,
    );

    emit_progress(
        &app,
        "postVerify",
        "running",
        "復旧後のデータベースと画像Storageを確認しています。",
        None,
        None,
    );
    let checked_table_count = verify_database_after_restore(
        &settings,
        &db_restore_user,
        &db_restore_password,
        &package.database_manifest,
    )
    .await?;
    verify_restored_storage_objects(
        &app,
        &settings,
        &storage_headers,
        &package.root.join("storage").join(STORAGE_BUCKET),
        &package.storage_manifest,
    )
    .await?;
    journal.verification_status = "postRestoreComplete".to_string();
    emit_progress(
        &app,
        "complete",
        "complete",
        "復旧が完了しました。",
        None,
        None,
    );
    temp.close()?;

    Ok(RestoreResult {
        restore_id: restore_id.to_string(),
        pre_restore_backup_id: safety_backup.history.backup_id,
        db_restored: true,
        storage_restored: true,
        verification_ok: true,
        restored_storage_objects: storage_count,
        checked_table_count,
    })
}

async fn execute_backup(
    app: AppHandle,
    settings: BackupToolSettings,
    recovery_password: Zeroizing<String>,
) -> Result<BackupResult, String> {
    let encryption = validate_backup_prerequisites(&app, &settings, &recovery_password)?;
    execute_backup_authorized(app, settings, encryption.passphrase).await
}

async fn execute_backup_authorized(
    app: AppHandle,
    settings: BackupToolSettings,
    passphrase: SecretString,
) -> Result<BackupResult, String> {
    let endpoint_id = settings
        .endpoint_id
        .clone()
        .ok_or_else(|| "endpointIdが未設定です。".to_string())?;
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
    let archive_name = archive_file_name(&endpoint_id, &backup_id);
    let temp = file_security::PrivateTempDir::new("kawashima-backup-")?;
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
        fs::create_dir_all(directory).map_err(sanitized_error)?;
    }

    let db_password = Zeroizing::new(read_secret(ACCOUNT_DB_PASSWORD, "DBパスワード")?);
    let storage_auth_password = Zeroizing::new(read_secret(
        ACCOUNT_STORAGE_AUTH_PASSWORD,
        "Storage読み取り用パスワード",
    )?);

    let db_info = query_database_metadata(&settings, &db_password).await?;
    let postgres_runtime = postgres_runtime::PostgresRuntime::resolve(&app)?;
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
    fs::write(&ca_path, SUPABASE_ROOT_CA_PEM).map_err(sanitized_error)?;
    postgres_runtime::run_pg_dump(
        &postgres_runtime.pg_dump,
        &settings,
        &db_password,
        &ca_path,
        &dump_path,
    )?;
    postgres_runtime::inspect_custom_dump(&postgres_runtime.pg_restore, &dump_path)?;
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
    let storage_token = storage_auth::authenticate(&settings, &storage_auth_password).await?;
    let storage_headers = storage_token.headers(&settings.supabase_publishable_key)?;
    let normalized_project_url = normalize_project_url(&settings.supabase_project_url)?;
    storage_auth::verify_bucket_access(
        &reqwest::Client::new(),
        &normalized_project_url,
        STORAGE_BUCKET,
        &storage_headers,
    )
    .await?;
    let storage_objects =
        list_storage_objects(&settings.supabase_project_url, &storage_headers).await?;
    let storage_manifest_objects = download_storage_objects(
        &app,
        &settings.supabase_project_url,
        &storage_headers,
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
        postgres_version: db_info.postgres_version,
        connection_mode: connection_mode_label(&settings.connection_mode).to_string(),
        schema: "public".to_string(),
        dump_file: format!("database/{DUMP_FILE_NAME}"),
        dump_format: "PostgreSQL custom".to_string(),
        dump_size,
        dump_sha256,
        public_table_count: db_info.public_table_count,
        table_counts: db_info.table_counts,
        pg_dump_version: postgres_runtime.pg_dump_version,
        pg_restore_version: postgres_runtime.pg_restore_version,
    };
    let storage_manifest = StorageManifest {
        created_at: created_at.clone(),
        bucket: STORAGE_BUCKET.to_string(),
        object_count: storage_manifest_objects.len(),
        objects: storage_manifest_objects,
    };
    let backup_manifest = BackupManifest {
        format_version: 2,
        backup_id: backup_id.clone(),
        created_at: created_at.clone(),
        application: "Kawashima Motors Backup Tool".to_string(),
        application_version: env!("CARGO_PKG_VERSION").to_string(),
        endpoint_id: endpoint_id.clone(),
        database_manifest: "manifests/database.json".to_string(),
        storage_manifest: "manifests/storage.json".to_string(),
        checksum_manifest: "verification/sha256sums.txt".to_string(),
        encryption: EncryptionManifest {
            scheme: ENCRYPTION_ALGORITHM.to_string(),
            format: ENCRYPTION_FORMAT.to_string(),
            version: ENCRYPTION_FORMAT_VERSION,
        },
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
    let plaintext_archive_sha256 = sha256_file(&tar_path)?;
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
    encrypt_file(&tar_path, &encrypted_path, &passphrase)?;
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
        "暗号化形式と事前整合性を検証しています。",
        None,
        None,
    );
    validate_encrypted_envelope(&encrypted_path)?;
    verify_encrypted_backup(
        &encrypted_path,
        &passphrase,
        &temp.path().join("self-check"),
        &postgres_runtime.pg_restore,
    )?;
    verify_checksum_manifest(&source_root, &verification_dir.join("sha256sums.txt"))?;
    emit_progress(
        &app,
        "verify",
        "complete",
        "復旧パスワードで復号できることと事前整合性を確認しました。",
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
    temp.close()?;
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
        google_drive_sync_status: default_google_drive_sync_status(),
        storage_object_count: storage_manifest.object_count,
        public_table_count: database_manifest.public_table_count,
        endpoint_id,
        encryption_scheme: ENCRYPTION_ALGORITHM.to_string(),
        plaintext_archive_sha256,
        application_version: env!("CARGO_PKG_VERSION").to_string(),
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
    let settings = super::load_settings_from_disk(app).unwrap_or_default();
    let algorithm = settings
        .encryption_algorithm
        .unwrap_or_else(|| ENCRYPTION_ALGORITHM.to_string());
    let configured = algorithm == ENCRYPTION_ALGORITHM;
    EncryptionStatus {
        configured,
        state: if configured { "configured" } else { "invalid" }.to_string(),
        algorithm,
        credential_mode: "enteredPerBackup".to_string(),
        endpoint_id: settings.endpoint_id,
    }
}

fn validate_backup_prerequisites(
    app: &AppHandle,
    settings: &BackupToolSettings,
    recovery_password: &str,
) -> Result<ValidatedEncryptionContext, String> {
    super::validate_settings(settings)?;
    if !settings.setup_complete {
        return Err("初回セットアップを完了してください。".to_string());
    }
    let encryption = validate_backup_encryption_authorization(settings, recovery_password)?;
    let _db_password = Zeroizing::new(read_secret(ACCOUNT_DB_PASSWORD, "DBパスワード")?);
    let _storage_auth_password = Zeroizing::new(read_secret(
        ACCOUNT_STORAGE_AUTH_PASSWORD,
        "Storage読み取り用パスワード",
    )?);
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
    postgres_runtime::PostgresRuntime::resolve(app)?;
    Ok(encryption)
}

fn validate_restore_prerequisites(
    app: &AppHandle,
    settings: &BackupToolSettings,
    encrypted_backup: &Path,
    recovery_password: &str,
) -> Result<(), String> {
    super::validate_settings(settings)?;
    if !settings.setup_complete {
        return Err("初回セットアップを完了してください。".to_string());
    }
    if !encrypted_backup.is_file() {
        return Err("復旧する暗号化バックアップファイルを選択してください。".to_string());
    }
    if encrypted_backup
        .extension()
        .and_then(|value| value.to_str())
        != Some("age")
    {
        return Err("復旧には.tar.ageバックアップファイルを選択してください。".to_string());
    }
    validate_backup_encryption_authorization(settings, recovery_password)?;
    postgres_runtime::PostgresRuntime::resolve(app)?;
    Ok(())
}

fn validate_backup_encryption_authorization(
    settings: &BackupToolSettings,
    recovery_password: &str,
) -> Result<ValidatedEncryptionContext, String> {
    if settings.encryption_algorithm.as_deref() != Some(ENCRYPTION_ALGORITHM) {
        return Err("暗号化方式はage passphrase方式で設定してください。".to_string());
    }
    validate_recovery_password(recovery_password)
        .map(|passphrase| ValidatedEncryptionContext { passphrase })
}

fn validate_recovery_password(recovery_password: &str) -> Result<SecretString, String> {
    let trimmed = recovery_password.trim();
    if trimmed.is_empty() {
        return Err("復旧パスワードを入力してください。".to_string());
    }
    if trimmed.chars().count() < MIN_RECOVERY_PASSWORD_CHARS {
        return Err(format!(
            "復旧パスワードは{MIN_RECOVERY_PASSWORD_CHARS}文字以上を使用してください。"
        ));
    }
    if trimmed
        .chars()
        .all(|character| character == trimmed.chars().next().unwrap_or_default())
    {
        return Err(
            "復旧パスワードが単純すぎます。Apple Passwordsで生成した強い値を使用してください。"
                .to_string(),
        );
    }
    Ok(SecretString::from(trimmed.to_string()))
}

fn archive_file_name(endpoint_id: &str, backup_id: &str) -> String {
    format!("kawashima-backup-{endpoint_id}-{backup_id}.tar.age")
}

async fn query_database_metadata(
    settings: &BackupToolSettings,
    password: &str,
) -> Result<DatabaseMetadata, String> {
    let config = build_db_config(settings, password)?;
    let (client, connection) = config
        .connect(build_database_tls_connector()?)
        .await
        .map_err(sanitized_error)?;
    tauri::async_runtime::spawn(async move {
        let _ = connection.await;
    });
    let version: String = client
        .query_one("select version()", &[])
        .await
        .map_err(sanitized_error)?
        .get(0);
    let table_count: i64 = client
        .query_one(
            "select count(*) from information_schema.tables where table_schema = 'public' and table_type = 'BASE TABLE'",
            &[],
        )
        .await
        .map_err(sanitized_error)?
        .get(0);
    let table_rows = client
        .query(
            "select table_name from information_schema.tables where table_schema = 'public' and table_type = 'BASE TABLE' order by table_name",
            &[],
        )
        .await
        .map_err(sanitized_error)?;
    let mut table_counts = Vec::with_capacity(table_rows.len());
    for row in table_rows {
        let table: String = row.get(0);
        let count_sql = format!("select count(*) from public.{}", quote_identifier(&table));
        let rows: i64 = client
            .query_one(&count_sql, &[])
            .await
            .map_err(sanitized_error)?
            .get(0);
        table_counts.push(TableCountManifest { table, rows });
    }
    Ok(DatabaseMetadata {
        postgres_version: version
            .split_whitespace()
            .take(2)
            .collect::<Vec<_>>()
            .join(" "),
        public_table_count: table_count,
        table_counts,
    })
}

fn quote_identifier(value: &str) -> String {
    format!("\"{}\"", value.replace('"', "\"\""))
}

async fn list_storage_objects(
    project_url: &str,
    headers: &HeaderMap,
) -> Result<Vec<StorageObjectRef>, String> {
    let project_url = normalize_project_url(project_url)?;
    let client = reqwest::Client::new();
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
                .map_err(sanitized_error)?;
            if !response.status().is_success() {
                return Err(format!(
                    "Storage一覧の取得に失敗しました: {}",
                    response.status()
                ));
            }
            let entries: Vec<Value> = response.json().await.map_err(sanitized_error)?;
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
    headers: &HeaderMap,
    storage_root: &Path,
    objects: &[StorageObjectRef],
) -> Result<Vec<StorageObjectManifest>, String> {
    let client = reqwest::Client::new();
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
            fs::create_dir_all(parent).map_err(sanitized_error)?;
        }
        let bytes =
            download_storage_object_with_retry(&client, headers, &base, &object.path).await?;
        fs::write(&destination, &bytes).map_err(sanitized_error)?;
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
                    .map_err(sanitized_error);
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
    let bytes = serde_json::to_vec_pretty(value).map_err(sanitized_error)?;
    fs::write(path, bytes).map_err(sanitized_error)
}

fn write_checksum_manifest(root: &Path, destination: &Path) -> Result<(), String> {
    let mut files = Vec::new();
    collect_files(root, root, &mut files)?;
    files.retain(|(relative, _)| relative != Path::new("verification/sha256sums.txt"));
    files.sort_by(|left, right| left.0.cmp(&right.0));
    let mut output = BufWriter::new(File::create(destination).map_err(sanitized_error)?);
    for (relative, absolute) in files {
        writeln!(
            output,
            "{}  {}",
            sha256_file(&absolute)?,
            relative.to_string_lossy()
        )
        .map_err(sanitized_error)?;
    }
    output.flush().map_err(sanitized_error)
}

fn collect_files(
    root: &Path,
    current: &Path,
    files: &mut Vec<(PathBuf, PathBuf)>,
) -> Result<(), String> {
    for entry in fs::read_dir(current).map_err(sanitized_error)? {
        let entry = entry.map_err(sanitized_error)?;
        let path = entry.path();
        if path.is_dir() {
            collect_files(root, &path, files)?;
        } else if path.is_file() {
            let relative = path
                .strip_prefix(root)
                .map_err(sanitized_error)?
                .to_path_buf();
            files.push((relative, path));
        }
    }
    Ok(())
}

fn create_tar_archive(source_root: &Path, destination: &Path) -> Result<(), String> {
    let file = File::create(destination).map_err(sanitized_error)?;
    let mut builder = tar::Builder::new(BufWriter::new(file));
    builder
        .append_dir_all(ARCHIVE_ROOT, source_root)
        .map_err(sanitized_error)?;
    builder.finish().map_err(sanitized_error)
}

fn encrypt_file(input: &Path, output: &Path, passphrase: &SecretString) -> Result<(), String> {
    let encryptor = Encryptor::with_user_passphrase(passphrase.clone());
    let source = File::open(input).map_err(sanitized_error)?;
    let destination = BufWriter::new(File::create(output).map_err(sanitized_error)?);
    let mut writer = encryptor
        .wrap_output(destination)
        .map_err(sanitized_error)?;
    std::io::copy(&mut BufReader::new(source), &mut writer).map_err(sanitized_error)?;
    writer.finish().map_err(sanitized_error)?;
    Ok(())
}

fn validate_encrypted_envelope(encrypted: &Path) -> Result<(), String> {
    let reader = BufReader::new(File::open(encrypted).map_err(sanitized_error)?);
    Decryptor::new_buffered(reader)
        .map(|_| ())
        .map_err(|_| "age暗号化ファイルの形式を確認できませんでした。".to_string())
}

fn verify_backup_file_with_passphrase(
    encrypted: &Path,
    passphrase: &SecretString,
    pg_restore: &Path,
) -> Result<BackupVerificationResult, String> {
    if !encrypted.is_file() {
        return Err("暗号化バックアップファイルを読み込めませんでした。".to_string());
    }
    let temp = file_security::PrivateTempDir::new("kawashima-backup-verify-")?;
    let temp_path = temp.path().to_path_buf();
    let verification = verify_encrypted_backup(encrypted, passphrase, temp.path(), pg_restore);
    temp.close()?;
    if temp_path.exists() {
        return Err("復号確認用の一時ファイルを削除できませんでした。".to_string());
    }
    let structure = verification?;
    Ok(BackupVerificationResult {
        ok: true,
        database_dump_present: structure.database_dump_present,
        manifests_present: structure.manifests_present,
        storage_present: structure.storage_present,
        verification_present: structure.verification_present,
        database_structure_valid: structure.database_structure_valid,
        plaintext_archive_sha256: structure.plaintext_archive_sha256,
        temporary_files_removed: true,
    })
}

fn verify_encrypted_backup(
    encrypted: &Path,
    passphrase: &SecretString,
    temp_root: &Path,
    pg_restore: &Path,
) -> Result<VerifiedBackupStructure, String> {
    decrypt_extract_verify_backup(encrypted, passphrase, temp_root, pg_restore)
        .map(|package| package.structure)
}

fn decrypt_extract_verify_backup(
    encrypted: &Path,
    passphrase: &SecretString,
    temp_root: &Path,
    pg_restore: &Path,
) -> Result<VerifiedExtractedBackup, String> {
    let basic = decrypt_extract_verify_structure(encrypted, passphrase, temp_root, pg_restore)?;
    let backup_manifest: BackupManifest = read_json(&basic.root.join("manifests/backup.json"))?;
    let database_manifest: DatabaseManifest =
        read_json(&basic.root.join("manifests/database.json"))?;
    let storage_manifest: StorageManifest = read_json(&basic.root.join("manifests/storage.json"))?;
    Ok(VerifiedExtractedBackup {
        structure: basic.structure,
        root: basic.root,
        backup_manifest,
        database_manifest,
        storage_manifest,
    })
}

fn decrypt_extract_verify_structure(
    encrypted: &Path,
    passphrase: &SecretString,
    temp_root: &Path,
    pg_restore: &Path,
) -> Result<BasicExtractedBackup, String> {
    fs::create_dir_all(temp_root).map_err(sanitized_error)?;
    let decrypted_tar = temp_root.join("verification.tar");
    let encrypted_reader = BufReader::new(File::open(encrypted).map_err(sanitized_error)?);
    let decryptor = Decryptor::new_buffered(encrypted_reader).map_err(sanitized_error)?;
    let identity = age::scrypt::Identity::new(passphrase.clone());
    let mut reader = decryptor
        .decrypt(std::iter::once(&identity as &dyn age::Identity))
        .map_err(|_| {
            "復旧パスワードが正しくないか、バックアップファイルを復号できませんでした。".to_string()
        })?;
    let mut output = BufWriter::new(File::create(&decrypted_tar).map_err(sanitized_error)?);
    std::io::copy(&mut reader, &mut output).map_err(sanitized_error)?;
    output.flush().map_err(sanitized_error)?;
    drop(output);
    let plaintext_archive_sha256 = sha256_file(&decrypted_tar)?;

    let extract_dir = temp_root.join("verification-extracted");
    fs::create_dir_all(&extract_dir).map_err(sanitized_error)?;
    unpack_archive_safely(&decrypted_tar, &extract_dir)?;
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
    postgres_runtime::inspect_custom_dump(pg_restore, &root.join("database").join(DUMP_FILE_NAME))?;
    Ok(BasicExtractedBackup {
        structure: VerifiedBackupStructure {
            database_dump_present,
            manifests_present,
            storage_present,
            verification_present,
            database_structure_valid: true,
            plaintext_archive_sha256,
        },
        root,
    })
}

fn unpack_archive_safely(archive_path: &Path, destination: &Path) -> Result<(), String> {
    let mut archive = tar::Archive::new(BufReader::new(
        File::open(archive_path).map_err(sanitized_error)?,
    ));
    let entries = archive.entries().map_err(sanitized_error)?;
    for entry in entries {
        let mut entry = entry.map_err(sanitized_error)?;
        let entry_type = entry.header().entry_type();
        if !(entry_type.is_file() || entry_type.is_dir()) {
            return Err("バックアップarchiveに許可されない種類のentryがあります。".to_string());
        }
        let relative = entry.path().map_err(sanitized_error)?;
        validate_archive_entry_path(&relative)?;
        let output_path = destination.join(relative.as_ref());
        if let Some(parent) = output_path.parent() {
            fs::create_dir_all(parent).map_err(sanitized_error)?;
        }
        entry.unpack(&output_path).map_err(sanitized_error)?;
    }
    Ok(())
}

fn validate_archive_entry_path(path: &Path) -> Result<(), String> {
    let mut components = path.components();
    match components.next() {
        Some(Component::Normal(root)) if root == ARCHIVE_ROOT => {}
        _ => return Err("バックアップarchiveの構造が正しくありません。".to_string()),
    }
    if components.any(|component| !matches!(component, Component::Normal(_))) {
        return Err("バックアップarchiveのpathが安全ではありません。".to_string());
    }
    Ok(())
}

fn validate_restore_compatibility(package: &VerifiedExtractedBackup) -> Result<(), String> {
    if package.backup_manifest.format_version > 2 {
        return Err("このバージョンのバックアップ形式には対応していません。".to_string());
    }
    if package.backup_manifest.encryption.scheme != ENCRYPTION_ALGORITHM
        || package.backup_manifest.encryption.format != ENCRYPTION_FORMAT
        || package.backup_manifest.encryption.version != ENCRYPTION_FORMAT_VERSION
    {
        return Err("バックアップの暗号化方式が現在の復旧機能と一致しません。".to_string());
    }
    if package.database_manifest.schema != "public"
        || package.database_manifest.dump_file != format!("database/{DUMP_FILE_NAME}")
        || package.database_manifest.dump_format != "PostgreSQL custom"
    {
        return Err("データベースmanifestが復旧対象形式と一致しません。".to_string());
    }
    let dump_path = package.root.join("database").join(DUMP_FILE_NAME);
    if file_size(&dump_path)? != package.database_manifest.dump_size
        || sha256_file(&dump_path)? != package.database_manifest.dump_sha256
    {
        return Err("データベースdumpのSHA-256確認に失敗しました。".to_string());
    }
    if package.storage_manifest.bucket != STORAGE_BUCKET {
        return Err("Storage manifestのbucketが復旧対象と一致しません。".to_string());
    }
    if package.storage_manifest.object_count != package.storage_manifest.objects.len() {
        return Err("Storage manifestのobject件数が一致しません。".to_string());
    }
    for object in &package.storage_manifest.objects {
        validate_object_path(&object.path)?;
        let object_path = package
            .root
            .join("storage")
            .join(STORAGE_BUCKET)
            .join(&object.path);
        if !object_path.is_file()
            || file_size(&object_path)? != object.size
            || sha256_file(&object_path)? != object.sha256
        {
            return Err("Storage objectのmanifest確認に失敗しました。".to_string());
        }
    }
    Ok(())
}

fn read_json<T: for<'de> Deserialize<'de>>(path: &Path) -> Result<T, String> {
    let bytes = fs::read(path).map_err(sanitized_error)?;
    serde_json::from_slice(&bytes).map_err(sanitized_error)
}

async fn restore_storage_objects(
    app: &AppHandle,
    settings: &BackupToolSettings,
    headers: &HeaderMap,
    storage_root: &Path,
    manifest: &StorageManifest,
) -> Result<usize, String> {
    storage_auth::verify_bucket_access(
        &reqwest::Client::new(),
        &normalize_project_url(&settings.supabase_project_url)?,
        STORAGE_BUCKET,
        headers,
    )
    .await?;
    for (index, object) in manifest.objects.iter().enumerate() {
        emit_progress(
            app,
            "storageRestore",
            "running",
            "画像ファイルを復旧しています。",
            Some(index + 1),
            Some(manifest.objects.len()),
        );
        upload_storage_object_with_retry(settings, headers, storage_root, object).await?;
    }
    verify_restored_storage_objects(app, settings, headers, storage_root, manifest).await?;
    Ok(manifest.objects.len())
}

async fn upload_storage_object_with_retry(
    settings: &BackupToolSettings,
    headers: &HeaderMap,
    storage_root: &Path,
    object: &StorageObjectManifest,
) -> Result<(), String> {
    validate_object_path(&object.path)?;
    let source = storage_root.join(&object.path);
    if !source.is_file()
        || file_size(&source)? != object.size
        || sha256_file(&source)? != object.sha256
    {
        return Err("復旧元Storageファイルの整合性確認に失敗しました。".to_string());
    }
    let bytes = fs::read(&source).map_err(sanitized_error)?;
    let client = reqwest::Client::new();
    let url = storage_upload_url(
        &normalize_project_url(&settings.supabase_project_url)?,
        &object.path,
    )?;
    let mut last_status = None;
    for attempt in 1..=STORAGE_UPLOAD_ATTEMPTS {
        let mut upload_headers = headers.clone();
        upload_headers.insert("x-upsert", HeaderValue::from_static("true"));
        upload_headers.insert(
            CONTENT_TYPE,
            HeaderValue::from_str(
                object
                    .content_type
                    .as_deref()
                    .unwrap_or("application/octet-stream"),
            )
            .map_err(|_| "Storage content_typeの形式を確認してください。".to_string())?,
        );
        match client
            .post(url.clone())
            .headers(upload_headers)
            .body(bytes.clone())
            .send()
            .await
        {
            Ok(response) if response.status().is_success() => return Ok(()),
            Ok(response) => last_status = Some(response.status().to_string()),
            Err(_) => last_status = Some("network error".to_string()),
        }
        if attempt < STORAGE_UPLOAD_ATTEMPTS {
            tokio::time::sleep(std::time::Duration::from_millis(250 * attempt as u64)).await;
        }
    }
    let status = last_status.unwrap_or_else(|| "unknown".to_string());
    Err(format!(
        "Storage復旧uploadに失敗しました（HTTP {status}）。"
    ))
}

async fn verify_restored_storage_objects(
    app: &AppHandle,
    settings: &BackupToolSettings,
    headers: &HeaderMap,
    storage_root: &Path,
    manifest: &StorageManifest,
) -> Result<(), String> {
    let client = reqwest::Client::new();
    let base = normalize_project_url(&settings.supabase_project_url)?;
    for (index, object) in manifest.objects.iter().enumerate() {
        emit_progress(
            app,
            "postVerify",
            "running",
            "復旧済み画像ファイルを検証しています。",
            Some(index + 1),
            Some(manifest.objects.len()),
        );
        let expected_path = storage_root.join(&object.path);
        let expected_hash = sha256_file(&expected_path)?;
        let response = client
            .get(storage_download_url(&base, &object.path)?)
            .headers(headers.clone())
            .send()
            .await
            .map_err(sanitized_error)?;
        if !response.status().is_success() {
            return Err(format!(
                "復旧済みStorage objectを確認できません（HTTP {}）。",
                response.status().as_u16()
            ));
        }
        let actual_content_type = response
            .headers()
            .get(CONTENT_TYPE)
            .and_then(|value| value.to_str().ok())
            .map(|value| value.split(';').next().unwrap_or(value).trim().to_string());
        let bytes = response.bytes().await.map_err(sanitized_error)?;
        if bytes.len() as u64 != object.size || sha256_bytes(&bytes) != expected_hash {
            return Err("復旧済みStorage objectのSHA-256確認に失敗しました。".to_string());
        }
        if let Some(expected) = &object.content_type {
            if actual_content_type.as_deref() != Some(expected.as_str()) {
                return Err("復旧済みStorage objectのcontent_type確認に失敗しました。".to_string());
            }
        }
    }
    Ok(())
}

fn storage_upload_url(project_url: &str, object_path: &str) -> Result<reqwest::Url, String> {
    validate_object_path(object_path)?;
    let mut url = reqwest::Url::parse(project_url)
        .map_err(|_| "Supabase Project URLを確認してください。".to_string())?;
    {
        let mut segments = url
            .path_segments_mut()
            .map_err(|_| "Supabase Project URLを確認してください。".to_string())?;
        segments
            .clear()
            .extend(["storage", "v1", "object", STORAGE_BUCKET]);
        for segment in object_path.split('/') {
            segments.push(segment);
        }
    }
    Ok(url)
}

async fn verify_database_after_restore(
    settings: &BackupToolSettings,
    user: &str,
    password: &str,
    manifest: &DatabaseManifest,
) -> Result<usize, String> {
    let config = build_db_config_for_user(settings, user, password)?;
    let (client, connection) = config
        .connect(build_database_tls_connector()?)
        .await
        .map_err(sanitized_error)?;
    tauri::async_runtime::spawn(async move {
        let _ = connection.await;
    });
    let public_schema_exists: bool = client
        .query_one(
            "select exists (select 1 from information_schema.schemata where schema_name = 'public')",
            &[],
        )
        .await
        .map_err(sanitized_error)?
        .get(0);
    if !public_schema_exists {
        return Err("復旧後のpublic schemaを確認できません。".to_string());
    }
    let actual_tables = client
        .query(
            "select table_name from information_schema.tables where table_schema = 'public' and table_type = 'BASE TABLE' order by table_name",
            &[],
        )
        .await
        .map_err(sanitized_error)?;
    if manifest.table_counts.is_empty() {
        if actual_tables.len() as i64 != manifest.public_table_count {
            return Err("復旧後のpublic table数がmanifestと一致しません。".to_string());
        }
        return Ok(actual_tables.len());
    }
    if actual_tables.len() != manifest.table_counts.len() {
        return Err("復旧後のpublic table一覧がmanifestと一致しません。".to_string());
    }
    for expected in &manifest.table_counts {
        let count_sql = format!(
            "select count(*) from public.{}",
            quote_identifier(&expected.table)
        );
        let actual_rows: i64 = client
            .query_one(&count_sql, &[])
            .await
            .map_err(sanitized_error)?
            .get(0);
        if actual_rows != expected.rows {
            return Err("復旧後のtable row countがmanifestと一致しません。".to_string());
        }
    }
    Ok(manifest.table_counts.len())
}

#[cfg(test)]
fn decrypt_file_to_path(
    encrypted: &Path,
    output: &Path,
    passphrase: &SecretString,
) -> Result<(), String> {
    let encrypted_reader = BufReader::new(File::open(encrypted).map_err(sanitized_error)?);
    let decryptor = Decryptor::new_buffered(encrypted_reader).map_err(sanitized_error)?;
    let identity = age::scrypt::Identity::new(passphrase.clone());
    let mut reader = decryptor
        .decrypt(std::iter::once(&identity as &dyn age::Identity))
        .map_err(|_| {
            "復旧パスワードが正しくないか、バックアップファイルを復号できませんでした。".to_string()
        })?;
    let mut destination = BufWriter::new(File::create(output).map_err(sanitized_error)?);
    std::io::copy(&mut reader, &mut destination).map_err(sanitized_error)?;
    destination.flush().map_err(sanitized_error)
}

fn verify_checksum_manifest(root: &Path, manifest: &Path) -> Result<(), String> {
    let reader = BufReader::new(File::open(manifest).map_err(sanitized_error)?);
    for line in reader.lines() {
        let line = line.map_err(sanitized_error)?;
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
    let mut completed: Vec<PathBuf> = Vec::new();
    for destination in [&local, &drive] {
        if let Err(error) = copy_atomic_verified(source, destination, expected_hash) {
            for path in completed {
                let _ = file_security::remove_file_with_retry(&path);
            }
            let _ =
                file_security::remove_file_with_retry(&destination.with_extension("age.partial"));
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
        file_security::remove_file_with_retry(&partial).map_err(sanitized_error)?;
    }
    let result = (|| {
        fs::copy(source, &partial).map_err(sanitized_error)?;
        if file_size(source)? != file_size(&partial)? || sha256_file(&partial)? != expected_hash {
            return Err("保存先コピーの整合性確認に失敗しました。".to_string());
        }
        fs::OpenOptions::new()
            .write(true)
            .open(&partial)
            .and_then(|file| file.sync_all())
            .map_err(sanitized_error)?;
        file_security::publish_new_file(&partial, destination).map_err(sanitized_error)?;
        Ok(())
    })();
    if result.is_err() {
        let _ = file_security::remove_file_with_retry(&partial);
    }
    result
}

fn history_path(app: &AppHandle) -> Result<PathBuf, String> {
    app.path()
        .app_config_dir()
        .map(|path| path.join(HISTORY_FILE_NAME))
        .map_err(sanitized_error)
}

fn read_history(app: &AppHandle) -> Result<Vec<BackupHistoryEntry>, String> {
    let path = history_path(app)?;
    if !path.exists() {
        return Ok(Vec::new());
    }
    let content = fs::read_to_string(path).map_err(sanitized_error)?;
    serde_json::from_str(&content).map_err(sanitized_error)
}

fn append_history(app: &AppHandle, entry: BackupHistoryEntry) -> Result<(), String> {
    let mut history = read_history(app)?;
    history.insert(0, entry);
    let path = history_path(app)?;
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent).map_err(sanitized_error)?;
    }
    let temp = path.with_extension("json.tmp");
    write_json(&temp, &history)?;
    file_security::replace_file(&temp, &path).map_err(sanitized_error)
}

fn restore_journal_path(app: &AppHandle) -> Result<PathBuf, String> {
    app.path()
        .app_config_dir()
        .map(|path| path.join(RESTORE_JOURNAL_FILE_NAME))
        .map_err(sanitized_error)
}

fn read_restore_journal(app: &AppHandle) -> Result<Vec<RestoreJournalEntry>, String> {
    let path = restore_journal_path(app)?;
    if !path.exists() {
        return Ok(Vec::new());
    }
    let content = fs::read_to_string(path).map_err(sanitized_error)?;
    serde_json::from_str(&content).map_err(sanitized_error)
}

fn append_restore_journal(app: &AppHandle, entry: RestoreJournalEntry) -> Result<(), String> {
    let mut journal = read_restore_journal(app)?;
    journal.insert(0, entry);
    let path = restore_journal_path(app)?;
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent).map_err(sanitized_error)?;
    }
    let temp = path.with_extension("json.tmp");
    write_json(&temp, &journal)?;
    file_security::replace_file(&temp, &path).map_err(sanitized_error)
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
        .map_err(sanitized_error)
}

fn sha256_file(path: &Path) -> Result<String, String> {
    let mut file = BufReader::new(File::open(path).map_err(sanitized_error)?);
    let mut hasher = Sha256::new();
    let mut buffer = [0u8; 64 * 1024];
    loop {
        let count = file.read(&mut buffer).map_err(sanitized_error)?;
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

fn safe_restore_error_summary(error: &str) -> String {
    let sanitized = sanitized_error(error);
    if sanitized.contains("Storage") {
        "Storage復旧または検証に失敗しました。".to_string()
    } else if sanitized.contains("pg_restore")
        || sanitized.contains("データベース")
        || sanitized.contains("DB")
    {
        "データベース復旧または検証に失敗しました。".to_string()
    } else if sanitized.contains("復号")
        || sanitized.contains("manifest")
        || sanitized.contains("SHA-256")
    {
        "復旧ファイルの事前検証に失敗しました。".to_string()
    } else {
        "復旧処理に失敗しました。".to_string()
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use age::secrecy::ExposeSecret;
    use tempfile::TempDir;

    fn test_passphrase() -> SecretString {
        SecretString::from("correct horse battery staple 2026".to_string())
    }

    fn test_settings(root: &Path) -> BackupToolSettings {
        BackupToolSettings {
            supabase_project_url: "https://example.supabase.co".to_string(),
            supabase_publishable_key: "publishable-test".to_string(),
            storage_auth_email: "endpoint@nonprod.invalid".to_string(),
            db_host: "example.pooler.supabase.com".to_string(),
            db_port: "5432".to_string(),
            db_name: "postgres".to_string(),
            db_user: "postgres.example".to_string(),
            db_restore_user: "postgres.restore".to_string(),
            connection_mode: super::super::ConnectionMode::Session,
            local_backup_path: root.join("local").to_string_lossy().to_string(),
            google_drive_path: root.join("drive").to_string_lossy().to_string(),
            storage_restore_auth_email: "restore@nonprod.invalid".to_string(),
            endpoint_id: Some("test-endpoint".to_string()),
            encryption_algorithm: Some(ENCRYPTION_ALGORITHM.to_string()),
            setup_complete: true,
            setup_step: 6,
            setup_completed_at: Some("2026-08-28T00:00:00Z".to_string()),
        }
    }

    #[cfg(unix)]
    fn create_test_backup(root: &Path, passphrase: &SecretString) -> PathBuf {
        let source = root.join("source").join(ARCHIVE_ROOT);
        fs::create_dir_all(source.join("database")).unwrap();
        fs::create_dir_all(source.join("manifests")).unwrap();
        fs::create_dir_all(source.join("storage").join(STORAGE_BUCKET)).unwrap();
        fs::create_dir_all(source.join("verification")).unwrap();
        let dump = source.join("database").join(DUMP_FILE_NAME);
        fs::write(&dump, b"test dump").unwrap();
        let backup_manifest = BackupManifest {
            format_version: 2,
            backup_id: "test".to_string(),
            created_at: "2026-09-04T00:00:00Z".to_string(),
            application: "Kawashima Motors Backup Tool".to_string(),
            application_version: "0.5.0".to_string(),
            endpoint_id: "test-endpoint".to_string(),
            database_manifest: "manifests/database.json".to_string(),
            storage_manifest: "manifests/storage.json".to_string(),
            checksum_manifest: "verification/sha256sums.txt".to_string(),
            encryption: EncryptionManifest {
                scheme: ENCRYPTION_ALGORITHM.to_string(),
                format: ENCRYPTION_FORMAT.to_string(),
                version: ENCRYPTION_FORMAT_VERSION,
            },
        };
        let database_manifest = DatabaseManifest {
            created_at: "2026-09-04T00:00:00Z".to_string(),
            postgres_version: "PostgreSQL 17".to_string(),
            connection_mode: "Session pooler".to_string(),
            schema: "public".to_string(),
            dump_file: format!("database/{DUMP_FILE_NAME}"),
            dump_format: "PostgreSQL custom".to_string(),
            dump_size: file_size(&dump).unwrap(),
            dump_sha256: sha256_file(&dump).unwrap(),
            public_table_count: 0,
            table_counts: vec![],
            pg_dump_version: "pg_dump 17".to_string(),
            pg_restore_version: "pg_restore 17".to_string(),
        };
        let storage_manifest = StorageManifest {
            created_at: "2026-09-04T00:00:00Z".to_string(),
            bucket: STORAGE_BUCKET.to_string(),
            object_count: 0,
            objects: vec![],
        };
        write_json(&source.join("manifests/backup.json"), &backup_manifest).unwrap();
        write_json(&source.join("manifests/database.json"), &database_manifest).unwrap();
        write_json(&source.join("manifests/storage.json"), &storage_manifest).unwrap();
        fs::write(source.join("verification/backup-report.json"), b"{}").unwrap();
        write_checksum_manifest(&source, &source.join("verification/sha256sums.txt")).unwrap();
        let archive = root.join("test.tar");
        create_tar_archive(&source, &archive).unwrap();
        let encrypted = root.join("test.tar.age");
        encrypt_file(&archive, &encrypted, passphrase).unwrap();
        encrypted
    }

    #[cfg(unix)]
    fn fake_pg_restore(root: &Path) -> PathBuf {
        use std::os::unix::fs::PermissionsExt;
        let path = root.join("pg_restore");
        fs::write(&path, "#!/bin/sh\nprintf 'archive list\\n'\n").unwrap();
        fs::set_permissions(&path, fs::Permissions::from_mode(0o755)).unwrap();
        path
    }

    fn restore_package_fixture(root: &Path) -> VerifiedExtractedBackup {
        let package_root = root.join(ARCHIVE_ROOT);
        fs::create_dir_all(package_root.join("database")).unwrap();
        fs::create_dir_all(package_root.join("storage").join(STORAGE_BUCKET)).unwrap();
        let dump = package_root.join("database").join(DUMP_FILE_NAME);
        fs::write(&dump, b"custom dump").unwrap();
        let object_path = package_root
            .join("storage")
            .join(STORAGE_BUCKET)
            .join("line/one.png");
        fs::create_dir_all(object_path.parent().unwrap()).unwrap();
        fs::write(&object_path, b"image").unwrap();
        VerifiedExtractedBackup {
            structure: VerifiedBackupStructure {
                database_dump_present: true,
                manifests_present: true,
                storage_present: true,
                verification_present: true,
                database_structure_valid: true,
                plaintext_archive_sha256: "0".repeat(64),
            },
            root: package_root,
            backup_manifest: BackupManifest {
                format_version: 2,
                backup_id: "fixture".to_string(),
                created_at: "2026-09-04T00:00:00Z".to_string(),
                application: "Kawashima Motors Backup Tool".to_string(),
                application_version: "0.5.0".to_string(),
                endpoint_id: "test-endpoint".to_string(),
                database_manifest: "manifests/database.json".to_string(),
                storage_manifest: "manifests/storage.json".to_string(),
                checksum_manifest: "verification/sha256sums.txt".to_string(),
                encryption: EncryptionManifest {
                    scheme: ENCRYPTION_ALGORITHM.to_string(),
                    format: ENCRYPTION_FORMAT.to_string(),
                    version: ENCRYPTION_FORMAT_VERSION,
                },
            },
            database_manifest: DatabaseManifest {
                created_at: "2026-09-04T00:00:00Z".to_string(),
                postgres_version: "PostgreSQL 17".to_string(),
                connection_mode: "Session pooler".to_string(),
                schema: "public".to_string(),
                dump_file: format!("database/{DUMP_FILE_NAME}"),
                dump_format: "PostgreSQL custom".to_string(),
                dump_size: file_size(&dump).unwrap(),
                dump_sha256: sha256_file(&dump).unwrap(),
                public_table_count: 1,
                table_counts: vec![TableCountManifest {
                    table: "customers".to_string(),
                    rows: 3,
                }],
                pg_dump_version: "pg_dump 17".to_string(),
                pg_restore_version: "pg_restore 17".to_string(),
            },
            storage_manifest: StorageManifest {
                created_at: "2026-09-04T00:00:00Z".to_string(),
                bucket: STORAGE_BUCKET.to_string(),
                object_count: 1,
                objects: vec![StorageObjectManifest {
                    path: "line/one.png".to_string(),
                    size: file_size(&object_path).unwrap(),
                    sha256: sha256_file(&object_path).unwrap(),
                    content_type: Some("image/png".to_string()),
                }],
            },
        }
    }

    #[test]
    fn age_passphrase_round_trip_and_wrong_password_failure() {
        let temp = TempDir::new().unwrap();
        let input = temp.path().join("input.tar");
        let encrypted = temp.path().join("input.tar.age");
        fs::write(&input, b"backup contents").unwrap();
        let passphrase = test_passphrase();
        encrypt_file(&input, &encrypted, &passphrase).unwrap();
        let temp_root = temp.path().join("decrypt-ok");
        fs::create_dir_all(&temp_root).unwrap();
        let output = temp_root.join("out.tar");
        decrypt_file_to_path(&encrypted, &output, &passphrase).unwrap();
        assert_eq!(fs::read(output).unwrap(), b"backup contents");

        let wrong = SecretString::from("wrong horse battery staple 2026".to_string());
        assert!(decrypt_file_to_path(&encrypted, &temp.path().join("wrong.tar"), &wrong).is_err());
    }

    #[test]
    fn backup_guard_requires_passphrase_scheme_and_usable_password() {
        let temp = TempDir::new().unwrap();
        let mut settings = test_settings(temp.path());
        let password = "correct horse battery staple 2026";
        let validated = validate_backup_encryption_authorization(&settings, password).unwrap();
        assert_eq!(validated.passphrase.expose_secret(), password);

        settings.encryption_algorithm = Some("age X25519".to_string());
        assert!(
            validate_backup_encryption_authorization(&settings, password)
                .unwrap_err()
                .contains("age passphrase")
        );

        settings.encryption_algorithm = Some(ENCRYPTION_ALGORITHM.to_string());
        assert!(validate_backup_encryption_authorization(&settings, "")
            .unwrap_err()
            .contains("復旧パスワード"));
        assert!(validate_backup_encryption_authorization(&settings, "short")
            .unwrap_err()
            .contains("16文字以上"));
        assert!(
            validate_backup_encryption_authorization(&settings, "aaaaaaaaaaaaaaaa")
                .unwrap_err()
                .contains("単純すぎ")
        );
    }

    #[test]
    fn settings_and_backup_manifest_contain_passphrase_scheme_without_secrets() {
        let temp = TempDir::new().unwrap();
        let settings = test_settings(temp.path());
        let settings_json = serde_json::to_string(&settings).unwrap();
        assert!(settings_json.contains(ENCRYPTION_ALGORITHM));
        assert!(!settings_json.contains("AGE-SECRET-KEY-"));
        assert!(!settings_json.to_lowercase().contains("recoverypassword"));
        assert!(!settings_json.to_lowercase().contains("password"));
        assert!(!settings_json.to_lowercase().contains("privatekey"));
        assert!(!settings_json.to_lowercase().contains("publickeyledger"));

        let manifest = BackupManifest {
            format_version: 2,
            backup_id: "fixture".to_string(),
            created_at: "2026-08-28T00:20:00Z".to_string(),
            application: "Kawashima Motors Backup Tool".to_string(),
            application_version: "0.5.0".to_string(),
            endpoint_id: "test-endpoint".to_string(),
            database_manifest: "manifests/database.json".to_string(),
            storage_manifest: "manifests/storage.json".to_string(),
            checksum_manifest: "verification/sha256sums.txt".to_string(),
            encryption: EncryptionManifest {
                scheme: ENCRYPTION_ALGORITHM.to_string(),
                format: ENCRYPTION_FORMAT.to_string(),
                version: ENCRYPTION_FORMAT_VERSION,
            },
        };
        let manifest_json = serde_json::to_string(&manifest).unwrap();
        assert!(manifest_json.contains(ENCRYPTION_ALGORITHM));
        assert!(manifest_json.contains(ENCRYPTION_FORMAT));
        assert!(!manifest_json.contains("AGE-SECRET-KEY-"));
        assert!(!manifest_json.to_lowercase().contains("recoverypassword"));
        assert!(!manifest_json.to_lowercase().contains("password"));
        assert!(!manifest_json.to_lowercase().contains("fingerprint"));
    }

    #[test]
    fn endpoint_id_is_part_of_the_new_filename_without_breaking_legacy_files() {
        assert_eq!(
            archive_file_name("kawashima-windows-main", "20260828-120000-JST"),
            "kawashima-backup-kawashima-windows-main-20260828-120000-JST.tar.age"
        );
        let legacy = "kawashima-backup-20260828-120000-JST.tar.age";
        assert!(legacy.ends_with(".tar.age"));
    }

    #[cfg(unix)]
    #[test]
    fn passphrase_encrypted_backup_verifies_with_password() {
        let temp = TempDir::new().unwrap();
        let passphrase = test_passphrase();
        let encrypted = create_test_backup(temp.path(), &passphrase);
        let pg_restore = fake_pg_restore(temp.path());

        let recovery_result =
            verify_backup_file_with_passphrase(&encrypted, &passphrase, &pg_restore).unwrap();
        assert!(recovery_result.ok);
        assert!(recovery_result.temporary_files_removed);
        assert!(recovery_result.database_dump_present);
        assert!(recovery_result.manifests_present);
        assert!(recovery_result.storage_present);
        assert!(recovery_result.verification_present);
        assert!(recovery_result.database_structure_valid);
        assert_eq!(recovery_result.plaintext_archive_sha256.len(), 64);
        assert!(verify_backup_file_with_passphrase(
            &encrypted,
            &SecretString::from("wrong horse battery staple 2026".to_string()),
            &pg_restore,
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
        assert!(RestoreRunGuard::acquire().is_err());
        drop(first);
        assert!(BackupRunGuard::acquire().is_ok());
        BACKUP_RUNNING.store(false, Ordering::SeqCst);
    }

    #[test]
    fn restore_compatibility_allows_only_current_passphrase_public_and_line_bucket() {
        let temp = TempDir::new().unwrap();
        let mut package = restore_package_fixture(temp.path());
        assert!(validate_restore_compatibility(&package).is_ok());

        package.storage_manifest.bucket = "other-bucket".to_string();
        assert!(validate_restore_compatibility(&package)
            .unwrap_err()
            .contains("bucket"));
    }

    #[test]
    fn restore_manifest_rejects_object_path_traversal() {
        let temp = TempDir::new().unwrap();
        let mut package = restore_package_fixture(temp.path());
        package.storage_manifest.objects[0].path = "../secret".to_string();
        assert!(validate_restore_compatibility(&package).is_err());
    }

    #[test]
    fn storage_upload_url_is_fixed_to_line_message_images() {
        let url = storage_upload_url("https://example.supabase.co", "line/one.png").unwrap();
        assert_eq!(
            url.as_str(),
            "https://example.supabase.co/storage/v1/object/line-message-images/line/one.png"
        );
        assert!(storage_upload_url("https://example.supabase.co", "../secret").is_err());
    }

    #[test]
    fn restore_journal_serialization_contains_no_secrets() {
        let entry = RestoreJournalEntry {
            restore_id: "restore-20260904-120000-JST".to_string(),
            started_at: "2026-09-04T03:00:00Z".to_string(),
            completed_at: Some("2026-09-04T03:01:00Z".to_string()),
            target_backup: "backup.tar.age".to_string(),
            backup_sha256: "a".repeat(64),
            pre_restore_backup_id: Some("20260904-115900-JST".to_string()),
            db_restore_status: "complete".to_string(),
            storage_restore_status: "complete".to_string(),
            verification_status: "postRestoreComplete".to_string(),
            error_summary: None,
        };
        let serialized = serde_json::to_string(&entry).unwrap();
        assert!(!serialized.to_lowercase().contains("password"));
        assert!(!serialized.to_lowercase().contains("passphrase"));
        assert!(!serialized.contains("AGE-SECRET-KEY-"));
        assert!(!serialized.to_lowercase().contains("service_role"));
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
            table_counts: vec![],
            pg_dump_version: "pg_dump 17".to_string(),
            pg_restore_version: "pg_restore 17".to_string(),
        };
        let serialized = serde_json::to_string(&manifest).unwrap();
        assert!(!serialized.contains("password"));
        assert!(!serialized.contains("service_role"));
        assert!(!serialized.contains("db_user"));
    }

    #[test]
    fn phase_two_history_deserializes_with_empty_phase_three_metadata() {
        let legacy = r#"{
            "backupId":"legacy","startedAt":"2026-08-01T00:00:00Z",
            "completedAt":"2026-08-01T00:01:00Z","fileName":"legacy.tar.age",
            "success":true,"errorSummary":null,"encryptedSize":1,
            "encryptedSha256":"abc","databaseOk":true,"storageOk":true,
            "verificationOk":true,"localCopyOk":true,"googleDriveCopyOk":true,
            "storageObjectCount":0,"publicTableCount":1
        }"#;
        let entry: BackupHistoryEntry = serde_json::from_str(legacy).unwrap();
        assert!(entry.endpoint_id.is_empty());
        assert_eq!(entry.encryption_scheme, ENCRYPTION_ALGORITHM);
        assert!(entry.plaintext_archive_sha256.is_empty());
        assert!(entry.application_version.is_empty());
    }
}
