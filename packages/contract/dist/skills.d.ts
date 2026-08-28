import { z } from 'zod';
/**
 * One discovered skill: repo (`.ai/skills`, `.ai/cezar/skills`), `npx skills` install dirs
 * (project + global), or a configured team skills repo (spec 005).
 */
export declare const skillSchema: z.ZodObject<{
    name: z.ZodString;
    description: z.ZodOptional<z.ZodString>;
    interactive: z.ZodOptional<z.ZodLiteral<true>>;
    body: z.ZodString;
    path: z.ZodString;
    source: z.ZodEnum<{
        agents: "agents";
        ai: "ai";
        cezar: "cezar";
        global: "global";
        team: "team";
    }>;
    team: z.ZodOptional<z.ZodObject<{
        repo: z.ZodString;
        ref: z.ZodString;
        path: z.ZodString;
        dir: z.ZodBoolean;
        commit: z.ZodOptional<z.ZodString>;
    }, z.core.$strip>>;
}, z.core.$strip>;
export type Skill = z.infer<typeof skillSchema>;
/**
 * One row in the "Manage skills" panel — a skill a default (vendor) repo offers, from
 * `GET /skills/importable`, independent of whether it is currently kept.
 *
 * `description` is optional because that is what the WIRE says: the handler builds
 * `{ name, description: skill.description }` and `JSON.stringify` omits an undefined value, so
 * a description-less skill is serialized as `{ "name": "…" }`. The route's own type disagrees
 * (it claims the key is always present) — a handler defect, see
 * `contract-parity.workflows.test.ts`.
 */
export declare const importableSkillSchema: z.ZodObject<{
    name: z.ZodString;
    description: z.ZodOptional<z.ZodString>;
}, z.core.$strip>;
export type ImportableSkill = z.infer<typeof importableSkillSchema>;
/** One entry of `.ai/cezar/todos.json`, as `GET /todos` serves it (ids are backfilled on read). */
export declare const todoItemSchema: z.ZodObject<{
    id: z.ZodString;
    ts: z.ZodOptional<z.ZodString>;
    taskId: z.ZodOptional<z.ZodString>;
    summary: z.ZodString;
    action: z.ZodOptional<z.ZodString>;
    prUrl: z.ZodOptional<z.ZodString>;
    suggestedSkill: z.ZodOptional<z.ZodString>;
    suggestedArgs: z.ZodOptional<z.ZodString>;
    suggestedPrompt: z.ZodOptional<z.ZodString>;
    runnable: z.ZodOptional<z.ZodBoolean>;
    startedTaskId: z.ZodOptional<z.ZodString>;
}, z.core.$strip>;
export type TodoItem = z.infer<typeof todoItemSchema>;
/**
 * `DELETE /todos/:id` — Dismiss checks the entry off.
 *
 * `removed` is the LITERAL `true`: a miss is a 404 `{ error }`, never `{ removed: false }`.
 * The hand-written DTO said `boolean`, which was wider than the route.
 */
export declare const removeTodoResponseSchema: z.ZodObject<{
    removed: z.ZodLiteral<true>;
}, z.core.$strip>;
export type RemoveTodoResponse = z.infer<typeof removeTodoResponseSchema>;
/** `POST /todos/:id/start` — 201 with the run the entry became. */
export declare const startTodoResponseSchema: z.ZodObject<{
    run: z.ZodObject<{
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
}, z.core.$strip>;
export type StartTodoResponse = z.infer<typeof startTodoResponseSchema>;
