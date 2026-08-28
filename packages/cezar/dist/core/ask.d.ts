/**
 * AskUser payload — the structured multiple-choice question an agent asks the
 * user, so the cockpit can render clickable option chips instead of the prose
 * fallback ("AskUserQuestion isn't available…"). See the spec
 * `.ai/specs/2026-07-18-askuser-across-runners.md`.
 *
 * The agent emits this as a `CEZ:ASK <compact-json>` control marker (a sibling
 * of `CEZ:DONE` / `CEZ:MONITORING`), parsed on the assembled turn text in
 * `src/workflows/run.ts` — uniform across claude, codex and opencode with no
 * per-backend mapper work. The shape is modeled 1:1 on Claude Code's built-in
 * `AskUserQuestion` (1–4 questions, 2–4 options each, `header` ≤12 chars,
 * unique question texts and unique option labels) so a native bridge can map
 * onto it later. A free-text "Other" is always available via the composer, so
 * it is never an explicit option.
 */
import { z } from 'zod';
export declare const askOptionSchema: z.ZodObject<{
    label: z.ZodString;
    description: z.ZodOptional<z.ZodString>;
}, z.core.$strict>;
export declare const askQuestionSchema: z.ZodObject<{
    id: z.ZodOptional<z.ZodString>;
    header: z.ZodString;
    question: z.ZodString;
    options: z.ZodArray<z.ZodObject<{
        label: z.ZodString;
        description: z.ZodOptional<z.ZodString>;
    }, z.core.$strict>>;
    multiSelect: z.ZodOptional<z.ZodBoolean>;
}, z.core.$strict>;
export declare const askRequestSchema: z.ZodObject<{
    questions: z.ZodArray<z.ZodObject<{
        id: z.ZodOptional<z.ZodString>;
        header: z.ZodString;
        question: z.ZodString;
        options: z.ZodArray<z.ZodObject<{
            label: z.ZodString;
            description: z.ZodOptional<z.ZodString>;
        }, z.core.$strict>>;
        multiSelect: z.ZodOptional<z.ZodBoolean>;
    }, z.core.$strict>>;
}, z.core.$strict>;
export type AskOption = z.infer<typeof askOptionSchema>;
export type AskQuestion = z.infer<typeof askQuestionSchema>;
export type AskRequest = z.infer<typeof askRequestSchema>;
export interface AskParseIssue {
    code: string;
    path: PropertyKey[];
    message: string;
}
/** The diagnostic parse result used at turn-end. The compatibility wrapper
 * below deliberately keeps returning `AskRequest | null`. */
export type AskMarkerParseResult = {
    kind: 'none';
} | {
    kind: 'invalid-json';
    message: string;
} | {
    kind: 'invalid-structure';
    issues: AskParseIssue[];
} | {
    kind: 'valid';
    request: AskRequest;
    normalized: boolean;
};
/**
 * Parse a value into a validated `AskRequest`, or `null` when it does not match
 * (bad counts, over-length header, non-unique labels/questions, extra keys).
 * Callers degrade to plain text on `null` — the feature never makes the prose
 * fallback worse.
 */
export declare function parseAskRequest(value: unknown): AskRequest | null;
/**
 * The AskUser control marker: a trailing `CEZ:ASK <compact-json>` line (a
 * sibling of `CEZ:DONE` / `CEZ:MONITORING`). Detected on the *assembled* turn
 * text so delta-streaming backends can't split it — uniform across all three
 * backends. The JSON is greedily captured from the first `{` after the keyword
 * to the last `}` at end-of-text.
 */
export declare const ASK_MARKER_RE: RegExp;
/**
 * Parse a trailing marker with an actionable result for diagnostics. A
 * parseable near-valid request gets one bounded normalization pass; structural
 * violations remain rejected so the raw fallback stays readable.
 */
export declare function parseAskMarkerResult(turnText: string): AskMarkerParseResult;
/**
 * Extract and validate a trailing `CEZ:ASK <json>` marker from assembled turn
 * text. Returns a strict or safely normalized `AskRequest`, or `null` when
 * there is no marker or its payload remains invalid (caller degrades to plain
 * text — the prose fallback is never made worse).
 */
export declare function parseAskMarker(turnText: string): AskRequest | null;
/**
 * Strip a trailing `CEZ:ASK <json>` marker from one text event so transcripts
 * stay free of protocol noise — but ONLY when the payload actually validates.
 * An invalid payload never becomes an ask card (`parseAskMarker` → `null`), so
 * stripping it would delete the agent's question from the transcript with
 * nothing to replace it; it stays visible as raw text instead — degraded but
 * answerable (the prose fallback is never made worse). Delta backends may split
 * the marker across events — then it stays visible; detection on the assembled
 * turn text is unaffected (same best-effort caveat as the `CEZ:DONE` /
 * `CEZ:MONITORING` strippers).
 */
export declare function stripAskMarker(text: string): string;
