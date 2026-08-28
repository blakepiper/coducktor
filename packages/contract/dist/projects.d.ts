import { z } from 'zod';
/**
 * The project-registry family: `GET/POST/PATCH/DELETE /api/v1/projects`, the folder picker
 * (`GET /api/v1/fs/browse`) that feeds it, and the launch-key read.
 *
 * Node-free by construction (see README rule 1) — `zod` and nothing else.
 */
/**
 * One `GET /api/v1/projects` registry entry (multi-project spec, step 1.6).
 *
 * Unlike health's id+name pairs this carries the absolute `root`: the registry routes are
 * same-origin, the CORS-open health route is not, and that difference is the reason the two
 * project shapes are deliberately NOT the same type.
 *
 * Deliberately a CLOSED object even though the server's persistence schema
 * (`src/workspace/config.ts`, `workspaceProjectSchema.passthrough()`) keeps unknown keys in the
 * file: passthrough is a durability promise about `~/.cezar/config.json`, not a promise that the
 * API answers arbitrary keys. Modelling it as a loose object here would also be unprovable — see
 * the note on the index signature in `src/server/contract-parity.workspace.test.ts`.
 */
export declare const projectListEntrySchema: z.ZodObject<{
    id: z.ZodString;
    name: z.ZodString;
    root: z.ZodString;
    addedAt: z.ZodString;
    lastOpenedAt: z.ZodString;
    source: z.ZodEnum<{
        checkout: "checkout";
        local: "local";
    }>;
    status: z.ZodEnum<{
        missing: "missing";
        "not-git": "not-git";
        ok: "ok";
    }>;
    branch: z.ZodOptional<z.ZodString>;
    forge: z.ZodOptional<z.ZodLiteral<"github">>;
    repoUrl: z.ZodOptional<z.ZodString>;
    maxParallel: z.ZodOptional<z.ZodNumber>;
    tags: z.ZodOptional<z.ZodArray<z.ZodString>>;
}, z.core.$strip>;
export type ProjectListEntry = z.infer<typeof projectListEntrySchema>;
/** `GET /api/v1/projects` — the workspace registry. Workspace-level: never 404s, never scoped.
 *  An unreadable workspace degrades to `projects: []` plus the default `projectsDir`, so all
 *  three keys are always present. */
export declare const projectsResponseSchema: z.ZodObject<{
    projects: z.ZodArray<z.ZodObject<{
        id: z.ZodString;
        name: z.ZodString;
        root: z.ZodString;
        addedAt: z.ZodString;
        lastOpenedAt: z.ZodString;
        source: z.ZodEnum<{
            checkout: "checkout";
            local: "local";
        }>;
        status: z.ZodEnum<{
            missing: "missing";
            "not-git": "not-git";
            ok: "ok";
        }>;
        branch: z.ZodOptional<z.ZodString>;
        forge: z.ZodOptional<z.ZodLiteral<"github">>;
        repoUrl: z.ZodOptional<z.ZodString>;
        maxParallel: z.ZodOptional<z.ZodNumber>;
        tags: z.ZodOptional<z.ZodArray<z.ZodString>>;
    }, z.core.$strip>>;
    bootProject: z.ZodString;
    projectsDir: z.ZodString;
}, z.core.$strip>;
export type ProjectsResponse = z.infer<typeof projectsResponseSchema>;
/**
 * `POST /api/v1/projects` (multi-project spec, step 4.2) — what the folder-browser dialog gets
 * back. `error` is present ONLY on the 409 (already registered), where `project` is the EXISTING
 * entry: the dialog navigates to it rather than dead-ending on a duplicate.
 */
export declare const registerProjectResponseSchema: z.ZodObject<{
    project: z.ZodObject<{
        id: z.ZodString;
        name: z.ZodString;
        root: z.ZodString;
        addedAt: z.ZodString;
        lastOpenedAt: z.ZodString;
        source: z.ZodEnum<{
            checkout: "checkout";
            local: "local";
        }>;
        status: z.ZodEnum<{
            missing: "missing";
            "not-git": "not-git";
            ok: "ok";
        }>;
        branch: z.ZodOptional<z.ZodString>;
        forge: z.ZodOptional<z.ZodLiteral<"github">>;
        repoUrl: z.ZodOptional<z.ZodString>;
        maxParallel: z.ZodOptional<z.ZodNumber>;
        tags: z.ZodOptional<z.ZodArray<z.ZodString>>;
    }, z.core.$strip>;
    error: z.ZodOptional<z.ZodString>;
}, z.core.$strip>;
export type RegisterProjectResponse = z.infer<typeof registerProjectResponseSchema>;
/**
 * `DELETE /api/v1/projects/:projectId` (multi-project spec, step 4.4) — Settings → Projects'
 * per-row Remove. Deregistration ONLY: the server never touches anything under the project root,
 * so this is a registry edit and nothing else. The interesting failures are 409s (the project has
 * running tasks, or it is the project this server booted in), whose `{ error }` the pane shows
 * verbatim.
 */
export declare const removeProjectResponseSchema: z.ZodObject<{
    removed: z.ZodLiteral<true>;
    id: z.ZodString;
}, z.core.$strip>;
export type RemoveProjectResponse = z.infer<typeof removeProjectResponseSchema>;
/** `PATCH /api/v1/projects/:projectId` — the updated entry, the same shape `GET /api/v1/projects`
 *  attaches (the handler re-probes `status`/`branch` so one project has one shape). */
export declare const updateProjectResponseSchema: z.ZodObject<{
    project: z.ZodObject<{
        id: z.ZodString;
        name: z.ZodString;
        root: z.ZodString;
        addedAt: z.ZodString;
        lastOpenedAt: z.ZodString;
        source: z.ZodEnum<{
            checkout: "checkout";
            local: "local";
        }>;
        status: z.ZodEnum<{
            missing: "missing";
            "not-git": "not-git";
            ok: "ok";
        }>;
        branch: z.ZodOptional<z.ZodString>;
        forge: z.ZodOptional<z.ZodLiteral<"github">>;
        repoUrl: z.ZodOptional<z.ZodString>;
        maxParallel: z.ZodOptional<z.ZodNumber>;
        tags: z.ZodOptional<z.ZodArray<z.ZodString>>;
    }, z.core.$strip>;
}, z.core.$strip>;
export type UpdateProjectResponse = z.infer<typeof updateProjectResponseSchema>;
/** Bounds for one tag and for a project's tag list. Named because three places must agree: this
 *  schema, the registry schema that must never `.catch` away a value this accepts
 *  (`workspaceProjectSchema` in the service), and the settings editor that refuses input early. */
export declare const PROJECT_TAG_MAX_LENGTH = 32;
export declare const PROJECT_TAGS_MAX = 20;
/**
 * `PATCH /api/v1/projects/:projectId` body — the two per-project registry fields the cockpit
 * edits. Each key is optional and a body may carry either or both: a PATCH names the fields it
 * changes, and an absent key must stay distinguishable from one set to `null` (which CLEARS). A
 * `{ maxParallel }`-only body — every pre-tags client sends exactly that — therefore still means
 * what it always did. An EMPTY body is still refused, as it was before tags existed: a request
 * that names no field is a mistake, and answering 200 to it would report a change that never
 * happened (and cost a full config rewrite to do nothing).
 *
 * - `maxParallel` (spec 2026-07-22-per-project-concurrency): `null` clears the override back to
 *   "inherit the workspace cap"; an integer `1..16` pins it. The bounds mirror
 *   `workspaceProjectSchema` exactly, so a value this schema accepts can never be degraded away
 *   by the next load's `.catch`.
 * - `tags`: the whole list, replaced wholesale — there is no add-one/remove-one spelling,
 *   because the editor always knows the full set and a merge protocol would only add a way for
 *   two tabs to disagree. `null` and `[]` both clear it; the server normalizes before storing.
 *
 * Deliberately NOT where the agent-account selection lives — that is
 * `PUT /api/v1/workspace/agent-profiles/selection`, stored beside the accounts it names.
 */
export declare const updateProjectInputSchema: z.ZodObject<{
    maxParallel: z.ZodOptional<z.ZodNullable<z.ZodNumber>>;
    tags: z.ZodOptional<z.ZodNullable<z.ZodArray<z.ZodString>>>;
}, z.core.$strip>;
export type UpdateProjectInput = z.infer<typeof updateProjectInputSchema>;
/**
 * `POST /api/v1/projects/checkout` (multi-project spec, step 4.3) — the clone-from-GitHub body.
 * `name` defaults server-side to the repo name; `checkoutId` is the cockpit's own correlation
 * token, echoed on every `checkout-progress` event so two tabs cloning at once never render each
 * other's progress.
 */
export declare const checkoutProjectInputSchema: z.ZodObject<{
    url: z.ZodString;
    name: z.ZodOptional<z.ZodString>;
    checkoutId: z.ZodOptional<z.ZodString>;
}, z.core.$strip>;
export type CheckoutProjectInput = z.infer<typeof checkoutProjectInputSchema>;
/** One directory in a `GET /api/v1/fs/browse` listing (multi-project spec, step 4.1). `path` is
 *  absolute — same-origin route, like `ProjectListEntry.root`. */
export declare const fsBrowseDirSchema: z.ZodObject<{
    name: z.ZodString;
    path: z.ZodString;
    isRepo: z.ZodBoolean;
}, z.core.$strip>;
export type FsBrowseDir = z.infer<typeof fsBrowseDirSchema>;
/** `GET /api/v1/fs/browse?path=` — the folder picker's listing. Rooted at the independently
 *  configured browse root, directories only. */
export declare const fsBrowseResponseSchema: z.ZodObject<{
    path: z.ZodString;
    parent: z.ZodNullable<z.ZodString>;
    dirs: z.ZodArray<z.ZodObject<{
        name: z.ZodString;
        path: z.ZodString;
        isRepo: z.ZodBoolean;
    }, z.core.$strip>>;
    truncated: z.ZodBoolean;
}, z.core.$strip>;
export type FsBrowseResponse = z.infer<typeof fsBrowseResponseSchema>;
/** `GET /api/v1/launch-key` — the bookmarklet auto-start secret (spec 011). Fetched to COMPARE
 *  against the `?key=` query param and to bake into the `javascript:` links the Settings → Skills
 *  bookmarklet panel generates. The value never renders as text, never logs, and never goes back
 *  into the address bar. */
export declare const launchKeyResponseSchema: z.ZodObject<{
    key: z.ZodString;
}, z.core.$strip>;
export type LaunchKeyResponse = z.infer<typeof launchKeyResponseSchema>;
