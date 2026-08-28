use coducktor_protocol::ToolStatus;
use ratatui::style::{Modifier, Style};
use ratatui::text::{Line, Span};

use crate::glyphs::glyphs;
use crate::widgets::tool_card;
use crate::widgets::transcript::{FrameCtx, ToolItem};

use super::string_field;

pub(super) fn call_body(
    item: &ToolItem,
    _width: u16,
    ctx: FrameCtx<'_>,
) -> Option<Vec<Line<'static>>> {
    let input = item.input.as_ref()?;
    let prompt = string_field(input, &["prompt", "task", "description"])?;
    let agent = string_field(input, &["subagent_type", "subagentType", "agent"]);
    let mut lines = Vec::new();
    if let Some(agent) = agent {
        lines.push(Line::from(Span::styled(
            format!(
                "{}{}{}",
                glyphs().bracket_left,
                agent,
                glyphs().bracket_right
            ),
            Style::default().fg(ctx.theme.palette.waiting),
        )));
    }
    let prefix = if matches!(item.status, ToolStatus::Pending | ToolStatus::Running) {
        format!("{} ", glyphs().tree_last)
    } else {
        String::new()
    };
    lines.extend(prompt.lines().take(2).map(|line| {
        Line::from(Span::styled(
            format!("{prefix}{line}"),
            Style::default()
                .fg(ctx.theme.palette.soft_fg)
                .add_modifier(Modifier::DIM | Modifier::ITALIC),
        ))
    }));
    Some(lines)
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
