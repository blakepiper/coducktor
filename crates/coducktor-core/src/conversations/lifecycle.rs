use std::io;
use std::path::PathBuf;
use std::sync::Arc;
use std::sync::atomic::{AtomicU8, Ordering};

use coducktor_contract::{
    ConversationQuestionAnswer, ConversationSkillAttachment, ImageInput, Runner,
};
use serde::{Deserialize, Serialize};
use serde_json::{Map, Value};

/// Provider request for exactly one ordinary user-authored turn.
#[derive(Debug, Clone, PartialEq)]
pub struct ConversationTurnRequest {
    pub conversation_id: String,
    pub turn_id: String,
    pub user_text: String,
    pub images: Vec<ImageInput>,
    pub skill_context: Vec<ConversationSkillAttachment>,
    pub harness: Runner,
    pub model: Option<String>,
    pub reasoning: Option<String>,
    pub provider_session_id: Option<String>,
    pub resume: bool,
    pub cwd: PathBuf,
    pub additional_directories: Vec<PathBuf>,
    pub cancellation: TurnCancellation,
}

/// Usage and native session identity reported for one provider turn.
#[derive(Debug, Clone, Default, PartialEq)]
pub struct TurnReport {
    pub provider_session_id: Option<String>,
    pub tokens_used: f64,
    pub input_tokens: Option<f64>,
    pub output_tokens: Option<f64>,
    pub cost_usd: Option<f64>,
    /// Diagnostics/title fallback only; event callbacks own transcript persistence.
    pub turn_text: String,
}

/// One bounded native question within a stable provider request.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PendingQuestion {
    pub id: String,
    pub prompt: String,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub choices: Vec<String>,
    pub multiple: bool,
    pub allow_free_form: bool,
}

/// Process-local provider request that can be answered only through the retained session.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PendingRequest {
    pub request_id: String,
    pub questions: Vec<PendingQuestion>,
}

/// Native provider turn outcome. No variant depends on assistant prose or Coducktor markers.
#[derive(Debug, Clone, PartialEq)]
pub enum TurnOutcome {
    Ended {
        report: TurnReport,
        session_open: bool,
    },
    NeedsInput {
        report: TurnReport,
        pending_request: PendingRequest,
    },
    Failed {
        message: String,
        report: TurnReport,
        session_open: bool,
    },
    Cancelled {
        report: TurnReport,
        session_open: bool,
    },
}

/// Open normalized event emitted while a provider call is outside the manager.
#[derive(Debug, Clone, Default, PartialEq)]
pub struct ConversationEventInput {
    pub event_type: String,
    pub extra: Map<String, Value>,
}

impl ConversationEventInput {
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
}

/// Conversation-native live session. Calls are made only after the manager returns ownership.
pub trait ConversationSession: Send {
    fn turn(
        &mut self,
        request: &ConversationTurnRequest,
        on_event: &mut dyn FnMut(ConversationEventInput) -> io::Result<()>,
    ) -> Result<TurnOutcome, String>;

    fn answer(
        &mut self,
        request_id: &str,
        answers: &[ConversationQuestionAnswer],
        on_event: &mut dyn FnMut(ConversationEventInput) -> io::Result<()>,
    ) -> Result<TurnOutcome, String>;

    fn cancel(&mut self) {}

    fn provider_session_id(&self) -> Option<String> {
        None
    }
}

/// Opens or natively resumes one concrete harness session.
pub trait ConversationSessionFactory: Send + Sync {
    fn open(
        &self,
        request: &ConversationTurnRequest,
    ) -> Result<Box<dyn ConversationSession + Send>, String>;
}

/// Backend-neutral cancellation flag carried to the process layer without borrowing the manager.
#[derive(Debug, Clone, Default)]
pub struct TurnCancellation(Arc<AtomicU8>);

impl TurnCancellation {
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

impl PartialEq for TurnCancellation {
    fn eq(&self, other: &Self) -> bool {
        Arc::ptr_eq(&self.0, &other.0)
    }
}

impl Eq for TurnCancellation {}
