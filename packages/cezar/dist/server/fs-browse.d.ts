/**
 * `GET /api/fs/browse` — the directory picker behind "Add project → open local
 * folder" (spec 2026-07-20-multi-project-workspace, step 4.1).
 *
 * This is the one route that hands the operator's filesystem shape to a
 * browser, so the whole module is written around a single containment rule and
 * nothing else:
 *
 *   **every path this route answers about — the one browsed and every entry
 *   listed — must be the browse root itself or live strictly beneath it, as
 *   judged AFTER `realpath()` resolved the whole symlink chain.**
 *
 * Why realpath and not `resolve()`: `resolve()` only normalizes `..` textually.
 * It cannot see that `~/tmp/escape` is a symlink to `/etc`, so a lexical-only
 * check happily lists `/etc` under a path that spells as being inside home.
 * The lexical check is still done FIRST (it rejects `..` traversal and absolute
 * escapes without touching the disk at all, and it keeps a probe for
 * "does /root exist" from ever reaching the filesystem), and the realpath check
 * is done SECOND as the authoritative one.
 *
 * Two more deliberate choices:
 *
 * - **Directories only.** Files are never listed, never stat-reported, never
 *   read. The picker's job is to name a folder; a file name is already more of
 *   the operator's disk than the caller needs.
 * - **Errors never echo a resolved path.** `{ error }` says what the caller did
 *   wrong, never where they landed — an error string carrying the realpath of
 *   an escape attempt would be the very leak the containment prevents (same
 *   reasoning as the `/api/health` `repoRoot` trim, #431).
 */
/** One listed subdirectory. `path` is absolute — this route is same-origin and
 *  behind the cockpit, exactly like `GET /api/projects`' `root`s (health, the
 *  CORS-open route, is the one that must never carry absolute paths). */
export interface FsBrowseDir {
    name: string;
    path: string;
    /** Has a `.git` entry — file or dir, so linked worktrees count. Drives the
     *  "repo" badge in the picker; a non-repo folder is still selectable. */
    isRepo: boolean;
}
/** `GET /api/fs/browse?path=` — the spec's shape plus `truncated`. */
export interface FsBrowseResponse {
    /** The realpath'd directory actually listed (never the spelling asked for —
     *  the picker's breadcrumb should show where it really is). */
    path: string;
    /** `null` AT the browse root: there is no "up" out of the root, and the UI
     *  needs that to be a shape it cannot mis-navigate. */
    parent: string | null;
    dirs: FsBrowseDir[];
    /** True when `dirs` was capped — an honest signal beats a silently short
     *  list in a directory with tens of thousands of children. */
    truncated: boolean;
}
export type BrowseResult = {
    ok: true;
    body: FsBrowseResponse;
} | {
    ok: false;
    status: 400 | 404;
    error: string;
};
/**
 * Expand the configured browse root. The workspace owns this independently
 * from the checkout root, so browsing never follows a clone-destination edit.
 */
export declare function resolveBrowseRoot(browseRoot: string): string;
/**
 * Is `candidate` the browse root or strictly beneath it — the same containment
 * question `browseDirectory` asks, exported for the ONE other route that must
 * ask it: `POST /api/projects` (step 4.2).
 *
 * Configuring the browse root only limits what the picker
 * can SEE. A register call naming an arbitrary absolute path would walk around
 * that in one request — and a registered project's panes read its whole tree.
 * So the register route re-asks containment for itself, against the same root,
 * with the same realpath-based rule. Both paths are realpath'd here (unlike
 * `contains`, which trusts its callers) because neither is guaranteed resolved.
 */
/**
 * The LEXICAL half of the containment question: does `candidate` spell as being inside `root`,
 * judged without asking whether it exists?
 *
 * `isInsideBrowseRoot` below realpaths both sides, which makes it answer `false` for a path that
 * is inside the root but simply not there — so using it alone as the first gate would tell a
 * hosted user who typo'd a folder under their own checkout root that it is "outside the browsable
 * root". This split lets the register route reject out-of-root paths UNIFORMLY (the existence
 * oracle stays shut, because a spelling outside the root is refused whether or not it exists),
 * then answer honestly about existence, then still catch symlink escapes with the realpath gate.
 */
export declare function isLexicallyInsideBrowseRoot(root: string, candidate: string): Promise<boolean>;
export declare function isInsideBrowseRoot(root: string, candidate: string): Promise<boolean>;
/**
 * List the directories inside `path`, contained within `root`.
 *
 * `path` is the raw query value: absent/empty means the root itself, `~`
 * spellings are expanded, and a relative value resolves against the root (so
 * the route is usable without the caller knowing the absolute root, and a
 * relative `../..` is still caught by the same containment check as everything
 * else).
 */
export declare function browseDirectory(opts: {
    root: string;
    path?: string | undefined;
    showHidden?: boolean;
}): Promise<BrowseResult>;
