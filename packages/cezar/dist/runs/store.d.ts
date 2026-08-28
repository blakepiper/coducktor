import { EventEmitter } from 'node:events';
import { z } from 'zod';
import type { RunnerId } from '../core/agent-runner.ts';
export type RunStatus = 'queued' | 'running' | 'waiting' | 'review' | 'done' | 'failed' | 'cancelled';
/**
 * A sub-state of `running` (spec 2026-07-18-subagent-monitoring-status, #490):
 * the agent ended its turn still working on its own downstream work (a sub-agent
 * or a monitored command) and declared it with the `CEZ:MONITORING` marker — so
 * the cockpit shows a non-attention "monitoring" label instead of "needs you".
 * Only ever set while `status === 'running'`; cleared on resume/terminal.
 */
export type RunActivity = 'monitoring';
export type StepStatus = 'pending' | 'running' | 'waiting' | 'review' | 'done' | 'failed' | 'cancelled' | 'skipped';
declare const stepStateSchema: z.ZodObject<{
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
    backend: z.ZodOptional<z.ZodPipe<z.ZodEnum<{
        claude: "claude";
        "claude-cli": "claude-cli";
        codex: "codex";
        opencode: "opencode";
        pi: "pi";
    }>, z.ZodTransform<"claude" | "codex" | "opencode" | "pi", "claude" | "claude-cli" | "codex" | "opencode" | "pi">>>;
    requestedRunner: z.ZodOptional<z.ZodUnion<readonly [z.ZodEnum<{
        claude: "claude";
        codex: "codex";
        opencode: "opencode";
        pi: "pi";
    }>, z.ZodLiteral<"auto">]>>;
    profileId: z.ZodOptional<z.ZodString>;
    reasoningEffort: z.ZodOptional<z.ZodEnum<{
        high: "high";
        low: "low";
        medium: "medium";
        xhigh: "xhigh";
    }>>;
    costUsd: z.ZodOptional<z.ZodNumber>;
    modelIdentity: z.ZodOptional<z.ZodString>;
}, z.core.$strip>;
/** One prompt message stacked onto a run while it waits for a free agent slot
 *  (#472). Folded into `{{task}}` at dequeue by `hydrateQueuedInput`; never
 *  delivered as its own turn — a follow-up turn would reach only the first step
 *  of a chain and would race the opening turn. */
declare const queuedMessageSchema: z.ZodObject<{
    id: z.ZodString;
    text: z.ZodString;
    images: z.ZodOptional<z.ZodArray<z.ZodString>>;
    createdAt: z.ZodString;
}, z.core.$strip>;
/** Exported for `./run-index.ts`, the read-only reader of the same file. Nothing else should
 *  parse `runs.json` — see `reconcileLoadedRun` for why a second parser is a correctness risk. */
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
    reasoningEffort: z.ZodOptional<z.ZodEnum<{
        auto: "auto";
        high: "high";
        low: "low";
        medium: "medium";
        xhigh: "xhigh";
    }>>;
    modelIdentity: z.ZodOptional<z.ZodString>;
    runner: z.ZodOptional<z.ZodPipe<z.ZodEnum<{
        claude: "claude";
        "claude-cli": "claude-cli";
        codex: "codex";
        opencode: "opencode";
        pi: "pi";
    }>, z.ZodTransform<"claude" | "codex" | "opencode" | "pi", "claude" | "claude-cli" | "codex" | "opencode" | "pi">>>;
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
    monitoringWakeAt: z.ZodCatch<z.ZodOptional<z.ZodString>>;
    monitoringWakeCapReached: z.ZodOptional<z.ZodBoolean>;
    autoResumeAt: z.ZodCatch<z.ZodOptional<z.ZodString>>;
    autoResumeAttempts: z.ZodCatch<z.ZodOptional<z.ZodNumber>>;
    blockedReason: z.ZodOptional<z.ZodObject<{
        type: z.ZodLiteral<"provider_quota">;
        providers: z.ZodArray<z.ZodEnum<{
            claude: "claude";
            codex: "codex";
        }>>;
        retryAt: z.ZodCatch<z.ZodOptional<z.ZodString>>;
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
    archived: z.ZodDefault<z.ZodBoolean>;
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
        backend: z.ZodOptional<z.ZodPipe<z.ZodEnum<{
            claude: "claude";
            "claude-cli": "claude-cli";
            codex: "codex";
            opencode: "opencode";
            pi: "pi";
        }>, z.ZodTransform<"claude" | "codex" | "opencode" | "pi", "claude" | "claude-cli" | "codex" | "opencode" | "pi">>>;
        requestedRunner: z.ZodOptional<z.ZodUnion<readonly [z.ZodEnum<{
            claude: "claude";
            codex: "codex";
            opencode: "opencode";
            pi: "pi";
        }>, z.ZodLiteral<"auto">]>>;
        profileId: z.ZodOptional<z.ZodString>;
        reasoningEffort: z.ZodOptional<z.ZodEnum<{
            high: "high";
            low: "low";
            medium: "medium";
            xhigh: "xhigh";
        }>>;
        costUsd: z.ZodOptional<z.ZodNumber>;
        modelIdentity: z.ZodOptional<z.ZodString>;
    }, z.core.$strip>>;
    workflowDef: z.ZodCatch<z.ZodOptional<z.ZodObject<{
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
    }, z.core.$strip>>>;
}, z.core.$strip>;
export type StepState = z.infer<typeof stepStateSchema>;
export type QueuedMessage = z.infer<typeof queuedMessageSchema>;
export type RunRecord = z.infer<typeof runRecordSchema>;
export interface ModelUsageEntry {
    model: string;
    reasoningEffort?: 'low' | 'medium' | 'high' | 'xhigh';
    pct: number;
}
/**
 * Groups a run's steps by (model identity, reasoning level) and weighs each group by tokens
 * spent — "which models actually did this work, and how much of it?" rather than "what's
 * running right now". The server-side twin of the task-detail agent badge's
 * `computeModelBreakdown` (`web/src/routes/task-thread/run-header.tsx`): same grouping rule, run
 * here so the cross-project runs index (`GET /workspace/runs-index`) can ship the small, already
 * summarized answer instead of every project's full `steps[]`.
 *
 * Steps predating per-step `modelIdentity` or with zero recorded tokens are skipped rather than
 * guessed into a group — same omitted-not-guessed rule as the badge.
 */
export declare function computeModelUsageBreakdown(steps: readonly StepState[]): ModelUsageEntry[];
/** One persisted event line; `type` mirrors AgentEvent plus engine lifecycle. */
export interface RunEvent {
    seq: number;
    ts: string;
    stepId?: string;
    type: string;
    [key: string]: unknown;
}
/**
 * Reconcile one record just read off disk with the fact that whichever process wrote it is gone.
 *
 * Mutates and returns `run`. Extracted from `RunStore.open` so the read-only index reader
 * (`./run-index.ts`) answers the SAME question about a `running` row on disk. Two parsers that
 * disagree here is a visible bug, not an internal one: the cockpit would show a task as running
 * in the ⌘K index and failed the moment you opened it.
 *
 * `keepLive` (#367): leave `queued`/`running`/`waiting` untouched so the caller can recover them
 * (RunManager.recover re-queues queued runs, resumes interrupted ones). Without it — one-shot CLI
 * paths that never recover, and the index reader, which has no manager at all — live-looking runs
 * are marked failed so no ghost stays behind.
 */
export declare function reconcileLoadedRun(run: RunRecord, opts?: {
    keepLive?: boolean;
}): RunRecord;
/**
 * File-backed run store: `runs.json` index (atomic tmp+rename writes, the
 * pattern from @cezar/core's IssueStore) plus one append-only NDJSON event
 * file per run. Also the in-process event bus the SSE endpoints subscribe to:
 * emits `('run', RunRecord)` and `('event', { runId, event: RunEvent })`.
 */
export declare class RunStore extends EventEmitter {
    private readonly dataDir;
    private runs;
    private saveTimer;
    private constructor();
    /** See `reconcileLoadedRun` for what `keepLive` (#367) decides about live-looking rows. */
    static open(dataDir: string, opts?: {
        keepLive?: boolean;
    }): RunStore;
    listRuns(): RunRecord[];
    getRun(id: string): RunRecord | undefined;
    createRun(input: {
        title: string;
        workflow: string;
        task: string;
        model?: string;
        reasoningEffort?: 'auto' | 'low' | 'medium' | 'high' | 'xhigh';
        runner?: RunnerId;
        requestedRunner?: RunnerId | 'auto';
        /** Composer's per-task agent account (spec 2026-07-29-agent-profiles). */
        agentProfile?: string;
        generateFollowups?: boolean;
        autonomous?: boolean;
        worktree?: false;
        groupId?: string;
        variant?: string;
        steps: Array<Pick<StepState, 'id' | 'name' | 'kind'>>;
    }): RunRecord;
    updateRun(id: string, patch: Partial<Omit<RunRecord, 'id' | 'steps'>>): RunRecord | undefined;
    /**
     * Scrub the free-text fields of a record patch (#427 review). Redacting only
     * events left a hole: `titleSummary` is derived from the RAW first agent turn
     * and `error` from raw process output, so a token the agent echoed was
     * `[REDACTED]` in the NDJSON yet verbatim in `runs.json` — the file the "no
     * secrets in state files" rule names explicitly. These three are the only
     * patch fields carrying agent/process text; the rest are ids, enums, counters
     * and URLs, and running the scrubber over them would only risk mangling them.
     *
     * `StepState.error` is the step-level counterpart and is scrubbed the same
     * way in `updateStep` — `run.ts` feeds the SAME `err.message` string to both
     * calls, so redacting only the run-level copy left the token verbatim one
     * field away (#456 review).
     */
    private redactPatch;
    /**
     * Step-level counterpart of `redactPatch` (#456 review). `error` is the only
     * free-text `StepState` field — it is set from raw `err.message` /process
     * output (`run.ts` `finishStep`), and `touch()` fans the whole record out
     * over SSE, so an unscrubbed copy leaked to `runs.json` AND to the browser.
     * The remaining fields are ids, enums, counters and timestamps.
     */
    private redactStepPatch;
    /** Append a step to an existing run (used by "Continue" — spec 003). */
    addStep(runId: string, step: Pick<StepState, 'id' | 'name' | 'kind' | 'requestedRunner'>): void;
    updateStep(runId: string, stepId: string, patch: Partial<Omit<StepState, 'id'>>): void;
    setArchived(id: string, archived: boolean): RunRecord | undefined;
    /** Bulk-archive every finished run; returns how many were archived. */
    archiveFinished(): number;
    /** Mark one run as read (#unread-done-items): stamp the read receipt now. Mirrors
     *  `setArchived` — sets the field then persists + broadcasts via `touch`, so the
     *  updated record rides the existing `run` SSE with no new event. Idempotent by
     *  design: opening an already-read thread just re-stamps a later `seenAt`. */
    setRead(id: string): RunRecord | undefined;
    /** Mark one run as UNread (#775): drop the read receipt so the run rejoins the unread
     *  list. The inverse of `setRead` and, like it, `touch`es so the updated record rides the
     *  existing `run` SSE.
     *
     *  Deleting the field rather than adding a "manually unread" flag is the whole point:
     *  absent `seenAt` is ALREADY what every reader treats as unread (`isUnread` in the
     *  cockpit's read-state.ts, and `markAllRead`'s clause-for-clause copy of it below), so
     *  clearing needs no new state and writes a shape any older cezar already parses.
     *
     *  Deliberately unconditional: clearing a receipt is always a legal write, so this
     *  succeeds for an already-unread run (idempotent) and for statuses that can never wear
     *  the marker. WHETHER the action means anything for a given run is UI policy, and lives
     *  in the cockpit's `runActionFlags` — the same split the rest of the store keeps. */
    setUnread(id: string): RunRecord | undefined;
    /** Bulk mark-read: stamp every currently-unread finished run; returns the count.
     *  "Unread" here is the same rule the cockpit paints (`isUnread` in read-state.ts),
     *  clause for clause:
     *   - a `done` or `failed` run that finished and has not been seen since;
     *   - cancelled runs are never unread — you stopped them yourself;
     *   - archived ones never are either, since archiving is a stronger "done with this"
     *     than reading;
     *   - and a `failed` run with a pending `autoResumeAt` is not a done item AT ALL
     *     (`isScheduledResume`, spec 2026-08-03-auto-resume-after-usage-limit): it has an
     *     appointment to pick the work back up, so there is no outcome to have missed.
     *
     *  Keeping the two rules identical is what makes the returned count the number the
     *  cockpit's unread badge was showing. The `autoResumeAt` clause is the one that drifted
     *  (#803): `isUnread` gained it with auto-resume and this sweep did not, so a task waiting
     *  out a usage limit was uncounted by the badge but stamped read by the sweep — and this
     *  comment asserted an invariant the code no longer held.
     *
     *  This rule lives in two languages of the same repo, which is why it has now drifted
     *  once. The cockpit cannot import it (`packages/web` does not depend on the service, and
     *  should not), so a single definition would have to move to `packages/contract` — the one
     *  package both sides already import. Worth doing; deliberately not done here, because
     *  widening the contract package's remit from "shapes" to "behavior" is a design change
     *  that deserves its own review rather than riding along in a bug fix. Until then: EDIT
     *  BOTH, and the case-table tests on either side are what catch you if you don't. */
    markAllRead(): number;
    appendEvent(runId: string, event: {
        type: string;
        stepId?: string;
        [key: string]: unknown;
    }): RunEvent;
    /**
     * Fold every PR URL in `haystack` into the run's referenced-tier working
     * set and re-resolve `referencedPullRequestUrl` (spec
     * 2026-07-16-pr-autodiscovery). Mutates the record in place — the caller
     * owns persistence/fan-out — and reports whether anything changed.
     */
    private trackReferencedPrs;
    /**
     * The issue-side mirror of `trackReferencedPrs` (spec
     * 2026-07-21-report-ref-discovery): fold every issue URL in `haystack` into
     * the working set and re-resolve `referencedIssueUrl`. An unambiguous
     * resolution also seeds `issueNumber` when nothing owns that field yet —
     * marker and namer both outrank this janitor and overwrite it freely.
     */
    private trackReferencedIssues;
    /**
     * Apply agent-declared reference markers (spec 2026-07-18-task-ref-markers).
     * Marker values are authoritative for the display tier: they overwrite the
     * regex/namer numbers, and a declared PR re-resolves the referenced URL
     * against the candidate working set — including down to `undefined` when no
     * candidate matches (a wrong chip is worse than no chip). The created tier
     * (`pullRequestUrl`) is deliberately untouched.
     */
    applyMarkerRefs(runId: string, refs: {
        pr?: number;
        issue?: number;
    }): RunRecord | undefined;
    /**
     * Fan an event out to live subscribers WITHOUT writing it to the NDJSON
     * file — the channel for coalesced `item.delta` flushes (protocol-v2
     * performance guardrail: raw deltas never hit disk; replay = the persisted
     * snapshots). Stamped with `seq`/`ts` like persisted lines so the live
     * wire keeps one ordering axis; the seq simply never appears in a replay
     * (gaps are fine — dedup compares with `>`).
     */
    emitEphemeral(runId: string, event: {
        type: string;
        stepId?: string;
        [key: string]: unknown;
    }): RunEvent;
    /** Lazily-collected concrete secret values from the host env (#427). */
    private secretValues;
    /**
     * Scrub known credential values / token shapes from an event before it is
     * persisted or fanned out. On by default; `CEZ_REDACT_SECRETS=0` opts out.
     */
    private redact;
    /** Best-effort scrub of one free-text string bound for `runs.json`. Honors
     *  the `CEZ_REDACT_SECRETS=0` opt-out itself so every caller inherits it. */
    private redactText;
    private hostSecrets;
    readEvents(runId: string): RunEvent[];
    deleteRun(id: string): boolean;
    /** Write the index out now (used on shutdown). */
    flush(): void;
    private seqs;
    private nextSeq;
    /** After a restart the in-memory counter is empty while the run's NDJSON file
     *  keeps the history. Restarting from 1 would collide with the seqs a client
     *  already replayed — its `seq > maxSeq` dedup then silently drops every
     *  resumed event, even across a reload (the frozen-transcript symptom class
     *  of #424). One file read on the first post-restart append per run. */
    private rehydrateSeq;
    private eventsPath;
    /** Same location `handoffPath()` in handoff.ts produces — inlined to keep
     *  the store free of upward imports. */
    private handoffPath;
    /** Agent screenshots persisted by the run manager (see persistImage). */
    private imagesDir;
    private touch;
    private pruneOldRuns;
    /** Debounced so token-usage updates don't rewrite the index per event. */
    private scheduleSave;
    private saveNow;
}
export {};
