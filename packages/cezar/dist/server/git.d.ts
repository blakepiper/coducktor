export interface RepoInfo {
    root: string;
    branch: string;
    remote?: string;
}
export interface StatusEntry {
    status: string;
    path: string;
}
export interface LogEntry {
    hash: string;
    subject: string;
    author: string;
    when: string;
}
/** Null when `dir` isn't inside a git repository. */
export declare function getRepoInfo(dir: string): Promise<RepoInfo | null>;
/** The current commit, pinned as a full SHA. Null outside a repository or before its first commit. */
export declare function getHeadCommit(root: string): Promise<string | null>;
export declare function getStatus(root: string): Promise<StatusEntry[]>;
/** Working-tree diff vs HEAD (staged + unstaged), capped for the GUI. */
export declare function getDiff(root: string, cap?: number): Promise<string>;
/** Local + origin branch names, deduped (origin/x counts as x), sorted.
 *  Feeds the Repo tab's base-branch picker. */
export declare function getBranches(root: string): Promise<string[]>;
/** One commit — message + stat + patch — for the Repo view's expandable rows. */
export declare function getCommit(root: string, sha: string, cap?: number): Promise<string>;
export declare function getLog(root: string, count?: number): Promise<LogEntry[]>;
