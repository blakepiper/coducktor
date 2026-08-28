//! Global tasks screen — `screens/global_tasks.rs`.
//!
//! Reads the workspace runs index, adds a PROJECT column and project-tag filtering, and shows
//! an honest "capped" note when the index is truncated.

use coducktor_contract::{ProcessUsage, ProjectListEntry, RunIndexEntry, RunsIndexResponse};
use ratatui::Frame;
use ratatui::layout::{Constraint, Direction, Layout, Rect};
use ratatui::style::{Modifier, Style};
use ratatui::text::{Line, Span};
use ratatui::widgets::{Block, Borders, Paragraph};

use crate::app::{App, RowMenu, RowMenuItem};
use crate::input::hitmap::HitAction;
use crate::screens::runs_util::{
    TaskView, UsageCell, UsageKind, format_cost_with_split, format_mem, short_age,
};
use crate::theme::Theme;
use crate::widgets::table::{ColumnId, Table, TableCell, TableRow};
use crate::widgets::task_cards::{self, CardChip, CardGroup, CardState, TaskCard};

/// The column set for the cross-project table (§8.2). `Tag` is a leading
/// column used only while grouping by tag.
const COLUMNS: [ColumnId; 10] = [
    ColumnId::Status,
    ColumnId::Task,
    ColumnId::Project,
    ColumnId::Workflow,
    ColumnId::Reference,
    ColumnId::Cost,
    ColumnId::Cpu,
    ColumnId::Memory,
    ColumnId::Started,
    ColumnId::Tag,
];

/// Screen-local state: search, tag filter, grouping, and the table widget.
#[derive(Debug, Clone)]
pub struct GlobalUi {
    pub query: String,
    pub tag: Option<String>,
    pub group_by_tag: bool,
    pub picker_open: bool,
    pub picker_index: usize,
    pub table: Table,
}

impl Default for GlobalUi {
    fn default() -> Self {
        let mut table = Table::with_columns(COLUMNS[..9].to_vec());
        table.folded.insert(ColumnId::Cpu);
        table.folded.insert(ColumnId::Memory);
        Self {
            query: String::new(),
            tag: None,
            group_by_tag: false,
            picker_open: false,
            picker_index: 0,
            table,
        }
    }
}

/// Build the visible rows for the given index and state.
#[allow(clippy::too_many_arguments)]
pub fn build_rows(
    index: &RunsIndexResponse,
    registry: &[ProjectListEntry],
    view: TaskView,
    query: &str,
    tag: Option<&str>,
    group_by_tag: bool,
    now: i64,
    theme: &Theme,
) -> Vec<TableRow> {
    let mut entries: Vec<&RunIndexEntry> = index
        .runs
        .iter()
        .filter(|entry| entry.archived == (view == TaskView::Archived))
        .collect();
    if let Some(tag) = tag {
        entries.retain(|entry| project_has_tag(registry, entry, tag));
    }
    let visible: Vec<&RunIndexEntry> = entries
        .into_iter()
        .filter(|entry| {
            if query.trim().is_empty() {
                return true;
            }
            let needle = query.trim().to_ascii_lowercase();
            [
                run_title_entry(entry).to_ascii_lowercase(),
                entry.workflow.to_ascii_lowercase(),
            ]
            .iter()
            .any(|text| text.contains(&needle))
        })
        .collect();
    let mut indexed: Vec<usize> = (0..visible.len()).collect();
    indexed.sort_by(|&a, &b| {
        let a = visible[a];
        let b = visible[b];
        let weight = status_order(a.status).cmp(&status_order(b.status));
        if weight != std::cmp::Ordering::Equal {
            return weight;
        }
        b.created_at.cmp(&a.created_at)
    });
    if group_by_tag {
        indexed.sort_by(|&a, &b| {
            let a_tag = entry_tag(registry, visible[a]);
            let b_tag = entry_tag(registry, visible[b]);
            a_tag
                .cmp(&b_tag)
                .then_with(|| visible[b].created_at.cmp(&visible[a].created_at))
        });
    }
    indexed
        .into_iter()
        .map(|position| {
            let entry = visible[position];
            let cells = run_cells(
                entry,
                entry_tag(registry, entry),
                group_by_tag,
                now,
                theme,
                entry.usage.as_ref(),
            );
            TableRow {
                key: format!("{}/{}", entry.project_id, entry.id),
                cells,
            }
        })
        .collect()
}

/// Workspace-wide conversation cards. Ids only need to be unique within a project, so each
/// card's key is project-qualified and its project name is always shown.
fn build_conversation_cards(
    index: &coducktor_contract::ConversationsIndexResponse,
    registry: &[ProjectListEntry],
    view: TaskView,
    query: &str,
    tag: Option<&str>,
    now: i64,
) -> Vec<TaskCard> {
    use crate::screens::chats_util;

    let mut entries: Vec<&coducktor_contract::ConversationIndexEntry> = index
        .conversations
        .iter()
        .filter(|entry| entry.archived == (view == TaskView::Archived))
        .filter(|entry| tag.is_none_or(|tag| project_id_has_tag(registry, &entry.project_id, tag)))
        .collect();
    let owned: Vec<coducktor_contract::ConversationIndexEntry> =
        entries.iter().map(|entry| (*entry).clone()).collect();
    let matched = chats_util::filter(&owned, query);
    let matched_ids: std::collections::HashSet<(&str, &str)> = matched
        .iter()
        .map(|entry| (entry.project_id.as_str(), entry.id.as_str()))
        .collect();
    entries.retain(|entry| matched_ids.contains(&(entry.project_id.as_str(), entry.id.as_str())));
    entries.sort_by(|a, b| {
        chats_util::group(a)
            .cmp(&chats_util::group(b))
            .then_with(|| chats_util::meaningful_at(b).cmp(chats_util::meaningful_at(a)))
            .then_with(|| a.project_id.cmp(&b.project_id))
            .then_with(|| a.id.cmp(&b.id))
    });
    entries
        .into_iter()
        .map(|entry| {
            let mut chips = vec![
                CardChip::Project(project_name(registry, &entry.project_id)),
                CardChip::Harness {
                    harness: format!("{:?}", entry.harness).to_ascii_lowercase(),
                    model: Some(
                        entry
                            .model
                            .clone()
                            .or_else(|| entry.model_identity.clone())
                            .unwrap_or_else(|| "auto".to_owned()),
                    ),
                    reasoning: Some(entry.reasoning.clone().unwrap_or_else(|| "auto".to_owned())),
                },
            ];
            if let Some(branch) = entry.branch.as_deref().filter(|value| !value.is_empty()) {
                chips.push(CardChip::Branch(branch.to_owned()));
            }
            if let Some(number) = entry
                .pull_request_url
                .as_deref()
                .or(entry.referenced_pull_request_url.as_deref())
                .and_then(|url| url.rsplit('/').next())
                .and_then(|number| number.parse().ok())
            {
                chips.push(CardChip::PullRequest(number));
            }
            TaskCard {
                key: format!("{}::{}", entry.project_id, entry.id),
                group: match chats_util::group(entry) {
                    chats_util::ChatGroup::NeedsYou => CardGroup::NeedsYou,
                    chats_util::ChatGroup::Working => CardGroup::Working,
                    chats_util::ChatGroup::Recent => CardGroup::Recent,
                    chats_util::ChatGroup::Archived => CardGroup::Archived,
                },
                state: chats_util::card_state(entry),
                title: entry.title.clone(),
                body: task_cards::body_after_title(&entry.title, &entry.prompt_preview),
                age: short_age(chats_util::meaningful_at(entry), now),
                chips,
                unread: chats_util::is_unread(entry),
            }
        })
        .collect()
}

fn build_cards(
    index: &RunsIndexResponse,
    registry: &[ProjectListEntry],
    view: TaskView,
    query: &str,
    tag: Option<&str>,
    group_by_tag: bool,
    now: i64,
) -> Vec<TaskCard> {
    let needle = query.trim().to_ascii_lowercase();
    let mut entries: Vec<&RunIndexEntry> = index
        .runs
        .iter()
        .filter(|entry| entry.archived == (view == TaskView::Archived))
        .filter(|entry| tag.is_none_or(|tag| project_has_tag(registry, entry, tag)))
        .filter(|entry| {
            if needle.is_empty() {
                return true;
            }
            let project = project_name(registry, &entry.project_id);
            let references = format!(
                "{} {} {} {}",
                entry.pull_request_url.as_deref().unwrap_or_default(),
                entry
                    .referenced_pull_request_url
                    .as_deref()
                    .unwrap_or_default(),
                entry.referenced_issue_url.as_deref().unwrap_or_default(),
                entry.branch.as_deref().unwrap_or_default()
            );
            [
                run_title_entry(entry).as_str(),
                entry.prompt_preview.as_deref().unwrap_or_default(),
                project.as_str(),
                entry.workflow.as_str(),
                references.as_str(),
            ]
            .iter()
            .any(|value| value.to_ascii_lowercase().contains(&needle))
        })
        .collect();
    entries.sort_by(|a, b| {
        entry_group(a, view)
            .cmp(&entry_group(b, view))
            .then_with(|| entry_activity(b, view).cmp(entry_activity(a, view)))
            .then_with(|| a.project_id.cmp(&b.project_id))
            .then_with(|| a.id.cmp(&b.id))
    });
    entries
        .into_iter()
        .map(|entry| {
            let mut chips = vec![CardChip::Project(project_name(registry, &entry.project_id))];
            if let Some(runner) = entry.runner {
                chips.push(CardChip::Harness {
                    harness: format!("{runner:?}").to_ascii_lowercase(),
                    model: entry.model.clone().or_else(|| entry.model_identity.clone()),
                    reasoning: entry
                        .reasoning_effort
                        .map(|effort| format!("{effort:?}").to_ascii_lowercase()),
                });
            } else if let Some(model) = entry.model.as_deref().or(entry.model_identity.as_deref()) {
                chips.push(CardChip::Custom(model.to_owned()));
            }
            if !entry.workflow.is_empty() {
                chips.push(CardChip::Custom(entry.workflow.clone()));
            }
            if group_by_tag {
                chips.push(CardChip::Custom(entry_tag(registry, entry)));
            }
            if let Some(branch) = entry.branch.as_deref().filter(|value| !value.is_empty()) {
                chips.push(CardChip::Branch(branch.to_owned()));
            }
            if let Some(number) = entry
                .pr_number
                .or(entry.marker_refs.as_ref().and_then(|markers| markers.pr))
            {
                chips.push(CardChip::PullRequest(number as u64));
            } else if let Some(number) = entry.issue_number {
                chips.push(CardChip::Custom(format!("issue #{}", number as u64)));
            }
            let title = run_title_entry(entry);
            TaskCard {
                key: format!("{}/{}", entry.project_id, entry.id),
                group: entry_group(entry, view),
                state: run_card_state(entry.status),
                body: task_cards::body_after_title(
                    &title,
                    entry.prompt_preview.as_deref().unwrap_or_default(),
                ),
                title,
                age: short_age(entry_activity(entry, view), now),
                chips,
                unread: is_unread_entry(entry),
            }
        })
        .collect()
}

fn project_name(registry: &[ProjectListEntry], project_id: &str) -> String {
    registry
        .iter()
        .find(|project| project.id == project_id)
        .map(|project| project.name.clone())
        .unwrap_or_else(|| project_id.to_owned())
}

fn entry_group(entry: &RunIndexEntry, view: TaskView) -> CardGroup {
    if view == TaskView::Archived {
        CardGroup::Archived
    } else if matches!(
        entry.status,
        coducktor_contract::RunStatus::Waiting | coducktor_contract::RunStatus::Review
    ) {
        CardGroup::NeedsYou
    } else if matches!(
        entry.status,
        coducktor_contract::RunStatus::Queued
            | coducktor_contract::RunStatus::Running
            | coducktor_contract::RunStatus::Idle
    ) {
        CardGroup::Working
    } else {
        CardGroup::Recent
    }
}

fn entry_activity(entry: &RunIndexEntry, view: TaskView) -> &str {
    if view == TaskView::Archived {
        entry.archived_at.as_deref().unwrap_or(&entry.created_at)
    } else {
        entry
            .updated_at
            .as_deref()
            .or(entry.finished_at.as_deref())
            .or(entry.started_at.as_deref())
            .unwrap_or(&entry.created_at)
    }
}

fn run_card_state(status: coducktor_contract::RunStatus) -> CardState {
    use coducktor_contract::RunStatus;
    match status {
        RunStatus::Waiting | RunStatus::Review => CardState::NeedsInput,
        RunStatus::Queued => CardState::Queued,
        RunStatus::Running => CardState::Running,
        RunStatus::Failed => CardState::Failed,
        RunStatus::Cancelled => CardState::Cancelled,
        RunStatus::Idle | RunStatus::Done => CardState::Idle,
    }
}

/// The tag a project carries in the registry, or UNTAGGED.
fn entry_tag(registry: &[ProjectListEntry], entry: &RunIndexEntry) -> String {
    project_tags(registry, &entry.project_id)
        .first()
        .cloned()
        .unwrap_or_else(|| "UNTAGGED".to_owned())
}

fn project_tags(registry: &[ProjectListEntry], project_id: &str) -> Vec<String> {
    registry
        .iter()
        .find(|project| project.id == project_id)
        .map(|project| project.tags.clone().unwrap_or_default())
        .unwrap_or_default()
}

fn project_has_tag(registry: &[ProjectListEntry], entry: &RunIndexEntry, tag: &str) -> bool {
    project_id_has_tag(registry, &entry.project_id, tag)
}

fn project_id_has_tag(registry: &[ProjectListEntry], project_id: &str, tag: &str) -> bool {
    let tags = project_tags(registry, project_id);
    if tag == "UNTAGGED" {
        return tags.is_empty();
    }
    tags.iter()
        .any(|candidate| candidate.eq_ignore_ascii_case(tag))
}

fn status_order(status: coducktor_contract::RunStatus) -> u8 {
    match status {
        coducktor_contract::RunStatus::Waiting => 0,
        coducktor_contract::RunStatus::Review => 1,
        coducktor_contract::RunStatus::Running => 2,
        coducktor_contract::RunStatus::Idle => 3,
        coducktor_contract::RunStatus::Queued => 4,
        coducktor_contract::RunStatus::Done => 5,
        coducktor_contract::RunStatus::Failed => 6,
        coducktor_contract::RunStatus::Cancelled => 7,
    }
}

fn run_title_entry(entry: &RunIndexEntry) -> String {
    entry
        .title_summary
        .clone()
        .unwrap_or_else(|| entry.title.clone())
}

/// One row's cells, in `COLUMNS` order. When `group_by_tag`, the leading Tag
/// cell is included first.
fn run_cells(
    entry: &RunIndexEntry,
    tag: String,
    group_by_tag: bool,
    now: i64,
    theme: &Theme,
    live: Option<&ProcessUsage>,
) -> Vec<TableCell> {
    let att = attention_entry(entry);
    let unread = is_unread_entry(entry);
    let read_done = is_read_done_entry(entry);
    let title = run_title_entry(entry);
    let title_style = if unread {
        Style::default()
            .fg(theme.palette.fg)
            .add_modifier(Modifier::BOLD)
    } else if read_done {
        Style::default().fg(theme.palette.soft_fg)
    } else {
        Style::default().fg(theme.palette.fg)
    };
    let reference = task_reference_entry(entry);
    let (cpu, mem) = usage_cells_for(entry, live);
    let status_text = if entry.status == coducktor_contract::RunStatus::Queued {
        "queued".to_owned()
    } else {
        att.label.to_owned()
    };

    let mut cells = Vec::with_capacity(COLUMNS.len() + 1);
    if group_by_tag {
        cells.push(TableCell::new(
            tag,
            Style::default().fg(theme.palette.accent),
        ));
    }
    cells.push(TableCell::new(status_text, att.tone.style(theme)));
    cells.push(TableCell::new(
        if unread {
            format!("● {title}")
        } else {
            title
        },
        title_style,
    ));
    cells.push(TableCell::new(
        entry.project_id.clone(),
        Style::default().fg(theme.palette.soft_fg),
    ));
    cells.push(TableCell::new(
        entry.workflow.clone(),
        Style::default().fg(theme.palette.soft_fg),
    ));
    cells.push(TableCell::new(
        reference
            .as_ref()
            .map(|reference| format!("{} #{}", reference.kind, reference.number))
            .unwrap_or_default(),
        Style::default().fg(theme.palette.review),
    ));
    cells.push(TableCell::new(
        format_cost_with_split(entry.cost_usd, entry.model_usage.as_deref()),
        Style::default().fg(theme.palette.soft_fg),
    ));
    cells.push(TableCell::new(
        cpu.text,
        if cpu.kind == UsageKind::Live {
            Style::default().fg(theme.palette.fg)
        } else {
            Style::default().fg(theme.palette.soft_fg)
        },
    ));
    cells.push(TableCell::new(
        mem.text,
        Style::default().fg(theme.palette.soft_fg),
    ));
    cells.push(TableCell::new(
        short_age(
            entry.started_at.as_deref().unwrap_or(&entry.created_at),
            now,
        ),
        Style::default().fg(theme.palette.soft_fg),
    ));
    cells
}

/// The live/peak usage pair for an index row (the index carries its own sample).
fn usage_cells_for(entry: &RunIndexEntry, sample: Option<&ProcessUsage>) -> (UsageCell, UsageCell) {
    if matches!(
        entry.status,
        coducktor_contract::RunStatus::Running
            | coducktor_contract::RunStatus::Idle
            | coducktor_contract::RunStatus::Waiting
    ) && let Some(live) = sample
    {
        return (
            UsageCell {
                text: format!("{}%", live.cpu_pct.round()),
                kind: UsageKind::Live,
            },
            UsageCell {
                text: format_mem(Some(live.rss_bytes)),
                kind: UsageKind::Live,
            },
        );
    }
    let peak = format_mem(entry.peak_rss_bytes);
    (
        UsageCell {
            text: String::new(),
            kind: UsageKind::None,
        },
        UsageCell {
            text: if peak.is_empty() {
                String::new()
            } else {
                format!("peak {peak}")
            },
            kind: UsageKind::Peak,
        },
    )
}

fn attention_entry(entry: &RunIndexEntry) -> crate::screens::runs_util::Attention {
    let failed_scheduled =
        entry.status == coducktor_contract::RunStatus::Failed && entry.auto_resume_at.is_some();
    if failed_scheduled {
        return crate::screens::runs_util::Attention {
            label: "scheduled",
            tone: crate::screens::runs_util::AttentionTone::Pending,
            pulse: false,
        };
    }
    match entry.status {
        coducktor_contract::RunStatus::Failed => crate::screens::runs_util::Attention {
            label: "failed",
            tone: crate::screens::runs_util::AttentionTone::Danger,
            pulse: false,
        },
        coducktor_contract::RunStatus::Waiting => crate::screens::runs_util::Attention {
            label: "needs you",
            tone: crate::screens::runs_util::AttentionTone::Pending,
            pulse: true,
        },
        coducktor_contract::RunStatus::Review => crate::screens::runs_util::Attention {
            label: "needs review",
            tone: crate::screens::runs_util::AttentionTone::Violet,
            pulse: true,
        },
        coducktor_contract::RunStatus::Running => crate::screens::runs_util::Attention {
            label: "running",
            tone: crate::screens::runs_util::AttentionTone::Violet,
            pulse: true,
        },
        coducktor_contract::RunStatus::Idle => crate::screens::runs_util::Attention {
            label: "idle",
            tone: crate::screens::runs_util::AttentionTone::Neutral,
            pulse: false,
        },
        coducktor_contract::RunStatus::Queued => crate::screens::runs_util::Attention {
            label: "queued",
            tone: crate::screens::runs_util::AttentionTone::Neutral,
            pulse: false,
        },
        coducktor_contract::RunStatus::Done => crate::screens::runs_util::Attention {
            label: "done",
            tone: crate::screens::runs_util::AttentionTone::Success,
            pulse: false,
        },
        coducktor_contract::RunStatus::Cancelled => crate::screens::runs_util::Attention {
            label: "cancelled",
            tone: crate::screens::runs_util::AttentionTone::Neutral,
            pulse: false,
        },
    }
}

fn is_unread_entry(entry: &RunIndexEntry) -> bool {
    entry.seen_at.is_none() && can_be_unread_entry(entry)
}

fn can_be_unread_entry(entry: &RunIndexEntry) -> bool {
    if entry.archived || entry.seen_at.is_some() {
        return false;
    }
    matches!(
        entry.status,
        coducktor_contract::RunStatus::Done
            | coducktor_contract::RunStatus::Failed
            | coducktor_contract::RunStatus::Cancelled
    )
}

fn is_read_done_entry(entry: &RunIndexEntry) -> bool {
    !entry.archived
        && entry.seen_at.is_some()
        && matches!(
            entry.status,
            coducktor_contract::RunStatus::Done
                | coducktor_contract::RunStatus::Failed
                | coducktor_contract::RunStatus::Cancelled
        )
}

fn task_reference_entry(entry: &RunIndexEntry) -> Option<crate::screens::runs_util::TaskReference> {
    let mut pr_url = entry.pull_request_url.clone();
    if pr_url.is_none()
        && let Some(about) = &entry.referenced_pull_request_url
    {
        pr_url = Some(about.clone());
    }
    if let Some(url) = pr_url {
        return Some(crate::screens::runs_util::TaskReference {
            kind: "PR",
            number: number_from_url(&url),
            url: Some(url),
        });
    }
    if let Some(url) = &entry.referenced_issue_url {
        return Some(crate::screens::runs_util::TaskReference {
            kind: "issue",
            number: number_from_url(url),
            url: Some(url.clone()),
        });
    }
    if let Some(number) = entry.issue_number {
        return Some(crate::screens::runs_util::TaskReference {
            kind: "issue",
            number: format!("{number:.0}"),
            url: None,
        });
    }
    if let Some(number) = entry.pr_number {
        return Some(crate::screens::runs_util::TaskReference {
            kind: "PR",
            number: format!("{number:.0}"),
            url: None,
        });
    }
    None
}

fn number_from_url(url: &str) -> String {
    url.split('/')
        .next_back()
        .filter(|last| !last.is_empty() && last.chars().all(|c| c.is_ascii_digit()))
        .unwrap_or(url)
        .to_owned()
}

/// Render the global tasks screen.
pub fn render(frame: &mut Frame<'_>, area: Rect, app: &mut App) {
    let theme = app.theme;
    let view = app.task_view();
    let now = app.now_epoch;
    let truncated = app.truncated_note();

    let layout = Layout::default()
        .direction(Direction::Vertical)
        .constraints([
            Constraint::Length(1),
            Constraint::Length(if truncated.is_empty() { 0 } else { 1 }),
            Constraint::Min(1),
        ])
        .split(area);

    render_title_row(frame, layout[0], app, view);
    if !truncated.is_empty() {
        render_truncated(frame, layout[1], truncated, &theme);
    }
    let Some(index) = &app.global_index else {
        app.global_ui.table.rows.clear();
        let hint = app.global_error.clone().unwrap_or_else(|| {
            if app.global_loading {
                "Loading…".to_owned()
            } else {
                "No chats across projects yet.".to_owned()
            }
        });
        task_cards::render(
            frame,
            layout[2],
            &[],
            None,
            &mut app.global_ui.table.scroll_y,
            &mut app.hitmap,
            all_chats_title(&theme),
            &hint,
            &theme,
            app.animation_tick,
            None,
        );
        return;
    };
    let registry = &app.project_registry;
    let selected = app.global_ui.table.selected;
    let mut cards = app
        .global_conversations
        .as_ref()
        .map(|conversations| {
            build_conversation_cards(
                conversations,
                registry,
                view,
                &app.global_ui.query,
                app.global_ui.tag.as_deref(),
                now,
            )
        })
        .unwrap_or_default();
    cards.extend(build_cards(
        index,
        registry,
        view,
        &app.global_ui.query,
        app.global_ui.tag.as_deref(),
        app.global_ui.group_by_tag,
        now,
    ));
    app.global_ui.table.rows = cards
        .iter()
        .map(|card| TableRow {
            key: card.key.clone(),
            cells: Vec::new(),
        })
        .collect();
    app.global_ui
        .table
        .select(selected.or((!cards.is_empty()).then_some(0)));
    app.global_ui.table.last_area = Some(layout[2]);
    task_cards::render(
        frame,
        layout[2],
        &cards,
        app.global_ui.table.selected,
        &mut app.global_ui.table.scroll_y,
        &mut app.hitmap,
        all_chats_title(&theme),
        if app.global_ui.query.trim().is_empty() {
            "No chats across projects yet."
        } else {
            "No chats match your search."
        },
        &theme,
        app.animation_tick,
        None,
    );
    render_tag_picker(frame, app);
}

fn all_chats_title(theme: &Theme) -> Line<'static> {
    Line::from(vec![Span::styled(
        " ALL CHATS ",
        Style::default()
            .fg(theme.palette.soft_fg)
            .add_modifier(Modifier::BOLD),
    )])
}

fn render_title_row(frame: &mut Frame<'_>, area: Rect, app: &mut App, view: TaskView) {
    let theme = app.theme;
    let Some(index) = &app.global_index else {
        frame.render_widget(
            Paragraph::new(Line::from(Span::styled(
                " ALL CHATS",
                Style::default().add_modifier(Modifier::BOLD),
            ))),
            area,
        );
        return;
    };
    let active = index.runs.iter().filter(|entry| !entry.archived).count();
    let archived = index.runs.iter().filter(|entry| entry.archived).count();
    let needs_you = index
        .runs
        .iter()
        .filter(|entry| {
            !entry.archived
                && matches!(
                    entry.status,
                    coducktor_contract::RunStatus::Waiting | coducktor_contract::RunStatus::Review
                )
        })
        .count();
    let finished = index
        .runs
        .iter()
        .filter(|entry| {
            matches!(
                entry.status,
                coducktor_contract::RunStatus::Done
                    | coducktor_contract::RunStatus::Failed
                    | coducktor_contract::RunStatus::Cancelled
            )
        })
        .count();
    let projects = index
        .runs
        .iter()
        .map(|entry| entry.project_id.as_str())
        .collect::<std::collections::BTreeSet<_>>()
        .len();
    let mut spans: Vec<Span<'static>> = Vec::new();
    spans.push(Span::styled(
        format!(" ALL CHATS  {projects} projects  "),
        Style::default()
            .fg(theme.palette.fg)
            .add_modifier(Modifier::BOLD),
    ));
    spans.push(Span::styled(
        format!(" Current {active}"),
        if view == TaskView::Active {
            Style::default()
                .fg(theme.palette.accent)
                .add_modifier(Modifier::BOLD)
        } else {
            Style::default().fg(theme.palette.soft_fg)
        },
    ));
    spans.push(Span::styled(
        format!("  Needs you {needs_you}  Finished {finished}"),
        Style::default().fg(theme.palette.soft_fg),
    ));
    spans.push(Span::styled(
        format!("  Archived {archived}"),
        if view == TaskView::Archived {
            Style::default()
                .fg(theme.palette.accent)
                .add_modifier(Modifier::BOLD)
        } else {
            Style::default().fg(theme.palette.soft_fg)
        },
    ));
    spans.push(Span::raw("  "));
    if area.width >= 100 {
        spans.push(Span::styled(
            format!(
                "  group:{}  tag:{}  filter:{}  / {}",
                if app.global_ui.group_by_tag {
                    "tag"
                } else {
                    "none"
                },
                app.global_ui.tag.as_deref().unwrap_or("-"),
                if view == TaskView::Active {
                    "current"
                } else {
                    "archived"
                },
                app.global_ui.query
            ),
            Style::default().fg(theme.palette.soft_fg),
        ));
    } else {
        spans.push(Span::styled(
            format!(
                "  filter:{}",
                if view == TaskView::Active {
                    "current"
                } else {
                    "archived"
                }
            ),
            Style::default().fg(theme.palette.soft_fg),
        ));
    }
    frame.render_widget(
        Paragraph::new(Line::from(spans)).style(Style::default().bg(theme.palette.surface)),
        area,
    );
    let hitmap = &mut app.hitmap;
    hitmap.register(
        Rect::new(area.x, area.y, 20, area.height),
        3,
        HitAction::ActiveTasks,
    );
    hitmap.register(
        Rect::new(area.x + 20, area.y, 13, area.height),
        3,
        HitAction::ArchivedTasks,
    );
}

fn render_truncated(frame: &mut Frame<'_>, area: Rect, note: String, theme: &Theme) {
    frame.render_widget(
        Paragraph::new(Line::from(Span::styled(
            note,
            Style::default().fg(theme.palette.soft_fg),
        ))),
        area,
    );
}

/// The tag-facet picker overlay opened by `f`.
fn render_tag_picker(frame: &mut Frame<'_>, app: &mut App) {
    if !app.global_ui.picker_open {
        return;
    }
    let items = picker_items(app);
    let height = (items.len() as u16 + 2).min(12);
    let width = 28.min(app.last_width.saturating_sub(2));
    let rect = centered_rect(app.last_width, width, height);
    frame.render_widget(ratatui::widgets::Clear, rect);
    let picker_index = app.global_ui.picker_index;
    let tag = app.global_ui.tag.clone();
    let lines: Vec<Line<'static>> = items
        .iter()
        .enumerate()
        .map(|(index, item)| {
            let selected = index == picker_index;
            let label = if item == tag.as_deref().unwrap_or("ALL") {
                format!("● {item}")
            } else {
                item.clone()
            };
            let style = if selected {
                Style::default()
                    .fg(app.theme.palette.accent)
                    .add_modifier(Modifier::REVERSED)
            } else {
                Style::default().fg(app.theme.palette.fg)
            };
            Line::from(Span::styled(format!(" {label}"), style))
        })
        .collect();
    frame.render_widget(
        Paragraph::new(lines)
            .block(Block::default().borders(Borders::ALL).title("TAG FILTER"))
            .style(Style::default().bg(app.theme.palette.surface)),
        rect,
    );
}

fn picker_items(app: &App) -> Vec<String> {
    let Some(index) = &app.global_index else {
        return Vec::new();
    };
    let mut tags: Vec<String> = index
        .runs
        .iter()
        .filter_map(|entry| {
            app.project_registry
                .iter()
                .find(|project| project.id == entry.project_id)
                .and_then(|project| project.tags.clone())
                .and_then(|tags| tags.first().cloned())
        })
        .collect();
    tags.sort();
    tags.dedup();
    if tags.iter().any(|tag| tag != "UNTAGGED") {
        tags.push("UNTAGGED".to_owned());
    }
    let mut items = vec!["ALL".to_owned()];
    items.extend(tags);
    items
}

/// The keyboard contract for the Global tasks screen. Returns true when consumed.
pub fn handle_key(app: &mut App, key: crossterm::event::KeyEvent) -> bool {
    use crossterm::event::KeyCode;
    if app.global_ui.picker_open {
        return handle_picker_key(app, key);
    }
    if let Some(menu) = app.row_menu.clone() {
        return crate::app::handle_row_menu_key(app, &menu, key);
    }
    match key.code {
        KeyCode::Char('j') | KeyCode::Down => {
            app.global_ui.table.move_selection(1);
            true
        }
        KeyCode::Char('k') | KeyCode::Up => {
            app.global_ui.table.move_selection(-1);
            true
        }
        KeyCode::Char('a') => {
            open_row_menu(app);
            true
        }
        KeyCode::Enter => {
            if let Some((_, row)) = app.global_ui.table.selected_row() {
                let key = row.key.clone();
                open_thread(app, &key);
            }
            true
        }
        _ => false,
    }
}

fn handle_picker_key(app: &mut App, key: crossterm::event::KeyEvent) -> bool {
    use crossterm::event::KeyCode;
    let mut items = picker_items(app);
    let count = items.len();
    let ui = &mut app.global_ui;
    match key.code {
        KeyCode::Char('j') | KeyCode::Down => {
            ui.picker_index = (ui.picker_index + 1).min(count.saturating_sub(1));
        }
        KeyCode::Char('k') | KeyCode::Up => {
            ui.picker_index = ui.picker_index.saturating_sub(1);
        }
        KeyCode::Enter => {
            if let Some(item) = items.get_mut(ui.picker_index) {
                ui.tag = if item == "ALL" {
                    None
                } else {
                    Some(item.clone())
                };
            }
            ui.picker_open = false;
            ui.picker_index = 0;
        }
        KeyCode::Esc => {
            ui.picker_open = false;
            ui.picker_index = 0;
        }
        _ => {}
    }
    true
}

pub fn open_thread(app: &mut App, key: &str) {
    let Some((project, id)) = split_key(key) else {
        return;
    };
    app.select_task(&project, &id);
    crate::screens::thread::open(app, &project, &id);
}

fn split_key(key: &str) -> Option<(String, String)> {
    // Conversation cards use a project-qualified `::` key; legacy run cards use `/`.
    let (project, id) = key.split_once("::").or_else(|| key.split_once('/'))?;
    Some((project.to_owned(), id.to_owned()))
}

/// Set the row menu for the global table's selected row.
pub fn open_row_menu(app: &mut App) {
    let Some((_, row)) = app.global_ui.table.selected_row() else {
        return;
    };
    let Some((project, id)) = split_key(&row.key) else {
        return;
    };
    if let Some(entry) = app.global_conversations.as_ref().and_then(|index| {
        index
            .conversations
            .iter()
            .find(|entry| entry.project_id == project && entry.id == id)
            .cloned()
    }) {
        crate::screens::tasks::open_conversation_row_menu(app, &entry);
        return;
    }
    let Some(index) = &app.global_index else {
        return;
    };
    let Some(entry) = index
        .runs
        .iter()
        .find(|entry| entry.project_id == project && entry.id == id)
        .cloned()
    else {
        return;
    };
    let archived = entry.archived;
    let mut items = vec![
        RowMenuItem {
            label: "Open thread".to_owned(),
            action: crate::app::MenuAction::Open,
        },
        RowMenuItem {
            label: if archived {
                "Restore to active".to_owned()
            } else {
                "Archive".to_owned()
            },
            action: if archived {
                crate::app::MenuAction::Restore
            } else {
                crate::app::MenuAction::Archive
            },
        },
    ];
    if can_be_unread_entry(&entry) {
        items.push(RowMenuItem {
            label: if is_unread_entry(&entry) {
                "Mark read".to_owned()
            } else {
                "Mark unread".to_owned()
            },
            action: if is_unread_entry(&entry) {
                crate::app::MenuAction::MarkRead
            } else {
                crate::app::MenuAction::MarkUnread
            },
        });
    }
    items.push(RowMenuItem {
        label: "Delete".to_owned(),
        action: crate::app::MenuAction::Delete,
    });
    app.row_menu = Some(RowMenu {
        project: entry.project_id.clone(),
        run_id: entry.id.clone(),
        title: run_title_entry(&entry),
        items,
        selected: 0,
    });
}

fn centered_rect(total_width: u16, width: u16, height: u16) -> Rect {
    let width = width.min(total_width);
    Rect::new(total_width.saturating_sub(width) / 2, 0, width, height)
}

#[cfg(test)]
mod tests {
    use coducktor_contract::{RunIndexEntry, RunsIndexResponse};
    use ratatui::Terminal;
    use ratatui::backend::TestBackend;

    use super::*;
    use crate::app::App;
    use crate::input::keymap::Keymap;
    use crate::theme::Theme;

    fn entry(project: &str, id: &str, status: coducktor_contract::RunStatus) -> RunIndexEntry {
        RunIndexEntry {
            project_id: project.to_owned(),
            id: id.to_owned(),
            title: format!("Global task {id}"),
            title_summary: None,
            status,
            created_at: "2026-08-15T00:00:00Z".to_owned(),
            started_at: Some("2026-08-15T00:00:00Z".to_owned()),
            prompt_preview: Some(format!(
                "Implement global task {id} exactly — café 🦆 — and preserve project-scoped behavior across long wrapped prompts."
            )),
            seen_at: None,
            archived: false,
            workflow: "quick-task".to_owned(),
            cost_usd: None,
            peak_rss_bytes: None,
            peak_proc_count: None,
            ..RunIndexEntry::default()
        }
    }

    fn project(id: &str, tags: Vec<&str>) -> ProjectListEntry {
        ProjectListEntry {
            id: id.to_owned(),
            name: id.to_owned(),
            root: format!("/tmp/{id}"),
            added_at: String::new(),
            last_opened_at: String::new(),
            source: coducktor_contract::ProjectSource::Local,
            status: coducktor_contract::ProjectStatus::Ok,
            tags: Some(tags.into_iter().map(ToOwned::to_owned).collect()),
            ..ProjectListEntry::default()
        }
    }

    fn app_with_index(entries: Vec<RunIndexEntry>, projects: Vec<ProjectListEntry>) -> App {
        let mut app = App::new("main", Theme::detect(), Keymap::default());
        app.now_epoch = 1_800_000_000;
        app.set_project_registry(projects);
        app.set_global_index(RunsIndexResponse {
            runs: entries,
            per_project_limit: 200,
            truncated: Vec::new(),
        });
        app.navigate_route(crate::app::Route::GlobalTasks);
        app
    }

    fn conversation_entry(
        project: &str,
        id: &str,
        state: coducktor_contract::ConversationState,
    ) -> coducktor_contract::ConversationIndexEntry {
        coducktor_contract::ConversationIndexEntry {
            project_id: project.to_owned(),
            id: id.to_owned(),
            title: format!("Global chat {id}"),
            state,
            harness: coducktor_contract::Runner::Claude,
            model: Some("opus".to_owned()),
            model_identity: None,
            reasoning: None,
            created_at: "2026-08-15T00:00:00Z".to_owned(),
            updated_at: "2026-08-15T00:01:00Z".to_owned(),
            seen_at: None,
            archived: false,
            archived_at: None,
            prompt_preview: "Implement the requested change".to_owned(),
            branch: Some("duck/task-chat-1".to_owned()),
            pull_request_url: None,
            referenced_pull_request_url: None,
            extra: Default::default(),
        }
    }

    fn render(app: &mut App, width: u16, height: u16) -> String {
        let mut terminal = Terminal::new(TestBackend::new(width, height)).unwrap();
        terminal.draw(|frame| app.render(frame)).unwrap();
        let buffer = terminal.backend().buffer();
        buffer.content.iter().map(|cell| cell.symbol()).collect()
    }

    #[test]
    fn global_browser_shows_project_chips_and_typed_states() {
        let mut app = app_with_index(
            vec![
                entry("shop", "1", coducktor_contract::RunStatus::Running),
                entry("blog", "2", coducktor_contract::RunStatus::Waiting),
            ],
            vec![
                project("shop", vec!["storefront"]),
                project("blog", Vec::new()),
            ],
        );
        let content = render(&mut app, 160, 30);
        assert!(content.contains("shop"));
        assert!(content.contains("blog"));
        assert!(content.contains(crate::widgets::spinner::status_frame(0)));
        assert!(content.contains("⟦needs you⟧"));
        assert!(!content.contains(" idle "));
    }

    #[test]
    fn all_chat_cards_accept_mouse_wheel_navigation_after_render() {
        let mut app = app_with_index(
            (0..10)
                .map(|index| {
                    entry(
                        "shop",
                        &index.to_string(),
                        coducktor_contract::RunStatus::Done,
                    )
                })
                .collect(),
            vec![project("shop", Vec::new())],
        );
        render(&mut app, 80, 20);
        let area = app.global_ui.table.last_area.expect("all chats area");
        assert_eq!(app.global_ui.table.selected, Some(0));

        app.handle_event(crossterm::event::Event::Mouse(
            crossterm::event::MouseEvent {
                kind: crossterm::event::MouseEventKind::ScrollDown,
                column: area.x,
                row: area.y,
                modifiers: crossterm::event::KeyModifiers::NONE,
            },
        ));

        assert_eq!(app.global_ui.table.selected, Some(3));
    }

    #[test]
    fn failed_global_chat_can_be_deleted_from_keyboard_actions() {
        let mut app = app_with_index(Vec::new(), vec![project("shop", Vec::new())]);
        app.set_global_conversations(coducktor_contract::ConversationsIndexResponse {
            conversations: vec![conversation_entry(
                "shop",
                "chat-1",
                coducktor_contract::ConversationState::Failed,
            )],
            extra: Default::default(),
        });
        let content = render(&mut app, 160, 30);
        assert!(content.contains("Global chat chat-1"));

        assert!(handle_key(
            &mut app,
            crossterm::event::KeyEvent::new(
                crossterm::event::KeyCode::Char('a'),
                crossterm::event::KeyModifiers::NONE,
            ),
        ));
        let delete = app
            .row_menu
            .as_ref()
            .and_then(|menu| {
                menu.items
                    .iter()
                    .position(|item| item.action == crate::app::MenuAction::Delete)
            })
            .expect("a settled failed chat offers Delete");
        app.row_menu
            .as_mut()
            .expect("actions menu is open")
            .selected = delete;

        assert!(handle_key(
            &mut app,
            crossterm::event::KeyEvent::new(
                crossterm::event::KeyCode::Enter,
                crossterm::event::KeyModifiers::NONE,
            ),
        ));
        assert!(matches!(
            app.confirm.as_ref().map(|confirm| &confirm.action),
            Some(crate::app::PendingAction::DeleteConversation { project, id })
                if project == "shop" && id == "chat-1"
        ));
    }

    #[test]
    fn terminal_tasks_stay_in_done_even_when_unread() {
        for status in [
            coducktor_contract::RunStatus::Done,
            coducktor_contract::RunStatus::Failed,
            coducktor_contract::RunStatus::Cancelled,
        ] {
            let entry = entry("shop", "1", status);
            assert_eq!(entry_group(&entry, TaskView::Active), CardGroup::Recent);
            assert!(is_unread_entry(&entry));
        }
    }

    #[test]
    fn tag_filter_narrows_the_table() {
        let mut app = app_with_index(
            vec![
                entry("shop", "1", coducktor_contract::RunStatus::Running),
                entry("blog", "2", coducktor_contract::RunStatus::Running),
            ],
            vec![
                project("shop", vec!["storefront"]),
                project("blog", Vec::new()),
            ],
        );
        app.global_ui.tag = Some("storefront".to_owned());
        let content = render(&mut app, 160, 30);
        assert!(content.contains("Global task 1"));
        assert!(!content.contains("Global task 2"));
    }

    #[test]
    fn grouping_by_tag_adds_the_tag_column() {
        let mut app = app_with_index(
            vec![
                entry("shop", "1", coducktor_contract::RunStatus::Done),
                entry("blog", "2", coducktor_contract::RunStatus::Done),
            ],
            vec![
                project("shop", vec!["storefront"]),
                project("blog", Vec::new()),
            ],
        );
        app.global_ui.group_by_tag = true;
        app.global_ui.table.columns = {
            let mut columns = COLUMNS[..9].to_vec();
            columns.insert(0, ColumnId::Tag);
            columns
        };
        let content = render(&mut app, 160, 30);
        assert!(content.contains("storefront"));
        assert!(content.contains("UNTAGGED"));
    }

    #[test]
    fn snapshot_global_table_at_three_sizes() {
        let mut app = app_with_index(
            vec![
                entry("shop", "1", coducktor_contract::RunStatus::Running),
                entry("blog", "2", coducktor_contract::RunStatus::Waiting),
                entry("shop", "3", coducktor_contract::RunStatus::Done),
            ],
            vec![
                project("shop", vec!["storefront"]),
                project("blog", Vec::new()),
            ],
        );
        for (width, height) in [(80, 24), (120, 40), (200, 60)] {
            let mut terminal = Terminal::new(TestBackend::new(width, height)).unwrap();
            terminal.draw(|frame| app.render(frame)).unwrap();
            insta::assert_debug_snapshot!(
                format!("global_tasks_{width}x{height}"),
                terminal.backend().buffer()
            );
        }
    }

    #[test]
    fn split_key_resolves_conversation_and_run_cards() {
        assert_eq!(
            split_key("shop::conv-1"),
            Some(("shop".to_owned(), "conv-1".to_owned())),
            "conversation cards use the project-qualified :: key"
        );
        assert_eq!(
            split_key("shop/run-1"),
            Some(("shop".to_owned(), "run-1".to_owned())),
            "legacy run cards keep the / key"
        );
        assert_eq!(split_key("no-separator"), None);
    }
}
