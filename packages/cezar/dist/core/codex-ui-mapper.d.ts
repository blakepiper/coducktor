/**
 * Pure codex app-server JSON-RPC → protocol-v2 mapper. `mapCodexNotification`
 * folds one parsed JSONL frame into `UiEvent`s plus the next mapper state;
 * the runner calls it ALONGSIDE the v1 path (v1 events keep flowing
 * unchanged).
 *
 * Contract: `.ai/analysis/cockpit-ui-redesign/agent-event-protocols.md` §3
 * (wire format) and §7.1 "Codex (app-server)" (the mapping). Golden fixtures
 * replaying wire-faithful frame sequences live in `__fixtures__/codex/`.
 *
 * Robustness rule: input is untrusted wire data — the mapper never throws;
 * responses, server→client requests (handled by the session transport) and
 * unknown methods map to zero events.
 *
 * State is explicit and treated as immutable: callers thread the returned
 * `state` into the next call. Ids are deterministic — codex items and turns
 * carry stable wire ids which are reused verbatim (`turn_<n>` is minted only
 * when a turn frame arrives without one) — so replaying a stored transcript
 * reproduces the exact event sequence.
 *
 * Status map (§7.1, kills v1's regex-on-status hack): `inProgress→running`,
 * `completed→completed`, `failed→failed`, `declined→declined`.
 */
import type { TokenUsage, UiEvent } from './ui-events.ts';
/** The two reasoning delta channels, accumulated separately — see
 *  `CodexUiMapperState.reasonings`. */
export interface ReasoningAccumulator {
    /** `item/reasoning/textDelta` — the raw chain of thought. */
    readonly text: string;
    /** `item/reasoning/summaryDelta` + `summaryTextDelta` — the condensed summary. */
    readonly summary: string;
}
interface CodexCollabTask {
    readonly itemId: string;
    readonly prompt?: string;
    readonly model?: string;
}
export interface CodexUiMapperState {
    /** True once `session.started` was emitted (thread/started notification or
     *  the runner's `codexSessionStarted` after the thread/start result —
     *  whichever lands first wins; the other is deduplicated). */
    readonly sessionStarted: boolean;
    /** Fallback counter for turn frames that arrive without a wire turn id. */
    readonly turnSeq: number;
    readonly currentTurnId: string | null;
    /** Fresh `tokenUsage.last` received while the current turn is active.
     * Consumed exactly once by its matching turn end; cumulative `total` is
     * never used as a persisted per-turn delta. */
    readonly pendingTurnUsage: TokenUsage | null;
    /** Item ids already introduced — a delta for an unknown id synthesizes an
     *  `item.started` first so consumers always have something to upsert. */
    readonly knownItems: ReadonlySet<string>;
    /** Accumulated `outputDelta` text per commandExecution item, attached to
     *  the final snapshot when the wire `item/completed` carries no output. */
    readonly outputs: ReadonlyMap<string, string>;
    /** Accumulated reasoning deltas per reasoning item, attached to the final
     *  snapshot when the wire `item/completed` carries no `content`. Deltas are
     *  live-only (never persisted), so without this the reasoning text is
     *  unrecoverable on replay and the row reads back empty (#528).
     *
     *  Kept PER CHANNEL: `item/reasoning/textDelta` streams the raw chain of
     *  thought while `summaryDelta`/`summaryTextDelta` stream the condensed
     *  summary, and codex emits both when raw reasoning is enabled. One shared
     *  bucket would concatenate the two into `"<raw CoT><summary>"` and persist
     *  that garble over the clean wire `summary`.
     *
     *  Turn-scoped, and reset by `turn/started`: an interrupted item is never
     *  completed, so without the reset its text would both leak into a later
     *  turn that reuses the id and pin whole chains of thought in memory. */
    readonly reasonings: ReadonlyMap<string, ReasoningAccumulator>;
    /** True once `turn/plan/updated` has spoken IN THE CURRENT TURN. Both that
     *  notification and the `plan`/`todoList` item arm write `plan.updated`, so
     *  without a precedence rule the last frame wins and a prose plan item would
     *  flatten the real checklist into one entry. The authoritative channel
     *  latches this and the item arm stands down (see `mapItemLifecycle`).
     *
     *  Turn-scoped, and reset by `turn/started`: a plan belongs to a turn (hence
     *  `turn/plan/updated`), so a latch that outlived its turn would gag the item
     *  arm for the rest of the session and strand the dock on a stale checklist. */
    readonly planFromNotification: boolean;
    /** The open review-mode item's id, or `null` when review mode is not active.
     *
     *  Codex announces review mode as two disjoint frames (`enteredReviewMode`,
     *  `exitedReviewMode`) with different ids. Mapped literally that is two
     *  childless `task` items — which the Agents dock would read as two separate
     *  sub-agents that each did nothing (spec
     *  `.ai/specs/2026-07-20-grouped-subagent-display.md` §"Codex-mapper fix",
     *  #474). This latch folds the pair into ONE item with a running→completed
     *  lifecycle: the entered frame opens it, the exited frame completes that
     *  same id. An unpaired exit falls back to its own item, so a stream that
     *  starts mid-review still renders. */
    readonly reviewItemId: string | null;
    /** Child thread → stable task item created by a Codex collaboration spawn.
     * Installed 0.144.6 uses `collabAgentToolCall`; newer protocol revisions use
     * `collabToolCall`. Both carry the receiver ids used for child attribution. */
    readonly collabTasks: ReadonlyMap<string, CodexCollabTask>;
}
export interface CodexUiMapping {
    events: UiEvent[];
    state: CodexUiMapperState;
}
export declare function createCodexUiState(): CodexUiMapperState;
/**
 * Codex confirms the thread via the `thread/start`/`thread/resume` RESULT
 * (a response frame the mapper cannot attribute), so the runner calls this
 * once the thread id is known. Deduplicated against the `thread/started`
 * notification — whichever arrives first emits `session.started`.
 */
export declare function codexSessionStarted(threadId: string, state: CodexUiMapperState): CodexUiMapping;
/** Fold one parsed JSON-RPC frame into v2 events. Never throws. */
export declare function mapCodexNotification(frame: unknown, state: CodexUiMapperState): CodexUiMapping;
export {};
