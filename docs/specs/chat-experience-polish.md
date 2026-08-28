# Chat experience polish — implementation specification

Status: proposed (2026-08-28)

Audience: the implementation agent. Work directly on `main`, preserve unrelated worktree changes,
commit each completed phase, and push `origin main` as required by `AGENTS.md`.

Scope: the *watching the agent work* surface — the conversation transcript in
`crates/coducktor-tui`. The composer, header, routing, engine seam, durable formats, and Git/GitHub
screens are untouched except where this document names an exact file and symbol.

This is a presentation specification. It borrows the visual grammar of the OMP (oh-my-pi) harness,
which was read directly out of the shipped `omp` binary's embedded sources
(`packages/coding-agent/src/tui/output-block.ts`, `modes/components/tool-execution.ts`,
`modes/theme/symbols.ts`, `tools/default-renderer.ts`, `packages/tui/src/components/loader.ts`) and
its published docs (`omp://tui-runtime-internals.md`, `omp://theme.md`). Every OMP constant quoted
below is a real value from that read, not an estimate.

---

## 0. How to use this document

Phases are ordered by dependency. **Do not reorder.** Phase 1 and 2 build primitives that every
later phase consumes.

Each phase has:

- **Files** — the exact files to touch.
- **Change** — what to build, with signatures.
- **Acceptance** — the observable result.
- **Verify** — the command that proves it.

Rules that apply to every phase:

- No `unwrap()` / `expect()` in production paths (tests may use them). `AGENTS.md`.
- Every new rendering helper is a pure function of `(item, width, theme, frame context)` so the
  transcript's height cache and 33 ms frame budget survive. Never allocate per frame what can be
  computed once per item revision.
- Never break `Transcript`'s virtualization contract: `TranscriptItem::height(width)` must return
  exactly the number of rows `TranscriptItem::paint` writes at that width.
- Snapshots are reviewed, never blindly accepted (`cargo insta review`, or hand-diff the `.snap`).
- Run the focused tests while iterating; run the full gate before committing.

---

## 1. Decision

The transcript today is a flat list of styled single lines. It reads like a log file. The target is
a transcript of **cards**: bordered, status-tinted, semantically summarized blocks that animate
while they are alive and go quiet when they finish.

Concretely, coducktor adopts six things from OMP, in this order of value:

1. **A framed card primitive** — rounded box, status-colored border, status-tinted background,
   a header row embedded in the top border, and `├─ Output ─┤` section dividers.
2. **A shared-clock animation model** — one spinner phase derived from the existing
   `App::animation_tick`, used simultaneously by the transcript status line, every running tool
   card, and the thinking indicator, so the whole screen pulses in unison.
3. **A live activity line** — spinner + the model's current activity + elapsed + `esc` affordance,
   directly above the composer.
4. **Progressive collapse under vertical pressure** — a running tool card degrades 
   full card → 2-row folded card → 1-row activity line → hidden, instead of pushing the
   composer off-screen or scrolling the live tail away.
5. **Per-tool semantic bodies** — bash, read, edit/diff, search, task, plan get their own body
   renderer instead of a raw text dump.
6. **A thinking indicator** — italic dim reasoning text plus an animated sparkle header carrying
   elapsed time.

### 1.1 Non-goals

- No new terminal renderer. coducktor stays on `ratatui` + the existing virtualized `Transcript`.
- No change to durable NDJSON shapes, no new engine methods, no runner rewiring beyond the one
  narrow field lift in Phase 8.
- No theme file format, no user-authored themes, no `symbolPreset` setting. The glyph set is a
  compile-time table with a locale-driven ASCII fallback (coducktor already does this in
  `widgets/run_end.rs`).
- No image protocol work.

---

## 2. Reference — the OMP visual grammar, distilled

Read this section once; later phases reference it by number.

### 2.1 The framed block (`renderOutputBlock`)

Every OMP tool result is one rounded box:

```
╭─── ❯ Ran npm test ─────────────────────────── 2.4s ──╮
│ $ cd /repo && npm test 2>&1 | tail -20               │
├─── Output ───────────────────────────────────────────┤
│ Test Files  1 passed (1)                             │
│      Tests  6 passed (6)                             │
│ [Wall: 2.37s | Timeout: 300s]                        │
╰──────────────────────────────────────────────────────╯
```

Rules taken verbatim from `tui/output-block.ts`:

- Bars start with `corner + "───"` (exactly three horizontals), then ` label `, then fill, then
  the closing corner. A bar with no label is solid fill.
- A section with a label emits a `├─── Label ────┤` divider; a section without one emits either
  nothing (first section) or a plain `├─────┤` separator.
- Content rows are `│` + left padding + text padded to the inner width + right padding + `│`.
- Border color by state: `error` → error, `warning` → warning, `running`/`pending` → accent,
  anything else → dim.
- Background: a state tint (`toolPendingBg` / `toolSuccessBg` / `toolErrorBg`) fills the whole
  box, borders included.
- The header may carry right-hand meta joined with ` · `.
- Rendered rows are memoized behind a content hash (`CachedOutputBlock`) — the box is not rebuilt
  unless its inputs change.

### 2.2 The header line (`renderStatusLine`)

`icon + " " + title` (title in accent), then `": " + description` in muted, then an optional
`⟦badge⟧`, then dim meta joined by ` · `. The icon is the status glyph, and when the status is
`running` the icon **is the spinner frame**, so the card's own header animates.

### 2.3 Progressive collapse (`ToolExecutionComponent.render`)

The container hands each block a row allocation. The block renders:

| Allocation | Rendering |
| --- | --- |
| ≥ 3 rows | the full tool renderer |
| 2 rows | `╭─ Label · detail 12s` then `╰` — a two-row "folded card" |
| 1 row | `⠿ Label · detail 12s` — spinner (or `•` when idle) + bold label + muted detail + dim elapsed |
| 0 rows | nothing |

The 1-row and 2-row forms truncate to `width - 4`. `detail` comes from a per-tool
`activitySummary`, falling back to the first line of the tool's `command`, `path`, or `input`
argument, falling back to the literal `running`.

### 2.4 Animation constants

| Thing | Value | Source |
| --- | --- | --- |
| Status spinner frames (unicode) | `⣾ ⣽ ⣻ ⢿ ⡿ ⣟ ⣯ ⣷` | `modes/theme/symbols.ts` |
| Activity spinner frames (unicode) | `⠋ ⠙ ⠹ ⠸ ⠼ ⠴ ⠦ ⠧ ⠇ ⠏` | `modes/theme/symbols.ts` |
| ASCII spinner | `| / - \` | `modes/theme/symbols.ts` |
| Status spinner advance | 80 ms (`SPINNER_GLYPH_ADVANCE_MS`) → 12.5 fps | `tool-execution.ts` |
| Spinner phase | `floor(now_ms / 80) % frames.len()` — one shared clock, every card in phase | `sharedSpinnerFrame` |
| Thinking sparkle frames | `✻ ✼ ❉ ❊ ✺ ✹ ✸ ✶` | `modes/components/…` (assistant block) |
| Thinking brightness pulse | `70 + (230-70) * (1 - cos(2π·i/8))/2` | same |
| Loader re-render backpressure | next tick ≥ `9 × last_frame_cost_ms`, capped 200 ms | `packages/tui/src/components/loader.ts` |

The shared clock is the important idea: OMP does not give each component its own phase. Every
running card shows the *same* glyph on the *same* frame.

### 2.5 Glyph table (unicode preset, subset coducktor needs)

```
status.success ✔   status.error ✘    status.warning ⚠   status.running ⟳
status.pending ⏳   status.done •     nav.expand ▸       nav.collapse ▾
tree.branch ├─     tree.last └─      tree.vertical │
boxRound ╭ ╮ ╰ ╯ ─ │      boxSharp tees ├ ┤ ┬ ┴ ┼
tool.bash ❯   tool.edit ✎   tool.write ✎   tool.task ⇶   tool.todo ☑
tool.webSearch ⌕   tool.browser 🌐   tool.eval ▶   tool.review ◉
format.bullet •    format.bracketLeft ⟦   format.bracketRight ⟧
sep.dot " · "
```

### 2.6 Body renderers worth stealing

- **bash**: call section shows `$ cd <cwd> && <command>` with the `$ cd … &&` prefix dim and the
  command syntax-highlighted; result section is labelled `Output`; unexpanded output is tail-
  clamped with a leading `… (N earlier lines, showing M of T) (<key> to expand)`; a dim footer chip
  `[Wall: 2.37s | Timeout: 300s | Exit: 1]` closes the block.
- **default** (`tools/default-renderer.ts`): header line, then when collapsed a single
  `└─ <compact args>` tree row, then at most 4 output lines (12 when expanded) and a dim
  `… N more lines  <expand hint>`. JSON output is pretty-printed instead of dumped.

---

## 3. Current state (verified)

Do not re-discover this; it is accurate as of `b007709c`.

| Concern | Where | State |
| --- | --- | --- |
| Thread screen entry | `screens/thread/mod.rs::render` → `render_conversation` (~:1633) | 3-row layout: `Length(5)` header / `Min(3)` transcript / dock |
| Transcript status line | `mod.rs:1672-1705` | spinner + `current_status` + elapsed + tokens, folded into a `Borders::TOP` block title |
| Dock hint | `mod.rs:1745-1758` → `widgets::render_status_hint` | one row, spinner-prefixed while Queued/Running |
| Transcript widget | `widgets/transcript.rs` | virtualized; `HeightCache` keyed `(id, revision, width)`; `paint_clipped` scratch-buffer blit |
| Item model | `transcript.rs::TranscriptItem` | `Message | Reasoning | Tool | Note | Image | RunEnd` |
| Tool card | `transcript.rs::paint_tool_card` (:448-557) | **one header line + clamped raw output. No border, no background, no per-tool body, no spinner.** |
| Tool item fields | `transcript.rs::ToolItem` (:232-247) | `id, tool_kind, title, subtitle, status, output, error, exit_code, user_expanded, is_latest` |
| Default open policy | `transcript.rs::tool_default_open` (:288) | open iff `is_latest`, or Execute+Running+has output |
| Output clamp | `OUTPUT_CLAMP_LINES = 12` (:31) | head-clamped, `+N more lines` |
| Reasoning | `transcript.rs::paint_reasoning` (:415) | `Thinking — <first line>` header, DIM body when expanded. Not italic, not animated |
| Markdown | `markdown.rs::RenderCache` | re-parses when `source.len()` changes; per-width height memo; no code-fence highlighting |
| Spinner | `widgets/spinner.rs` | 8 braille frames, `frame(tick) = FRAMES[(tick/3) % 8]`, ~100 ms/frame |
| Frame cadence | `runtime.rs::FRAME_BUDGET = 33ms` (:30); `animation_tick` incremented once per frame (:3108) | **A ~30 fps tick already exists. No new timer is needed anywhere in this plan.** |
| Theme | `theme.rs::ThemePalette` | 15 `Color` tokens: `bg surface border fg soft_fg accent add del queued running waiting review done failed cancelled` |
| Unicode fallback | `widgets/run_end.rs::unicode_supported()` (private) | `LC_ALL`/`LC_CTYPE`/`LANG` contains `utf` |
| Diff engine | `diff/` — `render_files`, `Highlighter`, `parse_patch`, `word_diff` | complete, used by Git screens, **not wired into the transcript** |
| Per-tool semantics | `coducktor-protocol::tool_display(name, input)` | maps ~20 tool names to `(ToolKind, title, subtitle)` |
| Perf guards | `mod.rs::live_thread_frame_at_twelve_thousand_events_stays_under_eight_ms`; `benches/thread_frame.rs`; `benches/transcript.rs` | 8 ms release / 30 ms debug for one live frame at 12k events |

### 3.1 What live data exists

The TUI consumes the untyped `coducktor_contract::RunEvent { seq, ts, step_id, event_type, extra }`
and rebuilds items in `screens/thread/reducer.rs`. Available **today** on the live path:

- tool name, full raw JSON args (`tool-call.input`), result text, `isError`, `turnId`;
- per-event ISO-8601 `ts` on both `tool-call` and `tool-result` (currently discarded);
- `exitCode` — OpenCode only, and the reducer drops it on the matched path (`reducer.rs:445-459`);
  Codex buries it inside the stringified item JSON;
- reasoning as a separate `reasoning` event stream;
- record-channel metadata (`ConversationRecord`): state, model, tokens, cost, turn `started_at`.

Not available and **out of scope for this plan**: structured `diffs[]`/`locations[]`, streaming
tool output deltas, `stopReason`, context-window usage, subagent `parent_item_id`. The typed v2
mappers in `coducktor-runners/src/{claude,codex,opencode,pi}.rs` already produce all of these and
are golden-tested against `fixtures/`, but no runner calls them. Wiring them is a separate
specification; see §12.

Phase 6's edit/diff card therefore derives its diff **client-side from the tool's own arguments**
(`old_string`/`new_string`/`content`), which is available on every backend today.

---

## 4. Target rendering

At 120 columns, mid-turn:

```
▌ Add the CI guardrail check.

● I need a verification step that greps tracked files for DEV_AUTH_ENABLED and fails when it
  shows up outside the five allowed files.

▾ ╭─── ✎ Edit .github/workflows/ci.yml ──────────────────────────────── +12 −0 · 0.4s ──╮
  │  38   - run: npm run lint                                                            │
  │  39 + - name: Guard dev auth                                                          │
  │  40 +   run: ./scripts/check-dev-auth.sh                                              │
  ╰───────────────────────────────────────────────────────────────────────────────────────╯

▾ ╭─── ⣟ Ran npm test ───────────────────────────────────────────────────────── 4s ──╮
  │ $ cd /repo && npm test 2>&1 | tail -20                                            │
  ├─── Output ────────────────────────────────────────────────────────────────────────┤
  │ … (37 earlier lines, showing 8 of 45) (za to expand)                              │
  │ Test Files  1 passed (1)                                                          │
  │      Tests  6 passed (6)                                                          │
  ╰───────────────────────────────────────────────────────────────────────────────────╯

  ⣟ Run the full backend test suite · 4s          esc to stop
─────────────────────────────────────────────────────────────────────────────────────────
❯ ▏
```

Under vertical pressure the same live card degrades to:

```
  ╭─ Ran npm test · npm test 2>&1 | tail -20  4s
  ╰
```

and then to:

```
  ⣟ Ran npm test · npm test 2>&1 | tail -20  4s
```

---

## 5. Phase 1 — Theme and glyph foundation

### Files

- `crates/coducktor-tui/src/theme.rs`
- `crates/coducktor-tui/src/glyphs.rs` (new)
- `crates/coducktor-tui/src/lib.rs`
- `crates/coducktor-tui/src/widgets/run_end.rs`

### Change

**1.1 Add four palette tokens** to `ThemePalette`:

```rust
pub struct ThemePalette {
    // … existing 15 tokens unchanged …
    /// Card fill while a tool is pending or running.
    pub card_pending_bg: Color,
    /// Card fill for a finished, successful tool.
    pub card_success_bg: Color,
    /// Card fill for a failed tool.
    pub card_error_bg: Color,
    /// Border for a finished card — dimmer than `border`, so live cards stand out.
    pub card_quiet_border: Color,
}
```

Values, added inside `palette()` and `lakes_palette()`:

| Token | Dark / LazyVim | Lakes | Ansi256 | Ansi16 |
| --- | --- | --- | --- | --- |
| `card_pending_bg` | `blend(bg, accent, 0.10)` | `blend(bg, accent, 0.06)` | 236 / 254 | `Color::Reset` |
| `card_success_bg` | `blend(bg, surface, 1.0)` (i.e. `surface`) | `surface` | 236 / 254 | `Color::Reset` |
| `card_error_bg` | `blend(bg, del, 0.14)` | `blend(bg, del, 0.08)` | 52 / 224 | `Color::Reset` |
| `card_quiet_border` | `blend(bg, border, 0.65)` | `blend(bg, border, 0.65)` | 238 / 250 | `Color::DarkGray` |

Add a private helper next to `palette()`:

```rust
/// Mix `top` into `base` at `alpha` (0.0 = base, 1.0 = top). Used for card fills, which must
/// read as a tint of the terminal background rather than a separate surface.
fn blend(base: (u8, u8, u8), top: (u8, u8, u8), alpha: f32) -> (u8, u8, u8) {
    let mix = |b: u8, t: u8| (f32::from(b) + (f32::from(t) - f32::from(b)) * alpha).round() as u8;
    (mix(base.0, top.0), mix(base.1, top.1), mix(base.2, top.2))
}
```

Because `ColorCapability::Ansi16` maps every tint to `Color::Reset`, the card degrades to
border-only on 16-color terminals. That is the intended fallback; do not invent a 16-color tint.

**1.2 New module `glyphs.rs`.** Move `unicode_supported()` here, make it `pub`, and have
`run_end.rs` call `crate::glyphs::unicode_supported()`. Then:

```rust
/// The glyph set for the current locale. Resolved once; `Glyphs` is `Copy` and cheap to pass.
#[derive(Debug, Clone, Copy)]
pub struct Glyphs {
    pub top_left: &'static str,      // ╭  |  +
    pub top_right: &'static str,     // ╮  |  +
    pub bottom_left: &'static str,   // ╰  |  +
    pub bottom_right: &'static str,  // ╯  |  +
    pub horizontal: &'static str,    // ─  |  -
    pub vertical: &'static str,      // │  |  |
    pub tee_right: &'static str,     // ├  |  +
    pub tee_left: &'static str,      // ┤  |  +
    pub tree_last: &'static str,     // └─ |  `-
    pub bullet: &'static str,        // •  |  *
    pub success: &'static str,       // ✔  |  ok
    pub error: &'static str,         // ✘  |  x
    pub warning: &'static str,       // ⚠  |  !
    pub pending: &'static str,       // ◌  |  .
    pub expanded: &'static str,      // ▾  |  v
    pub collapsed: &'static str,     // ▸  |  >
    pub separator: &'static str,     // " · " | " - "
}

pub fn glyphs() -> Glyphs;           // returns UNICODE or ASCII based on unicode_supported()
```

Per-`ToolKind` icons live here too:

```rust
pub fn tool_icon(kind: ToolKind) -> &'static str;
// Read ▤ · Edit ✎ · Delete ✂ · Move ➜ · Search ⌕ · Execute ❯ · Think ✻ · Fetch ⇩ · Task ⇶ · Plan ☑ · Other ◆
// ASCII: R E D M S $ T F A P *
```

### Acceptance

- `ThemePalette` has 19 tokens; all three themes construct without a compile error.
- `Glyphs` returns the ASCII column when `LANG=C`.
- No visual change yet — nothing consumes the new tokens.

### Verify

```
cargo test -p coducktor-tui --lib theme
cargo test -p coducktor-tui --lib glyphs
```

Add a test asserting `glyphs()` never returns a multi-cell glyph for a single-cell slot
(every field except `tree_last` and `separator` must have `unicode_width == 1`).

---

## 6. Phase 2 — The card primitive

### Files

- `crates/coducktor-tui/src/widgets/card.rs` (new)
- `crates/coducktor-tui/src/widgets/mod.rs`

### Change

A pure, self-measuring framed block. This is coducktor's `renderOutputBlock` (§2.1).

```rust
//! The framed transcript card: a rounded box with a header embedded in its top border,
//! labelled section dividers, and a status tint. Height is a pure function of content and
//! width so the transcript's height cache stays correct.

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum CardState {
    Pending,
    Running,
    Success,
    Warning,
    Error,
}

impl CardState {
    pub fn border(self, theme: &Theme) -> Color;   // Error→failed, Warning→waiting,
                                                    // Pending|Running→accent, Success→card_quiet_border
    pub fn fill(self, theme: &Theme) -> Color;     // Pending|Running→card_pending_bg,
                                                    // Error→card_error_bg, else card_success_bg
}

/// One labelled run of body rows. `label: None` renders a bare `├────┤` separator when it is not
/// the first section, and nothing when it is.
pub struct CardSection<'a> {
    pub label: Option<Span<'a>>,
    pub lines: Vec<Line<'a>>,
}

pub struct Card<'a> {
    /// Rendered inside the top border after `╭───`.
    pub header: Vec<Span<'a>>,
    /// Right-aligned dim meta inside the top border, joined by `glyphs().separator`.
    pub meta: Vec<String>,
    pub state: CardState,
    pub sections: Vec<CardSection<'a>>,
}

impl<'a> Card<'a> {
    /// Rows this card occupies at `width`. Body lines are hard-truncated, never wrapped: a card
    /// whose height depended on wrapping would defeat the height cache's `(id, revision, width)`
    /// key whenever a span's style changed without its text changing.
    pub fn height(&self, width: u16) -> u16 {
        if width < MIN_CARD_WIDTH { return self.plain_height(); }
        let mut rows = 2; // top + bottom border
        for (index, section) in self.sections.iter().enumerate() {
            if section.label.is_some() || index > 0 { rows += 1; }
            rows += section.lines.len() as u16;
        }
        rows
    }

    pub fn render(&self, buf: &mut Buffer, area: Rect, theme: &Theme);

    /// Two-row fold: `╭─ <header> <meta>` / `╰`. §2.3.
    pub fn render_folded(&self, buf: &mut Buffer, area: Rect, theme: &Theme);

    /// One-row summary: `<icon> <header> <meta>`, truncated to `width - 4`. §2.3.
    pub fn render_summary(&self, icon: &str, buf: &mut Buffer, area: Rect, theme: &Theme);
}

/// Below this the box chrome costs more than it conveys; the card degrades to borderless rows.
pub const MIN_CARD_WIDTH: u16 = 24;
/// Columns consumed by `│ ` + ` │`.
pub const CARD_CHROME_WIDTH: u16 = 4;
```

Implementation requirements:

1. **Fill first.** `buf.set_style(area, Style::default().bg(state.fill(theme)))` before painting
   any row, so padding cells carry the tint. Skip when the resolved fill is `Color::Reset`.
2. **Bar construction** matches §2.1 exactly: `corner + horizontal×3`, then ` label `, then fill
   horizontals, then the closing corner. Label spans keep their own fg; the horizontals use the
   border color.
3. **Meta** is right-aligned in the top bar, dim, joined by `glyphs().separator`. If
   `header_width + meta_width + 8 > width`, drop meta entirely rather than truncating it.
4. **Content rows** are `vertical + " " + truncate(line, inner) + pad + " " + vertical`. Use
   `unicode_width::UnicodeWidthStr` for truncation (already a dependency via ratatui; if not,
   use `ratatui::text::Line::width`).
5. **Narrow fallback** (`width < MIN_CARD_WIDTH`): render header row + body rows with no box.
   `plain_height()` returns `1 + section lines`.
6. **No allocation in the hot path beyond the row strings.** Build `Vec<Line>` once per call;
   `Card` is constructed per paint, and paint only happens for visible items.

### Acceptance

- A unit test renders a 2-section card into a 60×8 `Buffer` and asserts the exact border row
  strings, including the `├─── Output ───┤` divider.
- `Card::height(w) == rows actually written` for widths 10, 24, 40, 80, 200 — assert by counting
  non-empty rows in a scratch buffer.
- ASCII locale renders `+---+` chrome with identical height.

### Verify

```
cargo test -p coducktor-tui --lib widgets::card
```

---

## 7. Phase 3 — Frame context and the shared animation clock

### Files

- `crates/coducktor-tui/src/widgets/spinner.rs`
- `crates/coducktor-tui/src/widgets/transcript.rs`
- `crates/coducktor-tui/src/screens/thread/mod.rs`

### Change

**3.1 Extend the spinner** to OMP's two-speed model (§2.4) while keeping the existing API working:

```rust
/// Braille dot patterns ordered as a continuous clockwise spin. Unchanged: existing call sites
/// and tests depend on this exact sequence.
pub const FRAMES: [&str; 8] = ["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧"];
/// Heavier braille used inside tool cards, where the glyph competes with a border.
pub const STATUS_FRAMES: [&str; 8] = ["⣾", "⣽", "⣻", "⢿", "⡿", "⣟", "⣯", "⣷"];
/// Sparkle cycle for the thinking indicator.
pub const THINKING_FRAMES: [&str; 8] = ["✻", "✼", "❉", "❊", "✺", "✹", "✸", "✶"];
pub const ASCII_FRAMES: [&str; 4] = ["|", "/", "-", "\\"];

pub fn frame(tick: u64) -> &'static str;          // unchanged
pub fn status_frame(tick: u64) -> &'static str;   // STATUS_FRAMES[(tick/3) % 8], ASCII fallback
pub fn thinking_frame(tick: u64) -> &'static str; // THINKING_FRAMES[(tick/4) % 8] (~130 ms)

/// 0.0 → 1.0 → 0.0 over one full `THINKING_FRAMES` cycle. Drives the brightness pulse (§2.4).
pub fn pulse(tick: u64) -> f32 {
    let phase = (tick / 4) % THINKING_FRAMES.len() as u64;
    let t = phase as f32 / THINKING_FRAMES.len() as f32;
    (1.0 - (std::f32::consts::TAU * t).cos()) / 2.0
}
```

All frame functions must return `ASCII_FRAMES[...]` when `!crate::glyphs::unicode_supported()`.

**3.2 Thread a frame context into painting.** `TranscriptItem::paint` currently takes only
`&Theme`, so nothing inside a card can animate or show elapsed time. Introduce:

```rust
/// Per-frame render inputs that are *not* part of an item's identity. Nothing in here may
/// influence `TranscriptItem::revision()` or `::height()` — the height cache would thrash.
#[derive(Debug, Clone, Copy)]
pub struct FrameCtx<'a> {
    pub theme: &'a Theme,
    pub tick: u64,
    pub now_epoch: i64,
}
```

Mechanical change, all inside `transcript.rs`:

- `TranscriptItem::paint(&mut self, buf, area, ctx: FrameCtx<'_>)`
- every `paint_*` free function takes `ctx: FrameCtx<'_>` instead of `theme: &Theme`
- `paint_clipped(..., ctx: FrameCtx<'_>)`
- `Transcript::render_inner(&mut self, buf, area, ctx: FrameCtx<'_>, hitmap)`
- `Transcript::render(&mut self, buf, area, ctx)` and `render_interactive(&mut self, buf, area, ctx, hitmap)`

Call sites to update: `screens/thread/mod.rs:1713` (conversation), the legacy-run branch around
`mod.rs:1240`, and the transcript tests/benches
(`transcript.rs` tests, `benches/transcript.rs`, `benches/thread_frame.rs`,
`mod.rs::live_thread_frame_at_twelve_thousand_events_stays_under_eight_ms`). Build them as
`FrameCtx { theme: &theme, tick: app.animation_tick, now_epoch: app.now_epoch }`; in tests and
benches use a fixed `tick: 0, now_epoch: 0` so snapshots stay deterministic.

**3.3 Invariant to enforce with a test.** Add to `transcript.rs` tests:

```rust
#[test]
fn animation_never_changes_item_heights() {
    // Render the same fixture at ticks 0..24 and assert total_height is identical.
}
```

### Acceptance

- `cargo build` clean; every existing snapshot byte-identical (tick 0 must reproduce today's
  spinner frame `⠋`, which it does: `FRAMES[0]`).
- The new invariant test passes.

### Verify

```
cargo test -p coducktor-tui --lib widgets::transcript
cargo test -p coducktor-tui --lib widgets::spinner
```

---

## 8. Phase 4 — Rebuild the tool card

### Files

- `crates/coducktor-tui/src/widgets/transcript.rs`
- `crates/coducktor-tui/src/widgets/tool_card.rs` (new — move the tool rendering out of
  `transcript.rs`, which is already 1,518 lines)

### Change

**4.1 Extend `ToolItem`** with three presentation-relevant fields (populated in Phase 8; default
to `None`/`false` until then so this phase is independently shippable):

```rust
pub struct ToolItem {
    // … existing …
    /// Wall time from `tool-call.ts` to `tool-result.ts`, in milliseconds.
    pub duration_ms: Option<u64>,
    /// Epoch seconds when the call started; used to show live elapsed while running.
    pub started_epoch: Option<i64>,
    /// Raw tool arguments, retained for the per-tool body renderers (Phase 6).
    pub input: Option<serde_json::Value>,
}
```

`reuse_tool` in `screens/thread/mod.rs:881` must compare and copy these too. Update
`ToolItem::revision()` in `transcript.rs:86-105` to fold in `duration_ms.is_some()` and
`input.as_ref().map(|v| v.to_string().len())` — **not** `started_epoch` (it is time-varying and
would invalidate the cache every second).

**4.2 `tool_card.rs` public surface:**

```rust
/// Row budget the transcript grants this card. `Full` is the ordinary case.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum ToolTier {
    Full,
    Folded,   // 2 rows
    Summary,  // 1 row
    Hidden,   // 0 rows
}

/// Build the card model. Pure; no terminal access. Called by both `height` and `paint`, so the
/// two can never disagree.
pub fn build_card<'a>(item: &'a ToolItem, width: u16, ctx: FrameCtx<'_>) -> Card<'a>;

pub fn card_height(item: &ToolItem, width: u16, tier: ToolTier) -> u16;

pub fn paint(item: &ToolItem, buf: &mut Buffer, area: Rect, ctx: FrameCtx<'_>, tier: ToolTier);
```

**4.3 Header composition** (§2.2). In order:

1. **Icon** — when `status == Running | Pending`, `spinner::status_frame(ctx.tick)` in
   `theme.palette.running`; otherwise `glyphs::tool_icon(item.tool_kind)` colored by the existing
   `verb_color` match from `paint_tool_card:451-459` (keep that mapping verbatim).
2. **Title** — `item.title`, bold, in `theme.palette.fg`. Keep the existing verb/argument split so
   the leading verb keeps its kind color.
3. **Subtitle** — `": " + subtitle` in `soft_fg`, only when present.
4. **Badge** — `⟦failed⟧` in `failed`, `⟦declined⟧` in `soft_fg`. Nothing for Running (the spinner
   already says it) or Completed (the border already says it).

**4.4 Meta chips** (right side of the top border, dim, ` · ` joined), in this order, each omitted
when absent:

- elapsed: `format_ms(duration_ms)` when finished; `short_age(started_epoch, ctx.now_epoch)` while
  running. Reuse `screens::runs_util::short_age`. Format finished durations as
  `340ms` / `2.4s` / `1m12s`.
- exit code: `exit 1` in `failed` when `exit_code` is `Some(non-zero)`; `exit 0` is **not** shown
  (a green border already communicates success).
- output size: `12 lines` when the body is clamped.

**4.5 Sections.**

- Section 1 (unlabelled): the **call** body — per-tool in Phase 6; until then, a single dim
  `└─ <compact args>` row derived from `input` when collapsed (mirrors §2.6 default renderer),
  or nothing when `input` is `None`.
- Section 2, label `Error`: `item.error`, wrapped, in `failed`. Only when non-empty.
- Section 3, label `Output`: `item.output`. Only when non-empty **and** the card is open.

**4.6 Output clamping changes.** Replace the current head-clamp with a **tail**-clamp, matching
OMP: the useful part of a command's output is its end. Show the last `OUTPUT_CLAMP_LINES` lines
with a leading dim row:

```
… (37 earlier lines, showing 12 of 49) (za to expand)
```

Keep `OUTPUT_CLAMP_LINES = 12` for collapsed, and add `OUTPUT_EXPANDED_LINES = 200` as a hard cap
for expanded cards so a 50k-line log cannot blow the height cache. When expanded output is capped,
the leading row says `(showing last 200 of N)`.

**4.7 State mapping** `ToolStatus` → `CardState`:

| ToolStatus | CardState |
| --- | --- |
| `Pending` | `Pending` |
| `Running` | `Running` |
| `Completed` | `Success` |
| `Failed` | `Error` |
| `Declined` | `Warning` |

**4.8 Wire into `TranscriptItem`.** `TranscriptItem::height` calls
`tool_card::card_height(item, content_width, ToolTier::Full)`; `paint` calls `tool_card::paint`.
Delete `paint_tool_card` and `tool_card_height` from `transcript.rs`. Keep the gutter marker
(`▾`/`▸`) — it is the click affordance registered by `render_inner`'s hitmap — so the card
occupies `width - ITEM_GUTTER_WIDTH`.

### Acceptance

- Running bash tool renders as a bordered accent-bordered card with an animating braille icon in
  its header and a live `4s` chip.
- A failed tool renders with the error border, error tint, an `Error` section, and an `exit 1`
  chip.
- A completed tool renders with the quiet border and surface tint, no status word.
- Card height equals rows painted at widths 40/80/120/200 (property test).

### Verify

```
cargo test -p coducktor-tui --lib widgets::tool_card
cargo test -p coducktor-tui --lib widgets::transcript
cargo insta review          # transcript_{collapsed,expanded}_* and transcript_mixed_* will churn
```

Snapshots that **will** churn and must be reviewed, not accepted blindly:

```
crates/coducktor-tui/src/widgets/snapshots/coducktor_tui__widgets__transcript__tests__transcript_collapsed_{80x24,120x40,200x60}.snap
crates/coducktor-tui/src/widgets/snapshots/coducktor_tui__widgets__transcript__tests__transcript_expanded_{80x24,120x40,200x60}.snap
crates/coducktor-tui/src/widgets/snapshots/coducktor_tui__widgets__transcript__tests__transcript_mixed_{dark,lakes}.snap
```

`crates/coducktor-tui/src/snapshots/coducktor_tui__app__tests__tasks_*.snap` should **not** change;
if it does, the thread screen chrome moved and that is a bug in this phase.

---

## 9. Phase 5 — Progressive collapse under vertical pressure

### Files

- `crates/coducktor-tui/src/widgets/transcript.rs`

### Change

Today, when the live tail is taller than the viewport, the transcript simply scrolls and the
newest card can be half-visible or off-screen. OMP instead compresses the live tail (§2.3).

**5.1 Add a tail budget to `Transcript`:**

```rust
impl Transcript {
    /// Rows the trailing live cards may occupy before they start folding. Set by the thread
    /// screen from the transcript viewport height each frame.
    pub fn set_pressure(&mut self, viewport_height: u16);
}
```

**5.2 Tier selection**, computed at the top of `render_inner` *after* `total_height`:

```
let overflow = total.saturating_sub(viewport);
if overflow == 0 { every item is ToolTier::Full }
```

Otherwise walk the items from the end, and for each `TranscriptItem::Tool` whose status is
`Running` or `Pending`:

1. try `Folded` (2 rows) — recompute total; if it now fits, stop;
2. else try `Summary` (1 row) — recompute; if it fits, stop;
3. else `Hidden` (0 rows) and continue to the next-newest live card.

Never compress a **finished** card: those are history and scroll away naturally. Never compress
more than the trailing 8 items — beyond that, scrolling is the right answer and the walk must
terminate cheaply.

**5.3 Cache discipline.** Tiered heights **must not** enter `HeightCache`, whose key has no tier
component. Store the computed tiers in a small `Vec<(usize, ToolTier)>` on `Transcript`, rebuilt
each frame, and have `total_height`/`render_inner` consult it:

```rust
fn item_height(&mut self, index: usize, width: u16) -> u16 {
    match self.tier_for(index) {
        None | Some(ToolTier::Full) => self.height_cache.get(index, &mut self.items, width),
        Some(tier) => tier.rows(),   // 2, 1, or 0 — constant, no cache needed
    }
}
```

Because non-`Full` tiers have constant height, the second and third passes of 5.2 are O(compressed
items), not O(all items). Compute `total` once, then adjust by the delta of each demotion.

**5.4 An aggregate row.** When one or more cards are `Hidden`, render a single dim row in their
place: `⋯ N more running`. This mirrors OMP's `N more transcript blocks active`. It counts as one
row in the budget.

### Acceptance

- With three running tool cards and a 10-row viewport, the composer never moves and the newest
  card is always at least one row visible.
- A test renders 3 running cards into an 8-row buffer and asserts the tier sequence is
  `[Summary, Folded, Full]` (oldest → newest: the newest keeps the most room).
- With no overflow, tiers are all `Full` and rendering is byte-identical to Phase 4.

### Verify

```
cargo test -p coducktor-tui --lib widgets::transcript::tests::pressure
cargo test -p coducktor-tui --bench thread_frame
```

---

## 10. Phase 6 — Per-tool bodies

### Files

- `crates/coducktor-tui/src/widgets/tool_card.rs`
- `crates/coducktor-tui/src/widgets/tool_bodies/{mod.rs,bash.rs,read.rs,edit.rs,search.rs,task.rs,plan.rs}` (new)

### Change

One dispatch point, keyed on `ToolKind` first and the raw tool `name` second:

```rust
/// The call-section body for a tool, or `None` to fall back to the generic `└─ args` row.
pub fn call_body<'a>(item: &'a ToolItem, width: u16, ctx: FrameCtx<'_>) -> Option<Vec<Line<'a>>>;
/// An optional override for the result section's label and rows.
pub fn result_body<'a>(item: &'a ToolItem, width: u16, ctx: FrameCtx<'_>)
    -> Option<(Span<'a>, Vec<Line<'a>>)>;
```

Every body renderer is a pure function, returns owned `Line`s, and must never panic on malformed
JSON — read fields with `Value::get(..).and_then(Value::as_str)` and fall back.

**6.1 Execute / bash** (`tool_bodies/bash.rs`)

Call body: one row `$ ` (dim) + `cd <cwd> && ` (dim, only when `input.cwd` differs from the
conversation cwd) + the command. Highlight the command with `crate::diff::Highlighter` using the
`bash` language if the highlighter supports it; otherwise plain `fg`. Wrap onto continuation rows
with a two-space hanging indent.

Result section label: `Output`. Footer chip row, dim, at the end of the output:
`[Wall: 2.37s | Exit: 1]` — include `Wall` only when `duration_ms` is known and `Exit` only when
non-zero.

**6.2 Read** (`tool_bodies/read.rs`)

No call body — the header already reads `Read src/foo.rs`. Instead append the line range to the
header meta when `input` carries `offset`/`limit`: `L120–L260`. Collapse the *result* to a single
dim row `N lines · M KB` instead of dumping file contents; the raw contents are still shown when
the user expands the card.

**6.3 Edit / Write** (`tool_bodies/edit.rs`)

The highest-value card. Derive a diff from arguments — available on every backend today:

- `edit`: `input.file_path` + `input.old_string` + `input.new_string`
- `multiEdit`: `input.edits[]` of the same shape
- `write`: `input.file_path` + `input.content` (all-added)
- Codex `fileChange`: `input.changes` — a map of path → `{ add | update | delete }`

Build a unified hunk with `crate::diff::parse_patch` where a patch already exists; otherwise
line-diff `old_string` vs `new_string` directly and reuse `crate::diff::word_diff` for the
intra-line highlight. Render at most 12 changed rows plus 2 rows of context each side, using the
existing `add`/`del` palette colors and the `+`/`-`/` ` prefixes already used by
`diff/render.rs`. Header meta gains `+A −B`.

Do **not** re-implement diff rendering. If `diff::render_files` cannot be called with a synthetic
in-memory file pair, add a narrow constructor to `diff/render.rs` rather than duplicating the
row-layout logic.

**6.4 Search** (`tool_bodies/search.rs`)

Call body: `pattern` in `review` color, then `in <path>` dim. Result: group hits by file and show
`path:line` rows, at most 8, then `… N more matches`.

**6.5 Task / subagent** (`tool_bodies/task.rs`)

Call body: `subagent_type` badge + the first 2 lines of the prompt, dim, italic. While running,
prefix each with `glyphs().tree_last`.

**6.6 Plan / todo** (`tool_bodies/plan.rs`)

Render the todo list as checkbox rows: `☑` done in `done`, `▸` in-progress in `running` (bold),
`☐` pending in `soft_fg`. This replaces the current `Plan 3/7 complete` note in
`build_transcript_items` (`mod.rs:783-793`) — delete that note and emit a `TranscriptItem::Tool`
body instead, or keep the note and add the checkbox rows to the tool card, whichever the plan
entries are actually available on. Prefer the tool card.

### Acceptance

- A bash card shows the highlighted command line and a `[Wall: … | Exit: …]` footer.
- An edit card shows a colored `+`/`-` diff derived purely from tool arguments, on Claude,
  Codex, OpenCode, and pi transcripts.
- A malformed/absent `input` renders the generic `└─ args` row and never panics.

### Verify

```
cargo test -p coducktor-tui --lib widgets::tool_bodies
cargo test -p coducktor-runners --test golden      # unchanged; proves nothing regressed upstream
```

Add one fixture-driven test per body: build a `ToolItem` from the JSON shapes in
`fixtures/claude/thinking-edit-write-todo.ndjson`, `fixtures/codex/command-lifecycle.ndjson`, and
`fixtures/opencode/tool-lifecycle.ndjson`, and snapshot the rendered card at 100 columns.

---

## 11. Phase 7 — Assistant text, thinking, and the activity line

### Files

- `crates/coducktor-tui/src/widgets/transcript.rs`
- `crates/coducktor-tui/src/markdown.rs`
- `crates/coducktor-tui/src/screens/thread/mod.rs`
- `crates/coducktor-tui/src/screens/thread/widgets.rs`

### Change

**7.1 Thinking presentation.** Replace `paint_reasoning` (`transcript.rs:415`):

- Header row while the reasoning item is the newest and the turn is running:
  `spinner::thinking_frame(ctx.tick)` colored by interpolating `soft_fg → accent` with
  `spinner::pulse(ctx.tick)` (fall back to plain `accent` below `ColorCapability::TrueColor`),
  then ` Thinking`, then ` · <elapsed>` dim.
- Header row otherwise: `glyphs().collapsed/expanded` + ` Thinking` + ` · ` + first line of the
  reasoning text, dim.
- Body when expanded: the existing markdown cache, styled `soft_fg` **plus
  `Modifier::ITALIC`**. This single modifier is most of what makes OMP's thinking read as
  a different voice.

**7.2 Assistant text.** Two contained improvements:

- Fenced code blocks in assistant markdown get syntax highlighting. `tui_markdown` already emits
  code-block lines; post-process the cached `Text` in `RenderCache::refresh`, detecting fence
  language from the source and running `crate::diff::Highlighter` over the block's lines. Cache
  the result — this happens once per source change, not per frame.
- Streaming caret: when the message item is the last item and the turn is running, append a
  `▌` span in `accent` at the end of the rendered text, blinking on `ctx.tick % 12 < 6`. Because
  the caret is appended to the *last existing line* it must not change `height()`; if the last
  line is already at full width, skip the caret.

**7.3 The live activity line.** Promote the one-row dock hint into a real activity line.
In `render_conversation` (`mod.rs:1743-1758`), replace the current hint composition with:

```
<status_frame> <activity> · <elapsed>                         esc to stop
```

where `activity` is, in priority order:

1. `transcript.latest_running_tool_title()` (already exists, `transcript.rs:618`);
2. `view_model.current_status`;
3. `"Working"`.

Right-align the `esc to stop` affordance in `soft_fg`. When the conversation is not
Queued/Running, keep today's `Enter · send` hint, unchanged.

Also simplify the transcript block title (`mod.rs:1690-1698`) now that the activity line carries
the live state: keep ` Session · <tokens> tok · <N> new ` and drop the spinner/status/elapsed from
the title. Two spinners on screen at once is exactly the noise this plan is removing.

**7.4 Adaptive redraw.** `runtime.rs` already sleeps `FRAME_BUDGET - elapsed`. Add OMP's
backpressure rule (§2.4) so a heavy transcript cannot spin the CPU: when the previous
`terminal.draw` took longer than `FRAME_BUDGET / 2`, skip the *animation* tick increment on the
next frame (render still happens on real input/events). One field on `App`:
`last_frame_cost: Duration`, fed from the `frame_micros` already passed to
`App::record_frame_metrics` (`app.rs:1232`).

### Acceptance

- Reasoning renders italic and the header sparkles while the turn runs.
- The activity line shows the running tool's title and stops animating the moment the turn ends.
- The transcript title no longer duplicates the spinner.
- A code fence in an assistant message is syntax-colored.

### Verify

```
cargo test -p coducktor-tui --lib screens::thread
cargo test -p coducktor-tui --lib markdown
cargo test -p coducktor-tui --lib live_thread_frame_at_twelve_thousand_events_stays_under_eight_ms
```

Thread-screen string assertions that will need updating (they assert on the old title/hint text):
`live_activity_line_includes_the_running_tool_and_usage`,
`a_conversation_thread_shows_its_affinity_and_no_removed_control`,
`every_terminal_status_ends_the_run_with_its_own_word` — all in `screens/thread/mod.rs` tests.

---

## 12. Phase 8 — Minimal data plumbing

Everything above works with data the TUI already has. These three changes are cheap and unlock the
duration and exit-code chips. Nothing here touches durable formats: `RunEvent.ts` is already
written on every event, and `exitCode` is already written by OpenCode.

### Files

- `crates/coducktor-tui/src/screens/thread/reducer.rs`
- `crates/coducktor-protocol/src/ui_events.rs`
- `crates/coducktor-runners/src/codex_runner.rs`

### Change

**8.1 Tool timestamps.** Add to `UiToolItem`:

```rust
/// ISO-8601 timestamp of the `tool-call` event, and of its matching `tool-result`.
#[serde(default, skip_serializing_if = "Option::is_none")]
pub started_at: Option<String>,
#[serde(default, skip_serializing_if = "Option::is_none")]
pub finished_at: Option<String>,
```

Both `#[serde(default)]`, so every persisted transcript still deserializes (`BACKWARD_COMPATIBILITY.md`).
In `reducer.rs`, set `started_at: Some(event.ts.clone())` in the `"tool-call"` arm (:412) and
`finished_at: Some(event.ts.clone())` in the matched `"tool-result"` arm (:445-459). Parse to
epoch millis in `reuse_tool` (`mod.rs:881`) to fill `ToolItem::duration_ms` / `started_epoch`.

**8.2 Exit code on the matched path.** `reducer.rs:445-459` currently ignores `extra["exitCode"]`
for a matched tool call — only the orphan branch reads it. Add:

```rust
tool.exit_code = extra.get("exitCode").and_then(Value::as_f64).or(tool.exit_code);
```

This immediately lights up OpenCode's exit codes.

**8.3 Codex exit code lift.** `codex_runner.rs` emits `tool-result.result` as the stringified
whole item, which contains `exitCode`. In the `item/completed` arm (~:665), when the item object
has a numeric `exitCode`, also set it as a top-level `exitCode` field on the emitted
`tool-result` event. One field, additive, no format break.

### Acceptance

- A finished bash card on OpenCode or Codex shows `exit 1` in red when the command failed.
- Every card shows a duration chip.
- Reloading an old transcript (written before this change) still renders — with no duration chip.

### Verify

```
cargo test -p coducktor-runners --test golden
cargo test -p coducktor-tui --lib screens::thread::reducer
cargo test --workspace --all-targets
```

---

## 13. Phase 9 — Keymap, hints, docs

### Files

- `crates/coducktor-tui/default-keymap.toml`
- `crates/coducktor-tui/src/screens/thread/mod.rs`
- `docs/tui/keymap.md`
- `CHANGELOG.md`

### Change

`Ctrl-O` is already the cockpit's "older location" (`docs/tui/keymap.md:21`), so coducktor cannot
copy OMP's expand key. Use the Neovim fold grammar the rest of the app already speaks:

| Key | Action |
| --- | --- |
| `za` | Toggle the selected transcript item (alias of the existing `Enter`) |
| `zR` | Expand every tool and reasoning card in the transcript |
| `zM` | Collapse every tool and reasoning card |

Implement `zR`/`zM` as `Transcript::set_all_expanded(bool)`, which sets `user_expanded` on every
`ToolItem` and `expanded` on every `ReasoningItem`, then clears the height cache.

The expand hint printed inside a clamped card body (Phase 4.6) must render the *configured* key,
not a hardcoded `za` — read it from the keymap the same way other hints do.

Update `docs/tui/keymap.md` with the three fold keys, and note in `docs/tui/screenshots.md` that
transcript cards are the new reference surface. Add a `CHANGELOG.md` entry.

### Acceptance

- `zR` then `zM` round-trips the transcript with no height-cache staleness (scroll position is
  preserved by the existing `top_anchor` logic).
- `docs/tui/keymap.md` lists the fold keys.

---

## 14. Performance contract

The transcript re-paints its visible window every frame; that is unchanged and is what makes
animation free. The risks this plan introduces, and their mitigations:

| Risk | Mitigation | Enforced by |
| --- | --- | --- |
| Card construction allocating per frame for off-screen items | Cards are built only inside `paint`, which only runs for visible items | existing `render_inner` windowing |
| Animation invalidating the height cache | `revision()` excludes `tick` and `started_epoch`; heights are tier-constant for non-`Full` tiers | `animation_never_changes_item_heights` test (Phase 3.3) |
| Diff derivation (Phase 6.3) running per frame | Compute the diff once and memoize it on `ToolItem` behind an `OnceCell<Vec<Line<'static>>>` keyed by input length | unit test asserting the derivation runs once across 30 paints |
| Syntax highlighting per frame | Runs inside `RenderCache::refresh`, i.e. once per source change | `markdown` tests |
| Pressure walk being O(n) per frame | Bounded to the trailing 8 items | Phase 5.2 |

Hard budget, unchanged: **8 ms release / 30 ms debug** for one live frame at 12k events
(`live_thread_frame_at_twelve_thousand_events_stays_under_eight_ms`). Run
`cargo test -p coducktor-tui --bench thread_frame` before and after each of Phases 4, 5, and 6 and
record the `render` numbers in the commit message. A regression greater than 25 % on the 12k case
blocks the phase.

---

## 15. Test plan

Per phase, in addition to the phase's own `Verify` block:

1. **Unit** — every new pure function (`Card::height`, glyph fallback, body renderers, tier
   selection) gets a direct test. Bodies get a malformed-input test.
2. **Height/paint agreement** — a property-style test over widths `[20, 40, 80, 120, 200]` and
   every `TranscriptItem` variant asserting `height(w)` equals the number of rows `paint` writes.
3. **Snapshots** — the three existing transcript snapshot tests are extended, not replaced. Add
   the new fixtures (running bash card, failed card, edit card with diff, todo card) to
   `snapshot_fixture` (`transcript.rs:1402`) so all three widths and both themes cover them.
4. **Terminal reality** — box-drawing, background tints, and italics are terminal-dependent.
   Manually verify in Ghostty, iTerm2, tmux, and Apple Terminal, and record real results in
   `docs/tui/terminals.md`. Headless snapshots are **not** evidence for an interactive terminal
   (`AGENTS.md`). At minimum confirm: rounded corners render, the background tint does not bleed
   past the card, italic reasoning is legible, and the ASCII fallback is exercised with `LANG=C`.

Final gate before each commit:

```
cargo test -p coducktor-client --test manager_lock_discipline
cargo test -p coducktor-tui --lib live_thread_frame_at_twelve_thousand_events_stays_under_eight_ms
cargo test -p coducktor-tui --bench thread_frame
cargo test --workspace --all-targets
cargo clippy --workspace --all-targets -- -D warnings
cargo fmt --all --check
```

---

## 16. Acceptance checklist

The work is done when all of these are true in a real terminal:

- [ ] Every tool call renders as a rounded, status-tinted card with a header in its top border.
- [ ] A running card's header icon animates, in phase with every other running card and with the
      activity line.
- [ ] Finished cards are visually quiet: dim border, surface tint, no status word.
- [ ] Failed cards are unmistakable: error border, error tint, `Error` section, `exit N` chip.
- [ ] Bash cards show the command and a tail-clamped `Output` section with an expand hint.
- [ ] Edit cards show a colored diff derived from the tool's own arguments, on all four backends.
- [ ] Reasoning is italic and its header sparkles while the model thinks.
- [ ] One activity line above the composer shows the current tool, elapsed time, and `esc to stop`;
      the transcript title no longer duplicates it.
- [ ] Three simultaneous running cards in a 10-row viewport fold instead of pushing the composer.
- [ ] `LANG=C` produces a readable ASCII transcript with identical row counts.
- [ ] A 16-color terminal produces a readable, tint-free transcript.
- [ ] The 12k-event frame test passes and `thread_frame` has not regressed more than 25 %.
- [ ] `docs/tui/keymap.md`, `docs/tui/terminals.md`, and `CHANGELOG.md` are updated.

---

## 17. Deliberately out of scope

These are real gaps, but they are data-plumbing projects, not UI polish, and each deserves its own
specification:

- **Wiring the v2 mappers.** `map_claude_message`, `map_codex_notification`, `map_opencode_event`,
  and `map_pi_rpc_message` already produce `diffs[]`, `locations[]`, `parent_item_id`,
  `stopReason`, structured `TokenUsage`, `contextWindow`, and `MessagePhase`, and are golden-tested
  against `fixtures/`, but no runner calls them. Doing so would replace Phase 6.3's argument-derived
  diff with a real one and enable subagent nesting (`widgets.rs::render_child_line` already exists
  and is never fed).
- **Streaming tool output.** The reducer supports `item.delta` with `field: "output"`; no runner
  emits it. Codex explicitly discards `item/commandExecution/outputDelta`.
- **Context-window meter.** `TokenUsage.context_window` exists in the type and in Codex fixtures;
  no live event carries it.
- **`UiBackend::Omp`.** `omp_runner.rs` exists; the enum has no variant for it.
- **Inline images in cards, sixel/kitty budgets, and a theme file format.**
