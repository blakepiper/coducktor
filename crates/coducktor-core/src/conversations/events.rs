//! Conversation history over the existing append-only normalized event log.

use std::io;
use std::path::{Path, PathBuf};

use coducktor_contract::RunEvent;

use crate::runs::events::{self, BufferedEventAppender};

/// Compatibility storage path for one conversation's append-only history.
pub fn history_path(data_dir: &Path, conversation_id: &str) -> PathBuf {
    events::events_path(data_dir, conversation_id)
}

/// Read valid history entries in chronological order, salvaging malformed lines individually.
pub fn read_history(path: &Path) -> Vec<RunEvent> {
    events::read_events(path)
}

/// Highest durable sequence number, or zero for missing/empty history.
pub fn rehydrate_sequence(path: &Path) -> f64 {
    events::rehydrate_seq(path)
}

/// Conversation-named buffered wrapper around the shared durable event appender.
pub struct ConversationEventAppender {
    inner: BufferedEventAppender,
}

impl ConversationEventAppender {
    pub fn open(path: &Path) -> io::Result<Self> {
        BufferedEventAppender::open(path).map(|inner| Self { inner })
    }

    pub fn append(&mut self, event: &RunEvent) -> io::Result<()> {
        self.inner.append(event)
    }
}

#[cfg(test)]
mod tests {
    use std::fs;

    use serde_json::{Value, json};

    use super::*;

    fn event(seq: f64, event_type: &str, extra: serde_json::Map<String, Value>) -> RunEvent {
        RunEvent {
            seq,
            ts: "2026-08-22T12:00:00.000Z".to_owned(),
            step_id: None,
            event_type: event_type.to_owned(),
            extra,
        }
    }

    #[test]
    fn conversation_history_reuses_the_compatibility_path_and_salvages_per_line() {
        let dir = tempfile::tempdir().unwrap();
        let path = history_path(dir.path(), "chat-1");
        let mut extra = serde_json::Map::new();
        extra.insert("text".to_owned(), json!("hello"));
        extra.insert("futureEventField".to_owned(), json!({"kept": true}));
        let first = event(1.0, "user-message", extra);
        let third = event(3.0, "future.provider-event", serde_json::Map::new());
        let raw = format!(
            "{}\nnot-json\n{}\n",
            serde_json::to_string(&first).unwrap(),
            serde_json::to_string(&third).unwrap()
        );
        fs::create_dir_all(path.parent().unwrap()).unwrap();
        fs::write(&path, raw).unwrap();

        let history = read_history(&path);

        assert_eq!(history, vec![first, third]);
        assert_eq!(rehydrate_sequence(&path), 3.0);
    }

    #[test]
    fn buffered_conversation_appends_are_immediately_readable() {
        let dir = tempfile::tempdir().unwrap();
        let path = history_path(dir.path(), "chat-1");
        let mut appender = ConversationEventAppender::open(&path).unwrap();
        appender
            .append(&event(1.0, "turn.started", serde_json::Map::new()))
            .unwrap();

        assert_eq!(read_history(&path).len(), 1);
    }
}
