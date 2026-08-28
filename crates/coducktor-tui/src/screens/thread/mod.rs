//! The task thread screen: the full run lifecycle, including actions, steps, plans, subagents,
//! questions, review, queued messages, auto-resume, and composition. Pure policies live in
//! `actions.rs` and `reducer.rs`; rendering helpers live in `widgets.rs`.
//!
//! The review panel exposes its actions without embedding a full diff. The composer sends text,
//! and the task Git tabs provide Changes, Files, and Commits navigation.

use std::path::PathBuf;
use std::time::{Duration, Instant};

pub mod actions;
pub mod presenters;
pub mod projection;
pub mod reducer;
mod widgets;

use coducktor_contract::{ApiRun, ImageInput, RunEvent, RunStatus};
use coducktor_protocol::UiItem;
use crossterm::event::{KeyCode, KeyEvent, KeyModifiers};
use ratatui::Frame;
use ratatui::layout::{Constraint, Direction, Layout, Rect};
use ratatui::style::Style;
use ratatui::widgets::{Block, Borders, Paragraph};

use crate::app::{App, PendingAction};
use crate::input::hitmap::HitAction;
use crate::input::keymap::{ActionId, KeyMode};
use crate::widgets::run_end::RunOutcome;
use crate::widgets::transcript::{
    FrameCtx, MessageItem, NoteItem, NoteTone as TranscriptNoteTone, ReasoningItem, RunEndItem,
    ToolItem, Transcript, TranscriptItem,
};

use projection::ThreadViewModel;
use reducer::{
    NoteTone, ThreadAsk, ThreadEntry, ThreadReduceOptions, ThreadState, reduce_thread,
    reduce_thread_incremental, strip_done_marker,
};

/// A thread-screen control — a header action, an ask option, a review
/// button. Routed by `apply_hit` and mirrored by keyboard shortcuts in `handle_key`.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum ThreadAction {
    ToggleTimelineItem(usize),
    Archive,
    MarkUnread,
    Cancel,
    Delete,
    ToggleStepRail,
    OpenSubagent(String),
    CloseSubagentSheet,
    AskOption {
        question: usize,
        option: usize,
    },
    AskSend,
    /// Flip a conversation between manual and automatic Git while it is idle.
    ToggleGitMode,
    /// Abandon a provider session the harness would not resume. Confirmed, never automatic.
    RestartSession,
    ReviewSendBack,
    ReviewDraftPr,
    ReviewOpenPr,
    ReviewAccept,
    CancelAutoResume,
    RemoveQueuedMessage(String),
    FocusComposer,
    /// Click into the transcript pane: it takes keyboard focus for scrolling.
    FocusTranscript,
    FocusReviewNotes,
    /// Animate the local placebo mascot. This never crosses the TUI/engine seam.
    PetDuck,
    /// Tab row: Session is this screen; Changes/Files/Commits are `screens::task_git` — leaving
    /// this screen is a navigation, not a local state change.
    OpenGitTab(crate::app::TaskGitTab),
}

impl ThreadAction {
    pub(crate) fn command_name(&self) -> &'static str {
        match self {
            Self::Cancel => ":stop",
            Self::Archive => ":archive",
            Self::Delete => ":delete",
            Self::RestartSession => ":restart-session",
            _ => "chat action",
        }
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Default)]
pub enum ThreadFocus {
    #[default]
    Transcript,
    Composer,
    ReviewNotes,
    Ask,
}

/// What the thread is showing. A conversation is interactive; a legacy run record is rendered
/// read-only (section 4.3) and never passes through the conversation runtime, so the two are
/// distinguished by type rather than by convention.
#[derive(Debug, Clone, PartialEq)]
pub enum ThreadSubject {
    Conversation(Box<coducktor_contract::ConversationRecord>),
    LegacyRun(Box<ApiRun>),
}

/// Engine-fetched state for the currently open thread.
impl ThreadSubject {
    pub fn conversation(&self) -> Option<&coducktor_contract::ConversationRecord> {
        match self {
            Self::Conversation(record) => Some(record),
            Self::LegacyRun(_) => None,
        }
    }

    pub fn legacy_run(&self) -> Option<&ApiRun> {
        match self {
            Self::LegacyRun(run) => Some(run),
            Self::Conversation(_) => None,
        }
    }

    /// Whether the user may act on this thread at all. Legacy records are historical.
    pub fn is_interactive(&self) -> bool {
        matches!(self, Self::Conversation(_))
    }

    pub fn title(&self) -> &str {
        match self {
            Self::Conversation(record) => &record.title,
            Self::LegacyRun(run) => &run.record.title,
        }
    }
}

/// Adapt conversation metadata to the mature transcript projection without making the
/// conversation runtime run-shaped. The adapter exists only inside the renderer; Engine and
/// persistence continue to use the conversation-native contract.
fn conversation_projection_run(record: &coducktor_contract::ConversationRecord) -> ApiRun {
    use coducktor_contract::ConversationState;

    let status = match record.state {
        ConversationState::Idle => RunStatus::Idle,
        ConversationState::Queued => RunStatus::Queued,
        ConversationState::Running => RunStatus::Running,
        ConversationState::NeedsInput => RunStatus::Waiting,
        ConversationState::Failed => RunStatus::Failed,
        ConversationState::Cancelled => RunStatus::Cancelled,
    };
    ApiRun {
        record: coducktor_contract::RunRecord {
            id: record.id.clone(),
            title: record.title.clone(),
            workflow: String::new(),
            task: record.initial_message.text.clone(),
            model: record.model.clone(),
            runner: Some(record.harness),
            status,
            created_at: record.created_at.clone(),
            updated_at: Some(record.updated_at.clone()),
            started_at: record
                .active_turn
                .as_ref()
                .or(record.latest_turn.as_ref())
                .and_then(|turn| turn.started_at.clone()),
            finished_at: record
                .latest_turn
                .as_ref()
                .and_then(|turn| turn.finished_at.clone()),
            tokens_used: record.tokens_used,
            input_tokens: record.input_tokens,
            output_tokens: record.output_tokens,
            cost_usd: record.cost_usd,
            worktree: Some(record.worktree),
            worktree_path: record.worktree_path.clone(),
            worktree_reclaimed_at: None,
            branch: record.branch.clone(),
            archived: record.archived,
            archived_at: record.archived_at.clone(),
            seen_at: record.seen_at.clone(),
            error: record.last_error.clone(),
            ..Default::default()
        },
        usage: None,
    }
}

impl ThreadData {
    /// The legacy run record, when this thread is showing one. Conversation threads return
    /// `None` — they are not run-shaped and must not be rendered through run-only controls.
    pub fn run(&self) -> Option<&ApiRun> {
        self.subject.as_ref().and_then(ThreadSubject::legacy_run)
    }

    /// The conversation record, when this thread is showing one.
    pub fn conversation(&self) -> Option<&coducktor_contract::ConversationRecord> {
        self.subject.as_ref().and_then(ThreadSubject::conversation)
    }

    /// The conversation's current state, which drives composer availability.
    pub fn conversation_state(&self) -> Option<coducktor_contract::ConversationState> {
        self.conversation().map(|record| record.state)
    }

    /// Whether provider I/O is active right now, for either kind of subject.
    pub fn turn_is_running(&self) -> bool {
        match &self.subject {
            Some(ThreadSubject::Conversation(record)) => {
                record.state == coducktor_contract::ConversationState::Running
            }
            Some(ThreadSubject::LegacyRun(run)) => run.record.status == RunStatus::Running,
            None => false,
        }
    }
}

#[derive(Debug, Clone, Default, PartialEq)]
pub struct ThreadData {
    pub project: String,
    pub run_id: String,
    pub subject: Option<ThreadSubject>,
    pub events: Vec<RunEvent>,
    pub as_of_seq: f64,
    pub older_cursor: Option<String>,
    pub older_loading: bool,
    pub older_error: Option<String>,
    pub state: ThreadState,
    pub view_model: ThreadViewModel,
}

/// Sanitized local accounting for thread projection work. It intentionally records only counts
/// and elapsed time, never prompts, provider payloads, or transcript contents.
#[derive(Debug, Clone, Copy, Default, PartialEq, Eq)]
pub struct ThreadProjectionMetrics {
    pub rebuilds: usize,
    /// Number of durable events folded across all rebuilds. This makes accidental quadratic
    /// re-folding visible without retaining any event data.
    pub rebuilt_events: usize,
    /// Time spent folding durable events into `ThreadState`.
    pub rebuild_time: Duration,
    /// End-to-end projection and transcript reconciliation time.
    pub projection_time: Duration,
}

/// Result of folding one live batch. A sequence hole leaves the watermark at the last durable
/// contiguous event so the runtime can reload from that point instead of cementing the gap.
#[derive(Debug, Clone, Copy, Default, PartialEq, Eq)]
pub struct ThreadPushResult {
    pub accepted: usize,
    pub dropped_events: usize,
    pub refresh_required: bool,
}

const DUCK_COMBO_TICKS: u64 = 48;

/// Ephemeral input state for the chat-header placebo. It is deliberately absent from every
/// contract and durable record: petting the duck can only change pixels in this process.
#[derive(Debug, Clone, Copy, Default, PartialEq, Eq)]
pub(crate) struct PlaceboDuck {
    combo: u16,
    last_pet_tick: Option<u64>,
}

impl PlaceboDuck {
    pub(crate) fn pet(&mut self, tick: u64) {
        self.combo = match self.last_pet_tick {
            Some(previous) if tick.saturating_sub(previous) <= DUCK_COMBO_TICKS => {
                self.combo.saturating_add(1)
            }
            _ => 1,
        };
        self.last_pet_tick = Some(tick);
    }

    pub(crate) fn combo_at(self, tick: u64) -> u16 {
        match self.last_pet_tick {
            Some(previous) if tick.saturating_sub(previous) <= DUCK_COMBO_TICKS => self.combo,
            _ => 0,
        }
    }

    pub(crate) fn elapsed(self, tick: u64) -> Option<u64> {
        self.last_pet_tick
            .map(|previous| tick.saturating_sub(previous))
            .filter(|elapsed| *elapsed <= DUCK_COMBO_TICKS)
    }
}

pub struct ThreadUi {
    pub data: ThreadData,
    pub transcript: Transcript,
    pub composer: crate::widgets::composer::Composer,
    pub review_notes: String,
    pub ask_selections: Vec<Vec<String>>,
    pub ask_focus: (usize, usize),
    pub subagent_sheet: Option<String>,
    pub steps_collapsed: bool,
    pub focus: ThreadFocus,
    pub header_action_focus: Option<usize>,
    pub(crate) placebo_duck: PlaceboDuck,
    /// The transcript's inner rectangle from the last render, used to keep mouse-wheel input
    /// scoped to the task activity rather than the composer and other controls.
    pub(crate) transcript_area: Option<Rect>,
    pub pending_prompt: Option<String>,
    pending_prompt_after_seq: f64,
    pending_prompt_queued: bool,
    pending_composer: Option<crate::widgets::composer::Composer>,
    pub delivery_error: bool,
    pub cancel_pending: bool,
    pub project_root: Option<PathBuf>,
    projection_metrics: ThreadProjectionMetrics,
    load_revision: u64,
}

impl Default for ThreadUi {
    fn default() -> Self {
        Self {
            data: ThreadData::default(),
            transcript: Transcript::new(),
            composer: crate::widgets::composer::Composer::default(),
            review_notes: String::new(),
            ask_selections: Vec::new(),
            ask_focus: (0, 0),
            subagent_sheet: None,
            steps_collapsed: true,
            focus: ThreadFocus::Transcript,
            header_action_focus: None,
            placebo_duck: PlaceboDuck::default(),
            transcript_area: None,
            pending_prompt: None,
            pending_prompt_after_seq: -1.0,
            pending_prompt_queued: false,
            pending_composer: None,
            delivery_error: false,
            cancel_pending: false,
            project_root: None,
            projection_metrics: ThreadProjectionMetrics::default(),
            load_revision: 0,
        }
    }
}

impl ThreadUi {
    /// Return local projection accounting for diagnostics and scaling tests.
    pub fn projection_metrics(&self) -> ThreadProjectionMetrics {
        self.projection_metrics
    }

    pub fn load_revision(&self) -> u64 {
        self.load_revision
    }

    /// Called on thread entry, from a fresh subject record and the first history page.
    pub fn load(
        &mut self,
        project: String,
        run_id: String,
        subject: ThreadSubject,
        events: Vec<RunEvent>,
        as_of_seq: f64,
        older_cursor: Option<String>,
    ) {
        let same_thread = self.data.project == project && self.data.run_id == run_id;
        self.data = ThreadData {
            project,
            run_id,
            subject: Some(subject),
            events,
            as_of_seq,
            older_cursor,
            older_loading: false,
            older_error: None,
            state: ThreadState::default(),
            view_model: ThreadViewModel::default(),
        };
        self.transcript = Transcript::new();
        self.review_notes.clear();
        self.ask_selections.clear();
        self.ask_focus = (0, 0);
        self.subagent_sheet = None;
        self.header_action_focus = None;
        if !same_thread {
            self.placebo_duck = PlaceboDuck::default();
        }
        self.focus = if same_thread {
            self.focus
        } else {
            ThreadFocus::Composer
        };
        if self.focus == ThreadFocus::Composer {
            self.composer.focus();
        } else {
            self.composer.blur();
        }
        self.transcript_area = None;
        if !same_thread {
            self.pending_prompt = None;
            self.pending_prompt_after_seq = -1.0;
            self.pending_prompt_queued = false;
            self.pending_composer = None;
        }
        self.cancel_pending = false;
        self.load_revision = self.load_revision.wrapping_add(1);
        self.rebuild_full();
    }

    pub fn set_pending_prompt(&mut self, text: String) {
        self.pending_prompt = Some(text);
        self.pending_prompt_after_seq = self.data.as_of_seq;
        self.pending_prompt_queued = false;
        self.pending_composer = None;
        self.delivery_error = false;
        // A freshly sent prompt is the whole point of sending it. Every other coding harness
        // jumps to the bottom on send; without this, a user who had scrolled up to review
        // earlier output sends a follow-up that renders off-screen and looks like it vanished.
        self.transcript.jump_to_bottom();
        self.refresh_projection(0, Duration::ZERO);
    }

    fn set_pending_composer(&mut self, text: String, queued: bool) {
        self.pending_prompt = Some(text);
        self.pending_prompt_after_seq = self.data.as_of_seq;
        self.pending_prompt_queued = queued;
        self.pending_composer = Some(self.composer.clone());
        self.delivery_error = false;
        self.transcript.jump_to_bottom();
        self.refresh_projection(0, Duration::ZERO);
    }

    pub fn set_project_root(&mut self, root: Option<PathBuf>) {
        self.project_root = root;
        self.refresh_projection(0, Duration::ZERO);
    }

    pub fn restore_pending_prompt(&mut self, project: &str, run_id: &str) {
        if self.data.project != project || self.data.run_id != run_id {
            return;
        }
        if let Some(composer) = self.pending_composer.take() {
            self.composer = composer;
            self.composer.focus();
            self.focus = ThreadFocus::Composer;
        } else if let Some(text) = &self.pending_prompt {
            self.composer.set_text(text);
            self.composer.focus();
            self.focus = ThreadFocus::Composer;
        }
        self.pending_prompt = None;
        self.pending_prompt_after_seq = -1.0;
        self.pending_prompt_queued = false;
        self.delivery_error = true;
        self.refresh_projection(0, Duration::ZERO);
    }

    /// Replace the loaded subject (a fresh engine read, or a live event for the open thread).
    pub fn set_subject(&mut self, subject: ThreadSubject) {
        self.data.subject = Some(subject);
        self.refresh_projection(0, Duration::ZERO);
    }

    /// Replace the loaded legacy run record.
    pub fn set_run(&mut self, run: ApiRun) {
        self.set_subject(ThreadSubject::LegacyRun(Box::new(run)));
    }

    /// Replace the loaded conversation record.
    pub fn set_conversation(&mut self, record: coducktor_contract::ConversationRecord) {
        self.set_subject(ThreadSubject::Conversation(Box::new(record)));
    }

    pub fn clear_if_matches(&mut self, project: &str, run_id: &str) {
        if self.data.project != project || self.data.run_id != run_id {
            return;
        }
        self.data.subject = None;
        self.data.events.clear();
        self.data.state = ThreadState::default();
        self.data.view_model = ThreadViewModel::default();
        self.data.as_of_seq = 0.0;
        self.data.older_cursor = None;
        self.data.older_loading = false;
        self.data.older_error = None;
        self.transcript = Transcript::new();
        self.pending_prompt = None;
        self.pending_prompt_after_seq = -1.0;
        self.pending_prompt_queued = false;
        self.pending_composer = None;
        self.delivery_error = false;
    }

    /// Append one live run event and re-fold.
    pub fn push_event(&mut self, seq: f64, event: RunEvent) -> ThreadPushResult {
        self.push_events(std::iter::once((seq, event)))
    }

    /// Append a frame-sized live batch and re-fold once. This keeps projection cost linear in
    /// frames rather than rebuilding the complete transcript for every provider delta.
    pub fn push_events(
        &mut self,
        events: impl IntoIterator<Item = (f64, RunEvent)>,
    ) -> ThreadPushResult {
        let first_new = self.data.events.len();
        let mut result = ThreadPushResult::default();
        for (seq, event) in events {
            if seq <= self.data.as_of_seq {
                continue;
            }
            let expected = self.data.as_of_seq + 1.0;
            if self.data.as_of_seq >= 0.0 && seq > expected {
                result.dropped_events = (seq - expected).round().max(1.0) as usize;
                result.refresh_required = true;
                break;
            }
            self.data.as_of_seq = seq;
            self.data.events.push(event);
        }
        let accepted_len = self.data.events.len().saturating_sub(first_new);
        result.accepted = accepted_len;
        if accepted_len > 0 {
            let active_turn = self.data.turn_is_running();
            let started = Instant::now();
            reduce_thread_incremental(
                &mut self.data.state,
                &self.data.events[first_new..],
                ThreadReduceOptions { active_turn },
            );
            self.refresh_projection(accepted_len, started.elapsed());
        }
        result
    }

    pub fn begin_load_earlier(&mut self) -> Option<String> {
        if self.data.older_loading {
            return None;
        }
        let cursor = self.data.older_cursor.clone()?;
        self.data.older_loading = true;
        self.data.older_error = None;
        Some(cursor)
    }

    pub fn merge_earlier(&mut self, events: Vec<RunEvent>, older_cursor: Option<String>) {
        let old_len = self.data.events.len();
        self.data.events.extend(events);
        self.data.events.sort_by(|a, b| a.seq.total_cmp(&b.seq));
        self.data.events.dedup_by(|a, b| a.seq == b.seq);
        let added = self.data.events.len().saturating_sub(old_len);
        self.data.older_cursor = older_cursor;
        self.data.older_loading = false;
        self.data.older_error = None;
        self.rebuild_full();
        self.transcript.preserve_after_prepend(added);
    }

    pub fn fail_load_earlier(&mut self, error: String) {
        self.data.older_loading = false;
        self.data.older_error = Some(error);
    }

    fn rebuild_full(&mut self) {
        let active_turn = self.data.turn_is_running();
        let started = Instant::now();
        self.data.state = reduce_thread(&self.data.events, ThreadReduceOptions { active_turn });
        self.refresh_projection(self.data.events.len(), started.elapsed());
    }

    fn refresh_projection(&mut self, reduced_events: usize, reduction_time: Duration) {
        let started = Instant::now();
        // The send request being accepted does not mean its user-message has reached the
        // transcript yet. Keep the optimistic prompt visible until the durable event arrives,
        // then let that event replace it without briefly hiding what the agent is working on.
        let queued_prompt_is_durable = self.pending_prompt_queued
            && self.pending_prompt.as_deref().is_some_and(|prompt| {
                self.data.run().is_some_and(|run| {
                    run.record
                        .queued_messages
                        .iter()
                        .flatten()
                        .any(|message| queued_prompt_label(message) == prompt)
                })
            });
        let pending_is_durable = queued_prompt_is_durable
            || self.pending_prompt.as_deref().is_some_and(|prompt| {
                self.data.events.iter().any(|event| {
                event.seq > self.pending_prompt_after_seq
                    && event.event_type == "user-message"
                    && durable_prompt_label(event) == prompt
            })
            // History is paged. A reload can therefore advance its sequence watermark past the
            // follow-up while omitting that individual event from the visible page. The core
            // writes the user-message before it can append any later event, so this is still a
            // durable acknowledgement; without it the optimistic UI could remain "Sending…"
            // forever after a missed live notification.
            || (!self.pending_prompt_queued
                && self.data.as_of_seq > self.pending_prompt_after_seq)
            });
        if pending_is_durable {
            self.pending_prompt = None;
            self.pending_prompt_after_seq = -1.0;
            self.pending_prompt_queued = false;
            self.pending_composer = None;
            self.delivery_error = false;
        }
        let projection_run = match self.data.subject.as_ref() {
            Some(ThreadSubject::LegacyRun(run)) => Some((**run).clone()),
            Some(ThreadSubject::Conversation(record)) => {
                Some(conversation_projection_run(record.as_ref()))
            }
            None => None,
        };
        // A conversation's initial message is normally present as its first durable
        // `user-message`; rendering the record's copy beside it would show the prompt twice. The
        // record remains a fallback for legacy runs and salvaged/partial history with no visible
        // user message at all.
        let task_opens_the_transcript = matches!(
            self.data.subject.as_ref(),
            Some(ThreadSubject::LegacyRun(_))
        ) || self
            .data
            .state
            .turns
            .first()
            .is_none_or(|turn| turn.user_message.is_none());
        if let Some(run) = projection_run {
            let run = &run;
            self.data.view_model = projection::project_thread_with_root(
                run,
                &self.data.state,
                self.project_root.as_deref(),
            );
            self.transcript.reconcile_reusing(|existing| {
                build_transcript_items(
                    run,
                    &self.data.state,
                    &self.data.view_model,
                    TranscriptBuild {
                        available: self.data.older_cursor.is_some(),
                        loading: self.data.older_loading,
                        error: self.data.older_error.as_deref(),
                        task_fallback: task_opens_the_transcript,
                    },
                    self.pending_prompt.as_deref(),
                    self.pending_prompt_queued,
                    existing,
                )
            });
            // A resolved ask, or a fresh one under a different id, clears any stale in-progress
            // selections — a leftover partial answer must never attach to the NEXT question.
            if pending_ask(&self.data.state).is_none() {
                self.ask_selections.clear();
            }
        }
        self.projection_metrics.rebuilds += 1;
        self.projection_metrics.rebuilt_events += reduced_events;
        self.projection_metrics.rebuild_time += reduction_time;
        self.projection_metrics.projection_time += started.elapsed();
    }
}

fn durable_prompt_label(event: &RunEvent) -> &str {
    let text = event
        .extra
        .get("text")
        .and_then(serde_json::Value::as_str)
        .unwrap_or_default();
    if text.is_empty()
        && event
            .extra
            .get("imageCount")
            .and_then(serde_json::Value::as_u64)
            .unwrap_or_default()
            > 0
    {
        "[Image]"
    } else {
        text
    }
}

fn queued_prompt_label(message: &coducktor_contract::QueuedMessage) -> &str {
    if message.text.is_empty()
        && message
            .images
            .as_ref()
            .is_some_and(|images| !images.is_empty())
    {
        "[Image]"
    } else {
        &message.text
    }
}

fn map_tone(tone: NoteTone) -> TranscriptNoteTone {
    match tone {
        NoteTone::Dim => TranscriptNoteTone::Dim,
        NoteTone::Warning => TranscriptNoteTone::Warning,
        NoteTone::Danger => TranscriptNoteTone::Danger,
    }
}

struct TranscriptBuild<'a> {
    available: bool,
    loading: bool,
    error: Option<&'a str>,
    task_fallback: bool,
}

fn build_transcript_items(
    run: &ApiRun,
    state: &ThreadState,
    view_model: &ThreadViewModel,
    options: TranscriptBuild<'_>,
    pending_prompt: Option<&str>,
    pending_prompt_queued: bool,
    existing: &mut std::collections::HashMap<String, TranscriptItem>,
) -> Vec<TranscriptItem> {
    let mut items = Vec::new();
    if options.loading {
        items.push(TranscriptItem::Note(NoteItem::new(
            "history-loading",
            "Loading earlier history…",
            TranscriptNoteTone::Dim,
        )));
    } else if let Some(error) = options.error {
        items.push(TranscriptItem::Note(NoteItem::new(
            "history-error",
            format!("Earlier history failed: {error} — press R to retry"),
            TranscriptNoteTone::Danger,
        )));
    } else if options.available {
        items.push(TranscriptItem::Note(NoteItem::new(
            "history-earlier",
            "Earlier history available — scroll to the top or press R to load",
            TranscriptNoteTone::Dim,
        )));
    }
    if options.task_fallback && !run.record.task.trim().is_empty() {
        items.push(reuse_message(
            existing,
            "task".to_owned(),
            coducktor_protocol::MessageRole::User,
            &run.record.task,
        ));
    }
    for (turn_index, turn) in state.turns.iter().enumerate() {
        let has_ask_card = turn
            .items
            .iter()
            .any(|item| matches!(item, ThreadEntry::Ask(_)));
        let active_last_turn =
            run.record.status == RunStatus::Running && turn_index + 1 == state.turns.len();
        let strip_ask = has_ask_card || active_last_turn;
        let projected = view_model
            .turns
            .iter()
            .find(|item| item.id == turn.id)
            .or_else(|| {
                (turn_index == 0 && turn.user_message.is_none())
                    .then(|| view_model.turns.first())
                    .flatten()
            });
        if let Some(user_message) = &turn.user_message {
            items.push(reuse_message(
                existing,
                format!("um:{}", turn.id),
                coducktor_protocol::MessageRole::User,
                &user_message.text,
            ));
        }
        for entry in &turn.items {
            match entry {
                ThreadEntry::Item(UiItem::Message(message)) => {
                    let text = if message.role == coducktor_protocol::MessageRole::Assistant
                        && message.text.contains("DUCK:")
                    {
                        std::borrow::Cow::Owned(strip_done_marker(&message.text, strip_ask))
                    } else {
                        std::borrow::Cow::Borrowed(message.text.as_str())
                    };
                    items.push(reuse_message(
                        existing,
                        message.id.clone(),
                        message.role,
                        &text,
                    ));
                }
                ThreadEntry::Item(UiItem::Reasoning(reasoning)) => {
                    items.push(reuse_reasoning(
                        existing,
                        reasoning.id.clone(),
                        &reasoning.text,
                    ));
                }
                ThreadEntry::Item(UiItem::Tool(tool)) => {
                    items.push(reuse_tool(existing, tool));
                }
                ThreadEntry::Note(note) => {
                    items.push(TranscriptItem::Note(NoteItem::new(
                        note.id.clone(),
                        note.text.clone(),
                        map_tone(note.tone),
                    )));
                }
                ThreadEntry::Image(image) => {
                    items.push(TranscriptItem::Note(NoteItem::new(
                        image.id.clone(),
                        format!("image: {}", image.url),
                        TranscriptNoteTone::Dim,
                    )));
                }
                ThreadEntry::ProviderAuthRequired(card) => {
                    items.push(TranscriptItem::Note(NoteItem::new(
                        card.id.clone(),
                        format!(
                            "{:?} needs re-authentication (incident {})",
                            card.provider, card.auth_failure_id
                        ),
                        TranscriptNoteTone::Danger,
                    )));
                }
                // Rendered as its own interactive card below the transcript, not inline.
                ThreadEntry::Ask(_) => {}
            }
        }
        if let Some(plan) = &turn.plan_entries {
            let input = serde_json::json!({ "todos": plan });
            let status = if plan
                .iter()
                .all(|entry| entry.status == coducktor_protocol::PlanStatus::Completed)
            {
                coducktor_protocol::ToolStatus::Completed
            } else {
                coducktor_protocol::ToolStatus::Running
            };
            items.push(TranscriptItem::Tool(ToolItem::new(
                format!("plan:{}", turn.id),
                "TodoWrite",
                Some(&input),
                status,
            )));
        }
        if let Some(projected) = projected
            && let Some(outcome) = outcome_item(projected)
        {
            items.push(outcome);
        }
    }
    for message in run.record.queued_messages.iter().flatten() {
        items.push(reuse_message(
            existing,
            format!("queued:{}", message.id),
            coducktor_protocol::MessageRole::User,
            queued_prompt_label(message),
        ));
        items.push(TranscriptItem::Note(NoteItem::new(
            format!("queued-state:{}", message.id),
            "Queued for the next turn",
            TranscriptNoteTone::Dim,
        )));
    }
    if let Some(prompt) = pending_prompt {
        items.push(TranscriptItem::Message(MessageItem::new(
            "pending-prompt",
            coducktor_protocol::MessageRole::User,
            prompt,
        )));
        items.push(TranscriptItem::Note(NoteItem::new(
            "pending-prompt-state",
            if pending_prompt_queued {
                "Queueing…"
            } else {
                "Sending…"
            },
            TranscriptNoteTone::Dim,
        )));
    }
    // The dock's copy of this rule is ephemeral — it is gone the moment a follow-up starts — so
    // mirror it here, after everything the run produced, to mark where the run terminated.
    if let Some(outcome) = RunOutcome::from_status(run.record.status) {
        items.push(TranscriptItem::RunEnd(RunEndItem::new(
            format!("run-end:{}", run.record.id),
            outcome,
            widgets::run_end_detail(&run.record),
        )));
    }
    let latest_tool = items
        .iter()
        .rposition(|item| matches!(item, TranscriptItem::Tool(_)));
    if let Some(index) = latest_tool
        && let Some(TranscriptItem::Tool(item)) = items.get_mut(index)
    {
        item.is_latest = true;
    }
    if run.record.status == RunStatus::Running {
        let latest_reasoning = items
            .iter()
            .rposition(|item| matches!(item, TranscriptItem::Reasoning(_)));
        if let Some(index) = latest_reasoning
            && let Some(TranscriptItem::Reasoning(item)) = items.get_mut(index)
        {
            item.is_active = true;
            item.started_epoch = run
                .record
                .started_at
                .as_deref()
                .and_then(crate::screens::runs_util::parse_iso_seconds);
        }
        if let Some(TranscriptItem::Message(item)) = items.last_mut()
            && item.role == coducktor_protocol::MessageRole::Assistant
        {
            item.streaming = true;
        }
    }
    items
}

fn reuse_message(
    existing: &mut std::collections::HashMap<String, TranscriptItem>,
    id: String,
    role: coducktor_protocol::MessageRole,
    text: &str,
) -> TranscriptItem {
    if let Some(TranscriptItem::Message(mut item)) = existing.remove(&id)
        && item.role == role
        && item.text == text
    {
        item.streaming = false;
        return TranscriptItem::Message(item);
    }
    TranscriptItem::Message(MessageItem::new(id, role, text))
}

fn reuse_reasoning(
    existing: &mut std::collections::HashMap<String, TranscriptItem>,
    id: String,
    text: &str,
) -> TranscriptItem {
    if let Some(TranscriptItem::Reasoning(mut item)) = existing.remove(&id)
        && item.text == text
    {
        item.is_active = false;
        item.started_epoch = None;
        return TranscriptItem::Reasoning(item);
    }
    TranscriptItem::Reasoning(ReasoningItem::new(id, text))
}

fn reuse_tool(
    existing: &mut std::collections::HashMap<String, TranscriptItem>,
    tool: &coducktor_protocol::UiToolItem,
) -> TranscriptItem {
    let id = tool.id.clone();
    let display = coducktor_protocol::tool_display(&tool.name, tool.input.as_ref());
    let started_millis = tool
        .started_at
        .as_deref()
        .and_then(crate::screens::runs_util::parse_iso_millis);
    let finished_millis = tool
        .finished_at
        .as_deref()
        .and_then(crate::screens::runs_util::parse_iso_millis);
    let started_epoch = started_millis.map(|value| value.div_euclid(1_000));
    let duration_ms = started_millis
        .zip(finished_millis)
        .map(|(started, finished)| finished.saturating_sub(started).max(0) as u64);
    if let Some(TranscriptItem::Tool(mut item)) = existing.remove(&id)
        && item.tool_kind == display.tool_kind
        && item.title == display.title
        && item.subtitle == display.subtitle
        && item.name == tool.name
        && item.input.as_ref() == tool.input.as_ref()
        && item.status == tool.status
        && item.output.as_deref() == tool.output.as_deref()
        && item.error.as_deref() == tool.error.as_deref()
        && item.exit_code == tool.exit_code.map(|value| value as i64)
        && item.started_epoch == started_epoch
        && item.duration_ms == duration_ms
    {
        item.is_latest = false;
        return TranscriptItem::Tool(item);
    }
    let mut candidate = ToolItem::new(id, &tool.name, tool.input.as_ref(), tool.status);
    candidate.output = tool.output.clone();
    candidate.error = tool.error.clone();
    candidate.exit_code = tool.exit_code.map(|value| value as i64);
    candidate.started_epoch = started_epoch;
    candidate.duration_ms = duration_ms;
    TranscriptItem::Tool(candidate)
}

fn outcome_item(turn: &projection::TurnViewModel) -> Option<TranscriptItem> {
    let (text, tone) = match &turn.outcome {
        projection::TurnOutcome::Running | projection::TurnOutcome::Unknown => return None,
        projection::TurnOutcome::Completed { verification, .. } => (
            format!(
                "Completed · verification {}",
                verification_label(*verification)
            ),
            TranscriptNoteTone::Dim,
        ),
        projection::TurnOutcome::Failed {
            reason,
            verification,
        } => (
            format!(
                "Failed{} · verification {}",
                reason
                    .as_deref()
                    .map(|value| format!(": {value}"))
                    .unwrap_or_default(),
                verification_label(*verification)
            ),
            TranscriptNoteTone::Danger,
        ),
        projection::TurnOutcome::Interrupted => {
            ("Interrupted".to_owned(), TranscriptNoteTone::Warning)
        }
    };
    Some(TranscriptItem::Note(NoteItem::new(
        format!("outcome:{}", turn.id),
        text,
        tone,
    )))
}

/// The single AskUser card that can still be answered — only the LATEST `ask.requested`
/// is ever open (the agent asks once, then parks `waiting`).
fn pending_ask(state: &ThreadState) -> Option<&ThreadAsk> {
    state.turns.iter().rev().find_map(|turn| {
        turn.items.iter().rev().find_map(|entry| match entry {
            ThreadEntry::Ask(ask) if !ask.resolved => Some(ask),
            ThreadEntry::Ask(_) => None,
            _ => None,
        })
    })
}

/// Navigate to a run's thread and queue the data load. The one entry point every screen
/// (Tasks, Global tasks, row menus, a just-started run) should call instead of navigating
/// `Route::Thread` directly.
pub fn open(app: &mut App, project: &str, id: &str) {
    let root = app
        .project_registry
        .iter()
        .find(|entry| entry.id == project)
        .map(|entry| PathBuf::from(&entry.root))
        .or_else(|| {
            (app.default_project == project)
                .then(|| app.boot_root.clone())
                .flatten()
        });
    app.thread_ui.set_project_root(root);
    if (app.thread_ui.data.project != project || app.thread_ui.data.run_id != id)
        && let Some(run) = app
            .project_tasks
            .get(project)
            .and_then(|state| state.runs.iter().find(|run| run.record.id == id))
            .cloned()
    {
        app.thread_ui.load(
            project.to_owned(),
            id.to_owned(),
            ThreadSubject::LegacyRun(Box::new(run)),
            Vec::new(),
            -1.0,
            None,
        );
    }
    app.navigate_route(crate::app::Route::Thread {
        project: project.to_owned(),
        id: id.to_owned(),
    });
    app.pending.push(PendingAction::LoadThread {
        project: project.to_owned(),
        id: id.to_owned(),
    });
}

/// Open a newly accepted run without a round trip through the manager. Agent execution may hold
/// that manager for the duration of a turn, so the create response is the authoritative first
/// frame: it contains the exact prompt, queued status, and durable run id needed by the listener.
pub fn open_started(app: &mut App, project: &str, run: coducktor_contract::RunRecord) {
    let id = run.id.clone();
    let root = app
        .project_registry
        .iter()
        .find(|entry| entry.id == project)
        .map(|entry| PathBuf::from(&entry.root))
        .or_else(|| {
            (app.default_project == project)
                .then(|| app.boot_root.clone())
                .flatten()
        });
    app.thread_ui.set_project_root(root);
    app.thread_ui.load(
        project.to_owned(),
        id.clone(),
        ThreadSubject::LegacyRun(Box::new(ApiRun {
            record: run,
            usage: None,
        })),
        Vec::new(),
        -1.0,
        None,
    );
    app.navigate_route(crate::app::Route::Thread {
        project: project.to_owned(),
        id,
    });
}

fn request_earlier(app: &mut App) {
    let Some(cursor) = app.thread_ui.begin_load_earlier() else {
        return;
    };
    app.pending.push(PendingAction::LoadEarlierThread {
        project: app.thread_ui.data.project.clone(),
        id: app.thread_ui.data.run_id.clone(),
        cursor,
    });
}

/// Scroll the task transcript in response to a wheel event. A wheel notch moves three
/// transcript rows, matching the usual terminal mouse-wheel behavior while preserving the
/// transcript's existing bounds and follow-mode handling.
pub fn handle_scroll(app: &mut App, up: bool) {
    if up && app.thread_ui.transcript.at_top() {
        request_earlier(app);
    }
    app.thread_ui.transcript.scroll_by(if up { -3 } else { 3 });
}

pub fn render(frame: &mut Frame<'_>, area: Rect, app: &mut App) {
    if let Some(record) = app.thread_ui.data.conversation().cloned() {
        render_conversation(frame, area, app, &record);
        return;
    }
    let Some(run) = app.thread_ui.data.run().cloned() else {
        frame.render_widget(
            Paragraph::new("Loading…").style(Style::default().fg(app.theme.palette.soft_fg)),
            area,
        );
        return;
    };
    let theme = app.theme;
    let record = &run.record;

    // Legacy workflow records remain inspectable, archivable, and deletable, but every execution
    // control is retired. Their old steps, pending questions, review gate, monitoring state, and
    // composer are historical transcript data rather than actionable product state.
    let step_rail_height = 0;
    let ask = None;
    let ask_height = 0;
    let review_height = 0;
    let auto_resume_height = 0;
    let hint_height = 1;
    // One row, always reserved. During a run it holds the live-activity line; the moment the run
    // reaches a terminal status the same row converts into the run-end rule. Reserving it
    // unconditionally is what keeps that conversion from shifting the composer under the cursor.
    let live_activity_height = 1;
    let composer_height = 0;
    let base_dock_height = ask_height
        + review_height
        + auto_resume_height
        + hint_height
        + live_activity_height
        + composer_height;

    let base_rows = Layout::default()
        .direction(Direction::Vertical)
        .constraints([
            Constraint::Length(5),
            Constraint::Length(step_rail_height),
            Constraint::Min(3),
            Constraint::Length(base_dock_height),
        ])
        .split(area);
    // Both `Waiting` (a genuine question) and `Idle` (an ordinary turn end, F4) park the
    // session with the composer ready for a follow-up. Either way the agent's last word should
    // be readable without hunting back through the transcript, so both statuses get the pinned
    // duplicate when that message has scrolled out of view.
    let latest_message = if matches!(record.status, RunStatus::Waiting | RunStatus::Idle) {
        app.thread_ui
            .transcript
            .latest_assistant_message()
            .map(|(id, text)| (id.to_owned(), text.to_owned()))
            .filter(|(id, _)| {
                !app.thread_ui.transcript.item_content_fully_visible(
                    id,
                    area.width,
                    base_rows[2].height.saturating_sub(1),
                )
            })
    } else {
        None
    };
    let latest_message_height = latest_message
        .as_ref()
        .map(|(_, text)| widgets::latest_message_height(text, area.width))
        .unwrap_or(0);
    let dock_height = base_dock_height + latest_message_height;

    let rows = Layout::default()
        .direction(Direction::Vertical)
        .constraints([
            Constraint::Length(5),
            Constraint::Length(step_rail_height),
            Constraint::Min(3),
            Constraint::Length(dock_height),
        ])
        .split(area);

    if let Some(conversation) = app.thread_ui.data.conversation().cloned() {
        widgets::render_conversation_header(
            frame,
            rows[0],
            &conversation,
            &theme,
            &mut app.hitmap,
            app.thread_ui.header_action_focus,
            widgets::PlaceboDuckView::new(
                app.thread_ui.placebo_duck,
                app.animation_tick,
                app.keymap
                    .key_for_action(KeyMode::Normal, ActionId::PetDuck)
                    .unwrap_or("click"),
            ),
        );
    } else {
        widgets::render_header(
            frame,
            rows[0],
            &run,
            &theme,
            &mut app.hitmap,
            app.thread_ui.header_action_focus,
        );
    }
    if step_rail_height > 0 {
        widgets::render_step_rail(
            frame,
            rows[1],
            &run,
            app.thread_ui.steps_collapsed,
            &theme,
            &mut app.hitmap,
        );
    }

    let transcript_title = format!(
        " Session  \u{b7}  {} tok{} ",
        record.tokens_used as i64,
        if app.thread_ui.transcript.unseen_count() > 0 {
            format!("  \u{b7}  {} new", app.thread_ui.transcript.unseen_count())
        } else {
            String::new()
        }
    );
    let transcript_block = Block::default()
        .title(transcript_title)
        .borders(Borders::TOP)
        .border_style(Style::default().fg(theme.palette.border));
    let transcript_area = transcript_block.inner(rows[2]);
    app.thread_ui.transcript_area = Some(transcript_area);
    frame.render_widget(transcript_block, rows[2]);
    if transcript_area.height > 0 {
        // Empty transcript space focuses the pane; per-row hits sit above it.
        app.hitmap.register(
            transcript_area,
            0,
            HitAction::ThreadScreen(ThreadAction::FocusTranscript),
        );
        app.thread_ui
            .transcript
            .set_pressure(transcript_area.height);
        app.thread_ui.transcript.render_interactive(
            frame.buffer_mut(),
            transcript_area,
            FrameCtx {
                theme: &theme,
                tick: app.animation_tick,
                now_epoch: app.now_epoch,
                expand_key: app
                    .keymap
                    .key_for_action(KeyMode::Normal, ActionId::ToggleTranscriptItem)
                    .unwrap_or("Enter"),
            },
            &mut app.hitmap,
        );
    }

    let dock_rows = Layout::default()
        .direction(Direction::Vertical)
        .constraints([
            Constraint::Length(ask_height),
            Constraint::Length(review_height),
            Constraint::Length(auto_resume_height),
            Constraint::Length(latest_message_height),
            Constraint::Length(hint_height),
            Constraint::Length(live_activity_height),
            Constraint::Length(composer_height),
        ])
        .split(rows[3]);

    if let Some(ask) = &ask {
        widgets::render_ask_card(
            frame,
            dock_rows[0],
            ask,
            &app.thread_ui.ask_selections,
            app.thread_ui.ask_focus,
            &theme,
            &mut app.hitmap,
        );
    }
    if review_height > 0 {
        let preview: String = app
            .thread_ui
            .review_notes
            .chars()
            .take(dock_rows[1].width.max(8) as usize - 8)
            .collect();
        widgets::render_review_panel(frame, dock_rows[1], &run, &preview, &theme, &mut app.hitmap);
    }
    if auto_resume_height > 0 {
        widgets::render_auto_resume_hint(frame, dock_rows[2], &run, &theme, &mut app.hitmap);
    }
    if let Some((_, message)) = &latest_message {
        widgets::render_latest_message(frame, dock_rows[3], message, &theme);
    }
    if hint_height > 0 {
        widgets::render_status_hint(
            frame,
            dock_rows[4],
            "Historical task · read-only · start a new chat to continue",
            &theme,
        );
    }
    if let Some(outcome) = RunOutcome::from_status(record.status) {
        widgets::render_run_end_banner(
            frame,
            dock_rows[5],
            outcome,
            &widgets::run_end_detail(record),
            &theme,
        );
    } else if matches!(record.status, RunStatus::Queued | RunStatus::Running) {
        let elapsed = record
            .started_at
            .as_deref()
            .map(|started| crate::screens::runs_util::short_age(started, app.now_epoch))
            .filter(|value| !value.is_empty())
            .unwrap_or_else(|| "0s".to_owned());
        let activity = if app.thread_ui.cancel_pending {
            "Stopping\u{2026}"
        } else {
            app.thread_ui
                .transcript
                .latest_running_tool_title()
                .unwrap_or_else(|| {
                    let status = app.thread_ui.data.view_model.current_status.trim();
                    if status.is_empty() { "Working" } else { status }
                })
        };
        widgets::render_live_activity(
            frame,
            dock_rows[5],
            activity,
            &elapsed,
            app.animation_tick,
            &theme,
        );
    }

    if let Some(agent_id) = app.thread_ui.subagent_sheet.clone()
        && let Some(agent) = find_subagent(&app.thread_ui.data.state, &agent_id)
    {
        let sheet_area = Rect::new(
            area.right().saturating_sub(area.width / 2),
            area.y,
            area.width / 2,
            area.height,
        );
        widgets::render_subagent_sheet(
            frame,
            sheet_area,
            &agent,
            &app.thread_ui.data.state,
            &theme,
            &mut app.hitmap,
        );
    }
}

fn verification_label(status: projection::VerificationStatus) -> &'static str {
    match status {
        projection::VerificationStatus::Passed => "passed",
        projection::VerificationStatus::Failed => "failed",
        projection::VerificationStatus::NotObserved => "not observed",
    }
}

fn find_subagent(state: &ThreadState, id: &str) -> Option<coducktor_protocol::UiToolItem> {
    state.turns.iter().find_map(|turn| {
        turn.items.iter().find_map(|entry| match entry {
            ThreadEntry::Item(UiItem::Tool(tool)) if tool.id == id => Some(tool.clone()),
            _ => None,
        })
    })
}

pub fn handle_key(app: &mut App, key: KeyEvent) -> bool {
    // Ctrl-C stops the live turn from anywhere on this screen. Esc is the Neovim mode change
    // and nothing else, so leaving the composer never touches the harness.
    if key.code == KeyCode::Char('c') && key.modifiers.contains(KeyModifiers::CONTROL) {
        return request_stop(app);
    }
    if app.thread_ui.subagent_sheet.is_some() {
        if key.code == KeyCode::Esc {
            app.thread_ui.subagent_sheet = None;
        }
        return true;
    }
    if let Some(index) = app.thread_ui.header_action_focus {
        match key.code {
            KeyCode::Tab => {
                cycle_header_action(app, true);
            }
            KeyCode::BackTab => {
                cycle_header_action(app, false);
            }
            KeyCode::Enter => {
                let action = thread_header_actions(app)
                    .get(index)
                    .cloned()
                    .map(|(_, action)| action);
                app.thread_ui.header_action_focus = None;
                if let Some(action) = action {
                    apply_hit(app, action);
                }
            }
            KeyCode::Esc => app.thread_ui.header_action_focus = None,
            _ => {
                app.thread_ui.header_action_focus = None;
                return false;
            }
        }
        return true;
    }
    if key.code == KeyCode::Esc && app.thread_ui.focus == ThreadFocus::Composer {
        app.thread_ui.composer.blur();
        app.thread_ui.focus = ThreadFocus::Transcript;
        return true;
    }
    match app.thread_ui.focus {
        ThreadFocus::Composer => return handle_composer_key(app, key),
        ThreadFocus::ReviewNotes => return handle_review_notes_key(app, key),
        ThreadFocus::Ask => return handle_ask_key(app, key),
        ThreadFocus::Transcript => {}
    }
    match key.code {
        KeyCode::Tab => {
            if !cycle_header_action(app, true) {
                app.thread_ui.transcript.select_next_expandable(1);
            }
            true
        }
        KeyCode::BackTab => {
            if !cycle_header_action(app, false) {
                app.thread_ui.transcript.select_next_expandable(-1);
            }
            true
        }
        KeyCode::Char('i') => {
            app.thread_ui.focus = ThreadFocus::Composer;
            app.thread_ui.composer.focus();
            true
        }
        KeyCode::Char('j') | KeyCode::Down => {
            app.thread_ui.transcript.scroll_by(1);
            true
        }
        KeyCode::Char('k') | KeyCode::Up => {
            if app.thread_ui.transcript.at_top() {
                request_earlier(app);
            }
            app.thread_ui.transcript.scroll_by(-1);
            true
        }
        KeyCode::Enter => {
            app.thread_ui.transcript.toggle_selected();
            true
        }
        _ => false,
    }
}

/// Stop the live turn. A legacy run record is read-only history with nothing to stop, so this
/// returns false there and the key keeps falling through to the shell instead of being swallowed.
fn request_stop(app: &mut App) -> bool {
    let Some(record) = app.thread_ui.data.conversation().cloned() else {
        return false;
    };
    if !record.state.is_active() {
        return false;
    }
    apply_conversation_action(app, &record, ThreadAction::Cancel);
    true
}

fn cycle_header_action(app: &mut App, forward: bool) -> bool {
    let count = thread_header_actions(app).len();
    if count == 0 {
        app.thread_ui.header_action_focus = None;
        return false;
    }
    let next = match (app.thread_ui.header_action_focus, forward) {
        (Some(index), true) => (index + 1) % count,
        (Some(0), false) | (None, false) => count - 1,
        (Some(index), false) => index - 1,
        (None, true) => 0,
    };
    app.thread_ui.composer.blur();
    app.thread_ui.focus = ThreadFocus::Transcript;
    app.thread_ui.header_action_focus = Some(next);
    true
}

fn thread_header_actions(app: &App) -> Vec<(&'static str, ThreadAction)> {
    if let Some(record) = app.thread_ui.data.conversation() {
        widgets::conversation_header_actions(record)
    } else if let Some(run) = app.thread_ui.data.run() {
        widgets::header_actions(run)
    } else {
        Vec::new()
    }
}

/// Deliver a bracketed-paste chunk to the focused composer.
pub fn handle_paste(app: &mut App, text: &str) -> bool {
    if app.thread_ui.subagent_sheet.is_some() || app.thread_ui.focus != ThreadFocus::Composer {
        return false;
    }
    // Image pastes have no textual payload in some terminal implementations. In that case,
    // read the native clipboard so a copied image can still become a follow-up attachment.
    if text.is_empty() {
        return handle_clipboard_paste(app);
    }
    let ctx = crate::widgets::composer::ComposerContext {
        skills: &[],
        skill_usage: None,
        mention_candidates: &[],
    };
    app.thread_ui.composer.handle_paste(text, &ctx);
    true
}

fn handle_composer_key(app: &mut App, key: KeyEvent) -> bool {
    if key.code == KeyCode::BackTab {
        cycle_header_action(app, false);
        return true;
    }
    if is_clipboard_paste_key(key) {
        return handle_clipboard_paste(app);
    }
    let ctx = crate::widgets::composer::ComposerContext {
        skills: &[],
        skill_usage: None,
        mention_candidates: &[],
    };
    let event = app.thread_ui.composer.handle_key(key, &ctx);
    if matches!(event, crate::widgets::composer::ComposerEvent::Blur) {
        if key.code == KeyCode::Tab && cycle_header_action(app, true) {
            return true;
        }
        app.thread_ui.composer.blur();
        app.thread_ui.focus = ThreadFocus::Transcript;
        return true;
    }
    if let crate::widgets::composer::ComposerEvent::Submit { .. } = event {
        let text = app.thread_ui.composer.submission_text();
        let images = app.thread_ui.composer.image_inputs();
        let delivered = if !text.is_empty() || !images.is_empty() {
            submit_composer(app, text, images)
        } else {
            false
        };
        if delivered {
            app.thread_ui.composer.clear_content();
        }
    }
    true
}

/// Drop the open thread when its conversation is deleted underneath it.
pub fn clear_if_matches(app: &mut App, project: &str, id: &str) {
    app.thread_ui.clear_if_matches(project, id);
}

/// Give a failed follow-up its draft back. The submitted text is never silently dropped.
pub fn restore_failed_delivery(app: &mut App, project: &str, id: &str) {
    app.thread_ui.restore_pending_prompt(project, id);
}

/// The action set a conversation actually supports. Finish, Continue, Review acceptance, and
/// the native CLI hand-off do not exist here: a turn ending is not a decision the user has to
/// ratify, and the composer is simply available again (sections 5.3 and 5.5).
fn apply_conversation_action(
    app: &mut App,
    record: &coducktor_contract::ConversationRecord,
    action: ThreadAction,
) {
    let project = app.thread_ui.data.project.clone();
    let id = record.id.clone();
    match action {
        ThreadAction::Cancel => {
            // Cancel is immediate and leaves the chat follow-up capable, so it needs no
            // destructive confirmation.
            app.pending
                .push(PendingAction::CancelConversationTurn { project, id });
            app.thread_ui.cancel_pending = true;
        }
        ThreadAction::Archive => app.pending.push(PendingAction::ArchiveConversation {
            project,
            id,
            archived: !record.archived,
        }),
        ThreadAction::MarkUnread => app
            .pending
            .push(PendingAction::UnreadConversation { project, id }),
        ThreadAction::Delete => {
            if record.state.is_active() {
                app.notice = Some("stop the current turn before deleting this chat".to_owned());
                return;
            }
            let mut targets = vec![format!("the transcript for \"{}\"", record.title)];
            if let Some(path) = record.worktree_path.as_deref() {
                targets.push(format!("its worktree at {path}"));
            }
            if let Some(branch) = record.branch.as_deref() {
                targets.push(format!("its branch {branch}"));
            }
            app.confirm = Some(crate::app::ConfirmRequest {
                text: format!("Delete {}?", targets.join(", ")),
                action: PendingAction::DeleteConversation { project, id },
            });
        }
        ThreadAction::RestartSession => {
            if record.state.is_active() {
                app.notice =
                    Some("stop the current turn before restarting the provider session".to_owned());
                return;
            }
            if !record.resume_failed {
                app.notice = Some(
                    "this chat's provider session resumes normally — nothing to restart".to_owned(),
                );
                return;
            }
            // Say exactly what will happen before it happens: a new session, and a bounded
            // excerpt of this chat replayed into it once.
            app.confirm = Some(crate::app::ConfirmRequest {
                text: format!(
                    "Start a new provider session for \"{}\"? The old session is abandoned, and \
                     your next message replays a bounded excerpt of this chat's messages into the \
                     new one. Nothing is sent until you send it.",
                    record.title
                ),
                action: PendingAction::RestartConversationSession { project, id },
            });
        }
        ThreadAction::ToggleGitMode => {
            if record.state.is_active() {
                app.notice = Some("git mode can only change while the chat is idle".to_owned());
                return;
            }
            let next = match record.git_mode {
                coducktor_contract::ConversationGitMode::Auto => {
                    coducktor_contract::ConversationGitMode::Manual
                }
                coducktor_contract::ConversationGitMode::Manual => {
                    coducktor_contract::ConversationGitMode::Auto
                }
            };
            if next == coducktor_contract::ConversationGitMode::Auto && !record.worktree {
                app.notice =
                    Some("git auto will commit and push this checkout's current branch".to_owned());
            }
            app.pending.push(PendingAction::SetConversationGitMode {
                project,
                id,
                git_mode: next,
            });
        }
        ThreadAction::FocusComposer => {
            app.thread_ui.focus = ThreadFocus::Composer;
            app.thread_ui.composer.focus();
        }
        ThreadAction::FocusTranscript => {
            app.thread_ui.composer.blur();
            app.thread_ui.focus = ThreadFocus::Transcript;
        }
        ThreadAction::OpenGitTab(tab) => {
            crate::screens::task_git::open(app, &project, &id, tab);
        }
        _ => {}
    }
}

/// The conversation timeline. One chronological transcript, a question card when the provider
/// is asking, a live row while a turn runs, and the composer — no step rail, review panel,
/// auto-resume hint, or take-over line (section 5.5).
fn render_conversation(
    frame: &mut Frame<'_>,
    area: Rect,
    app: &mut App,
    record: &coducktor_contract::ConversationRecord,
) {
    use coducktor_contract::ConversationState;

    let theme = app.theme;
    let ask = pending_ask(&app.thread_ui.data.state).cloned();
    let ask_height = ask
        .as_ref()
        .map(|ask| {
            let rows: usize = ask.questions.iter().map(|q| 1 + q.options.len()).sum();
            (rows as u16 + 2).min(12)
        })
        .unwrap_or(0);
    let hint_height = 1;
    let composer_height = app.thread_ui.composer.height_for_width(area.width).max(3);
    let dock_height = ask_height + hint_height + composer_height;

    let rows = Layout::default()
        .direction(Direction::Vertical)
        .constraints([
            Constraint::Length(5),
            Constraint::Min(3),
            Constraint::Length(dock_height),
        ])
        .split(area);

    widgets::render_conversation_header(
        frame,
        rows[0],
        record,
        &theme,
        &mut app.hitmap,
        app.thread_ui.header_action_focus,
        widgets::PlaceboDuckView::new(
            app.thread_ui.placebo_duck,
            app.animation_tick,
            app.keymap
                .key_for_action(KeyMode::Normal, ActionId::PetDuck)
                .unwrap_or("click"),
        ),
    );

    let transcript_title = format!(
        " Session  \u{b7}  {} tok{} ",
        record.tokens_used as i64,
        if app.thread_ui.transcript.unseen_count() > 0 {
            format!("  \u{b7}  {} new", app.thread_ui.transcript.unseen_count())
        } else {
            String::new()
        }
    );
    let transcript_block = Block::default()
        .title(transcript_title)
        .borders(Borders::TOP)
        .border_style(Style::default().fg(theme.palette.border));
    let transcript_area = transcript_block.inner(rows[1]);
    app.thread_ui.transcript_area = Some(transcript_area);
    frame.render_widget(transcript_block, rows[1]);
    if transcript_area.height > 0 {
        // Empty transcript space focuses the pane; per-row hits sit above it.
        app.hitmap.register(
            transcript_area,
            0,
            HitAction::ThreadScreen(ThreadAction::FocusTranscript),
        );
        app.thread_ui
            .transcript
            .set_pressure(transcript_area.height);
        app.thread_ui.transcript.render_interactive(
            frame.buffer_mut(),
            transcript_area,
            FrameCtx {
                theme: &theme,
                tick: app.animation_tick,
                now_epoch: app.now_epoch,
                expand_key: app
                    .keymap
                    .key_for_action(KeyMode::Normal, ActionId::ToggleTranscriptItem)
                    .unwrap_or("Enter"),
            },
            &mut app.hitmap,
        );
    }

    let dock_rows = Layout::default()
        .direction(Direction::Vertical)
        .constraints([
            Constraint::Length(ask_height),
            Constraint::Length(hint_height),
            Constraint::Length(composer_height),
        ])
        .split(rows[2]);

    // A structured question sits directly above the composer and owns the turn until answered.
    if let Some(ask) = &ask {
        widgets::render_ask_card(
            frame,
            dock_rows[0],
            ask,
            &app.thread_ui.ask_selections,
            app.thread_ui.ask_focus,
            &theme,
            &mut app.hitmap,
        );
    }

    let active = matches!(
        app.thread_ui.data.conversation_state(),
        Some(ConversationState::Queued | ConversationState::Running)
    );
    if active {
        let elapsed = record
            .active_turn
            .as_ref()
            .and_then(|turn| turn.started_at.as_deref())
            .map(|started| crate::screens::runs_util::short_age(started, app.now_epoch))
            .filter(|value| !value.is_empty())
            .unwrap_or_else(|| "0s".to_owned());
        let activity = if app.thread_ui.cancel_pending {
            "Stopping\u{2026}"
        } else {
            app.thread_ui
                .transcript
                .latest_running_tool_title()
                .unwrap_or_else(|| {
                    let status = app.thread_ui.data.view_model.current_status.trim();
                    if status.is_empty() { "Working" } else { status }
                })
        };
        widgets::render_live_activity(
            frame,
            dock_rows[1],
            activity,
            &elapsed,
            app.animation_tick,
            &theme,
        );
    } else {
        let hint = followup_blocked_reason(app)
            .or_else(|| session_restart_hint(app))
            .unwrap_or("Enter \u{b7} send");
        widgets::render_status_hint(frame, dock_rows[1], hint, &theme);
    }

    app.thread_ui
        .composer
        .render(frame, dock_rows[2], theme, &mut app.hitmap, 5);
    app.hitmap.register(
        dock_rows[2],
        4,
        HitAction::ThreadScreen(ThreadAction::FocusComposer),
    );
}

fn is_clipboard_paste_key(key: KeyEvent) -> bool {
    matches!(key.code, KeyCode::Char(character) if character.eq_ignore_ascii_case(&'v'))
        && key
            .modifiers
            .intersects(KeyModifiers::CONTROL | KeyModifiers::ALT)
}

fn handle_clipboard_paste(app: &mut App) -> bool {
    match crate::clipboard::read() {
        Ok(crate::clipboard::ClipboardContent::ImagePng(png)) => {
            app.thread_ui.composer.attach_clipboard_image(png);
            true
        }
        Ok(crate::clipboard::ClipboardContent::Text(text)) if text.is_empty() => true,
        Ok(crate::clipboard::ClipboardContent::Text(text)) => handle_paste(app, &text),
        Err(error) => {
            app.notice = Some(format!("Could not paste: {error}"));
            true
        }
    }
}

/// Whether the composer may send right now. Section 5.3: there is no in-flight message queue,
/// so a queued or running turn disables Send while the draft is preserved. A pending structured
/// question must be answered (or the turn cancelled) before an ordinary message is available.
pub fn can_send_followup(app: &App) -> bool {
    use coducktor_contract::ConversationState;

    let Some(state) = app.thread_ui.data.conversation_state() else {
        // Legacy records are historical and never accept a message.
        return false;
    };
    if app
        .thread_ui
        .data
        .conversation()
        .is_some_and(|record| record.archived)
    {
        return false;
    }
    matches!(
        state,
        ConversationState::Idle | ConversationState::Failed | ConversationState::Cancelled
    )
}

/// Why Send is unavailable, for the composer hint.
pub fn followup_blocked_reason(app: &App) -> Option<&'static str> {
    use coducktor_contract::ConversationState;

    match app.thread_ui.data.conversation_state() {
        None => Some("this is a historical task record — start a new chat to continue"),
        Some(_)
            if app
                .thread_ui
                .data
                .conversation()
                .is_some_and(|r| r.archived) =>
        {
            Some("unarchive this chat to send a message")
        }
        Some(ConversationState::Queued) => {
            Some("waiting for the harness to start — Ctrl-C stops it")
        }
        Some(ConversationState::Running) => Some("the harness is working — Ctrl-C stops it"),
        Some(ConversationState::NeedsInput) => Some("answer the question above to continue"),
        Some(_) => None,
    }
}

/// The composer's standing notice about this chat's provider session. Deliberately not a blocked
/// reason: after a failed resume the user may still just send — and after a restart, sending is
/// exactly what completes it. Both states have to be visible *before* the message goes, because
/// each changes what that message costs.
fn session_restart_hint(app: &App) -> Option<&'static str> {
    let record = app.thread_ui.data.conversation()?;
    if record.resume_failed {
        return Some(
            "the harness could not resume this session — [Restart session], or send to retry",
        );
    }
    let restart = record.session_restart.as_ref()?;
    restart.new_session_id.is_none().then_some(
        "Enter · send — starts a new provider session and replays a bounded excerpt of this chat",
    )
}

fn submit_composer(app: &mut App, text: String, images: Vec<ImageInput>) -> bool {
    if app.thread_ui.pending_prompt.is_some() {
        app.notice = Some("a message is already being delivered".to_owned());
        return false;
    }
    if let Some(record) = app.thread_ui.data.conversation().cloned() {
        if !can_send_followup(app) {
            // The draft is deliberately left intact: the user keeps typing while the turn runs
            // and sends once it ends.
            app.notice = followup_blocked_reason(app).map(ToOwned::to_owned);
            return false;
        }
        let project = app.thread_ui.data.project.clone();
        let pending_label = if text.is_empty() {
            "[Image]".to_owned()
        } else {
            text.clone()
        };
        app.thread_ui.set_pending_composer(pending_label, false);
        app.pending.push(PendingAction::SubmitConversationMessage {
            project,
            id: record.id.clone(),
            input: coducktor_contract::SubmitConversationMessageInput {
                text,
                images,
                skills: Vec::new(),
            },
        });
        return true;
    }
    app.notice = followup_blocked_reason(app).map(ToOwned::to_owned);
    false
}

fn handle_review_notes_key(app: &mut App, key: KeyEvent) -> bool {
    match key.code {
        KeyCode::Esc => app.thread_ui.focus = ThreadFocus::Transcript,
        KeyCode::Enter if key.modifiers.contains(KeyModifiers::CONTROL) => {
            apply_action(app, ThreadAction::ReviewSendBack);
        }
        KeyCode::Enter => app.thread_ui.review_notes.push('\n'),
        KeyCode::Backspace => {
            app.thread_ui.review_notes.pop();
        }
        KeyCode::Char(character) => app.thread_ui.review_notes.push(character),
        _ => {}
    }
    true
}

fn handle_ask_key(app: &mut App, key: KeyEvent) -> bool {
    let Some(ask) = pending_ask(&app.thread_ui.data.state).cloned() else {
        app.thread_ui.focus = ThreadFocus::Transcript;
        return true;
    };
    ensure_ask_selection_shape(app, &ask);
    let (question, option) = app.thread_ui.ask_focus;
    match key.code {
        KeyCode::Esc => app.thread_ui.focus = ThreadFocus::Transcript,
        KeyCode::Down | KeyCode::Char('j') => {
            if let Some(count) = ask.questions.get(question).map(|q| q.options.len()) {
                app.thread_ui.ask_focus.1 = (option + 1).min(count.saturating_sub(1));
            }
        }
        KeyCode::Up | KeyCode::Char('k') => {
            app.thread_ui.ask_focus.1 = option.saturating_sub(1);
        }
        KeyCode::Tab | KeyCode::Right => {
            app.thread_ui.ask_focus =
                ((question + 1).min(ask.questions.len().saturating_sub(1)), 0);
        }
        KeyCode::BackTab | KeyCode::Left => {
            app.thread_ui.ask_focus = (question.saturating_sub(1), 0);
        }
        KeyCode::Char(' ') => toggle_ask_option(app, &ask, question, option),
        KeyCode::Enter => {
            let one_tap = ask.questions.len() == 1 && ask.questions[0].multi_select != Some(true);
            if one_tap {
                toggle_ask_option(app, &ask, question, option);
                send_ask_answer(app, &ask);
            } else {
                send_ask_answer(app, &ask);
            }
        }
        _ => {}
    }
    true
}

fn ensure_ask_selection_shape(app: &mut App, ask: &ThreadAsk) {
    if app.thread_ui.ask_selections.len() != ask.questions.len() {
        app.thread_ui.ask_selections = vec![Vec::new(); ask.questions.len()];
    }
}

fn toggle_ask_option(app: &mut App, ask: &ThreadAsk, question: usize, option: usize) {
    ensure_ask_selection_shape(app, ask);
    let Some(question_def) = ask.questions.get(question) else {
        return;
    };
    let Some(label) = question_def
        .options
        .get(option)
        .map(|option| option.label.clone())
    else {
        return;
    };
    let multi = question_def.multi_select == Some(true);
    let Some(selected) = app.thread_ui.ask_selections.get_mut(question) else {
        return;
    };
    if multi {
        if let Some(index) = selected.iter().position(|existing| existing == &label) {
            selected.remove(index);
        } else {
            selected.push(label);
        }
    } else {
        *selected = vec![label];
    }
}

fn send_ask_answer(app: &mut App, ask: &ThreadAsk) {
    let text = ask
        .questions
        .iter()
        .enumerate()
        .map(|(index, question)| {
            let labels = app
                .thread_ui
                .ask_selections
                .get(index)
                .cloned()
                .unwrap_or_default();
            format!("{}: {}", question.header, labels.join(", "))
        })
        .collect::<Vec<_>>()
        .join("\n");
    if text.trim().is_empty() {
        return;
    }
    // A conversation answers the exact pending request on the runner-owned path. This continues
    // the still-pending provider turn rather than starting a second one, so it must never be
    // delivered as an ordinary message (sections 4.4 and 7.2).
    if let Some(record) = app.thread_ui.data.conversation().cloned() {
        let answers = ask
            .questions
            .iter()
            .enumerate()
            .filter_map(|(index, question)| {
                let values = app
                    .thread_ui
                    .ask_selections
                    .get(index)
                    .cloned()
                    .unwrap_or_default();
                let question_id = question.id.clone()?;
                (!values.is_empty()).then_some(coducktor_contract::ConversationQuestionAnswer {
                    question_id,
                    values,
                })
            })
            .collect::<Vec<_>>();
        if answers.is_empty() {
            app.notice = Some("choose an answer first".to_owned());
            return;
        }
        app.pending.push(PendingAction::AnswerConversationQuestion {
            project: app.thread_ui.data.project.clone(),
            id: record.id,
            input: coducktor_contract::AnswerConversationQuestionInput {
                request_id: ask.id.clone(),
                answers,
            },
        });
        return;
    }
    app.notice =
        Some("this historical task is read-only — start a new chat to continue".to_owned());
    app.thread_ui.ask_selections.clear();
    app.thread_ui.focus = ThreadFocus::Transcript;
}

pub fn apply_hit(app: &mut App, action: ThreadAction) {
    match action {
        ThreadAction::PetDuck => app.thread_ui.placebo_duck.pet(app.animation_tick),
        ThreadAction::AskOption { question, option } => {
            if let Some(ask) = pending_ask(&app.thread_ui.data.state).cloned() {
                ensure_ask_selection_shape(app, &ask);
                app.thread_ui.ask_focus = (question, option);
                let one_tap =
                    ask.questions.len() == 1 && ask.questions[0].multi_select != Some(true);
                toggle_ask_option(app, &ask, question, option);
                if one_tap {
                    send_ask_answer(app, &ask);
                }
            }
        }
        ThreadAction::AskSend => {
            if let Some(ask) = pending_ask(&app.thread_ui.data.state).cloned() {
                send_ask_answer(app, &ask);
            }
        }
        // Both are conversation-only controls; a legacy record has no idle Git policy to flip
        // and no provider session to restart.
        ThreadAction::ToggleGitMode | ThreadAction::RestartSession => {}
        ThreadAction::ToggleTimelineItem(index) => {
            app.thread_ui.focus = ThreadFocus::Transcript;
            app.thread_ui.transcript.select(index);
            app.thread_ui.transcript.toggle_selected();
        }
        ThreadAction::OpenSubagent(id) => app.thread_ui.subagent_sheet = Some(id),
        ThreadAction::CloseSubagentSheet => app.thread_ui.subagent_sheet = None,
        ThreadAction::ToggleStepRail => {
            app.thread_ui.steps_collapsed = !app.thread_ui.steps_collapsed
        }
        ThreadAction::FocusComposer => {
            app.thread_ui.focus = ThreadFocus::Composer;
            app.thread_ui.composer.focus();
        }
        ThreadAction::FocusTranscript => {
            app.thread_ui.composer.blur();
            app.thread_ui.focus = ThreadFocus::Transcript;
        }
        ThreadAction::FocusReviewNotes => app.thread_ui.focus = ThreadFocus::ReviewNotes,
        ThreadAction::ReviewSendBack => apply_action(app, ThreadAction::ReviewSendBack),
        ThreadAction::OpenGitTab(tab) => {
            let project = app.thread_ui.data.project.clone();
            let id = app.thread_ui.data.run_id.clone();
            crate::screens::task_git::open(app, &project, &id, tab);
        }
        other => apply_action(app, other),
    }
}

fn apply_action(app: &mut App, action: ThreadAction) {
    if let Some(record) = app.thread_ui.data.conversation().cloned() {
        apply_conversation_action(app, &record, action);
        return;
    }
    let Some(run) = app.thread_ui.data.run().cloned() else {
        return;
    };
    let project = app.thread_ui.data.project.clone();
    let id = app.thread_ui.data.run_id.clone();
    match action {
        // Both are conversation-only controls; a legacy record has no idle Git policy to flip
        // and no provider session to restart.
        ThreadAction::ToggleGitMode | ThreadAction::RestartSession => {}
        ThreadAction::Archive => app.pending.push(PendingAction::Archive {
            project,
            id,
            archived: !run.record.archived,
        }),
        ThreadAction::MarkUnread => app.pending.push(PendingAction::Unread { project, id }),
        ThreadAction::Cancel => app.notice = Some("this historical task is read-only".to_owned()),
        ThreadAction::Delete => {
            app.confirm = Some(crate::app::ConfirmRequest {
                text: format!(
                    "Delete \"{}\" and its branch?",
                    crate::screens::runs_util::run_title(&run)
                ),
                action: PendingAction::Delete { project, id },
            })
        }
        ThreadAction::ReviewSendBack | ThreadAction::ReviewAccept => {
            app.notice =
                Some("this historical task is read-only — start a new chat to continue".to_owned())
        }
        ThreadAction::ReviewDraftPr => app.pending.push(PendingAction::CreatePr { project, id }),
        ThreadAction::ReviewOpenPr => {
            if let Some(url) = run.record.pull_request_url.clone() {
                app.open_url(&url);
            }
        }
        ThreadAction::CancelAutoResume | ThreadAction::RemoveQueuedMessage(_) => {
            app.notice = Some("this historical task is read-only".to_owned())
        }
        ThreadAction::AskOption { .. }
        | ThreadAction::AskSend
        | ThreadAction::ToggleTimelineItem(_)
        | ThreadAction::OpenSubagent(_)
        | ThreadAction::CloseSubagentSheet
        | ThreadAction::ToggleStepRail
        | ThreadAction::FocusComposer
        | ThreadAction::FocusTranscript
        | ThreadAction::FocusReviewNotes
        | ThreadAction::PetDuck
        | ThreadAction::OpenGitTab(_) => {}
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::input::keymap::Keymap;
    use crate::theme::Theme;
    use coducktor_contract::{RunRecord, StepKind, StepState, StepStatus};
    use crossterm::event::{Event, KeyModifiers, MouseButton, MouseEvent, MouseEventKind};
    use ratatui::Terminal;
    use ratatui::backend::TestBackend;
    use serde_json::json;

    fn run(status: RunStatus, task: &str) -> ApiRun {
        ApiRun {
            record: RunRecord {
                id: "run-1".to_owned(),
                title: "Ship the shell".to_owned(),
                workflow: "quick-task".to_owned(),
                task: task.to_owned(),
                status,
                created_at: "2026-08-15T00:00:00Z".to_owned(),
                steps: vec![StepState {
                    id: "s1".to_owned(),
                    name: "agent".to_owned(),
                    kind: StepKind::Agent,
                    status: StepStatus::Running,
                    iterations: 1.0,
                    tokens_used: 0.0,
                    input_tokens: None,
                    output_tokens: None,
                    usage_invocations_started: None,
                    usage_invocations_observed: None,
                    usage_turns_started: None,
                    usage_turns_recorded: None,
                    usage_invocation_epoch: None,
                    started_at: None,
                    finished_at: None,
                    error: None,
                    session_id: Some("sess-1".to_owned()),
                    backend: None,
                    requested_runner: None,
                    profile_id: None,
                    reasoning_effort: None,
                    cost_usd: None,
                    model_identity: None,
                    route_key: None,
                    recovery_generation: None,
                    routing_decision: None,
                    extra: serde_json::Map::new(),
                }],
                ..RunRecord::default()
            },
            usage: None,
        }
    }

    fn event(seq: f64, event_type: &str, extra: serde_json::Value) -> RunEvent {
        RunEvent {
            seq,
            ts: "2026-08-15T00:00:00Z".to_owned(),
            step_id: Some("s1".to_owned()),
            event_type: event_type.to_owned(),
            extra: extra.as_object().cloned().unwrap_or_default(),
        }
    }

    fn realistic_v2_event(sequence: u64) -> RunEvent {
        let item_index = sequence / 32;
        let offset = sequence % 32;
        let is_tool = item_index.is_multiple_of(2);
        let id = if is_tool {
            format!("tool-{item_index}")
        } else {
            format!("message-{item_index}")
        };
        let (event_type, extra) = match offset {
            0 if is_tool => (
                "item.started",
                json!({"item": {"kind": "tool", "id": id, "name": "Bash", "toolKind": "execute", "title": "Run cargo test --workspace", "status": "running", "input": {"command": "cargo test --workspace"}}}),
            ),
            0 => (
                "item.started",
                json!({"item": {"kind": "message", "id": id, "role": "assistant", "text": "", "phase": "commentary"}}),
            ),
            31 if is_tool => (
                "item.completed",
                json!({"item": {"kind": "tool", "id": id, "name": "Bash", "toolKind": "execute", "title": "Run cargo test --workspace", "status": "completed", "input": {"command": "cargo test --workspace"}, "output": (0..80).map(|line| format!("test case {line}: ok")).collect::<Vec<_>>().join("\n"), "exitCode": 0}}),
            ),
            31 => (
                "item.completed",
                json!({"item": {"kind": "message", "id": id, "role": "assistant", "text": "### Progress\n\nThe focused change is in place, and the relevant tests are passing.", "phase": "commentary"}}),
            ),
            _ if is_tool => (
                "item.delta",
                json!({"itemId": id, "field": "output", "delta": "checking target... ok\n"}),
            ),
            _ => (
                "item.delta",
                json!({"itemId": id, "field": "text", "delta": "Streaming markdown. "}),
            ),
        };
        event((sequence + 1) as f64, event_type, extra)
    }

    fn app_with_run(status: RunStatus) -> App {
        let mut app = App::new("main", Theme::detect(), Keymap::default());
        app.thread_ui.load(
            "main".to_owned(),
            "run-1".to_owned(),
            ThreadSubject::LegacyRun(Box::new(run(status, "Ship the shell"))),
            Vec::new(),
            -1.0,
            None,
        );
        app.navigate_route(crate::app::Route::Thread {
            project: "main".to_owned(),
            id: "run-1".to_owned(),
        });
        app
    }

    fn conversation(
        state: coducktor_contract::ConversationState,
    ) -> coducktor_contract::ConversationRecord {
        coducktor_contract::ConversationRecord {
            record_kind: coducktor_contract::RecordKind::Conversation,
            id: "chat-1".to_owned(),
            project_id: "main".to_owned(),
            title: "Ship the shell".to_owned(),
            initial_message: coducktor_contract::ConversationMessage {
                text: "ship the shell".to_owned(),
                images: Vec::new(),
                skill_attachments: Vec::new(),
                extra: Default::default(),
            },
            harness: coducktor_contract::Runner::Claude,
            model: None,
            reasoning: None,
            provider_session_id: None,
            repository_root: "/repo".to_owned(),
            cwd: "/repo".to_owned(),
            base_branch: Some("main".to_owned()),
            branch: Some("coducktor/chat-1".to_owned()),
            worktree: true,
            worktree_path: Some("/repo/.worktrees/chat-1".to_owned()),
            worktree_reclaimed_at: None,
            git_mode: coducktor_contract::ConversationGitMode::Manual,
            state,
            active_turn: None,
            latest_turn: None,
            created_at: "2026-08-22T10:00:00Z".to_owned(),
            updated_at: "2026-08-22T10:00:00Z".to_owned(),
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
            // Compatibility columns the legacy readers still project; a conversation carries
            // no workflow.
            workflow: String::new(),
            task: String::new(),
            steps: Vec::new(),
            extra: Default::default(),
        }
    }

    fn app_with_conversation(state: coducktor_contract::ConversationState) -> App {
        let mut app = App::new("main", Theme::detect(), Keymap::default());
        app.thread_ui.load(
            "main".to_owned(),
            "chat-1".to_owned(),
            ThreadSubject::Conversation(Box::new(conversation(state))),
            Vec::new(),
            -1.0,
            None,
        );
        app.navigate_route(crate::app::Route::Thread {
            project: "main".to_owned(),
            id: "chat-1".to_owned(),
        });
        app
    }

    #[test]
    fn an_active_turn_disables_send_but_keeps_the_draft() {
        use coducktor_contract::ConversationState;

        for state in [ConversationState::Queued, ConversationState::Running] {
            let mut app = app_with_conversation(state);
            assert!(!can_send_followup(&app), "{state:?} must not accept a send");
            app.thread_ui.composer.set_text("the next thing");

            let delivered = submit_composer(&mut app, "the next thing".to_owned(), Vec::new());

            assert!(!delivered);
            assert!(
                !app.pending.iter().any(|action| matches!(
                    action,
                    PendingAction::SubmitConversationMessage { .. }
                )),
                "no in-flight message queue exists"
            );
            assert_eq!(
                app.thread_ui.composer.text, "the next thing",
                "the draft survives so the user can send it when the turn ends"
            );
        }
    }

    #[test]
    fn a_settled_conversation_accepts_exactly_one_follow_up() {
        use coducktor_contract::ConversationState;

        for state in [
            ConversationState::Idle,
            ConversationState::Failed,
            ConversationState::Cancelled,
        ] {
            let mut app = app_with_conversation(state);
            assert!(can_send_followup(&app), "{state:?} may send");

            assert!(submit_composer(&mut app, "next".to_owned(), Vec::new()));

            let sends = app
                .pending
                .iter()
                .filter(|action| matches!(action, PendingAction::SubmitConversationMessage { .. }))
                .count();
            assert_eq!(sends, 1, "one user message is exactly one queued turn");
        }
    }

    #[test]
    fn sending_a_follow_up_after_scrolling_up_jumps_back_to_the_bottom() {
        // Reading earlier output while the turn is idle is normal; sending a follow-up from
        // there must still surface the new prompt instead of leaving it off-screen, looking
        // like it was never sent (matches every other coding harness).
        let mut app = app_with_conversation(coducktor_contract::ConversationState::Idle);
        for index in 0..50 {
            app.thread_ui.push_event(
                index as f64,
                event(
                    index as f64,
                    "text",
                    json!({"text": format!("line {index}")}),
                ),
            );
        }
        app.thread_ui.transcript_area = Some(Rect::new(0, 0, 60, 10));
        app.thread_ui.transcript.scroll_by(-1_000_000);
        assert!(!app.thread_ui.transcript.sticky_bottom());

        assert!(submit_composer(&mut app, "next".to_owned(), Vec::new()));

        assert!(app.thread_ui.transcript.sticky_bottom());
    }

    #[test]
    fn a_pending_question_blocks_an_ordinary_follow_up() {
        let mut app = app_with_conversation(coducktor_contract::ConversationState::NeedsInput);
        assert!(!can_send_followup(&app));
        assert!(
            followup_blocked_reason(&app).is_some_and(|reason| reason.contains("question")),
            "the composer explains why it is unavailable"
        );
        assert!(!submit_composer(
            &mut app,
            "unrelated".to_owned(),
            Vec::new()
        ));
    }

    #[test]
    fn answering_a_question_uses_the_runner_path_not_a_second_message() {
        let mut app = app_with_conversation(coducktor_contract::ConversationState::NeedsInput);
        let ask = crate::screens::thread::reducer::ThreadAsk {
            id: "req-7".to_owned(),
            questions: vec![coducktor_protocol::ui_events::UiAskQuestion {
                id: Some("library".to_owned()),
                header: "Library".to_owned(),
                question: "Which one?".to_owned(),
                options: Vec::new(),
                multi_select: Some(false),
            }],
            resolved: false,
            answer: None,
        };
        app.thread_ui.ask_selections = vec![vec!["serde".to_owned()]];
        app.pending.clear();

        send_ask_answer(&mut app, &ask);

        let Some(PendingAction::AnswerConversationQuestion { input, .. }) = app.pending.first()
        else {
            panic!(
                "the answer travels the runner-owned path: {:?}",
                app.pending
            );
        };
        assert_eq!(input.request_id, "req-7");
        assert_eq!(input.answers[0].question_id, "library");
        assert_eq!(input.answers[0].values, vec!["serde".to_owned()]);
        assert!(
            !app.pending
                .iter()
                .any(|action| matches!(action, PendingAction::SubmitConversationMessage { .. })),
            "answering must not open a second provider turn"
        );
    }

    #[test]
    fn a_live_record_update_returns_the_composer_at_turn_end() {
        use coducktor_contract::ConversationState;

        let mut app = app_with_conversation(ConversationState::Running);
        assert!(
            !can_send_followup(&app),
            "a running turn holds the composer"
        );

        // This is the event the engine publishes when the provider's turn ends.
        let mut settled = conversation(ConversationState::Idle);
        settled.seen_at = None;
        app.apply_workspace_event(crate::app::WorkspaceEvent::Conversation {
            project: "main".to_owned(),
            record: Box::new(settled),
        });

        assert_eq!(
            app.thread_ui.data.conversation_state(),
            Some(ConversationState::Idle)
        );
        assert!(
            can_send_followup(&app),
            "turn end alone makes the composer available — no user decision"
        );
        assert!(app.pending.iter().any(|action| matches!(
            action,
            PendingAction::LoadThread { project, id }
                if project == "main" && id == "chat-1"
        )));
        assert!(
            app.project_tasks
                .get("main")
                .is_some_and(|state| state.conversations.iter().any(|row| row.id == "chat-1")),
            "the browser row updates from the same event"
        );
    }

    #[test]
    fn chat_mutations_never_travel_the_run_managers_actions() {
        use coducktor_contract::ConversationState;

        // Conversations and legacy runs are separate managers, so a run action carrying a
        // conversation id would simply not be found.
        let mut app = app_with_conversation(ConversationState::Idle);
        app.pending.clear();
        apply_action(&mut app, ThreadAction::Archive);
        apply_action(&mut app, ThreadAction::MarkUnread);
        apply_action(&mut app, ThreadAction::Delete);
        if let Some(confirm) = app.confirm.take() {
            app.pending.push(confirm.action);
        }

        assert!(
            app.pending.iter().all(|action| !matches!(
                action,
                PendingAction::Archive { .. }
                    | PendingAction::Unread { .. }
                    | PendingAction::Delete { .. }
            )),
            "a chat must not be routed through run actions: {:?}",
            app.pending
        );
        assert!(
            app.pending
                .iter()
                .any(|action| matches!(action, PendingAction::ArchiveConversation { .. }))
        );
        assert!(
            app.pending
                .iter()
                .any(|action| matches!(action, PendingAction::UnreadConversation { .. }))
        );
        assert!(
            app.pending
                .iter()
                .any(|action| matches!(action, PendingAction::DeleteConversation { .. }))
        );
    }

    fn app_with_failed_resume() -> App {
        use coducktor_contract::ConversationState;
        let mut app = app_with_conversation(ConversationState::Failed);
        if let Some(ThreadSubject::Conversation(record)) = app.thread_ui.data.subject.as_mut() {
            record.resume_failed = true;
            record.provider_session_id = Some("session-1".to_owned());
        }
        app
    }

    fn app_with_pending_restart() -> App {
        use coducktor_contract::ConversationState;
        let mut app = app_with_conversation(ConversationState::Idle);
        if let Some(ThreadSubject::Conversation(record)) = app.thread_ui.data.subject.as_mut() {
            record.session_restart = Some(coducktor_contract::ConversationSessionRestart {
                restarted_at: "2026-08-23T00:00:00.000Z".to_owned(),
                previous_session_id: Some("session-1".to_owned()),
                new_session_id: None,
                handoff_boundary_seq: 12.0,
                handoff_messages: 4,
                handoff_bytes: 900,
                handoff_truncated: false,
                extra: Default::default(),
            });
        }
        app
    }

    /// Replaying a transcript is the one thing the cockpit otherwise never does, so it is offered
    /// only where it is the actual repair, and only behind a confirmation that says so.
    #[test]
    fn a_session_restart_is_offered_only_after_a_failed_resume_and_always_confirms() {
        use coducktor_contract::ConversationState;

        let ordinary = app_with_conversation(ConversationState::Failed);
        let record = ordinary.thread_ui.data.conversation().unwrap();
        assert!(
            !widgets::conversation_header_actions(record)
                .iter()
                .any(|(label, _)| *label == "Restart session"),
            "an ordinary failure is not a resume failure"
        );

        let mut app = app_with_failed_resume();
        let record = app.thread_ui.data.conversation().unwrap().clone();
        assert!(
            widgets::conversation_header_actions(&record)
                .iter()
                .any(|(label, _)| *label == "Restart session")
        );

        app.pending.clear();
        apply_action(&mut app, ThreadAction::RestartSession);
        assert!(
            app.pending.is_empty(),
            "a restart never happens without confirmation"
        );
        let confirm = app.confirm.expect("a restart confirms first");
        assert!(
            confirm.text.contains("new provider session")
                && confirm.text.contains("replays")
                && confirm.text.contains("Nothing is sent until you send it"),
            "the confirmation must say what happens and when: {}",
            confirm.text
        );
        assert!(matches!(
            confirm.action,
            PendingAction::RestartConversationSession { .. }
        ));
    }

    #[test]
    fn a_restart_is_refused_while_a_turn_is_running() {
        use coducktor_contract::ConversationState;

        let mut app = app_with_conversation(ConversationState::Running);
        if let Some(ThreadSubject::Conversation(record)) = app.thread_ui.data.subject.as_mut() {
            record.resume_failed = true;
        }
        app.pending.clear();
        apply_action(&mut app, ThreadAction::RestartSession);

        assert!(app.confirm.is_none());
        assert!(app.pending.is_empty());
        assert!(app.notice.is_some());
    }

    /// The user has to know a restart is armed *before* they send, because that message is what
    /// pays for it.
    #[test]
    fn the_composer_says_a_pending_restart_will_replay_on_the_next_message() {
        let failed = app_with_failed_resume();
        assert_eq!(
            session_restart_hint(&failed),
            Some("the harness could not resume this session — [Restart session], or send to retry")
        );

        let armed = app_with_pending_restart();
        assert!(can_send_followup(&armed), "a restart never blocks sending");
        assert!(followup_blocked_reason(&armed).is_none());
        let hint = session_restart_hint(&armed).expect("an armed restart is announced");
        assert!(hint.contains("new provider session") && hint.contains("bounded excerpt"));

        // Once the new session has taken, the composer goes back to saying nothing special.
        let mut settled = app_with_pending_restart();
        if let Some(ThreadSubject::Conversation(record)) = settled.thread_ui.data.subject.as_mut()
            && let Some(restart) = record.session_restart.as_mut()
        {
            restart.new_session_id = Some("session-2".to_owned());
        }
        assert_eq!(session_restart_hint(&settled), None);
    }

    #[test]
    fn a_legacy_record_is_read_only() {
        let app = app_with_run(RunStatus::Done);
        assert!(
            !can_send_followup(&app),
            "a historical task record never accepts a message"
        );
        assert!(
            app.thread_ui
                .data
                .subject
                .as_ref()
                .is_some_and(|subject| !subject.is_interactive())
        );
    }

    #[test]
    fn a_conversation_offers_no_review_accept() {
        use coducktor_contract::ConversationState;

        let action = ThreadAction::ReviewAccept;
        let mut app = app_with_conversation(ConversationState::Idle);
        app.pending.clear();
        apply_action(&mut app, action.clone());
        assert!(
            app.pending.is_empty(),
            "{action:?} must not be reachable on a conversation"
        );
    }

    #[test]
    fn cancel_is_immediate_and_delete_waits_for_a_settled_turn() {
        use coducktor_contract::ConversationState;

        let mut running = app_with_conversation(ConversationState::Running);
        running.pending.clear();
        apply_action(&mut running, ThreadAction::Cancel);
        assert!(
            running
                .pending
                .iter()
                .any(|action| matches!(action, PendingAction::CancelConversationTurn { .. })),
            "cancel needs no confirmation — it leaves the chat follow-up capable"
        );
        assert!(running.confirm.is_none());

        let mut active = app_with_conversation(ConversationState::Running);
        active.pending.clear();
        apply_action(&mut active, ThreadAction::Delete);
        assert!(
            active.confirm.is_none(),
            "delete is refused while a turn runs"
        );
        assert!(active.notice.is_some());

        let mut idle = app_with_conversation(ConversationState::Idle);
        apply_action(&mut idle, ThreadAction::Delete);
        let confirm = idle.confirm.expect("a settled chat confirms deletion");
        assert!(
            confirm.text.contains("worktree") && confirm.text.contains("branch"),
            "the confirmation names every managed target: {}",
            confirm.text
        );
    }

    #[test]
    fn a_large_live_batch_rebuilds_the_transcript_once() {
        let mut app = app_with_run(RunStatus::Running);
        let metrics_before = app.thread_ui.projection_metrics();

        app.thread_ui.push_events((1..=1_000).map(|seq| {
            let seq = f64::from(seq);
            (
                seq,
                event(seq, "text", json!({"text": format!("chunk {seq}")})),
            )
        }));

        let metrics = app.thread_ui.projection_metrics();
        assert_eq!(metrics.rebuilds - metrics_before.rebuilds, 1);
        assert_eq!(
            metrics.rebuilt_events - metrics_before.rebuilt_events,
            1_000
        );
        assert!(metrics.rebuild_time >= metrics_before.rebuild_time);
        assert_eq!(app.thread_ui.data.events.len(), 1_000);
        assert_eq!(app.thread_ui.data.as_of_seq, 1_000.0);
    }

    #[test]
    fn a_sequence_hole_preserves_the_last_good_watermark_until_durable_reload() {
        let durable = (1..=4)
            .map(|seq| {
                event(
                    seq as f64,
                    "note",
                    json!({"message": format!("line {seq}")}),
                )
            })
            .collect::<Vec<_>>();
        let mut app = App::new("main", Theme::detect(), Keymap::default());
        app.thread_ui.load(
            "main".to_owned(),
            "run-1".to_owned(),
            ThreadSubject::LegacyRun(Box::new(run(RunStatus::Running, "Ship the shell"))),
            durable[..2].to_vec(),
            2.0,
            None,
        );

        let result = app.thread_ui.push_event(4.0, durable[3].clone());
        assert_eq!(result.dropped_events, 1);
        assert!(result.refresh_required);
        assert_eq!(app.thread_ui.data.as_of_seq, 2.0);
        assert_eq!(app.thread_ui.data.events.len(), 2);

        app.thread_ui.load(
            "main".to_owned(),
            "run-1".to_owned(),
            ThreadSubject::LegacyRun(Box::new(run(RunStatus::Running, "Ship the shell"))),
            durable,
            4.0,
            None,
        );
        assert_eq!(app.thread_ui.data.as_of_seq, 4.0);
        assert_eq!(app.thread_ui.data.events.len(), 4);
    }

    #[test]
    fn batched_projection_work_scales_linearly_with_accepted_events() {
        fn projection_work(event_count: u64) -> ThreadProjectionMetrics {
            let mut app = app_with_run(RunStatus::Running);
            let before = app.thread_ui.projection_metrics();
            app.thread_ui.push_events((1..=event_count).map(|seq| {
                let sequence = seq as f64;
                (sequence, event(sequence, "text", json!({"text": "delta"})))
            }));
            let after = app.thread_ui.projection_metrics();
            ThreadProjectionMetrics {
                rebuilds: after.rebuilds - before.rebuilds,
                rebuilt_events: after.rebuilt_events - before.rebuilt_events,
                rebuild_time: after.rebuild_time.saturating_sub(before.rebuild_time),
                projection_time: after.projection_time.saturating_sub(before.projection_time),
            }
        }

        let small = projection_work(1_000);
        let large = projection_work(2_000);
        assert_eq!(small.rebuilds, 1);
        assert_eq!(large.rebuilds, 1);
        assert_eq!(small.rebuilt_events, 1_000);
        assert_eq!(large.rebuilt_events, 2_000);
    }

    /// Production-shape guard: events arrive across many frame-sized batches, rather than in one
    /// call that can only demonstrate a linear single fold.
    #[test]
    fn doubling_accepted_events_does_not_quadruple_rebuild_time() {
        fn projection_work(event_count: u64) -> ThreadProjectionMetrics {
            let mut app = app_with_run(RunStatus::Running);
            let before = app.thread_ui.projection_metrics();
            for first in (0..event_count).step_by(8) {
                let end = (first + 8).min(event_count);
                app.thread_ui.push_events((first..end).map(|sequence| {
                    let event = realistic_v2_event(sequence);
                    (event.seq, event)
                }));
            }
            let after = app.thread_ui.projection_metrics();
            ThreadProjectionMetrics {
                rebuilds: after.rebuilds - before.rebuilds,
                rebuilt_events: after.rebuilt_events - before.rebuilt_events,
                rebuild_time: after.rebuild_time.saturating_sub(before.rebuild_time),
                projection_time: after.projection_time.saturating_sub(before.projection_time),
            }
        }

        let small = projection_work(1_000);
        let large = projection_work(2_000);
        assert_eq!(small.rebuilds, 125);
        assert_eq!(large.rebuilds, 250);
        assert_eq!(small.rebuilt_events, 1_000);
        assert_eq!(large.rebuilt_events, 2_000);
        assert!(
            large.rebuilt_events <= small.rebuilt_events * 3
                && large.rebuild_time < small.rebuild_time * 3,
            "doubling accepted events rebuilt {large:?} against {small:?}; frame-batched \
             projection is still quadratic"
        );
    }

    #[test]
    fn live_thread_frame_at_twelve_thousand_events_stays_under_eight_ms() {
        use ratatui::buffer::Buffer;

        let mut app = app_with_run(RunStatus::Running);
        let theme = Theme::detect();
        let viewport = Rect::new(0, 0, 120, 40);
        for first in (0..11_992_u64).step_by(8) {
            app.thread_ui
                .push_events((first..first + 8).map(|sequence| {
                    let event = realistic_v2_event(sequence);
                    (event.seq, event)
                }));
            let mut buffer = Buffer::empty(viewport);
            app.thread_ui.transcript.render(
                &mut buffer,
                viewport,
                FrameCtx {
                    expand_key: "za",
                    theme: &theme,
                    tick: 0,
                    now_epoch: 0,
                },
            );
        }

        let metrics_before = app.thread_ui.projection_metrics();
        let started = Instant::now();
        app.thread_ui.push_events((11_992..12_000).map(|sequence| {
            let event = realistic_v2_event(sequence);
            (event.seq, event)
        }));
        let mut buffer = Buffer::empty(viewport);
        app.thread_ui.transcript.render(
            &mut buffer,
            viewport,
            FrameCtx {
                expand_key: "za",
                theme: &theme,
                tick: 0,
                now_epoch: 0,
            },
        );
        let metrics_after = app.thread_ui.projection_metrics();
        let elapsed = started.elapsed();
        let budget = if cfg!(debug_assertions) {
            Duration::from_millis(30)
        } else {
            Duration::from_millis(8)
        };
        assert!(
            elapsed < budget,
            "12,000-event live frame took {elapsed:?}; target is <8ms in the optimized profile; \
             reduction {:?}, projection {:?}",
            metrics_after
                .rebuild_time
                .saturating_sub(metrics_before.rebuild_time),
            metrics_after
                .projection_time
                .saturating_sub(metrics_before.projection_time),
        );
    }

    #[test]
    fn clicking_the_composer_focuses_it_and_places_the_caret() {
        let mut app = app_with_conversation(coducktor_contract::ConversationState::Idle);
        app.thread_ui.composer.set_text("hello world");
        render_to_string(&mut app);
        let Some(area) = app.thread_ui.composer.input_area() else {
            panic!("the composer has been rendered");
        };
        app.thread_ui.focus = ThreadFocus::Transcript;
        app.thread_ui.composer.blur();

        app.handle_event(Event::Mouse(MouseEvent {
            kind: MouseEventKind::Down(MouseButton::Left),
            // Inner text starts one row of border and one leading space in; column 3
            // places the caret after "hel".
            column: area.x + 2 + 3,
            row: area.y + 1,
            modifiers: KeyModifiers::NONE,
        }));

        assert_eq!(app.thread_ui.focus, ThreadFocus::Composer);
        assert!(app.thread_ui.composer.focused);
        assert_eq!(app.thread_ui.composer.caret, 3);
    }

    #[test]
    fn clicking_the_composer_releases_sidebar_focus_for_immediate_typing() {
        let mut app = app_with_conversation(coducktor_contract::ConversationState::Idle);
        render_to_string(&mut app);
        let Some(area) = app.thread_ui.composer.input_area() else {
            panic!("the composer has been rendered");
        };
        app.focus_sidebar();

        app.handle_event(Event::Mouse(MouseEvent {
            kind: MouseEventKind::Down(MouseButton::Left),
            column: area.x + 2,
            row: area.y + 1,
            modifiers: KeyModifiers::NONE,
        }));
        app.handle_event(Event::Key(KeyEvent::new(
            KeyCode::Char('x'),
            KeyModifiers::NONE,
        )));

        assert_eq!(app.thread_ui.composer.text, "x");
    }

    #[test]
    fn clicking_the_transcript_focuses_it_and_blurs_the_composer() {
        let mut app = app_with_conversation(coducktor_contract::ConversationState::Idle);
        render_to_string(&mut app);
        let Some(area) = app.thread_ui.transcript_area else {
            panic!("the transcript has been rendered");
        };
        app.thread_ui.focus = ThreadFocus::Composer;
        app.thread_ui.composer.focus();

        app.handle_event(Event::Mouse(MouseEvent {
            kind: MouseEventKind::Down(MouseButton::Left),
            column: area.x + 2,
            row: area.y,
            modifiers: KeyModifiers::NONE,
        }));

        assert_eq!(app.thread_ui.focus, ThreadFocus::Transcript);
        assert!(!app.thread_ui.composer.focused);
    }

    #[test]
    fn mouse_wheel_scrolls_the_transcript() {
        let mut app = app_with_run(RunStatus::Running);
        for index in 0..50 {
            app.thread_ui
                .transcript
                .push(TranscriptItem::Note(NoteItem::new(
                    format!("n{index}"),
                    format!("note {index}"),
                    TranscriptNoteTone::Dim,
                )));
        }
        app.thread_ui.transcript_area = Some(Rect::new(10, 5, 60, 10));
        app.thread_ui.transcript.scroll_by(10);

        app.handle_event(Event::Mouse(MouseEvent {
            kind: MouseEventKind::ScrollUp,
            column: 20,
            row: 8,
            modifiers: KeyModifiers::NONE,
        }));

        assert!(!app.thread_ui.transcript.at_top());
    }

    #[test]
    fn opening_a_cached_task_paints_its_prompt_before_history_loads() {
        let mut app = App::new("main", Theme::detect(), Keymap::default());
        let cached = run(RunStatus::Running, "Fix the task experience");
        app.project_tasks
            .entry("main".to_owned())
            .or_default()
            .runs
            .push(cached);

        open(&mut app, "main", "run-1");

        assert_eq!(
            app.thread_ui.data.run().map(|run| run.record.task.as_str()),
            Some("Fix the task experience")
        );
        assert!(matches!(
            app.pending.as_slice(),
            [PendingAction::LoadThread { project, id }]
                if project == "main" && id == "run-1"
        ));
        let content = render_to_string(&mut app);
        assert!(content.contains("Fix the task experience"));
        assert!(!content.contains("Loading"));
    }

    fn render_to_string(app: &mut App) -> String {
        let mut terminal = Terminal::new(TestBackend::new(120, 40)).unwrap();
        terminal.draw(|frame| app.render(frame)).unwrap();
        terminal
            .backend()
            .buffer()
            .content
            .iter()
            .map(|cell| cell.symbol())
            .collect()
    }

    #[test]
    fn a_fresh_thread_focuses_the_composer_and_refresh_preserves_focus() {
        let mut app = app_with_run(RunStatus::Running);
        assert_eq!(app.thread_ui.focus, ThreadFocus::Composer);
        handle_key(
            &mut app,
            KeyEvent::new(KeyCode::Char('x'), KeyModifiers::NONE),
        );
        assert_eq!(app.thread_ui.composer.text, "x");

        app.thread_ui.focus = ThreadFocus::Transcript;
        app.thread_ui.composer.blur();
        let current = app.thread_ui.data.run().cloned().unwrap();
        app.thread_ui.load(
            "main".to_owned(),
            "run-1".to_owned(),
            ThreadSubject::LegacyRun(Box::new(current)),
            Vec::new(),
            -1.0,
            None,
        );
        assert_eq!(app.thread_ui.focus, ThreadFocus::Transcript);
    }

    #[test]
    fn escape_leaves_insert_mode_without_stopping_the_task() {
        let mut app = app_with_run(RunStatus::Running);
        assert!(handle_key(
            &mut app,
            KeyEvent::new(KeyCode::Esc, KeyModifiers::NONE)
        ));
        assert!(!app.thread_ui.cancel_pending);
        assert_eq!(app.thread_ui.focus, ThreadFocus::Transcript);
        assert!(app.pending.is_empty());
        assert!(app.confirm.is_none());

        assert!(!handle_key(
            &mut app,
            KeyEvent::new(KeyCode::Esc, KeyModifiers::NONE)
        ));
        assert_eq!(app.thread_ui.focus, ThreadFocus::Transcript);
        assert!(app.pending.is_empty());

        let mut queued = app_with_run(RunStatus::Queued);
        queued.thread_ui.focus = ThreadFocus::Transcript;
        queued.thread_ui.composer.blur();
        assert!(!handle_key(
            &mut queued,
            KeyEvent::new(KeyCode::Esc, KeyModifiers::NONE)
        ));
        assert!(!queued.thread_ui.cancel_pending);
        assert!(queued.pending.is_empty());
    }

    #[test]
    fn control_c_stops_a_live_conversation_without_dropping_its_draft() {
        let mut app = app_with_conversation(coducktor_contract::ConversationState::Running);
        app.thread_ui.composer.set_text("keep this draft");

        assert!(handle_key(
            &mut app,
            KeyEvent::new(KeyCode::Char('c'), KeyModifiers::CONTROL)
        ));

        assert!(app.thread_ui.cancel_pending);
        assert_eq!(app.thread_ui.composer.text, "keep this draft");
        assert!(app.pending.iter().any(|action| matches!(
            action,
            PendingAction::CancelConversationTurn { project, id }
                if project == "main" && id == "chat-1"
        )));
    }

    #[test]
    fn conversation_header_actions_are_keyboard_reachable() {
        let mut app = app_with_conversation(coducktor_contract::ConversationState::Idle);
        assert!(handle_key(
            &mut app,
            KeyEvent::new(KeyCode::Tab, KeyModifiers::NONE)
        ));
        assert_eq!(app.thread_ui.header_action_focus, Some(0));
    }

    #[test]
    fn placebo_duck_combo_decays_without_persisting_history() {
        let mut duck = PlaceboDuck::default();
        duck.pet(10);
        duck.pet(11);
        assert_eq!(duck.combo_at(11), 2);
        assert_eq!(duck.combo_at(11 + DUCK_COMBO_TICKS + 1), 0);

        duck.pet(11 + DUCK_COMBO_TICKS + 2);
        assert_eq!(duck.combo_at(11 + DUCK_COMBO_TICKS + 2), 1);
    }

    #[test]
    fn ctrl_g_pets_the_duck_without_editing_or_contacting_the_agent() {
        let mut app = app_with_conversation(coducktor_contract::ConversationState::Running);
        app.thread_ui.composer.set_text("draft stays put");
        app.pending.clear();
        app.animation_tick = 7;

        app.handle_event(Event::Key(KeyEvent::new(
            KeyCode::Char('g'),
            KeyModifiers::CONTROL,
        )));

        assert_eq!(app.thread_ui.placebo_duck.combo_at(7), 1);
        assert_eq!(app.thread_ui.composer.text, "draft stays put");
        assert!(
            app.pending.is_empty(),
            "the placebo must not queue engine work"
        );
    }

    #[test]
    fn the_visible_placebo_duck_is_clickable_and_disclosed() {
        let mut app = app_with_conversation(coducktor_contract::ConversationState::Running);
        let mut terminal = Terminal::new(TestBackend::new(120, 40)).unwrap();
        terminal.draw(|frame| app.render(frame)).unwrap();
        let content = terminal
            .backend()
            .buffer()
            .content()
            .iter()
            .map(|cell| cell.symbol())
            .collect::<String>();
        assert!(content.contains("morale only"));

        let target = (0..120).find_map(|column| {
            (0..40).find_map(|row| {
                matches!(
                    app.hitmap.hit(column, row),
                    Some(HitAction::ThreadScreen(ThreadAction::PetDuck))
                )
                .then_some((column, row))
            })
        });
        let (column, row) = target.expect("the responsive chat header should expose the duck");
        app.handle_event(Event::Mouse(MouseEvent {
            kind: MouseEventKind::Down(MouseButton::Left),
            column,
            row,
            modifiers: KeyModifiers::NONE,
        }));

        assert_eq!(app.thread_ui.placebo_duck.combo_at(app.animation_tick), 1);
        assert!(app.pending.is_empty(), "a click must remain TUI-local");

        app.handle_event(Event::Mouse(MouseEvent {
            kind: MouseEventKind::Down(MouseButton::Left),
            column,
            row,
            modifiers: KeyModifiers::NONE,
        }));
        terminal.draw(|frame| app.render(frame)).unwrap();
        let reacted = terminal
            .backend()
            .buffer()
            .content()
            .iter()
            .map(|cell| cell.symbol())
            .collect::<String>();
        assert!(reacted.contains("FASTER! x2"));
        assert!(app.pending.is_empty(), "the animation remains TUI-local");
    }

    #[test]
    fn idle_escape_only_drops_focus_and_bare_archive_finish_keys_are_inert() {
        let mut app = app_with_run(RunStatus::Idle);
        assert!(handle_key(
            &mut app,
            KeyEvent::new(KeyCode::Esc, KeyModifiers::NONE)
        ));
        assert_eq!(app.thread_ui.focus, ThreadFocus::Transcript);
        assert!(app.pending.is_empty());

        assert!(!handle_key(
            &mut app,
            KeyEvent::new(KeyCode::Char('a'), KeyModifiers::NONE)
        ));
        assert!(!handle_key(
            &mut app,
            KeyEvent::new(KeyCode::Char('f'), KeyModifiers::NONE)
        ));
        assert!(app.pending.is_empty());
        assert!(app.confirm.is_none());
    }

    #[test]
    fn live_activity_line_includes_the_running_tool_and_usage() {
        let mut app = app_with_run(RunStatus::Running);
        app.thread_ui.push_event(
            1.0,
            event(
                1.0,
                "item.started",
                json!({"item": {"kind": "tool", "id": "t1", "name": "Bash", "toolKind": "execute", "title": "Run cargo test -p coducktor-tui", "status": "running", "input": {"command": "cargo test -p coducktor-tui"}}}),
            ),
        );
        let content = render_to_string(&mut app);
        assert!(
            content.contains("Ran cargo test -p coducktor-tui · 0s")
                && content.contains("esc to stop"),
            "rendered thread: {content}"
        );
    }

    fn conversation_screen(
        state: coducktor_contract::ConversationState,
        width: u16,
        height: u16,
    ) -> String {
        let mut app = app_with_conversation(state);
        app.thread_ui.push_event(
            1.0,
            event(
                1.0,
                "item.completed",
                json!({"item": {"kind": "message", "id": "m1", "role": "assistant", "text": "On it."}}),
            ),
        );
        let mut terminal = Terminal::new(TestBackend::new(width, height)).unwrap();
        terminal.draw(|frame| app.render(frame)).unwrap();
        terminal
            .backend()
            .buffer()
            .content()
            .iter()
            .map(|cell| cell.symbol())
            .collect::<String>()
    }

    #[test]
    fn clicking_the_conversation_composer_focuses_it() {
        let mut app = app_with_conversation(coducktor_contract::ConversationState::Idle);
        app.thread_ui.focus = ThreadFocus::Transcript;
        app.thread_ui.composer.blur();
        let mut terminal = Terminal::new(TestBackend::new(120, 40)).unwrap();
        terminal.draw(|frame| app.render(frame)).unwrap();

        let target = (0..120).find_map(|column| {
            (0..40).find_map(|row| {
                matches!(
                    app.hitmap.hit(column, row),
                    Some(crate::input::hitmap::HitAction::ThreadScreen(
                        ThreadAction::FocusComposer
                    ))
                )
                .then_some((column, row))
            })
        });
        let (column, row) = target.expect("conversation composer should be clickable");
        app.handle_event(Event::Mouse(MouseEvent {
            kind: MouseEventKind::Down(MouseButton::Left),
            column,
            row,
            modifiers: KeyModifiers::NONE,
        }));

        assert_eq!(app.thread_ui.focus, ThreadFocus::Composer);
        assert!(app.thread_ui.composer.focused);
    }

    #[test]
    fn a_conversation_thread_shows_its_affinity_and_no_removed_control() {
        use coducktor_contract::ConversationState;

        for (width, height) in [(80u16, 24u16), (120, 40), (200, 60)] {
            let screen = conversation_screen(ConversationState::Idle, width, height);
            assert!(
                screen.contains("claude"),
                "the immutable harness is in the header at {width}x{height}"
            );
            assert!(
                screen.contains("git: manual"),
                "git mode is shown in the header"
            );
            assert!(screen.contains("worktree"));
            assert!(
                screen.contains("On it."),
                "conversation assistant output is visible at {width}x{height}"
            );
            // Scan only for strings the thread itself would draw. "Terminal" is excluded here
            // because the workspace sidebar legitimately offers an embedded terminal tab; the
            // thread's own control set is asserted exactly below instead.
            for removed in ["Send back", "take over", "Accept", "autonomous pass"] {
                assert!(
                    !screen.contains(removed),
                    "{removed:?} is still reachable at {width}x{height}"
                );
            }
        }

        // The header's control set is the authoritative list of what a chat can do.
        for state in [
            ConversationState::Idle,
            ConversationState::Running,
            ConversationState::NeedsInput,
            ConversationState::Failed,
            ConversationState::Cancelled,
        ] {
            let labels = widgets::conversation_header_actions(&conversation(state))
                .into_iter()
                .map(|(label, _)| label)
                .collect::<Vec<_>>();
            for removed in ["Finish", "Continue", "Terminal", "Accept", "Send back"] {
                assert!(
                    !labels.contains(&removed),
                    "{removed:?} must not be offered in {state:?}: {labels:?}"
                );
            }
        }
    }

    #[test]
    fn a_running_conversation_offers_cancel_and_says_why_send_is_unavailable() {
        let screen = conversation_screen(coducktor_contract::ConversationState::Running, 120, 40);
        assert!(screen.contains("Cancel"), "a live turn can be stopped");
        assert!(
            screen.contains("esc to stop"),
            "the live activity line exposes the stop affordance"
        );
        assert!(
            !screen.contains("queues a follow-up"),
            "there is no in-flight message queue"
        );
    }

    #[test]
    fn git_mode_only_toggles_while_idle() {
        use coducktor_contract::ConversationState;

        let mut idle = app_with_conversation(ConversationState::Idle);
        idle.pending.clear();
        apply_action(&mut idle, ThreadAction::ToggleGitMode);
        let Some(PendingAction::SetConversationGitMode { git_mode, .. }) = idle.pending.first()
        else {
            panic!("an idle chat can change its git policy: {:?}", idle.pending);
        };
        assert_eq!(*git_mode, coducktor_contract::ConversationGitMode::Auto);

        let mut running = app_with_conversation(ConversationState::Running);
        running.pending.clear();
        apply_action(&mut running, ThreadAction::ToggleGitMode);
        assert!(
            running.pending.is_empty(),
            "git mode governs post-turn behavior, so it cannot change mid-turn"
        );
        assert!(running.notice.is_some());
    }

    #[test]
    fn git_auto_is_allowed_for_an_in_place_conversation() {
        let mut app = app_with_conversation(coducktor_contract::ConversationState::Idle);
        let mut record = conversation(coducktor_contract::ConversationState::Idle);
        record.worktree = false;
        record.worktree_path = None;
        app.thread_ui.set_conversation(record);
        app.pending.clear();

        apply_action(&mut app, ThreadAction::ToggleGitMode);

        let Some(PendingAction::SetConversationGitMode { git_mode, .. }) = app.pending.first()
        else {
            panic!(
                "an in-place chat can still opt into automatic Git: {:?}",
                app.pending
            );
        };

        assert_eq!(*git_mode, coducktor_contract::ConversationGitMode::Auto);
        assert!(
            app.notice
                .as_deref()
                .is_some_and(|n| n.contains("checkout")),
            "the user is told the commit will land in the current checkout"
        );
    }
    #[test]
    fn tool_timestamps_become_duration_without_breaking_old_items() {
        let old: coducktor_protocol::UiToolItem = serde_json::from_value(json!({
            "id": "old",
            "name": "Bash",
            "toolKind": "execute",
            "title": "Run true",
            "status": "completed"
        }))
        .unwrap();
        assert!(old.started_at.is_none() && old.finished_at.is_none());

        let timed: coducktor_protocol::UiToolItem = serde_json::from_value(json!({
            "id": "timed",
            "name": "Bash",
            "toolKind": "execute",
            "title": "Run false",
            "status": "failed",
            "exitCode": 1,
            "startedAt": "2026-08-15T00:00:00.500Z",
            "finishedAt": "2026-08-15T00:00:01.750Z"
        }))
        .unwrap();
        let item = reuse_tool(&mut std::collections::HashMap::new(), &timed);
        let TranscriptItem::Tool(tool) = item else {
            panic!("expected a tool item");
        };
        assert_eq!(tool.duration_ms, Some(1_250));
        assert_eq!(tool.exit_code, Some(1));
        assert_eq!(
            tool.started_epoch,
            crate::screens::runs_util::parse_iso_seconds("2026-08-15T00:00:00.500Z")
        );
    }

    #[test]
    fn the_most_recently_appended_tool_call_is_marked_latest_and_expands() {
        let mut app = app_with_run(RunStatus::Running);
        app.thread_ui.push_event(
            1.0,
            event(
                1.0,
                "item.completed",
                json!({"item": {"kind": "tool", "id": "t1", "name": "Read", "toolKind": "read", "title": "Read a.rs", "status": "completed", "output": "fn a() {}"}}),
            ),
        );
        app.thread_ui.push_event(
            2.0,
            event(
                2.0,
                "item.completed",
                json!({"item": {"kind": "tool", "id": "t2", "name": "Bash", "toolKind": "execute", "title": "Run cargo test", "status": "completed", "output": "latest command output"}}),
            ),
        );

        let tools: Vec<_> = app
            .thread_ui
            .transcript
            .items()
            .iter()
            .filter_map(|item| match item {
                TranscriptItem::Tool(tool) => Some(tool),
                _ => None,
            })
            .collect();
        assert_eq!(tools.len(), 2);
        assert!(!tools[0].is_latest, "the earlier call is not latest");
        assert!(tools[1].is_latest, "the last-appended call is latest");

        let content = render_to_string(&mut app);
        assert!(
            content.contains("latest command output"),
            "the latest tool call's output is expanded by default"
        );
        assert!(
            !content.contains("fn a() {}"),
            "the earlier tool call stays collapsed"
        );
    }

    #[test]
    fn every_terminal_status_ends_the_run_with_its_own_word() {
        for (status, word) in [
            (RunStatus::Done, "RUN COMPLETE"),
            (RunStatus::Failed, "RUN FAILED"),
            (RunStatus::Cancelled, "RUN CANCELLED"),
            (RunStatus::Review, "PAUSED FOR REVIEW"),
        ] {
            let mut app = app_with_run(status);
            let content = render_to_string(&mut app);
            assert!(
                content.contains(word),
                "{status:?} says how the run stopped"
            );
        }
    }

    #[test]
    fn a_run_still_working_has_no_run_end_rule() {
        for status in [RunStatus::Running, RunStatus::Queued, RunStatus::Idle] {
            let mut app = app_with_run(status);
            let content = render_to_string(&mut app);
            assert!(
                !content.contains("RUN COMPLETE") && !content.contains("RUN CANCELLED"),
                "{status:?} is mid-flight"
            );
        }
    }

    /// The dock's rule is ephemeral, so the transcript keeps its own copy of where the run
    /// terminated. Both are built from the same outcome and detail.
    #[test]
    fn the_run_end_rule_is_mirrored_into_the_transcript() {
        let mut app = app_with_run(RunStatus::Done);
        let mirrored: Vec<_> = app
            .thread_ui
            .transcript
            .items()
            .iter()
            .filter_map(|item| match item {
                TranscriptItem::RunEnd(item) => Some(item),
                _ => None,
            })
            .collect();
        assert_eq!(mirrored.len(), 1, "exactly one boundary per run");
        assert_eq!(mirrored[0].outcome, RunOutcome::Done);

        let content = render_to_string(&mut app);
        assert_eq!(
            content.matches("RUN COMPLETE").count(),
            2,
            "the dock line and the transcript item"
        );
    }

    #[test]
    fn earlier_history_merges_by_sequence_without_duplicates_and_retains_cursor_state() {
        let mut app = app_with_run(RunStatus::Done);
        app.thread_ui.data.events = (101..=150)
            .map(|seq| {
                event(
                    f64::from(seq),
                    "note",
                    json!({"message": format!("event {seq}")}),
                )
            })
            .collect();
        app.thread_ui.data.older_cursor = Some("page-2".to_owned());
        assert_eq!(
            app.thread_ui.begin_load_earlier().as_deref(),
            Some("page-2")
        );
        app.thread_ui.merge_earlier(
            (1..=101)
                .map(|seq| {
                    event(
                        f64::from(seq),
                        "note",
                        json!({"message": format!("event {seq}")}),
                    )
                })
                .collect(),
            Some("page-3".to_owned()),
        );
        assert_eq!(app.thread_ui.data.events.len(), 150);
        assert!(
            app.thread_ui
                .data
                .events
                .windows(2)
                .all(|pair| pair[0].seq < pair[1].seq)
        );
        assert_eq!(app.thread_ui.data.older_cursor.as_deref(), Some("page-3"));
        assert!(!app.thread_ui.data.older_loading);
    }

    #[test]
    fn send_failure_restores_the_draft_and_exposes_retry_mode() {
        let mut app = app_with_run(RunStatus::Running);
        app.thread_ui.set_pending_prompt("keep going".to_owned());
        app.thread_ui.restore_pending_prompt("main", "run-1");
        assert_eq!(app.thread_ui.composer.text, "keep going");
        assert!(app.thread_ui.delivery_error);
        assert!(app.thread_ui.pending_prompt.is_none());
    }

    #[test]
    fn a_conversation_shows_its_initial_prompt_once() {
        use coducktor_contract::ConversationState;

        let mut app = app_with_conversation(ConversationState::Running);
        // The core writes the initial message to history as the conversation's first
        // `user-message`, exactly as it writes every follow-up.
        app.thread_ui.push_event(
            1.0,
            event(1.0, "user-message", json!({"text": "ship the shell"})),
        );

        let content = render_to_string(&mut app);
        assert_eq!(
            content.matches("ship the shell").count(),
            1,
            "the record's copy of the initial message must not render beside the durable one"
        );
    }

    #[test]
    fn a_legacy_run_still_opens_its_transcript_with_the_task() {
        // A run record's task was never written to history, so dropping it would lose the prompt.
        let mut app = App::new("main", Theme::detect(), Keymap::default());
        app.thread_ui.load(
            "main".to_owned(),
            "run-1".to_owned(),
            ThreadSubject::LegacyRun(Box::new(run(RunStatus::Running, "rotate the keys"))),
            vec![event(1.0, "text", json!({"text": "working"}))],
            1.0,
            None,
        );
        app.navigate_route(crate::app::Route::Thread {
            project: "main".to_owned(),
            id: "run-1".to_owned(),
        });

        let content = render_to_string(&mut app);
        assert_eq!(content.matches("rotate the keys").count(), 1);
    }

    #[test]
    fn durable_follow_up_replaces_the_optimistic_copy_during_generation() {
        let mut app = app_with_run(RunStatus::Running);
        app.thread_ui.push_event(
            1.0,
            event(1.0, "user-message", json!({"text": "follow up"})),
        );
        app.thread_ui.set_pending_prompt("follow up".to_owned());
        let optimistic = render_to_string(&mut app);
        assert_eq!(optimistic.matches("follow up").count(), 2);
        assert!(optimistic.contains("Sending…"));

        app.thread_ui.push_event(
            2.0,
            event(2.0, "user-message", json!({"text": "follow up"})),
        );

        let content = render_to_string(&mut app);
        assert_eq!(content.matches("follow up").count(), 2);
        assert!(!content.contains("Sending…"));
        assert!(app.thread_ui.pending_prompt.is_none());
    }

    #[test]
    fn durable_image_follow_up_replaces_the_optimistic_copy() {
        let mut app = app_with_run(RunStatus::Running);
        app.thread_ui.set_pending_prompt("[Image]".to_owned());

        app.thread_ui.push_event(
            1.0,
            event(
                1.0,
                "user-message",
                json!({"text": "", "imageCount": 1, "images": ["data:image/png;base64,AA=="]}),
            ),
        );

        let content = render_to_string(&mut app);
        assert!(!content.contains("Sending…"));
        assert!(app.thread_ui.pending_prompt.is_none());
    }

    #[test]
    fn history_watermark_acknowledges_a_follow_up_missing_from_the_visible_page() {
        let mut app = app_with_run(RunStatus::Running);
        app.thread_ui
            .push_event(1.0, event(1.0, "text", json!({"text": "earlier output"})));
        app.thread_ui.set_pending_prompt("follow up".to_owned());
        let run = app.thread_ui.data.run().cloned().unwrap();

        // A compact history page can omit the just-written user event while its watermark still
        // includes it. That must acknowledge the optimistic composer state.
        app.thread_ui.load(
            "main".to_owned(),
            "run-1".to_owned(),
            ThreadSubject::LegacyRun(Box::new(run)),
            vec![event(1.0, "text", json!({"text": "earlier output"}))],
            2.0,
            None,
        );

        assert!(app.thread_ui.pending_prompt.is_none());
        assert!(!app.thread_ui.delivery_error);
    }

    #[test]
    fn waiting_session_keeps_agent_text_after_later_tool_activity() {
        let mut app = app_with_run(RunStatus::Waiting);
        app.thread_ui.push_event(
            1.0,
            event(
                1.0,
                "item.started",
                json!({
                    "item": {
                        "kind": "message",
                        "id": "agent-question",
                        "role": "assistant",
                        "text": "Which export format should I use?",
                        "phase": "commentary"
                    }
                }),
            ),
        );
        for index in 0..20 {
            let sequence = f64::from(index * 2 + 2);
            let id = format!("inspect-{index}");
            app.thread_ui.push_events([
                (
                    sequence,
                    event(
                        sequence,
                        "tool-call",
                        json!({"id": id.clone(), "tool": "shell", "input": {"cmd": "inspect"}}),
                    ),
                ),
                (
                    sequence + 1.0,
                    event(
                        sequence + 1.0,
                        "tool-result",
                        json!({"toolCallId": id, "result": "done"}),
                    ),
                ),
            ]);
        }

        let ids: Vec<_> = app
            .thread_ui
            .transcript
            .items()
            .iter()
            .map(TranscriptItem::id)
            .collect();
        assert!(
            ids.iter().position(|id| *id == "agent-question")
                < ids.iter().position(|id| *id == "inspect-0"),
            "the transcript preserves reducer chronology"
        );
        assert!(matches!(
            app.thread_ui
                .transcript
                .items()
                .iter()
                .find(|item| item.id() == "agent-question"),
            Some(TranscriptItem::Message(_))
        ));
        let content = render_to_string(&mut app);
        assert!(content.contains("LATEST MESSAGE"));
        assert!(content.contains("Which export format should I use?"));
    }

    /// An ordinary turn end — no question asked — parks as `Idle`, not `Waiting` (F4). The
    /// final assistant message must still surface even though nobody needs to answer anything:
    /// otherwise it scrolls out of view behind later tool activity and the user has to scroll
    /// back up through the transcript to find text that was supposed to be the punchline.
    #[test]
    fn idle_session_keeps_agent_text_after_later_tool_activity() {
        let mut app = app_with_run(RunStatus::Idle);
        app.thread_ui.push_event(
            1.0,
            event(
                1.0,
                "item.started",
                json!({
                    "item": {
                        "kind": "message",
                        "id": "agent-summary",
                        "role": "assistant",
                        "text": "Done — the shell now ships with the new flag.",
                        "phase": "commentary"
                    }
                }),
            ),
        );
        for index in 0..20 {
            let sequence = f64::from(index * 2 + 2);
            let id = format!("inspect-{index}");
            app.thread_ui.push_events([
                (
                    sequence,
                    event(
                        sequence,
                        "tool-call",
                        json!({"id": id.clone(), "tool": "shell", "input": {"cmd": "inspect"}}),
                    ),
                ),
                (
                    sequence + 1.0,
                    event(
                        sequence + 1.0,
                        "tool-result",
                        json!({"toolCallId": id, "result": "done"}),
                    ),
                ),
            ]);
        }

        let content = render_to_string(&mut app);
        assert!(content.contains("LATEST MESSAGE"));
        assert!(content.contains("Done — the shell now ships with the new flag."));
    }

    #[test]
    fn bracketed_paste_inserts_into_the_focused_composer() {
        let mut app = app_with_run(RunStatus::Running);
        app.thread_ui.focus = ThreadFocus::Composer;
        app.thread_ui.composer.focus();
        app.handle_event(crossterm::event::Event::Paste("first\nsecond".to_owned()));

        assert_eq!(app.thread_ui.composer.text, "first\nsecond");
    }
}
