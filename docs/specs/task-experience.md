# Chat experience

Status: current product summary (2026-08-23). The authoritative implementation contract is the
[conversation-first harness cockpit](conversation-first-harness-cockpit.md).

## Chat browser

Project Chats and workspace All Chats use the same card language. Current chats are grouped by
their projected conversation state:

- **Needs you**: a native structured question, or an unseen failed/cancelled turn;
- **Working**: queued or running; and
- **Recent**: idle chats and seen failures/cancellations.

Archived contains only explicitly archived conversations. Provider prose never marks a chat done
or archived. Cards preserve project-qualified identity, unread state, exact prompt previews, and
meaningful activity timestamps. Search and filters are independent between project Chats and All
Chats.

Legacy task records remain visible as read-only history with their historical states and metadata.
They can be archived or deleted, but cannot be resumed, finished, continued, reviewed, compared,
or sent through the conversation runtime.

## New Chat

The focus order is Message, Harness, Model, Reasoning, Skills, Base branch, Worktree, and Git mode.
Harness is always a concrete Claude, Codex, OpenCode, or pi selection. Model and reasoning each
offer Default when catalog discovery is absent. Skills attach additively to the current message.

Harness, model, reasoning, base branch, and working directory become immutable when the chat
starts. Git auto requires a managed worktree. Without Git, branch/worktree controls are disabled;
with worktree off, the harness uses the repository's current checkout without switching it.

## Conversation timeline

The timeline presents exact user messages, assistant text, compact harness activity, native
structured questions, errors, usage, and turn boundaries. Completed tool activity collapses by
default; unknown events degrade to a bounded generic activity row. The view follows live output
only while the user remains at the bottom.

An idle composer sends one ordinary user message as one native provider turn. While queued or
running, the user may edit and retain a draft but cannot submit it. `Esc` leaves Insert mode;
`Ctrl-C`, the Cancel header action, or `:stop` stops the active turn without discarding the draft.
After ended, failed, or cancelled, the composer is available again.

Only a provider-native structured question creates Needs you controls. Answering it continues the
same pending turn. A question in ordinary assistant prose ends normally and the user's reply is a
new turn.

Changes, Files, Commits, GitHub references, archive/delete, and read/unread behavior remain
available. There are no workflow, variant, compare, review, finish, continue, task-mode,
provider-routing, or native-harness takeover controls for current chats.
