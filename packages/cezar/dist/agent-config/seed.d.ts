/**
 * Copy the seeded personal-layer files from `repoRoot` into `worktreeCwd`.
 * Guards every file with `git check-ignore` so a file the user genuinely tracked
 * (against the vendor's advice) is neither copied nor excluded. Returns the
 * repo-relative paths actually seeded, for the caller's note. Never throws.
 */
export declare function seedAgentConfigLocalLayer(repoRoot: string, worktreeCwd: string, env?: NodeJS.ProcessEnv): Promise<string[]>;
