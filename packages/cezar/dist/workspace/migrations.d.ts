export { mergeWriteWorkspaceUiState } from './ui-state.ts';
/**
 * Workspace config migrations (spec 2026-07-20-multi-project-workspace,
 * "Migrations"). Deliberately tiny and **config-files-only** — run state
 * (`runs.json`, NDJSON) keeps the existing additive-zod convention and never
 * migrates. Rules, verbatim from the spec:
 *
 * - **idempotent** — every migration is safe to re-run after a crash mid-way;
 * - **additive** — never deletes or rewrites the user's per-repo files;
 * - **non-blocking** — a failing migration logs ONE warning and boot proceeds
 *   degraded with in-memory defaults; it is never a boot failure (the
 *   zero-config law "a read-only home degrades to a smaller cockpit" holds);
 * - **concurrency-safe** — every write takes the same read-modify-write +
 *   atomic-rename path as all workspace writes (`mergeWriteWorkspaceConfig`),
 *   and two processes racing the same idempotent step converge.
 */
export interface WorkspaceMigration {
    /** `schemaVersion` this migration produces. */
    to: number;
    /** Stable id for the warning line, e.g. `'001-workspace-config'`. */
    id: string;
    /** The migration body — MUST be idempotent (see module docs). */
    run(ctx: {
        home: string;
        bootRepoRoot: string | null;
    }): Promise<void>;
}
/** All known migrations. Kept in ascending `to` order; `runMigrations` sorts
 *  defensively anyway. */
export declare const WORKSPACE_MIGRATIONS: readonly WorkspaceMigration[];
/**
 * Run every pending workspace migration — called at boot before anything else
 * touches `~/.cezar`. Reads `schemaVersion` (absent file or key → 0, which
 * means "run everything" — safe because every migration is idempotent), runs
 * each migration with `to > current` in ascending order, and persists the new
 * `schemaVersion` after EACH one, so a crash resumes exactly where it left
 * off. A failing migration logs ONE warning and stops the chain (later
 * migrations may depend on earlier ones); boot proceeds degraded on in-memory
 * defaults. Never throws.
 *
 * `migrations` is injectable for tests only; production callers pass nothing.
 */
export declare function runMigrations(opts: {
    bootRepoRoot: string | null;
}, migrations?: readonly WorkspaceMigration[]): Promise<void>;
