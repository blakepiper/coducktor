import { z } from 'zod';
import type { RunnerSelection } from './core/runner-selection.ts';
/**
 * Optional advanced config at `.ai/cezar/config.json`. Zero-config rule:
 * a missing file behaves exactly like the default below, an unreadable or
 * invalid file degrades to the default too (never blocks startup). Team skill
 * repositories are opt-in; an explicit `skillsRepos` can add one.
 */
declare const skillsRepoSchema: z.ZodObject<{
    repo: z.ZodString;
    ref: z.ZodDefault<z.ZodString>;
}, z.core.$strip>;
export type SkillsRepoSource = z.infer<typeof skillsRepoSchema>;
/** No remote skill source is contacted unless the repo explicitly configures one. */
export declare const DEFAULT_SKILLS_REPOS: SkillsRepoSource[];
/** Last-resort retention when neither the repo nor the workspace says anything. */
export declare const DEFAULT_WORKTREE_RETENTION = 10;
declare const configSchema: z.ZodObject<{
    skillsRepos: z.ZodDefault<z.ZodArray<z.ZodObject<{
        repo: z.ZodString;
        ref: z.ZodDefault<z.ZodString>;
    }, z.core.$strip>>>;
    maxParallel: z.ZodDefault<z.ZodNumber>;
    worktreeRetention: z.ZodCatch<z.ZodDefault<z.ZodNumber>>;
    memoryLimitMb: z.ZodCatch<z.ZodOptional<z.ZodNumber>>;
    defaultRunner: z.ZodDefault<z.ZodUnion<readonly [z.ZodEnum<{
        claude: "claude";
        codex: "codex";
        opencode: "opencode";
        pi: "pi";
    }>, z.ZodLiteral<"auto">]>>;
    plannerModel: z.ZodDefault<z.ZodString>;
    namerModel: z.ZodDefault<z.ZodString>;
    liveTitleUpdates: z.ZodOptional<z.ZodBoolean>;
    reviewGate: z.ZodOptional<z.ZodBoolean>;
    baseBranch: z.ZodOptional<z.ZodString>;
    systemPrompt: z.ZodCatch<z.ZodOptional<z.ZodString>>;
    defaultModels: z.ZodCatch<z.ZodOptional<z.ZodObject<{
        claude: z.ZodOptional<z.ZodString>;
        codex: z.ZodOptional<z.ZodString>;
        opencode: z.ZodOptional<z.ZodString>;
        pi: z.ZodOptional<z.ZodString>;
    }, z.core.$strip>>>;
    modelsLocked: z.ZodCatch<z.ZodOptional<z.ZodBoolean>>;
}, z.core.$strip>;
export type CezConfig = z.infer<typeof configSchema>;
/** Auxiliary planner/namer calls are outside MVP quota routing and need a concrete backend. */
export declare function auxiliaryRunner(selection: RunnerSelection): Exclude<RunnerSelection, 'auto'>;
/**
 * Read `.ai/cezar/config.json` on demand — never cached, never throws.
 *
 * Also reads the machine-wide defaults, which is one more small JSON read and deliberately not
 * cached for the same reason this one is not: `~/.cezar/` is shared by every cezar process on the
 * machine, so a snapshot is a staleness bug.
 */
export declare function loadConfig(repoRoot: string): Promise<CezConfig>;
/**
 * The default skills repos that are *opt-in per skill* (the "import skills"
 * flow): the set of repo identifiers a user must explicitly import from before
 * their skills join the catalog. This is exactly `DEFAULT_SKILLS_REPOS` when the
 * repo has NOT configured its own `skillsRepos` — empty by default so startup
 * never contacts a remote source — and empty once a repo takes control by
 * setting `skillsRepos` (then everything it lists auto-loads, unchanged).
 *
 * `loadConfig` cannot answer this: the schema's `.default(DEFAULT_SKILLS_REPOS)`
 * materializes the key, so a parsed config can't tell "the user chose these" from
 * "the user said nothing". So we probe the raw file for the key's presence — the
 * same reason `ownWorktreeRetention` below reads the raw JSON.
 */
export declare function gatedSkillsRepos(repoRoot: string): Promise<Set<string>>;
/**
 * Effective worktree retention for a repo (#483 + spec
 * 2026-07-20-multi-project-workspace). Precedence, exactly what Settings →
 * Worktrees promises: the repo's own `worktreeRetention` wins whenever it sets
 * one; otherwise the workspace's `resources.worktreeRetentionDefault` seeds it;
 * an absent/unreadable workspace config keeps the historical 10. Every
 * enforcement site (boot sweeps, terminal transitions, the reclaim route) must
 * go through here so the setting can never be a lie.
 */
export declare function resolveWorktreeRetention(repoRoot: string): Promise<number>;
export {};
