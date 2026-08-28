export declare const CACHE_READ_WEIGHT = 0.1;
export declare const CACHE_CREATION_WEIGHT = 1.25;
/** A loosely-typed usage record as emitted by the claude CLI stream. */
export interface RawUsage {
    input_tokens?: number;
    output_tokens?: number;
    cache_creation_input_tokens?: number;
    cache_read_input_tokens?: number;
}
/** Collapse a raw usage record into a single cost-weighted token count. */
export declare function costWeightedTokens(usage: RawUsage | undefined | null): number;
