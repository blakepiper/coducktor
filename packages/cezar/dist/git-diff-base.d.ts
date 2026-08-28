/**
 * "Which ref anchors *this task's* diff" — the single rule every task-diff
 * surface resolves through (#751).
 *
 * The normal answer is `merge-base(baseBranch, HEAD)`: it keeps a task's diff
 * to the task's own commits even after the base branch moves on, and even
 * after the task merges the base back in.
 *
 * Two things break that answer, and both are fixed here:
 *
 * **A stale local base ref.** `RunRecord.baseBranch` is a NAME (`main`),
 * resolved to a ref once, when the worktree was created. Nothing ever
 * fast-forwards the user's local `main` — cezar's agents only ever `git fetch`,
 * which moves `origin/main` — so on a repo the user does not pull, the local
 * ref drifts arbitrarily far behind. The merge-base then collapses onto that
 * stale tip and every upstream commit the task forked from or merged in counts
 * as the task's own work: an eight-line fix measured `+59514 −12160` against a
 * `main` that was 98 commits and one monorepo restructure behind origin. So the
 * base is re-resolved to the freshest ref it names at every call
 * (`freshestBaseRef`) — the read-time twin of `resolveBaseRef`, which does the
 * same thing at worktree-creation time and cannot know what happens later.
 *
 * **A repointed HEAD.** cezar hands the agent a worktree on the task's own
 * branch, but nothing stops the agent from checking out another branch in it —
 * every `review/pr-NNN` and QA run does exactly that, and so does every skill
 * that opens its work on a named `feat/…` branch. The merge-base then silently
 * redefines "this task's diff" as *the whole checked-out branch*, which is how
 * a task that committed nothing came to report `+22505 −2628`. #591 and #751
 * answered that with `HEAD` — uncommitted work only — which is right for a
 * pure review and badly wrong for the far more common case of an agent that
 * committed real work on a branch it created itself: those runs reported
 * `+0 −0` for changes that were genuinely theirs.
 *
 * The honest anchor for a repointed HEAD is the branch as it stood **when this
 * run first saw it** — its `<branch>@{<run start>}` reflog state. Diffing
 * against that attributes exactly what the run did to the tree and nothing
 * that was already there: a review run gets its `+0`, and a run that branched
 * off the base and committed gets its real numbers. Where that baseline is
 * itself stale — the run merged the base branch in afterwards, dragging the
 * whole upstream delta behind it — the ordinary merge-base is the tighter
 * answer, so the two candidates compete and the one that attributes FEWER
 * CHANGED LINES to the task wins. The reported number is then never more than
 * the least either measure can defend.
 *
 * It lives here so a third surface cannot get it wrong again — callers hand in
 * their own `git` runner (`git-worktree.ts` and `server/git-changes.ts` each
 * own a private one, and `git-changes` needs its scratch-`GIT_INDEX_FILE`
 * variant), so this module stays a pure decision with no process-spawning of
 * its own.
 */
/** What a caller's `git` runner must answer with. Both existing runners are wider than this. */
export interface GitRunResult {
    ok: boolean;
    stdout: string;
}
/** A caller-supplied `git` invocation, already bound to a working directory (and env). */
export type GitRunner = (args: string[]) => Promise<GitRunResult>;
/** The task branch cezar created vs. the branch HEAD actually sits on. */
export interface RepointedHead {
    headBranch: string;
    taskBranch: string;
}
export interface TaskDiffBase {
    /** The ref to diff against. */
    base: string;
    /** Present only when HEAD left the task's branch — the reason `base` is what it is. */
    repointedHead?: RepointedHead;
}
/**
 * Resolve the diff anchor for a task worktree. Never throws: a failing git call
 * degrades to the base branch name, which is what the un-guarded callers did
 * before this helper existed.
 *
 * `taskBranch` is optional because not every caller has one (the main working
 * tree has no task branch at all). Without it there is nothing to compare HEAD
 * against, so the merge-base anchor is used unchanged.
 *
 * `runStartedAt` is what makes the repointed-HEAD answer a measurement instead
 * of a guess; without it the anchor stays `HEAD` (uncommitted work only), the
 * conservative #751 answer that can never claim someone else's commits.
 */
export declare function resolveTaskDiffBase(runGit: GitRunner, baseBranch: string, opts?: {
    taskBranch?: string;
    runStartedAt?: string;
}): Promise<TaskDiffBase>;
