use crate::llm::auth::api_key_manager::ApiKeyManager;
use crate::llm::protocols::{ProtocolStreamState, ToolCallAccum};
use crate::llm::providers::provider_registry::ProviderRegistry;
use crate::llm::testing::{Recorder, RecordingContext, TestConfig, TestMode};
use crate::llm::tracing::types::{float_attr, int_attr};
use crate::llm::tracing::TraceWriter;
use crate::llm::types::{StreamEvent, StreamTextRequest};
use futures_util::StreamExt;
use serde_json;
use std::collections::HashMap;
use std::sync::atomic::{AtomicU32, Ordering};
use std::sync::Arc;
use std::time::Duration;
use tauri::{Emitter, Manager};
use tokio::time::timeout;

static REQUEST_COUNTER: AtomicU32 = AtomicU32::new(1000);

pub struct StreamHandler<'a> {
    registry: &'a ProviderRegistry,
    api_keys: &'a ApiKeyManager,
}

impl<'a> StreamHandler<'a> {
    pub fn new(registry: &'a ProviderRegistry, api_keys: &'a ApiKeyManager) -> Self {
        Self { registry, api_keys }
    }

    pub async fn stream_completion(
        &self,
        window: tauri::Window,
        request: StreamTextRequest,
        request_id: u32,
    ) -> Result<u32, String> {
        // Use provided request_id if non-zero, otherwise generate one
        let request_id = if request_id > 0 {
            request_id
        } else {
            REQUEST_COUNTER.fetch_add(1, Ordering::SeqCst)
        };
        let event_name = format!("llm-stream-{}", request_id);

        log::info!(
            "[LLM Stream {}] Starting stream completion for model: {}",
            request_id,
            request.model
        );

        let (model_key, provider_id) = self.resolve_model_and_provider(&request.model).await?;
        log::info!(
            "[LLM Stream {}] Resolved model: {}, provider: {}",
            request_id,
            model_key,
            provider_id
        );
        let provider = self
            .registry
            .provider(&provider_id)
            .ok_or_else(|| format!("Provider not found: {}", provider_id))?;
        log::info!(
            "[LLM Stream {}] Found provider: {} with protocol: {:?}",
            request_id,
            provider.name,
            provider.protocol
        );

        let protocol = self
            .registry
            .protocol(provider.protocol)
            .ok_or_else(|| format!("Protocol not found: {:?}", provider.protocol))?;
        log::info!(
            "[LLM Stream {}] Protocol initialized: {}",
            request_id,
            protocol.name()
        );

        let mut base_url = self.resolve_base_url(provider).await?;
        log::info!(
            "[LLM Stream {}] Resolved base URL: {}",
            request_id,
            base_url
        );

        let provider_model_name = self
            .resolve_provider_model_name(&model_key, &provider_id)
            .await?;
        log::info!(
            "[LLM Stream {}] Provider model name: {}",
            request_id,
            provider_model_name
        );

        // Initialize tracing span if trace_context is provided
        let mut trace_span_id: Option<String> = None;
        let mut trace_usage: Option<(i32, i32, Option<i32>, Option<i32>, Option<i32>)> = None;
        let mut trace_finish_reason: Option<String> = None;

        if let Some(ref trace_context) = request.trace_context {
            let trace_writer = window.app_handle().state::<Arc<TraceWriter>>();
            let trace_id = trace_context
                .trace_id
                .clone()
                .unwrap_or_else(|| trace_writer.start_trace());

            let span_name = trace_context
                .span_name
                .as_deref()
                .unwrap_or("llm.stream_completion");

            let mut attributes = HashMap::new();
            attributes.insert(
                crate::llm::tracing::types::attributes::GEN_AI_REQUEST_MODEL.to_string(),
                crate::llm::tracing::types::string_attr(&provider_model_name),
            );
            attributes.insert(
                crate::llm::tracing::types::attributes::GEN_AI_SYSTEM.to_string(),
                crate::llm::tracing::types::string_attr(&provider_id),
            );

            if let Some(t) = request.temperature {
                attributes.insert(
                    crate::llm::tracing::types::attributes::GEN_AI_REQUEST_TEMPERATURE.to_string(),
                    float_attr(t as f64),
                );
            }
            if let Some(p) = request.top_p {
                attributes.insert(
                    crate::llm::tracing::types::attributes::GEN_AI_REQUEST_TOP_P.to_string(),
                    float_attr(p as f64),
                );
            }
            if let Some(k) = request.top_k {
                attributes.insert(
                    crate::llm::tracing::types::attributes::GEN_AI_REQUEST_TOP_K.to_string(),
                    int_attr(k as i64),
                );
            }
            if let Some(m) = request.max_tokens {
                attributes.insert(
                    crate::llm::tracing::types::attributes::GEN_AI_REQUEST_MAX_TOKENS.to_string(),
                    int_attr(m as i64),
                );
            }

            let span_id = trace_writer.start_span(
                trace_id,
                trace_context.parent_span_id.clone(),
                span_name.to_string(),
                attributes,
            );
            trace_span_id = Some(span_id);

            log::info!("[LLM Stream {}] Tracing span created", request_id);
        }

        let credentials = self.api_keys.get_credentials(provider).await?;
        log::info!(
            "[LLM Stream {}] Credentials obtained, auth type: {:?}",
            request_id,
            provider.auth_type
        );

        let (api_key, oauth_token) = match credentials {
            crate::llm::auth::api_key_manager::ProviderCredentials::None => {
                log::info!("[LLM Stream {}] Using no authentication", request_id);
                (None, None)
            }
            crate::llm::auth::api_key_manager::ProviderCredentials::Token(token) => {
                log::info!("[LLM Stream {}] Using token authentication", request_id);
                (Some(token.clone()), Some(token))
            }
        };

        let use_openai_oauth = if provider_id == "openai" && provider.supports_oauth {
            self.api_keys.has_oauth_token(&provider_id).await?
        } else {
            false
        };

        // When using OpenAI OAuth, override base URL to ChatGPT backend API
        if use_openai_oauth {
            base_url = "https://chatgpt.com/backend-api".to_string();
            log::info!(
                "[LLM Stream {}] Using ChatGPT backend API for OAuth",
                request_id
            );
        }

        let mut headers = protocol.build_headers(
            api_key.as_deref(),
            oauth_token.as_deref(),
            provider.headers.as_ref(),
        );

        if provider.id == "moonshot" && provider.supports_coding_plan {
            if let Some(use_coding_plan) = self
                .api_keys
                .get_setting(&format!("use_coding_plan_{}", provider.id))
                .await?
            {
                if use_coding_plan == "true" {
                    if let Some(coding_plan_url) = &provider.coding_plan_base_url {
                        if base_url == *coding_plan_url {
                            headers.insert("User-Agent".to_string(), "KimiCLI/1.3".to_string());
                        }
                    }
                }
            }
        }

        if use_openai_oauth {
            headers.insert(
                "OpenAI-Beta".to_string(),
                "responses=experimental".to_string(),
            );
            headers.insert("originator".to_string(), "codex_cli_rs".to_string());
            self.api_keys
                .maybe_set_openai_account_header(&provider_id, &mut headers)
                .await?;
        }
        log::debug!(
            "[LLM Stream {}] Built headers with {} entries",
            request_id,
            headers.len()
        );

        let body = if use_openai_oauth {
            self.build_openai_oauth_request(&request, &provider_model_name)?
        } else {
            protocol.build_request(
                &provider_model_name,
                &request.messages,
                request.tools.as_deref(),
                request.temperature,
                request.max_tokens,
                request.top_p,
                request.top_k,
                request.provider_options.as_ref(),
                provider.extra_body.as_ref(),
            )?
        };

        // Log the complete request body
        match serde_json::to_string_pretty(&body) {
            Ok(body_str) => log::info!("[LLM Stream {}] Request body:\n{}", request_id, body_str),
            Err(e) => log::warn!(
                "[LLM Stream {}] Failed to serialize request body: {}",
                request_id,
                e
            ),
        }

        // Record request event for tracing
        if let Some(ref span_id) = trace_span_id {
            let trace_writer = window.app_handle().state::<Arc<TraceWriter>>();
            trace_writer.add_event(
                span_id.clone(),
                crate::llm::tracing::types::attributes::HTTP_REQUEST_BODY.to_string(),
                Some(body.clone()),
            );
        }

        let test_config = TestConfig::from_env();
        let base_url = if test_config.mode != TestMode::Off {
            test_config.base_url_override.clone().unwrap_or(base_url)
        } else {
            base_url
        };
        let endpoint_path = if use_openai_oauth {
            "codex/responses"
        } else {
            protocol.endpoint_path()
        };
        let url = format!("{}/{}", base_url.trim_end_matches('/'), endpoint_path);
        log::info!("[LLM Stream {}] Request URL: {}", request_id, url);

        let mut recorder = Recorder::from_test_config(
            &test_config,
            RecordingContext {
                provider_id: provider.id.clone(),
                protocol: protocol.name().to_string(),
                model: provider_model_name.clone(),
                endpoint_path: endpoint_path.to_string(),
                url: url.clone(),
                request_headers: headers.clone(),
                request_body: body.clone(),
            },
        );

        let client = reqwest::Client::builder()
            .connect_timeout(Duration::from_secs(10))
            .timeout(Duration::from_secs(300)) // Add overall request timeout
            .gzip(false)
            .brotli(false)
            .tcp_nodelay(true)
            .pool_max_idle_per_host(5)
            .build()
            .map_err(|e| format!("Failed to build client: {}", e))?;
        log::debug!("[LLM Stream {}] HTTP client built", request_id);

        let mut req_builder = client.post(&url);
        for (key, value) in headers {
            req_builder = req_builder.header(&key, &value);
        }
        req_builder = req_builder
            .header("Accept", "text/event-stream")
            .json(&body);

        log::info!("[LLM Stream {}] Sending HTTP request...", request_id);
        let response = req_builder.send().await.map_err(|e| {
            log::error!("[LLM Stream {}] Request failed: {}", request_id, e);
            format!("Request failed: {}", e)
        })?;
        log::info!(
            "[LLM Stream {}] HTTP response received, status: {}",
            request_id,
            response.status()
        );

        let status = response.status().as_u16();
        if status >= 400 {
            let response_headers = response.headers().clone();
            let text = response.text().await.unwrap_or_default();
            log::error!(
                "[LLM Stream {}] HTTP error {}: {}",
                request_id,
                status,
                text
            );
            if let Some(recorder) = recorder.as_mut() {
                let _ = recorder.finish_error(status, &response_headers, &text);
            }
            // Record error in tracing span
            if let Some(ref span_id) = trace_span_id {
                let trace_writer = window.app_handle().state::<Arc<TraceWriter>>();
                trace_writer.add_event(
                    span_id.clone(),
                    crate::llm::tracing::types::attributes::ERROR_TYPE.to_string(),
                    Some(serde_json::json!({
                        "error_type": "http_error",
                        "status_code": status,
                        "message": text,
                    })),
                );
            }
            let error_event = StreamEvent::Error {
                message: format!("HTTP {}: {}", status, text),
            };
            let _ = window.emit(&event_name, &error_event);
            return Err(format!("HTTP error {}", status));
        }

        let response_headers = response.headers().clone();
        let mut stream = response.bytes_stream();
        let mut buffer: Vec<u8> = Vec::new();
        let mut state = ProtocolStreamState::default();
        let mut chunk_count = 0;
        let mut response_text = String::new();
        let stream_timeout = Duration::from_secs(60); // Timeout between chunks

        log::info!("[LLM Stream {}] Starting to read stream...", request_id);

        loop {
            // Use timeout to prevent hanging on stream.next().await
            let chunk_result = timeout(stream_timeout, stream.next()).await;

            let chunk = match chunk_result {
                Ok(Some(result)) => result,
                Ok(None) => {
                    log::info!(
                        "[LLM Stream {}] Stream ended normally after {} chunks",
                        request_id,
                        chunk_count
                    );
                    break;
                }
                Err(_) => {
                    log::error!(
                        "[LLM Stream {}] Stream timeout - no data received for {} seconds",
                        request_id,
                        stream_timeout.as_secs()
                    );
                    // Record error in tracing span
                    if let Some(ref span_id) = trace_span_id {
                        let trace_writer = window.app_handle().state::<Arc<TraceWriter>>();
                        trace_writer.add_event(
                            span_id.clone(),
                            crate::llm::tracing::types::attributes::ERROR_TYPE.to_string(),
                            Some(serde_json::json!({
                                "error_type": "stream_timeout",
                                "timeout_seconds": stream_timeout.as_secs(),
                                "message": format!("Stream timeout - no data received for {} seconds", stream_timeout.as_secs()),
                            })),
                        );
                    }
                    let error_event = StreamEvent::Error {
                        message: format!(
                            "Stream timeout - no data received for {} seconds",
                            stream_timeout.as_secs()
                        ),
                    };
                    let _ = window.emit(&event_name, &error_event);
                    return Err(format!(
                        "Stream timeout - no data received for {} seconds",
                        stream_timeout.as_secs()
                    ));
                }
            };

            chunk_count += 1;
            log::debug!(
                "[LLM Stream {}] Received chunk #{}, buffer size: {}",
                request_id,
                chunk_count,
                buffer.len()
            );

            let bytes = match chunk {
                Ok(b) => b,
                Err(e) => {
                    log::error!(
                        "[LLM Stream {}] Stream error at chunk {}: {}",
                        request_id,
                        chunk_count,
                        e
                    );
                    // Record error in tracing span
                    if let Some(ref span_id) = trace_span_id {
                        let trace_writer = window.app_handle().state::<Arc<TraceWriter>>();
                        trace_writer.add_event(
                            span_id.clone(),
                            crate::llm::tracing::types::attributes::ERROR_TYPE.to_string(),
                            Some(serde_json::json!({
                                "error_type": "stream_error",
                                "chunk_count": chunk_count,
                                "message": format!("Stream error: {}", e),
                            })),
                        );
                    }
                    let error_event = StreamEvent::Error {
                        message: format!("Stream error: {}", e),
                    };
                    let _ = window.emit(&event_name, &error_event);
                    return Err(format!("Stream error: {}", e));
                }
            };

            if bytes.is_empty() {
                log::debug!("[LLM Stream {}] Received empty chunk", request_id);
                continue;
            }

            buffer.extend_from_slice(&bytes);

            // Process SSE events from buffer, handling both \n\n and \r\n\r\n delimiters
            while let Some((idx, delimiter_len)) = Self::find_sse_delimiter(&buffer) {
                let event_bytes = buffer[..idx].to_vec();
                buffer.drain(..idx + delimiter_len);

                let event_str = match String::from_utf8(event_bytes) {
                    Ok(s) => s,
                    Err(e) => {
                        log::error!(
                            "[LLM Stream {}] Invalid UTF-8 in SSE event: {}",
                            request_id,
                            e
                        );
                        // Record error in tracing span
                        if let Some(ref span_id) = trace_span_id {
                            let trace_writer = window.app_handle().state::<Arc<TraceWriter>>();
                            trace_writer.add_event(
                                span_id.clone(),
                                crate::llm::tracing::types::attributes::ERROR_TYPE.to_string(),
                                Some(serde_json::json!({
                                    "error_type": "utf8_error",
                                    "message": format!("Invalid UTF-8 in SSE event: {}", e),
                                })),
                            );
                        }
                        let error_event = StreamEvent::Error {
                            message: format!("Invalid UTF-8 in SSE event: {}", e),
                        };
                        let _ = window.emit(&event_name, &error_event);
                        return Err(format!("Invalid UTF-8 in SSE event: {}", e));
                    }
                };

                if use_openai_oauth {
                    log::info!("[LLM Stream {}] Raw SSE event:\n{}", request_id, event_str);
                } else {
                    log::debug!("[LLM Stream {}] Raw SSE event:\n{}", request_id, event_str);
                }

                if let Some(parsed) = Self::parse_sse_event(&event_str) {
                    if use_openai_oauth {
                        log::info!(
                            "[LLM Stream {}] Parsed SSE - event: {:?}, data: {}",
                            request_id,
                            parsed.event,
                            parsed.data
                        );
                    } else {
                        log::debug!(
                            "[LLM Stream {}] Parsed SSE - event: {:?}, data: {}",
                            request_id,
                            parsed.event,
                            parsed.data
                        );
                    }
                    if let Some(recorder) = recorder.as_mut() {
                        recorder.record_sse_event(parsed.event.as_deref(), &parsed.data);
                    }
                    let parsed_result = if use_openai_oauth {
                        parse_openai_oauth_event(parsed.event.as_deref(), &parsed.data, &mut state)
                    } else {
                        protocol.parse_stream_event(
                            parsed.event.as_deref(),
                            &parsed.data,
                            &mut state,
                        )
                    };
                    match parsed_result {
                        Ok(Some(event)) => {
                            // Capture usage and finish_reason for tracing
                            match &event {
                                StreamEvent::Usage {
                                    input_tokens,
                                    output_tokens,
                                    total_tokens,
                                    cached_input_tokens,
                                    cache_creation_input_tokens,
                                } => {
                                    trace_usage = Some((
                                        *input_tokens,
                                        *output_tokens,
                                        *total_tokens,
                                        *cached_input_tokens,
                                        *cache_creation_input_tokens,
                                    ));
                                }
                                StreamEvent::Done { finish_reason } => {
                                    trace_finish_reason = finish_reason.clone();
                                }
                                _ => {}
                            }

                            Self::append_text_delta(&mut response_text, &event);
                            self.emit_stream_event(&window, &event_name, request_id, &event);
                            if !state.pending_events.is_empty() {
                                for pending in state.pending_events.drain(..) {
                                    Self::append_text_delta(&mut response_text, &pending);
                                    self.emit_stream_event(
                                        &window,
                                        &event_name,
                                        request_id,
                                        &pending,
                                    );
                                }
                            }

                            if matches!(event, StreamEvent::Done { .. }) {
                                log::info!(
                                    "[LLM Stream {}] Done event received, ending stream loop",
                                    request_id
                                );
                                break;
                            }
                        }
                        Ok(None) => {
                            log::debug!(
                                "[LLM Stream {}] No event emitted from parsed data",
                                request_id
                            );
                            if !state.pending_events.is_empty() {
                                for pending in state.pending_events.drain(..) {
                                    Self::append_text_delta(&mut response_text, &pending);
                                    self.emit_stream_event(
                                        &window,
                                        &event_name,
                                        request_id,
                                        &pending,
                                    );
                                }
                            }
                        }
                        Err(err) => {
                            log::error!(
                                "[LLM Stream {}] Error parsing stream event: {}",
                                request_id,
                                err
                            );
                            // Record error in tracing span
                            if let Some(ref span_id) = trace_span_id {
                                let trace_writer = window.app_handle().state::<Arc<TraceWriter>>();
                                trace_writer.add_event(
                                    span_id.clone(),
                                    crate::llm::tracing::types::attributes::ERROR_TYPE.to_string(),
                                    Some(serde_json::json!({
                                        "error_type": "parse_error",
                                        "message": err,
                                    })),
                                );
                            }
                            let _ = window.emit(
                                &event_name,
                                &StreamEvent::Error {
                                    message: err.clone(),
                                },
                            );
                            return Err(err);
                        }
                    }
                } else {
                    log::debug!(
                        "[LLM Stream {}] No SSE event parsed from: {}",
                        request_id,
                        event_str
                    );
                }
            }
        }

        log::info!(
            "[LLM Stream {}] Stream ended, total chunks: {}, emitting Done event",
            request_id,
            chunk_count
        );
        if response_text.is_empty() {
            log::info!("[LLM Stream {}] Final response: <empty>", request_id);
        } else {
            log::info!(
                "[LLM Stream {}] Final response:\n{}",
                request_id,
                response_text
            );
        }
        if let Some(recorder) = recorder.as_mut() {
            let _ = recorder.finish_stream(status, &response_headers);
        }

        // Record response event and usage for tracing
        if let Some(ref span_id) = trace_span_id {
            let trace_writer = window.app_handle().state::<Arc<TraceWriter>>();
            // Add usage attributes if available
            if let Some((
                input_tokens,
                output_tokens,
                total_tokens,
                cached_input_tokens,
                cache_creation_input_tokens,
            )) = trace_usage
            {
                let mut usage_attrs = serde_json::Map::new();
                usage_attrs.insert(
                    "input_tokens".to_string(),
                    serde_json::Value::Number(input_tokens.into()),
                );
                usage_attrs.insert(
                    "output_tokens".to_string(),
                    serde_json::Value::Number(output_tokens.into()),
                );
                usage_attrs.insert(
                    "total_tokens".to_string(),
                    total_tokens
                        .map(|value| serde_json::Value::Number(value.into()))
                        .unwrap_or(serde_json::Value::Null),
                );
                usage_attrs.insert(
                    "cached_input_tokens".to_string(),
                    cached_input_tokens
                        .map(|value| serde_json::Value::Number(value.into()))
                        .unwrap_or(serde_json::Value::Null),
                );
                usage_attrs.insert(
                    "cache_creation_input_tokens".to_string(),
                    cache_creation_input_tokens
                        .map(|value| serde_json::Value::Number(value.into()))
                        .unwrap_or(serde_json::Value::Null),
                );
                trace_writer.add_event(
                    span_id.clone(),
                    "gen_ai.usage".to_string(),
                    Some(serde_json::Value::Object(usage_attrs)),
                );
            }

            // Add finish reason if available
            if let Some(ref finish_reason) = trace_finish_reason {
                trace_writer.add_event(
                    span_id.clone(),
                    "gen_ai.finish_reason".to_string(),
                    Some(serde_json::json!({"finish_reason": finish_reason})),
                );
            }

            // Record response event
            trace_writer.add_event(
                span_id.clone(),
                crate::llm::tracing::types::attributes::HTTP_RESPONSE_BODY.to_string(),
                Some(serde_json::json!({
                    "finish_reason": trace_finish_reason,
                    "usage": trace_usage.map(|(i, o, t, c, cc)| serde_json::json!({
                        "input_tokens": i,
                        "output_tokens": o,
                        "total_tokens": t,
                        "cached_input_tokens": c,
                        "cache_creation_input_tokens": cc,
                    })),
                })),
            );

            trace_writer.end_span(span_id.clone(), chrono::Utc::now().timestamp_millis());
        }

        let _ = window.emit(
            &event_name,
            &StreamEvent::Done {
                finish_reason: state.finish_reason.clone(),
            },
        );

        log::info!(
            "[LLM Stream {}] Stream completion finished successfully",
            request_id
        );
        Ok(request_id)
    }

    async fn resolve_model_and_provider(
        &self,
        model_identifier: &str,
    ) -> Result<(String, String), String> {
        let api_keys = self.api_keys.load_api_keys().await?;
        let custom_providers = self.api_keys.load_custom_providers().await?;
        crate::llm::models::model_registry::ModelRegistry::get_model_provider(
            model_identifier,
            &api_keys,
            self.registry,
            &custom_providers,
        )
    }

    async fn resolve_provider_model_name(
        &self,
        model_key: &str,
        provider_id: &str,
    ) -> Result<String, String> {
        let models =
            crate::llm::models::model_registry::ModelRegistry::load_models_config(self.api_keys)
                .await?;
        Ok(
            crate::llm::models::model_registry::ModelRegistry::resolve_provider_model_name(
                model_key,
                provider_id,
                &models,
            ),
        )
    }

    async fn resolve_base_url(
        &self,
        provider: &crate::llm::types::ProviderConfig,
    ) -> Result<String, String> {
        if let Some(base_url) = self
            .api_keys
            .get_setting(&format!("base_url_{}", provider.id))
            .await?
        {
            if !base_url.is_empty() {
                return Ok(base_url);
            }
        }

        if provider.supports_coding_plan {
            if let Some(use_coding_plan) = self
                .api_keys
                .get_setting(&format!("use_coding_plan_{}", provider.id))
                .await?
            {
                if use_coding_plan == "true" {
                    if let Some(url) = &provider.coding_plan_base_url {
                        return Ok(url.clone());
                    }
                }
            }
        }

        if provider.supports_international {
            if let Some(use_international) = self
                .api_keys
                .get_setting(&format!("use_international_{}", provider.id))
                .await?
            {
                if use_international == "true" {
                    if let Some(url) = &provider.international_base_url {
                        return Ok(url.clone());
                    }
                }
            }
        }

        Ok(provider.base_url.clone())
    }

    /// Find SSE delimiter in buffer, returns (index, delimiter_length)
    /// Handles both \n\n and \r\n\r\n delimiters
    fn find_sse_delimiter(buf: &[u8]) -> Option<(usize, usize)> {
        // First check for \r\n\r\n (4 bytes)
        if let Some(pos) = buf.windows(4).position(|w| w == b"\r\n\r\n") {
            return Some((pos, 4));
        }
        // Then check for \n\n (2 bytes)
        if let Some(pos) = buf.windows(2).position(|w| w == b"\n\n") {
            return Some((pos, 2));
        }
        None
    }

    fn parse_sse_event(raw: &str) -> Option<SseEvent> {
        let mut event: Option<String> = None;
        let mut data_lines = Vec::new();
        for line in raw.lines() {
            if let Some(rest) = line.strip_prefix("event:") {
                event = Some(rest.trim().to_string());
            } else if let Some(rest) = line.strip_prefix("data:") {
                // Preserve payload exactly, only removing single optional leading space per SSE spec
                let data = rest.strip_prefix(' ').unwrap_or(rest);
                data_lines.push(data.to_string());
            }
        }
        if data_lines.is_empty() {
            return None;
        }
        Some(SseEvent {
            event,
            data: data_lines.join("\n"),
        })
    }

    fn append_text_delta(target: &mut String, event: &StreamEvent) {
        if let StreamEvent::TextDelta { text } = event {
            target.push_str(text);
        }
    }

    fn emit_stream_event(
        &self,
        window: &tauri::Window,
        event_name: &str,
        request_id: u32,
        event: &StreamEvent,
    ) {
        log::debug!("[LLM Stream {}] Emitting event: {:?}", request_id, event);
        let _ = window.emit(event_name, event);
    }

    fn build_openai_oauth_request(
        &self,
        request: &StreamTextRequest,
        model: &str,
    ) -> Result<serde_json::Value, String> {
        use serde_json::{json, Value};

        fn normalize_model(model_name: &str) -> String {
            let model_id = if model_name.contains('/') {
                model_name.split('/').last().unwrap_or(model_name)
            } else {
                model_name
            };
            let normalized = model_id.to_lowercase();
            if normalized.contains("gpt-5.1-codex-max") || normalized.contains("gpt 5.1 codex max")
            {
                return "gpt-5.1-codex-max".to_string();
            }
            "gpt-5.2-codex".to_string()
        }

        fn tool_output_to_string(output: &Value) -> String {
            if let Some(value) = output.get("value").and_then(|v| v.as_str()) {
                return value.to_string();
            }
            output.to_string()
        }

        fn push_message_item(role: &str, parts: &mut Vec<Value>, input_items: &mut Vec<Value>) {
            if parts.is_empty() {
                return;
            }
            let content = std::mem::take(parts);
            input_items.push(json!({
                "type": "message",
                "role": role,
                "content": content
            }));
        }

        fn to_input_content(content: &crate::llm::types::MessageContent) -> Vec<Value> {
            match content {
                crate::llm::types::MessageContent::Text(text) => {
                    if text.trim().is_empty() {
                        Vec::new()
                    } else {
                        vec![json!({ "type": "input_text", "text": text })]
                    }
                }
                crate::llm::types::MessageContent::Parts(parts) => {
                    let mut mapped = Vec::new();
                    for part in parts {
                        match part {
                            crate::llm::types::ContentPart::Text { text } => {
                                if !text.trim().is_empty() {
                                    mapped.push(json!({ "type": "input_text", "text": text }));
                                }
                            }
                            crate::llm::types::ContentPart::Reasoning { text, .. } => {
                                if !text.trim().is_empty() {
                                    mapped.push(json!({ "type": "input_text", "text": text }));
                                }
                            }
                            crate::llm::types::ContentPart::Image { image } => {
                                mapped.push(json!({
                                    "type": "input_image",
                                    "image_url": format!("data:image/png;base64,{}", image)
                                }));
                            }
                            crate::llm::types::ContentPart::ToolCall { .. } => {}
                            crate::llm::types::ContentPart::ToolResult { .. } => {}
                        }
                    }
                    mapped
                }
            }
        }

        fn append_assistant_items(
            content: &crate::llm::types::MessageContent,
            input_items: &mut Vec<Value>,
        ) {
            match content {
                crate::llm::types::MessageContent::Text(_) => {
                    let content_parts = to_input_content(content);
                    if !content_parts.is_empty() {
                        input_items.push(json!({
                            "type": "message",
                            "role": "assistant",
                            "content": content_parts
                        }));
                    }
                }
                crate::llm::types::MessageContent::Parts(parts) => {
                    let mut pending_parts: Vec<Value> = Vec::new();

                    for part in parts {
                        match part {
                            crate::llm::types::ContentPart::Text { text } => {
                                if !text.trim().is_empty() {
                                    pending_parts
                                        .push(json!({ "type": "input_text", "text": text }));
                                }
                            }
                            crate::llm::types::ContentPart::Reasoning { text, .. } => {
                                if !text.trim().is_empty() {
                                    pending_parts
                                        .push(json!({ "type": "input_text", "text": text }));
                                }
                            }
                            crate::llm::types::ContentPart::Image { image } => {
                                pending_parts.push(json!({
                                    "type": "input_image",
                                    "image_url": format!("data:image/png;base64,{}", image)
                                }));
                            }
                            crate::llm::types::ContentPart::ToolCall {
                                tool_call_id,
                                tool_name,
                                input,
                            } => {
                                push_message_item("assistant", &mut pending_parts, input_items);
                                if tool_name.trim().is_empty() {
                                    continue;
                                }

                                let arguments = if input.is_object()
                                    || input.is_array()
                                    || input.is_string()
                                    || input.is_number()
                                    || input.is_boolean()
                                    || input.is_null()
                                {
                                    input.to_string()
                                } else {
                                    "{}".to_string()
                                };

                                input_items.push(json!({
                                    "type": "function_call",
                                    "call_id": tool_call_id,
                                    "name": tool_name,
                                    "arguments": arguments
                                }));
                            }
                            crate::llm::types::ContentPart::ToolResult { .. } => {}
                        }
                    }

                    push_message_item("assistant", &mut pending_parts, input_items);
                }
            }
        }

        // Collect system messages and convert to developer role for Codex API
        let mut system_messages: Vec<String> = Vec::new();
        let mut input_items: Vec<Value> = Vec::new();

        for msg in &request.messages {
            match msg {
                crate::llm::types::Message::System { content, .. } => {
                    if !content.trim().is_empty() {
                        system_messages.push(content.clone());
                        // Also add as developer message for Codex API
                        input_items.push(json!({
                            "type": "message",
                            "role": "developer",
                            "content": [{ "type": "input_text", "text": content }]
                        }));
                    }
                }
                crate::llm::types::Message::User { content, .. } => {
                    let content_parts = to_input_content(content);
                    if !content_parts.is_empty() {
                        input_items.push(json!({
                            "type": "message",
                            "role": "user",
                            "content": content_parts
                        }));
                    }
                }
                crate::llm::types::Message::Assistant { content, .. } => {
                    append_assistant_items(content, &mut input_items);
                }
                crate::llm::types::Message::Tool { content, .. } => {
                    for part in content {
                        if let crate::llm::types::ContentPart::ToolResult {
                            tool_call_id,
                            output,
                            ..
                        } = part
                        {
                            input_items.push(json!({
                                "type": "function_call_output",
                                "call_id": tool_call_id,
                                "output": tool_output_to_string(output)
                            }));
                        }
                    }
                }
            }
        }

        // Build instructions using base codex instructions only (system messages are now in input as developer role)
        let instructions = include_str!("../../../../src/services/codex-instructions.md");

        // Log input items count for debugging
        log::info!(
            "[LLM Stream] Building OpenAI OAuth request with {} input items",
            input_items.len()
        );
        if input_items.is_empty() {
            log::warn!("[LLM Stream] Warning: input_items is empty!");
        }

        let mut body = json!({
            "model": normalize_model(model),
            "input": input_items,
            "store": false,
            "stream": true,
            "instructions": instructions,
            "text": { "verbosity": "medium" },
            "include": ["reasoning.encrypted_content"]
        });

        if let Some(tools) = request.tools.as_ref() {
            let mut mapped_tools = Vec::new();
            for tool in tools {
                // Codex API expects flat tool format (not nested under "function")
                mapped_tools.push(json!({
                    "type": "function",
                    "name": tool.name,
                    "description": tool.description,
                    "parameters": tool.parameters
                }));
            }
            body["tools"] = Value::Array(mapped_tools);
        }
        if let Some(temperature) = request.temperature {
            body["temperature"] = json!(temperature);
        }
        // Note: max_output_tokens is not supported by Codex API
        if let Some(top_p) = request.top_p {
            body["top_p"] = json!(top_p);
        }

        Ok(body)
    }
}

fn build_openai_oauth_tool_input(arguments: &str, force: bool) -> Option<serde_json::Value> {
    if arguments.trim().is_empty() {
        return if force {
            Some(serde_json::json!({}))
        } else {
            None
        };
    }

    match serde_json::from_str(arguments) {
        Ok(value) => Some(value),
        Err(_) => {
            if force {
                Some(serde_json::Value::String(arguments.to_string()))
            } else {
                None
            }
        }
    }
}

fn parse_openai_oauth_event(
    event_type: Option<&str>,
    data: &str,
    state: &mut ProtocolStreamState,
) -> Result<Option<StreamEvent>, String> {
    // Helper to emit tool calls immediately for Codex output items
    let emit_tool_calls = |state: &mut ProtocolStreamState, force: bool| {
        for key in state.tool_call_order.clone() {
            if state.emitted_tool_calls.contains(&key) {
                continue;
            }
            if let Some(acc) = state.tool_calls.get(&key) {
                if acc.tool_name.is_empty() {
                    continue;
                }

                let input_value = match build_openai_oauth_tool_input(&acc.arguments, force) {
                    Some(value) => value,
                    None => continue,
                };

                state.pending_events.push(StreamEvent::ToolCall {
                    tool_call_id: acc.tool_call_id.clone(),
                    tool_name: acc.tool_name.clone(),
                    input: input_value,
                });
                state.emitted_tool_calls.insert(key);
            }
        }
    };

    let payload: serde_json::Value = serde_json::from_str(data).map_err(|e| e.to_string())?;

    // Handle OpenAI-compatible chat completion chunks (no SSE event type)
    if payload.get("object").and_then(|v| v.as_str()) == Some("chat.completion.chunk") {
        if let Some(usage) = payload.get("usage") {
            let input_tokens = usage
                .get("prompt_tokens")
                .and_then(|v| v.as_i64())
                .unwrap_or(0);
            let output_tokens = usage
                .get("completion_tokens")
                .and_then(|v| v.as_i64())
                .unwrap_or(0);
            let total_tokens = usage.get("total_tokens").and_then(|v| v.as_i64());
            state.pending_events.push(StreamEvent::Usage {
                input_tokens: input_tokens as i32,
                output_tokens: output_tokens as i32,
                total_tokens: total_tokens.map(|v| v as i32),
                cached_input_tokens: None,
                cache_creation_input_tokens: None,
            });
        }

        if let Some(choices) = payload.get("choices").and_then(|v| v.as_array()) {
            if let Some(choice) = choices.first() {
                if let Some(finish_reason) = choice.get("finish_reason").and_then(|v| v.as_str()) {
                    state.finish_reason = Some(finish_reason.to_string());
                }
                if let Some(delta) = choice.get("delta") {
                    if !state.text_started {
                        state.text_started = true;
                        state.pending_events.push(StreamEvent::TextStart);
                    }
                    if let Some(content) = delta.get("content").and_then(|v| v.as_str()) {
                        if !content.is_empty() {
                            state.pending_events.push(StreamEvent::TextDelta {
                                text: content.to_string(),
                            });
                        }
                    }
                }
            }
        }

        if let Some(event) = state.pending_events.get(0).cloned() {
            state.pending_events.remove(0);
            return Ok(Some(event));
        }
        return Ok(None);
    }

    let mut resolved_event = event_type.map(|value| value.to_string());
    if resolved_event.is_none() {
        resolved_event = payload
            .get("type")
            .and_then(|v| v.as_str())
            .map(|v| v.to_string())
            .or_else(|| {
                payload
                    .get("event")
                    .and_then(|v| v.as_str())
                    .map(|v| v.to_string())
            })
            .or_else(|| {
                payload
                    .get("kind")
                    .and_then(|v| v.as_str())
                    .map(|v| v.to_string())
            });
    }

    let event_type = match resolved_event {
        Some(value) => value,
        None => return Ok(None),
    };

    log::debug!(
        "[OpenAI OAuth] Parsing event: {}, data: {}",
        event_type,
        data
    );
    log::debug!("[OpenAI OAuth] Parsed payload: {:?}", payload);

    match event_type.as_str() {
        "response.created" | "response.in_progress" => {
            log::debug!("[OpenAI OAuth] Response lifecycle event: {}", event_type);
        }
        "response.output_item.added" => {
            log::debug!("[OpenAI OAuth] Output item added: {:?}", payload);
            if let Some(item) = payload.get("item") {
                if item.get("type").and_then(|v| v.as_str()) == Some("function_call") {
                    let item_id = item
                        .get("id")
                        .and_then(|v| v.as_str())
                        .unwrap_or_default()
                        .to_string();
                    let call_id = item
                        .get("call_id")
                        .and_then(|v| v.as_str())
                        .unwrap_or_default()
                        .to_string();
                    let name = item
                        .get("name")
                        .and_then(|v| v.as_str())
                        .unwrap_or_default()
                        .to_string();

                    if !item_id.is_empty() {
                        let acc = state.tool_calls.entry(item_id.clone()).or_insert_with(|| {
                            ToolCallAccum {
                                tool_call_id: if call_id.is_empty() {
                                    item_id.clone()
                                } else {
                                    call_id.clone()
                                },
                                tool_name: name.clone(),
                                arguments: String::new(),
                            }
                        });
                        if !call_id.is_empty() {
                            acc.tool_call_id = call_id;
                        }
                        if !name.is_empty() {
                            acc.tool_name = name;
                        }
                        let index = item
                            .get("index")
                            .and_then(|v| v.as_u64())
                            .map(|value| value as usize);
                        if let Some(order_index) = index {
                            if state.tool_call_order.len() <= order_index {
                                state.tool_call_order.resize(order_index + 1, String::new());
                            }
                            let slot = &mut state.tool_call_order[order_index];
                            if slot.is_empty() || *slot == item_id {
                                *slot = item_id.clone();
                            }
                        } else if !state.tool_call_order.contains(&item_id) {
                            state.tool_call_order.push(item_id.clone());
                        }
                    }
                }
            }
        }
        "response.content_part.added" => {
            log::debug!("[OpenAI OAuth] Content part added: {:?}", payload);
            // Check if this is a text content part
            if let Some(part) = payload.get("part") {
                if let Some(text) = part.get("text").and_then(|v| v.as_str()) {
                    if !state.text_started {
                        state.text_started = true;
                        state.pending_events.push(StreamEvent::TextStart);
                    }
                    state.pending_events.push(StreamEvent::TextDelta {
                        text: text.to_string(),
                    });
                }
            }
        }
        "response.output_text.delta" => {
            log::debug!("[OpenAI OAuth] Output text delta: {:?}", payload);
            if !state.text_started {
                state.text_started = true;
                state.pending_events.push(StreamEvent::TextStart);
            }
            if let Some(delta) = payload.get("delta").and_then(|v| v.as_str()) {
                if !delta.is_empty() {
                    state.pending_events.push(StreamEvent::TextDelta {
                        text: delta.to_string(),
                    });
                }
            }
        }
        "response.output_text.done" => {
            log::debug!("[OpenAI OAuth] Output text done");
        }
        "response.function_call_arguments.delta" => {
            log::debug!("[OpenAI OAuth] Function call args delta");
            parse_openai_oauth_function_call_delta(&payload, state);
            emit_tool_calls(state, false);
        }
        "response.function_call_arguments.done" => {
            log::debug!("[OpenAI OAuth] Function call args done");
            if let Some(event) = parse_openai_oauth_function_call_done(&payload, state) {
                state.pending_events.push(event);
            }
            emit_tool_calls(state, true);
        }
        "response.reasoning_text.delta" => {
            let id = payload
                .get("item_id")
                .and_then(|v| v.as_str())
                .unwrap_or("default")
                .to_string();
            let delta = payload.get("delta").and_then(|v| v.as_str()).unwrap_or("");
            log::debug!("[OpenAI OAuth] Reasoning delta for {}: {}", id, delta);
            if state.current_thinking_id.as_deref() != Some(&id) {
                state.current_thinking_id = Some(id.clone());
                state.pending_events.push(StreamEvent::ReasoningStart {
                    id: id.clone(),
                    provider_metadata: None,
                });
            }
            if !delta.is_empty() {
                state.pending_events.push(StreamEvent::ReasoningDelta {
                    id,
                    text: delta.to_string(),
                    provider_metadata: None,
                });
            }
        }
        "response.reasoning_text.done" => {
            let id = payload
                .get("item_id")
                .and_then(|v| v.as_str())
                .unwrap_or("default")
                .to_string();
            log::debug!("[OpenAI OAuth] Reasoning done for {}", id);
            state.pending_events.push(StreamEvent::ReasoningEnd { id });
        }
        "response.completed" => {
            log::debug!("[OpenAI OAuth] Response completed");
            if let Some(response) = payload.get("response") {
                if let Some(usage) = response.get("usage") {
                    let input_tokens = usage
                        .get("input_tokens")
                        .and_then(|v| v.as_i64())
                        .unwrap_or(0);
                    let output_tokens = usage
                        .get("output_tokens")
                        .and_then(|v| v.as_i64())
                        .unwrap_or(0);
                    let total_tokens = usage.get("total_tokens").and_then(|v| v.as_i64());
                    state.pending_events.push(StreamEvent::Usage {
                        input_tokens: input_tokens as i32,
                        output_tokens: output_tokens as i32,
                        total_tokens: total_tokens.map(|v| v as i32),
                        cached_input_tokens: None,
                        cache_creation_input_tokens: None,
                    });
                }
                // Try to extract output text from response.output
                if let Some(output) = response.get("output").and_then(|v| v.as_array()) {
                    for item in output {
                        if let Some(content) = item.get("content").and_then(|v| v.as_array()) {
                            for part in content {
                                if let Some(text) = part.get("text").and_then(|v| v.as_str()) {
                                    if !state.text_started {
                                        state.text_started = true;
                                        state.pending_events.push(StreamEvent::TextStart);
                                    }
                                    state.pending_events.push(StreamEvent::TextDelta {
                                        text: text.to_string(),
                                    });
                                }
                                if let Some(delta) = part.get("delta").and_then(|v| v.as_str()) {
                                    if !delta.is_empty() {
                                        if !state.text_started {
                                            state.text_started = true;
                                            state.pending_events.push(StreamEvent::TextStart);
                                        }
                                        state.pending_events.push(StreamEvent::TextDelta {
                                            text: delta.to_string(),
                                        });
                                    }
                                }
                            }
                        }
                    }
                }
            }
            state.pending_events.push(StreamEvent::Done {
                finish_reason: None,
            });
        }
        "response.failed" => {
            let message = payload
                .get("response")
                .and_then(|r| r.get("error"))
                .and_then(|e| e.get("message"))
                .and_then(|v| v.as_str())
                .unwrap_or("Response failed")
                .to_string();
            log::error!("[OpenAI OAuth] Response failed: {}", message);
            state.pending_events.push(StreamEvent::Error { message });
        }
        _ => {
            log::debug!("[OpenAI OAuth] Unknown event type: {}", event_type);
        }
    }

    if let Some(event) = state.pending_events.get(0).cloned() {
        state.pending_events.remove(0);
        return Ok(Some(event));
    }

    Ok(None)
}

fn parse_openai_oauth_function_call_delta(
    payload: &serde_json::Value,
    state: &mut ProtocolStreamState,
) {
    let item_id = payload
        .get("item_id")
        .and_then(|v| v.as_str())
        .unwrap_or_default()
        .to_string();
    if item_id.is_empty() {
        return;
    }
    let delta = payload.get("delta").and_then(|v| v.as_str()).unwrap_or("");
    let acc = state.tool_calls.entry(item_id.clone()).or_insert_with(|| {
        crate::llm::protocols::ToolCallAccum {
            tool_call_id: item_id.clone(),
            tool_name: String::new(),
            arguments: String::new(),
        }
    });
    if !delta.is_empty() {
        acc.arguments.push_str(delta);
    }
    let index = payload
        .get("index")
        .and_then(|v| v.as_u64())
        .map(|value| value as usize);
    if let Some(order_index) = index {
        if state.tool_call_order.len() <= order_index {
            state.tool_call_order.resize(order_index + 1, String::new());
        }
        let slot = &mut state.tool_call_order[order_index];
        if slot.is_empty() || *slot == item_id {
            *slot = item_id.clone();
        }
    } else if !state.tool_call_order.contains(&item_id) {
        state.tool_call_order.push(item_id.clone());
    }
}

fn parse_openai_oauth_function_call_done(
    payload: &serde_json::Value,
    state: &mut ProtocolStreamState,
) -> Option<StreamEvent> {
    let item_id = payload
        .get("item_id")
        .and_then(|v| v.as_str())
        .unwrap_or_default()
        .to_string();
    if item_id.is_empty() {
        return None;
    }

    if state.emitted_tool_calls.contains(&item_id) {
        return None;
    }

    let name = payload
        .get("name")
        .and_then(|v| v.as_str())
        .unwrap_or_default()
        .to_string();
    let args = payload
        .get("arguments")
        .and_then(|v| v.as_str())
        .unwrap_or_default()
        .to_string();

    let acc = state.tool_calls.entry(item_id.clone()).or_insert_with(|| {
        crate::llm::protocols::ToolCallAccum {
            tool_call_id: item_id.clone(),
            tool_name: name.clone(),
            arguments: String::new(),
        }
    });

    if !name.is_empty() {
        acc.tool_name = name;
    }
    if !args.is_empty() {
        acc.arguments = args;
    }

    if acc.tool_name.trim().is_empty() {
        return None;
    }

    let index = payload
        .get("index")
        .and_then(|v| v.as_u64())
        .map(|value| value as usize);
    if let Some(order_index) = index {
        if state.tool_call_order.len() <= order_index {
            state.tool_call_order.resize(order_index + 1, String::new());
        }
        let slot = &mut state.tool_call_order[order_index];
        if slot.is_empty() || *slot == item_id {
            *slot = item_id.clone();
        }
    } else if !state.tool_call_order.contains(&item_id) {
        state.tool_call_order.push(item_id.clone());
    }
    state.emitted_tool_calls.insert(item_id.clone());

    let input_value = match build_openai_oauth_tool_input(&acc.arguments, true) {
        Some(value) => value,
        None => serde_json::json!({}),
    };

    Some(StreamEvent::ToolCall {
        tool_call_id: acc.tool_call_id.clone(),
        tool_name: acc.tool_name.clone(),
        input: input_value,
    })
}

struct SseEvent {
    event: Option<String>,
    data: String,
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::database::Database;
    use crate::llm::auth::api_key_manager::ApiKeyManager;
    use crate::llm::providers::provider_configs::builtin_providers;
    use crate::llm::providers::provider_registry::ProviderRegistry;
    use crate::llm::types::{ContentPart, Message, MessageContent, StreamTextRequest};
    use serde_json::json;
    use std::sync::Arc;
    use tempfile::TempDir;

    #[tokio::test]
    async fn build_openai_oauth_request_maps_tool_results() {
        let dir = TempDir::new().expect("temp dir");
        let db_path = dir.path().join("talkcody-test.db");
        let db = Arc::new(Database::new(db_path.to_string_lossy().to_string()));
        db.connect().await.expect("db connect");
        let api_keys = ApiKeyManager::new(db);
        let registry = ProviderRegistry::new(builtin_providers());
        let handler = StreamHandler::new(&registry, &api_keys);

        let request = StreamTextRequest {
            model: "gpt-5.2-codex".to_string(),
            messages: vec![
                Message::User {
                    content: MessageContent::Text("hi".to_string()),
                    provider_options: None,
                },
                Message::Assistant {
                    content: MessageContent::Parts(vec![
                        ContentPart::Text {
                            text: "checking".to_string(),
                        },
                        ContentPart::ToolCall {
                            tool_call_id: "call_1".to_string(),
                            tool_name: "webFetch".to_string(),
                            input: json!({ "url": "https://example.com" }),
                        },
                    ]),
                    provider_options: None,
                },
                Message::Tool {
                    content: vec![ContentPart::ToolResult {
                        tool_call_id: "call_1".to_string(),
                        tool_name: "webFetch".to_string(),
                        output: json!({ "type": "text", "value": "ok" }),
                    }],
                    provider_options: None,
                },
            ],
            tools: None,
            stream: Some(true),
            temperature: None,
            max_tokens: None,
            top_p: None,
            top_k: None,
            provider_options: None,
            request_id: None,
            trace_context: None,
        };

        let body = handler
            .build_openai_oauth_request(&request, "gpt-5.2-codex")
            .expect("request body");
        let input = body
            .get("input")
            .and_then(|value| value.as_array())
            .expect("input array");

        let has_tool_result = input.iter().any(|item| {
            item.get("type")
                .and_then(|value| value.as_str())
                .is_some_and(|value| value == "tool_result")
        });
        assert!(!has_tool_result);

        let has_function_call = input.iter().any(|item| {
            item.get("type")
                .and_then(|value| value.as_str())
                .is_some_and(|value| value == "function_call")
        });
        assert!(has_function_call);

        let output_item = input.iter().find(|item| {
            item.get("type")
                .and_then(|value| value.as_str())
                .is_some_and(|value| value == "function_call_output")
        });
        assert!(output_item.is_some());
        assert_eq!(
            output_item
                .and_then(|item| item.get("output"))
                .and_then(|value| value.as_str()),
            Some("ok")
        );
    }

    #[test]
    fn openai_oauth_skips_partial_tool_call_arguments() {
        let mut state = ProtocolStreamState::default();
        state.tool_calls.insert(
            "item_1".to_string(),
            ToolCallAccum {
                tool_call_id: "call_1".to_string(),
                tool_name: "readFile".to_string(),
                arguments: "{".to_string(),
            },
        );
        state.tool_call_order.push("item_1".to_string());

        let event = parse_openai_oauth_event(None, "{}", &mut state).expect("parse event");
        assert!(event.is_none());
        assert!(state.pending_events.is_empty());
        assert!(!state.emitted_tool_calls.contains("item_1"));
    }

    #[test]
    fn openai_oauth_emits_tool_call_when_arguments_complete() {
        let mut state = ProtocolStreamState::default();
        state.tool_calls.insert(
            "item_1".to_string(),
            ToolCallAccum {
                tool_call_id: "call_1".to_string(),
                tool_name: "readFile".to_string(),
                arguments: "{\"path\":\"/tmp/a\"}".to_string(),
            },
        );
        state.tool_call_order.push("item_1".to_string());

        // Trigger the tool call emission with function_call_arguments.delta event
        let event = parse_openai_oauth_event(
            Some("response.function_call_arguments.delta"),
            "{}",
            &mut state,
        )
        .expect("parse event");
        assert!(event.is_some());
        assert!(state.emitted_tool_calls.contains("item_1"));
    }

    #[test]
    fn openai_oauth_function_call_done_emits_once() {
        let mut state = ProtocolStreamState::default();
        let payload = json!({
            "item_id": "item_1",
            "name": "readFile",
            "arguments": "{\"path\":\"/tmp/a\"}"
        });

        let first = parse_openai_oauth_function_call_done(&payload, &mut state);
        assert!(first.is_some());
        assert!(state.emitted_tool_calls.contains("item_1"));

        let second = parse_openai_oauth_function_call_done(&payload, &mut state);
        assert!(second.is_none());
    }

    #[test]
    fn openai_oauth_preserves_tool_call_index_order() {
        let mut state = ProtocolStreamState::default();
        let first = json!({
            "type": "response.output_item.added",
            "item": {
                "type": "function_call",
                "id": "item_b",
                "call_id": "call_b",
                "name": "glob",
                "index": 1
            }
        });
        let second = json!({
            "type": "response.output_item.added",
            "item": {
                "type": "function_call",
                "id": "item_a",
                "call_id": "call_a",
                "name": "readFile",
                "index": 0
            }
        });
        let args_a = json!({
            "type": "response.function_call_arguments.done",
            "item_id": "item_a",
            "name": "readFile",
            "arguments": "{\"file_path\":\"/tmp/a\"}",
            "index": 0
        });
        let args_b = json!({
            "type": "response.function_call_arguments.done",
            "item_id": "item_b",
            "name": "glob",
            "arguments": "{\"pattern\":\"*.rs\"}",
            "index": 1
        });

        // Parse output_item.added events (no tool calls yet, just setup)
        let _ =
            parse_openai_oauth_event(None, &first.to_string(), &mut state).expect("parse first");
        let _ =
            parse_openai_oauth_event(None, &second.to_string(), &mut state).expect("parse second");

        // Collect tool calls from return values (not pending_events)
        let mut tool_calls: Vec<String> = Vec::new();

        // Parse args_b - should emit call_b via emit_tool_calls
        if let Some(event) =
            parse_openai_oauth_event(None, &args_b.to_string(), &mut state).expect("parse args b")
        {
            if let StreamEvent::ToolCall { tool_call_id, .. } = event {
                tool_calls.push(tool_call_id);
            }
        }
        // Drain any pending events
        while let Some(event) = state.pending_events.get(0).cloned() {
            state.pending_events.remove(0);
            if let StreamEvent::ToolCall { tool_call_id, .. } = event {
                tool_calls.push(tool_call_id);
            }
        }

        // Parse args_a - should emit call_a via emit_tool_calls
        if let Some(event) =
            parse_openai_oauth_event(None, &args_a.to_string(), &mut state).expect("parse args a")
        {
            if let StreamEvent::ToolCall { tool_call_id, .. } = event {
                tool_calls.push(tool_call_id);
            }
        }
        // Drain any pending events
        while let Some(event) = state.pending_events.get(0).cloned() {
            state.pending_events.remove(0);
            if let StreamEvent::ToolCall { tool_call_id, .. } = event {
                tool_calls.push(tool_call_id);
            }
        }

        // Tool calls are emitted in order of when their arguments become complete
        // call_b completes first (args_b processed before args_a)
        assert_eq!(tool_calls, vec!["call_b".to_string(), "call_a".to_string()]);
    }

    #[test]
    fn find_sse_delimiter_prefers_crlf() {
        let data = b"event: ping\r\n\r\n";
        let delimiter = StreamHandler::find_sse_delimiter(data);
        assert_eq!(delimiter, Some((11, 4)));
    }

    #[test]
    fn parse_sse_event_preserves_data_lines() {
        let raw = "event: message\ndata: first\ndata: second\n";
        let event = StreamHandler::parse_sse_event(raw).expect("parsed");
        assert_eq!(event.event.as_deref(), Some("message"));
        assert_eq!(event.data, "first\nsecond");
    }

    #[tokio::test]
    async fn resolve_base_url_prefers_coding_plan_setting() {
        let dir = TempDir::new().expect("temp dir");
        let db_path = dir.path().join("talkcody-base-url.db");
        let db = Arc::new(Database::new(db_path.to_string_lossy().to_string()));
        db.connect().await.expect("db connect");
        db.execute(
            "CREATE TABLE IF NOT EXISTS settings (key TEXT PRIMARY KEY, value TEXT, updated_at INTEGER)",
            vec![],
        )
        .await
        .expect("create settings");

        let api_keys = ApiKeyManager::new(db);
        api_keys
            .set_setting("use_coding_plan_zhipu", "true")
            .await
            .expect("set setting");

        let providers = builtin_providers();
        let provider = providers
            .iter()
            .find(|item| item.id == "zhipu")
            .expect("zhipu provider")
            .clone();
        let registry = ProviderRegistry::new(providers);
        let handler = StreamHandler::new(&registry, &api_keys);

        let base_url = handler
            .resolve_base_url(&provider)
            .await
            .expect("resolve base url");
        assert_eq!(
            &base_url,
            provider
                .coding_plan_base_url
                .as_ref()
                .expect("coding plan url")
        );
    }

    #[tokio::test]
    async fn moonshot_coding_plan_adds_kimi_cli_user_agent() {
        let dir = TempDir::new().expect("temp dir");
        let db_path = dir.path().join("talkcody-base-url.db");
        let db = Arc::new(Database::new(db_path.to_string_lossy().to_string()));
        db.connect().await.expect("db connect");
        db.execute(
            "CREATE TABLE IF NOT EXISTS settings (key TEXT PRIMARY KEY, value TEXT, updated_at INTEGER)",
            vec![],
        )
        .await
        .expect("create settings");

        let api_keys = ApiKeyManager::new(db);
        api_keys
            .set_setting("use_coding_plan_moonshot", "true")
            .await
            .expect("set setting");

        let providers = builtin_providers();
        let provider = providers
            .iter()
            .find(|item| item.id == "moonshot")
            .expect("moonshot provider")
            .clone();
        let registry = ProviderRegistry::new(providers);
        let handler = StreamHandler::new(&registry, &api_keys);

        let base_url = handler
            .resolve_base_url(&provider)
            .await
            .expect("resolve base url");

        let protocol = registry
            .protocol(provider.protocol)
            .expect("protocol exists");
        let mut headers = protocol.build_headers(None, None, provider.headers.as_ref());
        if provider.supports_coding_plan {
            if let Some(use_coding_plan) = api_keys
                .get_setting(&format!("use_coding_plan_{}", provider.id))
                .await
                .expect("get setting")
            {
                if use_coding_plan == "true" {
                    if let Some(coding_plan_url) = &provider.coding_plan_base_url {
                        if base_url == *coding_plan_url {
                            headers.insert("User-Agent".to_string(), "KimiCLI/1.3".to_string());
                        }
                    }
                }
            }
        }

        assert_eq!(headers.get("User-Agent"), Some(&"KimiCLI/1.3".to_string()));
    }

    #[test]
    fn openai_oauth_response_completed_emits_usage_and_done() {
        let mut state = ProtocolStreamState::default();
        let payload = json!({
            "type": "response.completed",
            "response": {
                "usage": { "input_tokens": 10, "output_tokens": 5, "total_tokens": 15 }
            }
        });

        let first = parse_openai_oauth_event(None, &payload.to_string(), &mut state)
            .expect("parse event")
            .expect("event");
        match first {
            StreamEvent::Usage {
                input_tokens,
                output_tokens,
                total_tokens,
                ..
            } => {
                assert_eq!(input_tokens, 10);
                assert_eq!(output_tokens, 5);
                assert_eq!(total_tokens, Some(15));
            }
            _ => panic!("Unexpected event"),
        }

        let second = parse_openai_oauth_event(Some("response.output_text.done"), "{}", &mut state)
            .expect("parse event")
            .expect("event");
        match second {
            StreamEvent::Done { finish_reason } => {
                assert_eq!(finish_reason, None);
            }
            _ => panic!("Unexpected event"),
        }
    }
}
