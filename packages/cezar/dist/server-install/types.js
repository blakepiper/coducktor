import { z } from 'zod';
/**
 * Contracts for the server installer (spec 2026-07-16-server-installer).
 * The engine closes over `InstallStep` / `PlatformStrategy` and never learns
 * what a step *does* — only `check` / `run` / `undo`. That seam is what makes
 * "use ubuntu as a selector and run it that way" a registry lookup, and what
 * makes the interactive helpers reusable across every future platform.
 */
/** The platforms the registry knows. Extend here + add a strategy file. */
export const PLATFORM_IDS = ['ubuntu-vps', 'macosx-ngrok'];
/** Per-step lifecycle. `failed` resumes identically to `pending`. */
export const STEP_STATUSES = ['pending', 'done', 'skipped', 'failed'];
/**
 * One thing a step created, tagged by who owns its removal:
 *  - `owned`  — cezar authored it and nothing else uses it → uninstall removes it.
 *  - `shared` — a system tool the operator may now depend on (gh, agent CLIs,
 *    certbot + its renewal timer, the cert itself) → uninstall lists it with a
 *    manual removal hint instead of yanking it.
 */
export const stepArtifactSchema = z.object({
    kind: z.enum(['owned', 'shared']),
    /** file | package | service | cert | htpasswd | config | note */
    type: z.string().min(1),
    /** Filesystem path for `owned` files (vhost, unit, htpasswd). */
    path: z.string().optional(),
    /** Human name: package id, unit name, cert domain, auth user. */
    name: z.string().optional(),
    /** `system` | `user` for services. */
    scope: z.string().optional(),
    /** For `shared` artifacts: the exact command the operator can run to remove it. */
    removeHint: z.string().optional(),
});
/** What a step returns from `run()`; `undo()` receives it back verbatim. */
export const stepCreatedSchema = z
    .object({ artifacts: z.array(stepArtifactSchema).default([]) })
    .nullable();
/**
 * Persisted per-step outcome — the `steps` map in `server.json`. A status this
 * version doesn't know (written by a newer cezar) degrades to `failed`, which
 * keeps the record AND keeps it on uninstall's undo path — never to a parse
 * failure that would discard the whole ledger.
 */
export const stepOutcomeSchema = z.object({
    status: z.enum(STEP_STATUSES).catch('failed'),
    created: stepCreatedSchema.optional().catch(null),
});
/**
 * `~/.cezar/server.json` — host-level, install-once. Additive-safe: every new
 * field is optional / defaulted so an older cezar still parses a newer file
 * (BACKWARD_COMPATIBILITY cross-version-state rule). No secrets live here.
 */
export const serverStateSchema = z
    .object({
    schema: z.literal(1).catch(1),
    /**
     * Free string, not an enum: a `server.json` written by a newer cezar with a
     * platform this version doesn't ship must still parse — the registry lookup
     * is where "unknown platform" is decided, with the ledger intact.
     */
    platform: z.string().min(1).optional().catch(undefined),
    /**
     * Instance id (slug) this record belongs to — `default` for the original
     * single-cockpit host, or a domain-derived slug for a named instance under
     * `~/.cezar/server-instances/`. Self-describing so tooling can list what a
     * host runs without re-deriving it from the filename.
     */
    instance: z.string().min(1).optional().catch(undefined),
    /** Public domain this instance answers on (drives nginx `server_name` +
     * the SSL cert). Absent for a plain HTTP / default install. */
    domain: z.string().optional().catch(undefined),
    /**
     * External-reverse-proxy mode (`--external-proxy`): the box already has a
     * front (Dokploy/Traefik, Coolify, Caddy, an existing nginx) that owns
     * :80/:443 and provides TLS + auth. cezar then installs NO nginx and NO
     * cert of its own — just the service — and that proxy routes to `bindHost`.
     */
    externalProxy: z.boolean().optional().catch(undefined),
    /**
     * Interface the cockpit binds. Loopback by default; an external-proxy
     * install may need a host the proxy can actually reach (e.g. the docker
     * bridge `172.17.0.1` when the proxy runs in a container).
     */
    bindHost: z.string().optional().catch(undefined),
    /** Flips true only when every required step is `done`. */
    installed: z.boolean().default(false).catch(false),
    /** True when this record was written by a CEZ_DRY_RUN preview — a real
     * install/uninstall treats it as no record at all (self-healing). */
    dryRun: z.boolean().optional().catch(undefined),
    /** ISO stamp set by the caller (Date.now is unavailable in some contexts). */
    createdAt: z.string().optional().catch(undefined),
    updatedAt: z.string().optional().catch(undefined),
    primaryPort: z.number().int().positive().default(4321).catch(4321),
    /** Public URL / identity user surfaced at the end — display only. */
    publicUrl: z.string().optional().catch(undefined),
    /** macOS+ngrok free tier: the tunnel URL changes across restarts. */
    ephemeral: z.boolean().optional().catch(undefined),
    // A single malformed entry degrades to a `failed` record (undo still runs
    // from constants), never to losing every other step's ledger.
    steps: z
        .record(z.string(), stepOutcomeSchema.catch({ status: 'failed', created: null }))
        .default({})
        .catch({}),
})
    // Unknown top-level fields written by a newer cezar survive a load+save
    // round-trip — the file's own additive-safe contract.
    .passthrough();
/** Freshly-initialized state (no install yet). */
export function freshServerState() {
    return serverStateSchema.parse({});
}
/**
 * The interactive surface a step talks to. Implemented by `ui.ts` over
 * `@clack/prompts`; declared here as a pure interface so `types.ts` (and the
 * engine) never import the TUI library. Prompt methods resolve to the
 * `CANCEL` sentinel instead of throwing when the user aborts.
 */
export const CANCEL = Symbol('cezar.ui.cancel');
/** Thrown by `preflight` to stop with a clean, user-facing reason (no stack). */
export class PreflightError extends Error {
}
//# sourceMappingURL=types.js.map