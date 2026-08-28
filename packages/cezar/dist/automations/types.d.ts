import { z } from 'zod';
export declare const automationEventSchema: z.ZodEnum<{
    "issue.labeled": "issue.labeled";
    "issue.opened": "issue.opened";
    "issue.unlabeled": "issue.unlabeled";
    "pull_request.opened": "pull_request.opened";
}>;
export declare const automationFiltersSchema: z.ZodObject<{
    authors: z.ZodOptional<z.ZodArray<z.ZodString>>;
    assignees: z.ZodOptional<z.ZodArray<z.ZodString>>;
    allLabels: z.ZodOptional<z.ZodArray<z.ZodString>>;
    anyLabels: z.ZodOptional<z.ZodArray<z.ZodString>>;
    excludeLabels: z.ZodOptional<z.ZodArray<z.ZodString>>;
    changedLabels: z.ZodOptional<z.ZodArray<z.ZodString>>;
    lookbackDays: z.ZodDefault<z.ZodNumber>;
    maxRecords: z.ZodDefault<z.ZodNumber>;
}, z.core.$loose>;
export declare const automationTaskSchema: z.ZodObject<{
    prompt: z.ZodString;
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
    runner: z.ZodOptional<z.ZodUnion<readonly [z.ZodEnum<{
        claude: "claude";
        codex: "codex";
        opencode: "opencode";
        pi: "pi";
    }>, z.ZodLiteral<"auto">]>>;
    model: z.ZodOptional<z.ZodString>;
    variants: z.ZodOptional<z.ZodUnion<readonly [z.ZodLiteral<1>, z.ZodLiteral<2>, z.ZodLiteral<3>]>>;
    worktree: z.ZodOptional<z.ZodBoolean>;
    generateFollowups: z.ZodOptional<z.ZodBoolean>;
    autonomous: z.ZodOptional<z.ZodBoolean>;
    systemPrompt: z.ZodOptional<z.ZodString>;
}, z.core.$loose>;
export declare const automationDefinitionSchema: z.ZodObject<{
    id: z.ZodString;
    revision: z.ZodNumber;
    name: z.ZodString;
    description: z.ZodOptional<z.ZodString>;
    enabled: z.ZodDefault<z.ZodBoolean>;
    events: z.ZodArray<z.ZodEnum<{
        "issue.labeled": "issue.labeled";
        "issue.opened": "issue.opened";
        "issue.unlabeled": "issue.unlabeled";
        "pull_request.opened": "pull_request.opened";
    }>>;
    intervalSeconds: z.ZodDefault<z.ZodNumber>;
    filters: z.ZodObject<{
        authors: z.ZodOptional<z.ZodArray<z.ZodString>>;
        assignees: z.ZodOptional<z.ZodArray<z.ZodString>>;
        allLabels: z.ZodOptional<z.ZodArray<z.ZodString>>;
        anyLabels: z.ZodOptional<z.ZodArray<z.ZodString>>;
        excludeLabels: z.ZodOptional<z.ZodArray<z.ZodString>>;
        changedLabels: z.ZodOptional<z.ZodArray<z.ZodString>>;
        lookbackDays: z.ZodDefault<z.ZodNumber>;
        maxRecords: z.ZodDefault<z.ZodNumber>;
    }, z.core.$loose>;
    task: z.ZodObject<{
        prompt: z.ZodString;
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
        runner: z.ZodOptional<z.ZodUnion<readonly [z.ZodEnum<{
            claude: "claude";
            codex: "codex";
            opencode: "opencode";
            pi: "pi";
        }>, z.ZodLiteral<"auto">]>>;
        model: z.ZodOptional<z.ZodString>;
        variants: z.ZodOptional<z.ZodUnion<readonly [z.ZodLiteral<1>, z.ZodLiteral<2>, z.ZodLiteral<3>]>>;
        worktree: z.ZodOptional<z.ZodBoolean>;
        generateFollowups: z.ZodOptional<z.ZodBoolean>;
        autonomous: z.ZodOptional<z.ZodBoolean>;
        systemPrompt: z.ZodOptional<z.ZodString>;
    }, z.core.$loose>;
    createdAt: z.ZodString;
    updatedAt: z.ZodString;
}, z.core.$loose>;
export declare const automationDefinitionsFileSchema: z.ZodObject<{
    version: z.ZodDefault<z.ZodLiteral<1>>;
    automations: z.ZodDefault<z.ZodArray<z.ZodUnknown>>;
    tombstones: z.ZodOptional<z.ZodRecord<z.ZodString, z.ZodString>>;
}, z.core.$loose>;
export declare const automationCursorSchema: z.ZodObject<{
    timestamp: z.ZodString;
    tieBreaker: z.ZodOptional<z.ZodString>;
}, z.core.$loose>;
export declare const automationRuntimeStateSchema: z.ZodObject<{
    revision: z.ZodOptional<z.ZodNumber>;
    baselineAt: z.ZodOptional<z.ZodString>;
    cursor: z.ZodOptional<z.ZodObject<{
        timestamp: z.ZodString;
        tieBreaker: z.ZodOptional<z.ZodString>;
    }, z.core.$loose>>;
    frozenHighWatermark: z.ZodOptional<z.ZodObject<{
        timestamp: z.ZodString;
        tieBreaker: z.ZodString;
    }, z.core.$loose>>;
    backlogAfter: z.ZodOptional<z.ZodObject<{
        timestamp: z.ZodString;
        tieBreaker: z.ZodString;
    }, z.core.$loose>>;
    nextCheckAt: z.ZodOptional<z.ZodString>;
    lastSuccessAt: z.ZodOptional<z.ZodString>;
    etags: z.ZodOptional<z.ZodRecord<z.ZodString, z.ZodString>>;
    backoffUntil: z.ZodOptional<z.ZodString>;
    consecutiveFailures: z.ZodOptional<z.ZodNumber>;
}, z.core.$loose>;
export declare const automationStateFileSchema: z.ZodObject<{
    version: z.ZodDefault<z.ZodLiteral<1>>;
    states: z.ZodDefault<z.ZodRecord<z.ZodString, z.ZodObject<{
        revision: z.ZodOptional<z.ZodNumber>;
        baselineAt: z.ZodOptional<z.ZodString>;
        cursor: z.ZodOptional<z.ZodObject<{
            timestamp: z.ZodString;
            tieBreaker: z.ZodOptional<z.ZodString>;
        }, z.core.$loose>>;
        frozenHighWatermark: z.ZodOptional<z.ZodObject<{
            timestamp: z.ZodString;
            tieBreaker: z.ZodString;
        }, z.core.$loose>>;
        backlogAfter: z.ZodOptional<z.ZodObject<{
            timestamp: z.ZodString;
            tieBreaker: z.ZodString;
        }, z.core.$loose>>;
        nextCheckAt: z.ZodOptional<z.ZodString>;
        lastSuccessAt: z.ZodOptional<z.ZodString>;
        etags: z.ZodOptional<z.ZodRecord<z.ZodString, z.ZodString>>;
        backoffUntil: z.ZodOptional<z.ZodString>;
        consecutiveFailures: z.ZodOptional<z.ZodNumber>;
    }, z.core.$loose>>>;
}, z.core.$loose>;
export declare const automationReceiptSchema: z.ZodObject<{
    receiptId: z.ZodString;
    receiptKey: z.ZodString;
    eventId: z.ZodString;
    automationId: z.ZodString;
    revision: z.ZodNumber;
    status: z.ZodEnum<{
        "launch-error": "launch-error";
        launched: "launched";
        reserved: "reserved";
    }>;
    runId: z.ZodOptional<z.ZodString>;
    observedAt: z.ZodString;
    updatedAt: z.ZodString;
    error: z.ZodOptional<z.ZodString>;
    candidate: z.ZodOptional<z.ZodObject<{
        eventId: z.ZodString;
        event: z.ZodEnum<{
            "issue.labeled": "issue.labeled";
            "issue.opened": "issue.opened";
            "issue.unlabeled": "issue.unlabeled";
            "pull_request.opened": "pull_request.opened";
        }>;
        timestamp: z.ZodString;
        tieBreaker: z.ZodString;
        repo: z.ZodString;
        nodeId: z.ZodString;
        number: z.ZodNumber;
        title: z.ZodString;
        url: z.ZodString;
        author: z.ZodString;
        assignees: z.ZodArray<z.ZodString>;
        labels: z.ZodArray<z.ZodString>;
        changedLabel: z.ZodOptional<z.ZodString>;
    }, z.core.$loose>>;
}, z.core.$loose>;
export declare const automationLogResultSchema: z.ZodEnum<{
    baseline: "baseline";
    duplicate: "duplicate";
    error: "error";
    launched: "launched";
    "no-match": "no-match";
    preview: "preview";
    "rate-limited": "rate-limited";
}>;
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
    }, z.core.$loose>>;
}, z.core.$loose>;
export type AutomationEvent = z.infer<typeof automationEventSchema>;
export type AutomationDefinition = z.infer<typeof automationDefinitionSchema>;
export type AutomationRuntimeState = z.infer<typeof automationRuntimeStateSchema>;
export type AutomationReceipt = z.infer<typeof automationReceiptSchema>;
export type AutomationLogRecord = z.infer<typeof automationLogRecordSchema>;
