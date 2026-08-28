/**
 * In-band task-reference markers (spec 2026-07-18-task-ref-markers): the main
 * agent thread declares its subject PR/issue — and optionally a title — the
 * same way it declares completion with `CEZ:DONE`. Parsed from the accumulated
 * turn text only (the agent's own words, never tool output), so a task that
 * merely *reads* the marker contract cannot poison its record. Marker values
 * outrank the fuzzy discovery layers; precedence lives in the spec's table.
 */
export interface TaskMarkers {
    pr?: number;
    issue?: number;
    title?: string;
}
/** The turn's declared references. The last occurrence of each marker wins —
 *  an agent that corrects itself mid-turn is believed, not averaged. Within a
 *  turn, an explicit CEZ:* declaration outranks a report-tier line, which
 *  outranks the legacy env-style markers. */
export declare function parseTaskMarkers(text: string): TaskMarkers;
/**
 * Remove complete marker lines from display text — the `stripDoneMarker`
 * precedent. Only `CEZ:*` control lines are stripped: the report-tier
 * reference lines (`PR: #12 (link: …)`) are human-readable by design and
 * stay visible. Best-effort by design: a marker split across streamed v1 chunks
 * may transiently render; parsing always runs on the whole turn text, so the
 * record is never affected. Mirrored for v2 display in the cockpit's
 * `thread-state.ts`.
 */
export declare function stripTaskMarkers(text: string): string;
