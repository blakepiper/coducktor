# Conversation-first harness cockpit — implementation specification

Status: implemented (2026-08-23)

Audience: the implementation agent. Work directly on `main`, preserve unrelated worktree changes,
commit completed phases, and push `origin main` as required by `AGENTS.md`.

This specification is the current product contract and replaces the workflow-oriented product
model for newly created work. Existing
task and workflow records remain readable historical data until their compatibility readers can be
removed under a separate migration policy. Where this document conflicts with the current
`task-experience.md`, `intelligent-auto-routing.md`, or agent lifecycle sections of
`AGENT_PROTOCOL.md`, this document is the new target behavior.

## 1. Decision

Coducktor becomes a project-scoped conversation manager for four locally installed coding-agent
harnesses: Claude Code, Codex, OpenCode, and pi.

Coducktor owns:

- registered projects and project selection;
- durable conversation and transcript history;
- the composer and its exact user-authored messages;
- explicit harness, model, reasoning, and skill selection;
- branch and worktree placement;
- Git auto/manual policy and the existing Git inspection surfaces;
- process admission, cancellation, crash recovery, and bounded live event delivery; and
- a small normalized presentation boundary for assistant text, activity, questions, errors, and
  usage.

The selected harness owns:

- the model's agent loop within one user turn;
- reasoning, tool selection, tool execution, delegation, editing, and verification;
- its native context management and compaction;
- when that turn has finished; and
- its provider-native session history and resume token.

Coducktor sends exactly one provider turn for each ordinary user submission. It never sends an
automatic `continue`, completion-marker repair, workflow transition, plan checkpoint handoff,
monitoring wake, quota failover prompt, synthetic commit-message prompt, or context-refresh
prompt. A harness may perform arbitrarily many tool calls before returning from that one turn.
Once it returns, Coducktor records the outcome and waits for the user.

This is a deliberately smaller product. It is not an autonomous workflow orchestrator, a harness
UI emulator, or a provider router.

## 2. User promise

The primary loop is literal and testable:

1. The user opens a project and creates a conversation.
2. The user chooses Claude, Codex, OpenCode, or pi; a model or harness default; a supported
   reasoning setting or harness default; optional skills; a base branch; worktree mode; and Git
   mode.
3. The user submits one message.
4. Coducktor starts or resumes the selected harness in the conversation's working directory and
   sends that message once.
5. The harness reasons, calls tools, edits files, and returns according to its own normal behavior.
6. Coducktor shows live assistant text and compact activity where the harness exposes it, then
   makes the conversation idle.
7. The composer is ready for the user's next message, which resumes the same harness session.

The application must never silently turn one user message into multiple model turns. The only
exception is a provider-native structured user question: answering that question resumes the same
still-pending provider turn and is not an autonomous reprompt.

## 3. Goals and non-goals

### 3.1 Goals

- Make multi-turn coding chat reliable before adding any higher-order automation.
- Preserve all conversations created through Coducktor as project-scoped durable history.
- Make the wrapped harness behave like the harness, including its own tools, project instructions,
  plugins, skills, subagents, context compaction, and final-turn behavior.
- Make every user-visible configuration choice honest and directly traceable to a runner argument,
  protocol field, working-directory decision, or explicitly delimited prompt attachment.
- Keep the TUI responsive while a provider turn runs and while large histories render.
- Keep missing CLIs, credentials, Git, network, model catalogs, or writable optional state as
  capability reductions rather than startup failures.
- Preserve unknown JSON fields, per-entry salvage, atomic owner-only writes, and existing project
  scoping.
- Leave old workflows, variants, task branches, markers, and event logs readable without letting
  them influence new conversations.

### 3.2 Non-goals

- No workflows, workflow builder, workflow retries, check steps, workflow imports/exports, or
  workflow CLI flags for new work.
- No variants, compare groups, winner selection, or alternative-prompt generation.
- No Runner Auto, account/model routing, cross-provider failover, or usage-limit auto-resume.
- No Coducktor-owned context-window refresh, plan handoff, monitoring wake, or autonomous nudge.
- No completion markers or prose classification used to decide whether a turn is done.
- No task-mode or approval-mode selector in the composer.
- No per-workflow tool allowlist or Bash prefix policy.
- No rich provider-neutral reconstruction of every tool call or reasoning block.
- No import of arbitrary conversations created outside Coducktor.
- No action, button, hint, command, menu entry, or open target that launches, resumes, or hands a
  conversation over to a native Claude, Codex, OpenCode, or pi interface. In particular, remove
  the current native-agent CLI open targets, per-thread Terminal/take-over action, copyable resume
  command, and session resume hint. The ordinary project/worktree terminal and editor open targets
  remain.
- No database, service, browser, listening Coducktor socket, hosted deployment, or remote session
  surface.

## 4. Terminology and state model

### 4.1 Conversation

A conversation is the durable project-scoped container users browse and archive. It owns:

- `id` and project identity;
- deterministic title and exact initial message;
- concrete harness;
- optional concrete model and optional harness-specific reasoning value;
- provider session ID when known;
- repository root, base branch, task branch, worktree path, and worktree mode;
- Git mode;
- timestamps, read/archive state, usage totals, and last error; and
- an append-only event history containing its user turns and provider output.

Harness, model, reasoning, and working directory are fixed for the lifetime of a conversation.
Changing one starts a new conversation. This uniform rule avoids provider-specific mid-session
mutation behavior and makes resume deterministic. Git mode may be changed only while idle because
it governs Coducktor's post-turn action, not provider context.

### 4.2 Turn

A turn begins with exactly one ordinary user message and ends when the provider reports that turn
ended, failed, or was cancelled. A structured provider question can temporarily suspend the turn;
its answer continues the same turn.

Every turn has a durable identity and one of:

- `queued`: accepted but not yet admitted to the bounded worker pool;
- `running`: provider I/O is active;
- `needs_input`: a provider-native structured question is pending;
- `ended`: the provider ended normally, regardless of the wording of its response;
- `failed`: opening, transport, protocol, or provider execution failed; or
- `cancelled`: the user cancelled the live provider turn.

Turn outcome is historical. It does not close the conversation.

### 4.3 Conversation state

The conversation's current state is a projection of its active or latest turn:

- `idle`: no provider turn is active; the user may send a message;
- `queued`;
- `running`;
- `needs_input`;
- `failed`: the latest submission failed and the user may retry or send a different message; or
- `cancelled`: the latest turn was cancelled and the user may send another message.

There is no `done` or `review` state for a conversation. Archiving is the only user action that
closes it in the browser. Unarchiving restores the prior idle/failed/cancelled state; an archived
conversation cannot accept a message until unarchived.

Legacy task records retain their historical `done`, `review`, workflow, step, and variant states.
They are rendered read-only and are never passed through the conversation runtime.

### 4.4 Normal versus structured questions

If an agent asks a question in ordinary assistant prose and the provider ends the turn, the
conversation becomes `idle`. The user replies with a normal new message. Coducktor must not scan
for question marks or phrases such as "need your input."

Only a native structured question/RPC/event puts a turn in `needs_input`. The pending request must
have a stable request ID, bounded choices or bounded free-form input, and an exact runner-owned
response path. If Coducktor restarts while such an RPC is pending, the in-memory RPC cannot be
fabricated: mark that turn failed with an interruption explanation, keep its visible question in
history, and allow a new ordinary message through a resumed provider session.

## 5. Composer and browser experience

### 5.1 New conversation composer

Rename the user-facing `New Task` surface to `New Chat`. Internal `run` names may remain during
the staged migration, but no current UI copy may describe a newly created conversation as a
workflow or autonomous task.

The composer contains, in focus order:

1. Message editor, pasted images, and the existing skill mention interaction.
2. Harness: exactly Claude, Codex, OpenCode, or pi. No Auto choice.
3. Model: `Default` plus the selected harness's discovered models. Catalog failure leaves
   `Default` usable and may offer a validated free-form model ID.
4. Reasoning: `Default` plus the exact values advertised or supported by that harness/model.
5. Skills: zero or more discovered local skills, additive to the message rather than a mutually
   exclusive task source.
6. Base branch.
7. Worktree on/off.
8. Git manual/auto.

Remove Source, Workflow, Variants, Task Mode, Runner Auto, planning-mode shortcuts, and any summary
derived from them. Persist last-used and per-project defaults only for the remaining choices.
There is no account/profile picker: the concrete harness uses its own configured authentication and
Coducktor's deterministic per-harness default environment. Existing stored account metadata may
remain for compatibility and health display, but it cannot route or fail over a conversation.

Harness, model, reasoning, base branch, and worktree become immutable after the first successful
submission. The conversation header displays them; they do not consume space in every follow-up
composer. Skills remain per-message attachments and clear after a successful send. Git mode is
shown in the header and can be toggled while idle.

### 5.2 Branch and worktree rules

- With Git and worktree on, the branch picker chooses the base ref and Coducktor creates the
  existing managed task branch/worktree. Preserve the current loud, non-destructive worktree
  creation behavior and compatibility branch readers.
- With Git and worktree off, the only selectable branch is the repository's currently checked-out
  branch/HEAD. Coducktor must not check out another branch underneath the user's working tree.
- Without Git, branch and worktree controls are disabled and the harness runs in the project root.
- Worktree mode defaults on for Git projects and remains the recommended concurrent mode.
- In-place conversations retain the existing repository-root serialization rule so two harnesses
  cannot concurrently mutate the same checkout.
- Worktree and Git mode are independent. Git auto commits and pushes the conversation's current
  branch — in its managed worktree, or in the repository's current checkout when worktree mode is
  off.
- An unarchived conversation's managed worktree is not retention-eligible. An archived clean
  conversation may have its worktree reclaimed while its transcript and managed branch remain.
  Unarchiving must reattach or recreate that worktree from the recorded branch before enabling the
  composer; restoration failure leaves history readable and must never fall back to the project
  root.

### 5.3 Follow-up composer

The follow-up editor always records the exact user-authored text and images. Provider-only skill
augmentation must never alter the displayed or durable user message.

While a turn is queued or running, the user may type and retain a draft, but Send is disabled.
There is no in-flight message queue. This enforces the primary sequence—response, then next
prompt—and removes ambiguous steering and boundary delivery. `Esc` leaves Insert mode without
touching the live turn. `Ctrl-C`, the Cancel header action, or `:stop` stops the current turn; none
of them discards the draft or archives the conversation.

While `needs_input`, show the native question controls directly above the composer. Submitting an
answer addresses the pending request. A separate ordinary follow-up is unavailable until that
request resolves or the turn is cancelled.

After `failed` or `cancelled`, the same composer is available. A retry is a user-authored action,
never automatic. Preserve the submitted message in history even when opening the runner fails.

### 5.4 Chat browser

Rename project `Tasks` and workspace `All Tasks` to `Chats` and `All Chats`. Keep project-qualified
identity, independent filters/selections, unread state, archive/delete, GitHub references, prompt
previews, and meaningful activity timestamps.

Current chats are grouped as:

- `Needs you`: structured `needs_input` and unseen failed/cancelled turns;
- `Working`: queued and running;
- `Recent`: idle conversations and seen failures/cancellations.

Archived contains only explicitly archived conversations. Do not infer archival or completion from
provider prose or turn end.

History is the product: remove count-based automatic deletion of new conversation records and
NDJSON logs. Only an explicit user delete removes a conversation history. Worktree retention is a
separate policy and may reclaim an eligible checkout without deleting the transcript.

Delete is disabled while a turn is active and uses the existing destructive confirmation pattern.
The confirmation identifies the transcript, managed worktree, and managed branch that will be
removed. Refuse an unqualified/broad target and report whether any retained checkout or branch
could not be removed; never erase an unrelated or unresolved directory.

### 5.5 Conversation timeline

Keep one chronological timeline. Render:

- exact user messages and images;
- streamed assistant messages using provider-reported phase when present;
- reasoning collapsed when a provider exposes it;
- tool activity as compact semantic rows with status, short title, and expandable bounded details;
- structured questions;
- errors, cancellation, turn boundaries, usage, and Git actions; and
- a live row showing current phase, elapsed time, tokens, and running tool.

Do not attempt to make every provider's tool calls identical. Preserve the small existing
normalized event vocabulary and fall back to an `Other` activity row for unknown provider items.
Unknown events stay durable and must not break the rest of the transcript. Routine completed
activity defaults closed; failures remain legible when closed.

At turn end, provider-native final messages receive final-response styling. When a provider does
not label commentary versus final text, preserve chronology and display its assistant text without
inventing a semantic phase. Turn end itself makes the composer available; it does not promote
arbitrary prose into a completion decision.

Remove workflow-step progress, plan-driven refresh notices, autonomous-pass notes, monitoring
status, Compare, Finish, Continue, Review acceptance, native CLI/Terminal handoff, and resume hints.
Keep Changes, Files, Commits, Git actions, PR actions, archive, delete, mark read/unread, and cancel.

## 6. Skills and prompt construction

Skills are prompt attachments, not workflow steps. The durable message event contains:

- exact user text and images;
- selected skill identities and source metadata;
- a content hash for the exact skill body sent; and
- no duplicated injected skill text in the visible user message.

Resolve selected skills at submission time. If a selected skill disappears or cannot be read,
reject the send while preserving the draft and name the missing skill. Bound the total attached
skill content and number of skills; use the existing prompt/image bounds as the starting policy and
add explicit tests for the chosen limits.

The runner request carries user content and skill context as distinct fields. Concrete adapters
use a native system/instruction field when that field can be added to the relevant turn without
changing the harness's base prompt. Otherwise they prepend a clearly delimited provider-only
context block to the payload sent to the harness. Coducktor's transcript still shows only the
exact user message.

Do not inject:

- `DUCK:DONE`, `DUCK:ASK`, or `DUCK:MONITORING` instructions;
- an autonomous continuation contract;
- workflow step prompts or check commands;
- plan checkpoints or handoff files;
- generic tool restrictions; or
- a second copy of repository instructions that the harness already discovers natively.

Harness-native AGENTS/CLAUDE files, plugins, MCP servers, commands, extensions, skills, subagents,
and context compaction remain enabled according to that harness's own configuration. Removing
Coducktor context refresh must not disable native compaction such as Claude autocompact.

## 7. Harness execution contract

### 7.1 Backend-neutral request

Replace workflow-derived `SessionRequest`/`AgentRunSpec` fields with a conversation turn request:

```text
ConversationTurnRequest
  conversation_id
  turn_id
  user_text
  images
  skill_context[]
  harness                 concrete; never Auto
  model                   optional; absent means harness default
  reasoning               optional opaque harness value
  provider_session_id     optional
  resume                   bool
  cwd
  additional_directories  only when explicitly supported by project scope
  cancellation
```

Remove `step_id`, workflow policy, allowed tools, Bash allowlist, marker controls, auto-runner
candidates, retry prompt, plan checkpoint, and failover context from the new runtime seam.

Reasoning becomes an optional harness-specific string/value rather than a globally normalized
four-level enum. The catalog/UI controls which values can be selected. `Default` is represented by
omission and delegates to the harness. Never silently lower, translate, or invent a reasoning
level.

### 7.2 Backend-neutral outcome

Replace marker-oriented `SessionOutcome` variants with:

```text
TurnOutcome
  Ended(report, session_open)
  NeedsInput(report, pending_request)
  Failed(message, report, session_open)
  Cancelled(report, session_open)
```

`report` contains provider session ID, aggregated usage/cost, and turn text only for diagnostics
and deterministic title fallback. It contains no lifecycle marker decision and no plan entries.
Provider `turn.completed`, result frames, idle/end-turn events, or clean command exit produce
`Ended`; the adapter does not inspect message prose.

### 7.3 Permission policy

New conversations always use the harness's autonomous permission mode. This is runner
configuration, not conversation lifecycle and not a composer choice. Remove `autonomous` from new
request/default/config records and remove `DUCK_APPROVAL_GATE` from current documentation and the
new execution path.

Autonomous permission modes are not equivalent security sandboxes. The UI must disclose that the
selected harness can execute tools and that a worktree isolates Git state, not the rest of the
host or network. Do not imply that a worktree makes `--yolo` safe.

An unexpected permission request under an autonomous preset is a protocol/provider failure. Fail
closed, terminate or cleanly release the blocked request, record the error, and leave the
conversation recoverable. Do not restore a cross-provider permission approval UI as part of this
effort. Native user-question tools remain supported because they ask for task input, not execution
permission.

### 7.4 Runner mapping

| Harness | Transport | Autonomous setting | Model | Reasoning | Resume |
| --- | --- | --- | --- | --- | --- |
| Codex | existing `codex app-server` JSON-RPC | `sandbox=danger-full-access`, `approvalPolicy=never` (the app-server equivalent of `--yolo`) | native turn/thread field | native effort field | persisted thread ID via `thread/resume` |
| Claude | existing `--input-format stream-json --output-format stream-json --verbose` process | `--permission-mode auto`; do not send workflow `--allowedTools` | `--model` | exact supported `--effort` value | `--session-id` / `--resume` |
| OpenCode | `opencode run --format json --auto` per provider turn | `--auto` | `--model provider/model` | `--variant` | discovered session ID, then `--session` |
| pi | existing `--mode rpc` process | normal built-in tools, no workflow `--tools` narrowing; use `--approve` to avoid project-local trust prompts | `--model` | exact `--thinking` value | `--session-id` / `--session` |

Characterize the installed OpenCode JSON stream in a committed fixture before replacing the
current `opencode serve` adapter. The required gate is stable session identity, live assistant
text, tool lifecycle where available, clean turn end, cancellation, and a second `--session` turn.
If the installed `run --format json` transport demonstrably cannot satisfy one of those required
behaviors, retain the current short-lived local server transport but implement the same autonomous
permission policy through its supported session configuration. This is a transport fallback, not
a reason to restore orchestration or approval UI.

Runner CLI spellings are version-sensitive. Keep them isolated in runner modules, characterize
the minimum supported installed versions, and make an unsupported flag a clear per-turn backend
error rather than a startup failure.

### 7.5 Session ownership and resume

Keep a live provider process/session between turns when the transport supports it. Once a normal
turn ends, park the session without consuming a worker slot. Persist the provider session ID as
soon as it is known. On process restart or when a parked child has exited, the next user message
opens the same harness with native resume.

The harness is the authority for context. Coducktor does not replay its transcript during normal
resume. If native resume fails, show the exact error and offer an explicit Coducktor action to
restart the provider session in the same conversation/worktree. That action:

- requires a user confirmation;
- creates a new provider session ID;
- builds a deterministic, bounded handoff from visible user/assistant messages only;
- shows that a session restart will occur before sending;
- sends only in response to the user's explicit retry/new-message action; and
- records the old/new session IDs and handoff boundary durably.

It must never run automatically based on context-window usage, plan progress, quota state, a
timer, or provider prose.

There is no UI or command for opening the provider session in the harness's own interface.

## 8. Core runtime architecture

### 8.1 Introduce a conversation manager

Create a conversation-oriented runtime rather than continuing to grow the workflow-oriented
`RunManager`. Suggested location:

```text
crates/coducktor-core/src/conversations/
  mod.rs
  manager.rs
  persistence.rs
  lifecycle.rs
  events.rs
  recovery.rs
  semaphore.rs
```

Reuse proven primitives for atomic persistence, NDJSON append, observers, cancellation, project
scope, worktree leases, and bounded concurrency. Do not copy workflow state machines, check
execution, marker decisions, variants, monitoring, quota failover, or context refresh.

The conversation manager owns at most one active turn per conversation. It may queue initial/user
turns behind global/project capacity, but because the UI cannot submit while a conversation is
active, it has no per-conversation message queue. Admission ordering is FIFO across conversations.

No manager mutex may be held across `SessionFactory::open`, `AgentSession::turn`,
`AgentSession::answer`, cancellation wait, child-process wait, Git child, or any other blocking
provider call. Retain and adapt `manager_lock_discipline` to the new seam.

### 8.2 Turn transition table

| Current state | User/system event | Next state | Provider call |
| --- | --- | --- | --- |
| idle/failed/cancelled | submit message | queued → running | exactly one `turn`/`send_message` |
| queued | admitted | running | open/resume, then one turn |
| queued | cancel | cancelled | none if not opened |
| running | native structured question | needs_input | return pending request; keep session |
| needs_input | answer | running | answer exact pending request and continue same turn |
| needs_input | cancel | cancelled | cancel pending turn |
| running | native turn end | idle | none |
| running | provider/open/protocol failure | failed | none |
| running | cancel | cancelled | cancellation only |
| any non-active | archive | archived | none |

There is no transition from a native turn end to another provider turn without a new user
submission. Add a test double that counts every `turn`, `send_message`, and structured-answer call;
all ordinary submissions must be one-to-one with provider turn calls.

### 8.3 Startup recovery

On startup:

- run existing ordered workspace migrations first;
- load and salvage conversation/legacy records with unknown fields preserved;
- `queued` conversations may be restored to queued only if their exact durable user turn was never
  admitted; otherwise mark the turn interrupted and the conversation failed;
- `running` conversations become failed/interrupted; never silently repeat the message;
- `needs_input` conversations become failed/interrupted because the pending process-local RPC was
  lost;
- idle/failed/cancelled conversations remain follow-up capable through native session resume;
- legacy queued/running/waiting workflows are settled as interrupted historical tasks and are not
  restarted; and
- no timer, quota probe, or context checkpoint can admit a turn.

Startup recovery must prefer avoiding duplicate paid/provider work over speculative continuation.

## 9. Durable compatibility and contracts

### 9.1 Storage strategy

Keep the existing project-local storage locations during this effort:

- `.ai/coducktor/runs.json` for the owner-only atomic index; and
- `.ai/coducktor/runs/<id>.ndjson` for append-only history.

The filenames are compatibility implementation details; user-facing copy calls them chats and
conversations. A directory rename is not required to deliver this product and would add migration
risk without user value.

Add an explicit record discriminator such as `recordKind: "conversation"`. An absent discriminator
means a legacy task. New records retain the minimum required legacy fields (`task`, a stable
non-user-facing compatibility value for `workflow`, and an empty `steps` array) until all readers
have moved to a conversation contract. They also add top-level provider session and active-turn
fields so no code needs to manufacture a workflow step merely to store session affinity.

Do not rewrite every legacy record on startup. The first real mutation may round-trip a record,
preserving its unknown fields. New writers emit one current conversation vocabulary; legacy fields
exist only where required for old-state compatibility and never become alternate UI terminology.

### 9.2 Contract shape

Add conversation-specific types to `coducktor-contract` rather than making screens infer them from
workflow steps:

- `RecordKind`;
- `ConversationState`;
- `TurnState` and a bounded current/latest turn summary;
- concrete harness/model/reasoning/session affinity;
- per-message skill attachment metadata;
- new create/send/answer/cancel/archive response types; and
- project-qualified conversation index entries.

Keep existing `RunRecord`, workflow, variant, marker, and event types readable for legacy records.
Compatibility readers retain both existing marker regexes and task-branch regexes. New conversation
writers do not emit markers.

The normalized v1/v2 event envelopes remain open and forward-compatible. Add typed conversation
lifecycle events only where the existing `turn.started`, `turn.completed`, user message, question,
error, session, and usage events cannot express the required fact. Preserve unknown event kinds
and raw extra keys.

### 9.3 Engine seam

Screens continue to depend only on `Engine`. Add conversation-named methods and migrate TUI call
sites:

- create/list/get conversation;
- submit message;
- answer pending question;
- cancel active turn;
- archive/unarchive/delete;
- page history/context;
- inspect changes/files/commits and perform explicit Git/PR actions; and
- update idle Git mode.

Remove workflow builder reads/writes, group/variant selection, finish, synthetic continue, review
accept/send-back, monitoring, and native CLI open/resume methods after all new call sites migrate.
Keep ordinary open-in-editor, open-in-file-manager, and open-in-terminal operations, but remove
`cli:<provider>` targets.

The one-shot headless `duck run "<message>"` command remains as a convenience that creates a
conversation, waits for its first native turn to end, prints provider output, and exits. Remove
`--workflow` and variants. Add/retain explicit `--runner`, `--model`, reasoning, skill, branch,
worktree, and Git-mode flags only where they share the TUI contract. `coducktor init` scaffolds a
skill example only; it does not create a workflows directory or workflow YAML.

## 10. Git behavior

Git mode is Coducktor post-turn policy and never changes provider turn count.

### 10.1 Manual

In manual mode Coducktor does not commit or push at turn end. Changes remain in the selected
worktree/current checkout and are visible in Changes, Files, and Commits. Remove automatic recovery
commits from the manual path so the label is truthful. Worktree retention must not reclaim a
checkout with uncommitted changes unless an existing explicit, recoverable policy permits it and
the UI clearly reports the retained/reclaimed state.

Explicit user actions—Commit, Push, Publish PR, or a provider choosing to run Git itself—retain
their current meaning.

### 10.2 Auto

Auto mode is available only for a managed worktree. After a normally ended provider turn:

1. Inspect the worktree without holding the conversation-manager lock.
2. If uncommitted changes exist, commit them with a deterministic subject derived locally from the
   bounded user-message preview, for example `coducktor: <preview>`. Do not ask the agent to write
   a commit message.
3. Push the current managed branch using the existing argument-array helper and bounded timeout.
4. Record commit/push success or failure as Git activity attached to that turn.

If the agent already committed its changes, skip the commit and still push commits that need an
upstream update. A Git failure does not fail or close the conversation; leave it idle with a clear
warning and all manual Git controls available. Cancellation cancels provider work, not an already
completed explicit Git command; keep Git subprocess bounds so shutdown cannot hang.

Do not auto-commit or push a failed/cancelled turn. Preserve its worktree changes for manual review.

## 11. Removal inventory

Before deleting code, perform reference searches and keep compatibility readers proven by tests.
The implementation must remove or retire the following from the new product path.

### 11.1 Core/client

- `context_refresh`, autonomous nudges, prose input detection, task-control system prompt, marker
  decisions, monitoring wakes, auto-resume, quota failover, review gate, check executor, workflow
  job cursor/retries, variants, groups, and synthetic Git subject turns;
- runner selection/routing decisions from conversation admission;
- queued follow-up delivery and Finish/Continue semantics; and
- provider CLI open targets and resume-command construction.

### 11.2 Contract/config

- new-record `workflow`, `steps`, `variants`, `group`, `autonomous`, monitoring, auto-resume,
  routing-decision, and review fields after compatibility isolation;
- composer defaults for variants/autonomous;
- `intelligentContextRefresh`, workflow defaults, automatic routing policy, and approval-gate UI
  configuration from current writers and Settings; and
- global normalized reasoning choices that claim unsupported equivalence.

Deprecated config keys must be tolerated as unknown/legacy input and omitted on the next relevant
write without corrupting sibling keys. Do not fail startup because an old config still contains
them.

### 11.3 TUI

- Workflows sidebar/screen/editor and workflow source picker;
- Variants pill, Compare screen, group winner actions;
- Task Mode/autonomous pill and review controls;
- workflow steps/progress and plan-refresh presentation;
- Finish, Continue, Send Back, monitoring, queued-follow-up submission, and native CLI handoff;
- Runner Auto and routing explanations; and
- context-refresh and approval-gate Settings rows.

### 11.4 CLI/docs/assets

- `--workflow`, workflow scaffold/import/export/save/delete/parse documentation;
- workflow examples under `coducktor init`;
- variants, compare, autonomous passes, marker controls, intelligent refresh, provider failover,
  and native harness take-over as current README/keymap/protocol behavior; and
- current-behavior references to deleted workflow/variant screens in terminal documentation.

Historical specs may remain under `docs/specs/` but must be marked superseded where they otherwise
claim to be current. Do not delete them merely to make a reference search empty.

## 12. Affected source map

Use this as the initial inventory, then search references before every public-type change or
deletion.

| Area | Primary current files | Target work |
| --- | --- | --- |
| Contracts | `crates/coducktor-contract/src/{runs,events,reasoning,workspace,workflows}.rs` | add conversation/turn contracts; isolate legacy task/workflow shapes |
| Protocol | `crates/coducktor-protocol/src/ui_events.rs` | retain the small normalized stream; add only proven conversation gaps |
| Persistence | `crates/coducktor-core/src/runs/{store,events}.rs` | mixed-record salvage, discriminator, no conversation-history pruning |
| Runtime | `crates/coducktor-core/src/workflows/run/` | extract reusable primitives; replace product execution with `core::conversations` |
| Skills | `crates/coducktor-core/src/skills.rs` | bounded per-message resolution and attachment metadata |
| Worktrees/Git | `crates/coducktor-core/src/git/worktree.rs`, `crates/coducktor-client/src/in_process/git.rs` | conversation retention/restoration and truthful manual/auto policy |
| Engine | `crates/coducktor-client/src/{engine,in_process,events}.rs` and `src/in_process/{workspace,git}.rs` | conversation methods, project routing, removal of workflow/group/native-CLI paths |
| Runner seam | `crates/coducktor-runners/src/{agent_runner,session_factory}.rs` | reduced request/outcome and conformance suite |
| Runners | `crates/coducktor-runners/src/{claude,codex,opencode,pi}_runner.rs` plus mappers/fixtures | exact autonomous args, native turn end, session resume |
| Composer | `crates/coducktor-tui/src/{new_task_form.rs,screens/new_task.rs}` | New Chat fields, skill attachments, sticky affinity |
| Browser | `crates/coducktor-tui/src/screens/{tasks,global_tasks,runs_util}.rs` | Chats/All Chats state and grouping |
| Timeline | `crates/coducktor-tui/src/screens/thread/`, `src/widgets/transcript.rs` | conversation states, simplified activity, no take-over/finish/continue |
| Removed TUI | `crates/coducktor-tui/src/screens/{workflows,compare}.rs` | delete after legacy history no longer depends on them |
| App/runtime/input | `crates/coducktor-tui/src/{app,runtime,overlay,cli,headless}.rs`, `src/input/` | route/actions/CLI/keymap migration |
| Settings | `crates/coducktor-tui/src/screens/settings/mod.rs`, core/client workspace config | remove orchestration settings; retain harness health/defaults |
| Documentation | `README.md`, `AGENT_PROTOCOL.md`, `.env.example`, `docs/tui/`, current specs | describe only the shipped conversation-first binary |

## 13. Implementation phases

Each phase must be independently reviewable and must not mix unrelated cleanup. Suggested commits
are guidance; preserve the repository's actual state and current `main` history.

### Phase 0 — Freeze the one-message/one-turn invariant

1. Add black-box fake-session tests that count ordinary provider calls, structured answers, and
   automatic sends.
2. Characterize all four installed runner transports for first turn, second turn, session ID,
   final text, tool activity, native question, cancellation, and process exit.
3. Commit an OpenCode `run --format json --auto` fixture and decide the transport fallback using
   the gate in section 7.4.
4. Add negative tests proving no normal provider response can trigger a second call, including
   markerless prose, questions in prose, plan completion, max tokens, and empty final text.

Gate: one ordinary submission produces exactly one provider turn on every harness fixture.

Suggested commit: `Freeze native turn boundaries`

### Phase 1 — Add durable conversation contracts and manager

1. Add `recordKind`, conversation/turn states, top-level session affinity, message-skill metadata,
   and project-qualified index types.
2. Extend the existing atomic index and NDJSON layers with mixed legacy/conversation fixtures.
3. Implement `ConversationManager` admission, live session parking, native resume, structured
   question handling, cancellation, and startup interruption rules.
4. Port the semaphore, observer, event append, pagination, cancellation token, and lock-discipline
   invariants without workflow lifecycle code.
5. Stop automatic history pruning for conversation records.

Gate: core tests exercise two full user turns, restart/resume, interruption, archive/delete, mixed
legacy records, unknown keys, salvage, permissions, and atomic writes.

Suggested commit: `Add durable conversation runtime`

### Phase 2 — Make runners harness-native and autonomous

1. Introduce the reduced turn request/outcome seam.
2. Remove task controls, marker interpretation, workflow tools, and global reasoning translation
   from new runner requests.
3. Apply the exact autonomous/model/reasoning/session mapping in section 7.4.
4. Preserve normalized assistant, reasoning, tool, question, error, usage, and turn events.
5. Add subprocess/golden coverage for first turn, follow-up, resume after process recreation,
   unexpected permission failure, cancellation, malformed frames, stderr bounds, and teardown.

Gate: all four runner integration fixtures pass the same conversation conformance suite, with
documented capability degradation where a native wire omits detail.

Suggested commit: `Run one native harness turn per message`

### Phase 3 — Switch the engine and Git policy

1. Add conversation engine methods and project-scoped manager registry wiring.
2. Route new creates/messages/history/events/cancellation through `ConversationManager`.
3. Preserve asynchronous worker separation and live event sequencing/gap recovery.
4. Implement truthful manual and deterministic auto Git behavior without model calls.
5. Remove auto routing/failover/resume and native CLI open targets from the new engine path.
6. Keep legacy task reads, archive/delete, Git inspection, and PR inspection read-only.

Gate: two projects with colliding conversation IDs remain isolated; a blocked provider turn does
not delay unrelated reads/mutations; Git auto never increases provider call count.

Suggested commit: `Route chats through the conversation engine`

### Phase 4 — Ship New Chat and multi-turn chat UX

1. Replace the composer fields and defaults with section 5.1.
2. Rename user-facing task routes/copy to Chats/New Chat/All Chats.
3. Render the conversation state model and simplified timeline.
4. Disable submission during active turns while preserving editable drafts.
5. Keep structured questions, cancel, history paging, Changes/Files/Commits, GitHub, archive/delete,
   read/unread, and live-tail behavior.
6. Remove Compare, workflows, variants, task mode, Finish/Continue/Review, queued-send hints, native
   CLI actions, and resume hints.

Gate: a user can complete the exact seven-step loop in section 2 twice in one conversation using
keyboard and mouse at 80x24, 120x40, and a wide terminal; no removed control is reachable.

Suggested commit: `Make chats the primary cockpit loop`

### Phase 5 — Retire workflow-era product surfaces

1. Remove workflow Engine APIs, TUI screen, CLI flags, init scaffold, loaders on startup, and
   current documentation.
2. Remove variants/group runtime and Compare code.
3. Remove context refresh, nudges, monitoring, check steps, review gate, quota failover/auto-resume,
   and their active config writers.
4. Isolate legacy parsers/renderers under clearly named compatibility modules.
5. Use reference searches before deleting dead types or comments; do not remove compatibility
   marker/branch readers.

Gate: no new-record, composer, engine, runner, or runtime path references workflow execution,
variants, autonomous continuation, or intelligent context refresh.

Suggested commit: `Retire workflow orchestration surfaces`

### Phase 6 — Documentation, manual verification, and final cleanup

1. Rewrite README, `AGENT_PROTOCOL.md`, `.env.example`, CLI help, keymap, task/chat specification,
   and relevant settings documentation around the shipped chat binary.
2. Mark superseded current-behavior specs explicitly while retaining historical evidence.
3. Run stale-reference searches for browser/server/npm/hosted surfaces and all removals in section
   11.
4. Exercise real interactive terminals for each locally configured harness and record results in
   `docs/tui/terminals.md`; headless output is not interactive-terminal evidence.
5. Run the final repository gate.

Gate: all current docs describe the shipped conversation-first terminal binary and the real manual
matrix demonstrates two user turns for every available harness.

Suggested commit: `Document the conversation-first cockpit`

## 14. Test matrix

### 14.1 Contract and persistence

- Mixed legacy task and conversation records in one `runs.json`.
- Old records with absent discriminator, workflow steps, variants, old runners, and both marker
  spellings remain readable.
- New records round-trip unknown top-level and nested keys.
- One malformed entry salvages valid siblings and quarantines writes.
- Corrupt index remains in place and boots with defaults after one warning.
- Atomic `0600` read-modify-write, concurrent writer conflict, disk-full/pre/post-rename behavior,
  and explicit repair retain existing invariants.
- Conversation NDJSON pagination, deduplication, live cursor, and unknown event salvage.
- No automatic count-based conversation-history deletion.

### 14.2 Runtime

- First message opens one session and calls one turn.
- Second message reuses a live session and calls one follow-up.
- Process recreation resumes the same native session ID.
- Markerless final prose, a final question, an empty response, a plan update, and max-token stop
  each end without an automatic send.
- Structured question answer is the only non-user-turn response call and resumes the exact pending
  request.
- In-flight ordinary submission is rejected without losing its draft.
- Cancellation before admission, during open, during tools, during a question, and after native
  turn end.
- Startup never repeats an admitted/running message.
- Missing CLI/auth/network/model catalog affects only the selected turn/capability.
- No manager lock is held across session/process/Git waits.
- Per-project and in-place/worktree concurrency remain isolated.

### 14.3 Runners

For Claude, Codex, OpenCode, and pi:

- exact autonomous argument/protocol policy;
- harness default model/reasoning by omission;
- explicit model and every advertised reasoning value;
- skill context plus exact visible user message;
- image opening and follow-up where supported;
- assistant delta/final text, tool lifecycle, reasoning, usage, native question, error;
- stable provider session ID and second-turn resume;
- unexpected permission request fails closed;
- cancellation and bounded teardown; and
- stdout/stderr never inherit the user's terminal.

### 14.4 TUI

- New Chat fields, keyboard focus order, mouse hit targets, and narrow wrapping.
- Harness change refreshes model/reasoning options without stale async results.
- Worktree-off branch restriction and Git-auto/worktree coupling.
- Skills attach additively, clear after send, and remain on failed send.
- Running composer retains draft but cannot submit.
- Idle/needs-input/failed/cancelled transitions and browser grouping.
- Two full turns preserve exact user messages and do not duplicate assistant output.
- Unknown tool/event degradation and collapsed completed activity.
- Native CLI actions/resume hints, workflows, variants, Compare, Finish, Continue, Review, and task
  mode are absent from keymap, menus, command palette, hitmaps, and snapshots.
- Existing 12,000-event frame and lock-discipline performance gates remain green.

### 14.5 Git

- Manual mode performs no Coducktor commit or push.
- Auto mode works with or without a managed worktree: it commits in the worktree when present,
  otherwise in the repository's current checkout.
- Ended turn commits once with deterministic bounded subject and pushes once.
- Existing agent commit is not duplicated and is pushed when needed.
- Failed/cancelled turn is not auto-committed or pushed.
- Git failure leaves the conversation idle and changes recoverable.
- Git auto makes zero additional provider calls.

## 15. Acceptance criteria

The effort is complete only when all of the following are true:

1. A user can create a Claude, Codex, OpenCode, or pi chat, observe tool-driven work and assistant
   output, then send a second message in the same durable conversation.
2. Every ordinary user message maps to exactly one native provider turn; tests prove no hidden
   reprompt path remains.
3. Native structured questions work without prose heuristics or permission-approval UI.
4. New chats have no workflow, variant, task-mode, runner-auto, monitoring, review, context-refresh,
   or provider-failover behavior.
5. Every harness uses its autonomous tool mode by default and records a clear per-turn failure if
   that mode is unsupported.
6. Harness, model, reasoning, session, cwd/worktree, and selected skill metadata are durable and
   accurately displayed.
7. A provider session resumes after Coducktor restart without transcript replay during normal
   operation; failed native resume requires an explicit user restart action.
8. Coducktor offers no native harness launch, resume, take-over, Terminal handoff, or copyable
   provider resume command.
9. Manual Git performs no implicit commit/push; Auto Git requires a worktree and performs no model
   call.
10. Existing task/workflow/variant histories remain readable, archivable, deletable, and
    inspectable without being executable through the new runtime.
11. Missing optional CLIs, credentials, Git, network, catalogs, or writable state never prevent
    unrelated projects and chats from opening.
12. All focused tests and the repository final gate pass:

```text
cargo test -p coducktor-client --test manager_lock_discipline
cargo test -p coducktor-tui --lib live_thread_frame_at_twelve_thousand_events_stays_under_eight_ms
cargo test -p coducktor-tui --bench thread_frame
cargo test --workspace --all-targets
cargo clippy --workspace --all-targets -- -D warnings
cargo fmt --all --check
cargo tree --workspace
```

## 16. Guardrails against scope regrowth

Future features must preserve the one-message/one-turn invariant unless a new, separately approved
product specification explicitly replaces it. In particular:

- A skill may alter the instructions attached to the user's message but may not schedule another
  turn.
- Git policy may run local Git commands but may not ask the model for a subject or review.
- Usage telemetry may inform the user but may not switch harnesses or resume work.
- Native context compaction is allowed; Coducktor context rotation is not.
- A provider-native subagent is ordinary activity inside the same harness turn; Coducktor does not
  coordinate it.
- A future prompt template may fill the composer but may not become a workflow.
- A retry is always visible and user initiated.
- A conversation is complete only when the user archives it, never because an agent emitted a
  marker or a classifier inferred completion.

These constraints are architectural acceptance criteria, not temporary omissions.
