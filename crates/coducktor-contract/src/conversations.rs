use serde::{Deserialize, Serialize};

use crate::compat::ExtraFields;
use crate::{ImageInput, Runner, SkillSource, StepState};

/// Discriminates new conversation records from legacy task/workflow records in `runs.json`.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum RecordKind {
    Conversation,
}

/// The user-visible projection of a conversation's active or latest turn.
#[derive(Debug, Clone, Copy, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum ConversationState {
    #[default]
    Idle,
    Queued,
    Running,
    NeedsInput,
    Failed,
    Cancelled,
}

impl ConversationState {
    pub fn is_active(self) -> bool {
        matches!(self, Self::Queued | Self::Running | Self::NeedsInput)
    }
}

/// Durable outcome/state of one user-authored provider turn.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum TurnState {
    Queued,
    Running,
    NeedsInput,
    Ended,
    Failed,
    Cancelled,
}

impl TurnState {
    pub fn is_active(self) -> bool {
        matches!(self, Self::Queued | Self::Running | Self::NeedsInput)
    }
}

/// Coducktor's post-turn Git policy. It never changes provider turn count.
#[derive(Debug, Clone, Copy, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum ConversationGitMode {
    #[default]
    Manual,
    Auto,
}

/// Exact visible user content retained separately from provider-only skill augmentation.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ConversationMessage {
    pub text: String,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub images: Vec<ImageInput>,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub skill_attachments: Vec<ConversationSkillAttachment>,
    #[serde(default, flatten)]
    pub extra: ExtraFields,
}

/// Metadata proving which exact local skill body was attached to one provider turn.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ConversationSkillAttachment {
    pub id: String,
    pub name: String,
    pub source: SkillSource,
    pub path: String,
    pub content_hash: String,
    #[serde(default, flatten)]
    pub extra: ExtraFields,
}

/// A bounded current/latest-turn projection; full content remains in the NDJSON timeline.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ConversationTurnSummary {
    pub id: String,
    pub state: TurnState,
    pub submitted_at: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub started_at: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub finished_at: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub pending_request_id: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub error: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub tokens_used: Option<f64>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub cost_usd: Option<f64>,
    #[serde(default, flatten)]
    pub extra: ExtraFields,
}

/// New conversation record stored alongside legacy `RunRecord` values.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ConversationRecord {
    pub record_kind: RecordKind,
    pub id: String,
    pub project_id: String,
    pub title: String,
    pub initial_message: ConversationMessage,
    pub harness: Runner,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub model: Option<String>,
    /// Exact harness-native value. Omission delegates to the harness default.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub reasoning: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub provider_session_id: Option<String>,
    pub repository_root: String,
    pub cwd: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub base_branch: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub branch: Option<String>,
    pub worktree: bool,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub worktree_path: Option<String>,
    pub git_mode: ConversationGitMode,
    pub state: ConversationState,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub active_turn: Option<ConversationTurnSummary>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub latest_turn: Option<ConversationTurnSummary>,
    pub created_at: String,
    pub updated_at: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub seen_at: Option<String>,
    pub archived: bool,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub archived_at: Option<String>,
    pub tokens_used: f64,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub input_tokens: Option<f64>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub output_tokens: Option<f64>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub cost_usd: Option<f64>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub last_error: Option<String>,

    // Minimum compatibility vocabulary required while old readers still consume `runs.json`.
    pub workflow: String,
    pub task: String,
    pub steps: Vec<StepState>,

    #[serde(default, flatten)]
    pub extra: ExtraFields,
}

/// Project-qualified browser entry for a current conversation record.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ConversationIndexEntry {
    pub project_id: String,
    pub id: String,
    pub title: String,
    pub state: ConversationState,
    pub harness: Runner,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub model: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub reasoning: Option<String>,
    pub created_at: String,
    pub updated_at: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub seen_at: Option<String>,
    pub archived: bool,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub archived_at: Option<String>,
    /// Bounded, whitespace-collapsed preview of the exact initial user message.
    pub prompt_preview: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub branch: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub pull_request_url: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub referenced_pull_request_url: Option<String>,
    #[serde(default, flatten)]
    pub extra: ExtraFields,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ConversationsIndexResponse {
    pub conversations: Vec<ConversationIndexEntry>,
    #[serde(default, flatten)]
    pub extra: ExtraFields,
}

/// Local skill identity selected in a composer. Resolution happens at submission time.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ConversationSkillSelection {
    pub id: String,
}

/// Request for the first user turn and immutable conversation affinity.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CreateConversationInput {
    pub project_id: String,
    pub text: String,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub images: Vec<ImageInput>,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub skills: Vec<ConversationSkillSelection>,
    pub harness: Runner,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub model: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub reasoning: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub base_branch: Option<String>,
    pub worktree: bool,
    pub git_mode: ConversationGitMode,
}

/// Exact visible content for one ordinary follow-up turn.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SubmitConversationMessageInput {
    pub text: String,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub images: Vec<ImageInput>,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub skills: Vec<ConversationSkillSelection>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ConversationQuestionAnswer {
    pub question_id: String,
    pub values: Vec<String>,
}

/// Answers one exact provider-native request without creating another ordinary provider turn.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AnswerConversationQuestionInput {
    pub request_id: String,
    pub answers: Vec<ConversationQuestionAnswer>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CreateConversationResponse {
    pub conversation: ConversationRecord,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SubmitConversationMessageResponse {
    pub accepted: bool,
    pub turn: ConversationTurnSummary,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AnswerConversationQuestionResponse {
    pub accepted: bool,
    pub turn: ConversationTurnSummary,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CancelConversationTurnResponse {
    pub cancelled: bool,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub turn_id: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct ArchiveConversationResponse {
    pub archived: bool,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct UnarchiveConversationResponse {
    pub unarchived: bool,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DeleteConversationResponse {
    pub deleted: bool,
    pub worktree_removed: bool,
    pub branch_removed: bool,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub warnings: Vec<String>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct UpdateConversationGitModeInput {
    pub git_mode: ConversationGitMode,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct UpdateConversationGitModeResponse {
    pub updated: bool,
    pub git_mode: ConversationGitMode,
}

#[cfg(test)]
mod tests {
    use serde_json::{Value, json};

    use super::*;

    fn conversation_value() -> Value {
        json!({
            "recordKind": "conversation",
            "id": "chat-1",
            "projectId": "project-a",
            "title": "Fix login",
            "initialMessage": {
                "text": "Fix login",
                "images": [{"mediaType": "image/png", "data": "AQID"}],
                "skillAttachments": [{
                    "id": "skill-1",
                    "name": "testing",
                    "source": "agents",
                    "path": "/repo/.agents/skills/testing/SKILL.md",
                    "contentHash": "sha256:abc",
                    "futureSkillField": {"kept": true}
                }],
                "futureMessageField": [1, 2]
            },
            "harness": "codex",
            "model": "gpt-5.6",
            "reasoning": "max",
            "providerSessionId": "thread-1",
            "repositoryRoot": "/repo",
            "cwd": "/repo/.ai/coducktor/worktrees/chat-1",
            "baseBranch": "main",
            "branch": "duck/task-chat-1",
            "worktree": true,
            "worktreePath": "/repo/.ai/coducktor/worktrees/chat-1",
            "gitMode": "manual",
            "state": "running",
            "activeTurn": {
                "id": "turn-1",
                "state": "running",
                "submittedAt": "2026-08-22T12:00:00.000Z",
                "futureTurnField": "kept"
            },
            "latestTurn": {
                "id": "turn-1",
                "state": "running",
                "submittedAt": "2026-08-22T12:00:00.000Z"
            },
            "createdAt": "2026-08-22T12:00:00.000Z",
            "updatedAt": "2026-08-22T12:00:01.000Z",
            "archived": false,
            "tokensUsed": 0.0,
            "workflow": "conversation",
            "task": "Fix login",
            "steps": [],
            "futureRecordField": {"kept": true}
        })
    }

    #[test]
    fn conversation_records_round_trip_unknown_top_level_and_nested_fields() {
        let original = conversation_value();
        let record: ConversationRecord = serde_json::from_value(original.clone()).unwrap();

        assert_eq!(record.record_kind, RecordKind::Conversation);
        assert_eq!(record.reasoning.as_deref(), Some("max"));
        assert_eq!(serde_json::to_value(record).unwrap(), original);
    }

    #[test]
    fn legacy_records_cannot_be_misread_as_conversations() {
        let legacy = json!({
            "id": "run-1",
            "title": "Old task",
            "workflow": "quick-task",
            "task": "Do work",
            "status": "done",
            "createdAt": "2026-08-22T12:00:00.000Z",
            "tokensUsed": 0,
            "archived": false,
            "steps": []
        });

        assert!(serde_json::from_value::<ConversationRecord>(legacy).is_err());
    }

    #[test]
    fn harness_is_concrete_and_reasoning_is_provider_native() {
        let valid: CreateConversationInput = serde_json::from_value(json!({
            "projectId": "project-a",
            "text": "Investigate",
            "harness": "opencode",
            "reasoning": "provider-specific-ultra",
            "worktree": true,
            "gitMode": "manual"
        }))
        .unwrap();
        assert_eq!(valid.harness, Runner::OpenCode);
        assert_eq!(valid.reasoning.as_deref(), Some("provider-specific-ultra"));

        let auto = json!({
            "projectId": "project-a",
            "text": "Investigate",
            "harness": "auto",
            "worktree": true,
            "gitMode": "manual"
        });
        assert!(serde_json::from_value::<CreateConversationInput>(auto).is_err());
    }

    #[test]
    fn only_live_conversation_and_turn_states_are_active() {
        assert!(!ConversationState::Idle.is_active());
        assert!(ConversationState::Queued.is_active());
        assert!(ConversationState::Running.is_active());
        assert!(ConversationState::NeedsInput.is_active());
        assert!(!ConversationState::Failed.is_active());
        assert!(!ConversationState::Cancelled.is_active());

        assert!(TurnState::Queued.is_active());
        assert!(TurnState::Running.is_active());
        assert!(TurnState::NeedsInput.is_active());
        assert!(!TurnState::Ended.is_active());
        assert!(!TurnState::Failed.is_active());
        assert!(!TurnState::Cancelled.is_active());
    }
}
