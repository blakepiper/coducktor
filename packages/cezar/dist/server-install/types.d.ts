import { z } from 'zod';
/**
 * Contracts for the server installer (spec 2026-07-16-server-installer).
 * The engine closes over `InstallStep` / `PlatformStrategy` and never learns
 * what a step *does* — only `check` / `run` / `undo`. That seam is what makes
 * "use ubuntu as a selector and run it that way" a registry lookup, and what
 * makes the interactive helpers reusable across every future platform.
 */
/** The platforms the registry knows. Extend here + add a strategy file. */
export declare const PLATFORM_IDS: readonly ['ubuntu-vps', 'macosx-ngrok'];
export type PlatformId = (typeof PLATFORM_IDS)[number];
/** Per-step lifecycle. `failed` resumes identically to `pending`. */
export declare const STEP_STATUSES: readonly ['pending', 'done', 'skipped', 'failed'];
export type StepStatus = (typeof STEP_STATUSES)[number];
/**
 * One thing a step created, tagged by who owns its removal:
 *  - `owned`  — cezar authored it and nothing else uses it → uninstall removes it.
 *  - `shared` — a system tool the operator may now depend on (gh, agent CLIs,
 *    certbot + its renewal timer, the cert itself) → uninstall lists it with a
 *    manual removal hint instead of yanking it.
 */
export declare const stepArtifactSchema: z.ZodObject<{
    kind: z.ZodEnum<{
        owned: "owned";
        shared: "shared";
    }>;
    type: z.ZodString;
    path: z.ZodOptional<z.ZodString>;
    name: z.ZodOptional<z.ZodString>;
    scope: z.ZodOptional<z.ZodString>;
    removeHint: z.ZodOptional<z.ZodString>;
}, z.core.$strip>;
export type StepArtifact = z.infer<typeof stepArtifactSchema>;
/** What a step returns from `run()`; `undo()` receives it back verbatim. */
export declare const stepCreatedSchema: z.ZodNullable<z.ZodObject<{
    artifacts: z.ZodDefault<z.ZodArray<z.ZodObject<{
        kind: z.ZodEnum<{
            owned: "owned";
            shared: "shared";
        }>;
        type: z.ZodString;
        path: z.ZodOptional<z.ZodString>;
        name: z.ZodOptional<z.ZodString>;
        scope: z.ZodOptional<z.ZodString>;
        removeHint: z.ZodOptional<z.ZodString>;
    }, z.core.$strip>>>;
}, z.core.$strip>>;
export type StepCreated = z.infer<typeof stepCreatedSchema>;
/**
 * Persisted per-step outcome — the `steps` map in `server.json`. A status this
 * version doesn't know (written by a newer cezar) degrades to `failed`, which
 * keeps the record AND keeps it on uninstall's undo path — never to a parse
 * failure that would discard the whole ledger.
 */
export declare const stepOutcomeSchema: z.ZodObject<{
    status: z.ZodCatch<z.ZodEnum<{
        done: "done";
        failed: "failed";
        pending: "pending";
        skipped: "skipped";
    }>>;
    created: z.ZodCatch<z.ZodOptional<z.ZodNullable<z.ZodObject<{
        artifacts: z.ZodDefault<z.ZodArray<z.ZodObject<{
            kind: z.ZodEnum<{
                owned: "owned";
                shared: "shared";
            }>;
            type: z.ZodString;
            path: z.ZodOptional<z.ZodString>;
            name: z.ZodOptional<z.ZodString>;
            scope: z.ZodOptional<z.ZodString>;
            removeHint: z.ZodOptional<z.ZodString>;
        }, z.core.$strip>>>;
    }, z.core.$strip>>>>;
}, z.core.$strip>;
export type StepOutcome = z.infer<typeof stepOutcomeSchema>;
/**
 * `~/.cezar/server.json` — host-level, install-once. Additive-safe: every new
 * field is optional / defaulted so an older cezar still parses a newer file
 * (BACKWARD_COMPATIBILITY cross-version-state rule). No secrets live here.
 */
export declare const serverStateSchema: z.ZodObject<{
    schema: z.ZodCatch<z.ZodLiteral<1>>;
    platform: z.ZodCatch<z.ZodOptional<z.ZodString>>;
    instance: z.ZodCatch<z.ZodOptional<z.ZodString>>;
    domain: z.ZodCatch<z.ZodOptional<z.ZodString>>;
    externalProxy: z.ZodCatch<z.ZodOptional<z.ZodBoolean>>;
    bindHost: z.ZodCatch<z.ZodOptional<z.ZodString>>;
    installed: z.ZodCatch<z.ZodDefault<z.ZodBoolean>>;
    dryRun: z.ZodCatch<z.ZodOptional<z.ZodBoolean>>;
    createdAt: z.ZodCatch<z.ZodOptional<z.ZodString>>;
    updatedAt: z.ZodCatch<z.ZodOptional<z.ZodString>>;
    primaryPort: z.ZodCatch<z.ZodDefault<z.ZodNumber>>;
    publicUrl: z.ZodCatch<z.ZodOptional<z.ZodString>>;
    ephemeral: z.ZodCatch<z.ZodOptional<z.ZodBoolean>>;
    steps: z.ZodCatch<z.ZodDefault<z.ZodRecord<z.ZodString, z.ZodCatch<z.ZodObject<{
        status: z.ZodCatch<z.ZodEnum<{
            done: "done";
            failed: "failed";
            pending: "pending";
            skipped: "skipped";
        }>>;
        created: z.ZodCatch<z.ZodOptional<z.ZodNullable<z.ZodObject<{
            artifacts: z.ZodDefault<z.ZodArray<z.ZodObject<{
                kind: z.ZodEnum<{
                    owned: "owned";
                    shared: "shared";
                }>;
                type: z.ZodString;
                path: z.ZodOptional<z.ZodString>;
                name: z.ZodOptional<z.ZodString>;
                scope: z.ZodOptional<z.ZodString>;
                removeHint: z.ZodOptional<z.ZodString>;
            }, z.core.$strip>>>;
        }, z.core.$strip>>>>;
    }, z.core.$strip>>>>>;
}, z.core.$loose>;
export type ServerState = z.infer<typeof serverStateSchema>;
/** Freshly-initialized state (no install yet). */
export declare function freshServerState(): ServerState;
/**
 * The interactive surface a step talks to. Implemented by `ui.ts` over
 * `@clack/prompts`; declared here as a pure interface so `types.ts` (and the
 * engine) never import the TUI library. Prompt methods resolve to the
 * `CANCEL` sentinel instead of throwing when the user aborts.
 */
export declare const CANCEL: unique symbol;
export type Cancellable<T> = T | typeof CANCEL;
export interface SpinnerHandle {
    start(message?: string): void;
    stop(message?: string): void;
    message(message: string): void;
}
export interface Ui {
    intro(message: string): void;
    outro(message: string): void;
    note(message: string, title?: string): void;
    /**
     * Plain, un-boxed output — no border/table drawing. Use for shell commands and
     * other content that a `note()` box would mangle when it wraps (long base64
     * file-writes, certbot lines). Renders verbatim so it stays copy-pasteable.
     */
    message(message: string): void;
    info(message: string): void;
    success(message: string): void;
    warn(message: string): void;
    error(message: string): void;
    select<T>(opts: {
        message: string;
        options: Array<{
            value: T;
            label: string;
            hint?: string;
        }>;
        initialValue?: T;
    }): Promise<Cancellable<T>>;
    multiselect<T>(opts: {
        message: string;
        options: Array<{
            value: T;
            label: string;
            hint?: string;
        }>;
        required?: boolean;
    }): Promise<Cancellable<T[]>>;
    confirm(opts: {
        message: string;
        initialValue?: boolean;
    }): Promise<Cancellable<boolean>>;
    text(opts: {
        message: string;
        placeholder?: string;
        initialValue?: string;
        validate?: (v: string) => string | undefined;
    }): Promise<Cancellable<string>>;
    password(opts: {
        message: string;
        validate?: (v: string) => string | undefined;
    }): Promise<Cancellable<string>>;
    spinner(): SpinnerHandle;
}
/** Result of running a command with captured output. */
export interface CommandResult {
    code: number;
    stdout: string;
    stderr: string;
}
/**
 * Command execution seam. The engine supplies a real implementation; tests
 * inject a fake so `sudoStep` / `verifyCommand` are exercised without touching
 * the host. In `CEZ_DRY_RUN`, side-effecting runs are short-circuited by the
 * step helpers, not the runner.
 */
export interface Runner {
    /**
     * Capture stdout/stderr; never throws on non-zero exit (returns the code).
     * `opts.input` is written to the child's stdin — use it to pass secrets
     * (passwords, tokens) so they never appear in the process's argv.
     */
    capture(program: string, args: string[], opts?: {
        input?: string;
    }): Promise<CommandResult>;
    /**
     * Inherit stdio (streams live output). Resolves with the exit code.
     * `opts.input` pipes the child's stdin instead of inheriting it — the
     * secret-passing channel for privileged commands (`cat > file` style), so
     * credentials never ride in argv where `ps` can read them.
     */
    interactive(program: string, args: string[], opts?: {
        input?: string;
        env?: Record<string, string>;
    }): Promise<number>;
}
/** Live install/uninstall context, threaded through every step. */
export interface InstallContext {
    state: ServerState;
    ui: Ui;
    runner: Runner;
    /**
     * Instance id (slug) this run targets. `default` (the original single-cockpit
     * flow) keeps every legacy path unchanged; a domain-derived slug suffixes the
     * nginx site, htpasswd, and systemd unit so instances never collide on one
     * host. Steps read this to build their instance-scoped paths.
     */
    instance: string;
    /** Atomically persist `state` to this instance's `~/.cezar` record. */
    save(): Promise<void>;
    /** CEZ_DRY_RUN — no real sudo, package installs, or network. */
    dryRun: boolean;
    /** `--yes`: auto-accept safe defaults; never invents a sudo password. */
    assumeYes: boolean;
    /** Step ids the user asked to force-rerun via `--reconfigure`. */
    reconfigure: ReadonlySet<string>;
    /** Repo root the autostart service should run `cezar serve` in. */
    repoRoot: string;
    /** ISO timestamp for this run (passed in — Date.now guard). */
    now: string;
    /**
     * Choices remembered for the rest of the run so the wizard stops re-asking.
     * `sudoMode` is set the first time the operator answers the sudo-vs-delegate
     * prompt — once they pick "I'll run it myself as root", every later privileged
     * command reuses that choice instead of prompting again.
     *
     * `cockpit` holds the credentials just set, IN MEMORY ONLY (never persisted to
     * `server.json`), so the final verify step can make a real authenticated
     * request through the proxy. Absent on a resume where the proxy step was
     * already done — the verify step then falls back to structural checks.
     */
    prefs: {
        sudoMode?: 'sudo' | 'delegate';
        cockpit?: {
            user: string;
            password: string;
        };
    };
}
export interface InstallStep {
    /** Stable — the key in `server.json`. Never rename once it has landed. */
    id: string;
    title: string;
    /** Optional steps (SSL, autostart) can be skipped without failing install. */
    optional?: boolean;
    /** True ⇒ already satisfied, engine skips (unless `--reconfigure` names it). */
    check(ctx: InstallContext): Promise<boolean>;
    /** Do it, interactively. Return what was created (or null). */
    run(ctx: InstallContext): Promise<StepCreated>;
    /** Reverse it, given back the recorded `created`. */
    undo(ctx: InstallContext, created: StepCreated): Promise<void>;
}
export interface PlatformStrategy {
    id: PlatformId;
    label: string;
    /** OS / arch / privilege sanity. Throw `PreflightError` to refuse politely. */
    preflight(ctx: InstallContext): Promise<void>;
    /** Ordered steps for this platform. */
    steps(ctx: InstallContext): InstallStep[];
    /**
     * Reload the running cockpit to pick up a new cezar version (a fresh local
     * build or a newly published `cezar-cli`) — the standardized `server-deploy`
     * entry point. Typically: restart the service + re-verify. Throw `StepAborted`
     * to report a failed deploy.
     */
    redeploy?(ctx: InstallContext): Promise<void>;
}
/** Thrown by `preflight` to stop with a clean, user-facing reason (no stack). */
export declare class PreflightError extends Error {
}
