//! Semantic call and result bodies for transcript tool cards.

mod bash;
mod edit;
mod plan;
mod read;
mod search;
mod task;

use coducktor_protocol::ToolKind;
use ratatui::text::{Line, Span};
use serde_json::Value;

use crate::widgets::transcript::{FrameCtx, ToolItem};

pub fn call_body(item: &ToolItem, width: u16, ctx: FrameCtx<'_>) -> Option<Vec<Line<'static>>> {
    match item.tool_kind {
        ToolKind::Execute => bash::call_body(item, width, ctx),
        ToolKind::Read | ToolKind::Fetch => read::call_body(item, width, ctx),
        ToolKind::Edit | ToolKind::Delete | ToolKind::Move => edit::call_body(item, width, ctx),
        ToolKind::Search => search::call_body(item, width, ctx),
        ToolKind::Task => task::call_body(item, width, ctx),
        ToolKind::Plan => plan::call_body(item, width, ctx),
        ToolKind::Think | ToolKind::Other => None,
    }
}

pub fn result_body(
    item: &ToolItem,
    width: u16,
    ctx: FrameCtx<'_>,
) -> Option<(Span<'static>, Vec<Line<'static>>)> {
    match item.tool_kind {
        ToolKind::Execute => bash::result_body(item, width, ctx),
        ToolKind::Read | ToolKind::Fetch => read::result_body(item, width, ctx),
        ToolKind::Edit | ToolKind::Delete | ToolKind::Move => edit::result_body(item, width, ctx),
        ToolKind::Search => search::result_body(item, width, ctx),
        ToolKind::Task => task::result_body(item, width, ctx),
        ToolKind::Plan => plan::result_body(item, width, ctx),
        ToolKind::Think | ToolKind::Other => None,
    }
}

pub fn meta(item: &ToolItem) -> Vec<String> {
    match item.tool_kind {
        ToolKind::Read | ToolKind::Fetch => read::meta(item),
        ToolKind::Edit | ToolKind::Delete | ToolKind::Move => edit::meta(item),
        _ => Vec::new(),
    }
}

pub(super) fn string_field<'a>(input: &'a Value, keys: &[&str]) -> Option<&'a str> {
    keys.iter()
        .find_map(|key| input.get(*key).and_then(Value::as_str))
        .filter(|value| !value.is_empty())
}

pub(super) fn number_field(input: &Value, keys: &[&str]) -> Option<u64> {
    keys.iter().find_map(|key| {
        input.get(*key).and_then(|value| {
            value
                .as_u64()
                .or_else(|| value.as_f64().map(|value| value as u64))
        })
    })
}

#[cfg(test)]
mod tests {
    use coducktor_protocol::ToolStatus;
    use ratatui::style::Modifier;

    use super::*;
    use crate::theme::{ColorCapability, Theme, ThemeName};

    fn theme() -> Theme {
        Theme::new(ThemeName::Dark, ColorCapability::TrueColor)
    }

    fn ctx(theme: &Theme) -> FrameCtx<'_> {
        FrameCtx {
            theme,
            tick: 0,
            now_epoch: 100,
        }
    }

    fn text(lines: &[Line<'_>]) -> String {
        lines
            .iter()
            .flat_map(|line| line.spans.iter())
            .map(|span| span.content.as_ref())
            .collect::<Vec<_>>()
            .join("")
    }

    #[test]
    fn bash_body_shows_command_output_and_footer() {
        let theme = theme();
        let mut item = ToolItem::new(
            "bash",
            "Bash",
            Some(&serde_json::json!({"command":"cargo test","cwd":"/repo"})),
            ToolStatus::Failed,
        );
        item.output = Some("failed".to_owned());
        item.duration_ms = Some(2_370);
        item.exit_code = Some(1);
        let call = call_body(&item, 100, ctx(&theme)).unwrap();
        assert!(text(&call).contains("$ cd /repo && cargo test"));
        let (_, result) = result_body(&item, 100, ctx(&theme)).unwrap();
        assert!(text(&result).contains("[Wall: 2.4s | Exit: 1]"));
    }

    #[test]
    fn read_body_summarizes_until_explicitly_expanded() {
        let theme = theme();
        let mut item = ToolItem::new(
            "read",
            "Read",
            Some(&serde_json::json!({"path":"src/lib.rs","offset":120,"limit":20})),
            ToolStatus::Completed,
        );
        item.output = Some("one\ntwo\nthree".to_owned());
        let (_, result) = result_body(&item, 100, ctx(&theme)).unwrap();
        assert!(text(&result).contains("3 lines"));
        assert_eq!(meta(&item), vec!["L120–L139"]);
    }

    #[test]
    fn edit_body_derives_and_memoizes_argument_diff() {
        let theme = theme();
        let item = ToolItem::new(
            "edit",
            "Edit",
            Some(&serde_json::json!({
                "file_path":"/repo/src/middleware.ts",
                "old_string":"return redirect('/login')",
                "new_string":"return redirect('/login', { preserveSession: true })"
            })),
            ToolStatus::Completed,
        );
        let first = call_body(&item, 100, ctx(&theme)).unwrap();
        assert!(text(&first).contains("preserveSession"));
        assert_eq!(meta(&item), vec!["+1 −1"]);
        let cached = item.diff_cache.get().unwrap() as *const _;
        for _ in 0..30 {
            let _ = call_body(&item, 100, ctx(&theme));
        }
        assert_eq!(cached, item.diff_cache.get().unwrap() as *const _);
    }

    #[test]
    fn codex_file_change_patch_uses_the_same_diff_renderer() {
        let theme = theme();
        let item = ToolItem::new(
            "edit",
            "fileChange",
            Some(&serde_json::json!({"changes":[{
                "path":"src/auth.ts",
                "kind":"update",
                "diff":"@@ -10,1 +10,1 @@\n-redirect('/login')\n+redirect(returnTo)\n"
            }]})),
            ToolStatus::Completed,
        );
        let body = call_body(&item, 100, ctx(&theme)).unwrap();
        assert!(text(&body).contains("returnTo"));
        assert_eq!(meta(&item), vec!["+1 −1"]);
    }

    #[test]
    fn search_task_and_plan_have_semantic_rows() {
        let theme = theme();
        let search = ToolItem::new(
            "search",
            "Grep",
            Some(&serde_json::json!({"pattern":"needle","path":"src"})),
            ToolStatus::Running,
        );
        assert!(text(&call_body(&search, 100, ctx(&theme)).unwrap()).contains("needle in src"));

        let task = ToolItem::new(
            "task",
            "Task",
            Some(
                &serde_json::json!({"subagent_type":"reviewer","prompt":"Review auth\nCheck tests"}),
            ),
            ToolStatus::Running,
        );
        let task_lines = call_body(&task, 100, ctx(&theme)).unwrap();
        assert!(task_lines.iter().any(|line| {
            line.spans
                .iter()
                .any(|span| span.style.add_modifier.contains(Modifier::ITALIC))
        }));

        let plan = ToolItem::new(
            "plan",
            "TodoWrite",
            Some(&serde_json::json!({"todos":[
                {"content":"Implement","status":"completed"},
                {"content":"Verify","status":"in_progress"}
            ]})),
            ToolStatus::Running,
        );
        let plan_text = text(&call_body(&plan, 100, ctx(&theme)).unwrap());
        assert!(plan_text.contains("Implement"));
        assert!(plan_text.contains("Verify"));
    }

    #[test]
    fn malformed_inputs_fall_back_without_panicking() {
        let theme = theme();
        for name in ["Bash", "Read", "Edit", "Grep", "Task", "TodoWrite"] {
            let item = ToolItem::new(
                name,
                name,
                Some(&serde_json::json!({"unexpected": 7})),
                ToolStatus::Running,
            );
            let _ = call_body(&item, 100, ctx(&theme));
            let _ = result_body(&item, 100, ctx(&theme));
        }
    }
}
