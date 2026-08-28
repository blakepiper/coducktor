/**
 * Per-item coalescing of streamed assistant text into whole v1 `text` events.
 *
 * The v1 `AgentEvent` contract treats `text` as a complete assistant block —
 * that is what claude emits, what the RunManager persists one NDJSON line per
 * event, and what every consumer renders as one paragraph (cockpit thread,
 * headless CLI). Codex and opencode stream deltas, so emitting each delta as
 * its own `text` event persisted one line per token: transcripts rendered one
 * paragraph per token, and turn-end markers split across deltas (`CE`+`Z`+
 * `:D`+`ONE`) slipped past the server's per-event marker stripping.
 *
 * Streaming display does not go through v1 at all — protocol v2's
 * `item.delta` (coalesced by `UiEventSink`) carries it — so v1 can afford
 * whole-block granularity.
 */
export declare class V1TextCoalescer {
    private readonly emitText;
    /** Accumulated deltas per open item. Deltas with no item id share the ''
     *  bucket (at most one anonymous item streams at a time). */
    private readonly pending;
    /** Items already emitted — a late snapshot/delta must not double-emit. */
    private readonly done;
    constructor(emitText: (text: string) => void);
    /** Buffer one streamed delta of an item. */
    append(itemId: string | undefined, delta: string): void;
    /**
     * The item is final: emit its text exactly once — the wire snapshot when the
     * backend sent one (authoritative full text), else the accumulated deltas.
     */
    complete(itemId: string | undefined, snapshotText?: string): void;
    /** Turn/session boundary: emit whatever never saw its item complete, in
     *  arrival order, so interrupted turns still surface their partial prose.
     *  The `done` latch survives on purpose — item/part ids are unique per
     *  session, and a re-sent snapshot after the boundary must not re-emit. */
    flush(): void;
}
