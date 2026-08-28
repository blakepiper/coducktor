/**
 * Pure opencode SSE-bus → protocol-v2 mapper. `mapOpencodeEvent` folds one
 * parsed `{type, properties}` bus event into `UiEvent`s plus the next mapper
 * state; the runner calls it ALONGSIDE the v1 path (v1 events keep flowing
 * unchanged — including v1's HTTP-response-synthesized `turn-end`; only the
 * v2 stream uses the correct `session.idle` signal, fixing gap §5.9).
 *
 * Contract: `.ai/analysis/cockpit-ui-redesign/agent-event-protocols.md` §4
 * (wire format: Message/Part model, ToolState lifecycle) and §7.1
 * "OpenCode (SSE)" (the mapping). Golden fixtures replaying wire-faithful
 * bus-event sequences live in `__fixtures__/opencode/`.
 *
 * Robustness rule: input is untrusted wire data — the mapper never throws;
 * unknown event/part types map to zero events.
 *
 * State is explicit and treated as immutable: callers thread the returned
 * `state` into the next call. Ids are deterministic — items reuse the wire
 * part ids, turns get `turn_<n>` minted at each prompt POST — so replaying
 * a stored transcript reproduces the exact event sequence.
 *
 * Opencode-specific mechanics baked in:
 *  - text/reasoning parts carry the FULL accumulated text on every update;
 *    a per-part cursor diffs it into true `item.delta`s (a server-provided
 *    `delta` field wins when present — newer servers send it);
 *  - tool parts have the ONLY real `pending` phase of the three backends
 *    (`pending→pending`, `running→running`, `completed→completed`,
 *    `error→failed`);
 *  - the SSE bus is server-wide: parts from a foreign session id are the
 *    active subtask's child session and nest via `parentItemId` (§7.1);
 *    anything foreign outside a subtask scope is dropped.
 */
import type { TokenUsage, ToolStatus, UiEvent } from './ui-events.ts';
/** Per-message telemetry: `message.updated` snapshots (cumulative per
 *  message) and summed `step-finish` increments are tracked separately —
 *  they describe the same accumulation, so the larger total wins and
 *  nothing is double-counted. */
interface MessageUsage {
    readonly info: TokenUsage | null;
    readonly infoCost: number | null;
    readonly steps: TokenUsage | null;
    readonly stepsCost: number | null;
}
interface SubtaskScope {
    readonly id: string;
    readonly title: string;
    readonly input?: unknown;
}
export interface OpencodeUiMapperState {
    /** The main session id (from POST /session) — the SSE bus is server-wide,
     *  so this is what separates our events from a subtask's child session. */
    readonly sessionId: string | null;
    /** True once `opencodeSessionStarted` emitted `session.started`. */
    readonly sessionStarted: boolean;
    readonly turnSeq: number;
    readonly currentTurnId: string | null;
    /** Message ids observed during the active turn. Their latest snapshots are
     * summed once when the matching `session.idle` closes the turn. */
    readonly currentTurnMessageIds: ReadonlySet<string>;
    /** A `session.error` arrived since the turn started → `session.idle`
     *  closes the turn with stopReason 'error' (§7.1). */
    readonly turnErrored: boolean;
    /** messageID → role. Parts carry no role; only assistant parts surface
     *  (the user's own prompt streams as parts over the same feed). */
    readonly msgRoles: ReadonlyMap<string, string>;
    /** Text/reasoning part id → chars already emitted as deltas. */
    readonly cursors: ReadonlyMap<string, number>;
    /** Part ids whose `item.started` was emitted. */
    readonly startedItems: ReadonlySet<string>;
    /** Text/reasoning/patch part ids whose `item.completed` was emitted. */
    readonly endedItems: ReadonlySet<string>;
    /** Tool part id → last emitted status/title (flip + live-title detection). */
    readonly tools: ReadonlyMap<string, {
        status: ToolStatus;
        title: string;
    }>;
    /** Serialized last plan — todowrite snapshots are idempotent, so identical
     *  replacements emit no duplicate `plan.updated`. */
    readonly lastPlanJson: string | null;
    /** Child session id → subtask scope. Foreign parts are attributed only to
     *  their own child session; that session's idle completes the scope. */
    readonly subtasks: ReadonlyMap<string, SubtaskScope>;
    /** Subtask parts do not carry the child session id. Bind one on the first
     *  foreign event only while attribution is unambiguous. */
    readonly unboundSubtasks: readonly SubtaskScope[];
    readonly usageByMessage: ReadonlyMap<string, MessageUsage>;
    /** Last emitted session totals — usage.updated fires only on change. */
    readonly lastUsage: {
        total: number;
        cost: number | null;
    } | null;
}
export interface OpencodeUiMapping {
    events: UiEvent[];
    state: OpencodeUiMapperState;
}
export declare function createOpencodeUiState(): OpencodeUiMapperState;
/**
 * Opencode has no wire-level session-start event — the session is created by
 * the runner's `POST /session`, so the runner calls this once the response
 * carries the id (like codex's out-of-band thread/start result).
 */
export declare function opencodeSessionStarted(sessionId: string, state: OpencodeUiMapperState): OpencodeUiMapping;
/**
 * Opencode has no wire-level turn-start either — the runner POSTing a prompt
 * IS the turn boundary, so the runner calls this on each prompt POST. The
 * matching `turn.completed` comes from the wire `session.idle` (never from
 * the HTTP prompt response — that is v1's known fidelity gap).
 */
export declare function opencodeTurnStarted(state: OpencodeUiMapperState): OpencodeUiMapping;
/** Fold one parsed SSE bus event into v2 events. Never throws. */
export declare function mapOpencodeEvent(evt: unknown, state: OpencodeUiMapperState): OpencodeUiMapping;
export {};
