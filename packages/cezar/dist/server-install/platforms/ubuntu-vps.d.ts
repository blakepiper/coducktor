import { type InstallContext, type PlatformStrategy } from '../types.ts';
/**
 * Name of the process listening on `port`, or null when nothing is. Best effort
 * (`ss` output varies, and without root the process name may be hidden) — used
 * only to make a port collision explainable, never to gate the install.
 */
export declare function portListener(ctx: InstallContext, port: number): Promise<string | null>;
/** The interface the cockpit listens on — loopback unless an external-proxy
 *  install bound it somewhere the proxy can reach (e.g. the docker bridge). */
export declare function upstreamHost(ctx: InstallContext): string;
/**
 * The nginx server block: auth_basic identity + SSE-safe proxy to loopback.
 * `serverName` defaults to the catch-all `_`; the SSL step rewrites it to the
 * real domain so the `certbot --nginx` plugin can find this vhost to edit.
 */
export declare function nginxVhost(port: number, serverName?: string, htpasswd?: string): string;
/**
 * systemd unit that runs cezar loopback-bound with CEZ_REMOTE=1.
 *
 * `execStart` must be an ABSOLUTE command — systemd resolves the ExecStart
 * executable against its OWN compiled-in PATH (/usr/local/bin:/usr/bin:…), NOT
 * the unit's `Environment=PATH`, so a bare `cezar` gives status=203/EXEC
 * ("Unable to locate executable"). `resolveExecStart` therefore returns an
 * absolute `"<node> <entry.js>"`. We still set `Environment=PATH` (with the
 * installer's node dir) for any child process the app spawns.
 */
export declare function systemdUnit(repoRoot: string, port: number, scope: 'user' | 'system', execStart: string, bindHost?: string): string;
/**
 * Decide the absolute ExecStart command for the service, mirroring how the
 * installer itself was launched so the box keeps running the same cezar:
 *
 *  - Launched via `npx <alias>` (the CLI package lives in npm's ephemeral
 *    `_npx` cache, which gets cleaned): the service can't point there, so it
 *    reinstalls-and-runs the same way — `<abs npx> --yes cezar-cli` (bare `npx`
 *    would 203/EXEC, so npx is made absolute).
 *  - A stable install (a checkout, or a global `cezar-cli`/`cezar`): run the
 *    CLI's own built entry `<node> <pkg>/dist/index.js`, or a resolved global
 *    bin. Absolute node + absolute script → systemd never resolves off PATH.
 */
export declare function serviceExecStart(opts: {
    node: string;
    pkgRoot: string;
    entry: string;
    entryExists: boolean;
    npxPath: string;
    globalBin?: string;
}): string;
/** True when a systemd `ExecStart` string launches cezar via npx (the unpinned
 *  `npx --yes cezar-cli` form) rather than a checkout (`<node> …/dist/index.js`)
 *  or a global bin. */
export declare function isNpxExecStart(execStart: string): boolean;
/**
 * The npx trap (#696): `npx --yes cezar-cli` caches the resolved package under
 * `~/.npm/_npx/<hash>` and reuses it forever — a service restart re-execs the
 * SAME cached build, so `server-deploy` would never actually update. Before
 * restarting an npx-based unit we delete the cache entries that contain
 * `cezar-cli`, so the next launch re-resolves `latest`. Surgical: other npx
 * packages' caches are left untouched. A checkout / global-bin unit has no
 * npx cache to clear and is skipped (its restart picks up the new build/global
 * directly).
 */
export declare function refreshNpxCacheForRedeploy(ctx: InstallContext, execStart: string): void;
export declare const ubuntuVps: PlatformStrategy;
