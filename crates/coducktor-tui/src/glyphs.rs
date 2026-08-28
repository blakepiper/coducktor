//! Locale-aware glyphs shared by transcript and chat-card renderers.

use std::env;
use std::sync::LazyLock;

use coducktor_protocol::ToolKind;

/// The glyph set for the current locale. Resolved once; `Glyphs` is cheap to pass.
#[derive(Debug, Clone, Copy)]
pub struct Glyphs {
    pub top_left: &'static str,
    pub top_right: &'static str,
    pub bottom_left: &'static str,
    pub bottom_right: &'static str,
    pub horizontal: &'static str,
    pub vertical: &'static str,
    pub tee_right: &'static str,
    pub tee_left: &'static str,
    pub tree_last: &'static str,
    pub bullet: &'static str,
    pub success: &'static str,
    pub error: &'static str,
    pub warning: &'static str,
    pub pending: &'static str,
    pub expanded: &'static str,
    pub collapsed: &'static str,
    pub separator: &'static str,
    pub bracket_left: &'static str,
    pub bracket_right: &'static str,
}

const UNICODE: Glyphs = Glyphs {
    top_left: "╭",
    top_right: "╮",
    bottom_left: "╰",
    bottom_right: "╯",
    horizontal: "─",
    vertical: "│",
    tee_right: "├",
    tee_left: "┤",
    tree_last: "└─",
    bullet: "•",
    success: "✔",
    error: "✘",
    warning: "⚠",
    pending: "◌",
    expanded: "▾",
    collapsed: "▸",
    separator: " · ",
    bracket_left: "⟦",
    bracket_right: "⟧",
};

const ASCII: Glyphs = Glyphs {
    top_left: "+",
    top_right: "+",
    bottom_left: "+",
    bottom_right: "+",
    horizontal: "-",
    vertical: "|",
    tee_right: "+",
    tee_left: "+",
    tree_last: "`-",
    bullet: "*",
    success: "o",
    error: "x",
    warning: "!",
    pending: ".",
    expanded: "v",
    collapsed: ">",
    separator: " - ",
    bracket_left: "[",
    bracket_right: "]",
};

static UNICODE_SUPPORTED: LazyLock<bool> = LazyLock::new(|| {
    ["LC_ALL", "LC_CTYPE", "LANG"]
        .iter()
        .find_map(|key| env::var(key).ok().filter(|value| !value.is_empty()))
        .is_some_and(|value| locale_supports_unicode(&value))
});

/// Whether the terminal locale advertises UTF-8.
pub fn unicode_supported() -> bool {
    *UNICODE_SUPPORTED
}

fn locale_supports_unicode(value: &str) -> bool {
    value.to_ascii_lowercase().contains("utf")
}

pub fn glyphs() -> Glyphs {
    glyphs_for(unicode_supported())
}

pub(crate) fn glyphs_for(unicode: bool) -> Glyphs {
    if unicode { UNICODE } else { ASCII }
}

pub fn tool_icon(kind: ToolKind) -> &'static str {
    let unicode = unicode_supported();
    match (kind, unicode) {
        (ToolKind::Read, true) => "▤",
        (ToolKind::Edit, true) => "✎",
        (ToolKind::Delete, true) => "✂",
        (ToolKind::Move, true) => "➜",
        (ToolKind::Search, true) => "⌕",
        (ToolKind::Execute, true) => "❯",
        (ToolKind::Think, true) => "✻",
        (ToolKind::Fetch, true) => "⇩",
        (ToolKind::Task, true) => "⇶",
        (ToolKind::Plan, true) => "☑",
        (ToolKind::Other, true) => "◆",
        (ToolKind::Read, false) => "R",
        (ToolKind::Edit, false) => "E",
        (ToolKind::Delete, false) => "D",
        (ToolKind::Move, false) => "M",
        (ToolKind::Search, false) => "S",
        (ToolKind::Execute, false) => "$",
        (ToolKind::Think, false) => "T",
        (ToolKind::Fetch, false) => "F",
        (ToolKind::Task, false) => "A",
        (ToolKind::Plan, false) => "P",
        (ToolKind::Other, false) => "*",
    }
}

#[cfg(test)]
mod tests {
    use ratatui::text::Span;

    use super::*;

    #[test]
    fn c_locale_selects_ascii() {
        assert!(!locale_supports_unicode("C"));
        assert!(!locale_supports_unicode("POSIX"));
        assert!(locale_supports_unicode("en_US.UTF-8"));
    }

    #[test]
    fn single_cell_slots_are_exactly_one_column() {
        for set in [UNICODE, ASCII] {
            for glyph in [
                set.top_left,
                set.top_right,
                set.bottom_left,
                set.bottom_right,
                set.horizontal,
                set.vertical,
                set.tee_right,
                set.tee_left,
                set.bullet,
                set.success,
                set.error,
                set.warning,
                set.pending,
                set.expanded,
                set.collapsed,
                set.bracket_left,
                set.bracket_right,
            ] {
                assert_eq!(Span::raw(glyph).width(), 1, "{glyph:?}");
            }
        }
    }
}
