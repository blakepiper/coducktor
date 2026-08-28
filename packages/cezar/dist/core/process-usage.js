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
import { execFile } from 'node:child_process';
/**
 * Parse `ps -axo pid=,ppid=,rss=,%cpu=` output (the `=` suffixes suppress
 * headers on darwin and linux alike). Malformed lines are skipped — `ps`
 * racing process exits can truncate rows.
 */
export function parsePsOutput(text) {
    const out = [];
    for (const line of text.split('\n')) {
        const parts = line.trim().split(/\s+/);
        if (parts.length < 4)
            continue;
        const pid = Number(parts[0]);
        const ppid = Number(parts[1]);
        const rssKb = Number(parts[2]);
        const cpuPct = Number(parts[3]);
        if (!Number.isInteger(pid) || !Number.isInteger(ppid))
            continue;
        out.push({
            pid,
            ppid,
            rssKb: Number.isFinite(rssKb) && rssKb > 0 ? rssKb : 0,
            cpuPct: Number.isFinite(cpuPct) && cpuPct > 0 ? cpuPct : 0,
        });
    }
    return out;
}
/**
 * Aggregate the full descendant tree rooted at `rootPid` from one `ps`
 * snapshot. Null when the root is gone (process exited between register and
 * sample) — callers treat that as "no data", not zero usage.
 */
export function aggregateTreeUsage(procs, rootPid) {
    const byPid = new Map();
    const children = new Map();
    for (const p of procs) {
        byPid.set(p.pid, p);
        const siblings = children.get(p.ppid);
        if (siblings)
            siblings.push(p.pid);
        else
            children.set(p.ppid, [p.pid]);
    }
    if (!byPid.has(rootPid))
        return null;
    let cpuPct = 0;
    let rssKb = 0;
    let procCount = 0;
    const queue = [rootPid];
    const seen = new Set(); // pid-reuse in a torn snapshot can't loop us
    while (queue.length > 0) {
        const pid = queue.pop();
        if (seen.has(pid))
            continue;
        seen.add(pid);
        const p = byPid.get(pid);
        if (!p)
            continue;
        cpuPct += p.cpuPct;
        rssKb += p.rssKb;
        procCount += 1;
        for (const child of children.get(pid) ?? [])
            queue.push(child);
    }
    return { cpuPct: Math.round(cpuPct * 10) / 10, rssBytes: rssKb * 1024, procCount };
}
// ---- registry + sampler -----------------------------------------------------
export const SAMPLE_INTERVAL_MS = 2_000;
const entries = new Map();
const listeners = new Set();
let timer = null;
let sampling = false;
/** Start tracking a run's process tree. A re-register (a run's next agent
 *  step) replaces the pid but keeps nothing else — peaks are per session and
 *  the engine maxes them into the run record on unregister. */
export function registerRunProcess(runId, pid) {
    entries.set(runId, { pid, peakRssBytes: 0, peakProcCount: 0 });
    if (!timer) {
        timer = setInterval(() => void sample(), SAMPLE_INTERVAL_MS);
        timer.unref?.();
        void sample(); // first data point right away, not 2 s late
    }
}
/** Stop tracking; returns the session's peaks (undefined when no sample ever
 *  landed — `ps` unavailable, or the process died before the first tick). */
export function unregisterRunProcess(runId) {
    const entry = entries.get(runId);
    entries.delete(runId);
    if (entries.size === 0 && timer) {
        clearInterval(timer);
        timer = null;
    }
    if (!entry || entry.peakProcCount === 0)
        return undefined;
    return { peakRssBytes: entry.peakRssBytes, peakProcCount: entry.peakProcCount };
}
/** Latest sample for one run, if any. */
export function currentUsage(runId) {
    return entries.get(runId)?.last;
}
/** Latest samples for every registered run that has data. */
export function allUsage() {
    const out = {};
    for (const [runId, entry] of entries) {
        if (entry.last)
            out[runId] = entry.last;
    }
    return out;
}
/** Subscribe to fresh samples (fires ~every 2 s while runs are registered);
 *  returns the unsubscribe. The SSE endpoint relays these to the GUI. */
export function onUsage(listener) {
    listeners.add(listener);
    return () => listeners.delete(listener);
}
/** Test hook: fan one snapshot out to every subscriber without shelling `ps` —
 *  lets unit tests prove a dispose()d subscriber stops receiving ticks. */
export function emitUsageForTest(snapshot) {
    for (const listener of listeners) {
        try {
            listener(snapshot);
        }
        catch {
            // mirror sample(): one broken listener never kills the fan-out
        }
    }
}
async function sample() {
    if (sampling || entries.size === 0)
        return;
    sampling = true;
    try {
        const text = await runPs();
        if (text === null)
            return; // ps unavailable — degrade to no data
        const procs = parsePsOutput(text);
        for (const entry of entries.values()) {
            const usage = aggregateTreeUsage(procs, entry.pid);
            entry.last = usage ?? undefined;
            if (usage) {
                entry.peakRssBytes = Math.max(entry.peakRssBytes, usage.rssBytes);
                entry.peakProcCount = Math.max(entry.peakProcCount, usage.procCount);
            }
        }
        if (listeners.size > 0) {
            const snapshot = allUsage();
            for (const listener of listeners) {
                try {
                    listener(snapshot);
                }
                catch {
                    // a broken SSE stream must not kill the sampler
                }
            }
        }
    }
    finally {
        sampling = false;
    }
}
/** One system-wide snapshot in the `pid ppid rssKb cpu` shape `parsePsOutput` expects; null on
 *  any failure. Unix uses `ps`; Windows uses PowerShell's Win32_Process (WorkingSetSize → KB,
 *  cpu reported as 0 — the memory guard only needs RSS). */
function runPs() {
    if (process.platform === 'win32') {
        return new Promise((resolve) => {
            execFile('powershell', [
                '-NoProfile',
                '-Command',
                "Get-CimInstance Win32_Process | ForEach-Object { \"$($_.ProcessId) $($_.ParentProcessId) $([math]::Round($_.WorkingSetSize/1024)) 0\" }",
            ], { maxBuffer: 16 * 1024 * 1024, windowsHide: true }, (err, stdout) => resolve(err ? null : stdout));
        });
    }
    return new Promise((resolve) => {
        execFile('ps', ['-axo', 'pid=,ppid=,rss=,%cpu='], { maxBuffer: 16 * 1024 * 1024 }, (err, stdout) => resolve(err ? null : stdout));
    });
}
//# sourceMappingURL=process-usage.js.map