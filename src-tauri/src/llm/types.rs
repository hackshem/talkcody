use serde::{Deserialize, Serialize};
use std::collections::HashMap;

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq, Hash)]
#[serde(rename_all = "snake_case")]
pub enum ProtocolType {
    OpenAiCompatible,
    Claude,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ProviderConfig {
    pub id: String,
    pub name: String,
    pub protocol: ProtocolType,
    #[serde(rename = "baseUrl")]
    pub base_url: String,
    #[serde(rename = "apiKeyName")]
    pub api_key_name: String,
    #[serde(rename = "supportsOAuth")]
    pub supports_oauth: bool,
    #[serde(rename = "supportsCodingPlan")]
    pub supports_coding_plan: bool,
    #[serde(rename = "supportsInternational")]
    pub supports_international: bool,
    #[serde(rename = "codingPlanBaseUrl")]
    pub coding_plan_base_url: Option<String>,
    #[serde(rename = "internationalBaseUrl")]
    pub international_base_url: Option<String>,
    pub headers: Option<HashMap<String, String>>,
    #[serde(rename = "extraBody")]
    pub extra_body: Option<serde_json::Value>,
    #[serde(rename = "authType")]
    pub auth_type: AuthType,
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum AuthType {
    None,
    Bearer,
    ApiKey,
    OAuthBearer,
    TalkCodyJwt,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ModelConfig {
    pub name: String,
    #[serde(default, rename = "imageInput")]
    pub image_input: bool,
    #[serde(default, rename = "imageOutput")]
    pub image_output: bool,
    #[serde(default, rename = "audioInput")]
    pub audio_input: bool,
    #[serde(default)]
    pub interleaved: bool,
    pub providers: Vec<String>,
    #[serde(rename = "providerMappings")]
    pub provider_mappings: Option<HashMap<String, String>>,
    pub pricing: Option<ModelPricing>,
    pub context_length: Option<u32>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ModelPricing {
    pub input: String,
    pub output: String,
    #[serde(rename = "cachedInput")]
    pub cached_input: Option<String>,
    #[serde(rename = "cacheCreation")]
    pub cache_creation: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ModelsConfiguration {
    pub version: String,
    pub models: HashMap<String, ModelConfig>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AvailableModel {
    pub key: String,
    pub name: String,
    pub provider: String,
    #[serde(rename = "providerName")]
    pub provider_name: String,
    #[serde(rename = "imageInput")]
    pub image_input: bool,
    #[serde(rename = "imageOutput")]
    pub image_output: bool,
    #[serde(rename = "audioInput")]
    pub audio_input: bool,
    #[serde(rename = "inputPricing")]
    pub input_pricing: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct StreamTextRequest {
    pub model: String,
    pub messages: Vec<Message>,
    pub tools: Option<Vec<ToolDefinition>>,
    pub stream: Option<bool>,
    pub temperature: Option<f32>,
    #[serde(rename = "maxTokens")]
    pub max_tokens: Option<i32>,
    #[serde(rename = "topP")]
    pub top_p: Option<f32>,
    #[serde(rename = "topK")]
    pub top_k: Option<i32>,
    #[serde(rename = "providerOptions")]
    pub provider_options: Option<serde_json::Value>,
    #[serde(rename = "requestId")]
    pub request_id: Option<u32>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct StreamResponse {
    pub request_id: u32,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(tag = "role", rename_all = "lowercase")]
pub enum Message {
    System {
        content: String,
        #[serde(default, rename = "providerOptions")]
        provider_options: Option<serde_json::Value>,
    },
    User {
        content: MessageContent,
        #[serde(default, rename = "providerOptions")]
        provider_options: Option<serde_json::Value>,
    },
    Assistant {
        content: MessageContent,
        #[serde(default, rename = "providerOptions")]
        provider_options: Option<serde_json::Value>,
    },
    Tool {
        content: Vec<ContentPart>,
        #[serde(default, rename = "providerOptions")]
        provider_options: Option<serde_json::Value>,
    },
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(untagged)]
pub enum MessageContent {
    Text(String),
    Parts(Vec<ContentPart>),
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(tag = "type")]
pub enum ContentPart {
    #[serde(rename = "text")]
    Text { text: String },
    #[serde(rename = "image")]
    Image { image: String },
    #[serde(rename = "tool-call")]
    ToolCall {
        #[serde(rename = "toolCallId")]
        tool_call_id: String,
        #[serde(rename = "toolName")]
        tool_name: String,
        input: serde_json::Value,
    },
    #[serde(rename = "tool-result")]
    ToolResult {
        #[serde(rename = "toolCallId")]
        tool_call_id: String,
        #[serde(rename = "toolName")]
        tool_name: String,
        output: serde_json::Value,
    },
    #[serde(rename = "reasoning")]
    Reasoning {
        text: String,
        #[serde(default, rename = "providerOptions")]
        provider_options: Option<serde_json::Value>,
    },
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ToolDefinition {
    #[serde(rename = "type")]
    pub tool_type: String,
    pub name: String,
    pub description: Option<String>,
    pub parameters: serde_json::Value,
    pub strict: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(tag = "type", rename_all = "kebab-case")]
pub enum StreamEvent {
    TextStart,
    TextDelta {
        text: String,
    },
    ToolCall {
        #[serde(rename = "toolCallId")]
        tool_call_id: String,
        #[serde(rename = "toolName")]
        tool_name: String,
        input: serde_json::Value,
    },
    ReasoningStart {
        id: String,
        #[serde(default)]
        provider_metadata: Option<serde_json::Value>,
    },
    ReasoningDelta {
        id: String,
        text: String,
        #[serde(default)]
        provider_metadata: Option<serde_json::Value>,
    },
    ReasoningEnd {
        id: String,
    },
    Usage {
        input_tokens: i32,
        output_tokens: i32,
        total_tokens: Option<i32>,
        cached_input_tokens: Option<i32>,
        cache_creation_input_tokens: Option<i32>,
    },
    Done {
        finish_reason: Option<String>,
    },
    Error {
        message: String,
    },
    Raw {
        raw_value: String,
    },
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CustomProviderConfig {
    pub id: String,
    pub name: String,
    #[serde(rename = "type")]
    pub provider_type: CustomProviderType,
    #[serde(rename = "baseUrl")]
    pub base_url: String,
    #[serde(rename = "apiKey")]
    pub api_key: String,
    pub enabled: bool,
    pub description: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "kebab-case")]
pub enum CustomProviderType {
    OpenAiCompatible,
    Anthropic,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CustomProvidersConfiguration {
    pub version: String,
    pub providers: HashMap<String, CustomProviderConfig>,
}
