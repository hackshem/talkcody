use crate::llm::protocols::{LlmProtocol, ProtocolStreamState, ToolCallAccum};
use crate::llm::types::{ContentPart, Message, MessageContent, StreamEvent, ToolDefinition};
use serde_json::{json, Value};
use std::collections::HashMap;

pub struct OpenAiProtocol;

impl OpenAiProtocol {
    fn build_messages(&self, messages: &[Message]) -> Vec<Value> {
        let mut result = Vec::new();

        for msg in messages {
            match msg {
                Message::System { content, .. } => {
                    result.push(json!({ "role": "system", "content": content }));
                }
                Message::User { content, .. } => {
                    result.push(json!({
                        "role": "user",
                        "content": self.convert_content(content)
                    }));
                }
                Message::Assistant {
                    content,
                    provider_options,
                } => {
                    result.push(self.build_assistant_message(content, provider_options.as_ref()));
                }
                Message::Tool { content, .. } => {
                    let mut tool_results = Vec::new();
                    for part in content {
                        if let ContentPart::ToolResult {
                            tool_call_id,
                            tool_name: _,
                            output,
                        } = part
                        {
                            tool_results.push(json!({
                                "tool_call_id": tool_call_id,
                                "role": "tool",
                                "content": self.tool_output_to_string(output)
                            }));
                        }
                    }
                    for tool_msg in tool_results {
                        result.push(tool_msg);
                    }
                }
            }
        }

        result
    }

    fn convert_content(&self, content: &MessageContent) -> Value {
        match content {
            MessageContent::Text(text) => json!(text),
            MessageContent::Parts(parts) => {
                let mut mapped = Vec::new();
                for part in parts {
                    match part {
                        ContentPart::Text { text } => {
                            mapped.push(json!({ "type": "text", "text": text }));
                        }
                        ContentPart::Image { image } => {
                            mapped.push(json!({
                                "type": "image_url",
                                "image_url": { "url": format!("data:image/png;base64,{}", image) }
                            }));
                        }
                        ContentPart::ToolCall {
                            tool_call_id,
                            tool_name,
                            input,
                        } => {
                            mapped.push(json!({
                                "type": "tool_call",
                                "id": tool_call_id,
                                "function": {
                                    "name": tool_name,
                                    "arguments": input.to_string()
                                }
                            }));
                        }
                        ContentPart::ToolResult { .. } => {}
                        ContentPart::Reasoning { text, .. } => {
                            if !text.trim().is_empty() {
                                mapped.push(json!({ "type": "text", "text": text }));
                            }
                        }
                    }
                }
                Value::Array(mapped)
            }
        }
    }

    fn build_assistant_message(
        &self,
        content: &MessageContent,
        provider_options: Option<&Value>,
    ) -> Value {
        let mut content_value = Value::Null;

        match content {
            MessageContent::Text(text) => {
                if !text.trim().is_empty() {
                    content_value = json!(text);
                }
            }
            MessageContent::Parts(parts) => {
                let mut text_chunks: Vec<String> = Vec::new();
                let mut rich_parts: Vec<Value> = Vec::new();
                let mut has_image = false;

                for part in parts {
                    match part {
                        ContentPart::Text { text } => {
                            if !text.trim().is_empty() {
                                text_chunks.push(text.clone());
                                rich_parts.push(json!({ "type": "text", "text": text }));
                            }
                        }
                        ContentPart::Reasoning { text, .. } => {
                            if !text.trim().is_empty() {
                                text_chunks.push(text.clone());
                                rich_parts.push(json!({ "type": "text", "text": text }));
                            }
                        }
                        ContentPart::Image { image } => {
                            has_image = true;
                            rich_parts.push(json!({
                                "type": "image_url",
                                "image_url": { "url": format!("data:image/png;base64,{}", image) }
                            }));
                        }
                        ContentPart::ToolCall { .. } => {}
                        ContentPart::ToolResult { .. } => {}
                    }
                }

                if has_image {
                    content_value = Value::Array(rich_parts);
                } else if !text_chunks.is_empty() {
                    content_value = json!(text_chunks.join(""));
                }
            }
        }

        let mut message = json!({
            "role": "assistant",
            "content": content_value
        });

        if let MessageContent::Parts(parts) = content {
            let mut tool_calls: Vec<Value> = Vec::new();
            for part in parts {
                if let ContentPart::ToolCall {
                    tool_call_id,
                    tool_name,
                    input,
                } = part
                {
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

                    tool_calls.push(json!({
                        "id": tool_call_id,
                        "type": "function",
                        "function": {
                            "name": tool_name,
                            "arguments": arguments
                        }
                    }));
                }
            }

            if !tool_calls.is_empty() {
                message["tool_calls"] = Value::Array(tool_calls);
            }
        }

        if let Some(options) = provider_options {
            if let Some(openai_compat) = options.get("openaiCompatible") {
                if let Some(reasoning_content) = openai_compat.get("reasoning_content") {
                    message["reasoning_content"] = reasoning_content.clone();
                }
            }
        }

        message
    }

    fn tool_output_to_string(&self, output: &Value) -> String {
        if let Some(value) = output.get("value").and_then(|v| v.as_str()) {
            return value.to_string();
        }
        output.to_string()
    }

    fn build_tools(&self, tools: Option<&[ToolDefinition]>) -> Option<Vec<Value>> {
        let tools = tools?;
        let mut result = Vec::new();
        for tool in tools {
            result.push(json!({
                "type": "function",
                "function": {
                    "name": tool.name,
                    "description": tool.description,
                    "parameters": tool.parameters
                }
            }));
        }
        Some(result)
    }

    fn parse_tool_delta(&self, delta: &Value, state: &mut ProtocolStreamState) {
        let tool_calls = delta.get("tool_calls").and_then(|v| v.as_array());
        if tool_calls.is_none() {
            return;
        }

        for entry in tool_calls.unwrap_or(&Vec::new()) {
            let index = entry.get("index").and_then(|v| v.as_u64());
            let tool_call_id = entry
                .get("id")
                .and_then(|v| v.as_str())
                .unwrap_or_default()
                .to_string();

            if let (Some(index), true) = (index, !tool_call_id.is_empty()) {
                state
                    .tool_call_index_map
                    .entry(index)
                    .or_insert_with(|| tool_call_id.clone());
            }

            let key = if !tool_call_id.is_empty() {
                tool_call_id.clone()
            } else if let Some(index) = index {
                state
                    .tool_call_index_map
                    .get(&index)
                    .cloned()
                    .or_else(|| {
                        let order_index = index as usize;
                        state.tool_call_order.get(order_index).cloned()
                    })
                    .unwrap_or_else(|| index.to_string())
            } else {
                String::new()
            };

            if key.is_empty() {
                continue;
            }

            let function = entry.get("function");
            let name = function
                .and_then(|f| f.get("name"))
                .and_then(|v| v.as_str())
                .unwrap_or_default();
            let args_value = function.and_then(|f| f.get("arguments"));

            let acc = state
                .tool_calls
                .entry(key.clone())
                .or_insert_with(|| ToolCallAccum {
                    tool_call_id: if tool_call_id.is_empty() {
                        key.clone()
                    } else {
                        tool_call_id.clone()
                    },
                    tool_name: name.to_string(),
                    arguments: String::new(),
                });

            if !tool_call_id.is_empty() {
                acc.tool_call_id = tool_call_id.clone();
            }
            if !name.is_empty() {
                acc.tool_name = name.to_string();
            }
            if let Some(args_val) = args_value {
                if let Some(args_str) = args_val.as_str() {
                    if !args_str.is_empty() {
                        acc.arguments.push_str(args_str);
                    }
                } else if acc.arguments.is_empty() {
                    acc.arguments = args_val.to_string();
                }
            }

            if let Some(order_index) = index.map(|value| value as usize) {
                if state.tool_call_order.len() <= order_index {
                    state.tool_call_order.resize(order_index + 1, String::new());
                }
                let placeholder = order_index.to_string();
                let slot = &mut state.tool_call_order[order_index];
                if slot.is_empty()
                    || *slot == placeholder
                    || (!tool_call_id.is_empty() && *slot != key)
                {
                    *slot = key.clone();
                }
            } else if !state.tool_call_order.contains(&key) {
                state.tool_call_order.push(key.clone());
            }
        }
    }

    fn emit_tool_calls(&self, state: &mut ProtocolStreamState, force: bool) {
        for key in state.tool_call_order.clone() {
            if state.emitted_tool_calls.contains(&key) {
                continue;
            }
            if let Some(acc) = state.tool_calls.get(&key) {
                if acc.tool_name.is_empty() {
                    continue;
                }
                if !force && acc.arguments.trim().is_empty() {
                    continue;
                }

                let input_value = if acc.arguments.trim().is_empty() {
                    json!({})
                } else {
                    serde_json::from_str(&acc.arguments)
                        .unwrap_or_else(|_| Value::String(acc.arguments.clone()))
                };

                state.pending_events.push(StreamEvent::ToolCall {
                    tool_call_id: acc.tool_call_id.clone(),
                    tool_name: acc.tool_name.clone(),
                    input: input_value,
                });
                state.emitted_tool_calls.insert(key);
            }
        }
    }
}

impl LlmProtocol for OpenAiProtocol {
    fn name(&self) -> &str {
        "openai"
    }

    fn endpoint_path(&self) -> &'static str {
        "chat/completions"
    }

    fn build_request(
        &self,
        model: &str,
        messages: &[Message],
        tools: Option<&[ToolDefinition]>,
        temperature: Option<f32>,
        max_tokens: Option<i32>,
        top_p: Option<f32>,
        top_k: Option<i32>,
        provider_options: Option<&Value>,
        extra_body: Option<&Value>,
    ) -> Result<Value, String> {
        let mut body = json!({
            "model": model,
            "messages": self.build_messages(messages),
            "stream": true,
            "stream_options": { "include_usage": true }
        });

        if let Some(tools) = self.build_tools(tools) {
            body["tools"] = Value::Array(tools);
        }
        if let Some(temperature) = temperature {
            body["temperature"] = json!(temperature);
        }
        if let Some(max_tokens) = max_tokens {
            body["max_tokens"] = json!(max_tokens);
        }
        if let Some(top_p) = top_p {
            body["top_p"] = json!(top_p);
        }
        if let Some(top_k) = top_k {
            body["top_k"] = json!(top_k);
        }

        if let Some(options) = provider_options {
            if let Some(openai_opts) = options.get("openai") {
                if let Some(reasoning) = openai_opts.get("reasoningEffort") {
                    body["reasoning_effort"] = reasoning.clone();
                }
            }
            if let Some(openrouter_opts) = options.get("openrouter") {
                if let Some(effort) = openrouter_opts.get("effort") {
                    body["reasoning"] = json!({ "effort": effort.clone() });
                }
            }
        }

        if let Some(extra) = extra_body {
            if let Some(obj) = body.as_object_mut() {
                if let Some(extra_obj) = extra.as_object() {
                    for (k, v) in extra_obj {
                        obj.insert(k.to_string(), v.clone());
                    }
                }
            }
        }

        Ok(body)
    }

    fn parse_stream_event(
        &self,
        _event_type: Option<&str>,
        data: &str,
        state: &mut ProtocolStreamState,
    ) -> Result<Option<StreamEvent>, String> {
        if data.trim() == "[DONE]" {
            self.emit_tool_calls(state, true);
            // Emit ReasoningEnd if reasoning was started
            if state.reasoning_started {
                if let Some(ref id) = state.reasoning_id {
                    state
                        .pending_events
                        .push(StreamEvent::ReasoningEnd { id: id.clone() });
                }
                state.reasoning_started = false;
            }
            if let Some(event) = state.pending_events.get(0).cloned() {
                state.pending_events.remove(0);
                return Ok(Some(event));
            }
            return Ok(Some(StreamEvent::Done {
                finish_reason: state.finish_reason.clone(),
            }));
        }

        let payload: Value = serde_json::from_str(data).map_err(|e| e.to_string())?;
        // Only emit Usage event when there's meaningful usage data
        // Some providers send empty usage in every chunk, so we filter those out
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

            // Only emit if we have non-zero values or explicit total_tokens
            let has_meaningful_data =
                input_tokens > 0 || output_tokens > 0 || total_tokens.is_some_and(|v| v > 0);

            if has_meaningful_data {
                state.pending_events.push(StreamEvent::Usage {
                    input_tokens: input_tokens as i32,
                    output_tokens: output_tokens as i32,
                    total_tokens: total_tokens.map(|v| v as i32),
                    cached_input_tokens: None,
                    cache_creation_input_tokens: None,
                });
            }
        }

        let choices = payload.get("choices").and_then(|v| v.as_array());
        if let Some(choice) = choices.and_then(|arr| arr.first()) {
            if let Some(finish_reason) = choice.get("finish_reason").and_then(|v| v.as_str()) {
                state.finish_reason = Some(finish_reason.to_string());
            }
            if let Some(delta) = choice.get("delta") {
                if !state.text_started {
                    state.text_started = true;
                    state.pending_events.push(StreamEvent::TextStart);
                }

                // Handle reasoning_content (DeepSeek-style reasoning)
                if let Some(reasoning_content) =
                    delta.get("reasoning_content").and_then(|v| v.as_str())
                {
                    if !reasoning_content.is_empty() {
                        if !state.reasoning_started {
                            state.reasoning_started = true;
                            // Generate a stable reasoning ID
                            state.reasoning_id =
                                Some(format!("reasoning_{}", uuid::Uuid::new_v4()));
                            state.pending_events.push(StreamEvent::ReasoningStart {
                                id: state.reasoning_id.clone().unwrap(),
                                provider_metadata: None,
                            });
                        }
                        if let Some(ref id) = state.reasoning_id {
                            state.pending_events.push(StreamEvent::ReasoningDelta {
                                id: id.clone(),
                                text: reasoning_content.to_string(),
                                provider_metadata: None,
                            });
                        }
                    }
                }

                if let Some(content) = delta.get("content").and_then(|v| v.as_str()) {
                    state.pending_events.push(StreamEvent::TextDelta {
                        text: content.to_string(),
                    });
                }

                self.parse_tool_delta(delta, state);
            }
        }

        if state.finish_reason.as_deref() == Some("tool_calls") {
            self.emit_tool_calls(state, false);
        }

        // Emit ReasoningEnd when finish_reason is received and reasoning was started
        if state.finish_reason.is_some() && state.reasoning_started {
            if let Some(ref id) = state.reasoning_id {
                state
                    .pending_events
                    .push(StreamEvent::ReasoningEnd { id: id.clone() });
            }
            state.reasoning_started = false;
        }

        if let Some(event) = state.pending_events.get(0).cloned() {
            state.pending_events.remove(0);
            return Ok(Some(event));
        }

        Ok(None)
    }

    fn build_headers(
        &self,
        api_key: Option<&str>,
        oauth_token: Option<&str>,
        extra_headers: Option<&HashMap<String, String>>,
    ) -> HashMap<String, String> {
        let mut headers = HashMap::new();
        headers.insert("Content-Type".to_string(), "application/json".to_string());
        if let Some(token) = oauth_token.or(api_key) {
            headers.insert("Authorization".to_string(), format!("Bearer {}", token));
        }
        if let Some(extra) = extra_headers {
            for (k, v) in extra {
                headers.insert(k.to_string(), v.to_string());
            }
        }
        headers
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;
    use std::collections::HashMap;

    #[test]
    fn parse_stream_emits_reasoning_events_from_reasoning_content() {
        let protocol = OpenAiProtocol;
        let mut state = ProtocolStreamState::default();

        let first = json!({
            "choices": [{
                "delta": {
                    "reasoning_content": "Let me think about this..."
                }
            }]
        });
        let second = json!({
            "choices": [{
                "delta": {
                    "reasoning_content": " more reasoning"
                }
            }]
        });
        let done = json!({
            "choices": [{ "finish_reason": "stop", "delta": {} }]
        });

        // Parse first reasoning chunk - TextStart is emitted first
        let event = protocol
            .parse_stream_event(None, &first.to_string(), &mut state)
            .expect("parse first")
            .expect("event");

        match event {
            StreamEvent::TextStart => {
                // Expected - TextStart is always emitted first
            }
            _ => panic!("Expected TextStart, got {:?}", event),
        }

        // ReasoningStart is in pending_events
        assert!(!state.pending_events.is_empty(), "Expected pending events");
        let start_event = state.pending_events.remove(0);
        match start_event {
            StreamEvent::ReasoningStart { .. } => {
                // Expected
            }
            _ => panic!("Expected ReasoningStart, got {:?}", start_event),
        }

        // ReasoningDelta is also in pending_events
        assert!(!state.pending_events.is_empty(), "Expected pending events");
        let delta_event = state.pending_events.remove(0);
        match delta_event {
            StreamEvent::ReasoningDelta { text, .. } => {
                assert_eq!(text, "Let me think about this...");
            }
            _ => panic!("Expected ReasoningDelta, got {:?}", delta_event),
        }

        // Parse second reasoning chunk
        let event = protocol
            .parse_stream_event(None, &second.to_string(), &mut state)
            .expect("parse second")
            .expect("event");

        match event {
            StreamEvent::ReasoningDelta { text, .. } => {
                assert_eq!(text, " more reasoning");
            }
            _ => panic!("Expected ReasoningDelta, got {:?}", event),
        }

        // Parse done - should emit ReasoningEnd
        let event = protocol
            .parse_stream_event(None, &done.to_string(), &mut state)
            .expect("parse done")
            .expect("event");

        match event {
            StreamEvent::ReasoningEnd { .. } => {
                // Expected
            }
            _ => panic!("Expected ReasoningEnd, got {:?}", event),
        }
    }

    #[test]
    fn parse_stream_handles_empty_reasoning_content() {
        let protocol = OpenAiProtocol;
        let mut state = ProtocolStreamState::default();

        let data = json!({
            "choices": [{
                "delta": {
                    "reasoning_content": ""
                }
            }]
        });

        let result = protocol
            .parse_stream_event(None, &data.to_string(), &mut state)
            .expect("parse");

        // Empty reasoning_content should emit TextStart but not start reasoning
        match result {
            Some(StreamEvent::TextStart) => {
                // Expected - TextStart is always emitted when delta is present
            }
            _ => panic!(
                "Expected TextStart for empty reasoning_content, got {:?}",
                result
            ),
        }
        assert!(
            !state.reasoning_started,
            "Reasoning should not start for empty content"
        );
    }

    #[test]
    fn parse_stream_handles_reasoning_content_with_regular_content() {
        let protocol = OpenAiProtocol;
        let mut state = ProtocolStreamState::default();

        let data = json!({
            "choices": [{
                "delta": {
                    "reasoning_content": "Let me analyze",
                    "content": "The answer is"
                }
            }]
        });

        // Process all events
        let mut events = Vec::new();
        if let Some(event) = protocol
            .parse_stream_event(None, &data.to_string(), &mut state)
            .expect("parse")
        {
            events.push(event);
        }
        while let Some(pending) = state.pending_events.get(0).cloned() {
            state.pending_events.remove(0);
            events.push(pending);
        }

        // Should have: TextStart, ReasoningStart, ReasoningDelta, TextDelta
        assert!(
            events.iter().any(|e| matches!(e, StreamEvent::TextStart)),
            "Expected TextStart"
        );
        assert!(
            events
                .iter()
                .any(|e| matches!(e, StreamEvent::ReasoningStart { .. })),
            "Expected ReasoningStart"
        );
        assert!(
            events.iter().any(|e| matches!(e, StreamEvent::ReasoningDelta { text, .. } if text == "Let me analyze")),
            "Expected ReasoningDelta with 'Let me analyze'"
        );
        assert!(
            events.iter().any(
                |e| matches!(e, StreamEvent::TextDelta { text, .. } if text == "The answer is")
            ),
            "Expected TextDelta with 'The answer is'"
        );
    }

    #[test]
    fn includes_reasoning_content_from_provider_options() {
        let protocol = OpenAiProtocol;
        let messages = vec![Message::Assistant {
            content: MessageContent::Parts(vec![ContentPart::ToolCall {
                tool_call_id: "call_1".to_string(),
                tool_name: "webFetch".to_string(),
                input: json!({ "url": "https://example.com" }),
            }]),
            provider_options: Some(json!({
                "openaiCompatible": { "reasoning_content": "" }
            })),
        }];

        let built = protocol.build_messages(&messages);
        let assistant = built.first().expect("assistant message");
        assert_eq!(assistant.get("reasoning_content"), Some(&json!("")));
    }

    #[test]
    fn omits_reasoning_content_when_not_provided() {
        let protocol = OpenAiProtocol;
        let messages = vec![Message::Assistant {
            content: MessageContent::Parts(vec![ContentPart::ToolCall {
                tool_call_id: "call_1".to_string(),
                tool_name: "webFetch".to_string(),
                input: json!({ "url": "https://example.com" }),
            }]),
            provider_options: None,
        }];

        let built = protocol.build_messages(&messages);
        let assistant = built.first().expect("assistant message");
        assert!(assistant.get("reasoning_content").is_none());
    }

    #[test]
    fn build_request_merges_provider_options_and_extra_body() {
        let protocol = OpenAiProtocol;
        let messages = vec![Message::User {
            content: MessageContent::Text("hi".to_string()),
            provider_options: None,
        }];

        let body = protocol
            .build_request(
                "gpt-4o",
                &messages,
                None,
                Some(0.2),
                Some(120),
                None,
                None,
                Some(&json!({
                    "openai": { "reasoningEffort": "medium" },
                    "openrouter": { "effort": "low" }
                })),
                Some(&json!({ "extra_param": true })),
            )
            .expect("build request");

        assert_eq!(body.get("reasoning_effort"), Some(&json!("medium")));
        assert_eq!(body.get("reasoning"), Some(&json!({ "effort": "low" })));
        assert_eq!(body.get("extra_param"), Some(&json!(true)));
        assert_eq!(body.get("max_tokens"), Some(&json!(120)));
    }

    #[test]
    fn parse_stream_emits_tool_call_from_accumulated_arguments() {
        let protocol = OpenAiProtocol;
        let mut state = ProtocolStreamState::default();

        let first = json!({
            "choices": [{
                "delta": {
                    "tool_calls": [{
                        "index": 0,
                        "id": "call_1",
                        "function": { "name": "readFile", "arguments": "{\"path\":\"/tmp" }
                    }]
                }
            }]
        });
        let second = json!({
            "choices": [{
                "delta": {
                    "tool_calls": [{
                        "index": 0,
                        "function": { "arguments": "\",\"pattern\":\"**/*.rs\"}" }
                    }]
                }
            }]
        });
        let done = json!({
            "choices": [{ "finish_reason": "tool_calls", "delta": {} }]
        });

        let _ = protocol
            .parse_stream_event(None, &first.to_string(), &mut state)
            .expect("parse first");
        let _ = protocol
            .parse_stream_event(None, &second.to_string(), &mut state)
            .expect("parse second");
        state.text_started = true;
        let event = protocol
            .parse_stream_event(None, &done.to_string(), &mut state)
            .expect("parse done")
            .expect("event");

        match event {
            StreamEvent::ToolCall {
                tool_call_id,
                tool_name,
                input,
            } => {
                assert_eq!(tool_call_id, "call_1");
                assert_eq!(tool_name, "readFile");
                assert_eq!(input.get("path"), Some(&json!("/tmp")));
                assert_eq!(input.get("pattern"), Some(&json!("**/*.rs")));
            }
            _ => panic!("Unexpected event"),
        }
    }

    #[test]
    fn parse_stream_preserves_tool_call_index_order() {
        let protocol = OpenAiProtocol;
        let mut state = ProtocolStreamState::default();

        let first = json!({
            "choices": [{
                "delta": {
                    "tool_calls": [{
                        "index": 1,
                        "id": "call_b",
                        "function": { "name": "glob", "arguments": "{\"pattern\":\"*.rs\"}" }
                    }]
                }
            }]
        });
        let second = json!({
            "choices": [{
                "delta": {
                    "tool_calls": [{
                        "index": 0,
                        "id": "call_a",
                        "function": { "name": "readFile", "arguments": "{\"file_path\":\"/tmp\"}" }
                    }]
                }
            }]
        });
        let done = json!({
            "choices": [{ "finish_reason": "tool_calls", "delta": {} }]
        });

        let mut events: Vec<StreamEvent> = Vec::new();

        let parsed = protocol
            .parse_stream_event(None, &first.to_string(), &mut state)
            .expect("parse first");
        if let Some(event) = parsed {
            events.push(event);
        }
        while let Some(pending) = state.pending_events.get(0).cloned() {
            state.pending_events.remove(0);
            events.push(pending);
        }

        let parsed = protocol
            .parse_stream_event(None, &second.to_string(), &mut state)
            .expect("parse second");
        if let Some(event) = parsed {
            events.push(event);
        }
        while let Some(pending) = state.pending_events.get(0).cloned() {
            state.pending_events.remove(0);
            events.push(pending);
        }

        state.text_started = true;
        let parsed = protocol
            .parse_stream_event(None, &done.to_string(), &mut state)
            .expect("parse done");
        if let Some(event) = parsed {
            events.push(event);
        }
        while let Some(pending) = state.pending_events.get(0).cloned() {
            state.pending_events.remove(0);
            events.push(pending);
        }

        let tool_calls: Vec<String> = events
            .iter()
            .filter_map(|event| match event {
                StreamEvent::ToolCall { tool_call_id, .. } => Some(tool_call_id.clone()),
                _ => None,
            })
            .collect();

        assert_eq!(tool_calls, vec!["call_a".to_string(), "call_b".to_string()]);
    }

    #[test]
    fn build_headers_prefers_oauth_token() {
        let protocol = OpenAiProtocol;
        let headers = protocol.build_headers(
            Some("api"),
            Some("oauth"),
            Some(&HashMap::from([(
                String::from("X-Test"),
                String::from("1"),
            )])),
        );
        assert_eq!(
            headers.get("Authorization"),
            Some(&"Bearer oauth".to_string())
        );
        assert_eq!(headers.get("X-Test"), Some(&"1".to_string()));
    }
}
