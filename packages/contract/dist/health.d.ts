import { z } from 'zod';
/** The agent backends a run can be dispatched to. */
export declare const runnerSchema: z.ZodEnum<{
    claude: "claude";
    codex: "codex";
    opencode: "opencode";
    pi: "pi";
}>;
export type Runner = z.infer<typeof runnerSchema>;
/** An authored runner choice. `auto` is a selection policy, never a concrete backend. */
export declare const runnerSelectionSchema: z.ZodUnion<readonly [z.ZodEnum<{
    claude: "claude";
    codex: "codex";
    opencode: "opencode";
    pi: "pi";
}>, z.ZodLiteral<"auto">]>;
export type RunnerSelection = z.infer<typeof runnerSelectionSchema>;
/** Git facts about the project root, or `null` when it is not a repository. */
export declare const repoInfoSchema: z.ZodObject<{
    root: z.ZodString;
    branch: z.ZodString;
    remote: z.ZodOptional<z.ZodString>;
}, z.core.$strip>;
export type RepoInfo = z.infer<typeof repoInfoSchema>;
/** One probed CLI behind the Tools menu. */
export declare const backendCheckSchema: z.ZodObject<{
    name: z.ZodEnum<{
        claude: "claude";
        codex: "codex";
        gh: "gh";
        git: "git";
        opencode: "opencode";
        pi: "pi";
    }>;
    available: z.ZodBoolean;
    version: z.ZodOptional<z.ZodString>;
    hint: z.ZodOptional<z.ZodString>;
}, z.core.$strip>;
export type BackendCheck = z.infer<typeof backendCheckSchema>;
export declare const forgeInfoSchema: z.ZodObject<{
    kind: z.ZodLiteral<"github">;
    available: z.ZodOptional<z.ZodBoolean>;
    reason: z.ZodOptional<z.ZodString>;
}, z.core.$strip>;
export type ForgeInfo = z.infer<typeof forgeInfoSchema>;
/** Server-side feature switches the cockpit reads once at boot. */
export declare const capabilitiesSchema: z.ZodObject<{
    localHandoff: z.ZodBoolean;
    followups: z.ZodBoolean;
    singleProject: z.ZodBoolean;
    automations: z.ZodBoolean;
    tokenMetrics: z.ZodBoolean;
    tokenUsageMetrics: z.ZodBoolean;
    costMetrics: z.ZodBoolean;
}, z.core.$strip>;
export type Capabilities = z.infer<typeof capabilitiesSchema>;
/**
 * `GET /api/v1/health` — the CORS-open discovery endpoint (BACKWARD_COMPATIBILITY.md §2).
 *
 * Additive fields only: this is the most externally-depended-on JSON in the app.
 */
export declare const healthResponseSchema: z.ZodObject<{
    version: z.ZodString;
    latestVersion: z.ZodOptional<z.ZodString>;
    repoRoot: z.ZodString;
    repo: z.ZodNullable<z.ZodObject<{
        root: z.ZodString;
        branch: z.ZodString;
        remote: z.ZodOptional<z.ZodString>;
    }, z.core.$strip>>;
    checks: z.ZodArray<z.ZodObject<{
        name: z.ZodEnum<{
            claude: "claude";
            codex: "codex";
            gh: "gh";
            git: "git";
            opencode: "opencode";
            pi: "pi";
        }>;
        available: z.ZodBoolean;
        version: z.ZodOptional<z.ZodString>;
        hint: z.ZodOptional<z.ZodString>;
    }, z.core.$strip>>;
    defaultRunner: z.ZodEnum<{
        claude: "claude";
        codex: "codex";
        opencode: "opencode";
        pi: "pi";
    }>;
    forge: z.ZodNullable<z.ZodObject<{
        kind: z.ZodLiteral<"github">;
        available: z.ZodOptional<z.ZodBoolean>;
        reason: z.ZodOptional<z.ZodString>;
    }, z.core.$strip>>;
    capabilities: z.ZodObject<{
        localHandoff: z.ZodBoolean;
        followups: z.ZodBoolean;
        singleProject: z.ZodBoolean;
        automations: z.ZodBoolean;
        tokenMetrics: z.ZodBoolean;
        tokenUsageMetrics: z.ZodBoolean;
        costMetrics: z.ZodBoolean;
    }, z.core.$strip>;
    projects: z.ZodArray<z.ZodObject<{
        id: z.ZodString;
        name: z.ZodString;
    }, z.core.$strip>>;
    bootProject: z.ZodString;
}, z.core.$strip>;
export type HealthResponse = z.infer<typeof healthResponseSchema>;
