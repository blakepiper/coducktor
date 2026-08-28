import { realpathSync } from 'node:fs';
import { resolve } from 'node:path';
import { DEFAULT_MONITORING_WAKE_MINUTES, loadWorkspaceConfig } from './config.js';
/** Realpath-normalize a root the same way the registry does
 *  (`workspace/projects.ts` `normalizeRoot`), but synchronously — this answers
 *  a manager's hot-path lookup and must not `await`. A path that cannot be
 *  realpath'd degrades to `resolve()`, matching the registry's own fallback. */
function normalizeRootSync(root) {
    try {
        return realpathSync(root);
    }
    catch {
        return resolve(root);
    }
}
const DEFAULT_LIMITS = {
    maxParallel: 2,
    maxMonitoringSessions: 2,
    monitoringWakeIntervalMinutes: DEFAULT_MONITORING_WAKE_MINUTES,
    autoResumeOnUsageLimit: true,
    intelligentContextRefresh: false,
    memoryLimitMb: null,
};
/** Production loader: the `resources` slice of `~/.cezar/config.json`
 *  (schema-defaulted, so a missing/corrupt file yields the zero-config
 *  2 parallel / 2 monitoring / 5-minute wake / no memory cap),
 *  plus the per-project `maxParallel` overrides built into a root→limit map.
 *  The registry `root` is already realpath-normalized (`registerProject`), so
 *  the keys match `normalizeRootSync`'s output at lookup time. */
async function loadResourceLimits() {
    const { resources, projects } = await loadWorkspaceConfig();
    const projectLimits = new Map();
    for (const project of projects) {
        if (typeof project.maxParallel === 'number')
            projectLimits.set(project.root, project.maxParallel);
    }
    return {
        maxParallel: resources.maxParallel,
        maxMonitoringSessions: resources.maxMonitoringSessions,
        monitoringWakeIntervalMinutes: resources.monitoringWakeIntervalMinutes,
        autoResumeOnUsageLimit: resources.autoResumeOnUsageLimit,
        intelligentContextRefresh: resources.intelligentContextRefresh,
        memoryLimitMb: resources.memoryLimitMb,
        projectLimits,
    };
}
export class WorkspaceSemaphore {
    participants = new Set();
    load;
    limits;
    /** A `release()` sweep is in flight — see `pendingRelease`. */
    broadcasting = false;
    /** A slot freed DURING a sweep. The in-flight sweep may already have pumped
     *  the manager that should get it, so re-run rather than drop the wakeup. */
    pendingRelease = false;
    constructor(options = {}) {
        this.load = options.load ?? loadResourceLimits;
        this.limits = { ...DEFAULT_LIMITS, ...options.initial };
    }
    /** Join the shared counter. Returns the unregister handle — the manager's
     *  `dispose()` must call it so a torn-down project stops counting. */
    register(participant) {
        this.participants.add(participant);
        return () => this.participants.delete(participant);
    }
    /** Slots held across EVERY registered manager (waiting runs excluded by
     *  each participant — the #347 rule). */
    busy() {
        let total = 0;
        for (const participant of this.participants)
            total += participant.busySlots();
        return total;
    }
    /** Cached workspace-wide parallel cap. */
    maxParallel() {
        return this.limits.maxParallel;
    }
    maxMonitoringSessions() {
        return this.limits.maxMonitoringSessions ?? 2;
    }
    /** Cadence for automatic monitoring re-checks, or null when the operator chose "park
     *  until resumed". Deliberately NOT `?? DEFAULT`: `null` is a real user choice and
     *  `null ?? 5` would silently override it (#810). Only an ABSENT key — an older `load`
     *  stub, a partial `initial` — falls back to the shipped default. */
    monitoringWakeIntervalMinutes() {
        const configured = this.limits.monitoringWakeIntervalMinutes;
        return configured === undefined ? DEFAULT_MONITORING_WAKE_MINUTES : configured;
    }
    /** Whether a usage-limit stop schedules its own resume. Absent (an older `load` stub, a config
     *  written before the key existed) reads as ON — the shipped default. */
    autoResumeOnUsageLimit() {
        return this.limits.autoResumeOnUsageLimit ?? true;
    }
    /** Whether a completed in-session plan item should start the next item in a fresh context. */
    intelligentContextRefresh() {
        return this.limits.intelligentContextRefresh ?? false;
    }
    /** Cached per-task memory ceiling (MiB), or null for no limit. */
    memoryLimitMb() {
        return this.limits.memoryLimitMb;
    }
    /**
     * Every agent account held across the WHOLE workspace, by kind — the union of what each manager
     * reports (spec 2026-08-03-auto-resume-after-usage-limit). A `pump()` consults this before
     * starting a queued run, so a limit hit in one project also stops the same account being walked
     * into the wall from another.
     *
     * Asked live rather than cached: the underlying answer is derived from run records that change
     * on every schedule, resume and cancel, and a stale snapshot here would either stall a queue
     * whose window has reopened or leak a stampede through one that has not.
     */
    accountHolds() {
        const deadline = new Set();
        const inFlight = new Set();
        for (const participant of this.participants) {
            const holds = participant.accountHolds?.();
            if (!holds)
                continue;
            for (const key of holds.deadline)
                deadline.add(key);
            for (const key of holds.inFlight)
                inFlight.add(key);
        }
        return { deadline, inFlight };
    }
    /**
     * A slot came free somewhere in the workspace: pump EVERY manager,
     * longest-waiting-queue first.
     *
     * This is the counterpart to `busy()` being workspace-wide. A `RunManager`
     * only ever pumps itself, so before this existed a freed slot reached
     * exactly one project's queue: a run queued in project B stayed `queued`
     * while project A's runs came and went, until B happened to start or finish
     * a run of its own (or someone saved the workspace config). Every
     * slot-freeing transition — a run settling, a session parking at `waiting`
     * — routes here instead.
     *
     * Pumps are awaited in turn so the manager that takes the slot has it
     * counted (`starting`) before the next manager evaluates capacity — two
     * managers pumping concurrently could both read the same free slot and
     * overshoot `maxParallel`. Ordering is best-effort fairness, not a global
     * FIFO gate: a manager whose head-of-queue can't start (non-git root,
     * spec 006 degradation) must never block the rest of the workspace.
     */
    async release() {
        if (this.broadcasting) {
            this.pendingRelease = true;
            return;
        }
        this.broadcasting = true;
        try {
            do {
                this.pendingRelease = false;
                const ordered = [...this.participants]
                    .map((participant) => ({
                    participant,
                    // Empty queues sort last — they have nothing to claim the slot with.
                    since: participant.oldestQueuedAt() ?? Number.MAX_SAFE_INTEGER,
                }))
                    .sort((a, b) => a.since - b.since);
                for (const { participant } of ordered)
                    await participant.pump();
            } while (this.pendingRelease);
        }
        finally {
            this.broadcasting = false;
        }
    }
    /**
     * The effective per-project concurrency cap for a manager's repo root: the
     * project's own `maxParallel` if set in the registry, else the workspace cap
     * (`maxParallel()`). Answered from the cached snapshot — the class's
     * no-per-tick-file-read invariant is preserved; the only syscall is a
     * `realpathSync` to key the lookup the same way the registry normalizes
     * `root` (once per `pump()`, alongside the existing `getRepoInfo` stat). A
     * root with no registry entry (an ad-hoc run outside the registry) has no
     * override and inherits the workspace cap.
     */
    projectMaxParallel(repoRoot) {
        const override = this.limits.projectLimits?.get(normalizeRootSync(repoRoot));
        return override ?? this.maxParallel();
    }
    /**
     * The workspace resource-cache hook: re-read the config and pump every
     * registered manager, so a config change takes effect without a restart.
     * Called at boot and by `PUT /api/workspace/config` (step 2.7). A failed
     * read keeps the last good cache — enforcement never degrades to unlimited
     * because the file was momentarily unreadable.
     */
    async refresh() {
        try {
            this.limits = await this.load();
        }
        catch {
            // keep the last good snapshot
        }
        // A raised cap is capacity appearing everywhere at once — same sweep.
        await this.release();
    }
}
//# sourceMappingURL=semaphore.js.map