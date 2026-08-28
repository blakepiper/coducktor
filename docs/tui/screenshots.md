# TUI visual references

The committed `insta` snapshots under `crates/coducktor-tui/src/screens/**/snapshots/` are the
source of truth for rendered cockpit frames. They cover 80×24, 120×40, and 200×60 layouts for New
Chat, Chats, chat timelines, GitHub, Settings, and the remaining supporting screens.

Review changed snapshots explicitly with `cargo insta review`; do not accept them as a batch
without checking that:

- New Chat exposes only Message, Harness, Model, Reasoning, Skills, Base branch, Worktree, and Git
  mode;
- Chats and All Chats use Needs you, Working, Recent, and Archived groupings;
- chat timelines use shared framed status cards, semantic tool bodies, reasoning activity, and
  readable folded-output hints without clipping at each reference size;
- active conversations retain their draft while Send is disabled;
- current screens contain no workflow, variant, compare, review, finish, continue, task-mode, or
  provider-routing controls; and
- narrow layouts remain keyboard- and mouse-reachable.

Static copies of rendered frames are intentionally not duplicated here because they drift from
the executable snapshots. Real terminal behavior and harness runs are recorded in
[`terminals.md`](terminals.md).
