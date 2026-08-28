use std::{
    fs,
    path::{Path, PathBuf},
    process::Command,
};

use tauri::{AppHandle, Manager};

use super::{sanitized_error, BackupToolSettings};

pub(crate) const REQUIRED_POSTGRES_TOOL_MAJOR: u32 = 17;

pub(crate) struct PostgresRuntime {
    pub(crate) pg_dump: PathBuf,
    pub(crate) pg_restore: PathBuf,
    pub(crate) pg_dump_version: String,
    pub(crate) pg_restore_version: String,
}

impl PostgresRuntime {
    pub(crate) fn resolve(app: &AppHandle) -> Result<Self, String> {
        let pg_dump = resolve_tool(app, "pg_dump")?;
        let pg_restore = resolve_tool(app, "pg_restore")?;
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
        .env("PGAPPNAME", "kawashima_backup_tool_phase3a")
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
    if !output_path.is_file() || fs::metadata(output_path).map_err(sanitized_error)?.len() == 0 {
        return Err("データベースファイルが生成されませんでした。".to_string());
    }
    Ok(())
}

pub(crate) fn inspect_custom_dump(executable: &Path, dump: &Path) -> Result<(), String> {
    let output = Command::new(executable)
        .arg("--list")
        .arg(dump)
        .output()
        .map_err(|_| "pg_restoreを起動できませんでした。".to_string())?;
    if !output.status.success() || output.stdout.is_empty() {
        return Err("pg_restoreでcustom dump構造を確認できませんでした。".to_string());
    }
    Ok(())
}

fn resolve_tool(app: &AppHandle, tool: &str) -> Result<PathBuf, String> {
    let file_name = if cfg!(target_os = "windows") {
        format!("{tool}.exe")
    } else {
        tool.to_string()
    };
    let relative = if cfg!(all(target_os = "windows", target_arch = "x86_64")) {
        PathBuf::from("resources/bin/windows-x86_64").join(file_name)
    } else if cfg!(all(target_os = "macos", target_arch = "aarch64")) {
        PathBuf::from("resources/bin/macos-aarch64").join(file_name)
    } else {
        return Err(format!("このOS向けの{tool} 17はまだ同梱されていません。"));
    };
    let bundled = app
        .path()
        .resource_dir()
        .map_err(sanitized_error)?
        .join(&relative);
    if bundled.is_file() {
        return Ok(bundled);
    }
    let development = Path::new(env!("CARGO_MANIFEST_DIR")).join(relative);
    if development.is_file() {
        return Ok(development);
    }
    Err(format!("同梱された{tool} 17が見つかりません。"))
}

fn validate_tool(path: &Path, tool: &str) -> Result<String, String> {
    let output = Command::new(path)
        .arg("--version")
        .output()
        .map_err(|_| format!("{tool}を起動できませんでした。"))?;
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
}
