import { z } from 'zod';
/**
 * The WORKFLOWS family: the chain catalog, the save/parse routes, and the planner.
 *
 * This file must NOT import `./runs.ts`: the run record embeds a workflow definition
 * (`RunRecord.workflowDef`), so `runs.ts` imports the two definition schemas below, and a second
 * edge back would be a module cycle — one whose top-level `z.object(…)` calls would hit a TDZ at
 * import time, not a type error. The parallel-variant shapes (`/groups/:groupId/*`), which DO
 * embed the record, live with the run family for the same reason.
 */
/**
 * One step of a chain: either an agent step (`prompt`/`skill`) or a check step (`command`).
 *
 * `onFail.max` carries a `.default(2)`, exactly as `src/workflows/types.ts` declares it, so the
 * OUTPUT shape the routes serve has `max` present whenever `onFail` is.
 */
export declare const workflowStepDefSchema: z.ZodObject<{
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
export type WorkflowStepDef = z.infer<typeof workflowStepDefSchema>;
/** One catalog entry: the built-in `quick-task`, or a `.ai/cezar/workflows/*.yaml` file. */
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
/** A workflow file that failed to load. Reported, never fatal — the catalog still answers. */
export declare const workflowLoadIssueSchema: z.ZodObject<{
    path: z.ZodString;
    message: z.ZodString;
}, z.core.$strip>;
export type WorkflowLoadIssue = z.infer<typeof workflowLoadIssueSchema>;
/** `GET /workflows` — the catalog plus the files that could not be read. */
export declare const workflowsResponseSchema: z.ZodObject<{
    workflows: z.ZodArray<z.ZodObject<{
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
    }, z.core.$strip>>;
    issues: z.ZodArray<z.ZodObject<{
        path: z.ZodString;
        message: z.ZodString;
    }, z.core.$strip>>;
}, z.core.$strip>;
export type WorkflowsResponse = z.infer<typeof workflowsResponseSchema>;
/**
 * `POST /workflows` body: save a chain as `.ai/cezar/workflows/<slug>.yaml`.
 *
 * Exactly one of `steps` / the portable `skills` shorthand — the refinement below is the same
 * XOR the server enforces. Without `overwrite` an existing file answers 409 (`exists: true`).
 */
export declare const saveWorkflowInputSchema: z.ZodObject<{
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
    overwrite: z.ZodOptional<z.ZodBoolean>;
}, z.core.$strip>;
export type SaveWorkflowInput = z.infer<typeof saveWorkflowInputSchema>;
/** `POST /workflows` — 201 with where the YAML landed. */
export declare const saveWorkflowResponseSchema: z.ZodObject<{
    path: z.ZodString;
    name: z.ZodString;
}, z.core.$strip>;
export type SaveWorkflowResponse = z.infer<typeof saveWorkflowResponseSchema>;
/** `POST /workflows/parse` (spec 012) — pasted YAML, normalized to plain steps. */
export declare const parsedWorkflowSchema: z.ZodObject<{
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
}, z.core.$strip>;
export type ParsedWorkflow = z.infer<typeof parsedWorkflowSchema>;
/**
 * `DELETE /workflows/:name` — file workflows only; built-ins answer 400.
 *
 * `ok` is the LITERAL `true`, not a boolean: the only body carrying it is the success one, and
 * every failure is an `{ error }` status instead. The hand-written DTO said `boolean`, which
 * was wider than the route has ever been.
 */
export declare const deleteWorkflowResponseSchema: z.ZodObject<{
    ok: z.ZodLiteral<true>;
    path: z.ZodString;
}, z.core.$strip>;
export type DeleteWorkflowResponse = z.infer<typeof deleteWorkflowResponseSchema>;
/**
 * The proposed chain for a task. Never a hard failure: a missing CLI, a timeout or an
 * unparseable answer degrade to the one-step quick-task plan with `fallback: true`.
 */
export declare const planResponseSchema: z.ZodObject<{
    name: z.ZodOptional<z.ZodString>;
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
    rationale: z.ZodString;
    fallback: z.ZodBoolean;
}, z.core.$strip>;
export type PlanResponse = z.infer<typeof planResponseSchema>;
