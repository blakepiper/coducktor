/** Where a run's agent-scoped temp directory lives. */
export declare function agentTmpDir(dataDir: string, runId: string): string;
/**
 * The preflight's failure. Named so the spawn path can tell it apart from an
 * ordinary crash and turn it into the run's `error` — the same treatment
 * `ModelIdentityError` gets, and the same channel the thread footer renders.
 */
export declare class AgentTempDirError extends Error {
    readonly path: string;
    constructor(path: string, reason: unknown);
}
/** Opt-out spelling matches the house style for default-on behaviour
 *  (`CEZ_AUTONAME=0`, `CEZ_SKILLS_AUTO_UPDATE=0`): only an exact `0` disables. */
export declare function agentTmpDirEnabled(env?: NodeJS.ProcessEnv): boolean;
/**
 * The `TMPDIR`/`TEMP`/`TMP` overrides for this run, after proving the resolved
 * directory actually accepts writes. Throws `AgentTempDirError` when it does
 * not — callers turn that into the run's error rather than spawning.
 *
 * All three spellings are set, on every platform: a tool that reads `TMP` (or
 * `TEMP`) would otherwise keep following the host value straight back to the
 * exhausted directory this exists to escape.
 *
 * Returns `{}` under the opt-out, without probing anything: the hatch turns the
 * whole feature off, preflight included, so it stays an escape someone can
 * actually take.
 */
export declare function agentTmpEnv(dataDir: string, runId: string, env?: NodeJS.ProcessEnv): Record<string, string>;
/**
 * Reap one run's directory. Scratch, not an artifact: nothing reads it once the
 * agent is gone, and a Continue re-creates it through `agentTmpEnv`. Never
 * throws — reaping must not break a terminal transition.
 */
export declare function removeAgentTmpDir(dataDir: string, runId: string): void;
/**
 * Remove every per-run directory that is not in `keepRunIds` — the startup
 * sweep, so a crash (which never reaches the terminal-transition reap) cannot
 * accumulate them forever. Confined to `<dataDir>/tmp`; sibling run state is
 * never enumerated, let alone touched. Returns the ids actually reaped.
 */
export declare function sweepAgentTmpDirs(dataDir: string, keepRunIds: Iterable<string>): string[];
