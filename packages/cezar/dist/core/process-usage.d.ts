/**
 * Live process telemetry for the Runs table (#348): while any run has a
 * registered backend process, ONE `ps` snapshot every ~2 s is aggregated per
 * run over the process's full descendant tree (the CLI plus every Bash child
 * an agent spawned) into `{ cpuPct, rssBytes, procCount }`.
 *
 * Design constraints, in order:
 *  - never affect a run — a missing/failing `ps` (Windows, exotic containers)
 *    degrades silently to "no data";
 *  - one shared sampler, not one per run — N parallel runs still cost a
 *    single `ps` every tick, and the timer is unref()ed and stopped the
 *    moment the registry empties, so an idle cockpit spawns nothing;
 *  - parsing + tree aggregation are pure functions, testable against canned
 *    `ps` output (scripts/test-process-usage.mjs).
 */
/** One aggregated sample for a run's process tree. */
export interface ProcessUsage {
    /** Sum of `%cpu` across the tree — can exceed 100 on multi-core work. */
    cpuPct: number;
    /** Sum of resident set sizes, in bytes. */
    rssBytes: number;
    /** Number of live processes in the tree, the root included. */
    procCount: number;
}
/** One parsed `ps` row (`pid ppid rss %cpu`; rss is in KB, ps's unit). */
export interface ProcStat {
    pid: number;
    ppid: number;
    rssKb: number;
    cpuPct: number;
}
/**
 * Parse `ps -axo pid=,ppid=,rss=,%cpu=` output (the `=` suffixes suppress
 * headers on darwin and linux alike). Malformed lines are skipped — `ps`
 * racing process exits can truncate rows.
 */
export declare function parsePsOutput(text: string): ProcStat[];
/**
 * Aggregate the full descendant tree rooted at `rootPid` from one `ps`
 * snapshot. Null when the root is gone (process exited between register and
 * sample) — callers treat that as "no data", not zero usage.
 */
export declare function aggregateTreeUsage(procs: ProcStat[], rootPid: number): ProcessUsage | null;
export declare const SAMPLE_INTERVAL_MS = 2000;
type UsageListener = (usage: Record<string, ProcessUsage>) => void;
/** Start tracking a run's process tree. A re-register (a run's next agent
 *  step) replaces the pid but keeps nothing else — peaks are per session and
 *  the engine maxes them into the run record on unregister. */
export declare function registerRunProcess(runId: string, pid: number): void;
/** Stop tracking; returns the session's peaks (undefined when no sample ever
 *  landed — `ps` unavailable, or the process died before the first tick). */
export declare function unregisterRunProcess(runId: string): {
    peakRssBytes: number;
    peakProcCount: number;
} | undefined;
/** Latest sample for one run, if any. */
export declare function currentUsage(runId: string): ProcessUsage | undefined;
/** Latest samples for every registered run that has data. */
export declare function allUsage(): Record<string, ProcessUsage>;
/** Subscribe to fresh samples (fires ~every 2 s while runs are registered);
 *  returns the unsubscribe. The SSE endpoint relays these to the GUI. */
export declare function onUsage(listener: UsageListener): () => void;
/** Test hook: fan one snapshot out to every subscriber without shelling `ps` —
 *  lets unit tests prove a dispose()d subscriber stops receiving ticks. */
export declare function emitUsageForTest(snapshot: Record<string, ProcessUsage>): void;
export {};
