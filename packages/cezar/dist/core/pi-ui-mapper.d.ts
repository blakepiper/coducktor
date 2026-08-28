/**
 * Pure pi RPC → normalized protocol-v2 mapper.
 *
 * Contract: https://github.com/badlogic/pi-mono/blob/main/packages/coding-agent/docs/rpc.md
 * Unknown or malformed wire data is ignored; this mapper never throws.
 */
import type { StopReason, TokenUsage, UiEvent, UiToolItem } from './ui-events.js';
export interface PiUiMapperState {
    readonly sessionStarted: boolean;
    readonly sessionId: string | null;
    readonly turnSeq: number;
    readonly turnId: string | null;
    readonly stopReason: StopReason;
    /**
     * The usage pi reported for the turn currently in flight, held between `message_end` (which
     * carries it) and `agent_settled` (which ends the turn).
     *
     * pi splits the two the way claude does not: its terminal frame has no usage of its own, so
     * without this the `turn.completed` event would ship without the per-turn directional counts
     * every other backend emits — a parity capability, not a nicety (`ui-parity.test.ts`).
     */
    readonly turnUsage: TokenUsage | null;
    readonly turnCostUsd: number | null;
    readonly startedItems: ReadonlySet<string>;
    readonly textByItem: ReadonlyMap<string, string>;
    readonly tools: ReadonlyMap<string, UiToolItem>;
}
export interface PiUiMapping {
    events: UiEvent[];
    state: PiUiMapperState;
}
export declare function createPiUiState(): PiUiMapperState;
export declare function piTurnStarted(state: PiUiMapperState): PiUiMapping;
export declare function mapPiRpcMessage(value: unknown, state: PiUiMapperState): PiUiMapping;
