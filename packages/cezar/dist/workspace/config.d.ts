import { z } from 'zod';
/**
 * `~/.cezar/config.json` — the per-user workspace config + project registry
 * (spec 2026-07-20-multi-project-workspace). House rules from the spec's Data
 * Model, applied verbatim:
 *
 * - every field optional/defaulted with `.catch`, so a bad value degrades
 *   per-key instead of discarding the file;
 * - `.passthrough()` at every object level, so keys a *newer* cezar wrote
 *   survive a round-trip through an older one;
 * - `.max()` bounds on strings (this file is parsed on every boot);
 * - atomic tmp+rename writes with mode `0600` (dir `0700`);
 * - a corrupt file degrades to in-memory defaults plus ONE warning line — the
 *   registry rebuilds as projects are opened, so losing it is an
 *   inconvenience, not data loss. The corrupt file is left in place until the
 *   next successful merge-write replaces it.
 */
/** `id` slug rule — mirrors the spec: `^[a-z0-9][a-z0-9-]{0,63}$`. */
export declare const PROJECT_ID_RE: RegExp;
/**
 * One registry entry. `id` + `root` are load-bearing (an entry without them is
 * useless and gets dropped by the per-entry salvage below); the display fields
 * degrade per-key so one bad value never evicts the project.
 */
declare const workspaceProjectSchema: z.ZodObject<{
    id: z.ZodString;
    root: z.ZodString;
    name: z.ZodCatch<z.ZodString>;
    addedAt: z.ZodCatch<z.ZodString>;
    lastOpenedAt: z.ZodCatch<z.ZodString>;
    source: z.ZodCatch<z.ZodEnum<{
        checkout: "checkout";
        local: "local";
    }>>;
    maxParallel: z.ZodCatch<z.ZodOptional<z.ZodNumber>>;
    tags: z.ZodCatch<z.ZodOptional<z.ZodArray<z.ZodString>>>;
}, z.core.$loose>;
export type WorkspaceProject = z.infer<typeof workspaceProjectSchema>;
/**
 * Zero-config cadence, in minutes, for re-checking a run parked with
 * `CEZ:MONITORING` (#810). The single source of truth for that default — the
 * schema below and `WorkspaceSemaphore`'s fallback both read it, so an install
 * with no `~/.cezar/config.json` and a semaphore built without boot wiring
 * agree. `null` (explicit park) is a user choice and is never replaced by it.
 */
export declare const DEFAULT_MONITORING_WAKE_MINUTES = 5;
declare const workspaceConfigSchema: z.ZodObject<{
    schemaVersion: z.ZodCatch<z.ZodDefault<z.ZodNumber>>;
    browseRoot: z.ZodCatch<z.ZodDefault<z.ZodString>>;
    projectsDir: z.ZodCatch<z.ZodDefault<z.ZodString>>;
    skillsAutoUpdate: z.ZodCatch<z.ZodOptional<z.ZodBoolean>>;
    modelsLocked: z.ZodCatch<z.ZodOptional<z.ZodBoolean>>;
    resources: z.ZodCatch<z.ZodPrefault<z.ZodObject<{
        maxParallel: z.ZodCatch<z.ZodDefault<z.ZodNumber>>;
        maxMonitoringSessions: z.ZodCatch<z.ZodDefault<z.ZodNumber>>;
        monitoringWakeIntervalMinutes: z.ZodCatch<z.ZodDefault<z.ZodNullable<z.ZodNumber>>>;
        autoResumeOnUsageLimit: z.ZodCatch<z.ZodDefault<z.ZodBoolean>>;
        intelligentContextRefresh: z.ZodCatch<z.ZodDefault<z.ZodBoolean>>;
        memoryLimitMb: z.ZodCatch<z.ZodDefault<z.ZodNullable<z.ZodNumber>>>;
        worktreeRetentionDefault: z.ZodCatch<z.ZodDefault<z.ZodNumber>>;
    }, z.core.$loose>>>;
    composerDefaults: z.ZodCatch<z.ZodDefault<z.ZodObject<{
        autonomous: z.ZodCatch<z.ZodOptional<z.ZodBoolean>>;
        worktree: z.ZodCatch<z.ZodOptional<z.ZodBoolean>>;
    }, z.core.$loose>>>;
    disabledProviders: z.ZodPipe<z.ZodCatch<z.ZodDefault<z.ZodArray<z.ZodUnknown>>>, z.ZodTransform<("claude" | "codex" | "opencode" | "pi")[], unknown[]>>;
    agentDefaults: z.ZodCatch<z.ZodDefault<z.ZodObject<{
        runner: z.ZodCatch<z.ZodOptional<z.ZodUnion<readonly [z.ZodEnum<{
            claude: "claude";
            codex: "codex";
            opencode: "opencode";
            pi: "pi";
        }>, z.ZodLiteral<"auto">]>>>;
        models: z.ZodCatch<z.ZodOptional<z.ZodObject<{
            claude: z.ZodCatch<z.ZodOptional<z.ZodString>>;
            codex: z.ZodCatch<z.ZodOptional<z.ZodString>>;
            opencode: z.ZodCatch<z.ZodOptional<z.ZodString>>;
            pi: z.ZodCatch<z.ZodOptional<z.ZodString>>;
        }, z.core.$loose>>>;
    }, z.core.$loose>>>;
    quotaRouting: z.ZodCatch<z.ZodPrefault<z.ZodObject<{
        enabled: z.ZodCatch<z.ZodDefault<z.ZodBoolean>>;
        providerOrder: z.ZodCatch<z.ZodDefault<z.ZodArray<z.ZodEnum<{
            claude: "claude";
            codex: "codex";
        }>>>>;
        refreshIntervalSeconds: z.ZodCatch<z.ZodDefault<z.ZodNumber>>;
        cacheTtlSeconds: z.ZodCatch<z.ZodDefault<z.ZodNumber>>;
        requestTimeoutSeconds: z.ZodCatch<z.ZodDefault<z.ZodNumber>>;
        unknownUsagePolicy: z.ZodCatch<z.ZodDefault<z.ZodEnum<{
            allow: "allow";
            deny: "deny";
        }>>>;
        providers: z.ZodCatch<z.ZodPrefault<z.ZodObject<{
            claude: z.ZodCatch<z.ZodPrefault<z.ZodObject<{
                enabled: z.ZodCatch<z.ZodDefault<z.ZodBoolean>>;
                stopNewWorkAtPercent: z.ZodCatch<z.ZodDefault<z.ZodNumber>>;
                longWindowStopAtPercent: z.ZodCatch<z.ZodDefault<z.ZodNumber>>;
                resumeBelowPercent: z.ZodCatch<z.ZodDefault<z.ZodNumber>>;
                maxConcurrent: z.ZodCatch<z.ZodDefault<z.ZodNumber>>;
            }, z.core.$loose>>>;
            codex: z.ZodCatch<z.ZodPrefault<z.ZodObject<{
                enabled: z.ZodCatch<z.ZodDefault<z.ZodBoolean>>;
                stopNewWorkAtPercent: z.ZodCatch<z.ZodDefault<z.ZodNumber>>;
                longWindowStopAtPercent: z.ZodCatch<z.ZodDefault<z.ZodNumber>>;
                resumeBelowPercent: z.ZodCatch<z.ZodDefault<z.ZodNumber>>;
                maxConcurrent: z.ZodCatch<z.ZodDefault<z.ZodNumber>>;
            }, z.core.$loose>>>;
        }, z.core.$loose>>>;
    }, z.core.$loose>>>;
    projects: z.ZodPipe<z.ZodCatch<z.ZodDefault<z.ZodArray<z.ZodUnknown>>>, z.ZodTransform<{
        [x: string]: unknown;
        id: string;
        root: string;
        name: string;
        addedAt: string;
        lastOpenedAt: string;
        source: "checkout" | "local";
        maxParallel?: number | undefined;
        tags?: string[] | undefined;
    }[], unknown[]>>;
}, z.core.$loose>;
export type WorkspaceConfig = z.infer<typeof workspaceConfigSchema>;
/** Resolve the auto-update preference without mutating or materializing it. */
export declare function effectiveSkillsAutoUpdate(config: Pick<WorkspaceConfig, 'skillsAutoUpdate'>, env?: NodeJS.ProcessEnv): boolean;
export declare function effectiveComposerDefault(stored: boolean | undefined, envValue: string | undefined, fallback: boolean): boolean;
/** The in-memory default — what a missing/corrupt file behaves like. */
export declare function defaultWorkspaceConfig(): WorkspaceConfig;
/**
 * The last-known-good copy of a NON-EMPTY registry, written beside the config
 * by every successful merge-write. The registry is cheap to rebuild in theory
 * ("open the project again"), but in practice it is a hand-curated list, and a
 * single bad write — a crash between `writeFileSync` and `rename`, a full
 * disk, a stray process — costs the user every entry. One extra file, no
 * configuration, and `loadWorkspaceConfig` falls back to it.
 *
 * Removing `~/.cezar` still resets cezar completely; removing only
 * `config.json` no longer does, because this snapshot restores it.
 *
 * A cezar older than this change does not refresh the snapshot, so on a machine
 * that alternates between versions it can lag behind the registry — which only
 * shows if the config file is also lost, and the worst case is a project the
 * user unregistered reappearing. Cheap next to losing the whole list.
 */
export declare function workspaceConfigBackupPath(path?: string): string;
/**
 * Read `~/.cezar/config.json` on demand — never cached, never throws. A
 * missing file is the zero-config default (silent); an unreadable or
 * malformed one degrades to the same default with a one-line warning and is
 * left on disk untouched (the next successful merge-write replaces it).
 *
 * Before degrading, a missing, empty, or corrupt file is restored from the
 * `config.json.bak` snapshot when that still holds projects. The restore is
 * read-only: the recovered registry is handed back in memory and lands on disk
 * again through the next merge-write, so a read never writes. A file that
 * parses and simply has no projects is NOT restored — that is a user who
 * removed their last project, not a lost registry.
 *
 * `path` defaults to the current `workspaceConfigPath()`, but a caller that
 * will also WRITE passes the path it resolved itself — see
 * `mergeWriteWorkspaceConfig` for why resolving it twice is a data-loss bug.
 */
export declare function loadWorkspaceConfig(path?: string): Promise<WorkspaceConfig>;
/**
 * The tmp path an atomic write stages through — UNIQUE PER WRITE, never a
 * fixed `${path}.tmp`. `~/.cezar/` is shared by every cezar process on the
 * machine (a `serve` per repo, `cezar run`s, a settings PUT), and two writers
 * staging through the same tmp name interleave: writer B's `O_TRUNC` open can
 * empty the file between writer A's write and rename, so A renames a
 * truncated/half-written file into place — and B's own rename then throws
 * `ENOENT` on the name A consumed. The pid + random suffix gives every writer
 * its own staging file, so the only cross-process contention left is the
 * rename itself, which is atomic.
 */
export declare function atomicTmpPath(path: string): string;
/** Atomic JSON write (`0600`, dir `0700`) via a per-writer tmp + rename —
 *  shared by the workspace config and ui-state writers. Throws on write
 *  failure (e.g. a read-only home) — degrading is the caller's policy. */
export declare function atomicWriteJsonSync(path: string, value: unknown): void;
/**
 * Read-modify-write merge: re-read the file, apply `mutator`, atomic-rename
 * write (`0600`, dir `0700`). Because every writer re-reads immediately before
 * writing, two processes registering different projects converge instead of
 * dropping each other's entries (last-writer-wins only within the tiny
 * read→rename window — acceptable for a registry that self-heals on next
 * boot). The mutator may mutate its argument in place or return a replacement.
 * Returns the config that was written. Throws on write failure (e.g. a
 * read-only home) — degrading is the caller's policy, per house rules.
 *
 * The path is resolved ONCE, before the `await`, and the same value feeds the
 * read and the write. Resolving it twice used to lose the whole registry:
 * `workspaceConfigPath()` re-reads `CEZ_HOME` on every call, so if the variable
 * changed while the read was in flight — a test's `afterEach` dropping its pin
 * after a timeout is the way this happens in practice — the read came from one
 * home and the write landed in another, replacing that file's registry with a
 * config it never held. One resolution keeps a merge-write inside exactly one
 * file, whatever the environment does mid-flight.
 */
export declare function mergeWriteWorkspaceConfig(mutator: (config: WorkspaceConfig) => WorkspaceConfig | void): Promise<WorkspaceConfig>;
export {};
