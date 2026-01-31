use crate::llm::types::CustomProvidersConfiguration;
use crate::llm::types::{AuthType, ProviderConfig};
use serde_json::Value;
use std::collections::HashMap;
use std::sync::Arc;
use tauri::State;
use tokio::sync::Mutex;

use crate::database::Database;

const SETTINGS_SELECT: &str = "SELECT value FROM settings WHERE key = $1";

pub struct ApiKeyManager {
    db: Arc<Database>,
}

impl ApiKeyManager {
    pub fn new(db: Arc<Database>) -> Self {
        Self { db }
    }

    pub async fn get_setting(&self, key: &str) -> Result<Option<String>, String> {
        let result = self
            .db
            .query(SETTINGS_SELECT, vec![Value::String(key.to_string())])
            .await?;
        if result.rows.is_empty() {
            return Ok(None);
        }
        Ok(result.rows[0]
            .get("value")
            .and_then(|v| v.as_str())
            .map(|v| v.to_string()))
    }

    pub async fn set_setting(&self, key: &str, value: &str) -> Result<(), String> {
        let now = chrono::Utc::now().timestamp_millis();
        self.db
            .execute(
                "INSERT OR REPLACE INTO settings (key, value, updated_at) VALUES ($1, $2, $3)",
                vec![
                    Value::String(key.to_string()),
                    Value::String(value.to_string()),
                    Value::Number(now.into()),
                ],
            )
            .await?;
        Ok(())
    }

    pub async fn load_api_keys(&self) -> Result<HashMap<String, String>, String> {
        let mut api_keys = HashMap::new();
        let keys = self
            .db
            .query(
                "SELECT key, value FROM settings WHERE key LIKE 'api_key_%'",
                vec![],
            )
            .await?;

        for row in keys.rows {
            if let (Some(key), Some(value)) = (row.get("key"), row.get("value")) {
                let key_str = key.as_str().unwrap_or_default();
                let value_str = value.as_str().unwrap_or_default();
                if let Some(provider_id) = key_str.strip_prefix("api_key_") {
                    if !value_str.is_empty() {
                        api_keys.insert(provider_id.to_string(), value_str.to_string());
                    }
                }
            }
        }

        Ok(api_keys)
    }

    pub async fn load_base_urls(&self) -> Result<HashMap<String, String>, String> {
        let mut base_urls = HashMap::new();
        let rows = self
            .db
            .query(
                "SELECT key, value FROM settings WHERE key LIKE 'base_url_%'",
                vec![],
            )
            .await?;
        for row in rows.rows {
            let key = row.get("key").and_then(|v| v.as_str()).unwrap_or_default();
            let value = row
                .get("value")
                .and_then(|v| v.as_str())
                .unwrap_or_default();
            if let Some(provider_id) = key.strip_prefix("base_url_") {
                if !value.is_empty() {
                    base_urls.insert(provider_id.to_string(), value.to_string());
                }
            }
        }
        Ok(base_urls)
    }

    pub async fn load_provider_flags(&self, prefix: &str) -> Result<HashMap<String, bool>, String> {
        let mut flags = HashMap::new();
        let rows = self
            .db
            .query(
                &format!(
                    "SELECT key, value FROM settings WHERE key LIKE '{}%'",
                    prefix
                ),
                vec![],
            )
            .await?;
        for row in rows.rows {
            let key = row.get("key").and_then(|v| v.as_str()).unwrap_or_default();
            let value = row
                .get("value")
                .and_then(|v| v.as_str())
                .unwrap_or_default();
            if let Some(provider_id) = key.strip_prefix(prefix) {
                flags.insert(provider_id.to_string(), value == "true");
            }
        }
        Ok(flags)
    }

    pub async fn load_custom_providers(&self) -> Result<CustomProvidersConfiguration, String> {
        let value = self.get_setting("custom_providers_json").await?;
        if let Some(raw) = value {
            let parsed: CustomProvidersConfiguration = serde_json::from_str(&raw)
                .map_err(|e| format!("Failed to parse custom providers: {}", e))?;
            Ok(parsed)
        } else {
            Ok(CustomProvidersConfiguration {
                version: chrono::Utc::now().to_rfc3339(),
                providers: HashMap::new(),
            })
        }
    }

    pub async fn save_custom_providers(
        &self,
        config: &CustomProvidersConfiguration,
    ) -> Result<(), String> {
        let raw = serde_json::to_string_pretty(config)
            .map_err(|e| format!("Failed to serialize custom providers: {}", e))?;
        self.set_setting("custom_providers_json", &raw).await
    }

    pub async fn get_credentials(
        &self,
        provider: &ProviderConfig,
    ) -> Result<ProviderCredentials, String> {
        match provider.auth_type {
            AuthType::None => Ok(ProviderCredentials::None),
            AuthType::TalkCodyJwt => {
                let token = self
                    .get_setting("talkcody_auth_token")
                    .await?
                    .unwrap_or_default();
                if token.is_empty() {
                    return Err(
                        "Authentication required. Please sign in to use TalkCody Free.".to_string(),
                    );
                }
                Ok(ProviderCredentials::Token(token))
            }
            AuthType::Bearer | AuthType::ApiKey | AuthType::OAuthBearer => {
                if provider.supports_oauth {
                    if let Some(token) = self.get_oauth_token(&provider.id).await? {
                        if !token.trim().is_empty() {
                            return Ok(ProviderCredentials::Token(token));
                        }
                    }
                }

                let api_key = self
                    .get_setting(&format!("api_key_{}", provider.id))
                    .await?
                    .unwrap_or_default();
                if !api_key.is_empty() {
                    return Ok(ProviderCredentials::Token(api_key));
                }

                Err(format!(
                    "API key not configured for provider {}",
                    provider.id
                ))
            }
        }
    }

    async fn get_oauth_token(&self, provider_id: &str) -> Result<Option<String>, String> {
        match provider_id {
            "openai" => self.get_setting("openai_oauth_access_token").await,
            "anthropic" => self.get_setting("claude_oauth_access_token").await,
            "github_copilot" => self.get_setting("github_copilot_oauth_copilot_token").await,
            "qwen_code" => Ok(None),
            _ => Ok(None),
        }
    }

    pub async fn has_oauth_token(&self, provider_id: &str) -> Result<bool, String> {
        Ok(self
            .get_oauth_token(provider_id)
            .await?
            .map(|token| !token.trim().is_empty())
            .unwrap_or(false))
    }

    pub async fn maybe_set_openai_account_header(
        &self,
        provider_id: &str,
        headers: &mut HashMap<String, String>,
    ) -> Result<(), String> {
        if provider_id != "openai" {
            return Ok(());
        }
        if let Some(account_id) = self.get_setting("openai_oauth_account_id").await? {
            if !account_id.trim().is_empty() {
                headers.insert("chatgpt-account-id".to_string(), account_id);
            }
        }
        Ok(())
    }

    pub async fn load_oauth_tokens(&self) -> Result<HashMap<String, String>, String> {
        let mut tokens = HashMap::new();
        if let Some(token) = self.get_setting("openai_oauth_access_token").await? {
            if !token.trim().is_empty() {
                tokens.insert("openai".to_string(), token);
            }
        }
        if let Some(token) = self.get_setting("claude_oauth_access_token").await? {
            if !token.trim().is_empty() {
                tokens.insert("anthropic".to_string(), token);
            }
        }
        if let Some(token) = self
            .get_setting("github_copilot_oauth_copilot_token")
            .await?
        {
            if !token.trim().is_empty() {
                tokens.insert("github_copilot".to_string(), token);
            }
        }
        Ok(tokens)
    }
}

pub enum ProviderCredentials {
    None,
    Token(String),
}

pub struct LlmState {
    pub registry: Mutex<crate::llm::providers::provider_registry::ProviderRegistry>,
    pub api_keys: Mutex<ApiKeyManager>,
}

impl LlmState {
    pub fn new(db: Arc<Database>, providers: Vec<ProviderConfig>) -> Self {
        Self {
            registry: Mutex::new(
                crate::llm::providers::provider_registry::ProviderRegistry::new(providers),
            ),
            api_keys: Mutex::new(ApiKeyManager::new(db)),
        }
    }
}

#[tauri::command]
pub async fn llm_set_setting(
    key: String,
    value: String,
    state: State<'_, LlmState>,
) -> Result<(), String> {
    let api_keys = state.api_keys.lock().await;
    api_keys.set_setting(&key, &value).await
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::database::Database;
    use crate::llm::types::ProtocolType;
    use std::collections::HashMap;
    use std::sync::Arc;
    use tempfile::TempDir;

    struct TestContext {
        _dir: TempDir,
        api_keys: ApiKeyManager,
    }

    async fn setup() -> TestContext {
        let dir = TempDir::new().expect("temp dir");
        let db_path = dir.path().join("llm-settings.db");
        let db = Arc::new(Database::new(db_path.to_string_lossy().to_string()));
        db.connect().await.expect("db connect");
        db.execute(
            "CREATE TABLE IF NOT EXISTS settings (key TEXT PRIMARY KEY, value TEXT, updated_at INTEGER)",
            vec![],
        )
        .await
        .expect("create settings");
        TestContext {
            _dir: dir,
            api_keys: ApiKeyManager::new(db),
        }
    }

    fn provider_config(id: &str, auth_type: AuthType, supports_oauth: bool) -> ProviderConfig {
        ProviderConfig {
            id: id.to_string(),
            name: "Test".to_string(),
            protocol: ProtocolType::OpenAiCompatible,
            base_url: "https://example.com".to_string(),
            api_key_name: "TEST_API_KEY".to_string(),
            supports_oauth,
            supports_coding_plan: false,
            supports_international: false,
            coding_plan_base_url: None,
            international_base_url: None,
            headers: None,
            extra_body: None,
            auth_type,
        }
    }

    #[tokio::test]
    async fn get_credentials_rejects_missing_talkcody_jwt() {
        let ctx = setup().await;
        let provider = provider_config("talkcody", AuthType::TalkCodyJwt, false);
        let result = ctx.api_keys.get_credentials(&provider).await;
        assert!(result.is_err());
        assert!(result.unwrap_err().contains("Authentication required"));
    }

    #[tokio::test]
    async fn get_credentials_accepts_talkcody_jwt() {
        let ctx = setup().await;
        ctx.api_keys
            .set_setting("talkcody_auth_token", "token")
            .await
            .expect("set token");
        let provider = provider_config("talkcody", AuthType::TalkCodyJwt, false);
        let result = ctx.api_keys.get_credentials(&provider).await;
        match result {
            Ok(ProviderCredentials::Token(value)) => assert_eq!(value, "token"),
            _ => panic!("Unexpected credentials"),
        }
    }

    #[tokio::test]
    async fn get_credentials_prefers_oauth_token() {
        let ctx = setup().await;
        ctx.api_keys
            .set_setting("openai_oauth_access_token", "oauth")
            .await
            .expect("set oauth token");
        ctx.api_keys
            .set_setting("api_key_openai", "api")
            .await
            .expect("set api key");
        let provider = provider_config("openai", AuthType::Bearer, true);
        let result = ctx.api_keys.get_credentials(&provider).await;
        match result {
            Ok(ProviderCredentials::Token(value)) => assert_eq!(value, "oauth"),
            _ => panic!("Unexpected credentials"),
        }
    }

    #[tokio::test]
    async fn get_credentials_falls_back_to_api_key() {
        let ctx = setup().await;
        ctx.api_keys
            .set_setting("api_key_openai", "api")
            .await
            .expect("set api key");
        let provider = provider_config("openai", AuthType::Bearer, true);
        let result = ctx.api_keys.get_credentials(&provider).await;
        match result {
            Ok(ProviderCredentials::Token(value)) => assert_eq!(value, "api"),
            _ => panic!("Unexpected credentials"),
        }
    }

    #[tokio::test]
    async fn get_credentials_none_auth() {
        let ctx = setup().await;
        let provider = provider_config("ollama", AuthType::None, false);
        let result = ctx.api_keys.get_credentials(&provider).await;
        match result {
            Ok(ProviderCredentials::None) => {}
            _ => panic!("Unexpected credentials"),
        }
    }

    #[tokio::test]
    async fn maybe_set_openai_account_header_adds_header() {
        let ctx = setup().await;
        ctx.api_keys
            .set_setting("openai_oauth_account_id", "acct_123")
            .await
            .expect("set account id");
        let mut headers: HashMap<String, String> = HashMap::new();
        ctx.api_keys
            .maybe_set_openai_account_header("openai", &mut headers)
            .await
            .expect("set header");
        assert_eq!(
            headers.get("chatgpt-account-id"),
            Some(&"acct_123".to_string())
        );

        let mut other_headers: HashMap<String, String> = HashMap::new();
        ctx.api_keys
            .maybe_set_openai_account_header("anthropic", &mut other_headers)
            .await
            .expect("no header");
        assert!(other_headers.get("chatgpt-account-id").is_none());
    }

    #[tokio::test]
    async fn load_provider_flags_parses_boolean_settings() {
        let ctx = setup().await;
        ctx.api_keys
            .set_setting("use_coding_plan_zhipu", "true")
            .await
            .expect("set flag");
        ctx.api_keys
            .set_setting("use_coding_plan_zai", "false")
            .await
            .expect("set flag");

        let flags = ctx
            .api_keys
            .load_provider_flags("use_coding_plan_")
            .await
            .expect("load flags");
        assert_eq!(flags.get("zhipu"), Some(&true));
        assert_eq!(flags.get("zai"), Some(&false));
    }
}
