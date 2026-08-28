/**
 * Tool display model — the api-client's mirror of `src/core/tool-display.ts`,
 * computed ONCE in the protocol layer so the thread, activity groups and
 * notifications all say the same thing.
 *
 * Still a mirror rather than a shared import, for the reason this package
 * exists: `src/core/tool-display.ts` sits in the server's NodeNext program,
 * and reaching into it would couple every consumer of this package to that
 * module graph. The mirror is *checked*, not trusted, twice over:
 * `src/server/api-types.test.ts` guards the types, and
 * `src/server/tool-display-mirror.test.ts` runs BOTH implementations over a
 * representative input table and asserts identical outputs, so a behavior
 * drift fails `npm test` rather than making the web say something different
 * from the server about the same tool call.
 *
 * Relative imports here name the real `.ts` file. `rewriteRelativeImportExtensions`
 * turns them into `.js` on the way into `dist`, so the published package still
 * resolves in plain Node — nobody has to write a specifier that points at a file
 * that does not exist.
 *
 * Pure function over untrusted input: tool inputs come off the wire and may
 * be null, partial (streamed incrementally) or arbitrarily malformed —
 * `toolDisplay` must never throw.
 *
 * Known Codex items include commandExecution, contextCompaction, fileChange,
 * imageView, mcpToolCall, webSearch and plan.
 */
import type { ToolKind } from './ui-events.ts';
export interface ToolDisplay {
    toolKind: ToolKind;
    /** Human line for the card trigger, e.g. "Ran npm test". */
    title: string;
    /** Secondary detail, e.g. the claude Bash `description`. */
    subtitle?: string;
}
export declare function toolDisplay(name: string, input?: unknown): ToolDisplay;
