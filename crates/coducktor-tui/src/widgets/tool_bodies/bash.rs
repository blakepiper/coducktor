use ratatui::style::{Modifier, Style};
use ratatui::text::{Line, Span};

use crate::diff::Highlighter;
use crate::widgets::tool_card;
use crate::widgets::transcript::{FrameCtx, ToolItem};

use super::string_field;

pub(super) fn call_body(
    item: &ToolItem,
    _width: u16,
    ctx: FrameCtx<'_>,
) -> Option<Vec<Line<'static>>> {
    let input = item.input.as_ref()?;
    let command = string_field(input, &["command", "cmd", "script"])?;
    let cwd = string_field(input, &["cwd", "workdir", "working_directory"]);
    let commands = command.lines().map(str::to_owned).collect::<Vec<_>>();
    let highlighter = Highlighter::new();
    let highlighted =
        highlighter.highlight_lines("command.sh", &commands, ctx.theme.name.is_dark());
    let mut lines = Vec::with_capacity(commands.len());
    for (index, command) in commands.iter().enumerate() {
        let mut spans = Vec::new();
        if index == 0 {
            spans.push(Span::styled(
                "$ ",
                Style::default()
                    .fg(ctx.theme.palette.soft_fg)
                    .add_modifier(Modifier::DIM),
            ));
            if let Some(cwd) = cwd {
                spans.push(Span::styled(
                    format!("cd {cwd} && "),
                    Style::default()
                        .fg(ctx.theme.palette.soft_fg)
                        .add_modifier(Modifier::DIM),
                ));
            }
        } else {
            spans.push(Span::raw("  "));
        }
        if let Some(highlighted) = highlighted.as_ref().and_then(|lines| lines.get(index)) {
            spans.extend(
                highlighted
                    .iter()
                    .map(|span| Span::styled(span.text.clone(), Style::default().fg(span.color))),
            );
        } else {
            spans.push(Span::styled(
                command.clone(),
                Style::default().fg(ctx.theme.palette.fg),
            ));
        }
        lines.push(Line::from(spans));
    }
    Some(lines)
}

pub(super) fn result_body(
    item: &ToolItem,
    _width: u16,
    ctx: FrameCtx<'_>,
) -> Option<(Span<'static>, Vec<Line<'static>>)> {
    let output = item.output.as_deref()?;
    let mut lines = tool_card::output_lines(item, output, ctx.theme);
    let mut footer = Vec::new();
    if let Some(duration) = item.duration_ms {
        footer.push(format!("Wall: {}", tool_card::format_ms(duration)));
    }
    if let Some(exit) = item.exit_code.filter(|exit| *exit != 0) {
        footer.push(format!("Exit: {exit}"));
    }
    if !footer.is_empty() {
        lines.push(Line::from(Span::styled(
            format!("[{}]", footer.join(" | ")),
            Style::default()
                .fg(ctx.theme.palette.soft_fg)
                .add_modifier(Modifier::DIM),
        )));
    }
    Some((Span::raw("Output"), lines))
}
