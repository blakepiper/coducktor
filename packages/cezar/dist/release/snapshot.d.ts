/** Snapshot release decisions — the pure half of `scripts/release-snapshot.mjs`.
 *
 *  Spec `.ai/specs/2026-07-18-npm-preview-publish.md` (#482): every green CI run
 *  publishes an installable preview of the CLI. This module decides *whether* a
 *  given CI event publishes, under *which* version and dist-tag, and how the two
 *  manifests (the scoped package and its unscoped alias) are stamped. Kept
 *  dependency-free and side-effect-free so the decision is unit-testable; the
 *  script owns file writes, `npm publish`, and the exit code.
 *
 *  Deliberately name-agnostic: package names come from the checked-out manifests
 *  at call time, never from constants — so the `@pat-lewczuk/cezar` →
 *  `@open-mercato/cezar` rename (PR #501) lands independently of this pipeline.
 */
import { type ReleaseManifests as ReleaseManifestSet } from './manifests.ts';
/** The CI facts the decision needs, straight from GitHub Actions' env/event. */
export interface SnapshotContext {
    /** `GITHUB_EVENT_NAME` — `pull_request` and `push` publish previews; `schedule`
     *  and `workflow_dispatch` publish only the explicitly requested nightly. */
    eventName: string;
    /** `GITHUB_REF_NAME` for push events — only `develop` publishes a snapshot;
     *  `main` is reserved for owner-driven stable releases (see stable.ts) and for
     *  the nightly channel below, which never moves `latest` either. */
    refName: string;
    /** `CEZ_RELEASE_CHANNEL` — a channel asked for by name rather than derived from
     *  the event. Only `.github/workflows/nightly.yml` sets it (to `nightly`); every
     *  other caller leaves it empty and gets the event-derived channel. Opt-in by
     *  name is what keeps a `workflow_dispatch` of ci.yml from cutting a nightly by
     *  accident — the event alone is not enough. */
    requestedChannel?: string;
    /** `YYYYMMDD` (UTC) of the day a nightly is cut — the nightly version is named
     *  after its date. Required for the nightly channel, ignored by every other. */
    nightlyDate?: string;
    /** PR number for pull_request events; absent/invalid → no publish. */
    prNumber?: number;
    /** `owner/name` of the PR head repo — fork PRs (≠ `repo`) never publish. */
    headRepo?: string;
    /** `GITHUB_REPOSITORY` — this repo's `owner/name`. */
    repo?: string;
    /** The base version from the root `package.json` (e.g. `0.1.5`). */
    baseVersion: string;
    /** `GITHUB_RUN_NUMBER` — monotonic per workflow; makes versions unique. */
    runNumber: number;
    /** `GITHUB_RUN_ATTEMPT` — appended only when > 1 so re-runs never collide. */
    runAttempt?: number;
}
/** A publishable snapshot: prerelease version + the explicit dist-tag.
 *  The dist-tag is structurally never `latest` — snapshots must not become the
 *  default install; stable releases stay owner-driven (spec, resolved Q2). */
export interface SnapshotPlan {
    channel: string;
    version: string;
    distTag: string;
}
export declare function computeSnapshot(ctx: SnapshotContext): SnapshotPlan | null;
export type { ManifestLike, ReleaseManifests } from './manifests.ts';
/** Stamp the release set to the snapshot version.
 *
 *  Every intra-release dependency is pinned **exact** (`0.1.5-pr482.123`, no range) so
 *  `npx <alias>@<version>` runs exactly the PR's code and the service resolves exactly the
 *  api-client it was cut with — a `^` range would resolve to whatever newer version exists
 *  (spec, resolved Q5). Stable releases keep their `^` range and never go through this
 *  stamper. */
export declare function stampManifests(manifests: ReleaseManifestSet, version: string): ReleaseManifestSet;
/** The copy-pasteable commands for the sticky PR comment and the step summary.
 *  Rendered from the *actual* alias package name so a future rename of the npx
 *  command can never leave stale instructions (spec, resolved Q1). */
export declare function buildInstallLines(aliasName: string, version: string): string[];
