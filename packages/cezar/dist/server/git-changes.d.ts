import { type RepointedHead } from '../git-diff-base.ts';
export interface ChangedFile {
    path: string;
    /** Rename/copy source — present only when `status` is renamed/copied. */
    oldPath?: string;
    status: 'added' | 'modified' | 'deleted' | 'renamed' | 'copied';
    adds: number;
    dels: number;
    binary: boolean;
    /** True when `path`'s extension is one the raw-bytes route (`/files?raw=1`) will serve as an
     *  `<img>` (#365) — lets the diff pane preview it inline instead of the "Binary file" note,
     *  even for extensions (SVG) git itself doesn't flag `binary`. Present only when true. */
    image?: boolean;
    patch: string;
}
export interface ChangesPayload {
    files: ChangedFile[];
    stat: {
        adds: number;
        dels: number;
        files: number;
    };
    /** Present when a run worktree was repointed away from the task branch (#591). In that case the
     *  payload is intentionally limited to uncommitted changes instead of attributing the
     *  checked-out branch's history to this task. */
    repointedHead?: RepointedHead;
}
export type ChangesResult = {
    ok: true;
    changes: ChangesPayload;
} | {
    ok: false;
    error: string;
};
interface NumstatEntry {
    adds: number;
    dels: number;
    binary: boolean;
    path: string;
    oldPath?: string;
}
/** Parse `git diff --numstat -z -M`: `adds TAB dels TAB path NUL`, or for a
 *  rename/copy `adds TAB dels TAB NUL old NUL new NUL`. Binary files report
 *  `-` for both counters. Exported for tests. */
export declare function parseNumstatZ(out: string): NumstatEntry[];
interface NameStatusEntry {
    status: string;
    path: string;
    oldPath?: string;
}
/** Parse `git diff --name-status -z -M`: `X NUL path NUL`, renames/copies
 *  `Rnnn NUL old NUL new NUL`. Exported for tests. */
export declare function parseNameStatusZ(out: string): NameStatusEntry[];
/** Split one `git diff --patch` blob into per-file sections, in git's file
 *  order (the same order `--numstat`/`--name-status` use). Exported for tests. */
export declare function splitPatch(patch: string): string[];
/** Map each `git diff --patch` section to the file path it describes, so a file's
 *  patch is looked up by path rather than by position. This is robust to the two
 *  listings (`--name-status` and `--patch`) disagreeing on file count — the case
 *  where positional matching used to blank *every* file's patch. Exported for tests. */
export declare function patchByPath(sections: string[]): Map<string, string>;
/**
 * Structured "what changed here" for a directory vs its base branch:
 * committed + uncommitted + untracked (via `add -N`), anchored by the shared
 * `resolveTaskDiffBase` rule (`src/git-diff-base.ts`) — the merge-base against
 * the freshest base ref, so the diff stays *this task's* changes even after the
 * base moves on, and the branch's state at `runStartedAt` when the agent
 * repointed the worktree onto another branch (#591, #751).
 * `worktreeShortstat` resolves through the same helper; the text-blob `/diff`
 * endpoint (`worktreeDiff`) deliberately does not — see its own note.
 */
export declare function collectChanges(dir: string, baseBranch: string, opts?: {
    patchCap?: number;
    intentToAdd?: boolean;
    taskBranch?: string;
    runStartedAt?: string;
}): Promise<ChangesResult>;
/** The three raw `git diff` listings (name-status, numstat, patch) → the `{files, stat}`
 *  payload. Shared by the working-tree diff above and the commit diff below. Each file's
 *  patch is matched by path (`patchByPath`), so a mismatch between the name-status and
 *  patch file counts — a typechange, submodule, or any entry that emits no `diff --git`
 *  block — drops at most that one file's patch instead of blanking every file's. Positional
 *  matching remains the fallback for a section whose path can't be parsed, but only when the
 *  counts agree (the same condition the old all-or-nothing guard required). Exported for tests. */
export declare function assemblePayload(nameStatusOut: string, numstatOut: string, patchOut: string, patchCap: number): ChangesPayload;
export interface RunCommit {
    sha: string;
    subject: string;
    author: string;
    /** Relative time ("3 hours ago"), git's `%cr`. */
    when: string;
}
export type RunCommitsResult = {
    ok: true;
    commits: RunCommit[];
} | {
    ok: false;
    error: string;
};
export interface RunGitStatus {
    branch?: string;
    /** True when HEAD is reachable from a remote-tracking branch. */
    pushed: boolean;
}
/** Read the current branch's publication state without changing the worktree. A commit can be
 * published to a different remote branch (`git push origin HEAD:main`), so the current branch's
 * upstream is not sufficient: check every locally known remote-tracking branch first. A detached
 * HEAD or any git failure is conservatively reported as not pushed. */
export declare function collectRunGitStatus(dir: string): Promise<RunGitStatus>;
/**
 * The commits reachable from the worktree's current HEAD after its base, newest first. A review
 * task may deliberately repoint HEAD to the reviewed branch, so this list retains that useful
 * history even though `collectChanges` narrows its payload to uncommitted work in that case.
 * Empty (not an error) when the branch has no commits past base.
 */
export declare function collectRunCommits(dir: string, baseBranch: string): Promise<RunCommitsResult>;
/** `GET /api/repo/commit/:sha?structured=1` — one commit's metadata plus the same
 *  structured `{files, stat}` shape the working-tree routes serve (R5 Step 1.7). The
 *  legacy text-blob answer of that route is a protected surface and stays untouched. */
export interface CommitPayload {
    sha: string;
    subject: string;
    author: string;
    /** Relative time ("3 hours ago") — same `%cr` format the /api/repo log uses. */
    when: string;
    files: ChangedFile[];
    stat: {
        adds: number;
        dels: number;
        files: number;
    };
}
export type CommitChangesResult = {
    ok: true;
    commit: CommitPayload;
} | {
    ok: false;
    error: string;
};
/**
 * Structured diff of ONE commit vs its first parent (`--root` covers the initial commit).
 * A merge commit honestly answers zero files — `git diff-tree` shows no diff for merges
 * without `-m`/`-c`, and inventing one side's diff would misattribute the changes.
 * Unknown/invalid shas degrade to `{ ok:false, error }` for the route's 409.
 */
export declare function collectCommitChanges(dir: string, sha: string, patchCap?: number): Promise<CommitChangesResult>;
/** Max file content served to the Files tab — past this the GUI shows an
 *  honest "too large" state instead of the bytes. */
export declare const FILE_CONTENT_CAP = 512000;
export interface DirEntry {
    name: string;
    type: 'dir' | 'file';
    size?: number;
}
export type FilesResult = {
    kind: 'dir';
    path: string;
    entries: DirEntry[];
} | {
    kind: 'file';
    path: string;
    size: number;
    binary: boolean;
    tooLarge: boolean;
    content?: string;
} | {
    kind: 'invalid';
    error: string;
} | {
    kind: 'missing';
    error: string;
};
/** The image MIME type for a path, or null when it is not an image we serve raw. */
export declare function imageMimeType(path: string): string | null;
/** True when `path` is an image safe to hand to the OS's default handler — see OS_OPENABLE_EXT. */
export declare function isOsOpenableImage(path: string): boolean;
/**
 * Directory listing or file content from inside `root`, traversal-safe:
 * anything resolving outside the root (dot-segments, absolute paths, NUL) is
 * rejected — same "not a file we serve" stance as `isSafeAssetFilename` in
 * src/server/static-ui.ts. `.git` and symlinks are off-limits too.
 */
export declare function readWorktreePath(root: string, relPath: string, contentCap?: number): Promise<FilesResult>;
export type BranchResult = {
    ok: true;
    branch: string;
    created: boolean;
} | {
    ok: false;
    error: string;
};
/**
 * Repo-view branch action (`POST /api/repo/branch`): switch to `name` when it
 * already exists locally, otherwise create it from `from` (or HEAD) and switch.
 * Name validation is delegated to `git check-ref-format --branch` — git's own
 * rules, not a reimplementation — behind an explicit dash-guard (#431).
 * Predictable failures (invalid name, unknown `from`, dirty-tree checkout
 * conflict) come back as `{ ok:false, error }`.
 */
export declare function createOrSwitchBranch(dir: string, name: string, from?: string): Promise<BranchResult>;
export type CommitResult = {
    ok: true;
    sha: string;
} | {
    ok: false;
    error: string;
};
/** `git add -A && git commit -m <message>` in `dir`. A clean tree, a failing
 *  hook or missing identity all come back as `{ ok:false, error }`. */
export declare function commitAll(dir: string, message: string): Promise<CommitResult>;
export type PushResult = {
    ok: true;
    branch: string;
    remote: string;
    upstreamSet: boolean;
} | {
    ok: false;
    error: string;
};
/** Push the current branch, setting upstream when it has none. No remote,
 *  detached HEAD and rejected pushes all degrade to `{ ok:false, error }`. */
export declare function pushCurrentBranch(dir: string): Promise<PushResult>;
export {};
