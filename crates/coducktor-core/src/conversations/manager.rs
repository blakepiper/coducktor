use std::collections::{BTreeMap, HashMap, VecDeque};
use std::io;
use std::path::PathBuf;
use std::sync::atomic::{AtomicU64, Ordering};

use coducktor_contract::{
    ConversationGitMode, ConversationMessage, ConversationQuestionAnswer, ConversationRecord,
    ConversationSessionRestart, ConversationSkillAttachment, ConversationState,
    ConversationTurnSummary, ImageInput, RecordKind, RunEvent, RunStatus, Runner, TurnState,
};
use serde_json::{Map, Value};

use super::events::{self, ConversationEventAppender};
use super::lifecycle::{
    ConversationEventInput, ConversationSession, ConversationTurnRequest, PendingRequest,
    TurnCancellation, TurnOutcome, TurnReport,
};
use super::persistence::{self, StoredRecord};
use super::restart;
use crate::runs::store;
use crate::time::now_iso8601;

const INTERRUPTED_ERROR: &str = "interrupted — coducktor exited during the provider turn";
const LOST_QUESTION_ERROR: &str =
    "interrupted — the provider question can no longer be answered after restart";

/// Fully resolved placement and immutable affinity for a newly created conversation.
#[derive(Debug, Clone, PartialEq)]
pub struct NewConversation {
    pub project_id: String,
    pub text: String,
    pub images: Vec<ImageInput>,
    pub skill_attachments: Vec<ConversationSkillAttachment>,
    pub harness: Runner,
    pub model: Option<String>,
    pub reasoning: Option<String>,
    pub repository_root: PathBuf,
    pub cwd: PathBuf,
    pub base_branch: Option<String>,
    pub branch: Option<String>,
    pub worktree: bool,
    pub worktree_path: Option<PathBuf>,
    pub git_mode: ConversationGitMode,
}

/// One FIFO-admitted ordinary turn. Provider calls happen while this value is outside the manager.
pub struct AdmittedConversationTurn {
    pub request: ConversationTurnRequest,
    session: Option<Box<dyn ConversationSession + Send>>,
}

impl AdmittedConversationTurn {
    pub fn has_live_session(&self) -> bool {
        self.session.is_some()
    }

    pub fn attach_session(&mut self, session: Box<dyn ConversationSession + Send>) {
        self.session = Some(session);
    }

    pub fn session_mut(&mut self) -> Option<&mut (dyn ConversationSession + Send + 'static)> {
        self.session.as_deref_mut()
    }
}

/// Detached native-question answer. Calling `session.answer` is the caller's responsibility.
pub struct PendingConversationAnswer {
    pub conversation_id: String,
    pub turn_id: String,
    pub request_id: String,
    pub answers: Vec<ConversationQuestionAnswer>,
    session: Box<dyn ConversationSession + Send>,
    cancellation: TurnCancellation,
}

impl PendingConversationAnswer {
    pub fn session_mut(&mut self) -> &mut (dyn ConversationSession + Send + 'static) {
        self.session.as_mut()
    }

    pub fn cancellation(&self) -> TurnCancellation {
        self.cancellation.clone()
    }
}

/// Immediate cancellation result. A parked session is returned so the caller can cancel it
/// without holding whichever mutex owns the manager.
pub struct ConversationCancellation {
    pub cancelled: bool,
    pub session_to_cancel: Option<Box<dyn ConversationSession + Send>>,
}

/// The outcome of an explicit provider-session restart. Any session still parked for this
/// conversation is handed back for the caller to tear down outside the manager's mutex — the
/// point of a restart is that nothing of the old session survives it.
pub struct ConversationSessionRestarted {
    pub record: ConversationRecord,
    pub session_to_cancel: Option<Box<dyn ConversationSession + Send>>,
}

struct ParkedSession {
    session: Box<dyn ConversationSession + Send>,
    pending_request: Option<PendingRequest>,
}

/// The history entry delivered to an in-process conversation event observer.
#[derive(Debug, Clone, PartialEq)]
pub struct ConversationEventNotification {
    pub conversation_id: String,
    pub event: RunEvent,
}

pub type ConversationObserverId = u64;
type ConversationEventObservers =
    BTreeMap<ConversationObserverId, Box<dyn Fn(&ConversationEventNotification) + Send + Sync>>;
type ConversationRecordObservers =
    BTreeMap<ConversationObserverId, Box<dyn Fn(&ConversationRecord) + Send + Sync>>;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct ConversationManagerOptions {
    pub max_parallel: usize,
}

impl Default for ConversationManagerOptions {
    fn default() -> Self {
        Self { max_parallel: 2 }
    }
}

/// Durable conversation lifecycle with split-phase provider calls and FIFO admission.
pub struct ConversationManager {
    data_dir: PathBuf,
    conversations: BTreeMap<String, ConversationRecord>,
    legacy: Vec<StoredRecord>,
    queue: VecDeque<ConversationTurnRequest>,
    parked: HashMap<String, ParkedSession>,
    in_flight: HashMap<String, TurnCancellation>,
    seqs: HashMap<String, f64>,
    appenders: HashMap<String, ConversationEventAppender>,
    options: ConversationManagerOptions,
    write_quarantined: bool,
    warnings: Vec<String>,
    event_observers: ConversationEventObservers,
    record_observers: ConversationRecordObservers,
    next_observer_id: ConversationObserverId,
}

impl ConversationManager {
    pub fn open(data_dir: impl Into<PathBuf>) -> Self {
        Self::open_with_options(data_dir, ConversationManagerOptions::default())
    }

    pub fn open_with_options(
        data_dir: impl Into<PathBuf>,
        mut options: ConversationManagerOptions,
    ) -> Self {
        options.max_parallel = options.max_parallel.max(1);
        let data_dir = data_dir.into();
        let load = persistence::load_mixed_index(&store::index_path(&data_dir), true);
        let write_quarantined = load.write_quarantined();
        let mut conversations = BTreeMap::new();
        let mut legacy = Vec::new();
        let mut legacy_changed = false;
        for record in load.records().iter().cloned() {
            match record {
                StoredRecord::Conversation(record) => {
                    conversations.entry(record.id.clone()).or_insert(*record);
                }
                StoredRecord::Legacy(record) => {
                    let settle = matches!(
                        record.status,
                        RunStatus::Queued | RunStatus::Running | RunStatus::Waiting
                    );
                    let record = store::reconcile_loaded_run(*record, !settle);
                    legacy_changed |= settle;
                    legacy.push(StoredRecord::Legacy(Box::new(record)));
                }
            }
        }
        let mut manager = Self {
            data_dir,
            conversations,
            legacy,
            queue: VecDeque::new(),
            parked: HashMap::new(),
            in_flight: HashMap::new(),
            seqs: HashMap::new(),
            appenders: HashMap::new(),
            options,
            write_quarantined,
            warnings: Vec::new(),
            event_observers: BTreeMap::new(),
            record_observers: BTreeMap::new(),
            next_observer_id: 0,
        };
        manager.recover_startup(legacy_changed);
        manager
    }

    pub fn is_write_quarantined(&self) -> bool {
        self.write_quarantined
    }

    pub fn warnings(&self) -> &[String] {
        &self.warnings
    }

    pub fn get(&self, conversation_id: &str) -> Option<&ConversationRecord> {
        self.conversations.get(conversation_id)
    }

    pub fn list(&self) -> Vec<&ConversationRecord> {
        let mut records = self.conversations.values().collect::<Vec<_>>();
        records.sort_by(|left, right| right.updated_at.cmp(&left.updated_at));
        records
    }

    pub fn queued_count(&self) -> usize {
        self.queue.len()
    }

    pub fn active_provider_calls(&self) -> usize {
        self.in_flight.len()
    }

    pub fn create(&mut self, input: NewConversation) -> io::Result<ConversationRecord> {
        self.ensure_writable()?;
        if input.text.trim().is_empty() && input.images.is_empty() {
            return Err(io::Error::new(
                io::ErrorKind::InvalidInput,
                "a conversation requires text or an image",
            ));
        }
        if input.git_mode == ConversationGitMode::Auto && !input.worktree {
            return Err(io::Error::new(
                io::ErrorKind::InvalidInput,
                "automatic Git mode requires a managed worktree",
            ));
        }

        let conversation_id = new_id("chat");
        let turn_id = new_id("turn");
        let now = now_iso8601();
        let message = ConversationMessage {
            text: input.text.clone(),
            images: input.images.clone(),
            skill_attachments: input.skill_attachments.clone(),
            extra: Map::new(),
        };
        let turn = ConversationTurnSummary {
            id: turn_id.clone(),
            state: TurnState::Queued,
            submitted_at: now.clone(),
            started_at: None,
            finished_at: None,
            pending_request_id: None,
            error: None,
            tokens_used: None,
            cost_usd: None,
            extra: Map::new(),
        };
        let record = ConversationRecord {
            record_kind: RecordKind::Conversation,
            id: conversation_id.clone(),
            project_id: input.project_id,
            title: deterministic_title(&input.text),
            initial_message: message.clone(),
            harness: input.harness,
            model: input.model,
            reasoning: input.reasoning,
            provider_session_id: None,
            repository_root: input.repository_root.to_string_lossy().into_owned(),
            cwd: input.cwd.to_string_lossy().into_owned(),
            base_branch: input.base_branch,
            branch: input.branch,
            worktree: input.worktree,
            worktree_path: input
                .worktree_path
                .map(|path| path.to_string_lossy().into_owned()),
            worktree_reclaimed_at: None,
            git_mode: input.git_mode,
            state: ConversationState::Queued,
            active_turn: Some(turn.clone()),
            latest_turn: Some(turn),
            created_at: now.clone(),
            updated_at: now,
            seen_at: None,
            archived: false,
            archived_at: None,
            tokens_used: 0.0,
            input_tokens: None,
            output_tokens: None,
            cost_usd: None,
            last_error: None,
            resume_failed: false,
            session_restart: None,
            workflow: "conversation".to_owned(),
            task: input.text,
            steps: Vec::new(),
            extra: Map::new(),
        };
        self.conversations
            .insert(conversation_id.clone(), record.clone());
        let request = request_for(&record, &turn_id, &message, None);
        if let Err(error) = self.append_user_message(&conversation_id, &turn_id, &message) {
            self.conversations.remove(&conversation_id);
            return Err(error);
        }
        self.queue.push_back(request);
        if let Err(error) = self.persist() {
            self.queue
                .retain(|queued| queued.conversation_id != conversation_id);
            self.conversations.remove(&conversation_id);
            return Err(error);
        }
        self.notify_record(&record);
        Ok(record)
    }

    pub fn submit_message(
        &mut self,
        conversation_id: &str,
        message: ConversationMessage,
    ) -> io::Result<ConversationTurnSummary> {
        self.ensure_writable()?;
        if message.text.trim().is_empty() && message.images.is_empty() {
            return Err(io::Error::new(
                io::ErrorKind::InvalidInput,
                "a turn requires text or an image",
            ));
        }
        let previous = self
            .conversations
            .get(conversation_id)
            .cloned()
            .ok_or_else(|| io::Error::new(io::ErrorKind::NotFound, "conversation not found"))?;
        if previous.archived {
            return Err(io::Error::new(
                io::ErrorKind::InvalidInput,
                "an archived conversation cannot accept messages",
            ));
        }
        if previous.state.is_active() {
            return Err(io::Error::new(
                io::ErrorKind::WouldBlock,
                "the conversation already has an active turn",
            ));
        }
        let turn_id = new_id("turn");
        let now = now_iso8601();
        let turn = ConversationTurnSummary {
            id: turn_id.clone(),
            state: TurnState::Queued,
            submitted_at: now.clone(),
            started_at: None,
            finished_at: None,
            pending_request_id: None,
            error: None,
            tokens_used: None,
            cost_usd: None,
            extra: Map::new(),
        };
        let mut next = previous.clone();
        next.state = ConversationState::Queued;
        next.active_turn = Some(turn.clone());
        next.latest_turn = Some(turn.clone());
        next.updated_at = now;
        next.last_error = None;
        self.append_user_message(conversation_id, &turn_id, &message)?;
        let handoff = self.pending_session_handoff(&next);
        self.conversations
            .insert(conversation_id.to_owned(), next.clone());
        self.queue
            .push_back(request_for(&next, &turn_id, &message, handoff));
        if let Err(error) = self.persist() {
            self.queue.retain(|queued| queued.turn_id != turn_id);
            self.conversations
                .insert(conversation_id.to_owned(), previous);
            return Err(error);
        }
        self.notify_record(&next);
        Ok(turn)
    }

    /// Mark the oldest queued turn admitted before returning it to a provider worker.
    pub fn admit_next(&mut self) -> io::Result<Option<AdmittedConversationTurn>> {
        self.ensure_writable()?;
        if self.in_flight.len() >= self.options.max_parallel {
            return Ok(None);
        }
        while let Some(request) = self.queue.pop_front() {
            let Some(previous) = self.conversations.get(&request.conversation_id).cloned() else {
                continue;
            };
            if previous.state != ConversationState::Queued
                || previous.active_turn.as_ref().map(|turn| turn.id.as_str())
                    != Some(request.turn_id.as_str())
            {
                continue;
            }
            let mut next = previous.clone();
            let now = now_iso8601();
            next.state = ConversationState::Running;
            if let Some(turn) = next.active_turn.as_mut() {
                turn.state = TurnState::Running;
                turn.started_at = Some(now.clone());
            }
            next.latest_turn = next.active_turn.clone();
            next.updated_at = now;
            self.conversations
                .insert(request.conversation_id.clone(), next.clone());
            if let Err(error) = self.persist() {
                self.conversations
                    .insert(request.conversation_id.clone(), previous);
                self.queue.push_front(request);
                return Err(error);
            }
            self.notify_record(&next);
            self.in_flight.insert(
                request.conversation_id.clone(),
                request.cancellation.clone(),
            );
            self.append_history_event(
                &request.conversation_id,
                &request.turn_id,
                ConversationEventInput::new("turn.started"),
            )?;
            let parked = self.parked.remove(&request.conversation_id);
            return Ok(Some(AdmittedConversationTurn {
                request,
                session: parked.map(|parked| parked.session),
            }));
        }
        Ok(None)
    }

    pub fn apply_open_failure(
        &mut self,
        admitted: AdmittedConversationTurn,
        message: impl Into<String>,
    ) -> io::Result<ConversationRecord> {
        self.apply_turn_result(admitted, Err(message.into()))
    }

    pub fn apply_turn_result(
        &mut self,
        admitted: AdmittedConversationTurn,
        result: Result<TurnOutcome, String>,
    ) -> io::Result<ConversationRecord> {
        self.finish_provider_call(
            admitted.request.conversation_id,
            admitted.request.turn_id,
            admitted.request.cancellation,
            admitted.request.resume,
            admitted.session,
            result,
        )
    }

    pub fn apply_turn_event(
        &mut self,
        conversation_id: &str,
        turn_id: &str,
        input: ConversationEventInput,
    ) -> io::Result<RunEvent> {
        if !self.in_flight.contains_key(conversation_id) {
            return Err(io::Error::new(
                io::ErrorKind::NotFound,
                "conversation turn is not in flight",
            ));
        }
        self.append_history_event(conversation_id, turn_id, input)
    }

    pub fn begin_answer(
        &mut self,
        conversation_id: &str,
        request_id: &str,
        answers: Vec<ConversationQuestionAnswer>,
    ) -> io::Result<PendingConversationAnswer> {
        self.ensure_writable()?;
        let previous = self
            .conversations
            .get(conversation_id)
            .cloned()
            .ok_or_else(|| io::Error::new(io::ErrorKind::NotFound, "conversation not found"))?;
        if previous.state != ConversationState::NeedsInput {
            return Err(io::Error::new(
                io::ErrorKind::InvalidInput,
                "conversation does not need structured input",
            ));
        }
        let parked = self
            .parked
            .remove(conversation_id)
            .ok_or_else(|| io::Error::new(io::ErrorKind::NotFound, "pending session is missing"))?;
        if parked
            .pending_request
            .as_ref()
            .map(|pending| pending.request_id.as_str())
            != Some(request_id)
        {
            self.parked.insert(conversation_id.to_owned(), parked);
            return Err(io::Error::new(
                io::ErrorKind::InvalidInput,
                "pending request id does not match",
            ));
        }
        let turn_id = previous
            .active_turn
            .as_ref()
            .map(|turn| turn.id.clone())
            .ok_or_else(|| io::Error::new(io::ErrorKind::InvalidData, "active turn is missing"))?;
        let mut next = previous.clone();
        next.state = ConversationState::Running;
        if let Some(turn) = next.active_turn.as_mut() {
            turn.state = TurnState::Running;
            turn.pending_request_id = None;
        }
        next.latest_turn = next.active_turn.clone();
        next.updated_at = now_iso8601();
        self.conversations
            .insert(conversation_id.to_owned(), next.clone());
        if let Err(error) = self.persist() {
            self.conversations
                .insert(conversation_id.to_owned(), previous);
            self.parked.insert(conversation_id.to_owned(), parked);
            return Err(error);
        }
        self.notify_record(&next);
        self.append_history_event(
            conversation_id,
            &turn_id,
            ConversationEventInput::new("question.answered")
                .field("requestId", request_id)
                .field("answers", &answers),
        )?;
        let cancellation = TurnCancellation::default();
        self.in_flight
            .insert(conversation_id.to_owned(), cancellation.clone());
        Ok(PendingConversationAnswer {
            conversation_id: conversation_id.to_owned(),
            turn_id,
            request_id: request_id.to_owned(),
            answers,
            session: parked.session,
            cancellation,
        })
    }

    pub fn apply_answer_result(
        &mut self,
        pending: PendingConversationAnswer,
        result: Result<TurnOutcome, String>,
    ) -> io::Result<ConversationRecord> {
        // Answering continues a session that is already open, so this can never be a resume
        // failure however it ends.
        self.finish_provider_call(
            pending.conversation_id,
            pending.turn_id,
            pending.cancellation,
            false,
            Some(pending.session),
            result,
        )
    }

    pub fn cancel(&mut self, conversation_id: &str) -> io::Result<ConversationCancellation> {
        self.ensure_writable()?;
        let previous = match self.conversations.get(conversation_id).cloned() {
            Some(record) => record,
            None => {
                return Ok(ConversationCancellation {
                    cancelled: false,
                    session_to_cancel: None,
                });
            }
        };
        if !previous.state.is_active() {
            return Ok(ConversationCancellation {
                cancelled: false,
                session_to_cancel: None,
            });
        }
        let turn_id = previous
            .active_turn
            .as_ref()
            .map(|turn| turn.id.clone())
            .ok_or_else(|| io::Error::new(io::ErrorKind::InvalidData, "active turn is missing"))?;
        if let Some(token) = self.in_flight.get(conversation_id) {
            token.request();
        }
        self.queue
            .retain(|request| request.conversation_id != conversation_id);
        let parked = self.parked.remove(conversation_id);
        let mut next = previous.clone();
        next.state = ConversationState::Cancelled;
        next.active_turn = None;
        if let Some(turn) = next.latest_turn.as_mut() {
            turn.state = TurnState::Cancelled;
            turn.finished_at = Some(now_iso8601());
            turn.pending_request_id = None;
        }
        next.updated_at = now_iso8601();
        self.conversations
            .insert(conversation_id.to_owned(), next.clone());
        if let Err(error) = self.persist() {
            self.conversations
                .insert(conversation_id.to_owned(), previous);
            if let Some(parked) = parked {
                self.parked.insert(conversation_id.to_owned(), parked);
            }
            return Err(error);
        }
        self.notify_record(&next);
        self.append_history_event(
            conversation_id,
            &turn_id,
            ConversationEventInput::new("turn.cancelled"),
        )?;
        Ok(ConversationCancellation {
            cancelled: true,
            session_to_cancel: parked.map(|parked| parked.session),
        })
    }

    pub fn read_history(&self, conversation_id: &str) -> Vec<RunEvent> {
        events::read_history(&events::history_path(&self.data_dir, conversation_id))
    }

    /// Register an observer for appended history entries. The callback runs after the NDJSON
    /// append succeeds and receives an owned view, so it cannot alias manager state.
    pub fn subscribe_events<F>(&mut self, observer: F) -> ConversationObserverId
    where
        F: Fn(&ConversationEventNotification) + Send + Sync + 'static,
    {
        let id = self.next_observer_id();
        self.event_observers.insert(id, Box::new(observer));
        id
    }

    pub fn unsubscribe_events(&mut self, observer_id: ConversationObserverId) -> bool {
        self.event_observers.remove(&observer_id).is_some()
    }

    /// Register an observer for durable conversation record updates.
    pub fn subscribe_conversations<F>(&mut self, observer: F) -> ConversationObserverId
    where
        F: Fn(&ConversationRecord) + Send + Sync + 'static,
    {
        let id = self.next_observer_id();
        self.record_observers.insert(id, Box::new(observer));
        id
    }

    pub fn unsubscribe_conversations(&mut self, observer_id: ConversationObserverId) -> bool {
        self.record_observers.remove(&observer_id).is_some()
    }

    /// Archive or unarchive an idle conversation. An active turn is never torn down implicitly:
    /// the caller cancels first, so archiving can never orphan a live provider process.
    pub fn archive(
        &mut self,
        conversation_id: &str,
        archived: bool,
    ) -> io::Result<ConversationRecord> {
        self.mutate_idle(conversation_id, "be archived", |record| {
            record.archived = archived;
            record.archived_at = archived.then(now_iso8601);
            Ok(())
        })
    }

    /// Mark a conversation read or unread. Allowed while a turn is active because it records what
    /// the user has seen and never touches provider state.
    pub fn mark_seen(
        &mut self,
        conversation_id: &str,
        seen: bool,
    ) -> io::Result<ConversationRecord> {
        let previous = self.require(conversation_id)?;
        let mut next = previous.clone();
        next.seen_at = seen.then(now_iso8601);
        self.commit_record(previous, next)
    }

    /// Change the idle Git policy. Automatic mode is only truthful for a managed worktree, so the
    /// same rule that guards creation guards the update.
    pub fn set_git_mode(
        &mut self,
        conversation_id: &str,
        git_mode: ConversationGitMode,
    ) -> io::Result<ConversationRecord> {
        self.mutate_idle(conversation_id, "have its Git mode changed", |record| {
            if git_mode == ConversationGitMode::Auto && !record.worktree {
                return Err(io::Error::new(
                    io::ErrorKind::InvalidInput,
                    "automatic Git mode requires a managed worktree",
                ));
            }
            record.git_mode = git_mode;
            Ok(())
        })
    }

    /// Attach the result of one post-turn Git action to a conversation's history. Git runs after
    /// the provider turn has already settled, so this deliberately does not require an in-flight
    /// turn and never changes conversation state.
    pub fn record_git_activity(
        &mut self,
        conversation_id: &str,
        turn_id: &str,
        input: ConversationEventInput,
    ) -> io::Result<RunEvent> {
        self.append_history_event(conversation_id, turn_id, input)
    }

    /// Delete an idle conversation and its history. Returns false when the id is already absent so
    /// a repeated delete is not an error.
    pub fn delete(&mut self, conversation_id: &str) -> io::Result<bool> {
        self.ensure_writable()?;
        let Some(previous) = self.conversations.get(conversation_id).cloned() else {
            return Ok(false);
        };
        if previous.state.is_active() {
            return Err(io::Error::new(
                io::ErrorKind::WouldBlock,
                "an active conversation cannot be deleted",
            ));
        }
        self.conversations.remove(conversation_id);
        if let Err(error) = self.persist() {
            self.conversations
                .insert(conversation_id.to_owned(), previous);
            return Err(error);
        }
        self.queue
            .retain(|request| request.conversation_id != conversation_id);
        self.parked.remove(conversation_id);
        self.appenders.remove(conversation_id);
        self.seqs.remove(conversation_id);
        // History is best-effort: the index no longer references the file, so a failed unlink
        // leaves an unreachable transcript rather than a half-deleted conversation.
        let _ = std::fs::remove_file(events::history_path(&self.data_dir, conversation_id));
        Ok(true)
    }

    /// Record the managed worktree a queued conversation was placed in. Placement is resolved
    /// before the first turn is admitted, so this also repoints the queued request's cwd — the
    /// provider must never be opened against the repository root a worktree replaced.
    pub fn place_worktree(
        &mut self,
        conversation_id: &str,
        worktree_path: &std::path::Path,
        branch: &str,
        base_branch: &str,
    ) -> io::Result<ConversationRecord> {
        self.ensure_writable()?;
        let previous = self.require(conversation_id)?;
        let mut next = previous.clone();
        next.worktree = true;
        next.worktree_path = Some(worktree_path.to_string_lossy().into_owned());
        next.branch = Some(branch.to_owned());
        next.base_branch = Some(base_branch.to_owned());
        next.cwd = worktree_path.to_string_lossy().into_owned();
        next.worktree_reclaimed_at = None;
        let placed = self.commit_record(previous, next)?;
        for request in self.queue.iter_mut() {
            if request.conversation_id == conversation_id {
                request.cwd = worktree_path.to_path_buf();
            }
        }
        Ok(placed)
    }

    /// Record that an archived conversation's checkout was reclaimed. The transcript, record, and
    /// managed branch are untouched — only the directory is gone, and unarchiving rebuilds it.
    pub fn mark_worktree_reclaimed(
        &mut self,
        conversation_id: &str,
        reclaimed_at: String,
    ) -> io::Result<ConversationRecord> {
        let previous = self.require(conversation_id)?;
        let mut next = previous.clone();
        next.worktree_reclaimed_at = Some(reclaimed_at);
        self.commit_record(previous, next)
    }

    /// Abandon a provider session the harness refused to resume, and prepare the bounded handoff
    /// the user's next message will carry into a fresh one.
    ///
    /// Only reachable after a resumed turn actually failed, and only when the user asks. Nothing
    /// is sent here: this clears the session affinity and records the boundary, and the next
    /// ordinary submission is what opens the new session. That keeps the one-message/one-turn
    /// invariant intact — a restart costs no provider turn of its own.
    pub fn restart_session(
        &mut self,
        conversation_id: &str,
    ) -> io::Result<ConversationSessionRestarted> {
        self.ensure_writable()?;
        let previous = self.require(conversation_id)?;
        if previous.state.is_active() {
            return Err(io::Error::new(
                io::ErrorKind::WouldBlock,
                "an active conversation cannot have its provider session restarted",
            ));
        }
        if !previous.resume_failed {
            return Err(io::Error::new(
                io::ErrorKind::InvalidInput,
                "the provider session can only be restarted after a failed native resume",
            ));
        }
        let history = self.read_history(conversation_id);
        let boundary_seq = history.iter().map(|event| event.seq).fold(0.0, f64::max);
        let handoff = restart::build_session_handoff(&history, boundary_seq);
        let restart_record = ConversationSessionRestart {
            restarted_at: now_iso8601(),
            previous_session_id: previous.provider_session_id.clone(),
            new_session_id: None,
            handoff_boundary_seq: boundary_seq,
            handoff_messages: handoff
                .as_ref()
                .map(|handoff| handoff.messages)
                .unwrap_or(0),
            handoff_bytes: handoff.as_ref().map(|handoff| handoff.bytes).unwrap_or(0),
            handoff_truncated: handoff.as_ref().is_some_and(|handoff| handoff.truncated),
            extra: Default::default(),
        };
        let turn_id = previous
            .latest_turn
            .as_ref()
            .map(|turn| turn.id.clone())
            .unwrap_or_default();
        let mut next = previous.clone();
        next.provider_session_id = None;
        next.resume_failed = false;
        next.session_restart = Some(restart_record.clone());
        let committed = self.commit_record(previous, next)?;
        let session_to_cancel = self
            .parked
            .remove(conversation_id)
            .map(|parked| parked.session);
        self.append_history_event(
            conversation_id,
            &turn_id,
            ConversationEventInput::new("session.restarted")
                .field("previousSessionId", &restart_record.previous_session_id)
                .field("handoffBoundarySeq", restart_record.handoff_boundary_seq)
                .field("handoffMessages", restart_record.handoff_messages)
                .field("handoffBytes", restart_record.handoff_bytes)
                .field("handoffTruncated", restart_record.handoff_truncated),
        )?;
        Ok(ConversationSessionRestarted {
            record: committed,
            session_to_cancel,
        })
    }

    /// Rebuild the handoff a restarted conversation still owes its provider, or `None` when
    /// there is no undelivered restart. Rebuilt from the recorded boundary rather than stored as
    /// text, so what is replayed is always exactly what the boundary describes.
    fn pending_session_handoff(&self, record: &ConversationRecord) -> Option<String> {
        let restart_record = record.session_restart.as_ref()?;
        if restart_record.new_session_id.is_some() {
            return None;
        }
        let history = self.read_history(&record.id);
        restart::build_session_handoff(&history, restart_record.handoff_boundary_seq)
            .map(|handoff| handoff.text)
    }

    /// Signal every in-flight turn's cancellation token without touching durable state. Used at
    /// shutdown: the records stay `running` on disk so startup recovery reports them as
    /// interrupted rather than silently repeating a message the user already paid for.
    pub fn request_shutdown(&self) {
        for cancellation in self.in_flight.values() {
            cancellation.request();
        }
    }

    /// Hand back every parked provider session so the caller can close them outside whichever
    /// mutex owns this manager.
    ///
    /// A parked session is a live child process. Nothing else takes it: an idle conversation
    /// keeps its session precisely so the next message can reuse it, so shutdown is the only
    /// point at which they must all go.
    pub fn take_parked_sessions(&mut self) -> Vec<Box<dyn ConversationSession + Send>> {
        std::mem::take(&mut self.parked)
            .into_values()
            .map(|parked| parked.session)
            .collect()
    }

    fn require(&self, conversation_id: &str) -> io::Result<ConversationRecord> {
        self.conversations
            .get(conversation_id)
            .cloned()
            .ok_or_else(|| io::Error::new(io::ErrorKind::NotFound, "conversation not found"))
    }

    /// Apply one durable field change that is only meaningful between turns. `action` completes
    /// the sentence "an active conversation cannot ...".
    fn mutate_idle(
        &mut self,
        conversation_id: &str,
        action: &str,
        apply: impl FnOnce(&mut ConversationRecord) -> io::Result<()>,
    ) -> io::Result<ConversationRecord> {
        self.ensure_writable()?;
        let previous = self.require(conversation_id)?;
        if previous.state.is_active() {
            return Err(io::Error::new(
                io::ErrorKind::WouldBlock,
                format!("an active conversation cannot {action}"),
            ));
        }
        let mut next = previous.clone();
        apply(&mut next)?;
        self.commit_record(previous, next)
    }

    /// Persist one replaced record, restoring the previous value when the index write fails.
    fn commit_record(
        &mut self,
        previous: ConversationRecord,
        mut next: ConversationRecord,
    ) -> io::Result<ConversationRecord> {
        self.ensure_writable()?;
        next.updated_at = now_iso8601();
        let conversation_id = next.id.clone();
        self.conversations
            .insert(conversation_id.clone(), next.clone());
        if let Err(error) = self.persist() {
            self.conversations.insert(conversation_id, previous);
            return Err(error);
        }
        self.notify_record(&next);
        Ok(next)
    }

    fn next_observer_id(&mut self) -> ConversationObserverId {
        self.next_observer_id = self.next_observer_id.wrapping_add(1);
        self.next_observer_id
    }

    fn notify_record(&self, record: &ConversationRecord) {
        for observer in self.record_observers.values() {
            observer(record);
        }
    }

    fn notify_event(&self, notification: &ConversationEventNotification) {
        for observer in self.event_observers.values() {
            observer(notification);
        }
    }

    fn finish_provider_call(
        &mut self,
        conversation_id: String,
        turn_id: String,
        cancellation: TurnCancellation,
        resumed: bool,
        mut session: Option<Box<dyn ConversationSession + Send>>,
        result: Result<TurnOutcome, String>,
    ) -> io::Result<ConversationRecord> {
        self.in_flight.remove(&conversation_id);
        cancellation.deactivate();
        let previous = self
            .conversations
            .get(&conversation_id)
            .cloned()
            .ok_or_else(|| io::Error::new(io::ErrorKind::NotFound, "conversation not found"))?;
        if previous.state == ConversationState::Cancelled {
            return Ok(previous);
        }
        let outcome = result.unwrap_or_else(|message| TurnOutcome::Failed {
            message,
            report: TurnReport::default(),
            session_open: false,
        });
        let session_id = outcome_report(&outcome)
            .provider_session_id
            .clone()
            .or_else(|| {
                session
                    .as_ref()
                    .and_then(|session| session.provider_session_id())
            });
        let now = now_iso8601();
        let mut next = previous.clone();
        let mut turn = next
            .active_turn
            .clone()
            .or_else(|| next.latest_turn.clone())
            .ok_or_else(|| io::Error::new(io::ErrorKind::InvalidData, "turn summary is missing"))?;
        if turn.id != turn_id {
            return Err(io::Error::new(
                io::ErrorKind::InvalidData,
                "provider result belongs to a different turn",
            ));
        }
        apply_usage(&mut next, &mut turn, outcome_report(&outcome));
        next.provider_session_id = session_id;
        next.updated_at = now.clone();

        let (event, park) = match outcome {
            TurnOutcome::Ended {
                session_open,
                report: _,
            } => {
                turn.state = TurnState::Ended;
                turn.finished_at = Some(now);
                turn.pending_request_id = None;
                next.state = ConversationState::Idle;
                next.active_turn = None;
                next.last_error = None;
                next.resume_failed = false;
                // A normally ended turn is what proves the new session took: from here the
                // handoff has been delivered and is never replayed again.
                if let Some(restart_record) = next.session_restart.as_mut()
                    && restart_record.new_session_id.is_none()
                {
                    restart_record.new_session_id = next.provider_session_id.clone();
                }
                (
                    ConversationEventInput::new("turn.completed"),
                    session_open.then_some(None),
                )
            }
            TurnOutcome::NeedsInput {
                pending_request,
                report: _,
            } => {
                turn.state = TurnState::NeedsInput;
                turn.pending_request_id = Some(pending_request.request_id.clone());
                next.state = ConversationState::NeedsInput;
                next.active_turn = Some(turn.clone());
                next.last_error = None;
                (
                    ConversationEventInput::new("question.requested")
                        .field("request", &pending_request),
                    Some(Some(pending_request)),
                )
            }
            TurnOutcome::Failed {
                message,
                session_open,
                report: _,
            } => {
                turn.state = TurnState::Failed;
                turn.finished_at = Some(now);
                turn.pending_request_id = None;
                turn.error = Some(message.clone());
                next.state = ConversationState::Failed;
                next.active_turn = None;
                next.last_error = Some(message.clone());
                // The harness was asked to rejoin its own session and could not. That is the
                // only thing that offers a session restart; an ordinary failure never does.
                next.resume_failed = resumed;
                (
                    ConversationEventInput::new("error").field("message", message),
                    session_open.then_some(None),
                )
            }
            TurnOutcome::Cancelled {
                session_open,
                report: _,
            } => {
                turn.state = TurnState::Cancelled;
                turn.finished_at = Some(now);
                turn.pending_request_id = None;
                next.state = ConversationState::Cancelled;
                next.active_turn = None;
                (
                    ConversationEventInput::new("turn.cancelled"),
                    session_open.then_some(None),
                )
            }
        };
        next.latest_turn = Some(turn);
        self.append_history_event(&conversation_id, &turn_id, event)?;
        self.conversations
            .insert(conversation_id.clone(), next.clone());
        if let Err(error) = self.persist() {
            self.conversations.insert(conversation_id.clone(), previous);
            return Err(error);
        }
        self.notify_record(&next);
        if let Some(pending_request) = park
            && let Some(session) = session.take()
        {
            self.parked.insert(
                conversation_id,
                ParkedSession {
                    session,
                    pending_request,
                },
            );
        }
        Ok(next)
    }

    fn append_user_message(
        &mut self,
        conversation_id: &str,
        turn_id: &str,
        message: &ConversationMessage,
    ) -> io::Result<RunEvent> {
        self.append_history_event(
            conversation_id,
            turn_id,
            ConversationEventInput::new("user-message")
                .field("text", &message.text)
                .field("images", &message.images)
                .field("skillAttachments", &message.skill_attachments),
        )
    }

    fn append_history_event(
        &mut self,
        conversation_id: &str,
        turn_id: &str,
        mut input: ConversationEventInput,
    ) -> io::Result<RunEvent> {
        if !self.conversations.contains_key(conversation_id) {
            return Err(io::Error::new(
                io::ErrorKind::NotFound,
                "conversation not found",
            ));
        }
        input
            .extra
            .entry("turnId".to_owned())
            .or_insert_with(|| Value::String(turn_id.to_owned()));
        let path = events::history_path(&self.data_dir, conversation_id);
        let seq = self
            .seqs
            .get(conversation_id)
            .copied()
            .unwrap_or_else(|| events::rehydrate_sequence(&path))
            + 1.0;
        let event = RunEvent {
            seq,
            ts: now_iso8601(),
            step_id: None,
            event_type: input.event_type,
            extra: input.extra,
        };
        if !self.appenders.contains_key(conversation_id) {
            self.appenders.insert(
                conversation_id.to_owned(),
                ConversationEventAppender::open(&path)?,
            );
        }
        self.appenders
            .get_mut(conversation_id)
            .ok_or_else(|| io::Error::other("conversation event appender unavailable"))?
            .append(&event)?;
        self.seqs.insert(conversation_id.to_owned(), seq);
        self.notify_event(&ConversationEventNotification {
            conversation_id: conversation_id.to_owned(),
            event: event.clone(),
        });
        Ok(event)
    }

    fn recover_startup(&mut self, legacy_changed: bool) {
        let ids = self.conversations.keys().cloned().collect::<Vec<_>>();
        let mut changed = legacy_changed;
        for conversation_id in ids {
            let Some(record) = self.conversations.get(&conversation_id).cloned() else {
                continue;
            };
            match record.state {
                ConversationState::Queued if !record.archived => {
                    if let Some(request) = self.recover_queued_request(&record) {
                        self.queue.push_back(request);
                    } else {
                        self.interrupt_record(&conversation_id, INTERRUPTED_ERROR);
                        changed = true;
                    }
                }
                ConversationState::Running => {
                    self.interrupt_record(&conversation_id, INTERRUPTED_ERROR);
                    changed = true;
                }
                ConversationState::NeedsInput => {
                    self.interrupt_record(&conversation_id, LOST_QUESTION_ERROR);
                    changed = true;
                }
                ConversationState::Queued => {
                    self.interrupt_record(&conversation_id, INTERRUPTED_ERROR);
                    changed = true;
                }
                ConversationState::Idle
                | ConversationState::Failed
                | ConversationState::Cancelled => {}
            }
        }
        if changed
            && !self.write_quarantined
            && let Err(error) = self.persist()
        {
            self.warnings
                .push(format!("failed to persist conversation recovery: {error}"));
        }
    }

    fn recover_queued_request(
        &self,
        record: &ConversationRecord,
    ) -> Option<ConversationTurnRequest> {
        let turn = record.active_turn.as_ref()?;
        if turn.state != TurnState::Queued {
            return None;
        }
        let history = self.read_history(&record.id);
        let event = history.iter().rev().find(|event| {
            event.event_type == "user-message"
                && event.extra.get("turnId").and_then(Value::as_str) == Some(turn.id.as_str())
        })?;
        let message = ConversationMessage {
            text: event.extra.get("text")?.as_str()?.to_owned(),
            images: serde_json::from_value(
                event
                    .extra
                    .get("images")
                    .cloned()
                    .unwrap_or_else(|| Value::Array(Vec::new())),
            )
            .ok()?,
            skill_attachments: serde_json::from_value(
                event
                    .extra
                    .get("skillAttachments")
                    .cloned()
                    .unwrap_or_else(|| Value::Array(Vec::new())),
            )
            .ok()?,
            extra: Map::new(),
        };
        Some(request_for(
            record,
            &turn.id,
            &message,
            self.pending_session_handoff(record),
        ))
    }

    fn interrupt_record(&mut self, conversation_id: &str, message: &str) {
        let Some(record) = self.conversations.get_mut(conversation_id) else {
            return;
        };
        let now = now_iso8601();
        record.state = ConversationState::Failed;
        record.last_error = Some(message.to_owned());
        record.updated_at = now.clone();
        if let Some(mut turn) = record.active_turn.take() {
            turn.state = TurnState::Failed;
            turn.finished_at = Some(now);
            turn.pending_request_id = None;
            turn.error = Some(message.to_owned());
            record.latest_turn = Some(turn);
        }
    }

    fn ensure_writable(&self) -> io::Result<()> {
        if self.write_quarantined {
            Err(io::Error::new(
                io::ErrorKind::InvalidData,
                "runs.json is quarantined because existing state could not be fully loaded",
            ))
        } else {
            Ok(())
        }
    }

    fn persist(&self) -> io::Result<()> {
        self.ensure_writable()?;
        let mut records = self.legacy.clone();
        records.extend(
            self.conversations
                .values()
                .cloned()
                .map(Box::new)
                .map(StoredRecord::Conversation),
        );
        persistence::write_mixed_index(&store::index_path(&self.data_dir), &records)
    }
}

fn request_for(
    record: &ConversationRecord,
    turn_id: &str,
    message: &ConversationMessage,
    session_handoff: Option<String>,
) -> ConversationTurnRequest {
    ConversationTurnRequest {
        conversation_id: record.id.clone(),
        turn_id: turn_id.to_owned(),
        user_text: message.text.clone(),
        images: message.images.clone(),
        skill_context: message.skill_attachments.clone(),
        harness: record.harness,
        model: record.model.clone(),
        reasoning: record.reasoning.clone(),
        provider_session_id: record.provider_session_id.clone(),
        resume: record.provider_session_id.is_some(),
        cwd: PathBuf::from(&record.cwd),
        additional_directories: Vec::new(),
        session_handoff,
        cancellation: TurnCancellation::default(),
    }
}

fn apply_usage(
    record: &mut ConversationRecord,
    turn: &mut ConversationTurnSummary,
    report: &TurnReport,
) {
    record.tokens_used += report.tokens_used;
    record.input_tokens = add_optional(record.input_tokens, report.input_tokens);
    record.output_tokens = add_optional(record.output_tokens, report.output_tokens);
    record.cost_usd = add_optional(record.cost_usd, report.cost_usd);
    turn.tokens_used = Some(report.tokens_used);
    turn.cost_usd = report.cost_usd;
}

fn add_optional(total: Option<f64>, addition: Option<f64>) -> Option<f64> {
    match (total, addition) {
        (Some(total), Some(addition)) => Some(total + addition),
        (None, Some(addition)) => Some(addition),
        (total, None) => total,
    }
}

fn outcome_report(outcome: &TurnOutcome) -> &TurnReport {
    match outcome {
        TurnOutcome::Ended { report, .. }
        | TurnOutcome::NeedsInput { report, .. }
        | TurnOutcome::Failed { report, .. }
        | TurnOutcome::Cancelled { report, .. } => report,
    }
}

fn deterministic_title(text: &str) -> String {
    let title = text
        .lines()
        .map(str::trim)
        .find(|line| !line.is_empty())
        .unwrap_or("New chat");
    let mut chars = title.chars();
    let bounded = chars.by_ref().take(80).collect::<String>();
    if chars.next().is_some() {
        format!("{bounded}…")
    } else {
        bounded
    }
}

fn new_id(prefix: &str) -> String {
    static COUNTER: AtomicU64 = AtomicU64::new(0);
    let count = COUNTER.fetch_add(1, Ordering::Relaxed);
    let nanos = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|duration| duration.as_nanos())
        .unwrap_or_default();
    format!("{prefix}-{nanos:x}-{count:x}")
}

#[cfg(test)]
mod tests {
    use std::collections::VecDeque;
    use std::fs;
    use std::sync::atomic::{AtomicBool, AtomicUsize};
    use std::sync::{Arc, Mutex};

    use coducktor_contract::ConversationQuestionAnswer;

    use super::super::git;
    use super::super::lifecycle::{
        ConversationSessionFactory, PendingQuestion, PendingRequest, TurnOutcome,
    };
    use super::*;

    #[derive(Default)]
    struct SessionCounts {
        opens: AtomicUsize,
        turns: AtomicUsize,
        answers: AtomicUsize,
        cancels: AtomicUsize,
        prompts: Mutex<Vec<String>>,
        cancelled_during_call: AtomicBool,
    }

    struct FakeFactory {
        counts: Arc<SessionCounts>,
        turn_outcomes: Arc<Mutex<VecDeque<TurnOutcome>>>,
        answer_outcomes: Arc<Mutex<VecDeque<TurnOutcome>>>,
    }

    impl FakeFactory {
        fn new(turn_outcomes: Vec<TurnOutcome>, answer_outcomes: Vec<TurnOutcome>) -> Self {
            Self {
                counts: Arc::new(SessionCounts::default()),
                turn_outcomes: Arc::new(Mutex::new(turn_outcomes.into_iter().collect())),
                answer_outcomes: Arc::new(Mutex::new(answer_outcomes.into_iter().collect())),
            }
        }
    }

    impl ConversationSessionFactory for FakeFactory {
        fn open(
            &self,
            _request: &ConversationTurnRequest,
        ) -> Result<Box<dyn ConversationSession + Send>, String> {
            self.counts.opens.fetch_add(1, Ordering::SeqCst);
            Ok(Box::new(FakeSession {
                counts: self.counts.clone(),
                turn_outcomes: self.turn_outcomes.clone(),
                answer_outcomes: self.answer_outcomes.clone(),
            }))
        }
    }

    struct FakeSession {
        counts: Arc<SessionCounts>,
        turn_outcomes: Arc<Mutex<VecDeque<TurnOutcome>>>,
        answer_outcomes: Arc<Mutex<VecDeque<TurnOutcome>>>,
    }

    impl ConversationSession for FakeSession {
        fn turn(
            &mut self,
            request: &ConversationTurnRequest,
            on_event: &mut dyn FnMut(ConversationEventInput) -> io::Result<()>,
        ) -> Result<TurnOutcome, String> {
            self.counts.turns.fetch_add(1, Ordering::SeqCst);
            self.counts
                .prompts
                .lock()
                .unwrap()
                .push(request.user_text.clone());
            on_event(ConversationEventInput::new("text").field("text", "provider text"))
                .map_err(|error| error.to_string())?;
            if request.cancellation.is_requested() {
                self.counts
                    .cancelled_during_call
                    .store(true, Ordering::SeqCst);
                return Ok(cancelled(true));
            }
            self.turn_outcomes
                .lock()
                .unwrap()
                .pop_front()
                .ok_or_else(|| "fake has no turn outcome".to_owned())
        }

        fn answer(
            &mut self,
            request_id: &str,
            _answers: &[ConversationQuestionAnswer],
            _cancellation: &TurnCancellation,
            _on_event: &mut dyn FnMut(ConversationEventInput) -> io::Result<()>,
        ) -> Result<TurnOutcome, String> {
            self.counts.answers.fetch_add(1, Ordering::SeqCst);
            assert_eq!(request_id, "request-1");
            self.answer_outcomes
                .lock()
                .unwrap()
                .pop_front()
                .ok_or_else(|| "fake has no answer outcome".to_owned())
        }

        fn cancel(&mut self) {
            self.counts.cancels.fetch_add(1, Ordering::SeqCst);
        }

        fn provider_session_id(&self) -> Option<String> {
            Some("session-1".to_owned())
        }
    }

    fn ended(session_open: bool) -> TurnOutcome {
        TurnOutcome::Ended {
            report: TurnReport {
                provider_session_id: Some("session-1".to_owned()),
                tokens_used: 5.0,
                input_tokens: Some(3.0),
                output_tokens: Some(2.0),
                cost_usd: Some(0.01),
                turn_text: "done".to_owned(),
            },
            session_open,
        }
    }

    fn cancelled(session_open: bool) -> TurnOutcome {
        TurnOutcome::Cancelled {
            report: TurnReport::default(),
            session_open,
        }
    }

    fn needs_input() -> TurnOutcome {
        TurnOutcome::NeedsInput {
            report: TurnReport {
                provider_session_id: Some("session-1".to_owned()),
                turn_text: "Choose a library".to_owned(),
                ..TurnReport::default()
            },
            pending_request: PendingRequest {
                request_id: "request-1".to_owned(),
                questions: vec![PendingQuestion {
                    id: "library".to_owned(),
                    prompt: "Which library?".to_owned(),
                    choices: vec!["Vitest".to_owned(), "Jest".to_owned()],
                    multiple: false,
                    allow_free_form: false,
                }],
            },
        }
    }

    fn new_conversation(text: &str) -> NewConversation {
        NewConversation {
            project_id: "project-a".to_owned(),
            text: text.to_owned(),
            images: Vec::new(),
            skill_attachments: Vec::new(),
            harness: Runner::Codex,
            model: Some("gpt-test".to_owned()),
            reasoning: Some("max".to_owned()),
            repository_root: PathBuf::from("/repo"),
            cwd: PathBuf::from("/repo/worktree"),
            base_branch: Some("main".to_owned()),
            branch: Some("duck/task-chat".to_owned()),
            worktree: true,
            worktree_path: Some(PathBuf::from("/repo/worktree")),
            git_mode: ConversationGitMode::Manual,
        }
    }

    fn drive_next(manager: &mut ConversationManager, factory: &FakeFactory) -> ConversationRecord {
        let mut admitted = manager.admit_next().unwrap().unwrap();
        if !admitted.has_live_session() {
            admitted.attach_session(factory.open(&admitted.request).unwrap());
        }
        let request = admitted.request.clone();
        let mut events = Vec::new();
        let outcome = admitted
            .session_mut()
            .unwrap()
            .turn(&request, &mut |event| {
                events.push(event);
                Ok(())
            });
        for event in events {
            manager
                .apply_turn_event(&request.conversation_id, &request.turn_id, event)
                .unwrap();
        }
        manager.apply_turn_result(admitted, outcome).unwrap()
    }

    #[test]
    fn two_user_messages_are_two_turn_calls_on_one_parked_session() {
        let dir = tempfile::tempdir().unwrap();
        let factory = FakeFactory::new(vec![ended(true), ended(true)], Vec::new());
        let mut manager = ConversationManager::open(dir.path());
        let created = manager
            .create(new_conversation("first exact message"))
            .unwrap();

        let first = drive_next(&mut manager, &factory);
        assert_eq!(first.state, ConversationState::Idle);
        assert_eq!(first.provider_session_id.as_deref(), Some("session-1"));
        manager
            .submit_message(
                &created.id,
                ConversationMessage {
                    text: "second exact message".to_owned(),
                    images: Vec::new(),
                    skill_attachments: Vec::new(),
                    extra: Map::new(),
                },
            )
            .unwrap();
        let second = drive_next(&mut manager, &factory);

        assert_eq!(second.state, ConversationState::Idle);
        assert_eq!(second.tokens_used, 10.0);
        assert_eq!(factory.counts.opens.load(Ordering::SeqCst), 1);
        assert_eq!(factory.counts.turns.load(Ordering::SeqCst), 2);
        assert_eq!(
            factory.counts.prompts.lock().unwrap().as_slice(),
            ["first exact message", "second exact message"]
        );
        assert_eq!(
            manager
                .read_history(&created.id)
                .iter()
                .filter(|event| event.event_type == "user-message")
                .count(),
            2
        );
    }

    #[test]
    fn native_question_answer_continues_the_same_turn_without_an_ordinary_send() {
        let dir = tempfile::tempdir().unwrap();
        let factory = FakeFactory::new(vec![needs_input()], vec![ended(true)]);
        let mut manager = ConversationManager::open(dir.path());
        let created = manager
            .create(new_conversation("choose dependencies"))
            .unwrap();
        let waiting = drive_next(&mut manager, &factory);
        let original_turn_id = waiting.latest_turn.as_ref().unwrap().id.clone();
        assert_eq!(waiting.state, ConversationState::NeedsInput);

        let mut pending = manager
            .begin_answer(
                &created.id,
                "request-1",
                vec![ConversationQuestionAnswer {
                    question_id: "library".to_owned(),
                    values: vec!["Vitest".to_owned()],
                }],
            )
            .unwrap();
        let request_id = pending.request_id.clone();
        let answers = pending.answers.clone();
        let cancellation = pending.cancellation();
        let result =
            pending
                .session_mut()
                .answer(&request_id, &answers, &cancellation, &mut |_| Ok(()));
        let ended = manager.apply_answer_result(pending, result).unwrap();

        assert_eq!(ended.state, ConversationState::Idle);
        assert_eq!(ended.latest_turn.as_ref().unwrap().id, original_turn_id);
        assert_eq!(factory.counts.opens.load(Ordering::SeqCst), 1);
        assert_eq!(factory.counts.turns.load(Ordering::SeqCst), 1);
        assert_eq!(factory.counts.answers.load(Ordering::SeqCst), 1);
        assert_eq!(
            manager
                .read_history(&created.id)
                .iter()
                .filter(|event| event.event_type == "user-message")
                .count(),
            1
        );
    }

    #[test]
    fn queued_cancellation_never_opens_or_calls_a_provider() {
        let dir = tempfile::tempdir().unwrap();
        let factory = FakeFactory::new(Vec::new(), Vec::new());
        let mut manager = ConversationManager::open(dir.path());
        let created = manager
            .create(new_conversation("cancel before admission"))
            .unwrap();

        let cancelled = manager.cancel(&created.id).unwrap();

        assert!(cancelled.cancelled);
        assert!(cancelled.session_to_cancel.is_none());
        assert!(manager.admit_next().unwrap().is_none());
        assert_eq!(factory.counts.opens.load(Ordering::SeqCst), 0);
        assert_eq!(factory.counts.turns.load(Ordering::SeqCst), 0);
        assert_eq!(
            manager.get(&created.id).unwrap().state,
            ConversationState::Cancelled
        );
    }

    #[test]
    fn parked_question_cancellation_returns_the_session_for_out_of_lock_teardown() {
        let dir = tempfile::tempdir().unwrap();
        let factory = FakeFactory::new(vec![needs_input()], Vec::new());
        let mut manager = ConversationManager::open(dir.path());
        let created = manager.create(new_conversation("ask then cancel")).unwrap();
        drive_next(&mut manager, &factory);

        let mut cancelled = manager.cancel(&created.id).unwrap();
        let mut session = cancelled.session_to_cancel.take().unwrap();
        session.cancel();

        assert!(cancelled.cancelled);
        assert_eq!(factory.counts.cancels.load(Ordering::SeqCst), 1);
        assert_eq!(
            manager.get(&created.id).unwrap().state,
            ConversationState::Cancelled
        );
    }

    #[test]
    fn fifo_admission_respects_the_bounded_provider_pool() {
        let dir = tempfile::tempdir().unwrap();
        let mut manager = ConversationManager::open_with_options(
            dir.path(),
            ConversationManagerOptions { max_parallel: 1 },
        );
        let first = manager.create(new_conversation("first queued")).unwrap();
        let second = manager.create(new_conversation("second queued")).unwrap();

        let admitted_first = manager.admit_next().unwrap().unwrap();

        assert_eq!(admitted_first.request.conversation_id, first.id);
        assert_eq!(manager.active_provider_calls(), 1);
        assert!(manager.admit_next().unwrap().is_none());
        manager
            .apply_turn_result(admitted_first, Ok(ended(false)))
            .unwrap();

        let admitted_second = manager.admit_next().unwrap().unwrap();
        assert_eq!(admitted_second.request.conversation_id, second.id);
    }

    #[test]
    fn running_cancellation_sets_the_worker_token_and_cannot_be_resurrected() {
        let dir = tempfile::tempdir().unwrap();
        let mut manager = ConversationManager::open(dir.path());
        let created = manager
            .create(new_conversation("cancel in flight"))
            .unwrap();
        let admitted = manager.admit_next().unwrap().unwrap();
        let cancellation = admitted.request.cancellation.clone();

        let cancelled = manager.cancel(&created.id).unwrap();

        assert!(cancelled.cancelled);
        assert!(cancellation.is_requested());
        assert_eq!(
            manager.get(&created.id).unwrap().state,
            ConversationState::Cancelled
        );
        let settled = manager
            .apply_turn_result(admitted, Ok(ended(true)))
            .unwrap();
        assert_eq!(settled.state, ConversationState::Cancelled);
        assert_eq!(manager.active_provider_calls(), 0);
    }

    #[test]
    fn queued_turn_recovers_but_an_admitted_turn_is_never_repeated() {
        let dir = tempfile::tempdir().unwrap();
        let queued_id = {
            let mut manager = ConversationManager::open(dir.path());
            manager
                .create(new_conversation("durable queued message"))
                .unwrap()
                .id
        };
        let mut recovered = ConversationManager::open(dir.path());
        assert_eq!(recovered.queued_count(), 1);
        let queued = recovered.admit_next().unwrap().unwrap();
        assert_eq!(queued.request.user_text, "durable queued message");
        assert_eq!(queued.request.conversation_id, queued_id);
        drop(queued);
        drop(recovered);

        let recovered_after_admission = ConversationManager::open(dir.path());
        assert_eq!(recovered_after_admission.queued_count(), 0);
        assert_eq!(
            recovered_after_admission.get(&queued_id).unwrap().state,
            ConversationState::Failed
        );
        assert_eq!(
            recovered_after_admission
                .get(&queued_id)
                .unwrap()
                .last_error
                .as_deref(),
            Some(INTERRUPTED_ERROR)
        );
    }

    #[test]
    fn lost_native_question_fails_on_restart_but_keeps_session_affinity() {
        let dir = tempfile::tempdir().unwrap();
        let factory = FakeFactory::new(vec![needs_input()], Vec::new());
        let conversation_id = {
            let mut manager = ConversationManager::open(dir.path());
            let created = manager
                .create(new_conversation("question before restart"))
                .unwrap();
            drive_next(&mut manager, &factory);
            created.id
        };

        let recovered = ConversationManager::open(dir.path());
        let record = recovered.get(&conversation_id).unwrap();

        assert_eq!(record.state, ConversationState::Failed);
        assert_eq!(record.last_error.as_deref(), Some(LOST_QUESTION_ERROR));
        assert_eq!(record.provider_session_id.as_deref(), Some("session-1"));
        assert!(
            recovered
                .read_history(&conversation_id)
                .iter()
                .any(|event| event.event_type == "question.requested")
        );
    }

    fn message(text: &str) -> ConversationMessage {
        ConversationMessage {
            text: text.to_owned(),
            images: Vec::new(),
            skill_attachments: Vec::new(),
            extra: Map::new(),
        }
    }

    fn failed(session_open: bool) -> TurnOutcome {
        TurnOutcome::Failed {
            message: "the provider refused to resume session-1".to_owned(),
            report: TurnReport::default(),
            session_open,
        }
    }

    /// The only path that offers a restart: a turn that asked the harness to rejoin its own
    /// session and could not. Nothing else may set it.
    #[test]
    fn only_a_failed_resume_offers_a_session_restart() {
        let dir = tempfile::tempdir().unwrap();
        let factory = FakeFactory::new(vec![failed(false), failed(false)], Vec::new());
        let mut manager = ConversationManager::open(dir.path());
        let created = manager.create(new_conversation("first")).unwrap();

        // The opening turn has no session to resume, so its failure is an ordinary one.
        let first = drive_next(&mut manager, &factory);
        assert_eq!(first.state, ConversationState::Failed);
        assert!(!first.resume_failed);
        assert!(
            manager.restart_session(&created.id).map(|_| ()).is_err(),
            "a restart must not be reachable without a failed resume"
        );

        // Give it a session to resume, then fail that.
        manager
            .conversations
            .get_mut(&created.id)
            .unwrap()
            .provider_session_id = Some("session-1".to_owned());
        manager
            .submit_message(&created.id, message("try again"))
            .unwrap();
        let second = drive_next(&mut manager, &factory);

        assert!(second.resume_failed);
    }

    #[test]
    fn a_restart_clears_session_affinity_and_costs_no_provider_turn() {
        let dir = tempfile::tempdir().unwrap();
        let factory = FakeFactory::new(vec![ended(true), failed(false), ended(true)], Vec::new());
        let mut manager = ConversationManager::open(dir.path());
        let created = manager
            .create(new_conversation("fix the login redirect"))
            .unwrap();
        drive_next(&mut manager, &factory);
        manager
            .submit_message(&created.id, message("now the logout"))
            .unwrap();
        let failed_resume = drive_next(&mut manager, &factory);
        assert!(failed_resume.resume_failed);
        let turns_before = factory.counts.turns.load(Ordering::SeqCst);

        let restarted = manager.restart_session(&created.id).unwrap().record;

        // Nothing was sent, and the affinity that could not be resumed is gone.
        assert_eq!(factory.counts.turns.load(Ordering::SeqCst), turns_before);
        assert!(restarted.provider_session_id.is_none());
        assert!(!restarted.resume_failed);
        let restart = restarted.session_restart.as_ref().expect("recorded");
        assert_eq!(restart.previous_session_id.as_deref(), Some("session-1"));
        assert!(restart.new_session_id.is_none());
        assert!(restart.handoff_messages > 0);
        assert!(restart.handoff_boundary_seq > 0.0);

        // The old and new session identities are both durable in the timeline.
        let restart_event = manager
            .read_history(&created.id)
            .into_iter()
            .find(|event| event.event_type == "session.restarted")
            .expect("the restart is recorded in history");
        assert_eq!(
            restart_event
                .extra
                .get("previousSessionId")
                .and_then(Value::as_str),
            Some("session-1")
        );

        // The next ordinary message opens a fresh session carrying the bounded handoff.
        manager
            .submit_message(&created.id, message("try once more"))
            .unwrap();
        let admitted = manager.admit_next().unwrap().unwrap();
        assert!(!admitted.request.resume);
        assert!(admitted.request.provider_session_id.is_none());
        let handoff = admitted
            .request
            .session_handoff
            .as_deref()
            .expect("the restarted turn carries the handoff");
        assert!(handoff.contains("fix the login redirect"));
        assert!(handoff.contains("provider text"));
        // The transcript still shows only what the user actually wrote.
        assert_eq!(admitted.request.user_text, "try once more");

        let after = manager
            .apply_turn_result(admitted, Ok(ended(true)))
            .unwrap();
        assert_eq!(
            after
                .session_restart
                .as_ref()
                .and_then(|restart| restart.new_session_id.as_deref()),
            Some("session-1"),
            "a normally ended turn records which session replaced the old one"
        );
    }

    /// The handoff is a one-shot repair, not a policy: once the new session has taken, ordinary
    /// resume is back in charge and nothing is replayed again.
    #[test]
    fn the_handoff_is_delivered_exactly_once() {
        let dir = tempfile::tempdir().unwrap();
        let factory = FakeFactory::new(
            vec![ended(true), failed(false), ended(true), ended(true)],
            Vec::new(),
        );
        let mut manager = ConversationManager::open(dir.path());
        let created = manager.create(new_conversation("first")).unwrap();
        drive_next(&mut manager, &factory);
        manager
            .submit_message(&created.id, message("second"))
            .unwrap();
        drive_next(&mut manager, &factory);
        manager.restart_session(&created.id).unwrap();

        manager
            .submit_message(&created.id, message("third"))
            .unwrap();
        let restarted_turn = manager.admit_next().unwrap().unwrap();
        assert!(restarted_turn.request.session_handoff.is_some());
        manager
            .apply_turn_result(restarted_turn, Ok(ended(true)))
            .unwrap();

        manager
            .submit_message(&created.id, message("fourth"))
            .unwrap();
        let ordinary_turn = manager.admit_next().unwrap().unwrap();

        assert!(ordinary_turn.request.session_handoff.is_none());
        assert!(ordinary_turn.request.resume);
    }

    #[test]
    fn a_restart_is_refused_while_a_turn_is_active() {
        let dir = tempfile::tempdir().unwrap();
        let factory = FakeFactory::new(vec![ended(true)], Vec::new());
        let mut manager = ConversationManager::open(dir.path());
        let created = manager.create(new_conversation("first")).unwrap();
        manager
            .conversations
            .get_mut(&created.id)
            .unwrap()
            .resume_failed = true;

        let Err(error) = manager.restart_session(&created.id) else {
            panic!("a restart must be refused while a turn is active");
        };

        assert_eq!(error.kind(), io::ErrorKind::WouldBlock);
        drive_next(&mut manager, &factory);
    }

    /// An idle conversation keeps its provider session parked so the next message can reuse it,
    /// which means nothing else will ever end it. Shutdown has to.
    #[test]
    fn shutdown_hands_back_every_parked_session_to_be_closed() {
        let dir = tempfile::tempdir().unwrap();
        let factory = FakeFactory::new(vec![ended(true), ended(true)], Vec::new());
        let mut manager = ConversationManager::open(dir.path());
        let first = manager.create(new_conversation("first")).unwrap();
        drive_next(&mut manager, &factory);
        let second = manager.create(new_conversation("second")).unwrap();
        drive_next(&mut manager, &factory);
        assert_eq!(
            manager.parked.len(),
            2,
            "both sessions are parked and alive"
        );

        let mut parked = manager.take_parked_sessions();

        assert_eq!(parked.len(), 2);
        assert!(manager.parked.is_empty());
        for session in parked.iter_mut() {
            session.cancel();
        }
        assert_eq!(factory.counts.cancels.load(Ordering::SeqCst), 2);
        // Taking the sessions is teardown, not a state change: both chats stay idle on disk.
        for id in [first.id, second.id] {
            assert_eq!(manager.get(&id).unwrap().state, ConversationState::Idle);
        }
    }

    /// "Restart" here is Coducktor's own process restarting, not a session restart: ordinary    /// "Restart" here is Coducktor's own process restarting, not a session restart: ordinary
    /// resume must still rejoin the provider's session with no transcript replay at all.
    #[test]
    fn a_process_restart_resumes_provider_affinity_without_replaying_transcript() {
        let dir = tempfile::tempdir().unwrap();
        let factory = FakeFactory::new(vec![ended(true)], Vec::new());
        let conversation_id = {
            let mut manager = ConversationManager::open(dir.path());
            let created = manager.create(new_conversation("first")).unwrap();
            drive_next(&mut manager, &factory);
            created.id
        };
        let mut recovered = ConversationManager::open(dir.path());
        recovered
            .submit_message(
                &conversation_id,
                ConversationMessage {
                    text: "after restart".to_owned(),
                    images: Vec::new(),
                    skill_attachments: Vec::new(),
                    extra: Map::new(),
                },
            )
            .unwrap();

        let admitted = recovered.admit_next().unwrap().unwrap();

        assert!(!admitted.has_live_session());
        assert!(admitted.request.resume);
        assert_eq!(
            admitted.request.provider_session_id.as_deref(),
            Some("session-1")
        );
        assert_eq!(admitted.request.user_text, "after restart");
    }

    #[test]
    fn idle_mutations_persist_and_notify_while_active_ones_are_refused() {
        let dir = tempfile::tempdir().unwrap();
        let factory = FakeFactory::new(vec![ended(true)], Vec::new());
        let mut manager = ConversationManager::open(dir.path());
        let seen = Arc::new(Mutex::new(Vec::new()));
        let observed = seen.clone();
        manager.subscribe_conversations(move |record| {
            if let Ok(mut seen) = observed.lock() {
                seen.push((record.id.clone(), record.state, record.archived));
            }
        });
        let created = manager.create(new_conversation("first")).unwrap();

        // Queued is an active state, so nothing that is only meaningful between turns applies.
        assert_eq!(
            manager.archive(&created.id, true).unwrap_err().kind(),
            io::ErrorKind::WouldBlock
        );
        assert_eq!(
            manager.delete(&created.id).unwrap_err().kind(),
            io::ErrorKind::WouldBlock
        );

        drive_next(&mut manager, &factory);
        let archived = manager.archive(&created.id, true).unwrap();
        assert!(archived.archived);
        assert!(archived.archived_at.is_some());
        assert!(
            manager
                .mark_seen(&created.id, true)
                .unwrap()
                .seen_at
                .is_some()
        );
        assert!(!manager.archive(&created.id, false).unwrap().archived);
        assert_eq!(
            manager
                .set_git_mode(&created.id, ConversationGitMode::Auto)
                .unwrap()
                .git_mode,
            ConversationGitMode::Auto
        );

        // Every change is durable, not just in-memory.
        let reopened = ConversationManager::open(dir.path());
        let stored = reopened.get(&created.id).unwrap();
        assert_eq!(stored.git_mode, ConversationGitMode::Auto);
        assert!(!stored.archived);
        assert!(stored.seen_at.is_some());
        let notified = seen.lock().unwrap().clone();
        assert!(
            notified
                .iter()
                .any(|(id, _, archived)| id == &created.id && *archived)
        );
    }

    #[test]
    fn automatic_git_mode_still_requires_a_managed_worktree_after_creation() {
        let dir = tempfile::tempdir().unwrap();
        let factory = FakeFactory::new(vec![ended(true)], Vec::new());
        let mut manager = ConversationManager::open(dir.path());
        let mut input = new_conversation("first");
        input.worktree = false;
        input.worktree_path = None;
        let created = manager.create(input).unwrap();
        drive_next(&mut manager, &factory);

        assert_eq!(
            manager
                .set_git_mode(&created.id, ConversationGitMode::Auto)
                .unwrap_err()
                .kind(),
            io::ErrorKind::InvalidInput
        );
        assert_eq!(
            manager.get(&created.id).unwrap().git_mode,
            ConversationGitMode::Manual
        );
    }

    #[test]
    fn deleting_an_idle_conversation_removes_its_record_and_history() {
        let dir = tempfile::tempdir().unwrap();
        let factory = FakeFactory::new(vec![ended(true)], Vec::new());
        let mut manager = ConversationManager::open(dir.path());
        let created = manager.create(new_conversation("first")).unwrap();
        drive_next(&mut manager, &factory);
        let history = events::history_path(dir.path(), &created.id);
        assert!(history.exists());

        assert!(manager.delete(&created.id).unwrap());

        assert!(manager.get(&created.id).is_none());
        assert!(!history.exists());
        // A repeated delete is not an error, and the removal survives a restart.
        assert!(!manager.delete(&created.id).unwrap());
        assert!(
            ConversationManager::open(dir.path())
                .get(&created.id)
                .is_none()
        );
    }

    #[test]
    fn post_turn_git_activity_attaches_to_history_without_an_in_flight_turn() {
        let dir = tempfile::tempdir().unwrap();
        let factory = FakeFactory::new(vec![ended(true)], Vec::new());
        let mut manager = ConversationManager::open(dir.path());
        let created = manager
            .create(new_conversation("Fix the login redirect"))
            .unwrap();
        let record = drive_next(&mut manager, &factory);
        let turn_id = record.latest_turn.as_ref().unwrap().id.clone();

        let event = manager
            .record_git_activity(
                &created.id,
                &turn_id,
                ConversationEventInput::new("git.committed").field(
                    "subject",
                    git::auto_commit_subject("Fix the login redirect"),
                ),
            )
            .unwrap();

        assert_eq!(event.event_type, "git.committed");
        assert_eq!(
            event.extra.get("subject").and_then(Value::as_str),
            Some("coducktor: Fix the login redirect")
        );
        assert_eq!(
            event.extra.get("turnId").and_then(Value::as_str),
            Some(turn_id.as_str())
        );
        // The conversation stays idle and Git costs no provider turn.
        assert_eq!(
            manager.get(&created.id).unwrap().state,
            ConversationState::Idle
        );
        assert_eq!(factory.counts.turns.load(Ordering::SeqCst), 1);
    }

    #[test]
    fn startup_settles_only_active_legacy_tasks_and_keeps_idle_history() {
        let dir = tempfile::tempdir().unwrap();
        let path = store::index_path(dir.path());
        let legacy = |id: &str, status: &str| {
            serde_json::json!({
                "id": id,
                "title": id,
                "workflow": "quick-task",
                "task": id,
                "status": status,
                "createdAt": "2026-08-22T12:00:00.000Z",
                "tokensUsed": 0,
                "archived": false,
                "steps": []
            })
        };
        fs::write(
            &path,
            serde_json::to_vec(&serde_json::json!([
                legacy("idle", "idle"),
                legacy("queued", "queued"),
                legacy("running", "running"),
                legacy("waiting", "waiting")
            ]))
            .unwrap(),
        )
        .unwrap();

        ConversationManager::open(dir.path());

        let loaded = persistence::load_mixed_index(&path, true);
        let statuses = loaded
            .records()
            .iter()
            .filter_map(StoredRecord::as_legacy)
            .map(|record| (record.id.as_str(), record.status))
            .collect::<BTreeMap<_, _>>();
        assert_eq!(statuses.get("idle"), Some(&RunStatus::Idle));
        assert_eq!(statuses.get("queued"), Some(&RunStatus::Failed));
        assert_eq!(statuses.get("running"), Some(&RunStatus::Failed));
        assert_eq!(statuses.get("waiting"), Some(&RunStatus::Failed));
    }
}
