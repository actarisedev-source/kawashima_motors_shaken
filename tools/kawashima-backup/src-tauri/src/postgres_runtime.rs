use std::{
    fs,
    path::{Path, PathBuf},
    process::{Command, Output},
};

use serde::Deserialize;
use sha2::{Digest, Sha256};
use tauri::{AppHandle, Manager};

use super::{sanitized_error, BackupToolSettings};

pub(crate) const REQUIRED_POSTGRES_TOOL_MAJOR: u32 = 17;
const WINDOWS_RUNTIME_MANIFEST: &str = "runtime-manifest.json";
const WINDOWS_REQUIRED_FILES: [&str; 11] = [
    "pg_dump.exe",
    "pg_restore.exe",
    "libpq.dll",
    "libintl-9.dll",
    "libiconv-2.dll",
    "libwinpthread-1.dll",
    "liblz4.dll",
    "libzstd.dll",
    "libcrypto-3-x64.dll",
    "libssl-3-x64.dll",
    "vcruntime140.dll",
];

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum RuntimePlatform {
    MacAarch64,
    WindowsX86_64,
}

impl RuntimePlatform {
    fn current() -> Result<Self, String> {
        if cfg!(all(target_os = "windows", target_arch = "x86_64")) {
            Ok(Self::WindowsX86_64)
        } else if cfg!(all(target_os = "macos", target_arch = "aarch64")) {
            Ok(Self::MacAarch64)
        } else {
            Err("このOS向けのPostgreSQL 17 runtimeはまだ同梱されていません。".to_string())
        }
    }

    fn directory(self) -> &'static str {
        match self {
            Self::MacAarch64 => "resources/bin/macos-aarch64",
            Self::WindowsX86_64 => "resources/bin/windows-x86_64",
        }
    }
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct RuntimeManifest {
    postgres_version: String,
    source_url: String,
    files: Vec<RuntimeManifestFile>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct RuntimeManifestFile {
    name: String,
    sha256: String,
}

pub(crate) struct PostgresRuntime {
    pub(crate) pg_dump: PathBuf,
    pub(crate) pg_restore: PathBuf,
    pub(crate) pg_dump_version: String,
    pub(crate) pg_restore_version: String,
}

impl PostgresRuntime {
    pub(crate) fn resolve(app: &AppHandle) -> Result<Self, String> {
        let platform = RuntimePlatform::current()?;
        let runtime_dir = resolve_runtime_directory(app, platform)?;
        validate_runtime_directory(&runtime_dir, platform)?;
        let pg_dump = runtime_dir.join(executable_name("pg_dump", platform));
        let pg_restore = runtime_dir.join(executable_name("pg_restore", platform));
        let pg_dump_version = validate_tool(&pg_dump, "pg_dump")?;
        let pg_restore_version = validate_tool(&pg_restore, "pg_restore")?;
        Ok(Self {
            pg_dump,
            pg_restore,
            pg_dump_version,
            pg_restore_version,
        })
    }
}

pub(crate) fn run_pg_dump(
    executable: &Path,
    settings: &BackupToolSettings,
    password: &str,
    ca_path: &Path,
    output_path: &Path,
) -> Result<(), String> {
    let output = runtime_command(executable)
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
        .env("PGAPPNAME", "kawashima_backup_tool_phase3b")
        .env_remove("PGSERVICE")
        .env_remove("PGPASSFILE")
        .output()
        .map_err(|_| "pg_dumpを起動できませんでした。".to_string())?;
    if !output.status.success() {
        if output_path.exists() {
            let _ = super::file_security::remove_file_with_retry(output_path);
        }
        return Err(format!(
            "データベース取得に失敗しました。 {}",
            sanitized_error(String::from_utf8_lossy(&output.stderr))
        ));
    }
    if !output_path.is_file() || fs::metadata(output_path).map_err(sanitized_error)?.len() == 0 {
        return Err("データベースファイルが生成されませんでした。".to_string());
    }
    Ok(())
}

pub(crate) fn inspect_custom_dump(executable: &Path, dump: &Path) -> Result<(), String> {
    let output = runtime_command(executable)
        .arg("--list")
        .arg(dump)
        .output()
        .map_err(|_| "pg_restoreを起動できませんでした。".to_string())?;
    if !output.status.success() || output.stdout.is_empty() {
        return Err("pg_restoreでcustom dump構造を確認できませんでした。".to_string());
    }
    Ok(())
}

fn resolve_runtime_directory(
    app: &AppHandle,
    platform: RuntimePlatform,
) -> Result<PathBuf, String> {
    let relative = PathBuf::from(platform.directory());
    let bundled = app
        .path()
        .resource_dir()
        .map_err(sanitized_error)?
        .join(&relative);
    if bundled.is_dir() {
        return Ok(bundled);
    }
    let development = Path::new(env!("CARGO_MANIFEST_DIR")).join(relative);
    if development.is_dir() {
        return Ok(development);
    }
    Err("同梱されたPostgreSQL 17 runtimeが見つかりません。".to_string())
}

fn validate_runtime_directory(directory: &Path, platform: RuntimePlatform) -> Result<(), String> {
    match platform {
        RuntimePlatform::MacAarch64 => {
            for file in ["pg_dump", "pg_restore"] {
                if !directory.join(file).is_file() {
                    return Err(format!("同梱された{file} 17が見つかりません。"));
                }
            }
        }
        RuntimePlatform::WindowsX86_64 => validate_windows_runtime(directory)?,
    }
    Ok(())
}

fn validate_windows_runtime(directory: &Path) -> Result<(), String> {
    for file in WINDOWS_REQUIRED_FILES {
        if !directory.join(file).is_file() {
            return Err(format!(
                "Windows PostgreSQL runtimeの必要ファイルが不足しています: {file}"
            ));
        }
    }
    let manifest_path = directory.join(WINDOWS_RUNTIME_MANIFEST);
    let manifest: RuntimeManifest = serde_json::from_slice(
        &fs::read(&manifest_path)
            .map_err(|_| "Windows PostgreSQL runtime manifestが見つかりません。".to_string())?,
    )
    .map_err(|_| "Windows PostgreSQL runtime manifestが破損しています。".to_string())?;
    if !manifest.postgres_version.starts_with("17.")
        || !manifest
            .source_url
            .starts_with("https://get.enterprisedb.com/postgresql/")
    {
        return Err("Windows PostgreSQL runtimeの由来を確認できません。".to_string());
    }
    for expected in WINDOWS_REQUIRED_FILES {
        let entry = manifest
            .files
            .iter()
            .find(|entry| entry.name == expected)
            .ok_or_else(|| format!("Windows runtime manifestに{expected}がありません。"))?;
        if sha256_path(&directory.join(expected))? != entry.sha256 {
            return Err(format!(
                "Windows PostgreSQL runtimeの整合性を確認できません: {expected}"
            ));
        }
    }
    Ok(())
}

fn executable_name(tool: &str, platform: RuntimePlatform) -> String {
    match platform {
        RuntimePlatform::WindowsX86_64 => format!("{tool}.exe"),
        RuntimePlatform::MacAarch64 => tool.to_string(),
    }
}

fn validate_tool(path: &Path, tool: &str) -> Result<String, String> {
    let output = runtime_command(path)
        .arg("--version")
        .output()
        .map_err(|_| format!("{tool}を起動できませんでした。"))?;
    validate_version_output(output, tool)
}

fn validate_version_output(output: Output, tool: &str) -> Result<String, String> {
    if !output.status.success() {
        return Err(format!("{tool}のバージョンを確認できませんでした。"));
    }
    let version = String::from_utf8_lossy(&output.stdout).trim().to_string();
    let major = version
        .split_whitespace()
        .find_map(|part| part.split('.').next()?.parse::<u32>().ok())
        .ok_or_else(|| format!("{tool}のバージョン形式を確認できませんでした。"))?;
    if major != REQUIRED_POSTGRES_TOOL_MAJOR {
        return Err(format!("{tool} {REQUIRED_POSTGRES_TOOL_MAJOR}が必要です。"));
    }
    Ok(version)
}

fn runtime_command(executable: &Path) -> Command {
    let mut command = Command::new(executable);
    if let Some(directory) = executable.parent() {
        command.current_dir(directory);
        #[cfg(windows)]
        command.env("PATH", directory);
    }
    command
}

fn sha256_path(path: &Path) -> Result<String, String> {
    let bytes =
        fs::read(path).map_err(|_| "runtimeファイルを読み込めませんでした。".to_string())?;
    Ok(format!("{:x}", Sha256::digest(bytes)))
}

#[cfg(test)]
mod tests {
    use super::*;
    use tempfile::TempDir;

    #[cfg(unix)]
    #[test]
    fn pg_restore_list_success_and_failure_are_detected() {
        use std::os::unix::fs::PermissionsExt;
        let temp = TempDir::new().unwrap();
        let dump = temp.path().join("public.dump");
        fs::write(&dump, b"test").unwrap();
        let success = temp.path().join("pg_restore-success");
        fs::write(&success, "#!/bin/sh\nprintf 'archive list\\n'\n").unwrap();
        fs::set_permissions(&success, fs::Permissions::from_mode(0o755)).unwrap();
        assert!(inspect_custom_dump(&success, &dump).is_ok());
        let failure = temp.path().join("pg_restore-failure");
        fs::write(&failure, "#!/bin/sh\nexit 1\n").unwrap();
        fs::set_permissions(&failure, fs::Permissions::from_mode(0o755)).unwrap();
        assert!(inspect_custom_dump(&failure, &dump).is_err());
    }

    #[test]
    fn windows_runtime_refuses_missing_dlls_before_launch() {
        let temp = TempDir::new().unwrap();
        for file in ["pg_dump.exe", "pg_restore.exe"] {
            fs::write(temp.path().join(file), b"synthetic").unwrap();
        }
        let error =
            validate_runtime_directory(temp.path(), RuntimePlatform::WindowsX86_64).unwrap_err();
        assert!(error.contains("必要ファイルが不足"));
    }

    #[test]
    fn platform_paths_are_fixed_and_never_use_system_path() {
        assert_eq!(
            RuntimePlatform::WindowsX86_64.directory(),
            "resources/bin/windows-x86_64"
        );
        assert_eq!(
            executable_name("pg_dump", RuntimePlatform::WindowsX86_64),
            "pg_dump.exe"
        );
        assert_eq!(
            RuntimePlatform::MacAarch64.directory(),
            "resources/bin/macos-aarch64"
        );
    }
}
