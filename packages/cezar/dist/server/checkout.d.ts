/** One `checkout-progress` SSE payload (workspace-level event, step 2.8's bus).
 *  `checkoutId` is echoed from the request so a cockpit only renders its own
 *  clone — two tabs cloning at once share the one workspace stream. */
export interface CheckoutProgressEvent {
    checkoutId?: string;
    /** The target folder name, so a payload is readable without the id too. */
    name: string;
    phase: 'cloning' | 'done' | 'error';
    /** One line of `git clone` progress (present on `cloning`). */
    line?: string;
    /** Human-readable failure (present on `error`). */
    error?: string;
}
export type CheckoutFailure = {
    ok: false;
    status: 400 | 409 | 500;
    error: string;
}
/** `gh` is missing or unauthenticated — the spec's `{ error, reason }`
 *  degradation, mirroring the GitHub pane's contract. */
 | {
    ok: false;
    status: 503;
    error: string;
    reason: string;
};
export type CheckoutResult = {
    ok: true;
    target: string;
    name: string;
} | CheckoutFailure;
/** A GitHub repo reference the clone flow accepts. */
export interface RepoRef {
    owner: string;
    repo: string;
    /** What `gh repo clone` is handed — always the normalized `owner/repo`, so a
     *  URL spelling can never smuggle flags or a different host past `gh`. */
    slug: string;
}
/**
 * Parse `owner/repo`, `https://github.com/owner/repo(.git)`, `git@github.com:owner/repo.git`
 * or `github.com/owner/repo` into a normalized ref. `null` when it is not a
 * GitHub repo reference — the route answers 400 rather than handing an
 * arbitrary string to `gh`.
 *
 * Only github.com: `gh repo clone` would happily take an enterprise host, but
 * this flow's contract (and its `gh`-availability degradation) is GitHub's, and
 * silently accepting `evil.example/owner/repo` would make the "which host am I
 * cloning from" question unanswerable from the dialog.
 */
export declare function parseRepoRef(input: string): RepoRef | null;
/**
 * Validate the target folder name (the dialog lets the user edit it, and it
 * defaults to the repo name).
 *
 * A name is one path segment and nothing else. `.` / `..` and anything with a
 * separator are rejected outright rather than sanitized: a silently rewritten
 * name would clone somewhere other than the path the dialog previewed, which
 * is the one thing a checkout target must never do. A leading dot is refused
 * too — a project named `.ssh` under the checkout root is not a project.
 */
export declare function isValidCheckoutName(name: string): boolean;
/**
 * Delete a partially-cloned checkout — the ONE destructive path in this module.
 *
 * Called only after `mkdir(target)` (non-recursive, so it succeeded only
 * because the directory did not exist and WE created it). Even with that proof
 * in hand, every one of these must hold or nothing is deleted:
 *
 * - `target` is still a real directory and NOT a symlink (`lstat`, not `stat`):
 *   between the mkdir and the failure, the directory could have been swapped
 *   for a link pointing anywhere.
 * - `projectsDir` and `target` both resolve (`realpath`), and the resolved
 *   target's PARENT is exactly the resolved checkout root. That is strict
 *   containment (nothing outside the root) *and* a depth limit (a direct child
 *   only, never the root itself, never a nested path).
 *
 * Any surprise — a vanished path, an unresolvable root, a `rm` that fails —
 * leaves the directory alone. Leaving a stray folder is a nuisance; deleting
 * the wrong one is unrecoverable, so every ambiguous case resolves toward "do
 * nothing".
 */
export declare function cleanupCheckout(projectsDir: string, target: string): Promise<boolean>;
/** Injected so the tests can drive a fake clone without a network or a `gh`
 *  binary. `dir` already exists (we created it); the runner clones INTO it. */
export type CloneRunner = (ref: RepoRef, dir: string, onLine: (line: string) => void, signal: AbortSignal | undefined) => Promise<{
    ok: true;
} | {
    ok: false;
    error: string;
    notFound?: boolean;
}>;
/**
 * `gh repo clone <owner/repo> <dir> -- --progress`.
 *
 * `spawn`, not `execFile`, because the whole point of this route is that the
 * dialog sees progress while it happens: `git clone --progress` writes its
 * counters to stderr, and each line becomes a `checkout-progress` event.
 * (`--progress` is needed explicitly — git suppresses it when stderr is not a
 * TTY, which it never is here.)
 */
export declare const ghCloneRunner: CloneRunner;
/** `CEZ_DRY_RUN=1` — a fake clone so the dialog (and the tests) can exercise
 *  the whole flow offline: a few progress lines and a plausible repo on disk.
 *  It writes only INSIDE the directory the caller already created. */
export declare const dryRunCloneRunner: CloneRunner;
export interface CheckoutOptions {
    /** Raw user input: `owner/repo` or a GitHub URL. */
    url: string;
    /** Target folder name; defaults to the repo name. */
    name?: string | undefined;
    /** The checkout root, ALREADY `~`-expanded by the caller. */
    projectsDir: string;
    onProgress: (event: CheckoutProgressEvent) => void;
    checkoutId?: string | undefined;
    signal?: AbortSignal | undefined;
    /** Test seam; defaults to `gh` (or the dry-run fake under `CEZ_DRY_RUN=1`). */
    run?: CloneRunner;
}
/**
 * Clone a GitHub repo into `<projectsDir>/<name>`, streaming progress.
 *
 * Answers only when the clone has finished (the spec's "long-running: answers
 * when the clone finishes"); the dialog's liveness comes from `onProgress`.
 * On any failure the partially-written directory is removed and NOTHING is
 * registered — registration is the caller's job, and only on `ok: true`.
 */
export declare function checkoutRepo(opts: CheckoutOptions): Promise<CheckoutResult>;
