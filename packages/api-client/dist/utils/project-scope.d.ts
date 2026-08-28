/**
 * Where a request goes: which API version, and which project's copy of it.
 *
 * Callers name a ROUTE (`/runs/123/diff`), never a URL. This module turns that into the real
 * path — `/api/v1/runs/123/diff`, or `/api/v1/p/<id>/runs/123/diff` when a project scope is
 * active — which is what makes the version a single fact in the codebase rather than a prefix
 * spelled at sixty call sites. A `v2` is one edit here.
 *
 * The scope itself is module-level rather than context-threaded on purpose: the API client
 * (client.ts) is a module of plain functions and its private `send()` is the single choke point
 * every request funnels through — threading a React context down into it would mean turning
 * every exported call into a hook. Instead the ProjectScopeProvider (project-scope-context.tsx)
 * writes the scope here as it mounts/changes, and the client reads it per request. One provider
 * per app (it wraps the routed tree), so there is exactly one writer.
 */
/**
 * The version prefix every request carries.
 *
 * The service used to answer on an unversioned `/api/*` as well; that surface was removed once
 * the whole API was reachable under `/api/v1` (BACKWARD_COMPATIBILITY.md §2). Nothing should
 * reintroduce a bare `/api/...` fetch — it will 404.
 */
export declare const API_PREFIX = "/api/v1";
/** Set the service origin. `''` (the default) means "same origin as this page". */
export declare function setApiBaseUrl(url: string): void;
export declare function getApiBaseUrl(): string;
/** Written by ProjectScopeProvider on mount/param change (and cleared on unmount). Everything
 *  else only reads. */
export declare function setApiScope(projectId: string | null): void;
export declare function getApiScope(): string | null;
/** The scoped API base — what the context carries and what deep links embed. */
export declare function apiBase(): string;
/**
 * The leading TanStack Query key segment (queries.ts prepends this to every key so caches never
 * bleed across projects). `'default'` when unscoped — a stable sentinel, and also the server's
 * reserved alias for the boot project, so the segment always *names* the project the data
 * belongs to. A registered project id can never collide with it: `'default'` is a reserved slug
 * server-side.
 */
export declare function queryScope(): string;
/**
 * Turn a ROUTE into the request path: `/runs` → `/api/v1/runs`, or `/api/v1/p/<id>/runs` when a
 * project scope is active. Workspace-level routes (above) answer for the whole workspace and
 * never take the scope.
 *
 * Every caller passes a route, never a URL — that is what keeps the version in one place.
 * A URL that arrived from the server goes through `resolveApiUrl` instead.
 *
 * Applied at request time (send(), the EventSources), never stored.
 */
export declare function apiPath(route: string): string;
/**
 * Resolve a URL the SERVER minted into one this client can fetch today.
 *
 * Run transcripts persist absolute image URLs (`/api/runs/<id>/images/…`) into NDJSON and keep
 * them forever, so the cockpit renders URLs written by every version that ever ran in a repo.
 * Two things therefore have to happen at render time rather than at write time:
 *
 * - **Upgrade.** A URL stored before the API was versioned is rewritten onto `/api/v1`. This is
 *   the migration path for existing transcripts; without it every historical screenshot 404s
 *   the moment the unversioned surface is gone.
 * - **Re-scope.** Transcripts store the unscoped spelling, so the active project's prefix is
 *   applied on use, which keeps one stored URL valid under every project.
 *
 * Anything that is not a cockpit API URL — a `/raw/...` asset, a `https://github.com/...` link,
 * a `data:` URI — is returned untouched. It is not ours to rewrite.
 */
export declare function resolveApiUrl(url: string): string;
