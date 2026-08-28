use std::{fs, fs::File, path::Path};

#[cfg(unix)]
use std::os::unix::fs::OpenOptionsExt;

#[cfg_attr(not(test), allow(dead_code))]
pub(crate) fn create_private_new(path: &Path) -> Result<File, String> {
    let mut options = fs::OpenOptions::new();
    options.write(true).create_new(true);
    #[cfg(unix)]
    options.mode(0o600);
    #[cfg(windows)]
    {
        return Err("Windowsの秘密ファイルACLはPhase 3Bで実装するまで利用できません。".to_string());
    }
    #[cfg(not(windows))]
    options
        .open(path)
        .map_err(|_| "秘密ファイルを安全に作成できませんでした。".to_string())
}

pub(crate) fn publish_new_file(partial: &Path, destination: &Path) -> Result<(), String> {
    if destination.exists() {
        return Err("同名のファイルがすでに存在します。".to_string());
    }
    fs::rename(partial, destination).map_err(|error| error.to_string())
}

pub(crate) fn replace_file(partial: &Path, destination: &Path) -> Result<(), String> {
    #[cfg(windows)]
    if destination.exists() {
        fs::remove_file(destination).map_err(|error| error.to_string())?;
    }
    fs::rename(partial, destination).map_err(|error| error.to_string())
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::io::Write;
    use tempfile::TempDir;

    #[cfg(unix)]
    #[test]
    fn private_file_is_created_with_user_only_permissions() {
        use std::os::unix::fs::PermissionsExt;
        let temp = TempDir::new().unwrap();
        let path = temp.path().join("secret.txt");
        let mut file = create_private_new(&path).unwrap();
        file.write_all(b"test-only").unwrap();
        file.sync_all().unwrap();
        assert_eq!(
            fs::metadata(path).unwrap().permissions().mode() & 0o777,
            0o600
        );
    }

    #[test]
    fn publish_never_overwrites_existing_file() {
        let temp = TempDir::new().unwrap();
        let partial = temp.path().join("new.partial");
        let destination = temp.path().join("final.age");
        fs::write(&partial, b"new").unwrap();
        fs::write(&destination, b"existing").unwrap();
        assert!(publish_new_file(&partial, &destination).is_err());
        assert_eq!(fs::read(destination).unwrap(), b"existing");
    }
}
