/**
 * Pure claude stream-json → protocol-v2 mapper. `mapClaudeMessage` folds one
 * parsed NDJSON stdout line into `UiEvent`s plus the next mapper state; the
 * runner calls it ALONGSIDE the v1 path (v1 events keep flowing unchanged).
 *
 * Contract: `.ai/analysis/cockpit-ui-redesign/agent-event-protocols.md` §1
 * (wire format) and §7.1 "Claude (stream-json)" (the mapping). Golden
 * fixtures replaying real wire shapes live in `__fixtures__/claude/`.
 *
 * Robustness rule: input is untrusted wire data — the mapper never throws;
 * unknown message/block types map to zero events.
 *
 * State is explicit and treated as immutable: callers thread the returned
 * `state` into the next call. Item ids are deterministic — tool items reuse
 * the wire `tool_use` id; text/thinking blocks (which have no wire id) get
 * sequential `item_<n>` ids, turns get `turn_<n>` — so replaying a stored
 * transcript reproduces the exact event sequence.
 *
 * Plan/task rule: task ids are the harness's, and it only ever reports them in
 * tool RESULT text (`Task #3 created successfully: …`, `#3 [pending] …`), never
 * in the call. So a `TaskCreate` parks until its result lands. Inferring ids by
 * counting creates looks equivalent and is not: `--resume` reopens a session
 * whose list is already at 1..N while a fresh mapper state starts at zero, and
 * the two id spaces then drift silently — updates land on the wrong row.
 */
import { toolDisplay } from './tool-display.js';
export function createClaudeUiState(opts = {}) {
    return {
        fallbackSessionId: opts.fallbackSessionId,
        sessionStarted: false,
        pendingTurnIds: [],
        turnSeq: 0,
        currentTurnId: null,
        itemSeq: 0,
        sawAssistantText: false,
        openTools: new Map(),
        tasks: new Map(),
        pendingTaskCreates: new Map(),
    };
}
/**
 * Claude has no wire-level turn-start — the runner writing a user message to
 * stdin IS the turn boundary, so the runner calls this on each send. Until
 * `init` arrives the event is queued (the seed message is written before the
 * first stdout line is read).
 */
export function claudeTurnStarted(state) {
    const turnId = `turn_${state.turnSeq + 1}`;
    const next = { ...state, turnSeq: state.turnSeq + 1, currentTurnId: turnId };
    if (!state.sessionStarted) {
        return { events: [], state: { ...next, pendingTurnIds: [...state.pendingTurnIds, turnId] } };
    }
    return { events: [{ type: 'turn.started', turnId }], state: next };
}
/** Fold one parsed stream-json message into v2 events. Never throws. */
export function mapClaudeMessage(msg, state) {
    if (!isRecord(msg))
        return { events: [], state };
    switch (msg.type) {
        case 'system':
            return msg.subtype === 'init' ? mapInit(msg, state) : { events: [], state };
        case 'assistant':
            return mapAssistant(msg, state);
        case 'user':
            return mapToolResults(msg, state);
        case 'result':
            return mapResult(msg, state);
        default:
            // stream_event, control_request, … — nothing to render yet.
            return { events: [], state };
    }
}
// ---- system/init → session.started ----------------------------------------
function mapInit(msg, state) {
    const event = {
        type: 'session.started',
        sessionId: str(msg.session_id) ?? state.fallbackSessionId ?? '',
        backend: 'claude',
    };
    const model = str(msg.model);
    if (model !== undefined)
        event.model = model;
    const cwd = str(msg.cwd);
    if (cwd !== undefined)
        event.cwd = cwd;
    if (Array.isArray(msg.tools)) {
        event.tools = msg.tools.filter((tool) => typeof tool === 'string');
    }
    const events = [event];
    // Flush turns that began before init (the seeded first user message).
    for (const turnId of state.pendingTurnIds)
        events.push({ type: 'turn.started', turnId });
    return { events, state: { ...state, sessionStarted: true, pendingTurnIds: [] } };
}
// ---- assistant blocks → message/reasoning/tool items -----------------------
function mapAssistant(msg, state) {
    const content = messageContent(msg);
    const parentItemId = str(msg.parent_tool_use_id);
    const events = [];
    let itemSeq = state.itemSeq;
    let openTools = null;
    let tasks = state.tasks;
    let pendingTaskCreates = state.pendingTaskCreates;
    let sawAssistantText = state.sawAssistantText;
    for (const raw of content) {
        if (!isRecord(raw))
            continue;
        if (raw.type === 'text' && typeof raw.text === 'string') {
            // Whole blocks per API round-trip — claude sends no deltas in this
            // mode, so we never fake `item.delta`s: started + completed.
            // Counted against the result fallback exactly as the runner counts it:
            // every text block, sub-agent ones included (`ctx.textChunks.push` runs
            // regardless of `parent_tool_use_id`).
            sawAssistantText = true;
            const item = { kind: 'message', id: `item_${++itemSeq}`, role: 'assistant', text: raw.text };
            if (parentItemId !== undefined)
                item.parentItemId = parentItemId;
            events.push({ type: 'item.started', item }, { type: 'item.completed', item });
        }
        else if (raw.type === 'thinking' && typeof raw.thinking === 'string' && raw.thinking.trim() !== '') {
            // Blank `thinking` is skipped: it carries no information and would only
            // mint a dead "Thinking —" row in the session view (#528).
            const item = { kind: 'reasoning', id: `item_${++itemSeq}`, text: raw.thinking };
            if (parentItemId !== undefined)
                item.parentItemId = parentItemId;
            events.push({ type: 'item.started', item }, { type: 'item.completed', item });
        }
        else if (raw.type === 'tool_use' && typeof raw.id === 'string' && typeof raw.name === 'string') {
            const display = toolDisplay(raw.name, raw.input);
            const item = {
                kind: 'tool',
                id: raw.id,
                name: raw.name,
                toolKind: display.toolKind,
                title: display.title,
                // claude has no pending phase — a tool_use is already executing.
                status: 'running',
            };
            if (raw.input !== undefined)
                item.input = raw.input;
            const edit = editArtifacts(raw.name, raw.input);
            if (edit) {
                if (edit.diffs)
                    item.diffs = edit.diffs;
                item.locations = edit.locations;
            }
            if (parentItemId !== undefined)
                item.parentItemId = parentItemId;
            events.push({ type: 'item.started', item });
            if (raw.name === 'TodoWrite') {
                const entries = planEntries(raw.input);
                if (entries)
                    events.push({ type: 'plan.updated', entries });
            }
            else if (parentItemId === undefined) {
                // Task tools are main-agent-only: a subagent's tool list has no
                // TaskCreate/TaskUpdate/TaskList at all (verified against the live
                // harness). Should that change, its id space is its own, so folding a
                // subagent's ids into this map would corrupt the main plan — ignore
                // them until the shared-or-separate question is answered on the wire.
                const pending = pendingTaskCreate(raw.name, raw.input);
                if (pending) {
                    // The id is minted by the harness and only revealed in the result, so
                    // the entry parks here until then (`applyTaskCreateResult`). Counting
                    // creates to guess it desyncs the moment a create is rejected or the
                    // session resumes with a task list already at 1..N.
                    pendingTaskCreates = new Map(pendingTaskCreates).set(raw.id, pending);
                }
                else {
                    const folded = applyTaskUpdate(raw.name, raw.input, tasks);
                    if (folded) {
                        tasks = folded;
                        events.push({ type: 'plan.updated', entries: [...tasks.values()] });
                    }
                }
            }
            openTools ??= new Map(state.openTools);
            openTools.set(raw.id, item);
        }
        // Unknown block types (redacted_thinking, server_tool_use, …): ignored.
    }
    if (events.length === 0)
        return { events, state };
    return {
        events,
        state: { ...state, itemSeq, openTools: openTools ?? state.openTools, tasks, pendingTaskCreates, sawAssistantText },
    };
}
/** claude `Edit`/`Write` inputs carry the diff inline (§7.1). */
function editArtifacts(name, input) {
    const key = name.toLowerCase();
    if (key !== 'edit' && key !== 'write')
        return undefined;
    if (!isRecord(input) || typeof input.file_path !== 'string' || input.file_path === '')
        return undefined;
    const path = input.file_path;
    const locations = [{ path }];
    if (key === 'edit') {
        if (typeof input.old_string === 'string' && typeof input.new_string === 'string') {
            return { diffs: [{ path, oldText: input.old_string, newText: input.new_string }], locations };
        }
        return { locations };
    }
    // Write: a created (or fully replaced) file — `oldText: null` per FileDiff.
    const diff = { path, oldText: null };
    if (typeof input.content === 'string')
        diff.newText = input.content;
    return { diffs: [diff], locations };
}
const PLAN_STATUSES = ['pending', 'in_progress', 'completed'];
/** `TaskUpdate.status` is `pending | in_progress | completed | deleted`. `deleted`
 *  is handled by the caller — it drops the entry, since PlanStatus has no such
 *  state. `running` is tolerated defensively as an alias for `in_progress`. */
function normalizePlanStatus(value) {
    if (value === 'running')
        return 'in_progress';
    return PLAN_STATUSES.find((status) => status === value);
}
/** `TaskCreate` result: `Task #12 created successfully: Ship it`. The id here is
 *  the harness's own, which is why it — not a count of creates — is the key. */
const TASK_CREATED_RE = /^Task #(\d+) created successfully\b/;
/** `TaskList` line: `#12 [in_progress] Ship it`. */
const TASK_LIST_LINE_RE = /^#(\d+) \[([a-z_]+)\] (.*)$/;
/** A `TaskCreate` call parked until its result reveals the harness id, or
 *  `undefined` when this is not a renderable create. */
function pendingTaskCreate(name, input) {
    if (name.toLowerCase() !== 'taskcreate')
        return undefined;
    // `subject` is required by the schema; without one there is nothing to render.
    if (!isRecord(input) || typeof input.subject !== 'string')
        return undefined;
    const content = input.subject.trim();
    if (content === '')
        return undefined;
    const entry = { content, status: 'pending' };
    if (typeof input.activeForm === 'string' && input.activeForm !== '')
        entry.activeForm = input.activeForm;
    return entry;
}
/** Land a parked create under the id the harness reported. A result that does
 *  not confirm creation (the tool errored, or the wording changed) drops the
 *  entry rather than inventing an id for it. */
function applyTaskCreateResult(entry, resultText, tasks) {
    const id = TASK_CREATED_RE.exec(resultText.trim())?.[1];
    if (id === undefined)
        return undefined;
    return new Map(tasks).set(id, entry);
}
/** Rebuild the plan from a `TaskList` result — the only wire message carrying
 *  the harness's whole task list, and so the one way a resumed session (whose
 *  tasks were created before this mapper existed) recovers them.
 *
 *  Returns `undefined` unless every non-blank line parses: a partial parse of an
 *  unrecognized format would silently drop live rows. `TaskList` omits
 *  `activeForm`, so it is carried over from the entry already held for that id. */
function applyTaskListResult(resultText, tasks) {
    const lines = resultText.split('\n').map((line) => line.trim()).filter((line) => line !== '');
    if (lines.length === 0)
        return undefined;
    const next = new Map();
    for (const line of lines) {
        const match = TASK_LIST_LINE_RE.exec(line);
        if (!match)
            return undefined;
        const [, id, rawStatus, rawSubject] = match;
        const status = normalizePlanStatus(rawStatus);
        const content = (rawSubject ?? '').trim();
        if (id === undefined || status === undefined || content === '')
            return undefined;
        const entry = { content, status };
        const activeForm = tasks.get(id)?.activeForm;
        if (activeForm !== undefined)
            entry.activeForm = activeForm;
        next.set(id, entry);
    }
    return next;
}
/** Fold one `TaskUpdate` into the plan. Its `taskId` is already the harness's
 *  own id, so it applies at call time; an id this mapper never saw created is
 *  dropped (a resumed session's pre-existing tasks land via `TaskList`). */
function applyTaskUpdate(name, input, tasks) {
    if (name.toLowerCase() !== 'taskupdate')
        return undefined;
    if (!isRecord(input))
        return undefined;
    const id = typeof input.taskId === 'string'
        ? input.taskId
        : typeof input.taskId === 'number'
            ? String(input.taskId)
            : undefined;
    if (id === undefined)
        return undefined;
    const existing = tasks.get(id);
    if (existing === undefined)
        return undefined;
    // `deleted` removes the task outright ("permanently removes the task"). The
    // harness does not renumber what is left, so surviving ids stay valid.
    if (input.status === 'deleted') {
        const next = new Map(tasks);
        next.delete(id);
        return next;
    }
    const entry = { ...existing };
    let changed = false;
    const status = normalizePlanStatus(input.status);
    if (status !== undefined && status !== existing.status) {
        entry.status = status;
        changed = true;
    }
    if (typeof input.subject === 'string') {
        const content = input.subject.trim();
        if (content !== '' && content !== existing.content) {
            entry.content = content;
            changed = true;
        }
    }
    // An empty activeForm would blank the dock's label exactly while the row is
    // in progress, so it is ignored like an empty subject.
    if (typeof input.activeForm === 'string' && input.activeForm !== '' && input.activeForm !== existing.activeForm) {
        entry.activeForm = input.activeForm;
        changed = true;
    }
    if (!changed)
        return undefined;
    return new Map(tasks).set(id, entry);
}
/** TodoWrite input `{todos:[{content,status,activeForm}]}` → plan entries
 *  (full-replacement semantics — an empty list is a valid plan). */
function planEntries(input) {
    if (!isRecord(input) || !Array.isArray(input.todos))
        return undefined;
    const entries = [];
    for (const todo of input.todos) {
        if (!isRecord(todo) || typeof todo.content !== 'string')
            continue;
        const status = PLAN_STATUSES.find((s) => s === todo.status);
        if (status === undefined)
            continue;
        const entry = { content: todo.content, status };
        if (typeof todo.activeForm === 'string')
            entry.activeForm = todo.activeForm;
        entries.push(entry);
    }
    return entries;
}
// ---- user tool_result blocks → item.completed (+ image events) -------------
function mapToolResults(msg, state) {
    const content = messageContent(msg);
    const parentItemId = str(msg.parent_tool_use_id);
    const events = [];
    let openTools = null;
    let tasks = state.tasks;
    let pendingTaskCreates = state.pendingTaskCreates;
    for (const raw of content) {
        if (!isRecord(raw) || raw.type !== 'tool_result' || typeof raw.tool_use_id !== 'string')
            continue;
        const open = (openTools ?? state.openTools).get(raw.tool_use_id);
        // A result for a tool we never saw start (state loss) still completes an
        // item — consumers upsert by id, so a lone snapshot renders fine.
        const item = open
            ? { ...open }
            : { kind: 'tool', id: raw.tool_use_id, name: 'unknown', toolKind: 'other', title: 'Tool', status: 'running' };
        if (!open && parentItemId !== undefined)
            item.parentItemId = parentItemId;
        const text = stringifyToolResultContent(raw.content);
        if (raw.is_error === true) {
            item.status = 'failed';
            item.error = text;
        }
        else {
            item.status = 'completed';
            item.output = text;
        }
        events.push({ type: 'item.completed', item });
        for (const img of toolResultImageBlocks(raw.content)) {
            events.push({ type: 'image', itemId: raw.tool_use_id, mediaType: img.media_type, data: img.data });
        }
        // The task tools report their outcome only as result text — `is_error` stays
        // unset even for a rejected update ("Task not found"), so the text is the
        // only signal there is.
        const parked = pendingTaskCreates.get(raw.tool_use_id);
        if (parked !== undefined) {
            const next = new Map(pendingTaskCreates);
            next.delete(raw.tool_use_id);
            pendingTaskCreates = next;
            if (raw.is_error !== true) {
                const landed = applyTaskCreateResult(parked, text, tasks);
                if (landed) {
                    tasks = landed;
                    events.push({ type: 'plan.updated', entries: [...tasks.values()] });
                }
            }
            // `parentItemId` here mirrors the call-side subagent guard: a subagent's
            // list describes its own tasks, so it must not rewrite the main plan.
        }
        else if (open?.name.toLowerCase() === 'tasklist' &&
            open.parentItemId === undefined &&
            raw.is_error !== true) {
            const resynced = applyTaskListResult(text, tasks);
            if (resynced && !samePlan(resynced, tasks)) {
                tasks = resynced;
                events.push({ type: 'plan.updated', entries: [...tasks.values()] });
            }
        }
        openTools ??= new Map(state.openTools);
        openTools.delete(raw.tool_use_id);
    }
    if (events.length === 0)
        return { events, state };
    return { events, state: { ...state, openTools: openTools ?? state.openTools, tasks, pendingTaskCreates } };
}
/** Whether a `TaskList` resync would change the rendered plan — it usually just
 *  restates what the mapper already has, and re-emitting is pure dock churn. */
function samePlan(a, b) {
    if (a.size !== b.size)
        return false;
    for (const [id, entry] of a) {
        const other = b.get(id);
        if (other === undefined ||
            other.content !== entry.content ||
            other.status !== entry.status ||
            other.activeForm !== entry.activeForm) {
            return false;
        }
    }
    return true;
}
// ---- result → declined tools + turn.completed + usage.updated --------------
function mapResult(msg, state) {
    const events = [];
    let itemSeq = state.itemSeq;
    let turnSeq = state.turnSeq;
    let openTools = null;
    if (Array.isArray(msg.permission_denials)) {
        for (const raw of msg.permission_denials) {
            if (!isRecord(raw) || typeof raw.tool_name !== 'string')
                continue;
            const id = typeof raw.tool_use_id === 'string' ? raw.tool_use_id : `item_${++itemSeq}`;
            const open = (openTools ?? state.openTools).get(id);
            let item;
            if (open) {
                item = { ...open, status: 'declined' };
                openTools ??= new Map(state.openTools);
                openTools.delete(id);
            }
            else {
                const display = toolDisplay(raw.tool_name, raw.tool_input);
                item = {
                    kind: 'tool',
                    id,
                    name: raw.tool_name,
                    toolKind: display.toolKind,
                    title: display.title,
                    status: 'declined',
                };
                if (raw.tool_input !== undefined)
                    item.input = raw.tool_input;
            }
            events.push({ type: 'item.completed', item });
        }
    }
    // The result fallback, mirroring claude-cli-runner.ts's `textChunks.length === 0`
    // branch: a session that streamed no assistant text block carries its whole
    // reply on `msg.result`. The runner emits a v1 `text` for it; without the v2
    // twin below, the cockpit's per-turn "v2 wins" dedup drops that line and the
    // turn renders tool cards with no prose at all.
    let sawAssistantText = state.sawAssistantText;
    if (!sawAssistantText && typeof msg.result === 'string' && msg.result !== '') {
        sawAssistantText = true;
        const item = {
            kind: 'message',
            id: `item_${++itemSeq}`,
            role: 'assistant',
            text: msg.result,
        };
        events.push({ type: 'item.started', item }, { type: 'item.completed', item });
    }
    const turnId = state.currentTurnId ?? `turn_${++turnSeq}`;
    const usage = rawTokenUsage(msg.usage);
    const costUsd = typeof msg.total_cost_usd === 'number' && Number.isFinite(msg.total_cost_usd)
        ? msg.total_cost_usd
        : undefined;
    const turnEvent = { type: 'turn.completed', turnId, stopReason: resultStopReason(msg) };
    if (usage)
        turnEvent.usage = usage;
    if (costUsd !== undefined)
        turnEvent.costUsd = costUsd;
    events.push(turnEvent);
    if (usage) {
        const usageEvent = { type: 'usage.updated', usage };
        if (costUsd !== undefined)
            usageEvent.costUsd = costUsd;
        events.push(usageEvent);
    }
    return {
        events,
        state: {
            ...state,
            itemSeq,
            turnSeq,
            currentTurnId: null,
            openTools: openTools ?? state.openTools,
            sawAssistantText,
        },
    };
}
/** §7.1: success→end_turn, error_max_turns→max_tokens,
 *  error_during_execution→error; unknown subtypes fall back on `is_error`. */
function resultStopReason(msg) {
    switch (msg.subtype) {
        case 'success':
            return 'end_turn';
        case 'error_max_turns':
            return 'max_tokens';
        case 'error_during_execution':
            return 'error';
        default:
            return msg.is_error === true ? 'error' : 'end_turn';
    }
}
/** Raw counts straight off the wire — never cost-weighted (that stays a
 *  presentation concern; v1's `token-usage` keeps the weighted number). */
function rawTokenUsage(usage) {
    if (!isRecord(usage))
        return undefined;
    const input = num(usage.input_tokens) ?? 0;
    const output = num(usage.output_tokens) ?? 0;
    const cacheRead = num(usage.cache_read_input_tokens);
    const cacheWrite = num(usage.cache_creation_input_tokens);
    const result = {
        input,
        output,
        total: input + output + (cacheRead ?? 0) + (cacheWrite ?? 0),
    };
    if (cacheRead !== undefined)
        result.cacheRead = cacheRead;
    if (cacheWrite !== undefined)
        result.cacheWrite = cacheWrite;
    return result;
}
// ---- shared wire helpers (also used by the v1 path in the runner) ----------
/** Flatten a `tool_result.content` (string or block array) to display text.
 *  Image blocks become a placeholder — they ride as their own events. */
export function stringifyToolResultContent(content) {
    if (typeof content === 'string')
        return content;
    if (Array.isArray(content)) {
        return content
            .map((c) => {
            const b = c;
            if (b.type === 'text' && typeof b.text === 'string')
                return b.text;
            if (b.type === 'image')
                return '[screenshot]'; // emitted as its own image event
            try {
                return JSON.stringify(b);
            }
            catch {
                return String(b);
            }
        })
            .join('\n');
    }
    try {
        return JSON.stringify(content);
    }
    catch {
        return String(content);
    }
}
/** base64 image blocks inside a tool_result's content, if any. */
export function toolResultImageBlocks(content) {
    if (!Array.isArray(content))
        return [];
    const out = [];
    for (const c of content) {
        const b = c;
        if (b.type === 'image' && b.source?.type === 'base64' && b.source.media_type && b.source.data) {
            out.push({ media_type: b.source.media_type, data: b.source.data });
        }
    }
    return out;
}
// ---- tiny guards ------------------------------------------------------------
function isRecord(value) {
    return typeof value === 'object' && value !== null && !Array.isArray(value);
}
function messageContent(msg) {
    const message = isRecord(msg.message) ? msg.message : undefined;
    return message && Array.isArray(message.content) ? message.content : [];
}
function str(value) {
    return typeof value === 'string' && value !== '' ? value : undefined;
}
function num(value) {
    return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
}
//# sourceMappingURL=claude-ui-mapper.js.map