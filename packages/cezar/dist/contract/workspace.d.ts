import { z } from 'zod';
import { type Runner } from './health.ts';
/**
 * The workspace + settings families: `~/.cezar/config.json`'s settings slice, both GUI-pref bags
 * (per-repo and workspace), the per-repo agent knobs, provider auth status, the host model
 * catalog, the skills-update state, and the "Open in…" targets.
 *
 * Node-free by construction (see README rule 1) — `zod` and the sibling contract modules only.
 */
/**
 * `GET/PUT /api/v1/workspace/config` — the settings slice of `~/.cezar/config.json` (step 2.7).
 *
 * Global knobs only: the registry itself is `GET /api/v1/projects`, and `schemaVersion` (a
 * migration cursor, not a setting) is deliberately absent. `resources` is the workspace's
 * host-protection budget — the ONLY effective `maxParallel`/`memoryLimitMb` since Phase 2;
 * `worktreeRetentionDefault` seeds projects that set none.
 *
 * `composerDefaults` and every `resources` key are REQUIRED: `workspaceConfigBody`
 * (src/server/server.ts:1888) materializes all of them from schema defaults on every answer,
 * including the degraded path. The hand-written DTO declared `composerDefaults`,
 * `resources.maxMonitoringSessions` and `resources.monitoringWakeIntervalMinutes` optional, which
 * was wider than the server has ever been.
 */
export declare const workspaceConfigResponseSchema: z.ZodObject<{
    browseRoot: z.ZodString;
    projectsDir: z.ZodString;
    skillsAutoUpdate: z.ZodNullable<z.ZodBoolean>;
    effectiveSkillsAutoUpdate: z.ZodBoolean;
    composerDefaults: z.ZodObject<{
        autonomous: z.ZodNullable<z.ZodBoolean>;
        worktree: z.ZodNullable<z.ZodBoolean>;
        inheritedAutonomous: z.ZodUnion<readonly [z.ZodBoolean, z.ZodLiteral<"source-dependent">]>;
        inheritedWorktree: z.ZodBoolean;
    }, z.core.$strip>;
    resources: z.ZodObject<{
        maxParallel: z.ZodNumber;
        maxMonitoringSessions: z.ZodNumber;
        monitoringWakeIntervalMinutes: z.ZodNullable<z.ZodNumber>;
        autoResumeOnUsageLimit: z.ZodBoolean;
        intelligentContextRefresh: z.ZodBoolean;
        memoryLimitMb: z.ZodNullable<z.ZodNumber>;
        worktreeRetentionDefault: z.ZodNumber;
    }, z.core.$strip>;
    quotaRouting: z.ZodOptional<z.ZodObject<{
        enabled: z.ZodLiteral<true>;
        providerOrder: z.ZodTuple<[z.ZodEnum<{
            claude: "claude";
            codex: "codex";
        }>, z.ZodEnum<{
            claude: "claude";
            codex: "codex";
        }>], null>;
        unknownUsagePolicy: z.ZodEnum<{
            allow: "allow";
            deny: "deny";
        }>;
    }, z.core.$strip>>;
    agentDefaults: z.ZodObject<{
        runner: z.ZodOptional<z.ZodUnion<readonly [z.ZodEnum<{
            claude: "claude";
            codex: "codex";
            opencode: "opencode";
            pi: "pi";
        }>, z.ZodLiteral<"auto">]>>;
        models: z.ZodOptional<z.ZodObject<{
            claude: z.ZodOptional<z.ZodString>;
            codex: z.ZodOptional<z.ZodString>;
            opencode: z.ZodOptional<z.ZodString>;
            pi: z.ZodOptional<z.ZodString>;
        }, z.core.$strip>>;
    }, z.core.$strip>;
}, z.core.$strip>;
export type WorkspaceConfigResponse = z.infer<typeof workspaceConfigResponseSchema>;
/**
 * `PUT /api/v1/workspace/config` body — partial: absent keys stay untouched. A rejected workspace
 * root (not writable) 400s with the reason and persists NOTHING, resources included, so callers
 * may send both in one request only if they want that atomicity. Bounds mirror
 * `src/workspace/config.ts` exactly, so a value this schema accepts can never be degraded away by
 * the next load's `.catch`.
 */
export declare const setWorkspaceConfigInputSchema: z.ZodObject<{
    browseRoot: z.ZodOptional<z.ZodString>;
    projectsDir: z.ZodOptional<z.ZodString>;
    skillsAutoUpdate: z.ZodOptional<z.ZodNullable<z.ZodBoolean>>;
    composerDefaults: z.ZodOptional<z.ZodObject<{
        autonomous: z.ZodOptional<z.ZodNullable<z.ZodBoolean>>;
        worktree: z.ZodOptional<z.ZodNullable<z.ZodBoolean>>;
    }, z.core.$strip>>;
    agentDefaults: z.ZodOptional<z.ZodObject<{
        runner: z.ZodOptional<z.ZodNullable<z.ZodUnion<readonly [z.ZodEnum<{
            claude: "claude";
            codex: "codex";
            opencode: "opencode";
            pi: "pi";
        }>, z.ZodLiteral<"auto">]>>>;
        models: z.ZodOptional<z.ZodObject<{
            claude: z.ZodOptional<z.ZodNullable<z.ZodString>>;
            codex: z.ZodOptional<z.ZodNullable<z.ZodString>>;
            opencode: z.ZodOptional<z.ZodNullable<z.ZodString>>;
            pi: z.ZodOptional<z.ZodNullable<z.ZodString>>;
        }, z.core.$strip>>;
    }, z.core.$strip>>;
    quotaRouting: z.ZodOptional<z.ZodObject<{
        enabled: z.ZodOptional<z.ZodBoolean>;
    }, z.core.$strip>>;
    resources: z.ZodOptional<z.ZodObject<{
        maxParallel: z.ZodOptional<z.ZodNumber>;
        maxMonitoringSessions: z.ZodOptional<z.ZodNumber>;
        monitoringWakeIntervalMinutes: z.ZodOptional<z.ZodNullable<z.ZodNumber>>;
        autoResumeOnUsageLimit: z.ZodOptional<z.ZodBoolean>;
        intelligentContextRefresh: z.ZodOptional<z.ZodBoolean>;
        memoryLimitMb: z.ZodOptional<z.ZodNullable<z.ZodNumber>>;
        worktreeRetentionDefault: z.ZodOptional<z.ZodNumber>;
    }, z.core.$strip>>;
}, z.core.$strip>;
export type SetWorkspaceConfigInput = z.infer<typeof setWorkspaceConfigInputSchema>;
/** Sanitized provider quota telemetry; credentials and raw adapter payloads never cross HTTP. */
export declare const providerUsageSnapshotSchema: z.ZodObject<{
    provider: z.ZodEnum<{
        claude: "claude";
        codex: "codex";
    }>;
    profileId: z.ZodString;
    health: z.ZodEnum<{
        auth_error: "auth_error";
        available: "available";
        hard_exhausted: "hard_exhausted";
        soft_exhausted: "soft_exhausted";
        unavailable: "unavailable";
        unknown: "unknown";
    }>;
    fetchedAt: z.ZodString;
    source: z.ZodString;
    stale: z.ZodBoolean;
    windows: z.ZodArray<z.ZodObject<{
        kind: z.ZodEnum<{
            long: "long";
            model: "model";
            short: "short";
            unknown: "unknown";
        }>;
        usedPercent: z.ZodNullable<z.ZodNumber>;
        resetsAt: z.ZodOptional<z.ZodString>;
        hardLimitReached: z.ZodOptional<z.ZodBoolean>;
    }, z.core.$strip>>;
    error: z.ZodOptional<z.ZodObject<{
        code: z.ZodString;
        message: z.ZodString;
    }, z.core.$strip>>;
}, z.core.$strip>;
export declare const workspaceUsageResponseSchema: z.ZodObject<{
    providers: z.ZodArray<z.ZodObject<{
        provider: z.ZodEnum<{
            claude: "claude";
            codex: "codex";
        }>;
        profileId: z.ZodString;
        health: z.ZodEnum<{
            auth_error: "auth_error";
            available: "available";
            hard_exhausted: "hard_exhausted";
            soft_exhausted: "soft_exhausted";
            unavailable: "unavailable";
            unknown: "unknown";
        }>;
        fetchedAt: z.ZodString;
        source: z.ZodString;
        stale: z.ZodBoolean;
        windows: z.ZodArray<z.ZodObject<{
            kind: z.ZodEnum<{
                long: "long";
                model: "model";
                short: "short";
                unknown: "unknown";
            }>;
            usedPercent: z.ZodNullable<z.ZodNumber>;
            resetsAt: z.ZodOptional<z.ZodString>;
            hardLimitReached: z.ZodOptional<z.ZodBoolean>;
        }, z.core.$strip>>;
        error: z.ZodOptional<z.ZodObject<{
            code: z.ZodString;
            message: z.ZodString;
        }, z.core.$strip>>;
    }, z.core.$strip>>;
}, z.core.$strip>;
export type WorkspaceUsageResponse = z.infer<typeof workspaceUsageResponseSchema>;
/** The composer source: a named workflow/skill, or the plain-task baseline. */
export declare const taskSourceSchema: z.ZodUnion<readonly [z.ZodObject<{
    source: z.ZodLiteral<"baseline">;
}, z.core.$strip>, z.ZodObject<{
    source: z.ZodEnum<{
        skill: "skill";
        workflow: "workflow";
    }>;
    ref: z.ZodString;
}, z.core.$strip>]>;
/**
 * `GET/PUT /api/v1/ui-state` — the per-repo GUI prefs in `.ai/cezar/ui-state.json`.
 *
 * An OPEN bag on purpose (BACKWARD_COMPATIBILITY.md §3): unknown keys round-trip untouched, so a
 * newer cockpit's prefs survive an older server and a future pref needs no server change. Hence
 * `z.looseObject`, not a closed object — the keys below are the ones the server's schema *names*,
 * never the ones it *permits*. The write side caps the TOP-LEVEL key count at 200 (#429); that cap
 * is a request-body refinement in `src/server/server.ts` (`capUiStateKeys`, :756) and is not part
 * of the response shape.
 *
 * `notifications` is deliberately NOT here: it moved to `WorkspaceUiState` at step 3.5 and the
 * per-repo schema (src/server/server.ts:550) has not named it since. The hand-written DTO still
 * listed it, which made it wider than the route.
 */
export declare const uiStateSchema: z.ZodObject<{
    lastTask: z.ZodOptional<z.ZodUnion<readonly [z.ZodObject<{
        source: z.ZodLiteral<"baseline">;
    }, z.core.$strip>, z.ZodObject<{
        source: z.ZodEnum<{
            skill: "skill";
            workflow: "workflow";
        }>;
        ref: z.ZodString;
    }, z.core.$strip>]>>;
    recentSources: z.ZodOptional<z.ZodArray<z.ZodUnion<readonly [z.ZodObject<{
        source: z.ZodLiteral<"baseline">;
    }, z.core.$strip>, z.ZodObject<{
        source: z.ZodEnum<{
            skill: "skill";
            workflow: "workflow";
        }>;
        ref: z.ZodString;
    }, z.core.$strip>]>>>;
    lastWorktree: z.ZodOptional<z.ZodBoolean>;
    lastAutonomous: z.ZodOptional<z.ZodBoolean>;
    lastGenerateFollowups: z.ZodOptional<z.ZodBoolean>;
    skillUsage: z.ZodOptional<z.ZodRecord<z.ZodString, z.ZodNumber>>;
    runsView: z.ZodOptional<z.ZodEnum<{
        list: "list";
        table: "table";
    }>>;
    githubView: z.ZodOptional<z.ZodEnum<{
        issues: "issues";
        prs: "prs";
    }>>;
    appearance: z.ZodOptional<z.ZodObject<{
        accent: z.ZodOptional<z.ZodEnum<{
            lime: "lime";
            violet: "violet";
        }>>;
        density: z.ZodOptional<z.ZodEnum<{
            comfortable: "comfortable";
            compact: "compact";
            ultra: "ultra";
        }>>;
        width: z.ZodOptional<z.ZodEnum<{
            narrow: "narrow";
            wide: "wide";
        }>>;
    }, z.core.$strip>>;
    promptTemplates: z.ZodOptional<z.ZodArray<z.ZodObject<{
        id: z.ZodString;
        label: z.ZodString;
        text: z.ZodString;
        skills: z.ZodOptional<z.ZodArray<z.ZodString>>;
    }, z.core.$strip>>>;
    dismissedSkillsBanner: z.ZodOptional<z.ZodBoolean>;
}, z.core.$loose>;
export type UiState = z.infer<typeof uiStateSchema>;
/**
 * `GET/PUT /api/v1/workspace/ui-state` — cross-project GUI prefs in `~/.cezar/ui-state.json`
 * (multi-project spec, step 2.7).
 *
 * The same open bag as its per-repo twin above, and open for the same reason. The PUT merges
 * SHALLOWLY at the top level server-side, so a writer must send the whole `sidebar` object (or the
 * whole `importedSkills` array), never a leaf.
 */
export declare const workspaceLastLocationSchema: z.ZodObject<{
    projectId: z.ZodString;
    pathname: z.ZodString;
    search: z.ZodOptional<z.ZodString>;
    hash: z.ZodOptional<z.ZodString>;
}, z.core.$strict>;
export type WorkspaceLastLocation = z.infer<typeof workspaceLastLocationSchema>;
export declare const workspaceUiStateSchema: z.ZodObject<{
    sidebar: z.ZodOptional<z.ZodObject<{
        collapsed: z.ZodOptional<z.ZodRecord<z.ZodString, z.ZodBoolean>>;
    }, z.core.$loose>>;
    dismissedProviderAuthFailures: z.ZodOptional<z.ZodObject<{
        claude: z.ZodOptional<z.ZodString>;
        codex: z.ZodOptional<z.ZodString>;
        opencode: z.ZodOptional<z.ZodString>;
        pi: z.ZodOptional<z.ZodString>;
    }, z.core.$strip>>;
    appearance: z.ZodOptional<z.ZodObject<{
        accent: z.ZodOptional<z.ZodEnum<{
            lime: "lime";
            violet: "violet";
        }>>;
        density: z.ZodOptional<z.ZodEnum<{
            comfortable: "comfortable";
            compact: "compact";
            ultra: "ultra";
        }>>;
        width: z.ZodOptional<z.ZodEnum<{
            narrow: "narrow";
            wide: "wide";
        }>>;
    }, z.core.$strip>>;
    notifications: z.ZodOptional<z.ZodObject<{
        enabled: z.ZodOptional<z.ZodBoolean>;
    }, z.core.$loose>>;
    taskTable: z.ZodOptional<z.ZodObject<{
        expandedColumns: z.ZodOptional<z.ZodRecord<z.ZodString, z.ZodBoolean>>;
    }, z.core.$loose>>;
    lastLocation: z.ZodOptional<z.ZodObject<{
        projectId: z.ZodString;
        pathname: z.ZodString;
        search: z.ZodOptional<z.ZodString>;
        hash: z.ZodOptional<z.ZodString>;
    }, z.core.$strict>>;
    importedSkills: z.ZodOptional<z.ZodArray<z.ZodString>>;
}, z.core.$loose>;
export type WorkspaceUiState = z.infer<typeof workspaceUiStateSchema>;
/**
 * `PUT /api/v1/workspace/ui-state` body. The response remains an open, tolerant bag so data from
 * a newer cockpit survives an older server; this write-side schema adds bounded known fields so
 * the current cockpit cannot grow the user-owned file without limit.
 */
export declare const setWorkspaceUiStateInputSchema: z.ZodObject<{
    appearance: z.ZodOptional<z.ZodObject<{
        accent: z.ZodOptional<z.ZodEnum<{
            lime: "lime";
            violet: "violet";
        }>>;
        density: z.ZodOptional<z.ZodEnum<{
            comfortable: "comfortable";
            compact: "compact";
            ultra: "ultra";
        }>>;
        width: z.ZodOptional<z.ZodEnum<{
            narrow: "narrow";
            wide: "wide";
        }>>;
    }, z.core.$strip>>;
    notifications: z.ZodOptional<z.ZodObject<{
        enabled: z.ZodOptional<z.ZodBoolean>;
    }, z.core.$loose>>;
    lastLocation: z.ZodOptional<z.ZodObject<{
        projectId: z.ZodString;
        pathname: z.ZodString;
        search: z.ZodOptional<z.ZodString>;
        hash: z.ZodOptional<z.ZodString>;
    }, z.core.$strict>>;
    sidebar: z.ZodOptional<z.ZodObject<{
        collapsed: z.ZodOptional<z.ZodRecord<z.ZodString, z.ZodBoolean>>;
    }, z.core.$loose>>;
    dismissedProviderAuthFailures: z.ZodOptional<z.ZodObject<{
        claude: z.ZodOptional<z.ZodString>;
        codex: z.ZodOptional<z.ZodString>;
        opencode: z.ZodOptional<z.ZodString>;
        pi: z.ZodOptional<z.ZodString>;
    }, z.core.$strict>>;
    importedSkills: z.ZodOptional<z.ZodArray<z.ZodString>>;
    taskTable: z.ZodOptional<z.ZodObject<{
        expandedColumns: z.ZodOptional<z.ZodRecord<z.ZodString, z.ZodBoolean>>;
    }, z.core.$loose>>;
}, z.core.$loose>;
export type SetWorkspaceUiStateInput = z.infer<typeof setWorkspaceUiStateInputSchema>;
/** Per-runner default model preset (Settings → Agents): the composer preselects this model id for
 *  the runner. Absent = auto (the runner decides). Keyed by runner name rather than derived from
 *  `runnerSchema` because the server's own `defaultModels` object (src/config.ts:92) is spelled
 *  the same way — one key per runner, each independently optional. */
export declare const runnerModelsSchema: z.ZodObject<{
    claude: z.ZodOptional<z.ZodString>;
    codex: z.ZodOptional<z.ZodString>;
    opencode: z.ZodOptional<z.ZodString>;
    pi: z.ZodOptional<z.ZodString>;
}, z.core.$strip>;
export type RunnerModels = z.infer<typeof runnerModelsSchema>;
/** `GET /api/v1/config` — every Settings → Agents knob in one read. */
export declare const configResponseSchema: z.ZodObject<{
    baseBranch: z.ZodNullable<z.ZodString>;
    defaultRunner: z.ZodUnion<readonly [z.ZodEnum<{
        claude: "claude";
        codex: "codex";
        opencode: "opencode";
        pi: "pi";
    }>, z.ZodLiteral<"auto">]>;
    systemPrompt: z.ZodNullable<z.ZodString>;
    defaultModels: z.ZodObject<{
        claude: z.ZodOptional<z.ZodString>;
        codex: z.ZodOptional<z.ZodString>;
        opencode: z.ZodOptional<z.ZodString>;
        pi: z.ZodOptional<z.ZodString>;
    }, z.core.$strip>;
    modelsLocked: z.ZodBoolean;
    maxParallel: z.ZodNumber;
    memoryLimitMb: z.ZodNullable<z.ZodNumber>;
    worktreeRetention: z.ZodNumber;
    liveTitleUpdates: z.ZodNullable<z.ZodBoolean>;
    reviewGate: z.ZodNullable<z.ZodBoolean>;
}, z.core.$strip>;
export type ConfigResponse = z.infer<typeof configResponseSchema>;
/** The `PUT /api/v1/config` answer: the same shape GET serves (`configAnswer` builds both). */
export declare const setConfigResponseSchema: z.ZodObject<{
    baseBranch: z.ZodNullable<z.ZodString>;
    defaultRunner: z.ZodUnion<readonly [z.ZodEnum<{
        claude: "claude";
        codex: "codex";
        opencode: "opencode";
        pi: "pi";
    }>, z.ZodLiteral<"auto">]>;
    systemPrompt: z.ZodNullable<z.ZodString>;
    defaultModels: z.ZodObject<{
        claude: z.ZodOptional<z.ZodString>;
        codex: z.ZodOptional<z.ZodString>;
        opencode: z.ZodOptional<z.ZodString>;
        pi: z.ZodOptional<z.ZodString>;
    }, z.core.$strip>;
    modelsLocked: z.ZodBoolean;
    maxParallel: z.ZodNumber;
    memoryLimitMb: z.ZodNullable<z.ZodNumber>;
    worktreeRetention: z.ZodNumber;
    liveTitleUpdates: z.ZodNullable<z.ZodBoolean>;
    reviewGate: z.ZodNullable<z.ZodBoolean>;
}, z.core.$strip>;
export type SetConfigResponse = z.infer<typeof setConfigResponseSchema>;
/**
 * `PUT /api/v1/config` body (Settings → Agents; the Repo tab's base-branch picker).
 * `baseBranch: null` clears the setting back to "follow checked-out branch"; `systemPrompt` and
 * per-runner `defaultModels` entries clear on `null` (or `''`) too. Merged into the raw
 * config.json server-side — `defaultModels` merges per runner, so one write never clobbers
 * another runner's preset.
 */
export declare const setConfigInputSchema: z.ZodObject<{
    baseBranch: z.ZodOptional<z.ZodNullable<z.ZodString>>;
    defaultRunner: z.ZodOptional<z.ZodUnion<readonly [z.ZodEnum<{
        claude: "claude";
        codex: "codex";
        opencode: "opencode";
        pi: "pi";
    }>, z.ZodLiteral<"auto">]>>;
    systemPrompt: z.ZodOptional<z.ZodNullable<z.ZodString>>;
    defaultModels: z.ZodOptional<z.ZodObject<{
        claude: z.ZodOptional<z.ZodNullable<z.ZodString>>;
        codex: z.ZodOptional<z.ZodNullable<z.ZodString>>;
        opencode: z.ZodOptional<z.ZodNullable<z.ZodString>>;
        pi: z.ZodOptional<z.ZodNullable<z.ZodString>>;
    }, z.core.$strip>>;
    maxParallel: z.ZodOptional<z.ZodNumber>;
    memoryLimitMb: z.ZodOptional<z.ZodNullable<z.ZodNumber>>;
    worktreeRetention: z.ZodOptional<z.ZodNullable<z.ZodNumber>>;
    liveTitleUpdates: z.ZodOptional<z.ZodNullable<z.ZodBoolean>>;
    reviewGate: z.ZodOptional<z.ZodNullable<z.ZodBoolean>>;
}, z.core.$strip>;
export type SetConfigInput = z.infer<typeof setConfigInputSchema>;
export declare const skillsUpdateStatusSchema: z.ZodEnum<{
    available: "available";
    checking: "checking";
    current: "current";
    error: "error";
    idle: "idle";
    unavailable: "unavailable";
    updating: "updating";
}>;
export type SkillsUpdateStatus = z.infer<typeof skillsUpdateStatusSchema>;
export declare const skillsUpdateScopeStateSchema: z.ZodObject<{
    scope: z.ZodEnum<{
        global: "global";
        project: "project";
    }>;
    status: z.ZodEnum<{
        available: "available";
        checking: "checking";
        current: "current";
        error: "error";
        idle: "idle";
        unavailable: "unavailable";
        updating: "updating";
    }>;
    available: z.ZodBoolean;
    skills: z.ZodArray<z.ZodString>;
    checkedAt: z.ZodNullable<z.ZodString>;
    updatedAt: z.ZodNullable<z.ZodString>;
    reason: z.ZodOptional<z.ZodString>;
}, z.core.$strip>;
export type SkillsUpdateScopeState = z.infer<typeof skillsUpdateScopeStateSchema>;
/** `GET /api/v1/workspace/skills-update` (and the check/apply POSTs) — the merged project+global
 *  skills-update state. `autoUpdateEnabled`/`inherited` are re-stamped from the workspace config
 *  on the way out (`skillsUpdateResponse`, src/server/server.ts:1818). */
export declare const skillsUpdateStateSchema: z.ZodObject<{
    status: z.ZodEnum<{
        available: "available";
        checking: "checking";
        current: "current";
        error: "error";
        idle: "idle";
        unavailable: "unavailable";
        updating: "updating";
    }>;
    available: z.ZodBoolean;
    autoUpdateEnabled: z.ZodBoolean;
    inherited: z.ZodBoolean;
    checkedAt: z.ZodNullable<z.ZodString>;
    updatedAt: z.ZodNullable<z.ZodString>;
    scopes: z.ZodArray<z.ZodObject<{
        scope: z.ZodEnum<{
            global: "global";
            project: "project";
        }>;
        status: z.ZodEnum<{
            available: "available";
            checking: "checking";
            current: "current";
            error: "error";
            idle: "idle";
            unavailable: "unavailable";
            updating: "updating";
        }>;
        available: z.ZodBoolean;
        skills: z.ZodArray<z.ZodString>;
        checkedAt: z.ZodNullable<z.ZodString>;
        updatedAt: z.ZodNullable<z.ZodString>;
        reason: z.ZodOptional<z.ZodString>;
    }, z.core.$strip>>;
    needsUpgradeNotes: z.ZodBoolean;
}, z.core.$strip>;
export type SkillsUpdateState = z.infer<typeof skillsUpdateStateSchema>;
/** The agent backends are the providers — one alias, never a second enum. */
export declare const providerIdSchema: z.ZodEnum<{
    claude: "claude";
    codex: "codex";
    opencode: "opencode";
    pi: "pi";
}>;
export type ProviderId = Runner;
/** Coarse host authentication state. Credentials, account identity, and raw CLI output never
 *  cross this boundary. */
export declare const providerConnectionStateSchema: z.ZodEnum<{
    connected: "connected";
    disconnected: "disconnected";
    "not-installed": "not-installed";
    unknown: "unknown";
}>;
export type ProviderConnectionState = z.infer<typeof providerConnectionStateSchema>;
/**
 * One provider row.
 *
 * `enabled` is OPTIONAL: `ProviderAuth.status()` (src/core/provider-auth.ts:12) builds rows
 * without it and only `applyProviderEnablement` stamps it in, so the type the routes answer keeps
 * the key optional. The hand-written DTO declared it required — narrower than the route.
 */
export declare const providerStatusSchema: z.ZodObject<{
    provider: z.ZodEnum<{
        claude: "claude";
        codex: "codex";
        opencode: "opencode";
        pi: "pi";
    }>;
    status: z.ZodEnum<{
        connected: "connected";
        disconnected: "disconnected";
        "not-installed": "not-installed";
        unknown: "unknown";
    }>;
    enabled: z.ZodOptional<z.ZodBoolean>;
    hint: z.ZodOptional<z.ZodString>;
    authFailureId: z.ZodOptional<z.ZodString>;
    profileId: z.ZodOptional<z.ZodString>;
}, z.core.$strip>;
export type ProviderStatus = z.infer<typeof providerStatusSchema>;
/** `GET /api/v1/providers/status`, and the answer of the enabled/retry mutators. */
export declare const providerStatusResponseSchema: z.ZodObject<{
    providers: z.ZodArray<z.ZodObject<{
        provider: z.ZodEnum<{
            claude: "claude";
            codex: "codex";
            opencode: "opencode";
            pi: "pi";
        }>;
        status: z.ZodEnum<{
            connected: "connected";
            disconnected: "disconnected";
            "not-installed": "not-installed";
            unknown: "unknown";
        }>;
        enabled: z.ZodOptional<z.ZodBoolean>;
        hint: z.ZodOptional<z.ZodString>;
        authFailureId: z.ZodOptional<z.ZodString>;
        profileId: z.ZodOptional<z.ZodString>;
    }, z.core.$strip>>;
}, z.core.$strip>;
export type ProviderStatusResponse = z.infer<typeof providerStatusResponseSchema>;
/** `POST /api/v1/providers/connect` — either a terminal was handed the login command, or the
 *  provider turned out to be connected already. Every other outcome is a 409/500 carrying the
 *  same `command` for the clipboard fallback. */
export declare const providerConnectResponseSchema: z.ZodDiscriminatedUnion<[z.ZodObject<{
    opened: z.ZodLiteral<true>;
    command: z.ZodString;
}, z.core.$strip>, z.ZodObject<{
    opened: z.ZodLiteral<false>;
    connected: z.ZodLiteral<true>;
    command: z.ZodString;
}, z.core.$strip>], "opened">;
export type ProviderConnectResponse = z.infer<typeof providerConnectResponseSchema>;
/**
 * The runners whose model list is discovered from the host rather than hard-coded: Codex
 * through its app-server protocol, OpenCode through its own `models` listing (#794). Claude has
 * no equivalent local source, so its picker keeps static presets and `GET /api/v1/models`
 * rejects it. One definition, used by the route's query validator and by the cockpit's picker.
 */
export declare const modelDiscoveryRunnerSchema: z.ZodEnum<{
    codex: "codex";
    opencode: "opencode";
}>;
export type ModelDiscoveryRunner = z.infer<typeof modelDiscoveryRunnerSchema>;
export declare const MODEL_DISCOVERY_RUNNERS: readonly ModelDiscoveryRunner[];
/** True when `runner` has a host-discovered catalog (and therefore a `/models` answer). */
export declare function runnerDiscoversModels(runner: Runner): runner is ModelDiscoveryRunner;
export declare const runnerModelOptionSchema: z.ZodObject<{
    id: z.ZodString;
    label: z.ZodString;
    description: z.ZodString;
    reasoningEfforts: z.ZodOptional<z.ZodArray<z.ZodString>>;
}, z.core.$strip>;
export type RunnerModelOption = z.infer<typeof runnerModelOptionSchema>;
/** `GET /api/v1/models?runner=codex|opencode` — the models discovered from that runner's own
 *  host installation, plus how fresh the answer is. Never an error: an unavailable CLI degrades
 *  to `source: 'unavailable'` with a `reason`. Claude has no host-local catalog and is rejected. */
export declare const runnerModelCatalogResponseSchema: z.ZodObject<{
    runner: z.ZodEnum<{
        claude: "claude";
        codex: "codex";
        opencode: "opencode";
        pi: "pi";
    }>;
    models: z.ZodArray<z.ZodObject<{
        id: z.ZodString;
        label: z.ZodString;
        description: z.ZodString;
        reasoningEfforts: z.ZodOptional<z.ZodArray<z.ZodString>>;
    }, z.core.$strip>>;
    source: z.ZodEnum<{
        cache: "cache";
        live: "live";
        unavailable: "unavailable";
    }>;
    stale: z.ZodBoolean;
    reason: z.ZodOptional<z.ZodString>;
}, z.core.$strip>;
export type RunnerModelCatalogResponse = z.infer<typeof runnerModelCatalogResponseSchema>;
/** A local app a worktree can be opened in (#open-in): editor, file manager, or terminal. */
export declare const openTargetSchema: z.ZodObject<{
    id: z.ZodString;
    label: z.ZodString;
    icon: z.ZodOptional<z.ZodString>;
}, z.core.$strip>;
export type OpenTarget = z.infer<typeof openTargetSchema>;
/** `GET /api/v1/open-targets` — the detected local apps; empty in hosted mode (CEZ_REMOTE). */
export declare const openTargetsResponseSchema: z.ZodObject<{
    targets: z.ZodArray<z.ZodObject<{
        id: z.ZodString;
        label: z.ZodString;
        icon: z.ZodOptional<z.ZodString>;
    }, z.core.$strip>>;
}, z.core.$strip>;
export type OpenTargetsResponse = z.infer<typeof openTargetsResponseSchema>;
/**
 * `POST /api/v1/open-in` — open THIS PROJECT'S root in a detected app (Settings → the project
 * folder row). The path is never sent: it is the scoped project's own registered root, resolved
 * server-side, so the route has no traversal surface at all. `target` is an
 * `/api/v1/open-targets` id; unlike the run route there is no `default`/`cli:` handling, because
 * a repo root is a directory and an agent CLI belongs in a task worktree.
 */
export declare const openProjectInSchema: z.ZodObject<{
    target: z.ZodString;
}, z.core.$strip>;
export type OpenProjectInRequest = z.infer<typeof openProjectInSchema>;
/** The 200 for the above — `opened` is a literal because every failure is a 409 with `{ error }`,
 *  so a `false` would be unreachable and would only invite a client to branch on it. */
export declare const openProjectInResponseSchema: z.ZodObject<{
    opened: z.ZodLiteral<true>;
    path: z.ZodString;
}, z.core.$strip>;
export type OpenProjectInResponse = z.infer<typeof openProjectInResponseSchema>;
