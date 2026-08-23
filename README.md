# Coducktor

Coducktor is a local terminal cockpit for durable coding-agent conversations. It wraps Claude
Code, Codex, OpenCode, and pi in one Rust binary, keeps chats scoped to their repository, and
leaves the selected harness in charge of its own agent loop.

One submitted message always means one native harness turn. The harness may reason, call tools,
delegate, edit, and test for as long as that turn needs; when it returns, Coducktor records the
result and waits for the next user message. Coducktor does not route between providers, retry by
prompting the model, or run a workflow behind the conversation.

## Install and start

Requirements are Rust and at least one supported agent CLI. Git is optional for in-place chats;
`gh` is optional for the GitHub screen.

```sh
cargo install --path crates/coducktor-tui
coducktor projects add --repo .
coducktor
```

The installed binary is `coducktor`; `duck` is its short alias. During development:

```sh
cargo run -p coducktor-tui --
```

Startup discovers the current repository, registered projects, local skills, Git, agent CLIs,
and provider health. A missing optional CLI, credential, network connection, Git checkout, or
writable optional state reduces only the affected capability.

## The conversation loop

Open **New chat**, write the exact message you want to send, and choose:

- a concrete harness: Claude, Codex, OpenCode, or pi;
- the harness default or a discovered model and reasoning value;
- zero or more local skills for this message;
- a base branch and managed-worktree policy when Git is available; and
- manual or automatic Git handling.

Harness, model, reasoning, base branch, and working directory are fixed after the conversation
starts. Skills are per-message attachments and clear after a successful send. Git mode can change
while the chat is idle.

Coducktor preserves an editable draft while a turn is active, but Send remains disabled until the
turn ends. `Esc` cancels a live turn without discarding that draft. Ordinary questions in
assistant prose end the turn normally; only a provider-native structured question enters
**Needs you** and continues the same pending turn when answered.

The **Chats** and **All chats** views group current conversations into Needs you, Working, and
Recent. A conversation is closed only when you archive it. Historical task records from older
versions remain readable, archivable, deletable, and available to the Git inspection views, but
cannot be executed by the conversation runtime.

## Harnesses

| Harness | Executable | Native transport |
| --- | --- | --- |
| Claude Code | `claude` | streaming JSON first turn, native session resume |
| Codex | `codex` | app-server JSON-RPC thread and turn calls |
| OpenCode | `opencode` | JSON event stream with native session resume |
| pi | `pi` | RPC session with native prompt and resume |

The harness runs autonomously according to its normal non-interactive contract. Provider-specific
session IDs are stored with the chat so later messages, including messages after a Coducktor
restart, resume native context without transcript replay. An unexpected permission request fails
that turn clearly; Coducktor does not emulate a harness approval interface.

If a harness refuses to resume its own session, the chat offers **Restart session**. It asks for
confirmation, abandons the old session, and prepares a bounded excerpt of the chat's visible
messages — nothing is sent until you send your next message, which carries that excerpt into the
new session. It is the only place Coducktor ever replays a transcript, it never happens on its
own, and it costs no extra provider turn.

Skills are discovered from local Coducktor and harness skill directories. Attachments are bounded
and delimited before the exact user-authored message; the transcript always shows the original
message. `coducktor init` creates an example skill under `.ai/coducktor/skills/`.

## Git behavior

Managed worktrees are the recommended default for Git repositories and allow conversations to run
without sharing a checkout. In-place chats are serialized per repository root and cannot silently
switch the user's checked-out branch.

Manual Git mode never commits or pushes at turn end. Auto mode requires a managed worktree and,
after a successful turn, uses deterministic local Git commands to commit and push changed work.
It never asks a model to review changes or write a commit message. A failed or cancelled turn
leaves changes available for manual inspection.

A live chat's worktree is never reclaimed. Archiving a chat makes its checkout eligible, and the
worktree panel's reclaim action takes back the directory while keeping the transcript and the
managed branch — a checkout with uncommitted changes is always skipped. Unarchiving rebuilds the
checkout from that branch before the composer reopens; if it cannot be rebuilt the chat stays
archived and readable rather than running its next turn somewhere else.

## CLI

Running `coducktor` or `coducktor tui` opens the cockpit. The non-interactive commands never open
an alternate screen or start a Coducktor service:

```text
coducktor run [OPTIONS] [MESSAGE]...  Run one conversation turn
coducktor init                        Scaffold an example local skill
coducktor doctor [--json]             Check local capabilities
coducktor usage [--json] [--refresh]  Show sanitized provider quota telemetry
coducktor repair-runs                 Back up and repair quarantined run state
coducktor projects [list|add|remove]  Manage the project registry
```

Headless `run` accepts `--runner`, `--model`, `--reasoning`, repeatable `--skill`, `--branch`,
`--worktree true|false`, `--git-mode manual|auto`, and `--repo`. It creates a conversation,
submits exactly one message, and prints normalized assistant and activity output.

```sh
duck run --runner codex --reasoning high --worktree false --git-mode manual \
  'Explain the failing test and fix it.'
```

Use `coducktor <command> --help` for the complete generated interface.

## State and configuration

Repository state is stored under `.ai/coducktor/`; per-user registry, preferences, and usage state
live under `~/.coducktor/`. Durable state is JSON, NDJSON, Markdown, and YAML—there is no database.
Startup migrations are ordered, additive, idempotent, and non-blocking. Unknown JSON keys and
valid siblings survive read-modify-write; a corrupt file stays in place after one warning while
the application boots with defaults.

Coducktor never loads `.env` automatically. Optional environment overrides use the `DUCK_*`
namespace and are documented in [`.env.example`](.env.example). Project and global defaults are
also editable in Settings; current chat defaults cover concrete harnesses, provider models,
worktree mode, Git mode, parallel-chat capacity, and worktree retention.

## Scope and architecture

The shipped product is one local terminal binary with an in-process engine. It has no Coducktor
service child, listening socket, browser cockpit, npm workspace, hosted deployment, or remote
session surface. Agent output is captured and normalized; child stdout and stderr are never
inherited by the user's terminal.

Screens depend on the client `Engine` trait. Durable conversation and Git behavior live in core;
provider-native details stop at the runner seam. See [AGENT_PROTOCOL.md](AGENT_PROTOCOL.md) for
that boundary and [docs/tui/keymap.md](docs/tui/keymap.md) for cockpit navigation.

The repository gate is:

```sh
cargo test --workspace --all-targets
cargo clippy --workspace --all-targets -- -D warnings
cargo fmt --all --check
cargo tree --workspace
```
