import type { RunRecord } from './store.ts';
/** A run is reclaimable when it is finished, still has a materialized worktree
 *  directory, and has not already been reclaimed. */
export declare function isReclaimable(run: RunRecord): boolean;
/**
 * Given every run and the keep-count `keep`, return the ids of the finished
 * worktrees whose *directory* should be reclaimed: keep the `keep`
 * most-recently-finished reclaimable worktrees, reclaim the rest.
 *
 * `keep === 0` means "unlimited — never auto-reclaim" and returns `[]`.
 * Pure: no I/O, no mutation of the input.
 */
export declare function selectReclaimableWorktrees(runs: readonly RunRecord[], keep: number): string[];
/** The slice of the runs store the enforcer needs. Kept structural so the
 *  enforcer stays easy to test and never imports the concrete store. */
export interface RetentionStore {
    listRuns(): RunRecord[];
    updateRun(id: string, patch: {
        worktreeReclaimedAt?: string;
    }): unknown;
}
/** The slice of the store the re-materializer needs. */
export interface RematerializeStore {
    getRun(id: string): RunRecord | undefined;
    updateRun(id: string, patch: {
        worktreeReclaimedAt?: string;
    }): unknown;
}
/**
 * If retention (#483) reclaimed this run's worktree — branch kept, directory
 * gone, `worktreeReclaimedAt` stamped — re-materialize the directory (via the
 * idempotent `createWorktree`, which reattaches the surviving `cez/<id8>`
 * branch) and CLEAR the stamp. Called on the resume/continue path so a resumed
 * run regains its isolated tree and becomes eligible for retention again;
 * without it the run would keep a directory on disk while staying invisible to
 * the enforcer forever (a leak). Returns true when it re-materialized.
 * Best-effort: never throws (the caller falls back to the repo root).
 */
export declare function rematerializeReclaimedWorktree(repoRoot: string, store: RematerializeStore, runId: string): Promise<boolean>;
/**
 * Enforce the retention budget: reclaim the *directory* of every over-limit
 * finished worktree (branch kept via `removeWorktree` without the branch arg),
 * stamping `worktreeReclaimedAt` on each run actually reclaimed. Returns the
 * reclaimed run ids (for logging/SSE).
 *
 * Never throws (helper discipline). `removeWorktree` is best-effort and does not
 * report failure, so a run is stamped only once its directory is confirmed gone
 * — a locked/permission failure leaves the stamp unset so the next pass retries.
 * Idempotent under races: `removeWorktree` is `--force` + `prune` and a repeated
 * stamp is harmless.
 */
export interface ReclaimOptions {
    /** Timestamp source for the stamp — injectable for deterministic tests. */
    now?: () => string;
    /** Directory reclaimer — defaults to the real `removeWorktree` (branch kept).
     *  Injectable so tests can exercise the "removal failed" branch without brittle
     *  filesystem-permission tricks. */
    remove?: (repoRoot: string, worktreePath: string) => Promise<void>;
}
export declare function reclaimWorktrees(repoRoot: string, store: RetentionStore, keep: number, opts?: ReclaimOptions): Promise<string[]>;
