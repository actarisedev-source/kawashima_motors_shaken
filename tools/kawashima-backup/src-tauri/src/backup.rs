use std::{
    fs::{self, File},
    io::{BufRead, BufReader, BufWriter, Read, Write},
    path::{Component, Path, PathBuf},
    str::FromStr,
    sync::{
        atomic::{AtomicBool, Ordering},
        Mutex,
    },
};

use age::{x25519, Decryptor, Encryptor};
use chrono::{DateTime, Local, SecondsFormat, Utc};
use reqwest::header::HeaderMap;
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use sha2::{Digest, Sha256};
use tauri::{AppHandle, Emitter, Manager, State};
use zeroize::Zeroizing;

use super::{
    build_database_tls_connector, build_db_config, connection_mode_label, normalize_project_url,
    read_secret, sanitized_error, save_settings_to_disk, storage_auth, BackupToolSettings,
    ProductionKeyCeremonyMetadata, PublicKeyLedgerEntry, PublicKeyStatus, ACCOUNT_DB_PASSWORD,
    ACCOUNT_STORAGE_AUTH_PASSWORD, SUPABASE_ROOT_CA_PEM,
};
use super::{file_security, postgres_runtime};

const HISTORY_FILE_NAME: &str = "backup-history.json";
const STORAGE_BUCKET: &str = "line-message-images";
const STORAGE_PAGE_SIZE: usize = 100;
const STORAGE_DOWNLOAD_ATTEMPTS: usize = 3;
const PROGRESS_EVENT: &str = "backup-progress";
const ARCHIVE_ROOT: &str = "kawashima-backup";
const DUMP_FILE_NAME: &str = "public.dump";
const MAX_RECOVERY_KEY_FILE_SIZE: u64 = 16 * 1024;
const ENCRYPTION_ALGORITHM: &str = "age X25519";
const RECIPIENT_REPLACEMENT_CONFIRMATION: &str = "公開鍵を変更する";
const CEREMONY_COMPLETION_CONFIRMATION: &str = "復旧鍵の二経路保管と復号を確認した";
const APPROVED_PRODUCTION_AGE_VERSION: &str = "v1.3.2";
const PRODUCTION_KEY_PURPOSE: &str = "Kawashima Motors production backup encryption";

static BACKUP_RUNNING: AtomicBool = AtomicBool::new(false);

#[derive(Default)]
pub(crate) struct RecoveryKeyState(Mutex<Option<x25519::Identity>>);

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct EncryptionRecipientStatus {
    configured: bool,
    state: String,
    recipient: Option<String>,
    fingerprint: Option<String>,
    registered_at: Option<String>,
    registered_by_app_version: Option<String>,
    endpoint_id: Option<String>,
    algorithm: String,
    ceremony_completed: bool,
    ceremony_key_id: Option<String>,
    ceremony_completed_at: Option<String>,
    key_status: Option<PublicKeyStatus>,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct CompleteProductionKeyCeremonyInput {
    key_id: String,
    generated_at: String,
    age_version: String,
    google_drive_stored_at: String,
    external_media_stored_at: String,
    google_drive_verified_at: String,
    external_media_verified_at: String,
    confirmation: String,
}

#[derive(Debug, Clone)]
struct ValidatedEncryptionContext {
    recipient: x25519::Recipient,
    recipient_fingerprint: String,
    key_id: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct RecoveryKeyImportStatus {
    loaded: bool,
    valid: bool,
    fingerprint: String,
    matches_recipient: Option<bool>,
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
    #[serde(default)]
    key_id: String,
    #[serde(default)]
    recipient_fingerprint: String,
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
    pg_restore_version: String,
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
    encryption: String,
    encryption_key_id: String,
    encryption_recipient_fingerprint: String,
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

fn default_google_drive_sync_status() -> String {
    "notVerified".to_string()
}

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
pub(crate) fn get_encryption_recipient_status(app: AppHandle) -> EncryptionRecipientStatus {
    encryption_recipient_status(&app)
}

#[tauri::command]
pub(crate) fn register_encryption_recipient(
    app: AppHandle,
    recipient: String,
    endpoint_id: String,
    maintenance_token: Option<String>,
    maintenance_state: State<'_, super::maintenance::MaintenanceState>,
) -> Result<EncryptionRecipientStatus, String> {
    if super::load_settings_from_disk(&app)?.setup_complete {
        super::maintenance::authorize(&maintenance_state, maintenance_token.as_deref())?;
    }
    let recipient = parse_encryption_recipient(&recipient)?;
    let endpoint_id = validate_endpoint_id(&endpoint_id)?;
    let mut settings = super::load_settings_from_disk(&app)?;
    if recipient_registration_exists_and_matches(&settings, &recipient, &endpoint_id)? {
        return Ok(encryption_recipient_status(&app));
    }
    apply_recipient_registration(&mut settings, &recipient, endpoint_id);
    save_settings_to_disk(&app, &settings)?;
    Ok(encryption_recipient_status(&app))
}

#[tauri::command]
pub(crate) fn replace_encryption_recipient(
    app: AppHandle,
    recipient: String,
    endpoint_id: String,
    expected_current_fingerprint: String,
    confirmation: String,
    maintenance_token: Option<String>,
    maintenance_state: State<'_, super::maintenance::MaintenanceState>,
) -> Result<EncryptionRecipientStatus, String> {
    super::maintenance::authorize(&maintenance_state, maintenance_token.as_deref())?;
    if confirmation != RECIPIENT_REPLACEMENT_CONFIRMATION {
        return Err("公開鍵変更には明示的な保守確認が必要です。".to_string());
    }
    let recipient = parse_encryption_recipient(&recipient)?;
    let endpoint_id = validate_endpoint_id(&endpoint_id)?;
    let mut settings = super::load_settings_from_disk(&app)?;
    let existing = settings
        .encryption_recipient
        .as_deref()
        .ok_or_else(|| "登録済み公開鍵がありません。通常登録を使用してください。".to_string())?;
    let existing = parse_encryption_recipient(existing)
        .map_err(|_| "登録済み公開鍵が破損しています。自動上書きしません。".to_string())?;
    if recipient_fingerprint(&existing) != expected_current_fingerprint {
        return Err("現在の公開鍵fingerprintが一致しないため変更を中止しました。".to_string());
    }
    if existing == recipient && settings.endpoint_id.as_deref() == Some(endpoint_id.as_str()) {
        return Ok(encryption_recipient_status(&app));
    }
    apply_recipient_registration(&mut settings, &recipient, endpoint_id);
    save_settings_to_disk(&app, &settings)?;
    Ok(encryption_recipient_status(&app))
}

#[tauri::command]
pub(crate) fn complete_production_key_ceremony(
    app: AppHandle,
    input: CompleteProductionKeyCeremonyInput,
    maintenance_token: Option<String>,
    maintenance_state: State<'_, super::maintenance::MaintenanceState>,
) -> Result<EncryptionRecipientStatus, String> {
    super::maintenance::authorize(&maintenance_state, maintenance_token.as_deref())?;
    let mut settings = super::load_settings_from_disk(&app)?;
    record_completed_ceremony(&mut settings, input, Utc::now())?;
    save_settings_to_disk(&app, &settings)?;
    Ok(encryption_recipient_status(&app))
}

#[tauri::command]
pub(crate) fn import_recovery_key(
    app: AppHandle,
    path: String,
    state: State<'_, RecoveryKeyState>,
    maintenance_token: Option<String>,
    maintenance_state: State<'_, super::maintenance::MaintenanceState>,
) -> Result<RecoveryKeyImportStatus, String> {
    super::maintenance::authorize(&maintenance_state, maintenance_token.as_deref())?;
    {
        let mut loaded = state
            .0
            .lock()
            .map_err(|_| "復旧鍵の状態を更新できませんでした。".to_string())?;
        *loaded = None;
    }
    let identity = read_recovery_identity_file(Path::new(path.trim()))?;
    let fingerprint = identity_fingerprint(&identity);
    let settings = super::load_settings_from_disk(&app)?;
    let matches_recipient = settings
        .encryption_recipient
        .as_deref()
        .and_then(|value| parse_encryption_recipient(value).ok())
        .map(|recipient| recipient_fingerprint(&recipient) == fingerprint);
    let mut loaded = state
        .0
        .lock()
        .map_err(|_| "復旧鍵の状態を更新できませんでした。".to_string())?;
    *loaded = Some(identity);
    Ok(RecoveryKeyImportStatus {
        loaded: true,
        valid: true,
        fingerprint,
        matches_recipient,
    })
}

#[tauri::command]
pub(crate) fn clear_imported_recovery_key(
    state: State<'_, RecoveryKeyState>,
) -> Result<(), String> {
    let mut identity = state
        .0
        .lock()
        .map_err(|_| "復旧鍵の状態を更新できませんでした。".to_string())?;
    *identity = None;
    Ok(())
}

#[tauri::command]
pub(crate) fn verify_backup_file(
    app: AppHandle,
    path: String,
    state: State<'_, RecoveryKeyState>,
    maintenance_token: Option<String>,
    maintenance_state: State<'_, super::maintenance::MaintenanceState>,
) -> Result<BackupVerificationResult, String> {
    super::maintenance::authorize(&maintenance_state, maintenance_token.as_deref())?;
    let identity = state
        .0
        .lock()
        .map_err(|_| "復旧鍵の状態を読み込めませんでした。".to_string())?
        .take()
        .ok_or_else(|| "有効な復旧鍵を先に読み込んでください。".to_string())?;
    let runtime = postgres_runtime::PostgresRuntime::resolve(&app)?;
    verify_backup_file_with_identity(
        Path::new(path.trim()),
        &identity,
        "復旧鍵",
        &runtime.pg_restore,
    )
}

#[tauri::command]
pub(crate) fn load_backup_history(app: AppHandle) -> Result<Vec<BackupHistoryEntry>, String> {
    read_history(&app)
}

#[tauri::command]
pub(crate) async fn run_backup(app: AppHandle) -> Result<BackupResult, String> {
    let _guard = BackupRunGuard::acquire()?;
    let settings = super::load_settings_from_disk(&app)?;
    let failed_started_at = Utc::now();
    let result = execute_backup(app.clone(), settings.clone()).await;
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
            recipient_fingerprint: settings
                .encryption_recipient_fingerprint
                .clone()
                .unwrap_or_default(),
            plaintext_archive_sha256: String::new(),
            application_version: env!("CARGO_PKG_VERSION").to_string(),
            key_id: settings
                .production_key_ceremony
                .as_ref()
                .map(|metadata| metadata.key_id.clone())
                .unwrap_or_default(),
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
    let encryption = validate_backup_prerequisites(&app, &settings)?;
    let recipient = encryption.recipient;
    let recipient_fingerprint = encryption.recipient_fingerprint;
    let key_id = encryption.key_id;
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
        fs::create_dir_all(directory).map_err(|error| sanitized_error(error))?;
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
    fs::write(&ca_path, SUPABASE_ROOT_CA_PEM).map_err(|error| sanitized_error(error))?;
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
        postgres_version: db_info.0,
        connection_mode: connection_mode_label(&settings.connection_mode).to_string(),
        schema: "public".to_string(),
        dump_file: format!("database/{DUMP_FILE_NAME}"),
        dump_format: "PostgreSQL custom".to_string(),
        dump_size,
        dump_sha256,
        public_table_count: db_info.1,
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
        encryption: ENCRYPTION_ALGORITHM.to_string(),
        encryption_key_id: key_id.clone(),
        encryption_recipient_fingerprint: recipient_fingerprint.clone(),
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
    encrypt_file(&tar_path, &encrypted_path, &recipient)?;
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
    verify_checksum_manifest(&source_root, &verification_dir.join("sha256sums.txt"))?;
    emit_progress(
        &app,
        "verify",
        "complete",
        "公開鍵暗号化と事前整合性を確認しました。",
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
        key_id,
        recipient_fingerprint,
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

fn encryption_recipient_status(app: &AppHandle) -> EncryptionRecipientStatus {
    let settings = super::load_settings_from_disk(app).unwrap_or_default();
    let parsed = settings
        .encryption_recipient
        .as_deref()
        .map(parse_encryption_recipient);
    let (recipient, fingerprint, state) = match parsed {
        Some(Ok(recipient)) => {
            let fingerprint = recipient_fingerprint(&recipient);
            if settings.encryption_recipient_fingerprint.as_deref() == Some(fingerprint.as_str()) {
                (Some(recipient.to_string()), Some(fingerprint), "configured")
            } else {
                (None, None, "metadataMismatch")
            }
        }
        Some(Err(_)) => (None, None, "invalid"),
        None => (None, None, "missing"),
    };
    let ceremony = settings.production_key_ceremony.as_ref();
    let ledger_entry = ceremony.and_then(|metadata| {
        settings
            .public_key_ledger
            .iter()
            .find(|entry| entry.key_id == metadata.key_id)
    });
    let ceremony_completed = validate_backup_encryption_authorization(&settings).is_ok();
    EncryptionRecipientStatus {
        configured: state == "configured",
        state: state.to_string(),
        recipient,
        fingerprint,
        registered_at: settings.encryption_recipient_registered_at,
        registered_by_app_version: settings.encryption_recipient_registered_by_app_version,
        endpoint_id: settings.endpoint_id,
        algorithm: settings
            .encryption_algorithm
            .unwrap_or_else(|| ENCRYPTION_ALGORITHM.to_string()),
        ceremony_completed,
        ceremony_key_id: ceremony.map(|metadata| metadata.key_id.clone()),
        ceremony_completed_at: ceremony.map(|metadata| metadata.completed_at.clone()),
        key_status: ledger_entry.map(|entry| entry.status.clone()),
    }
}

fn parse_encryption_recipient(value: &str) -> Result<x25519::Recipient, String> {
    let trimmed = value.trim();
    if trimmed.is_empty()
        || trimmed.lines().count() != 1
        || trimmed.split_whitespace().count() != 1
        || !trimmed.starts_with("age1")
    {
        return Err("有効なage X25519公開鍵を入力してください。".to_string());
    }
    x25519::Recipient::from_str(trimmed)
        .map_err(|_| "有効なage X25519公開鍵を入力してください。".to_string())
}

fn validate_endpoint_id(value: &str) -> Result<String, String> {
    let value = value.trim();
    let valid = (3..=64).contains(&value.len())
        && value.chars().all(|character| {
            character.is_ascii_lowercase() || character.is_ascii_digit() || character == '-'
        })
        && value
            .chars()
            .next()
            .is_some_and(|character| character.is_ascii_lowercase())
        && value
            .chars()
            .last()
            .is_some_and(|character| character.is_ascii_alphanumeric());
    if !valid {
        return Err(
            "endpointIdは英小文字で始まる3〜64文字の英小文字・数字・ハイフンで指定してください。"
                .to_string(),
        );
    }
    Ok(value.to_string())
}

fn identity_fingerprint(identity: &x25519::Identity) -> String {
    recipient_fingerprint(&identity.to_public())
}

fn recipient_fingerprint(recipient: &x25519::Recipient) -> String {
    sha256_bytes(recipient.to_string().as_bytes())
}

fn apply_recipient_registration(
    settings: &mut BackupToolSettings,
    recipient: &x25519::Recipient,
    endpoint_id: String,
) {
    let fingerprint = recipient_fingerprint(recipient);
    let recipient_string = recipient.to_string();
    let previous_fingerprint = settings.encryption_recipient_fingerprint.clone();
    let registration_changed = settings
        .encryption_recipient
        .as_deref()
        .is_some_and(|value| value != recipient_string)
        || previous_fingerprint
            .as_deref()
            .is_some_and(|value| value != fingerprint)
        || settings
            .production_key_ceremony
            .as_ref()
            .is_some_and(|metadata| metadata.recipient_fingerprint != fingerprint);
    let retired_other_key = retire_other_active_ledger_keys(settings, &fingerprint, Utc::now());
    if registration_changed || retired_other_key {
        settings.production_key_ceremony = None;
    }
    settings.encryption_recipient = Some(recipient_string);
    settings.encryption_recipient_fingerprint = Some(fingerprint);
    settings.encryption_recipient_registered_at =
        Some(Utc::now().to_rfc3339_opts(SecondsFormat::Secs, true));
    settings.encryption_recipient_registered_by_app_version =
        Some(env!("CARGO_PKG_VERSION").to_string());
    settings.endpoint_id = Some(endpoint_id);
    settings.encryption_algorithm = Some(ENCRYPTION_ALGORITHM.to_string());
}

fn retire_other_active_ledger_keys(
    settings: &mut BackupToolSettings,
    current_fingerprint: &str,
    retired_at: DateTime<Utc>,
) -> bool {
    let retired_at = retired_at.to_rfc3339_opts(SecondsFormat::Secs, true);
    let mut retired = false;
    for entry in &mut settings.public_key_ledger {
        if entry.fingerprint != current_fingerprint && entry.status == PublicKeyStatus::Active {
            entry.status = PublicKeyStatus::Retired;
            entry.retired_at = Some(retired_at.clone());
            retired = true;
        }
    }
    retired
}

fn record_completed_ceremony(
    settings: &mut BackupToolSettings,
    input: CompleteProductionKeyCeremonyInput,
    completed_at: DateTime<Utc>,
) -> Result<(), String> {
    if input.confirmation != CEREMONY_COMPLETION_CONFIRMATION {
        return Err("鍵式完了記録には二経路の保管・復号を実施した明示確認が必要です。".to_string());
    }
    if settings.production_key_ceremony.is_some() {
        return Err("現在のrecipientには本番鍵式の完了記録がすでに存在します。".to_string());
    }
    let recipient = validate_registered_recipient(settings)?;
    let fingerprint = recipient_fingerprint(&recipient);
    let key_id = validate_key_id(&input.key_id)?;
    if input.age_version.trim() != APPROVED_PRODUCTION_AGE_VERSION {
        return Err(format!(
            "本番鍵式のage versionは{APPROVED_PRODUCTION_AGE_VERSION}を指定してください。"
        ));
    }
    let generated_at = validate_ceremony_timestamp("鍵生成日時", &input.generated_at)?;
    let google_drive_stored_at =
        validate_ceremony_timestamp("Google Drive保管確認日時", &input.google_drive_stored_at)?;
    let external_media_stored_at =
        validate_ceremony_timestamp("外部媒体保管確認日時", &input.external_media_stored_at)?;
    let google_drive_verified_at = validate_ceremony_timestamp(
        "Google Drive復旧鍵検証日時",
        &input.google_drive_verified_at,
    )?;
    let external_media_verified_at =
        validate_ceremony_timestamp("外部媒体復旧鍵検証日時", &input.external_media_verified_at)?;
    if google_drive_stored_at < generated_at
        || external_media_stored_at < generated_at
        || google_drive_verified_at < google_drive_stored_at
        || external_media_verified_at < external_media_stored_at
        || completed_at < google_drive_verified_at
        || completed_at < external_media_verified_at
        || completed_at < generated_at
    {
        return Err("鍵式日時の前後関係を確認してください。".to_string());
    }
    if settings
        .public_key_ledger
        .iter()
        .any(|entry| entry.key_id == key_id)
    {
        return Err("同じkey IDの公開鍵台帳エントリがすでに存在します。".to_string());
    }
    if settings
        .public_key_ledger
        .iter()
        .any(|entry| entry.status == PublicKeyStatus::Active && entry.fingerprint != fingerprint)
    {
        return Err(
            "別のactive鍵が公開鍵台帳に残っています。recipient変更手順を確認してください。"
                .to_string(),
        );
    }

    let generated_at = generated_at.to_rfc3339_opts(SecondsFormat::Secs, true);
    let age_version = input.age_version.trim().to_string();
    settings.public_key_ledger.push(PublicKeyLedgerEntry {
        key_id: key_id.clone(),
        public_recipient: recipient.to_string(),
        fingerprint: fingerprint.clone(),
        generated_at: generated_at.clone(),
        age_version: age_version.clone(),
        purpose: PRODUCTION_KEY_PURPOSE.to_string(),
        status: PublicKeyStatus::Active,
        retired_at: None,
    });
    settings.production_key_ceremony = Some(ProductionKeyCeremonyMetadata {
        key_id,
        public_recipient: recipient.to_string(),
        recipient_fingerprint: fingerprint,
        generated_at,
        age_version,
        google_drive_stored_at: google_drive_stored_at.to_rfc3339_opts(SecondsFormat::Secs, true),
        external_media_stored_at: external_media_stored_at
            .to_rfc3339_opts(SecondsFormat::Secs, true),
        google_drive_verified_at: google_drive_verified_at
            .to_rfc3339_opts(SecondsFormat::Secs, true),
        external_media_verified_at: external_media_verified_at
            .to_rfc3339_opts(SecondsFormat::Secs, true),
        completed_at: completed_at.to_rfc3339_opts(SecondsFormat::Secs, true),
        recorded_by_app_version: env!("CARGO_PKG_VERSION").to_string(),
    });
    Ok(())
}

fn validate_key_id(value: &str) -> Result<String, String> {
    let value = value.trim();
    let valid = (3..=64).contains(&value.len())
        && value.chars().all(|character| {
            character.is_ascii_lowercase() || character.is_ascii_digit() || character == '-'
        })
        && value
            .chars()
            .next()
            .is_some_and(|character| character.is_ascii_lowercase())
        && value
            .chars()
            .last()
            .is_some_and(|character| character.is_ascii_alphanumeric());
    if !valid {
        return Err(
            "key IDは英小文字で始まる3〜64文字の英小文字・数字・ハイフンで指定してください。"
                .to_string(),
        );
    }
    Ok(value.to_string())
}

fn validate_ceremony_timestamp(label: &str, value: &str) -> Result<DateTime<Utc>, String> {
    DateTime::parse_from_rfc3339(value.trim())
        .map(|value| value.with_timezone(&Utc))
        .map_err(|_| format!("{label}はRFC 3339形式で入力してください。"))
}

fn recipient_registration_exists_and_matches(
    settings: &BackupToolSettings,
    recipient: &x25519::Recipient,
    endpoint_id: &str,
) -> Result<bool, String> {
    let Some(existing) = settings.encryption_recipient.as_deref() else {
        return Ok(false);
    };
    let existing = parse_encryption_recipient(existing).map_err(|_| {
        "登録済み公開鍵が破損しています。自動上書きせず保守担当へ連絡してください。".to_string()
    })?;
    if existing != *recipient || settings.endpoint_id.as_deref() != Some(endpoint_id) {
        return Err("異なる公開鍵またはendpointIdは通常登録では上書きできません。保守操作を使用してください。".to_string());
    }
    Ok(true)
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
    let content = Zeroizing::new(
        fs::read_to_string(path)
            .map_err(|_| "復旧鍵ファイルを読み込めませんでした。".to_string())?,
    );
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

fn validate_backup_prerequisites(
    app: &AppHandle,
    settings: &BackupToolSettings,
) -> Result<ValidatedEncryptionContext, String> {
    super::validate_settings(settings)?;
    if !settings.setup_complete {
        return Err("初回セットアップを完了してください。".to_string());
    }
    let encryption = validate_backup_encryption_authorization(settings)?;
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

fn validate_backup_encryption_authorization(
    settings: &BackupToolSettings,
) -> Result<ValidatedEncryptionContext, String> {
    let recipient = validate_registered_recipient(settings)?;
    let fingerprint = recipient_fingerprint(&recipient);
    let ceremony = settings
        .production_key_ceremony
        .as_ref()
        .ok_or_else(|| "本番鍵式の完了記録がないためバックアップを開始できません。".to_string())?;
    if ceremony.public_recipient != recipient.to_string()
        || ceremony.recipient_fingerprint != fingerprint
    {
        return Err(
            "本番鍵式のfingerprintが現在のage公開鍵と一致しないためバックアップを開始できません。"
                .to_string(),
        );
    }
    let ledger = settings
        .public_key_ledger
        .iter()
        .find(|entry| entry.key_id == ceremony.key_id)
        .ok_or_else(|| "本番鍵式に対応する公開鍵台帳エントリがありません。".to_string())?;
    if ledger.status != PublicKeyStatus::Active || ledger.retired_at.is_some() {
        return Err("retired鍵では新しいバックアップを作成できません。".to_string());
    }
    if ledger.public_recipient != recipient.to_string()
        || ledger.fingerprint != fingerprint
        || ledger.generated_at != ceremony.generated_at
        || ledger.age_version != ceremony.age_version
        || ledger.age_version != APPROVED_PRODUCTION_AGE_VERSION
        || ledger.purpose != PRODUCTION_KEY_PURPOSE
    {
        return Err("本番鍵式metadata、公開鍵台帳、現在のage公開鍵が一致しません。".to_string());
    }
    for (label, value) in [
        ("鍵生成日時", ceremony.generated_at.as_str()),
        (
            "Google Drive保管確認日時",
            ceremony.google_drive_stored_at.as_str(),
        ),
        (
            "外部媒体保管確認日時",
            ceremony.external_media_stored_at.as_str(),
        ),
        (
            "Google Drive復旧鍵検証日時",
            ceremony.google_drive_verified_at.as_str(),
        ),
        (
            "外部媒体復旧鍵検証日時",
            ceremony.external_media_verified_at.as_str(),
        ),
        ("鍵式完了日時", ceremony.completed_at.as_str()),
    ] {
        validate_ceremony_timestamp(label, value)?;
    }
    Ok(ValidatedEncryptionContext {
        recipient,
        recipient_fingerprint: fingerprint,
        key_id: ledger.key_id.clone(),
    })
}

pub(crate) fn validate_registered_recipient(
    settings: &BackupToolSettings,
) -> Result<x25519::Recipient, String> {
    let recipient = parse_encryption_recipient(
        settings
            .encryption_recipient
            .as_deref()
            .ok_or_else(|| "age公開鍵が未設定です。".to_string())?,
    )?;
    let fingerprint = recipient_fingerprint(&recipient);
    if settings.encryption_recipient_fingerprint.as_deref() != Some(fingerprint.as_str()) {
        return Err(
            "age公開鍵fingerprintが設定と一致しません。自動修復せず保守担当へ連絡してください。"
                .to_string(),
        );
    }
    validate_endpoint_id(settings.endpoint_id.as_deref().unwrap_or_default())?;
    if settings.encryption_algorithm.as_deref() != Some(ENCRYPTION_ALGORITHM) {
        return Err("暗号化方式の設定が一致しません。".to_string());
    }
    Ok(recipient)
}

fn archive_file_name(endpoint_id: &str, backup_id: &str) -> String {
    format!("kawashima-backup-{endpoint_id}-{backup_id}.tar.age")
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
            fs::create_dir_all(parent).map_err(|error| sanitized_error(error))?;
        }
        let bytes =
            download_storage_object_with_retry(&client, headers, &base, &object.path).await?;
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

fn encrypt_file(input: &Path, output: &Path, recipient: &x25519::Recipient) -> Result<(), String> {
    let encryptor = Encryptor::with_recipients(std::iter::once(recipient as &dyn age::Recipient))
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

fn validate_encrypted_envelope(encrypted: &Path) -> Result<(), String> {
    let reader = BufReader::new(File::open(encrypted).map_err(|error| sanitized_error(error))?);
    Decryptor::new_buffered(reader)
        .map(|_| ())
        .map_err(|_| "age暗号化ファイルの形式を確認できませんでした。".to_string())
}

fn verify_backup_file_with_identity(
    encrypted: &Path,
    identity: &x25519::Identity,
    source_label: &str,
    pg_restore: &Path,
) -> Result<BackupVerificationResult, String> {
    if !encrypted.is_file() {
        return Err("暗号化バックアップファイルを読み込めませんでした。".to_string());
    }
    let temp = file_security::PrivateTempDir::new("kawashima-backup-verify-")?;
    let temp_path = temp.path().to_path_buf();
    let verification = verify_encrypted_backup(encrypted, identity, temp.path(), pg_restore);
    let fingerprint = identity_fingerprint(identity);
    temp.close()?;
    if temp_path.exists() {
        return Err("復号確認用の一時ファイルを削除できませんでした。".to_string());
    }
    let structure = verification?;
    Ok(BackupVerificationResult {
        ok: true,
        key_source: source_label.to_string(),
        key_fingerprint: fingerprint,
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
    identity: &x25519::Identity,
    temp_root: &Path,
    pg_restore: &Path,
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
    drop(output);
    let plaintext_archive_sha256 = sha256_file(&decrypted_tar)?;

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
    postgres_runtime::inspect_custom_dump(pg_restore, &root.join("database").join(DUMP_FILE_NAME))?;
    Ok(VerifiedBackupStructure {
        database_dump_present,
        manifests_present,
        storage_present,
        verification_present,
        database_structure_valid: true,
        plaintext_archive_sha256,
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
        file_security::remove_file_with_retry(&partial).map_err(|error| sanitized_error(error))?;
    }
    let result = (|| {
        fs::copy(source, &partial).map_err(|error| sanitized_error(error))?;
        if file_size(source)? != file_size(&partial)? || sha256_file(&partial)? != expected_hash {
            return Err("保存先コピーの整合性確認に失敗しました。".to_string());
        }
        fs::OpenOptions::new()
            .write(true)
            .open(&partial)
            .and_then(|file| file.sync_all())
            .map_err(|error| sanitized_error(error))?;
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
    use age::secrecy::ExposeSecret;
    use tempfile::TempDir;

    fn test_settings(root: &Path) -> BackupToolSettings {
        let recipient = x25519::Identity::generate().to_public();
        BackupToolSettings {
            supabase_project_url: "https://example.supabase.co".to_string(),
            supabase_publishable_key: "publishable-test".to_string(),
            storage_auth_email: "endpoint@nonprod.invalid".to_string(),
            db_host: "example.pooler.supabase.com".to_string(),
            db_port: "5432".to_string(),
            db_name: "postgres".to_string(),
            db_user: "postgres.example".to_string(),
            connection_mode: super::super::ConnectionMode::Session,
            local_backup_path: root.join("local").to_string_lossy().to_string(),
            google_drive_path: root.join("drive").to_string_lossy().to_string(),
            encryption_recipient: Some(recipient.to_string()),
            encryption_recipient_fingerprint: Some(recipient_fingerprint(&recipient)),
            encryption_recipient_registered_at: Some("2026-08-28T00:00:00Z".to_string()),
            encryption_recipient_registered_by_app_version: Some("0.3.0".to_string()),
            endpoint_id: Some("test-endpoint".to_string()),
            encryption_algorithm: Some(ENCRYPTION_ALGORITHM.to_string()),
            public_key_ledger: Vec::new(),
            production_key_ceremony: None,
            setup_complete: true,
            setup_step: 6,
            setup_completed_at: Some("2026-08-28T00:00:00Z".to_string()),
        }
    }

    fn complete_test_ceremony(settings: &mut BackupToolSettings, key_id: &str) {
        let input = CompleteProductionKeyCeremonyInput {
            key_id: key_id.to_string(),
            generated_at: "2026-08-28T00:00:00Z".to_string(),
            age_version: APPROVED_PRODUCTION_AGE_VERSION.to_string(),
            google_drive_stored_at: "2026-08-28T00:05:00Z".to_string(),
            external_media_stored_at: "2026-08-28T00:06:00Z".to_string(),
            google_drive_verified_at: "2026-08-28T00:10:00Z".to_string(),
            external_media_verified_at: "2026-08-28T00:11:00Z".to_string(),
            confirmation: CEREMONY_COMPLETION_CONFIRMATION.to_string(),
        };
        let completed_at = DateTime::parse_from_rfc3339("2026-08-28T00:15:00Z")
            .unwrap()
            .with_timezone(&Utc);
        record_completed_ceremony(settings, input, completed_at).unwrap();
    }

    #[cfg(unix)]
    fn create_test_backup(root: &Path, recipient: &x25519::Recipient) -> PathBuf {
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
        encrypt_file(&archive, &encrypted, recipient).unwrap();
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

    #[test]
    fn age_round_trip_and_wrong_key_failure() {
        let temp = TempDir::new().unwrap();
        let input = temp.path().join("input.tar");
        let encrypted = temp.path().join("input.tar.age");
        fs::write(&input, b"backup contents").unwrap();
        let identity = x25519::Identity::generate();
        encrypt_file(&input, &encrypted, &identity.to_public()).unwrap();
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
    fn recipient_parser_accepts_one_x25519_public_key_only() {
        let recipient = x25519::Identity::generate().to_public().to_string();
        assert!(parse_encryption_recipient(&recipient).is_ok());
        assert!(parse_encryption_recipient(&format!("{recipient}\n{recipient}")).is_err());
        assert!(parse_encryption_recipient("AGE-SECRET-KEY-INVALID").is_err());
        assert!(parse_encryption_recipient("not-an-age-recipient").is_err());
    }

    #[test]
    fn recipient_registration_metadata_tracks_fingerprint_endpoint_and_version() {
        let temp = TempDir::new().unwrap();
        let mut settings = test_settings(temp.path());
        let recipient = x25519::Identity::generate().to_public();
        apply_recipient_registration(&mut settings, &recipient, "mac-secondary".to_string());
        assert_eq!(
            settings.encryption_recipient.as_deref(),
            Some(recipient.to_string().as_str())
        );
        assert_eq!(
            settings.encryption_recipient_fingerprint.as_deref(),
            Some(recipient_fingerprint(&recipient).as_str())
        );
        assert_eq!(settings.endpoint_id.as_deref(), Some("mac-secondary"));
        assert_eq!(
            settings.encryption_algorithm.as_deref(),
            Some(ENCRYPTION_ALGORITHM)
        );
        assert_eq!(
            settings
                .encryption_recipient_registered_by_app_version
                .as_deref(),
            Some(env!("CARGO_PKG_VERSION"))
        );
        assert!(settings.encryption_recipient_registered_at.is_some());
    }

    #[test]
    fn normal_registration_refuses_a_different_recipient_or_endpoint() {
        let temp = TempDir::new().unwrap();
        let settings = test_settings(temp.path());
        let existing =
            parse_encryption_recipient(settings.encryption_recipient.as_deref().unwrap()).unwrap();
        assert!(
            recipient_registration_exists_and_matches(&settings, &existing, "test-endpoint")
                .unwrap()
        );
        assert!(recipient_registration_exists_and_matches(
            &settings,
            &x25519::Identity::generate().to_public(),
            "test-endpoint",
        )
        .is_err());
        assert!(
            recipient_registration_exists_and_matches(&settings, &existing, "other-endpoint")
                .is_err()
        );
    }

    #[test]
    fn production_backup_guard_requires_registered_recipient_and_completed_ceremony() {
        let temp = TempDir::new().unwrap();
        let mut settings = test_settings(temp.path());
        settings.encryption_recipient = None;
        settings.encryption_recipient_fingerprint = None;
        assert!(validate_backup_encryption_authorization(&settings)
            .unwrap_err()
            .contains("age公開鍵が未設定"));

        let recipient = x25519::Identity::generate().to_public();
        apply_recipient_registration(&mut settings, &recipient, "test-endpoint".to_string());
        assert!(validate_backup_encryption_authorization(&settings)
            .unwrap_err()
            .contains("本番鍵式の完了記録がない"));

        complete_test_ceremony(&mut settings, "kawashima-prod-2026-01");
        let validated = validate_backup_encryption_authorization(&settings).unwrap();
        assert_eq!(validated.key_id, "kawashima-prod-2026-01");
        assert_eq!(
            settings
                .production_key_ceremony
                .as_ref()
                .unwrap()
                .public_recipient,
            settings.encryption_recipient.clone().unwrap()
        );
        assert_eq!(
            validated.recipient_fingerprint,
            recipient_fingerprint(&recipient)
        );
    }

    #[test]
    fn recipient_change_retires_old_key_and_requires_a_new_ceremony() {
        let temp = TempDir::new().unwrap();
        let mut settings = test_settings(temp.path());
        complete_test_ceremony(&mut settings, "kawashima-prod-2026-01");
        let old_fingerprint = settings.encryption_recipient_fingerprint.clone().unwrap();

        let replacement = x25519::Identity::generate().to_public();
        apply_recipient_registration(&mut settings, &replacement, "test-endpoint".to_string());

        assert!(settings.production_key_ceremony.is_none());
        let old_entry = settings
            .public_key_ledger
            .iter()
            .find(|entry| entry.fingerprint == old_fingerprint)
            .unwrap();
        assert_eq!(old_entry.status, PublicKeyStatus::Retired);
        assert!(old_entry.retired_at.is_some());
        assert!(validate_backup_encryption_authorization(&settings).is_err());
    }

    #[test]
    fn mismatched_fingerprint_and_retired_key_block_new_backups() {
        let temp = TempDir::new().unwrap();
        let mut settings = test_settings(temp.path());
        complete_test_ceremony(&mut settings, "kawashima-prod-2026-01");

        settings
            .production_key_ceremony
            .as_mut()
            .unwrap()
            .recipient_fingerprint = "0".repeat(64);
        assert!(validate_backup_encryption_authorization(&settings)
            .unwrap_err()
            .contains("fingerprint"));

        settings
            .production_key_ceremony
            .as_mut()
            .unwrap()
            .recipient_fingerprint = settings.encryption_recipient_fingerprint.clone().unwrap();
        settings.public_key_ledger[0].status = PublicKeyStatus::Retired;
        settings.public_key_ledger[0].retired_at = Some("2026-08-29T00:00:00Z".to_string());
        assert!(validate_backup_encryption_authorization(&settings)
            .unwrap_err()
            .contains("retired"));
    }

    #[test]
    fn public_settings_and_backup_manifest_contain_key_tracking_without_secrets() {
        let temp = TempDir::new().unwrap();
        let mut settings = test_settings(temp.path());
        complete_test_ceremony(&mut settings, "kawashima-prod-2026-01");
        let settings_json = serde_json::to_string(&settings).unwrap();
        assert!(!settings_json.contains("AGE-SECRET-KEY-"));
        assert!(!settings_json.to_lowercase().contains("passphrase"));
        assert!(!settings_json.to_lowercase().contains("privatekey"));

        let fingerprint = settings.encryption_recipient_fingerprint.clone().unwrap();
        let manifest = BackupManifest {
            format_version: 2,
            backup_id: "fixture".to_string(),
            created_at: "2026-08-28T00:20:00Z".to_string(),
            application: "Kawashima Motors Backup Tool".to_string(),
            application_version: "0.4.0".to_string(),
            endpoint_id: "test-endpoint".to_string(),
            database_manifest: "manifests/database.json".to_string(),
            storage_manifest: "manifests/storage.json".to_string(),
            checksum_manifest: "verification/sha256sums.txt".to_string(),
            encryption: ENCRYPTION_ALGORITHM.to_string(),
            encryption_key_id: "kawashima-prod-2026-01".to_string(),
            encryption_recipient_fingerprint: fingerprint.clone(),
        };
        let manifest_json = serde_json::to_string(&manifest).unwrap();
        assert!(manifest_json.contains("kawashima-prod-2026-01"));
        assert!(manifest_json.contains(&fingerprint));
        assert!(!manifest_json.contains("AGE-SECRET-KEY-"));
        assert!(!manifest_json.to_lowercase().contains("passphrase"));
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
    fn public_recipient_encrypts_and_matching_recovery_key_verifies_backup() {
        let temp = TempDir::new().unwrap();
        let identity = x25519::Identity::generate();
        let recovery = x25519::Identity::from_str(identity.to_string().expose_secret()).unwrap();
        let encrypted = create_test_backup(temp.path(), &identity.to_public());
        let pg_restore = fake_pg_restore(temp.path());

        let recovery_result =
            verify_backup_file_with_identity(&encrypted, &recovery, "復旧鍵", &pg_restore).unwrap();
        assert!(recovery_result.ok);
        assert!(recovery_result.temporary_files_removed);
        assert!(recovery_result.database_dump_present);
        assert!(recovery_result.manifests_present);
        assert!(recovery_result.storage_present);
        assert!(recovery_result.verification_present);
        assert!(recovery_result.database_structure_valid);
        assert_eq!(recovery_result.plaintext_archive_sha256.len(), 64);
        assert!(verify_backup_file_with_identity(
            &encrypted,
            &x25519::Identity::generate(),
            "復旧鍵",
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
        drop(first);
        assert!(BackupRunGuard::acquire().is_ok());
        BACKUP_RUNNING.store(false, Ordering::SeqCst);
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
        assert!(entry.recipient_fingerprint.is_empty());
        assert!(entry.plaintext_archive_sha256.is_empty());
        assert!(entry.application_version.is_empty());
    }
}
