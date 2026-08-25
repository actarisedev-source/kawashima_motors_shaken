use std::{
    fs,
    fs::OpenOptions,
    io::{Cursor, Write},
    path::{Path, PathBuf},
    time::{SystemTime, UNIX_EPOCH},
};

use keyring::Entry;
use reqwest::header::{HeaderMap, HeaderValue, AUTHORIZATION};
use rustls::{ClientConfig, RootCertStore};
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use tauri::{AppHandle, Manager};
use tokio_postgres::config::SslMode;
use tokio_postgres_rustls::MakeRustlsConnect;

const KEYRING_SERVICE_NAME: &str = "jp.actarise.kawashima.backup";
const ACCOUNT_DB_PASSWORD: &str = "db-password";
const ACCOUNT_SERVICE_ROLE_KEY: &str = "supabase-service-role-key";
const SETTINGS_FILE_NAME: &str = "settings.json";
const MAX_STORAGE_OBJECTS_TO_SCAN: usize = 10_000;
// Supabase official distribution: https://supabase-downloads.s3-ap-southeast-1.amazonaws.com/prod/ssl/prod-ca-2021.crt
const SUPABASE_ROOT_CA_PEM: &[u8] = include_bytes!("../resources/prod-ca-2021.crt");

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct BackupToolSettings {
    supabase_project_url: String,
    db_host: String,
    db_port: String,
    db_name: String,
    db_user: String,
    connection_mode: ConnectionMode,
    local_backup_path: String,
    google_drive_path: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
enum ConnectionMode {
    Direct,
    Session,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct SecretStatus {
    db_password: bool,
    service_role_key: bool,
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

impl Default for BackupToolSettings {
    fn default() -> Self {
        Self {
            supabase_project_url: String::new(),
            db_host: String::new(),
            db_port: "5432".to_string(),
            db_name: "postgres".to_string(),
            db_user: "postgres".to_string(),
            connection_mode: ConnectionMode::Direct,
            local_backup_path: String::new(),
            google_drive_path: String::new(),
        }
    }
}

pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_opener::init())
        .invoke_handler(tauri::generate_handler![
            load_settings,
            save_settings,
            get_secret_status,
            save_secret_values,
            check_database,
            check_storage,
            check_folder,
        ])
        .run(tauri::generate_context!())
        .expect("error while running Kawashima backup tool");
}

#[tauri::command]
fn load_settings(app: AppHandle) -> Result<BackupToolSettings, String> {
    let path = settings_path(&app)?;
    if !path.exists() {
        return Ok(BackupToolSettings::default());
    }
    let content = fs::read_to_string(path).map_err(|error| sanitized_error(error))?;
    serde_json::from_str(&content).map_err(|error| sanitized_error(error))
}

#[tauri::command]
fn save_settings(app: AppHandle, settings: BackupToolSettings) -> Result<(), String> {
    validate_settings(&settings)?;
    let path = settings_path(&app)?;
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent).map_err(|error| sanitized_error(error))?;
    }
    let content = serde_json::to_string_pretty(&settings).map_err(|error| sanitized_error(error))?;
    fs::write(path, content).map_err(|error| sanitized_error(error))
}

#[tauri::command]
fn get_secret_status() -> SecretStatus {
    get_secret_status_from_keyring()
}

#[tauri::command]
fn save_secret_values(db_password: String, service_role_key: String) -> Result<SecretStatus, String> {
    let should_save_db_password = !db_password.trim().is_empty();
    let should_save_service_role_key = !service_role_key.trim().is_empty();
    if !should_save_db_password && !should_save_service_role_key {
        return Err("保存する秘密情報を入力してください。".to_string());
    }

    if !db_password.trim().is_empty() {
        write_secret(ACCOUNT_DB_PASSWORD, db_password.trim())?;
    }
    if !service_role_key.trim().is_empty() {
        write_secret(ACCOUNT_SERVICE_ROLE_KEY, service_role_key.trim())?;
    }

    let status = get_secret_status_from_keyring();
    if should_save_db_password && !status.db_password {
        return Err("DBパスワードをOS資格情報ストアへ保存後に確認できませんでした。".to_string());
    }
    if should_save_service_role_key && !status.service_role_key {
        return Err("Service Role KeyをOS資格情報ストアへ保存後に確認できませんでした。".to_string());
    }
    Ok(status)
}

#[tauri::command]
async fn check_database(settings: BackupToolSettings) -> Result<DbCheckResult, String> {
    validate_settings(&settings)?;
    let password = read_secret(ACCOUNT_DB_PASSWORD)
        .map_err(|_| "DBパスワードが未設定です。OS資格情報ストアへ保存してください。".to_string())?;
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
async fn check_storage(project_url: String, bucket_name: String) -> Result<StorageCheckResult, String> {
    if bucket_name != "line-message-images" {
        return Err("確認対象bucketが正しくありません。".to_string());
    }
    let project_url = normalize_project_url(&project_url)?;
    let service_role_key = read_secret(ACCOUNT_SERVICE_ROLE_KEY).map_err(|_| {
        "Service Role Keyが未設定です。OS資格情報ストアへ保存してください。".to_string()
    })?;
    let client = reqwest::Client::new();
    let headers = storage_headers(&service_role_key)?;

    let bucket_url = format!("{project_url}/storage/v1/bucket/{bucket_name}");
    let bucket_response = client
        .get(bucket_url)
        .headers(headers.clone())
        .send()
        .await
        .map_err(|error| storage_error_message(&error.to_string()))?;

    if bucket_response.status().as_u16() == 404 {
        return Ok(StorageCheckResult {
            ok: false,
            bucket_exists: false,
            bucket_public: None,
            object_count_estimate: None,
            message: "bucketが見つかりません。".to_string(),
        });
    }
    if !bucket_response.status().is_success() {
        return Err(storage_error_message(&format!(
            "Storage bucket確認に失敗しました: {}",
            bucket_response.status()
        )));
    }
    let bucket_json: Value = bucket_response
        .json()
        .await
        .map_err(|error| storage_error_message(&error.to_string()))?;
    let bucket_public = bucket_json.get("public").and_then(Value::as_bool);

    let object_count = count_storage_objects(&client, &headers, &project_url, &bucket_name, "").await?;
    Ok(StorageCheckResult {
        ok: true,
        bucket_exists: true,
        bucket_public,
        object_count_estimate: Some(object_count),
        message: "Storage接続成功".to_string(),
    })
}

#[tauri::command]
fn check_folder(path: String) -> FolderCheckResult {
    let trimmed = path.trim().to_string();
    if trimmed.is_empty() {
        return FolderCheckResult {
            ok: false,
            path: trimmed,
            writable: false,
            message: "フォルダを選択してください。".to_string(),
        };
    }
    let folder = Path::new(&trimmed);
    if !folder.is_dir() {
        return FolderCheckResult {
            ok: false,
            path: trimmed,
            writable: false,
            message: "フォルダが存在しません。".to_string(),
        };
    }

    match write_probe_file(folder) {
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
    }
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
        .map_err(|error| sanitized_error(error))
}

fn validate_settings(settings: &BackupToolSettings) -> Result<(), String> {
    match settings.connection_mode {
        ConnectionMode::Direct | ConnectionMode::Session => {}
    }
    if settings.db_port.parse::<u16>().is_err() {
        return Err("DB portは数値で入力してください。".to_string());
    }
    Ok(())
}

fn build_db_config(
    settings: &BackupToolSettings,
    password: &str,
) -> Result<tokio_postgres::Config, String> {
    if settings.db_host.trim().is_empty()
        || settings.db_user.trim().is_empty()
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
        .user(settings.db_user.trim())
        .password(password)
        .ssl_mode(SslMode::Require)
        .application_name("kawashima_backup_tool_phase1");
    Ok(config)
}

fn build_database_tls_connector() -> Result<MakeRustlsConnect, String> {
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

fn write_secret(key: &str, value: &str) -> Result<(), String> {
    Entry::new(KEYRING_SERVICE_NAME, key)
        .map_err(|_| "OS資格情報ストアを開けませんでした。".to_string())?
        .set_password(value)
        .map_err(|_| "秘密情報の保存に失敗しました。".to_string())
}

fn read_secret(key: &str) -> Result<String, String> {
    Entry::new(KEYRING_SERVICE_NAME, key)
        .map_err(|_| "OS資格情報ストアを開けませんでした。".to_string())?
        .get_password()
        .map_err(|_| "秘密情報が未設定です。".to_string())
}

fn get_secret_status_from_keyring() -> SecretStatus {
    SecretStatus {
        db_password: read_secret(ACCOUNT_DB_PASSWORD).is_ok_and(|value| !value.is_empty()),
        service_role_key: read_secret(ACCOUNT_SERVICE_ROLE_KEY).is_ok_and(|value| !value.is_empty()),
    }
}

fn storage_headers(service_role_key: &str) -> Result<HeaderMap, String> {
    let mut headers = HeaderMap::new();
    headers.insert(
        "apikey",
        HeaderValue::from_str(service_role_key).map_err(|_| "Service Role Keyの形式を確認してください。".to_string())?,
    );
    headers.insert(
        AUTHORIZATION,
        HeaderValue::from_str(&format!("Bearer {service_role_key}"))
            .map_err(|_| "Service Role Keyの形式を確認してください。".to_string())?,
    );
    Ok(headers)
}

fn normalize_project_url(project_url: &str) -> Result<String, String> {
    let trimmed = project_url.trim().trim_end_matches('/');
    if !(trimmed.starts_with("https://") || trimmed.starts_with("http://localhost")) {
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

fn connection_mode_label(mode: &ConnectionMode) -> &'static str {
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
    format!("Storage接続を確認できません。Project URLとService Role Keyを確認してください。 {}", sanitized_error(error))
}

fn sanitized_error(error: impl ToString) -> String {
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
    fn invalid_ca_is_rejected() {
        let result = rustls_pemfile::certs(&mut Cursor::new(b"not a certificate"))
            .collect::<Result<Vec<_>, _>>();
        assert!(result.is_ok_and(|certificates| certificates.is_empty()));
    }
}
