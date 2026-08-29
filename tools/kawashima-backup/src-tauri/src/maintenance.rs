use std::{
    sync::Mutex,
    time::{Duration, Instant},
};

use argon2::{
    password_hash::{
        rand_core::{OsRng, RngCore},
        PasswordHash, PasswordHasher, PasswordVerifier, SaltString,
    },
    Argon2,
};
use base64::{engine::general_purpose::URL_SAFE_NO_PAD, Engine};
use serde::Serialize;
use tauri::State;
use zeroize::Zeroizing;

use super::credential_store::{self, CredentialState, ACCOUNT_MAINTENANCE_VERIFIER};

const SESSION_LIFETIME: Duration = Duration::from_secs(15 * 60);

#[derive(Default)]
pub(crate) struct MaintenanceState(Mutex<Option<MaintenanceSession>>);

struct MaintenanceSession {
    token: String,
    expires_at: Instant,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct MaintenanceStatus {
    configured: bool,
    state: String,
    unlocked: bool,
}

#[tauri::command]
pub(crate) fn get_maintenance_status(state: State<'_, MaintenanceState>) -> MaintenanceStatus {
    status(&state)
}

#[tauri::command]
pub(crate) fn configure_maintenance_passcode(
    passcode: String,
    maintenance_token: Option<String>,
    state: State<'_, MaintenanceState>,
) -> Result<MaintenanceStatus, String> {
    if credential_store::credential_state(ACCOUNT_MAINTENANCE_VERIFIER) == CredentialState::Stored {
        authorize(&state, maintenance_token.as_deref())?;
    }
    let passcode = Zeroizing::new(passcode);
    validate_passcode(&passcode)?;
    let verifier = hash_passcode(&passcode)?;
    credential_store::write_secret_explicit(ACCOUNT_MAINTENANCE_VERIFIER, &verifier)
        .map_err(|error| error.user_message("保守ロック"))?;
    clear_session(&state)?;
    Ok(status(&state))
}

#[tauri::command]
pub(crate) fn unlock_maintenance(
    passcode: String,
    state: State<'_, MaintenanceState>,
) -> Result<String, String> {
    let passcode = Zeroizing::new(passcode);
    let verifier = credential_store::read_secret(ACCOUNT_MAINTENANCE_VERIFIER)
        .map_err(|error| error.user_message("保守ロック"))?;
    verify_passcode(&passcode, &verifier)?;
    let token = random_session_token();
    *state
        .0
        .lock()
        .map_err(|_| "保守状態を更新できませんでした。".to_string())? = Some(MaintenanceSession {
        token: token.clone(),
        expires_at: Instant::now() + SESSION_LIFETIME,
    });
    Ok(token)
}

#[tauri::command]
pub(crate) fn lock_maintenance(state: State<'_, MaintenanceState>) -> Result<(), String> {
    clear_session(&state)
}

pub(crate) fn authorize(
    state: &State<'_, MaintenanceState>,
    token: Option<&str>,
) -> Result<(), String> {
    let mut session = state
        .0
        .lock()
        .map_err(|_| "保守状態を確認できませんでした。".to_string())?;
    let Some(current) = session.as_ref() else {
        return Err("ACTARISE保守ロックを解除してください。".to_string());
    };
    if current.expires_at <= Instant::now() {
        *session = None;
        return Err("保守セッションの有効期限が切れました。".to_string());
    }
    if token != Some(current.token.as_str()) {
        return Err("保守操作を許可できません。".to_string());
    }
    Ok(())
}

pub(crate) fn is_configured() -> bool {
    credential_store::credential_state(ACCOUNT_MAINTENANCE_VERIFIER) == CredentialState::Stored
}

fn status(state: &State<'_, MaintenanceState>) -> MaintenanceStatus {
    let credential_state = credential_store::credential_state(ACCOUNT_MAINTENANCE_VERIFIER);
    let unlocked = state
        .0
        .lock()
        .ok()
        .and_then(|session| {
            session
                .as_ref()
                .map(|session| session.expires_at > Instant::now())
        })
        .unwrap_or(false);
    MaintenanceStatus {
        configured: credential_state == CredentialState::Stored,
        state: credential_state.label().to_string(),
        unlocked,
    }
}

fn clear_session(state: &State<'_, MaintenanceState>) -> Result<(), String> {
    *state
        .0
        .lock()
        .map_err(|_| "保守状態を更新できませんでした。".to_string())? = None;
    Ok(())
}

fn validate_passcode(passcode: &str) -> Result<(), String> {
    if passcode.chars().count() < 12 || passcode.chars().count() > 128 {
        return Err("保守パスコードは12〜128文字で設定してください。".to_string());
    }
    Ok(())
}

fn hash_passcode(passcode: &str) -> Result<String, String> {
    let salt = SaltString::generate(&mut OsRng);
    Argon2::default()
        .hash_password(passcode.as_bytes(), &salt)
        .map(|hash| hash.to_string())
        .map_err(|_| "保守ロックを設定できませんでした。".to_string())
}

fn verify_passcode(passcode: &str, verifier: &str) -> Result<(), String> {
    let parsed = PasswordHash::new(verifier)
        .map_err(|_| "保守ロックが破損しています。自動上書きしません。".to_string())?;
    Argon2::default()
        .verify_password(passcode.as_bytes(), &parsed)
        .map_err(|_| "保守パスコードが一致しません。".to_string())
}

fn random_session_token() -> String {
    let mut bytes = [0u8; 32];
    OsRng.fill_bytes(&mut bytes);
    let token = URL_SAFE_NO_PAD.encode(bytes);
    bytes.fill(0);
    token
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn passcode_hash_verifies_without_storing_plaintext() {
        let hash = hash_passcode("synthetic-passcode-123").unwrap();
        assert!(!hash.contains("synthetic-passcode-123"));
        assert!(verify_passcode("synthetic-passcode-123", &hash).is_ok());
        assert!(verify_passcode("different-passcode", &hash).is_err());
    }

    #[test]
    fn short_maintenance_passcodes_are_rejected() {
        assert!(validate_passcode("short").is_err());
    }

    #[test]
    fn maintenance_session_tokens_are_opaque_and_unique() {
        let first = random_session_token();
        let second = random_session_token();
        assert_ne!(first, second);
        assert!(first.len() >= 40);
    }
}
