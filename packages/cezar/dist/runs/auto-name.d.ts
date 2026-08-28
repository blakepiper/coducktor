import { type TaskRefs } from './task-refs.ts';
/**
 * The one-shot LLM namer (spec 2026-07-17-task-auto-naming): turns a task's
 * INTENT — skill + arguments + prompt + PR/issue context, never the agent's
 * streamed words — into a short `<number>: <gerund phrase>` display title with
 * structured, regex-cross-checked PR/issue numbers. Mirrors the planner (spec
 * 008): `[cez-namer]` dry-run marker, strict JSON, never blocks, never fails a
 * run. This module is the pure half; the runner call lives in `generateRunName`.
 */
export declare const NAMER_TIMEOUT_MS = 20000;
/** Title budget in code points — the tasks table shows ~20-25 chars, 40 is the hard cap. */
export declare const TITLE_MAX = 40;
/**
 * Master switch for ALL LLM naming (creation-time and live refresh):
 * `CEZ_AUTONAME=0` kills it outright; under `CEZ_DRY_RUN=1` naming is off by
 * default too (the mock's canned title would REPLACE honest heuristic titles
 * in demos and e2e) unless `CEZ_AUTONAME=1` forces it — the hook the dry-run
 * naming tests use.
 */
export declare function autoNamingActive(env?: NodeJS.ProcessEnv): boolean;
/**
 * Live title updates switch (owner decision on PR #479 — deliberately ON by
 * default, deviating from the cost-opt-in house rule; cost is bounded by the
 * cheap `namerModel`, one call per turn end, and the skip conditions in
 * `RunManager.recordTurnEnd`). Precedence: `config.liveTitleUpdates` (the
 * Settings toggle) wins over the `CEZ_TITLE_UPDATES` env default (`'0'` = off)
 * wins over the built-in ON.
 */
export declare function liveTitleUpdatesEnabled(config: {
    liveTitleUpdates?: boolean;
}, env?: NodeJS.ProcessEnv): boolean;
export declare const NAMER_SYSTEM_PROMPT: string;
export interface NamerContext {
    task: string;
    skillName?: string;
    skillDescription?: string;
    /** Live refresh only (spec step 3): the just-finished turn's text. */
    turnText?: string;
    /** Live refresh only: current `git diff --shortstat` line. */
    diffStat?: string;
}
export interface NameResult {
    titleSummary: string;
    prNumber?: number;
    issueNumber?: number;
}
/** The `[cez-namer]` marker lets the CEZ_DRY_RUN mock recognize a naming call. */
export declare function buildNamerPrompt(ctx: NamerContext): string;
/**
 * Anti-hallucination cross-check: the model's `pr`/`issue` is accepted only
 * when the regex layer agrees or the number literally occurs in the task text;
 * on any disagreement the regex wins. The regex's own explicit findings always
 * carry through, so a lying model can add nothing and remove nothing.
 */
export declare function crossCheckRefs(raw: {
    pr?: number;
    issue?: number;
}, task: string, refs: TaskRefs): {
    prNumber?: number;
    issueNumber?: number;
};
/** Enforce the title contract regardless of what the model produced. */
export declare function postValidateTitle(title: string, refNumber?: number): string;
/**
 * The one-shot runner call: never throws, never blocks a run — every failure
 * path (runner error, timeout, junk twice) answers null and the caller keeps
 * the heuristic title. `namerModel` is a Claude alias, so it is passed only
 * when the namer runs on Claude (the `plannerModel` precedent).
 */
export declare function generateRunName(repoRoot: string, ctx: NamerContext): Promise<NameResult | null>;
/**
 * Raw model text → validated NameResult, or null when the answer is junk
 * (caller retries once, then keeps the heuristic title).
 */
export declare function composeNameResult(rawText: string, ctx: NamerContext): NameResult | null;
