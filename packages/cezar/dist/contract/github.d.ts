import { z } from 'zod';
/**
 * One issue or pull request, flattened for the cockpit (`ForgeItem` server-side).
 * A protected shape — BACKWARD_COMPATIBILITY.md §2 forbids reshaping it.
 */
export declare const githubItemSchema: z.ZodObject<{
    kind: z.ZodEnum<{
        issue: "issue";
        pr: "pr";
    }>;
    number: z.ZodNumber;
    title: z.ZodString;
    author: z.ZodString;
    createdAt: z.ZodString;
    labels: z.ZodArray<z.ZodString>;
    body: z.ZodString;
    url: z.ZodString;
    comments: z.ZodNumber;
    isDraft: z.ZodOptional<z.ZodBoolean>;
    additions: z.ZodOptional<z.ZodNumber>;
    deletions: z.ZodOptional<z.ZodNumber>;
    checks: z.ZodOptional<z.ZodNullable<z.ZodEnum<{
        failing: "failing";
        passing: "passing";
        pending: "pending";
    }>>>;
}, z.core.$strip>;
export type GithubItem = z.infer<typeof githubItemSchema>;
/**
 * `GET /api/v1/github` — the tab's issue + PR lists.
 *
 * NOT a discriminated union, unlike its siblings: `fetchGithub` always answers the full record and
 * merely flips `available`, so an unavailable payload still carries `issues: []` / `prs: []`.
 */
export declare const githubDataSchema: z.ZodObject<{
    available: z.ZodBoolean;
    reason: z.ZodOptional<z.ZodString>;
    repo: z.ZodOptional<z.ZodString>;
    syncedAt: z.ZodOptional<z.ZodString>;
    issues: z.ZodArray<z.ZodObject<{
        kind: z.ZodEnum<{
            issue: "issue";
            pr: "pr";
        }>;
        number: z.ZodNumber;
        title: z.ZodString;
        author: z.ZodString;
        createdAt: z.ZodString;
        labels: z.ZodArray<z.ZodString>;
        body: z.ZodString;
        url: z.ZodString;
        comments: z.ZodNumber;
        isDraft: z.ZodOptional<z.ZodBoolean>;
        additions: z.ZodOptional<z.ZodNumber>;
        deletions: z.ZodOptional<z.ZodNumber>;
        checks: z.ZodOptional<z.ZodNullable<z.ZodEnum<{
            failing: "failing";
            passing: "passing";
            pending: "pending";
        }>>>;
    }, z.core.$strip>>;
    prs: z.ZodArray<z.ZodObject<{
        kind: z.ZodEnum<{
            issue: "issue";
            pr: "pr";
        }>;
        number: z.ZodNumber;
        title: z.ZodString;
        author: z.ZodString;
        createdAt: z.ZodString;
        labels: z.ZodArray<z.ZodString>;
        body: z.ZodString;
        url: z.ZodString;
        comments: z.ZodNumber;
        isDraft: z.ZodOptional<z.ZodBoolean>;
        additions: z.ZodOptional<z.ZodNumber>;
        deletions: z.ZodOptional<z.ZodNumber>;
        checks: z.ZodOptional<z.ZodNullable<z.ZodEnum<{
            failing: "failing";
            passing: "passing";
            pending: "pending";
        }>>>;
    }, z.core.$strip>>;
    labelColors: z.ZodOptional<z.ZodRecord<z.ZodString, z.ZodString>>;
}, z.core.$strip>;
export type GithubData = z.infer<typeof githubDataSchema>;
/**
 * `GET /api/v1/github/checks?prs=…` (#664) — lazy PR checks glyphs, `number → glyph`. The list
 * call no longer ships `statusCheckRollup`, so a row's glyph is hydrated here for the on-screen
 * rows only. An absent number means "no checks / not found".
 */
export declare const githubChecksDataSchema: z.ZodDiscriminatedUnion<[z.ZodObject<{
    available: z.ZodLiteral<true>;
    checks: z.ZodRecord<z.ZodNumber, z.ZodNullable<z.ZodEnum<{
        failing: "failing";
        passing: "passing";
        pending: "pending";
    }>>>;
}, z.core.$strip>, z.ZodObject<{
    available: z.ZodLiteral<false>;
    reason: z.ZodString;
}, z.core.$strip>], "available">;
export type GithubChecksData = z.infer<typeof githubChecksDataSchema>;
/**
 * Where a referenced PR or issue STANDS — the vocabulary a task's tracker chip paints.
 *
 * One flat enum rather than a per-kind union, because the chip renders one status and a union
 * would make every consumer narrow on `kind` before it could pick a color. The kinds share no
 * value on purpose: a closed PR (abandoned — red) and a closed issue (`completed` — done, violet)
 * are opposite outcomes wearing the same English word, and collapsing them is how a merged-looking
 * task turns out to have been dropped.
 *
 * PR values: `merged`, `closed` (closed WITHOUT merging), `draft`, `checks-pending`,
 * `changes-requested`, `checks-failing`, `review-required`, `ready`. Issue values: `open`,
 * `completed`, `not-planned`.
 *
 * Which one a PR gets is `derivePrReferenceStatus`'s ranking (server-side, and documented there):
 * it answers "what is this waiting on right now", so it ranks by how FRESH a signal is rather
 * than by how heavy a blocker it is — running checks mean a commit was just pushed, and a
 * requested change the author has already pushed past is not what the PR is waiting on.
 *
 * `ready` is the honest reading of "nothing is blocking it here": open, not a draft, no failing or
 * running checks, and no review the forge is still waiting on. It is NOT a mergeability probe —
 * that is `githubPrMergeStateResponseSchema`, which costs a request per PR; this is one batched
 * query for a whole table.
 */
export declare const referenceStatusSchema: z.ZodEnum<{
    "changes-requested": "changes-requested";
    "checks-failing": "checks-failing";
    "checks-pending": "checks-pending";
    closed: "closed";
    completed: "completed";
    draft: "draft";
    merged: "merged";
    "not-planned": "not-planned";
    open: "open";
    ready: "ready";
    "review-required": "review-required";
}>;
export type ReferenceStatus = z.infer<typeof referenceStatusSchema>;
/**
 * `GET /api/v1/github/ref-status?prs=…&issues=…` — batched status for the PR/issue chips a task
 * table is painting. The additive sibling of `/github/checks`: same cache-behind-the-route shape,
 * same in-payload degrade, same "absent number = nothing known" rule (an unknown or unreachable
 * number is simply missing from the map, and its chip stays neutral).
 */
/**
 * How many numbers of ONE kind a single `/github/ref-status` request may name — the route 400s
 * past it, and the cockpit caps its batches to match.
 *
 * It lives in the contract because it is one: a client that believed a larger number would send
 * requests the server rejects outright, costing every chip in the batch its status rather than
 * just the tail. Two constants that must agree, in two packages, with nothing making them, is the
 * drift this export exists to prevent.
 */
export declare const REFERENCE_STATUS_MAX = 100;
export declare const githubRefStatusDataSchema: z.ZodDiscriminatedUnion<[z.ZodObject<{
    available: z.ZodLiteral<true>;
    prs: z.ZodRecord<z.ZodNumber, z.ZodEnum<{
        "changes-requested": "changes-requested";
        "checks-failing": "checks-failing";
        "checks-pending": "checks-pending";
        closed: "closed";
        completed: "completed";
        draft: "draft";
        merged: "merged";
        "not-planned": "not-planned";
        open: "open";
        ready: "ready";
        "review-required": "review-required";
    }>>;
    issues: z.ZodRecord<z.ZodNumber, z.ZodEnum<{
        "changes-requested": "changes-requested";
        "checks-failing": "checks-failing";
        "checks-pending": "checks-pending";
        closed: "closed";
        completed: "completed";
        draft: "draft";
        merged: "merged";
        "not-planned": "not-planned";
        open: "open";
        ready: "ready";
        "review-required": "review-required";
    }>>;
    recheckAfterMs: z.ZodNullable<z.ZodNumber>;
}, z.core.$strip>, z.ZodObject<{
    available: z.ZodLiteral<false>;
    reason: z.ZodString;
    recheckAfterMs: z.ZodNullable<z.ZodNumber>;
}, z.core.$strip>], "available">;
export type GithubRefStatusData = z.infer<typeof githubRefStatusDataSchema>;
/** One comment or PR review summary in an issue/PR thread (#499). */
export declare const githubCommentSchema: z.ZodObject<{
    id: z.ZodNumber;
    author: z.ZodString;
    avatarUrl: z.ZodOptional<z.ZodString>;
    createdAt: z.ZodString;
    body: z.ZodString;
    kind: z.ZodEnum<{
        comment: "comment";
        review: "review";
    }>;
    reviewState: z.ZodOptional<z.ZodEnum<{
        approved: "approved";
        changes_requested: "changes_requested";
        commented: "commented";
        dismissed: "dismissed";
    }>>;
    url: z.ZodString;
}, z.core.$strip>;
export type GithubComment = z.infer<typeof githubCommentSchema>;
/**
 * The timeline event kinds the thread renders (#525) — an allowlist, so an unknown GitHub event
 * type is dropped server-side rather than reaching the client.
 */
export declare const githubTimelineEventKindSchema: z.ZodEnum<{
    assigned: "assigned";
    closed: "closed";
    committed: "committed";
    "cross-referenced": "cross-referenced";
    head_ref_force_pushed: "head_ref_force_pushed";
    labeled: "labeled";
    merged: "merged";
    renamed: "renamed";
    reopened: "reopened";
    unassigned: "unassigned";
    unlabeled: "unlabeled";
}>;
export type GithubTimelineEventKind = z.infer<typeof githubTimelineEventKindSchema>;
/**
 * One non-comment timeline row (#525). Deliberately a separate shape from `GithubComment` rather
 * than a widened `kind`, which would break the client's narrowing.
 */
export declare const githubTimelineEventSchema: z.ZodObject<{
    id: z.ZodString;
    kind: z.ZodEnum<{
        assigned: "assigned";
        closed: "closed";
        committed: "committed";
        "cross-referenced": "cross-referenced";
        head_ref_force_pushed: "head_ref_force_pushed";
        labeled: "labeled";
        merged: "merged";
        renamed: "renamed";
        reopened: "reopened";
        unassigned: "unassigned";
        unlabeled: "unlabeled";
    }>;
    actor: z.ZodString;
    avatarUrl: z.ZodOptional<z.ZodString>;
    createdAt: z.ZodString;
    url: z.ZodOptional<z.ZodString>;
    sha: z.ZodOptional<z.ZodString>;
    message: z.ZodOptional<z.ZodString>;
    checks: z.ZodOptional<z.ZodNullable<z.ZodEnum<{
        failing: "failing";
        passing: "passing";
        pending: "pending";
    }>>>;
    label: z.ZodOptional<z.ZodObject<{
        name: z.ZodString;
        color: z.ZodOptional<z.ZodString>;
    }, z.core.$strip>>;
    subject: z.ZodOptional<z.ZodString>;
    refNumber: z.ZodOptional<z.ZodNumber>;
    refTitle: z.ZodOptional<z.ZodString>;
    refIsPr: z.ZodOptional<z.ZodBoolean>;
}, z.core.$strip>;
export type GithubTimelineEvent = z.infer<typeof githubTimelineEventSchema>;
/**
 * `GET /api/v1/github/comments/:kind/:number` — the full thread. Degrades to
 * `{ available: false, reason }` like the list fetch, never an error.
 */
export declare const githubCommentsDataSchema: z.ZodObject<{
    available: z.ZodBoolean;
    reason: z.ZodOptional<z.ZodString>;
    comments: z.ZodArray<z.ZodObject<{
        id: z.ZodNumber;
        author: z.ZodString;
        avatarUrl: z.ZodOptional<z.ZodString>;
        createdAt: z.ZodString;
        body: z.ZodString;
        kind: z.ZodEnum<{
            comment: "comment";
            review: "review";
        }>;
        reviewState: z.ZodOptional<z.ZodEnum<{
            approved: "approved";
            changes_requested: "changes_requested";
            commented: "commented";
            dismissed: "dismissed";
        }>>;
        url: z.ZodString;
    }, z.core.$strip>>;
    truncated: z.ZodOptional<z.ZodBoolean>;
    events: z.ZodOptional<z.ZodArray<z.ZodObject<{
        id: z.ZodString;
        kind: z.ZodEnum<{
            assigned: "assigned";
            closed: "closed";
            committed: "committed";
            "cross-referenced": "cross-referenced";
            head_ref_force_pushed: "head_ref_force_pushed";
            labeled: "labeled";
            merged: "merged";
            renamed: "renamed";
            reopened: "reopened";
            unassigned: "unassigned";
            unlabeled: "unlabeled";
        }>;
        actor: z.ZodString;
        avatarUrl: z.ZodOptional<z.ZodString>;
        createdAt: z.ZodString;
        url: z.ZodOptional<z.ZodString>;
        sha: z.ZodOptional<z.ZodString>;
        message: z.ZodOptional<z.ZodString>;
        checks: z.ZodOptional<z.ZodNullable<z.ZodEnum<{
            failing: "failing";
            passing: "passing";
            pending: "pending";
        }>>>;
        label: z.ZodOptional<z.ZodObject<{
            name: z.ZodString;
            color: z.ZodOptional<z.ZodString>;
        }, z.core.$strip>>;
        subject: z.ZodOptional<z.ZodString>;
        refNumber: z.ZodOptional<z.ZodNumber>;
        refTitle: z.ZodOptional<z.ZodString>;
        refIsPr: z.ZodOptional<z.ZodBoolean>;
    }, z.core.$strip>>>;
}, z.core.$strip>;
export type GithubCommentsData = z.infer<typeof githubCommentsDataSchema>;
export declare const githubMergeMethodSchema: z.ZodEnum<{
    merge: "merge";
    rebase: "rebase";
    squash: "squash";
}>;
export type GithubMergeMethod = z.infer<typeof githubMergeMethodSchema>;
/** One check row of the merge panel. */
export declare const githubPrCheckSchema: z.ZodObject<{
    name: z.ZodString;
    state: z.ZodEnum<{
        failing: "failing";
        passing: "passing";
        pending: "pending";
        unknown: "unknown";
    }>;
    required: z.ZodNullable<z.ZodBoolean>;
    url: z.ZodOptional<z.ZodString>;
}, z.core.$strip>;
export type GithubPrCheck = z.infer<typeof githubPrCheckSchema>;
/** Everything the merge panel needs about one PR. */
export declare const githubPrMergeStateSchema: z.ZodObject<{
    number: z.ZodNumber;
    title: z.ZodString;
    url: z.ZodString;
    state: z.ZodEnum<{
        closed: "closed";
        merged: "merged";
        open: "open";
    }>;
    isDraft: z.ZodBoolean;
    headRef: z.ZodString;
    baseRef: z.ZodString;
    headSha: z.ZodString;
    mergeable: z.ZodEnum<{
        conflicting: "conflicting";
        mergeable: "mergeable";
        unknown: "unknown";
    }>;
    reviewDecision: z.ZodEnum<{
        approved: "approved";
        "changes-requested": "changes-requested";
        "review-required": "review-required";
        unknown: "unknown";
    }>;
    checks: z.ZodArray<z.ZodObject<{
        name: z.ZodString;
        state: z.ZodEnum<{
            failing: "failing";
            passing: "passing";
            pending: "pending";
            unknown: "unknown";
        }>;
        required: z.ZodNullable<z.ZodBoolean>;
        url: z.ZodOptional<z.ZodString>;
    }, z.core.$strip>>;
    methods: z.ZodArray<z.ZodEnum<{
        merge: "merge";
        rebase: "rebase";
        squash: "squash";
    }>>;
    defaultMethod: z.ZodNullable<z.ZodEnum<{
        merge: "merge";
        rebase: "rebase";
        squash: "squash";
    }>>;
    eligibility: z.ZodEnum<{
        blocked: "blocked";
        pending: "pending";
        ready: "ready";
        terminal: "terminal";
        unauthorized: "unauthorized";
        unknown: "unknown";
    }>;
    blockers: z.ZodArray<z.ZodObject<{
        code: z.ZodString;
        message: z.ZodString;
    }, z.core.$strip>>;
    canMerge: z.ZodBoolean;
    canOverride: z.ZodBoolean;
}, z.core.$strip>;
export type GithubPrMergeState = z.infer<typeof githubPrMergeStateSchema>;
/** `GET /api/v1/github/prs/:number/merge-state` — 200 either way; the reason is the degrade. */
export declare const githubPrMergeStateResponseSchema: z.ZodDiscriminatedUnion<[z.ZodObject<{
    available: z.ZodLiteral<true>;
    mergeState: z.ZodObject<{
        number: z.ZodNumber;
        title: z.ZodString;
        url: z.ZodString;
        state: z.ZodEnum<{
            closed: "closed";
            merged: "merged";
            open: "open";
        }>;
        isDraft: z.ZodBoolean;
        headRef: z.ZodString;
        baseRef: z.ZodString;
        headSha: z.ZodString;
        mergeable: z.ZodEnum<{
            conflicting: "conflicting";
            mergeable: "mergeable";
            unknown: "unknown";
        }>;
        reviewDecision: z.ZodEnum<{
            approved: "approved";
            "changes-requested": "changes-requested";
            "review-required": "review-required";
            unknown: "unknown";
        }>;
        checks: z.ZodArray<z.ZodObject<{
            name: z.ZodString;
            state: z.ZodEnum<{
                failing: "failing";
                passing: "passing";
                pending: "pending";
                unknown: "unknown";
            }>;
            required: z.ZodNullable<z.ZodBoolean>;
            url: z.ZodOptional<z.ZodString>;
        }, z.core.$strip>>;
        methods: z.ZodArray<z.ZodEnum<{
            merge: "merge";
            rebase: "rebase";
            squash: "squash";
        }>>;
        defaultMethod: z.ZodNullable<z.ZodEnum<{
            merge: "merge";
            rebase: "rebase";
            squash: "squash";
        }>>;
        eligibility: z.ZodEnum<{
            blocked: "blocked";
            pending: "pending";
            ready: "ready";
            terminal: "terminal";
            unauthorized: "unauthorized";
            unknown: "unknown";
        }>;
        blockers: z.ZodArray<z.ZodObject<{
            code: z.ZodString;
            message: z.ZodString;
        }, z.core.$strip>>;
        canMerge: z.ZodBoolean;
        canOverride: z.ZodBoolean;
    }, z.core.$strip>;
}, z.core.$strip>, z.ZodObject<{
    available: z.ZodLiteral<false>;
    reason: z.ZodString;
}, z.core.$strip>], "available">;
export type GithubPrMergeStateResponse = z.infer<typeof githubPrMergeStateResponseSchema>;
/**
 * `POST /api/v1/github/prs/:number/merge` — the 200 branch only. Every refusal (403/404/409/502)
 * is an `ApiError`, so `merged` is pinned to `true` here rather than a boolean to re-check.
 */
export declare const githubMergeResponseSchema: z.ZodObject<{
    merged: z.ZodLiteral<true>;
    number: z.ZodNumber;
    url: z.ZodString;
    method: z.ZodEnum<{
        merge: "merge";
        rebase: "rebase";
        squash: "squash";
    }>;
    mergeCommitSha: z.ZodOptional<z.ZodString>;
}, z.core.$strip>;
export type GithubMergeResponse = z.infer<typeof githubMergeResponseSchema>;
/** One changed file of a pull request's diff. */
export declare const githubPrChangeSchema: z.ZodObject<{
    path: z.ZodString;
    previousPath: z.ZodOptional<z.ZodString>;
    status: z.ZodEnum<{
        added: "added";
        changed: "changed";
        copied: "copied";
        modified: "modified";
        removed: "removed";
        renamed: "renamed";
    }>;
    additions: z.ZodNumber;
    deletions: z.ZodNumber;
    patch: z.ZodOptional<z.ZodString>;
    patchUnavailableReason: z.ZodOptional<z.ZodEnum<{
        binary: "binary";
        "not-provided": "not-provided";
        "too-large": "too-large";
    }>>;
    truncated: z.ZodOptional<z.ZodBoolean>;
}, z.core.$strip>;
export type GithubPrChange = z.infer<typeof githubPrChangeSchema>;
/** `GET /api/v1/github/prs/:number/changes` — bounded, read-only PR file changes. */
export declare const githubPrChangesDataSchema: z.ZodDiscriminatedUnion<[z.ZodObject<{
    available: z.ZodLiteral<true>;
    number: z.ZodNumber;
    headSha: z.ZodString;
    files: z.ZodArray<z.ZodObject<{
        path: z.ZodString;
        previousPath: z.ZodOptional<z.ZodString>;
        status: z.ZodEnum<{
            added: "added";
            changed: "changed";
            copied: "copied";
            modified: "modified";
            removed: "removed";
            renamed: "renamed";
        }>;
        additions: z.ZodNumber;
        deletions: z.ZodNumber;
        patch: z.ZodOptional<z.ZodString>;
        patchUnavailableReason: z.ZodOptional<z.ZodEnum<{
            binary: "binary";
            "not-provided": "not-provided";
            "too-large": "too-large";
        }>>;
        truncated: z.ZodOptional<z.ZodBoolean>;
    }, z.core.$strip>>;
    additions: z.ZodNumber;
    deletions: z.ZodNumber;
    truncated: z.ZodBoolean;
    reason: z.ZodOptional<z.ZodString>;
}, z.core.$strip>, z.ZodObject<{
    available: z.ZodLiteral<false>;
    reason: z.ZodString;
}, z.core.$strip>], "available">;
export type GithubPrChangesData = z.infer<typeof githubPrChangesDataSchema>;
