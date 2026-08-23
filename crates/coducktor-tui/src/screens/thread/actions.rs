//! The run header's action policy — which actions a run offers, as a pure function of the record.

use coducktor_contract::{RunRecord, RunStatus};

use crate::screens::runs_util::{can_be_unread, is_unread};

/// "Active" in the legacy sense: the engine still owns the run (a queued run is parked but
/// claimed). `Review` is deliberately NOT active — a parked review can be continued, archived
/// or deleted like any finished run.
pub fn is_run_active(status: RunStatus) -> bool {
    matches!(
        status,
        RunStatus::Running | RunStatus::Queued | RunStatus::Idle | RunStatus::Waiting
    )
}

/// The run header's action policy — which actions a run offers, as a pure function of status.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct RunActionFlags {
    /// Archive when live, unarchive when archived.
    pub archive: bool,
    /// Put a read, finished task back into the unread list.
    pub mark_unread: bool,
    /// Stop an active run. Mutually exclusive with delete, by construction.
    pub cancel: bool,
    /// Remove the run, its transcript, worktree and branch. Terminal runs only.
    pub delete_run: bool,
}

pub fn run_action_flags(run: &coducktor_contract::ApiRun) -> RunActionFlags {
    let active = is_run_active(run.record.status);
    RunActionFlags {
        archive: !active,
        mark_unread: can_be_unread(run) && !is_unread(run),
        cancel: false,
        delete_run: !active,
    }
}

/// 1-based position among the queued, unarchived runs, FIFO by `createdAt`. `None` when the
/// run is not itself queued.
pub fn queue_position(runs: &[RunRecord], run_id: &str) -> Option<usize> {
    let mut queued: Vec<&RunRecord> = runs
        .iter()
        .filter(|run| !run.archived && run.status == RunStatus::Queued)
        .collect();
    queued.sort_by(|a, b| a.created_at.cmp(&b.created_at));
    queued
        .iter()
        .position(|run| run.id == run_id)
        .map(|index| index + 1)
}

#[cfg(test)]
mod tests {
    use super::*;
    use coducktor_contract::{ApiRun, RunRecord, StepKind, StepState, StepStatus};

    fn run(status: RunStatus, archived: bool, session_id: Option<&str>) -> ApiRun {
        let steps = session_id
            .map(|id| {
                vec![StepState {
                    id: "s1".to_owned(),
                    name: "agent".to_owned(),
                    kind: StepKind::Agent,
                    status: StepStatus::Done,
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
                    session_id: Some(id.to_owned()),
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
                }]
            })
            .unwrap_or_default();
        ApiRun {
            record: RunRecord {
                id: "r1".to_owned(),
                status,
                archived,
                steps,
                created_at: "2026-08-15T00:00:00Z".to_owned(),
                ..RunRecord::default()
            },
            usage: None,
        }
    }

    #[test]
    fn review_is_not_active_but_running_queued_idle_and_waiting_are() {
        assert!(!is_run_active(RunStatus::Review));
        assert!(is_run_active(RunStatus::Running));
        assert!(is_run_active(RunStatus::Queued));
        assert!(is_run_active(RunStatus::Idle));
        assert!(is_run_active(RunStatus::Waiting));
        assert!(!is_run_active(RunStatus::Done));
    }

    #[test]
    fn legacy_mutations_are_never_offered() {
        for status in [
            RunStatus::Queued,
            RunStatus::Running,
            RunStatus::Idle,
            RunStatus::Waiting,
            RunStatus::Review,
            RunStatus::Done,
            RunStatus::Failed,
            RunStatus::Cancelled,
        ] {
            let flags = run_action_flags(&run(status, false, Some("abc123")));
            assert!(!flags.cancel);
        }
    }

    #[test]
    fn queue_position_is_one_based_fifo_among_unarchived_queued_runs() {
        let mut a = run(RunStatus::Queued, false, None).record;
        a.id = "a".to_owned();
        a.created_at = "2026-08-15T00:00:00Z".to_owned();
        let mut b = run(RunStatus::Queued, false, None).record;
        b.id = "b".to_owned();
        b.created_at = "2026-08-15T00:00:01Z".to_owned();
        let mut archived = run(RunStatus::Queued, true, None).record;
        archived.id = "c".to_owned();
        archived.created_at = "2026-08-15T00:00:02Z".to_owned();
        let runs = vec![b.clone(), a.clone(), archived];
        assert_eq!(queue_position(&runs, "a"), Some(1));
        assert_eq!(queue_position(&runs, "b"), Some(2));
        assert_eq!(queue_position(&runs, "c"), None);
        assert_eq!(queue_position(&runs, "missing"), None);
    }
}
