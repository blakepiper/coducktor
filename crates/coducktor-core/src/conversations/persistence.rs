//! Mixed legacy/conversation persistence for the compatibility `runs.json` index.

use std::fs;
use std::io;
use std::path::Path;

use coducktor_contract::{ConversationRecord, RunRecord};
use serde::Serialize;
use serde_json::Value;

use crate::runs::store;

/// One durable index entry. The discriminator is inspected before either schema is attempted.
#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(untagged)]
pub enum StoredRecord {
    Conversation(Box<ConversationRecord>),
    Legacy(Box<RunRecord>),
}

impl StoredRecord {
    pub fn id(&self) -> &str {
        match self {
            Self::Conversation(record) => &record.id,
            Self::Legacy(record) => &record.id,
        }
    }

    pub fn created_at(&self) -> &str {
        match self {
            Self::Conversation(record) => &record.created_at,
            Self::Legacy(record) => &record.created_at,
        }
    }

    pub fn as_conversation(&self) -> Option<&ConversationRecord> {
        match self {
            Self::Conversation(record) => Some(record),
            Self::Legacy(_) => None,
        }
    }

    pub fn as_legacy(&self) -> Option<&RunRecord> {
        match self {
            Self::Legacy(record) => Some(record),
            Self::Conversation(_) => None,
        }
    }
}

/// Missing, valid, partially salvageable, and wholly corrupt index outcomes.
#[derive(Debug)]
pub enum MixedIndexLoad {
    Missing,
    Valid(Vec<StoredRecord>),
    ValidWithSalvage(Vec<StoredRecord>),
    Corrupt,
}

impl MixedIndexLoad {
    pub fn records(&self) -> &[StoredRecord] {
        match self {
            Self::Valid(records) | Self::ValidWithSalvage(records) => records,
            Self::Missing | Self::Corrupt => &[],
        }
    }

    pub fn write_quarantined(&self) -> bool {
        matches!(self, Self::ValidWithSalvage(_) | Self::Corrupt)
    }
}

/// Load mixed records with per-entry salvage. An absent discriminator is always legacy.
pub fn load_mixed_index(index_path: &Path, keep_legacy_live: bool) -> MixedIndexLoad {
    let raw = match fs::read_to_string(index_path) {
        Ok(raw) => raw,
        Err(error) if error.kind() == io::ErrorKind::NotFound => return MixedIndexLoad::Missing,
        Err(_) => return MixedIndexLoad::Corrupt,
    };
    let Ok(Value::Array(values)) = serde_json::from_str::<Value>(&raw) else {
        return MixedIndexLoad::Corrupt;
    };

    let mut records = Vec::with_capacity(values.len());
    let mut salvaged = false;
    for value in values {
        match parse_stored_record(value, keep_legacy_live) {
            Some(record) => records.push(record),
            None => salvaged = true,
        }
    }

    if salvaged {
        MixedIndexLoad::ValidWithSalvage(records)
    } else {
        MixedIndexLoad::Valid(records)
    }
}

fn parse_stored_record(value: Value, keep_legacy_live: bool) -> Option<StoredRecord> {
    match value.get("recordKind") {
        Some(Value::String(kind)) if kind == "conversation" => serde_json::from_value(value)
            .ok()
            .map(StoredRecord::Conversation),
        None => store::try_parse_run_record(value)
            .map(|record| store::reconcile_loaded_run(record, keep_legacy_live))
            .map(Box::new)
            .map(StoredRecord::Legacy),
        Some(_) => None,
    }
}

/// Atomically write all records newest-first without applying count-based retention.
pub fn write_mixed_index(index_path: &Path, records: &[StoredRecord]) -> io::Result<()> {
    let mut sorted = records.iter().collect::<Vec<_>>();
    sorted.sort_by(|left, right| right.created_at().cmp(left.created_at()));
    let value = serde_json::to_value(sorted).map_err(io::Error::other)?;
    store::write_index_value(index_path, &value)
}

/// Existing count limits apply only to legacy records; conversations require explicit deletion.
pub fn select_stale_legacy_record_ids(records: &[StoredRecord]) -> Vec<String> {
    let legacy = records
        .iter()
        .filter_map(StoredRecord::as_legacy)
        .cloned()
        .collect::<Vec<_>>();
    store::select_stale_run_ids(&legacy)
}

#[cfg(test)]
mod tests {
    use std::fs;

    use coducktor_contract::ConversationState;
    use serde_json::{Value, json};

    use super::*;

    fn legacy(id: &str, status: &str) -> Value {
        json!({
            "id": id,
            "title": "legacy task",
            "workflow": "quick-task",
            "task": "legacy task",
            "status": status,
            "createdAt": "2026-08-20T12:00:00.000Z",
            "tokensUsed": 0,
            "archived": false,
            "steps": []
        })
    }

    fn conversation(id: &str) -> Value {
        json!({
            "recordKind": "conversation",
            "id": id,
            "projectId": "project-a",
            "title": "new chat",
            "initialMessage": {"text": "new chat", "futureMessage": true},
            "harness": "codex",
            "reasoning": "max",
            "repositoryRoot": "/repo",
            "cwd": "/repo",
            "worktree": false,
            "gitMode": "manual",
            "state": "idle",
            "createdAt": "2026-08-22T12:00:00.000Z",
            "updatedAt": "2026-08-22T12:00:00.000Z",
            "archived": false,
            "tokensUsed": 0.0,
            "workflow": "conversation",
            "task": "new chat",
            "steps": [],
            "futureRecord": {"kept": true}
        })
    }

    fn write_raw(path: &Path, value: &Value) {
        fs::write(path, serde_json::to_vec_pretty(value).unwrap()).unwrap();
    }

    #[test]
    fn mixed_index_loads_legacy_and_conversation_records_without_cross_parsing() {
        let dir = tempfile::tempdir().unwrap();
        let path = store::index_path(dir.path());
        write_raw(
            &path,
            &json!([legacy("run-1", "done"), conversation("chat-1")]),
        );

        let load = load_mixed_index(&path, true);

        assert!(!load.write_quarantined());
        assert_eq!(load.records().len(), 2);
        assert!(load.records()[0].as_legacy().is_some());
        assert_eq!(
            load.records()[1]
                .as_conversation()
                .map(|record| record.state),
            Some(ConversationState::Idle)
        );
    }

    #[test]
    fn malformed_entry_salvages_siblings_and_quarantines_writes() {
        let dir = tempfile::tempdir().unwrap();
        let path = store::index_path(dir.path());
        write_raw(
            &path,
            &json!([
                legacy("run-1", "done"),
                {"recordKind": "conversation", "id": "broken"},
                conversation("chat-1")
            ]),
        );

        let load = load_mixed_index(&path, true);

        assert!(load.write_quarantined());
        assert_eq!(load.records().len(), 2);
        assert_eq!(load.records()[0].id(), "run-1");
        assert_eq!(load.records()[1].id(), "chat-1");
    }

    #[test]
    fn write_round_trips_unknown_fields_and_is_owner_only() {
        let dir = tempfile::tempdir().unwrap();
        let path = store::index_path(dir.path());
        write_raw(
            &path,
            &json!([conversation("chat-1"), legacy("run-1", "done")]),
        );
        let load = load_mixed_index(&path, true);

        write_mixed_index(&path, load.records()).unwrap();

        let reloaded = load_mixed_index(&path, true);
        let chat = reloaded.records()[0].as_conversation().unwrap();
        assert_eq!(chat.extra.get("futureRecord"), Some(&json!({"kept": true})));
        assert_eq!(
            chat.initial_message.extra.get("futureMessage"),
            Some(&json!(true))
        );
        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt as _;
            assert_eq!(
                fs::metadata(&path).unwrap().permissions().mode() & 0o777,
                0o600
            );
        }
    }

    #[test]
    fn legacy_recovery_does_not_reclassify_conversation_state() {
        let dir = tempfile::tempdir().unwrap();
        let path = store::index_path(dir.path());
        let mut chat = conversation("chat-1");
        chat.as_object_mut()
            .unwrap()
            .insert("state".to_owned(), json!("running"));
        write_raw(&path, &json!([legacy("run-1", "running"), chat]));

        let load = load_mixed_index(&path, false);

        assert_eq!(
            load.records()[0].as_legacy().map(|record| record.status),
            Some(coducktor_contract::RunStatus::Failed)
        );
        assert_eq!(
            load.records()[1]
                .as_conversation()
                .map(|record| record.state),
            Some(ConversationState::Running)
        );
    }

    #[test]
    fn count_based_retention_never_selects_conversations() {
        let records = (0..(store::MAX_RUNS_KEPT + 5))
            .map(|index| {
                let value = conversation(&format!("chat-{index}"));
                parse_stored_record(value, true).unwrap()
            })
            .collect::<Vec<_>>();

        assert!(select_stale_legacy_record_ids(&records).is_empty());
    }
}
