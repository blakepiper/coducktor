//! The backend-neutral session seam every harness runner implements.
//!
//! A runner adapter lives outside this crate and only has to translate its own native protocol
//! into these types: live [`EventInput`]s during the turn and one [`SessionOutcome`] out.
//! Nothing backend-specific crosses this boundary, which is what lets the conversation runtime
//! treat Claude, Codex, OpenCode, and pi identically.

use std::io;
use std::sync::Arc;
use std::sync::atomic::{AtomicU8, Ordering};

use serde::Serialize;
use serde_json::{Map, Value};

use crate::runs::task_markers::canonicalize_markers;

/// An event before the runtime allocates its durable sequence and timestamp.
#[derive(Debug, Clone, Default, PartialEq)]
pub struct EventInput {
    pub event_type: String,
    pub step_id: Option<String>,
    pub extra: Map<String, Value>,
}

impl EventInput {
    pub fn new(event_type: impl Into<String>) -> Self {
        Self {
            event_type: event_type.into(),
            ..Self::default()
        }
    }

    pub fn field<T: Serialize>(mut self, name: &str, value: T) -> Self {
        self.extra.insert(
            name.to_owned(),
            serde_json::to_value(value).unwrap_or(Value::Null),
        );
        self
    }

    pub fn step(mut self, step_id: String) -> Self {
        self.step_id = Some(step_id);
        self
    }
}

/// Backend-neutral base64 image carried with a user prompt.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct PromptImage {
    pub media_type: String,
    pub data: String,
}

impl PromptImage {
    pub fn data_url(&self) -> String {
        format!("data:{};base64,{}", self.media_type, self.data)
    }
}

/// A backend-neutral stop signal that can be set without borrowing the active session.
#[derive(Debug, Clone, Default)]
pub struct CancellationToken(Arc<AtomicU8>);

impl CancellationToken {
    pub fn request(&self) -> bool {
        loop {
            match self.0.load(Ordering::Acquire) {
                0 => {
                    if self
                        .0
                        .compare_exchange(0, 1, Ordering::AcqRel, Ordering::Acquire)
                        .is_ok()
                    {
                        return true;
                    }
                }
                1 => return true,
                _ => return false,
            }
        }
    }

    pub fn is_requested(&self) -> bool {
        self.0.load(Ordering::Acquire) == 1
    }

    pub fn deactivate(&self) {
        self.0.store(2, Ordering::Release);
    }
}

impl PartialEq for CancellationToken {
    fn eq(&self, other: &Self) -> bool {
        Arc::ptr_eq(&self.0, &other.0)
    }
}

impl Eq for CancellationToken {}

/// Usage and marker information a fake or a future backend mapper can report without leaking its
/// native event types into core.
#[derive(Debug, Clone, Default, PartialEq)]
pub struct SessionReport {
    pub session_id: Option<String>,
    pub tokens_used: f64,
    pub input_tokens: Option<f64>,
    pub output_tokens: Option<f64>,
    pub cost_usd: Option<f64>,
    pub turn_text: String,
    pub decision: Option<TurnMarkerDecision>,
}

/// A single session turn.
#[derive(Debug, Clone, PartialEq)]
pub enum SessionOutcome {
    Completed(SessionReport),
    Running(SessionReport),
    Waiting(SessionReport),
    Failed {
        message: String,
        report: SessionReport,
    },
    Cancelled(SessionReport),
}

/// Backend-neutral session seam. A real runner adapter belongs outside this crate and only needs
/// to translate its own protocol into these outcomes.
pub trait AgentSession: Send {
    /// Run one turn. `on_event` is called once per mid-turn live event, in order, before this
    /// returns — a real backend calls it as its process actually produces output; a fake/test
    /// double may call it zero or more times, or not at all, and still return a valid outcome.
    /// The returned [`SessionOutcome`]'s [`SessionReport::turn_text`] is the whole turn's
    /// aggregated text, used for post-turn bookkeeping — it is not re-persisted as its own
    /// event; `on_event` already carried the content live.
    fn turn(
        &mut self,
        on_event: &mut dyn FnMut(EventInput) -> io::Result<()>,
    ) -> Result<SessionOutcome, String>;

    fn send_message(
        &mut self,
        _prompt: &str,
        _images: &[PromptImage],
        _on_event: &mut dyn FnMut(EventInput) -> io::Result<()>,
    ) -> Result<SessionOutcome, String> {
        Err("session does not accept follow-up messages".to_owned())
    }

    fn finish(
        &mut self,
        _on_event: &mut dyn FnMut(EventInput) -> io::Result<()>,
    ) -> Result<SessionOutcome, String> {
        Ok(SessionOutcome::Completed(SessionReport::default()))
    }

    fn cancel(&mut self) {}

    fn session_id(&self) -> Option<String> {
        None
    }
}

/// How a finished turn ended, as read from the turn's own text.
///
/// Nothing schedules another turn from this: the conversation runtime settles every turn at the
/// user's next message. It survives because agents still emit the markers and a runner must not
/// render a complete marker as transcript prose.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum TurnMarkerDecision {
    Closed,
    Done,
    Ask,
    Monitoring,
    Idle,
}

fn is_standalone_legacy_done(text: &str) -> bool {
    matches!(
        text.trim_end().lines().next_back().map(str::trim),
        Some("DONE" | "[DONE]")
    )
}

fn trailing_marker(text: &str, marker: &str) -> bool {
    let canonical = canonicalize_markers(text);
    canonical.trim_end().ends_with(&format!("DUCK:{marker}"))
        || (marker == "DONE" && is_standalone_legacy_done(&canonical))
}

pub fn decide_turn_marker(
    turn_text: &str,
    session_open: bool,
    valid_ask: bool,
) -> TurnMarkerDecision {
    if !session_open {
        return TurnMarkerDecision::Closed;
    }
    if trailing_marker(turn_text, "DONE") {
        return TurnMarkerDecision::Done;
    }
    if valid_ask {
        return TurnMarkerDecision::Ask;
    }
    if trailing_marker(turn_text, "MONITORING") {
        return TurnMarkerDecision::Monitoring;
    }
    TurnMarkerDecision::Idle
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn turn_decisions_keep_done_ask_monitoring_precedence() {
        assert_eq!(
            decide_turn_marker("work\nDUCK:DONE", true, true),
            TurnMarkerDecision::Done
        );
        assert_eq!(
            decide_turn_marker("work", true, true),
            TurnMarkerDecision::Ask
        );
        assert_eq!(
            decide_turn_marker("work\nDUCK:MONITORING", true, false),
            TurnMarkerDecision::Monitoring
        );
        assert_eq!(
            decide_turn_marker("ordinary final answer", true, false),
            TurnMarkerDecision::Idle
        );
        assert_eq!(
            decide_turn_marker("work\nDUCK:DONE", false, false),
            TurnMarkerDecision::Closed
        );
    }

    #[test]
    fn the_legacy_bare_done_spelling_is_still_read() {
        assert_eq!(
            decide_turn_marker("work\nDONE", true, false),
            TurnMarkerDecision::Done
        );
        assert_eq!(
            decide_turn_marker("work\n[DONE]", true, false),
            TurnMarkerDecision::Done
        );
    }

    #[test]
    fn a_cancellation_token_latches_once_and_can_be_deactivated() {
        let token = CancellationToken::default();
        assert!(!token.is_requested());
        assert!(token.request());
        assert!(token.is_requested());
        assert!(token.request());
        token.deactivate();
        assert!(!token.is_requested());
        assert!(!token.request());
    }

    #[test]
    fn an_event_input_builds_its_type_step_and_fields() {
        let event = EventInput::new("lifecycle")
            .step("step-1".to_owned())
            .field("message", "run finished");
        assert_eq!(event.event_type, "lifecycle");
        assert_eq!(event.step_id.as_deref(), Some("step-1"));
        assert_eq!(
            event.extra.get("message").and_then(Value::as_str),
            Some("run finished")
        );
    }

    #[test]
    fn a_prompt_image_renders_a_data_url() {
        let image = PromptImage {
            media_type: "image/png".to_owned(),
            data: "abc".to_owned(),
        };
        assert_eq!(image.data_url(), "data:image/png;base64,abc");
    }
}
