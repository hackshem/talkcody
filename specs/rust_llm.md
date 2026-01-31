# Refactor Design Plan: Move Provider/Model Management to Rust Backend

## 1. Objective

Move provider and model management from the TypeScript frontend (currently using Vercel AI SDK) to a Rust backend implementation using raw HTTP for OpenAI-compatible and Claude protocols, while maintaining extensibility similar to Vercel AI SDK's provider architecture.

---

## 2. Impact Analysis

### Files to Create

**Rust Backend (src-tauri/src/llm/):**
```
src-tauri/src/llm/
├── mod.rs                     # Module exports and initialization
├── types.rs                   # Core LLM types (Provider, Model, Message, etc.)
├── protocols/
│   ├── mod.rs                 # Protocol exports
│   ├── openai_protocol.rs     # OpenAI API protocol implementation
│   └── claude_protocol.rs     # Anthropic Claude API protocol implementation
├── providers/
│   ├── mod.rs                 # Provider management
│   ├── provider_registry.rs   # Provider registration and lookup
│   ├── provider_configs.rs    # Built-in provider configurations
│   └── provider_factory.rs    # Provider instance creation
├── streaming/
│   ├── mod.rs                 # Streaming exports
│   ├── stream_handler.rs      # SSE stream parsing and handling
│   └── stream_transformer.rs  # Transform streams between protocols
├── auth/
│   ├── mod.rs                 # Auth exports
│   ├── api_key_manager.rs     # API key storage and retrieval
│   └── oauth_manager.rs       # OAuth token management
├── models/
│   ├── mod.rs                 # Model exports
│   ├── model_registry.rs      # Model registration and capabilities
│   └── model_resolver.rs      # Model ID to provider resolution
└── commands.rs                # Tauri command handlers for frontend
```

**TypeScript Frontend (new/modified):**
```
src/services/llm/
├── llm-client.ts              # New: Rust LLM service client
├── types.ts                   # New: Shared types between Rust/TS
└── index.ts                   # New: Public exports

src/providers/                 # Modified
├── stores/provider-store.ts   # Modified: Delegate to Rust backend
├── config/provider-config.ts  # Deprecated: Move to Rust
└── core/provider-utils.ts     # Deprecated: Move to Rust

src/services/agents/llm-service.ts  # Modified: Use new LLM client
src/lib/tauri-fetch.ts         # Reuse: Already handles HTTP via Rust
```

### Files to Modify

1. **src-tauri/src/lib.rs** - Add LLM module and commands
2. **src/providers/stores/provider-store.ts** - Delegate to Rust backend
3. **src/services/agents/llm-service.ts** - Use new streaming API
4. **src/services/ai/ai-completion-service.ts** - Use new API
5. **src/services/ai/ai-task-title-service.ts** - Use new API
6. **src/services/ai/ai-context-compaction.ts** - Use new API
7. **Cargo.toml** - Add required dependencies

### Dependencies

**Rust Dependencies (Cargo.toml):**
```toml
[dependencies]
# HTTP client
reqwest = { version = "0.12", features = ["json", "stream", "rustls-tls"] }
# SSE parsing
eventsource-stream = "0.2"
# Async runtime (already have tokio)
tokio = { version = "1", features = ["full"] }
# Serialization
serde = { version = "1.0", features = ["derive"] }
serde_json = "1.0"
# Error handling
thiserror = "1.0"
# Type-safe IDs
uuid = { version = "1.0", features = ["v4", "serde"] }
# Time handling
chrono = { version = "0.4", features = ["serde"] }
# Regex for parsing
regex = "1.0"
# Rate limiting (optional)
governor = "0.6"
# Caching (optional)
moka = "0.12"
```

---

## 3. Architecture Overview

### 3.1 High-Level Data Flow

```
┌─────────────────────────────────────────────────────────────────┐
│                     Frontend (TypeScript)                       │
├─────────────────────────────────────────────────────────────────┤
│  llm-service.ts                                                 │
│  ├─ Calls Rust: llm_stream_text()                               │
│  └─ Receives: Event stream (chunks, tool calls, reasoning)      │
└───────────────────────────┬─────────────────────────────────────┘
                            │ Tauri Commands
                            ▼
┌─────────────────────────────────────────────────────────────────┐
│                      Backend (Rust)                              │
├─────────────────────────────────────────────────────────────────┤
│  LLM Service                                                    │
│  ├─ Provider Registry: Built-in + Custom providers              │
│  ├─ Model Registry: Available models per provider               │
│  ├─ Auth Manager: API keys, OAuth tokens                        │
│  ├─ Protocol Handlers:                                          │
│  │   ├─ OpenAI Protocol (/v1/chat/completions)                  │
│  │   └─ Claude Protocol (/v1/messages)                          │
│  └─ Streaming Handler: Parse SSE, emit events                   │
└───────────────────────────┬─────────────────────────────────────┘
                            │ Raw HTTP
                            ▼
┌─────────────────────────────────────────────────────────────────┐
│                    External LLM APIs                             │
│  OpenAI, Anthropic, DeepSeek, Google, etc.                      │
└─────────────────────────────────────────────────────────────────┘
```

### 3.2 Protocol Abstraction Layer

```rust
// Core trait for all LLM protocols
trait LLMProtocol: Send + Sync {
    /// Protocol name (e.g., "openai", "anthropic")
    fn name(&self) -> &str;
    
    /// Build the request payload for this protocol
    fn build_request(&self, params: ChatCompletionParams) -> Result<RequestBody, LLMError>;
    
    /// Parse a streaming chunk from this protocol
    fn parse_stream_chunk(&self, chunk: &str) -> Result<StreamEvent, LLMError>;
    
    /// Extract usage information from response
    fn extract_usage(&self, response: &Value) -> Option<TokenUsage>;
    
    /// Get headers required for this protocol
    fn auth_headers(&self, credentials: &Credentials) -> HeaderMap;
}

// OpenAI Protocol Implementation
struct OpenAIProtocol;
impl LLMProtocol for OpenAIProtocol {
    fn build_request(&self, params: ChatCompletionParams) -> Result<RequestBody, LLMError> {
        // Convert generic params to OpenAI format
        // {
        //   "model": "gpt-4",
        //   "messages": [...],
        //   "stream": true,
        //   "tools": [...]
        // }
    }
    
    fn parse_stream_chunk(&self, chunk: &str) -> Result<StreamEvent, LLMError> {
        // Parse SSE data: lines starting with "data: "
        // Handle [DONE] marker
        // Extract delta content, tool calls, reasoning
    }
}

// Claude Protocol Implementation  
struct ClaudeProtocol;
impl LLMProtocol for ClaudeProtocol {
    fn build_request(&self, params: ChatCompletionParams) -> Result<RequestBody, LLMError> {
        // Convert to Claude format
        // {
        //   "model": "claude-3-opus",
        //   "messages": [...],
        //   "stream": true,
        //   "thinking": {...} // for extended thinking
        // }
    }
    
    fn parse_stream_chunk(&self, chunk: &str) -> Result<StreamEvent, LLMError> {
        // Parse SSE for Claude's event types
        // content_block_delta, content_block_start, etc.
    }
}
```

### 3.3 Provider Configuration Schema

```rust
// Rust representation of provider configs
#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct ProviderConfig {
    pub id: String,
    pub name: String,
    pub protocol: ProtocolType,  // OpenAICompatible, Claude, Custom
    pub base_url: String,
    pub api_key_name: String,
    pub supports_oauth: bool,
    pub default_models: Vec<String>,
    pub headers: Option<HashMap<String, String>>,
    pub extra_body: Option<Value>,
}

#[derive(Clone, Copy, Debug, Serialize, Deserialize)]
pub enum ProtocolType {
    #[serde(rename = "openai")]
    OpenAICompatible,
    #[serde(rename = "anthropic")]
    Claude,
    #[serde(rename = "google")]
    Google,
    #[serde(rename = "custom")]
    Custom,
}

// Built-in providers (migrated from provider-config.ts)
pub fn get_builtin_providers() -> Vec<ProviderConfig> {
    vec![
        ProviderConfig {
            id: "openai".to_string(),
            name: "OpenAI".to_string(),
            protocol: ProtocolType::OpenAICompatible,
            base_url: "https://api.openai.com/v1".to_string(),
            api_key_name: "OPENAI_API_KEY".to_string(),
            supports_oauth: true,
            default_models: vec!["gpt-4o".to_string(), "gpt-4o-mini".to_string()],
            headers: None,
            extra_body: None,
        },
        ProviderConfig {
            id: "anthropic".to_string(),
            name: "Anthropic".to_string(),
            protocol: ProtocolType::Claude,
            base_url: "https://api.anthropic.com/v1".to_string(),
            api_key_name: "ANTHROPIC_API_KEY".to_string(),
            supports_oauth: false,
            default_models: vec!["claude-3-5-sonnet".to_string(), "claude-3-opus".to_string()],
            headers: None,
            extra_body: None,
        },
        // ... more providers
    ]
}
```

---

## 4. Implementation Details

### Phase 1: Rust Backend Foundation (Week 1-2)

#### Step 1.1: Core Types and Protocol Definitions
- Define `LLMProtocol` trait and supporting types
- Implement `OpenAIProtocol` and `ClaudeProtocol`
- Create request/response types matching current TS usage

```rust
// src-tauri/src/llm/types.rs
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ChatCompletionParams {
    pub model: String,
    pub messages: Vec<Message>,
    pub tools: Option<Vec<ToolDefinition>>,
    pub stream: bool,
    pub temperature: Option<f32>,
    pub max_tokens: Option<i32>,
    pub top_p: Option<f32>,
    pub provider_options: Option<Value>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(tag = "role", rename_all = "lowercase")]
pub enum Message {
    System { content: String },
    User { content: Vec<ContentPart> },
    Assistant { content: Vec<ContentPart> },
    Tool { tool_call_id: String, content: String },
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(tag = "type", rename_all = "snake_case")]
pub enum ContentPart {
    Text { text: String },
    Image { source: ImageSource },
    ToolCall { id: String, name: String, arguments: Value },
    Reasoning { reasoning: String, signature: Option<String> },
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct StreamEvent {
    pub event_type: StreamEventType,
    pub index: Option<usize>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(tag = "type", rename_all = "snake_case")]
pub enum StreamEventType {
    TextStart,
    TextDelta { text: String },
    ToolCallStart { id: String, name: String },
    ToolCallDelta { id: String, arguments: String },
    ReasoningStart { id: String },
    ReasoningDelta { id: String, text: String, signature: Option<String> },
    Usage { input_tokens: i32, output_tokens: i32 },
    Done,
    Error { message: String },
}
```

#### Step 1.2: Provider Registry and Configuration
- Move provider configs from `provider-config.ts` to Rust
- Support custom provider registration via settings
- Handle OAuth token management

```rust
// src-tauri/src/llm/providers/provider_registry.rs
pub struct ProviderRegistry {
    providers: HashMap<String, ProviderConfig>,
    protocol_handlers: HashMap<ProtocolType, Box<dyn LLMProtocol>>,
}

impl ProviderRegistry {
    pub fn new() -> Self {
        let mut registry = Self {
            providers: HashMap::new(),
            protocol_handlers: HashMap::new(),
        };
        
        // Register built-in providers
        for config in get_builtin_providers() {
            registry.providers.insert(config.id.clone(), config);
        }
        
        // Register protocol handlers
        registry.protocol_handlers.insert(
            ProtocolType::OpenAICompatible, 
            Box::new(OpenAIProtocol)
        );
        registry.protocol_handlers.insert(
            ProtocolType::Claude, 
            Box::new(ClaudeProtocol)
        );
        
        registry
    }
    
    pub fn register_custom_provider(&mut self, config: ProviderConfig) {
        self.providers.insert(config.id.clone(), config);
    }
    
    pub fn get_protocol(&self, protocol_type: ProtocolType) -> Option<&dyn LLMProtocol> {
        self.protocol_handlers.get(&protocol_type).map(|b| b.as_ref())
    }
}
```

#### Step 1.3: Streaming HTTP Handler
- Leverage existing `http_proxy.rs` infrastructure
- Add SSE parsing for LLM streaming responses
- Emit Tauri events for frontend consumption

```rust
// src-tauri/src/llm/streaming/stream_handler.rs
pub struct StreamHandler {
    request_id: u32,
    protocol: ProtocolType,
}

impl StreamHandler {
    pub async fn stream_completion(
        &self,
        window: Window,
        provider: &ProviderConfig,
        params: ChatCompletionParams,
        credentials: Credentials,
    ) -> Result<(), LLMError> {
        let client = reqwest::Client::new();
        let protocol_handler = get_protocol(self.protocol)?;
        
        // Build request
        let request_body = protocol_handler.build_request(params)?;
        let headers = protocol_handler.auth_headers(&credentials);
        
        // Send request
        let response = client
            .post(&format!("{}/chat/completions", provider.base_url))
            .headers(headers)
            .json(&request_body)
            .send()
            .await?;
            
        // Handle SSE stream
        let mut stream = response.bytes_stream();
        let mut buffer = String::new();
        
        while let Some(chunk) = stream.next().await {
            let bytes = chunk?;
            buffer.push_str(&String::from_utf8_lossy(&bytes));
            
            // Process complete SSE events
            while let Some(event_end) = buffer.find("\n\n") {
                let event = buffer[..event_end].to_string();
                buffer = buffer[event_end + 2..].to_string();
                
                if let Some(stream_event) = self.parse_sse_event(&event)? {
                    // Emit to frontend
                    window.emit(
                        &format!("llm-stream-{}", self.request_id),
                        stream_event
                    )?;
                }
            }
        }
        
        // Emit completion
        window.emit(
            &format!("llm-stream-{}", self.request_id),
            StreamEvent { event_type: StreamEventType::Done }
        )?;
        
        Ok(())
    }
}
```

### Phase 2: Tauri Commands and Frontend Client (Week 2-3)

#### Step 2.1: Tauri Commands
```rust
// src-tauri/src/llm/commands.rs
#[tauri::command]
pub async fn llm_stream_text(
    window: Window,
    request: StreamTextRequest,
    state: State<'_, LLMState>,
) -> Result<StreamResponse, String> {
    let llm_service = state.llm_service.lock().await;
    
    // Resolve model to provider
    let (provider, model_name) = llm_service
        .resolve_model(&request.model)
        .map_err(|e| e.to_string())?;
    
    // Get credentials from secure storage
    let credentials = llm_service
        .get_credentials(&provider.id)
        .await
        .map_err(|e| e.to_string())?;
    
    // Start streaming
    let request_id = generate_request_id();
    let stream_handler = StreamHandler::new(request_id, provider.protocol);
    
    tokio::spawn(async move {
        let params = ChatCompletionParams {
            model: model_name,
            messages: request.messages,
            tools: request.tools,
            stream: true,
            temperature: request.temperature,
            max_tokens: request.max_tokens,
            top_p: request.top_p,
            provider_options: request.provider_options,
        };
        
        if let Err(e) = stream_handler
            .stream_completion(window, &provider, params, credentials)
            .await
        {
            log::error!("Stream error: {}", e);
        }
    });
    
    Ok(StreamResponse { request_id })
}

#[tauri::command]
pub async fn llm_list_available_models(
    state: State<'_, LLMState>,
) -> Result<Vec<AvailableModel>, String> {
    let llm_service = state.llm_service.lock().await;
    llm_service.list_available_models()
        .await
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn llm_register_custom_provider(
    config: ProviderConfig,
    state: State<'_, LLMState>,
) -> Result<(), String> {
    let mut llm_service = state.llm_service.lock().await;
    llm_service.register_custom_provider(config)
        .map_err(|e| e.to_string())
}
```

#### Step 2.2: TypeScript LLM Client
```typescript
// src/services/llm/llm-client.ts
import { invoke } from '@tauri-apps/api/core';
import { listen, type UnlistenFn } from '@tauri-apps/api/event';

export interface StreamTextOptions {
  model: string;
  messages: Message[];
  tools?: ToolDefinition[];
  temperature?: number;
  maxTokens?: number;
  topP?: number;
  providerOptions?: Record<string, unknown>;
  abortSignal?: AbortSignal;
}

export interface StreamChunk {
  type: 'text-delta' | 'tool-call' | 'reasoning-delta' | 'usage' | 'error' | 'done';
  data: unknown;
}

export class LLMClient {
  async *streamText(options: StreamTextOptions): AsyncGenerator<StreamChunk, void, unknown> {
    const requestId = await invoke<number>('llm_stream_text', {
      request: {
        model: options.model,
        messages: options.messages,
        tools: options.tools,
        temperature: options.temperature,
        max_tokens: options.maxTokens,
        top_p: options.topP,
        provider_options: options.providerOptions,
      },
    });

    const eventName = `llm-stream-${requestId}`;
    const buffer: StreamChunk[] = [];
    let resolveNext: ((value: IteratorResult<StreamChunk>) => void) | null = null;
    let unlisten: UnlistenFn | undefined;

    // Set up listener
    unlisten = await listen<StreamChunk>(eventName, (event) => {
      if (resolveNext) {
        const resolve = resolveNext;
        resolveNext = null;
        resolve({ value: event.payload, done: false });
      } else {
        buffer.push(event.payload);
      }
    });

    // Handle abort
    if (options.abortSignal) {
      options.abortSignal.addEventListener('abort', () => {
        unlisten?.();
        invoke('llm_abort_stream', { requestId });
      });
    }

    try {
      while (true) {
        if (buffer.length > 0) {
          const chunk = buffer.shift()!;
          yield chunk;
          if (chunk.type === 'done' || chunk.type === 'error') break;
        } else {
          const result = await new Promise<IteratorResult<StreamChunk>>((resolve) => {
            resolveNext = resolve;
          });
          if (result.done) break;
          yield result.value;
          if (result.value.type === 'done' || result.value.type === 'error') break;
        }
      }
    } finally {
      unlisten?.();
    }
  }

  async listAvailableModels(): Promise<AvailableModel[]> {
    return invoke('llm_list_available_models');
  }

  async registerCustomProvider(config: CustomProviderConfig): Promise<void> {
    return invoke('llm_register_custom_provider', { config });
  }
}

export const llmClient = new LLMClient();
```

### Phase 3: Frontend Migration (Week 3-4)

#### Step 3.1: Refactor LLMService
Replace Vercel AI SDK `streamText` with new Rust-backed client:

```typescript
// src/services/agents/llm-service.ts (modified)
import { llmClient } from '@/services/llm/llm-client';

export class LLMService {
  async runAgentLoop(
    options: AgentLoopOptions,
    callbacks: AgentLoopCallbacks,
    abortController?: AbortController
  ): Promise<void> {
    // ... existing setup code ...
    
    // Replace: const streamResult = streamText({...})
    // With: Rust-backed streaming
    const stream = llmClient.streamText({
      model,
      messages: loopState.messages,
      tools: toolsForAI,
      temperature,
      maxTokens: 15000,
      providerOptions,
      abortSignal: abortController?.signal,
    });

    // Process stream events (same logic, different source)
    for await (const chunk of stream) {
      switch (chunk.type) {
        case 'text-delta':
          streamProcessor.processTextDelta(chunk.data as string, streamCallbacks);
          break;
        case 'tool-call':
          streamProcessor.processToolCall(chunk.data as ToolCallData, streamCallbacks);
          break;
        case 'reasoning-delta':
          streamProcessor.processReasoningDelta(chunk.data as ReasoningData, streamCallbacks);
          break;
        case 'usage':
          this.handleUsage(chunk.data as UsageData, model, loopState);
          break;
        case 'error':
          this.handleStreamError(chunk.data as ErrorData, callbacks);
          break;
      }
    }
    
    // ... rest of existing logic ...
  }
}
```

#### Step 3.2: Update Provider Store
```typescript
// src/providers/stores/provider-store.ts (modified)
export const useProviderStore = create<ProviderStore>((set, get) => ({
  // ... state ...
  
  initialize: async () => {
    // Instead of building providers in TS, fetch from Rust
    const models = await llmClient.listAvailableModels();
    const configs = await llmClient.getProviderConfigs();
    
    set({
      availableModels: models,
      providerConfigs: new Map(configs.map(c => [c.id, c])),
      isInitialized: true,
    });
  },
  
  // getProviderModel now just validates and returns model identifier
  getProviderModel: (modelIdentifier: string) => {
    // Validate model is available through Rust backend
    if (!get().isModelAvailable(modelIdentifier)) {
      throw new Error(`Model ${modelIdentifier} not available`);
    }
    return modelIdentifier; // Rust handles the actual provider creation
  },
  
  // ... other actions delegated to Rust ...
}));
```

### Phase 4: Testing and Polish (Week 4-5)

#### Step 4.1: Protocol Testing
- Unit tests for OpenAI protocol parsing
- Unit tests for Claude protocol parsing
- Integration tests with mock servers

```rust
#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_openai_stream_parsing() {
        let protocol = OpenAIProtocol;
        let chunk = r#"data: {"choices":[{"delta":{"content":"Hello"}}]}"#;
        
        let event = protocol.parse_stream_chunk(chunk).unwrap();
        
        match event.event_type {
            StreamEventType::TextDelta { text } => {
                assert_eq!(text, "Hello");
            }
            _ => panic!("Expected text delta"),
        }
    }

    #[test]
    fn test_claude_stream_parsing() {
        let protocol = ClaudeProtocol;
        let chunk = r#"event: content_block_delta
data: {"delta":{"type":"text_delta","text":"Hello"}}"#;
        
        let event = protocol.parse_stream_chunk(chunk).unwrap();
        
        match event.event_type {
            StreamEventType::TextDelta { text } => {
                assert_eq!(text, "Hello");
            }
            _ => panic!("Expected text delta"),
        }
    }
}
```

#### Step 4.2: E2E Testing
- Test each provider (OpenAI, Anthropic, DeepSeek, etc.)
- Test streaming with tool calls
- Test OAuth authentication flow
- Test custom provider registration

---

## 5. Key Design Decisions

### 5.1 Protocol Strategy
- **OpenAI Protocol**: Standard for most providers (DeepSeek, Zhipu, Moonshot, etc.)
- **Claude Protocol**: Native Anthropic support with extended thinking
- **Extensible**: Easy to add new protocols (Google Gemini, etc.)

### 5.2 State Management
- **Rust Backend**: Source of truth for provider configs, API keys, OAuth tokens
- **Frontend Store**: Caches available models for UI, delegates operations to Rust

### 5.3 Streaming Architecture
- **Tauri Events**: Request-specific event channels (`llm-stream-{request_id}`)
- **Backpressure**: Frontend controls consumption via async generator
- **Cancellation**: AbortSignal propagates to Rust to cancel in-flight requests

### 5.4 Security
- **API Keys**: Stored in OS keychain via Tauri's secure storage
- **OAuth Tokens**: Same secure storage, with refresh token rotation
- **No Frontend Exposure**: Keys never exposed to frontend JavaScript

---

## 6. Migration Steps

### Week 1-2: Backend Development
1. Create LLM module structure in Rust
2. Implement OpenAI and Claude protocol handlers
3. Build provider registry and configuration system
4. Add Tauri commands for streaming and management

### Week 2-3: Frontend Client
1. Create `llm-client.ts` with new streaming API
2. Implement async generator for stream consumption
3. Add type definitions for Rust/TS interoperability
4. Create compatibility layer for existing code

### Week 3-4: Service Migration
1. Migrate `llm-service.ts` to use new client
2. Migrate `ai-completion-service.ts`
3. Migrate `ai-task-title-service.ts`
4. Migrate `ai-context-compaction.ts`

### Week 4-5: Testing & Cleanup
1. Write protocol unit tests
2. Test all providers end-to-end
3. Remove deprecated Vercel AI SDK code
4. Update documentation

---

## 7. Backward Compatibility

### Temporary Compatibility Layer
```typescript
// Keep old API surface while migrating internals
export const streamText = async (options: LegacyStreamOptions) => {
  // Convert to new API
  const stream = llmClient.streamText({
    model: options.model,
    messages: convertToNewFormat(options.messages),
    // ... other conversions
  });
  
  // Return legacy-compatible response
  return {
    textStream: convertToLegacyStream(stream),
    // ... legacy properties
  };
};
```

### Gradual Migration
1. Phase 1: New code uses new API, old code continues working
2. Phase 2: Migrate services one by one
3. Phase 3: Remove Vercel AI SDK dependency entirely

---

## 8. Risk Assessment

### Risks and Mitigations

| Risk | Impact | Likelihood | Mitigation |
|------|--------|------------|------------|
| Protocol parsing bugs | High | Medium | Extensive unit tests, fallback to legacy SDK |
| OAuth token refresh issues | Medium | Low | Keep existing OAuth logic, wrap in Rust |
| Performance regression | Medium | Low | Benchmark against current implementation |
| Custom provider breakage | Medium | Medium | Maintain exact same config format |
| Streaming reliability | High | Low | Reuse existing http_proxy infrastructure |

---

## 9. Success Criteria

- [ ] All existing providers work without configuration changes
- [ ] Streaming performance equal or better than current implementation
- [ ] OAuth authentication continues working for Claude/OpenAI/GitHub Copilot
- [ ] Custom providers can still be registered dynamically
- [ ] Tool calling works with all supported providers
- [ ] Reasoning/thinking support for compatible models
- [ ] Context compaction service works end-to-end
- [ ] All existing tests pass

---

## 10. Future Enhancements

### Post-Migration Improvements
1. **Local Model Support**: Better integration with Ollama/LM Studio via Rust
2. **Request Batching**: Batch multiple requests to same provider
3. **Intelligent Retries**: Exponential backoff with provider-specific strategies
4. **Usage Analytics**: Centralized tracking in Rust backend
5. **Model Routing**: Automatic model fallback based on availability/cost