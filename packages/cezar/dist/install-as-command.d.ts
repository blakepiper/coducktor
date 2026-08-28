/** The pure half of `scripts/install-as-command.mjs` (spec 013).
 *
 *  `npm run install-as-command` builds this checkout and puts a global
 *  `cezar`/`cez`/`cezar-cli` command on PATH pointing at THIS working tree —
 *  the local-dev equivalent of `npx cezar-cli`, with no publish. This module
 *  owns the *decisions* (which npm command runs, where the shims land) so they
 *  are unit-testable; the `.mjs` script owns the spawning and exit codes.
 *  Kept dependency-free and side-effect-free (mirrors `pack-check.ts`).
 */
/** Scoped package name — both install flavors register globally under it, so
 *  uninstall is a single `npm rm --global` of this name regardless of flavor. */
export declare const PACKAGE_NAME = "@open-mercato/cezar";
/** Every bin the main package installs. `cezar-cli` is added (spec 013) so a
 *  single link / global-install exposes the same name as `npx cezar-cli`. */
export declare const BIN_NAMES: readonly ['cezar', 'cez', 'cezar-cli'];
export type InstallMode = 'link' | 'global' | 'uninstall';
/** One npm invocation: `args` are passed straight to npm (no shell). */
export interface NpmStep {
    args: string[];
    label: string;
}
export interface InstallPlan {
    /** Run `npm run build` before the npm steps (link/global need a fresh dist). */
    build: boolean;
    steps: NpmStep[];
}
/** Decide the build + npm steps for a mode. `build` defaults to true for the
 *  install flavors and is forced false for uninstall (nothing to rebuild). */
export declare function planInstall(opts: {
    mode: InstallMode;
    build?: boolean;
}): InstallPlan;
/** Expected shim paths for all three bins under an `npm prefix -g` value.
 *  npm drops POSIX shims in `<prefix>/bin/<name>` and Windows shims directly in
 *  `<prefix>\<name>.cmd`. `platform` is passed in (not read from `process`) so
 *  the mapping is deterministic and testable for either OS. */
export declare function globalShimPaths(prefix: string, platform?: NodeJS.Platform): string[];
/** The directory the shims live in (for the post-install PATH hint). */
export declare function globalBinDir(prefix: string, platform?: NodeJS.Platform): string;
