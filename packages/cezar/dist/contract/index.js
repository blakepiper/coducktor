// ../contract/src/events.ts
import { z } from "zod";
var runEventSchema = z.looseObject({
  seq: z.number(),
  ts: z.string(),
  stepId: z.string().optional(),
  type: z.string()
});
var RUN_HISTORY_PAGE_ITEMS = 100;
var runIdParamSchema = z.object({
  id: z.string().min(1).max(128).regex(/^[A-Za-z0-9._-]+$/)
});
var runHistoryCursorSchema = z.string().min(1).max(2048);
var runHistoryQuerySchema = z.object({
  cursor: runHistoryCursorSchema.optional()
});
var runEventsQuerySchema = z.object({
  cursor: runHistoryCursorSchema.optional(),
  afterSeq: z.coerce.number().int().nonnegative().optional()
});
var runHistoryEventSchema = z.object({
  seq: z.number(),
  ts: z.string(),
  stepId: z.string().optional(),
  type: z.string()
}).catchall(z.any());
var runHistoryPageSchema = z.object({
  events: z.array(runHistoryEventSchema),
  itemCount: z.number().int().min(0).max(RUN_HISTORY_PAGE_ITEMS),
  olderCursor: runHistoryCursorSchema.optional(),
  newerCursor: runHistoryCursorSchema.optional(),
  liveCursor: runHistoryCursorSchema,
  asOfSeq: z.number().int().nonnegative(),
  hasOlder: z.boolean()
});
var runHistoryContextSchema = z.object({
  contextEvents: z.array(runHistoryEventSchema),
  asOfSeq: z.number().int().nonnegative()
});
var checkoutProgressEventSchema = z.object({
  checkoutId: z.string().optional(),
  name: z.string(),
  phase: z.enum(["cloning", "done", "error"]),
  line: z.string().optional(),
  error: z.string().optional()
});

// ../contract/src/health.ts
import { z as z2 } from "zod";
var runnerSchema = z2.enum(["claude", "codex", "opencode", "pi"]);
var runnerSelectionSchema = z2.union([runnerSchema, z2.literal("auto")]);
var repoInfoSchema = z2.object({
  root: z2.string(),
  branch: z2.string(),
  remote: z2.string().optional()
});
var backendCheckSchema = z2.object({
  name: z2.enum(["claude", "codex", "opencode", "pi", "gh", "git"]),
  available: z2.boolean(),
  version: z2.string().optional(),
  hint: z2.string().optional()
});
var forgeInfoSchema = z2.object({
  kind: z2.literal("github"),
  /**
   * Whether the forge is reachable — **absent until the availability probe has warmed**.
   *
   * Health must never pay a `gh` shell-out, so it serves whatever the cache holds. Absent means
   * "not determined yet", which is not the same as `false`, and the cockpit renders the two
   * differently. Declaring it required is what made an earlier hand-written mirror wrong.
   */
  available: z2.boolean().optional(),
  reason: z2.string().optional()
});
var capabilitiesSchema = z2.object({
  localHandoff: z2.boolean(),
  followups: z2.boolean(),
  singleProject: z2.boolean(),
  /**
   * `true` means `CEZ_AUTOMATIONS=1` opted this server into GitHub automations (#801). Off — the
   * default — the whole feature is absent: no `Automations` nav item anywhere it is rendered, the
   * `/api/v1/…/automations*` family answers `409`, and the workspace scheduler never polls GitHub.
   *
   * REQUIRED for the same reason as `tokenMetrics` below: this server always sends it.
   */
  automations: z2.boolean(),
  /**
   * `false` means `CEZ_HIDE_TOKEN_METRICS=1` asks the browser to omit token counts and monetary
   * cost (#481). The telemetry itself still rides in run/event payloads — this is presentation
   * only.
   *
   * REQUIRED, because this server always sends it (`capabilities.ts` computes it from the env on
   * every read) and this contract describes THIS server's wire. The DTO it replaces declared it
   * optional so a newer cockpit could read an OLDER server, which is version skew a contract
   * versioned in lockstep with the server cannot model. That tolerance lives where it belongs, in
   * `web/src/lib/token-metrics.ts`, whose `!== false` read still treats an absent field as
   * visible.
   */
  tokenMetrics: z2.boolean(),
  /** Current token-count presentation policy. Required on current servers;
   * older payload tolerance belongs in the browser resolver. */
  tokenUsageMetrics: z2.boolean(),
  /** Current backend-reported-cost presentation policy. */
  costMetrics: z2.boolean()
});
var healthResponseSchema = z2.object({
  version: z2.string(),
  latestVersion: z2.string().optional(),
  repoRoot: z2.string(),
  repo: repoInfoSchema.nullable(),
  checks: z2.array(backendCheckSchema),
  defaultRunner: runnerSelectionSchema,
  forge: forgeInfoSchema.nullable(),
  capabilities: capabilitiesSchema,
  // Always sent: `workspaceSummary()` returns both unconditionally, and an unreadable workspace
  // degrades to `projects: []` rather than to an absent key. The hand-written DTO declared them
  // optional, which was wider than the server has ever been.
  projects: z2.array(z2.object({ id: z2.string(), name: z2.string() })),
  bootProject: z2.string()
});

// ../contract/src/runs.ts
import { z as z6 } from "zod";

// ../contract/src/github.ts
import { z as z3 } from "zod";
var checksGlyphSchema = z3.enum(["passing", "failing", "pending"]).nullable();
var githubItemSchema = z3.object({
  kind: z3.enum(["issue", "pr"]),
  number: z3.number(),
  title: z3.string(),
  author: z3.string(),
  createdAt: z3.string(),
  labels: z3.array(z3.string()),
  body: z3.string(),
  url: z3.string(),
  comments: z3.number(),
  /** PRs only. */
  isDraft: z3.boolean().optional(),
  additions: z3.number().optional(),
  deletions: z3.number().optional(),
  checks: checksGlyphSchema.optional()
});
var githubDataSchema = z3.object({
  available: z3.boolean(),
  /** Why it is unavailable (`gh` missing, no remote, offline…). Never an error — a hint. */
  reason: z3.string().optional(),
  /** owner/name, when known. */
  repo: z3.string().optional(),
  syncedAt: z3.string().optional(),
  issues: z3.array(githubItemSchema),
  prs: z3.array(githubItemSchema),
  /** Repo-wide label name → 6-hex color (no `#`); lets chips tint like GitHub. Additive. */
  labelColors: z3.record(z3.string(), z3.string()).optional()
});
var githubChecksDataSchema = z3.discriminatedUnion("available", [
  z3.object({
    available: z3.literal(true),
    checks: z3.record(z3.number(), checksGlyphSchema)
  }),
  z3.object({
    available: z3.literal(false),
    reason: z3.string()
  })
]);
var referenceStatusSchema = z3.enum([
  "draft",
  "review-required",
  "changes-requested",
  "checks-pending",
  "checks-failing",
  "ready",
  "merged",
  "closed",
  "open",
  "completed",
  "not-planned"
]);
var recheckAfterMsSchema = z3.number().nullable();
var REFERENCE_STATUS_MAX = 100;
var githubRefStatusDataSchema = z3.discriminatedUnion("available", [
  z3.object({
    available: z3.literal(true),
    prs: z3.record(z3.number(), referenceStatusSchema),
    issues: z3.record(z3.number(), referenceStatusSchema),
    recheckAfterMs: recheckAfterMsSchema
  }),
  z3.object({
    available: z3.literal(false),
    reason: z3.string(),
    recheckAfterMs: recheckAfterMsSchema
  })
]);
var githubCommentSchema = z3.object({
  id: z3.number(),
  /** Author login, `'?'` fallback when gh omits the user. */
  author: z3.string(),
  avatarUrl: z3.string().optional(),
  createdAt: z3.string(),
  body: z3.string(),
  kind: z3.enum(["comment", "review"]),
  /** Reviews only — drives the state chip. */
  reviewState: z3.enum(["approved", "changes_requested", "commented", "dismissed"]).optional(),
  url: z3.string()
});
var githubTimelineEventKindSchema = z3.enum([
  "committed",
  "labeled",
  "unlabeled",
  "assigned",
  "unassigned",
  "merged",
  "closed",
  "reopened",
  "head_ref_force_pushed",
  "cross-referenced",
  "renamed"
]);
var githubTimelineEventSchema = z3.object({
  id: z3.string(),
  kind: githubTimelineEventKindSchema,
  /** Login — or the git author name for `committed`, which carries no GitHub actor. */
  actor: z3.string(),
  /** Absent for `committed`. */
  avatarUrl: z3.string().optional(),
  createdAt: z3.string(),
  url: z3.string().optional(),
  /** `committed` — full 40-char SHA. */
  sha: z3.string().optional(),
  /** `committed` — first line, capped at 120 chars. */
  message: z3.string().optional(),
  /** `committed` — **absent** (lookup failed/skipped) and **`null`** (no CI configured) both
   *  render no glyph, but stay distinct values. */
  checks: checksGlyphSchema.optional(),
  label: z3.object({ name: z3.string(), color: z3.string().optional() }).optional(),
  /** `assigned`/`unassigned` login, or the new title for `renamed`. */
  subject: z3.string().optional(),
  refNumber: z3.number().optional(),
  refTitle: z3.string().optional(),
  refIsPr: z3.boolean().optional()
});
var githubCommentsDataSchema = z3.object({
  available: z3.boolean(),
  reason: z3.string().optional(),
  /** Chronological, oldest first. */
  comments: z3.array(githubCommentSchema),
  /** True when either stream hit its cap, or the timeline fetch stopped short. */
  truncated: z3.boolean().optional(),
  /** Timeline events (#525) — additive; absent when the server degraded to the legacy
   *  comments-only fetch. Capped independently of `comments`. */
  events: z3.array(githubTimelineEventSchema).optional()
});
var githubMergeMethodSchema = z3.enum(["merge", "squash", "rebase"]);
var githubPrCheckSchema = z3.object({
  name: z3.string(),
  state: z3.enum(["passing", "failing", "pending", "unknown"]),
  required: z3.boolean().nullable(),
  url: z3.string().optional()
});
var githubPrMergeStateSchema = z3.object({
  number: z3.number(),
  title: z3.string(),
  url: z3.string(),
  state: z3.enum(["open", "closed", "merged"]),
  isDraft: z3.boolean(),
  headRef: z3.string(),
  baseRef: z3.string(),
  headSha: z3.string(),
  mergeable: z3.enum(["mergeable", "conflicting", "unknown"]),
  reviewDecision: z3.enum(["approved", "changes-requested", "review-required", "unknown"]),
  checks: z3.array(githubPrCheckSchema),
  methods: z3.array(githubMergeMethodSchema),
  defaultMethod: githubMergeMethodSchema.nullable(),
  eligibility: z3.enum(["ready", "blocked", "pending", "unauthorized", "terminal", "unknown"]),
  blockers: z3.array(z3.object({ code: z3.string(), message: z3.string() })),
  canMerge: z3.boolean(),
  canOverride: z3.boolean()
});
var githubPrMergeStateResponseSchema = z3.discriminatedUnion("available", [
  z3.object({ available: z3.literal(true), mergeState: githubPrMergeStateSchema }),
  z3.object({ available: z3.literal(false), reason: z3.string() })
]);
var githubMergeResponseSchema = z3.object({
  merged: z3.literal(true),
  number: z3.number(),
  url: z3.string(),
  method: githubMergeMethodSchema,
  mergeCommitSha: z3.string().optional()
});
var githubPrChangeSchema = z3.object({
  path: z3.string(),
  previousPath: z3.string().optional(),
  status: z3.enum(["added", "modified", "removed", "renamed", "copied", "changed"]),
  additions: z3.number(),
  deletions: z3.number(),
  patch: z3.string().optional(),
  patchUnavailableReason: z3.enum(["binary", "too-large", "not-provided"]).optional(),
  truncated: z3.boolean().optional()
});
var githubPrChangesDataSchema = z3.discriminatedUnion("available", [
  z3.object({
    available: z3.literal(true),
    number: z3.number(),
    headSha: z3.string(),
    files: z3.array(githubPrChangeSchema),
    additions: z3.number(),
    deletions: z3.number(),
    truncated: z3.boolean(),
    /** Present when the payload is complete but partial in some other way (a capped patch). */
    reason: z3.string().optional()
  }),
  z3.object({ available: z3.literal(false), reason: z3.string() })
]);

// ../contract/src/workflows.ts
import { z as z4 } from "zod";
var workflowStepDefSchema = z4.object({
  id: z4.string().min(1),
  name: z4.string().optional(),
  // agent step
  prompt: z4.string().optional(),
  skill: z4.string().optional(),
  model: z4.string().optional(),
  /** Per-step agent backend override (falls back to the task / config default). */
  runner: runnerSelectionSchema.optional(),
  allowedTools: z4.array(z4.string()).optional(),
  bashAllowlist: z4.array(z4.string()).optional(),
  // check step
  command: z4.string().optional(),
  onFail: z4.object({
    retry: z4.string().min(1),
    max: z4.number().int().positive().default(2)
  }).optional()
}).refine((s) => Boolean(s.command) !== Boolean(s.prompt ?? s.skill), {
  message: "a step is either an agent step (prompt/skill) or a check step (command), not both"
});
var workflowDefSchema = z4.object({
  name: z4.string(),
  description: z4.string().optional(),
  steps: z4.array(workflowStepDefSchema),
  source: z4.enum(["built-in", "file"]),
  /** Absent on built-ins — which is exactly what makes them undeletable. */
  path: z4.string().optional()
});
var workflowLoadIssueSchema = z4.object({
  path: z4.string(),
  message: z4.string()
});
var workflowsResponseSchema = z4.object({
  workflows: z4.array(workflowDefSchema),
  issues: z4.array(workflowLoadIssueSchema)
});
var saveWorkflowInputSchema = z4.object({
  name: z4.string().trim().min(1).max(80),
  description: z4.string().max(2e3, "must be at most 2000 characters").optional(),
  steps: z4.array(workflowStepDefSchema).min(1).max(8).optional(),
  skills: z4.array(z4.string().trim().min(1)).min(1).max(8).optional(),
  overwrite: z4.boolean().optional()
}).refine((b) => Boolean(b.steps) !== Boolean(b.skills), {
  message: 'provide either "steps" or "skills", not both'
});
var saveWorkflowResponseSchema = z4.object({
  path: z4.string(),
  name: z4.string()
});
var parsedWorkflowSchema = z4.object({
  name: z4.string(),
  description: z4.string().optional(),
  steps: z4.array(workflowStepDefSchema)
});
var deleteWorkflowResponseSchema = z4.object({
  ok: z4.literal(true),
  path: z4.string()
});
var planResponseSchema = z4.object({
  /** The kebab-case workflow title the planner proposed. Absent on the degraded fallback. */
  name: z4.string().optional(),
  steps: z4.array(workflowStepDefSchema),
  rationale: z4.string(),
  fallback: z4.boolean()
});

// ../contract/src/reasoning.ts
import { z as z5 } from "zod";
var reasoningEffortSchema = z5.enum(["auto", "low", "medium", "high", "xhigh"]);
var concreteReasoningEffortSchema = reasoningEffortSchema.exclude(["auto"]);

// ../contract/src/runs.ts
var runStatusSchema = z6.enum([
  "queued",
  "running",
  "waiting",
  "review",
  "done",
  "failed",
  "cancelled"
]);
var runActivitySchema = z6.enum(["monitoring"]);
var providerQuotaBlockedReasonSchema = z6.object({
  type: z6.literal("provider_quota"),
  providers: z6.array(z6.enum(["claude", "codex"])),
  retryAt: z6.string().optional()
});
var stepStatusSchema = z6.enum([
  "pending",
  "running",
  "waiting",
  "review",
  "done",
  "failed",
  "cancelled",
  "skipped"
]);
var usageCounterSchema = z6.number().finite().nonnegative();
var stepStateSchema = z6.object({
  id: z6.string(),
  name: z6.string(),
  kind: z6.enum(["agent", "check"]),
  status: stepStatusSchema,
  iterations: z6.number(),
  tokensUsed: z6.number(),
  inputTokens: usageCounterSchema.optional(),
  outputTokens: usageCounterSchema.optional(),
  usageInvocationsStarted: usageCounterSchema.optional(),
  usageInvocationsObserved: usageCounterSchema.optional(),
  usageTurnsStarted: usageCounterSchema.optional(),
  usageTurnsRecorded: usageCounterSchema.optional(),
  usageInvocationEpoch: usageCounterSchema.optional(),
  startedAt: z6.string().optional(),
  finishedAt: z6.string().optional(),
  error: z6.string().optional(),
  /** Latest agent session id — `claude --resume <id>` and friends. */
  sessionId: z6.string().optional(),
  /** Backend that owns `sessionId`; absent on records written before backend affinity. */
  backend: runnerSchema.optional(),
  requestedRunner: runnerSelectionSchema.optional(),
  /** Agent account (spec 2026-07-29-agent-profiles) that owns `sessionId` — `default`, or a
   *  stored profile id. The two are a PAIR: a session id only resolves inside the config dir
   *  that created it, so resume and Continue read this rather than the project's current
   *  selection. Absent on records written before accounts existed. */
  profileId: z6.string().optional(),
  /** Concrete reasoning level used for this step. `auto` is resolved before spawn and is never
   * written here, so the run history shows what each chunk actually received. */
  reasoningEffort: reasoningEffortSchema.exclude(["auto"]).optional(),
  costUsd: z6.number().optional(),
  /** Canonical provider/model identity (#405) this step actually spawned with — the per-step
   *  twin of the run-level `modelIdentity`, since a follow-up or resume can switch model
   *  between steps. Groups a per-model usage breakdown; absent on pre-this-feature records. */
  modelIdentity: z6.string().optional()
});
var diffStatSchema = z6.object({
  adds: z6.number(),
  dels: z6.number(),
  files: z6.number(),
  /** Additive since #751, and present ONLY when true: the numbers were measured against a
   *  branch the agent checked out into the task's worktree, as the run found it, because the
   *  worktree's HEAD had been repointed off the task's own branch (every review/QA run does
   *  this) and the merge-base anchor would otherwise have reported that branch's entire diff
   *  as this task's. Absent on every normal run and on every record written before #751 — a
   *  consumer that ignores it sees exactly the old shape. */
  repointed: z6.boolean().optional()
});
var queuedMessageSchema = z6.object({
  id: z6.string(),
  text: z6.string(),
  /** `/api/v1/runs/:id/images/…` URLs — attachments are persisted, never inlined. */
  images: z6.array(z6.string()).optional(),
  createdAt: z6.string()
});
var processUsageSchema = z6.object({
  /** Sum of `%cpu` across the tree — can exceed 100 on multi-core work. */
  cpuPct: z6.number(),
  rssBytes: z6.number(),
  procCount: z6.number()
});
var runRecordSchema = z6.object({
  id: z6.string(),
  title: z6.string(),
  /** Display title (#389): auto-derived from the first agent turn, or the user's inline edit
   *  (`PATCH /runs/:id` sets it together with `title`). Show `titleSummary ?? title`. */
  titleSummary: z6.string().optional(),
  /** Refreshed on every turn-end; absent until the first turn ends (and on worktree-less runs). */
  diffStat: diffStatSchema.optional(),
  workflow: z6.string(),
  task: z6.string(),
  /** Prompt messages stacked onto the run while it waited for a free agent slot (#472). Folded
   *  into the prompt at dequeue — never delivered as their own turns. Absent on pre-#472 runs. */
  queuedMessages: z6.array(queuedMessageSchema).optional(),
  /** URLs of images attached to the initial task prompt (#image-display). */
  taskImages: z6.array(z6.string()).optional(),
  model: z6.string().optional(),
  /** User-authored reasoning policy. `auto` is resolved independently for each agent step. */
  reasoningEffort: reasoningEffortSchema.optional(),
  /** Normalized provider/model identity used for attribution and reproducible replay. */
  modelIdentity: z6.string().optional(),
  runner: runnerSchema.optional(),
  requestedRunner: runnerSelectionSchema.optional(),
  /** The composer's per-task agent account (spec 2026-07-29-agent-profiles), applying to steps
   *  on `runner`. Absent = the run follows the project's own selection. */
  agentProfile: z6.string().optional(),
  /** Echo of the extra system prompt the run used (POST override or config default). */
  systemPrompt: z6.string().optional(),
  /** false when the run deliberately disabled follow-up todo generation. Absent means enabled. */
  generateFollowups: z6.boolean().optional(),
  /** Autonomous mode (#autonomous): the run never parks at `waiting` or the terminal `review`
   *  gate. Absent = falsy = not autonomous. */
  autonomous: z6.boolean().optional(),
  /**
   * Provenance for a task a project GitHub automation launched (#694). Absent on every ordinary
   * run, which is what makes it additive — the cockpit shows the "from automation" link only when
   * it is there.
   *
   * `event` is a plain string rather than `automationEventSchema`: it is the event NAME the
   * launching definition matched, recorded on the run for the audit trail, and `src/runs/store.ts`
   * persists it as free text so an older cezar can still read a record written by a newer one.
   */
  automation: z6.object({
    automationId: z6.string(),
    automationRevision: z6.number(),
    receiptId: z6.string(),
    event: z6.string(),
    githubUrl: z6.string()
  }).optional(),
  status: runStatusSchema,
  /** `monitoring` while `status === 'running'` and the agent is working on downstream work.
   *  Absent on old runs; cleared on resume/end. */
  activity: runActivitySchema.optional(),
  /** Exact ISO-8601 deadline for the next automatic monitoring check. */
  monitoringWakeAt: z6.string().optional(),
  /** The current live monitoring epoch exhausted its 40 automatic checks. */
  monitoringWakeCapReached: z6.boolean().optional(),
  /** Exact ISO-8601 instant this run resumes itself after a provider usage limit stopped it
   *  (spec 2026-08-03-auto-resume-after-usage-limit). Present only on a `failed` run with a
   *  pending automatic resume — its absence is what "no resume is scheduled" looks like. */
  autoResumeAt: z6.string().optional(),
  /** Consecutive automatic resumes since the last human turn, against the safety cap. */
  autoResumeAttempts: z6.number().optional(),
  /** Why a queued auto-routed run is intentionally not dispatching yet. */
  blockedReason: providerQuotaBlockedReasonSchema.optional(),
  createdAt: z6.string(),
  startedAt: z6.string().optional(),
  finishedAt: z6.string().optional(),
  tokensUsed: z6.number(),
  inputTokens: usageCounterSchema.optional(),
  outputTokens: usageCounterSchema.optional(),
  costUsd: z6.number().optional(),
  pullRequestUrl: z6.string().optional(),
  /** The PR this task is ABOUT (#407) — auto-discovered from conversation references. Display
   *  tier only: `pullRequestUrl` (the PR this task CREATED) wins, and the action gates ignore it. */
  referencedPullRequestUrl: z6.string().optional(),
  /** The PR/issue number this task is ABOUT (task auto-naming spec) — display tier only. */
  prNumber: z6.number().optional(),
  issueNumber: z6.number().optional(),
  /** Server-side provenance: referenced-issue discovery currently owns `issueNumber`. */
  referencedIssueNumberSeeded: z6.boolean().optional(),
  /** 'user' = renamed via PATCH, never auto-overwritten; 'marker' = agent-declared via
   *  CEZ:TITLE (spec 2026-07-18-task-ref-markers); 'auto' = namer-owned. */
  titleOrigin: z6.enum(["user", "auto", "marker"]).optional(),
  /** References the agent declared via CEZ:PR/CEZ:ISSUE markers — authoritative over the namer
   *  for the matching kind. */
  markerRefs: z6.object({ pr: z6.number().optional(), issue: z6.number().optional() }).optional(),
  /** The referenced tier's working set (distinct PR URLs spotted, capped server-side). */
  referencedPrCandidates: z6.array(z6.string()).optional(),
  /** The issue this task is ABOUT (spec 2026-07-21-report-ref-discovery). Display-only. */
  referencedIssueUrl: z6.string().optional(),
  /** The referenced-issue working set, persisted like `referencedPrCandidates`. Capped. */
  referencedIssueCandidates: z6.array(z6.string()).optional(),
  /** Explicit execution policy. `false` means the run intentionally uses the repo root;
   *  absent on older runs and for the default isolated-worktree mode. */
  worktree: z6.literal(false).optional(),
  /** Absent for in-place runs and after an isolated worktree is removed. */
  worktreePath: z6.string().optional(),
  branch: z6.string().optional(),
  /** Stable baseline for session git views: a worktree's fork ref, or an in-place run's starting commit. */
  baseBranch: z6.string().optional(),
  /** Set when count-based retention (#483) reclaimed the worktree DIRECTORY (the branch is
   *  kept): the dir is gone but recoverable. */
  worktreeReclaimedAt: z6.string().optional(),
  /** Parallel variants (spec 010): runs sharing a groupId are one group. */
  groupId: z6.string().optional(),
  /** Variant letter within the group — 'A' | 'B' | 'C'. */
  variant: z6.string().optional(),
  peakRssBytes: z6.number().optional(),
  peakProcCount: z6.number().optional(),
  archived: z6.boolean(),
  archivedAt: z6.string().optional(),
  /** Read receipt (#unread-done-items): ISO time the cockpit last opened this run's
   *  thread. A finished (`done`/`failed`) run reads as *unread* until seen since it
   *  finished — see `isUnread()` in the cockpit's `lib/read-state.ts`. Absent on old
   *  runs, on any run not yet opened, and on one deliberately put back to unread via
   *  `POST /runs/:id/unread` (#775) — all three count as unread. */
  seenAt: z6.string().optional(),
  currentStepId: z6.string().optional(),
  error: z6.string().optional(),
  steps: z6.array(stepStateSchema),
  /**
   * The persisted workflow definition, so a `queued` run survives a restart — including the ad-hoc
   * "(planned)" chains that exist nowhere else.
   *
   * The definition schema and NOT `z.record(z.string(), z.unknown())`: this key comes off the wire,
   * so its values are whatever `JSON.parse` can produce and nothing else. `unknown` was wider than
   * the server can serialize, and it made the route type unrepresentable here — hono maps `unknown`
   * to its own `JSONValue`, whose index signature admits `object | symbol | undefined`. The fix was
   * at the source: `src/runs/store.ts` persists a typed `workflowDefSchema` now, so the route's own
   * type is this shape and the two-way check in `src/server/contract-parity.runs.test.ts` covers it
   * like every other key.
   */
  workflowDef: workflowDefSchema.optional()
});
var apiRunSchema = runRecordSchema.extend({
  usage: processUsageSchema.optional()
});
var modelUsageEntrySchema = z6.object({
  model: z6.string(),
  reasoningEffort: reasoningEffortSchema.exclude(["auto"]).optional(),
  pct: z6.number()
});
var runIndexEntrySchema = z6.object({
  /** The registered project this run belongs to. Joins against `GET /projects`. */
  projectId: z6.string(),
  id: z6.string(),
  title: z6.string(),
  titleSummary: z6.string().optional(),
  titleOrigin: z6.enum(["user", "auto", "marker"]).optional(),
  status: runStatusSchema,
  activity: runActivitySchema.optional(),
  createdAt: z6.string(),
  finishedAt: z6.string().optional(),
  /** With `status`/`finishedAt`/`archived`, the four inputs `isUnread` reads — what lets the
   *  palette lead with "finished while you weren't looking" across every project, not just the
   *  one you happen to be standing in. */
  seenAt: z6.string().optional(),
  /** Always present, like `RunRecord.archived`: absent would read as "not archived", and the
   *  unread rule treats archiving as a stronger "done with this" than reading. */
  archived: z6.boolean(),
  /** A run parked by a provider usage limit is `failed` on the record with a resume booked
   *  (spec 2026-08-03-auto-resume-after-usage-limit). Both `deriveAttention` and `isUnread` read
   *  it, so without it here a cross-project row would show a red "failed" dot and land in
   *  Recently finished for work that is simply waiting for its appointment. */
  autoResumeAt: z6.string().optional(),
  /** The workflow the run executes — the global Tasks page shows it in a column and groups by
   *  it. Always present on the record (`RunRecord.workflow`), so required here; the display
   *  refinement `workflowLabel` applies needs `steps[]`, which this row deliberately omits, so
   *  a `(planned)` chain reads as itself here rather than as its first agent's name. */
  workflow: z6.string(),
  /** The task's branch, when it has one — a column on the global page, and the one field that
   *  makes a cross-project row identifiable at a glance without opening it. */
  branch: z6.string().optional(),
  /** When the agent actually started, as opposed to when the task was created. The global page's
   *  age column prefers it and falls back to `createdAt`, exactly as the per-project table does. */
  startedAt: z6.string().optional(),
  /**
   * The six fields `taskReference()` (`web/src/lib/tasks-table.ts`) reads to decide a task's PR
   * or issue chip. Carried verbatim rather than pre-resolved into a `{kind, number, url}` on the
   * server, because the rule that picks between them is subtle (#407, #526: a run that REVIEWED
   * a PR must not claim it as its own, an issue-subject run must not adopt an incidental
   * transcript PR) and it already exists, tested, on the client. Resolving it a second time
   * server-side would be a second rule, and the two would drift.
   *
   * Six scalars is still the slim row this schema exists to keep: `steps[]` and `workflowDef`,
   * the expensive half, stay off it.
   */
  pullRequestUrl: z6.string().optional(),
  referencedPullRequestUrl: z6.string().optional(),
  prNumber: z6.number().optional(),
  issueNumber: z6.number().optional(),
  referencedIssueUrl: z6.string().optional(),
  markerRefs: z6.object({ pr: z6.number().optional(), issue: z6.number().optional() }).optional(),
  /** What the run has cost so far. Absent means nothing was recorded, which is NOT `$0` — the
   *  cockpit prints an em dash rather than claiming a measurement that never happened. */
  costUsd: z6.number().optional(),
  /** The persisted high-water marks a FINISHED run leaves behind. `usage` below stops existing
   *  the moment the process tree does, so without these a finished row could say nothing at all
   *  about what it took to run. */
  peakRssBytes: z6.number().optional(),
  peakProcCount: z6.number().optional(),
  /**
   * The live CPU/RSS sample of this run's process tree, attached on the way out exactly as
   * `GET /runs` attaches it (`withUsage`) — never persisted.
   *
   * It can ride a WORKSPACE-level answer because the sampler is process-wide: one cezar process
   * runs every project's agents, so `currentUsage(runId)` knows about a run whatever project it
   * belongs to. That is what lets a cross-project table show live usage without opening one
   * event stream per project (it could not — the run stream is project-scoped).
   */
  usage: processUsageSchema.optional(),
  /** The backend that actually ran the run's latest step, falling back to the requested
   *  `RunRecord.runner` — the same resolution the task-detail agent badge leads with. Omitted
   *  only when neither is known (a queued run with no step yet and no explicit runner). */
  runner: runnerSchema.optional(),
  /** `RunRecord.model`, the free text the caller asked for — `opus`, `auto`, a gateway id.
   *  Alongside the concrete identity and `modelUsage` below, this is what lets the global Tasks
   *  page answer "which model, from which provider" without shipping every project's full
   *  `steps[]`. */
  model: z6.string().optional(),
  /**
   * Usage weighted by tokens spent, grouped by (model identity, reasoning level) and sorted
   * heaviest first — the server-computed twin of the task-detail agent badge's breakdown
   * (`computeModelBreakdown`/`computeModelUsageBreakdown`), done once here rather than requiring
   * the full `steps[]` on every row of a cross-project table. Present only when at least one step
   * recorded both a canonical model identity and nonzero tokens; a run that never switched model
   * or reasoning mid-run collapses to a single entry.
   */
  modelUsage: z6.array(modelUsageEntrySchema).optional(),
  /** The latest concrete provider/model identity recorded for this run. Unlike `modelUsage`,
   * this remains available while a task has no token sample yet, so the global Tasks page can
   * still identify a queued or just-started task without shipping `steps[]`. */
  modelIdentity: z6.string().optional(),
  /** The latest concrete reasoning level recorded for this run. `auto` is resolved before a
   * step starts and is intentionally omitted here until the runner records the concrete level. */
  reasoningEffort: reasoningEffortSchema.exclude(["auto"]).optional()
});
var referenceStatusesByProjectSchema = z6.record(
  z6.string(),
  z6.object({
    prs: z6.record(z6.number(), referenceStatusSchema),
    issues: z6.record(z6.number(), referenceStatusSchema)
  })
);
var runsIndexResponseSchema = z6.object({
  /** Newest first, across every registered project. Archived runs are included — `GET /runs`
   *  carries them for the project you are standing in, and a finder that dropped them elsewhere
   *  would make a task vanish the moment you left its project. */
  runs: z6.array(runIndexEntrySchema),
  /** Additive: absent statuses mean "nothing warm", never "nothing to show". */
  referenceStatuses: referenceStatusesByProjectSchema,
  /** The per-project cap that produced this list. */
  perProjectLimit: z6.number(),
  /** Ids of the projects that had more runs than the cap allowed. */
  truncated: z6.array(z6.string())
});
var createRunResponseSchema = z6.union([
  runRecordSchema,
  z6.object({ runs: z6.array(runRecordSchema) })
]);
var cancelResponseSchema = z6.object({ cancelled: z6.boolean() });
var cancelAutoResumeResponseSchema = z6.object({ cancelled: z6.literal(true) });
var archiveFinishedResponseSchema = z6.object({ archived: z6.number() });
var markAllReadResponseSchema = z6.object({ read: z6.number() });
var deleteRunResponseSchema = z6.object({ deleted: z6.literal(true) });
var finishResponseSchema = z6.object({ finished: z6.literal(true) });
var continueResponseSchema = z6.object({ continued: z6.literal(true) });
var createPrResponseSchema = z6.object({
  url: z6.string(),
  dryRun: z6.boolean()
});
var messageResponseSchema = z6.union([
  z6.object({ delivered: z6.literal(true) }),
  z6.object({ queued: z6.literal(true), message: queuedMessageSchema }),
  z6.object({ deferred: z6.literal(true) })
]);
var editQueuedMessageResponseSchema = z6.object({ message: queuedMessageSchema });
var removeQueuedMessageResponseSchema = z6.object({ removed: z6.literal(true) });
var openInCliResponseSchema = z6.object({
  opened: z6.literal(true),
  command: z6.string()
});
var removeWorktreeResponseSchema = z6.object({ removed: z6.literal(true) });
var gitCommitResponseSchema = z6.object({
  committed: z6.literal(true),
  sha: z6.string()
});
var gitPushResponseSchema = z6.object({
  pushed: z6.literal(true),
  branch: z6.string(),
  remote: z6.string(),
  upstreamSet: z6.boolean()
});
var runCommitSchema = z6.object({
  sha: z6.string(),
  subject: z6.string(),
  author: z6.string(),
  /** Relative time ("3 hours ago") — git's `%cr`. */
  when: z6.string()
});
var runCommitsResponseSchema = z6.object({
  commits: z6.array(runCommitSchema),
  branch: z6.string().optional(),
  pushed: z6.boolean()
});
var groupVariantSchema = z6.object({
  id: z6.string(),
  /** 'A' | 'B' | 'C' in practice; `'?'` for a record that lost its letter. */
  variant: z6.string(),
  title: z6.string(),
  status: runStatusSchema,
  archived: z6.boolean(),
  tokensUsed: z6.number(),
  inputTokens: usageCounterSchema.optional(),
  outputTokens: usageCounterSchema.optional(),
  costUsd: z6.number().optional(),
  diffStat: z6.string(),
  /** First lines of the handoff journal's "## Progress log" section, as markdown. */
  handoffExcerpt: z6.string()
});
var groupResponseSchema = z6.object({
  groupId: z6.string(),
  runs: z6.array(groupVariantSchema)
});
var pickVariantResponseSchema = z6.object({
  winner: runRecordSchema.optional()
});
var imageInputSchema = z6.object({
  mediaType: z6.string().regex(/^image\//),
  data: z6.string().min(1).max(7e6)
});
var createRunInputBaseSchema = z6.object({
  workflow: z6.string().min(1).optional(),
  /** An inline chain (spec 008 — an approved plan runs as an ad-hoc workflow, never written to
   *  a file). The catalog's own step shape, not a copy of it. */
  steps: z6.array(workflowStepDefSchema).min(1).max(8).optional(),
  task: z6.string().min(1).max(1e5, "must be at most 100000 characters"),
  model: z6.string().optional(),
  /** Reasoning policy for the task. `auto` chooses a concrete level per agent chunk. */
  reasoningEffort: reasoningEffortSchema.optional(),
  runner: runnerSelectionSchema.optional(),
  /** Agent account for this task (spec 2026-07-29-agent-profiles). Omit to follow the
   *  project's own selection; an id that no longer exists is a 400, not a silent default. */
  agentProfile: z6.string().max(64).optional(),
  /** 1–3. Above 1 the response is `{ runs }` rather than a single record. */
  variants: z6.number().int().min(1).max(3).optional(),
  /** false → run in the repo working tree instead of an isolated worktree (read-only skills).
   *  Omit for the default. Ignored server-side when variants > 1. */
  worktree: z6.boolean().optional(),
  /** true → autonomous run: never parks at "waiting"; auto-continues until done. */
  autonomous: z6.boolean().optional(),
  /** false → keep the handoff journal but do not expose or request a follow-up todos file.
   *  Omit for the default (enabled); a server with the capability off pins it to false. */
  generateFollowups: z6.boolean().optional(),
  /** Per-run system-prompt override (R2 2.3) — programmatic callers only. Wins over the
   *  config.json default; whitespace-only degrades to absent. */
  systemPrompt: z6.string().trim().max(2e4, "must be at most 20000 characters").optional().transform((s) => s ? s : void 0),
  /** Screenshots pasted into the new-task form; delivered with the first agent step. */
  images: z6.array(imageInputSchema).max(4).optional(),
  /** The inbox entry this task came from (#374). Best-effort bookkeeping: an unknown or
   *  already-started id never fails the run. For ×2/×3 the FIRST variant is recorded. */
  todoId: z6.string().min(1).max(200, "must be at most 200 characters").optional()
});
var createRunInputSchema = createRunInputBaseSchema.refine(
  (b) => Boolean(b.workflow) !== Boolean(b.steps),
  { message: 'provide either "workflow" or "steps", not both' }
);
var messageInputSchema = z6.object({
  text: z6.string().max(1e5).default(""),
  images: z6.array(imageInputSchema).max(4).default([])
}).refine((m) => m.text.trim().length > 0 || m.images.length > 0, {
  message: "message needs text or at least one image"
});
var patchRunInputSchema = z6.object({
  title: z6.string().trim().min(1).max(300).optional(),
  task: z6.string().trim().min(1).max(1e5).optional()
});

// ../contract/src/repo.ts
import { z as z7 } from "zod";
var statusEntrySchema = z7.object({
  status: z7.string(),
  path: z7.string()
});
var logEntrySchema = z7.object({
  hash: z7.string(),
  subject: z7.string(),
  author: z7.string(),
  when: z7.string()
});
var repoResponseSchema = z7.union([
  z7.object({
    info: z7.null(),
    status: z7.array(z7.never()),
    log: z7.array(z7.never()),
    branches: z7.array(z7.never()),
    baseBranch: z7.null()
  }),
  z7.object({
    info: repoInfoSchema,
    status: z7.array(statusEntrySchema),
    log: z7.array(logEntrySchema),
    branches: z7.array(z7.string()),
    baseBranch: z7.string().nullable()
  })
]);
var repoBranchResponseSchema = z7.object({
  branch: z7.string(),
  created: z7.boolean()
});
var diffStatSchema2 = z7.object({
  adds: z7.number(),
  dels: z7.number(),
  files: z7.number()
});
var changedFileSchema = z7.object({
  path: z7.string(),
  /** Rename/copy source — present only when `status` is renamed/copied. */
  oldPath: z7.string().optional(),
  status: z7.enum(["added", "modified", "deleted", "renamed", "copied"]),
  adds: z7.number(),
  dels: z7.number(),
  /** Binary per numstat — there is no text patch to render. */
  binary: z7.boolean(),
  /** True when the path is one the raw-bytes route serves as an `<img>` (#365) — present only
   *  when true, so old clients that never read it stay correct. */
  image: z7.boolean().optional(),
  /** This file's unified-diff section; possibly `… (patch truncated)`, possibly empty. */
  patch: z7.string()
});
var changesPayloadSchema = z7.object({
  files: z7.array(changedFileSchema),
  stat: diffStatSchema2,
  /** Additive context for review tasks whose worktree HEAD no longer matches their own branch. */
  repointedHead: z7.object({ headBranch: z7.string(), taskBranch: z7.string() }).optional()
});
var repoCommitPayloadSchema = z7.object({
  sha: z7.string(),
  subject: z7.string(),
  author: z7.string(),
  /** Relative time ("3 hours ago") — same `%cr` format as the /api/v1/repo log. */
  when: z7.string(),
  files: z7.array(changedFileSchema),
  stat: diffStatSchema2
});
var worktreeDirEntrySchema = z7.object({
  name: z7.string(),
  type: z7.enum(["dir", "file"]),
  size: z7.number().optional()
});
var worktreeEntrySchema = z7.discriminatedUnion("type", [
  z7.object({
    type: z7.literal("dir"),
    path: z7.string(),
    entries: z7.array(worktreeDirEntrySchema)
  }),
  z7.object({
    type: z7.literal("file"),
    path: z7.string(),
    size: z7.number(),
    binary: z7.boolean(),
    tooLarge: z7.boolean(),
    content: z7.string().optional()
  })
]);
var worktreeRunStatusSchema = z7.enum([
  "queued",
  "running",
  "waiting",
  "review",
  "done",
  "failed",
  "cancelled"
]);
var worktreeInfoSchema = z7.object({
  runId: z7.string(),
  title: z7.string(),
  status: worktreeRunStatusSchema,
  branch: z7.string().nullable(),
  sizeBytes: z7.number().nullable(),
  finishedAt: z7.string().nullable(),
  reclaimable: z7.boolean()
});
var worktreesResponseSchema = z7.object({
  worktrees: z7.array(worktreeInfoSchema),
  totalBytes: z7.number().nullable(),
  keep: z7.number()
});
var reclaimWorktreesResponseSchema = z7.object({
  reclaimed: z7.array(z7.string())
});

// ../contract/src/ide.ts
import { z as z8 } from "zod";
var ideDirectoryQuerySchema = z8.object({
  path: z8.string().max(4096).optional()
}).strict();
var ideFileQuerySchema = z8.object({
  path: z8.string().min(1).max(4096)
}).strict();
var ideFileInputSchema = z8.object({
  path: z8.string().min(1).max(4096),
  content: z8.string().max(1e6)
}).strict();
var ideEntrySchema = z8.object({
  name: z8.string(),
  path: z8.string(),
  type: z8.enum(["dir", "file"]),
  size: z8.number().int().nonnegative().optional()
});
var ideDirectoryResponseSchema = z8.object({
  path: z8.string(),
  entries: z8.array(ideEntrySchema),
  truncated: z8.boolean()
});
var ideFileResponseSchema = z8.object({
  path: z8.string(),
  content: z8.string(),
  size: z8.number().int().nonnegative()
});

// ../contract/src/projects.ts
import { z as z9 } from "zod";
var projectListEntrySchema = z9.object({
  id: z9.string(),
  name: z9.string(),
  /** Absolute, realpath-normalized repo root. */
  root: z9.string(),
  addedAt: z9.string(),
  lastOpenedAt: z9.string(),
  source: z9.enum(["local", "checkout"]),
  /** `not-git` is fully usable (degraded single-queue mode); only `missing` blocks. */
  status: z9.enum(["ok", "missing", "not-git"]),
  /** Current branch when cheaply available (omitted e.g. on an unborn HEAD). */
  branch: z9.string().optional(),
  /** Which forge this project's remote belongs to (#698) — classified server-side from the
   *  remote URL alone. Gates the project group's GitHub nav item; omitted = no forge remote. */
  forge: z9.literal("github").optional(),
  /**
   * The remote's web root, `https://github.com/owner/repo`. Rebuilt server-side from the parsed
   * remote rather than passed through, so a remote carrying credentials cannot leak into the
   * cockpit. Omitted when the project has no forge remote.
   *
   * It exists for the cross-project surfaces: a run often knows a PR or issue only by NUMBER, and
   * the global Tasks page has one row per project, so it cannot use any single repo's base the
   * way a project-scoped view can. With this, every reference it shows is a link.
   */
  repoUrl: z9.string().optional(),
  /** Per-project cap on concurrently running tasks (spec 2026-07-22). Omitted = inherit the
   *  workspace `resources.maxParallel`; a number pins this project. */
  maxParallel: z9.number().optional(),
  /**
   * Free-form labels grouping CONNECTED repositories — a `storefront` tag on the API, the web
   * app and the design system says those three are one piece of work spread over three repos.
   * The global Tasks page (`/tasks`) filters and groups by them.
   *
   * Omitted rather than `[]` when a project has none, exactly like `maxParallel`: the registry
   * stores nothing for a project nobody has tagged, and an empty array on the wire would make
   * "never tagged" indistinguishable from "tagged, then emptied" for no gain. Normalized
   * server-side (trimmed, deduped case-insensitively, sorted), so a consumer may compare them
   * directly.
   */
  tags: z9.array(z9.string()).optional()
});
var projectsResponseSchema = z9.object({
  projects: z9.array(projectListEntrySchema),
  bootProject: z9.string(),
  projectsDir: z9.string()
});
var registerProjectResponseSchema = z9.object({
  project: projectListEntrySchema,
  error: z9.string().optional()
});
var removeProjectResponseSchema = z9.object({
  removed: z9.literal(true),
  id: z9.string()
});
var updateProjectResponseSchema = z9.object({
  project: projectListEntrySchema
});
var PROJECT_TAG_MAX_LENGTH = 32;
var PROJECT_TAGS_MAX = 20;
var updateProjectInputSchema = z9.object({
  maxParallel: z9.number().int().min(1).max(16).nullable().optional(),
  tags: z9.array(z9.string().trim().min(1).max(PROJECT_TAG_MAX_LENGTH)).max(PROJECT_TAGS_MAX).nullable().optional()
}).refine(
  (body) => body.maxParallel !== void 0 || body.tags !== void 0,
  "specify maxParallel or tags"
);
var checkoutProjectInputSchema = z9.object({
  url: z9.string().trim().min(1).max(512),
  name: z9.string().trim().max(128).optional(),
  checkoutId: z9.string().trim().max(128).optional()
});
var fsBrowseDirSchema = z9.object({
  name: z9.string(),
  path: z9.string(),
  /** Has a `.git` entry — drives the "git" badge. A non-repo folder is still selectable. */
  isRepo: z9.boolean()
});
var fsBrowseResponseSchema = z9.object({
  /** The realpath'd directory actually listed — never the spelling asked for, so the breadcrumb
   *  shows where the picker really is. */
  path: z9.string(),
  /** `null` AT the browse root: there is no "up" out of it, and the dialog must render no parent
   *  row rather than one that 400s. */
  parent: z9.string().nullable(),
  dirs: z9.array(fsBrowseDirSchema),
  /** True when the listing was capped server-side — surfaced honestly instead of showing a
   *  silently short list. */
  truncated: z9.boolean()
});
var launchKeyResponseSchema = z9.object({
  key: z9.string()
});

// ../contract/src/workspace.ts
import { z as z10 } from "zod";
var workspaceConfigResponseSchema = z10.object({
  /** Root exposed by the Add-project directory browser — stored as written (`~` kept). */
  browseRoot: z10.string(),
  /** Checkout root for GUI-cloned projects — stored as written (`~` kept). */
  projectsDir: z10.string(),
  /** Stored override; `null` means inherit `CEZ_SKILLS_AUTO_UPDATE`, then true. */
  skillsAutoUpdate: z10.boolean().nullable(),
  effectiveSkillsAutoUpdate: z10.boolean(),
  composerDefaults: z10.object({
    autonomous: z10.boolean().nullable(),
    worktree: z10.boolean().nullable(),
    /** The environment-derived fallback when no workspace override is stored. */
    inheritedAutonomous: z10.union([z10.boolean(), z10.literal("source-dependent")]),
    inheritedWorktree: z10.boolean()
  }),
  resources: z10.object({
    maxParallel: z10.number(),
    maxMonitoringSessions: z10.number(),
    monitoringWakeIntervalMinutes: z10.number().nullable(),
    /** Resume a run a provider usage limit stopped, once the limit resets. Default `true`. */
    autoResumeOnUsageLimit: z10.boolean(),
    /** Start a fresh provider context after each completed in-session plan item. Default `false`. */
    intelligentContextRefresh: z10.boolean(),
    memoryLimitMb: z10.number().nullable(),
    worktreeRetentionDefault: z10.number()
  }),
  /** Absent means quota-aware routing is disabled (the zero-config default). */
  quotaRouting: z10.object({
    enabled: z10.literal(true),
    providerOrder: z10.tuple([z10.enum(["claude", "codex"]), z10.enum(["claude", "codex"])]),
    unknownUsagePolicy: z10.enum(["allow", "deny"])
  }).optional(),
  /**
   * What a repo that has set none of its own runs (spec 2026-07-29-agent-profiles).
   *
   * Both keys are OPTIONAL on the wire, and that is load-bearing rather than lax: absent means
   * "this machine has no opinion, the built-in default applies", and it has to stay distinguishable
   * from a value someone chose or the fallback collapses into "always claude". Consulted only where
   * the repo's own `.ai/cezar/config.json` is silent — a repo that chose is never overruled.
   */
  agentDefaults: z10.object({
    runner: runnerSelectionSchema.optional(),
    models: z10.object({
      claude: z10.string().optional(),
      codex: z10.string().optional(),
      opencode: z10.string().optional(),
      pi: z10.string().optional()
    }).optional()
  })
});
var setWorkspaceConfigInputSchema = z10.object({
  browseRoot: z10.string().trim().min(1).max(4096).optional(),
  projectsDir: z10.string().trim().min(1).max(4096).optional(),
  skillsAutoUpdate: z10.boolean().nullable().optional(),
  composerDefaults: z10.object({
    autonomous: z10.boolean().nullable().optional(),
    worktree: z10.boolean().nullable().optional()
  }).optional(),
  /** Machine-wide agent defaults. `null` on a key CLEARS it back to "no opinion", which a bare
   *  absent key cannot say in a partial patch. */
  agentDefaults: z10.object({
    runner: runnerSelectionSchema.nullable().optional(),
    models: z10.object({
      claude: z10.string().trim().min(1).max(200).nullable().optional(),
      codex: z10.string().trim().min(1).max(200).nullable().optional(),
      opencode: z10.string().trim().min(1).max(200).nullable().optional(),
      pi: z10.string().trim().min(1).max(200).nullable().optional()
    }).optional()
  }).optional(),
  quotaRouting: z10.object({ enabled: z10.boolean().optional() }).optional(),
  resources: z10.object({
    maxParallel: z10.number().int().min(1).max(16).optional(),
    maxMonitoringSessions: z10.number().int().min(0).max(16).optional(),
    monitoringWakeIntervalMinutes: z10.number().int().min(1).max(60).nullable().optional(),
    autoResumeOnUsageLimit: z10.boolean().optional(),
    intelligentContextRefresh: z10.boolean().optional(),
    memoryLimitMb: z10.number().int().min(0).max(1048576).nullable().optional(),
    worktreeRetentionDefault: z10.number().int().min(0).max(1e3).optional()
  }).optional()
});
var providerUsageSnapshotSchema = z10.object({
  provider: z10.enum(["claude", "codex"]),
  profileId: z10.string(),
  health: z10.enum(["available", "soft_exhausted", "hard_exhausted", "auth_error", "unavailable", "unknown"]),
  fetchedAt: z10.string(),
  source: z10.string(),
  stale: z10.boolean(),
  windows: z10.array(z10.object({
    kind: z10.enum(["short", "long", "model", "unknown"]),
    usedPercent: z10.number().nullable(),
    resetsAt: z10.string().optional(),
    hardLimitReached: z10.boolean().optional()
  })),
  error: z10.object({ code: z10.string(), message: z10.string() }).optional()
});
var workspaceUsageResponseSchema = z10.object({ providers: z10.array(providerUsageSnapshotSchema) });
var appearanceSchema = z10.object({
  accent: z10.enum(["lime", "violet"]).optional(),
  density: z10.enum(["comfortable", "compact", "ultra"]).optional(),
  width: z10.enum(["narrow", "wide"]).optional()
});
var taskTableUiStateSchema = z10.looseObject({
  /** Explicit user choices only. Missing ids keep the registry-owned default. */
  expandedColumns: z10.record(z10.string(), z10.boolean()).optional()
});
var taskSourceSchema = z10.union([
  z10.object({ source: z10.literal("baseline") }),
  z10.object({ source: z10.enum(["workflow", "skill"]), ref: z10.string().min(1).max(200) })
]);
var uiStateSchema = z10.looseObject({
  lastTask: taskSourceSchema.optional(),
  /** Most-recently-run sources, newest first (deduped, capped). Feeds the composer picker's
   *  recency sort. */
  recentSources: z10.array(taskSourceSchema).optional(),
  /** The last worktree choice for a single-skill run. Absent → the default (isolated worktree). */
  lastWorktree: z10.boolean().optional(),
  /** The last autonomous choice — remembered like `lastWorktree`. Absent → off. */
  lastAutonomous: z10.boolean().optional(),
  /** Whether new runs should ask agents to append follow-up work. Absent → on. */
  lastGenerateFollowups: z10.boolean().optional(),
  /** Skill selection frequency (#408): name → times chosen, across BOTH composers. */
  skillUsage: z10.record(z10.string(), z10.number()).optional(),
  runsView: z10.enum(["list", "table"]).optional(),
  /** The GitHub tab's last-selected sub-tab (#417). Absent → issues. */
  githubView: z10.enum(["issues", "prs"]).optional(),
  /** Settings → Appearance. The theme itself stays in localStorage (`cez-theme`) — it must
   *  pre-paint, and it is per-browser by design. */
  appearance: appearanceSchema.optional(),
  /** Follow-up prompt templates (#413). Absent → the built-in defaults; present (even `[]`) is
   *  the user's own edited list. `skills` are the skill names the template auto-applies for. */
  promptTemplates: z10.array(
    z10.object({
      id: z10.string(),
      label: z10.string(),
      text: z10.string(),
      skills: z10.array(z10.string()).optional()
    })
  ).optional(),
  /** The open-mercato/skills promo banner (#391), dismissed for good. Legacy — the banner is
   *  gone, replaced by `WorkspaceUiState.importedSkills`; retained so old files round-trip. */
  dismissedSkillsBanner: z10.boolean().optional()
});
var workspaceLastLocationSchema = z10.strictObject({
  projectId: z10.string().min(1).max(64),
  pathname: z10.string().min(1).max(2048).startsWith("/p/"),
  search: z10.string().max(4096).startsWith("?").optional(),
  hash: z10.string().max(2048).startsWith("#").optional()
});
var workspaceUiStateSchema = z10.looseObject({
  /** LEGACY — the sidebar's per-project collapse map (step 3.3). Still accepted and still
   *  round-tripped so an older cockpit sharing this home keeps working, but the current cockpit
   *  neither reads nor writes it: which groups are shut describes the WINDOW, not the workspace,
   *  so it lives in that browser's localStorage (`packages/web/src/lib/sidebar-collapse.ts`).
   *  One shared answer meant a phone collapsing a group collapsed it on the desktop too. */
  sidebar: z10.looseObject({ collapsed: z10.record(z10.string(), z10.boolean()).optional() }).optional(),
  /** Dismissed runtime-auth incident IDs, keyed by provider. An ID is only dismissed until the
   *  provider reports a different incident, so this stays workspace-global with the browser
   *  rather than one project checkout. */
  dismissedProviderAuthFailures: z10.object({
    claude: z10.string().optional(),
    codex: z10.string().optional(),
    opencode: z10.string().optional(),
    pi: z10.string().optional()
  }).optional(),
  /** Settings → Appearance, GLOBAL since step 3.5: accent + density describe the person at the
   *  keyboard, not a repo. */
  appearance: appearanceSchema.optional(),
  /** Settings → Notifications, GLOBAL since step 3.5 — one answer for the whole workspace, since
   *  the delivering browser is one browser whichever project you are looking at. */
  notifications: z10.looseObject({ enabled: z10.boolean().optional() }).optional(),
  /** Desktop Tasks-table density, shared across every project in this workspace. */
  taskTable: taskTableUiStateSchema.optional(),
  /** LEGACY, exactly like `sidebar` above — the last settled project-scoped page, restored when
   *  entering at the exact bare root. The shape is unchanged and still accepted, but the current
   *  cockpit keeps it in localStorage (`packages/web/src/lib/last-location.ts`): stored here, the
   *  last client to navigate decided where every OTHER client's next launch landed. */
  lastLocation: workspaceLastLocationSchema.optional(),
  /** The user's curated selection of default (vendor) skills. Tri-state: ABSENT means "not
   *  curated", so every default skill shows; a PRESENT array (even `[]`) means only those names
   *  show from that repo. */
  importedSkills: z10.array(z10.string()).optional()
});
var WORKSPACE_UI_STATE_MAX_KEYS = 200;
var TASK_TABLE_MAX_COLUMNS = 50;
var setWorkspaceUiStateInputSchema = z10.looseObject({
  ...workspaceUiStateSchema.shape,
  sidebar: z10.looseObject({
    collapsed: z10.record(z10.string().min(1).max(64), z10.boolean()).refine((map) => Object.keys(map).length <= WORKSPACE_UI_STATE_MAX_KEYS, {
      message: `sidebar.collapsed must have at most ${WORKSPACE_UI_STATE_MAX_KEYS} entries`
    }).optional()
  }).optional(),
  dismissedProviderAuthFailures: z10.strictObject({
    claude: z10.string().min(1).max(128).optional(),
    codex: z10.string().min(1).max(128).optional(),
    opencode: z10.string().min(1).max(128).optional(),
    pi: z10.string().min(1).max(128).optional()
  }).optional(),
  importedSkills: z10.array(z10.string().min(1).max(200)).max(WORKSPACE_UI_STATE_MAX_KEYS).optional(),
  taskTable: taskTableUiStateSchema.extend({
    expandedColumns: z10.record(z10.string().min(1).max(64), z10.boolean()).refine((map) => Object.keys(map).length <= TASK_TABLE_MAX_COLUMNS, {
      message: `taskTable.expandedColumns must have at most ${TASK_TABLE_MAX_COLUMNS} entries`
    }).optional()
  }).optional()
}).superRefine((data, ctx) => {
  if (Object.keys(data).length > WORKSPACE_UI_STATE_MAX_KEYS) {
    ctx.addIssue({
      code: "custom",
      message: `ui-state has too many keys (max ${WORKSPACE_UI_STATE_MAX_KEYS})`
    });
  }
});
var runnerModelsSchema = z10.object({
  claude: z10.string().optional(),
  codex: z10.string().optional(),
  opencode: z10.string().optional(),
  pi: z10.string().optional()
});
var configResponseSchema = z10.object({
  baseBranch: z10.string().nullable(),
  defaultRunner: runnerSelectionSchema,
  systemPrompt: z10.string().nullable(),
  defaultModels: runnerModelsSchema,
  /** True when native coding-agent settings are authoritative and model picks are read-only. */
  modelsLocked: z10.boolean(),
  /** How many tasks run at once (1–16). */
  maxParallel: z10.number(),
  /** Per-task memory ceiling in MiB (whole process tree); null = no limit. */
  memoryLimitMb: z10.number().nullable(),
  /** Keep the last N finished worktrees on disk (#483); 0 = unlimited. Older ones are reclaimed
   *  (directory only — branch kept, so work is recoverable). */
  worktreeRetention: z10.number(),
  /** Live title updates: null = no config key, the `CEZ_TITLE_UPDATES` env default (ON) decides. */
  liveTitleUpdates: z10.boolean().nullable(),
  /** Optional review gate (#489): null = no config key, the `CEZ_REVIEW_GATE` env default (OFF)
   *  decides. */
  reviewGate: z10.boolean().nullable()
});
var setConfigResponseSchema = configResponseSchema;
var setConfigInputSchema = z10.object({
  baseBranch: z10.string().trim().min(1).max(200).nullable().optional(),
  defaultRunner: runnerSelectionSchema.optional(),
  systemPrompt: z10.string().trim().max(2e4).nullable().optional(),
  defaultModels: z10.object({
    claude: z10.string().trim().max(200).nullable().optional(),
    codex: z10.string().trim().max(200).nullable().optional(),
    opencode: z10.string().trim().max(200).nullable().optional(),
    pi: z10.string().trim().max(200).nullable().optional()
  }).optional(),
  maxParallel: z10.number().int().min(1).max(16).optional(),
  /** null or 0 clears the ceiling back to "no limit". */
  memoryLimitMb: z10.number().int().min(0).max(1048576).nullable().optional(),
  /** Keep last N finished worktrees (#483); 0 = unlimited, null clears back to the default (10). */
  worktreeRetention: z10.number().int().min(0).max(1e3).nullable().optional(),
  /** null clears the key back to the env-default behavior. */
  liveTitleUpdates: z10.boolean().nullable().optional(),
  /** null clears the key back to the env-default behavior (OFF). */
  reviewGate: z10.boolean().nullable().optional()
});
var skillsUpdateStatusSchema = z10.enum([
  "idle",
  "checking",
  "available",
  "updating",
  "current",
  "unavailable",
  "error"
]);
var skillsUpdateScopeStateSchema = z10.object({
  scope: z10.enum(["project", "global"]),
  status: skillsUpdateStatusSchema,
  available: z10.boolean(),
  skills: z10.array(z10.string()),
  checkedAt: z10.string().nullable(),
  updatedAt: z10.string().nullable(),
  reason: z10.string().optional()
});
var skillsUpdateStateSchema = z10.object({
  status: skillsUpdateStatusSchema,
  available: z10.boolean(),
  autoUpdateEnabled: z10.boolean(),
  inherited: z10.boolean(),
  checkedAt: z10.string().nullable(),
  updatedAt: z10.string().nullable(),
  scopes: z10.array(skillsUpdateScopeStateSchema),
  needsUpgradeNotes: z10.boolean()
});
var providerIdSchema = runnerSchema;
var providerConnectionStateSchema = z10.enum([
  "connected",
  "disconnected",
  "not-installed",
  "unknown"
]);
var providerStatusSchema = z10.object({
  provider: providerIdSchema,
  status: providerConnectionStateSchema,
  enabled: z10.boolean().optional(),
  hint: z10.string().optional(),
  authFailureId: z10.string().optional(),
  /** Which agent account this row describes (spec 2026-07-29-agent-profiles). ABSENT on
   *  `GET /api/v1/providers/status`, which deliberately keeps answering exactly one row per
   *  provider — the discovered default — so an older client sees no change at all. Per-account
   *  rows are carried by `GET /api/v1/workspace/agent-profiles` instead. */
  profileId: z10.string().optional()
});
var providerStatusResponseSchema = z10.object({
  providers: z10.array(providerStatusSchema)
});
var providerConnectResponseSchema = z10.discriminatedUnion("opened", [
  z10.object({ opened: z10.literal(true), command: z10.string() }),
  z10.object({ opened: z10.literal(false), connected: z10.literal(true), command: z10.string() })
]);
var modelDiscoveryRunnerSchema = z10.enum(["codex", "opencode"]);
var MODEL_DISCOVERY_RUNNERS = modelDiscoveryRunnerSchema.options;
function runnerDiscoversModels(runner) {
  return MODEL_DISCOVERY_RUNNERS.includes(runner);
}
var runnerModelOptionSchema = z10.object({
  id: z10.string(),
  label: z10.string(),
  description: z10.string(),
  /** Model-advertised effort levels, when the backend exposes them. */
  reasoningEfforts: z10.array(z10.string().min(1)).optional()
});
var runnerModelCatalogResponseSchema = z10.object({
  runner: runnerSchema,
  models: z10.array(runnerModelOptionSchema),
  source: z10.enum(["live", "cache", "unavailable"]),
  stale: z10.boolean(),
  reason: z10.string().optional()
});
var openTargetSchema = z10.object({
  id: z10.string(),
  label: z10.string(),
  /** A stable icon key (#361) the UI maps to a concrete icon. Optional: an older server omitting
   *  it just renders the generic fallback icon. */
  icon: z10.string().optional()
});
var openTargetsResponseSchema = z10.object({
  targets: z10.array(openTargetSchema)
});
var openProjectInSchema = z10.object({
  // A short bound (#429): matched against a downstream allowlist, so an app id is never long.
  target: z10.string().trim().min(1, "target required").max(200)
});
var openProjectInResponseSchema = z10.object({
  opened: z10.literal(true),
  path: z10.string()
});

// ../contract/src/skills.ts
import { z as z11 } from "zod";
var skillSchema = z11.object({
  name: z11.string(),
  description: z11.string().optional(),
  /** Advisory hint for untouched composer run-mode choices. */
  interactive: z11.literal(true).optional(),
  body: z11.string(),
  path: z11.string(),
  source: z11.enum(["ai", "cezar", "agents", "global", "team"]),
  /** Team skills only: where the definition lives in its skills repo. */
  team: z11.object({
    repo: z11.string(),
    ref: z11.string(),
    path: z11.string(),
    /** True for the `SKILL.md` convention — a whole directory (references/…). */
    dir: z11.boolean(),
    /**
     * The exact commit `ref` resolved to when the skill was read (#428).
     *
     * The hand-written DTO omitted this field entirely — it was NARROWER than the route,
     * which has served it since #428.
     */
    commit: z11.string().optional()
  }).optional()
});
var importableSkillSchema = z11.object({
  name: z11.string(),
  description: z11.string().optional()
});
var todoItemSchema = z11.object({
  id: z11.string(),
  ts: z11.string().optional(),
  taskId: z11.string().optional(),
  summary: z11.string().min(1),
  action: z11.string().optional(),
  prUrl: z11.string().optional(),
  suggestedSkill: z11.string().optional(),
  suggestedArgs: z11.string().optional(),
  suggestedPrompt: z11.string().optional(),
  /** Explicit intent; missing infers from suggestedSkill/suggestedPrompt for old files. */
  runnable: z11.boolean().optional(),
  /** Set once a task was started from this entry — it then leaves the inbox and stays as
   *  the audit trail. A later launch never overwrites the first. */
  startedTaskId: z11.string().optional()
});
var removeTodoResponseSchema = z11.object({
  removed: z11.literal(true)
});
var startTodoResponseSchema = z11.object({
  run: runRecordSchema
});

// ../contract/src/agent-config.ts
import { z as z12 } from "zod";
var agentConfigFormatSchema = z12.enum(["json", "jsonc", "toml", "markdown"]);
var agentConfigScopeSchema = z12.enum(["user", "project", "local"]);
var agentConfigKindSchema = z12.enum(["settings", "memory", "mcp"]);
var agentConfigTrackedSchema = z12.enum(["tracked", "gitignored", "outside-repo"]);
var agentConfigFileSchema = z12.object({
  /** Stable, opaque, URL-safe — the ONLY thing a client may name (traversal-proof). */
  id: z12.string(),
  /** Every runner that reads this file: `<repo>/AGENTS.md` is one file, two readers. */
  runners: z12.array(runnerSchema),
  kind: agentConfigKindSchema,
  scope: agentConfigScopeSchema,
  label: z12.string(),
  path: z12.string(),
  format: agentConfigFormatSchema,
  tracked: agentConfigTrackedSchema,
  seeded: z12.boolean(),
  holdsMcp: z12.boolean(),
  /** VERBATIM from the vendor docs. Never computed, never generic. */
  precedence: z12.string(),
  /** Documented mid-run reload behaviour, or absent when the vendor is silent. */
  hotReload: z12.string().optional(),
  docsUrl: z12.string(),
  exists: z12.boolean(),
  size: z12.number(),
  /** sha256 of the bytes, or null when absent. */
  version: z12.string().nullable(),
  /** False in hosted mode (whole feature) — the client renders read-only up front. */
  writable: z12.boolean(),
  readOnlyReason: z12.string().optional()
});
var userMcpListingSchema = z12.object({
  path: z12.string(),
  servers: z12.array(z12.string()),
  readable: z12.boolean()
});
var agentConfigListingSchema = z12.object({
  editable: z12.boolean(),
  files: z12.array(agentConfigFileSchema),
  /** null in hosted mode (host-state disclosure guard). */
  userMcp: userMcpListingSchema.nullable()
});
var agentConfigFileContentSchema = z12.object({
  id: z12.string(),
  path: z12.string(),
  exists: z12.boolean(),
  content: z12.string(),
  /** sha256 of the bytes, or null when the file does not exist yet. */
  version: z12.string().nullable()
});
var setAgentConfigInputSchema = z12.object({
  content: z12.string().max(2e6),
  version: z12.string().nullable()
});

// ../contract/src/agent-profiles.ts
import { z as z13 } from "zod";
var DEFAULT_AGENT_ACCOUNT_ID = "default";
var agentAccountFileSchema = z13.object({
  id: z13.string(),
  /** e.g. `settings.json` — the file's own name, since the folder is shown once on the account. */
  label: z13.string(),
  /** Absolute, resolved inside this account's config folder. */
  path: z13.string(),
  exists: z13.boolean()
});
var agentProfileSchema = z13.object({
  /** `default` for the discovered profile, else the stored slug. */
  id: z13.string(),
  provider: providerIdSchema,
  label: z13.string(),
  /** As the user wrote it — a literal `~` is preserved, matching `browseRoot`/`projectsDir`. */
  configDir: z13.string(),
  /** Expanded absolute path. Same-origin route, like `ProjectListEntry.root`. */
  path: z13.string(),
  /** False for a dir the CLI has not created yet — legitimate, and NOT a reason to fall back
   *  to another account at run time (that would silently bill the wrong subscription). */
  exists: z13.boolean(),
  /** Whether the dir carries this agent's own marker files. ADVISORY: an unrecognised dir is
   *  still accepted, because "add profile → Connect → the CLI creates it" is the real flow. */
  looksValid: z13.boolean(),
  /** True for the profile cezar discovers from the environment. Never stored, never deletable. */
  isDefault: z13.boolean(),
  /** This account's own authentication state — two Claude logins answer independently.
   *
   *  **Absent until the probe has warmed.** Every probe shells out to an agent CLI, and this
   *  listing refuses to pay that (it would be one spawn per provider plus one per account, on
   *  every cold load); it serves only what is already cached, exactly as `GET /api/v1/health`
   *  serves a cached forge answer. Absent means "not determined yet" — NOT `unknown`, which is a
   *  real probe result — and the cockpit fills it in from `…/:id/status`. */
  status: providerStatusSchema.optional(),
  /** This agent's own user-scope config files, resolved inside THIS account's folder — so a
   *  second login's `settings.json` is the one you open, not the default account's. */
  files: z13.array(agentAccountFileSchema)
});
function agentAccountRouteId(profile) {
  return profile.isDefault ? `default:${profile.provider}` : profile.id;
}
var agentAccountSelectionSchema = z13.object({
  claude: z13.string().optional(),
  codex: z13.string().optional(),
  opencode: z13.string().optional(),
  pi: z13.string().optional()
});
var agentProfilesResponseSchema = z13.object({
  editable: z13.boolean(),
  profiles: z13.array(agentProfileSchema),
  /** Providers that can carry more than one account at all — what "Add account" is offered for.
   *  OpenCode is absent: its credentials live in a SQLite DB behind a separate `OPENCODE_DB`, so
   *  a config-dir profile would swap settings while still billing the other account. */
  profileCapableProviders: z13.array(providerIdSchema),
  /** Which account each project uses, keyed by the project's realpath'd ROOT.
   *
   *  Served here rather than on `GET /api/v1/projects` because it is stored beside the accounts it
   *  names (`~/.cezar/agent-accounts.json`) — one file, so deleting an account and scrubbing every
   *  reference to it is one atomic write, and neither can be dropped by a cezar version that never
   *  heard of accounts. Empty in hosted mode, where the whole family is withheld. */
  selections: z13.record(z13.string(), agentAccountSelectionSchema),
  /** The machine-wide fallback account per provider, used by any repo that has chosen none. */
  defaults: agentAccountSelectionSchema
});
var selectAgentProfileInputSchema = z13.object({
  /**
   * Registry slug, or the reserved `default` boot alias. Resolved to a root server-side.
   *
   * `null` targets the MACHINE-WIDE default instead of one repo — the account a repo that has
   * chosen nothing uses, so a second login is set up once rather than per checkout. A repo's own
   * choice always wins over it, which is what keeps this a default and not an override.
   */
  projectId: z13.string().min(1).max(64).nullable(),
  provider: providerIdSchema,
  profileId: z13.string().max(64).nullable()
});
var agentProfileSelectionsResponseSchema = z13.object({
  selections: z13.record(z13.string(), agentAccountSelectionSchema),
  /** The machine-wide fallback, for repos with no selection of their own. */
  defaults: agentAccountSelectionSchema
});
var agentAccountStatusResponseSchema = z13.object({ status: providerStatusSchema });
var agentAccountDetailsResponseSchema = z13.object({
  available: z13.boolean(),
  reason: z13.string().optional(),
  fields: z13.array(z13.object({ label: z13.string(), value: z13.string() }))
});
var openAgentAccountFileInputSchema = z13.object({
  file: z13.string().min(1).max(200),
  target: z13.string().min(1).max(64).optional()
});
var openAgentAccountFileResponseSchema = z13.object({
  opened: z13.literal(true),
  path: z13.string()
});
var createAgentProfileInputSchema = z13.object({
  provider: providerIdSchema,
  label: z13.string().trim().max(200).optional(),
  /** Stored as written; validated absolute after `~` expansion, server-side. */
  configDir: z13.string().trim().min(1).max(4096)
});
var agentProfileResponseSchema = z13.object({ profile: agentProfileSchema });
var updateAgentProfileInputSchema = z13.object({
  label: z13.string().trim().max(200).optional(),
  configDir: z13.string().trim().min(1).max(4096).optional()
});
var removeAgentProfileResponseSchema = z13.object({
  removed: z13.literal(true),
  id: z13.string()
});

// ../contract/src/automations.ts
import { z as z14 } from "zod";
var automationEventSchema = z14.enum([
  "pull_request.opened",
  "issue.opened",
  "issue.labeled",
  "issue.unlabeled"
]);
var automationFiltersSchema = z14.object({
  authors: z14.array(z14.string()).optional(),
  assignees: z14.array(z14.string()).optional(),
  allLabels: z14.array(z14.string()).optional(),
  anyLabels: z14.array(z14.string()).optional(),
  excludeLabels: z14.array(z14.string()).optional(),
  /** Required for the two label events — the server rejects a definition without it. */
  changedLabels: z14.array(z14.string()).optional(),
  lookbackDays: z14.number(),
  maxRecords: z14.number()
});
var automationTaskSchema = createRunInputBaseSchema.omit({ task: true, images: true, todoId: true, systemPrompt: true }).extend({
  /** The prompt template. `{{github.number}}`, `{{github.title}}`, `{{github.url}}` and
   *  `{{github.labels}}` are substituted per match; GitHub content is appended as untrusted
   *  context, never interpolated into instructions. */
  prompt: z14.string(),
  variants: z14.union([z14.literal(1), z14.literal(2), z14.literal(3)]).optional(),
  systemPrompt: z14.string().optional()
});
var automationDefinitionSchema = z14.object({
  id: z14.string(),
  /** Bumped on every edit; a PUT must echo the revision it read (optimistic concurrency). */
  revision: z14.number(),
  name: z14.string(),
  description: z14.string().optional(),
  /** Always present: the storage schema defaults it to `false`, so a definition is created
   *  PAUSED and enabling it is a separate, baseline-establishing act. */
  enabled: z14.boolean(),
  events: z14.array(automationEventSchema),
  intervalSeconds: z14.number(),
  filters: automationFiltersSchema,
  task: automationTaskSchema,
  createdAt: z14.string(),
  updatedAt: z14.string()
});
var automationCursorSchema = z14.object({
  timestamp: z14.string(),
  tieBreaker: z14.string().optional()
});
var automationRuntimeStateSchema = z14.object({
  /** The definition revision this state belongs to; a bumped revision re-baselines. */
  revision: z14.number().optional(),
  /** Enabling establishes a CURRENT-TIME baseline: records older than this never launch. */
  baselineAt: z14.string().optional(),
  cursor: automationCursorSchema.optional(),
  frozenHighWatermark: automationCursorSchema.extend({ tieBreaker: z14.string() }).optional(),
  backlogAfter: automationCursorSchema.extend({ tieBreaker: z14.string() }).optional(),
  nextCheckAt: z14.string().optional(),
  lastSuccessAt: z14.string().optional(),
  /** Per-query GitHub ETags, so an unchanged page costs no rate-limit budget. */
  etags: z14.record(z14.string(), z14.string()).optional(),
  backoffUntil: z14.string().optional(),
  consecutiveFailures: z14.number().optional()
});
var automationLogResultSchema = z14.enum([
  "launched",
  "no-match",
  "duplicate",
  "rate-limited",
  "error",
  "baseline",
  "preview"
]);
var automationLogRecordSchema = z14.object({
  seq: z14.number(),
  ts: z14.string(),
  automationId: z14.string(),
  revision: z14.number(),
  event: automationEventSchema.optional(),
  result: automationLogResultSchema,
  reason: z14.string().optional(),
  durationMs: z14.number().optional(),
  receiptId: z14.string().optional(),
  runId: z14.string().optional(),
  githubNumber: z14.number().optional(),
  githubTitle: z14.string().optional(),
  githubUrl: z14.string().optional(),
  rateLimit: z14.object({
    bucket: z14.enum(["core", "search"]),
    remaining: z14.number().optional(),
    resetAt: z14.string().optional()
  }).optional()
});
var automationCountsSchema = z14.object({
  matches: z14.number(),
  launched: z14.number(),
  duplicates: z14.number(),
  errors: z14.number()
});
var automationListEntrySchema = automationDefinitionSchema.extend({
  state: automationRuntimeStateSchema.optional(),
  latestLog: automationLogRecordSchema.optional(),
  counts: automationCountsSchema
});
var automationsResponseSchema = z14.object({
  available: z14.boolean(),
  reason: z14.string().optional(),
  scheduler: z14.object({
    state: z14.enum(["scheduled", "idle"]),
    nextDue: z14.string().optional()
  }),
  automations: z14.array(automationListEntrySchema)
});
var automationResponseSchema = z14.object({ automation: automationDefinitionSchema });
var automationDetailResponseSchema = z14.object({
  automation: automationDefinitionSchema,
  state: automationRuntimeStateSchema.optional(),
  latestLog: automationLogRecordSchema.optional()
});
var automationCheckSchema = z14.object({
  id: z14.string(),
  automationId: z14.string(),
  mode: z14.enum(["preview", "execute"]),
  status: z14.enum(["queued", "running", "complete", "error"]),
  createdAt: z14.string(),
  completedAt: z14.string().optional(),
  matches: z14.number().optional(),
  truncated: z14.boolean().optional(),
  error: z14.string().optional()
});
var automationCheckQueuedResponseSchema = z14.object({ checkId: z14.string() });
var automationLogResponseSchema = z14.object({
  records: z14.array(automationLogRecordSchema)
});
var automationRetryResponseSchema = z14.object({
  receiptId: z14.string(),
  runId: z14.string()
});
var createAutomationInputSchema = automationDefinitionSchema.omit({ id: true, revision: true, createdAt: true, updatedAt: true, enabled: true }).extend({ enable: z14.boolean().optional() });
var updateAutomationInputSchema = createAutomationInputSchema.omit({ enable: true }).extend({
  enabled: z14.boolean().optional(),
  expectedRevision: z14.number()
});
var automationCheckInputSchema = z14.object({
  mode: z14.enum(["preview", "execute"])
});
export {
  DEFAULT_AGENT_ACCOUNT_ID,
  MODEL_DISCOVERY_RUNNERS,
  PROJECT_TAGS_MAX,
  PROJECT_TAG_MAX_LENGTH,
  REFERENCE_STATUS_MAX,
  RUN_HISTORY_PAGE_ITEMS,
  agentAccountDetailsResponseSchema,
  agentAccountFileSchema,
  agentAccountRouteId,
  agentAccountSelectionSchema,
  agentAccountStatusResponseSchema,
  agentConfigFileContentSchema,
  agentConfigFileSchema,
  agentConfigFormatSchema,
  agentConfigKindSchema,
  agentConfigListingSchema,
  agentConfigScopeSchema,
  agentConfigTrackedSchema,
  agentProfileResponseSchema,
  agentProfileSchema,
  agentProfileSelectionsResponseSchema,
  agentProfilesResponseSchema,
  apiRunSchema,
  archiveFinishedResponseSchema,
  automationCheckInputSchema,
  automationCheckQueuedResponseSchema,
  automationCheckSchema,
  automationCountsSchema,
  automationCursorSchema,
  automationDefinitionSchema,
  automationDetailResponseSchema,
  automationEventSchema,
  automationFiltersSchema,
  automationListEntrySchema,
  automationLogRecordSchema,
  automationLogResponseSchema,
  automationLogResultSchema,
  automationResponseSchema,
  automationRetryResponseSchema,
  automationRuntimeStateSchema,
  automationTaskSchema,
  automationsResponseSchema,
  backendCheckSchema,
  cancelAutoResumeResponseSchema,
  cancelResponseSchema,
  capabilitiesSchema,
  changedFileSchema,
  changesPayloadSchema,
  checkoutProgressEventSchema,
  checkoutProjectInputSchema,
  concreteReasoningEffortSchema,
  configResponseSchema,
  continueResponseSchema,
  createAgentProfileInputSchema,
  createAutomationInputSchema,
  createPrResponseSchema,
  createRunInputBaseSchema,
  createRunInputSchema,
  createRunResponseSchema,
  deleteRunResponseSchema,
  deleteWorkflowResponseSchema,
  diffStatSchema,
  editQueuedMessageResponseSchema,
  finishResponseSchema,
  forgeInfoSchema,
  fsBrowseDirSchema,
  fsBrowseResponseSchema,
  gitCommitResponseSchema,
  gitPushResponseSchema,
  githubChecksDataSchema,
  githubCommentSchema,
  githubCommentsDataSchema,
  githubDataSchema,
  githubItemSchema,
  githubMergeMethodSchema,
  githubMergeResponseSchema,
  githubPrChangeSchema,
  githubPrChangesDataSchema,
  githubPrCheckSchema,
  githubPrMergeStateResponseSchema,
  githubPrMergeStateSchema,
  githubRefStatusDataSchema,
  githubTimelineEventKindSchema,
  githubTimelineEventSchema,
  groupResponseSchema,
  groupVariantSchema,
  healthResponseSchema,
  ideDirectoryQuerySchema,
  ideDirectoryResponseSchema,
  ideEntrySchema,
  ideFileInputSchema,
  ideFileQuerySchema,
  ideFileResponseSchema,
  imageInputSchema,
  importableSkillSchema,
  launchKeyResponseSchema,
  logEntrySchema,
  markAllReadResponseSchema,
  messageInputSchema,
  messageResponseSchema,
  modelDiscoveryRunnerSchema,
  modelUsageEntrySchema,
  openAgentAccountFileInputSchema,
  openAgentAccountFileResponseSchema,
  openInCliResponseSchema,
  openProjectInResponseSchema,
  openProjectInSchema,
  openTargetSchema,
  openTargetsResponseSchema,
  parsedWorkflowSchema,
  patchRunInputSchema,
  pickVariantResponseSchema,
  planResponseSchema,
  processUsageSchema,
  projectListEntrySchema,
  projectsResponseSchema,
  providerConnectResponseSchema,
  providerConnectionStateSchema,
  providerIdSchema,
  providerQuotaBlockedReasonSchema,
  providerStatusResponseSchema,
  providerStatusSchema,
  providerUsageSnapshotSchema,
  queuedMessageSchema,
  reasoningEffortSchema,
  reclaimWorktreesResponseSchema,
  referenceStatusSchema,
  referenceStatusesByProjectSchema,
  registerProjectResponseSchema,
  removeAgentProfileResponseSchema,
  removeProjectResponseSchema,
  removeQueuedMessageResponseSchema,
  removeTodoResponseSchema,
  removeWorktreeResponseSchema,
  repoBranchResponseSchema,
  repoCommitPayloadSchema,
  repoInfoSchema,
  repoResponseSchema,
  runActivitySchema,
  runCommitSchema,
  runCommitsResponseSchema,
  runEventSchema,
  runEventsQuerySchema,
  runHistoryContextSchema,
  runHistoryCursorSchema,
  runHistoryEventSchema,
  runHistoryPageSchema,
  runHistoryQuerySchema,
  runIdParamSchema,
  runIndexEntrySchema,
  runRecordSchema,
  runStatusSchema,
  runnerDiscoversModels,
  runnerModelCatalogResponseSchema,
  runnerModelOptionSchema,
  runnerModelsSchema,
  runnerSchema,
  runnerSelectionSchema,
  runsIndexResponseSchema,
  saveWorkflowInputSchema,
  saveWorkflowResponseSchema,
  selectAgentProfileInputSchema,
  setAgentConfigInputSchema,
  setConfigInputSchema,
  setConfigResponseSchema,
  setWorkspaceConfigInputSchema,
  setWorkspaceUiStateInputSchema,
  skillSchema,
  skillsUpdateScopeStateSchema,
  skillsUpdateStateSchema,
  skillsUpdateStatusSchema,
  startTodoResponseSchema,
  statusEntrySchema,
  stepStateSchema,
  stepStatusSchema,
  taskSourceSchema,
  todoItemSchema,
  uiStateSchema,
  updateAgentProfileInputSchema,
  updateAutomationInputSchema,
  updateProjectInputSchema,
  updateProjectResponseSchema,
  userMcpListingSchema,
  workflowDefSchema,
  workflowLoadIssueSchema,
  workflowStepDefSchema,
  workflowsResponseSchema,
  workspaceConfigResponseSchema,
  workspaceLastLocationSchema,
  workspaceUiStateSchema,
  workspaceUsageResponseSchema,
  worktreeDirEntrySchema,
  worktreeEntrySchema,
  worktreeInfoSchema,
  worktreesResponseSchema
};
