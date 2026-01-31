use super::fixtures::{load_fixture, parse_sse_body, ProviderFixture, RecordedResponse};
use super::mock_server::MockProviderServer;
use crate::llm::protocols::{
    claude_protocol::ClaudeProtocol, openai_protocol::OpenAiProtocol, LlmProtocol,
    ProtocolStreamState,
};
use serde_json::Value;
use std::path::PathBuf;

fn fixture_path(name: &str) -> PathBuf {
    PathBuf::from(env!("CARGO_MANIFEST_DIR"))
        .join("src")
        .join("llm")
        .join("testing")
        .join("recordings")
        .join(format!("{}.json", name))
}

fn load_named_fixture(name: &str) -> ProviderFixture {
    let path = fixture_path(name);
    load_fixture(&path).unwrap_or_else(|err| panic!("Failed to load fixture: {}", err))
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
    let fixture = load_named_fixture("openai");
    let protocol = protocol_for_fixture(&fixture);
    assert_request_matches_fixture(protocol.as_ref(), &fixture);

    let expected = fixture.expected_events.clone().expect("expected events");
    let expected_json = serde_json::to_value(expected).expect("serialize expected");
    let actual = collect_events(protocol.as_ref(), &fixture);
    let actual_json = Value::Array(actual);
    assert_eq!(expected_json, actual_json);
}

#[test]
fn claude_fixture_roundtrip() {
    let fixture = load_named_fixture("claude");
    let protocol = protocol_for_fixture(&fixture);
    assert_request_matches_fixture(protocol.as_ref(), &fixture);

    let expected = fixture.expected_events.clone().expect("expected events");
    let expected_json = serde_json::to_value(expected).expect("serialize expected");
    let actual = collect_events(protocol.as_ref(), &fixture);
    let actual_json = Value::Array(actual);
    assert_eq!(expected_json, actual_json);
}

#[tokio::test]
async fn mock_server_replays_openai_fixture() {
    let fixture = load_named_fixture("openai");
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
