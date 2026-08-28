import { z } from 'zod';
/**
 * The AUTOMATIONS family of `/api/v1` (#694) — the per-project GitHub triggers, their runtime
 * state, the manual "test filter" checks and the execution log.
 *
 * These shapes exist twice on purpose and only once as a DEFINITION of what the wire carries.
 * `packages/cezar/src/automations/types.ts` owns the STORAGE schemas: they are `.passthrough()`,
 * because a definitions/state/log file written by a newer cezar must survive a round trip through
 * an older one rather than lose keys it has never heard of. The schemas here are the CLOSED wire
 * half of those files — every key the routes actually answer with, and no index signature, so a
 * consumer compiles against a shape rather than against `unknown`. `src/server/
 * contract-parity.automations.test.ts` checks each response schema against the route that serves
 * it, in both directions.
 *
 * What that guard can and cannot see is worth knowing: a named key whose type drifts fails, and a
 * key this file makes required that the route does not send fails — but an EXTRA key arriving
 * through the storage schemas' catchall cannot, since the route's own type admits any key. That is
 * the same limit `contract-parity.workspace.test.ts` documents for the open GUI-pref bags.
 */
/** The GitHub activity an automation reacts to. Four events, all bounded polls — never a webhook. */
export declare const automationEventSchema: z.ZodEnum<{
    "issue.labeled": "issue.labeled";
    "issue.opened": "issue.opened";
    "issue.unlabeled": "issue.unlabeled";
    "pull_request.opened": "pull_request.opened";
}>;
export type AutomationEvent = z.infer<typeof automationEventSchema>;
/**
 * The bounded candidate filter.
 *
 * `lookbackDays` and `maxRecords` are REQUIRED here although the storage schema defaults them: a
 * default fills on PARSE, so both keys are always present in what the server hands out — and a
 * caller that omits them in a request body still gets them back materialized.
 */
export declare const automationFiltersSchema: z.ZodObject<{
    authors: z.ZodOptional<z.ZodArray<z.ZodString>>;
    assignees: z.ZodOptional<z.ZodArray<z.ZodString>>;
    allLabels: z.ZodOptional<z.ZodArray<z.ZodString>>;
    anyLabels: z.ZodOptional<z.ZodArray<z.ZodString>>;
    excludeLabels: z.ZodOptional<z.ZodArray<z.ZodString>>;
    changedLabels: z.ZodOptional<z.ZodArray<z.ZodString>>;
    lookbackDays: z.ZodNumber;
    maxRecords: z.ZodNumber;
}, z.core.$strip>;
export type AutomationFilters = z.infer<typeof automationFiltersSchema>;
/**
 * The task a match launches: `POST /runs`' own body minus the three keys an automation owns
 * itself — `task` (the rendered prompt), `images` and `todoId` — plus the prompt TEMPLATE.
 *
 * Two keys are re-spelled rather than inherited, because the automation schema really does differ
 * from the composer's and the contract has to describe the automation route:
 *
 *  - `variants` is the literal union the server's own automation schema accepts (`1 | 2 | 3`),
 *    not the composer's `z.number().int().min(1).max(3)`. Identical values, but only the literal
 *    spelling is assignable to the route's parameter;
 *  - `systemPrompt` carries no `.transform()` here. The composer's trims-to-absent on the way in,
 *    which makes the key REQUIRED (`string | undefined`) on the output side; the automation route
 *    stores and answers it plainly, so it stays optional.
 */
export declare const automationTaskSchema: z.ZodObject<{
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
    model: z.ZodOptional<z.ZodString>;
    reasoningEffort: z.ZodOptional<z.ZodEnum<{
        auto: "auto";
        high: "high";
        low: "low";
        medium: "medium";
        xhigh: "xhigh";
    }>>;
    runner: z.ZodOptional<z.ZodUnion<readonly [z.ZodEnum<{
        claude: "claude";
        codex: "codex";
        opencode: "opencode";
        pi: "pi";
    }>, z.ZodLiteral<"auto">]>>;
    agentProfile: z.ZodOptional<z.ZodString>;
    worktree: z.ZodOptional<z.ZodBoolean>;
    autonomous: z.ZodOptional<z.ZodBoolean>;
    generateFollowups: z.ZodOptional<z.ZodBoolean>;
    prompt: z.ZodString;
    variants: z.ZodOptional<z.ZodUnion<readonly [z.ZodLiteral<1>, z.ZodLiteral<2>, z.ZodLiteral<3>]>>;
    systemPrompt: z.ZodOptional<z.ZodString>;
}, z.core.$strip>;
export type AutomationTask = z.infer<typeof automationTaskSchema>;
/** One stored automation, as every route that answers a single definition serves it. */
export declare const automationDefinitionSchema: z.ZodObject<{
    id: z.ZodString;
    revision: z.ZodNumber;
    name: z.ZodString;
    description: z.ZodOptional<z.ZodString>;
    enabled: z.ZodBoolean;
    events: z.ZodArray<z.ZodEnum<{
        "issue.labeled": "issue.labeled";
        "issue.opened": "issue.opened";
        "issue.unlabeled": "issue.unlabeled";
        "pull_request.opened": "pull_request.opened";
    }>>;
    intervalSeconds: z.ZodNumber;
    filters: z.ZodObject<{
        authors: z.ZodOptional<z.ZodArray<z.ZodString>>;
        assignees: z.ZodOptional<z.ZodArray<z.ZodString>>;
        allLabels: z.ZodOptional<z.ZodArray<z.ZodString>>;
        anyLabels: z.ZodOptional<z.ZodArray<z.ZodString>>;
        excludeLabels: z.ZodOptional<z.ZodArray<z.ZodString>>;
        changedLabels: z.ZodOptional<z.ZodArray<z.ZodString>>;
        lookbackDays: z.ZodNumber;
        maxRecords: z.ZodNumber;
    }, z.core.$strip>;
    task: z.ZodObject<{
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
        model: z.ZodOptional<z.ZodString>;
        reasoningEffort: z.ZodOptional<z.ZodEnum<{
            auto: "auto";
            high: "high";
            low: "low";
            medium: "medium";
            xhigh: "xhigh";
        }>>;
        runner: z.ZodOptional<z.ZodUnion<readonly [z.ZodEnum<{
            claude: "claude";
            codex: "codex";
            opencode: "opencode";
            pi: "pi";
        }>, z.ZodLiteral<"auto">]>>;
        agentProfile: z.ZodOptional<z.ZodString>;
        worktree: z.ZodOptional<z.ZodBoolean>;
        autonomous: z.ZodOptional<z.ZodBoolean>;
        generateFollowups: z.ZodOptional<z.ZodBoolean>;
        prompt: z.ZodString;
        variants: z.ZodOptional<z.ZodUnion<readonly [z.ZodLiteral<1>, z.ZodLiteral<2>, z.ZodLiteral<3>]>>;
        systemPrompt: z.ZodOptional<z.ZodString>;
    }, z.core.$strip>;
    createdAt: z.ZodString;
    updatedAt: z.ZodString;
}, z.core.$strip>;
export type AutomationDefinition = z.infer<typeof automationDefinitionSchema>;
/** Where the poller had got to: an ISO timestamp plus a tie-breaker for same-second records. */
export declare const automationCursorSchema: z.ZodObject<{
    timestamp: z.ZodString;
    tieBreaker: z.ZodOptional<z.ZodString>;
}, z.core.$strip>;
export type AutomationCursor = z.infer<typeof automationCursorSchema>;
/**
 * The scheduler's own bookkeeping for one automation. Every key is optional — a definition that
 * has never run has no state at all, and the keys appear as the poller reaches each stage.
 */
export declare const automationRuntimeStateSchema: z.ZodObject<{
    revision: z.ZodOptional<z.ZodNumber>;
    baselineAt: z.ZodOptional<z.ZodString>;
    cursor: z.ZodOptional<z.ZodObject<{
        timestamp: z.ZodString;
        tieBreaker: z.ZodOptional<z.ZodString>;
    }, z.core.$strip>>;
    frozenHighWatermark: z.ZodOptional<z.ZodObject<{
        timestamp: z.ZodString;
        tieBreaker: z.ZodString;
    }, z.core.$strip>>;
    backlogAfter: z.ZodOptional<z.ZodObject<{
        timestamp: z.ZodString;
        tieBreaker: z.ZodString;
    }, z.core.$strip>>;
    nextCheckAt: z.ZodOptional<z.ZodString>;
    lastSuccessAt: z.ZodOptional<z.ZodString>;
    etags: z.ZodOptional<z.ZodRecord<z.ZodString, z.ZodString>>;
    backoffUntil: z.ZodOptional<z.ZodString>;
    consecutiveFailures: z.ZodOptional<z.ZodNumber>;
}, z.core.$strip>;
export type AutomationRuntimeState = z.infer<typeof automationRuntimeStateSchema>;
/** What one poll decided about one candidate. `baseline` and `preview` are bookkeeping rows: no
 *  task was launched and none was meant to be. */
export declare const automationLogResultSchema: z.ZodEnum<{
    baseline: "baseline";
    duplicate: "duplicate";
    error: "error";
    launched: "launched";
    "no-match": "no-match";
    preview: "preview";
    "rate-limited": "rate-limited";
}>;
export type AutomationLogResult = z.infer<typeof automationLogResultSchema>;
/** One row of `automation-log.ndjson` — the audit trail the log view renders. */
export declare const automationLogRecordSchema: z.ZodObject<{
    seq: z.ZodNumber;
    ts: z.ZodString;
    automationId: z.ZodString;
    revision: z.ZodNumber;
    event: z.ZodOptional<z.ZodEnum<{
        "issue.labeled": "issue.labeled";
        "issue.opened": "issue.opened";
        "issue.unlabeled": "issue.unlabeled";
        "pull_request.opened": "pull_request.opened";
    }>>;
    result: z.ZodEnum<{
        baseline: "baseline";
        duplicate: "duplicate";
        error: "error";
        launched: "launched";
        "no-match": "no-match";
        preview: "preview";
        "rate-limited": "rate-limited";
    }>;
    reason: z.ZodOptional<z.ZodString>;
    durationMs: z.ZodOptional<z.ZodNumber>;
    receiptId: z.ZodOptional<z.ZodString>;
    runId: z.ZodOptional<z.ZodString>;
    githubNumber: z.ZodOptional<z.ZodNumber>;
    githubTitle: z.ZodOptional<z.ZodString>;
    githubUrl: z.ZodOptional<z.ZodString>;
    rateLimit: z.ZodOptional<z.ZodObject<{
        bucket: z.ZodEnum<{
            core: "core";
            search: "search";
        }>;
        remaining: z.ZodOptional<z.ZodNumber>;
        resetAt: z.ZodOptional<z.ZodString>;
    }, z.core.$strip>>;
}, z.core.$strip>;
export type AutomationLogRecord = z.infer<typeof automationLogRecordSchema>;
/** The list view's per-automation tallies, counted over that automation's last 100 log rows. */
export declare const automationCountsSchema: z.ZodObject<{
    matches: z.ZodNumber;
    launched: z.ZodNumber;
    duplicates: z.ZodNumber;
    errors: z.ZodNumber;
}, z.core.$strip>;
export type AutomationCounts = z.infer<typeof automationCountsSchema>;
/** One row of `GET /automations`: the definition plus everything the list renders beside it. */
export declare const automationListEntrySchema: z.ZodObject<{
    id: z.ZodString;
    revision: z.ZodNumber;
    name: z.ZodString;
    description: z.ZodOptional<z.ZodString>;
    enabled: z.ZodBoolean;
    events: z.ZodArray<z.ZodEnum<{
        "issue.labeled": "issue.labeled";
        "issue.opened": "issue.opened";
        "issue.unlabeled": "issue.unlabeled";
        "pull_request.opened": "pull_request.opened";
    }>>;
    intervalSeconds: z.ZodNumber;
    filters: z.ZodObject<{
        authors: z.ZodOptional<z.ZodArray<z.ZodString>>;
        assignees: z.ZodOptional<z.ZodArray<z.ZodString>>;
        allLabels: z.ZodOptional<z.ZodArray<z.ZodString>>;
        anyLabels: z.ZodOptional<z.ZodArray<z.ZodString>>;
        excludeLabels: z.ZodOptional<z.ZodArray<z.ZodString>>;
        changedLabels: z.ZodOptional<z.ZodArray<z.ZodString>>;
        lookbackDays: z.ZodNumber;
        maxRecords: z.ZodNumber;
    }, z.core.$strip>;
    task: z.ZodObject<{
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
        model: z.ZodOptional<z.ZodString>;
        reasoningEffort: z.ZodOptional<z.ZodEnum<{
            auto: "auto";
            high: "high";
            low: "low";
            medium: "medium";
            xhigh: "xhigh";
        }>>;
        runner: z.ZodOptional<z.ZodUnion<readonly [z.ZodEnum<{
            claude: "claude";
            codex: "codex";
            opencode: "opencode";
            pi: "pi";
        }>, z.ZodLiteral<"auto">]>>;
        agentProfile: z.ZodOptional<z.ZodString>;
        worktree: z.ZodOptional<z.ZodBoolean>;
        autonomous: z.ZodOptional<z.ZodBoolean>;
        generateFollowups: z.ZodOptional<z.ZodBoolean>;
        prompt: z.ZodString;
        variants: z.ZodOptional<z.ZodUnion<readonly [z.ZodLiteral<1>, z.ZodLiteral<2>, z.ZodLiteral<3>]>>;
        systemPrompt: z.ZodOptional<z.ZodString>;
    }, z.core.$strip>;
    createdAt: z.ZodString;
    updatedAt: z.ZodString;
    state: z.ZodOptional<z.ZodObject<{
        revision: z.ZodOptional<z.ZodNumber>;
        baselineAt: z.ZodOptional<z.ZodString>;
        cursor: z.ZodOptional<z.ZodObject<{
            timestamp: z.ZodString;
            tieBreaker: z.ZodOptional<z.ZodString>;
        }, z.core.$strip>>;
        frozenHighWatermark: z.ZodOptional<z.ZodObject<{
            timestamp: z.ZodString;
            tieBreaker: z.ZodString;
        }, z.core.$strip>>;
        backlogAfter: z.ZodOptional<z.ZodObject<{
            timestamp: z.ZodString;
            tieBreaker: z.ZodString;
        }, z.core.$strip>>;
        nextCheckAt: z.ZodOptional<z.ZodString>;
        lastSuccessAt: z.ZodOptional<z.ZodString>;
        etags: z.ZodOptional<z.ZodRecord<z.ZodString, z.ZodString>>;
        backoffUntil: z.ZodOptional<z.ZodString>;
        consecutiveFailures: z.ZodOptional<z.ZodNumber>;
    }, z.core.$strip>>;
    latestLog: z.ZodOptional<z.ZodObject<{
        seq: z.ZodNumber;
        ts: z.ZodString;
        automationId: z.ZodString;
        revision: z.ZodNumber;
        event: z.ZodOptional<z.ZodEnum<{
            "issue.labeled": "issue.labeled";
            "issue.opened": "issue.opened";
            "issue.unlabeled": "issue.unlabeled";
            "pull_request.opened": "pull_request.opened";
        }>>;
        result: z.ZodEnum<{
            baseline: "baseline";
            duplicate: "duplicate";
            error: "error";
            launched: "launched";
            "no-match": "no-match";
            preview: "preview";
            "rate-limited": "rate-limited";
        }>;
        reason: z.ZodOptional<z.ZodString>;
        durationMs: z.ZodOptional<z.ZodNumber>;
        receiptId: z.ZodOptional<z.ZodString>;
        runId: z.ZodOptional<z.ZodString>;
        githubNumber: z.ZodOptional<z.ZodNumber>;
        githubTitle: z.ZodOptional<z.ZodString>;
        githubUrl: z.ZodOptional<z.ZodString>;
        rateLimit: z.ZodOptional<z.ZodObject<{
            bucket: z.ZodEnum<{
                core: "core";
                search: "search";
            }>;
            remaining: z.ZodOptional<z.ZodNumber>;
            resetAt: z.ZodOptional<z.ZodString>;
        }, z.core.$strip>>;
    }, z.core.$strip>>;
    counts: z.ZodObject<{
        matches: z.ZodNumber;
        launched: z.ZodNumber;
        duplicates: z.ZodNumber;
        errors: z.ZodNumber;
    }, z.core.$strip>;
}, z.core.$strip>;
export type AutomationListEntry = z.infer<typeof automationListEntrySchema>;
/**
 * `GET /automations` — the whole page in one read.
 *
 * `available`/`reason` are the forge's own cached availability (the same degrade `/github` uses:
 * no GitHub remote, no `gh`, offline — never a 5xx), and `scheduler` summarizes the timer:
 * `scheduled` when any definition is enabled, `idle` otherwise, with `nextDue` the earliest
 * pending check across them.
 */
export declare const automationsResponseSchema: z.ZodObject<{
    available: z.ZodBoolean;
    reason: z.ZodOptional<z.ZodString>;
    scheduler: z.ZodObject<{
        state: z.ZodEnum<{
            idle: "idle";
            scheduled: "scheduled";
        }>;
        nextDue: z.ZodOptional<z.ZodString>;
    }, z.core.$strip>;
    automations: z.ZodArray<z.ZodObject<{
        id: z.ZodString;
        revision: z.ZodNumber;
        name: z.ZodString;
        description: z.ZodOptional<z.ZodString>;
        enabled: z.ZodBoolean;
        events: z.ZodArray<z.ZodEnum<{
            "issue.labeled": "issue.labeled";
            "issue.opened": "issue.opened";
            "issue.unlabeled": "issue.unlabeled";
            "pull_request.opened": "pull_request.opened";
        }>>;
        intervalSeconds: z.ZodNumber;
        filters: z.ZodObject<{
            authors: z.ZodOptional<z.ZodArray<z.ZodString>>;
            assignees: z.ZodOptional<z.ZodArray<z.ZodString>>;
            allLabels: z.ZodOptional<z.ZodArray<z.ZodString>>;
            anyLabels: z.ZodOptional<z.ZodArray<z.ZodString>>;
            excludeLabels: z.ZodOptional<z.ZodArray<z.ZodString>>;
            changedLabels: z.ZodOptional<z.ZodArray<z.ZodString>>;
            lookbackDays: z.ZodNumber;
            maxRecords: z.ZodNumber;
        }, z.core.$strip>;
        task: z.ZodObject<{
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
            model: z.ZodOptional<z.ZodString>;
            reasoningEffort: z.ZodOptional<z.ZodEnum<{
                auto: "auto";
                high: "high";
                low: "low";
                medium: "medium";
                xhigh: "xhigh";
            }>>;
            runner: z.ZodOptional<z.ZodUnion<readonly [z.ZodEnum<{
                claude: "claude";
                codex: "codex";
                opencode: "opencode";
                pi: "pi";
            }>, z.ZodLiteral<"auto">]>>;
            agentProfile: z.ZodOptional<z.ZodString>;
            worktree: z.ZodOptional<z.ZodBoolean>;
            autonomous: z.ZodOptional<z.ZodBoolean>;
            generateFollowups: z.ZodOptional<z.ZodBoolean>;
            prompt: z.ZodString;
            variants: z.ZodOptional<z.ZodUnion<readonly [z.ZodLiteral<1>, z.ZodLiteral<2>, z.ZodLiteral<3>]>>;
            systemPrompt: z.ZodOptional<z.ZodString>;
        }, z.core.$strip>;
        createdAt: z.ZodString;
        updatedAt: z.ZodString;
        state: z.ZodOptional<z.ZodObject<{
            revision: z.ZodOptional<z.ZodNumber>;
            baselineAt: z.ZodOptional<z.ZodString>;
            cursor: z.ZodOptional<z.ZodObject<{
                timestamp: z.ZodString;
                tieBreaker: z.ZodOptional<z.ZodString>;
            }, z.core.$strip>>;
            frozenHighWatermark: z.ZodOptional<z.ZodObject<{
                timestamp: z.ZodString;
                tieBreaker: z.ZodString;
            }, z.core.$strip>>;
            backlogAfter: z.ZodOptional<z.ZodObject<{
                timestamp: z.ZodString;
                tieBreaker: z.ZodString;
            }, z.core.$strip>>;
            nextCheckAt: z.ZodOptional<z.ZodString>;
            lastSuccessAt: z.ZodOptional<z.ZodString>;
            etags: z.ZodOptional<z.ZodRecord<z.ZodString, z.ZodString>>;
            backoffUntil: z.ZodOptional<z.ZodString>;
            consecutiveFailures: z.ZodOptional<z.ZodNumber>;
        }, z.core.$strip>>;
        latestLog: z.ZodOptional<z.ZodObject<{
            seq: z.ZodNumber;
            ts: z.ZodString;
            automationId: z.ZodString;
            revision: z.ZodNumber;
            event: z.ZodOptional<z.ZodEnum<{
                "issue.labeled": "issue.labeled";
                "issue.opened": "issue.opened";
                "issue.unlabeled": "issue.unlabeled";
                "pull_request.opened": "pull_request.opened";
            }>>;
            result: z.ZodEnum<{
                baseline: "baseline";
                duplicate: "duplicate";
                error: "error";
                launched: "launched";
                "no-match": "no-match";
                preview: "preview";
                "rate-limited": "rate-limited";
            }>;
            reason: z.ZodOptional<z.ZodString>;
            durationMs: z.ZodOptional<z.ZodNumber>;
            receiptId: z.ZodOptional<z.ZodString>;
            runId: z.ZodOptional<z.ZodString>;
            githubNumber: z.ZodOptional<z.ZodNumber>;
            githubTitle: z.ZodOptional<z.ZodString>;
            githubUrl: z.ZodOptional<z.ZodString>;
            rateLimit: z.ZodOptional<z.ZodObject<{
                bucket: z.ZodEnum<{
                    core: "core";
                    search: "search";
                }>;
                remaining: z.ZodOptional<z.ZodNumber>;
                resetAt: z.ZodOptional<z.ZodString>;
            }, z.core.$strip>>;
        }, z.core.$strip>>;
        counts: z.ZodObject<{
            matches: z.ZodNumber;
            launched: z.ZodNumber;
            duplicates: z.ZodNumber;
            errors: z.ZodNumber;
        }, z.core.$strip>;
    }, z.core.$strip>>;
}, z.core.$strip>;
export type AutomationsResponse = z.infer<typeof automationsResponseSchema>;
/** `POST /automations` (201), `PUT /automations/:id`, `POST /automations/:id/{enable,pause}`. */
export declare const automationResponseSchema: z.ZodObject<{
    automation: z.ZodObject<{
        id: z.ZodString;
        revision: z.ZodNumber;
        name: z.ZodString;
        description: z.ZodOptional<z.ZodString>;
        enabled: z.ZodBoolean;
        events: z.ZodArray<z.ZodEnum<{
            "issue.labeled": "issue.labeled";
            "issue.opened": "issue.opened";
            "issue.unlabeled": "issue.unlabeled";
            "pull_request.opened": "pull_request.opened";
        }>>;
        intervalSeconds: z.ZodNumber;
        filters: z.ZodObject<{
            authors: z.ZodOptional<z.ZodArray<z.ZodString>>;
            assignees: z.ZodOptional<z.ZodArray<z.ZodString>>;
            allLabels: z.ZodOptional<z.ZodArray<z.ZodString>>;
            anyLabels: z.ZodOptional<z.ZodArray<z.ZodString>>;
            excludeLabels: z.ZodOptional<z.ZodArray<z.ZodString>>;
            changedLabels: z.ZodOptional<z.ZodArray<z.ZodString>>;
            lookbackDays: z.ZodNumber;
            maxRecords: z.ZodNumber;
        }, z.core.$strip>;
        task: z.ZodObject<{
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
            model: z.ZodOptional<z.ZodString>;
            reasoningEffort: z.ZodOptional<z.ZodEnum<{
                auto: "auto";
                high: "high";
                low: "low";
                medium: "medium";
                xhigh: "xhigh";
            }>>;
            runner: z.ZodOptional<z.ZodUnion<readonly [z.ZodEnum<{
                claude: "claude";
                codex: "codex";
                opencode: "opencode";
                pi: "pi";
            }>, z.ZodLiteral<"auto">]>>;
            agentProfile: z.ZodOptional<z.ZodString>;
            worktree: z.ZodOptional<z.ZodBoolean>;
            autonomous: z.ZodOptional<z.ZodBoolean>;
            generateFollowups: z.ZodOptional<z.ZodBoolean>;
            prompt: z.ZodString;
            variants: z.ZodOptional<z.ZodUnion<readonly [z.ZodLiteral<1>, z.ZodLiteral<2>, z.ZodLiteral<3>]>>;
            systemPrompt: z.ZodOptional<z.ZodString>;
        }, z.core.$strip>;
        createdAt: z.ZodString;
        updatedAt: z.ZodString;
    }, z.core.$strip>;
}, z.core.$strip>;
export type AutomationResponse = z.infer<typeof automationResponseSchema>;
/** `GET /automations/:id` — one definition with its state and the most recent log row. */
export declare const automationDetailResponseSchema: z.ZodObject<{
    automation: z.ZodObject<{
        id: z.ZodString;
        revision: z.ZodNumber;
        name: z.ZodString;
        description: z.ZodOptional<z.ZodString>;
        enabled: z.ZodBoolean;
        events: z.ZodArray<z.ZodEnum<{
            "issue.labeled": "issue.labeled";
            "issue.opened": "issue.opened";
            "issue.unlabeled": "issue.unlabeled";
            "pull_request.opened": "pull_request.opened";
        }>>;
        intervalSeconds: z.ZodNumber;
        filters: z.ZodObject<{
            authors: z.ZodOptional<z.ZodArray<z.ZodString>>;
            assignees: z.ZodOptional<z.ZodArray<z.ZodString>>;
            allLabels: z.ZodOptional<z.ZodArray<z.ZodString>>;
            anyLabels: z.ZodOptional<z.ZodArray<z.ZodString>>;
            excludeLabels: z.ZodOptional<z.ZodArray<z.ZodString>>;
            changedLabels: z.ZodOptional<z.ZodArray<z.ZodString>>;
            lookbackDays: z.ZodNumber;
            maxRecords: z.ZodNumber;
        }, z.core.$strip>;
        task: z.ZodObject<{
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
            model: z.ZodOptional<z.ZodString>;
            reasoningEffort: z.ZodOptional<z.ZodEnum<{
                auto: "auto";
                high: "high";
                low: "low";
                medium: "medium";
                xhigh: "xhigh";
            }>>;
            runner: z.ZodOptional<z.ZodUnion<readonly [z.ZodEnum<{
                claude: "claude";
                codex: "codex";
                opencode: "opencode";
                pi: "pi";
            }>, z.ZodLiteral<"auto">]>>;
            agentProfile: z.ZodOptional<z.ZodString>;
            worktree: z.ZodOptional<z.ZodBoolean>;
            autonomous: z.ZodOptional<z.ZodBoolean>;
            generateFollowups: z.ZodOptional<z.ZodBoolean>;
            prompt: z.ZodString;
            variants: z.ZodOptional<z.ZodUnion<readonly [z.ZodLiteral<1>, z.ZodLiteral<2>, z.ZodLiteral<3>]>>;
            systemPrompt: z.ZodOptional<z.ZodString>;
        }, z.core.$strip>;
        createdAt: z.ZodString;
        updatedAt: z.ZodString;
    }, z.core.$strip>;
    state: z.ZodOptional<z.ZodObject<{
        revision: z.ZodOptional<z.ZodNumber>;
        baselineAt: z.ZodOptional<z.ZodString>;
        cursor: z.ZodOptional<z.ZodObject<{
            timestamp: z.ZodString;
            tieBreaker: z.ZodOptional<z.ZodString>;
        }, z.core.$strip>>;
        frozenHighWatermark: z.ZodOptional<z.ZodObject<{
            timestamp: z.ZodString;
            tieBreaker: z.ZodString;
        }, z.core.$strip>>;
        backlogAfter: z.ZodOptional<z.ZodObject<{
            timestamp: z.ZodString;
            tieBreaker: z.ZodString;
        }, z.core.$strip>>;
        nextCheckAt: z.ZodOptional<z.ZodString>;
        lastSuccessAt: z.ZodOptional<z.ZodString>;
        etags: z.ZodOptional<z.ZodRecord<z.ZodString, z.ZodString>>;
        backoffUntil: z.ZodOptional<z.ZodString>;
        consecutiveFailures: z.ZodOptional<z.ZodNumber>;
    }, z.core.$strip>>;
    latestLog: z.ZodOptional<z.ZodObject<{
        seq: z.ZodNumber;
        ts: z.ZodString;
        automationId: z.ZodString;
        revision: z.ZodNumber;
        event: z.ZodOptional<z.ZodEnum<{
            "issue.labeled": "issue.labeled";
            "issue.opened": "issue.opened";
            "issue.unlabeled": "issue.unlabeled";
            "pull_request.opened": "pull_request.opened";
        }>>;
        result: z.ZodEnum<{
            baseline: "baseline";
            duplicate: "duplicate";
            error: "error";
            launched: "launched";
            "no-match": "no-match";
            preview: "preview";
            "rate-limited": "rate-limited";
        }>;
        reason: z.ZodOptional<z.ZodString>;
        durationMs: z.ZodOptional<z.ZodNumber>;
        receiptId: z.ZodOptional<z.ZodString>;
        runId: z.ZodOptional<z.ZodString>;
        githubNumber: z.ZodOptional<z.ZodNumber>;
        githubTitle: z.ZodOptional<z.ZodString>;
        githubUrl: z.ZodOptional<z.ZodString>;
        rateLimit: z.ZodOptional<z.ZodObject<{
            bucket: z.ZodEnum<{
                core: "core";
                search: "search";
            }>;
            remaining: z.ZodOptional<z.ZodNumber>;
            resetAt: z.ZodOptional<z.ZodString>;
        }, z.core.$strip>>;
    }, z.core.$strip>>;
}, z.core.$strip>;
export type AutomationDetailResponse = z.infer<typeof automationDetailResponseSchema>;
/**
 * One manual "test filter" check (`GET /automation-checks/:checkId`).
 *
 * Server-memory only, keyed by an unguessable id and capped at 200 — it is the progress record of
 * an asynchronous poll, not stored state, which is why it survives no restart and appears in no
 * file. `preview` counts matches and launches nothing; `execute` launches exactly as a scheduled
 * poll would.
 */
export declare const automationCheckSchema: z.ZodObject<{
    id: z.ZodString;
    automationId: z.ZodString;
    mode: z.ZodEnum<{
        execute: "execute";
        preview: "preview";
    }>;
    status: z.ZodEnum<{
        complete: "complete";
        error: "error";
        queued: "queued";
        running: "running";
    }>;
    createdAt: z.ZodString;
    completedAt: z.ZodOptional<z.ZodString>;
    matches: z.ZodOptional<z.ZodNumber>;
    truncated: z.ZodOptional<z.ZodBoolean>;
    error: z.ZodOptional<z.ZodString>;
}, z.core.$strip>;
export type AutomationCheck = z.infer<typeof automationCheckSchema>;
/** `POST /automations/:id/check` (202) — the check runs in the background; poll the id. */
export declare const automationCheckQueuedResponseSchema: z.ZodObject<{
    checkId: z.ZodString;
}, z.core.$strip>;
export type AutomationCheckQueuedResponse = z.infer<typeof automationCheckQueuedResponseSchema>;
/** `GET /automation-log` — newest first, capped at 100 rows per read. */
export declare const automationLogResponseSchema: z.ZodObject<{
    records: z.ZodArray<z.ZodObject<{
        seq: z.ZodNumber;
        ts: z.ZodString;
        automationId: z.ZodString;
        revision: z.ZodNumber;
        event: z.ZodOptional<z.ZodEnum<{
            "issue.labeled": "issue.labeled";
            "issue.opened": "issue.opened";
            "issue.unlabeled": "issue.unlabeled";
            "pull_request.opened": "pull_request.opened";
        }>>;
        result: z.ZodEnum<{
            baseline: "baseline";
            duplicate: "duplicate";
            error: "error";
            launched: "launched";
            "no-match": "no-match";
            preview: "preview";
            "rate-limited": "rate-limited";
        }>;
        reason: z.ZodOptional<z.ZodString>;
        durationMs: z.ZodOptional<z.ZodNumber>;
        receiptId: z.ZodOptional<z.ZodString>;
        runId: z.ZodOptional<z.ZodString>;
        githubNumber: z.ZodOptional<z.ZodNumber>;
        githubTitle: z.ZodOptional<z.ZodString>;
        githubUrl: z.ZodOptional<z.ZodString>;
        rateLimit: z.ZodOptional<z.ZodObject<{
            bucket: z.ZodEnum<{
                core: "core";
                search: "search";
            }>;
            remaining: z.ZodOptional<z.ZodNumber>;
            resetAt: z.ZodOptional<z.ZodString>;
        }, z.core.$strip>>;
    }, z.core.$strip>>;
}, z.core.$strip>;
export type AutomationLogResponse = z.infer<typeof automationLogResponseSchema>;
/** `POST /automation-log/:receiptId/retry` (202) — the relaunched receipt and its new run. */
export declare const automationRetryResponseSchema: z.ZodObject<{
    receiptId: z.ZodString;
    runId: z.ZodString;
}, z.core.$strip>;
export type AutomationRetryResponse = z.infer<typeof automationRetryResponseSchema>;
/**
 * `POST /automations`. The definition minus everything the server owns — id, revision, the
 * timestamps and `enabled`, which is not a body field: a definition is always created paused, and
 * `enable: true` asks the route to enable it AND establish a current-time baseline in one step.
 */
export declare const createAutomationInputSchema: z.ZodObject<{
    name: z.ZodString;
    description: z.ZodOptional<z.ZodString>;
    events: z.ZodArray<z.ZodEnum<{
        "issue.labeled": "issue.labeled";
        "issue.opened": "issue.opened";
        "issue.unlabeled": "issue.unlabeled";
        "pull_request.opened": "pull_request.opened";
    }>>;
    intervalSeconds: z.ZodNumber;
    filters: z.ZodObject<{
        authors: z.ZodOptional<z.ZodArray<z.ZodString>>;
        assignees: z.ZodOptional<z.ZodArray<z.ZodString>>;
        allLabels: z.ZodOptional<z.ZodArray<z.ZodString>>;
        anyLabels: z.ZodOptional<z.ZodArray<z.ZodString>>;
        excludeLabels: z.ZodOptional<z.ZodArray<z.ZodString>>;
        changedLabels: z.ZodOptional<z.ZodArray<z.ZodString>>;
        lookbackDays: z.ZodNumber;
        maxRecords: z.ZodNumber;
    }, z.core.$strip>;
    task: z.ZodObject<{
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
        model: z.ZodOptional<z.ZodString>;
        reasoningEffort: z.ZodOptional<z.ZodEnum<{
            auto: "auto";
            high: "high";
            low: "low";
            medium: "medium";
            xhigh: "xhigh";
        }>>;
        runner: z.ZodOptional<z.ZodUnion<readonly [z.ZodEnum<{
            claude: "claude";
            codex: "codex";
            opencode: "opencode";
            pi: "pi";
        }>, z.ZodLiteral<"auto">]>>;
        agentProfile: z.ZodOptional<z.ZodString>;
        worktree: z.ZodOptional<z.ZodBoolean>;
        autonomous: z.ZodOptional<z.ZodBoolean>;
        generateFollowups: z.ZodOptional<z.ZodBoolean>;
        prompt: z.ZodString;
        variants: z.ZodOptional<z.ZodUnion<readonly [z.ZodLiteral<1>, z.ZodLiteral<2>, z.ZodLiteral<3>]>>;
        systemPrompt: z.ZodOptional<z.ZodString>;
    }, z.core.$strip>;
    enable: z.ZodOptional<z.ZodBoolean>;
}, z.core.$strip>;
export type CreateAutomationInput = z.input<typeof createAutomationInputSchema>;
/**
 * `PUT /automations/:id`. The same body plus the revision the editor read — a stale one answers
 * 409 rather than overwriting somebody else's edit. `enabled` IS a field here: an edit may not
 * silently pause a running automation, so the caller restates it.
 */
export declare const updateAutomationInputSchema: z.ZodObject<{
    name: z.ZodString;
    description: z.ZodOptional<z.ZodString>;
    events: z.ZodArray<z.ZodEnum<{
        "issue.labeled": "issue.labeled";
        "issue.opened": "issue.opened";
        "issue.unlabeled": "issue.unlabeled";
        "pull_request.opened": "pull_request.opened";
    }>>;
    intervalSeconds: z.ZodNumber;
    filters: z.ZodObject<{
        authors: z.ZodOptional<z.ZodArray<z.ZodString>>;
        assignees: z.ZodOptional<z.ZodArray<z.ZodString>>;
        allLabels: z.ZodOptional<z.ZodArray<z.ZodString>>;
        anyLabels: z.ZodOptional<z.ZodArray<z.ZodString>>;
        excludeLabels: z.ZodOptional<z.ZodArray<z.ZodString>>;
        changedLabels: z.ZodOptional<z.ZodArray<z.ZodString>>;
        lookbackDays: z.ZodNumber;
        maxRecords: z.ZodNumber;
    }, z.core.$strip>;
    task: z.ZodObject<{
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
        model: z.ZodOptional<z.ZodString>;
        reasoningEffort: z.ZodOptional<z.ZodEnum<{
            auto: "auto";
            high: "high";
            low: "low";
            medium: "medium";
            xhigh: "xhigh";
        }>>;
        runner: z.ZodOptional<z.ZodUnion<readonly [z.ZodEnum<{
            claude: "claude";
            codex: "codex";
            opencode: "opencode";
            pi: "pi";
        }>, z.ZodLiteral<"auto">]>>;
        agentProfile: z.ZodOptional<z.ZodString>;
        worktree: z.ZodOptional<z.ZodBoolean>;
        autonomous: z.ZodOptional<z.ZodBoolean>;
        generateFollowups: z.ZodOptional<z.ZodBoolean>;
        prompt: z.ZodString;
        variants: z.ZodOptional<z.ZodUnion<readonly [z.ZodLiteral<1>, z.ZodLiteral<2>, z.ZodLiteral<3>]>>;
        systemPrompt: z.ZodOptional<z.ZodString>;
    }, z.core.$strip>;
    enabled: z.ZodOptional<z.ZodBoolean>;
    expectedRevision: z.ZodNumber;
}, z.core.$strip>;
export type UpdateAutomationInput = z.input<typeof updateAutomationInputSchema>;
/** `POST /automations/:id/check` — which of the two manual checks to run. */
export declare const automationCheckInputSchema: z.ZodObject<{
    mode: z.ZodEnum<{
        execute: "execute";
        preview: "preview";
    }>;
}, z.core.$strip>;
export type AutomationCheckInput = z.input<typeof automationCheckInputSchema>;
