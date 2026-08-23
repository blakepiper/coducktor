# Agent harness protocol

Coducktor is a conversation manager around native coding-agent harnesses. The boundary is one
ordinary user submission to one native provider turn. Coducktor owns durable chat state,
admission, cancellation, working-directory placement, bounded event delivery, and presentation;
the selected harness owns its model loop, tools, delegation, context management, and decision to
end the turn.

## Turn request

The backend-neutral conversation request carries:

- exact user-authored text and any supported image attachments;
- a concrete harness, optional model, and optional provider-native reasoning value;
- bounded, explicitly delimited skill context for that message;
- the conversation working directory and autonomous permission policy; and
- a native provider session ID when resuming.

Omitting model or reasoning means the harness default. Coducktor does not add completion markers,
continuation prompts, plan handoffs, review prompts, context-refresh prompts, or model-written Git
requests. Skill context augments the provider request but never changes the durable user message.

## Native mappings

- **Claude Code** uses streaming JSON for the first turn and its native resume form for later
  turns. Autonomous non-interactive execution is requested explicitly.
- **Codex** uses app-server JSON-RPC. A conversation maps to one Codex thread; each user message
  starts one turn on that thread.
- **OpenCode** uses its JSON event stream and resumes by native session identifier. Autonomous
  execution is explicit.
- **pi** uses its RPC mode; each message is one native prompt on the retained or resumed session.

Provider command lines and wire types remain private to `coducktor-runners`. They are translated
to the small normalized event vocabulary before reaching core or the UI.

## Events and outcomes

The normalized stream preserves assistant text, compact reasoning/activity when exposed, tool
lifecycle, structured questions, errors, usage, provider session identity, and native turn end.
Unknown or malformed provider frames degrade to bounded diagnostics; they do not become synthetic
user turns.

A native turn ends as `ended`, `failed`, or `cancelled`. Coducktor does not inspect prose,
question marks, markers, token-limit wording, or plan state to decide whether to send again. Empty
or question-shaped final text still ends the ordinary turn.

Only a provider-native structured question may suspend a turn. It carries a stable request ID and
a bounded answer shape; the user's answer is delivered through the exact pending provider
response path. An ordinary question in assistant prose ends the turn and is answered with the
next ordinary user message. Permission approval requests are not a portable conversation feature:
an unexpected one fails closed and visibly.

## Sessions and recovery

The provider session ID belongs to the durable conversation. A live session may be parked between
turns; after process or application restart Coducktor asks the same harness to resume that native
session without replaying the transcript. If native resume cannot be re-established, the turn
fails and recovery requires an explicit user action.

An admitted message is persisted before provider I/O. Startup never silently resends a queued or
running message. A structured request that existed only in a dead process is recorded as
interrupted rather than fabricated after restart.

## Concurrency and process safety

Conversation admission is bounded globally. Managed worktrees isolate concurrent chats; in-place
turns sharing a repository root are serialized. No manager lock is held while opening a session,
calling a provider turn, waiting for a child, or running Git. Cancellation is bounded and reaps
the provider process. Agent stdout and stderr are captured, never inherited by the cockpit
terminal.

Missing executables, credentials, network access, catalogs, or optional writable state fail only
the selected capability or turn. They must not prevent the cockpit or unrelated projects from
opening.

## Compatibility boundary

Legacy task, workflow, variant, marker, and task-branch records remain readable through
compatibility readers. They may be inspected, archived, deleted, and used by existing Git views,
but they never enter the conversation runtime. New writers emit only conversation-first state and
the current marker and branch spellings.
