use ratatui::style::{Modifier, Style};
use ratatui::text::{Line, Span};
use serde_json::Value;

use crate::glyphs::unicode_supported;
use crate::widgets::tool_card;
use crate::widgets::transcript::{FrameCtx, ToolItem};

pub(super) fn call_body(
    item: &ToolItem,
    _width: u16,
    ctx: FrameCtx<'_>,
) -> Option<Vec<Line<'static>>> {
    let input = item.input.as_ref()?;
    let entries = input
        .get("todos")
        .or_else(|| input.get("items"))
        .or_else(|| input.get("plan"))?
        .as_array()?;
    let mut lines = Vec::with_capacity(entries.len());
    for entry in entries {
        let (text, status) = match entry {
            Value::String(text) => (text.as_str(), "pending"),
            Value::Object(_) => {
                let text = entry
                    .get("content")
                    .or_else(|| entry.get("text"))
                    .or_else(|| entry.get("task"))
                    .and_then(Value::as_str)
                    .unwrap_or("task");
                let status = entry
                    .get("status")
                    .and_then(Value::as_str)
                    .unwrap_or("pending");
                (text, status)
            }
            _ => continue,
        };
        let complete = matches!(status, "completed" | "done");
        let active = matches!(status, "in_progress" | "inProgress" | "active");
        let glyph = match (unicode_supported(), complete, active) {
            (true, true, _) => "☑",
            (true, false, true) => "▸",
            (true, false, false) => "☐",
            (false, true, _) => "[x]",
            (false, false, true) => "[>]",
            (false, false, false) => "[ ]",
        };
        let style = if complete {
            Style::default().fg(ctx.theme.palette.done)
        } else if active {
            Style::default()
                .fg(ctx.theme.palette.running)
                .add_modifier(Modifier::BOLD)
        } else {
            Style::default().fg(ctx.theme.palette.soft_fg)
        };
        lines.push(Line::from(Span::styled(format!("{glyph} {text}"), style)));
    }
    (!lines.is_empty()).then_some(lines)
}

pub(super) fn result_body(
    item: &ToolItem,
    _width: u16,
    ctx: FrameCtx<'_>,
) -> Option<(Span<'static>, Vec<Line<'static>>)> {
    let output = item.output.as_deref()?;
    Some((
        Span::raw("Result"),
        tool_card::output_lines(item, output, ctx.theme),
    ))
}
