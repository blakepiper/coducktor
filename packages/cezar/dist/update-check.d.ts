/**
 * Update discovery (#368): a best-effort, fire-and-forget check against the
 * npm registry so the cockpit can tell the user a newer cezar exists — the
 * root cause behind most "bug already fixed" reports is `npx` happily reusing
 * a stale cached version forever. Silent on any failure: offline, slow
 * registry or a weird payload must never affect startup.
 */
/** Newest published version when it's newer than `current`, else null. */
export declare function checkForUpdate(pkgName: string, current: string): Promise<string | null>;
/** Plain numeric semver compare (`1.2.10` > `1.2.9`); pre-release tags and
 *  anything unparseable compare as 0 — good enough for release-only publishes. */
export declare function isNewerVersion(candidate: string, current: string): boolean;
