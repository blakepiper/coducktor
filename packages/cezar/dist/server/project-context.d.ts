import { AutomationStore } from '../automations/store.ts';
import { RunStore } from '../runs/store.ts';
import { WorkspaceSemaphore } from '../workspace/semaphore.ts';
import type { QuotaCoordinator } from '../core/quota/coordinator.ts';
import { RunManager } from '../workflows/run.ts';
/**
 * Per-project server context (spec 2026-07-20-multi-project-workspace,
 * "Project contexts" + "Boot flow"): one `{store, manager, dataDir,
 * launchKey}` bundle per registered project, built lazily on first access.
 *
 * Building a context mirrors what `serveCommand` does for the boot project
 * today — `RunStore.open(dataDir, { keepLive: true })`, `new RunManager`,
 * orphan-worktree prune + count-based retention when the root is a git repo,
 * then `manager.recover()` — so a project opened from the sidebar gets the
 * exact same crash recovery the boot project gets. A registry entry whose
 * root is gone (`status: 'missing'`) is never instantiated; `context()`
 * throws a typed `ProjectContextError` the route layer maps to 409 (and
 * `unknown-project` to 404).
 */
/** The per-project bundle the routes operate on. */
export interface ProjectContext {
    /** Registry project id (slug). */
    id: string;
    /** Realpath'd repo root the registry holds for this project. */
    root: string;
    /** `<root>/.ai/cezar` — all of this project's on-disk state. */
    dataDir: string;
    store: RunStore;
    manager: RunManager;
    automationStore: AutomationStore;
    /** Bookmarklet auto-start secret (spec 011), ensured at context build. */
    launchKey: string;
}
/** Minimal registry shape the context map needs — matches
 *  `workspace/projects.ts` `ProjectListEntry` structurally, but injected so
 *  tests stay hermetic (no `~/.cezar` reads). */
export interface ProjectContextSource {
    id: string;
    root: string;
    /** `missing` roots are never instantiated; `ok`/`not-git` both build. */
    status: 'ok' | 'missing' | 'not-git';
}
export interface ProjectContextDeps {
    /** Registry lookup — the workspace `listProjects()` in production. */
    listProjects: () => Promise<readonly ProjectContextSource[]>;
    /** Resolve the one automation store owned by this project. Production
     *  injects the workspace automation coordinator's cached store so API
     *  mutations and scheduler reads share the same in-memory state. */
    automationStore?: (projectId: string, root: string) => AutomationStore;
    /** Workspace-wide parallel-cap semaphore (spec 2026-07-20, step 2.5). Boot
     *  passes the ONE instance it already gave the boot manager, so every
     *  project's RunManager counts against the same `resources.maxParallel`.
     *  When omitted, the map still shares one private instance across the
     *  managers it builds (workspace defaults, never refreshed). */
    semaphore?: WorkspaceSemaphore;
    /** Process-wide provider reservations; never create one per project. */
    quotaCoordinator?: QuotaCoordinator;
}
export type ProjectContextFailure = 'unknown-project' | 'missing-root';
/** Typed failure so the route layer can map reasons to statuses (404/409)
 *  without string matching. */
export declare class ProjectContextError extends Error {
    readonly reason: ProjectContextFailure;
    readonly projectId: string;
    constructor(reason: ProjectContextFailure, projectId: string);
}
/**
 * Lazy `Map<projectId, ProjectContext>`. Nothing is instantiated at
 * construction — the boot project is built eagerly by the caller via
 * `context(bootId)`; every other project on first API touch. Concurrent
 * `context()` calls for the same id share one build (the in-flight promise is
 * cached), so recovery never runs twice for a project.
 */
export declare class ProjectContexts {
    private readonly deps;
    private readonly contexts;
    private readonly building;
    /** Live store-created subscribers; invoked before RunManager recovery. */
    private readonly storeListeners;
    /** Live `onContextBuilt` subscribers (workspace SSE, step 2.8). */
    private readonly builtListeners;
    /** One semaphore for every manager this map builds — injected by boot,
     *  private-but-shared otherwise. */
    private readonly semaphore;
    constructor(deps: ProjectContextDeps);
    /** The built context for `projectId`, building it on first access.
     *  Throws `ProjectContextError` for unknown ids and missing roots. */
    context(projectId: string): Promise<ProjectContext>;
    /**
     * Subscribe to future context builds (multi-project spec, step 2.8): the
     * workspace SSE stream attaches to every already-built context at connect
     * and uses this hook to pick up contexts built LATER — so subscribing never
     * force-instantiates a project, yet a project's first API touch makes its
     * events flow to already-open workspace streams. Returns an unsubscribe.
     */
    onContextBuilt(listener: (ctx: ProjectContext) => void): () => void;
    /**
     * Subscribe at the earliest RunStore lifecycle point: immediately after a
     * lazy project's store opens and before its manager can recover runs. This
     * stays generic so backend-specific observers do not leak into the context
     * map. Returns an unsubscribe.
     */
    onStoreCreated(listener: (store: RunStore) => void): () => void;
    /** A listener throwing must never fail the build (its store is usable). */
    private notifyStoreCreated;
    /** A listener throwing must never fail the build (its context is fine). */
    private notifyBuilt;
    /** Already-built context, without triggering a build. */
    peek(projectId: string): ProjectContext | undefined;
    /** Ids of every built context (dispose bookkeeping, shutdown flush). */
    ids(): string[];
    /**
     * Tear down one project's context (project removal): the manager stops
     * making moves on its own (`RunManager.dispose()` — usage-sampler
     * unsubscribe, timers, queued state) and the store is closed — index
     * flushed to disk, every event-bus subscriber detached. Returns false when
     * nothing was built for `projectId`.
     */
    dispose(projectId: string): boolean;
    /** Tear down every built context (process shutdown). */
    disposeAll(): void;
    private build;
}
