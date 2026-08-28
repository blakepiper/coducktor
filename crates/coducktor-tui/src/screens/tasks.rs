//! Tasks overview screen — `screens/tasks.rs`.
//!
//! Layout: title row (Active/Archived segments and counts), the run table, and
//! project-scoped historical task rows alongside current chats.

use coducktor_contract::{ApiRun, ProcessUsage, RunStatus};
use ratatui::Frame;
use ratatui::layout::{Constraint, Direction, Layout, Rect};
use ratatui::style::{Modifier, Style};
use ratatui::text::{Line, Span};
use ratatui::widgets::Paragraph;

use crate::app::{App, NavItem, RowMenu, RowMenuItem};
use crate::input::hitmap::HitAction;
use crate::screens::runs_util::{
    Attention, TaskView, UsageKind, attention, clock_time, filter_runs, finished_run_count,
    format_cost, format_diff, format_tokens, is_read_done_item, is_unread, queue_positions,
    run_title, short_age, sort_runs, task_reference, usage_cells, workflow_label,
};
use crate::theme::Theme;
use crate::widgets::table::{ColumnId, SortState, Table, TableCell, TableRow};
use crate::widgets::task_cards::{
    self, CardChip, CardGroup, CardHeaderAction, CardState, TaskCard,
};

/// The column set for the per-project table (§8.1).
pub const COLUMNS: [ColumnId; 11] = [
    ColumnId::Status,
    ColumnId::Task,
    ColumnId::Workflow,
    ColumnId::Branch,
    ColumnId::Diff,
    ColumnId::Reference,
    ColumnId::Tokens,
    ColumnId::Cost,
    ColumnId::Cpu,
    ColumnId::Memory,
    ColumnId::Started,
];

/// Screen-local state: search, table widget state, and the sort picker.
#[derive(Debug, Clone)]
pub struct TasksUi {
    pub query: String,
    pub table: Table,
    pub sort_picker: bool,
    pub new_task_focused: bool,
}

impl Default for TasksUi {
    fn default() -> Self {
        let mut table = Table::with_columns(COLUMNS.to_vec());
        // The default column set folds only Branch.
        table.folded.insert(ColumnId::Branch);
        Self {
            query: String::new(),
            table,
            sort_picker: false,
            new_task_focused: false,
        }
    }
}

/// Build the ordered, filtered rows the table should render.
pub fn build_rows(
    runs: &[ApiRun],
    view: TaskView,
    query: &str,
    sort: Option<SortState>,
    now: i64,
    theme: &Theme,
    live_usage: &std::collections::BTreeMap<String, ProcessUsage>,
) -> Vec<TableRow> {
    let filtered = filter_runs(runs, query);
    let mut order = sort_runs(runs, view);
    if let Some(sort) = sort {
        order.sort_by(|&a, &b| {
            let ordering = compare_cells(&runs[a], &runs[b], sort.column);
            if sort.descending {
                ordering.reverse()
            } else {
                ordering
            }
        });
    }
    order.retain(|index| filtered.iter().any(|run| std::ptr::eq(*run, &runs[*index])));
    let positions = queue_positions(runs);
    order
        .into_iter()
        .map(|index| {
            let run = &runs[index];
            let cells = run_cells(
                run,
                positions.get(&run.record.id).copied(),
                now,
                theme,
                live_usage.get(&run.record.id),
            );
            TableRow {
                key: run.record.id.clone(),
                cells,
            }
        })
        .collect()
}

/// Conversation cards — the browser's primary content. Legacy run cards are appended after
/// these by [`build_all_cards`] and are rendered read-only.
fn build_conversation_cards(
    conversations: &[coducktor_contract::ConversationIndexEntry],
    view: TaskView,
    query: &str,
    now: i64,
) -> Vec<TaskCard> {
    use crate::screens::chats_util;

    let matched = chats_util::filter(conversations, query);
    let mut order = chats_util::sort(conversations);
    order.retain(|index| {
        let entry = &conversations[*index];
        entry.archived == (view == TaskView::Archived)
            && matched.iter().any(|item| std::ptr::eq(*item, entry))
    });
    order
        .into_iter()
        .map(|index| {
            let entry = &conversations[index];
            let mut chips = vec![CardChip::Harness {
                harness: format!("{:?}", entry.harness).to_ascii_lowercase(),
                model: entry.model.clone().or_else(|| entry.model_identity.clone()),
            }];
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
                key: entry.id.clone(),
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

/// The browser's full card list: live conversations first, then legacy runs.
fn build_all_cards(
    conversations: &[coducktor_contract::ConversationIndexEntry],
    runs: &[ApiRun],
    view: TaskView,
    query: &str,
    now: i64,
) -> Vec<TaskCard> {
    let mut cards = build_conversation_cards(conversations, view, query, now);
    cards.extend(build_cards(runs, view, query, now));
    cards
}

fn build_cards(runs: &[ApiRun], view: TaskView, query: &str, now: i64) -> Vec<TaskCard> {
    let filtered = filter_runs(runs, query);
    let mut order: Vec<usize> = runs
        .iter()
        .enumerate()
        .filter(|(_, run)| {
            run.record.archived == (view == TaskView::Archived)
                && filtered.iter().any(|item| std::ptr::eq(*item, *run))
        })
        .map(|(index, _)| index)
        .collect();
    order.sort_by(|&a, &b| {
        let a = &runs[a];
        let b = &runs[b];
        card_group(a, view)
            .cmp(&card_group(b, view))
            .then_with(|| meaningful_at(&b.record, view).cmp(meaningful_at(&a.record, view)))
    });
    order
        .into_iter()
        .map(|index| {
            let run = &runs[index];
            let record = &run.record;
            let mut chips = Vec::new();
            if let Some(runner) = record.runner {
                chips.push(CardChip::Harness {
                    harness: format!("{runner:?}").to_ascii_lowercase(),
                    model: record
                        .model
                        .clone()
                        .or_else(|| record.model_identity.clone()),
                });
            } else if let Some(model) = record.model.as_deref().or(record.model_identity.as_deref())
            {
                chips.push(CardChip::Custom(model.to_owned()));
            }
            if !record.workflow.is_empty() {
                chips.push(CardChip::Custom(workflow_label(run)));
            }
            if let Some(branch) = record.branch.as_deref().filter(|value| !value.is_empty()) {
                chips.push(CardChip::Branch(branch.to_owned()));
            }
            if let Some(path) = record
                .worktree_path
                .as_deref()
                .filter(|value| !value.is_empty())
            {
                chips.push(CardChip::Worktree(path.to_owned()));
            }
            let diff = format_diff(record.diff_stat.as_ref());
            if !diff.is_empty() {
                chips.push(CardChip::Custom(diff));
            }
            if let Some(reference) = task_reference(run) {
                if reference.kind.eq_ignore_ascii_case("PR")
                    && let Ok(number) = reference.number.parse()
                {
                    chips.push(CardChip::PullRequest(number));
                } else {
                    chips.push(CardChip::Custom(format!(
                        "{} #{}",
                        reference.kind, reference.number
                    )));
                }
            }
            let title = run_title(run);
            TaskCard {
                key: record.id.clone(),
                group: card_group(run, view),
                state: run_card_state(record.status),
                body: task_cards::body_after_title(&title, &record.task),
                title,
                age: short_age(meaningful_at(record, view), now),
                chips,
                unread: is_unread(run),
            }
        })
        .collect()
}

fn card_group(run: &ApiRun, view: TaskView) -> CardGroup {
    if view == TaskView::Archived {
        return CardGroup::Archived;
    }
    if matches!(run.record.status, RunStatus::Waiting | RunStatus::Review) {
        CardGroup::NeedsYou
    } else if matches!(
        run.record.status,
        RunStatus::Queued | RunStatus::Running | RunStatus::Idle
    ) {
        CardGroup::Working
    } else {
        CardGroup::Recent
    }
}

fn meaningful_at(record: &coducktor_contract::RunRecord, view: TaskView) -> &str {
    if view == TaskView::Archived {
        record.archived_at.as_deref().unwrap_or(&record.created_at)
    } else {
        record
            .updated_at
            .as_deref()
            .or(record.finished_at.as_deref())
            .or(record.started_at.as_deref())
            .unwrap_or(&record.created_at)
    }
}

fn run_card_state(status: RunStatus) -> CardState {
    match status {
        RunStatus::Waiting | RunStatus::Review => CardState::NeedsInput,
        RunStatus::Queued => CardState::Queued,
        RunStatus::Running => CardState::Running,
        RunStatus::Failed => CardState::Failed,
        RunStatus::Cancelled => CardState::Cancelled,
        RunStatus::Idle | RunStatus::Done => CardState::Idle,
    }
}

/// The order one cell column imposes — used by header sort.
fn compare_cells(a: &ApiRun, b: &ApiRun, column: ColumnId) -> std::cmp::Ordering {
    let a = &a.record;
    let b = &b.record;
    match column {
        ColumnId::Status => attention_status_order(a.status).cmp(&attention_status_order(b.status)),
        ColumnId::Started => a.started_at.cmp(&b.started_at),
        ColumnId::Tokens => a.tokens_used.total_cmp(&b.tokens_used),
        ColumnId::Cost => a
            .cost_usd
            .unwrap_or_default()
            .total_cmp(&b.cost_usd.unwrap_or_default()),
        ColumnId::Workflow => a.workflow.cmp(&b.workflow),
        ColumnId::Branch => a.branch.cmp(&b.branch),
        _ => a.created_at.cmp(&b.created_at),
    }
}

fn attention_status_order(status: RunStatus) -> u8 {
    match status {
        RunStatus::Waiting => 0,
        RunStatus::Review => 1,
        RunStatus::Running => 2,
        RunStatus::Idle => 3,
        RunStatus::Queued => 4,
        RunStatus::Done => 5,
        RunStatus::Failed => 6,
        RunStatus::Cancelled => 7,
    }
}

/// One row's cells, in `COLUMNS` order.
fn run_cells(
    run: &ApiRun,
    queue_position: Option<usize>,
    now: i64,
    theme: &Theme,
    live: Option<&ProcessUsage>,
) -> Vec<TableCell> {
    let record = &run.record;
    let att = attention(run);
    let status_text = status_text(run, queue_position, att);
    let unread = is_unread(run);
    let read_done = is_read_done_item(run);
    let title = run_title(run);
    let title_style = if unread {
        Style::default()
            .fg(theme.palette.fg)
            .add_modifier(Modifier::BOLD)
    } else if read_done {
        Style::default().fg(theme.palette.soft_fg)
    } else {
        Style::default().fg(theme.palette.fg)
    };
    let reference = task_reference(run);
    let (cpu, mem) = usage_cells(run, live);

    let mut cells = Vec::with_capacity(COLUMNS.len());
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
        workflow_label(run),
        Style::default().fg(theme.palette.soft_fg),
    ));
    cells.push(TableCell::new(
        record.branch.clone().unwrap_or_default(),
        Style::default().fg(theme.palette.soft_fg),
    ));
    cells.push(TableCell::new(
        format_diff(record.diff_stat.as_ref()),
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
        format_tokens(record.input_tokens, record.output_tokens),
        Style::default().fg(theme.palette.soft_fg),
    ));
    cells.push(TableCell::new(
        format_cost(record.cost_usd),
        Style::default().fg(theme.palette.soft_fg),
    ));
    cells.push(TableCell::new(
        if queue_position.is_some() {
            String::new()
        } else {
            cpu.text.clone()
        },
        if queue_position.is_some() {
            Style::default().fg(theme.palette.soft_fg)
        } else if cpu.kind == UsageKind::Live {
            Style::default().fg(theme.palette.fg)
        } else {
            Style::default().fg(theme.palette.soft_fg)
        },
    ));
    cells.push(TableCell::new(
        mem.text.clone(),
        Style::default().fg(theme.palette.soft_fg),
    ));
    cells.push(TableCell::new(
        short_age(
            record.started_at.as_deref().unwrap_or(&record.created_at),
            now,
        ),
        Style::default().fg(theme.palette.soft_fg),
    ));
    cells
}

fn status_text(run: &ApiRun, queue_position: Option<usize>, att: Attention) -> String {
    if let Some(position) = queue_position {
        return format!("queued #{position}");
    }
    if att.label == "scheduled"
        && let Some(resume) = run.record.auto_resume_at.as_deref().and_then(clock_time)
    {
        return format!("sched {resume}");
    }
    att.label.to_owned()
}

/// Render the whole screen: title row, table, compare strips.
pub fn render(frame: &mut Frame<'_>, area: Rect, app: &mut App) {
    let theme = app.theme;
    let view = app.task_view();
    let now = app.now_epoch;
    let project = app.current_project().to_owned();
    let layout = Layout::default()
        .direction(Direction::Vertical)
        .constraints([Constraint::Length(1), Constraint::Min(1)])
        .split(area);
    render_title_row(frame, layout[0], app, view);

    let selected = app.tasks_ui.table.selected;
    let cards = build_all_cards(
        &app.conversations,
        &app.tasks,
        view,
        &app.tasks_ui.query,
        now,
    );
    app.tasks_ui.table.rows = cards
        .iter()
        .map(|card| TableRow {
            key: card.key.clone(),
            cells: Vec::new(),
        })
        .collect();
    app.tasks_ui
        .table
        .select(selected.or((!cards.is_empty()).then_some(0)));
    task_cards::render(
        frame,
        layout[1],
        &cards,
        app.tasks_ui.table.selected,
        &mut app.tasks_ui.table.scroll_y,
        &mut app.hitmap,
        Line::from(vec![
            Span::styled(
                " CHATS",
                Style::default()
                    .fg(theme.palette.soft_fg)
                    .add_modifier(Modifier::BOLD),
            ),
            Span::styled(" · ", Style::default().fg(theme.palette.soft_fg)),
            Span::styled(project, Style::default().fg(theme.palette.accent)),
            Span::raw(" "),
        ]),
        if app.tasks_ui.query.trim().is_empty() {
            "No chats in this project. Use :new or click New chat."
        } else {
            "No chats match your search."
        },
        &theme,
        app.animation_tick,
        Some(CardHeaderAction {
            label: "+ New chat",
            focused: app.tasks_ui.new_task_focused,
            action: HitAction::NewTask,
        }),
    );
}

fn render_title_row(frame: &mut Frame<'_>, area: Rect, app: &mut App, view: TaskView) {
    let theme = app.theme;
    let runs = &app.tasks;
    let active = runs.iter().filter(|run| !run.record.archived).count();
    let archived = runs.iter().filter(|run| run.record.archived).count();
    let needs_you = runs
        .iter()
        .filter(|run| {
            !run.record.archived
                && matches!(run.record.status, RunStatus::Waiting | RunStatus::Review)
        })
        .count();
    let finished = finished_run_count(runs);

    let mut spans: Vec<Span<'static>> = Vec::new();
    spans.push(span(
        &format!(" Current {active}"),
        view_style(theme, view == TaskView::Active, active > 0),
    ));
    spans.push(Span::raw("  "));
    spans.push(span(
        &format!("Needs you {needs_you}"),
        Style::default().fg(theme.palette.waiting),
    ));
    spans.push(Span::raw("  "));
    spans.push(span(
        &format!("Finished {finished}"),
        Style::default().fg(theme.palette.soft_fg),
    ));
    spans.push(Span::raw("  "));
    if area.width >= 100 {
        spans.push(span(
            &format!("Archived {archived}"),
            view_style(theme, view == TaskView::Archived, false),
        ));
        spans.push(Span::raw("  "));
    }
    frame.render_widget(
        Paragraph::new(Line::from(spans)).style(Style::default().bg(theme.palette.surface)),
        area,
    );
    let hitmap = &mut app.hitmap;
    // Active / Archived segments.
    hitmap.register(
        Rect::new(area.x, area.y, 9, area.height),
        3,
        HitAction::ActiveTasks,
    );
    hitmap.register(
        Rect::new(area.x + 9, area.y, 14, area.height),
        3,
        HitAction::ArchivedTasks,
    );
}

/// Route mouse/keyboard interactions from the table back into the app.
pub fn handle_table_hit(app: &mut App, action: HitAction) {
    if let HitAction::TableRow(index) = action {
        let Some(row) = app.tasks_ui.table.rows.get(index) else {
            return;
        };
        let id = row.key.clone();
        let project = app.current_project().to_owned();
        app.select_task(&project, &id);
        open_thread(app, &id);
    }
}

/// The keyboard contract for the Tasks screen (§8.1). Returns true when consumed.
pub fn handle_key(app: &mut App, key: crossterm::event::KeyEvent) -> bool {
    use crossterm::event::KeyCode;
    if let Some(menu) = app.row_menu.clone() {
        return crate::app::handle_row_menu_key(app, &menu, key);
    }
    match key.code {
        KeyCode::Tab | KeyCode::BackTab => {
            app.tasks_ui.new_task_focused = !app.tasks_ui.new_task_focused;
            true
        }
        KeyCode::Char('j') | KeyCode::Down => {
            app.tasks_ui.new_task_focused = false;
            app.tasks_ui.table.move_selection(1);
            remember_selection(app);
            true
        }
        KeyCode::Char('k') | KeyCode::Up => {
            app.tasks_ui.new_task_focused = false;
            app.tasks_ui.table.move_selection(-1);
            remember_selection(app);
            true
        }
        KeyCode::Char('a') => {
            app.tasks_ui.new_task_focused = false;
            open_row_menu(app);
            true
        }
        KeyCode::Enter => {
            if app.tasks_ui.new_task_focused {
                app.navigate(NavItem::NewTask);
                return true;
            }
            if let Some((_, row)) = app.tasks_ui.table.selected_row() {
                let id = row.key.clone();
                let project = app.current_project().to_owned();
                app.select_task(&project, &id);
                open_thread(app, &id);
            }
            true
        }
        _ => false,
    }
}

fn remember_selection(app: &mut App) {
    let Some((_, row)) = app.tasks_ui.table.selected_row() else {
        return;
    };
    let id = row.key.clone();
    let project = app.current_project().to_owned();
    app.select_task(&project, &id);
}

pub fn open_thread(app: &mut App, id: &str) {
    let project = app.current_project().to_owned();
    crate::screens::thread::open(app, &project, id);
}

/// Set the row menu for the selected row.
pub fn open_row_menu(app: &mut App) {
    let Some((_, row)) = app.tasks_ui.table.selected_row() else {
        return;
    };
    if let Some(entry) = app
        .conversations
        .iter()
        .find(|entry| entry.id == row.key)
        .cloned()
    {
        open_conversation_row_menu(app, &entry);
        return;
    }
    let Some(run) = app
        .tasks
        .iter()
        .find(|run| run.record.id == row.key)
        .cloned()
    else {
        return;
    };
    let archived = run.record.archived;
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
    if can_be_unread_or_read(&run) {
        items.push(RowMenuItem {
            label: if is_unread(&run) {
                "Mark read".to_owned()
            } else {
                "Mark unread".to_owned()
            },
            action: if is_unread(&run) {
                crate::app::MenuAction::MarkRead
            } else {
                crate::app::MenuAction::MarkUnread
            },
        });
    }
    if task_reference(&run).is_some() {
        items.push(RowMenuItem {
            label: "Open PR/issue".to_owned(),
            action: crate::app::MenuAction::OpenPr,
        });
    }
    if !run.record.branch.as_deref().is_none_or(str::is_empty) {
        items.push(RowMenuItem {
            label: "Copy branch".to_owned(),
            action: crate::app::MenuAction::CopyBranch,
        });
    }
    items.push(RowMenuItem {
        label: "Delete".to_owned(),
        action: crate::app::MenuAction::Delete,
    });
    let project = app.current_project().to_owned();
    app.row_menu = Some(RowMenu {
        project,
        run_id: row.key.clone(),
        title: run_title(&run),
        items,
        selected: 0,
    });
}

/// The chat row menu. Delete is offered only for a settled chat (section 5.4).
pub(crate) fn open_conversation_row_menu(
    app: &mut App,
    entry: &coducktor_contract::ConversationIndexEntry,
) {
    use crate::screens::chats_util;

    let mut items = vec![
        RowMenuItem {
            label: "Open chat".to_owned(),
            action: crate::app::MenuAction::Open,
        },
        RowMenuItem {
            label: if entry.archived {
                "Restore to active".to_owned()
            } else {
                "Archive".to_owned()
            },
            action: if entry.archived {
                crate::app::MenuAction::Restore
            } else {
                crate::app::MenuAction::Archive
            },
        },
    ];
    if chats_util::can_be_unread(entry) || entry.seen_at.is_some() {
        let unread = chats_util::is_unread(entry);
        items.push(RowMenuItem {
            label: if unread {
                "Mark read".to_owned()
            } else {
                "Mark unread".to_owned()
            },
            action: if unread {
                crate::app::MenuAction::MarkRead
            } else {
                crate::app::MenuAction::MarkUnread
            },
        });
    }
    if entry
        .pull_request_url
        .as_deref()
        .or(entry.referenced_pull_request_url.as_deref())
        .is_some()
    {
        items.push(RowMenuItem {
            label: "Open PR/issue".to_owned(),
            action: crate::app::MenuAction::OpenPr,
        });
    }
    if !entry.branch.as_deref().is_none_or(str::is_empty) {
        items.push(RowMenuItem {
            label: "Copy branch".to_owned(),
            action: crate::app::MenuAction::CopyBranch,
        });
    }
    if chats_util::can_delete(entry) {
        items.push(RowMenuItem {
            label: "Delete".to_owned(),
            action: crate::app::MenuAction::Delete,
        });
    }
    app.row_menu = Some(RowMenu {
        project: entry.project_id.clone(),
        run_id: entry.id.clone(),
        title: entry.title.clone(),
        items,
        selected: 0,
    });
}

fn can_be_unread_or_read(run: &ApiRun) -> bool {
    !run.record.archived
        && matches!(
            run.record.status,
            RunStatus::Done | RunStatus::Failed | RunStatus::Cancelled
        )
}

fn view_style(theme: Theme, active: bool, _attention: bool) -> Style {
    if active {
        Style::default()
            .fg(theme.palette.accent)
            .add_modifier(Modifier::BOLD)
    } else {
        Style::default().fg(theme.palette.soft_fg)
    }
}

fn span(text: &str, style: Style) -> Span<'static> {
    Span::styled(text.to_owned(), style)
}

#[cfg(test)]
mod tests {
    use coducktor_contract::{RunRecord, RunStatus};
    use ratatui::Terminal;
    use ratatui::backend::TestBackend;

    use super::*;
    use crate::app::App;
    use crate::input::keymap::Keymap;

    fn api_run(index: u8, status: RunStatus, branch: Option<&str>) -> ApiRun {
        ApiRun {
            record: RunRecord {
                id: format!("run-{index}"),
                title: format!("Task {index} — a reasonably long title to truncate"),
                workflow: "quick-task".to_owned(),
                task: format!(
                    "Implement task {index} with exact Unicode input — café 🦆 — while preserving all existing behavior and covering narrow terminals."
                ),
                status,
                created_at: "2026-08-15T00:00:00Z".to_owned(),
                started_at: Some("2026-08-15T00:00:00Z".to_owned()),
                tokens_used: 12_345.0,
                cost_usd: Some(0.42),
                archived: false,
                branch: branch.map(ToOwned::to_owned),
                diff_stat: Some(coducktor_contract::DiffStat {
                    adds: 12.0,
                    dels: 3.0,
                    files: 2.0,
                    repointed: None,
                }),
                steps: Vec::new(),
                ..RunRecord::default()
            },
            usage: None,
        }
    }

    fn conversation_entry(
        model: Option<&str>,
        model_identity: Option<&str>,
    ) -> coducktor_contract::ConversationIndexEntry {
        coducktor_contract::ConversationIndexEntry {
            project_id: "proj".to_owned(),
            id: "chat-1".to_owned(),
            title: "Ship the shell".to_owned(),
            state: coducktor_contract::ConversationState::Idle,
            harness: coducktor_contract::Runner::Claude,
            model: model.map(ToOwned::to_owned),
            model_identity: model_identity.map(ToOwned::to_owned),
            reasoning: None,
            created_at: "2026-08-22T10:00:00Z".to_owned(),
            updated_at: "2026-08-22T10:00:00Z".to_owned(),
            seen_at: None,
            archived: false,
            archived_at: None,
            prompt_preview: "ship the shell".to_owned(),
            branch: None,
            pull_request_url: None,
            referenced_pull_request_url: None,
            extra: Default::default(),
        }
    }

    fn app_with_tasks(tasks: Vec<ApiRun>) -> App {
        let mut app = App::new("main", Theme::detect(), Keymap::default());
        app.now_epoch = 1_800_000_000;
        app.set_tasks(tasks);
        app
    }

    fn render(app: &mut App, width: u16, height: u16) -> String {
        let mut terminal = Terminal::new(TestBackend::new(width, height)).unwrap();
        terminal.draw(|frame| app.render(frame)).unwrap();
        let buffer = terminal.backend().buffer();
        buffer.content.iter().map(|cell| cell.symbol()).collect()
    }

    #[test]
    fn tasks_table_renders_typed_card_states_and_chips() {
        let mut app = app_with_tasks(vec![
            api_run(1, RunStatus::Running, Some("feat/shell")),
            api_run(2, RunStatus::Waiting, None),
            api_run(3, RunStatus::Done, None),
        ]);
        let content = render(&mut app, 160, 30);
        assert!(content.contains(crate::widgets::spinner::status_frame(0)));
        assert!(content.contains("⟦needs you⟧"));
        assert!(!content.contains(" idle "));
        assert!(!content.contains(" done "));
        assert!(content.contains("feat/shell"));
        assert!(content.contains("+12 −3"));
    }
    #[test]
    fn terminal_tasks_stay_in_done_even_when_unread() {
        for status in [RunStatus::Done, RunStatus::Failed, RunStatus::Cancelled] {
            let run = api_run(1, status, None);
            assert_eq!(card_group(&run, TaskView::Active), CardGroup::Recent);
            assert!(is_unread(&run));
        }
    }

    #[test]
    fn bare_c_is_inert_and_new_command_opens_the_composer() {
        let mut app = app_with_tasks(Vec::new());
        app.handle_event(crossterm::event::Event::Key(
            crossterm::event::KeyEvent::new(
                crossterm::event::KeyCode::Char('c'),
                crossterm::event::KeyModifiers::NONE,
            ),
        ));
        assert!(matches!(app.route(), crate::app::Route::Tasks { .. }));
        app.execute_command("new");
        assert!(matches!(app.route(), crate::app::Route::NewTask { .. }));
        assert!(app.new_task_ui.composer_focused);
    }

    #[test]
    fn new_task_button_is_reachable_from_the_task_list() {
        let mut app = app_with_tasks(vec![api_run(1, RunStatus::Done, None)]);
        assert!(!app.tasks_ui.new_task_focused);

        assert!(handle_key(
            &mut app,
            crossterm::event::KeyEvent::new(
                crossterm::event::KeyCode::BackTab,
                crossterm::event::KeyModifiers::SHIFT,
            ),
        ));
        assert!(app.tasks_ui.new_task_focused);

        assert!(handle_key(
            &mut app,
            crossterm::event::KeyEvent::new(
                crossterm::event::KeyCode::Enter,
                crossterm::event::KeyModifiers::NONE,
            ),
        ));
        assert!(matches!(app.route(), crate::app::Route::NewTask { .. }));
    }

    #[test]
    fn queued_run_shows_its_queue_position() {
        let mut app = app_with_tasks(vec![api_run(1, RunStatus::Queued, None)]);
        let content = render(&mut app, 160, 30);
        assert!(content.contains("queued"), "got: {content}");
    }

    #[test]
    fn search_filters_the_rows() {
        let mut app = app_with_tasks(vec![
            api_run(1, RunStatus::Running, Some("feat/shell")),
            api_run(2, RunStatus::Running, None),
        ]);
        app.tasks_ui.query = "feat/shell".to_owned();
        let content = render(&mut app, 160, 30);
        assert!(content.contains("Task 1"));
        assert!(!content.contains("Task 2"));
    }

    #[test]
    fn snapshot_tasks_table_at_three_sizes() {
        let mut app = app_with_tasks(vec![
            api_run(1, RunStatus::Running, Some("feat/shell")),
            api_run(2, RunStatus::Waiting, None),
            api_run(3, RunStatus::Done, None),
        ]);
        for (width, height) in [(80, 24), (120, 40), (200, 60)] {
            let mut terminal = Terminal::new(TestBackend::new(width, height)).unwrap();
            terminal.draw(|frame| app.render(frame)).unwrap();
            insta::assert_debug_snapshot!(
                format!("tasks_table_{width}x{height}"),
                terminal.backend().buffer()
            );
        }
    }

    #[test]
    fn conversation_card_chip_prefers_the_resolved_model_over_a_requested_auto() {
        let auto = conversation_entry(None, Some("claude-opus-4-8-exact"));
        let cards = build_conversation_cards(&[auto], TaskView::Active, "", 1_800_000_000);
        let Some(CardChip::Harness { model, .. }) = cards[0].chips.first() else {
            panic!("expected a harness chip");
        };
        assert_eq!(model.as_deref(), Some("claude-opus-4-8-exact"));

        // An explicit pick still wins over whatever the harness reports back.
        let explicit = conversation_entry(Some("opus"), Some("claude-opus-4-8-exact"));
        let cards = build_conversation_cards(&[explicit], TaskView::Active, "", 1_800_000_000);
        let Some(CardChip::Harness { model, .. }) = cards[0].chips.first() else {
            panic!("expected a harness chip");
        };
        assert_eq!(model.as_deref(), Some("opus"));
    }

    #[test]
    fn legacy_run_card_chip_prefers_the_resolved_model_over_a_requested_auto() {
        let run = ApiRun {
            record: RunRecord {
                id: "run-1".to_owned(),
                title: "Task 1".to_owned(),
                runner: Some(coducktor_contract::Runner::Codex),
                model: None,
                model_identity: Some("gpt-5.4-exact".to_owned()),
                status: RunStatus::Done,
                created_at: "2026-08-15T00:00:00Z".to_owned(),
                ..RunRecord::default()
            },
            usage: None,
        };
        let cards = build_cards(&[run], TaskView::Active, "", 1_800_000_000);
        let Some(CardChip::Harness { model, .. }) = cards[0].chips.first() else {
            panic!("expected a harness chip");
        };
        assert_eq!(model.as_deref(), Some("gpt-5.4-exact"));
    }
}
