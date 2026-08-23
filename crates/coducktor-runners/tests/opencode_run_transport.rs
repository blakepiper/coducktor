use std::fs;
use std::path::{Path, PathBuf};

use serde_json::Value;

const SESSION_ID: &str = "ses_run_json_fixture";

fn fixture_root() -> PathBuf {
    Path::new(env!("CARGO_MANIFEST_DIR")).join("../../fixtures/opencode")
}

fn read_fixture(name: &str) -> Vec<Value> {
    let raw = fs::read_to_string(fixture_root().join(name)).expect("fixture must be readable");
    raw.lines()
        .filter(|line| !line.trim().is_empty())
        .map(|line| serde_json::from_str(line).expect("fixture line must be valid JSON"))
        .collect()
}

fn session_ids(events: &[Value]) -> Vec<&str> {
    events
        .iter()
        .filter_map(|event| event.get("sessionID").and_then(Value::as_str))
        .collect()
}

fn has_event(events: &[Value], event_type: &str) -> bool {
    events
        .iter()
        .any(|event| event.get("type").and_then(Value::as_str) == Some(event_type))
}

fn final_text(events: &[Value]) -> Option<&str> {
    events.iter().rev().find_map(|event| {
        (event.get("type").and_then(Value::as_str) == Some("text"))
            .then(|| event.pointer("/part/text").and_then(Value::as_str))
            .flatten()
    })
}

fn clean_turn_end(events: &[Value]) -> bool {
    events.iter().rev().any(|event| {
        event.get("type").and_then(Value::as_str) == Some("step_finish")
            && event.pointer("/part/reason").and_then(Value::as_str) == Some("stop")
    })
}

#[test]
fn run_json_exposes_the_required_first_and_resumed_turn_boundaries() {
    let first = read_fixture("run-json-first-turn.ndjson");
    let follow_up = read_fixture("run-json-follow-up.ndjson");

    assert!(has_event(&first, "tool_use"));
    assert!(has_event(&follow_up, "tool_use"));
    assert_eq!(final_text(&first), Some("FIRST TURN COMPLETE"));
    assert_eq!(final_text(&follow_up), Some("SECOND TURN COMPLETE"));
    assert!(clean_turn_end(&first));
    assert!(clean_turn_end(&follow_up));

    let all_session_ids = session_ids(&first)
        .into_iter()
        .chain(session_ids(&follow_up))
        .collect::<Vec<_>>();
    assert!(!all_session_ids.is_empty());
    assert!(all_session_ids.iter().all(|id| *id == SESSION_ID));
}

#[test]
fn run_json_tool_frames_include_terminal_status_and_bounded_output_metadata() {
    for fixture in ["run-json-first-turn.ndjson", "run-json-follow-up.ndjson"] {
        let events = read_fixture(fixture);
        let tool = events
            .iter()
            .find(|event| event.get("type").and_then(Value::as_str) == Some("tool_use"))
            .expect("fixture must expose a tool lifecycle frame");

        assert_eq!(
            tool.pointer("/part/state/status").and_then(Value::as_str),
            Some("completed")
        );
        assert_eq!(
            tool.pointer("/part/state/metadata/exit")
                .and_then(Value::as_i64),
            Some(0)
        );
        assert_eq!(
            tool.pointer("/part/state/metadata/truncated")
                .and_then(Value::as_bool),
            Some(false)
        );
    }
}
