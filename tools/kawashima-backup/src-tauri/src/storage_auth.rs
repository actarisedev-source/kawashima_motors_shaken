use reqwest::header::{HeaderMap, HeaderValue, AUTHORIZATION};
use serde::{Deserialize, Serialize};
use zeroize::Zeroizing;

use super::{normalize_project_url, BackupToolSettings};

#[derive(Serialize)]
struct PasswordGrantRequest<'a> {
    email: &'a str,
    password: &'a str,
}

#[derive(Deserialize)]
struct PasswordGrantResponse {
    access_token: String,
}

pub(crate) struct StorageAccessToken {
    value: Zeroizing<String>,
}

impl StorageAccessToken {
    pub(crate) fn headers(&self, publishable_key: &str) -> Result<HeaderMap, String> {
        storage_headers(publishable_key, &self.value)
    }
}

pub(crate) async fn authenticate(
    settings: &BackupToolSettings,
    password: &str,
) -> Result<StorageAccessToken, String> {
    let project_url = normalize_project_url(&settings.supabase_project_url)?;
    let publishable_key = settings.supabase_publishable_key.trim();
    let email = settings.storage_auth_email.trim();
    if publishable_key.is_empty() || email.is_empty() || password.is_empty() {
        return Err("Storage読み取り用の接続情報を確認してください。".to_string());
    }

    let response = reqwest::Client::new()
        .post(format!("{project_url}/auth/v1/token?grant_type=password"))
        .header("apikey", publishable_header(publishable_key)?)
        .json(&PasswordGrantRequest { email, password })
        .send()
        .await
        .map_err(|_| "Storage読み取り用の認証へ接続できません。".to_string())?;

    if !response.status().is_success() {
        return Err(format!(
            "Storage読み取り用の認証に失敗しました（HTTP {}）。",
            response.status().as_u16()
        ));
    }
    let body: PasswordGrantResponse = response
        .json()
        .await
        .map_err(|_| "Storage読み取り用の認証応答を確認できません。".to_string())?;
    if body.access_token.trim().is_empty() {
        return Err("Storage読み取り用の認証応答を確認できません。".to_string());
    }
    Ok(StorageAccessToken {
        value: Zeroizing::new(body.access_token),
    })
}

pub(crate) fn storage_headers(
    publishable_key: &str,
    access_token: &str,
) -> Result<HeaderMap, String> {
    let mut headers = HeaderMap::new();
    headers.insert("apikey", publishable_header(publishable_key)?);
    headers.insert(
        AUTHORIZATION,
        HeaderValue::from_str(&format!("Bearer {access_token}"))
            .map_err(|_| "Storage認証情報の形式を確認してください。".to_string())?,
    );
    Ok(headers)
}

pub(crate) async fn verify_bucket_access(
    client: &reqwest::Client,
    project_url: &str,
    bucket: &str,
    headers: &HeaderMap,
) -> Result<(), String> {
    let response = client
        .get(format!("{project_url}/storage/v1/bucket/{bucket}"))
        .headers(headers.clone())
        .send()
        .await
        .map_err(|_| "Storage対象bucketへ接続できません。".to_string())?;
    if !response.status().is_success() {
        return Err(format!(
            "Storage対象bucketへのアクセスが拒否されました（HTTP {}）。",
            response.status().as_u16()
        ));
    }
    Ok(())
}

fn publishable_header(value: &str) -> Result<HeaderValue, String> {
    if value.trim().is_empty() {
        return Err("Supabase Publishable Keyを確認してください。".to_string());
    }
    HeaderValue::from_str(value.trim())
        .map_err(|_| "Supabase Publishable Keyの形式を確認してください。".to_string())
}

#[cfg(test)]
mod tests {
    use std::{
        io::{Read, Write},
        net::TcpListener,
        thread,
    };

    use super::*;

    fn test_settings(project_url: String) -> BackupToolSettings {
        BackupToolSettings {
            supabase_project_url: project_url,
            supabase_publishable_key: "publishable-test".to_string(),
            storage_auth_email: "endpoint@nonprod.invalid".to_string(),
            ..BackupToolSettings::default()
        }
    }

    fn mock_auth_server(status: &str, body: &str) -> String {
        let listener = TcpListener::bind("127.0.0.1:0").unwrap();
        let port = listener.local_addr().unwrap().port();
        let status = status.to_string();
        let body = body.to_string();
        thread::spawn(move || {
            let (mut stream, _) = listener.accept().unwrap();
            let mut request = [0u8; 4096];
            let size = stream.read(&mut request).unwrap();
            let request = String::from_utf8_lossy(&request[..size]);
            assert!(request.starts_with("POST /auth/v1/token?grant_type=password"));
            assert!(request
                .to_ascii_lowercase()
                .contains("apikey: publishable-test"));
            let response = format!(
                "HTTP/1.1 {status}\r\nContent-Type: application/json\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{body}",
                body.len()
            );
            stream.write_all(response.as_bytes()).unwrap();
        });
        format!("http://localhost:{port}")
    }

    fn mock_bucket_server(status: &str) -> String {
        let listener = TcpListener::bind("127.0.0.1:0").unwrap();
        let port = listener.local_addr().unwrap().port();
        let status = status.to_string();
        thread::spawn(move || {
            let (mut stream, _) = listener.accept().unwrap();
            let mut request = [0u8; 4096];
            let size = stream.read(&mut request).unwrap();
            let request = String::from_utf8_lossy(&request[..size]);
            assert!(request.starts_with("GET /storage/v1/bucket/line-message-images"));
            let response =
                format!("HTTP/1.1 {status}\r\nContent-Length: 0\r\nConnection: close\r\n\r\n");
            stream.write_all(response.as_bytes()).unwrap();
        });
        format!("http://localhost:{port}")
    }

    #[test]
    fn storage_headers_separate_publishable_key_and_user_jwt() {
        let headers = storage_headers("publishable-test", "user-jwt-test").unwrap();
        assert_eq!(headers.get("apikey").unwrap(), "publishable-test");
        assert_eq!(headers.get(AUTHORIZATION).unwrap(), "Bearer user-jwt-test");
    }

    #[test]
    fn empty_credentials_are_rejected_without_echoing_values() {
        let error = storage_headers("", "sensitive-test-token").unwrap_err();
        assert!(!error.contains("sensitive-test-token"));
    }

    #[test]
    fn password_login_returns_an_in_memory_user_token() {
        let url = mock_auth_server(
            "200 OK",
            r#"{"access_token":"synthetic-user-jwt","token_type":"bearer"}"#,
        );
        let token =
            tauri::async_runtime::block_on(authenticate(&test_settings(url), "synthetic-password"))
                .unwrap();
        let headers = token.headers("publishable-test").unwrap();
        assert_eq!(
            headers.get(AUTHORIZATION).unwrap(),
            "Bearer synthetic-user-jwt"
        );
    }

    #[test]
    fn authentication_failure_does_not_echo_the_response_or_password() {
        let url = mock_auth_server(
            "401 Unauthorized",
            r#"{"message":"synthetic-password-or-token"}"#,
        );
        let error =
            tauri::async_runtime::block_on(authenticate(&test_settings(url), "synthetic-password"))
                .err()
                .unwrap();
        assert!(!error.contains("synthetic-password"));
        assert!(!error.contains("synthetic-password-or-token"));
        assert!(error.contains("HTTP 401"));
    }

    #[test]
    fn bucket_metadata_access_distinguishes_an_empty_bucket_from_revocation() {
        let headers = storage_headers("publishable-test", "user-jwt-test").unwrap();
        let allowed_url = mock_bucket_server("200 OK");
        tauri::async_runtime::block_on(verify_bucket_access(
            &reqwest::Client::new(),
            &allowed_url,
            "line-message-images",
            &headers,
        ))
        .unwrap();

        let denied_url = mock_bucket_server("403 Forbidden");
        let error = tauri::async_runtime::block_on(verify_bucket_access(
            &reqwest::Client::new(),
            &denied_url,
            "line-message-images",
            &headers,
        ))
        .unwrap_err();
        assert!(error.contains("HTTP 403"));
        assert!(!error.contains("user-jwt-test"));
    }
}
