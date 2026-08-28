/**
 * PR/issue-number extraction from a task prompt (spec 2026-07-17-task-auto-naming,
 * step 0): the always-available programmatic layer under the LLM namer. Pure and
 * synchronous — it runs inline at `startRun` and its result both prefixes the
 * heuristic title and cross-checks the namer's structured output (the regex wins
 * every disagreement).
 */
export interface TaskRefs {
    prNumber?: number;
    issueNumber?: number;
    /** A number present in the task whose kind (PR vs issue) is not determinable —
     *  a bare `469` argument or a plain `#469`. Still usable as a title prefix. */
    ambiguousNumber?: number;
}
export declare const MAX_REF = 10000000;
/** First match wins per kind, scanning the whole prompt. */
export declare function extractTaskRefs(task: string): TaskRefs;
/** The single number worth prefixing a title with, strongest kind first. */
export declare function titleRefNumber(refs: TaskRefs): number | undefined;
/**
 * Skill-aware disambiguation for a bare number: `469` handed to a *-review-pr
 * skill is a PR; handed to a *-fix-issue skill it is an issue. Only upgrades
 * `ambiguousNumber` — explicit URL/worded matches are never overridden.
 */
export declare function refineTaskRefs(refs: TaskRefs, skillName?: string): TaskRefs;
