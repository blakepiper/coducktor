import { z } from 'zod';
/**
 * SSE frame payloads — the only shapes in this contract that are NOT derived from a route.
 *
 * They are delivered over `text/event-stream` (`GET /api/v1/runs/:id/events`, `/api/v1/events`,
 * `/api/v1/workspace/events`), which Hono types as a string body, so `InferResponseType` sees a
 * stream of text and never the frame inside it. That makes the route-parity check in
 * `contract-parity*.test.ts` inapplicable here — but it is no reason to hand-write the TYPE.
 * These are zod like everything else, and `api-types.test.ts` still pins `RunEvent` against the
 * server's own declaration, which is the closest thing to a route that exists for it.
 */
/**
 * One line of a run transcript.
 *
 * Open by design: `type` is a plain string and unknown keys pass through, because the event
 * vocabulary is an APPEND-ONLY on-disk format (BACKWARD_COMPATIBILITY.md §7) that old NDJSON
 * recordings must keep replaying forever. Closing this schema would make a recording written by
 * a newer cezar unreadable by an older one — the opposite of what the format promises.
 */
export declare const runEventSchema: z.ZodObject<{
    seq: z.ZodNumber;
    ts: z.ZodString;
    stepId: z.ZodOptional<z.ZodString>;
    type: z.ZodString;
}, z.core.$loose>;
export type RunEvent = z.infer<typeof runEventSchema>;
/** Fixed protocol-level item count for one progressive transcript page. */
export declare const RUN_HISTORY_PAGE_ITEMS = 100;
export declare const runIdParamSchema: z.ZodObject<{
    id: z.ZodString;
}, z.core.$strip>;
export type RunIdParam = z.infer<typeof runIdParamSchema>;
/** Opaque, short-lived cursor returned by the history API. */
export declare const runHistoryCursorSchema: z.ZodString;
export type RunHistoryCursor = z.infer<typeof runHistoryCursorSchema>;
/** Query accepted by the reverse-paged history endpoint. */
export declare const runHistoryQuerySchema: z.ZodObject<{
    cursor: z.ZodOptional<z.ZodString>;
}, z.core.$strip>;
export type RunHistoryQuery = z.infer<typeof runHistoryQuerySchema>;
/** Additive resume controls for the existing per-run SSE endpoint. */
export declare const runEventsQuerySchema: z.ZodObject<{
    cursor: z.ZodOptional<z.ZodString>;
    afterSeq: z.ZodOptional<z.ZodCoercedNumber<unknown>>;
}, z.core.$strip>;
export type RunEventsQuery = z.infer<typeof runEventsQuerySchema>;
/**
 * Persisted history retains the append-only event vocabulary. The required envelope stays
 * strict; additive payload keys remain open for newer protocol events, matching `RunEvent`.
 * `z.any()` is deliberate here: Hono recursively rewrites `unknown` to its JSON union in a
 * response type, making the schema wider than the route even though every value came from
 * `JSON.parse`; `any` is stable on both sides while the required keys remain exact.
 */
export declare const runHistoryEventSchema: z.ZodObject<{
    seq: z.ZodNumber;
    ts: z.ZodString;
    stepId: z.ZodOptional<z.ZodString>;
    type: z.ZodString;
}, z.core.$catchall<z.ZodAny>>;
export type RunHistoryEvent = z.infer<typeof runHistoryEventSchema>;
export declare const runHistoryPageSchema: z.ZodObject<{
    events: z.ZodArray<z.ZodObject<{
        seq: z.ZodNumber;
        ts: z.ZodString;
        stepId: z.ZodOptional<z.ZodString>;
        type: z.ZodString;
    }, z.core.$catchall<z.ZodAny>>>;
    itemCount: z.ZodNumber;
    olderCursor: z.ZodOptional<z.ZodString>;
    newerCursor: z.ZodOptional<z.ZodString>;
    liveCursor: z.ZodString;
    asOfSeq: z.ZodNumber;
    hasOlder: z.ZodBoolean;
}, z.core.$strip>;
export type RunHistoryPage = z.infer<typeof runHistoryPageSchema>;
export declare const runHistoryContextSchema: z.ZodObject<{
    contextEvents: z.ZodArray<z.ZodObject<{
        seq: z.ZodNumber;
        ts: z.ZodString;
        stepId: z.ZodOptional<z.ZodString>;
        type: z.ZodString;
    }, z.core.$catchall<z.ZodAny>>>;
    asOfSeq: z.ZodNumber;
}, z.core.$strip>;
export type RunHistoryContext = z.infer<typeof runHistoryContextSchema>;
/**
 * One `checkout-progress` workspace frame (multi-project spec, step 4.3).
 *
 * `cloning` carries a single line of `git clone` output; `done` and `error` are terminal. The
 * clone dialog renders `error` VERBATIM — a clone fails for reasons (auth, network, a mistyped
 * repo) that only the server can name.
 */
export declare const checkoutProgressEventSchema: z.ZodObject<{
    checkoutId: z.ZodOptional<z.ZodString>;
    name: z.ZodString;
    phase: z.ZodEnum<{
        cloning: "cloning";
        done: "done";
        error: "error";
    }>;
    line: z.ZodOptional<z.ZodString>;
    error: z.ZodOptional<z.ZodString>;
}, z.core.$strip>;
export type CheckoutProgressEvent = z.infer<typeof checkoutProgressEventSchema>;
