//! Chat-browser projections — `screens/chats_util.rs`.
//!
//! The conversation-first counterpart to [`super::runs_util`]. Everything here is a pure
//! function over [`ConversationIndexEntry`] so the browser's grouping, ordering, and attention
//! grammar stay testable without a terminal.
//!
//! Legacy `RunRecord` values keep their own helpers in `runs_util`; they are rendered read-only
//! and never pass through these projections.

use coducktor_contract::{ConversationIndexEntry, ConversationState};

use super::runs_util::{Attention, AttentionTone, parse_iso_seconds};
use crate::widgets::task_cards::CardState;

/// The three current-chat groups from section 5.4. `Archived` holds only explicitly archived
/// conversations — archival is never inferred from provider prose or a turn ending.
#[derive(Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord)]
pub enum ChatGroup {
    /// A pending structured question, or a failure/cancellation the user has not seen yet.
    NeedsYou,
    /// A turn is queued or running.
    Working,
    /// Idle conversations, plus failures and cancellations that have been seen.
    Recent,
    Archived,
}

impl ChatGroup {
    pub const CURRENT: [Self; 3] = [Self::NeedsYou, Self::Working, Self::Recent];

    pub fn label(self) -> &'static str {
        match self {
            Self::NeedsYou => "Needs you",
            Self::Working => "Working",
            Self::Recent => "Recent",
            Self::Archived => "Archived",
        }
    }
}

/// Which group a conversation belongs to.
pub fn group(entry: &ConversationIndexEntry) -> ChatGroup {
    if entry.archived {
        return ChatGroup::Archived;
    }
    match entry.state {
        ConversationState::NeedsInput => ChatGroup::NeedsYou,
        ConversationState::Queued | ConversationState::Running => ChatGroup::Working,
        ConversationState::Failed | ConversationState::Cancelled => {
            if entry.seen_at.is_some() {
                ChatGroup::Recent
            } else {
                ChatGroup::NeedsYou
            }
        }
        ConversationState::Idle => ChatGroup::Recent,
    }
}
/// Browser-card state, kept separate from thread-header attention presentation.
pub fn card_state(entry: &ConversationIndexEntry) -> CardState {
    match entry.state {
        ConversationState::NeedsInput => CardState::NeedsInput,
        ConversationState::Running => CardState::Running,
        ConversationState::Queued => CardState::Queued,
        ConversationState::Idle => CardState::Idle,
        ConversationState::Failed => CardState::Failed,
        ConversationState::Cancelled => CardState::Cancelled,
    }
}

/// The status pill. There is no `done` or `review` state for a conversation: a turn ending
/// returns it to `idle` and leaves the composer ready.
pub fn attention(entry: &ConversationIndexEntry) -> Attention {
    match entry.state {
        ConversationState::NeedsInput => Attention {
            label: "needs you",
            tone: AttentionTone::Pending,
            pulse: true,
        },
        ConversationState::Running => Attention {
            label: "running",
            tone: AttentionTone::Violet,
            pulse: true,
        },
        ConversationState::Queued => Attention {
            label: "queued",
            tone: AttentionTone::Neutral,
            pulse: false,
        },
        ConversationState::Failed => Attention {
            label: "failed",
            tone: AttentionTone::Danger,
            pulse: false,
        },
        ConversationState::Cancelled => Attention {
            label: "cancelled",
            tone: AttentionTone::Neutral,
            pulse: false,
        },
        ConversationState::Idle => Attention {
            label: "idle",
            tone: AttentionTone::Neutral,
            pulse: false,
        },
    }
}

/// An unread receipt. Only a settled turn can carry one: a running conversation the user is
/// watching is not "unread", and archiving clears the receipt.
pub fn is_unread(entry: &ConversationIndexEntry) -> bool {
    entry.seen_at.is_none() && can_be_unread(entry)
}

/// Whether this conversation can carry an unread receipt at all.
pub fn can_be_unread(entry: &ConversationIndexEntry) -> bool {
    if entry.archived || entry.seen_at.is_some() {
        return false;
    }
    matches!(
        entry.state,
        ConversationState::Idle | ConversationState::Failed | ConversationState::Cancelled
    )
}

/// The timestamp the browser shows: when something last actually happened.
pub fn meaningful_at(entry: &ConversationIndexEntry) -> &str {
    if entry.archived {
        return entry.archived_at.as_deref().unwrap_or(&entry.updated_at);
    }
    &entry.updated_at
}

/// Substring search over the fields a user can actually see: title, prompt preview, branch,
/// and harness. An empty query keeps everything.
pub fn filter<'a>(
    entries: &'a [ConversationIndexEntry],
    query: &str,
) -> Vec<&'a ConversationIndexEntry> {
    let needle = query.trim().to_lowercase();
    entries
        .iter()
        .filter(|entry| {
            needle.is_empty()
                || entry.title.to_lowercase().contains(&needle)
                || entry.prompt_preview.to_lowercase().contains(&needle)
                || entry
                    .branch
                    .as_deref()
                    .is_some_and(|branch| branch.to_lowercase().contains(&needle))
                || harness_label(entry).contains(&needle)
        })
        .collect()
}

fn harness_label(entry: &ConversationIndexEntry) -> String {
    format!("{:?}", entry.harness).to_lowercase()
}

/// Browser order: group first, then most recent activity, then id so a tie never reshuffles
/// between frames. Returns indices into `entries`.
pub fn sort(entries: &[ConversationIndexEntry]) -> Vec<usize> {
    let mut order: Vec<usize> = (0..entries.len()).collect();
    order.sort_by(|a, b| {
        let (left, right) = (&entries[*a], &entries[*b]);
        group(left)
            .cmp(&group(right))
            .then_with(|| {
                let left_at = parse_iso_seconds(meaningful_at(left)).unwrap_or(0);
                let right_at = parse_iso_seconds(meaningful_at(right)).unwrap_or(0);
                right_at.cmp(&left_at)
            })
            .then_with(|| left.id.cmp(&right.id))
    });
    order
}

/// Whether a destructive or mutating row action is allowed. Delete is disabled while a turn is
/// active (section 5.4) and Git mode may only change while idle (section 4.1).
pub fn can_delete(entry: &ConversationIndexEntry) -> bool {
    !entry.state.is_active()
}

#[cfg(test)]
mod tests {
    use super::*;
    use coducktor_contract::Runner;

    fn entry(id: &str, state: ConversationState) -> ConversationIndexEntry {
        ConversationIndexEntry {
            project_id: "proj".to_owned(),
            id: id.to_owned(),
            title: format!("chat {id}"),
            state,
            harness: Runner::Claude,
            model: None,
            model_identity: None,
            reasoning: None,
            created_at: "2026-08-22T10:00:00Z".to_owned(),
            updated_at: "2026-08-22T10:00:00Z".to_owned(),
            seen_at: None,
            archived: false,
            archived_at: None,
            prompt_preview: "ship the login fix".to_owned(),
            branch: None,
            pull_request_url: None,
            referenced_pull_request_url: None,
            extra: Default::default(),
        }
    }

    #[test]
    fn grouping_follows_the_browser_contract() {
        assert_eq!(
            group(&entry("a", ConversationState::NeedsInput)),
            ChatGroup::NeedsYou
        );
        assert_eq!(
            group(&entry("b", ConversationState::Queued)),
            ChatGroup::Working
        );
        assert_eq!(
            group(&entry("c", ConversationState::Running)),
            ChatGroup::Working
        );
        assert_eq!(
            group(&entry("d", ConversationState::Idle)),
            ChatGroup::Recent,
            "a turn ending returns the chat to Recent, never to a done state"
        );
    }

    #[test]
    fn every_conversation_state_maps_to_one_card_state() {
        for (conversation, card) in [
            (ConversationState::NeedsInput, CardState::NeedsInput),
            (ConversationState::Running, CardState::Running),
            (ConversationState::Queued, CardState::Queued),
            (ConversationState::Idle, CardState::Idle),
            (ConversationState::Failed, CardState::Failed),
            (ConversationState::Cancelled, CardState::Cancelled),
        ] {
            assert_eq!(card_state(&entry("state", conversation)), card);
        }
    }

    #[test]
    fn an_unseen_failure_needs_you_but_a_seen_one_is_only_recent() {
        for state in [ConversationState::Failed, ConversationState::Cancelled] {
            let mut unseen = entry("e", state);
            assert_eq!(group(&unseen), ChatGroup::NeedsYou);
            unseen.seen_at = Some("2026-08-22T11:00:00Z".to_owned());
            assert_eq!(group(&unseen), ChatGroup::Recent);
        }
    }

    #[test]
    fn archived_is_explicit_and_never_inferred() {
        let mut archived = entry("f", ConversationState::Idle);
        archived.archived = true;
        assert_eq!(group(&archived), ChatGroup::Archived);
        assert!(
            !ChatGroup::CURRENT.contains(&ChatGroup::Archived),
            "archived chats are not one of the three current groups"
        );
    }

    #[test]
    fn only_a_settled_turn_carries_an_unread_receipt() {
        assert!(is_unread(&entry("g", ConversationState::Idle)));
        assert!(is_unread(&entry("h", ConversationState::Failed)));
        assert!(
            !is_unread(&entry("i", ConversationState::Running)),
            "a live turn is not an unread receipt"
        );
        let mut seen = entry("j", ConversationState::Idle);
        seen.seen_at = Some("2026-08-22T11:00:00Z".to_owned());
        assert!(!is_unread(&seen));
    }

    #[test]
    fn attention_has_no_done_or_review_state() {
        for state in [
            ConversationState::Idle,
            ConversationState::Queued,
            ConversationState::Running,
            ConversationState::NeedsInput,
            ConversationState::Failed,
            ConversationState::Cancelled,
        ] {
            let label = attention(&entry("k", state)).label;
            assert!(
                !matches!(label, "done" | "needs review"),
                "{state:?} must not render a workflow-era label"
            );
        }
        assert_eq!(
            attention(&entry("l", ConversationState::Idle)).label,
            "idle"
        );
    }

    #[test]
    fn ordering_puts_needs_you_first_then_newest_activity() {
        let mut idle_old = entry("a-idle", ConversationState::Idle);
        idle_old.updated_at = "2026-08-22T09:00:00Z".to_owned();
        let mut idle_new = entry("b-idle", ConversationState::Idle);
        idle_new.updated_at = "2026-08-22T12:00:00Z".to_owned();
        let running = entry("c-running", ConversationState::Running);
        let asking = entry("d-asking", ConversationState::NeedsInput);

        let entries = vec![idle_old, idle_new, running, asking];
        let ordered = sort(&entries)
            .into_iter()
            .map(|index| entries[index].id.as_str())
            .collect::<Vec<_>>();
        assert_eq!(ordered, ["d-asking", "c-running", "b-idle", "a-idle"]);
    }

    #[test]
    fn search_covers_the_visible_fields_only() {
        let mut entries = vec![entry("a", ConversationState::Idle)];
        entries[0].branch = Some("feature/login".to_owned());
        assert_eq!(filter(&entries, "login").len(), 1, "prompt preview matches");
        assert_eq!(filter(&entries, "feature/").len(), 1, "branch matches");
        assert_eq!(filter(&entries, "claude").len(), 1, "harness matches");
        assert_eq!(filter(&entries, "").len(), 1, "an empty query keeps all");
        assert!(filter(&entries, "nothing-here").is_empty());
    }

    #[test]
    fn delete_is_refused_while_a_turn_is_active() {
        assert!(!can_delete(&entry("a", ConversationState::Running)));
        assert!(!can_delete(&entry("b", ConversationState::Queued)));
        assert!(!can_delete(&entry("c", ConversationState::NeedsInput)));
        assert!(can_delete(&entry("d", ConversationState::Idle)));
        assert!(can_delete(&entry("e", ConversationState::Failed)));
    }
}
