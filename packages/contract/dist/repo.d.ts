import { z } from 'zod';
/**
 * The repo / git family of `/api/v1` — the Repo view, the structured diff shapes the Changes and
 * Files tabs read, and the worktree-retention panel.
 *
 * `RepoInfo` is NOT redeclared here: health already owns it (`./health.ts`), and the Repo view
 * serves the very same record.
 */
/** One `git status --porcelain` row. */
export declare const statusEntrySchema: z.ZodObject<{
    status: z.ZodString;
    path: z.ZodString;
}, z.core.$strip>;
export type StatusEntry = z.infer<typeof statusEntrySchema>;
/** One `git log` row; `when` is git's relative `%cr` ("3 hours ago"), not a timestamp. */
export declare const logEntrySchema: z.ZodObject<{
    hash: z.ZodString;
    subject: z.ZodString;
    author: z.ZodString;
    when: z.ZodString;
}, z.core.$strip>;
export type LogEntry = z.infer<typeof logEntrySchema>;
/**
 * `GET /api/v1/repo` — the Repo view's one read.
 *
 * A union, and deliberately so: the handler answers a DIFFERENT object when the project root is
 * not a repository (`server.ts:3481`) than when it is (`server.ts:3494`), and the empty branch's
 * `[]` literals make its arrays `never[]` in the route type. Modelling this as the flat
 * `{ info: RepoInfo | null; status: StatusEntry[]; … }` the hand-written DTO used would be WIDER
 * than the route — the parity guard rejects it. Both members still parse the real wire bytes
 * (an empty array satisfies `z.array(z.never())`), so nothing is lost at runtime; it is the
 * compile-time shape that is oddly precise. See the report note on `server.ts:3481`.
 */
export declare const repoResponseSchema: z.ZodUnion<readonly [z.ZodObject<{
    info: z.ZodNull;
    status: z.ZodArray<z.ZodNever>;
    log: z.ZodArray<z.ZodNever>;
    branches: z.ZodArray<z.ZodNever>;
    baseBranch: z.ZodNull;
}, z.core.$strip>, z.ZodObject<{
    info: z.ZodObject<{
        root: z.ZodString;
        branch: z.ZodString;
        remote: z.ZodOptional<z.ZodString>;
    }, z.core.$strip>;
    status: z.ZodArray<z.ZodObject<{
        status: z.ZodString;
        path: z.ZodString;
    }, z.core.$strip>>;
    log: z.ZodArray<z.ZodObject<{
        hash: z.ZodString;
        subject: z.ZodString;
        author: z.ZodString;
        when: z.ZodString;
    }, z.core.$strip>>;
    branches: z.ZodArray<z.ZodString>;
    baseBranch: z.ZodNullable<z.ZodString>;
}, z.core.$strip>]>;
export type RepoResponse = z.infer<typeof repoResponseSchema>;
/** `POST /api/v1/repo/branch` — switch to an existing branch, or create one and switch. Every
 *  predictable git failure (invalid name, unknown `from`, dirty-tree conflict) is a 409. */
export declare const repoBranchResponseSchema: z.ZodObject<{
    branch: z.ZodString;
    created: z.ZodBoolean;
}, z.core.$strip>;
export type RepoBranchResponse = z.infer<typeof repoBranchResponseSchema>;
/** One changed file of a structured diff (`/runs/:id/changes`, `/repo/changes`, the commit
 *  routes). Assignable to the diff facade's `DiffFileChange` by construction. */
export declare const changedFileSchema: z.ZodObject<{
    path: z.ZodString;
    oldPath: z.ZodOptional<z.ZodString>;
    status: z.ZodEnum<{
        added: "added";
        copied: "copied";
        deleted: "deleted";
        modified: "modified";
        renamed: "renamed";
    }>;
    adds: z.ZodNumber;
    dels: z.ZodNumber;
    binary: z.ZodBoolean;
    image: z.ZodOptional<z.ZodBoolean>;
    patch: z.ZodString;
}, z.core.$strip>;
export type ChangedFile = z.infer<typeof changedFileSchema>;
/** `GET /api/v1/runs/:id/changes` and `GET /api/v1/repo/changes` — the structured diff.
 *  409 (+ reason) when the run's backing directory is unavailable or git itself refuses; never HTML. */
export declare const changesPayloadSchema: z.ZodObject<{
    files: z.ZodArray<z.ZodObject<{
        path: z.ZodString;
        oldPath: z.ZodOptional<z.ZodString>;
        status: z.ZodEnum<{
            added: "added";
            copied: "copied";
            deleted: "deleted";
            modified: "modified";
            renamed: "renamed";
        }>;
        adds: z.ZodNumber;
        dels: z.ZodNumber;
        binary: z.ZodBoolean;
        image: z.ZodOptional<z.ZodBoolean>;
        patch: z.ZodString;
    }, z.core.$strip>>;
    stat: z.ZodObject<{
        adds: z.ZodNumber;
        dels: z.ZodNumber;
        files: z.ZodNumber;
    }, z.core.$strip>;
    repointedHead: z.ZodOptional<z.ZodObject<{
        headBranch: z.ZodString;
        taskBranch: z.ZodString;
    }, z.core.$strip>>;
}, z.core.$strip>;
export type ChangesPayload = z.infer<typeof changesPayloadSchema>;
/** `GET /api/v1/repo/commit/:sha?structured=1` (and `/runs/:id/commit/:sha`) — one commit's
 *  metadata plus the same `{files, stat}` shape the /changes routes serve. A merge commit
 *  honestly answers zero files. The bare (unstructured) route keeps its legacy text shape. */
export declare const repoCommitPayloadSchema: z.ZodObject<{
    sha: z.ZodString;
    subject: z.ZodString;
    author: z.ZodString;
    when: z.ZodString;
    files: z.ZodArray<z.ZodObject<{
        path: z.ZodString;
        oldPath: z.ZodOptional<z.ZodString>;
        status: z.ZodEnum<{
            added: "added";
            copied: "copied";
            deleted: "deleted";
            modified: "modified";
            renamed: "renamed";
        }>;
        adds: z.ZodNumber;
        dels: z.ZodNumber;
        binary: z.ZodBoolean;
        image: z.ZodOptional<z.ZodBoolean>;
        patch: z.ZodString;
    }, z.core.$strip>>;
    stat: z.ZodObject<{
        adds: z.ZodNumber;
        dels: z.ZodNumber;
        files: z.ZodNumber;
    }, z.core.$strip>;
}, z.core.$strip>;
export type RepoCommitPayload = z.infer<typeof repoCommitPayloadSchema>;
/** One row of a `GET /api/v1/runs/:id/files` directory listing. */
export declare const worktreeDirEntrySchema: z.ZodObject<{
    name: z.ZodString;
    type: z.ZodEnum<{
        dir: "dir";
        file: "file";
    }>;
    size: z.ZodOptional<z.ZodNumber>;
}, z.core.$strip>;
export type WorktreeDirEntry = z.infer<typeof worktreeDirEntrySchema>;
/**
 * `GET /api/v1/runs/:id/files?path=` — a directory listing or one file (size-capped, binary
 * flagged). `content` is absent exactly when `binary` or `tooLarge`.
 *
 * A discriminated union on `type`. Both handlers now build their literal with `as const`; without
 * it the property widened to `string` during Hono's route-type inference and the route lost the
 * discriminant, so a consumer narrowing on `entry.type === 'dir'` was left with `never`.
 */
export declare const worktreeEntrySchema: z.ZodDiscriminatedUnion<[z.ZodObject<{
    type: z.ZodLiteral<"dir">;
    path: z.ZodString;
    entries: z.ZodArray<z.ZodObject<{
        name: z.ZodString;
        type: z.ZodEnum<{
            dir: "dir";
            file: "file";
        }>;
        size: z.ZodOptional<z.ZodNumber>;
    }, z.core.$strip>>;
}, z.core.$strip>, z.ZodObject<{
    type: z.ZodLiteral<"file">;
    path: z.ZodString;
    size: z.ZodNumber;
    binary: z.ZodBoolean;
    tooLarge: z.ZodBoolean;
    content: z.ZodOptional<z.ZodString>;
}, z.core.$strip>], "type">;
export type WorktreeEntry = z.infer<typeof worktreeEntrySchema>;
/** One materialized task worktree in the management panel (#483). `sizeBytes` is null when `du`
 *  is unavailable (Windows / missing). `reclaimable` = finished, has a directory, not yet
 *  reclaimed (retention's rule). */
export declare const worktreeInfoSchema: z.ZodObject<{
    runId: z.ZodString;
    title: z.ZodString;
    status: z.ZodEnum<{
        cancelled: "cancelled";
        done: "done";
        failed: "failed";
        queued: "queued";
        review: "review";
        running: "running";
        waiting: "waiting";
    }>;
    branch: z.ZodNullable<z.ZodString>;
    sizeBytes: z.ZodNullable<z.ZodNumber>;
    finishedAt: z.ZodNullable<z.ZodString>;
    reclaimable: z.ZodBoolean;
}, z.core.$strip>;
export type WorktreeInfo = z.infer<typeof worktreeInfoSchema>;
/** `GET /api/v1/worktrees` (#483): the worktrees on disk, their total size (null when any
 *  degraded), and the current keep-limit (0 = unlimited). */
export declare const worktreesResponseSchema: z.ZodObject<{
    worktrees: z.ZodArray<z.ZodObject<{
        runId: z.ZodString;
        title: z.ZodString;
        status: z.ZodEnum<{
            cancelled: "cancelled";
            done: "done";
            failed: "failed";
            queued: "queued";
            review: "review";
            running: "running";
            waiting: "waiting";
        }>;
        branch: z.ZodNullable<z.ZodString>;
        sizeBytes: z.ZodNullable<z.ZodNumber>;
        finishedAt: z.ZodNullable<z.ZodString>;
        reclaimable: z.ZodBoolean;
    }, z.core.$strip>>;
    totalBytes: z.ZodNullable<z.ZodNumber>;
    keep: z.ZodNumber;
}, z.core.$strip>;
export type WorktreesResponse = z.infer<typeof worktreesResponseSchema>;
/** `POST /api/v1/worktrees/reclaim` (#483): the run ids whose directory was reclaimed. */
export declare const reclaimWorktreesResponseSchema: z.ZodObject<{
    reclaimed: z.ZodArray<z.ZodString>;
}, z.core.$strip>;
export type ReclaimWorktreesResponse = z.infer<typeof reclaimWorktreesResponseSchema>;
