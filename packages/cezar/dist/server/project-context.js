import { join } from 'node:path';
import { AutomationStore } from '../automations/store.js';
import { reconcileAutomationReceipts } from '../automations/task-template.js';
import { DEFAULT_WORKTREE_RETENTION, resolveWorktreeRetention } from '../config.js';
import { pruneOrphans } from '../git-worktree.js';
import { reclaimWorktrees } from '../runs/retention.js';
import { RunStore } from '../runs/store.js';
import { WorkspaceSemaphore } from '../workspace/semaphore.js';
import { RunManager } from '../workflows/run.js';
import { ensureLaunchKey } from './launch-key.js';
import { getRepoInfo } from './git.js';
/** Typed failure so the route layer can map reasons to statuses (404/409)
 *  without string matching. */
export class ProjectContextError extends Error {
    reason;
    projectId;
    constructor(reason, projectId) {
        super(reason === 'unknown-project'
            ? `unknown project: ${projectId}`
            : `project root is missing: ${projectId}`);
        this.reason = reason;
        this.projectId = projectId;
        this.name = 'ProjectContextError';
    }
}
/**
 * Lazy `Map<projectId, ProjectContext>`. Nothing is instantiated at
 * construction — the boot project is built eagerly by the caller via
 * `context(bootId)`; every other project on first API touch. Concurrent
 * `context()` calls for the same id share one build (the in-flight promise is
 * cached), so recovery never runs twice for a project.
 */
export class ProjectContexts {
    deps;
    contexts = new Map();
    building = new Map();
    /** Live store-created subscribers; invoked before RunManager recovery. */
    storeListeners = new Set();
    /** Live `onContextBuilt` subscribers (workspace SSE, step 2.8). */
    builtListeners = new Set();
    /** One semaphore for every manager this map builds — injected by boot,
     *  private-but-shared otherwise. */
    semaphore;
    constructor(deps) {
        this.deps = deps;
        this.semaphore = deps.semaphore ?? new WorkspaceSemaphore();
    }
    /** The built context for `projectId`, building it on first access.
     *  Throws `ProjectContextError` for unknown ids and missing roots. */
    async context(projectId) {
        const existing = this.contexts.get(projectId);
        if (existing)
            return existing;
        const inFlight = this.building.get(projectId);
        if (inFlight)
            return inFlight;
        const build = this.build(projectId);
        this.building.set(projectId, build);
        try {
            const ctx = await build;
            this.contexts.set(projectId, ctx);
            this.notifyBuilt(ctx);
            return ctx;
        }
        finally {
            this.building.delete(projectId);
        }
    }
    /**
     * Subscribe to future context builds (multi-project spec, step 2.8): the
     * workspace SSE stream attaches to every already-built context at connect
     * and uses this hook to pick up contexts built LATER — so subscribing never
     * force-instantiates a project, yet a project's first API touch makes its
     * events flow to already-open workspace streams. Returns an unsubscribe.
     */
    onContextBuilt(listener) {
        this.builtListeners.add(listener);
        return () => this.builtListeners.delete(listener);
    }
    /**
     * Subscribe at the earliest RunStore lifecycle point: immediately after a
     * lazy project's store opens and before its manager can recover runs. This
     * stays generic so backend-specific observers do not leak into the context
     * map. Returns an unsubscribe.
     */
    onStoreCreated(listener) {
        this.storeListeners.add(listener);
        return () => this.storeListeners.delete(listener);
    }
    /** A listener throwing must never fail the build (its store is usable). */
    notifyStoreCreated(store) {
        for (const listener of [...this.storeListeners]) {
            try {
                listener(store);
            }
            catch {
                // subscriber's problem — context construction can continue
            }
        }
    }
    /** A listener throwing must never fail the build (its context is fine). */
    notifyBuilt(ctx) {
        for (const listener of [...this.builtListeners]) {
            try {
                listener(ctx);
            }
            catch {
                // subscriber's problem — the build succeeded
            }
        }
    }
    /** Already-built context, without triggering a build. */
    peek(projectId) {
        return this.contexts.get(projectId);
    }
    /** Ids of every built context (dispose bookkeeping, shutdown flush). */
    ids() {
        return [...this.contexts.keys()];
    }
    /**
     * Tear down one project's context (project removal): the manager stops
     * making moves on its own (`RunManager.dispose()` — usage-sampler
     * unsubscribe, timers, queued state) and the store is closed — index
     * flushed to disk, every event-bus subscriber detached. Returns false when
     * nothing was built for `projectId`.
     */
    dispose(projectId) {
        const ctx = this.contexts.get(projectId);
        if (!ctx)
            return false;
        this.contexts.delete(projectId);
        teardown(ctx);
        return true;
    }
    /** Tear down every built context (process shutdown). */
    disposeAll() {
        for (const id of this.ids())
            this.dispose(id);
    }
    async build(projectId) {
        const projects = await this.deps.listProjects();
        const project = projects.find((p) => p.id === projectId);
        if (!project)
            throw new ProjectContextError('unknown-project', projectId);
        if (project.status === 'missing')
            throw new ProjectContextError('missing-root', projectId);
        const dataDir = join(project.root, '.ai/cezar');
        // keepLive + recover() (#367), same as serveCommand: runs that were live
        // when this project's context last existed are re-queued or resumed.
        const store = RunStore.open(dataDir, { keepLive: true });
        const automationStore = this.deps.automationStore?.(project.id, project.root)
            ?? AutomationStore.open(dataDir);
        reconcileAutomationReceipts(automationStore, store);
        this.notifyStoreCreated(store);
        const manager = new RunManager(store, project.root, {
            semaphore: this.semaphore,
            quotaCoordinator: this.deps.quotaCoordinator,
        });
        try {
            const launchKey = ensureLaunchKey(dataDir);
            // Startup reconcile (spec 006) + count-based retention (#483) — the same
            // best-effort sweeps serveCommand runs for the boot project, gated on the
            // root actually being a git repo.
            if (await getRepoInfo(project.root)) {
                await pruneOrphans(project.root, new Set(store.listRuns().map((r) => r.id))).catch(() => []);
                const keep = await resolveWorktreeRetention(project.root).catch(() => DEFAULT_WORKTREE_RETENTION);
                await reclaimWorktrees(project.root, store, keep).catch(() => []);
            }
            await manager.recover();
            return { id: project.id, root: project.root, dataDir, store, manager, automationStore, launchKey };
        }
        catch (err) {
            // A failed build must not leak the half-built context's subscriptions.
            teardown({ store, manager });
            throw err;
        }
    }
}
/** Shared teardown for built and half-built contexts. */
function teardown(ctx) {
    ctx.manager.dispose();
    ctx.store.flush();
    ctx.store.removeAllListeners();
}
//# sourceMappingURL=project-context.js.map