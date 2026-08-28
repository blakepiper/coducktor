import { z } from 'zod';
import type { DraftPrInput, DraftPrOutcome, ForgeAvailability, ForgeComment, ForgeCommentsData, ForgeDriver, ForgeItem, ForgePrMergeState, ForgePrDiffResult, ForgeTimelineEvent, ForgeTimelineEventKind } from './types.ts';
export declare const GH_PR_DIFF_FILE_CAP = 300;
export declare const GH_PR_PATCH_CAP: number;
export declare const GH_PR_DIFF_JSON_CAP: number;
export declare class GithubPrNotFoundError extends Error {
}
export type PrFilesPageRunner = (page: number) => Promise<string>;
/** Fetch no more than the three GitHub pages represented by the public 300-file response cap. */
export declare function fetchPrFilePages(runPage: PrFilesPageRunner): Promise<unknown[]>;
export declare function fetchGithubPrDiff(repoRoot: string, number: number, refresh?: boolean): Promise<ForgePrDiffResult>;
/** One GitHub issue or pull request, flattened for the cockpit's GitHub tab. */
export type GithubItem = ForgeItem;
export interface GithubData {
    available: boolean;
    /** Human-readable hint when unavailable (`gh` missing, no remote, offline…). */
    reason?: string;
    /** owner/name, when known. */
    repo?: string;
    syncedAt?: string;
    issues: GithubItem[];
    prs: GithubItem[];
    /** Repo-wide map of label name → 6-hex color (no `#`), so the UI can tint chips like GitHub
     *  does. Additive (BACKWARD_COMPATIBILITY): absent on old payloads, chips fall back to neutral. */
    labelColors?: Record<string, string>;
}
export declare const ghCheckRunSchema: z.ZodObject<{
    state: z.ZodOptional<z.ZodNullable<z.ZodString>>;
    status: z.ZodOptional<z.ZodNullable<z.ZodString>>;
    conclusion: z.ZodOptional<z.ZodNullable<z.ZodString>>;
}, z.core.$strip>;
declare const ghStatusCheckRollup: z.ZodOptional<z.ZodNullable<z.ZodArray<z.ZodObject<{
    state: z.ZodOptional<z.ZodNullable<z.ZodString>>;
    status: z.ZodOptional<z.ZodNullable<z.ZodString>>;
    conclusion: z.ZodOptional<z.ZodNullable<z.ZodString>>;
}, z.core.$strip>>>>;
/** Exported for unit tests (#400) — collapses a zod-validated `statusCheckRollup` array down to
 *  the single enum the GitHub tab (list rows + detail badge) renders. */
export declare function rollupToChecks(rollup: z.infer<typeof ghStatusCheckRollup>): GithubItem['checks'];
/** Runs a GraphQL query with String variables — injected so pagination is unit-testable
 *  without shelling to `gh`. */
export type GraphqlRunner = (query: string, variables: Record<string, string>) => Promise<string>;
/** GraphQL's max page size; pagination is capped at 10 pages/kind (1000 rows — the GUI's full
 *  background shot). Rows past the window keep `comments: 0`, which the UI reads as "no badge". */
export declare const GH_COUNTS_MAX_PAGES = 10;
/** Validate + flatten one gh GraphQL counts response into a `number → count` map plus the page
 *  cursor. Exported for unit tests (the zod boundary + shape). Throws on a malformed envelope. */
export declare function parseCountsPage(out: string, root: 'issues' | 'pullRequests'): {
    counts: Record<number, number>;
    hasNextPage: boolean;
    endCursor: string | null;
};
/** Comment counts for open issues and PRs as `number → count` maps. Two independent paginated
 *  queries (issues and PRs need separate cursors) run in parallel; any failure degrades the whole
 *  thing to empty maps so the tab is never held up by counts. Exported for unit tests. */
export declare function fetchCommentCounts(runGraphql: GraphqlRunner, owner: string, name: string, maxPages?: number): Promise<{
    issues: Record<number, number>;
    prs: Record<number, number>;
}>;
/** `owner/name` → `{ owner, name }`, or null when the handle isn't a clean two-part slug. */
export declare function parseOwnerName(nameWithOwner: string): {
    owner: string;
    name: string;
} | null;
export declare const GH_MAX_LIMIT = 1000;
export declare function fetchGithub(repoRoot: string, refresh?: boolean, limit?: number): Promise<GithubData>;
/** The event kinds rendered in v1 — an allowlist, so a new GitHub event type is dropped rather
 *  than rendered and can never crash or clutter the thread. Real timelines carry plenty that
 *  github.com itself doesn't surface (`subscribed`, `mentioned`, `review_requested`).
 *
 *  `reviewed` is deliberately absent: timeline `reviewed` rows DO carry a body and would work,
 *  but `/pulls/{n}/reviews` is already normalized, chipped and empty-body-filtered, so sourcing
 *  both would render every review twice. */
export declare const TIMELINE_EVENT_KINDS: Set<ForgeTimelineEventKind>;
/** Events get their OWN cap, independent of `THREAD_ENTRY_CAP`. A combined cap would mean a
 *  thread with 150 comments and 100 events returns ~120 comments — silently removing contents
 *  from a §2-protected response. */
export declare const TIMELINE_EVENT_CAP = 200;
/** `gh api --paginate` has no page limit, so the timeline fetch hand-rolls a bounded loop. */
export declare const TIMELINE_MAX_PAGES = 10;
/** ONE budget shared by every page. `gh()`'s timeout is per invocation, so ten pages at the 15 s
 *  default would put the ceiling at 150 s — an order of magnitude worse than the single
 *  `--paginate` spawn this replaces. The loop tracks a deadline and passes what's left. */
export declare const TIMELINE_BUDGET_MS = 15000;
/** Never spawn a page that cannot finish. A bare `remaining <= 0` guard catches only the exact
 *  boundary; the realistic case is 300 ms left, which spawns `gh` with a 300 ms timeout, throws,
 *  and is indistinguishable from a real endpoint failure. */
export declare const TIMELINE_MIN_PAGE_MS = 2000;
/** One timeline row. `event` stays a loose `z.string()` so unknown kinds parse and are dropped by
 *  the allowlist rather than throwing the whole page. Extras are stripped by default — notably
 *  `author.email`, which is read for nothing and must not reach the wire type. */
export declare const ghTimelineEventSchema: z.ZodObject<{
    event: z.ZodString;
    id: z.ZodOptional<z.ZodNullable<z.ZodNumber>>;
    node_id: z.ZodOptional<z.ZodNullable<z.ZodString>>;
    created_at: z.ZodOptional<z.ZodNullable<z.ZodString>>;
    actor: z.ZodOptional<z.ZodNullable<z.ZodObject<{
        login: z.ZodString;
        avatar_url: z.ZodOptional<z.ZodNullable<z.ZodString>>;
    }, z.core.$strip>>>;
    url: z.ZodOptional<z.ZodNullable<z.ZodString>>;
    html_url: z.ZodOptional<z.ZodNullable<z.ZodString>>;
    sha: z.ZodOptional<z.ZodNullable<z.ZodString>>;
    message: z.ZodOptional<z.ZodNullable<z.ZodString>>;
    author: z.ZodOptional<z.ZodNullable<z.ZodObject<{
        name: z.ZodOptional<z.ZodNullable<z.ZodString>>;
        date: z.ZodOptional<z.ZodNullable<z.ZodString>>;
    }, z.core.$strip>>>;
    label: z.ZodOptional<z.ZodNullable<z.ZodObject<{
        name: z.ZodString;
        color: z.ZodOptional<z.ZodNullable<z.ZodString>>;
    }, z.core.$strip>>>;
    assignee: z.ZodOptional<z.ZodNullable<z.ZodObject<{
        login: z.ZodString;
    }, z.core.$strip>>>;
    rename: z.ZodOptional<z.ZodNullable<z.ZodObject<{
        from: z.ZodOptional<z.ZodNullable<z.ZodString>>;
        to: z.ZodOptional<z.ZodNullable<z.ZodString>>;
    }, z.core.$strip>>>;
    source: z.ZodOptional<z.ZodNullable<z.ZodObject<{
        issue: z.ZodOptional<z.ZodNullable<z.ZodObject<{
            number: z.ZodOptional<z.ZodNullable<z.ZodNumber>>;
            title: z.ZodOptional<z.ZodNullable<z.ZodString>>;
            html_url: z.ZodOptional<z.ZodNullable<z.ZodString>>;
            pull_request: z.ZodOptional<z.ZodNullable<z.ZodUnknown>>;
        }, z.core.$strip>>>;
    }, z.core.$strip>>>;
}, z.core.$strip>;
/** First 200 thread entries, then `truncated`; each body sliced to 8 000 chars (same cap as
 *  item bodies). */
export declare const THREAD_ENTRY_CAP = 200;
/** `gh api …/issues/{n}/comments` JSON → `ForgeComment[]`. Exported for unit tests. */
export declare function normalizeComments(raw: unknown): ForgeComment[];
/** `gh api …/pulls/{n}/reviews` JSON → `ForgeComment[]`. Reviews with an empty body AND state
 *  COMMENTED/PENDING carry no signal in a flat thread and are dropped; the rest map to
 *  `kind: 'review'` (Q4). Exported for unit tests. */
export declare function normalizeReviews(raw: unknown): ForgeComment[];
/**
 * `gh api …/issues/{n}/timeline` JSON → `ForgeTimelineEvent[]`, plus whether the cap fired.
 *
 * Returns `truncated` rather than just the array because the caller has no other way to learn it:
 * `events.length === TIMELINE_EVENT_CAP` is ambiguous on a thread with exactly that many.
 *
 * Three details here are load-bearing and were verified against a real timeline, not assumed:
 *
 * 1. **`committed` rows return `created_at: null`** — the real timestamp is at `author.date`.
 *    Mapping `created_at` naively yields `createdAt: null` on every commit, which string-sorts to
 *    the top and silently reorders the entire thread.
 * 2. **`committed` carries a git author, not a GitHub actor** — a name, no login, no avatar.
 * 3. **The cap keeps the NEWEST events — `slice(-cap)`**, the opposite of the neighbouring
 *    `mergeThread`, which head-slices. The timeline arrives oldest-first, so `slice(0, cap)` would
 *    retain 200 stale day-one `labeled` rows and discard the merge and the recent commits — the
 *    exact rows #525 asks for.
 *
 * Exported for unit tests.
 */
export declare function normalizeEvents(raw: unknown, cap?: number): {
    events: ForgeTimelineEvent[];
    truncated: boolean;
};
/** Merge comment/review lists chronologically (oldest first) and apply the entry cap. Exported
 *  for unit tests. */
export declare function mergeThread(parts: ForgeComment[][], cap?: number): {
    comments: ForgeComment[];
    truncated: boolean;
};
/** Test-only: drop the per-thread cache so cases don't leak state into each other. */
export declare function __clearCommentsCacheForTests(): void;
/** Test-only: drop the memoized repo handles. */
export declare function __clearRepoHandleCacheForTests(): void;
/** The `owner/name` for `repoRoot`, memoized. Returns null when the handle isn't a clean two-part
 *  slug or `gh` failed — the caller then skips checks entirely and commits render unglyphed. */
export declare function resolveRepoHandle(repoRoot: string): Promise<{
    owner: string;
    name: string;
} | null>;
/** What the bounded timeline page loop returns. `stoppedShort` means "the timeline may have more
 *  rows than we fetched" and has exactly three causes — the page cap, the budget floor, and a
 *  failure on page ≥ 2. All three shorten the `commented` stream the same way, so all three feed
 *  `truncated` and arm the comments top-up; the cause does not change the remedy. A short page is
 *  the one exit that does NOT set it: that is the timeline genuinely ending. */
type TimelinePages = {
    rows: unknown[];
    stoppedShort: boolean;
};
/**
 * Walk `/issues/{n}/timeline` under ONE shared time budget.
 *
 * `gh api --paginate` is not used here: it pages *"until there are no more pages of results"* and
 * exposes no page-limit flag, so the only way to bound the walk is to hand-roll it. The cap that
 * `paginateCounts` gets comes from being a JS cursor loop, not from a `gh` flag.
 *
 * The budget is a **total**, not a per-page allowance. `gh()` takes its timeout per invocation, so
 * ten sequential spawns at the 15 s default would put the ceiling at 150 s — an order of magnitude
 * worse than the single `--paginate` spawn this replaces. The loop tracks a deadline and passes
 * each page whatever remains.
 *
 * Exported for unit tests; `run` is injected so the loop is testable without shelling out.
 */
export declare function fetchTimelinePages(run: (page: number, timeoutMs: number) => Promise<string>, opts?: {
    maxPages?: number;
    budgetMs?: number;
    minPageMs?: number;
    now?: () => number;
}): Promise<TimelinePages>;
/** SHAs per rollup query. Aliases resolve independently, so a chunk that fails costs only its own
 *  glyphs — but an unbounded alias list would eventually blow the query size limit. */
export declare const COMMIT_CHECKS_CHUNK = 50;
/**
 * Rolled-up CI state per commit SHA, as a `sha → checks` map.
 *
 * Batched and aliased so a 40-commit PR costs one subprocess, not forty. Verified against the live
 * API: each alias resolves independently and an unknown SHA comes back `null` rather than erroring
 * the batch, so partial results degrade cleanly.
 *
 * Degrades to an empty map on any failure — exactly as `fetchCommentCounts` does for counts. The
 * caller then leaves `checks` **absent**, which the UI renders as no glyph. Exported for tests;
 * `runGraphql` is injected so this is testable without shelling out.
 */
export declare function fetchCommitChecks(runGraphql: GraphqlRunner, owner: string, name: string, shas: string[], chunkSize?: number): Promise<Record<string, ForgeTimelineEvent['checks']>>;
/** The single enum a PR row's checks glyph renders (never `undefined` on the wire). */
export type ChecksGlyph = 'passing' | 'failing' | 'pending' | null;
export type GithubChecksData = {
    available: true;
    checks: Record<number, ChecksGlyph>;
} | {
    available: false;
    reason: string;
};
/** PR numbers per checks query. Aliases resolve independently (a failed chunk costs only its own
 *  glyphs); bounded so an unbounded number list can't blow the query size limit. Also the route's
 *  hard cap on how many PRs one request may ask about. */
export declare const GH_CHECKS_MAX = 100;
/**
 * Rolled-up CI state per PR number, as a `number → glyph` map.
 *
 * Batched and aliased so a 100-PR window costs one subprocess, not a hundred. Each alias resolves
 * independently and an unknown number comes back `null` (alias resolved null → left absent), so
 * partial results degrade cleanly. Degrades to an empty map on any failure — exactly as
 * `fetchCommitChecks` does. Exported for tests; `runGraphql` is injected so this is testable
 * without shelling out.
 */
export declare function fetchPrChecks(runGraphql: GraphqlRunner, owner: string, name: string, numbers: number[], chunkSize?: number): Promise<Record<number, ChecksGlyph>>;
/** Test hook — the per-PR checks cache would otherwise leak state across cases in one process. */
export declare function __clearChecksCacheForTests(): void;
/**
 * Lazy checks glyphs for the given PR numbers (route-facing). Resolves the repo handle once,
 * serves fresh cache entries, queries only the misses, and degrades to `{ available: false,
 * reason }` when `gh` or the handle is unavailable — never a throw, never a 5xx (plan rule 7).
 * Numbers are de-duplicated, validated, and capped at `GH_CHECKS_MAX`.
 */
export declare function fetchGithubChecks(repoRoot: string, numbers: number[]): Promise<GithubChecksData>;
/** Where a referenced PR or issue stands. Mirrored by `referenceStatusSchema` in the contract —
 *  see there for why PR `closed` and issue `completed` are separate words. */
export type ReferenceStatus = 'draft' | 'review-required' | 'changes-requested' | 'checks-pending' | 'checks-failing' | 'ready' | 'merged' | 'closed' | 'open' | 'completed' | 'not-planned';
export type GithubRefStatusData = {
    available: true;
    prs: Record<number, ReferenceStatus>;
    issues: Record<number, ReferenceStatus>;
    /** When to ask again, or `null` when nothing here can change. See `recheckAfterMs` in the
     *  contract for why the SERVER answers this. */
    recheckAfterMs: number | null;
} | {
    available: false;
    reason: string;
    recheckAfterMs: number | null;
};
/** Numbers per kind in one ref-status query — the same bound, and for the same reasons, as
 *  `GH_CHECKS_MAX`: aliases resolve independently, and the query size stays finite. Taken from the
 *  contract rather than restated, because the cockpit caps its batches by the same number and a
 *  client that guessed high would have every chip in a batch 400 instead of losing its tail. */
export declare const GH_REF_STATUS_MAX = 100;
/**
 * The one place a PR's signals collapse into a single word.
 *
 * The question the chip answers is "what is this waiting on RIGHT NOW", so the ranking is by
 * freshness of the signal, not by how heavy a blocker it is:
 *
 * Read the ranking as **whose move is it**, which is the question a table is scanned for:
 *
 *  1. `merged` / `closed` — nobody's. Terminal, whatever checks or reviews say.
 *  2. `draft` — the author's, and they have said so themselves.
 *  3. `checks-pending` — the machine's. CI running means a commit was JUST pushed, the newest
 *     thing that has happened to this PR, so it outranks a requested change unconditionally.
 *  4. `changes-requested` — the AUTHOR's, and only while that is still true: the review must be
 *     about the code that is there now, with no re-review already asked for.
 *  5. `checks-failing` — the author's again. A reviewer cannot approve a red PR anyway.
 *  6. `review-required` — the REVIEWER's: they have been asked, or the author has answered and
 *     the merge is now blocked on someone coming back to look.
 *  7. `ready` — open, not a draft, nothing failing, nothing running, nobody waited on.
 *
 * The subtle one is (4) → (6), and it is not a preference but a data finding. `reviewDecision`
 * stays `CHANGES_REQUESTED` after the author has responded — GitHub does not clear it until a
 * reviewer submits again — so on its own it points at the author forever. Two signals say the ball
 * has moved back:
 *
 *  - **a pending review request** (`reviewRequests.totalCount`), which is the author clicking
 *    re-request. Authoritative, and observed live alongside a stale `CHANGES_REQUESTED` and an
 *    EMPTY `latestReviews` — the case that has no other tell.
 *  - **a commit newer than the review**, the fallback for an author who pushed without clicking
 *    anything.
 *
 * Either way the words change from "you owe edits" to "they owe a look", and so does the colour:
 * danger is the author's move, info is the reviewer's.
 *
 * Both timestamps are optional and their ABSENCE is conservative: with no dates to compare and no
 * re-request, a review counts as current, and the chip keeps pointing at the author.
 *
 * `reviewDecision` is null on a repo with no review policy, which is exactly why `ready` is not
 * spelled "approved": on such a repo a green PR IS ready, and no approval will ever arrive — but a
 * requested reviewer still moves it to `review-required`, because someone was explicitly asked.
 */
export declare function derivePrReferenceStatus(pr: {
    state: string;
    isDraft?: boolean | null;
    reviewDecision?: string | null;
    checks: ChecksGlyph;
    /** ISO-8601 commit date of the head commit. `committedDate`, not a push time: GitHub's
     *  `pushedDate` is deprecated and comes back null on new PRs. */
    headCommittedAt?: string | null;
    /** ISO-8601 `submittedAt` of the most recent CHANGES_REQUESTED review, when there is one. */
    changesRequestedAt?: string | null;
    /** Is a reviewer currently ON THE HOOK — `reviewRequests.totalCount > 0`? True after the author
     *  clicks re-request, which is the one thing that says so while `reviewDecision` still reads
     *  `CHANGES_REQUESTED`. */
    reviewRequested?: boolean | null;
}): ReferenceStatus;
/**
 * An issue's two signals as one word. `NOT_PLANNED` is kept apart from `completed` because they
 * are opposite outcomes — "we did it" vs "we won't" — and a task whose issue was declined must
 * not read as a task that landed.
 */
export declare function deriveIssueReferenceStatus(issue: {
    state: string;
    stateReason?: string | null;
}): ReferenceStatus;
/** What one number turned out to be, and where it stands. `kind` is the forge's answer, not the
 *  caller's guess — see `refStatusQuery`. */
export interface ResolvedReference {
    kind: 'pr' | 'issue';
    status: ReferenceStatus;
}
/**
 * The outcome of one batched lookup. `failed` is what separates *this number is not in the
 * repository* from *we could not ask about this number* — an absence and a failure, which look
 * identical in a `number → status` map and mean opposite things to a reader ("that reference is
 * bogus" vs "GitHub is down"). Keeping them apart is what stops a transient error being cached,
 * and shown, as "not found".
 */
export interface RefStatusBatch {
    resolved: Record<number, ResolvedReference>;
    /** Numbers whose chunk threw. Nothing is known about them either way. */
    failed: number[];
    /** First failure's message, for the payload's `reason`. */
    reason?: string;
}
/**
 * Status per NUMBER, resolved to whatever that number actually is.
 *
 * Batched and aliased like `fetchPrChecks`: one subprocess per chunk, each alias resolving
 * independently, and a number the forge does not have simply staying absent from `resolved` (its
 * chip then renders neutral, as it did before this seam existed). A failed chunk costs only its
 * own numbers, and says so rather than letting them look absent. Exported for tests; `runGraphql`
 * is injected so this is testable without shelling out.
 */
export declare function fetchRefStatuses(runGraphql: GraphqlRunner, owner: string, name: string, numbers: number[], chunkSize?: number): Promise<RefStatusBatch>;
/** Test-only: drop the per-reference cache so cases don't leak state into each other. */
export declare function __clearRefStatusCacheForTests(): void;
/** Test-only: warm the cache the way the lazy route would have, so a reader can be tested
 *  without a forge behind it. */
export declare function __seedRefStatusCacheForTests(repoRoot: string, entries: Array<[number, ResolvedReference]>): void;
/**
 * Forget what we knew about one reference, so the next read asks GitHub again.
 *
 * Called where cezar itself CHANGES a pull request — it merges one, it opens one — because those
 * are the only forge changes this process can know about without asking. Everything else has to
 * be polled (GitHub cannot push to a cockpit with no public endpoint), but waiting out a TTL to
 * notice our own merge is a self-inflicted staleness: for up to a minute every chip would keep
 * showing the pre-merge status of a pull request the user watched this server merge.
 *
 * Deleting rather than overwriting with a guessed `merged`: the forge is the authority on what a
 * reference is, and a mutation that reports success is still not the same as having read the
 * result. The next reader pays one query and gets the truth — after which the answer is `merged`,
 * `recheckAfterMs` goes null, and the cockpit stops polling that batch entirely. Invalidating here
 * therefore REDUCES long-run traffic rather than adding to it.
 */
export declare function forgetRefStatus(repoRoot: string, number: number): void;
/**
 * Everything the cache ALREADY knows about these numbers. Never spawns `gh`, never awaits.
 *
 * This is what lets a status ride along with the rows that carry the references, instead of the
 * cockpit fetching it separately a moment later: the run index reads whatever is warm and ships
 * it, and a cold entry is simply absent — the lazy `/github/ref-status` route stays the thing that
 * actually goes and asks.
 *
 * Because it cannot cost anything, the caller may pass a SUPERSET of the numbers it will really
 * display. That matters: deciding which of a run's references a chip shows is the cockpit's rule
 * (#407, #526), deliberately not duplicated server-side, and a cache read does not need to know —
 * it can look up every number a run mentions and let the client pick.
 */
export declare function readCachedRefStatuses(repoRoot: string, numbers: Iterable<number>): {
    prs: Record<number, ReferenceStatus>;
    issues: Record<number, ReferenceStatus>;
};
/** The `#N` in a forge URL — `…/pull/774` → 774. Null when the tail is not a number, so a URL
 *  shape we do not recognise invalidates nothing rather than inventing a key. */
export declare function refNumberFromUrl(url: string): number | null;
/**
 * Route-facing reference status. Resolves the repo handle once, serves fresh cache entries,
 * queries only the misses, and degrades to `{ available: false, reason }` when `gh` or the handle
 * is unavailable — never a throw, never a 5xx.
 *
 * The two request lists are merged into ONE set of numbers: issues and pull requests share a
 * repository's numbering space, so a number is one thing and asking about it twice would be asking
 * the same question twice. What comes back is filed by what each number turned out to BE, which is
 * why a chip whose kind the cockpit guessed wrong still gets the right status.
 */
export declare function fetchGithubRefStatus(repoRoot: string, input: {
    prs?: number[];
    issues?: number[];
}): Promise<GithubRefStatusData>;
/**
 * The conversation thread for one issue/PR, lazily. `{owner}`/`{repo}` in the gh api paths are
 * filled from the worktree's remote by gh itself, so no extra handle lookup. Everything degrades:
 * gh missing/offline → `{ available: false, reason }`, a 404 → a "not found" hint — never a throw.
 *
 * Since #525 the thread is sourced from `/issues/{n}/timeline`, which returns comments AND events
 * in one stream: `commented` rows go through the unchanged `normalizeComments`, the rest through
 * `normalizeEvents`. `comments[]` therefore keeps its exact pre-#525 shape, contents and cap
 * (BACKWARD_COMPATIBILITY.md §2) — see the top-up below for the one case that needed defending.
 */
export declare function fetchGithubComments(repoRoot: string, kind: 'issue' | 'pr', number: number, refresh?: boolean): Promise<ForgeCommentsData>;
export declare function createDraftPr(input: DraftPrInput): Promise<DraftPrOutcome>;
/**
 * PR body from the handoff journal: the "## Goal" section (task text as
 * fallback) + the first ~10 lines of "## Progress log" (newest first) +
 * the cezar footer.
 */
export declare function buildPrBody(handoffText: string, task: string): string;
/**
 * Non-blocking availability for `GET /api/health` (#major-health-latency): serves the last-known
 * probe immediately (stale-while-revalidate) and only returns `null` on a cold start, before the
 * first probe has ever warmed the cache. It NEVER shells out to `gh` on the request that reads it,
 * so health stays under the bookmarklet's 800 ms port budget (a `gh repo view` round-trip is
 * ~500–650 ms on its own). `null` is contract-safe — the whole `forge` field is additive, so
 * "unknown until warm" is a valid answer.
 *
 * Serving the stale value while revalidating is what keeps the GitHub nav item from flickering:
 * without it, every time the 60 s cache expired this returned `null` for one 5 s health poll,
 * dropping `forge.available` and blinking the sidebar item out until the background probe warmed.
 */
export declare function detectGithubCached(repoRoot: string): ForgeAvailability | null;
export declare function normalizeMergeState(raw: unknown, policyRaw: unknown, requirements?: {
    readable: boolean;
    requiredChecks: string[];
}): ForgePrMergeState;
export declare function evictGithubProjectCaches(repoRoot: string): void;
export declare function mergePreflightAllowed(current: ForgePrMergeState, overrideRules?: boolean): boolean;
/** owner/repo parsed out of the origin remote — feeds `viewUrl`. */
export interface GithubRepoRef {
    owner: string;
    repo: string;
}
export declare function createGithubDriver(repoRoot: string, repoRef: GithubRepoRef | null): ForgeDriver;
export {};
