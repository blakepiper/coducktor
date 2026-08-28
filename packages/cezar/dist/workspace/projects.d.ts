import { type ForgeKind } from '../server/forge/index.ts';
import { type WorkspaceProject } from './config.ts';
/**
 * Project registry operations over `~/.cezar/config.json` (spec
 * 2026-07-20-multi-project-workspace, "Project identity" + "Boot flow"):
 *
 * - `registerProject(root)` — realpath-normalize, dedupe by realpath, allocate
 *   a human-readable slug from `basename(root)`. Registration is additive and
 *   goes through the read-modify-write merge, so the worst race outcome
 *   between concurrent `cezar serve` processes is a lost `lastOpenedAt` bump —
 *   never a lost project.
 * - `listProjects()` — registry entries + a cheap per-root status/branch probe
 *   behind a short TTL cache, so a sidebar render never shells `git` N times.
 * - `removeProject(id)` — unregister only. It never touches any file inside
 *   the repo (a project's own state stays in `<repo>/.ai/cezar/`).
 */
/**
 * Slugs the allocator must never hand out: `default` is the reserved alias
 * for the boot project, the rest are the cockpit shell's own top-level path
 * segments. A repo named `default/` becomes `default-2` and can never shadow
 * the alias or a route.
 */
export declare const RESERVED_PROJECT_IDS: ReadonlySet<string>;
/**
 * Allocate a unique slug for `root`: the slug base, deduplicated against
 * `taken` ids AND the reserved ids with a numeric suffix (`api`, `api-2`,
 * `api-3`, …). Suffixed candidates stay within the 64-char cap by truncating
 * the base, never the suffix.
 */
export declare function allocateProjectSlug(root: string, taken: Iterable<string>): string;
/**
 * Registration guard (spec 2026-07-20-multi-project-workspace, "Boot flow"):
 * auto-registration is suppressed — the process still serves the folder
 * normally, it just doesn't pollute the registry — when the resolved
 * `repoRoot` is:
 *
 * - inside any `…/.ai/cezar/worktrees/…` path (task worktrees and nested
 *   `cez` invocations — the same nesting reality the `CEZ_TODOS_FILE=''`
 *   guard in `workflows/run.ts` acknowledges), checked on both the raw and
 *   realpath'd spelling so neither a symlinked prefix nor a literal one
 *   slips through; or
 * - the user's home directory itself (realpath-compared, so a symlinked
 *   `$HOME` still matches).
 */
export declare function shouldRegisterProject(repoRoot: string): Promise<boolean>;
/**
 * Register `root` in the workspace registry (idempotent). Known root (by
 * realpath) → bump its `lastOpenedAt` and return the existing entry, id and
 * all. Unknown → allocate a slug and append a new entry via merge-write.
 */
export declare function registerProject(root: string, source?: 'local' | 'checkout'): Promise<WorkspaceProject>;
/**
 * The ONE spelling rule for project tags — applied on every write, never on read.
 *
 * Trimmed, empties dropped, over-long ones truncated, deduped CASE-INSENSITIVELY (the first
 * spelling wins, so `Storefront` typed before `storefront` keeps its capital), capped at
 * `PROJECT_TAGS_MAX`, and sorted so two projects tagged with the same set store and render the
 * same list. Case-insensitive dedupe is what makes tags usable as a grouping key: `API` and `api`
 * grouping into two columns of the same thing is the whole failure this prevents.
 *
 * Returns `undefined` — never `[]` — for an empty result, because the registry stores nothing for
 * an untagged project and `delete entry.tags` is what the writers then do.
 */
export declare function normalizeProjectTags(tags: readonly string[] | null | undefined): string[] | undefined;
export type ProjectStatus = 'ok' | 'missing' | 'not-git';
export interface ProjectListEntry extends WorkspaceProject {
    /** `missing` = root gone/unreadable; `not-git` = exists but no `.git`. */
    status: ProjectStatus;
    /** Current branch when cheaply available (omitted e.g. on an unborn HEAD). */
    branch?: string;
    /** Which forge the root's remote belongs to (#698) — classified from the
     *  remote URL alone, no `gh` probe. Omitted when there is no forge remote.
     *  The sidebar gates each project group's GitHub tab on this, instead of on
     *  the boot folder's health-level forge answer. */
    forge?: ForgeKind;
    /** The remote's web root (`https://github.com/owner/repo`), rebuilt from the
     *  parsed remote so it can never carry credentials. What lets a cross-project
     *  surface link a reference the run knows only by NUMBER — the global Tasks
     *  page has one row per project and so cannot use any single repo's base. */
    repoUrl?: string;
}
/** Test hook: drop cached probes so status changes are visible immediately. */
export declare function clearProjectProbeCache(): void;
/**
 * One root's `status` (+`branch`) through the same TTL cache `listProjects`
 * uses. Exported for `POST /api/projects` (step 4.2): the register route
 * answers with the freshly registered entry and must hand the cockpit the
 * SAME shape the list route does — one project, one shape, whichever route
 * produced it.
 */
export declare function probeProjectStatus(root: string): Promise<Pick<ProjectListEntry, 'status' | 'branch' | 'forge' | 'repoUrl'>>;
/**
 * Registry entries in stored order, each with its `status` (+`branch` when
 * available). Probes run concurrently and are TTL-cached per root. A
 * `missing` project is only ever *listed* — callers must never instantiate a
 * context for it.
 */
export interface ProjectListSelector {
    /** Return only this registry id without mutating or pruning other rows. */
    projectId: string;
}
export declare function listProjects(selector?: ProjectListSelector): Promise<ProjectListEntry[]>;
/**
 * Remove `id` from the registry. Returns false when no such entry exists.
 * Pure unregistration: nothing inside the repo (worktrees, `.ai/cezar/`,
 * run history) is touched — re-registering the same root later gets a fresh
 * slug but finds all its state intact.
 */
export declare function removeProject(id: string): Promise<boolean>;
