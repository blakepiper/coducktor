//! Worktree retention for conversations.
//!
//! History is the product, so this never touches a transcript: reclaiming takes back a checkout's
//! *directory* and leaves the conversation record, its NDJSON timeline, and its managed
//! `duck/<id8>` branch in place. What was committed stays recoverable, and
//! [`restore_worktree`] materializes the directory again from that branch.
//!
//! Only an archived conversation is ever eligible. An unarchived one can still accept the user's
//! next message, and that message must open the harness in the same checkout it has been using —
//! so its worktree is not retention-eligible no matter how old it is.

use std::path::Path;

use coducktor_contract::ConversationRecord;

use crate::git::worktree;

/// Whether this conversation's checkout may be considered for reclamation at all.
///
/// Record-only and pure, so a browser can render the flag without shelling out to Git. It is a
/// necessary condition, not a sufficient one: [`reclaim_worktrees`] additionally refuses any
/// checkout that still holds uncommitted changes.
pub fn is_reclaimable(record: &ConversationRecord) -> bool {
    record.archived && record.worktree_path.is_some() && record.worktree_reclaimed_at.is_none()
}

/// Recency key for a stable oldest-first ordering: when the conversation was archived, falling
/// back to its last update.
fn recency_key(record: &ConversationRecord) -> &str {
    record.archived_at.as_deref().unwrap_or(&record.updated_at)
}

/// The ids of every archived conversation whose checkout can be considered, oldest first.
///
/// Deliberately not count-budgeted the way legacy run retention is. A run became "finished"
/// on its own, so a budget was the only thing separating a checkout still worth having from
/// one that was not. Archiving is a user's explicit "I am done with this chat", which is
/// exactly that signal — so every archived checkout is a candidate, and the clean check in
/// [`reclaim_worktrees`] is what actually protects work.
///
/// Pure: no I/O, no mutation of the input.
pub fn select_reclaimable_worktrees(records: &[ConversationRecord]) -> Vec<String> {
    let mut reclaimable: Vec<&ConversationRecord> = records
        .iter()
        .filter(|record| is_reclaimable(record))
        .collect();
    reclaimable.sort_by(|left, right| recency_key(left).cmp(recency_key(right)));
    reclaimable
        .into_iter()
        .map(|record| record.id.clone())
        .collect()
}

/// Reclaim the directory of every archived conversation whose checkout is clean. Returns
/// `(conversation_id, reclaimed_at)` for each one actually reclaimed, for the caller to persist.
///
/// The managed branch is deliberately kept (`remove_worktree` is called without a branch), so
/// unarchiving can rebuild the checkout. A conversation is reported reclaimed only once its
/// directory is confirmed gone, so a locked or permission-denied removal is retried next pass
/// rather than being recorded as done.
pub fn reclaim_worktrees(
    repo_root: &Path,
    records: &[ConversationRecord],
    now: impl Fn() -> String,
) -> Vec<(String, String)> {
    let mut reclaimed = Vec::new();
    for id in select_reclaimable_worktrees(records) {
        let Some(record) = records.iter().find(|record| record.id == id) else {
            continue;
        };
        let Some(worktree_path) = record.worktree_path.as_deref() else {
            continue;
        };
        let path = Path::new(worktree_path);
        if !path.exists() {
            continue;
        }
        // Uncommitted work is not recoverable from the branch, so it outranks archiving.
        if !worktree::worktree_is_clean(path) {
            continue;
        }
        worktree::remove_worktree(repo_root, path, None);
        if path.exists() {
            continue;
        }
        reclaimed.push((id, now()));
    }
    reclaimed
}

/// Rebuild a conversation's managed checkout from its recorded branch.
///
/// Loud on purpose: unarchiving calls this before it will let the composer accept a message, and
/// a conversation whose checkout cannot be restored must stay archived with its history readable
/// rather than silently running its next turn against the repository root.
pub fn restore_worktree(
    repo_root: &Path,
    record: &ConversationRecord,
) -> Result<worktree::WorktreeInfo, String> {
    if !record.worktree {
        return Err("conversation does not use a managed worktree".to_owned());
    }
    worktree::create_worktree(
        repo_root,
        &record.id,
        record.base_branch.as_deref().unwrap_or("HEAD"),
    )
}

#[cfg(test)]
mod tests {
    use super::*;
    use coducktor_contract::{
        ConversationGitMode, ConversationMessage, ConversationState, RecordKind, Runner,
    };

    fn record(id: &str, archived: bool, archived_at: Option<&str>) -> ConversationRecord {
        ConversationRecord {
            record_kind: RecordKind::Conversation,
            id: id.to_owned(),
            project_id: "project-a".to_owned(),
            title: id.to_owned(),
            initial_message: ConversationMessage {
                text: "hello".to_owned(),
                images: Vec::new(),
                skill_attachments: Vec::new(),
                extra: Default::default(),
            },
            harness: Runner::Claude,
            model: None,
            reasoning: None,
            provider_session_id: None,
            repository_root: "/repo".to_owned(),
            cwd: format!("/repo/.ai/coducktor/worktrees/{id}"),
            base_branch: Some("main".to_owned()),
            branch: Some(format!("duck/{id}")),
            worktree: true,
            worktree_path: Some(format!("/repo/.ai/coducktor/worktrees/{id}")),
            worktree_reclaimed_at: None,
            git_mode: ConversationGitMode::Manual,
            state: ConversationState::Idle,
            active_turn: None,
            latest_turn: None,
            created_at: "2026-08-01T00:00:00.000Z".to_owned(),
            updated_at: "2026-08-01T00:00:00.000Z".to_owned(),
            seen_at: None,
            archived,
            archived_at: archived_at.map(ToOwned::to_owned),
            tokens_used: 0.0,
            input_tokens: None,
            output_tokens: None,
            cost_usd: None,
            last_error: None,
            resume_failed: false,
            session_restart: None,
            workflow: "conversation".to_owned(),
            task: "hello".to_owned(),
            steps: Vec::new(),
            extra: Default::default(),
        }
    }

    #[test]
    fn an_unarchived_conversation_is_never_retention_eligible() {
        let records = [
            record("chat-1", false, None),
            record("chat-2", false, None),
            record("chat-3", false, None),
        ];
        assert!(!is_reclaimable(&records[0]));
        assert!(select_reclaimable_worktrees(&records).is_empty());
    }

    #[test]
    fn every_archived_conversation_is_a_candidate_oldest_first() {
        let records = [
            record("chat-1", true, Some("2026-08-01T00:00:00.000Z")),
            record("chat-2", true, Some("2026-08-03T00:00:00.000Z")),
            record("chat-3", true, Some("2026-08-02T00:00:00.000Z")),
        ];
        assert_eq!(
            select_reclaimable_worktrees(&records),
            vec!["chat-1", "chat-3", "chat-2"]
        );
    }

    #[test]
    fn an_in_place_conversation_has_no_checkout_to_reclaim() {
        let mut in_place = record("chat-1", true, Some("2026-08-01T00:00:00.000Z"));
        in_place.worktree = false;
        in_place.worktree_path = None;
        assert!(!is_reclaimable(&in_place));
    }

    #[test]
    fn an_already_reclaimed_checkout_is_not_selected_twice() {
        let mut reclaimed = record("chat-1", true, Some("2026-08-01T00:00:00.000Z"));
        reclaimed.worktree_reclaimed_at = Some("2026-08-04T00:00:00.000Z".to_owned());
        assert!(!is_reclaimable(&reclaimed));
        assert!(select_reclaimable_worktrees(&[reclaimed]).is_empty());
    }

    #[test]
    fn restoring_a_conversation_without_a_managed_worktree_is_refused() {
        let mut in_place = record("chat-1", true, None);
        in_place.worktree = false;
        let Err(error) = restore_worktree(Path::new("/repo"), &in_place) else {
            panic!("an in-place conversation has no worktree to restore");
        };
        assert!(error.contains("managed worktree"), "{error}");
    }
}
