use crate::llm::auth::api_key_manager::ApiKeyManager;
use crate::llm::providers::provider_registry::ProviderRegistry;
use crate::llm::types::{AvailableModel, CustomProvidersConfiguration, ModelsConfiguration};
use std::collections::HashMap;

pub struct ModelRegistry;

impl ModelRegistry {
    pub async fn load_models_config(
        api_keys: &ApiKeyManager,
    ) -> Result<ModelsConfiguration, String> {
        if let Some(raw) = api_keys.get_setting("models_config_json").await? {
            let parsed: ModelsConfiguration = serde_json::from_str(&raw)
                .map_err(|e| format!("Failed to parse models config: {}", e))?;
            return Ok(parsed);
        }

        let default_config =
            include_str!("../../../../packages/shared/src/data/models-config.json");
        let parsed: ModelsConfiguration = serde_json::from_str(default_config)
            .map_err(|e| format!("Failed to parse bundled models config: {}", e))?;
        Ok(parsed)
    }

    pub async fn compute_available_models(
        api_keys: &ApiKeyManager,
        registry: &ProviderRegistry,
    ) -> Result<Vec<AvailableModel>, String> {
        let models = Self::load_models_config(api_keys).await?;
        let custom_providers = api_keys.load_custom_providers().await?;

        let mut api_key_map = api_keys.load_api_keys().await?;
        let oauth_tokens = api_keys.load_oauth_tokens().await?;
        for (provider_id, token) in oauth_tokens {
            api_key_map.entry(provider_id).or_insert(token);
        }

        let available = Self::compute_available_models_internal(
            &models,
            &api_key_map,
            registry,
            &custom_providers,
        );
        Ok(available)
    }

    fn compute_available_models_internal(
        config: &ModelsConfiguration,
        api_keys: &HashMap<String, String>,
        registry: &ProviderRegistry,
        custom_providers: &CustomProvidersConfiguration,
    ) -> Vec<AvailableModel> {
        let mut model_map: HashMap<String, AvailableModel> = HashMap::new();

        for (model_key, model_cfg) in &config.models {
            let providers = &model_cfg.providers;
            for provider_id in providers {
                if Self::provider_available(provider_id, api_keys, registry, custom_providers) {
                    if let Some(provider) = registry.provider(provider_id) {
                        let key = format!("{}-{}", model_key, provider_id);
                        if !model_map.contains_key(&key) {
                            model_map.insert(
                                key,
                                AvailableModel {
                                    key: model_key.clone(),
                                    name: model_cfg.name.clone(),
                                    provider: provider_id.clone(),
                                    provider_name: provider.name.clone(),
                                    image_input: model_cfg.image_input,
                                    image_output: model_cfg.image_output,
                                    audio_input: model_cfg.audio_input,
                                    input_pricing: model_cfg
                                        .pricing
                                        .as_ref()
                                        .map(|p| p.input.clone()),
                                },
                            );
                        }
                    }
                }
            }
        }

        for (model_key, model_cfg) in &config.models {
            let providers = &model_cfg.providers;
            for provider_id in providers {
                if custom_providers.providers.contains_key(provider_id) {
                    let key = format!("{}-{}", model_key, provider_id);
                    if !model_map.contains_key(&key) {
                        if let Some(custom) = custom_providers.providers.get(provider_id) {
                            model_map.insert(
                                key,
                                AvailableModel {
                                    key: model_key.clone(),
                                    name: model_cfg.name.clone(),
                                    provider: provider_id.clone(),
                                    provider_name: custom.name.clone(),
                                    image_input: model_cfg.image_input,
                                    image_output: model_cfg.image_output,
                                    audio_input: model_cfg.audio_input,
                                    input_pricing: model_cfg
                                        .pricing
                                        .as_ref()
                                        .map(|p| p.input.clone()),
                                },
                            );
                        }
                    }
                }
            }
        }

        let mut result: Vec<AvailableModel> = model_map.values().cloned().collect();
        result.sort_by(|a, b| a.name.cmp(&b.name));
        result
    }

    pub fn resolve_provider_model_name(
        model_key: &str,
        provider_id: &str,
        config: &ModelsConfiguration,
    ) -> String {
        if let Some(model_cfg) = config.models.get(model_key) {
            if let Some(mapping) = &model_cfg.provider_mappings {
                if let Some(mapped) = mapping.get(provider_id) {
                    return mapped.clone();
                }
            }
        }
        model_key.to_string()
    }

    pub fn get_model_provider(
        model_identifier: &str,
        api_keys: &HashMap<String, String>,
        registry: &ProviderRegistry,
        custom_providers: &CustomProvidersConfiguration,
        config: &ModelsConfiguration,
    ) -> Result<(String, String), String> {
        let parts: Vec<&str> = model_identifier.split('@').collect();
        if parts.len() == 2 {
            return Ok((parts[0].to_string(), parts[1].to_string()));
        }

        if let Some(model_cfg) = config.models.get(model_identifier) {
            for provider_id in &model_cfg.providers {
                if Self::provider_available(provider_id, api_keys, registry, custom_providers) {
                    return Ok((model_identifier.to_string(), provider_id.clone()));
                }
            }

            return Err(format!(
                "No available provider for model {}",
                model_identifier
            ));
        }

        for provider_id in registry.providers().iter().map(|p| p.id.clone()) {
            if Self::provider_available(&provider_id, api_keys, registry, custom_providers) {
                return Ok((model_identifier.to_string(), provider_id));
            }
        }

        if let Some((provider_id, _)) = custom_providers.providers.iter().find(|(_, p)| p.enabled) {
            return Ok((model_identifier.to_string(), provider_id.to_string()));
        }

        Err(format!(
            "No available provider for model {}",
            model_identifier
        ))
    }

    fn provider_available(
        provider_id: &str,
        api_keys: &HashMap<String, String>,
        registry: &ProviderRegistry,
        custom_providers: &CustomProvidersConfiguration,
    ) -> bool {
        if let Some(provider) = registry.provider(provider_id) {
            if provider.auth_type == crate::llm::types::AuthType::None {
                if provider_id == "ollama" || provider_id == "lmstudio" {
                    return api_keys
                        .get(provider_id)
                        .map(|v| v == "enabled")
                        .unwrap_or(false);
                }
                return true;
            }
            if api_keys.get(provider_id).is_some() {
                return true;
            }
            if provider.supports_oauth {
                if let Some(token) = api_keys.get(provider_id) {
                    if !token.trim().is_empty() {
                        return true;
                    }
                }
            }
        }

        if let Some(custom) = custom_providers.providers.get(provider_id) {
            return custom.enabled;
        }

        false
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::database::Database;
    use crate::llm::providers::provider_registry::ProviderRegistry;
    use crate::llm::types::{CustomProviderConfig, CustomProviderType, ModelConfig, ModelPricing};
    use crate::llm::types::{ProtocolType, ProviderConfig};
    use std::collections::HashMap;
    use tempfile::TempDir;

    struct TestContext {
        _dir: TempDir,
        api_keys: ApiKeyManager,
    }

    async fn setup_api_keys() -> TestContext {
        let dir = TempDir::new().expect("temp dir");
        let db_path = dir.path().join("models-test.db");
        let db = std::sync::Arc::new(Database::new(db_path.to_string_lossy().to_string()));
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

    fn provider_config(id: &str, auth_type: crate::llm::types::AuthType) -> ProviderConfig {
        ProviderConfig {
            id: id.to_string(),
            name: id.to_string(),
            protocol: ProtocolType::OpenAiCompatible,
            base_url: "https://example.com".to_string(),
            api_key_name: "TEST_API_KEY".to_string(),
            supports_oauth: false,
            supports_coding_plan: false,
            supports_international: false,
            coding_plan_base_url: None,
            international_base_url: None,
            headers: None,
            extra_body: None,
            auth_type,
        }
    }

    fn build_models_config() -> ModelsConfiguration {
        let mut models = HashMap::new();
        models.insert(
            "gpt-4o".to_string(),
            ModelConfig {
                name: "GPT-4o".to_string(),
                image_input: false,
                image_output: false,
                audio_input: false,
                interleaved: false,
                providers: vec![
                    "openai".to_string(),
                    "ollama".to_string(),
                    "custom".to_string(),
                ],
                provider_mappings: Some(HashMap::from([(
                    "ollama".to_string(),
                    "llama3".to_string(),
                )])),
                pricing: Some(ModelPricing {
                    input: "1".to_string(),
                    output: "2".to_string(),
                    cached_input: None,
                    cache_creation: None,
                }),
                context_length: None,
            },
        );
        ModelsConfiguration {
            version: "1".to_string(),
            models,
        }
    }

    #[tokio::test]
    async fn load_models_config_prefers_db_override() {
        let ctx = setup_api_keys().await;
        let config = build_models_config();
        let raw = serde_json::to_string(&config).expect("serialize config");
        ctx.api_keys
            .set_setting("models_config_json", &raw)
            .await
            .expect("set config");

        let loaded = ModelRegistry::load_models_config(&ctx.api_keys)
            .await
            .expect("load config");
        assert_eq!(loaded.version, "1");
        assert!(loaded.models.contains_key("gpt-4o"));
    }

    #[test]
    fn resolve_provider_model_name_uses_mapping() {
        let config = build_models_config();
        let name = ModelRegistry::resolve_provider_model_name("gpt-4o", "ollama", &config);
        assert_eq!(name, "llama3");
    }

    #[test]
    fn resolve_provider_model_name_falls_back_to_key() {
        let config = build_models_config();
        let name = ModelRegistry::resolve_provider_model_name("gpt-4o", "openai", &config);
        assert_eq!(name, "gpt-4o");
    }

    #[test]
    fn get_model_provider_accepts_explicit_provider() {
        let registry = ProviderRegistry::new(vec![provider_config(
            "openai",
            crate::llm::types::AuthType::Bearer,
        )]);
        let api_keys = HashMap::new();
        let custom_providers = CustomProvidersConfiguration {
            version: "1".to_string(),
            providers: HashMap::new(),
        };

        let config = build_models_config();
        let (model, provider) = ModelRegistry::get_model_provider(
            "gpt-4o@openai",
            &api_keys,
            &registry,
            &custom_providers,
            &config,
        )
        .expect("resolve provider");
        assert_eq!(model, "gpt-4o");
        assert_eq!(provider, "openai");
    }

    #[test]
    fn compute_available_models_includes_enabled_custom_provider() {
        let config = build_models_config();
        let registry = ProviderRegistry::new(vec![provider_config(
            "openai",
            crate::llm::types::AuthType::Bearer,
        )]);
        let api_keys = HashMap::from([("openai".to_string(), "key".to_string())]);
        let custom_provider = CustomProviderConfig {
            id: "custom".to_string(),
            name: "Custom".to_string(),
            provider_type: CustomProviderType::OpenAiCompatible,
            base_url: "https://custom".to_string(),
            api_key: "key".to_string(),
            enabled: true,
            description: None,
        };
        let custom_providers = CustomProvidersConfiguration {
            version: "1".to_string(),
            providers: HashMap::from([(custom_provider.id.clone(), custom_provider)]),
        };

        let available = ModelRegistry::compute_available_models_internal(
            &config,
            &api_keys,
            &registry,
            &custom_providers,
        );
        assert!(available.iter().any(|model| model.provider == "openai"));
        assert!(available.iter().any(|model| model.provider == "custom"));
    }

    #[test]
    fn provider_available_requires_enable_flag_for_ollama() {
        let config = build_models_config();
        let registry = ProviderRegistry::new(vec![provider_config(
            "ollama",
            crate::llm::types::AuthType::None,
        )]);
        let api_keys = HashMap::new();
        let custom_providers = CustomProvidersConfiguration {
            version: "1".to_string(),
            providers: HashMap::new(),
        };

        let available = ModelRegistry::compute_available_models_internal(
            &config,
            &api_keys,
            &registry,
            &custom_providers,
        );
        assert!(available.is_empty());

        let api_keys = HashMap::from([("ollama".to_string(), "enabled".to_string())]);
        let available = ModelRegistry::compute_available_models_internal(
            &config,
            &api_keys,
            &registry,
            &custom_providers,
        );
        assert!(!available.is_empty());
    }

    #[test]
    fn get_model_provider_prefers_model_config_providers_over_registry_order() {
        let mut config = build_models_config();
        if let Some(model_cfg) = config.models.get_mut("gpt-4o") {
            model_cfg.providers = vec!["openai".to_string()];
        }

        let registry = ProviderRegistry::new(vec![
            provider_config("deepseek", crate::llm::types::AuthType::Bearer),
            provider_config("openai", crate::llm::types::AuthType::Bearer),
        ]);
        let api_keys = HashMap::from([
            ("deepseek".to_string(), "key".to_string()),
            ("openai".to_string(), "key".to_string()),
        ]);
        let custom_providers = CustomProvidersConfiguration {
            version: "1".to_string(),
            providers: HashMap::new(),
        };

        let (model, provider) = ModelRegistry::get_model_provider(
            "gpt-4o",
            &api_keys,
            &registry,
            &custom_providers,
            &config,
        )
        .expect("resolve provider");

        assert_eq!(model, "gpt-4o");
        assert_eq!(provider, "openai");
    }
}
