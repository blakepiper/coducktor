import { z } from 'zod';
import { type RunnerSelection } from '../core/runner-selection.ts';
/**
 * A workflow is an ordered list of steps. Two step kinds:
 *  - `agent` — one claude CLI run (prompt + optional skill + model + tools);
 *  - `check` — a shell command; exit 0 passes, non-zero can loop back to an
 *    earlier step via `onFail` (bounded by `max`).
 *
 * `{{task}}` in a prompt is replaced with the user's task text. When a check
 * loops back, the failing output is appended to the retried agent's prompt.
 */
export declare const workflowStepSchema: z.ZodObject<{
    id: z.ZodString;
    name: z.ZodOptional<z.ZodString>;
    prompt: z.ZodOptional<z.ZodString>;
    skill: z.ZodOptional<z.ZodString>;
    model: z.ZodOptional<z.ZodString>;
    runner: z.ZodOptional<z.ZodUnion<readonly [z.ZodEnum<{
        claude: "claude";
        codex: "codex";
        opencode: "opencode";
        pi: "pi";
    }>, z.ZodLiteral<"auto">]>>;
    allowedTools: z.ZodOptional<z.ZodArray<z.ZodString>>;
    bashAllowlist: z.ZodOptional<z.ZodArray<z.ZodString>>;
    command: z.ZodOptional<z.ZodString>;
    onFail: z.ZodOptional<z.ZodObject<{
        retry: z.ZodString;
        max: z.ZodDefault<z.ZodNumber>;
    }, z.core.$strip>>;
}, z.core.$strip>;
/**
 * A workflow file names either full `steps` or the portable `skills` shorthand
 * (spec 012 — what the builder exports): an ordered list of skill names, each
 * becoming one agent step that applies that skill to `{{task}}`.
 */
export declare const workflowFileSchema: z.ZodObject<{
    name: z.ZodString;
    description: z.ZodOptional<z.ZodString>;
    steps: z.ZodOptional<z.ZodArray<z.ZodObject<{
        id: z.ZodString;
        name: z.ZodOptional<z.ZodString>;
        prompt: z.ZodOptional<z.ZodString>;
        skill: z.ZodOptional<z.ZodString>;
        model: z.ZodOptional<z.ZodString>;
        runner: z.ZodOptional<z.ZodUnion<readonly [z.ZodEnum<{
            claude: "claude";
            codex: "codex";
            opencode: "opencode";
            pi: "pi";
        }>, z.ZodLiteral<"auto">]>>;
        allowedTools: z.ZodOptional<z.ZodArray<z.ZodString>>;
        bashAllowlist: z.ZodOptional<z.ZodArray<z.ZodString>>;
        command: z.ZodOptional<z.ZodString>;
        onFail: z.ZodOptional<z.ZodObject<{
            retry: z.ZodString;
            max: z.ZodDefault<z.ZodNumber>;
        }, z.core.$strip>>;
    }, z.core.$strip>>>;
    skills: z.ZodOptional<z.ZodArray<z.ZodString>>;
}, z.core.$strip>;
export type WorkflowStepDef = z.infer<typeof workflowStepSchema> & {
    runner?: RunnerSelection;
};
export type WorkflowDoc = z.infer<typeof workflowFileSchema>;
/**
 * A resolved workflow: a catalog entry, or the ad-hoc "(planned)" chain a task
 * was started with. A SCHEMA and not an interface because `RunStore` persists
 * one of these on the run record (`workflowDef`) and has to parse it back —
 * `src/server/contract-parity.workflows.test.ts` is what keeps this shape and
 * the contract's `workflowDefSchema` from drifting.
 */
export declare const workflowDefSchema: z.ZodObject<{
    name: z.ZodString;
    description: z.ZodOptional<z.ZodString>;
    steps: z.ZodArray<z.ZodObject<{
        id: z.ZodString;
        name: z.ZodOptional<z.ZodString>;
        prompt: z.ZodOptional<z.ZodString>;
        skill: z.ZodOptional<z.ZodString>;
        model: z.ZodOptional<z.ZodString>;
        runner: z.ZodOptional<z.ZodUnion<readonly [z.ZodEnum<{
            claude: "claude";
            codex: "codex";
            opencode: "opencode";
            pi: "pi";
        }>, z.ZodLiteral<"auto">]>>;
        allowedTools: z.ZodOptional<z.ZodArray<z.ZodString>>;
        bashAllowlist: z.ZodOptional<z.ZodArray<z.ZodString>>;
        command: z.ZodOptional<z.ZodString>;
        onFail: z.ZodOptional<z.ZodObject<{
            retry: z.ZodString;
            max: z.ZodDefault<z.ZodNumber>;
        }, z.core.$strip>>;
    }, z.core.$strip>>;
    source: z.ZodEnum<{
        "built-in": "built-in";
        file: "file";
    }>;
    path: z.ZodOptional<z.ZodString>;
}, z.core.$strip>;
export type WorkflowDef = z.infer<typeof workflowDefSchema>;
/** `skills: [a, b]` → agent steps, one per skill, each running `{{task}}`. */
export declare function skillsToSteps(skills: string[]): WorkflowStepDef[];
/** Resolve the steps/skills XOR into plain steps. */
export declare function normalizeWorkflowDoc(doc: WorkflowDoc): {
    name: string;
    description?: string;
    steps: WorkflowStepDef[];
};
/**
 * The inverse of `skillsToSteps`: when every step is a plain "apply this
 * skill to the task" agent step, return the skill list — the workflow can be
 * written in the portable compact form. Anything richer (checks, custom
 * prompts, per-step models/tools, loops) returns null.
 */
export declare function skillStackOf(steps: WorkflowStepDef[]): string[] | null;
export declare function stepKind(step: WorkflowStepDef): 'agent' | 'check';
/**
 * A guard note prepended to an agent step's prompt when the workflow chains
 * 2+ AGENT steps (#410): every step gets the SAME `input.task` text and shares
 * one run-level handoff journal, so a later step's fresh session can read an
 * earlier step's own "done" signal (its final report, its handoff Resume
 * notes) and — with nothing in its prompt saying otherwise — conclude the
 * OVERALL task is already achieved. Since only the chain's last step honors
 * `CEZ:DONE` as an early-completion signal (`run.ts`'s `interactive` gate),
 * this silently skipped exactly the last selected skill: it ended its first
 * turn with the marker instead of doing its own step's work.
 *
 * `index` is the position in `steps`; both the gate and the "step N of M"
 * numbering count agent steps only. Check steps are shell commands, not
 * sessions the model reasons about, so a workflow with one agent step and any
 * number of checks around it (the README's `implement` + `verify` shape) is
 * not a chain and gets no note — that single-step case stays byte-for-byte
 * unchanged. Returns undefined for check steps.
 */
export declare function chainStepNote(steps: WorkflowStepDef[], index: number): string | undefined;
/**
 * Structural checks beyond the per-step schema: ids must be unique and every
 * `onFail.retry` must reference an *earlier* step (loops only go backwards).
 * Returns a human-readable problem, or null when the list is sound. Shared by
 * the file loader and the inline-steps / save-workflow API routes (spec 008).
 */
export declare function stepsIssue(steps: WorkflowStepDef[]): string | null;
/** Tools an agent step gets when the workflow doesn't say otherwise. */
export declare const DEFAULT_ALLOWED_TOOLS: string[];
/** The zero-config workflow: one agent step that just does the task. */
export declare const QUICK_TASK_WORKFLOW: WorkflowDef;
