export type SkillsUpdateScope = 'project' | 'global';
export type SkillsUpdateStatus = 'idle' | 'checking' | 'available' | 'updating' | 'current' | 'unavailable' | 'error';
export interface SkillsUpdateScopeState {
    scope: SkillsUpdateScope;
    status: SkillsUpdateStatus;
    available: boolean;
    skills: string[];
    checkedAt: string | null;
    updatedAt: string | null;
    reason?: string;
}
export interface SkillsUpdateState {
    status: SkillsUpdateStatus;
    available: boolean;
    autoUpdateEnabled: boolean;
    inherited: boolean;
    checkedAt: string | null;
    updatedAt: string | null;
    scopes: SkillsUpdateScopeState[];
    needsUpgradeNotes: boolean;
}
interface CommandResult {
    stdout: string;
    stderr: string;
}
export interface SkillsUpdateServiceOptions {
    homeDir?: string;
    now?: () => number;
    timeoutMs?: number;
    run?: (file: string, args: readonly string[], cwd: string, timeoutMs: number) => Promise<CommandResult>;
    resolveNpx?: () => Promise<string | null>;
    invalidateCatalog?: (repoRoot: string) => Promise<unknown> | unknown;
}
/** A manual apply distinguishes contention from ordinary unavailable state. */
export declare class SkillsUpdateConflictError extends Error {
    constructor();
}
/** Accept only GitHub's canonical host and the documented owner/repo shorthand. */
export declare function isOpenMercatoSkillsSource(value: unknown): boolean;
export declare class SkillsUpdateService {
    private readonly home;
    private readonly now;
    private readonly timeoutMs;
    private readonly runCommand;
    private readonly resolveNpx;
    private readonly invalidateCatalog;
    private readonly states;
    private readonly pending;
    private globalScopeCache?;
    private operationTail;
    constructor(options?: SkillsUpdateServiceOptions);
    snapshot(repoRoot: string): SkillsUpdateState;
    check(repoRoot: string, force?: boolean): Promise<SkillsUpdateState>;
    /** Apply only names proven available by the latest check. Browser callers
     * cannot widen this list: ownership is re-read from the lock immediately
     * before each fixed-argument invocation. */
    update(repoRoot: string, rejectIfBusy?: boolean): Promise<SkillsUpdateState>;
    evict(repoRoot: string): void;
    private serialized;
    private makeState;
    private performCheck;
    private performUpdate;
    private checkScope;
    private acquireLock;
    private readLockMetadata;
}
export interface SkillsUpdateProject {
    id: string;
    root: string;
    status?: string;
}
/** Post-listen owner for background checks. Its tail deliberately swallows
 * failures: update availability can never reject or delay server startup. */
export declare class SkillsUpdateCoordinator {
    private readonly service;
    private readonly autoUpdateEnabled;
    private readonly roots;
    private tail;
    private stopped;
    constructor(service: SkillsUpdateService, autoUpdateEnabled: () => Promise<boolean>);
    start(projects: readonly SkillsUpdateProject[]): void;
    add(id: string, root: string): void;
    remove(id: string): void;
    stop(): void;
    /** Test/lifecycle hook: resolves after all work queued so far. */
    settled(): Promise<void>;
}
export {};
