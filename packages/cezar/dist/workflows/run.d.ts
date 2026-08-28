import type { RunnerId } from '../core/agent-runner.ts';
import type { RunnerSelection } from '../core/runner-selection.ts';
import type { ReasoningEffort } from '../contract/index.js';
import type { ContentBlock } from '../core/agent-runner.ts';
import { type Skill } from '../skills.ts';
import type { QueuedMessage, RunRecord, RunStore } from '../runs/store.ts';
import { WorkspaceSemaphore, type AccountHolds } from '../workspace/semaphore.ts';
import type { QuotaCoordinator } from '../core/quota/coordinator.ts';
import { type WorkflowDef } from './types.ts';
/** An interactive session that hears nothing from the user closes itself. */
export declare const IDLE_TIMEOUT_MS: number;
/**
 * Preserve boundaries between complete assistant text blocks while a turn is
 * accumulated for marker parsing. The runners join these same v1 blocks with
 * newlines in `AgentRunResult`; matching that contract here prevents a
 * trailing `CEZ:TITLE=` block from absorbing later commentary (#623).
 */
export declare function appendTurnText(current: string, next: string): string;
/** Periodic "cezar autosave" commit in the task worktree (spec 006). */
export declare const AUTOSAVE_INTERVAL_MS = 90000;
/** The periodic autosave timer is opt-in (#471): off, a task branch carries only the
 *  agent's own commits plus the turn-end/pre-PR flushes — no mid-run "cezar autosave"
 *  noise interleaving PR history. The flushes (`autosaveCommit` at turn end and before
 *  a draft PR) are NOT gated: the branch must still end holding the finished state. */
export declare function periodicAutosaveEnabled(env?: NodeJS.ProcessEnv): boolean;
/**
 * Explicitly opt out of the repository-root lease for runs that execute in the
 * current checkout. This covers explicit worktree opt-out, non-Git degradation,
 * and continuations whose worktree cannot be restored (spec 006 hardening, #438).
 * This is intentionally unsafe: concurrent agents may overwrite each other's
 * files or Git state. Isolated worktree runs are unaffected.
 */
export declare function repositoryRootLockDisabled(env?: NodeJS.ProcessEnv): boolean;
/**
 * Auto-resume after a provider usage limit (spec 2026-08-03-auto-resume-after-usage-limit).
 *
 * The wait is the provider's own reset instant plus this grace: resuming AT the boundary races the
 * provider's clock (and its rounding), and one failed resume costs the whole window over again.
 * Thirty seconds is cheap next to five hours and long enough to be past any sane skew.
 */
export declare const AUTO_RESUME_GRACE_MS = 30000;
/**
 * Consecutive automatic resumes allowed without a human turn. A resume can only fire after a real
 * reset instant, so this is not a throttle — it is the backstop for the pathological case (a
 * provider that answers "limit reached, retry now" in a loop), and it is deliberately generous
 * enough to sit through a couple of days of five-hour windows.
 */
export declare const MAX_AUTO_RESUMES = 12;
/**
 * How long a missed deadline stays worth acting on. The promise is "we pick this up when the
 * window reopens" — kept across a restart or an overnight close, which is the case the feature
 * exists for. A day later it is no longer that promise: the user has moved on, and a task
 * springing back to life is a surprise rather than a service. Such a deadline is retired with a
 * note instead of fired, so the only tasks a sweep can revive are ones someone is still waiting on.
 */
export declare const AUTO_RESUME_MISSED_WINDOW_MS: number;
/**
 * How often the queue checks that it is not wedged.
 *
 * A hold is the only thing in the engine that can make an idle queue CORRECT, so it is also the
 * only thing that can make a wedged one look correct. This tick is the way out: cheap (a few
 * in-memory checks), unref'd, and it only ever acts when idling has no justification left.
 */
export declare const QUEUE_WATCHDOG_MS = 60000;
/**
 * Which agent ACCOUNT a run's work runs on — the thing a provider usage limit actually closes
 * (spec 2026-08-03-auto-resume-after-usage-limit).
 *
 * Backend plus agent account, because those are the two axes a limit is scoped to: a Claude
 * limit must never stall a Codex task, and a second Claude login is a second budget. A record
 * that names no runner has not started yet and will take the configured default, which is what
 * `fallbackRunner` carries; a run that HAS started always carries its resolved runner (execute
 * persists it), and only started runs can be holding.
 */
export declare function runAccountKey(run: Pick<RunRecord, 'runner' | 'agentProfile'>, fallbackRunner: RunnerId): string;
export interface StartRunInput {
    task: string;
    model?: string;
    /** User-authored reasoning policy. Auto is resolved independently for each agent chunk. */
    reasoningEffort?: ReasoningEffort;
    /** Agent backend chosen for this task (GUI). Unset = the config default. */
    runner?: RunnerSelection;
    /** Agent account for this task (spec 2026-07-29-agent-profiles), applying to steps that run
     *  on `runner`. Unset = the project's own selection. Persisted on the record so the choice
     *  survives into resume and Continue, and so the thread can say which account did the work. */
    agentProfile?: string;
    /** Screenshots pasted into the new-task form — persisted when the run is
     *  created and delivered once, with the first agent step's opening message. */
    images?: ContentBlock[];
    /** Per-run system-prompt override (`POST /api/runs`, programmatic callers).
     *  Replaces the `config.json` default for this run — see
     *  `resolveExtraSystemPrompt` for the precedence contract. */
    systemPrompt?: string;
    /** Composer opt-out (#worktree-toggle): `false` runs the task in the repo
     *  working tree instead of an isolated worktree. Undefined/`true` keeps the
     *  default per-task worktree. Ignored for variants (they always isolate). */
    worktree?: boolean;
    /** Autonomous mode (#autonomous): the run never parks at `waiting` for the
     *  user — turn-ends auto-continue until the agent signals done or the safety
     *  cap is hit. No "needs you" is ever raised. */
    autonomous?: boolean;
    /** Follow-up inbox generation (spec 007, #444). Omitted means enabled for
     *  compatibility; the handoff journal runs either way. */
    generateFollowups?: boolean;
    /** Attachments from the queued prompt stack (#472), re-encoded from disk by
     *  `hydrateQueuedInput` at dequeue. Kept separate from `images` because those
     *  are persisted into `taskImages` by `startRun()` — folding
     *  the stack's (already-persisted) files in there would write duplicate files
     *  and make the task bubble render the stack's images as its own. In-memory
     *  only: rebuilt from the record on every hydration, never persisted. */
    stackedImages?: ContentBlock[];
}
/**
 * The effective "extra" system prompt for a run (spec §protocol v2, R2 2.3):
 * the per-run override (`POST /api/runs` `systemPrompt`) REPLACES the
 * `config.json` default — they are the same knob at two scopes, so the more
 * specific one wins outright; they never concatenate. Whichever wins is
 * ADDITIVE to the skill body and the handoff contract, which always ride
 * along (see `composeSystemPrompt`). Blank strings count as unset.
 */
export declare function resolveExtraSystemPrompt(override: string | undefined, configDefault: string | undefined): string | undefined;
/**
 * Joins the parts of one agent step's system prompt in fixed order — skill
 * body (most task-specific), then the run's extra prompt (user guidance, can
 * amend the skill), then the handoff contract (always last, never optional in
 * practice). Blank parts drop out; survivors join with the same `\n\n---\n\n`
 * divider the skill+handoff composition has always used.
 */
export declare function composeSystemPrompt(...parts: Array<string | undefined>): string;
/**
 * The directories a spawned agent may reach outside its worktree: the run-state
 * folder that holds its handoff file, plus its own temp directory when this run
 * got one (#785). Handing an agent a `TMPDIR` its file tools are not allowed to
 * write would trade one silent failure for another, so the two travel together;
 * under `CEZ_AGENT_TMPDIR=0` there is no per-run directory and the list is
 * exactly what it always was.
 */
export declare function agentDirectories(runsDir: string, env: Record<string, string>): string[];
/**
 * Materialized pasted attachment: the on-disk name/serving-URL pair the
 * transcript already used, plus the absolute path that lets the agent
 * operate on the file itself — save it, `cp` it, attach it to a GitHub
 * issue/PR (#357). `path` is only ever an absolute path under
 * `.ai/cezar/runs/<runId>-images/` (see `RunManager.persistImage`).
 */
/** Inverse of `persistImage`'s extension mapping (#472) — a persisted attachment
 *  is re-encoded from disk at dequeue and needs its media type back. */
export declare function mediaTypeFor(name: string): string;
/** Highest `<prefix>-<n>.<ext>` suffix already present in a run's image dir (#472).
 *  `screenshot-*` and `pasted-*` share one numbering space, so this scans both and
 *  returns 0 for a missing/empty directory. */
export declare function highestImageSeq(dir: string): number;
export interface PersistedAttachment {
    name: string;
    url: string;
    path: string;
}
/**
 * Plain-text note listing the absolute paths of pasted attachments, appended
 * to the message that carries them (#357). The base64 image blocks stay in
 * the message for the model to *view*; this note is what lets it *use* the
 * files as files — and the only usable reference on backends (codex,
 * opencode) whose `textOf()` drops image blocks before reaching the model.
 */
export declare function pastedAttachmentsText(attachments: PersistedAttachment[]): string;
/** Same note as `pastedAttachmentsText`, wrapped as a trailing `ContentBlock`
 *  ready to append to a message's content array. */
export declare function pastedAttachmentsNote(attachments: PersistedAttachment[]): ContentBlock;
/** Variant letters + the fixed diversification hints (spec 010). A runs the
 *  task verbatim; B/C get one constant sentence each — zero configuration. */
export declare const VARIANT_LETTERS: readonly ['A', 'B', 'C'];
/**
 * The mini workflow engine: executes a `WorkflowDef` against a repo, one step
 * at a time, persisting every event to the RunStore (which the SSE endpoints
 * relay live to the GUI). No GitHub choreography — agent steps and shell
 * checks with bounded retry loops, plus live sessions: the last agent step
 * stays open for follow-ups (`waiting`) until "finish", idle timeout, or
 * cancel. Runs queue behind the workspace-wide `maxParallel` slots (the shared
 * `WorkspaceSemaphore`, spec 2026-07-20 step 2.5) and each run executes in its
 * own git worktree on a `cez/<id8>` branch (spec 006), autosave-committed at
 * turn end and before a draft PR — plus every 90 s when opted in via
 * CEZ_AUTOSAVE=1 (#471). Each autosave records its trigger in the commit
 * subject, so the always-on flushes are not mistaken for the opt-in timer.
 * The user's working tree is never touched.
 */
export declare class RunManager {
    private readonly store;
    private readonly repoRoot;
    /** Process-shared quota authority. Optional until Auto selection is exposed. */
    private readonly quotaCoordinator?;
    private readonly active;
    private readonly queue;
    private readonly starting;
    private readonly waiting;
    /** Durable monitoring subset. Only the configured number receives the waiting-slot exemption. */
    private readonly monitoring;
    private readonly pendingJobs;
    /** Interrupted agent turns recovered after a process restart. Unlike an
     *  explicit user Continue, these are bulk scheduler work and must re-enter
     *  through `pump()` so both workspace and per-project caps are honored. */
    private readonly pendingContinuations;
    /** Per-run image counter behind `pasted-<n>` / `screenshot-<n>` (#472). Lives on
     *  the manager rather than the `ActiveRun` so a *queued* run — which has no
     *  `ActiveRun` at all — can persist attachments. Seeded lazily from disk. */
    private readonly queuedImageSeq;
    /** Messages that landed in the dequeue → session-open gap (#472), flushed as
     *  ordinary follow-up turns the moment the session opens. In-memory only. */
    private readonly deferredMessages;
    /** Armed usage-limit resumes, keyed by run id (spec
     *  2026-08-03-auto-resume-after-usage-limit). The DEADLINE itself lives on the record
     *  (`autoResumeAt`) — this map holds only the process-local timer, so a restart rebuilds it
     *  from the record rather than losing the wait. Runs here are `failed` and therefore NOT in
     *  `active`, which is why the timer cannot live on an `ActiveRun` like the monitoring one. */
    private readonly autoResumeTimers;
    /** Known provider-reset wakes for queued auto-routed work. */
    private readonly quotaWakeTimers;
    private readonly offQuotaWake?;
    private pumping;
    /** A pump that arrived while one was in flight — replayed by `pump()`'s own
     *  loop so a slot freed mid-sweep is never a lost wakeup. */
    private pumpAgain;
    /**
     * Runs normally isolate in worktrees and may execute in parallel. When that
     * isolation is unavailable (or explicitly disabled), access to `repoRoot` is
     * serialized by default so two agents cannot edit/revert the same files
     * (#438). `CEZ_DISABLE_REPO_LOCK=1` deliberately bypasses this safety lease.
     */
    private repoRootTail;
    /** `.ai/cezar` — where the per-task handoff files and todos.json live. */
    private readonly dataDir;
    /** Runs currently being paused by the memory guard — dedupes the ~2 s samples so one breach
     *  triggers one pause, not a burst. Cleared in dropActive when the run leaves the registry. */
    private readonly memoryPausing;
    /** Unsubscribe handle for the constructor's `onUsage` subscription — released
     *  by dispose() so a torn-down manager stops receiving sampler ticks. */
    private readonly offUsage;
    /** The stalled-queue watchdog (see `rescueStalledQueue`). */
    private readonly queueWatchdog;
    /** Set by the watchdog for exactly one sweep: ignore the usage-limit hold and make progress. */
    private forceNextPump;
    /** Runs the watchdog started despite the hold. The spawn-time gate (`requeueWhileHeld`) would
     *  otherwise hand them straight back and the rescue would undo itself in a millisecond. */
    private readonly forceStarted;
    /** The workspace-wide parallel-cap semaphore + cached resource config
     *  (spec 2026-07-20, step 2.5). Boot constructs ONE and every manager shares
     *  it; the private fallback keeps single-manager callers and tests working. */
    private readonly semaphore;
    /** Unregister handle for this manager's semaphore membership — released by
     *  dispose() so a torn-down project stops counting against the cap. */
    private readonly offSemaphore;
    constructor(store: RunStore, repoRoot: string, options?: {
        semaphore?: WorkspaceSemaphore;
        quotaCoordinator?: QuotaCoordinator;
    });
    /**
     * Release everything this manager owns without touching run records
     * (multi-project workspace, spec 2026-07-20: a removed project's context is
     * torn down while the process lives on). Unsubscribes the shared usage
     * sampler — before dispose() existed that subscription lived for the whole
     * process — clears every per-run idle/autosave timer, releases any held
     * repo-root locks, and empties the queued state so nothing fires later.
     * Live sessions are NOT ended here: run lifecycle stays the caller's policy;
     * dispose only guarantees the manager makes no further moves on its own.
     */
    dispose(): void;
    /**
     * Pause any active run whose whole process tree exceeds the WORKSPACE
     * `resources.memoryLimitMb`, freeing its slot so the queue advances
     * (#memory-guard). "Pause" closes the session — freeing the tree's
     * memory — and leaves the run resumable via Continue; a loud warning explains why. No-op when
     * no limit is set or the sampler has no data (e.g. `ps`/PowerShell unavailable).
     */
    private enforceMemoryLimit;
    /** Env the spawned claude gets so the agent can find its handoff file and
     *  the global inbox (spec 007; the inbox only when the run opted in).
     *
     *  `CEZ_TODOS_FILE` is set to `''` rather than omitted when follow-ups are
     *  off: runners spawn with `{ ...process.env, ...spec.env }`, so omitting the
     *  key would let a value inherited from *this* process through — a nested
     *  cezar (an agent running `cez serve`/`cez run`/the test suite) would then
     *  write follow-ups into the parent's inbox despite the opt-out. Empty is the
     *  established "absent" spelling — consumers guard with `if (todosFile)`.
     *
     *  `TMPDIR`/`TEMP`/`TMP` (#785) point at this run's own scratch directory
     *  instead of the machine-wide one every agent used to share. Created and
     *  write-probed here, on the last common path before a spawn, so an unusable
     *  temp directory throws `AgentTempDirError` at the caller rather than
     *  turning into empty command output inside a running agent. */
    private agentEnv;
    /**
     * `agentEnv` plus the agent-account variable for the profile this STEP runs under (spec
     * 2026-07-29-agent-profiles), and the id it resolved to so the caller can record it.
     *
     * Resolved per step, not per run, because a workflow can mix backends: an override naming a
     * Claude account says nothing about which Codex account a codex step should use. Resolution
     * order, most specific first:
     *
     *   1. the step's ALREADY-RECORDED `profileId` — a resume or Continue must reattach to the
     *      account that created the session, whatever the project has since been switched to;
     *   2. the run's composer override, but only for steps on the run's own runner;
     *   3. the project's stored selection, and failing that the discovered default.
     *
     * Read fresh every time. `~/.cezar/config.json` is shared by every cezar process on this
     * machine, so a cached snapshot is a staleness bug, and one small JSON read is free next to
     * spawning a CLI. Never throws: an unreadable home degrades to the default profile, which is
     * exactly the behaviour that predates profiles.
     */
    private agentEnvForStep;
    startRun(workflow: WorkflowDef, input: StartRunInput, group?: {
        groupId: string;
        variant: string;
    }): RunRecord;
    /**
     * Parallel variants (spec 010): N runs of the same workflow on the same
     * task, sharing a groupId. Variant A gets the task verbatim; B and C get a
     * fixed one-line approach hint appended to the *task input* (not the step
     * template), so diversification works with any workflow. The normal queue
     * applies — with maxParallel=2 a third variant simply waits.
     */
    startVariants(workflow: WorkflowDef, input: StartRunInput, count: number): RunRecord[];
    /**
     * Slots this manager holds against the workspace-wide cap. `waiting` runs
     * don't hold a slot (#347): an idle claude process costs memory but no
     * tokens, queued work progressing matters more, and the idle timeout already
     * bounds how long a session can sit open. Because the exemption lives HERE —
     * in the count, not in any acquire path — a message into a `waiting` run
     * (sendMessage) resumes it immediately even when that momentarily exceeds
     * `maxParallel`, including when other projects saturate the cap.
     */
    private busySlots;
    /** Epoch ms of this manager's oldest queued run (the semaphore's fairness
     *  key when a freed slot is broadcast), or null when nothing is queued.
     *  `queue` is FIFO — `startRun` pushes and `recover()` re-queues by
     *  `createdAt` — so the head is the oldest. */
    private oldestQueuedAt;
    /**
     * A slot this manager held just came free. Pump the whole WORKSPACE, not
     * just this manager: `maxParallel` is counted across every project, so the
     * run that should take the slot is the workspace's oldest queued one — which
     * usually sits in another project's queue. Pumping only `this` is what left
     * a queued run in project B stuck at `queued` while project A's runs came
     * and went. `release()` pumps this manager too, so it replaces the local
     * `pump()` at every slot-freeing transition.
     */
    private releaseSlot;
    /**
     * Start queued runs while parallel slots are free. A run starts only under
     * BOTH ceilings: the WORKSPACE `resources.maxParallel` (default 2, counted
     * across every manager — spec 2026-07-20, step 2.5) AND this project's own
     * per-project `maxParallel` when the registry sets one (spec 2026-07-22,
     * inherits the workspace cap when unset). Legacy per-repo `maxParallel` keys
     * are ignored. A non-git directory degrades to 1 sequential run in the repo
     * root (spec 006 degradation rule), which is always the tighter bound.
     */
    private pump;
    /**
     * Make one `queued` RECORD executable again — the engine half a queued run needs but does not
     * persist (`pendingJobs` / `pendingContinuations` are process-local, the record is not).
     *
     * Two callers, one path: boot recovery re-adopts everything the previous process was holding,
     * and the queue watchdog re-adopts anything the running process has somehow lost. A queued
     * record with no work item behind it is invisible to `pump()` and would sit there for good,
     * which is the worst failure this engine has — the task is neither running nor failed, just
     * silently never going to happen.
     *
     * A continuation is reconstructed first: its executable details are gone, but the pending
     * `continue-N` step and the session before it are durable, which is enough. Otherwise the
     * workflow is revived from the record. A run that can be neither is failed loudly rather than
     * left in the queue as a ghost.
     */
    private reviveQueuedRun;
    /**
     * Startup recovery (#367) — re-adopt runs that were live when the previous
     * cezar process exited (requires the store opened with `keepLive`):
     *  - `queued`  → back into the queue (FIFO by createdAt), from the persisted
     *    workflowDef (or the catalog by name for older records);
     *  - `waiting` → the turn was over and the ball was in the user's court —
     *    settle exactly like a closed session (review/done, Continue still works);
     *  - `running` → mark interrupted, then immediately resume the last agent
     *    session via the Continue path, pointing the agent at its handoff file.
     * Call once, before the server starts taking requests.
     */
    recover(): Promise<void>;
    /** The persisted definition when it looks sane, else the catalog by name. */
    private reviveWorkflow;
    /** Remove a run from the live registries — keeps `waiting ⊆ active`. */
    private dropActive;
    /**
     * A run just failed: if the provider said "usage limit, back at T", promise to resume it at
     * `T + AUTO_RESUME_GRACE_MS` instead of leaving the task dead until someone notices.
     *
     * Every refusal below is silent-but-honest — the run stays `failed` with its Continue button,
     * which is exactly the pre-feature behavior — except the safety cap, which says so on the
     * transcript, because a run that stops resuming itself needs to explain why.
     */
    private scheduleAutoResumeIfLimited;
    /** Publish the deadline on the record (the cockpit's only source) and arm the timer for it. */
    private armAutoResume;
    /**
     * The window has reopened. Re-check the record synchronously — hours may have passed, and the
     * user may have continued, deleted or cancelled the run in them — then hand the resume to the
     * ordinary queued-continuation path so it obeys both concurrency caps like any other work.
     */
    private fireAutoResume;
    /**
     * Make the armed timers agree with the records and the current setting. Runs on every `pump()`
     * — which is where a settings change lands (a config PUT refreshes the shared semaphore, which
     * pumps every manager) — and once from `recover()`.
     *
     * It is a RECONCILE rather than a one-shot restore because the deadline is durable state and
     * the timer is not: a restart, a rebuilt project context, a manager disposed mid-wait, or a
     * refusal all leave a record promising a resume that no timer is holding. Rebuilding from the
     * record covers every one of those at once — the alternative is a hint counting down to a time
     * that has already passed, which is exactly the failure this method exists to make impossible.
     *
     * Cheap: an in-memory scan, and arming is skipped for every run already held.
     */
    private reconcileAutoResumes;
    /**
     * Hand a run that has not spawned anything back to the queue, when the account it would run on
     * went into a usage-limit hold (spec 2026-08-03-auto-resume-after-usage-limit).
     *
     * The dequeue-time gate in `pump()` cannot be the only one: a run can sit between dequeue and
     * spawn for a long time — an in-place run waiting for the exclusive repo-root lease is the
     * measured case — and the account can close in that gap. This is the last honest moment to
     * refuse, because everything after it costs a real agent turn.
     *
     * "Untouched" is the contract: the run has created no session and no worktree, so it goes back
     * as plain `queued` with its `startedAt` cleared, and `pump()` will pick it up when the window
     * reopens. Returns true when the caller must abandon the run.
     */
    private requeueWhileHeld;
    /**
     * The failsafe: a queue must never be able to wedge.
     *
     * Everything else in this file makes an idle queue CORRECT under some condition — a slot cap, a
     * repo-root lease, and now a usage-limit hold. That is also what makes a wedged queue look
     * correct, and the hold has already produced one in the field: two resumes fired together, each
     * holding the account the other was waiting on, and the whole workspace stopped with every task
     * `queued`. That specific bug is fixed and tested, but "the queue stopped and nothing will ever
     * restart it" is too expensive a failure mode to leave resting on any single fix being right.
     *
     * The test is deliberately about JUSTIFICATION rather than about any particular bug: idling is
     * legitimate while work is running (here or in another project), or while a real appointment is
     * still ahead — a scheduled resume that will fire and pump on its own. Anything else is a
     * queue with work in it, nothing running anywhere, and no event coming to wake it. That gets one
     * forced sweep, which starts work under the ordinary caps and lets the account's real state
     * re-assert itself: if the window truly is shut, that task meets the limit and re-establishes an
     * honest hold, with a real deadline behind it this time.
     *
     * Public so a test can drive the wedge directly instead of waiting out the interval.
     */
    rescueStalledQueue(now?: number): Promise<void>;
    /**
     * The accounts this project is currently holding: one key per run parked on a usage-limit
     * resume that has not come due yet (spec 2026-08-03-auto-resume-after-usage-limit).
     *
     * Published to the shared semaphore so the hold spans PROJECTS — one Claude account can be
     * driving tasks in three repos, and a limit closes it for all of them. Derived from the
     * records on every ask rather than tracked as state: a deadline that passes, a resume that
     * fires, a cancel, an archive and a delete all lift the hold with no bookkeeping.
     *
     * Deliberately excludes a deadline that has already passed — that run is about to resume, and
     * holding the queue for it would only stall the very work the window reopened for.
     */
    accountHolds(now?: number): AccountHolds;
    /**
     * The PER-TASK off switch (`DELETE /api/v1/runs/:id/auto-resume`, and the archive route):
     * stop resuming THIS task, without touching the workspace setting or any other task.
     *
     * Idempotent — a run with nothing pending answers the same way, because "this task will not
     * resume itself" is equally true either way. Returns false only when the run does not exist,
     * which is the route's 404.
     */
    cancelAutoResume(runId: string): boolean;
    /** Retire a pending resume — timer, deadline and counter. The counter goes too because every
     *  caller is a fresh epoch: a human Continue, or a resume that re-stamps its own count. */
    private clearAutoResume;
    /** Reclaim finished worktrees beyond the keep-limit (#483) — directory only,
     *  `cez/<id8>` branch kept. Best-effort; a failure never affects run
     *  lifecycle. `review`/live runs are excluded by the selector. */
    private enforceRetention;
    /** Last live-refresh namer inputs per run — unchanged inputs skip the call. */
    private lastNamerKey;
    /**
     * Acquire the one-at-a-time lease for runs executing in `repoRoot`.
     *
     * A lease waiter is idle, so it parks in `waiting` and gives its
     * `maxParallel` slot back (the #347 rule): isolated worktrees keep using
     * every configured slot while root runs line up. The store status stays
     * `running` — only the queue's busy count changes, so the GUI never shows a
     * lease-blocked run as awaiting user input.
     *
     * The lease is held for the run's whole lifetime, including the idle
     * `waiting` parks between agent turns. A parked session is still live and
     * writes to the working tree the moment it resumes, so handing the tree to
     * another run there would reintroduce the concurrent-edit bug (#438) this
     * lease exists to prevent.
     *
     * Returns false when the run was cancelled while waiting: the lease was
     * never granted and the caller must not touch the working tree.
     */
    private acquireRepoRoot;
    cancel(runId: string): boolean;
    isActive(runId: string): boolean;
    /**
     * Fold a queued run's persisted prompt — `run.task` plus everything stacked
     * onto it (#472) — into the job input that is about to execute.
     *
     * Called from `pump()` immediately before `execute()`, which makes the RECORD
     * the single source of truth for a queued run's prompt. Before this, the
     * executing copy lived in `pendingJobs` (memory) while the record held a
     * second one, so an edit that PATCHed the record silently did nothing until a
     * restart. `recover()` rebuilds through the same helper, so both paths agree.
     *
     * **Read-only, and that is load-bearing.** It composes into the in-memory
     * `input` and never writes the folded string back to `RunRecord.task`; the
     * task and its stack stay separate on disk for the life of the run. Writing
     * back would re-append the whole stack on every recovery and compound without
     * bound — asserted directly by a test.
     */
    private hydrateQueuedInput;
    /** Apply edits and messages made while a restart continuation waits for
     * capacity. The durable record remains the source of truth, just as it is for
     * an ordinary queued workflow (#472), so a second restart reconstructs and
     * hydrates the same amendments instead of dropping them. */
    private hydrateQueuedContinuation;
    private readPersistedImages;
    /**
     * Still waiting for a slot? Checked against the engine's own queue rather than
     * the record's `status` (#472): the record is written by `execute()` a tick
     * after `pump()` dequeues, so a status read can see `queued` for a run that has
     * already started. The pending maps are deleted synchronously at dequeue, so
     * they are the authoritative answer for "can this prompt still be amended".
     */
    private isQueued;
    /** Split `ContentBlock[]` into the persisted shape a stacked message holds. */
    private toQueuedMessage;
    /**
     * Append a prompt message onto a still-queued run (#472). Returns the stored
     * entry, or null when the run has already started — the caller then falls
     * through to `deferMessage`.
     */
    enqueueMessage(runId: string, content: ContentBlock[]): QueuedMessage | null;
    /** Edit a stacked message in place. Omitted fields retain their current value. */
    editQueuedMessage(runId: string, msgId: string, edit: {
        text?: string;
        images?: ContentBlock[];
    }): QueuedMessage | null;
    /** Remove a stacked message and its now-orphaned attachments. */
    removeQueuedMessage(runId: string, msgId: string): boolean;
    /**
     * Delete image files no longer referenced by anything (#472). Best effort — a
     * leftover file is harmless and goes with the run. Never touches a URL still
     * referenced by another stacked entry or by the initial prompt's `taskImages`.
     */
    private dropOrphanImages;
    /**
     * Edit the initial prompt of a still-queued run (#472). Re-derives the
     * heuristic title and the PR/issue chips, but never re-runs the LLM namer —
     * it already fired at creation and a second model call per edit is unjustified.
     */
    editTask(runId: string, task: string): boolean;
    /**
     * Buffer a message that arrived in the gap between dequeue and session-open
     * (#472). `pump()` has already folded the stack and `execute()` is spawning the
     * backend, so there is nothing left to amend and no session to deliver into —
     * without this rung the message would 409, a genuinely dropped message in the
     * feature built to stop dropping them. Flushed as an ordinary follow-up turn
     * the instant the session opens; dropped if the run never starts, which the
     * existing error path already surfaces.
     *
     * The buffer lives on the manager rather than the `ActiveRun` because the
     * `ActiveRun` does not exist yet for part of this window.
     */
    deferMessage(runId: string, content: ContentBlock[]): boolean;
    /** Deliver anything `deferMessage` buffered, once the session is live. */
    private flushDeferred;
    /**
     * Deliver a user message into the run's live claude session (mid-turn or
     * while `waiting`). Returns false when there is no open session — the GUI
     * then offers "Continue" instead.
     */
    sendMessage(runId: string, content: ContentBlock[]): boolean;
    /** Shared live-session delivery. Synthetic scheduler prompts reuse lifecycle
     * bookkeeping without masquerading as user-authored transcript messages. */
    private deliverMessage;
    /** Close the open session gracefully — the run then completes as `done`
     *  (or rests at `review` when the worktree holds changes, spec 009).
     *  On a run already resting at `review` (no session — the engine loop is
     *  over), "Finish" is the third review exit: accept the changes without a
     *  PR and flip straight to `done`. */
    finish(runId: string): boolean;
    /**
     * "Continue" (spec 003): reopen a finished run's claude session in-process
     * (`claude --resume <sessionId>`) as a new synthetic step. The session then
     * behaves exactly like an interactive step: `waiting` after each turn,
     * messages via sendMessage, closed by finish/idle/cancel.
     */
    continueRun(runId: string, opts?: {
        text?: string;
        images?: ContentBlock[];
        runner?: RunnerSelection;
        model?: string;
    }, 
    /** Restart recovery may discover several interrupted tasks at once. Those
     *  continuations are queued; an explicit user Continue remains immediate. */
    deferForCapacity?: boolean): {
        ok: boolean;
        error?: string;
    };
    private runContinuation;
    private execute;
    /** Park an auto-routed workflow at the exact agent-step boundary that could
     * not acquire a provider. Completed steps and the worktree remain intact. */
    private blockForProviderQuota;
    /**
     * A provider wait is a live workflow checkpoint, not a completed run. Keep
     * its worktree and durable execution state, but release the workspace slot
     * so another eligible task can run. This deliberately does not use
     * `dropActive()`, whose terminal-only cleanup can reclaim artifacts and
     * schedule an unrelated explicit-run auto-resume.
     */
    private parkActiveForProviderQuota;
    /** Provider telemetry and released provider leases both wake this. A read
     * made by the blocked attempt can yield one extra pass, but no spin: an
     * unchanged snapshot emits no coordinator wake. */
    private wakeQuotaBlockedRuns;
    private armQuotaWake;
    /** Resolve `auto` at the last responsible moment, after queue/worktree work
     * but immediately before model/profile/session construction. */
    private resolveRunnerSelection;
    /** Returns an error message, or null on success. */
    private runAgentStep;
    /**
     * Protocol-v2 sink for one agent session (R2 step 2.1): the runner's
     * `onUiEvent` stream flows through here. Persisted snapshots ride the same
     * NDJSON file as v1 (the store stamps `seq`/`ts`, `appendEvent` fans them
     * out live too); coalesced `item.delta` flushes go out live-only via
     * `emitEphemeral` — raw deltas never hit disk (spec §performance
     * guardrails). One sink per session: cumulative usage dedup and the
     * item-shape cache are session-scoped, like the mapper state feeding them.
     */
    private makeUiSink;
    /** Native backend asks arrive before turn-end. Persist and park immediately
     * so the cockpit shows attention and the run releases its workspace slot. */
    private handleRunnerUiEvent;
    /** Claim a scheduled plan refresh at a turn boundary. Claiming before closing the session makes
     * duplicate plan snapshots harmless, while the setting is read live so a Resources change
     * applies to sessions already in flight. */
    private takeContextRefreshPrompt;
    /** Persist the invocation checkpoint before launching a runner. A throw or
     * process exit before `turn.started` therefore leaves a durable mismatch. */
    private beginUsageInvocation;
    /** Fold backend-neutral completed-turn usage into the current step exactly
     * once. Invocation/turn counters are written before the event reaches the
     * NDJSON sink so crashes cannot preserve a falsely complete subtotal. */
    private recordUsageUiEvent;
    /** Usage completeness is a crash boundary, unlike high-frequency token
     * snapshots: the checkpoint must reach `runs.json` before the runner starts
     * or the matching UI event is persisted and forwarded. */
    private persistUsageCheckpoint;
    /**
     * Turn-end bookkeeping (#389), shared by `runAgentStep` and
     * `runContinuation` — called (fire-and-forget) from every `turn-end` event:
     *
     *  - `titleSummary`: derived from the turn's text, set ONCE — only while the
     *    record has none. A user's inline edit also lands in `titleSummary`
     *    (see `PATCH /api/runs/:id`), so an edit is never overwritten either.
     *  - `diffStat`: cheap `git diff --shortstat` vs the base, refreshed every
     *    turn. Async and best-effort — a git failure becomes at most a `note`
     *    event, NEVER a run failure. `updateRun` fans the record out over SSE,
     *    so the list views pick both up with no extra wiring.
     *
     * Not `private` so the integration tests can drive a turn-end directly —
     * a real agent session is the only other way to reach this path.
     */
    /**
     * The namer's apply path (task auto-naming spec). Fire-and-forget: called
     * without await from `startRun` (creation) and `recordTurnEnd` (live
     * refresh). A user-owned title (`titleOrigin: 'user'`) is never overwritten;
     * namer-owned titles may be replaced by fresher namer results.
     */
    private autoNameRun;
    recordTurnEnd(runId: string, turnText: string): Promise<void>;
    /**
     * In-band declarations from the finished turn (spec
     * 2026-07-18-task-ref-markers): the main thread's own `CEZ:PR=` /
     * `CEZ:ISSUE=` / `CEZ:TITLE=` lines, parsed from the accumulated turn text
     * like `CEZ:DONE` — never from tool output. Declared numbers overwrite the
     * regex/namer display tier (the store re-resolves the referenced-PR chip);
     * a declared title takes `titleOrigin: 'marker'`, which beats the namer but
     * never a user rename, and silences the live refresh below.
     */
    private applyTurnMarkers;
    /**
     * Live title refresh (task auto-naming spec, step 3): re-run the namer with
     * the turn's context. Skips: toggle off (`liveTitleUpdates` config over
     * `CEZ_TITLE_UPDATES` env, default ON), user-owned title, marker-owned title
     * (the agent declares via `CEZ:TITLE` — the token-saving fast path), dry-run
     * mocks (canned answers add nothing), empty turn text, unchanged namer inputs.
     */
    private maybeRefreshTitle;
    /**
     * End-of-session telemetry (#348): stop sampling the run's process tree and
     * fold the session's peaks into the run record. `max` with existing values —
     * a run can hold several sessions (multiple agent steps, Continue) and the
     * record keeps the highest water mark across all of them.
     */
    private recordUsagePeaks;
    /**
     * Diff-first review gate (spec 009), shared by `execute` and
     * `runContinuation`: a *successful* run whose worktree holds changes rests
     * at `review` instead of `done` — the user inspects the diff first, then
     * sends feedback back, opens a draft PR, or just finishes. Failed/cancelled
     * runs never enter review; no worktree or an empty diff means plain `done`.
     *
     * The gate is opt-in (#489): the review park happens only when it is enabled
     * (`reviewGateEnabled` — config toggle over the `CEZ_REVIEW_GATE` env, default
     * OFF) AND the run is not autonomous. Autonomous runs — and runs with the gate
     * off — settle straight to `done`, leaving the diff in the worktree untouched.
     */
    private settleSuccess;
    /**
     * Agent screenshot (an image block inside a tool result) or a user-pasted
     * attachment: the base64 data never enters the NDJSON event log — it lands
     * as a file under `.ai/cezar/runs/<id>-images/` and the transcript event
     * carries only the name + serving URL. `namePrefix` distinguishes the two
     * origins on disk (`screenshot-<n>.<ext>` for agent tool screenshots,
     * `pasted-<n>.<ext>` for user-pasted attachments, #357) and the absolute
     * `path` lets the agent operate on the file directly (save/attach/upload).
     * Best effort: on failure the attachment is dropped, the transcript still
     * shows the tool result's `[screenshot]` placeholder (or the image count).
     */
    private persistImage;
    private armIdleTimer;
    private clearIdleTimer;
    private reconcileMonitoringWakeTimers;
    private armMonitoringWakeTimer;
    private clearMonitoringWakeTimer;
    /** Autosave-commit the worktree every 90 s while the run lives (spec 006).
     *  Opt-in via CEZ_AUTOSAVE=1 (#471) — see periodicAutosaveEnabled. */
    private armAutosave;
    private clearAutosaveTimer;
    private runCheckStep;
    private finishStep;
}
/**
 * Immediate title shown while a run is queued. The namer's `titleSummary`
 * replaces it once the model answers; this is the honest, permanent fallback
 * when no model is available (#432, spec 2026-07-17-task-auto-naming). When
 * the task references a PR/issue, the number leads: `469: /om-auto-review-pr`.
 */
export declare function makeRunTitle(task: string, workflow: WorkflowDef): string;
/**
 * Skill identity is context, while the Markdown body remains instructions.
 *
 * For an on-disk skill we also hand the agent the ABSOLUTE directory of the
 * installed copy. A run executes in an isolated worktree that has no local
 * `.agents/skills` (gitignored, absent in a fresh checkout), so without this
 * the agent cannot read the skill's companion files (`references/*.md`) — or,
 * worse, reads a stale copy materialized from the team-repo cache. The path
 * resolves against the MAIN project root (`discoverSkills(repoRoot)`), i.e. the
 * current `npx skills`-installed copy, so a worktree agent and the main
 * checkout read the exact same, up-to-date files. Team skills are omitted here:
 * they are materialized into the worktree separately (see the call site).
 */
export declare function skillSystemPrompt(skill: Pick<Skill, 'name' | 'description' | 'body'> & Partial<Pick<Skill, 'path' | 'source'>>): string;
/**
 * Expand a registry-backed slash skill in one prompt string before it reaches a
 * backend. Claude otherwise intercepts an unknown leading slash command, and
 * Codex/OpenCode have no native slash-skill lookup at all (#676).
 *
 * Only a match at character zero counts, and unknown commands pass through
 * byte-for-byte — a backend's OWN slash commands must keep working. The caller
 * persists the original user text before applying this delivery-only rewrite.
 *
 * Both delivery seams route through here: live-session messages via
 * `expandRegistrySlashSkill`, and a continuation's opening prompt, which becomes
 * the session's `userPrompt` and never passes through `deliverMessage` at all
 * (#811).
 */
export declare function expandRegistrySlashSkillText(text: string, skills: readonly Skill[]): string;
/**
 * `expandRegistrySlashSkillText` over a live chat message: only the first text
 * block is eligible, and an unchanged block returns the caller's array
 * identity untouched.
 */
export declare function expandRegistrySlashSkill(content: ContentBlock[], skills: readonly Skill[]): ContentBlock[];
