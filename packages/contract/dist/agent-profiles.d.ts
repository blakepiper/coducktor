import { z } from 'zod';
/**
 * Agent profiles — extra config dirs for a SECOND login of the same agent CLI
 * (`CLAUDE_CONFIG_DIR=~/.claude-klaudiusz claude`), spec `2026-07-29-agent-profiles`.
 *
 * Workspace-level, so single-mount: `/api/v1/workspace/agent-profiles`. Never project-scoped —
 * an account belongs to the person and the machine, and a second scoped spelling would be a
 * second surface to protect with no consumer. Which account a PROJECT uses rides on
 * `PUT …/agent-profiles/selection` in this same family, because it is stored beside the accounts
 * it names rather than on the project registry (see `src/workspace/agent-accounts.ts`).
 *
 * Node-free by construction (see README rule 1) — `zod` and the sibling contract modules only.
 */
/**
 * The id of the DISCOVERED account — the one `agentHomePaths()` finds from the environment.
 *
 * Reserved: never allocated to a stored account, never written to `~/.cezar/agent-accounts.json`.
 * It is a real, meaningful value on the wire in two places, and they are not the same thing:
 * `PUT …/agent-profiles/selection` takes it (like `null`) to CLEAR a repo back to the discovered
 * account, and `POST /api/v1/runs` takes it as `agentProfile` to mean "this task uses the
 * discovered account, whatever the repo is set to" — which `selectProfile` honours over the repo's
 * selection. Defined here so the cockpit and the server cannot disagree about the spelling.
 */
export declare const DEFAULT_AGENT_ACCOUNT_ID = "default";
/**
 * One of the agent's OWN config files, resolved against THIS account's folder.
 *
 * Addressed by the catalog's stable, opaque `id` — never a path the client composes, which is what
 * makes the open route traversal-proof by construction (the same rule `/api/v1/agent-config/:id`
 * follows).
 */
export declare const agentAccountFileSchema: z.ZodObject<{
    id: z.ZodString;
    label: z.ZodString;
    path: z.ZodString;
    exists: z.ZodBoolean;
}, z.core.$strip>;
export type AgentAccountFile = z.infer<typeof agentAccountFileSchema>;
/**
 * One account, as the cockpit sees it.
 *
 * A CLOSED object, on the same terms as `projectListEntrySchema`: `.passthrough()` on the
 * persistence side (`src/workspace/agent-accounts.ts`) is a durability promise about
 * `~/.cezar/agent-accounts.json`, not a promise that the API answers arbitrary keys.
 */
export declare const agentProfileSchema: z.ZodObject<{
    id: z.ZodString;
    provider: z.ZodEnum<{
        claude: "claude";
        codex: "codex";
        opencode: "opencode";
        pi: "pi";
    }>;
    label: z.ZodString;
    configDir: z.ZodString;
    path: z.ZodString;
    exists: z.ZodBoolean;
    looksValid: z.ZodBoolean;
    isDefault: z.ZodBoolean;
    status: z.ZodOptional<z.ZodObject<{
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
    files: z.ZodArray<z.ZodObject<{
        id: z.ZodString;
        label: z.ZodString;
        path: z.ZodString;
        exists: z.ZodBoolean;
    }, z.core.$strip>>;
}, z.core.$strip>;
export type AgentProfile = z.infer<typeof agentProfileSchema>;
/**
 * How to address one account in the per-account routes (`…/:id/details`, `…/:id/open`).
 *
 * Every DISCOVERED account shares `id: "default"` — that spelling is load-bearing in the selection
 * routes, where it means "back to the discovered account" — so it cannot identify which agent's
 * default is meant. These two routes therefore take `default:<provider>` for a discovered account
 * and the stored slug otherwise. Defined once, here, so the client and the server cannot disagree
 * about the encoding; still opaque, still not a path.
 */
export declare function agentAccountRouteId(profile: Pick<AgentProfile, 'id' | 'provider' | 'isDefault'>): string;
/** One project's account choice, per provider. An absent key = the discovered account. */
export declare const agentAccountSelectionSchema: z.ZodObject<{
    claude: z.ZodOptional<z.ZodString>;
    codex: z.ZodOptional<z.ZodString>;
    opencode: z.ZodOptional<z.ZodString>;
    pi: z.ZodOptional<z.ZodString>;
}, z.core.$strip>;
export type AgentAccountSelection = z.infer<typeof agentAccountSelectionSchema>;
/**
 * `GET /api/v1/workspace/agent-profiles` — every account, discovered defaults first.
 *
 * `editable` is false in hosted mode (`CEZ_REMOTE`), where the whole family is refused: defining
 * a profile points an agent at a local directory, and the listing echoes absolute paths carrying
 * the username. Same posture as `PUT /api/v1/agent-config/:id`.
 */
export declare const agentProfilesResponseSchema: z.ZodObject<{
    editable: z.ZodBoolean;
    profiles: z.ZodArray<z.ZodObject<{
        id: z.ZodString;
        provider: z.ZodEnum<{
            claude: "claude";
            codex: "codex";
            opencode: "opencode";
            pi: "pi";
        }>;
        label: z.ZodString;
        configDir: z.ZodString;
        path: z.ZodString;
        exists: z.ZodBoolean;
        looksValid: z.ZodBoolean;
        isDefault: z.ZodBoolean;
        status: z.ZodOptional<z.ZodObject<{
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
        files: z.ZodArray<z.ZodObject<{
            id: z.ZodString;
            label: z.ZodString;
            path: z.ZodString;
            exists: z.ZodBoolean;
        }, z.core.$strip>>;
    }, z.core.$strip>>;
    profileCapableProviders: z.ZodArray<z.ZodEnum<{
        claude: "claude";
        codex: "codex";
        opencode: "opencode";
        pi: "pi";
    }>>;
    selections: z.ZodRecord<z.ZodString, z.ZodObject<{
        claude: z.ZodOptional<z.ZodString>;
        codex: z.ZodOptional<z.ZodString>;
        opencode: z.ZodOptional<z.ZodString>;
        pi: z.ZodOptional<z.ZodString>;
    }, z.core.$strip>>;
    defaults: z.ZodObject<{
        claude: z.ZodOptional<z.ZodString>;
        codex: z.ZodOptional<z.ZodString>;
        opencode: z.ZodOptional<z.ZodString>;
        pi: z.ZodOptional<z.ZodString>;
    }, z.core.$strip>;
}, z.core.$strip>;
export type AgentProfilesResponse = z.infer<typeof agentProfilesResponseSchema>;
/**
 * `PUT /api/v1/workspace/agent-profiles/selection` — point one project's provider at an account.
 *
 * `profileId: null` (and the reserved `"default"`) clear it back to the discovered account, stored
 * as absence. An id that does not exist, or belongs to another provider, is a 400 — never silently
 * degraded, because a typo the route accepted would quietly run the project on the wrong account.
 */
export declare const selectAgentProfileInputSchema: z.ZodObject<{
    projectId: z.ZodNullable<z.ZodString>;
    provider: z.ZodEnum<{
        claude: "claude";
        codex: "codex";
        opencode: "opencode";
        pi: "pi";
    }>;
    profileId: z.ZodNullable<z.ZodString>;
}, z.core.$strip>;
export type SelectAgentProfileInput = z.infer<typeof selectAgentProfileInputSchema>;
/** The selection map after the write — the same shape the listing carries. */
export declare const agentProfileSelectionsResponseSchema: z.ZodObject<{
    selections: z.ZodRecord<z.ZodString, z.ZodObject<{
        claude: z.ZodOptional<z.ZodString>;
        codex: z.ZodOptional<z.ZodString>;
        opencode: z.ZodOptional<z.ZodString>;
        pi: z.ZodOptional<z.ZodString>;
    }, z.core.$strip>>;
    defaults: z.ZodObject<{
        claude: z.ZodOptional<z.ZodString>;
        codex: z.ZodOptional<z.ZodString>;
        opencode: z.ZodOptional<z.ZodString>;
        pi: z.ZodOptional<z.ZodString>;
    }, z.core.$strip>;
}, z.core.$strip>;
export type AgentProfileSelectionsResponse = z.infer<typeof agentProfileSelectionsResponseSchema>;
/** `GET /api/v1/workspace/agent-profiles/:id/status` — one account's auth state, probed for real.
 *  `?refresh=1` drops this account's cached answer and re-probes. Kept off the listing so a cold
 *  load pays no CLI spawn. */
export declare const agentAccountStatusResponseSchema: z.ZodObject<{
    status: z.ZodObject<{
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
}, z.core.$strip>;
export type AgentAccountStatusResponse = z.infer<typeof agentAccountStatusResponseSchema>;
/**
 * `GET /api/v1/workspace/agent-profiles/:id/details` — who this account is signed in as.
 *
 * A SEPARATE, on-demand route rather than a field on the listing, and that is the whole point of
 * "hidden by default": if the listing carried an email, hiding it in the UI would be theatre — it
 * would already be in the response, the query cache and devtools. It is fetched only when the user
 * asks, is refused in hosted mode, and is never logged or persisted.
 *
 * `fields` is a labelled list rather than a fixed shape because what an agent knows about its own
 * login differs; inventing an empty "Organization" for one that has no such concept would be a
 * worse answer than omitting the row. `available: false` carries a `reason` in the user's terms.
 */
export declare const agentAccountDetailsResponseSchema: z.ZodObject<{
    available: z.ZodBoolean;
    reason: z.ZodOptional<z.ZodString>;
    fields: z.ZodArray<z.ZodObject<{
        label: z.ZodString;
        value: z.ZodString;
    }, z.core.$strip>>;
}, z.core.$strip>;
export type AgentAccountDetailsResponse = z.infer<typeof agentAccountDetailsResponseSchema>;
/**
 * `POST /api/v1/workspace/agent-profiles/:id/open` — hand one of this account's config files (or
 * the folder itself) to a local app.
 *
 * `file` is a catalog id from the account's own `files`, or `folder` for the config dir. `target`
 * is an `/api/v1/open-targets` id — an editor, or the file manager for `folder` — and omitted means
 * the OS default handler.
 *
 * Two target families are refused with a 400 rather than silently misbehaving: `terminal` for a
 * FILE (it would `cd` into it) and any `cli:<runner>` handoff (it would start an agent session
 * inside the config folder). An unknown/undetected target is a 400 too.
 */
export declare const openAgentAccountFileInputSchema: z.ZodObject<{
    file: z.ZodString;
    target: z.ZodOptional<z.ZodString>;
}, z.core.$strip>;
export type OpenAgentAccountFileInput = z.infer<typeof openAgentAccountFileInputSchema>;
/** `POST …/open` — what was opened, so the UI can say so rather than guess. */
export declare const openAgentAccountFileResponseSchema: z.ZodObject<{
    opened: z.ZodLiteral<true>;
    path: z.ZodString;
}, z.core.$strip>;
export type OpenAgentAccountFileResponse = z.infer<typeof openAgentAccountFileResponseSchema>;
/** `POST /api/v1/workspace/agent-profiles` — the id is allocated server-side from the label. */
export declare const createAgentProfileInputSchema: z.ZodObject<{
    provider: z.ZodEnum<{
        claude: "claude";
        codex: "codex";
        opencode: "opencode";
        pi: "pi";
    }>;
    label: z.ZodOptional<z.ZodString>;
    configDir: z.ZodString;
}, z.core.$strip>;
export type CreateAgentProfileInput = z.infer<typeof createAgentProfileInputSchema>;
/**
 * `POST` / `PATCH /api/v1/workspace/agent-profiles/:id` — the affected row.
 *
 * Answered WITHOUT waiting for a probe, like the listing: `status` is absent and the server kicks
 * the re-learn off behind the response, so adding an account does not block on a CLI spawn. The
 * pane's own request for that row joins the same in-flight probe rather than starting a second.
 */
export declare const agentProfileResponseSchema: z.ZodObject<{
    profile: z.ZodObject<{
        id: z.ZodString;
        provider: z.ZodEnum<{
            claude: "claude";
            codex: "codex";
            opencode: "opencode";
            pi: "pi";
        }>;
        label: z.ZodString;
        configDir: z.ZodString;
        path: z.ZodString;
        exists: z.ZodBoolean;
        looksValid: z.ZodBoolean;
        isDefault: z.ZodBoolean;
        status: z.ZodOptional<z.ZodObject<{
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
        files: z.ZodArray<z.ZodObject<{
            id: z.ZodString;
            label: z.ZodString;
            path: z.ZodString;
            exists: z.ZodBoolean;
        }, z.core.$strip>>;
    }, z.core.$strip>;
}, z.core.$strip>;
export type AgentProfileResponse = z.infer<typeof agentProfileResponseSchema>;
/** `PATCH /api/v1/workspace/agent-profiles/:id` — partial; absent keys stay untouched. */
export declare const updateAgentProfileInputSchema: z.ZodObject<{
    label: z.ZodOptional<z.ZodString>;
    configDir: z.ZodOptional<z.ZodString>;
}, z.core.$strip>;
export type UpdateAgentProfileInput = z.infer<typeof updateAgentProfileInputSchema>;
/** `DELETE /api/v1/workspace/agent-profiles/:id` — deregistration only; the directory is never
 *  touched. Projects that referenced it fall back to the discovered default. */
export declare const removeAgentProfileResponseSchema: z.ZodObject<{
    removed: z.ZodLiteral<true>;
    id: z.ZodString;
}, z.core.$strip>;
export type RemoveAgentProfileResponse = z.infer<typeof removeAgentProfileResponseSchema>;
