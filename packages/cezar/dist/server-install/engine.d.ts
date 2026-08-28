import { type PlatformStrategy, type Runner, type ServerState, type Ui } from './types.ts';
/**
 * The engine — pure control flow over a strategy's ordered steps. It never
 * knows what a step *does*, only `check`/`run`/`undo`. `runInstall` resumes
 * from `~/.cezar/server.json` (skips resolved steps unless `--reconfigure`
 * names them); `runUninstall` walks completed steps in reverse. Both hold the
 * single-writer lock for their whole run.
 */
export interface RunOptions {
    dryRun: boolean;
    assumeYes: boolean;
    reconfigure: ReadonlySet<string>;
    /** `--reinstall`: force every step to re-run, ignoring recorded/present state. */
    reinstall?: boolean;
    repoRoot: string;
    /** ISO timestamp from the caller (Date.now is guarded in some contexts). */
    now: string;
    ui?: Ui;
    runner?: Runner;
    /**
     * Instance id (slug) to act on. Omit / `default` for the original
     * single-cockpit host (legacy `~/.cezar/server.json`); a domain-derived slug
     * targets a named instance under `~/.cezar/server-instances/`.
     */
    instance?: string;
    /** Public domain for this instance — recorded up front so instance selection
     * and the SSL step share one source of truth. */
    domain?: string;
    /** Loopback port for this instance. For a NEW named instance the caller
     * passes an auto-picked free port; a resume keeps the recorded one. */
    port?: number;
    /** `--external-proxy`: an existing reverse proxy fronts cezar, so the
     * platform installs no nginx/SSL of its own. */
    externalProxy?: boolean;
    /** `--bind-host`: interface the cockpit binds so that proxy can reach it. */
    bindHost?: string;
}
export type RunStatus = 'complete' | 'cancelled' | 'failed';
export interface RunResult {
    status: RunStatus;
    state: ServerState;
}
export declare function runInstall(strategy: PlatformStrategy, opts: RunOptions): Promise<RunResult>;
export declare function runUninstall(strategy: PlatformStrategy, opts: RunOptions): Promise<RunResult>;
/**
 * Reload the running cockpit to pick up a new cezar version — the standardized
 * `server-deploy` flow. Delegates to the platform's `redeploy` (restart service
 * + re-verify); holds the single-writer lock for the whole run.
 */
export declare function runDeploy(strategy: PlatformStrategy, opts: RunOptions): Promise<RunResult>;
