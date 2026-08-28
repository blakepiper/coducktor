use ratatui::style::{Modifier, Style};
use ratatui::text::{Line, Span};

use crate::widgets::transcript::{FrameCtx, ToolItem};

use super::string_field;

pub(super) fn call_body(
    item: &ToolItem,
    _width: u16,
    ctx: FrameCtx<'_>,
) -> Option<Vec<Line<'static>>> {
    let input = item.input.as_ref()?;
    let pattern = string_field(input, &["pattern", "query", "regex"])?;
    let path = string_field(input, &["path", "include", "glob"]).unwrap_or("workspace");
    Some(vec![Line::from(vec![
        Span::styled(
            pattern.to_owned(),
            Style::default().fg(ctx.theme.palette.review),
        ),
        Span::styled(
            format!(" in {path}"),
            Style::default()
                .fg(ctx.theme.palette.soft_fg)
                .add_modifier(Modifier::DIM),
        ),
    ])])
}

pub(super) fn result_body(
    item: &ToolItem,
    _width: u16,
    ctx: FrameCtx<'_>,
) -> Option<(Span<'static>, Vec<Line<'static>>)> {
    let output = item.output.as_deref()?;
    let total = output
        .lines()
        .filter(|line| !line.trim().is_empty())
        .count();
    let mut lines = output
        .lines()
        .filter(|line| !line.trim().is_empty())
        .take(8)
        .map(|line| {
            Line::from(Span::styled(
                line.to_owned(),
                Style::default().fg(ctx.theme.palette.soft_fg),
            ))
        })
        .collect::<Vec<_>>();
    if total > lines.len() {
        lines.push(Line::from(Span::styled(
            format!("… {} more matches", total - lines.len()),
            Style::default()
                .fg(ctx.theme.palette.soft_fg)
                .add_modifier(Modifier::DIM),
        )));
    }
    Some((Span::raw("Matches"), lines))
}
