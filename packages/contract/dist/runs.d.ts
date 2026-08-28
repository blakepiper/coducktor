import { z } from 'zod';
/**
 * The RUNS family of `/api/v1` — a task's record, its lifecycle mutations, and the artifacts
 * (queued prompt stack, commits, git actions) that hang off one run.
 *
 * The record itself is persisted by `src/runs/store.ts`, so these schemas describe a shape that
 * already has a zod definition server-side; they are the WIRE half of it, and the parity guard in
 * `src/server/contract-parity.runs.test.ts` is what keeps the two from drifting.
 *
 * Two things about the mutation responses are deliberate and were measured, not assumed:
 *
 *  - every "did it work" flag is a `z.literal(true)`, not a boolean. Each of those routes answers
 *    409 (or 404) on refusal, so `false` is not a value the 200 branch can carry — the
 *    hand-written DTO's `boolean` invited a re-check the server never needs. `cancelled` is the
 *    one real boolean: `POST /runs/:id/cancel` answers 200 either way.
 *  - `POST /runs/:id/messages` answers a three-way UNION, not one object with three optional
 *    keys. The client narrows on which key is present, and the DTO's flattened shape allowed
 *    `{}` — a payload the route cannot produce.
 */
export declare const runStatusSchema: z.ZodEnum<{
    cancelled: "cancelled";
    done: "done";
    failed: "failed";
    queued: "queued";
    review: "review";
    running: "running";
    waiting: "waiting";
}>;
export type RunStatus = z.infer<typeof runStatusSchema>;
/**
 * Sub-state of `running` (spec 2026-07-18-subagent-monitoring-status, #490): the agent ended its
 * turn still working on its own downstream work (a sub-agent, a monitored command) and said so
 * with the `CEZ:MONITORING` marker — a non-attention state, not "needs you".
 */
export declare const runActivitySchema: z.ZodEnum<{
    monitoring: "monitoring";
}>;
export type RunActivity = z.infer<typeof runActivitySchema>;
/** A queued auto-routed run has no provider that may start new work yet. */
export declare const providerQuotaBlockedReasonSchema: z.ZodObject<{
    type: z.ZodLiteral<"provider_quota">;
    providers: z.ZodArray<z.ZodEnum<{
        claude: "claude";
        codex: "codex";
    }>>;
    retryAt: z.ZodOptional<z.ZodString>;
}, z.core.$strip>;
export type ProviderQuotaBlockedReason = z.infer<typeof providerQuotaBlockedReasonSchema>;
export declare const stepStatusSchema: z.ZodEnum<{
    cancelled: "cancelled";
    done: "done";
    failed: "failed";
    pending: "pending";
    review: "review";
    running: "running";
    skipped: "skipped";
    waiting: "waiting";
}>;
export type StepStatus = z.infer<typeof stepStatusSchema>;
/** One step of a run's chain. */
export declare const stepStateSchema: z.ZodObject<{
    id: z.ZodString;
    name: z.ZodString;
    kind: z.ZodEnum<{
        agent: "agent";
        check: "check";
    }>;
    status: z.ZodEnum<{
        cancelled: "cancelled";
        done: "done";
        failed: "failed";
        pending: "pending";
        review: "review";
        running: "running";
        skipped: "skipped";
        waiting: "waiting";
    }>;
    iterations: z.ZodNumber;
    tokensUsed: z.ZodNumber;
    inputTokens: z.ZodOptional<z.ZodNumber>;
    outputTokens: z.ZodOptional<z.ZodNumber>;
    usageInvocationsStarted: z.ZodOptional<z.ZodNumber>;
    usageInvocationsObserved: z.ZodOptional<z.ZodNumber>;
    usageTurnsStarted: z.ZodOptional<z.ZodNumber>;
    usageTurnsRecorded: z.ZodOptional<z.ZodNumber>;
    usageInvocationEpoch: z.ZodOptional<z.ZodNumber>;
    startedAt: z.ZodOptional<z.ZodString>;
    finishedAt: z.ZodOptional<z.ZodString>;
    error: z.ZodOptional<z.ZodString>;
    sessionId: z.ZodOptional<z.ZodString>;
    backend: z.ZodOptional<z.ZodEnum<{
        claude: "claude";
        codex: "codex";
        opencode: "opencode";
        pi: "pi";
    }>>;
    requestedRunner: z.ZodOptional<z.ZodUnion<readonly [z.ZodEnum<{
        claude: "claude";
        codex: "codex";
        opencode: "opencode";
        pi: "pi";
    }>, z.ZodLiteral<"auto">]>>;
    profileId: z.ZodOptional<z.ZodString>;
    costUsd: z.ZodOptional<z.ZodNumber>;
}, z.core.$strip>;
export type StepState = z.infer<typeof stepStateSchema>;
/** Aggregate diff numbers of a run's worktree vs its base (#389). */
export declare const diffStatSchema: z.ZodObject<{
    adds: z.ZodNumber;
    dels: z.ZodNumber;
    files: z.ZodNumber;
    repointed: z.ZodOptional<z.ZodBoolean>;
}, z.core.$strip>;
export type DiffStat = z.infer<typeof diffStatSchema>;
/** One prompt message stacked onto a run while it waits for a free agent slot (#472). */
export declare const queuedMessageSchema: z.ZodObject<{
    id: z.ZodString;
    text: z.ZodString;
    images: z.ZodOptional<z.ZodArray<z.ZodString>>;
    createdAt: z.ZodString;
}, z.core.$strip>;
export type QueuedMessage = z.infer<typeof queuedMessageSchema>;
/** One aggregated sample of a run's live process tree (`src/core/process-usage.ts`). */
export declare const processUsageSchema: z.ZodObject<{
    cpuPct: z.ZodNumber;
    rssBytes: z.ZodNumber;
    procCount: z.ZodNumber;
}, z.core.$strip>;
export type ProcessUsage = z.infer<typeof processUsageSchema>;
/**
 * The stored run record, as `runs.json` holds it (`src/runs/store.ts`).
 *
 * `archived` is required although the store schema defaults it: a default fills on PARSE, so the
 * key is always present in what the server hands out. Everything else optional here is optional
 * there — these are additive fields, and an absent one means "this run predates it".
 */
export declare const runRecordSchema: z.ZodObject<{
    id: z.ZodString;
    title: z.ZodString;
    titleSummary: z.ZodOptional<z.ZodString>;
    diffStat: z.ZodOptional<z.ZodObject<{
        adds: z.ZodNumber;
        dels: z.ZodNumber;
        files: z.ZodNumber;
        repointed: z.ZodOptional<z.ZodBoolean>;
    }, z.core.$strip>>;
    workflow: z.ZodString;
    task: z.ZodString;
    queuedMessages: z.ZodOptional<z.ZodArray<z.ZodObject<{
        id: z.ZodString;
        text: z.ZodString;
        images: z.ZodOptional<z.ZodArray<z.ZodString>>;
        createdAt: z.ZodString;
    }, z.core.$strip>>>;
    taskImages: z.ZodOptional<z.ZodArray<z.ZodString>>;
    model: z.ZodOptional<z.ZodString>;
    modelIdentity: z.ZodOptional<z.ZodString>;
    runner: z.ZodOptional<z.ZodEnum<{
        claude: "claude";
        codex: "codex";
        opencode: "opencode";
        pi: "pi";
    }>>;
    requestedRunner: z.ZodOptional<z.ZodUnion<readonly [z.ZodEnum<{
        claude: "claude";
        codex: "codex";
        opencode: "opencode";
        pi: "pi";
    }>, z.ZodLiteral<"auto">]>>;
    agentProfile: z.ZodOptional<z.ZodString>;
    systemPrompt: z.ZodOptional<z.ZodString>;
    generateFollowups: z.ZodOptional<z.ZodBoolean>;
    autonomous: z.ZodOptional<z.ZodBoolean>;
    automation: z.ZodOptional<z.ZodObject<{
        automationId: z.ZodString;
        automationRevision: z.ZodNumber;
        receiptId: z.ZodString;
        event: z.ZodString;
        githubUrl: z.ZodString;
    }, z.core.$strip>>;
    status: z.ZodEnum<{
        cancelled: "cancelled";
        done: "done";
        failed: "failed";
        queued: "queued";
        review: "review";
        running: "running";
        waiting: "waiting";
    }>;
    activity: z.ZodOptional<z.ZodEnum<{
        monitoring: "monitoring";
    }>>;
    monitoringWakeAt: z.ZodOptional<z.ZodString>;
    monitoringWakeCapReached: z.ZodOptional<z.ZodBoolean>;
    autoResumeAt: z.ZodOptional<z.ZodString>;
    autoResumeAttempts: z.ZodOptional<z.ZodNumber>;
    blockedReason: z.ZodOptional<z.ZodObject<{
        type: z.ZodLiteral<"provider_quota">;
        providers: z.ZodArray<z.ZodEnum<{
            claude: "claude";
            codex: "codex";
        }>>;
        retryAt: z.ZodOptional<z.ZodString>;
    }, z.core.$strip>>;
    createdAt: z.ZodString;
    startedAt: z.ZodOptional<z.ZodString>;
    finishedAt: z.ZodOptional<z.ZodString>;
    tokensUsed: z.ZodNumber;
    inputTokens: z.ZodOptional<z.ZodNumber>;
    outputTokens: z.ZodOptional<z.ZodNumber>;
    costUsd: z.ZodOptional<z.ZodNumber>;
    pullRequestUrl: z.ZodOptional<z.ZodString>;
    referencedPullRequestUrl: z.ZodOptional<z.ZodString>;
    prNumber: z.ZodOptional<z.ZodNumber>;
    issueNumber: z.ZodOptional<z.ZodNumber>;
    referencedIssueNumberSeeded: z.ZodOptional<z.ZodBoolean>;
    titleOrigin: z.ZodOptional<z.ZodEnum<{
        auto: "auto";
        marker: "marker";
        user: "user";
    }>>;
    markerRefs: z.ZodOptional<z.ZodObject<{
        pr: z.ZodOptional<z.ZodNumber>;
        issue: z.ZodOptional<z.ZodNumber>;
    }, z.core.$strip>>;
    referencedPrCandidates: z.ZodOptional<z.ZodArray<z.ZodString>>;
    referencedIssueUrl: z.ZodOptional<z.ZodString>;
    referencedIssueCandidates: z.ZodOptional<z.ZodArray<z.ZodString>>;
    worktree: z.ZodOptional<z.ZodLiteral<false>>;
    worktreePath: z.ZodOptional<z.ZodString>;
    branch: z.ZodOptional<z.ZodString>;
    baseBranch: z.ZodOptional<z.ZodString>;
    worktreeReclaimedAt: z.ZodOptional<z.ZodString>;
    groupId: z.ZodOptional<z.ZodString>;
    variant: z.ZodOptional<z.ZodString>;
    peakRssBytes: z.ZodOptional<z.ZodNumber>;
    peakProcCount: z.ZodOptional<z.ZodNumber>;
    archived: z.ZodBoolean;
    archivedAt: z.ZodOptional<z.ZodString>;
    seenAt: z.ZodOptional<z.ZodString>;
    currentStepId: z.ZodOptional<z.ZodString>;
    error: z.ZodOptional<z.ZodString>;
    steps: z.ZodArray<z.ZodObject<{
        id: z.ZodString;
        name: z.ZodString;
        kind: z.ZodEnum<{
            agent: "agent";
            check: "check";
        }>;
        status: z.ZodEnum<{
            cancelled: "cancelled";
            done: "done";
            failed: "failed";
            pending: "pending";
            review: "review";
            running: "running";
            skipped: "skipped";
            waiting: "waiting";
        }>;
        iterations: z.ZodNumber;
        tokensUsed: z.ZodNumber;
        inputTokens: z.ZodOptional<z.ZodNumber>;
        outputTokens: z.ZodOptional<z.ZodNumber>;
        usageInvocationsStarted: z.ZodOptional<z.ZodNumber>;
        usageInvocationsObserved: z.ZodOptional<z.ZodNumber>;
        usageTurnsStarted: z.ZodOptional<z.ZodNumber>;
        usageTurnsRecorded: z.ZodOptional<z.ZodNumber>;
        usageInvocationEpoch: z.ZodOptional<z.ZodNumber>;
        startedAt: z.ZodOptional<z.ZodString>;
        finishedAt: z.ZodOptional<z.ZodString>;
        error: z.ZodOptional<z.ZodString>;
        sessionId: z.ZodOptional<z.ZodString>;
        backend: z.ZodOptional<z.ZodEnum<{
            claude: "claude";
            codex: "codex";
            opencode: "opencode";
            pi: "pi";
        }>>;
        requestedRunner: z.ZodOptional<z.ZodUnion<readonly [z.ZodEnum<{
            claude: "claude";
            codex: "codex";
            opencode: "opencode";
            pi: "pi";
        }>, z.ZodLiteral<"auto">]>>;
        profileId: z.ZodOptional<z.ZodString>;
        costUsd: z.ZodOptional<z.ZodNumber>;
    }, z.core.$strip>>;
    workflowDef: z.ZodOptional<z.ZodObject<{
        name: z.ZodString;
        description: z.ZodOptional<z.ZodString>;
        steps: z.ZodArray<z.ZodObject<{
            id: z.ZodString;
            name: z.ZodOptional<z.ZodString>;
            prompt: z.ZodOptional<z.ZodString>;
            skill: z.ZodOptional<z.ZodString>;
            model: z.ZodOptional<z.ZodString>;
            runner: z.ZodOptional<z.ZodUnion<readonly [z.ZodEnum<{
                claude: "claude";
                codex: "codex";
                opencode: "opencode";
                pi: "pi";
            }>, z.ZodLiteral<"auto">]>>;
            allowedTools: z.ZodOptional<z.ZodArray<z.ZodString>>;
            bashAllowlist: z.ZodOptional<z.ZodArray<z.ZodString>>;
            command: z.ZodOptional<z.ZodString>;
            onFail: z.ZodOptional<z.ZodObject<{
                retry: z.ZodString;
                max: z.ZodDefault<z.ZodNumber>;
            }, z.core.$strip>>;
        }, z.core.$strip>>;
        source: z.ZodEnum<{
            "built-in": "built-in";
            file: "file";
        }>;
        path: z.ZodOptional<z.ZodString>;
    }, z.core.$strip>>;
}, z.core.$strip>;
export type RunRecord = z.infer<typeof runRecordSchema>;
/**
 * What `GET /runs` and `GET /runs/:id` answer: the stored record plus the live `usage` sample the
 * server attaches on the way out (`withUsage`). Absent for finished runs and wherever `ps` yields
 * nothing — never persisted, and never attached by the mutation routes.
 */
export declare const apiRunSchema: z.ZodObject<{
    id: z.ZodString;
    title: z.ZodString;
    titleSummary: z.ZodOptional<z.ZodString>;
    diffStat: z.ZodOptional<z.ZodObject<{
        adds: z.ZodNumber;
        dels: z.ZodNumber;
        files: z.ZodNumber;
        repointed: z.ZodOptional<z.ZodBoolean>;
    }, z.core.$strip>>;
    workflow: z.ZodString;
    task: z.ZodString;
    queuedMessages: z.ZodOptional<z.ZodArray<z.ZodObject<{
        id: z.ZodString;
        text: z.ZodString;
        images: z.ZodOptional<z.ZodArray<z.ZodString>>;
        createdAt: z.ZodString;
    }, z.core.$strip>>>;
    taskImages: z.ZodOptional<z.ZodArray<z.ZodString>>;
    model: z.ZodOptional<z.ZodString>;
    modelIdentity: z.ZodOptional<z.ZodString>;
    runner: z.ZodOptional<z.ZodEnum<{
        claude: "claude";
        codex: "codex";
        opencode: "opencode";
        pi: "pi";
    }>>;
    requestedRunner: z.ZodOptional<z.ZodUnion<readonly [z.ZodEnum<{
        claude: "claude";
        codex: "codex";
        opencode: "opencode";
        pi: "pi";
    }>, z.ZodLiteral<"auto">]>>;
    agentProfile: z.ZodOptional<z.ZodString>;
    systemPrompt: z.ZodOptional<z.ZodString>;
    generateFollowups: z.ZodOptional<z.ZodBoolean>;
    autonomous: z.ZodOptional<z.ZodBoolean>;
    automation: z.ZodOptional<z.ZodObject<{
        automationId: z.ZodString;
        automationRevision: z.ZodNumber;
        receiptId: z.ZodString;
        event: z.ZodString;
        githubUrl: z.ZodString;
    }, z.core.$strip>>;
    status: z.ZodEnum<{
        cancelled: "cancelled";
        done: "done";
        failed: "failed";
        queued: "queued";
        review: "review";
        running: "running";
        waiting: "waiting";
    }>;
    activity: z.ZodOptional<z.ZodEnum<{
        monitoring: "monitoring";
    }>>;
    monitoringWakeAt: z.ZodOptional<z.ZodString>;
    monitoringWakeCapReached: z.ZodOptional<z.ZodBoolean>;
    autoResumeAt: z.ZodOptional<z.ZodString>;
    autoResumeAttempts: z.ZodOptional<z.ZodNumber>;
    blockedReason: z.ZodOptional<z.ZodObject<{
        type: z.ZodLiteral<"provider_quota">;
        providers: z.ZodArray<z.ZodEnum<{
            claude: "claude";
            codex: "codex";
        }>>;
        retryAt: z.ZodOptional<z.ZodString>;
    }, z.core.$strip>>;
    createdAt: z.ZodString;
    startedAt: z.ZodOptional<z.ZodString>;
    finishedAt: z.ZodOptional<z.ZodString>;
    tokensUsed: z.ZodNumber;
    inputTokens: z.ZodOptional<z.ZodNumber>;
    outputTokens: z.ZodOptional<z.ZodNumber>;
    costUsd: z.ZodOptional<z.ZodNumber>;
    pullRequestUrl: z.ZodOptional<z.ZodString>;
    referencedPullRequestUrl: z.ZodOptional<z.ZodString>;
    prNumber: z.ZodOptional<z.ZodNumber>;
    issueNumber: z.ZodOptional<z.ZodNumber>;
    referencedIssueNumberSeeded: z.ZodOptional<z.ZodBoolean>;
    titleOrigin: z.ZodOptional<z.ZodEnum<{
        auto: "auto";
        marker: "marker";
        user: "user";
    }>>;
    markerRefs: z.ZodOptional<z.ZodObject<{
        pr: z.ZodOptional<z.ZodNumber>;
        issue: z.ZodOptional<z.ZodNumber>;
    }, z.core.$strip>>;
    referencedPrCandidates: z.ZodOptional<z.ZodArray<z.ZodString>>;
    referencedIssueUrl: z.ZodOptional<z.ZodString>;
    referencedIssueCandidates: z.ZodOptional<z.ZodArray<z.ZodString>>;
    worktree: z.ZodOptional<z.ZodLiteral<false>>;
    worktreePath: z.ZodOptional<z.ZodString>;
    branch: z.ZodOptional<z.ZodString>;
    baseBranch: z.ZodOptional<z.ZodString>;
    worktreeReclaimedAt: z.ZodOptional<z.ZodString>;
    groupId: z.ZodOptional<z.ZodString>;
    variant: z.ZodOptional<z.ZodString>;
    peakRssBytes: z.ZodOptional<z.ZodNumber>;
    peakProcCount: z.ZodOptional<z.ZodNumber>;
    archived: z.ZodBoolean;
    archivedAt: z.ZodOptional<z.ZodString>;
    seenAt: z.ZodOptional<z.ZodString>;
    currentStepId: z.ZodOptional<z.ZodString>;
    error: z.ZodOptional<z.ZodString>;
    steps: z.ZodArray<z.ZodObject<{
        id: z.ZodString;
        name: z.ZodString;
        kind: z.ZodEnum<{
            agent: "agent";
            check: "check";
        }>;
        status: z.ZodEnum<{
            cancelled: "cancelled";
            done: "done";
            failed: "failed";
            pending: "pending";
            review: "review";
            running: "running";
            skipped: "skipped";
            waiting: "waiting";
        }>;
        iterations: z.ZodNumber;
        tokensUsed: z.ZodNumber;
        inputTokens: z.ZodOptional<z.ZodNumber>;
        outputTokens: z.ZodOptional<z.ZodNumber>;
        usageInvocationsStarted: z.ZodOptional<z.ZodNumber>;
        usageInvocationsObserved: z.ZodOptional<z.ZodNumber>;
        usageTurnsStarted: z.ZodOptional<z.ZodNumber>;
        usageTurnsRecorded: z.ZodOptional<z.ZodNumber>;
        usageInvocationEpoch: z.ZodOptional<z.ZodNumber>;
        startedAt: z.ZodOptional<z.ZodString>;
        finishedAt: z.ZodOptional<z.ZodString>;
        error: z.ZodOptional<z.ZodString>;
        sessionId: z.ZodOptional<z.ZodString>;
        backend: z.ZodOptional<z.ZodEnum<{
            claude: "claude";
            codex: "codex";
            opencode: "opencode";
            pi: "pi";
        }>>;
        requestedRunner: z.ZodOptional<z.ZodUnion<readonly [z.ZodEnum<{
            claude: "claude";
            codex: "codex";
            opencode: "opencode";
            pi: "pi";
        }>, z.ZodLiteral<"auto">]>>;
        profileId: z.ZodOptional<z.ZodString>;
        costUsd: z.ZodOptional<z.ZodNumber>;
    }, z.core.$strip>>;
    workflowDef: z.ZodOptional<z.ZodObject<{
        name: z.ZodString;
        description: z.ZodOptional<z.ZodString>;
        steps: z.ZodArray<z.ZodObject<{
            id: z.ZodString;
            name: z.ZodOptional<z.ZodString>;
            prompt: z.ZodOptional<z.ZodString>;
            skill: z.ZodOptional<z.ZodString>;
            model: z.ZodOptional<z.ZodString>;
            runner: z.ZodOptional<z.ZodUnion<readonly [z.ZodEnum<{
                claude: "claude";
                codex: "codex";
                opencode: "opencode";
                pi: "pi";
            }>, z.ZodLiteral<"auto">]>>;
            allowedTools: z.ZodOptional<z.ZodArray<z.ZodString>>;
            bashAllowlist: z.ZodOptional<z.ZodArray<z.ZodString>>;
            command: z.ZodOptional<z.ZodString>;
            onFail: z.ZodOptional<z.ZodObject<{
                retry: z.ZodString;
                max: z.ZodDefault<z.ZodNumber>;
            }, z.core.$strip>>;
        }, z.core.$strip>>;
        source: z.ZodEnum<{
            "built-in": "built-in";
            file: "file";
        }>;
        path: z.ZodOptional<z.ZodString>;
    }, z.core.$strip>>;
    usage: z.ZodOptional<z.ZodObject<{
        cpuPct: z.ZodNumber;
        rssBytes: z.ZodNumber;
        procCount: z.ZodNumber;
    }, z.core.$strip>>;
}, z.core.$strip>;
export type ApiRun = z.infer<typeof apiRunSchema>;
/**
 * One run in the WORKSPACE-level index (`GET /api/v1/workspace/runs-index`) — the ⌘K palette's
 * "find a task in any project" list, and the global Tasks page's rows.
 *
 * Deliberately a separate, slim shape rather than `ApiRun`. The index answers for every
 * registered project at once, and `runRecordSchema` carries `steps[]` and `workflowDef` — a fat
 * record whose cost is fine per project and absurd multiplied by the registry. These are exactly
 * the fields a palette row renders: `runTitle`'s three (`title`, `titleSummary`, `titleOrigin`),
 * `deriveAttention`'s `AttentionInput`, `isUnread`'s `ReadStateInput`, and the timestamps
 * `shortAge` reads. Adding a field here is cheap; adding the whole record is what this exists to
 * avoid — but note that widening either of those two `Pick`s means widening this too, or the
 * palette's cross-project rows silently answer differently from every other surface.
 *
 * `projectId` is the join key, NOT the project name: the registry is already on the client and is
 * authoritative for display names, and duplicating one here would let a renamed project show two
 * different labels in one palette.
 */
export declare const runIndexEntrySchema: z.ZodObject<{
    projectId: z.ZodString;
    id: z.ZodString;
    title: z.ZodString;
    titleSummary: z.ZodOptional<z.ZodString>;
    titleOrigin: z.ZodOptional<z.ZodEnum<{
        auto: "auto";
        marker: "marker";
        user: "user";
    }>>;
    status: z.ZodEnum<{
        cancelled: "cancelled";
        done: "done";
        failed: "failed";
        queued: "queued";
        review: "review";
        running: "running";
        waiting: "waiting";
    }>;
    activity: z.ZodOptional<z.ZodEnum<{
        monitoring: "monitoring";
    }>>;
    createdAt: z.ZodString;
    finishedAt: z.ZodOptional<z.ZodString>;
    seenAt: z.ZodOptional<z.ZodString>;
    archived: z.ZodBoolean;
    autoResumeAt: z.ZodOptional<z.ZodString>;
    workflow: z.ZodString;
    branch: z.ZodOptional<z.ZodString>;
    startedAt: z.ZodOptional<z.ZodString>;
    pullRequestUrl: z.ZodOptional<z.ZodString>;
    referencedPullRequestUrl: z.ZodOptional<z.ZodString>;
    prNumber: z.ZodOptional<z.ZodNumber>;
    issueNumber: z.ZodOptional<z.ZodNumber>;
    referencedIssueUrl: z.ZodOptional<z.ZodString>;
    markerRefs: z.ZodOptional<z.ZodObject<{
        pr: z.ZodOptional<z.ZodNumber>;
        issue: z.ZodOptional<z.ZodNumber>;
    }, z.core.$strip>>;
    costUsd: z.ZodOptional<z.ZodNumber>;
    peakRssBytes: z.ZodOptional<z.ZodNumber>;
    peakProcCount: z.ZodOptional<z.ZodNumber>;
    usage: z.ZodOptional<z.ZodObject<{
        cpuPct: z.ZodNumber;
        rssBytes: z.ZodNumber;
        procCount: z.ZodNumber;
    }, z.core.$strip>>;
}, z.core.$strip>;
export type RunIndexEntry = z.infer<typeof runIndexEntrySchema>;
/**
 * `GET /workspace/runs-index`.
 *
 * `truncated` is not decoration: the index caps each project's contribution, and a capped list
 * that says nothing reads as "your task is not here" when the honest answer is "not in the
 * newest N". Naming the projects that hit the cap is what lets a consumer say so.
 */
/**
 * Everything the SERVER already knew about the references its rows carry, per project — the
 * statuses that would otherwise cost a second round trip a beat after the table paints.
 *
 * Read from cache only: this never asks the forge, so a cold entry is simply absent and
 * `GET /github/ref-status` stays the route that actually goes and looks. That makes it free, and
 * being free is what lets it be a superset — the server looks up every number a run mentions
 * rather than re-deriving which one the cockpit will display (#407, #526 live client-side, and
 * duplicating that rule is how the two would drift).
 */
export declare const referenceStatusesByProjectSchema: z.ZodRecord<z.ZodString, z.ZodObject<{
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
}, z.core.$strip>>;
export declare const runsIndexResponseSchema: z.ZodObject<{
    runs: z.ZodArray<z.ZodObject<{
        projectId: z.ZodString;
        id: z.ZodString;
        title: z.ZodString;
        titleSummary: z.ZodOptional<z.ZodString>;
        titleOrigin: z.ZodOptional<z.ZodEnum<{
            auto: "auto";
            marker: "marker";
            user: "user";
        }>>;
        status: z.ZodEnum<{
            cancelled: "cancelled";
            done: "done";
            failed: "failed";
            queued: "queued";
            review: "review";
            running: "running";
            waiting: "waiting";
        }>;
        activity: z.ZodOptional<z.ZodEnum<{
            monitoring: "monitoring";
        }>>;
        createdAt: z.ZodString;
        finishedAt: z.ZodOptional<z.ZodString>;
        seenAt: z.ZodOptional<z.ZodString>;
        archived: z.ZodBoolean;
        autoResumeAt: z.ZodOptional<z.ZodString>;
        workflow: z.ZodString;
        branch: z.ZodOptional<z.ZodString>;
        startedAt: z.ZodOptional<z.ZodString>;
        pullRequestUrl: z.ZodOptional<z.ZodString>;
        referencedPullRequestUrl: z.ZodOptional<z.ZodString>;
        prNumber: z.ZodOptional<z.ZodNumber>;
        issueNumber: z.ZodOptional<z.ZodNumber>;
        referencedIssueUrl: z.ZodOptional<z.ZodString>;
        markerRefs: z.ZodOptional<z.ZodObject<{
            pr: z.ZodOptional<z.ZodNumber>;
            issue: z.ZodOptional<z.ZodNumber>;
        }, z.core.$strip>>;
        costUsd: z.ZodOptional<z.ZodNumber>;
        peakRssBytes: z.ZodOptional<z.ZodNumber>;
        peakProcCount: z.ZodOptional<z.ZodNumber>;
        usage: z.ZodOptional<z.ZodObject<{
            cpuPct: z.ZodNumber;
            rssBytes: z.ZodNumber;
            procCount: z.ZodNumber;
        }, z.core.$strip>>;
    }, z.core.$strip>>;
    referenceStatuses: z.ZodRecord<z.ZodString, z.ZodObject<{
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
    }, z.core.$strip>>;
    perProjectLimit: z.ZodNumber;
    truncated: z.ZodArray<z.ZodString>;
}, z.core.$strip>;
export type RunsIndexResponse = z.infer<typeof runsIndexResponseSchema>;
/**
 * `POST /runs` (201) — one record for ×1, a group for ×2/×3.
 *
 * The ×1 branch is the STORED record, not `ApiRun`: `startRun` answers before any `ps` sample
 * exists, so the create route never runs a record through `withUsage`.
 */
export declare const createRunResponseSchema: z.ZodUnion<readonly [z.ZodObject<{
    id: z.ZodString;
    title: z.ZodString;
    titleSummary: z.ZodOptional<z.ZodString>;
    diffStat: z.ZodOptional<z.ZodObject<{
        adds: z.ZodNumber;
        dels: z.ZodNumber;
        files: z.ZodNumber;
        repointed: z.ZodOptional<z.ZodBoolean>;
    }, z.core.$strip>>;
    workflow: z.ZodString;
    task: z.ZodString;
    queuedMessages: z.ZodOptional<z.ZodArray<z.ZodObject<{
        id: z.ZodString;
        text: z.ZodString;
        images: z.ZodOptional<z.ZodArray<z.ZodString>>;
        createdAt: z.ZodString;
    }, z.core.$strip>>>;
    taskImages: z.ZodOptional<z.ZodArray<z.ZodString>>;
    model: z.ZodOptional<z.ZodString>;
    modelIdentity: z.ZodOptional<z.ZodString>;
    runner: z.ZodOptional<z.ZodEnum<{
        claude: "claude";
        codex: "codex";
        opencode: "opencode";
        pi: "pi";
    }>>;
    requestedRunner: z.ZodOptional<z.ZodUnion<readonly [z.ZodEnum<{
        claude: "claude";
        codex: "codex";
        opencode: "opencode";
        pi: "pi";
    }>, z.ZodLiteral<"auto">]>>;
    agentProfile: z.ZodOptional<z.ZodString>;
    systemPrompt: z.ZodOptional<z.ZodString>;
    generateFollowups: z.ZodOptional<z.ZodBoolean>;
    autonomous: z.ZodOptional<z.ZodBoolean>;
    automation: z.ZodOptional<z.ZodObject<{
        automationId: z.ZodString;
        automationRevision: z.ZodNumber;
        receiptId: z.ZodString;
        event: z.ZodString;
        githubUrl: z.ZodString;
    }, z.core.$strip>>;
    status: z.ZodEnum<{
        cancelled: "cancelled";
        done: "done";
        failed: "failed";
        queued: "queued";
        review: "review";
        running: "running";
        waiting: "waiting";
    }>;
    activity: z.ZodOptional<z.ZodEnum<{
        monitoring: "monitoring";
    }>>;
    monitoringWakeAt: z.ZodOptional<z.ZodString>;
    monitoringWakeCapReached: z.ZodOptional<z.ZodBoolean>;
    autoResumeAt: z.ZodOptional<z.ZodString>;
    autoResumeAttempts: z.ZodOptional<z.ZodNumber>;
    blockedReason: z.ZodOptional<z.ZodObject<{
        type: z.ZodLiteral<"provider_quota">;
        providers: z.ZodArray<z.ZodEnum<{
            claude: "claude";
            codex: "codex";
        }>>;
        retryAt: z.ZodOptional<z.ZodString>;
    }, z.core.$strip>>;
    createdAt: z.ZodString;
    startedAt: z.ZodOptional<z.ZodString>;
    finishedAt: z.ZodOptional<z.ZodString>;
    tokensUsed: z.ZodNumber;
    inputTokens: z.ZodOptional<z.ZodNumber>;
    outputTokens: z.ZodOptional<z.ZodNumber>;
    costUsd: z.ZodOptional<z.ZodNumber>;
    pullRequestUrl: z.ZodOptional<z.ZodString>;
    referencedPullRequestUrl: z.ZodOptional<z.ZodString>;
    prNumber: z.ZodOptional<z.ZodNumber>;
    issueNumber: z.ZodOptional<z.ZodNumber>;
    referencedIssueNumberSeeded: z.ZodOptional<z.ZodBoolean>;
    titleOrigin: z.ZodOptional<z.ZodEnum<{
        auto: "auto";
        marker: "marker";
        user: "user";
    }>>;
    markerRefs: z.ZodOptional<z.ZodObject<{
        pr: z.ZodOptional<z.ZodNumber>;
        issue: z.ZodOptional<z.ZodNumber>;
    }, z.core.$strip>>;
    referencedPrCandidates: z.ZodOptional<z.ZodArray<z.ZodString>>;
    referencedIssueUrl: z.ZodOptional<z.ZodString>;
    referencedIssueCandidates: z.ZodOptional<z.ZodArray<z.ZodString>>;
    worktree: z.ZodOptional<z.ZodLiteral<false>>;
    worktreePath: z.ZodOptional<z.ZodString>;
    branch: z.ZodOptional<z.ZodString>;
    baseBranch: z.ZodOptional<z.ZodString>;
    worktreeReclaimedAt: z.ZodOptional<z.ZodString>;
    groupId: z.ZodOptional<z.ZodString>;
    variant: z.ZodOptional<z.ZodString>;
    peakRssBytes: z.ZodOptional<z.ZodNumber>;
    peakProcCount: z.ZodOptional<z.ZodNumber>;
    archived: z.ZodBoolean;
    archivedAt: z.ZodOptional<z.ZodString>;
    seenAt: z.ZodOptional<z.ZodString>;
    currentStepId: z.ZodOptional<z.ZodString>;
    error: z.ZodOptional<z.ZodString>;
    steps: z.ZodArray<z.ZodObject<{
        id: z.ZodString;
        name: z.ZodString;
        kind: z.ZodEnum<{
            agent: "agent";
            check: "check";
        }>;
        status: z.ZodEnum<{
            cancelled: "cancelled";
            done: "done";
            failed: "failed";
            pending: "pending";
            review: "review";
            running: "running";
            skipped: "skipped";
            waiting: "waiting";
        }>;
        iterations: z.ZodNumber;
        tokensUsed: z.ZodNumber;
        inputTokens: z.ZodOptional<z.ZodNumber>;
        outputTokens: z.ZodOptional<z.ZodNumber>;
        usageInvocationsStarted: z.ZodOptional<z.ZodNumber>;
        usageInvocationsObserved: z.ZodOptional<z.ZodNumber>;
        usageTurnsStarted: z.ZodOptional<z.ZodNumber>;
        usageTurnsRecorded: z.ZodOptional<z.ZodNumber>;
        usageInvocationEpoch: z.ZodOptional<z.ZodNumber>;
        startedAt: z.ZodOptional<z.ZodString>;
        finishedAt: z.ZodOptional<z.ZodString>;
        error: z.ZodOptional<z.ZodString>;
        sessionId: z.ZodOptional<z.ZodString>;
        backend: z.ZodOptional<z.ZodEnum<{
            claude: "claude";
            codex: "codex";
            opencode: "opencode";
            pi: "pi";
        }>>;
        requestedRunner: z.ZodOptional<z.ZodUnion<readonly [z.ZodEnum<{
            claude: "claude";
            codex: "codex";
            opencode: "opencode";
            pi: "pi";
        }>, z.ZodLiteral<"auto">]>>;
        profileId: z.ZodOptional<z.ZodString>;
        costUsd: z.ZodOptional<z.ZodNumber>;
    }, z.core.$strip>>;
    workflowDef: z.ZodOptional<z.ZodObject<{
        name: z.ZodString;
        description: z.ZodOptional<z.ZodString>;
        steps: z.ZodArray<z.ZodObject<{
            id: z.ZodString;
            name: z.ZodOptional<z.ZodString>;
            prompt: z.ZodOptional<z.ZodString>;
            skill: z.ZodOptional<z.ZodString>;
            model: z.ZodOptional<z.ZodString>;
            runner: z.ZodOptional<z.ZodUnion<readonly [z.ZodEnum<{
                claude: "claude";
                codex: "codex";
                opencode: "opencode";
                pi: "pi";
            }>, z.ZodLiteral<"auto">]>>;
            allowedTools: z.ZodOptional<z.ZodArray<z.ZodString>>;
            bashAllowlist: z.ZodOptional<z.ZodArray<z.ZodString>>;
            command: z.ZodOptional<z.ZodString>;
            onFail: z.ZodOptional<z.ZodObject<{
                retry: z.ZodString;
                max: z.ZodDefault<z.ZodNumber>;
            }, z.core.$strip>>;
        }, z.core.$strip>>;
        source: z.ZodEnum<{
            "built-in": "built-in";
            file: "file";
        }>;
        path: z.ZodOptional<z.ZodString>;
    }, z.core.$strip>>;
}, z.core.$strip>, z.ZodObject<{
    runs: z.ZodArray<z.ZodObject<{
        id: z.ZodString;
        title: z.ZodString;
        titleSummary: z.ZodOptional<z.ZodString>;
        diffStat: z.ZodOptional<z.ZodObject<{
            adds: z.ZodNumber;
            dels: z.ZodNumber;
            files: z.ZodNumber;
            repointed: z.ZodOptional<z.ZodBoolean>;
        }, z.core.$strip>>;
        workflow: z.ZodString;
        task: z.ZodString;
        queuedMessages: z.ZodOptional<z.ZodArray<z.ZodObject<{
            id: z.ZodString;
            text: z.ZodString;
            images: z.ZodOptional<z.ZodArray<z.ZodString>>;
            createdAt: z.ZodString;
        }, z.core.$strip>>>;
        taskImages: z.ZodOptional<z.ZodArray<z.ZodString>>;
        model: z.ZodOptional<z.ZodString>;
        modelIdentity: z.ZodOptional<z.ZodString>;
        runner: z.ZodOptional<z.ZodEnum<{
            claude: "claude";
            codex: "codex";
            opencode: "opencode";
            pi: "pi";
        }>>;
        requestedRunner: z.ZodOptional<z.ZodUnion<readonly [z.ZodEnum<{
            claude: "claude";
            codex: "codex";
            opencode: "opencode";
            pi: "pi";
        }>, z.ZodLiteral<"auto">]>>;
        agentProfile: z.ZodOptional<z.ZodString>;
        systemPrompt: z.ZodOptional<z.ZodString>;
        generateFollowups: z.ZodOptional<z.ZodBoolean>;
        autonomous: z.ZodOptional<z.ZodBoolean>;
        automation: z.ZodOptional<z.ZodObject<{
            automationId: z.ZodString;
            automationRevision: z.ZodNumber;
            receiptId: z.ZodString;
            event: z.ZodString;
            githubUrl: z.ZodString;
        }, z.core.$strip>>;
        status: z.ZodEnum<{
            cancelled: "cancelled";
            done: "done";
            failed: "failed";
            queued: "queued";
            review: "review";
            running: "running";
            waiting: "waiting";
        }>;
        activity: z.ZodOptional<z.ZodEnum<{
            monitoring: "monitoring";
        }>>;
        monitoringWakeAt: z.ZodOptional<z.ZodString>;
        monitoringWakeCapReached: z.ZodOptional<z.ZodBoolean>;
        autoResumeAt: z.ZodOptional<z.ZodString>;
        autoResumeAttempts: z.ZodOptional<z.ZodNumber>;
        blockedReason: z.ZodOptional<z.ZodObject<{
            type: z.ZodLiteral<"provider_quota">;
            providers: z.ZodArray<z.ZodEnum<{
                claude: "claude";
                codex: "codex";
            }>>;
            retryAt: z.ZodOptional<z.ZodString>;
        }, z.core.$strip>>;
        createdAt: z.ZodString;
        startedAt: z.ZodOptional<z.ZodString>;
        finishedAt: z.ZodOptional<z.ZodString>;
        tokensUsed: z.ZodNumber;
        inputTokens: z.ZodOptional<z.ZodNumber>;
        outputTokens: z.ZodOptional<z.ZodNumber>;
        costUsd: z.ZodOptional<z.ZodNumber>;
        pullRequestUrl: z.ZodOptional<z.ZodString>;
        referencedPullRequestUrl: z.ZodOptional<z.ZodString>;
        prNumber: z.ZodOptional<z.ZodNumber>;
        issueNumber: z.ZodOptional<z.ZodNumber>;
        referencedIssueNumberSeeded: z.ZodOptional<z.ZodBoolean>;
        titleOrigin: z.ZodOptional<z.ZodEnum<{
            auto: "auto";
            marker: "marker";
            user: "user";
        }>>;
        markerRefs: z.ZodOptional<z.ZodObject<{
            pr: z.ZodOptional<z.ZodNumber>;
            issue: z.ZodOptional<z.ZodNumber>;
        }, z.core.$strip>>;
        referencedPrCandidates: z.ZodOptional<z.ZodArray<z.ZodString>>;
        referencedIssueUrl: z.ZodOptional<z.ZodString>;
        referencedIssueCandidates: z.ZodOptional<z.ZodArray<z.ZodString>>;
        worktree: z.ZodOptional<z.ZodLiteral<false>>;
        worktreePath: z.ZodOptional<z.ZodString>;
        branch: z.ZodOptional<z.ZodString>;
        baseBranch: z.ZodOptional<z.ZodString>;
        worktreeReclaimedAt: z.ZodOptional<z.ZodString>;
        groupId: z.ZodOptional<z.ZodString>;
        variant: z.ZodOptional<z.ZodString>;
        peakRssBytes: z.ZodOptional<z.ZodNumber>;
        peakProcCount: z.ZodOptional<z.ZodNumber>;
        archived: z.ZodBoolean;
        archivedAt: z.ZodOptional<z.ZodString>;
        seenAt: z.ZodOptional<z.ZodString>;
        currentStepId: z.ZodOptional<z.ZodString>;
        error: z.ZodOptional<z.ZodString>;
        steps: z.ZodArray<z.ZodObject<{
            id: z.ZodString;
            name: z.ZodString;
            kind: z.ZodEnum<{
                agent: "agent";
                check: "check";
            }>;
            status: z.ZodEnum<{
                cancelled: "cancelled";
                done: "done";
                failed: "failed";
                pending: "pending";
                review: "review";
                running: "running";
                skipped: "skipped";
                waiting: "waiting";
            }>;
            iterations: z.ZodNumber;
            tokensUsed: z.ZodNumber;
            inputTokens: z.ZodOptional<z.ZodNumber>;
            outputTokens: z.ZodOptional<z.ZodNumber>;
            usageInvocationsStarted: z.ZodOptional<z.ZodNumber>;
            usageInvocationsObserved: z.ZodOptional<z.ZodNumber>;
            usageTurnsStarted: z.ZodOptional<z.ZodNumber>;
            usageTurnsRecorded: z.ZodOptional<z.ZodNumber>;
            usageInvocationEpoch: z.ZodOptional<z.ZodNumber>;
            startedAt: z.ZodOptional<z.ZodString>;
            finishedAt: z.ZodOptional<z.ZodString>;
            error: z.ZodOptional<z.ZodString>;
            sessionId: z.ZodOptional<z.ZodString>;
            backend: z.ZodOptional<z.ZodEnum<{
                claude: "claude";
                codex: "codex";
                opencode: "opencode";
                pi: "pi";
            }>>;
            requestedRunner: z.ZodOptional<z.ZodUnion<readonly [z.ZodEnum<{
                claude: "claude";
                codex: "codex";
                opencode: "opencode";
                pi: "pi";
            }>, z.ZodLiteral<"auto">]>>;
            profileId: z.ZodOptional<z.ZodString>;
            costUsd: z.ZodOptional<z.ZodNumber>;
        }, z.core.$strip>>;
        workflowDef: z.ZodOptional<z.ZodObject<{
            name: z.ZodString;
            description: z.ZodOptional<z.ZodString>;
            steps: z.ZodArray<z.ZodObject<{
                id: z.ZodString;
                name: z.ZodOptional<z.ZodString>;
                prompt: z.ZodOptional<z.ZodString>;
                skill: z.ZodOptional<z.ZodString>;
                model: z.ZodOptional<z.ZodString>;
                runner: z.ZodOptional<z.ZodUnion<readonly [z.ZodEnum<{
                    claude: "claude";
                    codex: "codex";
                    opencode: "opencode";
                    pi: "pi";
                }>, z.ZodLiteral<"auto">]>>;
                allowedTools: z.ZodOptional<z.ZodArray<z.ZodString>>;
                bashAllowlist: z.ZodOptional<z.ZodArray<z.ZodString>>;
                command: z.ZodOptional<z.ZodString>;
                onFail: z.ZodOptional<z.ZodObject<{
                    retry: z.ZodString;
                    max: z.ZodDefault<z.ZodNumber>;
                }, z.core.$strip>>;
            }, z.core.$strip>>;
            source: z.ZodEnum<{
                "built-in": "built-in";
                file: "file";
            }>;
            path: z.ZodOptional<z.ZodString>;
        }, z.core.$strip>>;
    }, z.core.$strip>>;
}, z.core.$strip>]>;
export type CreateRunResponse = z.infer<typeof createRunResponseSchema>;
/** `POST /runs/:id/cancel` — genuinely a boolean: an already-settled run answers 200 + `false`. */
export declare const cancelResponseSchema: z.ZodObject<{
    cancelled: z.ZodBoolean;
}, z.core.$strip>;
export type CancelResponse = z.infer<typeof cancelResponseSchema>;
/**
 * `DELETE /runs/:id/auto-resume` (spec 2026-08-03-auto-resume-after-usage-limit) — the per-task
 * off switch for a pending usage-limit resume, next to the workspace-wide setting.
 *
 * `z.literal(true)`, not a boolean, and that IS the shape: the route is idempotent, so a run with
 * nothing pending answers 200 as well — "this task will not resume itself" is equally true either
 * way. Only an unknown run refuses, with 404.
 */
export declare const cancelAutoResumeResponseSchema: z.ZodObject<{
    cancelled: z.ZodLiteral<true>;
}, z.core.$strip>;
export type CancelAutoResumeResponse = z.infer<typeof cancelAutoResumeResponseSchema>;
/** `POST /runs/archive-finished` — how many runs the sweep archived. */
export declare const archiveFinishedResponseSchema: z.ZodObject<{
    archived: z.ZodNumber;
}, z.core.$strip>;
export type ArchiveFinishedResponse = z.infer<typeof archiveFinishedResponseSchema>;
/** `POST /runs/read-all` — how many unread finished runs the sweep marked read. */
export declare const markAllReadResponseSchema: z.ZodObject<{
    read: z.ZodNumber;
}, z.core.$strip>;
export type MarkAllReadResponse = z.infer<typeof markAllReadResponseSchema>;
/** `DELETE /runs/:id` — an active run is a 409 and an unknown one a 404, so this only ever
 *  reports success. */
export declare const deleteRunResponseSchema: z.ZodObject<{
    deleted: z.ZodLiteral<true>;
}, z.core.$strip>;
export type DeleteRunResponse = z.infer<typeof deleteRunResponseSchema>;
/** `POST /runs/:id/finish` — "no open session" is a 409. */
export declare const finishResponseSchema: z.ZodObject<{
    finished: z.ZodLiteral<true>;
}, z.core.$strip>;
export type FinishResponse = z.infer<typeof finishResponseSchema>;
/** `POST /runs/:id/continue` — a refusal to reopen is a 409 carrying the engine's reason. */
export declare const continueResponseSchema: z.ZodObject<{
    continued: z.ZodLiteral<true>;
}, z.core.$strip>;
export type ContinueResponse = z.infer<typeof continueResponseSchema>;
/**
 * `POST /runs/:id/pr` (201, spec 009) — the draft PR's URL; `dryRun` marks the CEZ_DRY_RUN fake
 * (no push, no gh). Failure is a 409 whose `ApiError` carries the `manual` merge command instead.
 *
 * `dryRun` is REQUIRED: `createDraftPr`'s success outcome always sets it (`forge/types.ts`), so
 * the key is always on the wire. The hand-written DTO had it optional.
 */
export declare const createPrResponseSchema: z.ZodObject<{
    url: z.ZodString;
    dryRun: z.ZodBoolean;
}, z.core.$strip>;
export type CreatePrResponse = z.infer<typeof createPrResponseSchema>;
/**
 * `POST /runs/:id/messages` — one of three shapes (#472), by how far the run has got:
 * `delivered` (a live session took it), `queued` (still waiting for a slot, so it was stacked
 * onto the prompt and the stored entry rides along), `deferred` (mid-spawn, so it was buffered
 * and arrives as an ordinary follow-up turn once the session opens). Anything else is a 409.
 *
 * A union, not one object of optional flags: exactly one of the three keys is ever present, and
 * the flattened DTO shape admitted `{}`. Pre-#472 clients only ever saw `delivered`.
 */
export declare const messageResponseSchema: z.ZodUnion<readonly [z.ZodObject<{
    delivered: z.ZodLiteral<true>;
}, z.core.$strip>, z.ZodObject<{
    queued: z.ZodLiteral<true>;
    message: z.ZodObject<{
        id: z.ZodString;
        text: z.ZodString;
        images: z.ZodOptional<z.ZodArray<z.ZodString>>;
        createdAt: z.ZodString;
    }, z.core.$strip>;
}, z.core.$strip>, z.ZodObject<{
    deferred: z.ZodLiteral<true>;
}, z.core.$strip>]>;
export type MessageResponse = z.infer<typeof messageResponseSchema>;
/** `PATCH /runs/:id/queued-messages/:msgId` (#472) — the replaced entry. */
export declare const editQueuedMessageResponseSchema: z.ZodObject<{
    message: z.ZodObject<{
        id: z.ZodString;
        text: z.ZodString;
        images: z.ZodOptional<z.ZodArray<z.ZodString>>;
        createdAt: z.ZodString;
    }, z.core.$strip>;
}, z.core.$strip>;
export type EditQueuedMessageResponse = z.infer<typeof editQueuedMessageResponseSchema>;
/** `DELETE /runs/:id/queued-messages/:msgId` (#472) — `409 run already started` otherwise. */
export declare const removeQueuedMessageResponseSchema: z.ZodObject<{
    removed: z.ZodLiteral<true>;
}, z.core.$strip>;
export type RemoveQueuedMessageResponse = z.infer<typeof removeQueuedMessageResponseSchema>;
/**
 * `POST /runs/:id/open-in-cli` — a terminal was spawned with `command` running in it. With no
 * terminal emulator the server answers 409 and the `ApiError` carries the full `cd … && <command>`
 * for the clipboard fallback.
 */
export declare const openInCliResponseSchema: z.ZodObject<{
    opened: z.ZodLiteral<true>;
    command: z.ZodString;
}, z.core.$strip>;
export type OpenInCliResponse = z.infer<typeof openInCliResponseSchema>;
/** `POST /runs/:id/remove-worktree` — per-row delete in the worktrees panel (#483). */
export declare const removeWorktreeResponseSchema: z.ZodObject<{
    removed: z.ZodLiteral<true>;
}, z.core.$strip>;
export type RemoveWorktreeResponse = z.infer<typeof removeWorktreeResponseSchema>;
/** `POST /runs/:id/git/commit` — `git add -A && git commit` in the run's worktree. */
export declare const gitCommitResponseSchema: z.ZodObject<{
    committed: z.ZodLiteral<true>;
    sha: z.ZodString;
}, z.core.$strip>;
export type GitCommitResponse = z.infer<typeof gitCommitResponseSchema>;
/** `POST /runs/:id/git/push` — push the worktree's branch, setting upstream if it has none. */
export declare const gitPushResponseSchema: z.ZodObject<{
    pushed: z.ZodLiteral<true>;
    branch: z.ZodString;
    remote: z.ZodString;
    upstreamSet: z.ZodBoolean;
}, z.core.$strip>;
export type GitPushResponse = z.infer<typeof gitPushResponseSchema>;
/** A commit a run made on its worktree branch. */
export declare const runCommitSchema: z.ZodObject<{
    sha: z.ZodString;
    subject: z.ZodString;
    author: z.ZodString;
    when: z.ZodString;
}, z.core.$strip>;
export type RunCommit = z.infer<typeof runCommitSchema>;
/** `GET /runs/:id/commits` — `<base>..HEAD` on the worktree branch, newest first. */
export declare const runCommitsResponseSchema: z.ZodObject<{
    commits: z.ZodArray<z.ZodObject<{
        sha: z.ZodString;
        subject: z.ZodString;
        author: z.ZodString;
        when: z.ZodString;
    }, z.core.$strip>>;
}, z.core.$strip>;
export type RunCommitsResponse = z.infer<typeof runCommitsResponseSchema>;
/**
 * One variant column of the compare view.
 *
 * CAREFUL: `diffStat` here is the raw `git diff --stat` TEXT the server runs in the variant's
 * worktree — a different thing from the numeric `RunRecord.diffStat`. `''` when the worktree
 * is gone.
 */
export declare const groupVariantSchema: z.ZodObject<{
    id: z.ZodString;
    variant: z.ZodString;
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
    archived: z.ZodBoolean;
    tokensUsed: z.ZodNumber;
    inputTokens: z.ZodOptional<z.ZodNumber>;
    outputTokens: z.ZodOptional<z.ZodNumber>;
    costUsd: z.ZodOptional<z.ZodNumber>;
    diffStat: z.ZodString;
    handoffExcerpt: z.ZodString;
}, z.core.$strip>;
export type GroupVariant = z.infer<typeof groupVariantSchema>;
/** `GET /groups/:groupId` — every run sharing a groupId, side by side. */
export declare const groupResponseSchema: z.ZodObject<{
    groupId: z.ZodString;
    runs: z.ZodArray<z.ZodObject<{
        id: z.ZodString;
        variant: z.ZodString;
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
        archived: z.ZodBoolean;
        tokensUsed: z.ZodNumber;
        inputTokens: z.ZodOptional<z.ZodNumber>;
        outputTokens: z.ZodOptional<z.ZodNumber>;
        costUsd: z.ZodOptional<z.ZodNumber>;
        diffStat: z.ZodString;
        handoffExcerpt: z.ZodString;
    }, z.core.$strip>>;
}, z.core.$strip>;
export type GroupResponse = z.infer<typeof groupResponseSchema>;
/**
 * `POST /groups/:groupId/pick` — the winner (parked at `review` when it has a diff); the losers
 * were cancelled if alive, archived, and their worktrees + branches removed.
 *
 * `winner` is OPTIONAL because that is what the wire says: `store.getRun(id)` can miss, and
 * `JSON.stringify` drops a key whose value is `undefined`. The handler spreads the key in
 * conditionally (`server.ts`, the `/groups/:groupId/pick` route) so its own type says the same
 * thing — the two-way check in `contract-parity.workflows.test.ts` is what pins that.
 */
export declare const pickVariantResponseSchema: z.ZodObject<{
    winner: z.ZodOptional<z.ZodObject<{
        id: z.ZodString;
        title: z.ZodString;
        titleSummary: z.ZodOptional<z.ZodString>;
        diffStat: z.ZodOptional<z.ZodObject<{
            adds: z.ZodNumber;
            dels: z.ZodNumber;
            files: z.ZodNumber;
            repointed: z.ZodOptional<z.ZodBoolean>;
        }, z.core.$strip>>;
        workflow: z.ZodString;
        task: z.ZodString;
        queuedMessages: z.ZodOptional<z.ZodArray<z.ZodObject<{
            id: z.ZodString;
            text: z.ZodString;
            images: z.ZodOptional<z.ZodArray<z.ZodString>>;
            createdAt: z.ZodString;
        }, z.core.$strip>>>;
        taskImages: z.ZodOptional<z.ZodArray<z.ZodString>>;
        model: z.ZodOptional<z.ZodString>;
        modelIdentity: z.ZodOptional<z.ZodString>;
        runner: z.ZodOptional<z.ZodEnum<{
            claude: "claude";
            codex: "codex";
            opencode: "opencode";
            pi: "pi";
        }>>;
        requestedRunner: z.ZodOptional<z.ZodUnion<readonly [z.ZodEnum<{
            claude: "claude";
            codex: "codex";
            opencode: "opencode";
            pi: "pi";
        }>, z.ZodLiteral<"auto">]>>;
        agentProfile: z.ZodOptional<z.ZodString>;
        systemPrompt: z.ZodOptional<z.ZodString>;
        generateFollowups: z.ZodOptional<z.ZodBoolean>;
        autonomous: z.ZodOptional<z.ZodBoolean>;
        automation: z.ZodOptional<z.ZodObject<{
            automationId: z.ZodString;
            automationRevision: z.ZodNumber;
            receiptId: z.ZodString;
            event: z.ZodString;
            githubUrl: z.ZodString;
        }, z.core.$strip>>;
        status: z.ZodEnum<{
            cancelled: "cancelled";
            done: "done";
            failed: "failed";
            queued: "queued";
            review: "review";
            running: "running";
            waiting: "waiting";
        }>;
        activity: z.ZodOptional<z.ZodEnum<{
            monitoring: "monitoring";
        }>>;
        monitoringWakeAt: z.ZodOptional<z.ZodString>;
        monitoringWakeCapReached: z.ZodOptional<z.ZodBoolean>;
        autoResumeAt: z.ZodOptional<z.ZodString>;
        autoResumeAttempts: z.ZodOptional<z.ZodNumber>;
        blockedReason: z.ZodOptional<z.ZodObject<{
            type: z.ZodLiteral<"provider_quota">;
            providers: z.ZodArray<z.ZodEnum<{
                claude: "claude";
                codex: "codex";
            }>>;
            retryAt: z.ZodOptional<z.ZodString>;
        }, z.core.$strip>>;
        createdAt: z.ZodString;
        startedAt: z.ZodOptional<z.ZodString>;
        finishedAt: z.ZodOptional<z.ZodString>;
        tokensUsed: z.ZodNumber;
        inputTokens: z.ZodOptional<z.ZodNumber>;
        outputTokens: z.ZodOptional<z.ZodNumber>;
        costUsd: z.ZodOptional<z.ZodNumber>;
        pullRequestUrl: z.ZodOptional<z.ZodString>;
        referencedPullRequestUrl: z.ZodOptional<z.ZodString>;
        prNumber: z.ZodOptional<z.ZodNumber>;
        issueNumber: z.ZodOptional<z.ZodNumber>;
        referencedIssueNumberSeeded: z.ZodOptional<z.ZodBoolean>;
        titleOrigin: z.ZodOptional<z.ZodEnum<{
            auto: "auto";
            marker: "marker";
            user: "user";
        }>>;
        markerRefs: z.ZodOptional<z.ZodObject<{
            pr: z.ZodOptional<z.ZodNumber>;
            issue: z.ZodOptional<z.ZodNumber>;
        }, z.core.$strip>>;
        referencedPrCandidates: z.ZodOptional<z.ZodArray<z.ZodString>>;
        referencedIssueUrl: z.ZodOptional<z.ZodString>;
        referencedIssueCandidates: z.ZodOptional<z.ZodArray<z.ZodString>>;
        worktree: z.ZodOptional<z.ZodLiteral<false>>;
        worktreePath: z.ZodOptional<z.ZodString>;
        branch: z.ZodOptional<z.ZodString>;
        baseBranch: z.ZodOptional<z.ZodString>;
        worktreeReclaimedAt: z.ZodOptional<z.ZodString>;
        groupId: z.ZodOptional<z.ZodString>;
        variant: z.ZodOptional<z.ZodString>;
        peakRssBytes: z.ZodOptional<z.ZodNumber>;
        peakProcCount: z.ZodOptional<z.ZodNumber>;
        archived: z.ZodBoolean;
        archivedAt: z.ZodOptional<z.ZodString>;
        seenAt: z.ZodOptional<z.ZodString>;
        currentStepId: z.ZodOptional<z.ZodString>;
        error: z.ZodOptional<z.ZodString>;
        steps: z.ZodArray<z.ZodObject<{
            id: z.ZodString;
            name: z.ZodString;
            kind: z.ZodEnum<{
                agent: "agent";
                check: "check";
            }>;
            status: z.ZodEnum<{
                cancelled: "cancelled";
                done: "done";
                failed: "failed";
                pending: "pending";
                review: "review";
                running: "running";
                skipped: "skipped";
                waiting: "waiting";
            }>;
            iterations: z.ZodNumber;
            tokensUsed: z.ZodNumber;
            inputTokens: z.ZodOptional<z.ZodNumber>;
            outputTokens: z.ZodOptional<z.ZodNumber>;
            usageInvocationsStarted: z.ZodOptional<z.ZodNumber>;
            usageInvocationsObserved: z.ZodOptional<z.ZodNumber>;
            usageTurnsStarted: z.ZodOptional<z.ZodNumber>;
            usageTurnsRecorded: z.ZodOptional<z.ZodNumber>;
            usageInvocationEpoch: z.ZodOptional<z.ZodNumber>;
            startedAt: z.ZodOptional<z.ZodString>;
            finishedAt: z.ZodOptional<z.ZodString>;
            error: z.ZodOptional<z.ZodString>;
            sessionId: z.ZodOptional<z.ZodString>;
            backend: z.ZodOptional<z.ZodEnum<{
                claude: "claude";
                codex: "codex";
                opencode: "opencode";
                pi: "pi";
            }>>;
            requestedRunner: z.ZodOptional<z.ZodUnion<readonly [z.ZodEnum<{
                claude: "claude";
                codex: "codex";
                opencode: "opencode";
                pi: "pi";
            }>, z.ZodLiteral<"auto">]>>;
            profileId: z.ZodOptional<z.ZodString>;
            costUsd: z.ZodOptional<z.ZodNumber>;
        }, z.core.$strip>>;
        workflowDef: z.ZodOptional<z.ZodObject<{
            name: z.ZodString;
            description: z.ZodOptional<z.ZodString>;
            steps: z.ZodArray<z.ZodObject<{
                id: z.ZodString;
                name: z.ZodOptional<z.ZodString>;
                prompt: z.ZodOptional<z.ZodString>;
                skill: z.ZodOptional<z.ZodString>;
                model: z.ZodOptional<z.ZodString>;
                runner: z.ZodOptional<z.ZodUnion<readonly [z.ZodEnum<{
                    claude: "claude";
                    codex: "codex";
                    opencode: "opencode";
                    pi: "pi";
                }>, z.ZodLiteral<"auto">]>>;
                allowedTools: z.ZodOptional<z.ZodArray<z.ZodString>>;
                bashAllowlist: z.ZodOptional<z.ZodArray<z.ZodString>>;
                command: z.ZodOptional<z.ZodString>;
                onFail: z.ZodOptional<z.ZodObject<{
                    retry: z.ZodString;
                    max: z.ZodDefault<z.ZodNumber>;
                }, z.core.$strip>>;
            }, z.core.$strip>>;
            source: z.ZodEnum<{
                "built-in": "built-in";
                file: "file";
            }>;
            path: z.ZodOptional<z.ZodString>;
        }, z.core.$strip>>;
    }, z.core.$strip>>;
}, z.core.$strip>;
export type PickVariantResponse = z.infer<typeof pickVariantResponseSchema>;
/** An inline image, base64 — ≤4 per request, ~5 MB each once decoded. */
export declare const imageInputSchema: z.ZodObject<{
    mediaType: z.ZodString;
    data: z.ZodString;
}, z.core.$strip>;
export type ImageInput = z.input<typeof imageInputSchema>;
/**
 * The KEYS of `POST /runs`' body, before the XOR refinement that `createRunInputSchema` adds.
 *
 * Split out for one reason: `./automations.ts` builds an automation's task on top of this shape
 * (a task IS a run-creation body minus the three keys an automation supplies itself), and zod
 * refuses `.omit()` on a schema that carries refinements. Validate with `createRunInputSchema`
 * below — this half accepts a body naming both `workflow` and `steps`, which the server does not.
 */
export declare const createRunInputBaseSchema: z.ZodObject<{
    workflow: z.ZodOptional<z.ZodString>;
    steps: z.ZodOptional<z.ZodArray<z.ZodObject<{
        id: z.ZodString;
        name: z.ZodOptional<z.ZodString>;
        prompt: z.ZodOptional<z.ZodString>;
        skill: z.ZodOptional<z.ZodString>;
        model: z.ZodOptional<z.ZodString>;
        runner: z.ZodOptional<z.ZodUnion<readonly [z.ZodEnum<{
            claude: "claude";
            codex: "codex";
            opencode: "opencode";
            pi: "pi";
        }>, z.ZodLiteral<"auto">]>>;
        allowedTools: z.ZodOptional<z.ZodArray<z.ZodString>>;
        bashAllowlist: z.ZodOptional<z.ZodArray<z.ZodString>>;
        command: z.ZodOptional<z.ZodString>;
        onFail: z.ZodOptional<z.ZodObject<{
            retry: z.ZodString;
            max: z.ZodDefault<z.ZodNumber>;
        }, z.core.$strip>>;
    }, z.core.$strip>>>;
    task: z.ZodString;
    model: z.ZodOptional<z.ZodString>;
    runner: z.ZodOptional<z.ZodUnion<readonly [z.ZodEnum<{
        claude: "claude";
        codex: "codex";
        opencode: "opencode";
        pi: "pi";
    }>, z.ZodLiteral<"auto">]>>;
    agentProfile: z.ZodOptional<z.ZodString>;
    variants: z.ZodOptional<z.ZodNumber>;
    worktree: z.ZodOptional<z.ZodBoolean>;
    autonomous: z.ZodOptional<z.ZodBoolean>;
    generateFollowups: z.ZodOptional<z.ZodBoolean>;
    systemPrompt: z.ZodPipe<z.ZodOptional<z.ZodString>, z.ZodTransform<string | undefined, string | undefined>>;
    images: z.ZodOptional<z.ZodArray<z.ZodObject<{
        mediaType: z.ZodString;
        data: z.ZodString;
    }, z.core.$strip>>>;
    todoId: z.ZodOptional<z.ZodString>;
}, z.core.$strip>;
/**
 * `POST /runs`. Exactly one of `workflow` / `steps` — the server rejects both or neither.
 *
 * Every bound here is the server's own (#429): an unbounded body must never reach a spawned
 * process, so a client that validates before sending gets the same answer the route would give.
 */
export declare const createRunInputSchema: z.ZodObject<{
    workflow: z.ZodOptional<z.ZodString>;
    steps: z.ZodOptional<z.ZodArray<z.ZodObject<{
        id: z.ZodString;
        name: z.ZodOptional<z.ZodString>;
        prompt: z.ZodOptional<z.ZodString>;
        skill: z.ZodOptional<z.ZodString>;
        model: z.ZodOptional<z.ZodString>;
        runner: z.ZodOptional<z.ZodUnion<readonly [z.ZodEnum<{
            claude: "claude";
            codex: "codex";
            opencode: "opencode";
            pi: "pi";
        }>, z.ZodLiteral<"auto">]>>;
        allowedTools: z.ZodOptional<z.ZodArray<z.ZodString>>;
        bashAllowlist: z.ZodOptional<z.ZodArray<z.ZodString>>;
        command: z.ZodOptional<z.ZodString>;
        onFail: z.ZodOptional<z.ZodObject<{
            retry: z.ZodString;
            max: z.ZodDefault<z.ZodNumber>;
        }, z.core.$strip>>;
    }, z.core.$strip>>>;
    task: z.ZodString;
    model: z.ZodOptional<z.ZodString>;
    runner: z.ZodOptional<z.ZodUnion<readonly [z.ZodEnum<{
        claude: "claude";
        codex: "codex";
        opencode: "opencode";
        pi: "pi";
    }>, z.ZodLiteral<"auto">]>>;
    agentProfile: z.ZodOptional<z.ZodString>;
    variants: z.ZodOptional<z.ZodNumber>;
    worktree: z.ZodOptional<z.ZodBoolean>;
    autonomous: z.ZodOptional<z.ZodBoolean>;
    generateFollowups: z.ZodOptional<z.ZodBoolean>;
    systemPrompt: z.ZodPipe<z.ZodOptional<z.ZodString>, z.ZodTransform<string | undefined, string | undefined>>;
    images: z.ZodOptional<z.ZodArray<z.ZodObject<{
        mediaType: z.ZodString;
        data: z.ZodString;
    }, z.core.$strip>>>;
    todoId: z.ZodOptional<z.ZodString>;
}, z.core.$strip>;
export type CreateRunInput = z.input<typeof createRunInputSchema>;
/**
 * `POST /runs/:id/messages` — text and/or pasted screenshots for a live session. Both keys have
 * server-side defaults, so an omitted `text` is `''` and an omitted `images` is `[]`; the refine
 * is what rejects a message that is empty in both.
 */
export declare const messageInputSchema: z.ZodObject<{
    text: z.ZodDefault<z.ZodString>;
    images: z.ZodDefault<z.ZodArray<z.ZodObject<{
        mediaType: z.ZodString;
        data: z.ZodString;
    }, z.core.$strip>>>;
}, z.core.$strip>;
export type MessageInput = z.input<typeof messageInputSchema>;
/**
 * `PATCH /runs/:id` (#389). `title` is trimmed server-side, 1–300 chars, and the edit sets both
 * `title` and `titleSummary` so it wins over any auto-summary. `task` (#472) is the initial
 * prompt, editable only while the run is still queued — any other status answers
 * `409 run already started`, and the folded total across the task and its stack bounds it again.
 */
export declare const patchRunInputSchema: z.ZodObject<{
    title: z.ZodOptional<z.ZodString>;
    task: z.ZodOptional<z.ZodString>;
}, z.core.$strip>;
export type PatchRunInput = z.input<typeof patchRunInputSchema>;
