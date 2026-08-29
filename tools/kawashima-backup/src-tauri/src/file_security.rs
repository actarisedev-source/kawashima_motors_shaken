use std::{
    fs,
    fs::File,
    io,
    path::{Path, PathBuf},
    thread,
    time::{Duration, SystemTime},
};

#[cfg(unix)]
use std::os::unix::fs::OpenOptionsExt;

const FILE_OPERATION_ATTEMPTS: usize = 4;
const FILE_OPERATION_RETRY_DELAY: Duration = Duration::from_millis(80);
const TEMP_PREFIXES: [&str; 2] = ["kawashima-backup-", "kawashima-backup-verify-"];

pub(crate) struct PrivateTempDir {
    inner: Option<tempfile::TempDir>,
    path: PathBuf,
}

impl PrivateTempDir {
    pub(crate) fn new(prefix: &str) -> Result<Self, String> {
        let inner = tempfile::Builder::new()
            .prefix(prefix)
            .tempdir()
            .map_err(|_| "一時作業領域を作成できませんでした。".to_string())?;
        restrict_existing_path(inner.path())?;
        Ok(Self {
            path: inner.path().to_path_buf(),
            inner: Some(inner),
        })
    }

    pub(crate) fn path(&self) -> &Path {
        &self.path
    }

    pub(crate) fn close(mut self) -> Result<(), String> {
        let inner = self.inner.take().expect("temporary directory is present");
        let path = self.path.clone();
        match inner.close() {
            Ok(()) => Ok(()),
            Err(_) => remove_dir_all_with_retry(&path)
                .map_err(|_| "一時作業領域を削除できませんでした。".to_string()),
        }
    }
}

impl Drop for PrivateTempDir {
    fn drop(&mut self) {
        if let Some(inner) = self.inner.take() {
            let path = self.path.clone();
            if inner.close().is_err() {
                let _ = remove_dir_all_with_retry(&path);
            }
        }
    }
}

#[cfg_attr(not(test), allow(dead_code))]
pub(crate) fn create_private_new(path: &Path) -> Result<File, String> {
    #[cfg(windows)]
    {
        return windows::create_private_new(path);
    }
    #[cfg(not(windows))]
    {
        let mut options = fs::OpenOptions::new();
        options.write(true).create_new(true);
        #[cfg(unix)]
        options.mode(0o600);
        options
            .open(path)
            .map_err(|_| "秘密ファイルを安全に作成できませんでした。".to_string())
    }
}

pub(crate) fn publish_new_file(partial: &Path, destination: &Path) -> Result<(), String> {
    if destination.exists() {
        return Err("同名のファイルがすでに存在します。".to_string());
    }
    move_with_retry(partial, destination, false).map_err(|error| error.to_string())
}

pub(crate) fn replace_file(partial: &Path, destination: &Path) -> Result<(), String> {
    move_with_retry(partial, destination, true).map_err(|error| error.to_string())
}

pub(crate) fn remove_file_with_retry(path: &Path) -> io::Result<()> {
    retry_io(|| match fs::remove_file(path) {
        Err(error) if error.kind() == io::ErrorKind::NotFound => Ok(()),
        result => result,
    })
}

pub(crate) fn cleanup_stale_temp_dirs(max_age: Duration) -> Result<usize, String> {
    let temp_root = std::env::temp_dir();
    let now = SystemTime::now();
    let mut removed = 0;
    let entries =
        fs::read_dir(&temp_root).map_err(|_| "一時領域を確認できませんでした。".to_string())?;
    for entry in entries.flatten() {
        let file_name = entry.file_name().to_string_lossy().to_string();
        if !TEMP_PREFIXES
            .iter()
            .any(|prefix| file_name.starts_with(prefix))
        {
            continue;
        }
        let Ok(metadata) = entry.metadata() else {
            continue;
        };
        if !metadata.is_dir() {
            continue;
        }
        let old_enough = metadata
            .modified()
            .ok()
            .and_then(|modified| now.duration_since(modified).ok())
            .is_some_and(|age| age >= max_age);
        if old_enough && remove_dir_all_with_retry(&entry.path()).is_ok() {
            removed += 1;
        }
    }
    Ok(removed)
}

pub(crate) fn volume_supports_private_acl(path: &Path) -> Result<bool, String> {
    #[cfg(windows)]
    {
        return windows::volume_supports_acl(path);
    }
    #[cfg(not(windows))]
    {
        let _ = path;
        Ok(true)
    }
}

fn restrict_existing_path(path: &Path) -> Result<(), String> {
    #[cfg(windows)]
    {
        return windows::restrict_existing_path(path);
    }
    #[cfg(not(windows))]
    {
        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;
            fs::set_permissions(path, fs::Permissions::from_mode(0o700))
                .map_err(|_| "一時作業領域の権限を設定できませんでした。".to_string())?;
        }
        Ok(())
    }
}

fn move_with_retry(source: &Path, destination: &Path, replace: bool) -> io::Result<()> {
    retry_io(|| {
        #[cfg(windows)]
        {
            return windows::move_file(source, destination, replace);
        }
        #[cfg(not(windows))]
        {
            let _ = replace;
            fs::rename(source, destination)
        }
    })
}

fn remove_dir_all_with_retry(path: &Path) -> io::Result<()> {
    retry_io(|| match fs::remove_dir_all(path) {
        Err(error) if error.kind() == io::ErrorKind::NotFound => Ok(()),
        result => result,
    })
}

fn retry_io(mut operation: impl FnMut() -> io::Result<()>) -> io::Result<()> {
    let mut last_error = None;
    for attempt in 0..FILE_OPERATION_ATTEMPTS {
        match operation() {
            Ok(()) => return Ok(()),
            Err(error) => {
                let retryable = matches!(
                    error.kind(),
                    io::ErrorKind::PermissionDenied
                        | io::ErrorKind::WouldBlock
                        | io::ErrorKind::Other
                );
                if !retryable || attempt + 1 == FILE_OPERATION_ATTEMPTS {
                    return Err(error);
                }
                last_error = Some(error);
                thread::sleep(FILE_OPERATION_RETRY_DELAY * (attempt as u32 + 1));
            }
        }
    }
    Err(last_error.unwrap_or_else(|| io::Error::other("file operation failed")))
}

#[cfg(windows)]
mod windows {
    use std::{
        ffi::c_void,
        mem::size_of,
        os::windows::{ffi::OsStrExt, io::FromRawHandle},
        ptr,
    };

    use windows_sys::Win32::{
        Foundation::{CloseHandle, GetLastError, LocalFree, GENERIC_WRITE, INVALID_HANDLE_VALUE},
        Security::{
            Authorization::{
                ConvertSidToStringSidW, ConvertStringSecurityDescriptorToSecurityDescriptorW,
                SDDL_REVISION_1,
            },
            GetTokenInformation, SetFileSecurityW, TokenUser, DACL_SECURITY_INFORMATION,
            PROTECTED_DACL_SECURITY_INFORMATION, PSECURITY_DESCRIPTOR, SECURITY_ATTRIBUTES,
            TOKEN_QUERY, TOKEN_USER,
        },
        Storage::FileSystem::{
            CreateFileW, GetVolumeInformationW, GetVolumePathNameW, MoveFileExW, CREATE_NEW,
            FILE_ATTRIBUTE_NORMAL, MOVEFILE_REPLACE_EXISTING, MOVEFILE_WRITE_THROUGH,
        },
        System::{
            SystemServices::FILE_PERSISTENT_ACLS,
            Threading::{GetCurrentProcess, OpenProcessToken},
        },
    };

    use super::*;

    pub(super) fn create_private_new(path: &Path) -> Result<File, String> {
        if !volume_supports_acl(path)? {
            return Err(
                "この保存先はアクセス制御リストを保証できないため秘密ファイルを作成できません。"
                    .to_string(),
            );
        }
        let descriptor = SecurityDescriptor::current_user_only(false)?;
        let mut attributes = SECURITY_ATTRIBUTES {
            nLength: size_of::<SECURITY_ATTRIBUTES>() as u32,
            lpSecurityDescriptor: descriptor.raw,
            bInheritHandle: 0,
        };
        let path = wide_path(path);
        let handle = unsafe {
            CreateFileW(
                path.as_ptr(),
                GENERIC_WRITE,
                0,
                &mut attributes,
                CREATE_NEW,
                FILE_ATTRIBUTE_NORMAL,
                ptr::null_mut(),
            )
        };
        if handle == INVALID_HANDLE_VALUE {
            return Err("秘密ファイルを安全に作成できませんでした。".to_string());
        }
        Ok(unsafe { File::from_raw_handle(handle) })
    }

    pub(super) fn restrict_existing_path(path: &Path) -> Result<(), String> {
        if !volume_supports_acl(path)? {
            return Err("このファイルシステムでは制限ACLを保証できません。".to_string());
        }
        let descriptor = SecurityDescriptor::current_user_only(true)?;
        let path = wide_path(path);
        let info = DACL_SECURITY_INFORMATION | PROTECTED_DACL_SECURITY_INFORMATION;
        if unsafe { SetFileSecurityW(path.as_ptr(), info, descriptor.raw) } == 0 {
            return Err("一時作業領域のACLを設定できませんでした。".to_string());
        }
        Ok(())
    }

    pub(super) fn volume_supports_acl(path: &Path) -> Result<bool, String> {
        let path = wide_path(path);
        let mut root = vec![0u16; 32768];
        if unsafe { GetVolumePathNameW(path.as_ptr(), root.as_mut_ptr(), root.len() as u32) } == 0 {
            return Err("保存先のファイルシステムを確認できませんでした。".to_string());
        }
        let mut flags = 0u32;
        if unsafe {
            GetVolumeInformationW(
                root.as_ptr(),
                ptr::null_mut(),
                0,
                ptr::null_mut(),
                ptr::null_mut(),
                &mut flags,
                ptr::null_mut(),
                0,
            )
        } == 0
        {
            return Err("保存先のACL対応を確認できませんでした。".to_string());
        }
        Ok(flags & FILE_PERSISTENT_ACLS != 0)
    }

    pub(super) fn move_file(source: &Path, destination: &Path, replace: bool) -> io::Result<()> {
        let source = wide_path(source);
        let destination = wide_path(destination);
        let flags = MOVEFILE_WRITE_THROUGH
            | if replace {
                MOVEFILE_REPLACE_EXISTING
            } else {
                0
            };
        if unsafe { MoveFileExW(source.as_ptr(), destination.as_ptr(), flags) } == 0 {
            Err(io::Error::from_raw_os_error(
                unsafe { GetLastError() } as i32
            ))
        } else {
            Ok(())
        }
    }

    struct SecurityDescriptor {
        raw: PSECURITY_DESCRIPTOR,
    }

    impl SecurityDescriptor {
        fn current_user_only(inherit_to_children: bool) -> Result<Self, String> {
            let sid = current_user_sid_string()?;
            let inheritance = if inherit_to_children { "OICI" } else { "" };
            let sddl = wide(&format!("D:P(A;{inheritance};FA;;;{sid})"));
            let mut raw: PSECURITY_DESCRIPTOR = ptr::null_mut();
            if unsafe {
                ConvertStringSecurityDescriptorToSecurityDescriptorW(
                    sddl.as_ptr(),
                    SDDL_REVISION_1,
                    &mut raw,
                    ptr::null_mut(),
                )
            } == 0
                || raw.is_null()
            {
                return Err("現在ユーザー専用ACLを作成できませんでした。".to_string());
            }
            Ok(Self { raw })
        }
    }

    impl Drop for SecurityDescriptor {
        fn drop(&mut self) {
            unsafe { LocalFree(self.raw) };
        }
    }

    fn current_user_sid_string() -> Result<String, String> {
        let mut token = ptr::null_mut();
        if unsafe { OpenProcessToken(GetCurrentProcess(), TOKEN_QUERY, &mut token) } == 0 {
            return Err("現在ユーザーを確認できませんでした。".to_string());
        }
        let result = (|| {
            let mut required = 0u32;
            unsafe { GetTokenInformation(token, TokenUser, ptr::null_mut(), 0, &mut required) };
            if required == 0 {
                return Err("現在ユーザーを確認できませんでした。".to_string());
            }
            let mut buffer = vec![0u8; required as usize];
            if unsafe {
                GetTokenInformation(
                    token,
                    TokenUser,
                    buffer.as_mut_ptr().cast::<c_void>(),
                    required,
                    &mut required,
                )
            } == 0
            {
                return Err("現在ユーザーを確認できませんでした。".to_string());
            }
            let token_user = unsafe { &*(buffer.as_ptr().cast::<TOKEN_USER>()) };
            let mut sid_string = ptr::null_mut();
            if unsafe { ConvertSidToStringSidW(token_user.User.Sid, &mut sid_string) } == 0
                || sid_string.is_null()
            {
                return Err("現在ユーザーのSIDを確認できませんでした。".to_string());
            }
            let value = unsafe { from_wide(sid_string) };
            unsafe { LocalFree(sid_string.cast::<c_void>()) };
            Ok(value)
        })();
        unsafe { CloseHandle(token) };
        result
    }

    fn wide(value: &str) -> Vec<u16> {
        value.encode_utf16().chain(std::iter::once(0)).collect()
    }

    fn wide_path(path: &Path) -> Vec<u16> {
        path.as_os_str()
            .encode_wide()
            .chain(std::iter::once(0))
            .collect()
    }

    unsafe fn from_wide(value: *const u16) -> String {
        let length = (0..).take_while(|offset| *value.add(*offset) != 0).count();
        String::from_utf16_lossy(std::slice::from_raw_parts(value, length))
    }
}

#[cfg(test)]
mod tests {
    use std::{
        io::Write,
        sync::{
            atomic::{AtomicUsize, Ordering},
            Arc,
        },
    };

    use tempfile::TempDir;

    use super::*;

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

    #[cfg(windows)]
    #[test]
    fn private_file_is_created_on_an_acl_capable_volume() {
        let temp = TempDir::new().unwrap();
        assert!(volume_supports_private_acl(temp.path()).unwrap());
        let path = temp.path().join("secret.txt");
        let mut file = create_private_new(&path).unwrap();
        file.write_all(b"synthetic-only").unwrap();
        file.sync_all().unwrap();
        assert_eq!(fs::read(path).unwrap(), b"synthetic-only");
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

    #[test]
    fn bounded_retry_recovers_from_a_transient_lock() {
        let attempts = Arc::new(AtomicUsize::new(0));
        let observed = attempts.clone();
        retry_io(|| {
            let current = observed.fetch_add(1, Ordering::SeqCst);
            if current < 2 {
                Err(io::Error::new(
                    io::ErrorKind::PermissionDenied,
                    "synthetic lock",
                ))
            } else {
                Ok(())
            }
        })
        .unwrap();
        assert_eq!(attempts.load(Ordering::SeqCst), 3);
    }

    #[test]
    fn private_temp_directory_is_removed_on_close() {
        let temp = PrivateTempDir::new("kawashima-backup-test-").unwrap();
        let path = temp.path().to_path_buf();
        fs::write(path.join("test"), b"synthetic").unwrap();
        temp.close().unwrap();
        assert!(!path.exists());
    }
}
