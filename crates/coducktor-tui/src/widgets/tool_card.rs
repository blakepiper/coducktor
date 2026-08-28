//! Status-aware tool cards built on the shared framed-card primitive.

use std::sync::LazyLock;

use coducktor_protocol::{ToolKind, ToolStatus};
use ratatui::buffer::Buffer;
use ratatui::layout::Rect;
use ratatui::style::{Modifier, Style};
use ratatui::text::{Line, Span};
use serde_json::Value;
use unicode_width::UnicodeWidthChar;

use crate::glyphs::{glyphs, tool_icon};
use crate::theme::{ColorCapability, Theme, ThemeName};
use crate::widgets::card::{Card, CardSection, CardState};
use crate::widgets::spinner;
use crate::widgets::tool_bodies;
use crate::widgets::transcript::{FrameCtx, ToolItem};

pub const OUTPUT_CLAMP_LINES: usize = 12;
pub const OUTPUT_EXPANDED_LINES: usize = 200;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum ToolTier {
    Full,
    Folded,
    Summary,
    Hidden,
}

impl ToolTier {
    pub const fn rows(self) -> u16 {
        match self {
            Self::Full => 0,
            Self::Folded => 2,
            Self::Summary => 1,
            Self::Hidden => 0,
        }
    }
}

/// Build the complete card model from stable item data and per-frame presentation context.
pub fn build_card<'a>(item: &'a ToolItem, width: u16, ctx: FrameCtx<'_>) -> Card<'a> {
    let theme = ctx.theme;
    let state = card_state(item.status);
    let mut header = Vec::new();
    let running = matches!(item.status, ToolStatus::Pending | ToolStatus::Running);
    let icon = if running {
        spinner::status_frame(ctx.tick)
    } else {
        tool_icon(item.tool_kind)
    };
    header.push(Span::styled(
        format!("{icon} "),
        Style::default().fg(if running {
            theme.palette.running
        } else {
            verb_color(item.tool_kind, theme)
        }),
    ));

    let (verb, argument) = item.title.split_once(' ').unwrap_or((&item.title, ""));
    header.push(Span::styled(
        verb.to_owned(),
        Style::default()
            .fg(verb_color(item.tool_kind, theme))
            .add_modifier(Modifier::BOLD),
    ));
    if !argument.is_empty() {
        header.push(Span::styled(
            format!(" {argument}"),
            Style::default()
                .fg(theme.palette.fg)
                .add_modifier(Modifier::BOLD),
        ));
    }
    if let Some(subtitle) = item.subtitle.as_deref().filter(|value| !value.is_empty()) {
        header.push(Span::styled(
            format!(": {subtitle}"),
            Style::default().fg(theme.palette.soft_fg),
        ));
    }
    match item.status {
        ToolStatus::Failed => header.push(badge("failed", theme.palette.failed)),
        ToolStatus::Declined => header.push(badge("declined", theme.palette.soft_fg)),
        _ => {}
    }
    if let Some(exit) = item.exit_code.filter(|exit| *exit != 0) {
        header.push(badge(&format!("exit {exit}"), theme.palette.failed));
    }

    let mut meta = Vec::new();
    if let Some(duration) = item.duration_ms {
        meta.push(format_ms(duration));
    } else if running && let Some(started) = item.started_epoch {
        meta.push(short_elapsed(started, ctx.now_epoch));
    }
    if let Some((shown, total)) = output_window(item)
        && total > shown
    {
        meta.push(format!("{shown} lines"));
    }
    meta.extend(tool_bodies::meta(item));

    Card {
        header,
        meta,
        state,
        sections: sections(item, width, ctx),
    }
}

pub fn card_height(item: &ToolItem, width: u16, tier: ToolTier) -> u16 {
    match tier {
        ToolTier::Full => {
            static HEIGHT_THEME: LazyLock<Theme> =
                LazyLock::new(|| Theme::new(ThemeName::Dark, ColorCapability::Ansi16));
            build_card(
                item,
                width,
                FrameCtx {
                    expand_key: "za",
                    theme: &HEIGHT_THEME,
                    tick: 0,
                    now_epoch: 0,
                },
            )
            .height(width)
        }
        ToolTier::Folded => 2,
        ToolTier::Summary => 1,
        ToolTier::Hidden => 0,
    }
}

pub fn paint(item: &ToolItem, buf: &mut Buffer, area: Rect, ctx: FrameCtx<'_>, tier: ToolTier) {
    if tier == ToolTier::Hidden || area.width == 0 || area.height == 0 {
        return;
    }
    let card = build_card(item, area.width, ctx);
    match tier {
        ToolTier::Full => card.render(buf, area, ctx.theme),
        ToolTier::Folded => card.render_folded(buf, area, ctx.theme),
        ToolTier::Summary => card.render_summary("", buf, area, ctx.theme),
        ToolTier::Hidden => {}
    }
}

fn sections(item: &ToolItem, width: u16, ctx: FrameCtx<'_>) -> Vec<CardSection<'static>> {
    let theme = ctx.theme;
    let mut sections = Vec::new();
    let call = tool_bodies::call_body(item, width, ctx).or_else(|| {
        item.input.as_ref().map(|input| {
            vec![Line::from(Span::styled(
                format!("{} {}", glyphs().tree_last, compact_args(input, width)),
                Style::default()
                    .fg(theme.palette.soft_fg)
                    .add_modifier(Modifier::DIM),
            ))]
        })
    });
    if let Some(lines) = call.filter(|lines| !lines.is_empty()) {
        sections.push(CardSection { label: None, lines });
    }
    if let Some(error) = item
        .error
        .as_deref()
        .filter(|value| !value.trim().is_empty())
    {
        sections.push(CardSection {
            label: Some(Span::styled(
                "Error",
                Style::default().fg(theme.palette.failed),
            )),
            lines: wrap_text(error, width.saturating_sub(4))
                .into_iter()
                .map(|line| {
                    Line::from(Span::styled(
                        line,
                        Style::default().fg(theme.palette.failed),
                    ))
                })
                .collect(),
        });
    }
    if item.open() {
        if let Some((label, lines)) = tool_bodies::result_body(item, width, ctx) {
            sections.push(CardSection {
                label: Some(label),
                lines,
            });
        } else if let Some(output) = item.output.as_deref().filter(|value| !value.is_empty()) {
            sections.push(CardSection {
                label: Some(Span::styled(
                    "Output",
                    Style::default().fg(theme.palette.soft_fg),
                )),
                lines: output_lines(item, output, theme, ctx.expand_key),
            });
        }
    }
    sections
}

pub(crate) fn output_lines(
    item: &ToolItem,
    output: &str,
    theme: &Theme,
    expand_key: &str,
) -> Vec<Line<'static>> {
    let total = output.lines().count().max(1);
    let limit = if item.user_expanded == Some(true) {
        OUTPUT_EXPANDED_LINES
    } else {
        OUTPUT_CLAMP_LINES
    };
    let shown = total.min(limit);
    let mut lines = Vec::with_capacity(shown.saturating_add(1));
    if total > shown {
        let hint = if limit == OUTPUT_EXPANDED_LINES {
            format!("… (showing last {shown} of {total})")
        } else {
            format!(
                "… ({} earlier lines, showing {shown} of {total}) ({expand_key} to expand)",
                total - shown
            )
        };
        lines.push(Line::from(Span::styled(
            hint,
            Style::default()
                .fg(theme.palette.soft_fg)
                .add_modifier(Modifier::DIM),
        )));
    }
    lines.extend(
        output
            .lines()
            .skip(total.saturating_sub(shown))
            .map(|line| {
                Line::from(Span::styled(
                    line.to_owned(),
                    Style::default().fg(theme.palette.soft_fg),
                ))
            }),
    );
    lines
}

fn output_window(item: &ToolItem) -> Option<(usize, usize)> {
    let total = item.output.as_deref()?.lines().count().max(1);
    let limit = if item.user_expanded == Some(true) {
        OUTPUT_EXPANDED_LINES
    } else {
        OUTPUT_CLAMP_LINES
    };
    Some((total.min(limit), total))
}

fn compact_args(input: &Value, width: u16) -> String {
    let budget = usize::from(width.saturating_sub(8)).max(8);
    let text = match input {
        Value::Object(map) => map
            .iter()
            .take(3)
            .map(|(key, value)| format!("{key}={}", compact_value(value)))
            .collect::<Vec<_>>()
            .join(" "),
        other => compact_value(other),
    };
    truncate(&text, budget)
}

fn compact_value(value: &Value) -> String {
    match value {
        Value::String(value) => value.lines().next().unwrap_or_default().to_owned(),
        Value::Array(values) => format!("[{} items]", values.len()),
        Value::Object(values) => format!("{{{} fields}}", values.len()),
        other => other.to_string(),
    }
}

fn truncate(value: &str, max_width: usize) -> String {
    if unicode_width::UnicodeWidthStr::width(value) <= max_width {
        return value.to_owned();
    }
    let mut result = String::new();
    let content_width = max_width.saturating_sub(1);
    let mut width = 0;
    for character in value.chars() {
        let character_width = character.width().unwrap_or(0);
        if width + character_width > content_width {
            break;
        }
        result.push(character);
        width += character_width;
    }
    result.push('…');
    result
}

fn wrap_text(value: &str, width: u16) -> Vec<String> {
    let width = usize::from(width.max(1));
    let mut lines = Vec::new();
    for source in value.lines() {
        if source.is_empty() {
            lines.push(String::new());
            continue;
        }
        let mut current = String::new();
        let mut current_width = 0;
        for character in source.chars() {
            let character_width = character.width().unwrap_or(0);
            if current_width > 0 && current_width + character_width > width {
                lines.push(std::mem::take(&mut current));
                current_width = 0;
            }
            current.push(character);
            current_width += character_width;
        }
        lines.push(current);
    }
    if lines.is_empty() {
        lines.push(String::new());
    }
    lines
}

fn badge(text: &str, color: ratatui::style::Color) -> Span<'static> {
    Span::styled(
        format!(" {}{text}{}", glyphs().bracket_left, glyphs().bracket_right),
        Style::default().fg(color),
    )
}

fn verb_color(kind: ToolKind, theme: &Theme) -> ratatui::style::Color {
    match kind {
        ToolKind::Read | ToolKind::Fetch => theme.palette.accent,
        ToolKind::Edit | ToolKind::Move => theme.palette.add,
        ToolKind::Delete => theme.palette.del,
        ToolKind::Search | ToolKind::Think => theme.palette.review,
        ToolKind::Execute => theme.palette.running,
        ToolKind::Task | ToolKind::Plan => theme.palette.waiting,
        ToolKind::Other => theme.palette.soft_fg,
    }
}

fn card_state(status: ToolStatus) -> CardState {
    match status {
        ToolStatus::Pending => CardState::Pending,
        ToolStatus::Running => CardState::Running,
        ToolStatus::Completed => CardState::Success,
        ToolStatus::Failed => CardState::Error,
        ToolStatus::Declined => CardState::Warning,
    }
}

pub(crate) fn format_ms(milliseconds: u64) -> String {
    if milliseconds < 1_000 {
        format!("{milliseconds}ms")
    } else if milliseconds < 60_000 {
        let seconds = milliseconds as f64 / 1_000.0;
        if milliseconds.is_multiple_of(1_000) {
            format!("{}s", milliseconds / 1_000)
        } else {
            format!("{seconds:.1}s")
        }
    } else {
        let seconds = milliseconds / 1_000;
        format!("{}m{}s", seconds / 60, seconds % 60)
    }
}

fn short_elapsed(started: i64, now: i64) -> String {
    let seconds = now.saturating_sub(started).max(0) as u64;
    if seconds < 60 {
        format!("{seconds}s")
    } else {
        format!("{}m{}s", seconds / 60, seconds % 60)
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::theme::{ColorCapability, ThemeName};

    fn theme() -> Theme {
        Theme::new(ThemeName::Dark, ColorCapability::TrueColor)
    }

    fn context<'a>(theme: &'a Theme, tick: u64, now_epoch: i64) -> FrameCtx<'a> {
        FrameCtx {
            expand_key: "za",
            theme,
            tick,
            now_epoch,
        }
    }

    fn row_text(buf: &Buffer, row: u16) -> String {
        (buf.area.x..buf.area.right())
            .map(|x| buf[(x, row)].symbol())
            .collect()
    }

    #[test]
    fn running_card_has_shared_spinner_and_live_elapsed() {
        let theme = theme();
        let mut item = ToolItem::new(
            "tool",
            "Bash",
            Some(&serde_json::json!({"command": "cargo test"})),
            ToolStatus::Running,
        );
        item.started_epoch = Some(96);
        item.is_latest = true;
        let height = card_height(&item, 80, ToolTier::Full);
        let area = Rect::new(0, 0, 80, height);
        let mut buf = Buffer::empty(area);
        paint(
            &item,
            &mut buf,
            area,
            context(&theme, 0, 100),
            ToolTier::Full,
        );
        let header = row_text(&buf, 0);
        assert!(header.starts_with("╭─── ⣾ Ran"));
        assert!(header.contains("4s"));
        assert_eq!(buf[(0, 0)].fg, theme.palette.accent);
        assert_eq!(buf[(1, 1)].bg, theme.palette.card_pending_bg);
    }

    #[test]
    fn failed_card_has_error_section_tint_and_exit_chip() {
        let theme = theme();
        let mut item = ToolItem::new(
            "tool",
            "Bash",
            Some(&serde_json::json!({"command": "false"})),
            ToolStatus::Failed,
        );
        item.error = Some("command failed".to_owned());
        item.exit_code = Some(1);
        item.is_latest = true;
        let height = card_height(&item, 80, ToolTier::Full);
        let area = Rect::new(0, 0, 80, height);
        let mut buf = Buffer::empty(area);
        paint(
            &item,
            &mut buf,
            area,
            context(&theme, 0, 100),
            ToolTier::Full,
        );
        let rendered = (0..height)
            .map(|row| row_text(&buf, row))
            .collect::<String>();
        assert!(rendered.contains("Error"));
        assert!(rendered.contains("exit 1"));
        assert_eq!(buf[(0, 0)].fg, theme.palette.failed);
        assert_eq!(buf[(1, 1)].bg, theme.palette.card_error_bg);
    }

    #[test]
    fn card_height_matches_rows_painted_at_supported_widths() {
        let theme = theme();
        let mut item = ToolItem::new(
            "tool",
            "Bash",
            Some(&serde_json::json!({"command": "cargo test"})),
            ToolStatus::Running,
        );
        item.output = Some(
            (0..30)
                .map(|line| format!("line {line}"))
                .collect::<Vec<_>>()
                .join("\n"),
        );
        item.is_latest = true;
        for width in [40, 80, 120, 200] {
            let height = card_height(&item, width, ToolTier::Full);
            let area = Rect::new(0, 0, width, height);
            let mut buf = Buffer::empty(area);
            paint(
                &item,
                &mut buf,
                area,
                context(&theme, 6, 100),
                ToolTier::Full,
            );
            let painted = (0..height)
                .filter(|row| !row_text(&buf, *row).trim().is_empty())
                .count();
            assert_eq!(painted, usize::from(height), "width {width}");
        }
    }

    #[test]
    fn clamped_output_hint_uses_the_configured_toggle_binding() {
        let mut item = ToolItem::new("tool", "Bash", None, ToolStatus::Completed);
        let output = (0..30)
            .map(|line| format!("line {line}"))
            .collect::<Vec<_>>()
            .join("\n");
        let rendered = output_lines(&item, &output, &theme(), "zx")
            .into_iter()
            .map(|line| line.to_string())
            .collect::<String>();
        assert!(rendered.contains("(zx to expand)"));

        item.user_expanded = Some(true);
        let expanded = output_lines(&item, &output, &theme(), "zx")
            .into_iter()
            .map(|line| line.to_string())
            .collect::<String>();
        assert!(!expanded.contains("to expand"));
    }

    #[test]
    fn duration_format_uses_compact_units() {
        assert_eq!(format_ms(340), "340ms");
        assert_eq!(format_ms(2_400), "2.4s");
        assert_eq!(format_ms(72_000), "1m12s");
    }
}
