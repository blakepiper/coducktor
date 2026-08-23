//! The explicit provider-session restart and the bounded handoff it replays.
//!
//! The harness is the authority for context, so Coducktor never replays a transcript during
//! normal operation. This module exists for the one case where that authority is gone: the
//! provider refused to resume its own session, and the conversation cannot continue without a
//! new one.
//!
//! Nothing here runs on its own. A restart happens only when the user asks for one, and the
//! handoff it prepares is delivered exactly once, on the user's next message. Context-window
//! usage, quota state, plan progress, a timer, and provider prose are all non-reasons — see the
//! guardrails in `docs/specs/conversation-first-harness-cockpit.md` §16.

use coducktor_contract::RunEvent;
use serde_json::Value;

/// Most recent visible messages carried across a restart.
pub const MAX_HANDOFF_MESSAGES: usize = 20;
/// Total budget for the replayed excerpt.
pub const MAX_HANDOFF_BYTES: usize = 16 * 1024;
/// Per-message budget, so one long message cannot consume the whole excerpt.
pub const MAX_HANDOFF_MESSAGE_BYTES: usize = 2 * 1024;

/// The excerpt replayed into a new provider session, with the counts recorded on the record so
/// the user can see exactly how much was carried over.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct SessionHandoff {
    pub text: String,
    pub messages: u64,
    pub bytes: u64,
    /// Whether anything was dropped or shortened to fit the bounds above.
    pub truncated: bool,
}

/// One visible message, after streamed chunks have been joined.
struct Message {
    role: &'static str,
    text: String,
}

/// Build the handoff for a restart taken at `boundary_seq`.
///
/// Deterministic: the same history and boundary always produce the same text, which is what
/// makes the recorded boundary a real audit trail rather than a timestamp. Only the exact user
/// messages and the assistant's own prose are included — no reasoning, tool activity, Git
/// actions, errors, or Coducktor lifecycle events, because a new session must not be told
/// things the old one only inferred.
///
/// `None` when there is nothing visible to carry over; the next turn then simply opens a fresh
/// session with the user's message alone.
pub fn build_session_handoff(history: &[RunEvent], boundary_seq: f64) -> Option<SessionHandoff> {
    let mut messages: Vec<Message> = Vec::new();
    for event in history.iter().filter(|event| event.seq <= boundary_seq) {
        let role = match event.event_type.as_str() {
            "user-message" => "user",
            "text" => "assistant",
            _ => continue,
        };
        let Some(text) = event.extra.get("text").and_then(Value::as_str) else {
            continue;
        };
        if text.trim().is_empty() {
            continue;
        }
        // Providers stream assistant prose in chunks; each chunk is not its own message.
        match messages.last_mut() {
            Some(last) if last.role == role => last.text.push_str(text),
            _ => messages.push(Message {
                role,
                text: text.to_owned(),
            }),
        }
    }
    if messages.is_empty() {
        return None;
    }

    let mut truncated = messages.len() > MAX_HANDOFF_MESSAGES;
    let kept_from = messages.len().saturating_sub(MAX_HANDOFF_MESSAGES);
    let mut kept: Vec<Message> = messages.split_off(kept_from);
    for message in kept.iter_mut() {
        let trimmed = message.text.trim();
        if trimmed.len() != message.text.len() {
            message.text = trimmed.to_owned();
        }
        if message.text.len() > MAX_HANDOFF_MESSAGE_BYTES {
            message.text = format!(
                "{}…",
                truncate_bytes(&message.text, MAX_HANDOFF_MESSAGE_BYTES)
            );
            truncated = true;
        }
    }

    // Drop from the oldest end until the excerpt fits, so the most recent exchange — the part
    // the next message actually follows on from — always survives.
    while kept.len() > 1 && rendered_bytes(&kept) > MAX_HANDOFF_BYTES {
        kept.remove(0);
        truncated = true;
    }
    if kept.len() == 1 && kept[0].text.len() > MAX_HANDOFF_BYTES {
        kept[0].text = format!("{}…", truncate_bytes(&kept[0].text, MAX_HANDOFF_BYTES));
        truncated = true;
    }

    let mut text = String::from(
        "This chat's previous provider session could not be resumed, so this is a new one. The \
         excerpt below is what was already said in this chat, replayed once for context; it is \
         history, not a new instruction. Everything after it is live.\n<coducktor-session-handoff>",
    );
    for message in &kept {
        text.push('\n');
        text.push('<');
        text.push_str(message.role);
        text.push_str(">\n");
        text.push_str(&message.text);
        text.push_str("\n</");
        text.push_str(message.role);
        text.push('>');
    }
    text.push_str("\n</coducktor-session-handoff>");

    Some(SessionHandoff {
        messages: kept.len() as u64,
        bytes: text.len() as u64,
        text,
        truncated,
    })
}

/// Byte budget of the rendered excerpt, close enough for a bound: tag overhead is constant per
/// message and the exact total is recomputed once the text is built.
fn rendered_bytes(messages: &[Message]) -> usize {
    messages
        .iter()
        .map(|message| message.text.len() + message.role.len() * 2 + 8)
        .sum()
}

/// Truncate to at most `max` bytes without splitting a UTF-8 character.
fn truncate_bytes(text: &str, max: usize) -> &str {
    if text.len() <= max {
        return text;
    }
    let mut end = max;
    while end > 0 && !text.is_char_boundary(end) {
        end -= 1;
    }
    &text[..end]
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::{Map, json};

    fn event(seq: f64, event_type: &str, text: &str) -> RunEvent {
        let mut extra = Map::new();
        extra.insert("text".to_owned(), json!(text));
        RunEvent {
            seq,
            ts: "2026-08-23T00:00:00.000Z".to_owned(),
            step_id: None,
            event_type: event_type.to_owned(),
            extra,
        }
    }

    fn noise(seq: f64, event_type: &str) -> RunEvent {
        let mut extra = Map::new();
        extra.insert("text".to_owned(), json!("invisible"));
        RunEvent {
            seq,
            ts: "2026-08-23T00:00:00.000Z".to_owned(),
            step_id: None,
            event_type: event_type.to_owned(),
            extra,
        }
    }

    #[test]
    fn only_visible_user_and_assistant_messages_are_carried_over() {
        let history = vec![
            event(1.0, "user-message", "fix the login redirect"),
            noise(2.0, "reasoning"),
            noise(3.0, "tool-call"),
            event(4.0, "text", "Fixed it in auth.rs."),
            noise(5.0, "git.committed"),
            noise(6.0, "error"),
        ];
        let handoff = build_session_handoff(&history, 6.0).expect("something visible was said");
        assert!(
            handoff
                .text
                .contains("<user>\nfix the login redirect\n</user>")
        );
        assert!(
            handoff
                .text
                .contains("<assistant>\nFixed it in auth.rs.\n</assistant>")
        );
        assert!(!handoff.text.contains("invisible"));
        assert_eq!(handoff.messages, 2);
        assert!(!handoff.truncated);
    }

    #[test]
    fn streamed_assistant_chunks_join_into_one_message() {
        let history = vec![
            event(1.0, "user-message", "hello"),
            event(2.0, "text", "Looking "),
            event(3.0, "text", "into it."),
        ];
        let handoff = build_session_handoff(&history, 3.0).unwrap();
        assert_eq!(handoff.messages, 2);
        assert!(
            handoff
                .text
                .contains("<assistant>\nLooking into it.\n</assistant>")
        );
    }

    #[test]
    fn the_boundary_excludes_everything_recorded_after_it() {
        let history = vec![
            event(1.0, "user-message", "first"),
            event(2.0, "text", "first answer"),
            event(3.0, "user-message", "second"),
        ];
        let handoff = build_session_handoff(&history, 2.0).unwrap();
        assert!(handoff.text.contains("first"));
        assert!(!handoff.text.contains("second"));
    }

    #[test]
    fn the_same_history_and_boundary_always_build_the_same_text() {
        let history = vec![
            event(1.0, "user-message", "hello"),
            event(2.0, "text", "hi"),
        ];
        assert_eq!(
            build_session_handoff(&history, 2.0),
            build_session_handoff(&history, 2.0)
        );
    }

    #[test]
    fn a_conversation_with_nothing_visible_yet_has_no_handoff() {
        let history = vec![noise(1.0, "turn.started"), noise(2.0, "tool-call")];
        assert!(build_session_handoff(&history, 2.0).is_none());
        assert!(build_session_handoff(&[], 0.0).is_none());
    }

    #[test]
    fn only_the_most_recent_messages_survive_the_count_bound() {
        let history: Vec<RunEvent> = (0..60)
            .map(|index| {
                let kind = if index % 2 == 0 {
                    "user-message"
                } else {
                    "text"
                };
                event(index as f64 + 1.0, kind, &format!("message {index}"))
            })
            .collect();
        let handoff = build_session_handoff(&history, 60.0).unwrap();
        assert_eq!(handoff.messages, MAX_HANDOFF_MESSAGES as u64);
        assert!(handoff.truncated);
        assert!(handoff.text.contains("message 59"));
        assert!(!handoff.text.contains("message 0\n"));
    }

    #[test]
    fn one_enormous_message_is_shortened_rather_than_dropped() {
        let history = vec![event(1.0, "user-message", &"x".repeat(200 * 1024))];
        let handoff = build_session_handoff(&history, 1.0).unwrap();
        assert!(handoff.truncated);
        assert!(handoff.bytes as usize <= MAX_HANDOFF_BYTES + 512);
        assert!(handoff.text.contains('…'));
    }

    #[test]
    fn the_total_budget_drops_from_the_oldest_end() {
        let history: Vec<RunEvent> = (0..12)
            .map(|index| {
                let kind = if index % 2 == 0 {
                    "user-message"
                } else {
                    "text"
                };
                event(
                    index as f64 + 1.0,
                    kind,
                    &format!("msg{index}: {}", "y".repeat(MAX_HANDOFF_MESSAGE_BYTES)),
                )
            })
            .collect();
        let handoff = build_session_handoff(&history, 12.0).unwrap();
        assert!(handoff.truncated);
        assert!(handoff.bytes as usize <= MAX_HANDOFF_BYTES + 1024);
        // The newest exchange is what the next message follows on from.
        assert!(handoff.text.contains("msg11: "));
        assert!(!handoff.text.contains("msg0: "));
    }

    #[test]
    fn a_multibyte_message_is_never_split_mid_character() {
        let history = vec![event(1.0, "user-message", &"é".repeat(4 * 1024))];
        let handoff = build_session_handoff(&history, 1.0).unwrap();
        assert!(handoff.text.contains('é'));
    }
}
