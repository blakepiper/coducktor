//! Presentational render functions for the task thread's sub-modules: header +
//! actions, step rail, subagent sheet, ask card, review panel,
//! auto-resume hint. Each function draws into a given `Rect` and registers its own
//! `HitAction::ThreadScreen(_)` regions; none of them own state beyond what `ThreadUi` passes
//! in. The review panel exposes its banner, notes box, and Send back / Draft PR / Accept actions;
//! task Git tab navigation is registered by `render_header`.

use coducktor_contract::{ApiRun, RunRecord, StepKind};
use coducktor_protocol::UiItem;
use ratatui::Frame;
use ratatui::layout::Rect;
use ratatui::style::{Modifier, Style};
use ratatui::text::{Line, Span, Text};
use ratatui::widgets::{Block, Borders, Paragraph, Wrap};

use crate::input::hitmap::HitAction;
use crate::screens::runs_util::{attention, compact_tokens, parse_iso_seconds, run_title};
use crate::theme::Theme;
use crate::widgets::run_end::{self, RunOutcome};

use super::actions::run_action_flags;
use super::reducer::{ThreadAsk, ThreadEntry, ThreadState};
use super::{PlaceboDuck, ThreadAction};

pub(crate) struct PlaceboDuckView<'a> {
    state: PlaceboDuck,
    tick: u64,
    pet_key: &'a str,
}

impl<'a> PlaceboDuckView<'a> {
    pub(crate) fn new(state: PlaceboDuck, tick: u64, pet_key: &'a str) -> Self {
        Self {
            state,
            tick,
            pet_key,
        }
    }
}

/// The header: title, status pill, meta row, tabs, action bar. Returns the height it used.
/// The conversation header. Harness, model, reasoning, branch, and worktree are immutable
/// affinity and live here rather than in every follow-up composer (section 5.1); Git mode is
/// shown here too and is the one value that can still change, while idle.
pub fn render_conversation_header(
    frame: &mut Frame<'_>,
    area: Rect,
    record: &coducktor_contract::ConversationRecord,
    theme: &Theme,
    hitmap: &mut crate::input::hitmap::HitMap,
    action_focus: Option<usize>,
    placebo_duck: PlaceboDuckView<'_>,
) -> u16 {
    use crate::screens::chats_util;

    if area.height == 0 {
        return 0;
    }
    let entry = coducktor_client::conversation_index_entry(&record.project_id, record);
    let att = chats_util::attention(&entry);
    let mut title_line = vec![
        Span::styled(
            record.title.clone(),
            Style::default()
                .fg(theme.palette.fg)
                .add_modifier(Modifier::BOLD),
        ),
        Span::raw("  "),
        Span::styled(format!("[{}]", att.label), att.tone.style(theme)),
    ];
    if record.seen_at.is_none() {
        title_line.push(Span::styled(
            " ●",
            Style::default().fg(theme.palette.review),
        ));
    }
    let duck = duck_layout(area);
    let text_area = duck.map_or(area, |(duck_area, _)| {
        Rect::new(
            area.x,
            area.y,
            duck_area.x.saturating_sub(area.x).saturating_sub(1),
            area.height,
        )
    });
    let mut lines = vec![Line::from(title_line)];

    let soft = Style::default().fg(theme.palette.soft_fg);
    let affinity = conversation_affinity(
        record.harness,
        record.model.as_deref(),
        record.model_identity.as_deref(),
        record.reasoning.as_deref(),
        record.reasoning_identity.as_deref(),
    );
    let mut meta = vec![Span::styled(format!("{affinity}  "), soft)];
    if let Some(branch) = &record.branch {
        meta.push(Span::styled(format!("{branch}  "), soft));
    }
    meta.push(Span::styled(
        format!(
            "{}  ",
            if record.worktree {
                "worktree"
            } else {
                "in place"
            }
        ),
        soft,
    ));
    meta.push(Span::styled(
        format!(
            "git: {}  ",
            match record.git_mode {
                coducktor_contract::ConversationGitMode::Auto => "auto",
                coducktor_contract::ConversationGitMode::Manual => "manual",
            }
        ),
        soft,
    ));
    meta.push(Span::styled(
        format!(
            "{} tok  ${:.2}",
            record.tokens_used as i64,
            record.cost_usd.unwrap_or(0.0)
        ),
        soft,
    ));
    lines.push(Line::from(meta));

    lines.push(Line::from(git_tab_spans(text_area, hitmap, theme)));

    let actions = conversation_header_actions(record);
    let mut action_spans = Vec::new();
    for (index, (label, _)) in actions.iter().enumerate() {
        let style = if action_focus == Some(index) {
            Style::default()
                .fg(theme.palette.accent)
                .add_modifier(Modifier::BOLD | Modifier::REVERSED)
        } else {
            Style::default().fg(theme.palette.fg)
        };
        action_spans.push(Span::styled(format!("[{label}] "), style));
    }
    lines.push(Line::from(action_spans));

    let height = (lines.len() as u16).min(area.height);
    frame.render_widget(
        Paragraph::new(Text::from(lines)).style(Style::default().fg(theme.palette.fg)),
        Rect::new(text_area.x, text_area.y, text_area.width, height),
    );
    if let Some((duck_area, full)) = duck {
        render_placebo_duck(
            frame,
            duck_area,
            full,
            placebo_duck.state,
            placebo_duck.tick,
            placebo_duck.pet_key,
            theme,
        );
        hitmap.register(duck_area, 5, HitAction::ThreadScreen(ThreadAction::PetDuck));
    }
    if let Some(action_row) = area.y.checked_add(3)
        && action_row < area.bottom()
    {
        let mut cursor = area.x;
        for (label, action) in &actions {
            let width = label.chars().count() as u16 + 3;
            if cursor >= text_area.right() {
                break;
            }
            hitmap.register(
                Rect::new(cursor, action_row, width.min(text_area.right() - cursor), 1),
                4,
                HitAction::ThreadScreen(action.clone()),
            );
            cursor += width;
        }
    }
    height
}

fn conversation_affinity(
    harness: coducktor_contract::Runner,
    model: Option<&str>,
    model_identity: Option<&str>,
    reasoning: Option<&str>,
    reasoning_identity: Option<&str>,
) -> String {
    let harness = format!("{harness:?}").to_ascii_lowercase();
    let model = model.or(model_identity).unwrap_or("auto");
    let reasoning = reasoning.or(reasoning_identity).unwrap_or("auto");
    format!("{harness}/{model} · {reasoning}")
}

const FULL_DUCK_WIDTH: u16 = 26;
const COMPACT_DUCK_WIDTH: u16 = 18;

fn duck_layout(area: Rect) -> Option<(Rect, bool)> {
    if area.height >= 4 && area.width >= 110 {
        Some((
            Rect::new(
                area.right().saturating_sub(FULL_DUCK_WIDTH),
                area.y,
                FULL_DUCK_WIDTH,
                4,
            ),
            true,
        ))
    } else if area.height >= 2 && area.width >= 86 {
        Some((
            Rect::new(
                area.right().saturating_sub(COMPACT_DUCK_WIDTH),
                area.y,
                COMPACT_DUCK_WIDTH,
                2,
            ),
            false,
        ))
    } else {
        None
    }
}

/// Width of the ASCII duck column, including the star ring, so the text column lines up.
const DUCK_ART_WIDTH: usize = 13;

/// `(row, column)` cells around the duck, clockwise from the top-left, that the star ring
/// fills. The four true corners of the `DUCK_ART_WIDTH`-wide box anchor a rectangle — not an
/// inscribed circle — so the edges stay straight and the corners stay square.
const STAR_RING: [(usize, usize); 12] = [
    (0, 0),
    (0, 3),
    (0, 9),
    (0, 12),
    (1, 12),
    (2, 12),
    (3, 12),
    (3, 9),
    (3, 3),
    (3, 0),
    (2, 0),
    (1, 0),
];

/// Splits one art row into spans so lit stars pick up the accent colour and the duck does not.
fn star_spans(row: &[char], duck_style: Style, accent: Style) -> Vec<Span<'static>> {
    let mut spans: Vec<Span<'static>> = Vec::new();
    let mut chunk = String::new();
    let mut chunk_is_star = false;
    for &cell in row {
        let is_star = cell == '*';
        if is_star != chunk_is_star && !chunk.is_empty() {
            spans.push(Span::styled(
                std::mem::take(&mut chunk),
                if chunk_is_star { accent } else { duck_style },
            ));
        }
        chunk_is_star = is_star;
        chunk.push(cell);
    }
    if !chunk.is_empty() {
        spans.push(Span::styled(
            chunk,
            if chunk_is_star { accent } else { duck_style },
        ));
    }
    spans
}

fn render_placebo_duck(
    frame: &mut Frame<'_>,
    area: Rect,
    full: bool,
    duck: PlaceboDuck,
    tick: u64,
    pet_key: &str,
    theme: &Theme,
) {
    let combo = duck.combo_at(tick);
    let elapsed = duck.elapsed(tick);
    let eye = match elapsed {
        Some(0..=1) => "-",
        Some(2..=4) => "^",
        _ => "o",
    };
    let key = placebo_key_label(pet_key);
    let accent = Style::default()
        .fg(theme.palette.accent)
        .add_modifier(Modifier::BOLD);
    let soft = Style::default().fg(theme.palette.soft_fg);
    let duck_style = Style::default().fg(theme.palette.fg);
    let label = format!("{key} PET DUCK");
    let combo_text = if combo == 0 {
        String::new()
    } else {
        format!("combo x{combo}")
    };

    let lines = if full {
        let art = [
            "    __".to_owned(),
            format!("  <({eye} )___"),
            "   ( ._> /".to_owned(),
            "    `---'".to_owned(),
        ];
        let mut grid: Vec<Vec<char>> = art
            .iter()
            .map(|row| {
                let mut cells: Vec<char> = row.chars().collect();
                cells.resize(DUCK_ART_WIDTH, ' ');
                cells
            })
            .collect();
        // Each pet lights the next star clockwise; a completed ring wraps and starts over, so
        // the spam never runs out of ring.
        let lit = usize::from(combo % (STAR_RING.len() as u16));
        let lit = if combo > 0 && lit == 0 {
            STAR_RING.len()
        } else {
            lit
        };
        for &(row, column) in STAR_RING.iter().take(lit) {
            grid[row][column] = '*';
        }
        let art_spans =
            |row: usize| -> Vec<Span<'static>> { star_spans(&grid[row], duck_style, accent) };
        let mut second = art_spans(1);
        second.push(Span::styled(label, accent));
        let mut third = art_spans(2);
        third.push(Span::styled(combo_text, soft));
        vec![
            Line::from(art_spans(0)),
            Line::from(second),
            Line::from(third),
            Line::from(art_spans(3)),
        ]
    } else {
        vec![
            Line::from(vec![
                Span::styled(format!("<({eye} )> "), duck_style),
                Span::styled(label, accent),
            ]),
            Line::from(vec![Span::raw("       "), Span::styled(combo_text, soft)]),
        ]
    };
    frame.render_widget(Paragraph::new(Text::from(lines)), area);
}

fn placebo_key_label(binding: &str) -> String {
    binding
        .strip_prefix("ctrl-")
        .filter(|key| key.chars().count() == 1)
        .map(|key| format!("^{}", key.to_ascii_uppercase()))
        .unwrap_or_else(|| binding.to_owned())
}

/// What a conversation can do from its header. Section 5.5 keeps Changes/Files/Commits, Git and
/// PR actions, archive, delete, mark read/unread, and cancel — and nothing else.
pub(crate) fn conversation_header_actions(
    record: &coducktor_contract::ConversationRecord,
) -> Vec<(&'static str, ThreadAction)> {
    let mut actions = Vec::new();
    if record.state.is_active() {
        actions.push(("Cancel", ThreadAction::Cancel));
    }
    if !record.state.is_active() {
        // Git mode governs post-turn behavior, so it may only change while idle (section 4.1).
        actions.push((
            match record.git_mode {
                coducktor_contract::ConversationGitMode::Auto => "Git: auto",
                coducktor_contract::ConversationGitMode::Manual => "Git: manual",
            },
            ThreadAction::ToggleGitMode,
        ));
    }
    actions.push((
        if record.archived {
            "Restore"
        } else {
            "Archive"
        },
        ThreadAction::Archive,
    ));
    // Offered only after the harness actually refused to resume its own session. Ordinary
    // failures do not get this action, because replaying a transcript is a repair, not a retry.
    if record.resume_failed && !record.state.is_active() {
        actions.push(("Restart session", ThreadAction::RestartSession));
    }
    if !record.archived && record.seen_at.is_some() {
        actions.push(("Mark unread", ThreadAction::MarkUnread));
    }
    if !record.state.is_active() {
        actions.push(("Delete", ThreadAction::Delete));
    }
    actions
}

/// The Session/Changes/Files/Commits tab row, shared by both header kinds.
fn git_tab_spans(
    area: Rect,
    hitmap: &mut crate::input::hitmap::HitMap,
    theme: &Theme,
) -> Vec<Span<'static>> {
    let tabs: [(&str, Option<HitAction>); 4] = [
        ("Session", None),
        (
            "Changes",
            Some(HitAction::ThreadScreen(ThreadAction::OpenGitTab(
                crate::app::TaskGitTab::Changes,
            ))),
        ),
        (
            "Files",
            Some(HitAction::ThreadScreen(ThreadAction::OpenGitTab(
                crate::app::TaskGitTab::Files,
            ))),
        ),
        (
            "Commits",
            Some(HitAction::ThreadScreen(ThreadAction::OpenGitTab(
                crate::app::TaskGitTab::Commits,
            ))),
        ),
    ];
    let mut tab_spans = Vec::new();
    let tab_row_y = area.y.saturating_add(2);
    let mut tab_x = area.x;
    for (index, (tab, action)) in tabs.iter().enumerate() {
        let active = index == 0;
        let label = format!(" {tab} ");
        let width = label.chars().count() as u16;
        tab_spans.push(Span::styled(
            label,
            if active {
                Style::default()
                    .fg(theme.palette.accent)
                    .add_modifier(Modifier::BOLD)
            } else {
                Style::default().fg(theme.palette.soft_fg)
            },
        ));
        if let Some(action) = action.clone()
            && tab_row_y < area.bottom()
        {
            hitmap.register(Rect::new(tab_x, tab_row_y, width, 1), 3, action);
        }
        tab_x = tab_x.saturating_add(width);
    }
    tab_spans
}

pub fn render_header(
    frame: &mut Frame<'_>,
    area: Rect,
    run: &ApiRun,
    theme: &Theme,
    hitmap: &mut crate::input::hitmap::HitMap,
    action_focus: Option<usize>,
) -> u16 {
    if area.height == 0 {
        return 0;
    }
    let record = &run.record;
    let att = attention(run);
    let mut title_line = vec![
        Span::styled(
            run_title(run),
            Style::default()
                .fg(theme.palette.fg)
                .add_modifier(Modifier::BOLD),
        ),
        Span::raw("  "),
        Span::styled(format!("[{}]", att.label), att.tone.style(theme)),
    ];
    if record.seen_at.is_none() {
        title_line.push(Span::styled(
            " ●",
            Style::default().fg(theme.palette.review),
        ));
    }
    let mut lines = vec![Line::from(title_line)];

    let mut meta = Vec::new();
    if let Some(agent) = agent_metadata(record) {
        meta.push(Span::styled(
            format!("{agent}  "),
            Style::default().fg(theme.palette.soft_fg),
        ));
    }
    meta.push(Span::styled(
        format!("{}  ", record.workflow),
        Style::default().fg(theme.palette.soft_fg),
    ));
    if let Some(branch) = &record.branch {
        meta.push(Span::styled(
            format!("{branch}  "),
            Style::default().fg(theme.palette.soft_fg),
        ));
    }
    if let Some(stat) = &record.diff_stat {
        meta.push(Span::styled(
            format!("+{} -{}  ", stat.adds as i64, stat.dels as i64),
            Style::default().fg(theme.palette.soft_fg),
        ));
    }
    meta.push(Span::styled(
        format!(
            "{} tok  ${:.2}",
            record.tokens_used as i64,
            record.cost_usd.unwrap_or(0.0)
        ),
        Style::default().fg(theme.palette.soft_fg),
    ));
    lines.push(Line::from(meta));

    let tabs: [(&str, Option<HitAction>); 4] = [
        ("Session", None),
        (
            "Changes",
            Some(HitAction::ThreadScreen(ThreadAction::OpenGitTab(
                crate::app::TaskGitTab::Changes,
            ))),
        ),
        (
            "Files",
            Some(HitAction::ThreadScreen(ThreadAction::OpenGitTab(
                crate::app::TaskGitTab::Files,
            ))),
        ),
        (
            "Commits",
            Some(HitAction::ThreadScreen(ThreadAction::OpenGitTab(
                crate::app::TaskGitTab::Commits,
            ))),
        ),
    ];
    let mut tab_spans = Vec::new();
    let tab_row_y = area.y.saturating_add(2);
    let mut tab_x = area.x;
    for (index, (tab, action)) in tabs.iter().enumerate() {
        let active = index == 0;
        let label = format!(" {tab} ");
        let width = label.chars().count() as u16;
        tab_spans.push(Span::styled(
            label,
            if active {
                Style::default()
                    .fg(theme.palette.accent)
                    .add_modifier(Modifier::BOLD)
            } else {
                Style::default().fg(theme.palette.soft_fg)
            },
        ));
        if let Some(action) = action.clone()
            && tab_row_y < area.bottom()
        {
            hitmap.register(Rect::new(tab_x, tab_row_y, width, 1), 3, action);
        }
        tab_x = tab_x.saturating_add(width);
    }
    lines.push(Line::from(tab_spans));

    let actions = header_actions(run);
    let mut action_spans = Vec::new();
    for (index, (label, _)) in actions.iter().enumerate() {
        let style = if action_focus == Some(index) {
            Style::default()
                .fg(theme.palette.accent)
                .add_modifier(Modifier::BOLD | Modifier::REVERSED)
        } else {
            Style::default().fg(theme.palette.fg)
        };
        action_spans.push(Span::styled(format!("[{label}] "), style));
    }
    lines.push(Line::from(action_spans));

    let height = (lines.len() as u16).min(area.height);
    frame.render_widget(
        Paragraph::new(Text::from(lines)).style(Style::default().fg(theme.palette.fg)),
        Rect::new(area.x, area.y, area.width, height),
    );

    // Register action hit-rects on the action-bar row (the 4th line, index 3).
    if let Some(action_row) = area.y.checked_add(3)
        && action_row < area.bottom()
    {
        let mut cursor = area.x;
        for (label, action) in &actions {
            let width = label.chars().count() as u16 + 3;
            hitmap.register(
                Rect::new(cursor, action_row, width, 1),
                4,
                HitAction::ThreadScreen(action.clone()),
            );
            cursor += width;
        }
    }
    height
}

pub(crate) fn header_actions(run: &ApiRun) -> Vec<(&'static str, ThreadAction)> {
    let record = &run.record;
    let flags = run_action_flags(run);
    let mut actions = Vec::new();
    if flags.archive {
        actions.push((
            if record.archived {
                "Restore"
            } else {
                "Archive"
            },
            ThreadAction::Archive,
        ));
    }
    if flags.mark_unread {
        actions.push(("Mark unread", ThreadAction::MarkUnread));
    }
    if flags.cancel {
        actions.push(("Cancel", ThreadAction::Cancel));
    }
    if flags.delete_run {
        actions.push(("Delete", ThreadAction::Delete));
    }
    actions
}

fn agent_metadata(record: &RunRecord) -> Option<String> {
    let step = record
        .steps
        .iter()
        .find(|step| {
            step.kind == StepKind::Agent
                && matches!(
                    step.status,
                    coducktor_contract::StepStatus::Running
                        | coducktor_contract::StepStatus::Waiting
                )
        })
        .or_else(|| {
            record.steps.iter().rev().find(|step| {
                step.kind == StepKind::Agent
                    && (step.backend.is_some()
                        || step.model_identity.is_some()
                        || step.reasoning_effort.is_some())
            })
        });
    let runner = step
        .and_then(|step| step.backend)
        .or(record.runner)
        .map(|runner| format!("runner {}", format!("{runner:?}").to_ascii_lowercase()))
        .or_else(|| {
            record
                .requested_runner
                .map(|runner| format!("runner {}", format!("{runner:?}").to_ascii_lowercase()))
        });
    let model = step
        .and_then(|step| step.model_identity.as_deref())
        .or(record.model_identity.as_deref())
        .or(record.model.as_deref())
        .map(|model| format!("model {model}"));
    let reasoning = step
        .and_then(|step| step.reasoning_effort)
        .map(|effort| format!("reasoning {}", format!("{effort:?}").to_ascii_lowercase()))
        .or_else(|| {
            record
                .reasoning_effort
                .map(|effort| format!("reasoning {}", format!("{effort:?}").to_ascii_lowercase()))
        });
    [runner, model, reasoning]
        .into_iter()
        .flatten()
        .reduce(|mut all, value| {
            all.push_str(" · ");
            all.push_str(&value);
            all
        })
}

/// The workflow step rail: one collapsed summary line, or the full per-step list when expanded.
pub fn render_step_rail(
    frame: &mut Frame<'_>,
    area: Rect,
    run: &ApiRun,
    collapsed: bool,
    theme: &Theme,
    hitmap: &mut crate::input::hitmap::HitMap,
) -> u16 {
    let steps = &run.record.steps;
    if steps.is_empty() || area.height == 0 {
        return 0;
    }
    let total = steps.len();
    let done = steps
        .iter()
        .filter(|s| {
            matches!(
                s.status,
                coducktor_contract::StepStatus::Done
                    | coducktor_contract::StepStatus::Failed
                    | coducktor_contract::StepStatus::Cancelled
                    | coducktor_contract::StepStatus::Skipped
            )
        })
        .count();
    let active_index = steps
        .iter()
        .position(|s| {
            matches!(
                s.status,
                coducktor_contract::StepStatus::Running
                    | coducktor_contract::StepStatus::Waiting
                    | coducktor_contract::StepStatus::Review
            )
        })
        .or_else(|| {
            steps
                .iter()
                .position(|s| s.status == coducktor_contract::StepStatus::Pending)
        })
        .unwrap_or(total.saturating_sub(1));
    let current_name = steps
        .get(active_index)
        .map(|s| s.name.as_str())
        .unwrap_or("");
    let line = Line::from(vec![
        Span::styled(
            if collapsed { "\u{25b8} " } else { "\u{25be} " },
            Style::default().fg(theme.palette.soft_fg),
        ),
        Span::styled(
            current_name.to_owned(),
            Style::default().fg(theme.palette.fg),
        ),
        Span::styled(
            format!("  step {} of {total}", active_index + 1),
            Style::default().fg(theme.palette.soft_fg),
        ),
    ]);
    frame.render_widget(
        Paragraph::new(line),
        Rect::new(area.x, area.y, area.width, 1),
    );
    hitmap.register(
        Rect::new(area.x, area.y, area.width, 1),
        4,
        HitAction::ThreadScreen(ThreadAction::ToggleStepRail),
    );
    if collapsed || area.height < 2 {
        return 1;
    }
    let mut row = area.y + 1;
    let bottom = area.bottom();
    for step in steps {
        if row >= bottom {
            break;
        }
        let glyph = match step.status {
            coducktor_contract::StepStatus::Done => {
                Span::styled("✓ ", Style::default().fg(theme.palette.done))
            }
            coducktor_contract::StepStatus::Failed => {
                Span::styled("✗ ", Style::default().fg(theme.palette.failed))
            }
            coducktor_contract::StepStatus::Cancelled | coducktor_contract::StepStatus::Skipped => {
                Span::styled("- ", Style::default().fg(theme.palette.soft_fg))
            }
            coducktor_contract::StepStatus::Running
            | coducktor_contract::StepStatus::Waiting
            | coducktor_contract::StepStatus::Review => {
                Span::styled("● ", Style::default().fg(theme.palette.running))
            }
            coducktor_contract::StepStatus::Pending => {
                Span::styled("○ ", Style::default().fg(theme.palette.soft_fg))
            }
        };
        frame.render_widget(
            Paragraph::new(Line::from(vec![
                glyph,
                Span::styled(step.name.clone(), Style::default().fg(theme.palette.fg)),
            ])),
            Rect::new(area.x + 2, row, area.width.saturating_sub(2), 1),
        );
        row += 1;
    }
    let _ = done;
    row - area.y
}

/// The AskUser card: the agent asked one or more structured questions via `DUCK:ASK`.
pub fn render_ask_card(
    frame: &mut Frame<'_>,
    area: Rect,
    ask: &ThreadAsk,
    selections: &[Vec<String>],
    focus: (usize, usize),
    theme: &Theme,
    hitmap: &mut crate::input::hitmap::HitMap,
) -> u16 {
    if area.height == 0 {
        return 0;
    }
    frame.render_widget(
        Paragraph::new(Line::from(Span::styled(
            "The agent is asking",
            Style::default()
                .fg(theme.palette.accent)
                .add_modifier(Modifier::BOLD),
        ))),
        Rect::new(area.x, area.y, area.width, 1),
    );
    let mut row = area.y + 1;
    for (qi, question) in ask.questions.iter().enumerate() {
        if row >= area.bottom() {
            break;
        }
        frame.render_widget(
            Paragraph::new(Line::from(vec![
                Span::styled(
                    format!("[{}] ", question.header),
                    Style::default().fg(theme.palette.accent),
                ),
                Span::styled(
                    question.question.clone(),
                    Style::default()
                        .fg(theme.palette.fg)
                        .add_modifier(Modifier::BOLD),
                ),
            ])),
            Rect::new(area.x, row, area.width, 1),
        );
        row += 1;
        for (oi, option) in question.options.iter().enumerate() {
            if row >= area.bottom() {
                break;
            }
            let selected = selections
                .get(qi)
                .is_some_and(|labels| labels.contains(&option.label));
            let is_focus = focus == (qi, oi);
            let marker = if selected { "[x]" } else { "[ ]" };
            let style = if is_focus {
                Style::default()
                    .fg(theme.palette.bg)
                    .bg(theme.palette.accent)
            } else if selected {
                Style::default().fg(theme.palette.accent)
            } else {
                Style::default().fg(theme.palette.fg)
            };
            let persists = matches!(
                option.kind,
                Some(coducktor_protocol::PermissionOptionKind::AllowAlways)
                    | Some(coducktor_protocol::PermissionOptionKind::RejectAlways)
            );
            let label = if persists {
                format!("  {marker} {} (remembers this choice)", option.label)
            } else {
                format!("  {marker} {}", option.label)
            };
            frame.render_widget(
                Paragraph::new(Line::from(Span::styled(label, style))),
                Rect::new(area.x, row, area.width, 1),
            );
            hitmap.register(
                Rect::new(area.x, row, area.width, 1),
                4,
                HitAction::ThreadScreen(ThreadAction::AskOption {
                    question: qi,
                    option: oi,
                }),
            );
            row += 1;
        }
    }
    if row < area.bottom() {
        frame.render_widget(
            Paragraph::new(Line::from(Span::styled(
                " [Send answer]  Space select · Enter send",
                Style::default().fg(theme.palette.soft_fg),
            ))),
            Rect::new(area.x, row, area.width, 1),
        );
        hitmap.register(
            Rect::new(area.x, row, 14, 1),
            4,
            HitAction::ThreadScreen(ThreadAction::AskSend),
        );
        row += 1;
    }
    row - area.y
}

/// The review gate: a violet banner, notes box, and Send back / Draft PR / Accept.
pub fn render_review_panel(
    frame: &mut Frame<'_>,
    area: Rect,
    run: &ApiRun,
    notes_preview: &str,
    theme: &Theme,
    hitmap: &mut crate::input::hitmap::HitMap,
) -> u16 {
    if area.height == 0 {
        return 0;
    }
    frame.render_widget(
        Paragraph::new(Line::from(Span::styled(
            "Review the changes before anything lands.",
            Style::default()
                .fg(theme.palette.review)
                .add_modifier(Modifier::BOLD),
        )))
        .wrap(Wrap { trim: false }),
        Rect::new(area.x, area.y, area.width, 1),
    );
    let notes_row = area.y + 1;
    frame.render_widget(
        Paragraph::new(Line::from(vec![
            Span::styled("notes: ", Style::default().fg(theme.palette.soft_fg)),
            Span::raw(notes_preview.to_owned()),
        ])),
        Rect::new(area.x, notes_row, area.width, 1),
    );
    let actions_row = area.y + 2;
    let mut actions = vec![("Send back", ThreadAction::ReviewSendBack)];
    if let Some(url) = run
        .record
        .pull_request_url
        .as_deref()
        .filter(|url| url.starts_with("http"))
    {
        let _ = url;
        actions.push(("PR ↗", ThreadAction::ReviewOpenPr));
    } else {
        actions.push(("Draft PR", ThreadAction::ReviewDraftPr));
    }
    actions.push(("Accept", ThreadAction::ReviewAccept));
    let mut cursor = area.x;
    let mut cursor_line = Vec::new();
    for (label, action) in &actions {
        let width = label.chars().count() as u16 + 3;
        cursor_line.push(Span::styled(
            format!("[{label}] "),
            Style::default().fg(theme.palette.fg),
        ));
        if actions_row < area.bottom() {
            hitmap.register(
                Rect::new(cursor, actions_row, width, 1),
                4,
                HitAction::ThreadScreen(action.clone()),
            );
        }
        cursor += width;
    }
    if actions_row < area.bottom() {
        frame.render_widget(
            Paragraph::new(Line::from(cursor_line)),
            Rect::new(area.x, actions_row, area.width, 1),
        );
    }
    3.min(area.height)
}

/// The `failed` + `autoResumeAt` hint: the absolute resume deadline and a "Don't resume" exit.
pub fn render_auto_resume_hint(
    frame: &mut Frame<'_>,
    area: Rect,
    run: &ApiRun,
    theme: &Theme,
    hitmap: &mut crate::input::hitmap::HitMap,
) -> u16 {
    if area.height == 0 {
        return 0;
    }
    let Some(at) = run.record.auto_resume_at.as_deref() else {
        return 0;
    };
    let line = Line::from(vec![
        Span::styled(
            format!("scheduled to resume at {at} "),
            Style::default().fg(theme.palette.waiting),
        ),
        Span::styled("[Don't resume]", Style::default().fg(theme.palette.fg)),
    ]);
    frame.render_widget(
        Paragraph::new(line),
        Rect::new(area.x, area.y, area.width, 1),
    );
    hitmap.register(
        Rect::new(area.x, area.y, area.width, 1),
        4,
        HitAction::ThreadScreen(ThreadAction::CancelAutoResume),
    );
    1
}

/// The one-line hint under the dock for a paused/waiting or a queued run.
pub fn render_status_hint(frame: &mut Frame<'_>, area: Rect, text: &str, theme: &Theme) -> u16 {
    if area.height == 0 || text.is_empty() {
        return 0;
    }
    frame.render_widget(
        Paragraph::new(Span::styled(
            text.to_owned(),
            Style::default().fg(theme.palette.soft_fg),
        )),
        Rect::new(area.x, area.y, area.width, 1),
    );
    1
}

/// `4m12s · 18.2k tok` — how long the run took and what it spent. Elapsed is omitted until the
/// server has stamped both ends, so the line never invents a duration from a half-written record.
pub fn run_end_detail(record: &RunRecord) -> String {
    let mut parts = Vec::new();
    if let (Some(started), Some(finished)) = (
        record.started_at.as_deref().and_then(parse_iso_seconds),
        record.finished_at.as_deref().and_then(parse_iso_seconds),
    ) {
        parts.push(format_duration((finished - started).max(0)));
    }
    parts.push(format!("{} tok", compact_tokens(record.tokens_used)));
    parts.join(" \u{b7} ")
}

/// `12s`, `4m12s`, `1h04m` — coarser as it grows, but never so coarse that a four-minute run and
/// a four-second one read the same.
fn format_duration(seconds: i64) -> String {
    if seconds < 60 {
        format!("{seconds}s")
    } else if seconds < 3600 {
        format!("{}m{:02}s", seconds / 60, seconds % 60)
    } else {
        format!("{}h{:02}m", seconds / 3600, (seconds % 3600) / 60)
    }
}

/// The full-width rule that replaces the live-activity row the moment a run stops. The row it
/// takes over is always reserved, so the conversion from `● Working · 2m10s` into the rule is
/// the attention grab — nothing below it moves.
pub fn render_run_end_banner(
    frame: &mut Frame<'_>,
    area: Rect,
    outcome: RunOutcome,
    detail: &str,
    theme: &Theme,
) -> u16 {
    if area.height == 0 || area.width == 0 {
        return 0;
    }
    frame.render_widget(
        Paragraph::new(run_end::banner_line(outcome, detail, area.width, theme)),
        Rect::new(area.x, area.y, area.width, 1),
    );
    1
}

pub fn render_live_activity(
    frame: &mut Frame<'_>,
    area: Rect,
    activity: &str,
    elapsed: &str,
    tick: u64,
    theme: &Theme,
) -> u16 {
    if area.height == 0 || area.width == 0 || activity.is_empty() {
        return 0;
    }
    let right = "esc to stop";
    let right_width = right.len().min(area.width as usize) as u16;
    let left_width = area.width.saturating_sub(right_width);
    let left = Line::from(vec![
        Span::styled(
            format!("{} ", crate::widgets::spinner::status_frame(tick)),
            Style::default().fg(theme.palette.running),
        ),
        Span::styled(
            activity.to_owned(),
            Style::default()
                .fg(theme.palette.fg)
                .add_modifier(Modifier::BOLD),
        ),
        Span::styled(
            format!(" \u{b7} {elapsed}"),
            Style::default().fg(theme.palette.soft_fg),
        ),
    ]);
    frame.render_widget(
        Paragraph::new(left),
        Rect::new(area.x, area.y, left_width, 1),
    );
    if right_width > 0 {
        frame.render_widget(
            Paragraph::new(Span::styled(
                right.to_owned(),
                Style::default().fg(theme.palette.soft_fg),
            ))
            .alignment(ratatui::layout::Alignment::Right),
            Rect::new(area.right() - right_width, area.y, right_width, 1),
        );
    }
    1
}

/// A compact duplicate of assistant prose that has scrolled out of a parked session's
/// transcript. It sits next to the other reply affordances instead of changing event order.
pub fn latest_message_height(text: &str, width: u16) -> u16 {
    if text.trim().is_empty() || width < 3 {
        return 0;
    }
    Paragraph::new(text)
        .wrap(Wrap { trim: false })
        .line_count(width.saturating_sub(2))
        .min(5) as u16
        + 2
}

pub fn render_latest_message(frame: &mut Frame<'_>, area: Rect, text: &str, theme: &Theme) -> u16 {
    if area.height == 0 || text.trim().is_empty() {
        return 0;
    }
    let block = Block::default()
        .borders(Borders::ALL)
        .title(" LATEST MESSAGE ")
        .border_style(Style::default().fg(theme.palette.accent));
    let inner = block.inner(area);
    frame.render_widget(block, area);
    frame.render_widget(
        Paragraph::new(text.to_owned())
            .style(Style::default().fg(theme.palette.fg))
            .wrap(Wrap { trim: false }),
        inner,
    );
    area.height
}

/// The right-side sub-agent drill-down panel: the full item stream for one agent.
pub fn render_subagent_sheet(
    frame: &mut Frame<'_>,
    area: Rect,
    agent: &coducktor_protocol::UiToolItem,
    state: &ThreadState,
    theme: &Theme,
    hitmap: &mut crate::input::hitmap::HitMap,
) {
    use ratatui::widgets::Clear;
    frame.render_widget(Clear, area);
    let block = Block::default()
        .borders(Borders::ALL)
        .title(format!(" {} ", agent.title))
        .border_style(Style::default().fg(theme.palette.accent));
    let inner = block.inner(area);
    frame.render_widget(block, area);
    hitmap.register(
        area,
        6,
        HitAction::ThreadScreen(ThreadAction::CloseSubagentSheet),
    );

    let mut lines = Vec::new();
    for turn in &state.turns {
        for entry in &turn.items {
            if let ThreadEntry::Item(item) = entry
                && item_parent(item) == Some(agent.id.as_str())
            {
                lines.push(render_child_line(item, theme));
            }
        }
    }
    if lines.is_empty() {
        lines.push(Line::from(Span::styled(
            "(no activity recorded yet)",
            Style::default().fg(theme.palette.soft_fg),
        )));
    }
    frame.render_widget(
        Paragraph::new(Text::from(lines)).wrap(Wrap { trim: false }),
        inner,
    );
}

fn item_parent(item: &UiItem) -> Option<&str> {
    match item {
        UiItem::Message(item) => item.parent_item_id.as_deref(),
        UiItem::Reasoning(item) => item.parent_item_id.as_deref(),
        UiItem::Tool(item) => item.parent_item_id.as_deref(),
    }
}

fn render_child_line(item: &UiItem, theme: &Theme) -> Line<'static> {
    match item {
        UiItem::Message(m) => Line::from(Span::styled(
            m.text.clone(),
            Style::default().fg(theme.palette.fg),
        )),
        UiItem::Reasoning(r) => Line::from(Span::styled(
            format!("(thinking) {}", r.text.lines().next().unwrap_or_default()),
            Style::default().fg(theme.palette.soft_fg),
        )),
        UiItem::Tool(t) => Line::from(Span::styled(
            t.title.clone(),
            Style::default().fg(theme.palette.fg),
        )),
    }
}

#[cfg(test)]
mod tests {
    use super::{
        FULL_DUCK_WIDTH, STAR_RING, agent_metadata, conversation_affinity, render_placebo_duck,
    };
    use crate::screens::thread::PlaceboDuck;
    use crate::theme::{ColorCapability, Theme, ThemeName};
    use coducktor_contract::{ReasoningEffort, RunRecord, Runner};
    use ratatui::{Terminal, backend::TestBackend, layout::Rect};

    fn duck_frame(combo: u16) -> Vec<String> {
        let duck = PlaceboDuck {
            combo,
            last_pet_tick: Some(1),
        };
        let theme = Theme::new(ThemeName::LazyVim, ColorCapability::TrueColor);
        let mut terminal = Terminal::new(TestBackend::new(FULL_DUCK_WIDTH, 4)).unwrap();
        terminal
            .draw(|frame| {
                render_placebo_duck(
                    frame,
                    Rect::new(0, 0, FULL_DUCK_WIDTH, 4),
                    true,
                    duck,
                    1,
                    "ctrl-g",
                    &theme,
                )
            })
            .unwrap();
        let buffer = terminal.backend().buffer().clone();
        (0..4)
            .map(|row| {
                (0..FULL_DUCK_WIDTH)
                    .map(|column| buffer[(column, row)].symbol())
                    .collect::<String>()
            })
            .collect()
    }

    fn stars(frame: &[String]) -> usize {
        frame.iter().map(|row| row.matches('*').count()).sum()
    }

    #[test]
    fn the_star_ring_fills_with_the_combo_and_wraps_when_the_circle_closes() {
        assert_eq!(stars(&duck_frame(0)), 0);
        assert_eq!(stars(&duck_frame(1)), 1);
        assert_eq!(stars(&duck_frame(5)), 5);
        // A closed circle stays full, and the next pet starts the ring over.
        assert_eq!(stars(&duck_frame(STAR_RING.len() as u16)), STAR_RING.len());
        assert_eq!(stars(&duck_frame(STAR_RING.len() as u16 + 1)), 1);
        assert_eq!(
            stars(&duck_frame(STAR_RING.len() as u16 * 3)),
            STAR_RING.len()
        );
    }

    #[test]
    fn the_star_ring_hugs_the_duck_evenly() {
        let frame = duck_frame(STAR_RING.len() as u16);
        for row in &frame {
            assert_eq!(row.chars().next(), Some('*'));
            assert_eq!(row.chars().nth(12), Some('*'));
        }
    }

    #[test]
    fn agent_metadata_shows_runner_model_and_reasoning() {
        let record = RunRecord {
            runner: Some(Runner::Codex),
            model: Some("gpt-5.4".to_owned()),
            reasoning_effort: Some(ReasoningEffort::High),
            ..RunRecord::default()
        };
        assert_eq!(
            agent_metadata(&record).as_deref(),
            Some("runner codex · model gpt-5.4 · reasoning high")
        );
    }

    #[test]
    fn conversation_affinity_keeps_auto_visible_and_prefers_a_reported_model() {
        assert_eq!(
            conversation_affinity(
                Runner::Claude,
                None,
                Some("claude-opus-4-8-exact"),
                None,
                Some("high"),
            ),
            "claude/claude-opus-4-8-exact · high"
        );
        assert_eq!(
            conversation_affinity(
                Runner::Claude,
                Some("opus"),
                Some("claude-opus-4-8-exact"),
                Some("high"),
                Some("medium"),
            ),
            "claude/opus · high"
        );
    }
}
