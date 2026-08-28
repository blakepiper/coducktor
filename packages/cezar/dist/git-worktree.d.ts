/**
 * Git worktree per task (spec 006). Each run gets its own branch
 * `cez/<id8>` checked out into `.ai/cezar/worktrees/<runId>` so agents never
 * touch the user's working tree. Pattern ported from github-janitor's
 * `git.ts` (createWorktree / autosaveCommit), minus the bare clone — we're
 * already inside a working copy. Everything degrades: helpers never throw
 * except `createWorktree`, whose failure the caller turns into a note.
 */
/** Repo-relative home of all task worktrees (gitignored via .ai/cezar/.gitignore). */
export declare const WORKTREES_DIR = ".ai/cezar/worktrees";
export declare function branchFor(runId: string): string;
/**
 * Resolve the configured base branch to something `git worktree add` can
 * fork from: the local branch, its remote-tracking ref, or null — the caller
 * falls back to the current branch with a note. Never throws.
 *
 * When BOTH the local branch and `origin/<base>` exist, prefer whichever is up
 * to date. A stale LOCAL base (behind origin, because nothing fetched it into
 * this worktree's repo) is the classic inflated-diff trap: the merge-base every
 * diff is measured from collapses onto the stale tip, so all of the history
 * merged into origin since then counts as the task's own changes — the phantom
 * 142k-line diff. `origin/<base>` is the source of truth for a review base, so
 * only keep the local ref when it is equal to or ahead of origin (unpushed base
 * commits); otherwise use origin.
 *
 * This answers the question once, when the worktree is forked. The local ref
 * goes stale AFTERWARDS too — agents fetch, they never pull — so every diff
 * re-applies the same rule at read time through `freshestBaseRef`
 * (`git-diff-base.ts`). Keep the two in agreement.
 */
export declare function resolveBaseRef(repoRoot: string, base: string): Promise<string | null>;
export declare function worktreePathFor(repoRoot: string, runId: string): string;
export interface WorktreeInfo {
    path: string;
    branch: string;
    /** Branch name the worktree was forked from (commit sha when HEAD was detached). */
    baseBranch: string;
}
/**
 * Establish the task worktree idempotently. Besides the fresh
 * `git worktree add -b` path, recover the two normal restart/deletion cases:
 * reuse an already-registered task worktree, or reattach a surviving task
 * branch after its directory/registration was removed. Existing non-empty
 * unregistered paths are never deleted because they may hold recoverable
 * uncommitted work.
 */
export declare function createWorktree(repoRoot: string, runId: string, baseBranch: string): Promise<WorktreeInfo>;
/**
 * Best-effort on-disk size of a worktree directory in bytes, via POSIX
 * `du -sk` (kibibytes → bytes). Returns `null` when `du` is unavailable —
 * including all of Windows, where `du` is not a command — or on any error.
 * Never throws and never blocks: worktree retention is count-based, so a null
 * size only blanks the panel's size column, it does not affect reclamation.
 */
export declare function worktreeSizeBytes(path: string): Promise<number | null>;
/** Remove a task worktree and its branch. Best effort — never throws. */
export declare function removeWorktree(repoRoot: string, worktreePath: string, branch?: string): Promise<void>;
/**
 * Why an autosave commit happened. Only `periodic` is gated (behind
 * `CEZ_AUTOSAVE=1`, #471) — the three flushes always run so the branch ends
 * holding the finished state. Before this was recorded, all four wrote the bare
 * message `cezar autosave`, so a user who had opted out of the periodic timer
 * still saw `cezar autosave` in `git log` and reasonably concluded the opt-out
 * was broken. Only commit *spacing* (~90 s ⇒ timer) told them apart.
 */
export type AutosaveReason = 'periodic' | 'turn end' | 'run finalize' | 'pre-PR';
/**
 * What an autosave attempt did. `refused` and `failed` are distinct from
 * `nothing-to-do` because one call site must act on them: the pre-PR flush is
 * the *last* one, so anything other than `committed`/`nothing-to-do` there
 * means the branch leaves the box without the run's final state and the user
 * has to be told (see createDraftPr). A bare boolean could not carry that.
 */
export type AutosaveResult = 'committed' | 'nothing-to-do' | 'refused' | 'failed';
/**
 * Stage and commit everything in the worktree as a "cezar autosave" commit
 * (janitor pattern) — the agent's progress is always recoverable from the
 * `cez/<id8>` branch history. Quietly a no-op when nothing changed.
 *
 * The message carries `reason` so the opt-in periodic timer and the always-on
 * flushes are distinguishable in `git log`; the `cezar autosave` prefix is kept
 * so existing log greps still match.
 *
 * Refuses to commit a worktree that is mid-merge or still carries conflict
 * markers: the incident behind #471 was an autosave capturing a half-resolved
 * merge, and a blind `git add -A` would do it again.
 */
export declare function autosaveCommit(dir: string, reason: AutosaveReason): Promise<AutosaveResult>;
/**
 * "What did this task change": diff of the worktree (committed + uncommitted
 * + untracked, via `add -N`) against the merge-base with its base branch —
 * so the diff stays *this task's* changes even after the base moves on.
 *
 * Deliberately does NOT take the repointed-HEAD guard that `collectChanges`
 * (#591) and `worktreeShortstat` (#751) resolve through
 * `resolveTaskDiffBase` — this is the whole-branch anchor on purpose, for two
 * reasons. Its text output is `GET /api/v1/runs/:id/diff`, a protected surface
 * (BACKWARD_COMPATIBILITY.md §2), so narrowing it would silently change what
 * every existing consumer reads. And its other caller, `settleSuccess`, asks
 * only "is there anything here to review at all" — over-answering that parks a
 * run at the review gate, which is recoverable, while under-answering would
 * settle a run to `done` with work still in the tree. If a future change wants
 * the narrow answer here, take it from `resolveTaskDiffBase` rather than
 * re-deriving the rule a fourth time.
 */
export declare function worktreeDiff(worktreePath: string, baseBranch: string, cap?: number): Promise<string>;
/**
 * `git diff --stat` version of `worktreeDiff` (spec 010 — the variant
 * comparison columns). Same merge-base anchoring, and it stays whole-branch
 * for a reason of its own: variants are sibling cezar worktrees, each on its
 * own `cez/*` branch, and the column exists to compare their *committed* work
 * against one another. Narrowing one variant to its uncommitted tree would
 * make the comparison meaningless rather than more honest. Returns '' on any
 * failure. (The task-diff rule the other surfaces follow: `git-diff-base.ts`.)
 */
export declare function worktreeDiffStat(worktreePath: string, baseBranch: string): Promise<string>;
/** Aggregate diff numbers (#389) — the shape stored on `RunRecord.diffStat`. */
export interface DiffStat {
    adds: number;
    dels: number;
    files: number;
    /** Set only when the numbers were narrowed to what this run did on a branch it checked
     *  out into its worktree, because HEAD had been repointed off the task's branch (#751).
     *  Absent — never `false` — on a normal run, so the persisted shape is unchanged for
     *  every task that behaved. */
    repointed?: boolean;
}
/**
 * Parse `git diff --shortstat` output — " 3 files changed, 10 insertions(+),
 * 2 deletions(-)". Every part is optional: insertions-only and deletions-only
 * diffs omit the other counter, and an empty diff prints nothing at all
 * (→ all zeros). The wording is stable porcelain English — git does not
 * localize `--shortstat` — so matching the words is safe.
 */
export declare function parseShortstat(s: string): DiffStat;
/**
 * `git diff --shortstat` of the worktree vs its base (#389) — the numbers
 * behind `RunRecord.diffStat`, which is what the sidebar quick list and the
 * Tasks table show. Same intent-to-add as `worktreeDiff`, but the anchor comes
 * from the shared `resolveTaskDiffBase` rule (`git-diff-base.ts`): pass the
 * run's own `taskBranch` and `runStartedAt`, and a worktree whose HEAD was
 * repointed onto another branch reports what this run did to that branch
 * instead of claiming the branch's whole diff as this task's (#751 — the #591
 * guard, on this surface). The same rule re-resolves a stale local base ref,
 * so the number never counts upstream history the task merely forked from.
 *
 * `repointed: true` rides along on the returned stat exactly when that
 * narrowing happened, so the UI can say why the number is what it is. Null on
 * git failure (the caller notes it, never fails the run); an empty diff is a
 * valid all-zero stat.
 */
export declare function worktreeShortstat(worktreePath: string, baseBranch: string, opts?: {
    taskBranch?: string;
    runStartedAt?: string;
}): Promise<DiffStat | null>;
/**
 * Startup reconcile: `git worktree prune` + remove every directory under
 * `.ai/cezar/worktrees/` whose run id is no longer in the store (and its
 * branch). Returns the removed run ids for the boot log. Never throws.
 */
export declare function pruneOrphans(repoRoot: string, validIds: ReadonlySet<string>): Promise<string[]>;
