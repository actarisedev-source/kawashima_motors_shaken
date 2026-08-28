use keyring::{Entry, Error as KeyringError};

pub(crate) const SERVICE_NAME: &str = "jp.actarise.kawashima.backup";
pub(crate) const ACCOUNT_DB_PASSWORD: &str = "db-password";
pub(crate) const ACCOUNT_SERVICE_ROLE_KEY: &str = "supabase-service-role-key";

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

pub(crate) fn credential_state(account: &str) -> CredentialState {
    match read_secret(account) {
        Ok(_) => CredentialState::Stored,
        Err(error) => error.state(),
    }
}

pub(crate) fn read_secret(account: &str) -> Result<String, CredentialStoreError> {
    let value = entry(account)?
        .get_password()
        .map_err(classify_keyring_error)?;
    if value.is_empty() {
        return Err(CredentialStoreError::Corrupt);
    }
    Ok(value)
}

pub(crate) fn write_secret_explicit(
    account: &str,
    value: &str,
) -> Result<(), CredentialStoreError> {
    if value.is_empty() {
        return Err(CredentialStoreError::Corrupt);
    }
    let current_state = credential_state(account);
    match current_state {
        CredentialState::Corrupt
        | CredentialState::AccessDenied
        | CredentialState::BackendError => {
            return Err(match current_state {
                CredentialState::Corrupt => CredentialStoreError::Corrupt,
                CredentialState::AccessDenied => CredentialStoreError::AccessDenied,
                _ => CredentialStoreError::Backend,
            });
        }
        CredentialState::Stored | CredentialState::Missing => {}
    }
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
        KeyringError::PlatformFailure(_) => CredentialStoreError::Backend,
        _ => CredentialStoreError::Backend,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

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
}
