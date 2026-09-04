use std::{
    fs,
    fs::{File, OpenOptions},
    io::{Cursor, Write},
    path::{Path, PathBuf},
    sync::Mutex,
    time::{Duration, Instant},
    time::{SystemTime, UNIX_EPOCH},
};

use chrono::{SecondsFormat, Utc};
use reqwest::header::HeaderMap;
use rustls::{ClientConfig, RootCertStore};
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use tauri::{AppHandle, Manager};
use tokio_postgres::config::SslMode;
use tokio_postgres_rustls::MakeRustlsConnect;
use zeroize::Zeroizing;

mod backup;
mod credential_store;
mod file_security;
mod maintenance;
mod postgres_runtime;
mod storage_auth;

pub(crate) use credential_store::{
    ACCOUNT_DB_PASSWORD, ACCOUNT_DB_RESTORE_PASSWORD, ACCOUNT_STORAGE_AUTH_PASSWORD,
    ACCOUNT_STORAGE_RESTORE_AUTH_PASSWORD,
};
const SETTINGS_FILE_NAME: &str = "settings.json";
const MAX_STORAGE_OBJECTS_TO_SCAN: usize = 10_000;
const STORAGE_BUCKET_NAME: &str = "line-message-images";
// Supabase official distribution: https://supabase-downloads.s3-ap-southeast-1.amazonaws.com/prod/ssl/prod-ca-2021.crt
pub(crate) const SUPABASE_ROOT_CA_PEM: &[u8] = include_bytes!("../resources/prod-ca-2021.crt");

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct BackupToolSettings {
    pub(crate) supabase_project_url: String,
    #[serde(default)]
    pub(crate) supabase_publishable_key: String,
    #[serde(default)]
    pub(crate) storage_auth_email: String,
    pub(crate) db_host: String,
    pub(crate) db_port: String,
    pub(crate) db_name: String,
    pub(crate) db_user: String,
    #[serde(default)]
    pub(crate) db_restore_user: String,
    pub(crate) connection_mode: ConnectionMode,
    pub(crate) local_backup_path: String,
    pub(crate) google_drive_path: String,
    #[serde(default)]
    pub(crate) storage_restore_auth_email: String,
    #[serde(default)]
    pub(crate) endpoint_id: Option<String>,
    #[serde(default)]
    pub(crate) encryption_algorithm: Option<String>,
    #[serde(default)]
    pub(crate) setup_complete: bool,
    #[serde(default = "default_setup_step")]
    pub(crate) setup_step: u8,
    #[serde(default)]
    pub(crate) setup_completed_at: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) enum ConnectionMode {
    Direct,
    Session,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct SecretStatus {
    db_password: bool,
    storage_auth_password: bool,
    db_restore_password: bool,
    storage_restore_auth_password: bool,
    legacy_service_role_key: bool,
    db_password_state: String,
    storage_auth_password_state: String,
    db_restore_password_state: String,
    storage_restore_auth_password_state: String,
    legacy_service_role_key_state: String,
}

#[derive(Default)]
struct StorageValidationState(Mutex<Option<Instant>>);

impl StorageValidationState {
    fn mark_success(&self) {
        if let Ok(mut verified_at) = self.0.lock() {
            *verified_at = Some(Instant::now());
        }
    }

    fn recently_succeeded(&self) -> bool {
        self.0
            .lock()
            .ok()
            .and_then(|verified_at| *verified_at)
            .is_some_and(|verified_at| verified_at.elapsed() <= Duration::from_secs(10 * 60))
    }
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct DbCheckResult {
    ok: bool,
    connection_mode: String,
    ssl: bool,
    postgres_version: Option<String>,
    public_schema_readable: bool,
    message: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct StorageCheckResult {
    ok: bool,
    bucket_exists: bool,
    bucket_public: Option<bool>,
    object_count_estimate: Option<usize>,
    message: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct FolderCheckResult {
    ok: bool,
    path: String,
    writable: bool,
    message: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct SetupStatus {
    complete: bool,
    current_step: u8,
    total_steps: u8,
    maintenance_configured: bool,
    platform: String,
    application_version: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct SystemCheckResult {
    ok: bool,
    platform: String,
    application_version: String,
    postgres_runtime_ready: bool,
    private_acl_ready: bool,
    message: String,
}

const fn default_setup_step() -> u8 {
    1
}

impl Default for BackupToolSettings {
    fn default() -> Self {
        Self {
            supabase_project_url: String::new(),
            supabase_publishable_key: String::new(),
            storage_auth_email: String::new(),
            db_host: String::new(),
            db_port: "5432".to_string(),
            db_name: "postgres".to_string(),
            db_user: "postgres".to_string(),
            db_restore_user: String::new(),
            connection_mode: ConnectionMode::Direct,
            local_backup_path: String::new(),
            google_drive_path: String::new(),
            storage_restore_auth_email: String::new(),
            endpoint_id: None,
            encryption_algorithm: Some("age-passphrase".to_string()),
            setup_complete: false,
            setup_step: default_setup_step(),
            setup_completed_at: None,
        }
    }
}

pub fn run() {
    let _ = file_security::cleanup_stale_temp_dirs(std::time::Duration::from_secs(24 * 60 * 60));
    let app = tauri::Builder::default()
        .manage(maintenance::MaintenanceState::default())
        .manage(StorageValidationState::default())
        .plugin(tauri_plugin_dialog::init())
        .invoke_handler(tauri::generate_handler![
            load_settings,
            save_settings,
            get_setup_status,
            check_system,
            set_setup_step,
            complete_setup,
            get_secret_status,
            save_secret_values,
            delete_legacy_service_role_key,
            check_database,
            check_storage,
            check_restore_readiness,
            check_folder,
            backup::backup_is_running,
            backup::get_encryption_status,
            backup::verify_backup_file,
            backup::load_backup_history,
            backup::run_backup,
            backup::restore_is_running,
            backup::run_restore,
            maintenance::get_maintenance_status,
            maintenance::configure_maintenance_passcode,
            maintenance::unlock_maintenance,
            maintenance::lock_maintenance,
        ])
        .build(tauri::generate_context!())
        .expect("error while running Kawashima backup tool");
    app.run(|_, event| {
        if let tauri::RunEvent::ExitRequested { api, .. } = event {
            if backup::backup_is_running() || backup::restore_is_running() {
                api.prevent_exit();
            }
        }
    });
}

#[tauri::command]
fn load_settings(app: AppHandle) -> Result<BackupToolSettings, String> {
    load_settings_from_disk(&app)
}

pub(crate) fn load_settings_from_disk(app: &AppHandle) -> Result<BackupToolSettings, String> {
    let path = settings_path(app)?;
    if !path.exists() {
        return Ok(BackupToolSettings::default());
    }
    let content = fs::read_to_string(path).map_err(sanitized_error)?;
    let mut settings: BackupToolSettings =
        serde_json::from_str(&content).map_err(sanitized_error)?;
    settings.encryption_algorithm = Some("age-passphrase".to_string());
    Ok(settings)
}

#[tauri::command]
fn save_settings(
    app: AppHandle,
    settings: BackupToolSettings,
    maintenance_token: Option<String>,
    maintenance_state: tauri::State<'_, maintenance::MaintenanceState>,
) -> Result<(), String> {
    validate_settings(&settings)?;
    let existing = load_settings_from_disk(&app)?;
    if existing.setup_complete {
        maintenance::authorize(&maintenance_state, maintenance_token.as_deref())?;
    }
    let settings = normalize_persisted_settings(existing, settings);
    save_settings_to_disk(&app, &settings)
}

fn normalize_persisted_settings(
    existing: BackupToolSettings,
    mut incoming: BackupToolSettings,
) -> BackupToolSettings {
    incoming.encryption_algorithm = Some("age-passphrase".to_string());
    incoming.db_restore_user = incoming.db_restore_user.trim().to_string();
    incoming.storage_restore_auth_email = incoming.storage_restore_auth_email.trim().to_string();
    incoming.setup_complete = existing.setup_complete;
    incoming.setup_step = existing.setup_step;
    incoming.setup_completed_at = existing.setup_completed_at;
    incoming
}

pub(crate) fn save_settings_to_disk(
    app: &AppHandle,
    settings: &BackupToolSettings,
) -> Result<(), String> {
    let path = settings_path(app)?;
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent).map_err(sanitized_error)?;
    }
    let content = serde_json::to_string_pretty(settings).map_err(sanitized_error)?;
    let partial = path.with_extension("json.partial");
    fs::write(&partial, content).map_err(sanitized_error)?;
    File::open(&partial)
        .and_then(|file| file.sync_all())
        .map_err(sanitized_error)?;
    file_security::replace_file(&partial, &path).map_err(sanitized_error)
}

#[tauri::command]
fn get_setup_status(app: AppHandle) -> Result<SetupStatus, String> {
    let settings = load_settings_from_disk(&app)?;
    Ok(setup_status(&settings))
}

#[tauri::command]
fn check_system(app: AppHandle) -> SystemCheckResult {
    let runtime_ready = postgres_runtime::PostgresRuntime::resolve(&app).is_ok();
    let acl_ready =
        file_security::volume_supports_private_acl(&std::env::temp_dir()).unwrap_or(false);
    let platform = if cfg!(all(windows, target_arch = "x86_64")) {
        "Windows x64"
    } else if cfg!(all(target_os = "macos", target_arch = "aarch64")) {
        "macOS Apple Silicon"
    } else {
        "未対応OS"
    };
    SystemCheckResult {
        ok: runtime_ready && acl_ready && platform != "未対応OS",
        platform: platform.to_string(),
        application_version: env!("CARGO_PKG_VERSION").to_string(),
        postgres_runtime_ready: runtime_ready,
        private_acl_ready: acl_ready,
        message: if runtime_ready && acl_ready {
            "システム確認済み"
        } else {
            "必要な実行環境を確認してください。"
        }
        .to_string(),
    }
}

#[tauri::command]
fn set_setup_step(app: AppHandle, step: u8) -> Result<SetupStatus, String> {
    if !(1..=6).contains(&step) {
        return Err("セットアップ手順を確認できません。".to_string());
    }
    let mut settings = load_settings_from_disk(&app)?;
    if settings.setup_complete {
        return Err("初回セットアップは完了しています。".to_string());
    }
    settings.setup_step = step;
    save_settings_to_disk(&app, &settings)?;
    Ok(setup_status(&settings))
}

#[tauri::command]
fn complete_setup(app: AppHandle) -> Result<SetupStatus, String> {
    let mut settings = load_settings_from_disk(&app)?;
    if settings.setup_complete {
        return Ok(setup_status(&settings));
    }
    validate_setup_prerequisites(&settings)?;
    settings.setup_complete = true;
    settings.setup_step = 6;
    settings.setup_completed_at = Some(Utc::now().to_rfc3339_opts(SecondsFormat::Secs, true));
    save_settings_to_disk(&app, &settings)?;
    Ok(setup_status(&settings))
}

fn setup_status(settings: &BackupToolSettings) -> SetupStatus {
    SetupStatus {
        complete: settings.setup_complete,
        current_step: settings.setup_step.clamp(1, 6),
        total_steps: 6,
        maintenance_configured: maintenance::is_configured(),
        platform: if cfg!(windows) {
            "windows-x86_64"
        } else if cfg!(target_os = "macos") {
            "macos"
        } else {
            "unsupported"
        }
        .to_string(),
        application_version: env!("CARGO_PKG_VERSION").to_string(),
    }
}

fn validate_setup_prerequisites(settings: &BackupToolSettings) -> Result<(), String> {
    validate_settings(settings)?;
    if !maintenance::is_configured() {
        return Err("ACTARISE保守ロックを設定してください。".to_string());
    }
    let secrets = get_secret_status_from_keyring();
    if !secrets.db_password || !secrets.storage_auth_password {
        return Err("接続資格情報を設定してください。".to_string());
    }
    if !Path::new(&settings.local_backup_path).is_dir()
        || !Path::new(&settings.google_drive_path).is_dir()
    {
        return Err("2つのバックアップ保存先を確認してください。".to_string());
    }
    validate_endpoint_id(settings.endpoint_id.as_deref().unwrap_or_default())?;
    if settings.encryption_algorithm.as_deref() != Some("age-passphrase") {
        return Err("暗号化方式はage passphrase方式で設定してください。".to_string());
    }
    Ok(())
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
            "端末IDは英小文字で始まる3〜64文字の英小文字・数字・ハイフンで指定してください。"
                .to_string(),
        );
    }
    Ok(value.to_string())
}

#[tauri::command]
fn get_secret_status() -> SecretStatus {
    get_secret_status_from_keyring()
}

#[tauri::command]
fn save_secret_values(
    db_password: String,
    storage_auth_password: String,
    db_restore_password: String,
    storage_restore_auth_password: String,
    maintenance_token: Option<String>,
    app: AppHandle,
    maintenance_state: tauri::State<'_, maintenance::MaintenanceState>,
) -> Result<SecretStatus, String> {
    if load_settings_from_disk(&app)?.setup_complete {
        maintenance::authorize(&maintenance_state, maintenance_token.as_deref())?;
    }
    let db_password = Zeroizing::new(db_password);
    let storage_auth_password = Zeroizing::new(storage_auth_password);
    let db_restore_password = Zeroizing::new(db_restore_password);
    let storage_restore_auth_password = Zeroizing::new(storage_restore_auth_password);
    let should_save_db_password = !db_password.trim().is_empty();
    let should_save_storage_auth_password = !storage_auth_password.trim().is_empty();
    let should_save_db_restore_password = !db_restore_password.trim().is_empty();
    let should_save_storage_restore_auth_password =
        !storage_restore_auth_password.trim().is_empty();
    if !should_save_db_password
        && !should_save_storage_auth_password
        && !should_save_db_restore_password
        && !should_save_storage_restore_auth_password
    {
        return Err("保存する秘密情報を入力してください。".to_string());
    }

    if !db_password.trim().is_empty() {
        credential_store::write_secret_explicit(ACCOUNT_DB_PASSWORD, db_password.trim())
            .map_err(|error| error.user_message("DBパスワード"))?;
    }
    if !storage_auth_password.trim().is_empty() {
        credential_store::write_secret_explicit(
            ACCOUNT_STORAGE_AUTH_PASSWORD,
            storage_auth_password.trim(),
        )
        .map_err(|error| error.user_message("Storage読み取り用パスワード"))?;
    }
    if !db_restore_password.trim().is_empty() {
        credential_store::write_secret_explicit(
            ACCOUNT_DB_RESTORE_PASSWORD,
            db_restore_password.trim(),
        )
        .map_err(|error| error.user_message("DB復旧用パスワード"))?;
    }
    if !storage_restore_auth_password.trim().is_empty() {
        credential_store::write_secret_explicit(
            ACCOUNT_STORAGE_RESTORE_AUTH_PASSWORD,
            storage_restore_auth_password.trim(),
        )
        .map_err(|error| error.user_message("Storage復旧用パスワード"))?;
    }

    let status = get_secret_status_from_keyring();
    if should_save_db_password && !status.db_password {
        return Err("DBパスワードをOS資格情報ストアへ保存後に確認できませんでした。".to_string());
    }
    if should_save_storage_auth_password && !status.storage_auth_password {
        return Err(
            "Storage読み取り用パスワードをOS資格情報ストアへ保存後に確認できませんでした。"
                .to_string(),
        );
    }
    if should_save_db_restore_password && !status.db_restore_password {
        return Err(
            "DB復旧用パスワードをOS資格情報ストアへ保存後に確認できませんでした。".to_string(),
        );
    }
    if should_save_storage_restore_auth_password && !status.storage_restore_auth_password {
        return Err(
            "Storage復旧用パスワードをOS資格情報ストアへ保存後に確認できませんでした。".to_string(),
        );
    }
    Ok(status)
}

#[tauri::command]
async fn check_restore_readiness(
    app: AppHandle,
    maintenance_token: Option<String>,
    maintenance_state: tauri::State<'_, maintenance::MaintenanceState>,
) -> Result<DbCheckResult, String> {
    let settings = settings_for_protected_check(&app, maintenance_token, &maintenance_state)?;
    validate_settings(&settings)?;
    let (user, password) = restore_db_credentials(&settings)?;
    let db_config = build_db_config_for_user(&settings, &user, &password)?;
    let tls = build_database_tls_connector()?;
    let (client, connection_task) = db_config
        .connect(tls)
        .await
        .map_err(|error| db_error_message(&error.to_string(), &settings.connection_mode))?;

    tauri::async_runtime::spawn(async move {
        let _ = connection_task.await;
    });

    let schema_row = client
        .query_one(
            "select exists (select 1 from information_schema.schemata where schema_name = 'public')",
            &[],
        )
        .await
        .map_err(|error| db_error_message(&error.to_string(), &settings.connection_mode))?;
    let public_schema_readable: bool = schema_row.get(0);
    Ok(DbCheckResult {
        ok: public_schema_readable,
        connection_mode: connection_mode_label(&settings.connection_mode).to_string(),
        ssl: true,
        postgres_version: None,
        public_schema_readable,
        message: "復旧用DB接続を確認しました。実際の書き込み権限確認は本番Policy追加後の復旧テストで行います。"
            .to_string(),
    })
}

#[tauri::command]
fn delete_legacy_service_role_key(
    confirmation: String,
    maintenance_token: Option<String>,
    maintenance_state: tauri::State<'_, maintenance::MaintenanceState>,
    validation_state: tauri::State<'_, StorageValidationState>,
) -> Result<SecretStatus, String> {
    maintenance::authorize(&maintenance_state, maintenance_token.as_deref())?;
    if confirmation.trim() != "旧Service Role Keyを削除する" {
        return Err("確認文字列が一致しません。".to_string());
    }
    if !validation_state.recently_succeeded() {
        return Err(
            "新しいStorage読み取り資格情報の接続確認を10分以内に完了してください。".to_string(),
        );
    }
    if credential_store::credential_state(ACCOUNT_STORAGE_AUTH_PASSWORD)
        != credential_store::CredentialState::Stored
    {
        return Err("Storage読み取り用パスワードを確認してください。".to_string());
    }
    credential_store::delete_secret_explicit(credential_store::ACCOUNT_SERVICE_ROLE_KEY)
        .map_err(|error| error.user_message("旧Service Role Key"))?;
    let status = get_secret_status_from_keyring();
    if status.legacy_service_role_key {
        return Err("旧Service Role Keyの削除後確認に失敗しました。".to_string());
    }
    Ok(status)
}

#[tauri::command]
async fn check_database(
    app: AppHandle,
    maintenance_token: Option<String>,
    maintenance_state: tauri::State<'_, maintenance::MaintenanceState>,
) -> Result<DbCheckResult, String> {
    let settings = settings_for_protected_check(&app, maintenance_token, &maintenance_state)?;
    validate_settings(&settings)?;
    let password = Zeroizing::new(read_secret(ACCOUNT_DB_PASSWORD, "DBパスワード")?);
    let db_config = build_db_config(&settings, &password)?;
    let tls = build_database_tls_connector()?;
    let (client, connection_task) = db_config
        .connect(tls)
        .await
        .map_err(|error| db_error_message(&error.to_string(), &settings.connection_mode))?;

    tauri::async_runtime::spawn(async move {
        let _ = connection_task.await;
    });

    let version_row = client
        .query_one("select version()", &[])
        .await
        .map_err(|error| db_error_message(&error.to_string(), &settings.connection_mode))?;
    let version: String = version_row.get(0);

    let schema_row = client
        .query_one(
            "select exists (select 1 from information_schema.schemata where schema_name = 'public')",
            &[],
        )
        .await
        .map_err(|error| db_error_message(&error.to_string(), &settings.connection_mode))?;
    let public_schema_readable: bool = schema_row.get(0);

    Ok(DbCheckResult {
        ok: public_schema_readable,
        connection_mode: connection_mode_label(&settings.connection_mode).to_string(),
        ssl: true,
        postgres_version: Some(summarize_postgres_version(&version)),
        public_schema_readable,
        message: "接続成功".to_string(),
    })
}

#[tauri::command]
async fn check_storage(
    app: AppHandle,
    maintenance_token: Option<String>,
    maintenance_state: tauri::State<'_, maintenance::MaintenanceState>,
    validation_state: tauri::State<'_, StorageValidationState>,
) -> Result<StorageCheckResult, String> {
    let settings = settings_for_protected_check(&app, maintenance_token, &maintenance_state)?;
    let project_url = normalize_project_url(&settings.supabase_project_url)?;
    let storage_auth_password = Zeroizing::new(read_secret(
        ACCOUNT_STORAGE_AUTH_PASSWORD,
        "Storage読み取り用パスワード",
    )?);
    let client = reqwest::Client::new();
    let token = storage_auth::authenticate(&settings, &storage_auth_password).await?;
    let headers = token.headers(&settings.supabase_publishable_key)?;
    storage_auth::verify_bucket_access(&client, &project_url, STORAGE_BUCKET_NAME, &headers)
        .await?;

    let object_count =
        count_storage_objects(&client, &headers, &project_url, STORAGE_BUCKET_NAME, "").await?;
    validation_state.mark_success();
    Ok(StorageCheckResult {
        ok: true,
        bucket_exists: true,
        bucket_public: None,
        object_count_estimate: Some(object_count),
        message: "Storage接続成功".to_string(),
    })
}

#[tauri::command]
fn check_folder(
    app: AppHandle,
    path: String,
    maintenance_token: Option<String>,
    maintenance_state: tauri::State<'_, maintenance::MaintenanceState>,
) -> Result<FolderCheckResult, String> {
    let _ = settings_for_protected_check(&app, maintenance_token, &maintenance_state)?;
    let trimmed = path.trim().to_string();
    if trimmed.is_empty() {
        return Ok(FolderCheckResult {
            ok: false,
            path: trimmed,
            writable: false,
            message: "フォルダを選択してください。".to_string(),
        });
    }
    let folder = Path::new(&trimmed);
    if !folder.is_dir() {
        return Ok(FolderCheckResult {
            ok: false,
            path: trimmed,
            writable: false,
            message: "フォルダが存在しません。".to_string(),
        });
    }

    Ok(match write_probe_file(folder) {
        Ok(()) => FolderCheckResult {
            ok: true,
            path: trimmed,
            writable: true,
            message: "フォルダ確認済み".to_string(),
        },
        Err(message) => FolderCheckResult {
            ok: false,
            path: trimmed,
            writable: false,
            message,
        },
    })
}

fn settings_for_protected_check(
    app: &AppHandle,
    maintenance_token: Option<String>,
    maintenance_state: &tauri::State<'_, maintenance::MaintenanceState>,
) -> Result<BackupToolSettings, String> {
    let settings = load_settings_from_disk(app)?;
    if settings.setup_complete {
        maintenance::authorize(maintenance_state, maintenance_token.as_deref())?;
    }
    Ok(settings)
}

async fn count_storage_objects(
    client: &reqwest::Client,
    headers: &HeaderMap,
    project_url: &str,
    bucket_name: &str,
    prefix: &str,
) -> Result<usize, String> {
    let mut total = 0usize;
    let mut folders = vec![prefix.to_string()];
    while let Some(current_prefix) = folders.pop() {
        let mut offset = 0usize;
        loop {
            let list_url = format!("{project_url}/storage/v1/object/list/{bucket_name}");
            let response = client
                .post(&list_url)
                .headers(headers.clone())
                .json(&json!({
                    "prefix": current_prefix,
                    "limit": 100,
                    "offset": offset,
                    "sortBy": { "column": "name", "order": "asc" }
                }))
                .send()
                .await
                .map_err(|error| storage_error_message(&error.to_string()))?;

            if !response.status().is_success() {
                return Err(storage_error_message(&format!(
                    "Storage object一覧の取得に失敗しました: {}",
                    response.status()
                )));
            }
            let entries: Vec<Value> = response
                .json()
                .await
                .map_err(|error| storage_error_message(&error.to_string()))?;
            if entries.is_empty() {
                break;
            }
            for entry in &entries {
                let name = entry.get("name").and_then(Value::as_str).unwrap_or("");
                let id = entry.get("id").and_then(Value::as_str);
                let metadata = entry.get("metadata");
                if id.is_none() && metadata.is_none() && !name.is_empty() {
                    let next_prefix = if current_prefix.is_empty() {
                        name.to_string()
                    } else {
                        format!("{current_prefix}/{name}")
                    };
                    folders.push(next_prefix);
                } else {
                    total += 1;
                }
                if total >= MAX_STORAGE_OBJECTS_TO_SCAN {
                    return Ok(total);
                }
            }
            if entries.len() < 100 {
                break;
            }
            offset += 100;
        }
    }
    Ok(total)
}

fn settings_path(app: &AppHandle) -> Result<PathBuf, String> {
    app.path()
        .app_config_dir()
        .map(|path| path.join(SETTINGS_FILE_NAME))
        .map_err(sanitized_error)
}

pub(crate) fn validate_settings(settings: &BackupToolSettings) -> Result<(), String> {
    match settings.connection_mode {
        ConnectionMode::Direct | ConnectionMode::Session => {}
    }
    if settings.db_port.parse::<u16>().is_err() {
        return Err("DB portは数値で入力してください。".to_string());
    }
    if settings.supabase_publishable_key.trim().is_empty() {
        return Err("Supabase Publishable Keyを入力してください。".to_string());
    }
    if !settings.storage_auth_email.contains('@') {
        return Err("Storage読み取り用ユーザーのメールアドレスを確認してください。".to_string());
    }
    if !settings.storage_restore_auth_email.trim().is_empty()
        && !settings.storage_restore_auth_email.contains('@')
    {
        return Err("Storage復旧用ユーザーのメールアドレスを確認してください。".to_string());
    }
    Ok(())
}

pub(crate) fn build_db_config(
    settings: &BackupToolSettings,
    password: &str,
) -> Result<tokio_postgres::Config, String> {
    build_db_config_for_user(settings, settings.db_user.trim(), password)
}

pub(crate) fn build_db_config_for_user(
    settings: &BackupToolSettings,
    user: &str,
    password: &str,
) -> Result<tokio_postgres::Config, String> {
    if settings.db_host.trim().is_empty()
        || user.trim().is_empty()
        || settings.db_name.trim().is_empty()
    {
        return Err("DB接続情報を入力してください。".to_string());
    }
    let mut config = tokio_postgres::Config::new();
    config
        .host(settings.db_host.trim())
        .port(
            settings
                .db_port
                .trim()
                .parse::<u16>()
                .map_err(|_| "DB portは数値で入力してください。".to_string())?,
        )
        .dbname(settings.db_name.trim())
        .user(user.trim())
        .password(password)
        .ssl_mode(SslMode::Require)
        .application_name("kawashima_backup_tool_phase1");
    Ok(config)
}

pub(crate) fn restore_db_credentials(
    settings: &BackupToolSettings,
) -> Result<(String, Zeroizing<String>), String> {
    if settings.db_restore_user.trim().is_empty() {
        Ok((
            settings.db_user.trim().to_string(),
            Zeroizing::new(read_secret(ACCOUNT_DB_PASSWORD, "DBパスワード")?),
        ))
    } else {
        Ok((
            settings.db_restore_user.trim().to_string(),
            Zeroizing::new(read_secret(
                ACCOUNT_DB_RESTORE_PASSWORD,
                "DB復旧用パスワード",
            )?),
        ))
    }
}

pub(crate) fn build_database_tls_connector() -> Result<MakeRustlsConnect, String> {
    let native_certificates = rustls_native_certs::load_native_certs();
    let mut roots = RootCertStore::empty();
    roots.add_parsable_certificates(native_certificates.certs);

    let bundled_certificates = rustls_pemfile::certs(&mut Cursor::new(SUPABASE_ROOT_CA_PEM))
        .collect::<Result<Vec<_>, _>>()
        .map_err(|_| "Supabase CA証明書を読み込めませんでした。".to_string())?;
    if bundled_certificates.is_empty() {
        return Err("Supabase CA証明書を読み込めませんでした。".to_string());
    }
    for certificate in bundled_certificates {
        roots
            .add(certificate)
            .map_err(|_| "Supabase CA証明書を読み込めませんでした。".to_string())?;
    }

    let config = ClientConfig::builder()
        .with_root_certificates(roots)
        .with_no_client_auth();
    Ok(MakeRustlsConnect::new(config))
}

pub(crate) fn read_secret(key: &str, label: &str) -> Result<String, String> {
    credential_store::read_secret(key).map_err(|error| error.user_message(label))
}

fn get_secret_status_from_keyring() -> SecretStatus {
    let db_password_state = credential_store::credential_state(ACCOUNT_DB_PASSWORD);
    let storage_auth_password_state =
        credential_store::credential_state(ACCOUNT_STORAGE_AUTH_PASSWORD);
    let db_restore_password_state = credential_store::credential_state(ACCOUNT_DB_RESTORE_PASSWORD);
    let storage_restore_auth_password_state =
        credential_store::credential_state(ACCOUNT_STORAGE_RESTORE_AUTH_PASSWORD);
    let legacy_service_role_key_state =
        credential_store::credential_state(credential_store::ACCOUNT_SERVICE_ROLE_KEY);
    SecretStatus {
        db_password: db_password_state == credential_store::CredentialState::Stored,
        storage_auth_password: storage_auth_password_state
            == credential_store::CredentialState::Stored,
        db_restore_password: db_restore_password_state == credential_store::CredentialState::Stored,
        storage_restore_auth_password: storage_restore_auth_password_state
            == credential_store::CredentialState::Stored,
        legacy_service_role_key: legacy_service_role_key_state
            == credential_store::CredentialState::Stored,
        db_password_state: db_password_state.label().to_string(),
        storage_auth_password_state: storage_auth_password_state.label().to_string(),
        db_restore_password_state: db_restore_password_state.label().to_string(),
        storage_restore_auth_password_state: storage_restore_auth_password_state
            .label()
            .to_string(),
        legacy_service_role_key_state: legacy_service_role_key_state.label().to_string(),
    }
}

pub(crate) fn normalize_project_url(project_url: &str) -> Result<String, String> {
    let trimmed = project_url.trim().trim_end_matches('/');
    let local_http = ["http://localhost", "http://127.0.0.1"]
        .iter()
        .any(|prefix| {
            trimmed.strip_prefix(prefix).is_some_and(|suffix| {
                suffix.is_empty() || suffix.starts_with(':') || suffix.starts_with('/')
            })
        });
    if !(trimmed.starts_with("https://") || local_http) {
        return Err("Supabase Project URLを確認してください。".to_string());
    }
    Ok(trimmed.to_string())
}

fn write_probe_file(folder: &Path) -> Result<(), String> {
    let stamp = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map_err(|_| "時刻の取得に失敗しました。".to_string())?
        .as_millis();
    let path = folder.join(format!(".kawashima-backup-write-check-{stamp}.tmp"));
    let mut file = OpenOptions::new()
        .write(true)
        .create_new(true)
        .open(&path)
        .map_err(|_| "フォルダへ書き込みできません。".to_string())?;
    file.write_all(b"")
        .map_err(|_| "フォルダへ書き込みできません。".to_string())?;
    drop(file);
    fs::remove_file(path).map_err(|_| "一時確認ファイルを削除できませんでした。".to_string())
}

fn summarize_postgres_version(version: &str) -> String {
    version
        .split_whitespace()
        .take(2)
        .collect::<Vec<_>>()
        .join(" ")
}

pub(crate) fn connection_mode_label(mode: &ConnectionMode) -> &'static str {
    match mode {
        ConnectionMode::Direct => "Direct connection",
        ConnectionMode::Session => "Session pooler",
    }
}

fn db_error_message(error: &str, mode: &ConnectionMode) -> String {
    let mode_hint = match mode {
        ConnectionMode::Direct => {
            "Direct connectionで接続できません。IPv6接続またはSession pooler設定を確認してください。"
        }
        ConnectionMode::Session => {
            "Session poolerで接続できません。host、port、user、DBパスワードを確認してください。"
        }
    };
    format!("{mode_hint} {}", sanitized_error(error))
}

fn storage_error_message(error: &str) -> String {
    format!(
        "Storage接続を確認できません。読み取り用ユーザー設定を確認してください。 {}",
        sanitized_error(error)
    )
}

pub(crate) fn sanitized_error(error: impl ToString) -> String {
    let mut text = error.to_string();
    for marker in ["password=", "apikey=", "authorization=", "Bearer "] {
        if let Some(index) = text.to_lowercase().find(&marker.to_lowercase()) {
            text.truncate(index);
            text.push_str("[masked]");
        }
    }
    text
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn bundled_supabase_ca_builds_a_tls_connector() {
        assert!(build_database_tls_connector().is_ok());
    }

    #[test]
    fn project_url_allows_https_and_exact_local_hosts_only() {
        assert!(normalize_project_url("https://example.supabase.co").is_ok());
        assert!(normalize_project_url("http://localhost:55421").is_ok());
        assert!(normalize_project_url("http://127.0.0.1:55421").is_ok());
        assert!(normalize_project_url("http://localhost.evil.invalid").is_err());
        assert!(normalize_project_url("http://127.0.0.1.evil.invalid").is_err());
    }

    #[test]
    fn legacy_settings_load_with_new_storage_fields_unconfigured() {
        let settings: BackupToolSettings = serde_json::from_value(json!({
            "supabaseProjectUrl": "https://example.supabase.co",
            "dbHost": "example.pooler.supabase.com",
            "dbPort": "5432",
            "dbName": "postgres",
            "dbUser": "legacy-user",
            "connectionMode": "session",
            "localBackupPath": "/tmp/local",
            "googleDrivePath": "/tmp/drive"
        }))
        .unwrap();
        assert!(settings.supabase_publishable_key.is_empty());
        assert!(settings.storage_auth_email.is_empty());
    }

    #[test]
    fn invalid_ca_is_rejected() {
        let result = rustls_pemfile::certs(&mut Cursor::new(b"not a certificate"))
            .collect::<Result<Vec<_>, _>>();
        assert!(result.is_ok_and(|certificates| certificates.is_empty()));
    }
}
