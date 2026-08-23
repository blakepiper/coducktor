//! Compatibility reader for the per-task handoff journal.
//!
//! `<project-state>/runs/<runId>.handoff.md`, next to the run's NDJSON events and outside the
//! task worktree — it survives worktree removal. Workflow-era runs wrote this journal; nothing
//! writes it any more. What remains is the read side the legacy task views still display, plus
//! the delete used when a historical record is removed. Everything here is best-effort: the
//! handoff is a journal, never a reason to fail a read.

use std::fs;
use std::path::{Path, PathBuf};

pub fn handoff_path(data_dir: &Path, run_id: &str) -> PathBuf {
    data_dir.join("runs").join(format!("{run_id}.handoff.md"))
}

/// Full handoff markdown, or `""` when the file doesn't exist (yet).
pub fn read_handoff(data_dir: &Path, run_id: &str) -> String {
    fs::read_to_string(handoff_path(data_dir, run_id)).unwrap_or_default()
}

/// First few non-empty lines under "## Progress log". Stops at the next `## ` header; `""` when
/// there's no Progress log section or it's empty.
pub fn handoff_progress_excerpt(text: &str, max_lines: usize) -> String {
    let marker = "## Progress log";
    let Some(idx) = text.find(marker) else {
        return String::new();
    };
    let mut lines = Vec::new();
    for line in text[idx + marker.len()..].split('\n') {
        if line.starts_with("## ") {
            break;
        }
        let trimmed = line.trim();
        if trimmed.is_empty() {
            continue;
        }
        lines.push(trimmed);
        if lines.len() >= max_lines {
            break;
        }
    }
    lines.join("\n")
}

pub fn delete_handoff(data_dir: &Path, run_id: &str) {
    let _ = fs::remove_file(handoff_path(data_dir, run_id)); // best effort
}

/// Appended to every agent step's `--append-system-prompt`. The matching
/// handoff/task env vars are set on every agent process.
pub const HANDOFF_ONLY_INSTRUCTIONS: &str = "## Handoff (coducktor)

DUCK_HANDOFF_FILE (env) is the absolute path to this task's rolling handoff file. Treat it like a HANDOFF.md:
1. At the start of work, read it — \"Resume notes\" left by a previous session is your starting context.
2. After every meaningful milestone (passing tests, a commit, a PR, a scope decision), append one terse timestamped line under \"## Progress log\", newest at the top.
3. Before finishing or pausing, update \"## Resume notes\" with what's done, what's next and any blockers. Leave it empty only when the task is truly complete.

Task completion marker: when the task's goal is fully achieved and you have no question for the user, end your final message with a line containing exactly DUCK:DONE — duck then closes the session and marks the task finished. If you are waiting on the user (a question, a decision, missing input), just end your message normally; the session stays open for their reply. Never emit DUCK:DONE while anything is unfinished or unverified.

Still-working marker: if you end a turn while still working on your OWN downstream work — a sub-agent you dispatched, or a long-running command you're monitoring — and are NOT waiting on the user for anything, end your final message with a line containing exactly DUCK:MONITORING. duck then shows the task as \"monitoring\" (still working) instead of asking for your attention. Use DUCK:MONITORING only for that in-progress case; use DUCK:DONE when the goal is done; end plainly (no marker) only when you are genuinely waiting on the user. Never combine DUCK:MONITORING with DUCK:DONE.

Structured question marker: when you are blocked on a decision that is genuinely the user's to make — one you cannot resolve from the request, the code, or sensible defaults — and it comes down to a few concrete choices, end your turn with a single line DUCK:ASK <json> instead of asking in prose. duck renders it as clickable option chips in the cockpit so the user can answer in one tap. The <json> is ONE object on ONE line, the last thing in your message: {\"questions\":[{\"header\":\"≤12-char label\",\"question\":\"a clear question ending in ?\",\"multiSelect\":false,\"options\":[{\"label\":\"short choice\",\"description\":\"what it means / the trade-off\"}]}]} — use only those keys (plus an optional non-empty \"id\" up to 64 characters), with 1–4 questions, 2–4 options per question, unique question text and option labels, header 1–12 characters, question 1–400, option label 1–60, and description at most 280. The user can always type a free-form reply, so never add an \"Other\" option. Prefer sensible defaults over asking; use DUCK:ASK only when the choice is truly the user's. Never combine DUCK:ASK with DUCK:DONE or DUCK:MONITORING.

Task reference markers: as soon as you know which GitHub pull request or issue this task is ABOUT (it was named in the task, or you just opened it), declare it by emitting, on its own line in your message text: DUCK:PR=<number> and/or DUCK:ISSUE=<number>. Re-emit with the new number if the subject changes (e.g. you open a PR later in the task). Declare only the task's own subject — never a PR/issue you merely mention, list, or compare against. You may also emit DUCK:TITLE=<terse gerund phrase, max 40 chars, e.g. \"implementing comment threads\"> once the work has a clearer shape than its current title; duck uses these instead of guessing from the transcript. Put markers in plain message text, never inside a code fence.";

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn progress_excerpt_stops_at_the_next_header_and_caps_line_count() {
        let text = "# Handoff\n\n## Progress log\n\n- line one\n- line two\n- line three\n\n## Resume notes\nshould not appear\n";
        assert_eq!(handoff_progress_excerpt(text, 2), "- line one\n- line two");
        assert_eq!(
            handoff_progress_excerpt(text, 10),
            "- line one\n- line two\n- line three"
        );
        assert_eq!(handoff_progress_excerpt("no marker here", 3), "");
    }

    #[test]
    fn delete_removes_an_existing_file_and_is_a_noop_when_absent() {
        let dir = tempfile::tempdir().unwrap();
        let path = handoff_path(dir.path(), "r1");
        std::fs::create_dir_all(path.parent().unwrap()).unwrap();
        std::fs::write(&path, "# Handoff\n").unwrap();
        assert!(path.exists());
        delete_handoff(dir.path(), "r1");
        assert!(!path.exists());
        delete_handoff(dir.path(), "r1"); // no-op
    }
}
