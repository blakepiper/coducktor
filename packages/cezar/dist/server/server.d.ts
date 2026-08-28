import { AutomationStore } from '../automations/store.ts';
import type { IncomingMessage } from 'node:http';
import { Hono } from 'hono';
import { type ServerType } from '@hono/node-server';
import { type WorkspaceConfigResponse as ContractWorkspaceConfigResponse } from '../contract/index.js';
import { ProviderAuthService, type ProviderId } from '../core/provider-auth.ts';
import { RunnerModelCatalog } from '../core/runner-model-catalog.ts';
import { currentUsage } from '../core/process-usage.ts';
import { SkillsUpdateService } from '../skills-update.ts';
import type { RunStore } from '../runs/store.ts';
import type { RunManager } from '../workflows/run.ts';
import { loadWorkspaceConfig, mergeWriteWorkspaceConfig, type WorkspaceConfig } from '../workspace/config.ts';
import { type ProjectListEntry } from '../workspace/projects.ts';
import { WorkspaceSemaphore } from '../workspace/semaphore.ts';
import type { ProviderUsageService } from '../core/quota/usage-service.ts';
import type { QuotaCoordinator } from '../core/quota/coordinator.ts';
import { type CloneRunner } from './checkout.ts';
import { ProjectContexts } from './project-context.ts';
import { type SocketHub, type WsUpgradeVerdict } from './ws.ts';
import { openInTerminal } from './open-in-terminal.ts';
import { openFileInDefaultApp, openInApp } from './open-in-app.ts';
import { ProviderRuntimeAuthObserver } from './provider-auth-runtime.ts';
export interface ServerDeps {
    repoRoot: string;
    store: RunStore;
    manager: RunManager;
    version: string;
    /** Optional externally supplied update metadata. The CLI does not contact a package registry. */
    update?: {
        latest?: string;
    };
    /** Host the HTTP server binds (default 127.0.0.1). A non-loopback host
     *  implies hosted mode — `capabilities.localHandoff:false`. */
    bindHost?: string;
    /** Workspace-registry id of the boot project (multi-project spec) — plumbed
     *  from `initWorkspace` in src/index.ts. Optional: legacy callers/tests get
     *  a lazy registry lookup by `repoRoot`, falling back to the repo's slug. */
    bootProjectId?: string;
    /** Per-project context map (multi-project spec, step 2.2). Non-boot
     *  `/api/p/:projectId/*` requests resolve their `{store, manager, …}` here,
     *  built lazily on first touch. Optional so legacy callers change nothing —
     *  the default is a registry-backed map; tests inject their own so they can
     *  `disposeAll()` after. The BOOT project never lives in this map: its
     *  context is seeded from `deps.{store,manager}` (which src/index.ts already
     *  recovered/pruned at startup) and the resolver short-circuits to it. */
    contexts?: ProjectContexts;
    /** Boot project's shared automation store. `startServer` injects the
     *  coordinator-owned instance so HTTP routes and the scheduler never cache
     *  separate views of the same project files. */
    automationStore?: AutomationStore;
    /** Workspace-wide parallel-cap semaphore + cached resource config (spec
     *  2026-07-20, step 2.5): the ONE instance boot created, refreshed, and gave
     *  the boot manager — threaded into the default `ProjectContexts` so every
     *  project's RunManager shares it. Step 2.7's `PUT /api/workspace/config`
     *  calls `semaphore.refresh()` after a write. Optional so legacy
     *  callers/tests change nothing. */
    semaphore?: WorkspaceSemaphore;
    /** Shared process-wide quota cache and reservation authority. */
    quotaCoordinator?: QuotaCoordinator;
    quotaUsage?: ProviderUsageService;
    quotaPolicyUpdate?: (config: WorkspaceConfig) => void;
    /** Workspace-level SSE bus (spec, step 2.8): `project-added` /
     *  `project-removed` / `checkout-progress` plus the host-wide unstamped
     *  `provider-status` event reach `/api/workspace/events` through this.
     *  Optional — createApp builds a private one; inject to emit from outside
     *  the app (tests, future CLI hooks). */
    workspaceEvents?: WorkspaceEventBus;
    /** How `POST /api/projects/checkout` (step 4.3) actually clones. Defaults to
     *  `gh repo clone` (or the `CEZ_DRY_RUN=1` fake) — injected by tests so the
     *  route's guards, cleanup and error surfacing are exercised for real
     *  against real temp dirs, without a network or a `gh` binary. */
    cloneRunner?: CloneRunner;
    /** Host-wide model discovery service. Tests inject a deterministic adapter. */
    modelCatalog?: RunnerModelCatalog;
    /** Host-wide provider authentication discovery. Tests inject deterministic probes. */
    providerAuth?: ProviderAuthService;
    /** Global provider enablement preferences. Tests may inject an in-memory store. */
    workspaceConfig?: {
        load: typeof loadWorkspaceConfig;
        mergeWrite: typeof mergeWriteWorkspaceConfig;
    };
    /** Shared runtime rejection observer. The CLI injects the instance already
     *  watching the boot store before recovery; createApp builds one for legacy
     *  callers and tests. */
    providerRuntimeAuth?: ProviderRuntimeAuthObserver;
    /** Local terminal handoff for provider-owned login. */
    openTerminal?: typeof openInTerminal;
    /** Hand a local FILE (or folder) to the OS default app. Injected so the account-file open route
     *  is testable without actually launching an editor. */
    openFile?: typeof openFileInDefaultApp;
    /** Hand a folder to a detected app by target id — editor, file manager, or `terminal`, which
     *  reaches `openInTerminal`. Injected for the same reason as the two above: a test that reaches
     *  this for real opens a window on the developer's machine (#820). */
    openApp?: typeof openInApp;
    /** Process-wide configured skills update detector. Injected in tests and
     * shared by every workspace route/project; createApp owns the default. */
    skillsUpdate?: SkillsUpdateService;
    /** WebSocket subscription hub (`/api/v1/ws`, src/server/ws.ts). `createApp`
     *  only registers topics on it — `startServer` builds one and attaches it
     *  to the HTTP server it binds. Optional so legacy callers/tests change
     *  nothing: no hub, no topics, and the HTTP surface is byte-identical. */
    socketHub?: SocketHub;
    /** Re-arm the workspace automation timer after definition mutations. */
    automationsChanged?: () => void;
}
/** One row of the mirrored project-route table. */
export interface ProjectRouteInfo {
    method: string;
    /** Path relative to the mount — `/runs/:id`, not `/api/runs/:id`. */
    path: string;
}
/**
 * The project-scoped route table of a `createApp()` app, derived from its actual registrations
 * (so it can never drift from the code): every method+path mounted under
 * `/api/v1/p/:projectId/…`, minus the scope-resolver middleware (method ALL), deduped. The
 * alias-parity suite iterates this to assert `/api/v1/<path>` ≡ `/api/v1/p/<boot>/<path>` ≡
 * `/api/v1/p/default/<path>`.
 */
export declare function projectRouteManifest(app: Hono): ProjectRouteInfo[];
/** One column of `GET /api/groups/:groupId`. NOTE: `diffStat` here is the raw
 *  `git diff --stat` text (worktreeDiffStat), NOT the numeric `RunRecord.diffStat`. */
/** `GET /api/projects` (multi-project spec) — the workspace registry with
 *  per-root status probes. Absolute `root`s belong HERE (same-origin, behind
 *  the cockpit) and are deliberately never mirrored into the CORS-open
 *  `/api/health` payload (#431 — see the health route). Never 404s. */
export interface ProjectsResponse {
    projects: ProjectListEntry[];
    bootProject: string;
    projectsDir: string;
}
/** `POST /api/projects` (multi-project spec, step 4.2) — the folder-browser
 *  dialog's commit step. The entry carries the same `status`/`branch` probe
 *  `GET /api/projects` attaches, so the cockpit sees one project shape.
 *  `error` is present ONLY on the 409 (already registered), where `project` is
 *  the EXISTING entry — the dialog navigates to it instead of dead-ending. */
export interface RegisterProjectResponse {
    project: ProjectListEntry;
    error?: string;
}
/** `DELETE /api/projects/:projectId` (multi-project spec, step 4.4) — the
 *  Projects settings pane's Remove. DEREGISTRATION ONLY: the entry leaves
 *  `~/.cezar/config.json` and nothing under the project root is read, moved or
 *  deleted. `removed` is always true on a 200 (the failure paths are 404/409). */
export interface RemoveProjectResponse {
    removed: true;
    id: string;
}
/** `PATCH /api/projects/:projectId` (spec 2026-07-22-per-project-concurrency)
 *  — sets or clears a project's per-project `maxParallel`. The entry carries
 *  the same `status`/`branch` probe `GET /api/projects` attaches, so the
 *  cockpit sees one project shape. `null` in the request clears the override
 *  back to "inherit the workspace cap". */
export interface UpdateProjectResponse {
    project: ProjectListEntry;
}
/** `GET/PUT /api/workspace/config` (multi-project spec, step 2.7) — the
 *  settings slice of `~/.cezar/config.json`: global knobs ONLY, never the
 *  project registry (that is `GET /api/projects`' job). */
export type WorkspaceConfigResponse = ContractWorkspaceConfigResponse;
/** Workspace-level event names carried ONLY on `GET /api/workspace/events`
 *  (never on the per-project streams): registry mutations, the GUI-clone
 *  progress feed (step 4.3), and host-wide unstamped provider status. */
export type WorkspaceEventName = 'project-added' | 'project-removed' | 'checkout-progress' | 'provider-status' | 'automation-change';
/**
 * The in-process bus for workspace-level SSE events. The registry-mutating
 * routes (`POST /api/projects` — step 4.2, emits `project-added` for a
 * genuinely new entry; `DELETE /api/projects/:projectId` — step 4.4) and the
 * checkout flow (step 4.3) call `emit()`; runtime provider auth observation
 * emits host-wide `provider-status`; every open `/api/workspace/events` stream
 * relays the event verbatim under its name. Injectable via
 * `ServerDeps.workspaceEvents` so tests (and any out-of-createApp emitter) can
 * drive the stream.
 */
export declare class WorkspaceEventBus {
    private readonly listeners;
    emit(event: WorkspaceEventName, data: unknown): void;
    /** Subscribe; returns an unsubscribe. */
    on(listener: (event: WorkspaceEventName, data: unknown) => void): () => void;
}
export declare function createApp(deps: ServerDeps): import("hono/hono-base").HonoBase<import("hono/types").BlankEnv, import("hono/types").BlankSchema | import("hono/types").MergeSchemaPath<import("hono/types").BlankSchema | import("hono/types").MergeSchemaPath<{
    "/health": {
        $get: {
            output: {
                version: string;
                latestVersion?: string | undefined;
                repoRoot: string;
                repo: {
                    root: string;
                    branch: string;
                    remote?: string;
                } | null;
                checks: {
                    name: 'claude' | 'codex' | 'opencode' | 'pi' | 'gh' | 'git';
                    available: boolean;
                    version?: string;
                    hint?: string;
                }[];
                defaultRunner: "auto" | "claude" | "codex" | "opencode" | "pi";
                forge: {
                    available?: boolean | undefined;
                    reason?: string;
                    kind: "github";
                } | null;
                capabilities: {
                    localHandoff: boolean;
                    followups: boolean;
                    singleProject: boolean;
                    automations: boolean;
                    tokenMetrics: boolean;
                    tokenUsageMetrics: boolean;
                    costMetrics: boolean;
                };
                projects: {
                    id: string;
                    name: string;
                }[];
                bootProject: string;
            };
            outputFormat: "json";
            status: import("hono/utils/http-status").ContentfulStatusCode;
            input: {};
        };
    };
}, "/"> | import("hono/types").MergeSchemaPath<{
    "/models": {
        $get: {
            output: {
                error: string;
            };
            outputFormat: "json";
            status: 400;
            input: {
                query: {
                    runner: "codex" | "opencode";
                };
            };
        } | {
            output: {
                runner: import("../core/agent-runner.ts").RunnerId;
                models: {
                    id: string;
                    label: string;
                    description: string;
                    reasoningEfforts?: string[];
                }[];
                source: import("../core/runner-model-catalog.ts").ModelCatalogSource;
                stale: boolean;
                reason?: string;
            };
            outputFormat: "json";
            status: import("hono/utils/http-status").ContentfulStatusCode;
            input: {
                query: {
                    runner: "codex" | "opencode";
                };
            };
        };
    };
}, "/"> | import("hono/types").MergeSchemaPath<{
    "/fs/browse": {
        $get: {
            output: {
                error: string;
            };
            outputFormat: "json";
            status: 400;
            input: {
                query: {
                    path?: string | undefined;
                    showHidden?: string | undefined;
                };
            };
        } | {
            output: {
                error: string;
            };
            outputFormat: "json";
            status: 409;
            input: {
                query: {
                    path?: string | undefined;
                    showHidden?: string | undefined;
                };
            };
        } | {
            output: {
                error: string;
            };
            outputFormat: "json";
            status: 400 | 404;
            input: {
                query: {
                    path?: string | undefined;
                    showHidden?: string | undefined;
                };
            };
        } | {
            output: {
                path: string;
                parent: string | null;
                dirs: {
                    name: string;
                    path: string;
                    isRepo: boolean;
                }[];
                truncated: boolean;
            };
            outputFormat: "json";
            status: import("hono/utils/http-status").ContentfulStatusCode;
            input: {
                query: {
                    path?: string | undefined;
                    showHidden?: string | undefined;
                };
            };
        };
    };
}, "/"> | import("hono/types").MergeSchemaPath<{
    "/automation-checks/:checkId": {
        $get: {
            output: {
                id: string;
                automationId: string;
                mode: 'preview' | 'execute';
                status: 'queued' | 'running' | 'complete' | 'error';
                createdAt: string;
                completedAt?: string;
                matches?: number;
                truncated?: boolean;
                error?: string;
            };
            outputFormat: "json";
            status: import("hono/utils/http-status").ContentfulStatusCode;
            input: {
                param: {
                    checkId: string;
                };
            };
        } | {
            output: {
                error: string;
            };
            outputFormat: "json";
            status: 404;
            input: {
                param: {
                    checkId: string;
                };
            };
        };
    };
}, "/"> | import("hono/types").MergeSchemaPath<{
    "/workspace/events": {
        $get: {
            output: {};
            outputFormat: string;
            status: import("hono/utils/http-status").StatusCode;
            input: {};
        };
    };
}, "/"> | import("hono/types").MergeSchemaPath<{
    "/workspace/runs-index": {
        $get: {
            output: {
                runs: {
                    projectId: string;
                    id: string;
                    title: string;
                    titleSummary?: string | undefined;
                    titleOrigin?: "auto" | "marker" | "user" | undefined;
                    status: "cancelled" | "done" | "failed" | "queued" | "review" | "running" | "waiting";
                    activity?: "monitoring" | undefined;
                    createdAt: string;
                    finishedAt?: string | undefined;
                    seenAt?: string | undefined;
                    archived: boolean;
                    autoResumeAt?: string | undefined;
                    workflow: string;
                    branch?: string | undefined;
                    startedAt?: string | undefined;
                    pullRequestUrl?: string | undefined;
                    referencedPullRequestUrl?: string | undefined;
                    prNumber?: number | undefined;
                    issueNumber?: number | undefined;
                    referencedIssueUrl?: string | undefined;
                    markerRefs?: {
                        pr?: number | undefined;
                        issue?: number | undefined;
                    } | undefined;
                    costUsd?: number | undefined;
                    peakRssBytes?: number | undefined;
                    peakProcCount?: number | undefined;
                    usage?: {
                        cpuPct: number;
                        rssBytes: number;
                        procCount: number;
                    } | undefined;
                    runner?: "claude" | "codex" | "opencode" | "pi" | undefined;
                    model?: string | undefined;
                    modelUsage?: {
                        model: string;
                        reasoningEffort?: "high" | "low" | "medium" | "xhigh" | undefined;
                        pct: number;
                    }[] | undefined;
                    modelIdentity?: string | undefined;
                    reasoningEffort?: "high" | "low" | "medium" | "xhigh" | undefined;
                }[];
                referenceStatuses: {
                    [x: string]: {
                        prs: {
                            [x: number]: "changes-requested" | "checks-failing" | "checks-pending" | "closed" | "completed" | "draft" | "merged" | "not-planned" | "open" | "ready" | "review-required";
                        };
                        issues: {
                            [x: number]: "changes-requested" | "checks-failing" | "checks-pending" | "closed" | "completed" | "draft" | "merged" | "not-planned" | "open" | "ready" | "review-required";
                        };
                    };
                };
                perProjectLimit: number;
                truncated: string[];
            };
            outputFormat: "json";
            status: import("hono/utils/http-status").ContentfulStatusCode;
            input: {};
        };
    };
}, "/"> | import("hono/types").MergeSchemaPath<{
    "/workspace/skills-update": {
        $get: {
            output: {
                error: string;
            };
            outputFormat: "json";
            status: 400;
            input: {
                query: {
                    projectId: string | string[];
                };
            };
        } | {
            output: {
                error: string;
            };
            outputFormat: "json";
            status: 404 | 409;
            input: {
                query: {
                    projectId: string | string[];
                };
            };
        } | {
            output: {
                status: import("../skills-update.ts").SkillsUpdateStatus;
                available: boolean;
                autoUpdateEnabled: boolean;
                inherited: boolean;
                checkedAt: string | null;
                updatedAt: string | null;
                scopes: {
                    scope: import("../skills-update.ts").SkillsUpdateScope;
                    status: import("../skills-update.ts").SkillsUpdateStatus;
                    available: boolean;
                    skills: string[];
                    checkedAt: string | null;
                    updatedAt: string | null;
                    reason?: string;
                }[];
                needsUpgradeNotes: boolean;
            };
            outputFormat: "json";
            status: import("hono/utils/http-status").ContentfulStatusCode;
            input: {
                query: {
                    projectId: string | string[];
                };
            };
        };
    };
} & {
    "/workspace/skills-update/check": {
        $post: {
            output: {
                status: import("../skills-update.ts").SkillsUpdateStatus;
                available: boolean;
                autoUpdateEnabled: boolean;
                inherited: boolean;
                checkedAt: string | null;
                updatedAt: string | null;
                scopes: {
                    scope: import("../skills-update.ts").SkillsUpdateScope;
                    status: import("../skills-update.ts").SkillsUpdateStatus;
                    available: boolean;
                    skills: string[];
                    checkedAt: string | null;
                    updatedAt: string | null;
                    reason?: string;
                }[];
                needsUpgradeNotes: boolean;
            };
            outputFormat: "json";
            status: import("hono/utils/http-status").ContentfulStatusCode;
            input: {
                json: {
                    projectId: string;
                };
            };
        } | {
            output: {
                error: string;
            };
            outputFormat: "json";
            status: 404 | 409;
            input: {
                json: {
                    projectId: string;
                };
            };
        };
    };
} & {
    "/workspace/skills-update/apply": {
        $post: {
            output: {
                status: import("../skills-update.ts").SkillsUpdateStatus;
                available: boolean;
                autoUpdateEnabled: boolean;
                inherited: boolean;
                checkedAt: string | null;
                updatedAt: string | null;
                scopes: {
                    scope: import("../skills-update.ts").SkillsUpdateScope;
                    status: import("../skills-update.ts").SkillsUpdateStatus;
                    available: boolean;
                    skills: string[];
                    checkedAt: string | null;
                    updatedAt: string | null;
                    reason?: string;
                }[];
                needsUpgradeNotes: boolean;
            };
            outputFormat: "json";
            status: import("hono/utils/http-status").ContentfulStatusCode;
            input: {
                json: {
                    projectId: string;
                };
            };
        } | {
            output: {
                error: string;
            };
            outputFormat: "json";
            status: 404 | 409;
            input: {
                json: {
                    projectId: string;
                };
            };
        };
    };
}, "/"> | import("hono/types").MergeSchemaPath<{
    "/providers/status": {
        $get: {
            output: {
                error: string;
            };
            outputFormat: "json";
            status: 400;
            input: {
                query: {
                    refresh?: "1" | undefined;
                };
            };
        } | {
            output: {
                providers: {
                    provider: ProviderId;
                    status: import("../core/provider-auth.ts").ProviderConnectionState;
                    enabled?: boolean;
                    hint?: string;
                    authFailureId?: string;
                    profileId?: string;
                }[];
            };
            outputFormat: "json";
            status: import("hono/utils/http-status").ContentfulStatusCode;
            input: {
                query: {
                    refresh?: "1" | undefined;
                };
            };
        };
    };
} & {
    "/providers/:provider/enabled": {
        $put: {
            output: {
                error: string;
            };
            outputFormat: "json";
            status: 400;
            input: {
                param: {
                    provider: "claude" | "codex" | "opencode" | "pi";
                };
            } & {
                json: {
                    enabled: boolean;
                };
            };
        } | {
            output: {
                providers: {
                    provider: ProviderId;
                    status: import("../core/provider-auth.ts").ProviderConnectionState;
                    enabled?: boolean;
                    hint?: string;
                    authFailureId?: string;
                    profileId?: string;
                }[];
            };
            outputFormat: "json";
            status: import("hono/utils/http-status").ContentfulStatusCode;
            input: {
                param: {
                    provider: "claude" | "codex" | "opencode" | "pi";
                };
            } & {
                json: {
                    enabled: boolean;
                };
            };
        } | {
            output: {
                error: string;
            };
            outputFormat: "json";
            status: 500;
            input: {
                param: {
                    provider: "claude" | "codex" | "opencode" | "pi";
                };
            } & {
                json: {
                    enabled: boolean;
                };
            };
        };
    };
} & {
    "/providers/:provider/retry": {
        $post: {
            output: {
                error: string;
            };
            outputFormat: "json";
            status: 400;
            input: {
                param: {
                    provider: "claude" | "codex" | "opencode" | "pi";
                };
            } & {
                json: {
                    authFailureId: string;
                };
            };
        } | {
            output: {
                providers: {
                    provider: ProviderId;
                    status: import("../core/provider-auth.ts").ProviderConnectionState;
                    enabled?: boolean;
                    hint?: string;
                    authFailureId?: string;
                    profileId?: string;
                }[];
            };
            outputFormat: "json";
            status: import("hono/utils/http-status").ContentfulStatusCode;
            input: {
                param: {
                    provider: "claude" | "codex" | "opencode" | "pi";
                };
            } & {
                json: {
                    authFailureId: string;
                };
            };
        } | {
            output: {
                error: string;
            };
            outputFormat: "json";
            status: 409;
            input: {
                param: {
                    provider: "claude" | "codex" | "opencode" | "pi";
                };
            } & {
                json: {
                    authFailureId: string;
                };
            };
        };
    };
} & {
    "/providers/connect": {
        $post: {
            output: {
                error: string;
            };
            outputFormat: "json";
            status: 409;
            input: {
                json: {
                    provider: "claude" | "codex" | "opencode" | "pi";
                    profileId?: string | undefined;
                };
            };
        } | {
            output: {
                error: string;
            };
            outputFormat: "json";
            status: 400;
            input: {
                json: {
                    provider: "claude" | "codex" | "opencode" | "pi";
                    profileId?: string | undefined;
                };
            };
        } | {
            output: {
                error: string;
            };
            outputFormat: "json";
            status: 500;
            input: {
                json: {
                    provider: "claude" | "codex" | "opencode" | "pi";
                    profileId?: string | undefined;
                };
            };
        } | {
            output: {
                opened: false;
                connected: true;
                command: string;
            };
            outputFormat: "json";
            status: import("hono/utils/http-status").ContentfulStatusCode;
            input: {
                json: {
                    provider: "claude" | "codex" | "opencode" | "pi";
                    profileId?: string | undefined;
                };
            };
        } | {
            output: {
                opened: true;
                command: string;
            };
            outputFormat: "json";
            status: import("hono/utils/http-status").ContentfulStatusCode;
            input: {
                json: {
                    provider: "claude" | "codex" | "opencode" | "pi";
                    profileId?: string | undefined;
                };
            };
        };
    };
}, "/"> | import("hono/types").MergeSchemaPath<{
    "/projects": {
        $get: {
            output: {
                projects: {
                    [x: string]: import("hono/utils/types").JSONValue;
                    id: string;
                    root: string;
                    name: string;
                    addedAt: string;
                    lastOpenedAt: string;
                    source: "checkout" | "local";
                    maxParallel?: number | undefined;
                    tags?: string[] | undefined;
                    status: import("../workspace/projects.ts").ProjectStatus;
                    branch?: string;
                    forge?: import("./forge/types.ts").ForgeKind;
                    repoUrl?: string;
                }[];
                bootProject: string;
                projectsDir: string;
            };
            outputFormat: "json";
            status: import("hono/utils/http-status").ContentfulStatusCode;
            input: {};
        };
    };
} & {
    "/projects": {
        $post: {
            output: {
                project: {
                    [x: string]: import("hono/utils/types").JSONValue;
                    id: string;
                    root: string;
                    name: string;
                    addedAt: string;
                    lastOpenedAt: string;
                    source: "checkout" | "local";
                    maxParallel?: number | undefined;
                    tags?: string[] | undefined;
                    status: import("../workspace/projects.ts").ProjectStatus;
                    branch?: string;
                    forge?: import("./forge/types.ts").ForgeKind;
                    repoUrl?: string;
                };
                error?: string;
            };
            outputFormat: "json";
            status: 200;
            input: {
                json: {
                    root: string;
                };
            };
        } | {
            output: {
                project: {
                    [x: string]: import("hono/utils/types").JSONValue;
                    id: string;
                    root: string;
                    name: string;
                    addedAt: string;
                    lastOpenedAt: string;
                    source: "checkout" | "local";
                    maxParallel?: number | undefined;
                    tags?: string[] | undefined;
                    status: import("../workspace/projects.ts").ProjectStatus;
                    branch?: string;
                    forge?: import("./forge/types.ts").ForgeKind;
                    repoUrl?: string;
                };
                error?: string;
            } | {
                error: string;
            };
            outputFormat: "json";
            status: 400 | 409 | 500;
            input: {
                json: {
                    root: string;
                };
            };
        };
    };
} & {
    "/projects/:projectId": {
        $delete: {
            output: {
                error: string;
            };
            outputFormat: "json";
            status: 409;
            input: {
                param: {
                    projectId: string;
                };
            };
        } | {
            output: {
                error: string;
            };
            outputFormat: "json";
            status: 404;
            input: {
                param: {
                    projectId: string;
                };
            };
        } | {
            output: {
                error: string;
            };
            outputFormat: "json";
            status: 500;
            input: {
                param: {
                    projectId: string;
                };
            };
        } | {
            output: {
                removed: true;
                id: string;
            };
            outputFormat: "json";
            status: import("hono/utils/http-status").ContentfulStatusCode;
            input: {
                param: {
                    projectId: string;
                };
            };
        };
    };
} & {
    "/projects/:projectId": {
        $patch: {
            output: {
                error: string;
            };
            outputFormat: "json";
            status: 409;
            input: {
                json: {
                    maxParallel?: number | null | undefined;
                    tags?: string[] | null | undefined;
                };
            } & {
                param: {
                    projectId: string;
                };
            };
        } | {
            output: {
                error: string;
            };
            outputFormat: "json";
            status: 404;
            input: {
                json: {
                    maxParallel?: number | null | undefined;
                    tags?: string[] | null | undefined;
                };
            } & {
                param: {
                    projectId: string;
                };
            };
        } | {
            output: {
                error: string;
            };
            outputFormat: "json";
            status: 500;
            input: {
                json: {
                    maxParallel?: number | null | undefined;
                    tags?: string[] | null | undefined;
                };
            } & {
                param: {
                    projectId: string;
                };
            };
        } | {
            output: {
                project: {
                    [x: string]: import("hono/utils/types").JSONValue;
                    id: string;
                    root: string;
                    name: string;
                    addedAt: string;
                    lastOpenedAt: string;
                    source: "checkout" | "local";
                    maxParallel?: number | undefined;
                    tags?: string[] | undefined;
                    status: import("../workspace/projects.ts").ProjectStatus;
                    branch?: string;
                    forge?: import("./forge/types.ts").ForgeKind;
                    repoUrl?: string;
                };
            };
            outputFormat: "json";
            status: import("hono/utils/http-status").ContentfulStatusCode;
            input: {
                json: {
                    maxParallel?: number | null | undefined;
                    tags?: string[] | null | undefined;
                };
            } & {
                param: {
                    projectId: string;
                };
            };
        };
    };
} & {
    "/projects/checkout": {
        $post: {
            output: {
                project: {
                    [x: string]: import("hono/utils/types").JSONValue;
                    id: string;
                    root: string;
                    name: string;
                    addedAt: string;
                    lastOpenedAt: string;
                    source: "checkout" | "local";
                    maxParallel?: number | undefined;
                    tags?: string[] | undefined;
                    status: import("../workspace/projects.ts").ProjectStatus;
                    branch?: string;
                    forge?: import("./forge/types.ts").ForgeKind;
                    repoUrl?: string;
                };
                error?: string;
            };
            outputFormat: "json";
            status: 200;
            input: {
                json: {
                    url: string;
                    name?: string | undefined;
                    checkoutId?: string | undefined;
                };
            };
        } | {
            output: {
                error: string;
                reason: string;
            } | {
                error: string;
            };
            outputFormat: "json";
            status: 400 | 409 | 500 | 503;
            input: {
                json: {
                    url: string;
                    name?: string | undefined;
                    checkoutId?: string | undefined;
                };
            };
        };
    };
}, "/"> | import("hono/types").MergeSchemaPath<{
    "/workspace/usage": {
        $get: {
            output: {
                providers: {
                    provider: import("../core/runner-selection.ts").AutoProvider;
                    profileId: string;
                    health: import("../core/quota/types.ts").ProviderQuotaHealth;
                    fetchedAt: string;
                    source: string;
                    stale: boolean;
                    error?: {
                        code: string;
                        message: string;
                    } | undefined;
                    windows: {
                        kind: 'short' | 'long' | 'model' | 'unknown';
                        usedPercent: number | null;
                        resetsAt?: string;
                        hardLimitReached?: boolean;
                    }[];
                }[];
            };
            outputFormat: "json";
            status: import("hono/utils/http-status").ContentfulStatusCode;
            input: {};
        };
    };
} & {
    "/workspace/config": {
        $get: {
            output: {
                browseRoot: string;
                projectsDir: string;
                skillsAutoUpdate: boolean | null;
                effectiveSkillsAutoUpdate: boolean;
                composerDefaults: {
                    autonomous: boolean | null;
                    worktree: boolean | null;
                    inheritedAutonomous: "source-dependent" | boolean;
                    inheritedWorktree: boolean;
                };
                resources: {
                    maxParallel: number;
                    maxMonitoringSessions: number;
                    monitoringWakeIntervalMinutes: number | null;
                    autoResumeOnUsageLimit: boolean;
                    intelligentContextRefresh: boolean;
                    memoryLimitMb: number | null;
                    worktreeRetentionDefault: number;
                };
                quotaRouting?: {
                    enabled: true;
                    providerOrder: ["claude" | "codex", "claude" | "codex"];
                    unknownUsagePolicy: "allow" | "deny";
                } | undefined;
                agentDefaults: {
                    runner?: "auto" | "claude" | "codex" | "opencode" | "pi" | undefined;
                    models?: {
                        claude?: string | undefined;
                        codex?: string | undefined;
                        opencode?: string | undefined;
                        pi?: string | undefined;
                    } | undefined;
                };
            };
            outputFormat: "json";
            status: import("hono/utils/http-status").ContentfulStatusCode;
            input: {};
        };
    };
} & {
    "/workspace/config": {
        $put: {
            output: {
                browseRoot: string;
                projectsDir: string;
                skillsAutoUpdate: boolean | null;
                effectiveSkillsAutoUpdate: boolean;
                composerDefaults: {
                    autonomous: boolean | null;
                    worktree: boolean | null;
                    inheritedAutonomous: "source-dependent" | boolean;
                    inheritedWorktree: boolean;
                };
                resources: {
                    maxParallel: number;
                    maxMonitoringSessions: number;
                    monitoringWakeIntervalMinutes: number | null;
                    autoResumeOnUsageLimit: boolean;
                    intelligentContextRefresh: boolean;
                    memoryLimitMb: number | null;
                    worktreeRetentionDefault: number;
                };
                quotaRouting?: {
                    enabled: true;
                    providerOrder: ["claude" | "codex", "claude" | "codex"];
                    unknownUsagePolicy: "allow" | "deny";
                } | undefined;
                agentDefaults: {
                    runner?: "auto" | "claude" | "codex" | "opencode" | "pi" | undefined;
                    models?: {
                        claude?: string | undefined;
                        codex?: string | undefined;
                        opencode?: string | undefined;
                        pi?: string | undefined;
                    } | undefined;
                };
            };
            outputFormat: "json";
            status: import("hono/utils/http-status").ContentfulStatusCode;
            input: {
                json: {
                    browseRoot?: string | undefined;
                    projectsDir?: string | undefined;
                    skillsAutoUpdate?: boolean | null | undefined;
                    composerDefaults?: {
                        autonomous?: boolean | null | undefined;
                        worktree?: boolean | null | undefined;
                    } | undefined;
                    resources?: {
                        maxParallel?: number | undefined;
                        maxMonitoringSessions?: number | undefined;
                        monitoringWakeIntervalMinutes?: number | null | undefined;
                        autoResumeOnUsageLimit?: boolean | undefined;
                        intelligentContextRefresh?: boolean | undefined;
                        memoryLimitMb?: number | null | undefined;
                        worktreeRetentionDefault?: number | undefined;
                    } | undefined;
                    agentDefaults?: {
                        runner?: "auto" | "claude" | "codex" | "opencode" | "pi" | null | undefined;
                        models?: {
                            claude?: string | null | undefined;
                            codex?: string | null | undefined;
                            opencode?: string | null | undefined;
                            pi?: string | null | undefined;
                        } | undefined;
                    } | undefined;
                    quotaRouting?: {
                        enabled?: boolean | undefined;
                    } | undefined;
                };
            };
        } | {
            output: {
                error: string;
            };
            outputFormat: "json";
            status: 400;
            input: {
                json: {
                    browseRoot?: string | undefined;
                    projectsDir?: string | undefined;
                    skillsAutoUpdate?: boolean | null | undefined;
                    composerDefaults?: {
                        autonomous?: boolean | null | undefined;
                        worktree?: boolean | null | undefined;
                    } | undefined;
                    resources?: {
                        maxParallel?: number | undefined;
                        maxMonitoringSessions?: number | undefined;
                        monitoringWakeIntervalMinutes?: number | null | undefined;
                        autoResumeOnUsageLimit?: boolean | undefined;
                        intelligentContextRefresh?: boolean | undefined;
                        memoryLimitMb?: number | null | undefined;
                        worktreeRetentionDefault?: number | undefined;
                    } | undefined;
                    agentDefaults?: {
                        runner?: "auto" | "claude" | "codex" | "opencode" | "pi" | null | undefined;
                        models?: {
                            claude?: string | null | undefined;
                            codex?: string | null | undefined;
                            opencode?: string | null | undefined;
                            pi?: string | null | undefined;
                        } | undefined;
                    } | undefined;
                    quotaRouting?: {
                        enabled?: boolean | undefined;
                    } | undefined;
                };
            };
        } | {
            output: {
                error: string;
            };
            outputFormat: "json";
            status: 500;
            input: {
                json: {
                    browseRoot?: string | undefined;
                    projectsDir?: string | undefined;
                    skillsAutoUpdate?: boolean | null | undefined;
                    composerDefaults?: {
                        autonomous?: boolean | null | undefined;
                        worktree?: boolean | null | undefined;
                    } | undefined;
                    resources?: {
                        maxParallel?: number | undefined;
                        maxMonitoringSessions?: number | undefined;
                        monitoringWakeIntervalMinutes?: number | null | undefined;
                        autoResumeOnUsageLimit?: boolean | undefined;
                        intelligentContextRefresh?: boolean | undefined;
                        memoryLimitMb?: number | null | undefined;
                        worktreeRetentionDefault?: number | undefined;
                    } | undefined;
                    agentDefaults?: {
                        runner?: "auto" | "claude" | "codex" | "opencode" | "pi" | null | undefined;
                        models?: {
                            claude?: string | null | undefined;
                            codex?: string | null | undefined;
                            opencode?: string | null | undefined;
                            pi?: string | null | undefined;
                        } | undefined;
                    } | undefined;
                    quotaRouting?: {
                        enabled?: boolean | undefined;
                    } | undefined;
                };
            };
        };
    };
} & {
    "/workspace/ui-state": {
        $get: {
            output: {
                [x: string]: import("hono/utils/types").JSONValue;
                sidebar?: {
                    [x: string]: import("hono/utils/types").JSONValue;
                    collapsed?: {
                        [x: string]: boolean;
                    } | undefined;
                } | undefined;
                dismissedProviderAuthFailures?: {
                    claude?: string | undefined;
                    codex?: string | undefined;
                    opencode?: string | undefined;
                    pi?: string | undefined;
                } | undefined;
                appearance?: {
                    accent?: "lime" | "violet" | undefined;
                    density?: "comfortable" | "compact" | "ultra" | undefined;
                    width?: "narrow" | "wide" | undefined;
                } | undefined;
                notifications?: {
                    [x: string]: import("hono/utils/types").JSONValue;
                    enabled?: boolean | undefined;
                } | undefined;
                taskTable?: {
                    [x: string]: import("hono/utils/types").JSONValue;
                    expandedColumns?: {
                        [x: string]: boolean;
                    } | undefined;
                } | undefined;
                lastLocation?: {
                    projectId: string;
                    pathname: string;
                    search?: string | undefined;
                    hash?: string | undefined;
                } | undefined;
                importedSkills?: string[] | undefined;
            };
            outputFormat: "json";
            status: import("hono/utils/http-status").ContentfulStatusCode;
            input: {};
        };
    };
} & {
    "/workspace/ui-state": {
        $put: {
            output: {
                [x: string]: import("hono/utils/types").JSONValue;
                sidebar?: {
                    [x: string]: import("hono/utils/types").JSONValue;
                    collapsed?: {
                        [x: string]: boolean;
                    } | undefined;
                } | undefined;
                dismissedProviderAuthFailures?: {
                    claude?: string | undefined;
                    codex?: string | undefined;
                    opencode?: string | undefined;
                    pi?: string | undefined;
                } | undefined;
                appearance?: {
                    accent?: "lime" | "violet" | undefined;
                    density?: "comfortable" | "compact" | "ultra" | undefined;
                    width?: "narrow" | "wide" | undefined;
                } | undefined;
                notifications?: {
                    [x: string]: import("hono/utils/types").JSONValue;
                    enabled?: boolean | undefined;
                } | undefined;
                taskTable?: {
                    [x: string]: import("hono/utils/types").JSONValue;
                    expandedColumns?: {
                        [x: string]: boolean;
                    } | undefined;
                } | undefined;
                lastLocation?: {
                    projectId: string;
                    pathname: string;
                    search?: string | undefined;
                    hash?: string | undefined;
                } | undefined;
                importedSkills?: string[] | undefined;
            };
            outputFormat: "json";
            status: import("hono/utils/http-status").ContentfulStatusCode;
            input: {
                json: {
                    [x: string]: unknown;
                    appearance?: {
                        accent?: "lime" | "violet" | undefined;
                        density?: "comfortable" | "compact" | "ultra" | undefined;
                        width?: "narrow" | "wide" | undefined;
                    } | undefined;
                    notifications?: {
                        [x: string]: unknown;
                        enabled?: boolean | undefined;
                    } | undefined;
                    lastLocation?: {
                        projectId: string;
                        pathname: string;
                        search?: string | undefined;
                        hash?: string | undefined;
                    } | undefined;
                    sidebar?: {
                        [x: string]: unknown;
                        collapsed?: Record<string, boolean> | undefined;
                    } | undefined;
                    dismissedProviderAuthFailures?: {
                        claude?: string | undefined;
                        codex?: string | undefined;
                        opencode?: string | undefined;
                        pi?: string | undefined;
                    } | undefined;
                    importedSkills?: string[] | undefined;
                    taskTable?: {
                        [x: string]: unknown;
                        expandedColumns?: Record<string, boolean> | undefined;
                    } | undefined;
                };
            };
        } | {
            output: {
                error: string;
            };
            outputFormat: "json";
            status: 500;
            input: {
                json: {
                    [x: string]: unknown;
                    appearance?: {
                        accent?: "lime" | "violet" | undefined;
                        density?: "comfortable" | "compact" | "ultra" | undefined;
                        width?: "narrow" | "wide" | undefined;
                    } | undefined;
                    notifications?: {
                        [x: string]: unknown;
                        enabled?: boolean | undefined;
                    } | undefined;
                    lastLocation?: {
                        projectId: string;
                        pathname: string;
                        search?: string | undefined;
                        hash?: string | undefined;
                    } | undefined;
                    sidebar?: {
                        [x: string]: unknown;
                        collapsed?: Record<string, boolean> | undefined;
                    } | undefined;
                    dismissedProviderAuthFailures?: {
                        claude?: string | undefined;
                        codex?: string | undefined;
                        opencode?: string | undefined;
                        pi?: string | undefined;
                    } | undefined;
                    importedSkills?: string[] | undefined;
                    taskTable?: {
                        [x: string]: unknown;
                        expandedColumns?: Record<string, boolean> | undefined;
                    } | undefined;
                };
            };
        };
    };
}, "/"> | import("hono/types").MergeSchemaPath<{
    "/workspace/agent-profiles": {
        $get: {
            output: {
                editable: boolean;
                profiles: ({
                    exists: boolean;
                    looksValid: boolean;
                    id: string;
                    provider: "claude" | "codex" | "opencode" | "pi";
                    label: string;
                    configDir: string;
                    path: string;
                    isDefault: boolean;
                    status: {
                        provider: ProviderId;
                        status: import("../core/provider-auth.ts").ProviderConnectionState;
                        enabled?: boolean;
                        hint?: string;
                        authFailureId?: string;
                        profileId?: string;
                    };
                    files: {
                        id: string;
                        label: string;
                        path: string;
                        exists: boolean;
                    }[];
                } | {
                    exists: boolean;
                    looksValid: boolean;
                    id: string;
                    provider: "claude" | "codex" | "opencode" | "pi";
                    label: string;
                    configDir: string;
                    path: string;
                    isDefault: boolean;
                    files: {
                        id: string;
                        label: string;
                        path: string;
                        exists: boolean;
                    }[];
                })[];
                profileCapableProviders: ("claude" | "codex" | "opencode" | "pi")[];
                selections: {
                    [x: string]: {
                        [x: string]: import("hono/utils/types").JSONValue;
                        claude?: string | undefined;
                        codex?: string | undefined;
                        opencode?: string | undefined;
                        pi?: string | undefined;
                    };
                };
                defaults: {
                    [x: string]: import("hono/utils/types").JSONValue;
                    claude?: string | undefined;
                    codex?: string | undefined;
                    opencode?: string | undefined;
                    pi?: string | undefined;
                };
            };
            outputFormat: "json";
            status: import("hono/utils/http-status").ContentfulStatusCode;
            input: {};
        };
    };
} & {
    "/workspace/agent-profiles": {
        $post: {
            output: {
                error: string;
            };
            outputFormat: "json";
            status: 409;
            input: {
                json: {
                    provider: "claude" | "codex" | "opencode" | "pi";
                    label?: string | undefined;
                    configDir: string;
                };
            };
        } | {
            output: {
                error: string;
            };
            outputFormat: "json";
            status: 400;
            input: {
                json: {
                    provider: "claude" | "codex" | "opencode" | "pi";
                    label?: string | undefined;
                    configDir: string;
                };
            };
        } | {
            output: {
                error: string;
            };
            outputFormat: "json";
            status: 500;
            input: {
                json: {
                    provider: "claude" | "codex" | "opencode" | "pi";
                    label?: string | undefined;
                    configDir: string;
                };
            };
        } | {
            output: {
                profile: {
                    exists: boolean;
                    looksValid: boolean;
                    id: string;
                    provider: "claude" | "codex" | "opencode" | "pi";
                    label: string;
                    configDir: string;
                    path: string;
                    isDefault: boolean;
                    status: {
                        provider: ProviderId;
                        status: import("../core/provider-auth.ts").ProviderConnectionState;
                        enabled?: boolean;
                        hint?: string;
                        authFailureId?: string;
                        profileId?: string;
                    };
                    files: {
                        id: string;
                        label: string;
                        path: string;
                        exists: boolean;
                    }[];
                } | {
                    exists: boolean;
                    looksValid: boolean;
                    id: string;
                    provider: "claude" | "codex" | "opencode" | "pi";
                    label: string;
                    configDir: string;
                    path: string;
                    isDefault: boolean;
                    files: {
                        id: string;
                        label: string;
                        path: string;
                        exists: boolean;
                    }[];
                };
            };
            outputFormat: "json";
            status: 201;
            input: {
                json: {
                    provider: "claude" | "codex" | "opencode" | "pi";
                    label?: string | undefined;
                    configDir: string;
                };
            };
        };
    };
} & {
    "/workspace/agent-profiles/:id": {
        $patch: {
            output: {
                error: string;
            };
            outputFormat: "json";
            status: 400;
            input: {
                param: {
                    id: string;
                };
            } & {
                json: {
                    label?: string | undefined;
                    configDir?: string | undefined;
                };
            };
        } | {
            output: {
                error: string;
            };
            outputFormat: "json";
            status: 409;
            input: {
                param: {
                    id: string;
                };
            } & {
                json: {
                    label?: string | undefined;
                    configDir?: string | undefined;
                };
            };
        } | {
            output: {
                error: string;
            };
            outputFormat: "json";
            status: 400;
            input: {
                param: {
                    id: string;
                };
            } & {
                json: {
                    label?: string | undefined;
                    configDir?: string | undefined;
                };
            };
        } | {
            output: {
                error: string;
            };
            outputFormat: "json";
            status: 404;
            input: {
                param: {
                    id: string;
                };
            } & {
                json: {
                    label?: string | undefined;
                    configDir?: string | undefined;
                };
            };
        } | {
            output: {
                error: string;
            };
            outputFormat: "json";
            status: 500;
            input: {
                param: {
                    id: string;
                };
            } & {
                json: {
                    label?: string | undefined;
                    configDir?: string | undefined;
                };
            };
        } | {
            output: {
                profile: {
                    exists: boolean;
                    looksValid: boolean;
                    id: string;
                    provider: "claude" | "codex" | "opencode" | "pi";
                    label: string;
                    configDir: string;
                    path: string;
                    isDefault: boolean;
                    status: {
                        provider: ProviderId;
                        status: import("../core/provider-auth.ts").ProviderConnectionState;
                        enabled?: boolean;
                        hint?: string;
                        authFailureId?: string;
                        profileId?: string;
                    };
                    files: {
                        id: string;
                        label: string;
                        path: string;
                        exists: boolean;
                    }[];
                } | {
                    exists: boolean;
                    looksValid: boolean;
                    id: string;
                    provider: "claude" | "codex" | "opencode" | "pi";
                    label: string;
                    configDir: string;
                    path: string;
                    isDefault: boolean;
                    files: {
                        id: string;
                        label: string;
                        path: string;
                        exists: boolean;
                    }[];
                };
            };
            outputFormat: "json";
            status: import("hono/utils/http-status").ContentfulStatusCode;
            input: {
                param: {
                    id: string;
                };
            } & {
                json: {
                    label?: string | undefined;
                    configDir?: string | undefined;
                };
            };
        };
    };
} & {
    "/workspace/agent-profiles/:id/status": {
        $get: {
            output: {
                error: string;
            };
            outputFormat: "json";
            status: 400;
            input: {
                param: {
                    id: string;
                };
            } & {
                query: {
                    refresh?: "1" | undefined;
                };
            };
        } | {
            output: {
                error: string;
            };
            outputFormat: "json";
            status: 409;
            input: {
                param: {
                    id: string;
                };
            } & {
                query: {
                    refresh?: "1" | undefined;
                };
            };
        } | {
            output: {
                error: string;
            };
            outputFormat: "json";
            status: 404;
            input: {
                param: {
                    id: string;
                };
            } & {
                query: {
                    refresh?: "1" | undefined;
                };
            };
        } | {
            output: {
                status: {
                    provider: ProviderId;
                    status: import("../core/provider-auth.ts").ProviderConnectionState;
                    enabled?: boolean;
                    hint?: string;
                    authFailureId?: string;
                    profileId?: string;
                };
            };
            outputFormat: "json";
            status: import("hono/utils/http-status").ContentfulStatusCode;
            input: {
                param: {
                    id: string;
                };
            } & {
                query: {
                    refresh?: "1" | undefined;
                };
            };
        };
    };
} & {
    "/workspace/agent-profiles/:id/details": {
        $get: {
            output: {
                error: string;
            };
            outputFormat: "json";
            status: 400;
            input: {
                param: {
                    id: string;
                };
            };
        } | {
            output: {
                error: string;
            };
            outputFormat: "json";
            status: 409;
            input: {
                param: {
                    id: string;
                };
            };
        } | {
            output: {
                error: string;
            };
            outputFormat: "json";
            status: 404;
            input: {
                param: {
                    id: string;
                };
            };
        } | {
            output: {
                available: boolean;
                reason?: string;
                fields: {
                    label: string;
                    value: string;
                }[];
            };
            outputFormat: "json";
            status: import("hono/utils/http-status").ContentfulStatusCode;
            input: {
                param: {
                    id: string;
                };
            };
        };
    };
} & {
    "/workspace/agent-profiles/:id/open": {
        $post: {
            output: {
                error: string;
            };
            outputFormat: "json";
            status: 400;
            input: {
                param: {
                    id: string;
                };
            } & {
                json: {
                    file: string;
                    target?: string | undefined;
                };
            };
        } | {
            output: {
                error: string;
            };
            outputFormat: "json";
            status: 409;
            input: {
                param: {
                    id: string;
                };
            } & {
                json: {
                    file: string;
                    target?: string | undefined;
                };
            };
        } | {
            output: {
                error: string;
            };
            outputFormat: "json";
            status: 404;
            input: {
                param: {
                    id: string;
                };
            } & {
                json: {
                    file: string;
                    target?: string | undefined;
                };
            };
        } | {
            output: {
                error: string;
            };
            outputFormat: "json";
            status: 400;
            input: {
                param: {
                    id: string;
                };
            } & {
                json: {
                    file: string;
                    target?: string | undefined;
                };
            };
        } | {
            output: {
                opened: true;
                path: string;
            };
            outputFormat: "json";
            status: import("hono/utils/http-status").ContentfulStatusCode;
            input: {
                param: {
                    id: string;
                };
            } & {
                json: {
                    file: string;
                    target?: string | undefined;
                };
            };
        };
    };
} & {
    "/workspace/agent-profiles/selection": {
        $put: {
            output: {
                error: string;
            };
            outputFormat: "json";
            status: 409;
            input: {
                json: {
                    projectId: string | null;
                    provider: "claude" | "codex" | "opencode" | "pi";
                    profileId: string | null;
                };
            };
        } | {
            output: {
                error: string;
            };
            outputFormat: "json";
            status: 404;
            input: {
                json: {
                    projectId: string | null;
                    provider: "claude" | "codex" | "opencode" | "pi";
                    profileId: string | null;
                };
            };
        } | {
            output: {
                error: string;
            };
            outputFormat: "json";
            status: 400;
            input: {
                json: {
                    projectId: string | null;
                    provider: "claude" | "codex" | "opencode" | "pi";
                    profileId: string | null;
                };
            };
        } | {
            output: {
                error: string;
            };
            outputFormat: "json";
            status: 500;
            input: {
                json: {
                    projectId: string | null;
                    provider: "claude" | "codex" | "opencode" | "pi";
                    profileId: string | null;
                };
            };
        } | {
            output: {
                selections: {
                    [x: string]: {
                        [x: string]: import("hono/utils/types").JSONValue;
                        claude?: string | undefined;
                        codex?: string | undefined;
                        opencode?: string | undefined;
                        pi?: string | undefined;
                    };
                };
                defaults: {
                    [x: string]: import("hono/utils/types").JSONValue;
                    claude?: string | undefined;
                    codex?: string | undefined;
                    opencode?: string | undefined;
                    pi?: string | undefined;
                };
            };
            outputFormat: "json";
            status: import("hono/utils/http-status").ContentfulStatusCode;
            input: {
                json: {
                    projectId: string | null;
                    provider: "claude" | "codex" | "opencode" | "pi";
                    profileId: string | null;
                };
            };
        };
    };
} & {
    "/workspace/agent-profiles/:id": {
        $delete: {
            output: {
                error: string;
            };
            outputFormat: "json";
            status: 400;
            input: {
                param: {
                    id: string;
                };
            };
        } | {
            output: {
                error: string;
            };
            outputFormat: "json";
            status: 409;
            input: {
                param: {
                    id: string;
                };
            };
        } | {
            output: {
                error: string;
            };
            outputFormat: "json";
            status: 500;
            input: {
                param: {
                    id: string;
                };
            };
        } | {
            output: {
                error: string;
            };
            outputFormat: "json";
            status: 404;
            input: {
                param: {
                    id: string;
                };
            };
        } | {
            output: {
                removed: true;
                id: string;
            };
            outputFormat: "json";
            status: import("hono/utils/http-status").ContentfulStatusCode;
            input: {
                param: {
                    id: string;
                };
            };
        };
    };
}, "/">, "/api/v1"> | import("hono/types").MergeSchemaPath<import("hono/types").BlankSchema | import("hono/types").MergeSchemaPath<{
    "/launch-key": {
        $get: {
            output: {
                key: string;
            };
            outputFormat: "json";
            status: import("hono/utils/http-status").ContentfulStatusCode;
            input: {};
        };
    };
}, "/"> | import("hono/types").MergeSchemaPath<{
    "/plan": {
        $post: {
            output: {
                error: string;
            };
            outputFormat: "json";
            status: 409;
            input: {
                json: {
                    task: string;
                };
            };
        } | {
            output: {
                name?: string;
                steps: {
                    id: string;
                    name?: string | undefined;
                    prompt?: string | undefined;
                    skill?: string | undefined;
                    model?: string | undefined;
                    runner?: "auto" | "claude" | "codex" | "opencode" | "pi" | undefined;
                    allowedTools?: string[] | undefined;
                    bashAllowlist?: string[] | undefined;
                    command?: string | undefined;
                    onFail?: {
                        retry: string;
                        max: number;
                    } | undefined;
                }[];
                rationale: string;
                fallback: boolean;
            };
            outputFormat: "json";
            status: import("hono/utils/http-status").ContentfulStatusCode;
            input: {
                json: {
                    task: string;
                };
            };
        };
    };
}, "/"> | import("hono/types").MergeSchemaPath<{
    "/ui-state": {
        $get: {
            output: {
                [x: string]: import("hono/utils/types").JSONValue;
                lastTask?: {
                    source: "baseline";
                } | {
                    source: "skill" | "workflow";
                    ref: string;
                } | undefined;
                recentSources?: ({
                    source: "baseline";
                } | {
                    source: "skill" | "workflow";
                    ref: string;
                })[] | undefined;
                lastWorktree?: boolean | undefined;
                lastAutonomous?: boolean | undefined;
                lastGenerateFollowups?: boolean | undefined;
                skillUsage?: {
                    [x: string]: number;
                } | undefined;
                runsView?: "list" | "table" | undefined;
                githubView?: "issues" | "prs" | undefined;
                appearance?: {
                    accent?: "lime" | "violet" | undefined;
                    density?: "comfortable" | "compact" | "ultra" | undefined;
                    width?: "narrow" | "wide" | undefined;
                } | undefined;
                promptTemplates?: {
                    id: string;
                    label: string;
                    text: string;
                    skills?: string[] | undefined;
                }[] | undefined;
                dismissedSkillsBanner?: boolean | undefined;
            };
            outputFormat: "json";
            status: import("hono/utils/http-status").ContentfulStatusCode;
            input: {};
        };
    };
} & {
    "/ui-state": {
        $put: {
            output: {
                error: string;
            };
            outputFormat: "json";
            status: 500;
            input: {
                json: {
                    [x: string]: unknown;
                    lastTask?: {
                        source: "baseline";
                    } | {
                        source: "skill" | "workflow";
                        ref: string;
                    } | undefined;
                    recentSources?: ({
                        source: "baseline";
                    } | {
                        source: "skill" | "workflow";
                        ref: string;
                    })[] | undefined;
                    lastWorktree?: boolean | undefined;
                    lastAutonomous?: boolean | undefined;
                    lastGenerateFollowups?: boolean | undefined;
                    skillUsage?: Record<string, number> | undefined;
                    runsView?: "list" | "table" | undefined;
                    githubView?: "issues" | "prs" | undefined;
                    appearance?: {
                        accent?: "lime" | "violet" | undefined;
                        density?: "comfortable" | "compact" | "ultra" | undefined;
                        width?: "narrow" | "wide" | undefined;
                    } | undefined;
                    promptTemplates?: {
                        id: string;
                        label: string;
                        text: string;
                        skills?: string[] | undefined;
                    }[] | undefined;
                    dismissedSkillsBanner?: boolean | undefined;
                };
            };
        } | {
            output: {
                [x: string]: import("hono/utils/types").JSONValue;
                lastTask?: {
                    source: "baseline";
                } | {
                    source: "skill" | "workflow";
                    ref: string;
                } | undefined;
                recentSources?: ({
                    source: "baseline";
                } | {
                    source: "skill" | "workflow";
                    ref: string;
                })[] | undefined;
                lastWorktree?: boolean | undefined;
                lastAutonomous?: boolean | undefined;
                lastGenerateFollowups?: boolean | undefined;
                skillUsage?: {
                    [x: string]: number;
                } | undefined;
                runsView?: "list" | "table" | undefined;
                githubView?: "issues" | "prs" | undefined;
                appearance?: {
                    accent?: "lime" | "violet" | undefined;
                    density?: "comfortable" | "compact" | "ultra" | undefined;
                    width?: "narrow" | "wide" | undefined;
                } | undefined;
                promptTemplates?: {
                    id: string;
                    label: string;
                    text: string;
                    skills?: string[] | undefined;
                }[] | undefined;
                dismissedSkillsBanner?: boolean | undefined;
            };
            outputFormat: "json";
            status: import("hono/utils/http-status").ContentfulStatusCode;
            input: {
                json: {
                    [x: string]: unknown;
                    lastTask?: {
                        source: "baseline";
                    } | {
                        source: "skill" | "workflow";
                        ref: string;
                    } | undefined;
                    recentSources?: ({
                        source: "baseline";
                    } | {
                        source: "skill" | "workflow";
                        ref: string;
                    })[] | undefined;
                    lastWorktree?: boolean | undefined;
                    lastAutonomous?: boolean | undefined;
                    lastGenerateFollowups?: boolean | undefined;
                    skillUsage?: Record<string, number> | undefined;
                    runsView?: "list" | "table" | undefined;
                    githubView?: "issues" | "prs" | undefined;
                    appearance?: {
                        accent?: "lime" | "violet" | undefined;
                        density?: "comfortable" | "compact" | "ultra" | undefined;
                        width?: "narrow" | "wide" | undefined;
                    } | undefined;
                    promptTemplates?: {
                        id: string;
                        label: string;
                        text: string;
                        skills?: string[] | undefined;
                    }[] | undefined;
                    dismissedSkillsBanner?: boolean | undefined;
                };
            };
        };
    };
}, "/"> | import("hono/types").MergeSchemaPath<{
    "/groups/:groupId": {
        $get: {
            output: {
                error: string;
            };
            outputFormat: "json";
            status: 404;
            input: {
                param: {
                    groupId: string;
                };
            };
        } | {
            output: {
                groupId: string;
                runs: {
                    id: string;
                    variant: string;
                    title: string;
                    status: "cancelled" | "done" | "failed" | "queued" | "review" | "running" | "waiting";
                    archived: boolean;
                    tokensUsed: number;
                    inputTokens?: number | undefined;
                    outputTokens?: number | undefined;
                    costUsd?: number | undefined;
                    diffStat: string;
                    handoffExcerpt: string;
                }[];
            };
            outputFormat: "json";
            status: import("hono/utils/http-status").ContentfulStatusCode;
            input: {
                param: {
                    groupId: string;
                };
            };
        };
    };
} & {
    "/groups/:groupId/pick": {
        $post: {
            output: {
                error: string;
            };
            outputFormat: "json";
            status: 404;
            input: {
                json: {
                    runId: string;
                };
            } & {
                param: {
                    groupId: string;
                };
            };
        } | {
            output: {
                error: string;
            };
            outputFormat: "json";
            status: 409;
            input: {
                json: {
                    runId: string;
                };
            } & {
                param: {
                    groupId: string;
                };
            };
        } | {
            output: {
                winner?: {
                    id: string;
                    title: string;
                    titleSummary?: string | undefined;
                    diffStat?: {
                        adds: number;
                        dels: number;
                        files: number;
                        repointed?: boolean | undefined;
                    } | undefined;
                    workflow: string;
                    task: string;
                    queuedMessages?: {
                        id: string;
                        text: string;
                        images?: string[] | undefined;
                        createdAt: string;
                    }[] | undefined;
                    taskImages?: string[] | undefined;
                    model?: string | undefined;
                    reasoningEffort?: "auto" | "high" | "low" | "medium" | "xhigh" | undefined;
                    modelIdentity?: string | undefined;
                    runner?: "claude" | "codex" | "opencode" | "pi" | undefined;
                    requestedRunner?: "auto" | "claude" | "codex" | "opencode" | "pi" | undefined;
                    agentProfile?: string | undefined;
                    systemPrompt?: string | undefined;
                    generateFollowups?: boolean | undefined;
                    autonomous?: boolean | undefined;
                    automation?: {
                        automationId: string;
                        automationRevision: number;
                        receiptId: string;
                        event: string;
                        githubUrl: string;
                    } | undefined;
                    status: "cancelled" | "done" | "failed" | "queued" | "review" | "running" | "waiting";
                    activity?: "monitoring" | undefined;
                    monitoringWakeAt?: string | undefined;
                    monitoringWakeCapReached?: boolean | undefined;
                    autoResumeAt?: string | undefined;
                    autoResumeAttempts?: number | undefined;
                    blockedReason?: {
                        type: "provider_quota";
                        providers: ("claude" | "codex")[];
                        retryAt?: string | undefined;
                    } | undefined;
                    createdAt: string;
                    startedAt?: string | undefined;
                    finishedAt?: string | undefined;
                    tokensUsed: number;
                    inputTokens?: number | undefined;
                    outputTokens?: number | undefined;
                    costUsd?: number | undefined;
                    pullRequestUrl?: string | undefined;
                    referencedPullRequestUrl?: string | undefined;
                    prNumber?: number | undefined;
                    issueNumber?: number | undefined;
                    referencedIssueNumberSeeded?: boolean | undefined;
                    titleOrigin?: "auto" | "marker" | "user" | undefined;
                    markerRefs?: {
                        pr?: number | undefined;
                        issue?: number | undefined;
                    } | undefined;
                    referencedPrCandidates?: string[] | undefined;
                    referencedIssueUrl?: string | undefined;
                    referencedIssueCandidates?: string[] | undefined;
                    worktree?: false | undefined;
                    worktreePath?: string | undefined;
                    branch?: string | undefined;
                    baseBranch?: string | undefined;
                    worktreeReclaimedAt?: string | undefined;
                    groupId?: string | undefined;
                    variant?: string | undefined;
                    peakRssBytes?: number | undefined;
                    peakProcCount?: number | undefined;
                    archived: boolean;
                    archivedAt?: string | undefined;
                    seenAt?: string | undefined;
                    currentStepId?: string | undefined;
                    error?: string | undefined;
                    steps: {
                        id: string;
                        name: string;
                        kind: "agent" | "check";
                        status: "cancelled" | "done" | "failed" | "pending" | "review" | "running" | "skipped" | "waiting";
                        iterations: number;
                        tokensUsed: number;
                        inputTokens?: number | undefined;
                        outputTokens?: number | undefined;
                        usageInvocationsStarted?: number | undefined;
                        usageInvocationsObserved?: number | undefined;
                        usageTurnsStarted?: number | undefined;
                        usageTurnsRecorded?: number | undefined;
                        usageInvocationEpoch?: number | undefined;
                        startedAt?: string | undefined;
                        finishedAt?: string | undefined;
                        error?: string | undefined;
                        sessionId?: string | undefined;
                        backend?: "claude" | "codex" | "opencode" | "pi" | undefined;
                        requestedRunner?: "auto" | "claude" | "codex" | "opencode" | "pi" | undefined;
                        profileId?: string | undefined;
                        reasoningEffort?: "high" | "low" | "medium" | "xhigh" | undefined;
                        costUsd?: number | undefined;
                        modelIdentity?: string | undefined;
                    }[];
                    workflowDef?: {
                        name: string;
                        description?: string | undefined;
                        steps: {
                            id: string;
                            name?: string | undefined;
                            prompt?: string | undefined;
                            skill?: string | undefined;
                            model?: string | undefined;
                            runner?: "auto" | "claude" | "codex" | "opencode" | "pi" | undefined;
                            allowedTools?: string[] | undefined;
                            bashAllowlist?: string[] | undefined;
                            command?: string | undefined;
                            onFail?: {
                                retry: string;
                                max: number;
                            } | undefined;
                        }[];
                        source: "built-in" | "file";
                        path?: string | undefined;
                    } | undefined;
                } | undefined;
            };
            outputFormat: "json";
            status: import("hono/utils/http-status").ContentfulStatusCode;
            input: {
                json: {
                    runId: string;
                };
            } & {
                param: {
                    groupId: string;
                };
            };
        };
    };
}, "/"> | import("hono/types").MergeSchemaPath<{
    "/open-targets": {
        $get: {
            output: {
                targets: {
                    id: string;
                    label: string;
                    icon?: string;
                }[];
            };
            outputFormat: "json";
            status: import("hono/utils/http-status").ContentfulStatusCode;
            input: {};
        };
    };
} & {
    "/open-in": {
        $post: {
            output: {
                error: string;
            };
            outputFormat: "json";
            status: 409;
            input: {
                json: {
                    target: string;
                };
            };
        } | {
            output: {
                error: string;
            };
            outputFormat: "json";
            status: 400;
            input: {
                json: {
                    target: string;
                };
            };
        } | {
            output: {
                opened: true;
                path: string;
            };
            outputFormat: "json";
            status: import("hono/utils/http-status").ContentfulStatusCode;
            input: {
                json: {
                    target: string;
                };
            };
        };
    };
}, "/"> | import("hono/types").MergeSchemaPath<{
    "/worktrees": {
        $get: {
            output: {
                worktrees: {
                    runId: string;
                    title: string;
                    status: "cancelled" | "done" | "failed" | "queued" | "review" | "running" | "waiting";
                    branch: string | null;
                    sizeBytes: number | null;
                    finishedAt: string | null;
                    reclaimable: boolean;
                }[];
                totalBytes: number | null;
                keep: number;
            };
            outputFormat: "json";
            status: import("hono/utils/http-status").ContentfulStatusCode;
            input: {};
        };
    };
} & {
    "/worktrees/reclaim": {
        $post: {
            output: {
                reclaimed: string[];
            };
            outputFormat: "json";
            status: import("hono/utils/http-status").ContentfulStatusCode;
            input: {
                json: {
                    [x: string]: unknown;
                };
            };
        };
    };
}, "/"> | import("hono/types").MergeSchemaPath<{
    "/runs/:id/events": {
        $get: {
            output: {};
            outputFormat: string;
            status: import("hono/utils/http-status").StatusCode;
            input: {
                param: {
                    id: string;
                };
            } & {
                query: {
                    cursor?: string | undefined;
                    afterSeq?: number | undefined;
                };
            };
        } | {
            output: {
                error: string;
            };
            outputFormat: "json";
            status: 400;
            input: {
                param: {
                    id: string;
                };
            } & {
                query: {
                    cursor?: string | undefined;
                    afterSeq?: number | undefined;
                };
            };
        };
    };
} & {
    "/events": {
        $get: {
            output: {};
            outputFormat: string;
            status: import("hono/utils/http-status").StatusCode;
            input: {};
        };
    };
}, "/"> | import("hono/types").MergeSchemaPath<{
    "/config": {
        $get: {
            output: {
                baseBranch: string | null;
                defaultRunner: "auto" | "claude" | "codex" | "opencode" | "pi";
                systemPrompt: string | null;
                defaultModels: {
                    claude?: string | undefined;
                    codex?: string | undefined;
                    opencode?: string | undefined;
                    pi?: string | undefined;
                };
                modelsLocked: boolean;
                maxParallel: number;
                memoryLimitMb: number | null;
                worktreeRetention: number;
                liveTitleUpdates: boolean | null;
                reviewGate: boolean | null;
            };
            outputFormat: "json";
            status: import("hono/utils/http-status").ContentfulStatusCode;
            input: {};
        };
    };
} & {
    "/config": {
        $put: {
            output: {
                baseBranch: string | null;
                defaultRunner: "auto" | "claude" | "codex" | "opencode" | "pi";
                systemPrompt: string | null;
                defaultModels: {
                    claude?: string | undefined;
                    codex?: string | undefined;
                    opencode?: string | undefined;
                    pi?: string | undefined;
                };
                modelsLocked: boolean;
                maxParallel: number;
                memoryLimitMb: number | null;
                worktreeRetention: number;
                liveTitleUpdates: boolean | null;
                reviewGate: boolean | null;
            };
            outputFormat: "json";
            status: import("hono/utils/http-status").ContentfulStatusCode;
            input: {
                json: {
                    baseBranch?: string | null | undefined;
                    defaultRunner?: "auto" | "claude" | "codex" | "opencode" | "pi" | undefined;
                    systemPrompt?: string | null | undefined;
                    defaultModels?: {
                        claude?: string | null | undefined;
                        codex?: string | null | undefined;
                        opencode?: string | null | undefined;
                        pi?: string | null | undefined;
                    } | undefined;
                    maxParallel?: number | undefined;
                    memoryLimitMb?: number | null | undefined;
                    worktreeRetention?: number | null | undefined;
                    liveTitleUpdates?: boolean | null | undefined;
                    reviewGate?: boolean | null | undefined;
                };
            };
        } | {
            output: {
                error: string;
            };
            outputFormat: "json";
            status: 409;
            input: {
                json: {
                    baseBranch?: string | null | undefined;
                    defaultRunner?: "auto" | "claude" | "codex" | "opencode" | "pi" | undefined;
                    systemPrompt?: string | null | undefined;
                    defaultModels?: {
                        claude?: string | null | undefined;
                        codex?: string | null | undefined;
                        opencode?: string | null | undefined;
                        pi?: string | null | undefined;
                    } | undefined;
                    maxParallel?: number | undefined;
                    memoryLimitMb?: number | null | undefined;
                    worktreeRetention?: number | null | undefined;
                    liveTitleUpdates?: boolean | null | undefined;
                    reviewGate?: boolean | null | undefined;
                };
            };
        } | {
            output: {
                error: string;
            };
            outputFormat: "json";
            status: 500;
            input: {
                json: {
                    baseBranch?: string | null | undefined;
                    defaultRunner?: "auto" | "claude" | "codex" | "opencode" | "pi" | undefined;
                    systemPrompt?: string | null | undefined;
                    defaultModels?: {
                        claude?: string | null | undefined;
                        codex?: string | null | undefined;
                        opencode?: string | null | undefined;
                        pi?: string | null | undefined;
                    } | undefined;
                    maxParallel?: number | undefined;
                    memoryLimitMb?: number | null | undefined;
                    worktreeRetention?: number | null | undefined;
                    liveTitleUpdates?: boolean | null | undefined;
                    reviewGate?: boolean | null | undefined;
                };
            };
        };
    };
}, "/"> | import("hono/types").MergeSchemaPath<{
    "/skills": {
        $get: {
            output: {
                name: string;
                description?: string;
                interactive?: true;
                body: string;
                path: string;
                source: 'ai' | 'cezar' | 'agents' | 'global' | 'team';
                team?: {
                    repo: string;
                    ref: string;
                    path: string;
                    dir: boolean;
                    commit?: string;
                } | undefined;
            }[];
            outputFormat: "json";
            status: import("hono/utils/http-status").ContentfulStatusCode;
            input: {
                query: {
                    wait?: string | undefined;
                };
            };
        } | {
            output: {
                error: string;
            };
            outputFormat: "json";
            status: 400;
            input: {
                query: {
                    wait?: string | undefined;
                };
            };
        };
    };
} & {
    "/skills/importable": {
        $get: {
            output: {
                name: string;
                description?: string | undefined;
            }[];
            outputFormat: "json";
            status: import("hono/utils/http-status").ContentfulStatusCode;
            input: {
                query: {
                    wait?: string | undefined;
                };
            };
        } | {
            output: {
                error: string;
            };
            outputFormat: "json";
            status: 400;
            input: {
                query: {
                    wait?: string | undefined;
                };
            };
        };
    };
} & {
    "/skills/refresh": {
        $post: {
            output: {
                name: string;
                description?: string;
                interactive?: true;
                body: string;
                path: string;
                source: 'ai' | 'cezar' | 'agents' | 'global' | 'team';
                team?: {
                    repo: string;
                    ref: string;
                    path: string;
                    dir: boolean;
                    commit?: string;
                } | undefined;
            }[];
            outputFormat: "json";
            status: import("hono/utils/http-status").ContentfulStatusCode;
            input: {};
        };
    };
}, "/"> | import("hono/types").MergeSchemaPath<{
    "/todos": {
        $get: {
            output: {
                id: string;
                ts?: string | undefined;
                taskId?: string | undefined;
                summary: string;
                action?: string | undefined;
                prUrl?: string | undefined;
                suggestedSkill?: string | undefined;
                suggestedArgs?: string | undefined;
                suggestedPrompt?: string | undefined;
                runnable?: boolean | undefined;
                startedTaskId?: string | undefined;
            }[];
            outputFormat: "json";
            status: import("hono/utils/http-status").ContentfulStatusCode;
            input: {};
        };
    };
} & {
    "/todos/:id": {
        $delete: {
            output: {
                error: string;
            };
            outputFormat: "json";
            status: 409;
            input: {
                param: {
                    id: string;
                };
            };
        } | {
            output: {
                removed: true;
            };
            outputFormat: "json";
            status: import("hono/utils/http-status").ContentfulStatusCode;
            input: {
                param: {
                    id: string;
                };
            };
        } | {
            output: {
                error: string;
            };
            outputFormat: "json";
            status: 404;
            input: {
                param: {
                    id: string;
                };
            };
        };
    };
} & {
    "/todos/:id/start": {
        $post: {
            output: {
                error: string;
            };
            outputFormat: "json";
            status: 409;
            input: {
                json: {
                    runner?: "auto" | "claude" | "codex" | "opencode" | "pi" | undefined;
                    model?: string | undefined;
                    prompt?: string | undefined;
                } | undefined;
            } & {
                param: {
                    id: string;
                };
            };
        } | {
            output: {
                run: {
                    id: string;
                    title: string;
                    titleSummary?: string | undefined;
                    diffStat?: {
                        adds: number;
                        dels: number;
                        files: number;
                        repointed?: boolean | undefined;
                    } | undefined;
                    workflow: string;
                    task: string;
                    queuedMessages?: {
                        id: string;
                        text: string;
                        images?: string[] | undefined;
                        createdAt: string;
                    }[] | undefined;
                    taskImages?: string[] | undefined;
                    model?: string | undefined;
                    reasoningEffort?: "auto" | "high" | "low" | "medium" | "xhigh" | undefined;
                    modelIdentity?: string | undefined;
                    runner?: "claude" | "codex" | "opencode" | "pi" | undefined;
                    requestedRunner?: "auto" | "claude" | "codex" | "opencode" | "pi" | undefined;
                    agentProfile?: string | undefined;
                    systemPrompt?: string | undefined;
                    generateFollowups?: boolean | undefined;
                    autonomous?: boolean | undefined;
                    automation?: {
                        automationId: string;
                        automationRevision: number;
                        receiptId: string;
                        event: string;
                        githubUrl: string;
                    } | undefined;
                    status: "cancelled" | "done" | "failed" | "queued" | "review" | "running" | "waiting";
                    activity?: "monitoring" | undefined;
                    monitoringWakeAt?: string | undefined;
                    monitoringWakeCapReached?: boolean | undefined;
                    autoResumeAt?: string | undefined;
                    autoResumeAttempts?: number | undefined;
                    blockedReason?: {
                        type: "provider_quota";
                        providers: ("claude" | "codex")[];
                        retryAt?: string | undefined;
                    } | undefined;
                    createdAt: string;
                    startedAt?: string | undefined;
                    finishedAt?: string | undefined;
                    tokensUsed: number;
                    inputTokens?: number | undefined;
                    outputTokens?: number | undefined;
                    costUsd?: number | undefined;
                    pullRequestUrl?: string | undefined;
                    referencedPullRequestUrl?: string | undefined;
                    prNumber?: number | undefined;
                    issueNumber?: number | undefined;
                    referencedIssueNumberSeeded?: boolean | undefined;
                    titleOrigin?: "auto" | "marker" | "user" | undefined;
                    markerRefs?: {
                        pr?: number | undefined;
                        issue?: number | undefined;
                    } | undefined;
                    referencedPrCandidates?: string[] | undefined;
                    referencedIssueUrl?: string | undefined;
                    referencedIssueCandidates?: string[] | undefined;
                    worktree?: false | undefined;
                    worktreePath?: string | undefined;
                    branch?: string | undefined;
                    baseBranch?: string | undefined;
                    worktreeReclaimedAt?: string | undefined;
                    groupId?: string | undefined;
                    variant?: string | undefined;
                    peakRssBytes?: number | undefined;
                    peakProcCount?: number | undefined;
                    archived: boolean;
                    archivedAt?: string | undefined;
                    seenAt?: string | undefined;
                    currentStepId?: string | undefined;
                    error?: string | undefined;
                    steps: {
                        id: string;
                        name: string;
                        kind: "agent" | "check";
                        status: "cancelled" | "done" | "failed" | "pending" | "review" | "running" | "skipped" | "waiting";
                        iterations: number;
                        tokensUsed: number;
                        inputTokens?: number | undefined;
                        outputTokens?: number | undefined;
                        usageInvocationsStarted?: number | undefined;
                        usageInvocationsObserved?: number | undefined;
                        usageTurnsStarted?: number | undefined;
                        usageTurnsRecorded?: number | undefined;
                        usageInvocationEpoch?: number | undefined;
                        startedAt?: string | undefined;
                        finishedAt?: string | undefined;
                        error?: string | undefined;
                        sessionId?: string | undefined;
                        backend?: "claude" | "codex" | "opencode" | "pi" | undefined;
                        requestedRunner?: "auto" | "claude" | "codex" | "opencode" | "pi" | undefined;
                        profileId?: string | undefined;
                        reasoningEffort?: "high" | "low" | "medium" | "xhigh" | undefined;
                        costUsd?: number | undefined;
                        modelIdentity?: string | undefined;
                    }[];
                    workflowDef?: {
                        name: string;
                        description?: string | undefined;
                        steps: {
                            id: string;
                            name?: string | undefined;
                            prompt?: string | undefined;
                            skill?: string | undefined;
                            model?: string | undefined;
                            runner?: "auto" | "claude" | "codex" | "opencode" | "pi" | undefined;
                            allowedTools?: string[] | undefined;
                            bashAllowlist?: string[] | undefined;
                            command?: string | undefined;
                            onFail?: {
                                retry: string;
                                max: number;
                            } | undefined;
                        }[];
                        source: "built-in" | "file";
                        path?: string | undefined;
                    } | undefined;
                };
            };
            outputFormat: "json";
            status: 201;
            input: {
                json: {
                    runner?: "auto" | "claude" | "codex" | "opencode" | "pi" | undefined;
                    model?: string | undefined;
                    prompt?: string | undefined;
                } | undefined;
            } & {
                param: {
                    id: string;
                };
            };
        } | {
            output: {
                error: string;
            };
            outputFormat: "json";
            status: 409;
            input: {
                json: {
                    runner?: "auto" | "claude" | "codex" | "opencode" | "pi" | undefined;
                    model?: string | undefined;
                    prompt?: string | undefined;
                } | undefined;
            } & {
                param: {
                    id: string;
                };
            };
        } | {
            output: {
                error: string;
            };
            outputFormat: "json";
            status: 404;
            input: {
                json: {
                    runner?: "auto" | "claude" | "codex" | "opencode" | "pi" | undefined;
                    model?: string | undefined;
                    prompt?: string | undefined;
                } | undefined;
            } & {
                param: {
                    id: string;
                };
            };
        };
    };
}, "/"> | import("hono/types").MergeSchemaPath<{
    "/agent-config": {
        $get: {
            output: {
                editable: boolean;
                files: {
                    id: string;
                    runners: import("../agent-config/catalog.ts").ConfigFileDef['runners'];
                    kind: import("../agent-config/catalog.ts").ConfigFileDef['kind'];
                    scope: import("../agent-config/catalog.ts").ConfigFileDef['scope'];
                    label: string;
                    path: string;
                    format: import("../agent-config/catalog.ts").ConfigFileDef['format'];
                    tracked: import("../agent-config/catalog.ts").ConfigFileDef['tracked'];
                    seeded: boolean;
                    holdsMcp: boolean;
                    precedence: string;
                    hotReload?: string;
                    docsUrl: string;
                    exists: boolean;
                    size: number;
                    version: string | null;
                    writable: boolean;
                    readOnlyReason?: string;
                }[];
                userMcp: import("../agent-config/service.ts").UserMcpListing | null;
            };
            outputFormat: "json";
            status: import("hono/utils/http-status").ContentfulStatusCode;
            input: {};
        };
    };
} & {
    "/agent-config/:id": {
        $get: {
            output: {
                error: string;
            };
            outputFormat: "json";
            status: 404;
            input: {
                param: {
                    id: string;
                };
            };
        } | {
            output: {
                error: string;
            };
            outputFormat: "json";
            status: 409;
            input: {
                param: {
                    id: string;
                };
            };
        } | {
            output: {
                error: string;
            };
            outputFormat: "json";
            status: 500;
            input: {
                param: {
                    id: string;
                };
            };
        } | {
            output: {
                id: string;
                path: string;
                exists: boolean;
                content: string;
                version: string | null;
            };
            outputFormat: "json";
            status: import("hono/utils/http-status").ContentfulStatusCode;
            input: {
                param: {
                    id: string;
                };
            };
        };
    };
} & {
    "/agent-config/:id": {
        $put: {
            output: {
                id: string;
                path: string;
                exists: boolean;
                content: string;
                version: string | null;
            };
            outputFormat: "json";
            status: import("hono/utils/http-status").ContentfulStatusCode;
            input: {
                json: {
                    content: string;
                    version: string | null;
                };
            } & {
                param: {
                    id: string;
                };
            };
        } | {
            output: {
                error: string;
            };
            outputFormat: "json";
            status: 404;
            input: {
                json: {
                    content: string;
                    version: string | null;
                };
            } & {
                param: {
                    id: string;
                };
            };
        } | {
            output: {
                error: string;
            };
            outputFormat: "json";
            status: 400 | 409 | 500;
            input: {
                json: {
                    content: string;
                    version: string | null;
                };
            } & {
                param: {
                    id: string;
                };
            };
        };
    };
}, "/"> | import("hono/types").MergeSchemaPath<{
    "/ide/tree": {
        $get: {
            output: {
                error: string;
            };
            outputFormat: "json";
            status: 400;
            input: {
                query: {
                    path?: string | undefined;
                };
            };
        } | {
            output: {
                error: string;
            };
            outputFormat: "json";
            status: 400 | 404 | 409;
            input: {
                query: {
                    path?: string | undefined;
                };
            };
        } | {
            output: {
                path: string;
                entries: {
                    name: string;
                    path: string;
                    type: 'dir' | 'file';
                    size?: number;
                }[];
                truncated: boolean;
            };
            outputFormat: "json";
            status: import("hono/utils/http-status").ContentfulStatusCode;
            input: {
                query: {
                    path?: string | undefined;
                };
            };
        };
    };
} & {
    "/ide/file": {
        $get: {
            output: {
                error: string;
            };
            outputFormat: "json";
            status: 400;
            input: {
                query: {
                    path: string | string[];
                };
            };
        } | {
            output: {
                error: string;
            };
            outputFormat: "json";
            status: 400 | 404 | 409;
            input: {
                query: {
                    path: string | string[];
                };
            };
        } | {
            output: {
                path: string;
                content: string;
                size: number;
            };
            outputFormat: "json";
            status: import("hono/utils/http-status").ContentfulStatusCode;
            input: {
                query: {
                    path: string | string[];
                };
            };
        };
    };
} & {
    "/ide/file": {
        $put: {
            output: {
                path: string;
                content: string;
                size: number;
            };
            outputFormat: "json";
            status: import("hono/utils/http-status").ContentfulStatusCode;
            input: {
                json: {
                    path: string;
                    content: string;
                };
            };
        } | {
            output: {
                error: string;
            };
            outputFormat: "json";
            status: 400 | 404 | 409;
            input: {
                json: {
                    path: string;
                    content: string;
                };
            };
        };
    };
}, "/"> | import("hono/types").MergeSchemaPath<{
    "/workflows": {
        $get: {
            output: {
                workflows: {
                    name: string;
                    description?: string | undefined;
                    steps: {
                        id: string;
                        name?: string | undefined;
                        prompt?: string | undefined;
                        skill?: string | undefined;
                        model?: string | undefined;
                        runner?: "auto" | "claude" | "codex" | "opencode" | "pi" | undefined;
                        allowedTools?: string[] | undefined;
                        bashAllowlist?: string[] | undefined;
                        command?: string | undefined;
                        onFail?: {
                            retry: string;
                            max: number;
                        } | undefined;
                    }[];
                    source: "built-in" | "file";
                    path?: string | undefined;
                }[];
                issues: {
                    path: string;
                    message: string;
                }[];
            };
            outputFormat: "json";
            status: import("hono/utils/http-status").ContentfulStatusCode;
            input: {};
        };
    };
} & {
    "/workflows": {
        $post: {
            output: {
                error: string;
            };
            outputFormat: "json";
            status: 400;
            input: {
                json: {
                    name: string;
                    description?: string | undefined;
                    steps?: {
                        id: string;
                        name?: string | undefined;
                        prompt?: string | undefined;
                        skill?: string | undefined;
                        model?: string | undefined;
                        runner?: "auto" | "claude" | "codex" | "opencode" | "pi" | undefined;
                        allowedTools?: string[] | undefined;
                        bashAllowlist?: string[] | undefined;
                        command?: string | undefined;
                        onFail?: {
                            retry: string;
                            max?: number | undefined;
                        } | undefined;
                    }[] | undefined;
                    skills?: string[] | undefined;
                    overwrite?: boolean | undefined;
                };
            };
        } | {
            output: {
                error: string;
                exists: true;
            };
            outputFormat: "json";
            status: 409;
            input: {
                json: {
                    name: string;
                    description?: string | undefined;
                    steps?: {
                        id: string;
                        name?: string | undefined;
                        prompt?: string | undefined;
                        skill?: string | undefined;
                        model?: string | undefined;
                        runner?: "auto" | "claude" | "codex" | "opencode" | "pi" | undefined;
                        allowedTools?: string[] | undefined;
                        bashAllowlist?: string[] | undefined;
                        command?: string | undefined;
                        onFail?: {
                            retry: string;
                            max?: number | undefined;
                        } | undefined;
                    }[] | undefined;
                    skills?: string[] | undefined;
                    overwrite?: boolean | undefined;
                };
            };
        } | {
            output: {
                error: string;
            };
            outputFormat: "json";
            status: 500;
            input: {
                json: {
                    name: string;
                    description?: string | undefined;
                    steps?: {
                        id: string;
                        name?: string | undefined;
                        prompt?: string | undefined;
                        skill?: string | undefined;
                        model?: string | undefined;
                        runner?: "auto" | "claude" | "codex" | "opencode" | "pi" | undefined;
                        allowedTools?: string[] | undefined;
                        bashAllowlist?: string[] | undefined;
                        command?: string | undefined;
                        onFail?: {
                            retry: string;
                            max?: number | undefined;
                        } | undefined;
                    }[] | undefined;
                    skills?: string[] | undefined;
                    overwrite?: boolean | undefined;
                };
            };
        } | {
            output: {
                path: string;
                name: string;
            };
            outputFormat: "json";
            status: 201;
            input: {
                json: {
                    name: string;
                    description?: string | undefined;
                    steps?: {
                        id: string;
                        name?: string | undefined;
                        prompt?: string | undefined;
                        skill?: string | undefined;
                        model?: string | undefined;
                        runner?: "auto" | "claude" | "codex" | "opencode" | "pi" | undefined;
                        allowedTools?: string[] | undefined;
                        bashAllowlist?: string[] | undefined;
                        command?: string | undefined;
                        onFail?: {
                            retry: string;
                            max?: number | undefined;
                        } | undefined;
                    }[] | undefined;
                    skills?: string[] | undefined;
                    overwrite?: boolean | undefined;
                };
            };
        };
    };
} & {
    "/workflows/:name": {
        $delete: {
            output: {
                error: string;
            };
            outputFormat: "json";
            status: 404;
            input: {
                param: {
                    name: string;
                };
            };
        } | {
            output: {
                error: string;
            };
            outputFormat: "json";
            status: 400;
            input: {
                param: {
                    name: string;
                };
            };
        } | {
            output: {
                error: string;
            };
            outputFormat: "json";
            status: 500;
            input: {
                param: {
                    name: string;
                };
            };
        } | {
            output: {
                ok: true;
                path: string;
            };
            outputFormat: "json";
            status: import("hono/utils/http-status").ContentfulStatusCode;
            input: {
                param: {
                    name: string;
                };
            };
        };
    };
} & {
    "/workflows/parse": {
        $post: {
            output: {
                error: string;
            };
            outputFormat: "json";
            status: 400;
            input: {
                json: {
                    yaml: string;
                };
            };
        } | {
            output: {
                name: string;
                description?: string;
                steps: {
                    id: string;
                    name?: string | undefined;
                    prompt?: string | undefined;
                    skill?: string | undefined;
                    model?: string | undefined;
                    runner?: "auto" | "claude" | "codex" | "opencode" | "pi" | undefined;
                    allowedTools?: string[] | undefined;
                    bashAllowlist?: string[] | undefined;
                    command?: string | undefined;
                    onFail?: {
                        retry: string;
                        max: number;
                    } | undefined;
                }[];
            };
            outputFormat: "json";
            status: import("hono/utils/http-status").ContentfulStatusCode;
            input: {
                json: {
                    yaml: string;
                };
            };
        };
    };
}, "/"> | import("hono/types").MergeSchemaPath<{
    "/repo": {
        $get: {
            output: {
                info: null;
                status: never[];
                log: never[];
                branches: never[];
                baseBranch: null;
            };
            outputFormat: "json";
            status: import("hono/utils/http-status").ContentfulStatusCode;
            input: {};
        } | {
            output: {
                info: {
                    root: string;
                    branch: string;
                    remote?: string;
                };
                status: {
                    status: string;
                    path: string;
                }[];
                log: {
                    hash: string;
                    subject: string;
                    author: string;
                    when: string;
                }[];
                branches: string[];
                baseBranch: string | null;
            };
            outputFormat: "json";
            status: import("hono/utils/http-status").ContentfulStatusCode;
            input: {};
        };
    };
} & {
    "/repo/diff": {
        $get: {
            output: string;
            outputFormat: "text";
            status: import("hono/utils/http-status").ContentfulStatusCode;
            input: {};
        };
    };
} & {
    "/repo/commit/:sha": {
        $get: {
            output: string;
            outputFormat: "text";
            status: import("hono/utils/http-status").ContentfulStatusCode;
            input: {
                query: {
                    structured?: string | undefined;
                };
            } & {
                param: {
                    sha: string;
                };
            };
        } | {
            output: {
                error: string;
            };
            outputFormat: "json";
            status: 400;
            input: {
                query: {
                    structured?: string | undefined;
                };
            } & {
                param: {
                    sha: string;
                };
            };
        } | {
            output: {
                sha: string;
                subject: string;
                author: string;
                when: string;
                files: {
                    path: string;
                    oldPath?: string;
                    status: 'added' | 'modified' | 'deleted' | 'renamed' | 'copied';
                    adds: number;
                    dels: number;
                    binary: boolean;
                    image?: boolean;
                    patch: string;
                }[];
                stat: {
                    adds: number;
                    dels: number;
                    files: number;
                };
            };
            outputFormat: "json";
            status: import("hono/utils/http-status").ContentfulStatusCode;
            input: {
                query: {
                    structured?: string | undefined;
                };
            } & {
                param: {
                    sha: string;
                };
            };
        } | {
            output: {
                error: string;
            };
            outputFormat: "json";
            status: 409;
            input: {
                query: {
                    structured?: string | undefined;
                };
            } & {
                param: {
                    sha: string;
                };
            };
        };
    };
} & {
    "/repo/changes": {
        $get: {
            output: {
                files: {
                    path: string;
                    oldPath?: string;
                    status: 'added' | 'modified' | 'deleted' | 'renamed' | 'copied';
                    adds: number;
                    dels: number;
                    binary: boolean;
                    image?: boolean;
                    patch: string;
                }[];
                stat: {
                    adds: number;
                    dels: number;
                    files: number;
                };
                repointedHead?: {
                    headBranch: string;
                    taskBranch: string;
                } | undefined;
            };
            outputFormat: "json";
            status: import("hono/utils/http-status").ContentfulStatusCode;
            input: {};
        } | {
            output: {
                error: string;
            };
            outputFormat: "json";
            status: 409;
            input: {};
        };
    };
} & {
    "/repo/branch": {
        $post: {
            output: {
                error: string;
            };
            outputFormat: "json";
            status: 409;
            input: {
                json: {
                    name: string;
                    from?: string | undefined;
                };
            };
        } | {
            output: {
                branch: string;
                created: boolean;
            };
            outputFormat: "json";
            status: import("hono/utils/http-status").ContentfulStatusCode;
            input: {
                json: {
                    name: string;
                    from?: string | undefined;
                };
            };
        };
    };
}, "/"> | import("hono/types").MergeSchemaPath<{
    "/github": {
        $get: {
            output: {
                error: string;
            };
            outputFormat: "json";
            status: 400;
            input: {
                query: {
                    limit?: string | undefined;
                    refresh?: string | undefined;
                };
            };
        } | {
            output: {
                available: boolean;
                reason?: string;
                repo?: string;
                syncedAt?: string;
                issues: {
                    kind: 'issue' | 'pr';
                    number: number;
                    title: string;
                    author: string;
                    createdAt: string;
                    labels: string[];
                    body: string;
                    url: string;
                    comments: number;
                    isDraft?: boolean;
                    additions?: number;
                    deletions?: number;
                    checks?: 'passing' | 'failing' | 'pending' | null;
                }[];
                prs: {
                    kind: 'issue' | 'pr';
                    number: number;
                    title: string;
                    author: string;
                    createdAt: string;
                    labels: string[];
                    body: string;
                    url: string;
                    comments: number;
                    isDraft?: boolean;
                    additions?: number;
                    deletions?: number;
                    checks?: 'passing' | 'failing' | 'pending' | null;
                }[];
                labelColors?: {
                    [x: string]: string;
                } | undefined;
            };
            outputFormat: "json";
            status: import("hono/utils/http-status").ContentfulStatusCode;
            input: {
                query: {
                    limit?: string | undefined;
                    refresh?: string | undefined;
                };
            };
        };
    };
} & {
    "/github/comments/:kind/:number": {
        $get: {
            output: {
                error: string;
            };
            outputFormat: "json";
            status: 400;
            input: {
                query: {
                    refresh?: string | undefined;
                };
            } & {
                param: {
                    kind: string;
                } & {
                    number: string;
                };
            };
        } | {
            output: {
                error: string;
            };
            outputFormat: "json";
            status: 400;
            input: {
                query: {
                    refresh?: string | undefined;
                };
            } & {
                param: {
                    kind: string;
                } & {
                    number: string;
                };
            };
        } | {
            output: {
                available: boolean;
                reason?: string;
                comments: {
                    id: number;
                    author: string;
                    avatarUrl?: string;
                    createdAt: string;
                    body: string;
                    kind: 'comment' | 'review';
                    reviewState?: 'approved' | 'changes_requested' | 'commented' | 'dismissed';
                    url: string;
                }[];
                truncated?: boolean;
                events?: {
                    id: string;
                    kind: import("./github.ts").ForgeTimelineEventKind;
                    actor: string;
                    avatarUrl?: string;
                    createdAt: string;
                    url?: string;
                    sha?: string;
                    message?: string;
                    checks?: 'passing' | 'failing' | 'pending' | null;
                    label?: {
                        name: string;
                        color?: string;
                    } | undefined;
                    subject?: string;
                    refNumber?: number;
                    refTitle?: string;
                    refIsPr?: boolean;
                }[] | undefined;
            };
            outputFormat: "json";
            status: import("hono/utils/http-status").ContentfulStatusCode;
            input: {
                query: {
                    refresh?: string | undefined;
                };
            } & {
                param: {
                    kind: string;
                } & {
                    number: string;
                };
            };
        };
    };
} & {
    "/github/checks": {
        $get: {
            output: {
                error: string;
            };
            outputFormat: "json";
            status: 400;
            input: {
                query: {
                    prs: string | string[];
                };
            };
        } | {
            output: {
                error: string;
            };
            outputFormat: "json";
            status: 400;
            input: {
                query: {
                    prs: string | string[];
                };
            };
        } | {
            output: {
                available: true;
                checks: {
                    [x: number]: import("./forge/github.ts").ChecksGlyph;
                };
            } | {
                available: false;
                reason: string;
            };
            outputFormat: "json";
            status: import("hono/utils/http-status").ContentfulStatusCode;
            input: {
                query: {
                    prs: string | string[];
                };
            };
        };
    };
} & {
    "/github/ref-status": {
        $get: {
            output: {
                error: string;
            };
            outputFormat: "json";
            status: 400;
            input: {
                query: {
                    prs?: string | undefined;
                    issues?: string | undefined;
                };
            };
        } | {
            output: {
                error: string;
            };
            outputFormat: "json";
            status: 400;
            input: {
                query: {
                    prs?: string | undefined;
                    issues?: string | undefined;
                };
            };
        } | {
            output: {
                available: true;
                prs: {
                    [x: number]: import("./github.ts").ReferenceStatus;
                };
                issues: {
                    [x: number]: import("./github.ts").ReferenceStatus;
                };
                recheckAfterMs: number | null;
            } | {
                available: false;
                reason: string;
                recheckAfterMs: number | null;
            };
            outputFormat: "json";
            status: import("hono/utils/http-status").ContentfulStatusCode;
            input: {
                query: {
                    prs?: string | undefined;
                    issues?: string | undefined;
                };
            };
        };
    };
} & {
    "/github/prs/:number/merge-state": {
        $get: {
            output: {
                error: string;
            };
            outputFormat: "json";
            status: 400;
            input: {
                param: {
                    number: string;
                };
            } & {
                query: {
                    refresh?: string | undefined;
                };
            };
        } | {
            output: {
                available: true;
                mergeState: {
                    number: number;
                    title: string;
                    url: string;
                    state: 'open' | 'closed' | 'merged';
                    isDraft: boolean;
                    headRef: string;
                    baseRef: string;
                    headSha: string;
                    mergeable: 'mergeable' | 'conflicting' | 'unknown';
                    reviewDecision: 'approved' | 'changes-requested' | 'review-required' | 'unknown';
                    checks: {
                        name: string;
                        state: 'passing' | 'failing' | 'pending' | 'unknown';
                        required: boolean | null;
                        url?: string;
                    }[];
                    methods: import("./forge/types.ts").ForgeMergeMethod[];
                    defaultMethod: import("./forge/types.ts").ForgeMergeMethod | null;
                    eligibility: 'ready' | 'blocked' | 'pending' | 'unauthorized' | 'terminal' | 'unknown';
                    blockers: {
                        code: string;
                        message: string;
                    }[];
                    canMerge: boolean;
                    canOverride: boolean;
                };
            } | {
                available: false;
                reason: string;
            };
            outputFormat: "json";
            status: import("hono/utils/http-status").ContentfulStatusCode;
            input: {
                param: {
                    number: string;
                };
            } & {
                query: {
                    refresh?: string | undefined;
                };
            };
        };
    };
} & {
    "/github/prs/:number/merge": {
        $post: {
            output: {
                error: string;
            };
            outputFormat: "json";
            status: 400;
            input: {
                param: {
                    number: string;
                };
            } & {
                json: {
                    method: "merge" | "rebase" | "squash";
                    expectedHeadSha: string;
                    overrideRules?: boolean | undefined;
                };
            };
        } | {
            output: {
                error: string;
            };
            outputFormat: "json";
            status: 409;
            input: {
                param: {
                    number: string;
                };
            } & {
                json: {
                    method: "merge" | "rebase" | "squash";
                    expectedHeadSha: string;
                    overrideRules?: boolean | undefined;
                };
            };
        } | {
            output: {
                merged: true;
                number: number;
                url: string;
                method: import("./forge/types.ts").ForgeMergeMethod;
                mergeCommitSha?: string;
            };
            outputFormat: "json";
            status: import("hono/utils/http-status").ContentfulStatusCode;
            input: {
                param: {
                    number: string;
                };
            } & {
                json: {
                    method: "merge" | "rebase" | "squash";
                    expectedHeadSha: string;
                    overrideRules?: boolean | undefined;
                };
            };
        } | {
            output: {
                error: string;
                code?: string | undefined;
                current?: {
                    number: number;
                    title: string;
                    url: string;
                    state: 'open' | 'closed' | 'merged';
                    isDraft: boolean;
                    headRef: string;
                    baseRef: string;
                    headSha: string;
                    mergeable: 'mergeable' | 'conflicting' | 'unknown';
                    reviewDecision: 'approved' | 'changes-requested' | 'review-required' | 'unknown';
                    checks: {
                        name: string;
                        state: 'passing' | 'failing' | 'pending' | 'unknown';
                        required: boolean | null;
                        url?: string;
                    }[];
                    methods: import("./forge/types.ts").ForgeMergeMethod[];
                    defaultMethod: import("./forge/types.ts").ForgeMergeMethod | null;
                    eligibility: 'ready' | 'blocked' | 'pending' | 'unauthorized' | 'terminal' | 'unknown';
                    blockers: {
                        code: string;
                        message: string;
                    }[];
                    canMerge: boolean;
                    canOverride: boolean;
                } | undefined;
            };
            outputFormat: "json";
            status: 403 | 404 | 409 | 502;
            input: {
                param: {
                    number: string;
                };
            } & {
                json: {
                    method: "merge" | "rebase" | "squash";
                    expectedHeadSha: string;
                    overrideRules?: boolean | undefined;
                };
            };
        };
    };
} & {
    "/github/prs/:number/changes": {
        $get: {
            output: {
                error: string;
            };
            outputFormat: "json";
            status: 400;
            input: {
                param: {
                    number: string;
                };
            } & {
                query: {
                    refresh?: "1" | undefined;
                };
            };
        } | {
            output: {
                error: string;
            };
            outputFormat: "json";
            status: 404;
            input: {
                param: {
                    number: string;
                };
            } & {
                query: {
                    refresh?: "1" | undefined;
                };
            };
        } | {
            output: {
                available: true;
                number: number;
                headSha: string;
                files: {
                    path: string;
                    previousPath?: string;
                    status: 'added' | 'modified' | 'removed' | 'renamed' | 'copied' | 'changed';
                    additions: number;
                    deletions: number;
                    patch?: string;
                    patchUnavailableReason?: 'binary' | 'too-large' | 'not-provided';
                    truncated?: boolean;
                }[];
                additions: number;
                deletions: number;
                truncated: boolean;
                reason?: string;
            } | {
                available: false;
                reason: string;
            };
            outputFormat: "json";
            status: import("hono/utils/http-status").ContentfulStatusCode;
            input: {
                param: {
                    number: string;
                };
            } & {
                query: {
                    refresh?: "1" | undefined;
                };
            };
        };
    };
}, "/"> | import("hono/types").MergeSchemaPath<{
    "/automations": {
        $get: {
            output: {
                available: boolean;
                reason?: string;
                scheduler: {
                    state: "idle" | "scheduled";
                    nextDue?: string | undefined;
                };
                automations: {
                    id: string;
                    revision: number;
                    name: string;
                    description?: string | undefined;
                    enabled: boolean;
                    events: ("issue.labeled" | "issue.opened" | "issue.unlabeled" | "pull_request.opened")[];
                    intervalSeconds: number;
                    filters: {
                        [x: string]: import("hono/utils/types").JSONValue;
                        authors?: string[] | undefined;
                        assignees?: string[] | undefined;
                        allLabels?: string[] | undefined;
                        anyLabels?: string[] | undefined;
                        excludeLabels?: string[] | undefined;
                        changedLabels?: string[] | undefined;
                        lookbackDays: number;
                        maxRecords: number;
                    };
                    task: {
                        [x: string]: import("hono/utils/types").JSONValue;
                        prompt: string;
                        workflow?: string | undefined;
                        steps?: {
                            id: string;
                            name?: string | undefined;
                            prompt?: string | undefined;
                            skill?: string | undefined;
                            model?: string | undefined;
                            runner?: "auto" | "claude" | "codex" | "opencode" | "pi" | undefined;
                            allowedTools?: string[] | undefined;
                            bashAllowlist?: string[] | undefined;
                            command?: string | undefined;
                            onFail?: {
                                retry: string;
                                max: number;
                            } | undefined;
                        }[] | undefined;
                        runner?: "auto" | "claude" | "codex" | "opencode" | "pi" | undefined;
                        model?: string | undefined;
                        variants?: 1 | 2 | 3 | undefined;
                        worktree?: boolean | undefined;
                        generateFollowups?: boolean | undefined;
                        autonomous?: boolean | undefined;
                        systemPrompt?: string | undefined;
                    };
                    createdAt: string;
                    updatedAt: string;
                    state?: {
                        [x: string]: import("hono/utils/types").JSONValue;
                        revision?: number | undefined;
                        baselineAt?: string | undefined;
                        cursor?: {
                            [x: string]: import("hono/utils/types").JSONValue;
                            timestamp: string;
                            tieBreaker?: string | undefined;
                        } | undefined;
                        frozenHighWatermark?: {
                            [x: string]: import("hono/utils/types").JSONValue;
                            timestamp: string;
                            tieBreaker: string;
                        } | undefined;
                        backlogAfter?: {
                            [x: string]: import("hono/utils/types").JSONValue;
                            timestamp: string;
                            tieBreaker: string;
                        } | undefined;
                        nextCheckAt?: string | undefined;
                        lastSuccessAt?: string | undefined;
                        etags?: {
                            [x: string]: string;
                        } | undefined;
                        backoffUntil?: string | undefined;
                        consecutiveFailures?: number | undefined;
                    } | undefined;
                    latestLog?: {
                        [x: string]: import("hono/utils/types").JSONValue;
                        seq: number;
                        ts: string;
                        automationId: string;
                        revision: number;
                        event?: "issue.labeled" | "issue.opened" | "issue.unlabeled" | "pull_request.opened" | undefined;
                        result: "baseline" | "duplicate" | "error" | "launched" | "no-match" | "preview" | "rate-limited";
                        reason?: string | undefined;
                        durationMs?: number | undefined;
                        receiptId?: string | undefined;
                        runId?: string | undefined;
                        githubNumber?: number | undefined;
                        githubTitle?: string | undefined;
                        githubUrl?: string | undefined;
                        rateLimit?: {
                            [x: string]: import("hono/utils/types").JSONValue;
                            bucket: "core" | "search";
                            remaining?: number | undefined;
                            resetAt?: string | undefined;
                        } | undefined;
                    } | undefined;
                    counts: {
                        matches: number;
                        launched: number;
                        duplicates: number;
                        errors: number;
                    };
                }[];
            };
            outputFormat: "json";
            status: import("hono/utils/http-status").ContentfulStatusCode;
            input: {};
        };
    };
} & {
    "/automations": {
        $post: {
            output: {
                error: string;
            };
            outputFormat: "json";
            status: 400;
            input: {
                json: {
                    name: string;
                    description?: string | undefined;
                    enabled?: boolean | undefined;
                    events: ("issue.labeled" | "issue.opened" | "issue.unlabeled" | "pull_request.opened")[];
                    intervalSeconds: number;
                    filters: {
                        [x: string]: unknown;
                        authors?: string[] | undefined;
                        assignees?: string[] | undefined;
                        allLabels?: string[] | undefined;
                        anyLabels?: string[] | undefined;
                        excludeLabels?: string[] | undefined;
                        changedLabels?: string[] | undefined;
                        lookbackDays?: number | undefined;
                        maxRecords?: number | undefined;
                    };
                    task: {
                        [x: string]: unknown;
                        prompt: string;
                        workflow?: string | undefined;
                        steps?: {
                            id: string;
                            name?: string | undefined;
                            prompt?: string | undefined;
                            skill?: string | undefined;
                            model?: string | undefined;
                            runner?: "auto" | "claude" | "codex" | "opencode" | "pi" | undefined;
                            allowedTools?: string[] | undefined;
                            bashAllowlist?: string[] | undefined;
                            command?: string | undefined;
                            onFail?: {
                                retry: string;
                                max?: number | undefined;
                            } | undefined;
                        }[] | undefined;
                        runner?: "auto" | "claude" | "codex" | "opencode" | "pi" | undefined;
                        model?: string | undefined;
                        variants?: 1 | 2 | 3 | undefined;
                        worktree?: boolean | undefined;
                        generateFollowups?: boolean | undefined;
                        autonomous?: boolean | undefined;
                        systemPrompt?: string | undefined;
                    };
                    enable?: boolean | undefined;
                };
            };
        } | {
            output: {
                automation: {
                    [x: string]: import("hono/utils/types").JSONValue;
                    id: string;
                    revision: number;
                    name: string;
                    description?: string | undefined;
                    enabled: boolean;
                    events: ("issue.labeled" | "issue.opened" | "issue.unlabeled" | "pull_request.opened")[];
                    intervalSeconds: number;
                    filters: {
                        [x: string]: import("hono/utils/types").JSONValue;
                        authors?: string[] | undefined;
                        assignees?: string[] | undefined;
                        allLabels?: string[] | undefined;
                        anyLabels?: string[] | undefined;
                        excludeLabels?: string[] | undefined;
                        changedLabels?: string[] | undefined;
                        lookbackDays: number;
                        maxRecords: number;
                    };
                    task: {
                        [x: string]: import("hono/utils/types").JSONValue;
                        prompt: string;
                        workflow?: string | undefined;
                        steps?: {
                            id: string;
                            name?: string | undefined;
                            prompt?: string | undefined;
                            skill?: string | undefined;
                            model?: string | undefined;
                            runner?: "auto" | "claude" | "codex" | "opencode" | "pi" | undefined;
                            allowedTools?: string[] | undefined;
                            bashAllowlist?: string[] | undefined;
                            command?: string | undefined;
                            onFail?: {
                                retry: string;
                                max: number;
                            } | undefined;
                        }[] | undefined;
                        runner?: "auto" | "claude" | "codex" | "opencode" | "pi" | undefined;
                        model?: string | undefined;
                        variants?: 1 | 2 | 3 | undefined;
                        worktree?: boolean | undefined;
                        generateFollowups?: boolean | undefined;
                        autonomous?: boolean | undefined;
                        systemPrompt?: string | undefined;
                    };
                    createdAt: string;
                    updatedAt: string;
                };
            };
            outputFormat: "json";
            status: 201;
            input: {
                json: {
                    name: string;
                    description?: string | undefined;
                    enabled?: boolean | undefined;
                    events: ("issue.labeled" | "issue.opened" | "issue.unlabeled" | "pull_request.opened")[];
                    intervalSeconds: number;
                    filters: {
                        [x: string]: unknown;
                        authors?: string[] | undefined;
                        assignees?: string[] | undefined;
                        allLabels?: string[] | undefined;
                        anyLabels?: string[] | undefined;
                        excludeLabels?: string[] | undefined;
                        changedLabels?: string[] | undefined;
                        lookbackDays?: number | undefined;
                        maxRecords?: number | undefined;
                    };
                    task: {
                        [x: string]: unknown;
                        prompt: string;
                        workflow?: string | undefined;
                        steps?: {
                            id: string;
                            name?: string | undefined;
                            prompt?: string | undefined;
                            skill?: string | undefined;
                            model?: string | undefined;
                            runner?: "auto" | "claude" | "codex" | "opencode" | "pi" | undefined;
                            allowedTools?: string[] | undefined;
                            bashAllowlist?: string[] | undefined;
                            command?: string | undefined;
                            onFail?: {
                                retry: string;
                                max?: number | undefined;
                            } | undefined;
                        }[] | undefined;
                        runner?: "auto" | "claude" | "codex" | "opencode" | "pi" | undefined;
                        model?: string | undefined;
                        variants?: 1 | 2 | 3 | undefined;
                        worktree?: boolean | undefined;
                        generateFollowups?: boolean | undefined;
                        autonomous?: boolean | undefined;
                        systemPrompt?: string | undefined;
                    };
                    enable?: boolean | undefined;
                };
            };
        };
    };
} & {
    "/automations/:id": {
        $get: {
            output: {
                error: string;
            };
            outputFormat: "json";
            status: 404;
            input: {
                param: {
                    id: string;
                };
            };
        } | {
            output: {
                automation: {
                    [x: string]: import("hono/utils/types").JSONValue;
                    id: string;
                    revision: number;
                    name: string;
                    description?: string | undefined;
                    enabled: boolean;
                    events: ("issue.labeled" | "issue.opened" | "issue.unlabeled" | "pull_request.opened")[];
                    intervalSeconds: number;
                    filters: {
                        [x: string]: import("hono/utils/types").JSONValue;
                        authors?: string[] | undefined;
                        assignees?: string[] | undefined;
                        allLabels?: string[] | undefined;
                        anyLabels?: string[] | undefined;
                        excludeLabels?: string[] | undefined;
                        changedLabels?: string[] | undefined;
                        lookbackDays: number;
                        maxRecords: number;
                    };
                    task: {
                        [x: string]: import("hono/utils/types").JSONValue;
                        prompt: string;
                        workflow?: string | undefined;
                        steps?: {
                            id: string;
                            name?: string | undefined;
                            prompt?: string | undefined;
                            skill?: string | undefined;
                            model?: string | undefined;
                            runner?: "auto" | "claude" | "codex" | "opencode" | "pi" | undefined;
                            allowedTools?: string[] | undefined;
                            bashAllowlist?: string[] | undefined;
                            command?: string | undefined;
                            onFail?: {
                                retry: string;
                                max: number;
                            } | undefined;
                        }[] | undefined;
                        runner?: "auto" | "claude" | "codex" | "opencode" | "pi" | undefined;
                        model?: string | undefined;
                        variants?: 1 | 2 | 3 | undefined;
                        worktree?: boolean | undefined;
                        generateFollowups?: boolean | undefined;
                        autonomous?: boolean | undefined;
                        systemPrompt?: string | undefined;
                    };
                    createdAt: string;
                    updatedAt: string;
                };
                state?: {
                    [x: string]: import("hono/utils/types").JSONValue;
                    revision?: number | undefined;
                    baselineAt?: string | undefined;
                    cursor?: {
                        [x: string]: import("hono/utils/types").JSONValue;
                        timestamp: string;
                        tieBreaker?: string | undefined;
                    } | undefined;
                    frozenHighWatermark?: {
                        [x: string]: import("hono/utils/types").JSONValue;
                        timestamp: string;
                        tieBreaker: string;
                    } | undefined;
                    backlogAfter?: {
                        [x: string]: import("hono/utils/types").JSONValue;
                        timestamp: string;
                        tieBreaker: string;
                    } | undefined;
                    nextCheckAt?: string | undefined;
                    lastSuccessAt?: string | undefined;
                    etags?: {
                        [x: string]: string;
                    } | undefined;
                    backoffUntil?: string | undefined;
                    consecutiveFailures?: number | undefined;
                } | undefined;
                latestLog?: {
                    [x: string]: import("hono/utils/types").JSONValue;
                    seq: number;
                    ts: string;
                    automationId: string;
                    revision: number;
                    event?: "issue.labeled" | "issue.opened" | "issue.unlabeled" | "pull_request.opened" | undefined;
                    result: "baseline" | "duplicate" | "error" | "launched" | "no-match" | "preview" | "rate-limited";
                    reason?: string | undefined;
                    durationMs?: number | undefined;
                    receiptId?: string | undefined;
                    runId?: string | undefined;
                    githubNumber?: number | undefined;
                    githubTitle?: string | undefined;
                    githubUrl?: string | undefined;
                    rateLimit?: {
                        [x: string]: import("hono/utils/types").JSONValue;
                        bucket: "core" | "search";
                        remaining?: number | undefined;
                        resetAt?: string | undefined;
                    } | undefined;
                } | undefined;
            };
            outputFormat: "json";
            status: import("hono/utils/http-status").ContentfulStatusCode;
            input: {
                param: {
                    id: string;
                };
            };
        };
    };
} & {
    "/automations/:id": {
        $put: {
            output: {
                error: string;
            };
            outputFormat: "json";
            status: 404;
            input: {
                json: {
                    name: string;
                    description?: string | undefined;
                    enabled?: boolean | undefined;
                    events: ("issue.labeled" | "issue.opened" | "issue.unlabeled" | "pull_request.opened")[];
                    intervalSeconds: number;
                    filters: {
                        [x: string]: unknown;
                        authors?: string[] | undefined;
                        assignees?: string[] | undefined;
                        allLabels?: string[] | undefined;
                        anyLabels?: string[] | undefined;
                        excludeLabels?: string[] | undefined;
                        changedLabels?: string[] | undefined;
                        lookbackDays?: number | undefined;
                        maxRecords?: number | undefined;
                    };
                    task: {
                        [x: string]: unknown;
                        prompt: string;
                        workflow?: string | undefined;
                        steps?: {
                            id: string;
                            name?: string | undefined;
                            prompt?: string | undefined;
                            skill?: string | undefined;
                            model?: string | undefined;
                            runner?: "auto" | "claude" | "codex" | "opencode" | "pi" | undefined;
                            allowedTools?: string[] | undefined;
                            bashAllowlist?: string[] | undefined;
                            command?: string | undefined;
                            onFail?: {
                                retry: string;
                                max?: number | undefined;
                            } | undefined;
                        }[] | undefined;
                        runner?: "auto" | "claude" | "codex" | "opencode" | "pi" | undefined;
                        model?: string | undefined;
                        variants?: 1 | 2 | 3 | undefined;
                        worktree?: boolean | undefined;
                        generateFollowups?: boolean | undefined;
                        autonomous?: boolean | undefined;
                        systemPrompt?: string | undefined;
                    };
                    expectedRevision: number;
                };
            } & {
                param: {
                    id: string;
                };
            };
        } | {
            output: {
                automation: {
                    [x: string]: import("hono/utils/types").JSONValue;
                    id: string;
                    revision: number;
                    name: string;
                    description?: string | undefined;
                    enabled: boolean;
                    events: ("issue.labeled" | "issue.opened" | "issue.unlabeled" | "pull_request.opened")[];
                    intervalSeconds: number;
                    filters: {
                        [x: string]: import("hono/utils/types").JSONValue;
                        authors?: string[] | undefined;
                        assignees?: string[] | undefined;
                        allLabels?: string[] | undefined;
                        anyLabels?: string[] | undefined;
                        excludeLabels?: string[] | undefined;
                        changedLabels?: string[] | undefined;
                        lookbackDays: number;
                        maxRecords: number;
                    };
                    task: {
                        [x: string]: import("hono/utils/types").JSONValue;
                        prompt: string;
                        workflow?: string | undefined;
                        steps?: {
                            id: string;
                            name?: string | undefined;
                            prompt?: string | undefined;
                            skill?: string | undefined;
                            model?: string | undefined;
                            runner?: "auto" | "claude" | "codex" | "opencode" | "pi" | undefined;
                            allowedTools?: string[] | undefined;
                            bashAllowlist?: string[] | undefined;
                            command?: string | undefined;
                            onFail?: {
                                retry: string;
                                max: number;
                            } | undefined;
                        }[] | undefined;
                        runner?: "auto" | "claude" | "codex" | "opencode" | "pi" | undefined;
                        model?: string | undefined;
                        variants?: 1 | 2 | 3 | undefined;
                        worktree?: boolean | undefined;
                        generateFollowups?: boolean | undefined;
                        autonomous?: boolean | undefined;
                        systemPrompt?: string | undefined;
                    };
                    createdAt: string;
                    updatedAt: string;
                };
            };
            outputFormat: "json";
            status: import("hono/utils/http-status").ContentfulStatusCode;
            input: {
                json: {
                    name: string;
                    description?: string | undefined;
                    enabled?: boolean | undefined;
                    events: ("issue.labeled" | "issue.opened" | "issue.unlabeled" | "pull_request.opened")[];
                    intervalSeconds: number;
                    filters: {
                        [x: string]: unknown;
                        authors?: string[] | undefined;
                        assignees?: string[] | undefined;
                        allLabels?: string[] | undefined;
                        anyLabels?: string[] | undefined;
                        excludeLabels?: string[] | undefined;
                        changedLabels?: string[] | undefined;
                        lookbackDays?: number | undefined;
                        maxRecords?: number | undefined;
                    };
                    task: {
                        [x: string]: unknown;
                        prompt: string;
                        workflow?: string | undefined;
                        steps?: {
                            id: string;
                            name?: string | undefined;
                            prompt?: string | undefined;
                            skill?: string | undefined;
                            model?: string | undefined;
                            runner?: "auto" | "claude" | "codex" | "opencode" | "pi" | undefined;
                            allowedTools?: string[] | undefined;
                            bashAllowlist?: string[] | undefined;
                            command?: string | undefined;
                            onFail?: {
                                retry: string;
                                max?: number | undefined;
                            } | undefined;
                        }[] | undefined;
                        runner?: "auto" | "claude" | "codex" | "opencode" | "pi" | undefined;
                        model?: string | undefined;
                        variants?: 1 | 2 | 3 | undefined;
                        worktree?: boolean | undefined;
                        generateFollowups?: boolean | undefined;
                        autonomous?: boolean | undefined;
                        systemPrompt?: string | undefined;
                    };
                    expectedRevision: number;
                };
            } & {
                param: {
                    id: string;
                };
            };
        } | {
            output: {
                error: string;
            };
            outputFormat: "json";
            status: 400 | 409;
            input: {
                json: {
                    name: string;
                    description?: string | undefined;
                    enabled?: boolean | undefined;
                    events: ("issue.labeled" | "issue.opened" | "issue.unlabeled" | "pull_request.opened")[];
                    intervalSeconds: number;
                    filters: {
                        [x: string]: unknown;
                        authors?: string[] | undefined;
                        assignees?: string[] | undefined;
                        allLabels?: string[] | undefined;
                        anyLabels?: string[] | undefined;
                        excludeLabels?: string[] | undefined;
                        changedLabels?: string[] | undefined;
                        lookbackDays?: number | undefined;
                        maxRecords?: number | undefined;
                    };
                    task: {
                        [x: string]: unknown;
                        prompt: string;
                        workflow?: string | undefined;
                        steps?: {
                            id: string;
                            name?: string | undefined;
                            prompt?: string | undefined;
                            skill?: string | undefined;
                            model?: string | undefined;
                            runner?: "auto" | "claude" | "codex" | "opencode" | "pi" | undefined;
                            allowedTools?: string[] | undefined;
                            bashAllowlist?: string[] | undefined;
                            command?: string | undefined;
                            onFail?: {
                                retry: string;
                                max?: number | undefined;
                            } | undefined;
                        }[] | undefined;
                        runner?: "auto" | "claude" | "codex" | "opencode" | "pi" | undefined;
                        model?: string | undefined;
                        variants?: 1 | 2 | 3 | undefined;
                        worktree?: boolean | undefined;
                        generateFollowups?: boolean | undefined;
                        autonomous?: boolean | undefined;
                        systemPrompt?: string | undefined;
                    };
                    expectedRevision: number;
                };
            } & {
                param: {
                    id: string;
                };
            };
        };
    };
} & {
    "/automations/:id": {
        $delete: {
            output: null;
            outputFormat: "body";
            status: 204;
            input: {
                param: {
                    id: string;
                };
            };
        } | {
            output: {
                error: string;
            };
            outputFormat: "json";
            status: 404;
            input: {
                param: {
                    id: string;
                };
            };
        };
    };
} & {
    "/automations/:id/enable": {
        $post: {
            output: {
                error: string;
            };
            outputFormat: "json";
            status: 404;
            input: {
                param: {
                    id: string;
                };
            };
        } | {
            output: {
                automation: {
                    [x: string]: import("hono/utils/types").JSONValue;
                    id: string;
                    revision: number;
                    name: string;
                    description?: string | undefined;
                    enabled: boolean;
                    events: ("issue.labeled" | "issue.opened" | "issue.unlabeled" | "pull_request.opened")[];
                    intervalSeconds: number;
                    filters: {
                        [x: string]: import("hono/utils/types").JSONValue;
                        authors?: string[] | undefined;
                        assignees?: string[] | undefined;
                        allLabels?: string[] | undefined;
                        anyLabels?: string[] | undefined;
                        excludeLabels?: string[] | undefined;
                        changedLabels?: string[] | undefined;
                        lookbackDays: number;
                        maxRecords: number;
                    };
                    task: {
                        [x: string]: import("hono/utils/types").JSONValue;
                        prompt: string;
                        workflow?: string | undefined;
                        steps?: {
                            id: string;
                            name?: string | undefined;
                            prompt?: string | undefined;
                            skill?: string | undefined;
                            model?: string | undefined;
                            runner?: "auto" | "claude" | "codex" | "opencode" | "pi" | undefined;
                            allowedTools?: string[] | undefined;
                            bashAllowlist?: string[] | undefined;
                            command?: string | undefined;
                            onFail?: {
                                retry: string;
                                max: number;
                            } | undefined;
                        }[] | undefined;
                        runner?: "auto" | "claude" | "codex" | "opencode" | "pi" | undefined;
                        model?: string | undefined;
                        variants?: 1 | 2 | 3 | undefined;
                        worktree?: boolean | undefined;
                        generateFollowups?: boolean | undefined;
                        autonomous?: boolean | undefined;
                        systemPrompt?: string | undefined;
                    };
                    createdAt: string;
                    updatedAt: string;
                };
            };
            outputFormat: "json";
            status: import("hono/utils/http-status").ContentfulStatusCode;
            input: {
                param: {
                    id: string;
                };
            };
        };
    };
} & {
    "/automations/:id/pause": {
        $post: {
            output: {
                error: string;
            };
            outputFormat: "json";
            status: 404;
            input: {
                param: {
                    id: string;
                };
            };
        } | {
            output: {
                automation: {
                    [x: string]: import("hono/utils/types").JSONValue;
                    id: string;
                    revision: number;
                    name: string;
                    description?: string | undefined;
                    enabled: boolean;
                    events: ("issue.labeled" | "issue.opened" | "issue.unlabeled" | "pull_request.opened")[];
                    intervalSeconds: number;
                    filters: {
                        [x: string]: import("hono/utils/types").JSONValue;
                        authors?: string[] | undefined;
                        assignees?: string[] | undefined;
                        allLabels?: string[] | undefined;
                        anyLabels?: string[] | undefined;
                        excludeLabels?: string[] | undefined;
                        changedLabels?: string[] | undefined;
                        lookbackDays: number;
                        maxRecords: number;
                    };
                    task: {
                        [x: string]: import("hono/utils/types").JSONValue;
                        prompt: string;
                        workflow?: string | undefined;
                        steps?: {
                            id: string;
                            name?: string | undefined;
                            prompt?: string | undefined;
                            skill?: string | undefined;
                            model?: string | undefined;
                            runner?: "auto" | "claude" | "codex" | "opencode" | "pi" | undefined;
                            allowedTools?: string[] | undefined;
                            bashAllowlist?: string[] | undefined;
                            command?: string | undefined;
                            onFail?: {
                                retry: string;
                                max: number;
                            } | undefined;
                        }[] | undefined;
                        runner?: "auto" | "claude" | "codex" | "opencode" | "pi" | undefined;
                        model?: string | undefined;
                        variants?: 1 | 2 | 3 | undefined;
                        worktree?: boolean | undefined;
                        generateFollowups?: boolean | undefined;
                        autonomous?: boolean | undefined;
                        systemPrompt?: string | undefined;
                    };
                    createdAt: string;
                    updatedAt: string;
                };
            };
            outputFormat: "json";
            status: import("hono/utils/http-status").ContentfulStatusCode;
            input: {
                param: {
                    id: string;
                };
            };
        };
    };
} & {
    "/automations/:id/check": {
        $post: {
            output: {
                error: string;
            };
            outputFormat: "json";
            status: 404;
            input: {
                json: {
                    mode: "execute" | "preview";
                };
            } & {
                param: {
                    id: string;
                };
            };
        } | {
            output: {
                checkId: string;
            };
            outputFormat: "json";
            status: 202;
            input: {
                json: {
                    mode: "execute" | "preview";
                };
            } & {
                param: {
                    id: string;
                };
            };
        };
    };
} & {
    "/automation-log": {
        $get: {
            output: {
                error: string;
            };
            outputFormat: "json";
            status: 400;
            input: {
                query: {
                    automationId?: string | undefined;
                    result?: "baseline" | "duplicate" | "error" | "launched" | "no-match" | "preview" | "rate-limited" | undefined;
                    event?: "issue.labeled" | "issue.opened" | "issue.unlabeled" | "pull_request.opened" | undefined;
                    since?: string | undefined;
                    cursor?: number | undefined;
                    limit?: number | undefined;
                };
            };
        } | {
            output: {
                records: {
                    [x: string]: import("hono/utils/types").JSONValue;
                    seq: number;
                    ts: string;
                    automationId: string;
                    revision: number;
                    event?: "issue.labeled" | "issue.opened" | "issue.unlabeled" | "pull_request.opened" | undefined;
                    result: "baseline" | "duplicate" | "error" | "launched" | "no-match" | "preview" | "rate-limited";
                    reason?: string | undefined;
                    durationMs?: number | undefined;
                    receiptId?: string | undefined;
                    runId?: string | undefined;
                    githubNumber?: number | undefined;
                    githubTitle?: string | undefined;
                    githubUrl?: string | undefined;
                    rateLimit?: {
                        [x: string]: import("hono/utils/types").JSONValue;
                        bucket: "core" | "search";
                        remaining?: number | undefined;
                        resetAt?: string | undefined;
                    } | undefined;
                }[];
            };
            outputFormat: "json";
            status: import("hono/utils/http-status").ContentfulStatusCode;
            input: {
                query: {
                    automationId?: string | undefined;
                    result?: "baseline" | "duplicate" | "error" | "launched" | "no-match" | "preview" | "rate-limited" | undefined;
                    event?: "issue.labeled" | "issue.opened" | "issue.unlabeled" | "pull_request.opened" | undefined;
                    since?: string | undefined;
                    cursor?: number | undefined;
                    limit?: number | undefined;
                };
            };
        };
    };
} & {
    "/automation-log/:receiptId/retry": {
        $post: {
            output: {
                error: string;
            };
            outputFormat: "json";
            status: 404;
            input: {
                param: {
                    receiptId: string;
                };
            };
        } | {
            output: {
                error: string;
            };
            outputFormat: "json";
            status: 409;
            input: {
                param: {
                    receiptId: string;
                };
            };
        } | {
            output: {
                receiptId: string;
                runId: string;
            };
            outputFormat: "json";
            status: 202;
            input: {
                param: {
                    receiptId: string;
                };
            };
        };
    };
}, "/"> | import("hono/types").MergeSchemaPath<{
    "/runs": {
        $get: {
            output: {
                id: string;
                title: string;
                titleSummary?: string | undefined;
                diffStat?: {
                    adds: number;
                    dels: number;
                    files: number;
                    repointed?: boolean | undefined;
                } | undefined;
                workflow: string;
                task: string;
                queuedMessages?: {
                    id: string;
                    text: string;
                    images?: string[] | undefined;
                    createdAt: string;
                }[] | undefined;
                taskImages?: string[] | undefined;
                model?: string | undefined;
                reasoningEffort?: "auto" | "high" | "low" | "medium" | "xhigh" | undefined;
                modelIdentity?: string | undefined;
                runner?: "claude" | "codex" | "opencode" | "pi" | undefined;
                requestedRunner?: "auto" | "claude" | "codex" | "opencode" | "pi" | undefined;
                agentProfile?: string | undefined;
                systemPrompt?: string | undefined;
                generateFollowups?: boolean | undefined;
                autonomous?: boolean | undefined;
                automation?: {
                    automationId: string;
                    automationRevision: number;
                    receiptId: string;
                    event: string;
                    githubUrl: string;
                } | undefined;
                status: "cancelled" | "done" | "failed" | "queued" | "review" | "running" | "waiting";
                activity?: "monitoring" | undefined;
                monitoringWakeAt?: string | undefined;
                monitoringWakeCapReached?: boolean | undefined;
                autoResumeAt?: string | undefined;
                autoResumeAttempts?: number | undefined;
                blockedReason?: {
                    type: "provider_quota";
                    providers: ("claude" | "codex")[];
                    retryAt?: string | undefined;
                } | undefined;
                createdAt: string;
                startedAt?: string | undefined;
                finishedAt?: string | undefined;
                tokensUsed: number;
                inputTokens?: number | undefined;
                outputTokens?: number | undefined;
                costUsd?: number | undefined;
                pullRequestUrl?: string | undefined;
                referencedPullRequestUrl?: string | undefined;
                prNumber?: number | undefined;
                issueNumber?: number | undefined;
                referencedIssueNumberSeeded?: boolean | undefined;
                titleOrigin?: "auto" | "marker" | "user" | undefined;
                markerRefs?: {
                    pr?: number | undefined;
                    issue?: number | undefined;
                } | undefined;
                referencedPrCandidates?: string[] | undefined;
                referencedIssueUrl?: string | undefined;
                referencedIssueCandidates?: string[] | undefined;
                worktree?: false | undefined;
                worktreePath?: string | undefined;
                branch?: string | undefined;
                baseBranch?: string | undefined;
                worktreeReclaimedAt?: string | undefined;
                groupId?: string | undefined;
                variant?: string | undefined;
                peakRssBytes?: number | undefined;
                peakProcCount?: number | undefined;
                archived: boolean;
                archivedAt?: string | undefined;
                seenAt?: string | undefined;
                currentStepId?: string | undefined;
                error?: string | undefined;
                steps: {
                    id: string;
                    name: string;
                    kind: "agent" | "check";
                    status: "cancelled" | "done" | "failed" | "pending" | "review" | "running" | "skipped" | "waiting";
                    iterations: number;
                    tokensUsed: number;
                    inputTokens?: number | undefined;
                    outputTokens?: number | undefined;
                    usageInvocationsStarted?: number | undefined;
                    usageInvocationsObserved?: number | undefined;
                    usageTurnsStarted?: number | undefined;
                    usageTurnsRecorded?: number | undefined;
                    usageInvocationEpoch?: number | undefined;
                    startedAt?: string | undefined;
                    finishedAt?: string | undefined;
                    error?: string | undefined;
                    sessionId?: string | undefined;
                    backend?: "claude" | "codex" | "opencode" | "pi" | undefined;
                    requestedRunner?: "auto" | "claude" | "codex" | "opencode" | "pi" | undefined;
                    profileId?: string | undefined;
                    reasoningEffort?: "high" | "low" | "medium" | "xhigh" | undefined;
                    costUsd?: number | undefined;
                    modelIdentity?: string | undefined;
                }[];
                workflowDef?: {
                    name: string;
                    description?: string | undefined;
                    steps: {
                        id: string;
                        name?: string | undefined;
                        prompt?: string | undefined;
                        skill?: string | undefined;
                        model?: string | undefined;
                        runner?: "auto" | "claude" | "codex" | "opencode" | "pi" | undefined;
                        allowedTools?: string[] | undefined;
                        bashAllowlist?: string[] | undefined;
                        command?: string | undefined;
                        onFail?: {
                            retry: string;
                            max: number;
                        } | undefined;
                    }[];
                    source: "built-in" | "file";
                    path?: string | undefined;
                } | undefined;
                usage?: ReturnType<typeof currentUsage>;
            }[];
            outputFormat: "json";
            status: import("hono/utils/http-status").ContentfulStatusCode;
            input: {};
        };
    };
} & {
    "/runs/archive-finished": {
        $post: {
            output: {
                archived: number;
            };
            outputFormat: "json";
            status: import("hono/utils/http-status").ContentfulStatusCode;
            input: {};
        };
    };
} & {
    "/runs/read-all": {
        $post: {
            output: {
                read: number;
            };
            outputFormat: "json";
            status: import("hono/utils/http-status").ContentfulStatusCode;
            input: {};
        };
    };
} & {
    "/runs/:id/archive": {
        $post: {
            output: {
                id: string;
                title: string;
                titleSummary?: string | undefined;
                diffStat?: {
                    adds: number;
                    dels: number;
                    files: number;
                    repointed?: boolean | undefined;
                } | undefined;
                workflow: string;
                task: string;
                queuedMessages?: {
                    id: string;
                    text: string;
                    images?: string[] | undefined;
                    createdAt: string;
                }[] | undefined;
                taskImages?: string[] | undefined;
                model?: string | undefined;
                reasoningEffort?: "auto" | "high" | "low" | "medium" | "xhigh" | undefined;
                modelIdentity?: string | undefined;
                runner?: "claude" | "codex" | "opencode" | "pi" | undefined;
                requestedRunner?: "auto" | "claude" | "codex" | "opencode" | "pi" | undefined;
                agentProfile?: string | undefined;
                systemPrompt?: string | undefined;
                generateFollowups?: boolean | undefined;
                autonomous?: boolean | undefined;
                automation?: {
                    automationId: string;
                    automationRevision: number;
                    receiptId: string;
                    event: string;
                    githubUrl: string;
                } | undefined;
                status: "cancelled" | "done" | "failed" | "queued" | "review" | "running" | "waiting";
                activity?: "monitoring" | undefined;
                monitoringWakeAt?: string | undefined;
                monitoringWakeCapReached?: boolean | undefined;
                autoResumeAt?: string | undefined;
                autoResumeAttempts?: number | undefined;
                blockedReason?: {
                    type: "provider_quota";
                    providers: ("claude" | "codex")[];
                    retryAt?: string | undefined;
                } | undefined;
                createdAt: string;
                startedAt?: string | undefined;
                finishedAt?: string | undefined;
                tokensUsed: number;
                inputTokens?: number | undefined;
                outputTokens?: number | undefined;
                costUsd?: number | undefined;
                pullRequestUrl?: string | undefined;
                referencedPullRequestUrl?: string | undefined;
                prNumber?: number | undefined;
                issueNumber?: number | undefined;
                referencedIssueNumberSeeded?: boolean | undefined;
                titleOrigin?: "auto" | "marker" | "user" | undefined;
                markerRefs?: {
                    pr?: number | undefined;
                    issue?: number | undefined;
                } | undefined;
                referencedPrCandidates?: string[] | undefined;
                referencedIssueUrl?: string | undefined;
                referencedIssueCandidates?: string[] | undefined;
                worktree?: false | undefined;
                worktreePath?: string | undefined;
                branch?: string | undefined;
                baseBranch?: string | undefined;
                worktreeReclaimedAt?: string | undefined;
                groupId?: string | undefined;
                variant?: string | undefined;
                peakRssBytes?: number | undefined;
                peakProcCount?: number | undefined;
                archived: boolean;
                archivedAt?: string | undefined;
                seenAt?: string | undefined;
                currentStepId?: string | undefined;
                error?: string | undefined;
                steps: {
                    id: string;
                    name: string;
                    kind: "agent" | "check";
                    status: "cancelled" | "done" | "failed" | "pending" | "review" | "running" | "skipped" | "waiting";
                    iterations: number;
                    tokensUsed: number;
                    inputTokens?: number | undefined;
                    outputTokens?: number | undefined;
                    usageInvocationsStarted?: number | undefined;
                    usageInvocationsObserved?: number | undefined;
                    usageTurnsStarted?: number | undefined;
                    usageTurnsRecorded?: number | undefined;
                    usageInvocationEpoch?: number | undefined;
                    startedAt?: string | undefined;
                    finishedAt?: string | undefined;
                    error?: string | undefined;
                    sessionId?: string | undefined;
                    backend?: "claude" | "codex" | "opencode" | "pi" | undefined;
                    requestedRunner?: "auto" | "claude" | "codex" | "opencode" | "pi" | undefined;
                    profileId?: string | undefined;
                    reasoningEffort?: "high" | "low" | "medium" | "xhigh" | undefined;
                    costUsd?: number | undefined;
                    modelIdentity?: string | undefined;
                }[];
                workflowDef?: {
                    name: string;
                    description?: string | undefined;
                    steps: {
                        id: string;
                        name?: string | undefined;
                        prompt?: string | undefined;
                        skill?: string | undefined;
                        model?: string | undefined;
                        runner?: "auto" | "claude" | "codex" | "opencode" | "pi" | undefined;
                        allowedTools?: string[] | undefined;
                        bashAllowlist?: string[] | undefined;
                        command?: string | undefined;
                        onFail?: {
                            retry: string;
                            max: number;
                        } | undefined;
                    }[];
                    source: "built-in" | "file";
                    path?: string | undefined;
                } | undefined;
            };
            outputFormat: "json";
            status: import("hono/utils/http-status").ContentfulStatusCode;
            input: {
                json: {
                    archived?: boolean | undefined;
                };
            } & {
                param: {
                    id: string;
                };
            };
        } | {
            output: {
                error: string;
            };
            outputFormat: "json";
            status: 404;
            input: {
                json: {
                    archived?: boolean | undefined;
                };
            } & {
                param: {
                    id: string;
                };
            };
        };
    };
} & {
    "/runs/:id/auto-resume": {
        $delete: {
            output: {
                error: string;
            };
            outputFormat: "json";
            status: 404;
            input: {
                param: {
                    id: string;
                };
            };
        } | {
            output: {
                cancelled: true;
            };
            outputFormat: "json";
            status: import("hono/utils/http-status").ContentfulStatusCode;
            input: {
                param: {
                    id: string;
                };
            };
        };
    };
} & {
    "/runs/:id/read": {
        $post: {
            output: {
                id: string;
                title: string;
                titleSummary?: string | undefined;
                diffStat?: {
                    adds: number;
                    dels: number;
                    files: number;
                    repointed?: boolean | undefined;
                } | undefined;
                workflow: string;
                task: string;
                queuedMessages?: {
                    id: string;
                    text: string;
                    images?: string[] | undefined;
                    createdAt: string;
                }[] | undefined;
                taskImages?: string[] | undefined;
                model?: string | undefined;
                reasoningEffort?: "auto" | "high" | "low" | "medium" | "xhigh" | undefined;
                modelIdentity?: string | undefined;
                runner?: "claude" | "codex" | "opencode" | "pi" | undefined;
                requestedRunner?: "auto" | "claude" | "codex" | "opencode" | "pi" | undefined;
                agentProfile?: string | undefined;
                systemPrompt?: string | undefined;
                generateFollowups?: boolean | undefined;
                autonomous?: boolean | undefined;
                automation?: {
                    automationId: string;
                    automationRevision: number;
                    receiptId: string;
                    event: string;
                    githubUrl: string;
                } | undefined;
                status: "cancelled" | "done" | "failed" | "queued" | "review" | "running" | "waiting";
                activity?: "monitoring" | undefined;
                monitoringWakeAt?: string | undefined;
                monitoringWakeCapReached?: boolean | undefined;
                autoResumeAt?: string | undefined;
                autoResumeAttempts?: number | undefined;
                blockedReason?: {
                    type: "provider_quota";
                    providers: ("claude" | "codex")[];
                    retryAt?: string | undefined;
                } | undefined;
                createdAt: string;
                startedAt?: string | undefined;
                finishedAt?: string | undefined;
                tokensUsed: number;
                inputTokens?: number | undefined;
                outputTokens?: number | undefined;
                costUsd?: number | undefined;
                pullRequestUrl?: string | undefined;
                referencedPullRequestUrl?: string | undefined;
                prNumber?: number | undefined;
                issueNumber?: number | undefined;
                referencedIssueNumberSeeded?: boolean | undefined;
                titleOrigin?: "auto" | "marker" | "user" | undefined;
                markerRefs?: {
                    pr?: number | undefined;
                    issue?: number | undefined;
                } | undefined;
                referencedPrCandidates?: string[] | undefined;
                referencedIssueUrl?: string | undefined;
                referencedIssueCandidates?: string[] | undefined;
                worktree?: false | undefined;
                worktreePath?: string | undefined;
                branch?: string | undefined;
                baseBranch?: string | undefined;
                worktreeReclaimedAt?: string | undefined;
                groupId?: string | undefined;
                variant?: string | undefined;
                peakRssBytes?: number | undefined;
                peakProcCount?: number | undefined;
                archived: boolean;
                archivedAt?: string | undefined;
                seenAt?: string | undefined;
                currentStepId?: string | undefined;
                error?: string | undefined;
                steps: {
                    id: string;
                    name: string;
                    kind: "agent" | "check";
                    status: "cancelled" | "done" | "failed" | "pending" | "review" | "running" | "skipped" | "waiting";
                    iterations: number;
                    tokensUsed: number;
                    inputTokens?: number | undefined;
                    outputTokens?: number | undefined;
                    usageInvocationsStarted?: number | undefined;
                    usageInvocationsObserved?: number | undefined;
                    usageTurnsStarted?: number | undefined;
                    usageTurnsRecorded?: number | undefined;
                    usageInvocationEpoch?: number | undefined;
                    startedAt?: string | undefined;
                    finishedAt?: string | undefined;
                    error?: string | undefined;
                    sessionId?: string | undefined;
                    backend?: "claude" | "codex" | "opencode" | "pi" | undefined;
                    requestedRunner?: "auto" | "claude" | "codex" | "opencode" | "pi" | undefined;
                    profileId?: string | undefined;
                    reasoningEffort?: "high" | "low" | "medium" | "xhigh" | undefined;
                    costUsd?: number | undefined;
                    modelIdentity?: string | undefined;
                }[];
                workflowDef?: {
                    name: string;
                    description?: string | undefined;
                    steps: {
                        id: string;
                        name?: string | undefined;
                        prompt?: string | undefined;
                        skill?: string | undefined;
                        model?: string | undefined;
                        runner?: "auto" | "claude" | "codex" | "opencode" | "pi" | undefined;
                        allowedTools?: string[] | undefined;
                        bashAllowlist?: string[] | undefined;
                        command?: string | undefined;
                        onFail?: {
                            retry: string;
                            max: number;
                        } | undefined;
                    }[];
                    source: "built-in" | "file";
                    path?: string | undefined;
                } | undefined;
            };
            outputFormat: "json";
            status: import("hono/utils/http-status").ContentfulStatusCode;
            input: {
                param: {
                    id: string;
                };
            };
        } | {
            output: {
                error: string;
            };
            outputFormat: "json";
            status: 404;
            input: {
                param: {
                    id: string;
                };
            };
        };
    };
} & {
    "/runs/:id/unread": {
        $post: {
            output: {
                id: string;
                title: string;
                titleSummary?: string | undefined;
                diffStat?: {
                    adds: number;
                    dels: number;
                    files: number;
                    repointed?: boolean | undefined;
                } | undefined;
                workflow: string;
                task: string;
                queuedMessages?: {
                    id: string;
                    text: string;
                    images?: string[] | undefined;
                    createdAt: string;
                }[] | undefined;
                taskImages?: string[] | undefined;
                model?: string | undefined;
                reasoningEffort?: "auto" | "high" | "low" | "medium" | "xhigh" | undefined;
                modelIdentity?: string | undefined;
                runner?: "claude" | "codex" | "opencode" | "pi" | undefined;
                requestedRunner?: "auto" | "claude" | "codex" | "opencode" | "pi" | undefined;
                agentProfile?: string | undefined;
                systemPrompt?: string | undefined;
                generateFollowups?: boolean | undefined;
                autonomous?: boolean | undefined;
                automation?: {
                    automationId: string;
                    automationRevision: number;
                    receiptId: string;
                    event: string;
                    githubUrl: string;
                } | undefined;
                status: "cancelled" | "done" | "failed" | "queued" | "review" | "running" | "waiting";
                activity?: "monitoring" | undefined;
                monitoringWakeAt?: string | undefined;
                monitoringWakeCapReached?: boolean | undefined;
                autoResumeAt?: string | undefined;
                autoResumeAttempts?: number | undefined;
                blockedReason?: {
                    type: "provider_quota";
                    providers: ("claude" | "codex")[];
                    retryAt?: string | undefined;
                } | undefined;
                createdAt: string;
                startedAt?: string | undefined;
                finishedAt?: string | undefined;
                tokensUsed: number;
                inputTokens?: number | undefined;
                outputTokens?: number | undefined;
                costUsd?: number | undefined;
                pullRequestUrl?: string | undefined;
                referencedPullRequestUrl?: string | undefined;
                prNumber?: number | undefined;
                issueNumber?: number | undefined;
                referencedIssueNumberSeeded?: boolean | undefined;
                titleOrigin?: "auto" | "marker" | "user" | undefined;
                markerRefs?: {
                    pr?: number | undefined;
                    issue?: number | undefined;
                } | undefined;
                referencedPrCandidates?: string[] | undefined;
                referencedIssueUrl?: string | undefined;
                referencedIssueCandidates?: string[] | undefined;
                worktree?: false | undefined;
                worktreePath?: string | undefined;
                branch?: string | undefined;
                baseBranch?: string | undefined;
                worktreeReclaimedAt?: string | undefined;
                groupId?: string | undefined;
                variant?: string | undefined;
                peakRssBytes?: number | undefined;
                peakProcCount?: number | undefined;
                archived: boolean;
                archivedAt?: string | undefined;
                seenAt?: string | undefined;
                currentStepId?: string | undefined;
                error?: string | undefined;
                steps: {
                    id: string;
                    name: string;
                    kind: "agent" | "check";
                    status: "cancelled" | "done" | "failed" | "pending" | "review" | "running" | "skipped" | "waiting";
                    iterations: number;
                    tokensUsed: number;
                    inputTokens?: number | undefined;
                    outputTokens?: number | undefined;
                    usageInvocationsStarted?: number | undefined;
                    usageInvocationsObserved?: number | undefined;
                    usageTurnsStarted?: number | undefined;
                    usageTurnsRecorded?: number | undefined;
                    usageInvocationEpoch?: number | undefined;
                    startedAt?: string | undefined;
                    finishedAt?: string | undefined;
                    error?: string | undefined;
                    sessionId?: string | undefined;
                    backend?: "claude" | "codex" | "opencode" | "pi" | undefined;
                    requestedRunner?: "auto" | "claude" | "codex" | "opencode" | "pi" | undefined;
                    profileId?: string | undefined;
                    reasoningEffort?: "high" | "low" | "medium" | "xhigh" | undefined;
                    costUsd?: number | undefined;
                    modelIdentity?: string | undefined;
                }[];
                workflowDef?: {
                    name: string;
                    description?: string | undefined;
                    steps: {
                        id: string;
                        name?: string | undefined;
                        prompt?: string | undefined;
                        skill?: string | undefined;
                        model?: string | undefined;
                        runner?: "auto" | "claude" | "codex" | "opencode" | "pi" | undefined;
                        allowedTools?: string[] | undefined;
                        bashAllowlist?: string[] | undefined;
                        command?: string | undefined;
                        onFail?: {
                            retry: string;
                            max: number;
                        } | undefined;
                    }[];
                    source: "built-in" | "file";
                    path?: string | undefined;
                } | undefined;
            };
            outputFormat: "json";
            status: import("hono/utils/http-status").ContentfulStatusCode;
            input: {
                param: {
                    id: string;
                };
            };
        } | {
            output: {
                error: string;
            };
            outputFormat: "json";
            status: 404;
            input: {
                param: {
                    id: string;
                };
            };
        };
    };
} & {
    "/runs": {
        $post: {
            output: {
                id: string;
                title: string;
                titleSummary?: string | undefined;
                diffStat?: {
                    adds: number;
                    dels: number;
                    files: number;
                    repointed?: boolean | undefined;
                } | undefined;
                workflow: string;
                task: string;
                queuedMessages?: {
                    id: string;
                    text: string;
                    images?: string[] | undefined;
                    createdAt: string;
                }[] | undefined;
                taskImages?: string[] | undefined;
                model?: string | undefined;
                reasoningEffort?: "auto" | "high" | "low" | "medium" | "xhigh" | undefined;
                modelIdentity?: string | undefined;
                runner?: "claude" | "codex" | "opencode" | "pi" | undefined;
                requestedRunner?: "auto" | "claude" | "codex" | "opencode" | "pi" | undefined;
                agentProfile?: string | undefined;
                systemPrompt?: string | undefined;
                generateFollowups?: boolean | undefined;
                autonomous?: boolean | undefined;
                automation?: {
                    automationId: string;
                    automationRevision: number;
                    receiptId: string;
                    event: string;
                    githubUrl: string;
                } | undefined;
                status: "cancelled" | "done" | "failed" | "queued" | "review" | "running" | "waiting";
                activity?: "monitoring" | undefined;
                monitoringWakeAt?: string | undefined;
                monitoringWakeCapReached?: boolean | undefined;
                autoResumeAt?: string | undefined;
                autoResumeAttempts?: number | undefined;
                blockedReason?: {
                    type: "provider_quota";
                    providers: ("claude" | "codex")[];
                    retryAt?: string | undefined;
                } | undefined;
                createdAt: string;
                startedAt?: string | undefined;
                finishedAt?: string | undefined;
                tokensUsed: number;
                inputTokens?: number | undefined;
                outputTokens?: number | undefined;
                costUsd?: number | undefined;
                pullRequestUrl?: string | undefined;
                referencedPullRequestUrl?: string | undefined;
                prNumber?: number | undefined;
                issueNumber?: number | undefined;
                referencedIssueNumberSeeded?: boolean | undefined;
                titleOrigin?: "auto" | "marker" | "user" | undefined;
                markerRefs?: {
                    pr?: number | undefined;
                    issue?: number | undefined;
                } | undefined;
                referencedPrCandidates?: string[] | undefined;
                referencedIssueUrl?: string | undefined;
                referencedIssueCandidates?: string[] | undefined;
                worktree?: false | undefined;
                worktreePath?: string | undefined;
                branch?: string | undefined;
                baseBranch?: string | undefined;
                worktreeReclaimedAt?: string | undefined;
                groupId?: string | undefined;
                variant?: string | undefined;
                peakRssBytes?: number | undefined;
                peakProcCount?: number | undefined;
                archived: boolean;
                archivedAt?: string | undefined;
                seenAt?: string | undefined;
                currentStepId?: string | undefined;
                error?: string | undefined;
                steps: {
                    id: string;
                    name: string;
                    kind: "agent" | "check";
                    status: "cancelled" | "done" | "failed" | "pending" | "review" | "running" | "skipped" | "waiting";
                    iterations: number;
                    tokensUsed: number;
                    inputTokens?: number | undefined;
                    outputTokens?: number | undefined;
                    usageInvocationsStarted?: number | undefined;
                    usageInvocationsObserved?: number | undefined;
                    usageTurnsStarted?: number | undefined;
                    usageTurnsRecorded?: number | undefined;
                    usageInvocationEpoch?: number | undefined;
                    startedAt?: string | undefined;
                    finishedAt?: string | undefined;
                    error?: string | undefined;
                    sessionId?: string | undefined;
                    backend?: "claude" | "codex" | "opencode" | "pi" | undefined;
                    requestedRunner?: "auto" | "claude" | "codex" | "opencode" | "pi" | undefined;
                    profileId?: string | undefined;
                    reasoningEffort?: "high" | "low" | "medium" | "xhigh" | undefined;
                    costUsd?: number | undefined;
                    modelIdentity?: string | undefined;
                }[];
                workflowDef?: {
                    name: string;
                    description?: string | undefined;
                    steps: {
                        id: string;
                        name?: string | undefined;
                        prompt?: string | undefined;
                        skill?: string | undefined;
                        model?: string | undefined;
                        runner?: "auto" | "claude" | "codex" | "opencode" | "pi" | undefined;
                        allowedTools?: string[] | undefined;
                        bashAllowlist?: string[] | undefined;
                        command?: string | undefined;
                        onFail?: {
                            retry: string;
                            max: number;
                        } | undefined;
                    }[];
                    source: "built-in" | "file";
                    path?: string | undefined;
                } | undefined;
            };
            outputFormat: "json";
            status: 201;
            input: {
                json: {
                    workflow?: string | undefined;
                    steps?: {
                        id: string;
                        name?: string | undefined;
                        prompt?: string | undefined;
                        skill?: string | undefined;
                        model?: string | undefined;
                        runner?: "auto" | "claude" | "codex" | "opencode" | "pi" | undefined;
                        allowedTools?: string[] | undefined;
                        bashAllowlist?: string[] | undefined;
                        command?: string | undefined;
                        onFail?: {
                            retry: string;
                            max?: number | undefined;
                        } | undefined;
                    }[] | undefined;
                    task: string;
                    model?: string | undefined;
                    reasoningEffort?: "auto" | "high" | "low" | "medium" | "xhigh" | undefined;
                    runner?: "auto" | "claude" | "codex" | "opencode" | "pi" | undefined;
                    agentProfile?: string | undefined;
                    variants?: number | undefined;
                    worktree?: boolean | undefined;
                    autonomous?: boolean | undefined;
                    generateFollowups?: boolean | undefined;
                    systemPrompt?: string | undefined;
                    images?: {
                        mediaType: string;
                        data: string;
                    }[] | undefined;
                    todoId?: string | undefined;
                };
            };
        } | {
            output: {
                error: string;
            };
            outputFormat: "json";
            status: 409;
            input: {
                json: {
                    workflow?: string | undefined;
                    steps?: {
                        id: string;
                        name?: string | undefined;
                        prompt?: string | undefined;
                        skill?: string | undefined;
                        model?: string | undefined;
                        runner?: "auto" | "claude" | "codex" | "opencode" | "pi" | undefined;
                        allowedTools?: string[] | undefined;
                        bashAllowlist?: string[] | undefined;
                        command?: string | undefined;
                        onFail?: {
                            retry: string;
                            max?: number | undefined;
                        } | undefined;
                    }[] | undefined;
                    task: string;
                    model?: string | undefined;
                    reasoningEffort?: "auto" | "high" | "low" | "medium" | "xhigh" | undefined;
                    runner?: "auto" | "claude" | "codex" | "opencode" | "pi" | undefined;
                    agentProfile?: string | undefined;
                    variants?: number | undefined;
                    worktree?: boolean | undefined;
                    autonomous?: boolean | undefined;
                    generateFollowups?: boolean | undefined;
                    systemPrompt?: string | undefined;
                    images?: {
                        mediaType: string;
                        data: string;
                    }[] | undefined;
                    todoId?: string | undefined;
                };
            };
        } | {
            output: {
                error: string;
            };
            outputFormat: "json";
            status: 400;
            input: {
                json: {
                    workflow?: string | undefined;
                    steps?: {
                        id: string;
                        name?: string | undefined;
                        prompt?: string | undefined;
                        skill?: string | undefined;
                        model?: string | undefined;
                        runner?: "auto" | "claude" | "codex" | "opencode" | "pi" | undefined;
                        allowedTools?: string[] | undefined;
                        bashAllowlist?: string[] | undefined;
                        command?: string | undefined;
                        onFail?: {
                            retry: string;
                            max?: number | undefined;
                        } | undefined;
                    }[] | undefined;
                    task: string;
                    model?: string | undefined;
                    reasoningEffort?: "auto" | "high" | "low" | "medium" | "xhigh" | undefined;
                    runner?: "auto" | "claude" | "codex" | "opencode" | "pi" | undefined;
                    agentProfile?: string | undefined;
                    variants?: number | undefined;
                    worktree?: boolean | undefined;
                    autonomous?: boolean | undefined;
                    generateFollowups?: boolean | undefined;
                    systemPrompt?: string | undefined;
                    images?: {
                        mediaType: string;
                        data: string;
                    }[] | undefined;
                    todoId?: string | undefined;
                };
            };
        } | {
            output: {
                error: string;
            };
            outputFormat: "json";
            status: 404;
            input: {
                json: {
                    workflow?: string | undefined;
                    steps?: {
                        id: string;
                        name?: string | undefined;
                        prompt?: string | undefined;
                        skill?: string | undefined;
                        model?: string | undefined;
                        runner?: "auto" | "claude" | "codex" | "opencode" | "pi" | undefined;
                        allowedTools?: string[] | undefined;
                        bashAllowlist?: string[] | undefined;
                        command?: string | undefined;
                        onFail?: {
                            retry: string;
                            max?: number | undefined;
                        } | undefined;
                    }[] | undefined;
                    task: string;
                    model?: string | undefined;
                    reasoningEffort?: "auto" | "high" | "low" | "medium" | "xhigh" | undefined;
                    runner?: "auto" | "claude" | "codex" | "opencode" | "pi" | undefined;
                    agentProfile?: string | undefined;
                    variants?: number | undefined;
                    worktree?: boolean | undefined;
                    autonomous?: boolean | undefined;
                    generateFollowups?: boolean | undefined;
                    systemPrompt?: string | undefined;
                    images?: {
                        mediaType: string;
                        data: string;
                    }[] | undefined;
                    todoId?: string | undefined;
                };
            };
        } | {
            output: {
                runs: {
                    id: string;
                    title: string;
                    titleSummary?: string | undefined;
                    diffStat?: {
                        adds: number;
                        dels: number;
                        files: number;
                        repointed?: boolean | undefined;
                    } | undefined;
                    workflow: string;
                    task: string;
                    queuedMessages?: {
                        id: string;
                        text: string;
                        images?: string[] | undefined;
                        createdAt: string;
                    }[] | undefined;
                    taskImages?: string[] | undefined;
                    model?: string | undefined;
                    reasoningEffort?: "auto" | "high" | "low" | "medium" | "xhigh" | undefined;
                    modelIdentity?: string | undefined;
                    runner?: "claude" | "codex" | "opencode" | "pi" | undefined;
                    requestedRunner?: "auto" | "claude" | "codex" | "opencode" | "pi" | undefined;
                    agentProfile?: string | undefined;
                    systemPrompt?: string | undefined;
                    generateFollowups?: boolean | undefined;
                    autonomous?: boolean | undefined;
                    automation?: {
                        automationId: string;
                        automationRevision: number;
                        receiptId: string;
                        event: string;
                        githubUrl: string;
                    } | undefined;
                    status: "cancelled" | "done" | "failed" | "queued" | "review" | "running" | "waiting";
                    activity?: "monitoring" | undefined;
                    monitoringWakeAt?: string | undefined;
                    monitoringWakeCapReached?: boolean | undefined;
                    autoResumeAt?: string | undefined;
                    autoResumeAttempts?: number | undefined;
                    blockedReason?: {
                        type: "provider_quota";
                        providers: ("claude" | "codex")[];
                        retryAt?: string | undefined;
                    } | undefined;
                    createdAt: string;
                    startedAt?: string | undefined;
                    finishedAt?: string | undefined;
                    tokensUsed: number;
                    inputTokens?: number | undefined;
                    outputTokens?: number | undefined;
                    costUsd?: number | undefined;
                    pullRequestUrl?: string | undefined;
                    referencedPullRequestUrl?: string | undefined;
                    prNumber?: number | undefined;
                    issueNumber?: number | undefined;
                    referencedIssueNumberSeeded?: boolean | undefined;
                    titleOrigin?: "auto" | "marker" | "user" | undefined;
                    markerRefs?: {
                        pr?: number | undefined;
                        issue?: number | undefined;
                    } | undefined;
                    referencedPrCandidates?: string[] | undefined;
                    referencedIssueUrl?: string | undefined;
                    referencedIssueCandidates?: string[] | undefined;
                    worktree?: false | undefined;
                    worktreePath?: string | undefined;
                    branch?: string | undefined;
                    baseBranch?: string | undefined;
                    worktreeReclaimedAt?: string | undefined;
                    groupId?: string | undefined;
                    variant?: string | undefined;
                    peakRssBytes?: number | undefined;
                    peakProcCount?: number | undefined;
                    archived: boolean;
                    archivedAt?: string | undefined;
                    seenAt?: string | undefined;
                    currentStepId?: string | undefined;
                    error?: string | undefined;
                    steps: {
                        id: string;
                        name: string;
                        kind: "agent" | "check";
                        status: "cancelled" | "done" | "failed" | "pending" | "review" | "running" | "skipped" | "waiting";
                        iterations: number;
                        tokensUsed: number;
                        inputTokens?: number | undefined;
                        outputTokens?: number | undefined;
                        usageInvocationsStarted?: number | undefined;
                        usageInvocationsObserved?: number | undefined;
                        usageTurnsStarted?: number | undefined;
                        usageTurnsRecorded?: number | undefined;
                        usageInvocationEpoch?: number | undefined;
                        startedAt?: string | undefined;
                        finishedAt?: string | undefined;
                        error?: string | undefined;
                        sessionId?: string | undefined;
                        backend?: "claude" | "codex" | "opencode" | "pi" | undefined;
                        requestedRunner?: "auto" | "claude" | "codex" | "opencode" | "pi" | undefined;
                        profileId?: string | undefined;
                        reasoningEffort?: "high" | "low" | "medium" | "xhigh" | undefined;
                        costUsd?: number | undefined;
                        modelIdentity?: string | undefined;
                    }[];
                    workflowDef?: {
                        name: string;
                        description?: string | undefined;
                        steps: {
                            id: string;
                            name?: string | undefined;
                            prompt?: string | undefined;
                            skill?: string | undefined;
                            model?: string | undefined;
                            runner?: "auto" | "claude" | "codex" | "opencode" | "pi" | undefined;
                            allowedTools?: string[] | undefined;
                            bashAllowlist?: string[] | undefined;
                            command?: string | undefined;
                            onFail?: {
                                retry: string;
                                max: number;
                            } | undefined;
                        }[];
                        source: "built-in" | "file";
                        path?: string | undefined;
                    } | undefined;
                }[];
            };
            outputFormat: "json";
            status: 201;
            input: {
                json: {
                    workflow?: string | undefined;
                    steps?: {
                        id: string;
                        name?: string | undefined;
                        prompt?: string | undefined;
                        skill?: string | undefined;
                        model?: string | undefined;
                        runner?: "auto" | "claude" | "codex" | "opencode" | "pi" | undefined;
                        allowedTools?: string[] | undefined;
                        bashAllowlist?: string[] | undefined;
                        command?: string | undefined;
                        onFail?: {
                            retry: string;
                            max?: number | undefined;
                        } | undefined;
                    }[] | undefined;
                    task: string;
                    model?: string | undefined;
                    reasoningEffort?: "auto" | "high" | "low" | "medium" | "xhigh" | undefined;
                    runner?: "auto" | "claude" | "codex" | "opencode" | "pi" | undefined;
                    agentProfile?: string | undefined;
                    variants?: number | undefined;
                    worktree?: boolean | undefined;
                    autonomous?: boolean | undefined;
                    generateFollowups?: boolean | undefined;
                    systemPrompt?: string | undefined;
                    images?: {
                        mediaType: string;
                        data: string;
                    }[] | undefined;
                    todoId?: string | undefined;
                };
            };
        };
    };
} & {
    "/runs/:id": {
        $get: {
            output: {
                id: string;
                title: string;
                titleSummary?: string | undefined;
                diffStat?: {
                    adds: number;
                    dels: number;
                    files: number;
                    repointed?: boolean | undefined;
                } | undefined;
                workflow: string;
                task: string;
                queuedMessages?: {
                    id: string;
                    text: string;
                    images?: string[] | undefined;
                    createdAt: string;
                }[] | undefined;
                taskImages?: string[] | undefined;
                model?: string | undefined;
                reasoningEffort?: "auto" | "high" | "low" | "medium" | "xhigh" | undefined;
                modelIdentity?: string | undefined;
                runner?: "claude" | "codex" | "opencode" | "pi" | undefined;
                requestedRunner?: "auto" | "claude" | "codex" | "opencode" | "pi" | undefined;
                agentProfile?: string | undefined;
                systemPrompt?: string | undefined;
                generateFollowups?: boolean | undefined;
                autonomous?: boolean | undefined;
                automation?: {
                    automationId: string;
                    automationRevision: number;
                    receiptId: string;
                    event: string;
                    githubUrl: string;
                } | undefined;
                status: "cancelled" | "done" | "failed" | "queued" | "review" | "running" | "waiting";
                activity?: "monitoring" | undefined;
                monitoringWakeAt?: string | undefined;
                monitoringWakeCapReached?: boolean | undefined;
                autoResumeAt?: string | undefined;
                autoResumeAttempts?: number | undefined;
                blockedReason?: {
                    type: "provider_quota";
                    providers: ("claude" | "codex")[];
                    retryAt?: string | undefined;
                } | undefined;
                createdAt: string;
                startedAt?: string | undefined;
                finishedAt?: string | undefined;
                tokensUsed: number;
                inputTokens?: number | undefined;
                outputTokens?: number | undefined;
                costUsd?: number | undefined;
                pullRequestUrl?: string | undefined;
                referencedPullRequestUrl?: string | undefined;
                prNumber?: number | undefined;
                issueNumber?: number | undefined;
                referencedIssueNumberSeeded?: boolean | undefined;
                titleOrigin?: "auto" | "marker" | "user" | undefined;
                markerRefs?: {
                    pr?: number | undefined;
                    issue?: number | undefined;
                } | undefined;
                referencedPrCandidates?: string[] | undefined;
                referencedIssueUrl?: string | undefined;
                referencedIssueCandidates?: string[] | undefined;
                worktree?: false | undefined;
                worktreePath?: string | undefined;
                branch?: string | undefined;
                baseBranch?: string | undefined;
                worktreeReclaimedAt?: string | undefined;
                groupId?: string | undefined;
                variant?: string | undefined;
                peakRssBytes?: number | undefined;
                peakProcCount?: number | undefined;
                archived: boolean;
                archivedAt?: string | undefined;
                seenAt?: string | undefined;
                currentStepId?: string | undefined;
                error?: string | undefined;
                steps: {
                    id: string;
                    name: string;
                    kind: "agent" | "check";
                    status: "cancelled" | "done" | "failed" | "pending" | "review" | "running" | "skipped" | "waiting";
                    iterations: number;
                    tokensUsed: number;
                    inputTokens?: number | undefined;
                    outputTokens?: number | undefined;
                    usageInvocationsStarted?: number | undefined;
                    usageInvocationsObserved?: number | undefined;
                    usageTurnsStarted?: number | undefined;
                    usageTurnsRecorded?: number | undefined;
                    usageInvocationEpoch?: number | undefined;
                    startedAt?: string | undefined;
                    finishedAt?: string | undefined;
                    error?: string | undefined;
                    sessionId?: string | undefined;
                    backend?: "claude" | "codex" | "opencode" | "pi" | undefined;
                    requestedRunner?: "auto" | "claude" | "codex" | "opencode" | "pi" | undefined;
                    profileId?: string | undefined;
                    reasoningEffort?: "high" | "low" | "medium" | "xhigh" | undefined;
                    costUsd?: number | undefined;
                    modelIdentity?: string | undefined;
                }[];
                workflowDef?: {
                    name: string;
                    description?: string | undefined;
                    steps: {
                        id: string;
                        name?: string | undefined;
                        prompt?: string | undefined;
                        skill?: string | undefined;
                        model?: string | undefined;
                        runner?: "auto" | "claude" | "codex" | "opencode" | "pi" | undefined;
                        allowedTools?: string[] | undefined;
                        bashAllowlist?: string[] | undefined;
                        command?: string | undefined;
                        onFail?: {
                            retry: string;
                            max: number;
                        } | undefined;
                    }[];
                    source: "built-in" | "file";
                    path?: string | undefined;
                } | undefined;
                usage?: ReturnType<typeof currentUsage>;
            };
            outputFormat: "json";
            status: import("hono/utils/http-status").ContentfulStatusCode;
            input: {
                param: {
                    id: string;
                };
            };
        } | {
            output: {
                error: string;
            };
            outputFormat: "json";
            status: 404;
            input: {
                param: {
                    id: string;
                };
            };
        };
    };
} & {
    "/runs/:id/history": {
        $get: {
            output: {
                error: string;
            };
            outputFormat: "json";
            status: 400;
            input: {
                param: {
                    id: string;
                };
            } & {
                query: {
                    cursor?: string | undefined;
                };
            };
        } | {
            output: {
                error: string;
            };
            outputFormat: "json";
            status: 404;
            input: {
                param: {
                    id: string;
                };
            } & {
                query: {
                    cursor?: string | undefined;
                };
            };
        } | {
            output: {
                events: {
                    [x: string]: any;
                    seq: number;
                    ts: string;
                    stepId?: string | undefined;
                    type: string;
                }[];
                itemCount: number;
                olderCursor?: string | undefined;
                newerCursor?: string | undefined;
                liveCursor: string;
                asOfSeq: number;
                hasOlder: boolean;
            };
            outputFormat: "json";
            status: import("hono/utils/http-status").ContentfulStatusCode;
            input: {
                param: {
                    id: string;
                };
            } & {
                query: {
                    cursor?: string | undefined;
                };
            };
        } | {
            output: {
                error: string;
            };
            outputFormat: "json";
            status: 400 | 409;
            input: {
                param: {
                    id: string;
                };
            } & {
                query: {
                    cursor?: string | undefined;
                };
            };
        };
    };
} & {
    "/runs/:id/history-context": {
        $get: {
            output: {
                error: string;
            };
            outputFormat: "json";
            status: 400;
            input: {
                param: {
                    id: string;
                };
            };
        } | {
            output: {
                error: string;
            };
            outputFormat: "json";
            status: 404;
            input: {
                param: {
                    id: string;
                };
            };
        } | {
            output: {
                contextEvents: {
                    [x: string]: any;
                    seq: number;
                    ts: string;
                    stepId?: string | undefined;
                    type: string;
                }[];
                asOfSeq: number;
            };
            outputFormat: "json";
            status: import("hono/utils/http-status").ContentfulStatusCode;
            input: {
                param: {
                    id: string;
                };
            };
        };
    };
} & {
    "/runs/:id": {
        $patch: {
            output: {
                id: string;
                title: string;
                titleSummary?: string | undefined;
                diffStat?: {
                    adds: number;
                    dels: number;
                    files: number;
                    repointed?: boolean | undefined;
                } | undefined;
                workflow: string;
                task: string;
                queuedMessages?: {
                    id: string;
                    text: string;
                    images?: string[] | undefined;
                    createdAt: string;
                }[] | undefined;
                taskImages?: string[] | undefined;
                model?: string | undefined;
                reasoningEffort?: "auto" | "high" | "low" | "medium" | "xhigh" | undefined;
                modelIdentity?: string | undefined;
                runner?: "claude" | "codex" | "opencode" | "pi" | undefined;
                requestedRunner?: "auto" | "claude" | "codex" | "opencode" | "pi" | undefined;
                agentProfile?: string | undefined;
                systemPrompt?: string | undefined;
                generateFollowups?: boolean | undefined;
                autonomous?: boolean | undefined;
                automation?: {
                    automationId: string;
                    automationRevision: number;
                    receiptId: string;
                    event: string;
                    githubUrl: string;
                } | undefined;
                status: "cancelled" | "done" | "failed" | "queued" | "review" | "running" | "waiting";
                activity?: "monitoring" | undefined;
                monitoringWakeAt?: string | undefined;
                monitoringWakeCapReached?: boolean | undefined;
                autoResumeAt?: string | undefined;
                autoResumeAttempts?: number | undefined;
                blockedReason?: {
                    type: "provider_quota";
                    providers: ("claude" | "codex")[];
                    retryAt?: string | undefined;
                } | undefined;
                createdAt: string;
                startedAt?: string | undefined;
                finishedAt?: string | undefined;
                tokensUsed: number;
                inputTokens?: number | undefined;
                outputTokens?: number | undefined;
                costUsd?: number | undefined;
                pullRequestUrl?: string | undefined;
                referencedPullRequestUrl?: string | undefined;
                prNumber?: number | undefined;
                issueNumber?: number | undefined;
                referencedIssueNumberSeeded?: boolean | undefined;
                titleOrigin?: "auto" | "marker" | "user" | undefined;
                markerRefs?: {
                    pr?: number | undefined;
                    issue?: number | undefined;
                } | undefined;
                referencedPrCandidates?: string[] | undefined;
                referencedIssueUrl?: string | undefined;
                referencedIssueCandidates?: string[] | undefined;
                worktree?: false | undefined;
                worktreePath?: string | undefined;
                branch?: string | undefined;
                baseBranch?: string | undefined;
                worktreeReclaimedAt?: string | undefined;
                groupId?: string | undefined;
                variant?: string | undefined;
                peakRssBytes?: number | undefined;
                peakProcCount?: number | undefined;
                archived: boolean;
                archivedAt?: string | undefined;
                seenAt?: string | undefined;
                currentStepId?: string | undefined;
                error?: string | undefined;
                steps: {
                    id: string;
                    name: string;
                    kind: "agent" | "check";
                    status: "cancelled" | "done" | "failed" | "pending" | "review" | "running" | "skipped" | "waiting";
                    iterations: number;
                    tokensUsed: number;
                    inputTokens?: number | undefined;
                    outputTokens?: number | undefined;
                    usageInvocationsStarted?: number | undefined;
                    usageInvocationsObserved?: number | undefined;
                    usageTurnsStarted?: number | undefined;
                    usageTurnsRecorded?: number | undefined;
                    usageInvocationEpoch?: number | undefined;
                    startedAt?: string | undefined;
                    finishedAt?: string | undefined;
                    error?: string | undefined;
                    sessionId?: string | undefined;
                    backend?: "claude" | "codex" | "opencode" | "pi" | undefined;
                    requestedRunner?: "auto" | "claude" | "codex" | "opencode" | "pi" | undefined;
                    profileId?: string | undefined;
                    reasoningEffort?: "high" | "low" | "medium" | "xhigh" | undefined;
                    costUsd?: number | undefined;
                    modelIdentity?: string | undefined;
                }[];
                workflowDef?: {
                    name: string;
                    description?: string | undefined;
                    steps: {
                        id: string;
                        name?: string | undefined;
                        prompt?: string | undefined;
                        skill?: string | undefined;
                        model?: string | undefined;
                        runner?: "auto" | "claude" | "codex" | "opencode" | "pi" | undefined;
                        allowedTools?: string[] | undefined;
                        bashAllowlist?: string[] | undefined;
                        command?: string | undefined;
                        onFail?: {
                            retry: string;
                            max: number;
                        } | undefined;
                    }[];
                    source: "built-in" | "file";
                    path?: string | undefined;
                } | undefined;
            };
            outputFormat: "json";
            status: import("hono/utils/http-status").ContentfulStatusCode;
            input: {
                json: {
                    title?: string | undefined;
                    task?: string | undefined;
                };
            } & {
                param: {
                    id: string;
                };
            };
        } | {
            output: {
                error: string;
            };
            outputFormat: "json";
            status: 404;
            input: {
                json: {
                    title?: string | undefined;
                    task?: string | undefined;
                };
            } & {
                param: {
                    id: string;
                };
            };
        } | {
            output: {
                error: string;
            };
            outputFormat: "json";
            status: 400;
            input: {
                json: {
                    title?: string | undefined;
                    task?: string | undefined;
                };
            } & {
                param: {
                    id: string;
                };
            };
        } | {
            output: {
                error: string;
            };
            outputFormat: "json";
            status: 409;
            input: {
                json: {
                    title?: string | undefined;
                    task?: string | undefined;
                };
            } & {
                param: {
                    id: string;
                };
            };
        };
    };
} & {
    "/runs/:id/cancel": {
        $post: {
            output: {
                error: string;
            };
            outputFormat: "json";
            status: 404;
            input: {
                param: {
                    id: string;
                };
            };
        } | {
            output: {
                cancelled: boolean;
            };
            outputFormat: "json";
            status: import("hono/utils/http-status").ContentfulStatusCode;
            input: {
                param: {
                    id: string;
                };
            };
        };
    };
} & {
    "/runs/:id/messages": {
        $post: {
            output: {
                error: string;
            };
            outputFormat: "json";
            status: 404;
            input: {
                json: {
                    text?: string | undefined;
                    images?: {
                        mediaType: string;
                        data: string;
                    }[] | undefined;
                };
            } & {
                param: {
                    id: string;
                };
            };
        } | {
            output: {
                error: string;
            };
            outputFormat: "json";
            status: 409;
            input: {
                json: {
                    text?: string | undefined;
                    images?: {
                        mediaType: string;
                        data: string;
                    }[] | undefined;
                };
            } & {
                param: {
                    id: string;
                };
            };
        } | {
            output: {
                delivered: true;
            };
            outputFormat: "json";
            status: import("hono/utils/http-status").ContentfulStatusCode;
            input: {
                json: {
                    text?: string | undefined;
                    images?: {
                        mediaType: string;
                        data: string;
                    }[] | undefined;
                };
            } & {
                param: {
                    id: string;
                };
            };
        } | {
            output: {
                error: string;
            };
            outputFormat: "json";
            status: 400;
            input: {
                json: {
                    text?: string | undefined;
                    images?: {
                        mediaType: string;
                        data: string;
                    }[] | undefined;
                };
            } & {
                param: {
                    id: string;
                };
            };
        } | {
            output: {
                queued: true;
                message: {
                    id: string;
                    text: string;
                    images?: string[] | undefined;
                    createdAt: string;
                };
            };
            outputFormat: "json";
            status: import("hono/utils/http-status").ContentfulStatusCode;
            input: {
                json: {
                    text?: string | undefined;
                    images?: {
                        mediaType: string;
                        data: string;
                    }[] | undefined;
                };
            } & {
                param: {
                    id: string;
                };
            };
        } | {
            output: {
                deferred: true;
            };
            outputFormat: "json";
            status: import("hono/utils/http-status").ContentfulStatusCode;
            input: {
                json: {
                    text?: string | undefined;
                    images?: {
                        mediaType: string;
                        data: string;
                    }[] | undefined;
                };
            } & {
                param: {
                    id: string;
                };
            };
        };
    };
} & {
    "/runs/:id/queued-messages/:msgId": {
        $patch: {
            output: {
                error: string;
            };
            outputFormat: "json";
            status: 404;
            input: {
                json: {
                    text?: string | undefined;
                    images?: {
                        mediaType: string;
                        data: string;
                    }[] | undefined;
                };
            } & {
                param: {
                    id: string;
                } & {
                    msgId: string;
                };
            };
        } | {
            output: {
                error: string;
            };
            outputFormat: "json";
            status: 400;
            input: {
                json: {
                    text?: string | undefined;
                    images?: {
                        mediaType: string;
                        data: string;
                    }[] | undefined;
                };
            } & {
                param: {
                    id: string;
                } & {
                    msgId: string;
                };
            };
        } | {
            output: {
                error: string;
            };
            outputFormat: "json";
            status: 409;
            input: {
                json: {
                    text?: string | undefined;
                    images?: {
                        mediaType: string;
                        data: string;
                    }[] | undefined;
                };
            } & {
                param: {
                    id: string;
                } & {
                    msgId: string;
                };
            };
        } | {
            output: {
                message: {
                    id: string;
                    text: string;
                    images?: string[] | undefined;
                    createdAt: string;
                };
            };
            outputFormat: "json";
            status: import("hono/utils/http-status").ContentfulStatusCode;
            input: {
                json: {
                    text?: string | undefined;
                    images?: {
                        mediaType: string;
                        data: string;
                    }[] | undefined;
                };
            } & {
                param: {
                    id: string;
                } & {
                    msgId: string;
                };
            };
        };
    };
} & {
    "/runs/:id/queued-messages/:msgId": {
        $delete: {
            output: {
                error: string;
            };
            outputFormat: "json";
            status: 404;
            input: {
                param: {
                    id: string;
                } & {
                    msgId: string;
                };
            };
        } | {
            output: {
                error: string;
            };
            outputFormat: "json";
            status: 409;
            input: {
                param: {
                    id: string;
                } & {
                    msgId: string;
                };
            };
        } | {
            output: {
                removed: true;
            };
            outputFormat: "json";
            status: import("hono/utils/http-status").ContentfulStatusCode;
            input: {
                param: {
                    id: string;
                } & {
                    msgId: string;
                };
            };
        };
    };
} & {
    "/runs/:id/finish": {
        $post: {
            output: {
                error: string;
            };
            outputFormat: "json";
            status: 404;
            input: {
                param: {
                    id: string;
                };
            };
        } | {
            output: {
                error: string;
            };
            outputFormat: "json";
            status: 409;
            input: {
                param: {
                    id: string;
                };
            };
        } | {
            output: {
                finished: true;
            };
            outputFormat: "json";
            status: import("hono/utils/http-status").ContentfulStatusCode;
            input: {
                param: {
                    id: string;
                };
            };
        };
    };
} & {
    "/runs/:id/continue": {
        $post: {
            output: {
                error: string;
            };
            outputFormat: "json";
            status: 404;
            input: {
                json: {
                    text?: string | undefined;
                    images?: {
                        mediaType: string;
                        data: string;
                    }[] | undefined;
                    runner?: "auto" | "claude" | "codex" | "opencode" | "pi" | undefined;
                    model?: string | undefined;
                };
            } & {
                param: {
                    id: string;
                };
            };
        } | {
            output: {
                error: string | undefined;
            };
            outputFormat: "json";
            status: 409;
            input: {
                json: {
                    text?: string | undefined;
                    images?: {
                        mediaType: string;
                        data: string;
                    }[] | undefined;
                    runner?: "auto" | "claude" | "codex" | "opencode" | "pi" | undefined;
                    model?: string | undefined;
                };
            } & {
                param: {
                    id: string;
                };
            };
        } | {
            output: {
                continued: true;
            };
            outputFormat: "json";
            status: import("hono/utils/http-status").ContentfulStatusCode;
            input: {
                json: {
                    text?: string | undefined;
                    images?: {
                        mediaType: string;
                        data: string;
                    }[] | undefined;
                    runner?: "auto" | "claude" | "codex" | "opencode" | "pi" | undefined;
                    model?: string | undefined;
                };
            } & {
                param: {
                    id: string;
                };
            };
        };
    };
} & {
    "/runs/:id/open-in-cli": {
        $post: {
            output: {
                error: string;
            };
            outputFormat: "json";
            status: 404;
            input: {
                param: {
                    id: string;
                };
            };
        } | {
            output: {
                error: string;
            };
            outputFormat: "json";
            status: 409;
            input: {
                param: {
                    id: string;
                };
            };
        } | {
            output: {
                opened: true;
                command: string;
            };
            outputFormat: "json";
            status: import("hono/utils/http-status").ContentfulStatusCode;
            input: {
                param: {
                    id: string;
                };
            };
        };
    };
} & {
    "/runs/:id/open-in": {
        $post: {
            output: {
                error: string;
            };
            outputFormat: "json";
            status: 404;
            input: {
                json: {
                    target: string;
                    path?: string | undefined;
                };
            } & {
                param: {
                    id: string;
                };
            };
        } | {
            output: {
                error: string;
            };
            outputFormat: "json";
            status: 409;
            input: {
                json: {
                    target: string;
                    path?: string | undefined;
                };
            } & {
                param: {
                    id: string;
                };
            };
        } | {
            output: {
                error: string;
            };
            outputFormat: "json";
            status: 400;
            input: {
                json: {
                    target: string;
                    path?: string | undefined;
                };
            } & {
                param: {
                    id: string;
                };
            };
        } | {
            output: {
                opened: true;
                path: string;
            };
            outputFormat: "json";
            status: import("hono/utils/http-status").ContentfulStatusCode;
            input: {
                json: {
                    target: string;
                    path?: string | undefined;
                };
            } & {
                param: {
                    id: string;
                };
            };
        };
    };
} & {
    "/runs/:id/handoff": {
        $get: {
            output: string;
            outputFormat: "text";
            status: 200;
            input: {
                param: {
                    id: string;
                };
            };
        } | {
            output: {
                error: string;
            };
            outputFormat: "json";
            status: 404;
            input: {
                param: {
                    id: string;
                };
            };
        };
    };
} & {
    "/runs/:id/images/:file": {
        $get: {
            output: {};
            outputFormat: string;
            status: import("hono/utils/http-status").StatusCode;
            input: {
                param: {
                    id: string;
                } & {
                    file: string;
                };
            };
        };
    };
} & {
    "/runs/:id/diff": {
        $get: {
            output: string;
            outputFormat: "text";
            status: import("hono/utils/http-status").ContentfulStatusCode;
            input: {
                param: {
                    id: string;
                };
            };
        } | {
            output: {
                error: string;
            };
            outputFormat: "json";
            status: 404;
            input: {
                param: {
                    id: string;
                };
            };
        };
    };
} & {
    "/runs/:id/changes": {
        $get: {
            output: {
                error: string;
            };
            outputFormat: "json";
            status: 404;
            input: {
                param: {
                    id: string;
                };
            };
        } | {
            output: {
                error: string;
            };
            outputFormat: "json";
            status: 409;
            input: {
                param: {
                    id: string;
                };
            };
        } | {
            output: {
                files: {
                    path: string;
                    oldPath?: string;
                    status: 'added' | 'modified' | 'deleted' | 'renamed' | 'copied';
                    adds: number;
                    dels: number;
                    binary: boolean;
                    image?: boolean;
                    patch: string;
                }[];
                stat: {
                    adds: number;
                    dels: number;
                    files: number;
                };
                repointedHead?: {
                    headBranch: string;
                    taskBranch: string;
                } | undefined;
            };
            outputFormat: "json";
            status: import("hono/utils/http-status").ContentfulStatusCode;
            input: {
                param: {
                    id: string;
                };
            };
        };
    };
} & {
    "/runs/:id/commits": {
        $get: {
            output: {
                error: string;
            };
            outputFormat: "json";
            status: 404;
            input: {
                param: {
                    id: string;
                };
            };
        } | {
            output: {
                error: string;
            };
            outputFormat: "json";
            status: 409;
            input: {
                param: {
                    id: string;
                };
            };
        } | {
            output: {
                commits: {
                    sha: string;
                    subject: string;
                    author: string;
                    when: string;
                }[];
                pushed: boolean;
                branch?: string | undefined;
            };
            outputFormat: "json";
            status: import("hono/utils/http-status").ContentfulStatusCode;
            input: {
                param: {
                    id: string;
                };
            };
        };
    };
} & {
    "/runs/:id/commit/:sha": {
        $get: {
            output: {
                error: string;
            };
            outputFormat: "json";
            status: 404;
            input: {
                param: {
                    id: string;
                } & {
                    sha: string;
                };
            };
        } | {
            output: {
                error: string;
            };
            outputFormat: "json";
            status: 409;
            input: {
                param: {
                    id: string;
                } & {
                    sha: string;
                };
            };
        } | {
            output: {
                sha: string;
                subject: string;
                author: string;
                when: string;
                files: {
                    path: string;
                    oldPath?: string;
                    status: 'added' | 'modified' | 'deleted' | 'renamed' | 'copied';
                    adds: number;
                    dels: number;
                    binary: boolean;
                    image?: boolean;
                    patch: string;
                }[];
                stat: {
                    adds: number;
                    dels: number;
                    files: number;
                };
            };
            outputFormat: "json";
            status: import("hono/utils/http-status").ContentfulStatusCode;
            input: {
                param: {
                    id: string;
                } & {
                    sha: string;
                };
            };
        };
    };
} & {
    "/runs/:id/files": {
        $get: {
            output: ArrayBuffer;
            outputFormat: "body";
            status: 200;
            input: {
                query: {
                    path?: string | undefined;
                    raw?: string | undefined;
                };
            } & {
                param: {
                    id: string;
                };
            };
        } | {
            output: {
                error: string;
            };
            outputFormat: "json";
            status: 400;
            input: {
                query: {
                    path?: string | undefined;
                    raw?: string | undefined;
                };
            } & {
                param: {
                    id: string;
                };
            };
        } | {
            output: {
                error: string;
            };
            outputFormat: "json";
            status: 404;
            input: {
                query: {
                    path?: string | undefined;
                    raw?: string | undefined;
                };
            } & {
                param: {
                    id: string;
                };
            };
        } | {
            output: {
                error: string;
            };
            outputFormat: "json";
            status: 409;
            input: {
                query: {
                    path?: string | undefined;
                    raw?: string | undefined;
                };
            } & {
                param: {
                    id: string;
                };
            };
        } | {
            output: {
                type: 'dir';
                path: string;
                entries: {
                    name: string;
                    type: 'dir' | 'file';
                    size?: number;
                }[];
            };
            outputFormat: "json";
            status: import("hono/utils/http-status").ContentfulStatusCode;
            input: {
                query: {
                    path?: string | undefined;
                    raw?: string | undefined;
                };
            } & {
                param: {
                    id: string;
                };
            };
        } | {
            output: {
                type: 'file';
                path: string;
                size: number;
                binary: boolean;
                tooLarge: boolean;
                content?: string | undefined;
            };
            outputFormat: "json";
            status: import("hono/utils/http-status").ContentfulStatusCode;
            input: {
                query: {
                    path?: string | undefined;
                    raw?: string | undefined;
                };
            } & {
                param: {
                    id: string;
                };
            };
        };
    };
} & {
    "/runs/:id/git/commit": {
        $post: {
            output: {
                error: string;
            };
            outputFormat: "json";
            status: 404;
            input: {
                json: {
                    message: string;
                };
            } & {
                param: {
                    id: string;
                };
            };
        } | {
            output: {
                error: string;
            };
            outputFormat: "json";
            status: 409;
            input: {
                json: {
                    message: string;
                };
            } & {
                param: {
                    id: string;
                };
            };
        } | {
            output: {
                committed: true;
                sha: string;
            };
            outputFormat: "json";
            status: import("hono/utils/http-status").ContentfulStatusCode;
            input: {
                json: {
                    message: string;
                };
            } & {
                param: {
                    id: string;
                };
            };
        };
    };
} & {
    "/runs/:id/git/push": {
        $post: {
            output: {
                error: string;
            };
            outputFormat: "json";
            status: 404;
            input: {
                param: {
                    id: string;
                };
            };
        } | {
            output: {
                error: string;
            };
            outputFormat: "json";
            status: 409;
            input: {
                param: {
                    id: string;
                };
            };
        } | {
            output: {
                pushed: true;
                branch: string;
                remote: string;
                upstreamSet: boolean;
            };
            outputFormat: "json";
            status: import("hono/utils/http-status").ContentfulStatusCode;
            input: {
                param: {
                    id: string;
                };
            };
        };
    };
} & {
    "/runs/:id/pr": {
        $post: {
            output: {
                error: string;
            };
            outputFormat: "json";
            status: 404;
            input: {
                param: {
                    id: string;
                };
            };
        } | {
            output: {
                error: string;
            };
            outputFormat: "json";
            status: 409;
            input: {
                param: {
                    id: string;
                };
            };
        } | {
            output: {
                error: string;
            };
            outputFormat: "json";
            status: 400;
            input: {
                param: {
                    id: string;
                };
            };
        } | {
            output: {
                url: string;
                dryRun: boolean;
            };
            outputFormat: "json";
            status: 201;
            input: {
                param: {
                    id: string;
                };
            };
        };
    };
} & {
    "/runs/:id/remove-worktree": {
        $post: {
            output: {
                error: string;
            };
            outputFormat: "json";
            status: 404;
            input: {
                param: {
                    id: string;
                };
            };
        } | {
            output: {
                error: string;
            };
            outputFormat: "json";
            status: 409;
            input: {
                param: {
                    id: string;
                };
            };
        } | {
            output: {
                removed: true;
            };
            outputFormat: "json";
            status: import("hono/utils/http-status").ContentfulStatusCode;
            input: {
                param: {
                    id: string;
                };
            };
        };
    };
} & {
    "/runs/:id": {
        $delete: {
            output: {
                error: string;
            };
            outputFormat: "json";
            status: 409;
            input: {
                param: {
                    id: string;
                };
            };
        } | {
            output: {
                error: string;
            };
            outputFormat: "json";
            status: 404;
            input: {
                param: {
                    id: string;
                };
            };
        } | {
            output: {
                deleted: true;
            };
            outputFormat: "json";
            status: import("hono/utils/http-status").ContentfulStatusCode;
            input: {
                param: {
                    id: string;
                };
            };
        };
    };
}, "/">, "/api/v1"> | import("hono/types").MergeSchemaPath<import("hono/types").BlankSchema | import("hono/types").MergeSchemaPath<{
    "/launch-key": {
        $get: {
            output: {
                key: string;
            };
            outputFormat: "json";
            status: import("hono/utils/http-status").ContentfulStatusCode;
            input: {};
        };
    };
}, "/"> | import("hono/types").MergeSchemaPath<{
    "/plan": {
        $post: {
            output: {
                error: string;
            };
            outputFormat: "json";
            status: 409;
            input: {
                json: {
                    task: string;
                };
            };
        } | {
            output: {
                name?: string;
                steps: {
                    id: string;
                    name?: string | undefined;
                    prompt?: string | undefined;
                    skill?: string | undefined;
                    model?: string | undefined;
                    runner?: "auto" | "claude" | "codex" | "opencode" | "pi" | undefined;
                    allowedTools?: string[] | undefined;
                    bashAllowlist?: string[] | undefined;
                    command?: string | undefined;
                    onFail?: {
                        retry: string;
                        max: number;
                    } | undefined;
                }[];
                rationale: string;
                fallback: boolean;
            };
            outputFormat: "json";
            status: import("hono/utils/http-status").ContentfulStatusCode;
            input: {
                json: {
                    task: string;
                };
            };
        };
    };
}, "/"> | import("hono/types").MergeSchemaPath<{
    "/ui-state": {
        $get: {
            output: {
                [x: string]: import("hono/utils/types").JSONValue;
                lastTask?: {
                    source: "baseline";
                } | {
                    source: "skill" | "workflow";
                    ref: string;
                } | undefined;
                recentSources?: ({
                    source: "baseline";
                } | {
                    source: "skill" | "workflow";
                    ref: string;
                })[] | undefined;
                lastWorktree?: boolean | undefined;
                lastAutonomous?: boolean | undefined;
                lastGenerateFollowups?: boolean | undefined;
                skillUsage?: {
                    [x: string]: number;
                } | undefined;
                runsView?: "list" | "table" | undefined;
                githubView?: "issues" | "prs" | undefined;
                appearance?: {
                    accent?: "lime" | "violet" | undefined;
                    density?: "comfortable" | "compact" | "ultra" | undefined;
                    width?: "narrow" | "wide" | undefined;
                } | undefined;
                promptTemplates?: {
                    id: string;
                    label: string;
                    text: string;
                    skills?: string[] | undefined;
                }[] | undefined;
                dismissedSkillsBanner?: boolean | undefined;
            };
            outputFormat: "json";
            status: import("hono/utils/http-status").ContentfulStatusCode;
            input: {};
        };
    };
} & {
    "/ui-state": {
        $put: {
            output: {
                error: string;
            };
            outputFormat: "json";
            status: 500;
            input: {
                json: {
                    [x: string]: unknown;
                    lastTask?: {
                        source: "baseline";
                    } | {
                        source: "skill" | "workflow";
                        ref: string;
                    } | undefined;
                    recentSources?: ({
                        source: "baseline";
                    } | {
                        source: "skill" | "workflow";
                        ref: string;
                    })[] | undefined;
                    lastWorktree?: boolean | undefined;
                    lastAutonomous?: boolean | undefined;
                    lastGenerateFollowups?: boolean | undefined;
                    skillUsage?: Record<string, number> | undefined;
                    runsView?: "list" | "table" | undefined;
                    githubView?: "issues" | "prs" | undefined;
                    appearance?: {
                        accent?: "lime" | "violet" | undefined;
                        density?: "comfortable" | "compact" | "ultra" | undefined;
                        width?: "narrow" | "wide" | undefined;
                    } | undefined;
                    promptTemplates?: {
                        id: string;
                        label: string;
                        text: string;
                        skills?: string[] | undefined;
                    }[] | undefined;
                    dismissedSkillsBanner?: boolean | undefined;
                };
            };
        } | {
            output: {
                [x: string]: import("hono/utils/types").JSONValue;
                lastTask?: {
                    source: "baseline";
                } | {
                    source: "skill" | "workflow";
                    ref: string;
                } | undefined;
                recentSources?: ({
                    source: "baseline";
                } | {
                    source: "skill" | "workflow";
                    ref: string;
                })[] | undefined;
                lastWorktree?: boolean | undefined;
                lastAutonomous?: boolean | undefined;
                lastGenerateFollowups?: boolean | undefined;
                skillUsage?: {
                    [x: string]: number;
                } | undefined;
                runsView?: "list" | "table" | undefined;
                githubView?: "issues" | "prs" | undefined;
                appearance?: {
                    accent?: "lime" | "violet" | undefined;
                    density?: "comfortable" | "compact" | "ultra" | undefined;
                    width?: "narrow" | "wide" | undefined;
                } | undefined;
                promptTemplates?: {
                    id: string;
                    label: string;
                    text: string;
                    skills?: string[] | undefined;
                }[] | undefined;
                dismissedSkillsBanner?: boolean | undefined;
            };
            outputFormat: "json";
            status: import("hono/utils/http-status").ContentfulStatusCode;
            input: {
                json: {
                    [x: string]: unknown;
                    lastTask?: {
                        source: "baseline";
                    } | {
                        source: "skill" | "workflow";
                        ref: string;
                    } | undefined;
                    recentSources?: ({
                        source: "baseline";
                    } | {
                        source: "skill" | "workflow";
                        ref: string;
                    })[] | undefined;
                    lastWorktree?: boolean | undefined;
                    lastAutonomous?: boolean | undefined;
                    lastGenerateFollowups?: boolean | undefined;
                    skillUsage?: Record<string, number> | undefined;
                    runsView?: "list" | "table" | undefined;
                    githubView?: "issues" | "prs" | undefined;
                    appearance?: {
                        accent?: "lime" | "violet" | undefined;
                        density?: "comfortable" | "compact" | "ultra" | undefined;
                        width?: "narrow" | "wide" | undefined;
                    } | undefined;
                    promptTemplates?: {
                        id: string;
                        label: string;
                        text: string;
                        skills?: string[] | undefined;
                    }[] | undefined;
                    dismissedSkillsBanner?: boolean | undefined;
                };
            };
        };
    };
}, "/"> | import("hono/types").MergeSchemaPath<{
    "/groups/:groupId": {
        $get: {
            output: {
                error: string;
            };
            outputFormat: "json";
            status: 404;
            input: {
                param: {
                    groupId: string;
                };
            };
        } | {
            output: {
                groupId: string;
                runs: {
                    id: string;
                    variant: string;
                    title: string;
                    status: "cancelled" | "done" | "failed" | "queued" | "review" | "running" | "waiting";
                    archived: boolean;
                    tokensUsed: number;
                    inputTokens?: number | undefined;
                    outputTokens?: number | undefined;
                    costUsd?: number | undefined;
                    diffStat: string;
                    handoffExcerpt: string;
                }[];
            };
            outputFormat: "json";
            status: import("hono/utils/http-status").ContentfulStatusCode;
            input: {
                param: {
                    groupId: string;
                };
            };
        };
    };
} & {
    "/groups/:groupId/pick": {
        $post: {
            output: {
                error: string;
            };
            outputFormat: "json";
            status: 404;
            input: {
                json: {
                    runId: string;
                };
            } & {
                param: {
                    groupId: string;
                };
            };
        } | {
            output: {
                error: string;
            };
            outputFormat: "json";
            status: 409;
            input: {
                json: {
                    runId: string;
                };
            } & {
                param: {
                    groupId: string;
                };
            };
        } | {
            output: {
                winner?: {
                    id: string;
                    title: string;
                    titleSummary?: string | undefined;
                    diffStat?: {
                        adds: number;
                        dels: number;
                        files: number;
                        repointed?: boolean | undefined;
                    } | undefined;
                    workflow: string;
                    task: string;
                    queuedMessages?: {
                        id: string;
                        text: string;
                        images?: string[] | undefined;
                        createdAt: string;
                    }[] | undefined;
                    taskImages?: string[] | undefined;
                    model?: string | undefined;
                    reasoningEffort?: "auto" | "high" | "low" | "medium" | "xhigh" | undefined;
                    modelIdentity?: string | undefined;
                    runner?: "claude" | "codex" | "opencode" | "pi" | undefined;
                    requestedRunner?: "auto" | "claude" | "codex" | "opencode" | "pi" | undefined;
                    agentProfile?: string | undefined;
                    systemPrompt?: string | undefined;
                    generateFollowups?: boolean | undefined;
                    autonomous?: boolean | undefined;
                    automation?: {
                        automationId: string;
                        automationRevision: number;
                        receiptId: string;
                        event: string;
                        githubUrl: string;
                    } | undefined;
                    status: "cancelled" | "done" | "failed" | "queued" | "review" | "running" | "waiting";
                    activity?: "monitoring" | undefined;
                    monitoringWakeAt?: string | undefined;
                    monitoringWakeCapReached?: boolean | undefined;
                    autoResumeAt?: string | undefined;
                    autoResumeAttempts?: number | undefined;
                    blockedReason?: {
                        type: "provider_quota";
                        providers: ("claude" | "codex")[];
                        retryAt?: string | undefined;
                    } | undefined;
                    createdAt: string;
                    startedAt?: string | undefined;
                    finishedAt?: string | undefined;
                    tokensUsed: number;
                    inputTokens?: number | undefined;
                    outputTokens?: number | undefined;
                    costUsd?: number | undefined;
                    pullRequestUrl?: string | undefined;
                    referencedPullRequestUrl?: string | undefined;
                    prNumber?: number | undefined;
                    issueNumber?: number | undefined;
                    referencedIssueNumberSeeded?: boolean | undefined;
                    titleOrigin?: "auto" | "marker" | "user" | undefined;
                    markerRefs?: {
                        pr?: number | undefined;
                        issue?: number | undefined;
                    } | undefined;
                    referencedPrCandidates?: string[] | undefined;
                    referencedIssueUrl?: string | undefined;
                    referencedIssueCandidates?: string[] | undefined;
                    worktree?: false | undefined;
                    worktreePath?: string | undefined;
                    branch?: string | undefined;
                    baseBranch?: string | undefined;
                    worktreeReclaimedAt?: string | undefined;
                    groupId?: string | undefined;
                    variant?: string | undefined;
                    peakRssBytes?: number | undefined;
                    peakProcCount?: number | undefined;
                    archived: boolean;
                    archivedAt?: string | undefined;
                    seenAt?: string | undefined;
                    currentStepId?: string | undefined;
                    error?: string | undefined;
                    steps: {
                        id: string;
                        name: string;
                        kind: "agent" | "check";
                        status: "cancelled" | "done" | "failed" | "pending" | "review" | "running" | "skipped" | "waiting";
                        iterations: number;
                        tokensUsed: number;
                        inputTokens?: number | undefined;
                        outputTokens?: number | undefined;
                        usageInvocationsStarted?: number | undefined;
                        usageInvocationsObserved?: number | undefined;
                        usageTurnsStarted?: number | undefined;
                        usageTurnsRecorded?: number | undefined;
                        usageInvocationEpoch?: number | undefined;
                        startedAt?: string | undefined;
                        finishedAt?: string | undefined;
                        error?: string | undefined;
                        sessionId?: string | undefined;
                        backend?: "claude" | "codex" | "opencode" | "pi" | undefined;
                        requestedRunner?: "auto" | "claude" | "codex" | "opencode" | "pi" | undefined;
                        profileId?: string | undefined;
                        reasoningEffort?: "high" | "low" | "medium" | "xhigh" | undefined;
                        costUsd?: number | undefined;
                        modelIdentity?: string | undefined;
                    }[];
                    workflowDef?: {
                        name: string;
                        description?: string | undefined;
                        steps: {
                            id: string;
                            name?: string | undefined;
                            prompt?: string | undefined;
                            skill?: string | undefined;
                            model?: string | undefined;
                            runner?: "auto" | "claude" | "codex" | "opencode" | "pi" | undefined;
                            allowedTools?: string[] | undefined;
                            bashAllowlist?: string[] | undefined;
                            command?: string | undefined;
                            onFail?: {
                                retry: string;
                                max: number;
                            } | undefined;
                        }[];
                        source: "built-in" | "file";
                        path?: string | undefined;
                    } | undefined;
                } | undefined;
            };
            outputFormat: "json";
            status: import("hono/utils/http-status").ContentfulStatusCode;
            input: {
                json: {
                    runId: string;
                };
            } & {
                param: {
                    groupId: string;
                };
            };
        };
    };
}, "/"> | import("hono/types").MergeSchemaPath<{
    "/open-targets": {
        $get: {
            output: {
                targets: {
                    id: string;
                    label: string;
                    icon?: string;
                }[];
            };
            outputFormat: "json";
            status: import("hono/utils/http-status").ContentfulStatusCode;
            input: {};
        };
    };
} & {
    "/open-in": {
        $post: {
            output: {
                error: string;
            };
            outputFormat: "json";
            status: 409;
            input: {
                json: {
                    target: string;
                };
            };
        } | {
            output: {
                error: string;
            };
            outputFormat: "json";
            status: 400;
            input: {
                json: {
                    target: string;
                };
            };
        } | {
            output: {
                opened: true;
                path: string;
            };
            outputFormat: "json";
            status: import("hono/utils/http-status").ContentfulStatusCode;
            input: {
                json: {
                    target: string;
                };
            };
        };
    };
}, "/"> | import("hono/types").MergeSchemaPath<{
    "/worktrees": {
        $get: {
            output: {
                worktrees: {
                    runId: string;
                    title: string;
                    status: "cancelled" | "done" | "failed" | "queued" | "review" | "running" | "waiting";
                    branch: string | null;
                    sizeBytes: number | null;
                    finishedAt: string | null;
                    reclaimable: boolean;
                }[];
                totalBytes: number | null;
                keep: number;
            };
            outputFormat: "json";
            status: import("hono/utils/http-status").ContentfulStatusCode;
            input: {};
        };
    };
} & {
    "/worktrees/reclaim": {
        $post: {
            output: {
                reclaimed: string[];
            };
            outputFormat: "json";
            status: import("hono/utils/http-status").ContentfulStatusCode;
            input: {
                json: {
                    [x: string]: unknown;
                };
            };
        };
    };
}, "/"> | import("hono/types").MergeSchemaPath<{
    "/runs/:id/events": {
        $get: {
            output: {};
            outputFormat: string;
            status: import("hono/utils/http-status").StatusCode;
            input: {
                param: {
                    id: string;
                };
            } & {
                query: {
                    cursor?: string | undefined;
                    afterSeq?: number | undefined;
                };
            };
        } | {
            output: {
                error: string;
            };
            outputFormat: "json";
            status: 400;
            input: {
                param: {
                    id: string;
                };
            } & {
                query: {
                    cursor?: string | undefined;
                    afterSeq?: number | undefined;
                };
            };
        };
    };
} & {
    "/events": {
        $get: {
            output: {};
            outputFormat: string;
            status: import("hono/utils/http-status").StatusCode;
            input: {};
        };
    };
}, "/"> | import("hono/types").MergeSchemaPath<{
    "/config": {
        $get: {
            output: {
                baseBranch: string | null;
                defaultRunner: "auto" | "claude" | "codex" | "opencode" | "pi";
                systemPrompt: string | null;
                defaultModels: {
                    claude?: string | undefined;
                    codex?: string | undefined;
                    opencode?: string | undefined;
                    pi?: string | undefined;
                };
                modelsLocked: boolean;
                maxParallel: number;
                memoryLimitMb: number | null;
                worktreeRetention: number;
                liveTitleUpdates: boolean | null;
                reviewGate: boolean | null;
            };
            outputFormat: "json";
            status: import("hono/utils/http-status").ContentfulStatusCode;
            input: {};
        };
    };
} & {
    "/config": {
        $put: {
            output: {
                baseBranch: string | null;
                defaultRunner: "auto" | "claude" | "codex" | "opencode" | "pi";
                systemPrompt: string | null;
                defaultModels: {
                    claude?: string | undefined;
                    codex?: string | undefined;
                    opencode?: string | undefined;
                    pi?: string | undefined;
                };
                modelsLocked: boolean;
                maxParallel: number;
                memoryLimitMb: number | null;
                worktreeRetention: number;
                liveTitleUpdates: boolean | null;
                reviewGate: boolean | null;
            };
            outputFormat: "json";
            status: import("hono/utils/http-status").ContentfulStatusCode;
            input: {
                json: {
                    baseBranch?: string | null | undefined;
                    defaultRunner?: "auto" | "claude" | "codex" | "opencode" | "pi" | undefined;
                    systemPrompt?: string | null | undefined;
                    defaultModels?: {
                        claude?: string | null | undefined;
                        codex?: string | null | undefined;
                        opencode?: string | null | undefined;
                        pi?: string | null | undefined;
                    } | undefined;
                    maxParallel?: number | undefined;
                    memoryLimitMb?: number | null | undefined;
                    worktreeRetention?: number | null | undefined;
                    liveTitleUpdates?: boolean | null | undefined;
                    reviewGate?: boolean | null | undefined;
                };
            };
        } | {
            output: {
                error: string;
            };
            outputFormat: "json";
            status: 409;
            input: {
                json: {
                    baseBranch?: string | null | undefined;
                    defaultRunner?: "auto" | "claude" | "codex" | "opencode" | "pi" | undefined;
                    systemPrompt?: string | null | undefined;
                    defaultModels?: {
                        claude?: string | null | undefined;
                        codex?: string | null | undefined;
                        opencode?: string | null | undefined;
                        pi?: string | null | undefined;
                    } | undefined;
                    maxParallel?: number | undefined;
                    memoryLimitMb?: number | null | undefined;
                    worktreeRetention?: number | null | undefined;
                    liveTitleUpdates?: boolean | null | undefined;
                    reviewGate?: boolean | null | undefined;
                };
            };
        } | {
            output: {
                error: string;
            };
            outputFormat: "json";
            status: 500;
            input: {
                json: {
                    baseBranch?: string | null | undefined;
                    defaultRunner?: "auto" | "claude" | "codex" | "opencode" | "pi" | undefined;
                    systemPrompt?: string | null | undefined;
                    defaultModels?: {
                        claude?: string | null | undefined;
                        codex?: string | null | undefined;
                        opencode?: string | null | undefined;
                        pi?: string | null | undefined;
                    } | undefined;
                    maxParallel?: number | undefined;
                    memoryLimitMb?: number | null | undefined;
                    worktreeRetention?: number | null | undefined;
                    liveTitleUpdates?: boolean | null | undefined;
                    reviewGate?: boolean | null | undefined;
                };
            };
        };
    };
}, "/"> | import("hono/types").MergeSchemaPath<{
    "/skills": {
        $get: {
            output: {
                name: string;
                description?: string;
                interactive?: true;
                body: string;
                path: string;
                source: 'ai' | 'cezar' | 'agents' | 'global' | 'team';
                team?: {
                    repo: string;
                    ref: string;
                    path: string;
                    dir: boolean;
                    commit?: string;
                } | undefined;
            }[];
            outputFormat: "json";
            status: import("hono/utils/http-status").ContentfulStatusCode;
            input: {
                query: {
                    wait?: string | undefined;
                };
            };
        } | {
            output: {
                error: string;
            };
            outputFormat: "json";
            status: 400;
            input: {
                query: {
                    wait?: string | undefined;
                };
            };
        };
    };
} & {
    "/skills/importable": {
        $get: {
            output: {
                name: string;
                description?: string | undefined;
            }[];
            outputFormat: "json";
            status: import("hono/utils/http-status").ContentfulStatusCode;
            input: {
                query: {
                    wait?: string | undefined;
                };
            };
        } | {
            output: {
                error: string;
            };
            outputFormat: "json";
            status: 400;
            input: {
                query: {
                    wait?: string | undefined;
                };
            };
        };
    };
} & {
    "/skills/refresh": {
        $post: {
            output: {
                name: string;
                description?: string;
                interactive?: true;
                body: string;
                path: string;
                source: 'ai' | 'cezar' | 'agents' | 'global' | 'team';
                team?: {
                    repo: string;
                    ref: string;
                    path: string;
                    dir: boolean;
                    commit?: string;
                } | undefined;
            }[];
            outputFormat: "json";
            status: import("hono/utils/http-status").ContentfulStatusCode;
            input: {};
        };
    };
}, "/"> | import("hono/types").MergeSchemaPath<{
    "/todos": {
        $get: {
            output: {
                id: string;
                ts?: string | undefined;
                taskId?: string | undefined;
                summary: string;
                action?: string | undefined;
                prUrl?: string | undefined;
                suggestedSkill?: string | undefined;
                suggestedArgs?: string | undefined;
                suggestedPrompt?: string | undefined;
                runnable?: boolean | undefined;
                startedTaskId?: string | undefined;
            }[];
            outputFormat: "json";
            status: import("hono/utils/http-status").ContentfulStatusCode;
            input: {};
        };
    };
} & {
    "/todos/:id": {
        $delete: {
            output: {
                error: string;
            };
            outputFormat: "json";
            status: 409;
            input: {
                param: {
                    id: string;
                };
            };
        } | {
            output: {
                removed: true;
            };
            outputFormat: "json";
            status: import("hono/utils/http-status").ContentfulStatusCode;
            input: {
                param: {
                    id: string;
                };
            };
        } | {
            output: {
                error: string;
            };
            outputFormat: "json";
            status: 404;
            input: {
                param: {
                    id: string;
                };
            };
        };
    };
} & {
    "/todos/:id/start": {
        $post: {
            output: {
                error: string;
            };
            outputFormat: "json";
            status: 409;
            input: {
                json: {
                    runner?: "auto" | "claude" | "codex" | "opencode" | "pi" | undefined;
                    model?: string | undefined;
                    prompt?: string | undefined;
                } | undefined;
            } & {
                param: {
                    id: string;
                };
            };
        } | {
            output: {
                run: {
                    id: string;
                    title: string;
                    titleSummary?: string | undefined;
                    diffStat?: {
                        adds: number;
                        dels: number;
                        files: number;
                        repointed?: boolean | undefined;
                    } | undefined;
                    workflow: string;
                    task: string;
                    queuedMessages?: {
                        id: string;
                        text: string;
                        images?: string[] | undefined;
                        createdAt: string;
                    }[] | undefined;
                    taskImages?: string[] | undefined;
                    model?: string | undefined;
                    reasoningEffort?: "auto" | "high" | "low" | "medium" | "xhigh" | undefined;
                    modelIdentity?: string | undefined;
                    runner?: "claude" | "codex" | "opencode" | "pi" | undefined;
                    requestedRunner?: "auto" | "claude" | "codex" | "opencode" | "pi" | undefined;
                    agentProfile?: string | undefined;
                    systemPrompt?: string | undefined;
                    generateFollowups?: boolean | undefined;
                    autonomous?: boolean | undefined;
                    automation?: {
                        automationId: string;
                        automationRevision: number;
                        receiptId: string;
                        event: string;
                        githubUrl: string;
                    } | undefined;
                    status: "cancelled" | "done" | "failed" | "queued" | "review" | "running" | "waiting";
                    activity?: "monitoring" | undefined;
                    monitoringWakeAt?: string | undefined;
                    monitoringWakeCapReached?: boolean | undefined;
                    autoResumeAt?: string | undefined;
                    autoResumeAttempts?: number | undefined;
                    blockedReason?: {
                        type: "provider_quota";
                        providers: ("claude" | "codex")[];
                        retryAt?: string | undefined;
                    } | undefined;
                    createdAt: string;
                    startedAt?: string | undefined;
                    finishedAt?: string | undefined;
                    tokensUsed: number;
                    inputTokens?: number | undefined;
                    outputTokens?: number | undefined;
                    costUsd?: number | undefined;
                    pullRequestUrl?: string | undefined;
                    referencedPullRequestUrl?: string | undefined;
                    prNumber?: number | undefined;
                    issueNumber?: number | undefined;
                    referencedIssueNumberSeeded?: boolean | undefined;
                    titleOrigin?: "auto" | "marker" | "user" | undefined;
                    markerRefs?: {
                        pr?: number | undefined;
                        issue?: number | undefined;
                    } | undefined;
                    referencedPrCandidates?: string[] | undefined;
                    referencedIssueUrl?: string | undefined;
                    referencedIssueCandidates?: string[] | undefined;
                    worktree?: false | undefined;
                    worktreePath?: string | undefined;
                    branch?: string | undefined;
                    baseBranch?: string | undefined;
                    worktreeReclaimedAt?: string | undefined;
                    groupId?: string | undefined;
                    variant?: string | undefined;
                    peakRssBytes?: number | undefined;
                    peakProcCount?: number | undefined;
                    archived: boolean;
                    archivedAt?: string | undefined;
                    seenAt?: string | undefined;
                    currentStepId?: string | undefined;
                    error?: string | undefined;
                    steps: {
                        id: string;
                        name: string;
                        kind: "agent" | "check";
                        status: "cancelled" | "done" | "failed" | "pending" | "review" | "running" | "skipped" | "waiting";
                        iterations: number;
                        tokensUsed: number;
                        inputTokens?: number | undefined;
                        outputTokens?: number | undefined;
                        usageInvocationsStarted?: number | undefined;
                        usageInvocationsObserved?: number | undefined;
                        usageTurnsStarted?: number | undefined;
                        usageTurnsRecorded?: number | undefined;
                        usageInvocationEpoch?: number | undefined;
                        startedAt?: string | undefined;
                        finishedAt?: string | undefined;
                        error?: string | undefined;
                        sessionId?: string | undefined;
                        backend?: "claude" | "codex" | "opencode" | "pi" | undefined;
                        requestedRunner?: "auto" | "claude" | "codex" | "opencode" | "pi" | undefined;
                        profileId?: string | undefined;
                        reasoningEffort?: "high" | "low" | "medium" | "xhigh" | undefined;
                        costUsd?: number | undefined;
                        modelIdentity?: string | undefined;
                    }[];
                    workflowDef?: {
                        name: string;
                        description?: string | undefined;
                        steps: {
                            id: string;
                            name?: string | undefined;
                            prompt?: string | undefined;
                            skill?: string | undefined;
                            model?: string | undefined;
                            runner?: "auto" | "claude" | "codex" | "opencode" | "pi" | undefined;
                            allowedTools?: string[] | undefined;
                            bashAllowlist?: string[] | undefined;
                            command?: string | undefined;
                            onFail?: {
                                retry: string;
                                max: number;
                            } | undefined;
                        }[];
                        source: "built-in" | "file";
                        path?: string | undefined;
                    } | undefined;
                };
            };
            outputFormat: "json";
            status: 201;
            input: {
                json: {
                    runner?: "auto" | "claude" | "codex" | "opencode" | "pi" | undefined;
                    model?: string | undefined;
                    prompt?: string | undefined;
                } | undefined;
            } & {
                param: {
                    id: string;
                };
            };
        } | {
            output: {
                error: string;
            };
            outputFormat: "json";
            status: 409;
            input: {
                json: {
                    runner?: "auto" | "claude" | "codex" | "opencode" | "pi" | undefined;
                    model?: string | undefined;
                    prompt?: string | undefined;
                } | undefined;
            } & {
                param: {
                    id: string;
                };
            };
        } | {
            output: {
                error: string;
            };
            outputFormat: "json";
            status: 404;
            input: {
                json: {
                    runner?: "auto" | "claude" | "codex" | "opencode" | "pi" | undefined;
                    model?: string | undefined;
                    prompt?: string | undefined;
                } | undefined;
            } & {
                param: {
                    id: string;
                };
            };
        };
    };
}, "/"> | import("hono/types").MergeSchemaPath<{
    "/agent-config": {
        $get: {
            output: {
                editable: boolean;
                files: {
                    id: string;
                    runners: import("../agent-config/catalog.ts").ConfigFileDef['runners'];
                    kind: import("../agent-config/catalog.ts").ConfigFileDef['kind'];
                    scope: import("../agent-config/catalog.ts").ConfigFileDef['scope'];
                    label: string;
                    path: string;
                    format: import("../agent-config/catalog.ts").ConfigFileDef['format'];
                    tracked: import("../agent-config/catalog.ts").ConfigFileDef['tracked'];
                    seeded: boolean;
                    holdsMcp: boolean;
                    precedence: string;
                    hotReload?: string;
                    docsUrl: string;
                    exists: boolean;
                    size: number;
                    version: string | null;
                    writable: boolean;
                    readOnlyReason?: string;
                }[];
                userMcp: import("../agent-config/service.ts").UserMcpListing | null;
            };
            outputFormat: "json";
            status: import("hono/utils/http-status").ContentfulStatusCode;
            input: {};
        };
    };
} & {
    "/agent-config/:id": {
        $get: {
            output: {
                error: string;
            };
            outputFormat: "json";
            status: 404;
            input: {
                param: {
                    id: string;
                };
            };
        } | {
            output: {
                error: string;
            };
            outputFormat: "json";
            status: 409;
            input: {
                param: {
                    id: string;
                };
            };
        } | {
            output: {
                error: string;
            };
            outputFormat: "json";
            status: 500;
            input: {
                param: {
                    id: string;
                };
            };
        } | {
            output: {
                id: string;
                path: string;
                exists: boolean;
                content: string;
                version: string | null;
            };
            outputFormat: "json";
            status: import("hono/utils/http-status").ContentfulStatusCode;
            input: {
                param: {
                    id: string;
                };
            };
        };
    };
} & {
    "/agent-config/:id": {
        $put: {
            output: {
                id: string;
                path: string;
                exists: boolean;
                content: string;
                version: string | null;
            };
            outputFormat: "json";
            status: import("hono/utils/http-status").ContentfulStatusCode;
            input: {
                json: {
                    content: string;
                    version: string | null;
                };
            } & {
                param: {
                    id: string;
                };
            };
        } | {
            output: {
                error: string;
            };
            outputFormat: "json";
            status: 404;
            input: {
                json: {
                    content: string;
                    version: string | null;
                };
            } & {
                param: {
                    id: string;
                };
            };
        } | {
            output: {
                error: string;
            };
            outputFormat: "json";
            status: 400 | 409 | 500;
            input: {
                json: {
                    content: string;
                    version: string | null;
                };
            } & {
                param: {
                    id: string;
                };
            };
        };
    };
}, "/"> | import("hono/types").MergeSchemaPath<{
    "/ide/tree": {
        $get: {
            output: {
                error: string;
            };
            outputFormat: "json";
            status: 400;
            input: {
                query: {
                    path?: string | undefined;
                };
            };
        } | {
            output: {
                error: string;
            };
            outputFormat: "json";
            status: 400 | 404 | 409;
            input: {
                query: {
                    path?: string | undefined;
                };
            };
        } | {
            output: {
                path: string;
                entries: {
                    name: string;
                    path: string;
                    type: 'dir' | 'file';
                    size?: number;
                }[];
                truncated: boolean;
            };
            outputFormat: "json";
            status: import("hono/utils/http-status").ContentfulStatusCode;
            input: {
                query: {
                    path?: string | undefined;
                };
            };
        };
    };
} & {
    "/ide/file": {
        $get: {
            output: {
                error: string;
            };
            outputFormat: "json";
            status: 400;
            input: {
                query: {
                    path: string | string[];
                };
            };
        } | {
            output: {
                error: string;
            };
            outputFormat: "json";
            status: 400 | 404 | 409;
            input: {
                query: {
                    path: string | string[];
                };
            };
        } | {
            output: {
                path: string;
                content: string;
                size: number;
            };
            outputFormat: "json";
            status: import("hono/utils/http-status").ContentfulStatusCode;
            input: {
                query: {
                    path: string | string[];
                };
            };
        };
    };
} & {
    "/ide/file": {
        $put: {
            output: {
                path: string;
                content: string;
                size: number;
            };
            outputFormat: "json";
            status: import("hono/utils/http-status").ContentfulStatusCode;
            input: {
                json: {
                    path: string;
                    content: string;
                };
            };
        } | {
            output: {
                error: string;
            };
            outputFormat: "json";
            status: 400 | 404 | 409;
            input: {
                json: {
                    path: string;
                    content: string;
                };
            };
        };
    };
}, "/"> | import("hono/types").MergeSchemaPath<{
    "/workflows": {
        $get: {
            output: {
                workflows: {
                    name: string;
                    description?: string | undefined;
                    steps: {
                        id: string;
                        name?: string | undefined;
                        prompt?: string | undefined;
                        skill?: string | undefined;
                        model?: string | undefined;
                        runner?: "auto" | "claude" | "codex" | "opencode" | "pi" | undefined;
                        allowedTools?: string[] | undefined;
                        bashAllowlist?: string[] | undefined;
                        command?: string | undefined;
                        onFail?: {
                            retry: string;
                            max: number;
                        } | undefined;
                    }[];
                    source: "built-in" | "file";
                    path?: string | undefined;
                }[];
                issues: {
                    path: string;
                    message: string;
                }[];
            };
            outputFormat: "json";
            status: import("hono/utils/http-status").ContentfulStatusCode;
            input: {};
        };
    };
} & {
    "/workflows": {
        $post: {
            output: {
                error: string;
            };
            outputFormat: "json";
            status: 400;
            input: {
                json: {
                    name: string;
                    description?: string | undefined;
                    steps?: {
                        id: string;
                        name?: string | undefined;
                        prompt?: string | undefined;
                        skill?: string | undefined;
                        model?: string | undefined;
                        runner?: "auto" | "claude" | "codex" | "opencode" | "pi" | undefined;
                        allowedTools?: string[] | undefined;
                        bashAllowlist?: string[] | undefined;
                        command?: string | undefined;
                        onFail?: {
                            retry: string;
                            max?: number | undefined;
                        } | undefined;
                    }[] | undefined;
                    skills?: string[] | undefined;
                    overwrite?: boolean | undefined;
                };
            };
        } | {
            output: {
                error: string;
                exists: true;
            };
            outputFormat: "json";
            status: 409;
            input: {
                json: {
                    name: string;
                    description?: string | undefined;
                    steps?: {
                        id: string;
                        name?: string | undefined;
                        prompt?: string | undefined;
                        skill?: string | undefined;
                        model?: string | undefined;
                        runner?: "auto" | "claude" | "codex" | "opencode" | "pi" | undefined;
                        allowedTools?: string[] | undefined;
                        bashAllowlist?: string[] | undefined;
                        command?: string | undefined;
                        onFail?: {
                            retry: string;
                            max?: number | undefined;
                        } | undefined;
                    }[] | undefined;
                    skills?: string[] | undefined;
                    overwrite?: boolean | undefined;
                };
            };
        } | {
            output: {
                error: string;
            };
            outputFormat: "json";
            status: 500;
            input: {
                json: {
                    name: string;
                    description?: string | undefined;
                    steps?: {
                        id: string;
                        name?: string | undefined;
                        prompt?: string | undefined;
                        skill?: string | undefined;
                        model?: string | undefined;
                        runner?: "auto" | "claude" | "codex" | "opencode" | "pi" | undefined;
                        allowedTools?: string[] | undefined;
                        bashAllowlist?: string[] | undefined;
                        command?: string | undefined;
                        onFail?: {
                            retry: string;
                            max?: number | undefined;
                        } | undefined;
                    }[] | undefined;
                    skills?: string[] | undefined;
                    overwrite?: boolean | undefined;
                };
            };
        } | {
            output: {
                path: string;
                name: string;
            };
            outputFormat: "json";
            status: 201;
            input: {
                json: {
                    name: string;
                    description?: string | undefined;
                    steps?: {
                        id: string;
                        name?: string | undefined;
                        prompt?: string | undefined;
                        skill?: string | undefined;
                        model?: string | undefined;
                        runner?: "auto" | "claude" | "codex" | "opencode" | "pi" | undefined;
                        allowedTools?: string[] | undefined;
                        bashAllowlist?: string[] | undefined;
                        command?: string | undefined;
                        onFail?: {
                            retry: string;
                            max?: number | undefined;
                        } | undefined;
                    }[] | undefined;
                    skills?: string[] | undefined;
                    overwrite?: boolean | undefined;
                };
            };
        };
    };
} & {
    "/workflows/:name": {
        $delete: {
            output: {
                error: string;
            };
            outputFormat: "json";
            status: 404;
            input: {
                param: {
                    name: string;
                };
            };
        } | {
            output: {
                error: string;
            };
            outputFormat: "json";
            status: 400;
            input: {
                param: {
                    name: string;
                };
            };
        } | {
            output: {
                error: string;
            };
            outputFormat: "json";
            status: 500;
            input: {
                param: {
                    name: string;
                };
            };
        } | {
            output: {
                ok: true;
                path: string;
            };
            outputFormat: "json";
            status: import("hono/utils/http-status").ContentfulStatusCode;
            input: {
                param: {
                    name: string;
                };
            };
        };
    };
} & {
    "/workflows/parse": {
        $post: {
            output: {
                error: string;
            };
            outputFormat: "json";
            status: 400;
            input: {
                json: {
                    yaml: string;
                };
            };
        } | {
            output: {
                name: string;
                description?: string;
                steps: {
                    id: string;
                    name?: string | undefined;
                    prompt?: string | undefined;
                    skill?: string | undefined;
                    model?: string | undefined;
                    runner?: "auto" | "claude" | "codex" | "opencode" | "pi" | undefined;
                    allowedTools?: string[] | undefined;
                    bashAllowlist?: string[] | undefined;
                    command?: string | undefined;
                    onFail?: {
                        retry: string;
                        max: number;
                    } | undefined;
                }[];
            };
            outputFormat: "json";
            status: import("hono/utils/http-status").ContentfulStatusCode;
            input: {
                json: {
                    yaml: string;
                };
            };
        };
    };
}, "/"> | import("hono/types").MergeSchemaPath<{
    "/repo": {
        $get: {
            output: {
                info: null;
                status: never[];
                log: never[];
                branches: never[];
                baseBranch: null;
            };
            outputFormat: "json";
            status: import("hono/utils/http-status").ContentfulStatusCode;
            input: {};
        } | {
            output: {
                info: {
                    root: string;
                    branch: string;
                    remote?: string;
                };
                status: {
                    status: string;
                    path: string;
                }[];
                log: {
                    hash: string;
                    subject: string;
                    author: string;
                    when: string;
                }[];
                branches: string[];
                baseBranch: string | null;
            };
            outputFormat: "json";
            status: import("hono/utils/http-status").ContentfulStatusCode;
            input: {};
        };
    };
} & {
    "/repo/diff": {
        $get: {
            output: string;
            outputFormat: "text";
            status: import("hono/utils/http-status").ContentfulStatusCode;
            input: {};
        };
    };
} & {
    "/repo/commit/:sha": {
        $get: {
            output: string;
            outputFormat: "text";
            status: import("hono/utils/http-status").ContentfulStatusCode;
            input: {
                query: {
                    structured?: string | undefined;
                };
            } & {
                param: {
                    sha: string;
                };
            };
        } | {
            output: {
                error: string;
            };
            outputFormat: "json";
            status: 400;
            input: {
                query: {
                    structured?: string | undefined;
                };
            } & {
                param: {
                    sha: string;
                };
            };
        } | {
            output: {
                sha: string;
                subject: string;
                author: string;
                when: string;
                files: {
                    path: string;
                    oldPath?: string;
                    status: 'added' | 'modified' | 'deleted' | 'renamed' | 'copied';
                    adds: number;
                    dels: number;
                    binary: boolean;
                    image?: boolean;
                    patch: string;
                }[];
                stat: {
                    adds: number;
                    dels: number;
                    files: number;
                };
            };
            outputFormat: "json";
            status: import("hono/utils/http-status").ContentfulStatusCode;
            input: {
                query: {
                    structured?: string | undefined;
                };
            } & {
                param: {
                    sha: string;
                };
            };
        } | {
            output: {
                error: string;
            };
            outputFormat: "json";
            status: 409;
            input: {
                query: {
                    structured?: string | undefined;
                };
            } & {
                param: {
                    sha: string;
                };
            };
        };
    };
} & {
    "/repo/changes": {
        $get: {
            output: {
                files: {
                    path: string;
                    oldPath?: string;
                    status: 'added' | 'modified' | 'deleted' | 'renamed' | 'copied';
                    adds: number;
                    dels: number;
                    binary: boolean;
                    image?: boolean;
                    patch: string;
                }[];
                stat: {
                    adds: number;
                    dels: number;
                    files: number;
                };
                repointedHead?: {
                    headBranch: string;
                    taskBranch: string;
                } | undefined;
            };
            outputFormat: "json";
            status: import("hono/utils/http-status").ContentfulStatusCode;
            input: {};
        } | {
            output: {
                error: string;
            };
            outputFormat: "json";
            status: 409;
            input: {};
        };
    };
} & {
    "/repo/branch": {
        $post: {
            output: {
                error: string;
            };
            outputFormat: "json";
            status: 409;
            input: {
                json: {
                    name: string;
                    from?: string | undefined;
                };
            };
        } | {
            output: {
                branch: string;
                created: boolean;
            };
            outputFormat: "json";
            status: import("hono/utils/http-status").ContentfulStatusCode;
            input: {
                json: {
                    name: string;
                    from?: string | undefined;
                };
            };
        };
    };
}, "/"> | import("hono/types").MergeSchemaPath<{
    "/github": {
        $get: {
            output: {
                error: string;
            };
            outputFormat: "json";
            status: 400;
            input: {
                query: {
                    limit?: string | undefined;
                    refresh?: string | undefined;
                };
            };
        } | {
            output: {
                available: boolean;
                reason?: string;
                repo?: string;
                syncedAt?: string;
                issues: {
                    kind: 'issue' | 'pr';
                    number: number;
                    title: string;
                    author: string;
                    createdAt: string;
                    labels: string[];
                    body: string;
                    url: string;
                    comments: number;
                    isDraft?: boolean;
                    additions?: number;
                    deletions?: number;
                    checks?: 'passing' | 'failing' | 'pending' | null;
                }[];
                prs: {
                    kind: 'issue' | 'pr';
                    number: number;
                    title: string;
                    author: string;
                    createdAt: string;
                    labels: string[];
                    body: string;
                    url: string;
                    comments: number;
                    isDraft?: boolean;
                    additions?: number;
                    deletions?: number;
                    checks?: 'passing' | 'failing' | 'pending' | null;
                }[];
                labelColors?: {
                    [x: string]: string;
                } | undefined;
            };
            outputFormat: "json";
            status: import("hono/utils/http-status").ContentfulStatusCode;
            input: {
                query: {
                    limit?: string | undefined;
                    refresh?: string | undefined;
                };
            };
        };
    };
} & {
    "/github/comments/:kind/:number": {
        $get: {
            output: {
                error: string;
            };
            outputFormat: "json";
            status: 400;
            input: {
                query: {
                    refresh?: string | undefined;
                };
            } & {
                param: {
                    kind: string;
                } & {
                    number: string;
                };
            };
        } | {
            output: {
                error: string;
            };
            outputFormat: "json";
            status: 400;
            input: {
                query: {
                    refresh?: string | undefined;
                };
            } & {
                param: {
                    kind: string;
                } & {
                    number: string;
                };
            };
        } | {
            output: {
                available: boolean;
                reason?: string;
                comments: {
                    id: number;
                    author: string;
                    avatarUrl?: string;
                    createdAt: string;
                    body: string;
                    kind: 'comment' | 'review';
                    reviewState?: 'approved' | 'changes_requested' | 'commented' | 'dismissed';
                    url: string;
                }[];
                truncated?: boolean;
                events?: {
                    id: string;
                    kind: import("./github.ts").ForgeTimelineEventKind;
                    actor: string;
                    avatarUrl?: string;
                    createdAt: string;
                    url?: string;
                    sha?: string;
                    message?: string;
                    checks?: 'passing' | 'failing' | 'pending' | null;
                    label?: {
                        name: string;
                        color?: string;
                    } | undefined;
                    subject?: string;
                    refNumber?: number;
                    refTitle?: string;
                    refIsPr?: boolean;
                }[] | undefined;
            };
            outputFormat: "json";
            status: import("hono/utils/http-status").ContentfulStatusCode;
            input: {
                query: {
                    refresh?: string | undefined;
                };
            } & {
                param: {
                    kind: string;
                } & {
                    number: string;
                };
            };
        };
    };
} & {
    "/github/checks": {
        $get: {
            output: {
                error: string;
            };
            outputFormat: "json";
            status: 400;
            input: {
                query: {
                    prs: string | string[];
                };
            };
        } | {
            output: {
                error: string;
            };
            outputFormat: "json";
            status: 400;
            input: {
                query: {
                    prs: string | string[];
                };
            };
        } | {
            output: {
                available: true;
                checks: {
                    [x: number]: import("./forge/github.ts").ChecksGlyph;
                };
            } | {
                available: false;
                reason: string;
            };
            outputFormat: "json";
            status: import("hono/utils/http-status").ContentfulStatusCode;
            input: {
                query: {
                    prs: string | string[];
                };
            };
        };
    };
} & {
    "/github/ref-status": {
        $get: {
            output: {
                error: string;
            };
            outputFormat: "json";
            status: 400;
            input: {
                query: {
                    prs?: string | undefined;
                    issues?: string | undefined;
                };
            };
        } | {
            output: {
                error: string;
            };
            outputFormat: "json";
            status: 400;
            input: {
                query: {
                    prs?: string | undefined;
                    issues?: string | undefined;
                };
            };
        } | {
            output: {
                available: true;
                prs: {
                    [x: number]: import("./github.ts").ReferenceStatus;
                };
                issues: {
                    [x: number]: import("./github.ts").ReferenceStatus;
                };
                recheckAfterMs: number | null;
            } | {
                available: false;
                reason: string;
                recheckAfterMs: number | null;
            };
            outputFormat: "json";
            status: import("hono/utils/http-status").ContentfulStatusCode;
            input: {
                query: {
                    prs?: string | undefined;
                    issues?: string | undefined;
                };
            };
        };
    };
} & {
    "/github/prs/:number/merge-state": {
        $get: {
            output: {
                error: string;
            };
            outputFormat: "json";
            status: 400;
            input: {
                param: {
                    number: string;
                };
            } & {
                query: {
                    refresh?: string | undefined;
                };
            };
        } | {
            output: {
                available: true;
                mergeState: {
                    number: number;
                    title: string;
                    url: string;
                    state: 'open' | 'closed' | 'merged';
                    isDraft: boolean;
                    headRef: string;
                    baseRef: string;
                    headSha: string;
                    mergeable: 'mergeable' | 'conflicting' | 'unknown';
                    reviewDecision: 'approved' | 'changes-requested' | 'review-required' | 'unknown';
                    checks: {
                        name: string;
                        state: 'passing' | 'failing' | 'pending' | 'unknown';
                        required: boolean | null;
                        url?: string;
                    }[];
                    methods: import("./forge/types.ts").ForgeMergeMethod[];
                    defaultMethod: import("./forge/types.ts").ForgeMergeMethod | null;
                    eligibility: 'ready' | 'blocked' | 'pending' | 'unauthorized' | 'terminal' | 'unknown';
                    blockers: {
                        code: string;
                        message: string;
                    }[];
                    canMerge: boolean;
                    canOverride: boolean;
                };
            } | {
                available: false;
                reason: string;
            };
            outputFormat: "json";
            status: import("hono/utils/http-status").ContentfulStatusCode;
            input: {
                param: {
                    number: string;
                };
            } & {
                query: {
                    refresh?: string | undefined;
                };
            };
        };
    };
} & {
    "/github/prs/:number/merge": {
        $post: {
            output: {
                error: string;
            };
            outputFormat: "json";
            status: 400;
            input: {
                param: {
                    number: string;
                };
            } & {
                json: {
                    method: "merge" | "rebase" | "squash";
                    expectedHeadSha: string;
                    overrideRules?: boolean | undefined;
                };
            };
        } | {
            output: {
                error: string;
            };
            outputFormat: "json";
            status: 409;
            input: {
                param: {
                    number: string;
                };
            } & {
                json: {
                    method: "merge" | "rebase" | "squash";
                    expectedHeadSha: string;
                    overrideRules?: boolean | undefined;
                };
            };
        } | {
            output: {
                merged: true;
                number: number;
                url: string;
                method: import("./forge/types.ts").ForgeMergeMethod;
                mergeCommitSha?: string;
            };
            outputFormat: "json";
            status: import("hono/utils/http-status").ContentfulStatusCode;
            input: {
                param: {
                    number: string;
                };
            } & {
                json: {
                    method: "merge" | "rebase" | "squash";
                    expectedHeadSha: string;
                    overrideRules?: boolean | undefined;
                };
            };
        } | {
            output: {
                error: string;
                code?: string | undefined;
                current?: {
                    number: number;
                    title: string;
                    url: string;
                    state: 'open' | 'closed' | 'merged';
                    isDraft: boolean;
                    headRef: string;
                    baseRef: string;
                    headSha: string;
                    mergeable: 'mergeable' | 'conflicting' | 'unknown';
                    reviewDecision: 'approved' | 'changes-requested' | 'review-required' | 'unknown';
                    checks: {
                        name: string;
                        state: 'passing' | 'failing' | 'pending' | 'unknown';
                        required: boolean | null;
                        url?: string;
                    }[];
                    methods: import("./forge/types.ts").ForgeMergeMethod[];
                    defaultMethod: import("./forge/types.ts").ForgeMergeMethod | null;
                    eligibility: 'ready' | 'blocked' | 'pending' | 'unauthorized' | 'terminal' | 'unknown';
                    blockers: {
                        code: string;
                        message: string;
                    }[];
                    canMerge: boolean;
                    canOverride: boolean;
                } | undefined;
            };
            outputFormat: "json";
            status: 403 | 404 | 409 | 502;
            input: {
                param: {
                    number: string;
                };
            } & {
                json: {
                    method: "merge" | "rebase" | "squash";
                    expectedHeadSha: string;
                    overrideRules?: boolean | undefined;
                };
            };
        };
    };
} & {
    "/github/prs/:number/changes": {
        $get: {
            output: {
                error: string;
            };
            outputFormat: "json";
            status: 400;
            input: {
                param: {
                    number: string;
                };
            } & {
                query: {
                    refresh?: "1" | undefined;
                };
            };
        } | {
            output: {
                error: string;
            };
            outputFormat: "json";
            status: 404;
            input: {
                param: {
                    number: string;
                };
            } & {
                query: {
                    refresh?: "1" | undefined;
                };
            };
        } | {
            output: {
                available: true;
                number: number;
                headSha: string;
                files: {
                    path: string;
                    previousPath?: string;
                    status: 'added' | 'modified' | 'removed' | 'renamed' | 'copied' | 'changed';
                    additions: number;
                    deletions: number;
                    patch?: string;
                    patchUnavailableReason?: 'binary' | 'too-large' | 'not-provided';
                    truncated?: boolean;
                }[];
                additions: number;
                deletions: number;
                truncated: boolean;
                reason?: string;
            } | {
                available: false;
                reason: string;
            };
            outputFormat: "json";
            status: import("hono/utils/http-status").ContentfulStatusCode;
            input: {
                param: {
                    number: string;
                };
            } & {
                query: {
                    refresh?: "1" | undefined;
                };
            };
        };
    };
}, "/"> | import("hono/types").MergeSchemaPath<{
    "/automations": {
        $get: {
            output: {
                available: boolean;
                reason?: string;
                scheduler: {
                    state: "idle" | "scheduled";
                    nextDue?: string | undefined;
                };
                automations: {
                    id: string;
                    revision: number;
                    name: string;
                    description?: string | undefined;
                    enabled: boolean;
                    events: ("issue.labeled" | "issue.opened" | "issue.unlabeled" | "pull_request.opened")[];
                    intervalSeconds: number;
                    filters: {
                        [x: string]: import("hono/utils/types").JSONValue;
                        authors?: string[] | undefined;
                        assignees?: string[] | undefined;
                        allLabels?: string[] | undefined;
                        anyLabels?: string[] | undefined;
                        excludeLabels?: string[] | undefined;
                        changedLabels?: string[] | undefined;
                        lookbackDays: number;
                        maxRecords: number;
                    };
                    task: {
                        [x: string]: import("hono/utils/types").JSONValue;
                        prompt: string;
                        workflow?: string | undefined;
                        steps?: {
                            id: string;
                            name?: string | undefined;
                            prompt?: string | undefined;
                            skill?: string | undefined;
                            model?: string | undefined;
                            runner?: "auto" | "claude" | "codex" | "opencode" | "pi" | undefined;
                            allowedTools?: string[] | undefined;
                            bashAllowlist?: string[] | undefined;
                            command?: string | undefined;
                            onFail?: {
                                retry: string;
                                max: number;
                            } | undefined;
                        }[] | undefined;
                        runner?: "auto" | "claude" | "codex" | "opencode" | "pi" | undefined;
                        model?: string | undefined;
                        variants?: 1 | 2 | 3 | undefined;
                        worktree?: boolean | undefined;
                        generateFollowups?: boolean | undefined;
                        autonomous?: boolean | undefined;
                        systemPrompt?: string | undefined;
                    };
                    createdAt: string;
                    updatedAt: string;
                    state?: {
                        [x: string]: import("hono/utils/types").JSONValue;
                        revision?: number | undefined;
                        baselineAt?: string | undefined;
                        cursor?: {
                            [x: string]: import("hono/utils/types").JSONValue;
                            timestamp: string;
                            tieBreaker?: string | undefined;
                        } | undefined;
                        frozenHighWatermark?: {
                            [x: string]: import("hono/utils/types").JSONValue;
                            timestamp: string;
                            tieBreaker: string;
                        } | undefined;
                        backlogAfter?: {
                            [x: string]: import("hono/utils/types").JSONValue;
                            timestamp: string;
                            tieBreaker: string;
                        } | undefined;
                        nextCheckAt?: string | undefined;
                        lastSuccessAt?: string | undefined;
                        etags?: {
                            [x: string]: string;
                        } | undefined;
                        backoffUntil?: string | undefined;
                        consecutiveFailures?: number | undefined;
                    } | undefined;
                    latestLog?: {
                        [x: string]: import("hono/utils/types").JSONValue;
                        seq: number;
                        ts: string;
                        automationId: string;
                        revision: number;
                        event?: "issue.labeled" | "issue.opened" | "issue.unlabeled" | "pull_request.opened" | undefined;
                        result: "baseline" | "duplicate" | "error" | "launched" | "no-match" | "preview" | "rate-limited";
                        reason?: string | undefined;
                        durationMs?: number | undefined;
                        receiptId?: string | undefined;
                        runId?: string | undefined;
                        githubNumber?: number | undefined;
                        githubTitle?: string | undefined;
                        githubUrl?: string | undefined;
                        rateLimit?: {
                            [x: string]: import("hono/utils/types").JSONValue;
                            bucket: "core" | "search";
                            remaining?: number | undefined;
                            resetAt?: string | undefined;
                        } | undefined;
                    } | undefined;
                    counts: {
                        matches: number;
                        launched: number;
                        duplicates: number;
                        errors: number;
                    };
                }[];
            };
            outputFormat: "json";
            status: import("hono/utils/http-status").ContentfulStatusCode;
            input: {};
        };
    };
} & {
    "/automations": {
        $post: {
            output: {
                error: string;
            };
            outputFormat: "json";
            status: 400;
            input: {
                json: {
                    name: string;
                    description?: string | undefined;
                    enabled?: boolean | undefined;
                    events: ("issue.labeled" | "issue.opened" | "issue.unlabeled" | "pull_request.opened")[];
                    intervalSeconds: number;
                    filters: {
                        [x: string]: unknown;
                        authors?: string[] | undefined;
                        assignees?: string[] | undefined;
                        allLabels?: string[] | undefined;
                        anyLabels?: string[] | undefined;
                        excludeLabels?: string[] | undefined;
                        changedLabels?: string[] | undefined;
                        lookbackDays?: number | undefined;
                        maxRecords?: number | undefined;
                    };
                    task: {
                        [x: string]: unknown;
                        prompt: string;
                        workflow?: string | undefined;
                        steps?: {
                            id: string;
                            name?: string | undefined;
                            prompt?: string | undefined;
                            skill?: string | undefined;
                            model?: string | undefined;
                            runner?: "auto" | "claude" | "codex" | "opencode" | "pi" | undefined;
                            allowedTools?: string[] | undefined;
                            bashAllowlist?: string[] | undefined;
                            command?: string | undefined;
                            onFail?: {
                                retry: string;
                                max?: number | undefined;
                            } | undefined;
                        }[] | undefined;
                        runner?: "auto" | "claude" | "codex" | "opencode" | "pi" | undefined;
                        model?: string | undefined;
                        variants?: 1 | 2 | 3 | undefined;
                        worktree?: boolean | undefined;
                        generateFollowups?: boolean | undefined;
                        autonomous?: boolean | undefined;
                        systemPrompt?: string | undefined;
                    };
                    enable?: boolean | undefined;
                };
            };
        } | {
            output: {
                automation: {
                    [x: string]: import("hono/utils/types").JSONValue;
                    id: string;
                    revision: number;
                    name: string;
                    description?: string | undefined;
                    enabled: boolean;
                    events: ("issue.labeled" | "issue.opened" | "issue.unlabeled" | "pull_request.opened")[];
                    intervalSeconds: number;
                    filters: {
                        [x: string]: import("hono/utils/types").JSONValue;
                        authors?: string[] | undefined;
                        assignees?: string[] | undefined;
                        allLabels?: string[] | undefined;
                        anyLabels?: string[] | undefined;
                        excludeLabels?: string[] | undefined;
                        changedLabels?: string[] | undefined;
                        lookbackDays: number;
                        maxRecords: number;
                    };
                    task: {
                        [x: string]: import("hono/utils/types").JSONValue;
                        prompt: string;
                        workflow?: string | undefined;
                        steps?: {
                            id: string;
                            name?: string | undefined;
                            prompt?: string | undefined;
                            skill?: string | undefined;
                            model?: string | undefined;
                            runner?: "auto" | "claude" | "codex" | "opencode" | "pi" | undefined;
                            allowedTools?: string[] | undefined;
                            bashAllowlist?: string[] | undefined;
                            command?: string | undefined;
                            onFail?: {
                                retry: string;
                                max: number;
                            } | undefined;
                        }[] | undefined;
                        runner?: "auto" | "claude" | "codex" | "opencode" | "pi" | undefined;
                        model?: string | undefined;
                        variants?: 1 | 2 | 3 | undefined;
                        worktree?: boolean | undefined;
                        generateFollowups?: boolean | undefined;
                        autonomous?: boolean | undefined;
                        systemPrompt?: string | undefined;
                    };
                    createdAt: string;
                    updatedAt: string;
                };
            };
            outputFormat: "json";
            status: 201;
            input: {
                json: {
                    name: string;
                    description?: string | undefined;
                    enabled?: boolean | undefined;
                    events: ("issue.labeled" | "issue.opened" | "issue.unlabeled" | "pull_request.opened")[];
                    intervalSeconds: number;
                    filters: {
                        [x: string]: unknown;
                        authors?: string[] | undefined;
                        assignees?: string[] | undefined;
                        allLabels?: string[] | undefined;
                        anyLabels?: string[] | undefined;
                        excludeLabels?: string[] | undefined;
                        changedLabels?: string[] | undefined;
                        lookbackDays?: number | undefined;
                        maxRecords?: number | undefined;
                    };
                    task: {
                        [x: string]: unknown;
                        prompt: string;
                        workflow?: string | undefined;
                        steps?: {
                            id: string;
                            name?: string | undefined;
                            prompt?: string | undefined;
                            skill?: string | undefined;
                            model?: string | undefined;
                            runner?: "auto" | "claude" | "codex" | "opencode" | "pi" | undefined;
                            allowedTools?: string[] | undefined;
                            bashAllowlist?: string[] | undefined;
                            command?: string | undefined;
                            onFail?: {
                                retry: string;
                                max?: number | undefined;
                            } | undefined;
                        }[] | undefined;
                        runner?: "auto" | "claude" | "codex" | "opencode" | "pi" | undefined;
                        model?: string | undefined;
                        variants?: 1 | 2 | 3 | undefined;
                        worktree?: boolean | undefined;
                        generateFollowups?: boolean | undefined;
                        autonomous?: boolean | undefined;
                        systemPrompt?: string | undefined;
                    };
                    enable?: boolean | undefined;
                };
            };
        };
    };
} & {
    "/automations/:id": {
        $get: {
            output: {
                error: string;
            };
            outputFormat: "json";
            status: 404;
            input: {
                param: {
                    id: string;
                };
            };
        } | {
            output: {
                automation: {
                    [x: string]: import("hono/utils/types").JSONValue;
                    id: string;
                    revision: number;
                    name: string;
                    description?: string | undefined;
                    enabled: boolean;
                    events: ("issue.labeled" | "issue.opened" | "issue.unlabeled" | "pull_request.opened")[];
                    intervalSeconds: number;
                    filters: {
                        [x: string]: import("hono/utils/types").JSONValue;
                        authors?: string[] | undefined;
                        assignees?: string[] | undefined;
                        allLabels?: string[] | undefined;
                        anyLabels?: string[] | undefined;
                        excludeLabels?: string[] | undefined;
                        changedLabels?: string[] | undefined;
                        lookbackDays: number;
                        maxRecords: number;
                    };
                    task: {
                        [x: string]: import("hono/utils/types").JSONValue;
                        prompt: string;
                        workflow?: string | undefined;
                        steps?: {
                            id: string;
                            name?: string | undefined;
                            prompt?: string | undefined;
                            skill?: string | undefined;
                            model?: string | undefined;
                            runner?: "auto" | "claude" | "codex" | "opencode" | "pi" | undefined;
                            allowedTools?: string[] | undefined;
                            bashAllowlist?: string[] | undefined;
                            command?: string | undefined;
                            onFail?: {
                                retry: string;
                                max: number;
                            } | undefined;
                        }[] | undefined;
                        runner?: "auto" | "claude" | "codex" | "opencode" | "pi" | undefined;
                        model?: string | undefined;
                        variants?: 1 | 2 | 3 | undefined;
                        worktree?: boolean | undefined;
                        generateFollowups?: boolean | undefined;
                        autonomous?: boolean | undefined;
                        systemPrompt?: string | undefined;
                    };
                    createdAt: string;
                    updatedAt: string;
                };
                state?: {
                    [x: string]: import("hono/utils/types").JSONValue;
                    revision?: number | undefined;
                    baselineAt?: string | undefined;
                    cursor?: {
                        [x: string]: import("hono/utils/types").JSONValue;
                        timestamp: string;
                        tieBreaker?: string | undefined;
                    } | undefined;
                    frozenHighWatermark?: {
                        [x: string]: import("hono/utils/types").JSONValue;
                        timestamp: string;
                        tieBreaker: string;
                    } | undefined;
                    backlogAfter?: {
                        [x: string]: import("hono/utils/types").JSONValue;
                        timestamp: string;
                        tieBreaker: string;
                    } | undefined;
                    nextCheckAt?: string | undefined;
                    lastSuccessAt?: string | undefined;
                    etags?: {
                        [x: string]: string;
                    } | undefined;
                    backoffUntil?: string | undefined;
                    consecutiveFailures?: number | undefined;
                } | undefined;
                latestLog?: {
                    [x: string]: import("hono/utils/types").JSONValue;
                    seq: number;
                    ts: string;
                    automationId: string;
                    revision: number;
                    event?: "issue.labeled" | "issue.opened" | "issue.unlabeled" | "pull_request.opened" | undefined;
                    result: "baseline" | "duplicate" | "error" | "launched" | "no-match" | "preview" | "rate-limited";
                    reason?: string | undefined;
                    durationMs?: number | undefined;
                    receiptId?: string | undefined;
                    runId?: string | undefined;
                    githubNumber?: number | undefined;
                    githubTitle?: string | undefined;
                    githubUrl?: string | undefined;
                    rateLimit?: {
                        [x: string]: import("hono/utils/types").JSONValue;
                        bucket: "core" | "search";
                        remaining?: number | undefined;
                        resetAt?: string | undefined;
                    } | undefined;
                } | undefined;
            };
            outputFormat: "json";
            status: import("hono/utils/http-status").ContentfulStatusCode;
            input: {
                param: {
                    id: string;
                };
            };
        };
    };
} & {
    "/automations/:id": {
        $put: {
            output: {
                error: string;
            };
            outputFormat: "json";
            status: 404;
            input: {
                json: {
                    name: string;
                    description?: string | undefined;
                    enabled?: boolean | undefined;
                    events: ("issue.labeled" | "issue.opened" | "issue.unlabeled" | "pull_request.opened")[];
                    intervalSeconds: number;
                    filters: {
                        [x: string]: unknown;
                        authors?: string[] | undefined;
                        assignees?: string[] | undefined;
                        allLabels?: string[] | undefined;
                        anyLabels?: string[] | undefined;
                        excludeLabels?: string[] | undefined;
                        changedLabels?: string[] | undefined;
                        lookbackDays?: number | undefined;
                        maxRecords?: number | undefined;
                    };
                    task: {
                        [x: string]: unknown;
                        prompt: string;
                        workflow?: string | undefined;
                        steps?: {
                            id: string;
                            name?: string | undefined;
                            prompt?: string | undefined;
                            skill?: string | undefined;
                            model?: string | undefined;
                            runner?: "auto" | "claude" | "codex" | "opencode" | "pi" | undefined;
                            allowedTools?: string[] | undefined;
                            bashAllowlist?: string[] | undefined;
                            command?: string | undefined;
                            onFail?: {
                                retry: string;
                                max?: number | undefined;
                            } | undefined;
                        }[] | undefined;
                        runner?: "auto" | "claude" | "codex" | "opencode" | "pi" | undefined;
                        model?: string | undefined;
                        variants?: 1 | 2 | 3 | undefined;
                        worktree?: boolean | undefined;
                        generateFollowups?: boolean | undefined;
                        autonomous?: boolean | undefined;
                        systemPrompt?: string | undefined;
                    };
                    expectedRevision: number;
                };
            } & {
                param: {
                    id: string;
                };
            };
        } | {
            output: {
                automation: {
                    [x: string]: import("hono/utils/types").JSONValue;
                    id: string;
                    revision: number;
                    name: string;
                    description?: string | undefined;
                    enabled: boolean;
                    events: ("issue.labeled" | "issue.opened" | "issue.unlabeled" | "pull_request.opened")[];
                    intervalSeconds: number;
                    filters: {
                        [x: string]: import("hono/utils/types").JSONValue;
                        authors?: string[] | undefined;
                        assignees?: string[] | undefined;
                        allLabels?: string[] | undefined;
                        anyLabels?: string[] | undefined;
                        excludeLabels?: string[] | undefined;
                        changedLabels?: string[] | undefined;
                        lookbackDays: number;
                        maxRecords: number;
                    };
                    task: {
                        [x: string]: import("hono/utils/types").JSONValue;
                        prompt: string;
                        workflow?: string | undefined;
                        steps?: {
                            id: string;
                            name?: string | undefined;
                            prompt?: string | undefined;
                            skill?: string | undefined;
                            model?: string | undefined;
                            runner?: "auto" | "claude" | "codex" | "opencode" | "pi" | undefined;
                            allowedTools?: string[] | undefined;
                            bashAllowlist?: string[] | undefined;
                            command?: string | undefined;
                            onFail?: {
                                retry: string;
                                max: number;
                            } | undefined;
                        }[] | undefined;
                        runner?: "auto" | "claude" | "codex" | "opencode" | "pi" | undefined;
                        model?: string | undefined;
                        variants?: 1 | 2 | 3 | undefined;
                        worktree?: boolean | undefined;
                        generateFollowups?: boolean | undefined;
                        autonomous?: boolean | undefined;
                        systemPrompt?: string | undefined;
                    };
                    createdAt: string;
                    updatedAt: string;
                };
            };
            outputFormat: "json";
            status: import("hono/utils/http-status").ContentfulStatusCode;
            input: {
                json: {
                    name: string;
                    description?: string | undefined;
                    enabled?: boolean | undefined;
                    events: ("issue.labeled" | "issue.opened" | "issue.unlabeled" | "pull_request.opened")[];
                    intervalSeconds: number;
                    filters: {
                        [x: string]: unknown;
                        authors?: string[] | undefined;
                        assignees?: string[] | undefined;
                        allLabels?: string[] | undefined;
                        anyLabels?: string[] | undefined;
                        excludeLabels?: string[] | undefined;
                        changedLabels?: string[] | undefined;
                        lookbackDays?: number | undefined;
                        maxRecords?: number | undefined;
                    };
                    task: {
                        [x: string]: unknown;
                        prompt: string;
                        workflow?: string | undefined;
                        steps?: {
                            id: string;
                            name?: string | undefined;
                            prompt?: string | undefined;
                            skill?: string | undefined;
                            model?: string | undefined;
                            runner?: "auto" | "claude" | "codex" | "opencode" | "pi" | undefined;
                            allowedTools?: string[] | undefined;
                            bashAllowlist?: string[] | undefined;
                            command?: string | undefined;
                            onFail?: {
                                retry: string;
                                max?: number | undefined;
                            } | undefined;
                        }[] | undefined;
                        runner?: "auto" | "claude" | "codex" | "opencode" | "pi" | undefined;
                        model?: string | undefined;
                        variants?: 1 | 2 | 3 | undefined;
                        worktree?: boolean | undefined;
                        generateFollowups?: boolean | undefined;
                        autonomous?: boolean | undefined;
                        systemPrompt?: string | undefined;
                    };
                    expectedRevision: number;
                };
            } & {
                param: {
                    id: string;
                };
            };
        } | {
            output: {
                error: string;
            };
            outputFormat: "json";
            status: 400 | 409;
            input: {
                json: {
                    name: string;
                    description?: string | undefined;
                    enabled?: boolean | undefined;
                    events: ("issue.labeled" | "issue.opened" | "issue.unlabeled" | "pull_request.opened")[];
                    intervalSeconds: number;
                    filters: {
                        [x: string]: unknown;
                        authors?: string[] | undefined;
                        assignees?: string[] | undefined;
                        allLabels?: string[] | undefined;
                        anyLabels?: string[] | undefined;
                        excludeLabels?: string[] | undefined;
                        changedLabels?: string[] | undefined;
                        lookbackDays?: number | undefined;
                        maxRecords?: number | undefined;
                    };
                    task: {
                        [x: string]: unknown;
                        prompt: string;
                        workflow?: string | undefined;
                        steps?: {
                            id: string;
                            name?: string | undefined;
                            prompt?: string | undefined;
                            skill?: string | undefined;
                            model?: string | undefined;
                            runner?: "auto" | "claude" | "codex" | "opencode" | "pi" | undefined;
                            allowedTools?: string[] | undefined;
                            bashAllowlist?: string[] | undefined;
                            command?: string | undefined;
                            onFail?: {
                                retry: string;
                                max?: number | undefined;
                            } | undefined;
                        }[] | undefined;
                        runner?: "auto" | "claude" | "codex" | "opencode" | "pi" | undefined;
                        model?: string | undefined;
                        variants?: 1 | 2 | 3 | undefined;
                        worktree?: boolean | undefined;
                        generateFollowups?: boolean | undefined;
                        autonomous?: boolean | undefined;
                        systemPrompt?: string | undefined;
                    };
                    expectedRevision: number;
                };
            } & {
                param: {
                    id: string;
                };
            };
        };
    };
} & {
    "/automations/:id": {
        $delete: {
            output: null;
            outputFormat: "body";
            status: 204;
            input: {
                param: {
                    id: string;
                };
            };
        } | {
            output: {
                error: string;
            };
            outputFormat: "json";
            status: 404;
            input: {
                param: {
                    id: string;
                };
            };
        };
    };
} & {
    "/automations/:id/enable": {
        $post: {
            output: {
                error: string;
            };
            outputFormat: "json";
            status: 404;
            input: {
                param: {
                    id: string;
                };
            };
        } | {
            output: {
                automation: {
                    [x: string]: import("hono/utils/types").JSONValue;
                    id: string;
                    revision: number;
                    name: string;
                    description?: string | undefined;
                    enabled: boolean;
                    events: ("issue.labeled" | "issue.opened" | "issue.unlabeled" | "pull_request.opened")[];
                    intervalSeconds: number;
                    filters: {
                        [x: string]: import("hono/utils/types").JSONValue;
                        authors?: string[] | undefined;
                        assignees?: string[] | undefined;
                        allLabels?: string[] | undefined;
                        anyLabels?: string[] | undefined;
                        excludeLabels?: string[] | undefined;
                        changedLabels?: string[] | undefined;
                        lookbackDays: number;
                        maxRecords: number;
                    };
                    task: {
                        [x: string]: import("hono/utils/types").JSONValue;
                        prompt: string;
                        workflow?: string | undefined;
                        steps?: {
                            id: string;
                            name?: string | undefined;
                            prompt?: string | undefined;
                            skill?: string | undefined;
                            model?: string | undefined;
                            runner?: "auto" | "claude" | "codex" | "opencode" | "pi" | undefined;
                            allowedTools?: string[] | undefined;
                            bashAllowlist?: string[] | undefined;
                            command?: string | undefined;
                            onFail?: {
                                retry: string;
                                max: number;
                            } | undefined;
                        }[] | undefined;
                        runner?: "auto" | "claude" | "codex" | "opencode" | "pi" | undefined;
                        model?: string | undefined;
                        variants?: 1 | 2 | 3 | undefined;
                        worktree?: boolean | undefined;
                        generateFollowups?: boolean | undefined;
                        autonomous?: boolean | undefined;
                        systemPrompt?: string | undefined;
                    };
                    createdAt: string;
                    updatedAt: string;
                };
            };
            outputFormat: "json";
            status: import("hono/utils/http-status").ContentfulStatusCode;
            input: {
                param: {
                    id: string;
                };
            };
        };
    };
} & {
    "/automations/:id/pause": {
        $post: {
            output: {
                error: string;
            };
            outputFormat: "json";
            status: 404;
            input: {
                param: {
                    id: string;
                };
            };
        } | {
            output: {
                automation: {
                    [x: string]: import("hono/utils/types").JSONValue;
                    id: string;
                    revision: number;
                    name: string;
                    description?: string | undefined;
                    enabled: boolean;
                    events: ("issue.labeled" | "issue.opened" | "issue.unlabeled" | "pull_request.opened")[];
                    intervalSeconds: number;
                    filters: {
                        [x: string]: import("hono/utils/types").JSONValue;
                        authors?: string[] | undefined;
                        assignees?: string[] | undefined;
                        allLabels?: string[] | undefined;
                        anyLabels?: string[] | undefined;
                        excludeLabels?: string[] | undefined;
                        changedLabels?: string[] | undefined;
                        lookbackDays: number;
                        maxRecords: number;
                    };
                    task: {
                        [x: string]: import("hono/utils/types").JSONValue;
                        prompt: string;
                        workflow?: string | undefined;
                        steps?: {
                            id: string;
                            name?: string | undefined;
                            prompt?: string | undefined;
                            skill?: string | undefined;
                            model?: string | undefined;
                            runner?: "auto" | "claude" | "codex" | "opencode" | "pi" | undefined;
                            allowedTools?: string[] | undefined;
                            bashAllowlist?: string[] | undefined;
                            command?: string | undefined;
                            onFail?: {
                                retry: string;
                                max: number;
                            } | undefined;
                        }[] | undefined;
                        runner?: "auto" | "claude" | "codex" | "opencode" | "pi" | undefined;
                        model?: string | undefined;
                        variants?: 1 | 2 | 3 | undefined;
                        worktree?: boolean | undefined;
                        generateFollowups?: boolean | undefined;
                        autonomous?: boolean | undefined;
                        systemPrompt?: string | undefined;
                    };
                    createdAt: string;
                    updatedAt: string;
                };
            };
            outputFormat: "json";
            status: import("hono/utils/http-status").ContentfulStatusCode;
            input: {
                param: {
                    id: string;
                };
            };
        };
    };
} & {
    "/automations/:id/check": {
        $post: {
            output: {
                error: string;
            };
            outputFormat: "json";
            status: 404;
            input: {
                json: {
                    mode: "execute" | "preview";
                };
            } & {
                param: {
                    id: string;
                };
            };
        } | {
            output: {
                checkId: string;
            };
            outputFormat: "json";
            status: 202;
            input: {
                json: {
                    mode: "execute" | "preview";
                };
            } & {
                param: {
                    id: string;
                };
            };
        };
    };
} & {
    "/automation-log": {
        $get: {
            output: {
                error: string;
            };
            outputFormat: "json";
            status: 400;
            input: {
                query: {
                    automationId?: string | undefined;
                    result?: "baseline" | "duplicate" | "error" | "launched" | "no-match" | "preview" | "rate-limited" | undefined;
                    event?: "issue.labeled" | "issue.opened" | "issue.unlabeled" | "pull_request.opened" | undefined;
                    since?: string | undefined;
                    cursor?: number | undefined;
                    limit?: number | undefined;
                };
            };
        } | {
            output: {
                records: {
                    [x: string]: import("hono/utils/types").JSONValue;
                    seq: number;
                    ts: string;
                    automationId: string;
                    revision: number;
                    event?: "issue.labeled" | "issue.opened" | "issue.unlabeled" | "pull_request.opened" | undefined;
                    result: "baseline" | "duplicate" | "error" | "launched" | "no-match" | "preview" | "rate-limited";
                    reason?: string | undefined;
                    durationMs?: number | undefined;
                    receiptId?: string | undefined;
                    runId?: string | undefined;
                    githubNumber?: number | undefined;
                    githubTitle?: string | undefined;
                    githubUrl?: string | undefined;
                    rateLimit?: {
                        [x: string]: import("hono/utils/types").JSONValue;
                        bucket: "core" | "search";
                        remaining?: number | undefined;
                        resetAt?: string | undefined;
                    } | undefined;
                }[];
            };
            outputFormat: "json";
            status: import("hono/utils/http-status").ContentfulStatusCode;
            input: {
                query: {
                    automationId?: string | undefined;
                    result?: "baseline" | "duplicate" | "error" | "launched" | "no-match" | "preview" | "rate-limited" | undefined;
                    event?: "issue.labeled" | "issue.opened" | "issue.unlabeled" | "pull_request.opened" | undefined;
                    since?: string | undefined;
                    cursor?: number | undefined;
                    limit?: number | undefined;
                };
            };
        };
    };
} & {
    "/automation-log/:receiptId/retry": {
        $post: {
            output: {
                error: string;
            };
            outputFormat: "json";
            status: 404;
            input: {
                param: {
                    receiptId: string;
                };
            };
        } | {
            output: {
                error: string;
            };
            outputFormat: "json";
            status: 409;
            input: {
                param: {
                    receiptId: string;
                };
            };
        } | {
            output: {
                receiptId: string;
                runId: string;
            };
            outputFormat: "json";
            status: 202;
            input: {
                param: {
                    receiptId: string;
                };
            };
        };
    };
}, "/"> | import("hono/types").MergeSchemaPath<{
    "/runs": {
        $get: {
            output: {
                id: string;
                title: string;
                titleSummary?: string | undefined;
                diffStat?: {
                    adds: number;
                    dels: number;
                    files: number;
                    repointed?: boolean | undefined;
                } | undefined;
                workflow: string;
                task: string;
                queuedMessages?: {
                    id: string;
                    text: string;
                    images?: string[] | undefined;
                    createdAt: string;
                }[] | undefined;
                taskImages?: string[] | undefined;
                model?: string | undefined;
                reasoningEffort?: "auto" | "high" | "low" | "medium" | "xhigh" | undefined;
                modelIdentity?: string | undefined;
                runner?: "claude" | "codex" | "opencode" | "pi" | undefined;
                requestedRunner?: "auto" | "claude" | "codex" | "opencode" | "pi" | undefined;
                agentProfile?: string | undefined;
                systemPrompt?: string | undefined;
                generateFollowups?: boolean | undefined;
                autonomous?: boolean | undefined;
                automation?: {
                    automationId: string;
                    automationRevision: number;
                    receiptId: string;
                    event: string;
                    githubUrl: string;
                } | undefined;
                status: "cancelled" | "done" | "failed" | "queued" | "review" | "running" | "waiting";
                activity?: "monitoring" | undefined;
                monitoringWakeAt?: string | undefined;
                monitoringWakeCapReached?: boolean | undefined;
                autoResumeAt?: string | undefined;
                autoResumeAttempts?: number | undefined;
                blockedReason?: {
                    type: "provider_quota";
                    providers: ("claude" | "codex")[];
                    retryAt?: string | undefined;
                } | undefined;
                createdAt: string;
                startedAt?: string | undefined;
                finishedAt?: string | undefined;
                tokensUsed: number;
                inputTokens?: number | undefined;
                outputTokens?: number | undefined;
                costUsd?: number | undefined;
                pullRequestUrl?: string | undefined;
                referencedPullRequestUrl?: string | undefined;
                prNumber?: number | undefined;
                issueNumber?: number | undefined;
                referencedIssueNumberSeeded?: boolean | undefined;
                titleOrigin?: "auto" | "marker" | "user" | undefined;
                markerRefs?: {
                    pr?: number | undefined;
                    issue?: number | undefined;
                } | undefined;
                referencedPrCandidates?: string[] | undefined;
                referencedIssueUrl?: string | undefined;
                referencedIssueCandidates?: string[] | undefined;
                worktree?: false | undefined;
                worktreePath?: string | undefined;
                branch?: string | undefined;
                baseBranch?: string | undefined;
                worktreeReclaimedAt?: string | undefined;
                groupId?: string | undefined;
                variant?: string | undefined;
                peakRssBytes?: number | undefined;
                peakProcCount?: number | undefined;
                archived: boolean;
                archivedAt?: string | undefined;
                seenAt?: string | undefined;
                currentStepId?: string | undefined;
                error?: string | undefined;
                steps: {
                    id: string;
                    name: string;
                    kind: "agent" | "check";
                    status: "cancelled" | "done" | "failed" | "pending" | "review" | "running" | "skipped" | "waiting";
                    iterations: number;
                    tokensUsed: number;
                    inputTokens?: number | undefined;
                    outputTokens?: number | undefined;
                    usageInvocationsStarted?: number | undefined;
                    usageInvocationsObserved?: number | undefined;
                    usageTurnsStarted?: number | undefined;
                    usageTurnsRecorded?: number | undefined;
                    usageInvocationEpoch?: number | undefined;
                    startedAt?: string | undefined;
                    finishedAt?: string | undefined;
                    error?: string | undefined;
                    sessionId?: string | undefined;
                    backend?: "claude" | "codex" | "opencode" | "pi" | undefined;
                    requestedRunner?: "auto" | "claude" | "codex" | "opencode" | "pi" | undefined;
                    profileId?: string | undefined;
                    reasoningEffort?: "high" | "low" | "medium" | "xhigh" | undefined;
                    costUsd?: number | undefined;
                    modelIdentity?: string | undefined;
                }[];
                workflowDef?: {
                    name: string;
                    description?: string | undefined;
                    steps: {
                        id: string;
                        name?: string | undefined;
                        prompt?: string | undefined;
                        skill?: string | undefined;
                        model?: string | undefined;
                        runner?: "auto" | "claude" | "codex" | "opencode" | "pi" | undefined;
                        allowedTools?: string[] | undefined;
                        bashAllowlist?: string[] | undefined;
                        command?: string | undefined;
                        onFail?: {
                            retry: string;
                            max: number;
                        } | undefined;
                    }[];
                    source: "built-in" | "file";
                    path?: string | undefined;
                } | undefined;
                usage?: ReturnType<typeof currentUsage>;
            }[];
            outputFormat: "json";
            status: import("hono/utils/http-status").ContentfulStatusCode;
            input: {};
        };
    };
} & {
    "/runs/archive-finished": {
        $post: {
            output: {
                archived: number;
            };
            outputFormat: "json";
            status: import("hono/utils/http-status").ContentfulStatusCode;
            input: {};
        };
    };
} & {
    "/runs/read-all": {
        $post: {
            output: {
                read: number;
            };
            outputFormat: "json";
            status: import("hono/utils/http-status").ContentfulStatusCode;
            input: {};
        };
    };
} & {
    "/runs/:id/archive": {
        $post: {
            output: {
                id: string;
                title: string;
                titleSummary?: string | undefined;
                diffStat?: {
                    adds: number;
                    dels: number;
                    files: number;
                    repointed?: boolean | undefined;
                } | undefined;
                workflow: string;
                task: string;
                queuedMessages?: {
                    id: string;
                    text: string;
                    images?: string[] | undefined;
                    createdAt: string;
                }[] | undefined;
                taskImages?: string[] | undefined;
                model?: string | undefined;
                reasoningEffort?: "auto" | "high" | "low" | "medium" | "xhigh" | undefined;
                modelIdentity?: string | undefined;
                runner?: "claude" | "codex" | "opencode" | "pi" | undefined;
                requestedRunner?: "auto" | "claude" | "codex" | "opencode" | "pi" | undefined;
                agentProfile?: string | undefined;
                systemPrompt?: string | undefined;
                generateFollowups?: boolean | undefined;
                autonomous?: boolean | undefined;
                automation?: {
                    automationId: string;
                    automationRevision: number;
                    receiptId: string;
                    event: string;
                    githubUrl: string;
                } | undefined;
                status: "cancelled" | "done" | "failed" | "queued" | "review" | "running" | "waiting";
                activity?: "monitoring" | undefined;
                monitoringWakeAt?: string | undefined;
                monitoringWakeCapReached?: boolean | undefined;
                autoResumeAt?: string | undefined;
                autoResumeAttempts?: number | undefined;
                blockedReason?: {
                    type: "provider_quota";
                    providers: ("claude" | "codex")[];
                    retryAt?: string | undefined;
                } | undefined;
                createdAt: string;
                startedAt?: string | undefined;
                finishedAt?: string | undefined;
                tokensUsed: number;
                inputTokens?: number | undefined;
                outputTokens?: number | undefined;
                costUsd?: number | undefined;
                pullRequestUrl?: string | undefined;
                referencedPullRequestUrl?: string | undefined;
                prNumber?: number | undefined;
                issueNumber?: number | undefined;
                referencedIssueNumberSeeded?: boolean | undefined;
                titleOrigin?: "auto" | "marker" | "user" | undefined;
                markerRefs?: {
                    pr?: number | undefined;
                    issue?: number | undefined;
                } | undefined;
                referencedPrCandidates?: string[] | undefined;
                referencedIssueUrl?: string | undefined;
                referencedIssueCandidates?: string[] | undefined;
                worktree?: false | undefined;
                worktreePath?: string | undefined;
                branch?: string | undefined;
                baseBranch?: string | undefined;
                worktreeReclaimedAt?: string | undefined;
                groupId?: string | undefined;
                variant?: string | undefined;
                peakRssBytes?: number | undefined;
                peakProcCount?: number | undefined;
                archived: boolean;
                archivedAt?: string | undefined;
                seenAt?: string | undefined;
                currentStepId?: string | undefined;
                error?: string | undefined;
                steps: {
                    id: string;
                    name: string;
                    kind: "agent" | "check";
                    status: "cancelled" | "done" | "failed" | "pending" | "review" | "running" | "skipped" | "waiting";
                    iterations: number;
                    tokensUsed: number;
                    inputTokens?: number | undefined;
                    outputTokens?: number | undefined;
                    usageInvocationsStarted?: number | undefined;
                    usageInvocationsObserved?: number | undefined;
                    usageTurnsStarted?: number | undefined;
                    usageTurnsRecorded?: number | undefined;
                    usageInvocationEpoch?: number | undefined;
                    startedAt?: string | undefined;
                    finishedAt?: string | undefined;
                    error?: string | undefined;
                    sessionId?: string | undefined;
                    backend?: "claude" | "codex" | "opencode" | "pi" | undefined;
                    requestedRunner?: "auto" | "claude" | "codex" | "opencode" | "pi" | undefined;
                    profileId?: string | undefined;
                    reasoningEffort?: "high" | "low" | "medium" | "xhigh" | undefined;
                    costUsd?: number | undefined;
                    modelIdentity?: string | undefined;
                }[];
                workflowDef?: {
                    name: string;
                    description?: string | undefined;
                    steps: {
                        id: string;
                        name?: string | undefined;
                        prompt?: string | undefined;
                        skill?: string | undefined;
                        model?: string | undefined;
                        runner?: "auto" | "claude" | "codex" | "opencode" | "pi" | undefined;
                        allowedTools?: string[] | undefined;
                        bashAllowlist?: string[] | undefined;
                        command?: string | undefined;
                        onFail?: {
                            retry: string;
                            max: number;
                        } | undefined;
                    }[];
                    source: "built-in" | "file";
                    path?: string | undefined;
                } | undefined;
            };
            outputFormat: "json";
            status: import("hono/utils/http-status").ContentfulStatusCode;
            input: {
                json: {
                    archived?: boolean | undefined;
                };
            } & {
                param: {
                    id: string;
                };
            };
        } | {
            output: {
                error: string;
            };
            outputFormat: "json";
            status: 404;
            input: {
                json: {
                    archived?: boolean | undefined;
                };
            } & {
                param: {
                    id: string;
                };
            };
        };
    };
} & {
    "/runs/:id/auto-resume": {
        $delete: {
            output: {
                error: string;
            };
            outputFormat: "json";
            status: 404;
            input: {
                param: {
                    id: string;
                };
            };
        } | {
            output: {
                cancelled: true;
            };
            outputFormat: "json";
            status: import("hono/utils/http-status").ContentfulStatusCode;
            input: {
                param: {
                    id: string;
                };
            };
        };
    };
} & {
    "/runs/:id/read": {
        $post: {
            output: {
                id: string;
                title: string;
                titleSummary?: string | undefined;
                diffStat?: {
                    adds: number;
                    dels: number;
                    files: number;
                    repointed?: boolean | undefined;
                } | undefined;
                workflow: string;
                task: string;
                queuedMessages?: {
                    id: string;
                    text: string;
                    images?: string[] | undefined;
                    createdAt: string;
                }[] | undefined;
                taskImages?: string[] | undefined;
                model?: string | undefined;
                reasoningEffort?: "auto" | "high" | "low" | "medium" | "xhigh" | undefined;
                modelIdentity?: string | undefined;
                runner?: "claude" | "codex" | "opencode" | "pi" | undefined;
                requestedRunner?: "auto" | "claude" | "codex" | "opencode" | "pi" | undefined;
                agentProfile?: string | undefined;
                systemPrompt?: string | undefined;
                generateFollowups?: boolean | undefined;
                autonomous?: boolean | undefined;
                automation?: {
                    automationId: string;
                    automationRevision: number;
                    receiptId: string;
                    event: string;
                    githubUrl: string;
                } | undefined;
                status: "cancelled" | "done" | "failed" | "queued" | "review" | "running" | "waiting";
                activity?: "monitoring" | undefined;
                monitoringWakeAt?: string | undefined;
                monitoringWakeCapReached?: boolean | undefined;
                autoResumeAt?: string | undefined;
                autoResumeAttempts?: number | undefined;
                blockedReason?: {
                    type: "provider_quota";
                    providers: ("claude" | "codex")[];
                    retryAt?: string | undefined;
                } | undefined;
                createdAt: string;
                startedAt?: string | undefined;
                finishedAt?: string | undefined;
                tokensUsed: number;
                inputTokens?: number | undefined;
                outputTokens?: number | undefined;
                costUsd?: number | undefined;
                pullRequestUrl?: string | undefined;
                referencedPullRequestUrl?: string | undefined;
                prNumber?: number | undefined;
                issueNumber?: number | undefined;
                referencedIssueNumberSeeded?: boolean | undefined;
                titleOrigin?: "auto" | "marker" | "user" | undefined;
                markerRefs?: {
                    pr?: number | undefined;
                    issue?: number | undefined;
                } | undefined;
                referencedPrCandidates?: string[] | undefined;
                referencedIssueUrl?: string | undefined;
                referencedIssueCandidates?: string[] | undefined;
                worktree?: false | undefined;
                worktreePath?: string | undefined;
                branch?: string | undefined;
                baseBranch?: string | undefined;
                worktreeReclaimedAt?: string | undefined;
                groupId?: string | undefined;
                variant?: string | undefined;
                peakRssBytes?: number | undefined;
                peakProcCount?: number | undefined;
                archived: boolean;
                archivedAt?: string | undefined;
                seenAt?: string | undefined;
                currentStepId?: string | undefined;
                error?: string | undefined;
                steps: {
                    id: string;
                    name: string;
                    kind: "agent" | "check";
                    status: "cancelled" | "done" | "failed" | "pending" | "review" | "running" | "skipped" | "waiting";
                    iterations: number;
                    tokensUsed: number;
                    inputTokens?: number | undefined;
                    outputTokens?: number | undefined;
                    usageInvocationsStarted?: number | undefined;
                    usageInvocationsObserved?: number | undefined;
                    usageTurnsStarted?: number | undefined;
                    usageTurnsRecorded?: number | undefined;
                    usageInvocationEpoch?: number | undefined;
                    startedAt?: string | undefined;
                    finishedAt?: string | undefined;
                    error?: string | undefined;
                    sessionId?: string | undefined;
                    backend?: "claude" | "codex" | "opencode" | "pi" | undefined;
                    requestedRunner?: "auto" | "claude" | "codex" | "opencode" | "pi" | undefined;
                    profileId?: string | undefined;
                    reasoningEffort?: "high" | "low" | "medium" | "xhigh" | undefined;
                    costUsd?: number | undefined;
                    modelIdentity?: string | undefined;
                }[];
                workflowDef?: {
                    name: string;
                    description?: string | undefined;
                    steps: {
                        id: string;
                        name?: string | undefined;
                        prompt?: string | undefined;
                        skill?: string | undefined;
                        model?: string | undefined;
                        runner?: "auto" | "claude" | "codex" | "opencode" | "pi" | undefined;
                        allowedTools?: string[] | undefined;
                        bashAllowlist?: string[] | undefined;
                        command?: string | undefined;
                        onFail?: {
                            retry: string;
                            max: number;
                        } | undefined;
                    }[];
                    source: "built-in" | "file";
                    path?: string | undefined;
                } | undefined;
            };
            outputFormat: "json";
            status: import("hono/utils/http-status").ContentfulStatusCode;
            input: {
                param: {
                    id: string;
                };
            };
        } | {
            output: {
                error: string;
            };
            outputFormat: "json";
            status: 404;
            input: {
                param: {
                    id: string;
                };
            };
        };
    };
} & {
    "/runs/:id/unread": {
        $post: {
            output: {
                id: string;
                title: string;
                titleSummary?: string | undefined;
                diffStat?: {
                    adds: number;
                    dels: number;
                    files: number;
                    repointed?: boolean | undefined;
                } | undefined;
                workflow: string;
                task: string;
                queuedMessages?: {
                    id: string;
                    text: string;
                    images?: string[] | undefined;
                    createdAt: string;
                }[] | undefined;
                taskImages?: string[] | undefined;
                model?: string | undefined;
                reasoningEffort?: "auto" | "high" | "low" | "medium" | "xhigh" | undefined;
                modelIdentity?: string | undefined;
                runner?: "claude" | "codex" | "opencode" | "pi" | undefined;
                requestedRunner?: "auto" | "claude" | "codex" | "opencode" | "pi" | undefined;
                agentProfile?: string | undefined;
                systemPrompt?: string | undefined;
                generateFollowups?: boolean | undefined;
                autonomous?: boolean | undefined;
                automation?: {
                    automationId: string;
                    automationRevision: number;
                    receiptId: string;
                    event: string;
                    githubUrl: string;
                } | undefined;
                status: "cancelled" | "done" | "failed" | "queued" | "review" | "running" | "waiting";
                activity?: "monitoring" | undefined;
                monitoringWakeAt?: string | undefined;
                monitoringWakeCapReached?: boolean | undefined;
                autoResumeAt?: string | undefined;
                autoResumeAttempts?: number | undefined;
                blockedReason?: {
                    type: "provider_quota";
                    providers: ("claude" | "codex")[];
                    retryAt?: string | undefined;
                } | undefined;
                createdAt: string;
                startedAt?: string | undefined;
                finishedAt?: string | undefined;
                tokensUsed: number;
                inputTokens?: number | undefined;
                outputTokens?: number | undefined;
                costUsd?: number | undefined;
                pullRequestUrl?: string | undefined;
                referencedPullRequestUrl?: string | undefined;
                prNumber?: number | undefined;
                issueNumber?: number | undefined;
                referencedIssueNumberSeeded?: boolean | undefined;
                titleOrigin?: "auto" | "marker" | "user" | undefined;
                markerRefs?: {
                    pr?: number | undefined;
                    issue?: number | undefined;
                } | undefined;
                referencedPrCandidates?: string[] | undefined;
                referencedIssueUrl?: string | undefined;
                referencedIssueCandidates?: string[] | undefined;
                worktree?: false | undefined;
                worktreePath?: string | undefined;
                branch?: string | undefined;
                baseBranch?: string | undefined;
                worktreeReclaimedAt?: string | undefined;
                groupId?: string | undefined;
                variant?: string | undefined;
                peakRssBytes?: number | undefined;
                peakProcCount?: number | undefined;
                archived: boolean;
                archivedAt?: string | undefined;
                seenAt?: string | undefined;
                currentStepId?: string | undefined;
                error?: string | undefined;
                steps: {
                    id: string;
                    name: string;
                    kind: "agent" | "check";
                    status: "cancelled" | "done" | "failed" | "pending" | "review" | "running" | "skipped" | "waiting";
                    iterations: number;
                    tokensUsed: number;
                    inputTokens?: number | undefined;
                    outputTokens?: number | undefined;
                    usageInvocationsStarted?: number | undefined;
                    usageInvocationsObserved?: number | undefined;
                    usageTurnsStarted?: number | undefined;
                    usageTurnsRecorded?: number | undefined;
                    usageInvocationEpoch?: number | undefined;
                    startedAt?: string | undefined;
                    finishedAt?: string | undefined;
                    error?: string | undefined;
                    sessionId?: string | undefined;
                    backend?: "claude" | "codex" | "opencode" | "pi" | undefined;
                    requestedRunner?: "auto" | "claude" | "codex" | "opencode" | "pi" | undefined;
                    profileId?: string | undefined;
                    reasoningEffort?: "high" | "low" | "medium" | "xhigh" | undefined;
                    costUsd?: number | undefined;
                    modelIdentity?: string | undefined;
                }[];
                workflowDef?: {
                    name: string;
                    description?: string | undefined;
                    steps: {
                        id: string;
                        name?: string | undefined;
                        prompt?: string | undefined;
                        skill?: string | undefined;
                        model?: string | undefined;
                        runner?: "auto" | "claude" | "codex" | "opencode" | "pi" | undefined;
                        allowedTools?: string[] | undefined;
                        bashAllowlist?: string[] | undefined;
                        command?: string | undefined;
                        onFail?: {
                            retry: string;
                            max: number;
                        } | undefined;
                    }[];
                    source: "built-in" | "file";
                    path?: string | undefined;
                } | undefined;
            };
            outputFormat: "json";
            status: import("hono/utils/http-status").ContentfulStatusCode;
            input: {
                param: {
                    id: string;
                };
            };
        } | {
            output: {
                error: string;
            };
            outputFormat: "json";
            status: 404;
            input: {
                param: {
                    id: string;
                };
            };
        };
    };
} & {
    "/runs": {
        $post: {
            output: {
                id: string;
                title: string;
                titleSummary?: string | undefined;
                diffStat?: {
                    adds: number;
                    dels: number;
                    files: number;
                    repointed?: boolean | undefined;
                } | undefined;
                workflow: string;
                task: string;
                queuedMessages?: {
                    id: string;
                    text: string;
                    images?: string[] | undefined;
                    createdAt: string;
                }[] | undefined;
                taskImages?: string[] | undefined;
                model?: string | undefined;
                reasoningEffort?: "auto" | "high" | "low" | "medium" | "xhigh" | undefined;
                modelIdentity?: string | undefined;
                runner?: "claude" | "codex" | "opencode" | "pi" | undefined;
                requestedRunner?: "auto" | "claude" | "codex" | "opencode" | "pi" | undefined;
                agentProfile?: string | undefined;
                systemPrompt?: string | undefined;
                generateFollowups?: boolean | undefined;
                autonomous?: boolean | undefined;
                automation?: {
                    automationId: string;
                    automationRevision: number;
                    receiptId: string;
                    event: string;
                    githubUrl: string;
                } | undefined;
                status: "cancelled" | "done" | "failed" | "queued" | "review" | "running" | "waiting";
                activity?: "monitoring" | undefined;
                monitoringWakeAt?: string | undefined;
                monitoringWakeCapReached?: boolean | undefined;
                autoResumeAt?: string | undefined;
                autoResumeAttempts?: number | undefined;
                blockedReason?: {
                    type: "provider_quota";
                    providers: ("claude" | "codex")[];
                    retryAt?: string | undefined;
                } | undefined;
                createdAt: string;
                startedAt?: string | undefined;
                finishedAt?: string | undefined;
                tokensUsed: number;
                inputTokens?: number | undefined;
                outputTokens?: number | undefined;
                costUsd?: number | undefined;
                pullRequestUrl?: string | undefined;
                referencedPullRequestUrl?: string | undefined;
                prNumber?: number | undefined;
                issueNumber?: number | undefined;
                referencedIssueNumberSeeded?: boolean | undefined;
                titleOrigin?: "auto" | "marker" | "user" | undefined;
                markerRefs?: {
                    pr?: number | undefined;
                    issue?: number | undefined;
                } | undefined;
                referencedPrCandidates?: string[] | undefined;
                referencedIssueUrl?: string | undefined;
                referencedIssueCandidates?: string[] | undefined;
                worktree?: false | undefined;
                worktreePath?: string | undefined;
                branch?: string | undefined;
                baseBranch?: string | undefined;
                worktreeReclaimedAt?: string | undefined;
                groupId?: string | undefined;
                variant?: string | undefined;
                peakRssBytes?: number | undefined;
                peakProcCount?: number | undefined;
                archived: boolean;
                archivedAt?: string | undefined;
                seenAt?: string | undefined;
                currentStepId?: string | undefined;
                error?: string | undefined;
                steps: {
                    id: string;
                    name: string;
                    kind: "agent" | "check";
                    status: "cancelled" | "done" | "failed" | "pending" | "review" | "running" | "skipped" | "waiting";
                    iterations: number;
                    tokensUsed: number;
                    inputTokens?: number | undefined;
                    outputTokens?: number | undefined;
                    usageInvocationsStarted?: number | undefined;
                    usageInvocationsObserved?: number | undefined;
                    usageTurnsStarted?: number | undefined;
                    usageTurnsRecorded?: number | undefined;
                    usageInvocationEpoch?: number | undefined;
                    startedAt?: string | undefined;
                    finishedAt?: string | undefined;
                    error?: string | undefined;
                    sessionId?: string | undefined;
                    backend?: "claude" | "codex" | "opencode" | "pi" | undefined;
                    requestedRunner?: "auto" | "claude" | "codex" | "opencode" | "pi" | undefined;
                    profileId?: string | undefined;
                    reasoningEffort?: "high" | "low" | "medium" | "xhigh" | undefined;
                    costUsd?: number | undefined;
                    modelIdentity?: string | undefined;
                }[];
                workflowDef?: {
                    name: string;
                    description?: string | undefined;
                    steps: {
                        id: string;
                        name?: string | undefined;
                        prompt?: string | undefined;
                        skill?: string | undefined;
                        model?: string | undefined;
                        runner?: "auto" | "claude" | "codex" | "opencode" | "pi" | undefined;
                        allowedTools?: string[] | undefined;
                        bashAllowlist?: string[] | undefined;
                        command?: string | undefined;
                        onFail?: {
                            retry: string;
                            max: number;
                        } | undefined;
                    }[];
                    source: "built-in" | "file";
                    path?: string | undefined;
                } | undefined;
            };
            outputFormat: "json";
            status: 201;
            input: {
                json: {
                    workflow?: string | undefined;
                    steps?: {
                        id: string;
                        name?: string | undefined;
                        prompt?: string | undefined;
                        skill?: string | undefined;
                        model?: string | undefined;
                        runner?: "auto" | "claude" | "codex" | "opencode" | "pi" | undefined;
                        allowedTools?: string[] | undefined;
                        bashAllowlist?: string[] | undefined;
                        command?: string | undefined;
                        onFail?: {
                            retry: string;
                            max?: number | undefined;
                        } | undefined;
                    }[] | undefined;
                    task: string;
                    model?: string | undefined;
                    reasoningEffort?: "auto" | "high" | "low" | "medium" | "xhigh" | undefined;
                    runner?: "auto" | "claude" | "codex" | "opencode" | "pi" | undefined;
                    agentProfile?: string | undefined;
                    variants?: number | undefined;
                    worktree?: boolean | undefined;
                    autonomous?: boolean | undefined;
                    generateFollowups?: boolean | undefined;
                    systemPrompt?: string | undefined;
                    images?: {
                        mediaType: string;
                        data: string;
                    }[] | undefined;
                    todoId?: string | undefined;
                };
            };
        } | {
            output: {
                error: string;
            };
            outputFormat: "json";
            status: 409;
            input: {
                json: {
                    workflow?: string | undefined;
                    steps?: {
                        id: string;
                        name?: string | undefined;
                        prompt?: string | undefined;
                        skill?: string | undefined;
                        model?: string | undefined;
                        runner?: "auto" | "claude" | "codex" | "opencode" | "pi" | undefined;
                        allowedTools?: string[] | undefined;
                        bashAllowlist?: string[] | undefined;
                        command?: string | undefined;
                        onFail?: {
                            retry: string;
                            max?: number | undefined;
                        } | undefined;
                    }[] | undefined;
                    task: string;
                    model?: string | undefined;
                    reasoningEffort?: "auto" | "high" | "low" | "medium" | "xhigh" | undefined;
                    runner?: "auto" | "claude" | "codex" | "opencode" | "pi" | undefined;
                    agentProfile?: string | undefined;
                    variants?: number | undefined;
                    worktree?: boolean | undefined;
                    autonomous?: boolean | undefined;
                    generateFollowups?: boolean | undefined;
                    systemPrompt?: string | undefined;
                    images?: {
                        mediaType: string;
                        data: string;
                    }[] | undefined;
                    todoId?: string | undefined;
                };
            };
        } | {
            output: {
                error: string;
            };
            outputFormat: "json";
            status: 400;
            input: {
                json: {
                    workflow?: string | undefined;
                    steps?: {
                        id: string;
                        name?: string | undefined;
                        prompt?: string | undefined;
                        skill?: string | undefined;
                        model?: string | undefined;
                        runner?: "auto" | "claude" | "codex" | "opencode" | "pi" | undefined;
                        allowedTools?: string[] | undefined;
                        bashAllowlist?: string[] | undefined;
                        command?: string | undefined;
                        onFail?: {
                            retry: string;
                            max?: number | undefined;
                        } | undefined;
                    }[] | undefined;
                    task: string;
                    model?: string | undefined;
                    reasoningEffort?: "auto" | "high" | "low" | "medium" | "xhigh" | undefined;
                    runner?: "auto" | "claude" | "codex" | "opencode" | "pi" | undefined;
                    agentProfile?: string | undefined;
                    variants?: number | undefined;
                    worktree?: boolean | undefined;
                    autonomous?: boolean | undefined;
                    generateFollowups?: boolean | undefined;
                    systemPrompt?: string | undefined;
                    images?: {
                        mediaType: string;
                        data: string;
                    }[] | undefined;
                    todoId?: string | undefined;
                };
            };
        } | {
            output: {
                error: string;
            };
            outputFormat: "json";
            status: 404;
            input: {
                json: {
                    workflow?: string | undefined;
                    steps?: {
                        id: string;
                        name?: string | undefined;
                        prompt?: string | undefined;
                        skill?: string | undefined;
                        model?: string | undefined;
                        runner?: "auto" | "claude" | "codex" | "opencode" | "pi" | undefined;
                        allowedTools?: string[] | undefined;
                        bashAllowlist?: string[] | undefined;
                        command?: string | undefined;
                        onFail?: {
                            retry: string;
                            max?: number | undefined;
                        } | undefined;
                    }[] | undefined;
                    task: string;
                    model?: string | undefined;
                    reasoningEffort?: "auto" | "high" | "low" | "medium" | "xhigh" | undefined;
                    runner?: "auto" | "claude" | "codex" | "opencode" | "pi" | undefined;
                    agentProfile?: string | undefined;
                    variants?: number | undefined;
                    worktree?: boolean | undefined;
                    autonomous?: boolean | undefined;
                    generateFollowups?: boolean | undefined;
                    systemPrompt?: string | undefined;
                    images?: {
                        mediaType: string;
                        data: string;
                    }[] | undefined;
                    todoId?: string | undefined;
                };
            };
        } | {
            output: {
                runs: {
                    id: string;
                    title: string;
                    titleSummary?: string | undefined;
                    diffStat?: {
                        adds: number;
                        dels: number;
                        files: number;
                        repointed?: boolean | undefined;
                    } | undefined;
                    workflow: string;
                    task: string;
                    queuedMessages?: {
                        id: string;
                        text: string;
                        images?: string[] | undefined;
                        createdAt: string;
                    }[] | undefined;
                    taskImages?: string[] | undefined;
                    model?: string | undefined;
                    reasoningEffort?: "auto" | "high" | "low" | "medium" | "xhigh" | undefined;
                    modelIdentity?: string | undefined;
                    runner?: "claude" | "codex" | "opencode" | "pi" | undefined;
                    requestedRunner?: "auto" | "claude" | "codex" | "opencode" | "pi" | undefined;
                    agentProfile?: string | undefined;
                    systemPrompt?: string | undefined;
                    generateFollowups?: boolean | undefined;
                    autonomous?: boolean | undefined;
                    automation?: {
                        automationId: string;
                        automationRevision: number;
                        receiptId: string;
                        event: string;
                        githubUrl: string;
                    } | undefined;
                    status: "cancelled" | "done" | "failed" | "queued" | "review" | "running" | "waiting";
                    activity?: "monitoring" | undefined;
                    monitoringWakeAt?: string | undefined;
                    monitoringWakeCapReached?: boolean | undefined;
                    autoResumeAt?: string | undefined;
                    autoResumeAttempts?: number | undefined;
                    blockedReason?: {
                        type: "provider_quota";
                        providers: ("claude" | "codex")[];
                        retryAt?: string | undefined;
                    } | undefined;
                    createdAt: string;
                    startedAt?: string | undefined;
                    finishedAt?: string | undefined;
                    tokensUsed: number;
                    inputTokens?: number | undefined;
                    outputTokens?: number | undefined;
                    costUsd?: number | undefined;
                    pullRequestUrl?: string | undefined;
                    referencedPullRequestUrl?: string | undefined;
                    prNumber?: number | undefined;
                    issueNumber?: number | undefined;
                    referencedIssueNumberSeeded?: boolean | undefined;
                    titleOrigin?: "auto" | "marker" | "user" | undefined;
                    markerRefs?: {
                        pr?: number | undefined;
                        issue?: number | undefined;
                    } | undefined;
                    referencedPrCandidates?: string[] | undefined;
                    referencedIssueUrl?: string | undefined;
                    referencedIssueCandidates?: string[] | undefined;
                    worktree?: false | undefined;
                    worktreePath?: string | undefined;
                    branch?: string | undefined;
                    baseBranch?: string | undefined;
                    worktreeReclaimedAt?: string | undefined;
                    groupId?: string | undefined;
                    variant?: string | undefined;
                    peakRssBytes?: number | undefined;
                    peakProcCount?: number | undefined;
                    archived: boolean;
                    archivedAt?: string | undefined;
                    seenAt?: string | undefined;
                    currentStepId?: string | undefined;
                    error?: string | undefined;
                    steps: {
                        id: string;
                        name: string;
                        kind: "agent" | "check";
                        status: "cancelled" | "done" | "failed" | "pending" | "review" | "running" | "skipped" | "waiting";
                        iterations: number;
                        tokensUsed: number;
                        inputTokens?: number | undefined;
                        outputTokens?: number | undefined;
                        usageInvocationsStarted?: number | undefined;
                        usageInvocationsObserved?: number | undefined;
                        usageTurnsStarted?: number | undefined;
                        usageTurnsRecorded?: number | undefined;
                        usageInvocationEpoch?: number | undefined;
                        startedAt?: string | undefined;
                        finishedAt?: string | undefined;
                        error?: string | undefined;
                        sessionId?: string | undefined;
                        backend?: "claude" | "codex" | "opencode" | "pi" | undefined;
                        requestedRunner?: "auto" | "claude" | "codex" | "opencode" | "pi" | undefined;
                        profileId?: string | undefined;
                        reasoningEffort?: "high" | "low" | "medium" | "xhigh" | undefined;
                        costUsd?: number | undefined;
                        modelIdentity?: string | undefined;
                    }[];
                    workflowDef?: {
                        name: string;
                        description?: string | undefined;
                        steps: {
                            id: string;
                            name?: string | undefined;
                            prompt?: string | undefined;
                            skill?: string | undefined;
                            model?: string | undefined;
                            runner?: "auto" | "claude" | "codex" | "opencode" | "pi" | undefined;
                            allowedTools?: string[] | undefined;
                            bashAllowlist?: string[] | undefined;
                            command?: string | undefined;
                            onFail?: {
                                retry: string;
                                max: number;
                            } | undefined;
                        }[];
                        source: "built-in" | "file";
                        path?: string | undefined;
                    } | undefined;
                }[];
            };
            outputFormat: "json";
            status: 201;
            input: {
                json: {
                    workflow?: string | undefined;
                    steps?: {
                        id: string;
                        name?: string | undefined;
                        prompt?: string | undefined;
                        skill?: string | undefined;
                        model?: string | undefined;
                        runner?: "auto" | "claude" | "codex" | "opencode" | "pi" | undefined;
                        allowedTools?: string[] | undefined;
                        bashAllowlist?: string[] | undefined;
                        command?: string | undefined;
                        onFail?: {
                            retry: string;
                            max?: number | undefined;
                        } | undefined;
                    }[] | undefined;
                    task: string;
                    model?: string | undefined;
                    reasoningEffort?: "auto" | "high" | "low" | "medium" | "xhigh" | undefined;
                    runner?: "auto" | "claude" | "codex" | "opencode" | "pi" | undefined;
                    agentProfile?: string | undefined;
                    variants?: number | undefined;
                    worktree?: boolean | undefined;
                    autonomous?: boolean | undefined;
                    generateFollowups?: boolean | undefined;
                    systemPrompt?: string | undefined;
                    images?: {
                        mediaType: string;
                        data: string;
                    }[] | undefined;
                    todoId?: string | undefined;
                };
            };
        };
    };
} & {
    "/runs/:id": {
        $get: {
            output: {
                id: string;
                title: string;
                titleSummary?: string | undefined;
                diffStat?: {
                    adds: number;
                    dels: number;
                    files: number;
                    repointed?: boolean | undefined;
                } | undefined;
                workflow: string;
                task: string;
                queuedMessages?: {
                    id: string;
                    text: string;
                    images?: string[] | undefined;
                    createdAt: string;
                }[] | undefined;
                taskImages?: string[] | undefined;
                model?: string | undefined;
                reasoningEffort?: "auto" | "high" | "low" | "medium" | "xhigh" | undefined;
                modelIdentity?: string | undefined;
                runner?: "claude" | "codex" | "opencode" | "pi" | undefined;
                requestedRunner?: "auto" | "claude" | "codex" | "opencode" | "pi" | undefined;
                agentProfile?: string | undefined;
                systemPrompt?: string | undefined;
                generateFollowups?: boolean | undefined;
                autonomous?: boolean | undefined;
                automation?: {
                    automationId: string;
                    automationRevision: number;
                    receiptId: string;
                    event: string;
                    githubUrl: string;
                } | undefined;
                status: "cancelled" | "done" | "failed" | "queued" | "review" | "running" | "waiting";
                activity?: "monitoring" | undefined;
                monitoringWakeAt?: string | undefined;
                monitoringWakeCapReached?: boolean | undefined;
                autoResumeAt?: string | undefined;
                autoResumeAttempts?: number | undefined;
                blockedReason?: {
                    type: "provider_quota";
                    providers: ("claude" | "codex")[];
                    retryAt?: string | undefined;
                } | undefined;
                createdAt: string;
                startedAt?: string | undefined;
                finishedAt?: string | undefined;
                tokensUsed: number;
                inputTokens?: number | undefined;
                outputTokens?: number | undefined;
                costUsd?: number | undefined;
                pullRequestUrl?: string | undefined;
                referencedPullRequestUrl?: string | undefined;
                prNumber?: number | undefined;
                issueNumber?: number | undefined;
                referencedIssueNumberSeeded?: boolean | undefined;
                titleOrigin?: "auto" | "marker" | "user" | undefined;
                markerRefs?: {
                    pr?: number | undefined;
                    issue?: number | undefined;
                } | undefined;
                referencedPrCandidates?: string[] | undefined;
                referencedIssueUrl?: string | undefined;
                referencedIssueCandidates?: string[] | undefined;
                worktree?: false | undefined;
                worktreePath?: string | undefined;
                branch?: string | undefined;
                baseBranch?: string | undefined;
                worktreeReclaimedAt?: string | undefined;
                groupId?: string | undefined;
                variant?: string | undefined;
                peakRssBytes?: number | undefined;
                peakProcCount?: number | undefined;
                archived: boolean;
                archivedAt?: string | undefined;
                seenAt?: string | undefined;
                currentStepId?: string | undefined;
                error?: string | undefined;
                steps: {
                    id: string;
                    name: string;
                    kind: "agent" | "check";
                    status: "cancelled" | "done" | "failed" | "pending" | "review" | "running" | "skipped" | "waiting";
                    iterations: number;
                    tokensUsed: number;
                    inputTokens?: number | undefined;
                    outputTokens?: number | undefined;
                    usageInvocationsStarted?: number | undefined;
                    usageInvocationsObserved?: number | undefined;
                    usageTurnsStarted?: number | undefined;
                    usageTurnsRecorded?: number | undefined;
                    usageInvocationEpoch?: number | undefined;
                    startedAt?: string | undefined;
                    finishedAt?: string | undefined;
                    error?: string | undefined;
                    sessionId?: string | undefined;
                    backend?: "claude" | "codex" | "opencode" | "pi" | undefined;
                    requestedRunner?: "auto" | "claude" | "codex" | "opencode" | "pi" | undefined;
                    profileId?: string | undefined;
                    reasoningEffort?: "high" | "low" | "medium" | "xhigh" | undefined;
                    costUsd?: number | undefined;
                    modelIdentity?: string | undefined;
                }[];
                workflowDef?: {
                    name: string;
                    description?: string | undefined;
                    steps: {
                        id: string;
                        name?: string | undefined;
                        prompt?: string | undefined;
                        skill?: string | undefined;
                        model?: string | undefined;
                        runner?: "auto" | "claude" | "codex" | "opencode" | "pi" | undefined;
                        allowedTools?: string[] | undefined;
                        bashAllowlist?: string[] | undefined;
                        command?: string | undefined;
                        onFail?: {
                            retry: string;
                            max: number;
                        } | undefined;
                    }[];
                    source: "built-in" | "file";
                    path?: string | undefined;
                } | undefined;
                usage?: ReturnType<typeof currentUsage>;
            };
            outputFormat: "json";
            status: import("hono/utils/http-status").ContentfulStatusCode;
            input: {
                param: {
                    id: string;
                };
            };
        } | {
            output: {
                error: string;
            };
            outputFormat: "json";
            status: 404;
            input: {
                param: {
                    id: string;
                };
            };
        };
    };
} & {
    "/runs/:id/history": {
        $get: {
            output: {
                error: string;
            };
            outputFormat: "json";
            status: 400;
            input: {
                param: {
                    id: string;
                };
            } & {
                query: {
                    cursor?: string | undefined;
                };
            };
        } | {
            output: {
                error: string;
            };
            outputFormat: "json";
            status: 404;
            input: {
                param: {
                    id: string;
                };
            } & {
                query: {
                    cursor?: string | undefined;
                };
            };
        } | {
            output: {
                events: {
                    [x: string]: any;
                    seq: number;
                    ts: string;
                    stepId?: string | undefined;
                    type: string;
                }[];
                itemCount: number;
                olderCursor?: string | undefined;
                newerCursor?: string | undefined;
                liveCursor: string;
                asOfSeq: number;
                hasOlder: boolean;
            };
            outputFormat: "json";
            status: import("hono/utils/http-status").ContentfulStatusCode;
            input: {
                param: {
                    id: string;
                };
            } & {
                query: {
                    cursor?: string | undefined;
                };
            };
        } | {
            output: {
                error: string;
            };
            outputFormat: "json";
            status: 400 | 409;
            input: {
                param: {
                    id: string;
                };
            } & {
                query: {
                    cursor?: string | undefined;
                };
            };
        };
    };
} & {
    "/runs/:id/history-context": {
        $get: {
            output: {
                error: string;
            };
            outputFormat: "json";
            status: 400;
            input: {
                param: {
                    id: string;
                };
            };
        } | {
            output: {
                error: string;
            };
            outputFormat: "json";
            status: 404;
            input: {
                param: {
                    id: string;
                };
            };
        } | {
            output: {
                contextEvents: {
                    [x: string]: any;
                    seq: number;
                    ts: string;
                    stepId?: string | undefined;
                    type: string;
                }[];
                asOfSeq: number;
            };
            outputFormat: "json";
            status: import("hono/utils/http-status").ContentfulStatusCode;
            input: {
                param: {
                    id: string;
                };
            };
        };
    };
} & {
    "/runs/:id": {
        $patch: {
            output: {
                id: string;
                title: string;
                titleSummary?: string | undefined;
                diffStat?: {
                    adds: number;
                    dels: number;
                    files: number;
                    repointed?: boolean | undefined;
                } | undefined;
                workflow: string;
                task: string;
                queuedMessages?: {
                    id: string;
                    text: string;
                    images?: string[] | undefined;
                    createdAt: string;
                }[] | undefined;
                taskImages?: string[] | undefined;
                model?: string | undefined;
                reasoningEffort?: "auto" | "high" | "low" | "medium" | "xhigh" | undefined;
                modelIdentity?: string | undefined;
                runner?: "claude" | "codex" | "opencode" | "pi" | undefined;
                requestedRunner?: "auto" | "claude" | "codex" | "opencode" | "pi" | undefined;
                agentProfile?: string | undefined;
                systemPrompt?: string | undefined;
                generateFollowups?: boolean | undefined;
                autonomous?: boolean | undefined;
                automation?: {
                    automationId: string;
                    automationRevision: number;
                    receiptId: string;
                    event: string;
                    githubUrl: string;
                } | undefined;
                status: "cancelled" | "done" | "failed" | "queued" | "review" | "running" | "waiting";
                activity?: "monitoring" | undefined;
                monitoringWakeAt?: string | undefined;
                monitoringWakeCapReached?: boolean | undefined;
                autoResumeAt?: string | undefined;
                autoResumeAttempts?: number | undefined;
                blockedReason?: {
                    type: "provider_quota";
                    providers: ("claude" | "codex")[];
                    retryAt?: string | undefined;
                } | undefined;
                createdAt: string;
                startedAt?: string | undefined;
                finishedAt?: string | undefined;
                tokensUsed: number;
                inputTokens?: number | undefined;
                outputTokens?: number | undefined;
                costUsd?: number | undefined;
                pullRequestUrl?: string | undefined;
                referencedPullRequestUrl?: string | undefined;
                prNumber?: number | undefined;
                issueNumber?: number | undefined;
                referencedIssueNumberSeeded?: boolean | undefined;
                titleOrigin?: "auto" | "marker" | "user" | undefined;
                markerRefs?: {
                    pr?: number | undefined;
                    issue?: number | undefined;
                } | undefined;
                referencedPrCandidates?: string[] | undefined;
                referencedIssueUrl?: string | undefined;
                referencedIssueCandidates?: string[] | undefined;
                worktree?: false | undefined;
                worktreePath?: string | undefined;
                branch?: string | undefined;
                baseBranch?: string | undefined;
                worktreeReclaimedAt?: string | undefined;
                groupId?: string | undefined;
                variant?: string | undefined;
                peakRssBytes?: number | undefined;
                peakProcCount?: number | undefined;
                archived: boolean;
                archivedAt?: string | undefined;
                seenAt?: string | undefined;
                currentStepId?: string | undefined;
                error?: string | undefined;
                steps: {
                    id: string;
                    name: string;
                    kind: "agent" | "check";
                    status: "cancelled" | "done" | "failed" | "pending" | "review" | "running" | "skipped" | "waiting";
                    iterations: number;
                    tokensUsed: number;
                    inputTokens?: number | undefined;
                    outputTokens?: number | undefined;
                    usageInvocationsStarted?: number | undefined;
                    usageInvocationsObserved?: number | undefined;
                    usageTurnsStarted?: number | undefined;
                    usageTurnsRecorded?: number | undefined;
                    usageInvocationEpoch?: number | undefined;
                    startedAt?: string | undefined;
                    finishedAt?: string | undefined;
                    error?: string | undefined;
                    sessionId?: string | undefined;
                    backend?: "claude" | "codex" | "opencode" | "pi" | undefined;
                    requestedRunner?: "auto" | "claude" | "codex" | "opencode" | "pi" | undefined;
                    profileId?: string | undefined;
                    reasoningEffort?: "high" | "low" | "medium" | "xhigh" | undefined;
                    costUsd?: number | undefined;
                    modelIdentity?: string | undefined;
                }[];
                workflowDef?: {
                    name: string;
                    description?: string | undefined;
                    steps: {
                        id: string;
                        name?: string | undefined;
                        prompt?: string | undefined;
                        skill?: string | undefined;
                        model?: string | undefined;
                        runner?: "auto" | "claude" | "codex" | "opencode" | "pi" | undefined;
                        allowedTools?: string[] | undefined;
                        bashAllowlist?: string[] | undefined;
                        command?: string | undefined;
                        onFail?: {
                            retry: string;
                            max: number;
                        } | undefined;
                    }[];
                    source: "built-in" | "file";
                    path?: string | undefined;
                } | undefined;
            };
            outputFormat: "json";
            status: import("hono/utils/http-status").ContentfulStatusCode;
            input: {
                json: {
                    title?: string | undefined;
                    task?: string | undefined;
                };
            } & {
                param: {
                    id: string;
                };
            };
        } | {
            output: {
                error: string;
            };
            outputFormat: "json";
            status: 404;
            input: {
                json: {
                    title?: string | undefined;
                    task?: string | undefined;
                };
            } & {
                param: {
                    id: string;
                };
            };
        } | {
            output: {
                error: string;
            };
            outputFormat: "json";
            status: 400;
            input: {
                json: {
                    title?: string | undefined;
                    task?: string | undefined;
                };
            } & {
                param: {
                    id: string;
                };
            };
        } | {
            output: {
                error: string;
            };
            outputFormat: "json";
            status: 409;
            input: {
                json: {
                    title?: string | undefined;
                    task?: string | undefined;
                };
            } & {
                param: {
                    id: string;
                };
            };
        };
    };
} & {
    "/runs/:id/cancel": {
        $post: {
            output: {
                error: string;
            };
            outputFormat: "json";
            status: 404;
            input: {
                param: {
                    id: string;
                };
            };
        } | {
            output: {
                cancelled: boolean;
            };
            outputFormat: "json";
            status: import("hono/utils/http-status").ContentfulStatusCode;
            input: {
                param: {
                    id: string;
                };
            };
        };
    };
} & {
    "/runs/:id/messages": {
        $post: {
            output: {
                error: string;
            };
            outputFormat: "json";
            status: 404;
            input: {
                json: {
                    text?: string | undefined;
                    images?: {
                        mediaType: string;
                        data: string;
                    }[] | undefined;
                };
            } & {
                param: {
                    id: string;
                };
            };
        } | {
            output: {
                error: string;
            };
            outputFormat: "json";
            status: 409;
            input: {
                json: {
                    text?: string | undefined;
                    images?: {
                        mediaType: string;
                        data: string;
                    }[] | undefined;
                };
            } & {
                param: {
                    id: string;
                };
            };
        } | {
            output: {
                delivered: true;
            };
            outputFormat: "json";
            status: import("hono/utils/http-status").ContentfulStatusCode;
            input: {
                json: {
                    text?: string | undefined;
                    images?: {
                        mediaType: string;
                        data: string;
                    }[] | undefined;
                };
            } & {
                param: {
                    id: string;
                };
            };
        } | {
            output: {
                error: string;
            };
            outputFormat: "json";
            status: 400;
            input: {
                json: {
                    text?: string | undefined;
                    images?: {
                        mediaType: string;
                        data: string;
                    }[] | undefined;
                };
            } & {
                param: {
                    id: string;
                };
            };
        } | {
            output: {
                queued: true;
                message: {
                    id: string;
                    text: string;
                    images?: string[] | undefined;
                    createdAt: string;
                };
            };
            outputFormat: "json";
            status: import("hono/utils/http-status").ContentfulStatusCode;
            input: {
                json: {
                    text?: string | undefined;
                    images?: {
                        mediaType: string;
                        data: string;
                    }[] | undefined;
                };
            } & {
                param: {
                    id: string;
                };
            };
        } | {
            output: {
                deferred: true;
            };
            outputFormat: "json";
            status: import("hono/utils/http-status").ContentfulStatusCode;
            input: {
                json: {
                    text?: string | undefined;
                    images?: {
                        mediaType: string;
                        data: string;
                    }[] | undefined;
                };
            } & {
                param: {
                    id: string;
                };
            };
        };
    };
} & {
    "/runs/:id/queued-messages/:msgId": {
        $patch: {
            output: {
                error: string;
            };
            outputFormat: "json";
            status: 404;
            input: {
                json: {
                    text?: string | undefined;
                    images?: {
                        mediaType: string;
                        data: string;
                    }[] | undefined;
                };
            } & {
                param: {
                    id: string;
                } & {
                    msgId: string;
                };
            };
        } | {
            output: {
                error: string;
            };
            outputFormat: "json";
            status: 400;
            input: {
                json: {
                    text?: string | undefined;
                    images?: {
                        mediaType: string;
                        data: string;
                    }[] | undefined;
                };
            } & {
                param: {
                    id: string;
                } & {
                    msgId: string;
                };
            };
        } | {
            output: {
                error: string;
            };
            outputFormat: "json";
            status: 409;
            input: {
                json: {
                    text?: string | undefined;
                    images?: {
                        mediaType: string;
                        data: string;
                    }[] | undefined;
                };
            } & {
                param: {
                    id: string;
                } & {
                    msgId: string;
                };
            };
        } | {
            output: {
                message: {
                    id: string;
                    text: string;
                    images?: string[] | undefined;
                    createdAt: string;
                };
            };
            outputFormat: "json";
            status: import("hono/utils/http-status").ContentfulStatusCode;
            input: {
                json: {
                    text?: string | undefined;
                    images?: {
                        mediaType: string;
                        data: string;
                    }[] | undefined;
                };
            } & {
                param: {
                    id: string;
                } & {
                    msgId: string;
                };
            };
        };
    };
} & {
    "/runs/:id/queued-messages/:msgId": {
        $delete: {
            output: {
                error: string;
            };
            outputFormat: "json";
            status: 404;
            input: {
                param: {
                    id: string;
                } & {
                    msgId: string;
                };
            };
        } | {
            output: {
                error: string;
            };
            outputFormat: "json";
            status: 409;
            input: {
                param: {
                    id: string;
                } & {
                    msgId: string;
                };
            };
        } | {
            output: {
                removed: true;
            };
            outputFormat: "json";
            status: import("hono/utils/http-status").ContentfulStatusCode;
            input: {
                param: {
                    id: string;
                } & {
                    msgId: string;
                };
            };
        };
    };
} & {
    "/runs/:id/finish": {
        $post: {
            output: {
                error: string;
            };
            outputFormat: "json";
            status: 404;
            input: {
                param: {
                    id: string;
                };
            };
        } | {
            output: {
                error: string;
            };
            outputFormat: "json";
            status: 409;
            input: {
                param: {
                    id: string;
                };
            };
        } | {
            output: {
                finished: true;
            };
            outputFormat: "json";
            status: import("hono/utils/http-status").ContentfulStatusCode;
            input: {
                param: {
                    id: string;
                };
            };
        };
    };
} & {
    "/runs/:id/continue": {
        $post: {
            output: {
                error: string;
            };
            outputFormat: "json";
            status: 404;
            input: {
                json: {
                    text?: string | undefined;
                    images?: {
                        mediaType: string;
                        data: string;
                    }[] | undefined;
                    runner?: "auto" | "claude" | "codex" | "opencode" | "pi" | undefined;
                    model?: string | undefined;
                };
            } & {
                param: {
                    id: string;
                };
            };
        } | {
            output: {
                error: string | undefined;
            };
            outputFormat: "json";
            status: 409;
            input: {
                json: {
                    text?: string | undefined;
                    images?: {
                        mediaType: string;
                        data: string;
                    }[] | undefined;
                    runner?: "auto" | "claude" | "codex" | "opencode" | "pi" | undefined;
                    model?: string | undefined;
                };
            } & {
                param: {
                    id: string;
                };
            };
        } | {
            output: {
                continued: true;
            };
            outputFormat: "json";
            status: import("hono/utils/http-status").ContentfulStatusCode;
            input: {
                json: {
                    text?: string | undefined;
                    images?: {
                        mediaType: string;
                        data: string;
                    }[] | undefined;
                    runner?: "auto" | "claude" | "codex" | "opencode" | "pi" | undefined;
                    model?: string | undefined;
                };
            } & {
                param: {
                    id: string;
                };
            };
        };
    };
} & {
    "/runs/:id/open-in-cli": {
        $post: {
            output: {
                error: string;
            };
            outputFormat: "json";
            status: 404;
            input: {
                param: {
                    id: string;
                };
            };
        } | {
            output: {
                error: string;
            };
            outputFormat: "json";
            status: 409;
            input: {
                param: {
                    id: string;
                };
            };
        } | {
            output: {
                opened: true;
                command: string;
            };
            outputFormat: "json";
            status: import("hono/utils/http-status").ContentfulStatusCode;
            input: {
                param: {
                    id: string;
                };
            };
        };
    };
} & {
    "/runs/:id/open-in": {
        $post: {
            output: {
                error: string;
            };
            outputFormat: "json";
            status: 404;
            input: {
                json: {
                    target: string;
                    path?: string | undefined;
                };
            } & {
                param: {
                    id: string;
                };
            };
        } | {
            output: {
                error: string;
            };
            outputFormat: "json";
            status: 409;
            input: {
                json: {
                    target: string;
                    path?: string | undefined;
                };
            } & {
                param: {
                    id: string;
                };
            };
        } | {
            output: {
                error: string;
            };
            outputFormat: "json";
            status: 400;
            input: {
                json: {
                    target: string;
                    path?: string | undefined;
                };
            } & {
                param: {
                    id: string;
                };
            };
        } | {
            output: {
                opened: true;
                path: string;
            };
            outputFormat: "json";
            status: import("hono/utils/http-status").ContentfulStatusCode;
            input: {
                json: {
                    target: string;
                    path?: string | undefined;
                };
            } & {
                param: {
                    id: string;
                };
            };
        };
    };
} & {
    "/runs/:id/handoff": {
        $get: {
            output: string;
            outputFormat: "text";
            status: 200;
            input: {
                param: {
                    id: string;
                };
            };
        } | {
            output: {
                error: string;
            };
            outputFormat: "json";
            status: 404;
            input: {
                param: {
                    id: string;
                };
            };
        };
    };
} & {
    "/runs/:id/images/:file": {
        $get: {
            output: {};
            outputFormat: string;
            status: import("hono/utils/http-status").StatusCode;
            input: {
                param: {
                    id: string;
                } & {
                    file: string;
                };
            };
        };
    };
} & {
    "/runs/:id/diff": {
        $get: {
            output: string;
            outputFormat: "text";
            status: import("hono/utils/http-status").ContentfulStatusCode;
            input: {
                param: {
                    id: string;
                };
            };
        } | {
            output: {
                error: string;
            };
            outputFormat: "json";
            status: 404;
            input: {
                param: {
                    id: string;
                };
            };
        };
    };
} & {
    "/runs/:id/changes": {
        $get: {
            output: {
                error: string;
            };
            outputFormat: "json";
            status: 404;
            input: {
                param: {
                    id: string;
                };
            };
        } | {
            output: {
                error: string;
            };
            outputFormat: "json";
            status: 409;
            input: {
                param: {
                    id: string;
                };
            };
        } | {
            output: {
                files: {
                    path: string;
                    oldPath?: string;
                    status: 'added' | 'modified' | 'deleted' | 'renamed' | 'copied';
                    adds: number;
                    dels: number;
                    binary: boolean;
                    image?: boolean;
                    patch: string;
                }[];
                stat: {
                    adds: number;
                    dels: number;
                    files: number;
                };
                repointedHead?: {
                    headBranch: string;
                    taskBranch: string;
                } | undefined;
            };
            outputFormat: "json";
            status: import("hono/utils/http-status").ContentfulStatusCode;
            input: {
                param: {
                    id: string;
                };
            };
        };
    };
} & {
    "/runs/:id/commits": {
        $get: {
            output: {
                error: string;
            };
            outputFormat: "json";
            status: 404;
            input: {
                param: {
                    id: string;
                };
            };
        } | {
            output: {
                error: string;
            };
            outputFormat: "json";
            status: 409;
            input: {
                param: {
                    id: string;
                };
            };
        } | {
            output: {
                commits: {
                    sha: string;
                    subject: string;
                    author: string;
                    when: string;
                }[];
                pushed: boolean;
                branch?: string | undefined;
            };
            outputFormat: "json";
            status: import("hono/utils/http-status").ContentfulStatusCode;
            input: {
                param: {
                    id: string;
                };
            };
        };
    };
} & {
    "/runs/:id/commit/:sha": {
        $get: {
            output: {
                error: string;
            };
            outputFormat: "json";
            status: 404;
            input: {
                param: {
                    id: string;
                } & {
                    sha: string;
                };
            };
        } | {
            output: {
                error: string;
            };
            outputFormat: "json";
            status: 409;
            input: {
                param: {
                    id: string;
                } & {
                    sha: string;
                };
            };
        } | {
            output: {
                sha: string;
                subject: string;
                author: string;
                when: string;
                files: {
                    path: string;
                    oldPath?: string;
                    status: 'added' | 'modified' | 'deleted' | 'renamed' | 'copied';
                    adds: number;
                    dels: number;
                    binary: boolean;
                    image?: boolean;
                    patch: string;
                }[];
                stat: {
                    adds: number;
                    dels: number;
                    files: number;
                };
            };
            outputFormat: "json";
            status: import("hono/utils/http-status").ContentfulStatusCode;
            input: {
                param: {
                    id: string;
                } & {
                    sha: string;
                };
            };
        };
    };
} & {
    "/runs/:id/files": {
        $get: {
            output: ArrayBuffer;
            outputFormat: "body";
            status: 200;
            input: {
                query: {
                    path?: string | undefined;
                    raw?: string | undefined;
                };
            } & {
                param: {
                    id: string;
                };
            };
        } | {
            output: {
                error: string;
            };
            outputFormat: "json";
            status: 400;
            input: {
                query: {
                    path?: string | undefined;
                    raw?: string | undefined;
                };
            } & {
                param: {
                    id: string;
                };
            };
        } | {
            output: {
                error: string;
            };
            outputFormat: "json";
            status: 404;
            input: {
                query: {
                    path?: string | undefined;
                    raw?: string | undefined;
                };
            } & {
                param: {
                    id: string;
                };
            };
        } | {
            output: {
                error: string;
            };
            outputFormat: "json";
            status: 409;
            input: {
                query: {
                    path?: string | undefined;
                    raw?: string | undefined;
                };
            } & {
                param: {
                    id: string;
                };
            };
        } | {
            output: {
                type: 'dir';
                path: string;
                entries: {
                    name: string;
                    type: 'dir' | 'file';
                    size?: number;
                }[];
            };
            outputFormat: "json";
            status: import("hono/utils/http-status").ContentfulStatusCode;
            input: {
                query: {
                    path?: string | undefined;
                    raw?: string | undefined;
                };
            } & {
                param: {
                    id: string;
                };
            };
        } | {
            output: {
                type: 'file';
                path: string;
                size: number;
                binary: boolean;
                tooLarge: boolean;
                content?: string | undefined;
            };
            outputFormat: "json";
            status: import("hono/utils/http-status").ContentfulStatusCode;
            input: {
                query: {
                    path?: string | undefined;
                    raw?: string | undefined;
                };
            } & {
                param: {
                    id: string;
                };
            };
        };
    };
} & {
    "/runs/:id/git/commit": {
        $post: {
            output: {
                error: string;
            };
            outputFormat: "json";
            status: 404;
            input: {
                json: {
                    message: string;
                };
            } & {
                param: {
                    id: string;
                };
            };
        } | {
            output: {
                error: string;
            };
            outputFormat: "json";
            status: 409;
            input: {
                json: {
                    message: string;
                };
            } & {
                param: {
                    id: string;
                };
            };
        } | {
            output: {
                committed: true;
                sha: string;
            };
            outputFormat: "json";
            status: import("hono/utils/http-status").ContentfulStatusCode;
            input: {
                json: {
                    message: string;
                };
            } & {
                param: {
                    id: string;
                };
            };
        };
    };
} & {
    "/runs/:id/git/push": {
        $post: {
            output: {
                error: string;
            };
            outputFormat: "json";
            status: 404;
            input: {
                param: {
                    id: string;
                };
            };
        } | {
            output: {
                error: string;
            };
            outputFormat: "json";
            status: 409;
            input: {
                param: {
                    id: string;
                };
            };
        } | {
            output: {
                pushed: true;
                branch: string;
                remote: string;
                upstreamSet: boolean;
            };
            outputFormat: "json";
            status: import("hono/utils/http-status").ContentfulStatusCode;
            input: {
                param: {
                    id: string;
                };
            };
        };
    };
} & {
    "/runs/:id/pr": {
        $post: {
            output: {
                error: string;
            };
            outputFormat: "json";
            status: 404;
            input: {
                param: {
                    id: string;
                };
            };
        } | {
            output: {
                error: string;
            };
            outputFormat: "json";
            status: 409;
            input: {
                param: {
                    id: string;
                };
            };
        } | {
            output: {
                error: string;
            };
            outputFormat: "json";
            status: 400;
            input: {
                param: {
                    id: string;
                };
            };
        } | {
            output: {
                url: string;
                dryRun: boolean;
            };
            outputFormat: "json";
            status: 201;
            input: {
                param: {
                    id: string;
                };
            };
        };
    };
} & {
    "/runs/:id/remove-worktree": {
        $post: {
            output: {
                error: string;
            };
            outputFormat: "json";
            status: 404;
            input: {
                param: {
                    id: string;
                };
            };
        } | {
            output: {
                error: string;
            };
            outputFormat: "json";
            status: 409;
            input: {
                param: {
                    id: string;
                };
            };
        } | {
            output: {
                removed: true;
            };
            outputFormat: "json";
            status: import("hono/utils/http-status").ContentfulStatusCode;
            input: {
                param: {
                    id: string;
                };
            };
        };
    };
} & {
    "/runs/:id": {
        $delete: {
            output: {
                error: string;
            };
            outputFormat: "json";
            status: 409;
            input: {
                param: {
                    id: string;
                };
            };
        } | {
            output: {
                error: string;
            };
            outputFormat: "json";
            status: 404;
            input: {
                param: {
                    id: string;
                };
            };
        } | {
            output: {
                deleted: true;
            };
            outputFormat: "json";
            status: import("hono/utils/http-status").ContentfulStatusCode;
            input: {
                param: {
                    id: string;
                };
            };
        };
    };
}, "/">, "/api/v1/p/:projectId">, "/", "/">;
export declare function startServer(deps: ServerDeps, port: number): ServerType;
/**
 * The WebSocket twin of the `/api/*` request-origin guard (#426), applied
 * before the `/api/v1/ws` handshake. WebSocket is NOT subject to CORS — any web
 * page may open `ws://127.0.0.1:<port>/api/v1/ws` and, unlike a forced HTTP GET,
 * would get to READ what comes back — so this guard is load-bearing:
 *
 *   1. Host allowlist (local mode): a non-loopback Host is a DNS-rebound
 *      request; kill it before the handshake. Same anchored
 *      `isLoopbackHostHeader` rules as the HTTP guard.
 *   2. Origin check: browsers always attach `Origin` to a WS handshake. A
 *      same-authority Origin is the cockpit itself. A LOOPBACK origin with a
 *      loopback Host is also admitted — that is the `npm run dev` Vite proxy
 *      (`changeOrigin` rewrites Host, the browser's `localhost:5173` Origin
 *      survives). Unlike the HTTP write guard we cannot REQUIRE `Sec-Fetch-Site`
 *      here — Safari sends no `Sec-Fetch-*` at all and requiring it would lock
 *      the dev proxy out of it — but we do honor it when it is there: Chromium
 *      does send it on a WS handshake, and page JS cannot forge it (forbidden
 *      header name), so a cross-port attacker page announcing `same-site` is
 *      rejected on the browser that ships it while Safari/Firefox still fall
 *      back to the loopback rule. Best available, not fail-open.
 *      No Origin at all is a non-browser client — same stance as the HTTP guard.
 *
 * The loopback-origin fallback still admits, on a browser that sends no
 * `Sec-Fetch-Site`, a page served from ANOTHER loopback port. That is no longer
 * a caveat the caller must remember: the verdict carries a `trusted` flag, and
 * the hub only lets an UNtrusted connection subscribe to topics a publisher
 * marked `loopbackReadable`. `health` is flagged so (the CORS-open discovery
 * payload, #431); every other topic stays trusted-only by default, so a topic
 * carrying run or repo content is mechanically unreachable from a foreign local
 * page without any per-topic vigilance. A connection is `trusted` when it is
 * provably the cockpit itself: a same-authority Origin, a no-Origin native
 * client, or a dev proxy the browser vouches for via `Sec-Fetch-Site`.
 */
export declare function verifyWsUpgrade(req: IncomingMessage, bindHost?: string): WsUpgradeVerdict;
/** True for session ids safe to splice into the take-over command (see above). */
export declare function isSafeSessionId(sessionId: string): boolean;
/**
 * The CLI command that reopens a run's session for interactive take-over, per
 * backend. Legacy/undefined records default to Claude. Returns null when the id
 * is not a shape we recognise — callers degrade (no take-over) rather than
 * splice it into a shell.
 *
 * Validate, don't quote (#431): the session id is the only variable spliced
 * into the command string, and `openInTerminal` runs that string through bash
 * on darwin/linux but through `cmd /K` on win32. cmd.exe does not treat `'` as
 * a quote character, so POSIX-quoting the id handed Windows users a literal
 * `claude --resume '9f8e…'` and Claude answered "no conversation found".
 * Constraining the charset to one with no metacharacter in ANY of those shells
 * needs no quoting at all and fails closed on an unexpected id — a stronger
 * guarantee than escaping, and platform-independent. Ids are UUID/CLI-minted
 * today; this keeps a future source safe.
 */
export declare function resumeCommand(runner: string | undefined, sessionId: string): string | null;
