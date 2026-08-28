import { type ServerState, type StepOutcome } from './types.ts';
/**
 * `~/.cezar/server.json` I/O and the single-writer lock. Reads degrade to a
 * fresh record on any corruption (house pattern — never crash the wizard);
 * writes are atomic (tmp + rename) and `0600`, since the file is the input to
 * uninstall's "reverse exactly what was created" logic.
 */
/** Load a host-level instance record, degrading to a fresh record on any error. */
export declare function loadServerState(instance?: string): ServerState;
/**
 * Every instance recorded on this host, newest schema first: the `default`
 * record (`server.json`) plus each named record under `server-instances/`.
 * Used to auto-pick a free loopback port for a new instance and to let
 * uninstall/deploy resolve which instance to act on. Never throws — an
 * unreadable dir or a corrupt file is simply skipped.
 */
export declare function listServerInstances(): Array<{
    instance: string;
    state: ServerState;
}>;
/**
 * The next free loopback port for a NEW instance, scanning from `startAt`
 * (4321, the default cockpit port) upward past every port already recorded by
 * another instance. Deterministic (recorded-state only, no network probe) so it
 * stays unit-testable; the operator can always override it with `--port`.
 */
export declare function nextFreeInstancePort(startAt?: number): number;
/** Atomically persist state as `0600`, creating its dir (`0700`) if needed. */
export declare function saveServerState(state: ServerState, instance?: string): void;
/**
 * Delete a named instance's state file (used after a complete uninstall so it
 * stops reserving its port and drops out of `listServerInstances`). The
 * `default` record is left in place — that is the legacy single-host file, and
 * its absence vs. an empty-but-present record has historically meant the same
 * thing, so we don't change that behavior. Best-effort; never throws.
 */
export declare function deleteServerState(instance: string): void;
/** A step is resolved (needs no run on resume) when it is done or skipped. */
export declare function isResolved(outcome: StepOutcome | undefined): boolean;
/**
 * First step id in `orderedIds` that is not yet resolved — the resume point.
 * `undefined` means every step is resolved (install complete).
 */
export declare function firstIncompleteStep(orderedIds: readonly string[], state: ServerState): string | undefined;
export declare class LockHeldError extends Error {
}
/**
 * Acquire the exclusive install lock. Throws `LockHeldError` if a *live*
 * process already holds it; a stale lock (dead pid) is reclaimed. Returns a
 * release function.
 */
export declare function acquireLock(instance?: string): () => void;
