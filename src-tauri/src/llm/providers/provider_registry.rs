use crate::llm::protocols::{
    claude_protocol::ClaudeProtocol, openai_protocol::OpenAiProtocol, LlmProtocol,
};
use crate::llm::types::{ProtocolType, ProviderConfig};
use std::collections::HashMap;

pub struct ProviderRegistry {
    providers: HashMap<String, ProviderConfig>,
    protocols: HashMap<ProtocolType, Box<dyn LlmProtocol>>,
}

impl ProviderRegistry {
    pub fn new(builtin_providers: Vec<ProviderConfig>) -> Self {
        let mut providers = HashMap::new();
        for provider in builtin_providers {
            providers.insert(provider.id.clone(), provider);
        }

        let mut protocols: HashMap<ProtocolType, Box<dyn LlmProtocol>> = HashMap::new();
        protocols.insert(ProtocolType::OpenAiCompatible, Box::new(OpenAiProtocol));
        protocols.insert(ProtocolType::Claude, Box::new(ClaudeProtocol));

        Self {
            providers,
            protocols,
        }
    }

    pub fn register_provider(&mut self, config: ProviderConfig) {
        self.providers.insert(config.id.clone(), config);
    }

    pub fn provider(&self, id: &str) -> Option<&ProviderConfig> {
        self.providers.get(id)
    }

    pub fn providers(&self) -> Vec<ProviderConfig> {
        self.providers.values().cloned().collect()
    }

    pub fn protocol(&self, protocol: ProtocolType) -> Option<&dyn LlmProtocol> {
        self.protocols.get(&protocol).map(|p| p.as_ref())
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::llm::types::{AuthType, ProviderConfig};

    fn provider_config(id: &str) -> ProviderConfig {
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
            auth_type: AuthType::Bearer,
        }
    }

    #[test]
    fn new_registers_builtin_protocols() {
        let registry = ProviderRegistry::new(Vec::new());
        assert!(registry.protocol(ProtocolType::OpenAiCompatible).is_some());
        assert!(registry.protocol(ProtocolType::Claude).is_some());
    }

    #[test]
    fn register_provider_updates_lookup() {
        let mut registry = ProviderRegistry::new(Vec::new());
        registry.register_provider(provider_config("openai"));
        let provider = registry.provider("openai").expect("provider exists");
        assert_eq!(provider.name, "openai");
    }
}
