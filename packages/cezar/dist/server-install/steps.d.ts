import { type BackendCheck } from '../core/backend-detect.ts';
import { type InstallContext, type InstallStep, type Runner, type StepArtifact } from './types.ts';
/**
 * Platform-agnostic step helpers. The star is `sudoStep`: the wizard runs as a
 * normal account and never escalates silently. It prints the exact command,
 * lets the operator run it via `sudo` or run it themselves, then proves the box
 * is actually in the expected state with `verify()` before advancing — and
 * offers a redo when verification fails.
 */
/** Real command runner (Node child_process). */
export declare const defaultRunner: Runner;
/** Run a probe and assert its result. Returns false in dry-run (nothing is verifiably present). */
export declare function verifyCommand(ctx: InstallContext, program: string, args: string[], matcher?: (r: {
    code: number;
    stdout: string;
    stderr: string;
}) => boolean): Promise<boolean>;
/**
 * True when `sudo -n true` succeeds — the box grants passwordless sudo, OR a
 * sudo timestamp from an earlier command in this session is still cached.
 * Both mean "sudo will run right now without prompting", which is exactly the
 * question `--yes` mode needs answered before choosing sudo over delegate.
 */
export declare function hasPasswordlessSudo(ctx: InstallContext): Promise<boolean>;
/** A bare DNS hostname — no scheme, no path, no shell/nginx metacharacters. */
export declare const HOSTNAME_RE: RegExp;
export declare class StepCancelled extends Error {
}
export declare class StepAborted extends Error {
}
/** Thrown from an optional step's `run()` to record it as `skipped` (e.g. certbot DNS not ready). */
export declare class StepSkipped extends Error {
}
export interface SudoStepOpts {
    /** One-line description of what/why (shown above the command). */
    description: string;
    /** The privileged shell command (without a leading `sudo`). May use pipes/redirects. */
    command: string;
    /**
     * Optional human-readable context (e.g. the file contents being written) shown
     * in its own box before the raw command — keeps big base64 file-writes legible.
     */
    note?: string;
    /**
     * Optional step: when verification keeps failing the operator can *skip* it
     * (thrown as `StepSkipped`) instead of aborting the whole install. Used by SSL
     * (certbot can legitimately fail on external DNS / rate limits).
     */
    skippable?: boolean;
    /** Shown next to the "Skip" choice — how to finish this step by hand later. */
    skipHint?: string;
    /**
     * Secret payload fed to the command's stdin (`cat > file` style) so it never
     * appears in the process argv (`ps`-readable) or in root's shell history.
     * Sudo mode pipes it; delegate mode shows it once, on screen only, for the
     * operator to paste after the command.
     */
    input?: string;
    /** Human name for the stdin payload, e.g. "credential line". */
    inputLabel?: string;
    /** Prove the command actually took effect. Runs after every attempt. */
    verify: (ctx: InstallContext) => Promise<boolean>;
}
/**
 * A strong random cockpit password: guaranteed to mix lower/upper letters, a
 * digit and a symbol, drawn from a crypto RNG, with visually-ambiguous glyphs
 * (0/O/1/l/I) removed. Offered by the identity step so operators don't fall back
 * to a weak hand-picked password.
 */
export declare function generatePassword(length?: number): string;
/**
 * Execute one privileged command with the operator in the loop:
 * print → run-via-sudo OR delegate → verify → redo-on-mismatch.
 *
 * - Dry-run: prints the intended command and returns (no exec, no verify).
 * - `--yes` with passwordless sudo: runs non-interactively.
 * - `--yes` without passwordless sudo: falls back to delegate (never blocks on a hidden prompt).
 *
 * Throws `StepCancelled` if the user cancels, `StepAborted` if they give up after a failed verify.
 */
/** Single-quote a shell string so a copy-paste of `display` runs exactly what we run. */
export declare function shquote(s: string): string;
export declare function sudoStep(ctx: InstallContext, opts: SudoStepOpts): Promise<void>;
/** Convenience: an `owned` file/service/etc. artifact. */
export declare function owned(type: string, fields: Omit<StepArtifact, 'kind' | 'type'>): StepArtifact;
/** Convenience: a `shared` artifact (listed, not removed, on uninstall). */
export declare function shared(type: string, fields: Omit<StepArtifact, 'kind' | 'type'>): StepArtifact;
/**
 * The dependency step, built from `detectEnvironment()` (reused verbatim). It
 * shows the missing tools as a checkbox, installs the selected ones, and prints
 * the per-tool authorization instruction (agent CLIs need an interactive login
 * a wizard cannot fully automate). `detect` is injectable for tests.
 */
/** How a given platform installs one missing tool. Platform-agnostic seam. */
export type ToolInstaller = (ctx: InstallContext, name: string) => Promise<void>;
export interface DepStepOpts {
    detect?: () => Promise<BackendCheck[]>;
    /** Per-platform installer; defaults to the apt/npm (Ubuntu) one. */
    installTool?: ToolInstaller;
    /** Per-tool manual-removal hint shown by uninstall. */
    removeHint?: (name: string) => string;
}
export declare function depCheckStep(opts?: DepStepOpts): InstallStep;
/** Ubuntu/Debian installer: apt for gh, sudo npm -g for the agent CLIs (system node). */
export declare const aptInstallTool: ToolInstaller;
/** macOS installer: brew (no sudo) for gh, npm -g for the agent CLIs. */
export declare const brewInstallTool: ToolInstaller;
/** macOS-flavored removal hints (brew instead of apt). */
export declare function brewRemoveHint(name: string): string;
