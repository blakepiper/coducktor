//! Compatibility store for workflow-era task records.
//!
//! Nothing here executes. Workflow runs were retired with the conversation-first cockpit; what
//! survives is the durable `runs.json` + NDJSON layer the legacy task views still read, archive,
//! mark, and delete. New work goes through [`crate::conversations`] instead.

mod persistence;

pub use crate::agent_session::EventInput;

use std::collections::{BTreeMap, HashMap};
use std::fs;
use std::io;
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicU64, Ordering};
use std::time::{Duration, Instant};

use coducktor_contract::events::RunEvent;
use coducktor_contract::runs::{RunRecord, RunStatus, StepKind, StepState, StepStatus};
use coducktor_contract::workflows::WorkflowDef;
use coducktor_contract::{ReasoningEffort, RoutingDecision, Runner, RunnerSelection};
use serde::Serialize;
use serde_json::{Map, Value};

use crate::runs::events;
use crate::runs::store;
use crate::time::now_iso8601;

///
/// A JSON patch is used here rather than duplicating the very wide `RunRecord` shape in a second
/// Rust struct. `RunManager` validates the merged value by deserializing it back into the shared
/// contract type before it can be stored. `null` clears an optional record field.
#[derive(Debug, Clone, Default, PartialEq)]
pub struct RunPatch {
    fields: Map<String, Value>,
}

impl RunPatch {
    pub fn new() -> Self {
        Self::default()
    }

    /// Build a patch from an object-shaped JSON value.
    pub fn from_value(value: Value) -> Result<Self, String> {
        let Value::Object(fields) = value else {
            return Err("run patch must be a JSON object".to_owned());
        };
        Ok(Self { fields })
    }

    /// Add or replace a typed camelCase field. Panicking here would only be possible for a type
    /// that cannot be represented by JSON; all contract values used by this module are JSON types.
    pub fn set<T: Serialize>(mut self, field: &str, value: T) -> Self {
        self.fields.insert(
            field.to_owned(),
            serde_json::to_value(value).unwrap_or(Value::Null),
        );
        self
    }

    /// Clear an optional field. Required fields will be rejected by the contract deserializer.
    pub fn clear(mut self, field: &str) -> Self {
        self.fields.insert(field.to_owned(), Value::Null);
        self
    }

    pub fn fields(&self) -> &Map<String, Value> {
        &self.fields
    }
}

/// Step patches use the same JSON-field representation as [`RunPatch`].
pub type StepPatch = RunPatch;

/// Input for durable run creation. `steps` is the compact execution-facing subset of a workflow
/// step; the complete ad-hoc definition can be retained in `workflow_def`.
#[derive(Debug, Clone, Default, PartialEq)]
pub struct CreateRunInput {
    pub title: String,
    pub workflow: String,
    pub task: String,
    pub task_images: Option<Vec<String>>,
    pub steps: Vec<StepSeed>,
    pub workflow_def: Option<WorkflowDef>,
    pub model: Option<String>,
    pub reasoning_effort: Option<ReasoningEffort>,
    pub model_identity: Option<String>,
    pub runner: Option<Runner>,
    pub requested_runner: Option<RunnerSelection>,
    pub agent_profile: Option<String>,
    pub system_prompt: Option<String>,
    pub autonomous: Option<bool>,
    pub git_auto: Option<bool>,
    pub worktree: Option<bool>,
    pub group_id: Option<String>,
    pub variant: Option<String>,
    /// Explanation for an `auto` runner request, attached to the run's first step. `None` for an
    /// explicit runner request or when the caller has no decision to record.
    pub routing_decision: Option<RoutingDecision>,
}

/// The fields that are present when a new step is added to a run.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct StepSeed {
    pub id: String,
    pub name: String,
    pub kind: StepKind,
    pub requested_runner: Option<RunnerSelection>,
}
#[derive(Debug, Clone, PartialEq)]
pub struct RunEventNotification {
    pub run_id: String,
    pub event: RunEvent,
}

/// The run delivered to an in-process run observer.
pub type RunObserverId = u64;
pub type EventObserverId = u64;
type EventObservers = BTreeMap<EventObserverId, Box<dyn Fn(&RunEventNotification) + Send + Sync>>;
type RunObservers = BTreeMap<RunObserverId, Box<dyn Fn(&RunRecord) + Send + Sync>>;

/// Backend-neutral usage checkpoints emitted by the session layer.
#[derive(Debug, Clone, PartialEq)]
pub enum UsageEvent {
    TurnStarted {
        turn_id: String,
    },
    TurnCompleted {
        turn_id: String,
        input_tokens: Option<f64>,
        output_tokens: Option<f64>,
    },
}

/// Whether an unread badge should include this run. This is the same predicate used by
/// `mark_all_read`, kept pure so the sweep and readers cannot silently diverge.
pub fn is_unread(run: &RunRecord) -> bool {
    !run.archived
        && matches!(run.status, RunStatus::Done | RunStatus::Failed)
        && !(run.status == RunStatus::Failed && run.auto_resume_at.is_some())
        && run.finished_at.is_some()
        && match (&run.seen_at, &run.finished_at) {
            (None, Some(_)) => true,
            (Some(seen), Some(finished)) => seen < finished,
            _ => false,
        }
}

/// A stateful, synchronous facade over the durable run files.
pub struct RunManager {
    data_dir: PathBuf,
    runs: BTreeMap<String, RunRecord>,
    seqs: HashMap<String, f64>,
    next_observer_id: u64,
    event_observers: EventObservers,
    run_observers: RunObservers,
    project_id: String,
    last_index_flush: Instant,
    write_quarantined: bool,
    index_write_count: usize,
    index_write_bytes: u64,
    event_append_count: usize,
    event_appenders: HashMap<String, events::BufferedEventAppender>,
}

impl RunManager {
    /// Open a live manager. Active records are retained so callers can reconcile or resume them.
    pub fn open(data_dir: impl Into<PathBuf>) -> Self {
        Self::open_with_keep_live(data_dir, true)
    }

    pub fn new(data_dir: impl Into<PathBuf>) -> Self {
        Self::open(data_dir)
    }

    pub fn open_with_keep_live(data_dir: impl Into<PathBuf>, keep_live: bool) -> Self {
        let data_dir = data_dir.into();
        let _ = fs::create_dir_all(data_dir.join("runs"));
        let index_path = store::index_path(&data_dir);
        let load = store::load_run_index_outcome(&index_path, keep_live);
        let write_quarantined = load.write_quarantined();
        if write_quarantined {
            eprintln!(
                "coducktor: {} contains corrupt run state; preserving it and quarantining writes",
                index_path.display()
            );
        }
        let mut loaded = load.records().to_vec();
        // `waiting` used to mean any parked session. On upgrade, retain attention only when the
        // durable transcript proves that a structured ask is still unanswered; every other
        // legacy record becomes the new neutral parked state.
        for run in &mut loaded {
            if run.status == RunStatus::Waiting
                && !events::has_pending_ask(&events::events_path(&data_dir, &run.id))
            {
                run.status = RunStatus::Idle;
            }
        }
        let runs = loaded
            .into_iter()
            .map(|run| (run.id.clone(), run))
            .collect();
        Self {
            data_dir,
            runs,
            seqs: HashMap::new(),
            next_observer_id: 0,
            event_observers: BTreeMap::new(),
            run_observers: BTreeMap::new(),
            project_id: "default".to_owned(),
            last_index_flush: Instant::now(),
            write_quarantined,
            index_write_count: 0,
            index_write_bytes: 0,
            event_append_count: 0,
            event_appenders: HashMap::new(),
        }
    }
}

fn apply_run_patch(record: &RunRecord, patch: &Map<String, Value>) -> io::Result<RunRecord> {
    let value = serde_json::to_value(record).map_err(|error| {
        io::Error::new(
            io::ErrorKind::InvalidData,
            format!("could not serialize run before patch: {error}"),
        )
    })?;
    let Some(mut object) = value.as_object().cloned() else {
        return Err(io::Error::new(
            io::ErrorKind::InvalidData,
            "run record did not serialize as an object",
        ));
    };
    for (field, value) in patch {
        object.insert(field.clone(), value.clone());
    }
    let mut next: RunRecord = serde_json::from_value(Value::Object(object)).map_err(|error| {
        io::Error::new(
            io::ErrorKind::InvalidInput,
            format!("invalid run patch: {error}"),
        )
    })?;
    if patch.contains_key("issueNumber") {
        next.referenced_issue_number_seeded = None;
    }
    // These are transition rules, not record-wide invariants: a patch to a queued message must
    // not retire an unrelated scheduled resume or clear a provider block just because the record
    // currently happens to be queued.
    if patch.contains_key("status") {
        if matches!(
            next.status,
            RunStatus::Running | RunStatus::Idle | RunStatus::Waiting | RunStatus::Queued
        ) {
            next.auto_resume_at = None;
        } else {
            next.activity = None;
            next.monitoring_wake_at = None;
            next.monitoring_wake_cap_reached = None;
        }
        if next.status != RunStatus::Queued {
            next.blocked_reason = None;
        }
    }
    if next.archived {
        next.auto_resume_at = None;
        next.auto_resume_attempts = None;
    }
    Ok(next)
}

fn step_from_seed(seed: StepSeed) -> StepState {
    StepState {
        id: seed.id,
        name: seed.name,
        kind: seed.kind,
        status: StepStatus::Pending,
        iterations: 0.0,
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
        session_id: None,
        backend: None,
        requested_runner: seed.requested_runner,
        profile_id: None,
        reasoning_effort: None,
        cost_usd: None,
        model_identity: None,
        route_key: None,
        recovery_generation: None,
        routing_decision: None,
        extra: Map::new(),
    }
}

/// Apply the marker title normalization used for task references.
pub fn post_validate_marker_title(title: &str, ref_number: Option<i64>) -> Option<String> {
    let mut normalized = title
        .trim()
        .trim_end_matches('.')
        .split_whitespace()
        .collect::<Vec<_>>()
        .join(" ");
    if let Some(number) = ref_number {
        let prefix = number.to_string();
        let without_hash = normalized.strip_prefix('#').unwrap_or(&normalized);
        if without_hash == prefix {
            normalized.clear();
        } else if let Some(rest) = without_hash.strip_prefix(&prefix) {
            let rest = rest.trim_start_matches([' ', ':', '-', '—']);
            normalized = rest.to_owned();
        }
    }
    if normalized.is_empty() {
        return None;
    }
    if let Some(first) = normalized.chars().next() {
        let lower = first.to_lowercase().collect::<String>();
        normalized.replace_range(..first.len_utf8(), &lower);
    }
    let chars: Vec<char> = normalized.chars().collect();
    if chars.len() > 40 {
        normalized = chars[..39].iter().collect::<String>() + "…";
    }
    Some(match ref_number {
        Some(number) => format!("{number}: {normalized}"),
        None => normalized,
    })
}

fn new_run_id() -> String {
    static COUNTER: AtomicU64 = AtomicU64::new(0);
    let counter = COUNTER.fetch_add(1, Ordering::Relaxed);
    let nanos = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap_or_default()
        .as_nanos();
    format!("run-{nanos:x}-{counter:x}")
}

#[cfg(test)]
mod tests {
    use super::*;

    use serde_json::json;
    use std::sync::{Arc, Mutex};
    use tempfile::tempdir;

    #[test]
    fn retention_prunes_terminal_sidecars_but_keeps_live_records_and_worktrees() {
        let dir = tempdir().unwrap();
        let stale_id = "done-0000";
        let retained_worktree = dir.path().join("recoverable-worktree");
        fs::create_dir(&retained_worktree).unwrap();
        let mut records = Vec::new();
        for index in 0..=(store::MAX_RUNS_KEPT + 1) {
            records.push(RunRecord {
                id: format!("done-{index:04}"),
                created_at: format!("2026-01-{index:04}T00:00:00.000Z"),
                status: RunStatus::Done,
                worktree_path: (index == 0)
                    .then(|| retained_worktree.to_string_lossy().into_owned()),
                ..RunRecord::default()
            });
        }
        let live_id = "queued-old";
        records.push(RunRecord {
            id: live_id.to_owned(),
            created_at: "2000-01-01T00:00:00.000Z".to_owned(),
            status: RunStatus::Queued,
            ..RunRecord::default()
        });
        store::write_run_index(&store::index_path(dir.path()), &records).unwrap();

        fs::create_dir_all(dir.path().join("runs")).unwrap();
        fs::write(events::events_path(dir.path(), stale_id), "{}\n").unwrap();
        fs::write(
            crate::handoff::handoff_path(dir.path(), stale_id),
            "handoff",
        )
        .unwrap();

        let mut manager = RunManager::open(dir.path());
        let pruned = manager.prune_stale_runs().unwrap();

        assert!(pruned.iter().any(|id| id == stale_id));
        assert!(manager.get_run(stale_id).is_none());
        assert!(manager.get_run(live_id).is_some());
        assert!(!events::events_path(dir.path(), stale_id).exists());
        assert!(!crate::handoff::handoff_path(dir.path(), stale_id).exists());
        assert!(retained_worktree.is_dir());
        assert_eq!(manager.list_runs().len(), store::MAX_RUNS_KEPT + 1);
    }

    fn step(id: &str, kind: StepKind) -> StepSeed {
        StepSeed {
            id: id.to_owned(),
            name: id.to_owned(),
            kind,
            requested_runner: None,
        }
    }

    fn create_input() -> CreateRunInput {
        CreateRunInput {
            title: "task".to_owned(),
            workflow: "quick-task".to_owned(),
            task: "task".to_owned(),
            steps: vec![step("work", StepKind::Agent)],
            ..CreateRunInput::default()
        }
    }

    #[test]
    fn truncated_index_quarantines_writes_until_an_explicit_repair_keeps_a_backup() {
        let dir = tempdir().unwrap();
        let index_path = store::index_path(dir.path());
        let truncated = b"[{\"id\": \"interrupted";
        fs::write(&index_path, truncated).unwrap();

        let mut manager = RunManager::open(dir.path());
        assert!(manager.list_runs().is_empty());
        let error = manager.create_run(create_input()).unwrap_err();
        assert_eq!(error.kind(), io::ErrorKind::InvalidData);
        assert_eq!(fs::read(&index_path).unwrap(), truncated);

        let backup = manager.repair_quarantined_index().unwrap().unwrap();
        assert_eq!(fs::read(&backup).unwrap(), truncated);
        manager.create_run(create_input()).unwrap();
        assert_eq!(manager.list_runs().len(), 1);
    }

    #[test]
    fn create_and_update_are_durable_across_a_reopen() {
        let dir = tempdir().unwrap();
        let mut manager = RunManager::open(dir.path());
        let run = manager.create_run(create_input()).unwrap();
        manager
            .update_run(
                &run.id,
                RunPatch::new().set("titleSummary", "A useful title"),
            )
            .unwrap();

        let reopened = RunManager::open(dir.path());
        let saved = reopened.get_run(&run.id).unwrap();
        assert_eq!(saved.title_summary.as_deref(), Some("A useful title"));
        assert_eq!(saved.steps.len(), 1);
    }

    #[test]
    fn event_sequences_rehydrate_and_observers_see_ordered_events() {
        let dir = tempdir().unwrap();
        let mut manager = RunManager::open(dir.path());
        let run = manager.create_run(create_input()).unwrap();
        let observed = Arc::new(Mutex::new(Vec::new()));
        let observed_by_callback = observed.clone();
        manager.subscribe_events(move |notification| {
            observed_by_callback
                .lock()
                .unwrap()
                .push(notification.event.seq);
        });
        assert_eq!(
            manager
                .append_event(&run.id, EventInput::new("note").field("message", "one"),)
                .unwrap()
                .seq,
            1.0
        );
        manager
            .append_event(&run.id, EventInput::new("note").field("message", "two"))
            .unwrap();
        assert_eq!(*observed.lock().unwrap(), vec![1.0, 2.0]);
        assert_eq!(
            manager.event_appenders.len(),
            1,
            "streamed events reuse one run-scoped append handle"
        );

        let reopened = RunManager::open(dir.path());
        let continued = reopened.read_events(&run.id);
        assert_eq!(
            continued.iter().map(|event| event.seq).collect::<Vec<_>>(),
            [1.0, 2.0]
        );
        drop(reopened);
        let mut resumed = RunManager::open(dir.path());
        assert_eq!(
            resumed
                .append_event(&run.id, EventInput::new("note"))
                .unwrap()
                .seq,
            3.0
        );
    }

    #[test]
    fn streaming_events_debounce_run_index_notifications() {
        let dir = tempdir().unwrap();
        let mut manager = RunManager::open(dir.path());
        let run = manager.create_run(create_input()).unwrap();
        let notifications = Arc::new(AtomicU64::new(0));
        let observed = notifications.clone();
        manager.subscribe_runs(move |_| {
            observed.fetch_add(1, Ordering::Relaxed);
        });
        let writes_before_stream = manager.index_write_count;
        for index in 0..10_000 {
            manager
                .append_event(
                    &run.id,
                    EventInput::new("text").field("text", format!("delta-{index}")),
                )
                .unwrap();
        }
        manager.flush().unwrap();
        let events = manager.read_events(&run.id);
        assert_eq!(events.len(), 10_000);
        // The exact final transcript, not just the right count: every delta present, in order,
        // with its own content intact — debounced index notifications must never coalesce away
        // or reorder the durable event log itself.
        assert!(
            events.windows(2).all(|pair| pair[0].seq < pair[1].seq),
            "events must stay in strictly increasing seq order"
        );
        for (index, event) in events.iter().enumerate() {
            assert_eq!(
                event.extra.get("text").and_then(Value::as_str),
                Some(format!("delta-{index}")).as_deref()
            );
        }
        assert_eq!(manager.event_append_count, 10_000);
        assert!(manager.index_write_bytes > 0);
        assert!(notifications.load(Ordering::Relaxed) < 100);
        assert!(manager.index_write_count - writes_before_stream < 100);
    }

    #[test]
    fn archive_and_read_receipts_match_the_finished_run_rules() {
        let dir = tempdir().unwrap();
        let mut manager = RunManager::open(dir.path());
        let done = manager.create_run(create_input()).unwrap();
        manager
            .update_run(
                &done.id,
                RunPatch::new()
                    .set("status", RunStatus::Done)
                    .set("finishedAt", "2020-01-01T00:00:00.000Z"),
            )
            .unwrap();
        let done_activity = manager.get_run(&done.id).unwrap().updated_at.clone();
        let scheduled = manager.create_run(create_input()).unwrap();
        manager
            .update_run(
                &scheduled.id,
                RunPatch::new()
                    .set("status", RunStatus::Failed)
                    .set("finishedAt", "2020-01-01T00:00:00.000Z")
                    .set("autoResumeAt", "2099-01-01T00:00:00.000Z"),
            )
            .unwrap();
        assert_eq!(manager.mark_all_read().unwrap(), 1);
        assert!(manager.get_run(&done.id).unwrap().seen_at.is_some());
        assert_eq!(manager.get_run(&done.id).unwrap().updated_at, done_activity);
        assert!(manager.get_run(&scheduled.id).unwrap().seen_at.is_none());
        manager.set_unread(&done.id).unwrap();
        assert_eq!(manager.mark_all_read().unwrap(), 1);
        manager.set_archived(&scheduled.id, true).unwrap();
        let archived = manager.get_run(&scheduled.id).unwrap();
        assert!(archived.archived);
        assert!(archived.archived_at.is_some());
        assert!(archived.auto_resume_at.is_none());
    }

    #[test]
    fn json_patch_rejects_invalid_contract_values_without_losing_the_record() {
        let dir = tempdir().unwrap();
        let mut manager = RunManager::open(dir.path());
        let run = manager.create_run(create_input()).unwrap();
        let error = manager
            .update_run_value(&run.id, json!({ "status": "not-a-status" }))
            .unwrap_err();
        assert_eq!(error.kind(), io::ErrorKind::InvalidInput);
        assert_eq!(manager.get_run(&run.id).unwrap().status, RunStatus::Queued);
    }
}
