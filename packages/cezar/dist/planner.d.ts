import { z } from 'zod';
import { type WorkflowStepDef } from './workflows/types.ts';
export interface PlanResult {
    /** The proposed workflow title (kebab-case slug), when the planner named one. The auto chain
     *  creator pre-fills the builder's name field with it. Absent on the degraded fallback. */
    name?: string;
    steps: WorkflowStepDef[];
    rationale: string;
    /** True when this is the degraded one-step quick-task plan. */
    fallback: boolean;
}
export declare function planChain(repoRoot: string, task: string): Promise<PlanResult>;
export declare function slugify(name: string): string;
/**
 * The proposed workflow title, normalized to the same kebab-case slug the builder saves as a
 * file name — so what the auto chain creator pre-fills is already a valid workflow name. A blank
 * or slug-less title (e.g. all punctuation) answers undefined, and the caller keeps the current
 * name instead of blanking it.
 */
export declare function proposeWorkflowName(raw: string | undefined): string | undefined;
/**
 * Best-effort structured-output extraction (trimmed from @cezar/core's
 * `parseStructured`): try the whole string after stripping a ```json fence,
 * then scan for balanced top-level `{...}` blocks and return the first that
 * validates. Null when nothing does — the caller decides how to recover.
 */
export declare function parseStructured<T>(raw: string, schema: z.ZodType<T, unknown>): T | null;
