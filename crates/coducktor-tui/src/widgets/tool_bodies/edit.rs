use ratatui::text::{Line, Span};
use serde_json::Value;
use similar::{ChangeTag, TextDiff};

use crate::diff::{Highlighter, render_compact_patch};
use crate::widgets::transcript::{FrameCtx, ToolDiffCache, ToolItem};

use super::string_field;

pub(super) fn call_body(
    item: &ToolItem,
    _width: u16,
    ctx: FrameCtx<'_>,
) -> Option<Vec<Line<'static>>> {
    let derived = derived(item)?;
    let (lines, _, _) = render_compact_patch(
        &derived.patch,
        &derived.path,
        ctx.theme,
        &Highlighter::new(),
        12,
    );
    (!lines.is_empty()).then_some(lines)
}

pub(super) fn result_body(
    _item: &ToolItem,
    _width: u16,
    _ctx: FrameCtx<'_>,
) -> Option<(Span<'static>, Vec<Line<'static>>)> {
    None
}

pub(super) fn meta(item: &ToolItem) -> Vec<String> {
    derived(item)
        .map(|diff| vec![format!("+{} −{}", diff.adds, diff.dels)])
        .unwrap_or_default()
}

fn derived(item: &ToolItem) -> Option<&ToolDiffCache> {
    let input = item.input.as_ref()?;
    let cache = item
        .diff_cache
        .get_or_init(|| derive_diff(&item.name, input));
    (cache.adds > 0 || cache.dels > 0).then_some(cache)
}

fn derive_diff(name: &str, input: &Value) -> ToolDiffCache {
    if let Some(patch) = string_field(input, &["patch", "diff"]) {
        return cache(
            string_field(input, &["file_path", "filePath", "path"]).unwrap_or("change"),
            patch.to_owned(),
        );
    }
    let key = name.to_ascii_lowercase();
    if key == "filechange"
        && let Some(changes) = input.get("changes").and_then(Value::as_array)
    {
        let mut path = "change".to_owned();
        let mut patches = Vec::new();
        for change in changes {
            if let Some(candidate) = string_field(change, &["path", "file_path"]) {
                if patches.is_empty() {
                    path = candidate.to_owned();
                }
                if let Some(diff) = string_field(change, &["diff", "patch"]) {
                    patches.push(diff.to_owned());
                }
            }
        }
        return cache(&path, patches.join("\n"));
    }
    let path = string_field(input, &["file_path", "filePath", "path"]).unwrap_or("change");
    if key == "multiedit" {
        let mut patches = Vec::new();
        if let Some(edits) = input.get("edits").and_then(Value::as_array) {
            for edit in edits {
                let old = string_field(edit, &["old_string", "oldString"]).unwrap_or("");
                let new = string_field(edit, &["new_string", "newString"]).unwrap_or("");
                patches.push(synthetic_patch(old, new));
            }
        }
        return cache(path, patches.join("\n"));
    }
    if key == "write" {
        let content = string_field(input, &["content"]).unwrap_or("");
        return cache(path, synthetic_patch("", content));
    }
    let old = string_field(input, &["old_string", "oldString"]).unwrap_or("");
    let new = string_field(input, &["new_string", "newString", "content"]).unwrap_or("");
    cache(path, synthetic_patch(old, new))
}

fn cache(path: &str, patch: String) -> ToolDiffCache {
    let adds = patch
        .lines()
        .filter(|line| line.starts_with('+') && !line.starts_with("+++"))
        .count();
    let dels = patch
        .lines()
        .filter(|line| line.starts_with('-') && !line.starts_with("---"))
        .count();
    ToolDiffCache {
        path: path.to_owned(),
        patch,
        adds,
        dels,
    }
}

fn synthetic_patch(old: &str, new: &str) -> String {
    let old_count = old.lines().count();
    let new_count = new.lines().count();
    let mut patch = format!("@@ -1,{old_count} +1,{new_count} @@\n");
    for change in TextDiff::from_lines(old, new).iter_all_changes() {
        let marker = match change.tag() {
            ChangeTag::Equal => ' ',
            ChangeTag::Delete => '-',
            ChangeTag::Insert => '+',
        };
        for value in change.value().split_inclusive('\n') {
            patch.push(marker);
            patch.push_str(value);
            if !value.ends_with('\n') {
                patch.push('\n');
            }
        }
    }
    patch
}
