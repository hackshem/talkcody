use super::fixtures::{load_fixture, parse_sse_body, ProviderFixture, RecordedResponse};
use super::mock_server::MockProviderServer;
use crate::llm::protocols::{
    claude_protocol::ClaudeProtocol, openai_protocol::OpenAiProtocol, LlmProtocol,
    ProtocolStreamState,
};
use serde_json::Value;
use std::path::PathBuf;

fn recordings_dir() -> PathBuf {
    PathBuf::from(env!("CARGO_MANIFEST_DIR"))
        .join("src")
        .join("llm")
        .join("testing")
        .join("recordings")
}

fn load_fixtures_for_test(
    provider_id: Option<&str>,
    protocol: &str,
    channel: &str,
) -> Vec<ProviderFixture> {
    let dir = recordings_dir();
    let suffix = format!("__{}.json", channel);
    let protocol_tag = format!("__{}__", protocol);
    let mut matches = Vec::new();

    let entries = std::fs::read_dir(&dir)
        .unwrap_or_else(|err| panic!("Failed to read fixtures dir: {}", err));
    for entry in entries {
        let entry = entry.expect("read dir entry");
        let file_name = entry.file_name();
        let file_name = file_name.to_string_lossy();
        if !file_name.ends_with(&suffix) || !file_name.contains(&protocol_tag) {
            continue;
        }
        if let Some(provider_id) = provider_id {
            let prefix = format!("{}__{}__", provider_id, protocol);
            if !file_name.starts_with(&prefix) {
                continue;
            }
        }
        matches.push(entry.path());
    }

    matches.sort();
    if matches.is_empty() {
        let provider_hint = provider_id.unwrap_or("*");
        panic!(
            "No fixtures found for {} {} {}",
            provider_hint, protocol, channel
        );
    }

    matches
        .into_iter()
        .map(|path| {
            load_fixture(&path)
                .unwrap_or_else(|err| panic!("Failed to load fixture {}: {}", path.display(), err))
        })
        .collect()
}

fn protocol_for_fixture(fixture: &ProviderFixture) -> Box<dyn LlmProtocol> {
    match fixture.protocol.as_str() {
        "openai" => Box::new(OpenAiProtocol),
        "anthropic" => Box::new(ClaudeProtocol),
        other => panic!("Unknown protocol in fixture: {}", other),
    }
}

fn collect_events(protocol: &dyn LlmProtocol, fixture: &ProviderFixture) -> Vec<Value> {
    let mut state = ProtocolStreamState::default();
    let mut events: Vec<Value> = Vec::new();

    let RecordedResponse::Stream { sse_events, .. } = &fixture.response else {
        return events;
    };

    for event in sse_events {
        if let Some(parsed) = drain_events(protocol.parse_stream_event(
            event.event.as_deref(),
            &event.data,
            &mut state,
        )) {
            events.push(parsed);
        }
        while let Some(pending) = state.pending_events.get(0).cloned() {
            state.pending_events.remove(0);
            events.push(serde_json::to_value(pending).expect("serialize pending"));
        }
    }

    if state.finish_reason.as_deref() == Some("tool_calls") {
        events.push(
            serde_json::to_value(crate::llm::types::StreamEvent::Done {
                finish_reason: state.finish_reason.clone(),
            })
            .expect("serialize done"),
        );
    }

    events
}

fn drain_events(result: Result<Option<crate::llm::types::StreamEvent>, String>) -> Option<Value> {
    let parsed = result.expect("parse ok")?;
    Some(serde_json::to_value(parsed).expect("serialize event"))
}

/// Normalizes event arrays for comparison by replacing dynamic values (like UUIDs) with placeholders
fn normalize_events(events: &mut [Value]) {
    for event in events.iter_mut() {
        if let Some(obj) = event.as_object_mut() {
            // Normalize reasoning IDs - replace dynamic UUIDs with a placeholder
            if let Some(id) = obj.get("id").and_then(|v| v.as_str()) {
                if id.starts_with("reasoning_") {
                    obj.insert(
                        "id".to_string(),
                        Value::String("reasoning_<normalized>".to_string()),
                    );
                }
            }
        }
    }
}

fn assert_request_matches_fixture(protocol: &dyn LlmProtocol, fixture: &ProviderFixture) {
    let input = fixture
        .test_input
        .as_ref()
        .expect("fixture test_input required");
    let body = protocol
        .build_request(
            &input.model,
            &input.messages,
            input.tools.as_deref(),
            input.temperature,
            input.max_tokens,
            input.top_p,
            input.top_k,
            input.provider_options.as_ref(),
            input.extra_body.as_ref(),
        )
        .expect("build request");
    super::fixtures::assert_json_matches(&fixture.request.body, &body)
        .unwrap_or_else(|err| panic!("Request mismatch: {}", err));
}

#[test]
fn openai_fixture_roundtrip() {
    let fixtures = load_fixtures_for_test(None, "openai", "api");
    for fixture in fixtures {
        let protocol = protocol_for_fixture(&fixture);
        assert_request_matches_fixture(protocol.as_ref(), &fixture);

        let expected = fixture.expected_events.clone().expect("expected events");
        let mut expected_json = serde_json::to_value(expected).expect("serialize expected");
        let actual = collect_events(protocol.as_ref(), &fixture);
        let mut actual_json = Value::Array(actual);

        // Normalize both expected and actual events for comparison
        if let Some(expected_arr) = expected_json.as_array_mut() {
            normalize_events(expected_arr);
        }
        if let Some(actual_arr) = actual_json.as_array_mut() {
            normalize_events(actual_arr);
        }

        assert_eq!(expected_json, actual_json);
    }
}

#[test]
fn claude_fixture_roundtrip() {
    let fixtures = load_fixtures_for_test(None, "anthropic", "api");
    for fixture in fixtures {
        let protocol = protocol_for_fixture(&fixture);
        assert_request_matches_fixture(protocol.as_ref(), &fixture);

        let expected = fixture.expected_events.clone().expect("expected events");
        let mut expected_json = serde_json::to_value(expected).expect("serialize expected");
        let actual = collect_events(protocol.as_ref(), &fixture);
        let mut actual_json = Value::Array(actual);

        // Normalize both expected and actual events for comparison
        if let Some(expected_arr) = expected_json.as_array_mut() {
            normalize_events(expected_arr);
        }
        if let Some(actual_arr) = actual_json.as_array_mut() {
            normalize_events(actual_arr);
        }

        assert_eq!(expected_json, actual_json);
    }
}

#[tokio::test]
async fn mock_server_replays_openai_fixture() {
    let fixtures = load_fixtures_for_test(None, "openai", "api");
    for fixture in fixtures {
        let server = MockProviderServer::start(fixture.clone()).expect("mock server");
        let url = format!("{}/{}", server.base_url(), fixture.endpoint_path);

        let response = reqwest::Client::new()
            .post(url)
            .json(&fixture.request.body)
            .send()
            .await
            .expect("mock response");

        let body = response.text().await.expect("response body");
        let actual = parse_sse_body(&body);

        let RecordedResponse::Stream { sse_events, .. } = &fixture.response else {
            panic!("expected stream response");
        };
        assert_eq!(actual, *sse_events);
    }
}

#[test]
fn github_copilot_base_url_avoids_duplicate_v1() {
    use crate::llm::providers::provider_configs::builtin_providers;

    let provider = builtin_providers()
        .into_iter()
        .find(|entry| entry.id == "github_copilot")
        .expect("github_copilot provider");

    let endpoint_path = "chat/completions";
    let url = format!(
        "{}/{}",
        provider.base_url.trim_end_matches('/'),
        endpoint_path
    );

    assert_eq!(url, "https://api.githubcopilot.com/chat/completions");
}
