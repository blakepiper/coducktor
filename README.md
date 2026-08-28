# Coducktor

Coducktor is a local terminal cockpit for durable coding-agent conversations. It wraps Claude
Code, Codex, OpenCode, and pi in one Rust binary, keeps chats scoped to their repository, and
leaves the selected harness in charge of its own agent loop.

One submitted message means one native harness turn. The harness reasons, calls tools, delegates,
edits, and tests for as long as that turn needs. When it returns, Coducktor records the result and
waits for the next message. Coducktor does not route between providers, retry by re-prompting the
model, or run a workflow behind the conversation.

## Install and start

You need Rust and at least one supported agent CLI. Git is optional for in-place chats; `gh` is
optional for the GitHub screen.

The installer script checks for `rustup` and builds both binaries with `--locked`:

```sh
git clone https://github.com/blakepiper/coducktor.git
cd coducktor
./install.sh
coducktor projects add --repo .
coducktor
```

A plain Cargo install works too:

```sh
cargo install --path crates/coducktor-tui
```

Either way, the installed binary is `coducktor`; `duck` is its short alias. During development,
run it straight from the checkout instead of installing it:

```sh
cargo run -p coducktor-tui --
```

Startup discovers the current repository, registered projects, local skills, Git, agent CLIs, and
provider health. A missing optional CLI, credential, network connection, Git checkout, or
writable optional state only narrows the affected capability; it never blocks startup.

## The conversation loop

Open **New chat**, write the exact message you want to send, and choose:

- a concrete harness: Claude, Codex, OpenCode, or pi;
- the harness default or a discovered model and reasoning value;
- zero or more local skills for this message;
- a base branch and managed-worktree policy when Git is available; and
- manual or automatic Git handling.

Harness, model, reasoning, base branch, and working directory lock in once the conversation
starts. Skills are per-message attachments and clear after a successful send. Git mode can still
change while the chat is idle.

Coducktor keeps an editable draft while a turn runs, but Send stays disabled until the turn ends.
`Esc` leaves composer input mode without touching the live turn; use `Ctrl-C`, the **Cancel**
header action, or `:stop` to stop the agent. Ordinary questions in assistant prose end the turn
normally; only a provider-native structured question opens **Needs you** and continues the same
pending turn once you answer it.

The **Chats** and **All chats** views group conversations into Needs you, Working, and Recent. A
conversation closes only when you archive it. Task records from older versions of Coducktor stay
readable, archivable, deletable, and visible to the Git inspection views, but the conversation
runtime can no longer execute them.

## Harnesses

| Harness | Executable | Native transport |
| --- | --- | --- |
| Claude Code | `claude` | streaming JSON first turn, native session resume |
| Codex | `codex` | app-server JSON-RPC thread and turn calls |
| OpenCode | `opencode` | JSON event stream with native session resume |
| pi | `pi` | RPC session with native prompt and resume |
| oh-my-pi | `omp` | RPC session with native prompt and resume |

The harness runs autonomously under its normal non-interactive contract. Provider-specific
session IDs are stored with the chat, so later messages, including messages sent after a
Coducktor restart, resume native context without replaying the transcript. An unexpected
permission request fails that turn clearly; Coducktor does not emulate a harness approval
interface.

If a harness refuses to resume its own session, the chat offers **Restart session**. It confirms
first, abandons the old session, and prepares a bounded excerpt of the chat's visible messages.
Nothing is sent until you send your next message, and that excerpt rides along with it. This is
the only place Coducktor ever replays a transcript, it never happens on its own, and it costs no
extra provider turn.

Skills are discovered from local Coducktor and harness skill directories. Attachments are bounded
and delimited before the exact user-authored message, and the transcript always shows the
original message. `coducktor init` creates an example skill under `.ai/coducktor/skills/`.

## Other screens

The sidebar also holds **Repo git** (Commits, Changes, and Branches over the main working tree),
**GitHub** (issues and pull requests, with markdown detail, comments, check status, a diff view
on PRs, and a hand-to-agent action that opens a new chat from the item), **IDE** (a small file
browser and editor with syntax highlighting, `Ctrl+S` to save, and `Ctrl+E` to hand the file to
`$EDITOR` instead), **Terminal** (a real shell in an embedded PTY, plus an "Open in Terminal"
action for launching your desktop's own terminal emulator), **Scratchpad** (a per-project note
pad stored outside Git, under your Coducktor home), and **Skills**.
From **Skills**, press `n` or choose **New skill** to name a project skill and write its generated
template in the built-in IDE.

The GitHub and Repo git screens degrade field by field when `gh` is missing or the repo isn't a
Git checkout, rather than failing outright.

Navigation uses a small Neovim-style modal grammar: `hjkl` and `gg`/`G` to move, `:` for Ex
commands, `Ctrl-W` for window focus. See [docs/tui/keymap.md](docs/tui/keymap.md) for the full
reference. Every visible control is also mouse-operable.

## Git behavior

Managed worktrees are the recommended default for Git repositories and let conversations run
without sharing a checkout. In-place chats are serialized per repository root and cannot silently
switch the branch you have checked out.

Manual Git mode never commits or pushes at turn end. Auto mode works with or without a managed
worktree: after a successful turn, deterministic local Git commands commit and push changed work in
the conversation's worktree, or in the repository's current checkout when the chat runs in place.
It never asks a model to review changes or write a commit message. A failed or cancelled turn
leaves changes available for manual inspection.

A live chat's worktree is never reclaimed. Archiving a chat makes its checkout eligible, and the
worktree panel's reclaim action takes back the directory while keeping the transcript and the
managed branch; a checkout with uncommitted changes is always skipped. Unarchiving rebuilds the
checkout from that branch before the composer reopens. If it can't be rebuilt, the chat stays
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

Run `coducktor <command> --help` for the full generated interface.

## State and configuration

Repository state lives under `.ai/coducktor/`; per-user registry, preferences, and usage state
live under `~/.coducktor/`. Durable state is JSON, NDJSON, Markdown, and YAML: there is no
database. Startup migrations are ordered, additive, idempotent, and non-blocking. Unknown JSON
keys and valid siblings survive read-modify-write; a corrupt file stays in place after one warning
while the application boots with defaults.

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
