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
import type { PlanEntry, UiEvent, UiToolItem } from './ui-events.ts';
export interface ClaudeUiMapperState {
    /** Used when `system/init` lacks `session_id` (the dry-run mock does). */
    readonly fallbackSessionId?: string;
    /** True once `system/init` produced `session.started`. */
    readonly sessionStarted: boolean;
    /** Turns begun before init arrived — their `turn.started` is queued so
     *  `session.started` stays the first event on the wire. */
    readonly pendingTurnIds: readonly string[];
    readonly turnSeq: number;
    readonly currentTurnId: string | null;
    readonly itemSeq: number;
    /** True once any assistant `text` block minted a message item. SESSION-scoped,
     *  never reset per turn — it mirrors `ctx.textChunks` in claude-cli-runner.ts,
     *  which is allocated once per `runAgent` and accumulates across turns. When a
     *  session streams no text block at all, the runner falls back to emitting the
     *  v1 `text` from `msg.result` (`textChunks.length === 0`), and `mapResult`
     *  must mint the v2 twin under the SAME guard — otherwise that prose exists
     *  only in v1 and the cockpit's "v2 wins per turn" dedup drops it with no
     *  replacement, which is exactly the vanishing-message bug. */
    readonly sawAssistantText: boolean;
    /** `tool_use` items awaiting their `tool_result`, keyed by tool_use id. */
    readonly openTools: ReadonlyMap<string, UiToolItem>;
    /** The running plan built incrementally by Claude's task tools, keyed by the
     *  task id the harness assigned — read from the `TaskCreate` result, never
     *  guessed (see `applyTaskCreateResult`). */
    readonly tasks: ReadonlyMap<string, PlanEntry>;
    /** `TaskCreate` calls whose result has not arrived yet, keyed by tool_use id.
     *  The entry parks here until the result reveals its real id. */
    readonly pendingTaskCreates: ReadonlyMap<string, PlanEntry>;
}
export interface ClaudeUiMapping {
    events: UiEvent[];
    state: ClaudeUiMapperState;
}
export declare function createClaudeUiState(opts?: {
    fallbackSessionId?: string;
}): ClaudeUiMapperState;
/**
 * Claude has no wire-level turn-start — the runner writing a user message to
 * stdin IS the turn boundary, so the runner calls this on each send. Until
 * `init` arrives the event is queued (the seed message is written before the
 * first stdout line is read).
 */
export declare function claudeTurnStarted(state: ClaudeUiMapperState): ClaudeUiMapping;
/** Fold one parsed stream-json message into v2 events. Never throws. */
export declare function mapClaudeMessage(msg: unknown, state: ClaudeUiMapperState): ClaudeUiMapping;
/** Flatten a `tool_result.content` (string or block array) to display text.
 *  Image blocks become a placeholder — they ride as their own events. */
export declare function stringifyToolResultContent(content: unknown): string;
/** base64 image blocks inside a tool_result's content, if any. */
export declare function toolResultImageBlocks(content: unknown): Array<{
    media_type: string;
    data: string;
}>;
