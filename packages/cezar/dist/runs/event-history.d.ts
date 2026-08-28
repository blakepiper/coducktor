import { z } from 'zod';
import { type RunEvent, type RunHistoryContext, type RunHistoryEvent, type RunHistoryPage } from '../contract/index.js';
declare const pageCursorSchema: z.ZodObject<{
    v: z.ZodLiteral<1>;
    kind: z.ZodLiteral<"page">;
    direction: z.ZodEnum<{
        newer: "newer";
        older: "older";
    }>;
    fileSize: z.ZodNumber;
    boundarySeq: z.ZodNumber;
}, z.core.$strip>;
declare const liveCursorSchema: z.ZodObject<{
    v: z.ZodLiteral<1>;
    kind: z.ZodLiteral<"live">;
    offset: z.ZodNumber;
    boundarySeq: z.ZodNumber;
}, z.core.$strip>;
export declare class HistoryCursorError extends Error {
    readonly status: 400 | 409;
    constructor(status: 400 | 409, message: string);
}
export declare function decodePageCursor(cursor: string): z.infer<typeof pageCursorSchema>;
export declare function decodeLiveCursor(cursor: string): z.infer<typeof liveCursorSchema>;
interface CanonicalItem {
    key: string;
    firstSeq: number;
    lastSeq: number;
}
/**
 * Classify the source events into the same protocol-level item units the cockpit renders.
 *
 * Projection always operates on complete collected turns. A v2-covered turn suppresses its v1
 * tool twins; lifecycle snapshots sharing a step/item identity collapse to one item.
 */
export declare function canonicalSessionItems(events: readonly RunEvent[]): CanonicalItem[];
export interface HistoryReadInstrumentation {
    fileSize: number;
    bytesRead: number;
    retainedEvents: number;
}
export declare function readRunHistoryPage(filePath: string, cursor?: string, onRead?: (instrumentation: HistoryReadInstrumentation) => void): Promise<RunHistoryPage>;
/** One forward pass retaining the latest Plan snapshot and only the selector-equivalent agent episode. */
export declare function deriveRunContextEvents(filePath: string): Promise<RunHistoryContext>;
export declare function readEventsAfterLiveCursor(filePath: string, cursor: string): Promise<{
    events: RunHistoryEvent[];
    boundarySeq: number;
}>;
export declare function validateLiveCursor(filePath: string, cursor: string): Promise<void>;
export {};
