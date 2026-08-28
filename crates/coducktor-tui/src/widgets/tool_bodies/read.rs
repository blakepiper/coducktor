use ratatui::style::{Modifier, Style};
use ratatui::text::{Line, Span};

use crate::widgets::tool_card;
use crate::widgets::transcript::{FrameCtx, ToolItem};

use super::number_field;

pub(super) fn call_body(
    _item: &ToolItem,
    _width: u16,
    _ctx: FrameCtx<'_>,
) -> Option<Vec<Line<'static>>> {
    None
}

pub(super) fn result_body(
    item: &ToolItem,
    _width: u16,
    ctx: FrameCtx<'_>,
) -> Option<(Span<'static>, Vec<Line<'static>>)> {
    let output = item.output.as_deref()?;
    if item.user_expanded == Some(true) {
        return Some((
            Span::raw("Contents"),
            tool_card::output_lines(item, output, ctx.theme, ctx.expand_key),
        ));
    }
    let line_count = output.lines().count();
    let kib = output.len() as f64 / 1024.0;
    Some((
        Span::raw("Contents"),
        vec![Line::from(Span::styled(
            format!("{line_count} lines · {kib:.1} KB"),
            Style::default()
                .fg(ctx.theme.palette.soft_fg)
                .add_modifier(Modifier::DIM),
        ))],
    ))
}

pub(super) fn meta(item: &ToolItem) -> Vec<String> {
    let Some(input) = item.input.as_ref() else {
        return Vec::new();
    };
    let Some(offset) = number_field(input, &["offset", "line", "start_line"]) else {
        return Vec::new();
    };
    let start = offset.max(1);
    match number_field(input, &["limit", "line_count"]) {
        Some(limit) if limit > 0 => vec![format!("L{start}–L{}", start + limit - 1)],
        _ => vec![format!("L{start}")],
    }
}
