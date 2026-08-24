//! A per-project quick-note editor persisted under the user's Coducktor home, outside Git.

use crossterm::event::{KeyCode, KeyEvent, KeyModifiers, MouseButton, MouseEvent, MouseEventKind};
use ratatui::Frame;
use ratatui::layout::Rect;
use ratatui::style::Style;
use ratatui::widgets::{Block, Borders, Paragraph};

use crate::app::{App, ConfirmRequest, PendingAction, Route};
use crate::clipboard::{self, ClipboardContent};
use crate::diff::Highlighter;
use crate::widgets::editor::Editor;

pub struct ScratchpadUi {
    pub project: String,
    pub editor: Editor,
    pub loaded: bool,
    pub saving: bool,
    pub viewport: usize,
    pub area: Rect,
    pub mode: ScratchpadMode,
    mouse_dragging: bool,
    pending_delete: bool,
    highlighter: Highlighter,
}

#[derive(Debug, Clone, Copy, Default, PartialEq, Eq)]
pub enum ScratchpadMode {
    #[default]
    Normal,
    Insert,
    Visual,
}

impl Default for ScratchpadUi {
    fn default() -> Self {
        Self {
            project: String::new(),
            editor: Editor::default(),
            loaded: false,
            saving: false,
            viewport: 0,
            area: Rect::default(),
            mode: ScratchpadMode::Normal,
            mouse_dragging: false,
            pending_delete: false,
            highlighter: Highlighter::new(),
        }
    }
}

pub fn open(app: &mut App, project: &str) {
    if app.scratchpad_ui.project != project {
        app.scratchpad_ui = ScratchpadUi {
            project: project.to_owned(),
            ..ScratchpadUi::default()
        };
    }
    app.navigate_route(Route::Scratchpad {
        project: project.to_owned(),
    });
    if !app.scratchpad_ui.loaded {
        app.pending.push(PendingAction::LoadScratchpad {
            project: project.to_owned(),
        });
    }
}

pub fn request_clear(app: &mut App) {
    if !matches!(app.route(), Route::Scratchpad { .. }) {
        app.notice = Some("open the scratchpad before clearing it".to_owned());
        return;
    }
    let project = app.scratchpad_ui.project.clone();
    app.confirm = Some(ConfirmRequest {
        text: "Clear this scratchpad? This cannot be undone.".to_owned(),
        action: PendingAction::ClearScratchpad { project },
    });
}

pub(crate) fn clear_after_confirmation(app: &mut App, project: &str) {
    if app.scratchpad_ui.project != project {
        return;
    }
    app.scratchpad_ui.editor.set_text("");
    app.scratchpad_ui.loaded = true;
    app.pending.retain(|action| {
        !matches!(action, PendingAction::LoadScratchpad { project: queued } if queued == project)
    });
    queue_save(app);
}

pub fn render(frame: &mut Frame<'_>, area: Rect, app: &mut App) {
    let state = if !app.scratchpad_ui.loaded {
        "loading…"
    } else if app.scratchpad_ui.saving {
        "saving…"
    } else {
        "saved locally"
    };
    let title = format!("Scratchpad — {} — {state}", mode_label(app));
    let block = Block::default()
        .borders(Borders::ALL)
        .title(title)
        .border_style(Style::default().fg(app.theme.palette.accent));
    let inner = block.inner(area);
    frame.render_widget(block, area);
    app.scratchpad_ui.area = inner;
    app.scratchpad_ui.viewport = inner.height as usize;
    app.scratchpad_ui
        .editor
        .ensure_caret_visible(app.scratchpad_ui.viewport);
    let lines = app.scratchpad_ui.editor.render_wrapped_lines(
        "scratchpad.md",
        &app.scratchpad_ui.highlighter,
        &app.theme,
        app.scratchpad_ui.viewport,
        inner.width,
        true,
    );
    frame.render_widget(Paragraph::new(lines), inner);
}

pub fn handle_key(app: &mut App, key: KeyEvent) -> bool {
    match app.scratchpad_ui.mode {
        ScratchpadMode::Normal => return handle_normal_key(app, key),
        ScratchpadMode::Visual => return handle_visual_key(app, key),
        ScratchpadMode::Insert => {}
    }
    if key.code == KeyCode::Esc {
        app.scratchpad_ui.mode = ScratchpadMode::Normal;
        app.scratchpad_ui.editor.clear_selection();
        return true;
    }
    if key.modifiers.contains(KeyModifiers::CONTROL) {
        match key.code {
            KeyCode::Char('s') => {
                queue_save(app);
                return true;
            }
            KeyCode::Char('a') => {
                app.scratchpad_ui.editor.select_all();
                return true;
            }
            KeyCode::Char('c') => {
                copy_selection(app);
                return true;
            }
            KeyCode::Char('x') => {
                cut_selection(app);
                return true;
            }
            KeyCode::Char('v') => {
                paste_clipboard(app);
                return true;
            }
            KeyCode::Char('k') => {
                request_clear(app);
                return true;
            }
            _ => {}
        }
    }
    let editor = &mut app.scratchpad_ui.editor;
    let selecting = key.modifiers.contains(KeyModifiers::SHIFT);
    let changed = match key.code {
        KeyCode::Char(character) if !key.modifiers.contains(KeyModifiers::CONTROL) => {
            editor.insert_text(&character.to_string());
            true
        }
        KeyCode::Enter => {
            editor.insert_text("\n");
            true
        }
        KeyCode::Backspace => {
            if editor.has_selection() {
                editor.delete_selection()
            } else {
                editor.backspace();
                true
            }
        }
        KeyCode::Delete => {
            if editor.has_selection() {
                editor.delete_selection()
            } else {
                editor.delete_forward();
                true
            }
        }
        KeyCode::Left => {
            prepare_cursor_move(editor, selecting);
            editor.move_left();
            false
        }
        KeyCode::Right => {
            prepare_cursor_move(editor, selecting);
            editor.move_right();
            false
        }
        KeyCode::Up => {
            prepare_cursor_move(editor, selecting);
            editor.move_up();
            false
        }
        KeyCode::Down => {
            prepare_cursor_move(editor, selecting);
            editor.move_down();
            false
        }
        KeyCode::Home => {
            prepare_cursor_move(editor, selecting);
            editor.move_home();
            false
        }
        KeyCode::End => {
            prepare_cursor_move(editor, selecting);
            editor.move_end();
            false
        }
        _ => return false,
    };
    if changed {
        queue_save(app);
    }
    true
}

pub fn handle_paste(app: &mut App, text: &str) -> bool {
    if app.scratchpad_ui.mode != ScratchpadMode::Insert {
        return false;
    }
    app.scratchpad_ui.editor.insert_text(text);
    queue_save(app);
    true
}

pub fn handle_mouse(app: &mut App, mouse: MouseEvent) -> bool {
    let area = app.scratchpad_ui.area;
    let inside = area.contains((mouse.column, mouse.row).into());
    match mouse.kind {
        MouseEventKind::Down(MouseButton::Left) if inside => {
            app.scratchpad_ui.mode = ScratchpadMode::Insert;
            place_mouse_caret(app, mouse, false);
            app.scratchpad_ui.editor.begin_selection();
            app.scratchpad_ui.mouse_dragging = true;
            true
        }
        MouseEventKind::Drag(MouseButton::Left) if app.scratchpad_ui.mouse_dragging => {
            place_mouse_caret(app, mouse, true);
            true
        }
        MouseEventKind::Up(MouseButton::Left) if app.scratchpad_ui.mouse_dragging => {
            if inside {
                place_mouse_caret(app, mouse, true);
            }
            app.scratchpad_ui.mouse_dragging = false;
            if !app.scratchpad_ui.editor.has_selection() {
                app.scratchpad_ui.editor.clear_selection();
            }
            true
        }
        MouseEventKind::ScrollUp | MouseEventKind::ScrollDown if inside => {
            app.scratchpad_ui.mode = ScratchpadMode::Normal;
            app.scratchpad_ui.editor.clear_selection();
            for _ in 0..3 {
                if mouse.kind == MouseEventKind::ScrollUp {
                    app.scratchpad_ui.editor.move_up();
                } else {
                    app.scratchpad_ui.editor.move_down();
                }
            }
            true
        }
        _ => false,
    }
}

pub fn captures_text_keys(app: &App) -> bool {
    app.scratchpad_ui.mode != ScratchpadMode::Normal
}

pub fn mode_label(app: &App) -> &'static str {
    match app.scratchpad_ui.mode {
        ScratchpadMode::Normal => "NORMAL",
        ScratchpadMode::Insert => "INSERT",
        ScratchpadMode::Visual => "VISUAL",
    }
}

fn place_mouse_caret(app: &mut App, mouse: MouseEvent, extend_selection: bool) {
    let area = app.scratchpad_ui.area;
    let row = usize::from(
        mouse
            .row
            .saturating_sub(area.y)
            .min(area.height.saturating_sub(1)),
    );
    let column = usize::from(
        mouse
            .column
            .saturating_sub(area.x)
            .min(area.width.saturating_sub(1)),
    );
    app.scratchpad_ui.editor.place_caret_wrapped(
        area.width,
        app.scratchpad_ui.viewport,
        row,
        column,
        extend_selection,
    );
}

fn handle_normal_key(app: &mut App, key: KeyEvent) -> bool {
    if key.code == KeyCode::Char('d') {
        if app.scratchpad_ui.pending_delete {
            app.scratchpad_ui.editor.delete_line();
            app.scratchpad_ui.pending_delete = false;
            queue_save(app);
        } else {
            app.scratchpad_ui.pending_delete = true;
        }
        return true;
    }
    app.scratchpad_ui.pending_delete = false;
    let editor = &mut app.scratchpad_ui.editor;
    match key.code {
        KeyCode::Char('i') => app.scratchpad_ui.mode = ScratchpadMode::Insert,
        KeyCode::Char('a') => {
            editor.move_right();
            app.scratchpad_ui.mode = ScratchpadMode::Insert;
        }
        KeyCode::Char('I') => {
            editor.move_home();
            app.scratchpad_ui.mode = ScratchpadMode::Insert;
        }
        KeyCode::Char('A') => {
            editor.move_end();
            app.scratchpad_ui.mode = ScratchpadMode::Insert;
        }
        KeyCode::Char('o') => {
            editor.move_end();
            editor.insert_newline();
            app.scratchpad_ui.mode = ScratchpadMode::Insert;
            queue_save(app);
        }
        KeyCode::Char('O') => {
            editor.open_line_above();
            app.scratchpad_ui.mode = ScratchpadMode::Insert;
            queue_save(app);
        }
        KeyCode::Char('v') => {
            editor.begin_selection();
            app.scratchpad_ui.mode = ScratchpadMode::Visual;
        }
        KeyCode::Char('x') | KeyCode::Delete => {
            editor.delete_forward();
            queue_save(app);
        }
        KeyCode::Char('0') | KeyCode::Home => editor.move_home(),
        KeyCode::Char('$') | KeyCode::End => editor.move_end(),
        KeyCode::Char('h') | KeyCode::Left => editor.move_left(),
        KeyCode::Char('j') | KeyCode::Down => editor.move_down(),
        KeyCode::Char('k') | KeyCode::Up => editor.move_up(),
        KeyCode::Char('l') | KeyCode::Right => editor.move_right(),
        _ => return false,
    }
    true
}

fn handle_visual_key(app: &mut App, key: KeyEvent) -> bool {
    match key.code {
        KeyCode::Esc => {
            app.scratchpad_ui.editor.clear_selection();
            app.scratchpad_ui.mode = ScratchpadMode::Normal;
        }
        KeyCode::Char('h') | KeyCode::Left => app.scratchpad_ui.editor.move_left(),
        KeyCode::Char('j') | KeyCode::Down => app.scratchpad_ui.editor.move_down(),
        KeyCode::Char('k') | KeyCode::Up => app.scratchpad_ui.editor.move_up(),
        KeyCode::Char('l') | KeyCode::Right => app.scratchpad_ui.editor.move_right(),
        KeyCode::Char('0') | KeyCode::Home => app.scratchpad_ui.editor.move_home(),
        KeyCode::Char('$') | KeyCode::End => app.scratchpad_ui.editor.move_end(),
        KeyCode::Char('y') => {
            copy_selection(app);
            app.scratchpad_ui.editor.clear_selection();
            app.scratchpad_ui.mode = ScratchpadMode::Normal;
        }
        KeyCode::Char('d') | KeyCode::Char('x') | KeyCode::Delete => {
            if app.scratchpad_ui.editor.delete_selection() {
                queue_save(app);
            }
            app.scratchpad_ui.mode = ScratchpadMode::Normal;
        }
        _ => return false,
    }
    true
}

fn prepare_cursor_move(editor: &mut Editor, selecting: bool) {
    if selecting {
        editor.begin_selection();
    } else {
        editor.clear_selection();
    }
}

fn copy_selection(app: &mut App) {
    let Some(text) = app.scratchpad_ui.editor.selected_text() else {
        return;
    };
    if let Err(error) = clipboard::write_text(&text) {
        app.notice = Some(error);
    }
}

fn cut_selection(app: &mut App) {
    let Some(text) = app.scratchpad_ui.editor.selected_text() else {
        return;
    };
    if let Err(error) = clipboard::write_text(&text) {
        app.notice = Some(error);
        return;
    }
    if app.scratchpad_ui.editor.delete_selection() {
        queue_save(app);
    }
}

fn paste_clipboard(app: &mut App) {
    match clipboard::read() {
        Ok(ClipboardContent::Text(text)) => {
            app.scratchpad_ui.editor.insert_text(&text);
            queue_save(app);
        }
        Ok(ClipboardContent::ImagePng(_)) => {
            app.notice = Some("scratchpad clipboard paste supports text only".to_owned());
        }
        Err(error) => app.notice = Some(error),
    }
}

fn queue_save(app: &mut App) {
    let project = app.scratchpad_ui.project.clone();
    let content = app.scratchpad_ui.editor.text.clone();
    app.pending.retain(|action| {
        !matches!(action, PendingAction::SaveScratchpad { project: queued, .. } if queued == &project)
    });
    app.pending
        .push(PendingAction::SaveScratchpad { project, content });
    app.scratchpad_ui.saving = true;
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::input::keymap::Keymap;
    use crate::theme::Theme;

    #[test]
    fn typing_queues_a_project_local_save() {
        let mut app = App::new("main", Theme::detect(), Keymap::default());
        open(&mut app, "main");
        app.pending.clear();
        app.scratchpad_ui.mode = ScratchpadMode::Insert;
        handle_key(
            &mut app,
            KeyEvent::new(KeyCode::Char('x'), KeyModifiers::NONE),
        );
        assert!(app.pending.iter().any(|action| matches!(
            action,
            PendingAction::SaveScratchpad { project, content }
                if project == "main" && content == "x"
        )));
    }

    #[test]
    fn shift_arrows_select_and_backspace_deletes_the_selection() {
        let mut app = App::new("main", Theme::detect(), Keymap::default());
        open(&mut app, "main");
        app.pending.clear();
        app.scratchpad_ui.mode = ScratchpadMode::Insert;
        app.scratchpad_ui.editor.set_text("scratchpad");
        app.scratchpad_ui.editor.move_end();

        for code in [KeyCode::Left, KeyCode::Left, KeyCode::Left] {
            handle_key(&mut app, KeyEvent::new(code, KeyModifiers::SHIFT));
        }
        assert_eq!(
            app.scratchpad_ui.editor.selected_text().as_deref(),
            Some("pad")
        );

        handle_key(
            &mut app,
            KeyEvent::new(KeyCode::Backspace, KeyModifiers::NONE),
        );
        assert_eq!(app.scratchpad_ui.editor.text, "scratch");
        assert!(!app.scratchpad_ui.editor.has_selection());
    }

    #[test]
    fn holding_shift_vertical_arrows_extends_a_multiline_selection() {
        let mut app = App::new("main", Theme::detect(), Keymap::default());
        open(&mut app, "main");
        app.pending.clear();
        app.scratchpad_ui.mode = ScratchpadMode::Insert;
        app.handle_event(crossterm::event::Event::Key(KeyEvent::new(
            KeyCode::Right,
            KeyModifiers::CONTROL,
        )));
        app.scratchpad_ui.editor.set_text("one\ntwo\nthree\nfour");
        app.scratchpad_ui.editor.row = 3;
        app.scratchpad_ui.editor.move_end();

        app.handle_event(crossterm::event::Event::Key(KeyEvent::new(
            KeyCode::Up,
            KeyModifiers::SHIFT,
        )));
        app.handle_event(crossterm::event::Event::Key(KeyEvent::new_with_kind(
            KeyCode::Up,
            KeyModifiers::SHIFT,
            crossterm::event::KeyEventKind::Repeat,
        )));

        assert_eq!(
            app.scratchpad_ui.editor.selected_text().as_deref(),
            Some("\nthree\nfour")
        );
    }

    #[test]
    fn clear_scratchpad_requires_confirmation_and_queues_an_empty_save() {
        let mut app = App::new("main", Theme::detect(), Keymap::default());
        open(&mut app, "main");
        app.pending.clear();
        app.scratchpad_ui.editor.set_text("discard me");
        app.execute_command("clear-scratchpad");
        assert!(app.confirm.is_some());

        app.handle_event(crossterm::event::Event::Key(KeyEvent::new(
            KeyCode::Char('y'),
            KeyModifiers::NONE,
        )));
        assert!(app.confirm.is_none());
        assert!(app.scratchpad_ui.editor.text.is_empty());
        assert!(app.pending.iter().any(|action| matches!(
            action,
            PendingAction::SaveScratchpad { project, content }
                if project == "main" && content.is_empty()
        )));
    }

    #[test]
    fn escape_leaves_insert_mode_and_normal_commands_edit_the_note() {
        let mut app = App::new("main", Theme::detect(), Keymap::default());
        open(&mut app, "main");
        app.pending.clear();

        app.handle_event(crossterm::event::Event::Key(KeyEvent::new(
            KeyCode::Char('i'),
            KeyModifiers::NONE,
        )));
        app.handle_event(crossterm::event::Event::Key(KeyEvent::new(
            KeyCode::Char('n'),
            KeyModifiers::NONE,
        )));
        app.handle_event(crossterm::event::Event::Key(KeyEvent::new(
            KeyCode::Esc,
            KeyModifiers::NONE,
        )));
        app.handle_event(crossterm::event::Event::Key(KeyEvent::new(
            KeyCode::Char('o'),
            KeyModifiers::NONE,
        )));

        assert_eq!(app.scratchpad_ui.mode, ScratchpadMode::Insert);
        assert_eq!(app.scratchpad_ui.editor.text, "n\n");
        assert_eq!(app.scratchpad_ui.editor.row, 1);
    }

    #[test]
    fn mouse_click_places_the_caret_and_enters_insert_mode() {
        let mut app = App::new("main", Theme::detect(), Keymap::default());
        open(&mut app, "main");
        app.scratchpad_ui.editor.set_text("alpha\nbeta");
        app.scratchpad_ui.area = Rect::new(10, 5, 30, 4);
        app.scratchpad_ui.viewport = 4;

        assert!(handle_mouse(
            &mut app,
            MouseEvent {
                kind: MouseEventKind::Down(MouseButton::Left),
                column: 14,
                row: 6,
                modifiers: KeyModifiers::NONE,
            }
        ));

        assert_eq!(app.scratchpad_ui.mode, ScratchpadMode::Insert);
        assert_eq!(app.scratchpad_ui.editor.row, 1);
        assert_eq!(app.scratchpad_ui.editor.col, 2);
    }
}
