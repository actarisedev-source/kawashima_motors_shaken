#[cfg(not(windows))]
use keyring::{Entry, Error as KeyringError};
use zeroize::Zeroize;

pub(crate) const SERVICE_NAME: &str = "jp.actarise.kawashima.backup";
pub(crate) const ACCOUNT_DB_PASSWORD: &str = "db-password";
pub(crate) const ACCOUNT_SERVICE_ROLE_KEY: &str = "supabase-service-role-key";
pub(crate) const ACCOUNT_MAINTENANCE_VERIFIER: &str = "maintenance-verifier";

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) enum CredentialState {
    Stored,
    Missing,
    Corrupt,
    AccessDenied,
    BackendError,
}

impl CredentialState {
    pub(crate) fn label(self) -> &'static str {
        match self {
            Self::Stored => "stored",
            Self::Missing => "missing",
            Self::Corrupt => "corrupt",
            Self::AccessDenied => "accessDenied",
            Self::BackendError => "backendError",
        }
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) enum CredentialStoreError {
    Missing,
    Corrupt,
    AccessDenied,
    Backend,
}

impl CredentialStoreError {
    pub(crate) fn state(self) -> CredentialState {
        match self {
            Self::Missing => CredentialState::Missing,
            Self::Corrupt => CredentialState::Corrupt,
            Self::AccessDenied => CredentialState::AccessDenied,
            Self::Backend => CredentialState::BackendError,
        }
    }

    pub(crate) fn user_message(self, label: &str) -> String {
        match self {
            Self::Missing => format!("{label}が未設定です。"),
            Self::Corrupt => {
                format!("{label}が破損しています。自動上書きせず保守担当へ連絡してください。")
            }
            Self::AccessDenied => {
                format!("{label}へアクセスできません。OS資格情報ストアの権限を確認してください。")
            }
            Self::Backend => format!("{label}をOS資格情報ストアから読み込めません。"),
        }
    }
}

trait CredentialBackend {
    fn read(&self, account: &str) -> Result<String, CredentialStoreError>;
    fn write(&self, account: &str, value: &str) -> Result<(), CredentialStoreError>;
}

struct OsCredentialBackend;

impl CredentialBackend for OsCredentialBackend {
    fn read(&self, account: &str) -> Result<String, CredentialStoreError> {
        platform::read(account)
    }

    fn write(&self, account: &str, value: &str) -> Result<(), CredentialStoreError> {
        platform::write(account, value)
    }
}

pub(crate) fn credential_state(account: &str) -> CredentialState {
    match read_secret(account) {
        Ok(mut value) => {
            value.zeroize();
            CredentialState::Stored
        }
        Err(error) => error.state(),
    }
}

pub(crate) fn read_secret(account: &str) -> Result<String, CredentialStoreError> {
    OsCredentialBackend.read(account)
}

pub(crate) fn write_secret_explicit(
    account: &str,
    value: &str,
) -> Result<(), CredentialStoreError> {
    write_secret_with_backend(&OsCredentialBackend, account, value)
}

fn write_secret_with_backend(
    backend: &dyn CredentialBackend,
    account: &str,
    value: &str,
) -> Result<(), CredentialStoreError> {
    if value.is_empty() {
        return Err(CredentialStoreError::Corrupt);
    }
    match backend.read(account) {
        Ok(_) | Err(CredentialStoreError::Missing) => {}
        Err(error) => return Err(error),
    }
    backend.write(account, value)?;
    let mut verified = backend.read(account)?;
    let matches = verified == value;
    verified.zeroize();
    if !matches {
        return Err(CredentialStoreError::Corrupt);
    }
    Ok(())
}

#[cfg(not(windows))]
mod platform {
    use super::*;

    pub(super) fn read(account: &str) -> Result<String, CredentialStoreError> {
        let value = entry(account)?
            .get_password()
            .map_err(classify_keyring_error)?;
        if value.is_empty() {
            return Err(CredentialStoreError::Corrupt);
        }
        Ok(value)
    }

    pub(super) fn write(account: &str, value: &str) -> Result<(), CredentialStoreError> {
        entry(account)?
            .set_password(value)
            .map_err(classify_keyring_error)
    }

    fn entry(account: &str) -> Result<Entry, CredentialStoreError> {
        Entry::new(SERVICE_NAME, account).map_err(classify_keyring_error)
    }

    fn classify_keyring_error(error: KeyringError) -> CredentialStoreError {
        match error {
            KeyringError::NoEntry => CredentialStoreError::Missing,
            KeyringError::BadEncoding(_)
            | KeyringError::Ambiguous(_)
            | KeyringError::Invalid(_, _)
            | KeyringError::TooLong(_, _) => CredentialStoreError::Corrupt,
            KeyringError::NoStorageAccess(_) => CredentialStoreError::AccessDenied,
            _ => CredentialStoreError::Backend,
        }
    }
}

#[cfg(windows)]
mod platform {
    use std::{ffi::c_void, mem::MaybeUninit, ptr};

    use super::*;
    #[cfg(test)]
    use windows_sys::Win32::Security::Credentials::CredDeleteW;
    use windows_sys::Win32::{
        Foundation::{
            GetLastError, ERROR_ACCESS_DENIED, ERROR_INVALID_DATA, ERROR_NOT_FOUND,
            ERROR_NO_SUCH_LOGON_SESSION, FILETIME,
        },
        Security::Credentials::{
            CredFree, CredReadW, CredWriteW, CREDENTIALW, CRED_PERSIST_LOCAL_MACHINE,
            CRED_TYPE_GENERIC,
        },
    };

    pub(super) fn read(account: &str) -> Result<String, CredentialStoreError> {
        let target = wide(&target_name(account));
        let mut credential = MaybeUninit::<*mut CREDENTIALW>::uninit();
        if unsafe {
            CredReadW(
                target.as_ptr(),
                CRED_TYPE_GENERIC,
                0,
                credential.as_mut_ptr(),
            )
        } == 0
        {
            return Err(last_error());
        }
        let credential = unsafe { credential.assume_init() };
        if credential.is_null() {
            return Err(CredentialStoreError::Backend);
        }
        let raw = unsafe { &*credential };
        let byte_len = raw.CredentialBlobSize as usize;
        let result = if byte_len == 0 || byte_len % 2 != 0 || raw.CredentialBlob.is_null() {
            Err(CredentialStoreError::Corrupt)
        } else {
            let units = unsafe {
                std::slice::from_raw_parts(raw.CredentialBlob.cast::<u16>(), byte_len / 2)
            };
            String::from_utf16(units)
                .map_err(|_| CredentialStoreError::Corrupt)
                .and_then(|value| {
                    if value.is_empty() {
                        Err(CredentialStoreError::Corrupt)
                    } else {
                        Ok(value)
                    }
                })
        };
        unsafe { CredFree(credential.cast::<c_void>()) };
        result
    }

    pub(super) fn write(account: &str, value: &str) -> Result<(), CredentialStoreError> {
        let mut target = wide(&target_name(account));
        let mut username = wide(account);
        let mut comment = wide("Kawashima Motors Backup Tool (local computer only)");
        let mut secret: Vec<u16> = value.encode_utf16().collect();
        let mut credential = CREDENTIALW {
            Flags: 0,
            Type: CRED_TYPE_GENERIC,
            TargetName: target.as_mut_ptr(),
            Comment: comment.as_mut_ptr(),
            LastWritten: FILETIME {
                dwLowDateTime: 0,
                dwHighDateTime: 0,
            },
            CredentialBlobSize: (secret.len() * 2) as u32,
            CredentialBlob: secret.as_mut_ptr().cast::<u8>(),
            Persist: CRED_PERSIST_LOCAL_MACHINE,
            AttributeCount: 0,
            Attributes: ptr::null_mut(),
            TargetAlias: ptr::null_mut(),
            UserName: username.as_mut_ptr(),
        };
        let result = if unsafe { CredWriteW(&mut credential, 0) } == 0 {
            Err(last_error())
        } else {
            Ok(())
        };
        secret.zeroize();
        result
    }

    #[cfg(test)]
    pub(super) fn delete_test_credential(account: &str) -> Result<(), CredentialStoreError> {
        let target = wide(&target_name(account));
        if unsafe { CredDeleteW(target.as_ptr(), CRED_TYPE_GENERIC, 0) } == 0 {
            return Err(last_error());
        }
        Ok(())
    }

    fn target_name(account: &str) -> String {
        // keyring 3.x uses this target convention; keeping it preserves existing entries.
        format!("{account}.{SERVICE_NAME}")
    }

    fn wide(value: &str) -> Vec<u16> {
        value.encode_utf16().chain(std::iter::once(0)).collect()
    }

    fn last_error() -> CredentialStoreError {
        match unsafe { GetLastError() } {
            ERROR_NOT_FOUND => CredentialStoreError::Missing,
            ERROR_ACCESS_DENIED | ERROR_NO_SUCH_LOGON_SESSION => CredentialStoreError::AccessDenied,
            ERROR_INVALID_DATA => CredentialStoreError::Corrupt,
            _ => CredentialStoreError::Backend,
        }
    }
}

#[cfg(test)]
mod tests {
    use std::{cell::RefCell, collections::HashMap};

    use super::*;

    struct FakeBackend {
        values: RefCell<HashMap<String, String>>,
        read_error: RefCell<Option<CredentialStoreError>>,
    }

    impl FakeBackend {
        fn empty() -> Self {
            Self {
                values: RefCell::new(HashMap::new()),
                read_error: RefCell::new(None),
            }
        }
    }

    impl CredentialBackend for FakeBackend {
        fn read(&self, account: &str) -> Result<String, CredentialStoreError> {
            if let Some(error) = *self.read_error.borrow() {
                return Err(error);
            }
            self.values
                .borrow()
                .get(account)
                .cloned()
                .ok_or(CredentialStoreError::Missing)
        }

        fn write(&self, account: &str, value: &str) -> Result<(), CredentialStoreError> {
            self.values
                .borrow_mut()
                .insert(account.to_string(), value.to_string());
            Ok(())
        }
    }

    #[test]
    fn credential_states_have_distinct_public_labels() {
        assert_eq!(CredentialState::Missing.label(), "missing");
        assert_eq!(CredentialState::Corrupt.label(), "corrupt");
        assert_eq!(CredentialState::AccessDenied.label(), "accessDenied");
        assert_eq!(CredentialState::BackendError.label(), "backendError");
    }

    #[test]
    fn missing_and_corrupt_credentials_have_different_messages() {
        let missing = CredentialStoreError::Missing.user_message("DBパスワード");
        let corrupt = CredentialStoreError::Corrupt.user_message("DBパスワード");
        assert_ne!(missing, corrupt);
        assert!(corrupt.contains("自動上書きせず"));
    }

    #[test]
    fn explicit_write_rereads_and_verifies_the_secret() {
        let backend = FakeBackend::empty();
        write_secret_with_backend(&backend, "test", "synthetic-only").unwrap();
        assert_eq!(backend.read("test").unwrap(), "synthetic-only");
    }

    #[test]
    fn backend_errors_never_trigger_an_overwrite() {
        let backend = FakeBackend::empty();
        *backend.read_error.borrow_mut() = Some(CredentialStoreError::AccessDenied);
        assert_eq!(
            write_secret_with_backend(&backend, "test", "synthetic-only"),
            Err(CredentialStoreError::AccessDenied)
        );
        assert!(backend.values.borrow().is_empty());
    }

    #[cfg(windows)]
    #[test]
    fn windows_credential_manager_round_trip_uses_a_synthetic_entry() {
        use std::time::{SystemTime, UNIX_EPOCH};

        let nonce = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .unwrap()
            .as_nanos();
        let account = format!("ci-synthetic-{}-{nonce}", std::process::id());
        let value = "synthetic-ci-credential";
        platform::write(&account, value).unwrap();
        let result = platform::read(&account);
        let cleanup = platform::delete_test_credential(&account);
        assert_eq!(result.unwrap(), value);
        cleanup.unwrap();
        assert_eq!(platform::read(&account), Err(CredentialStoreError::Missing));
    }
}
