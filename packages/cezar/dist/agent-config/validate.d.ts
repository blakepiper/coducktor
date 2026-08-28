import type { ConfigFormat } from './catalog.ts';
/**
 * On save, cezar proves a config file PARSES in its own format — refusing to
 * write bytes that would break the user's agent — but it never checks the
 * vendor's *schema* (that is the drift a raw editor exists to avoid) and it
 * never re-serializes: a valid file is written back byte-for-byte as typed.
 */
export interface ValidationResult {
    ok: boolean;
    /** Human-readable parser message when `ok` is false. */
    error?: string;
}
/**
 * Strip `//` line and slash-star block comments from JSONC, string-aware so a
 * `//` or `/*` inside a JSON string is preserved. Whitespace-preserving (spans
 * are blanked, not removed) so parser error offsets still line up with the
 * source. Only used to validate — the original bytes are what gets written.
 */
export declare function stripJsonComments(input: string): string;
/** Validate `content` against `format`. Markdown is always valid; empty is always valid (a new file). */
export declare function validateConfig(content: string, format: ConfigFormat): ValidationResult;
