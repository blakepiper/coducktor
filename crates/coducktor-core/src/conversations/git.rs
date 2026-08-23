//! Deterministic post-turn Git policy for conversations.
//!
//! Git mode is Coducktor's own policy, applied after a provider turn has already ended. Nothing
//! here may call a model: the commit subject is derived locally from the user's own message so
//! automatic mode can never change how many provider turns a submission costs.

/// Maximum characters of the user message kept in an automatic commit subject. Git subjects are
/// conventionally kept near 72 columns, and the `coducktor: ` prefix takes eleven of them.
const MAX_SUBJECT_PREVIEW_CHARS: usize = 60;

/// Build the commit subject for one automatic post-turn commit.
///
/// The preview is the message's first non-empty line with interior whitespace collapsed, so a
/// pasted multi-line prompt still yields a single-line subject. An empty or whitespace-only
/// message still produces a stable subject rather than a bare prefix.
pub fn auto_commit_subject(user_message: &str) -> String {
    format!("coducktor: {}", subject_preview(user_message))
}

fn subject_preview(user_message: &str) -> String {
    let line = user_message
        .lines()
        .map(str::trim)
        .find(|line| !line.is_empty())
        .unwrap_or_default();
    let collapsed = line.split_whitespace().collect::<Vec<_>>().join(" ");
    if collapsed.is_empty() {
        return "conversation turn".to_owned();
    }
    let mut chars = collapsed.chars();
    let bounded = chars
        .by_ref()
        .take(MAX_SUBJECT_PREVIEW_CHARS)
        .collect::<String>();
    if chars.next().is_some() {
        format!("{}…", bounded.trim_end())
    } else {
        bounded
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn the_subject_is_derived_locally_from_the_first_message_line() {
        assert_eq!(
            auto_commit_subject("Fix the login redirect\n\nMore detail here."),
            "coducktor: Fix the login redirect"
        );
    }

    #[test]
    fn interior_whitespace_collapses_to_one_subject_line() {
        assert_eq!(
            auto_commit_subject("   Fix   the\tlogin   redirect   "),
            "coducktor: Fix the login redirect"
        );
    }

    #[test]
    fn a_long_message_is_bounded_and_an_empty_one_still_has_a_subject() {
        let subject = auto_commit_subject(&"a".repeat(400));
        assert_eq!(subject.chars().count(), "coducktor: ".len() + 61);
        assert!(subject.ends_with('…'));
        assert_eq!(
            auto_commit_subject("   \n\n  "),
            "coducktor: conversation turn"
        );
    }

    #[test]
    fn the_same_message_always_produces_the_same_subject() {
        assert_eq!(
            auto_commit_subject("Ship the cockpit"),
            auto_commit_subject("Ship the cockpit")
        );
    }
}
