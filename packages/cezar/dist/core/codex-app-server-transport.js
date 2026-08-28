import { spawn as nodeSpawn } from 'node:child_process';
import { trackChildExit } from './agent-runner.js';
import { buildChildEnv } from './agent-env.js';
import { EOF_KILL_GRACE_MS, EOF_TERM_GRACE_MS, KILL_GRACE_MS } from './claude-cli-runner.js';
export function resolveCodexExecutable(override) {
    return override ?? process.env.CEZ_CODEX_BIN ?? 'codex';
}
export function buildCodexAppServerEnv(extraEnv) {
    return buildChildEnv({ backend: 'codex', extraEnv });
}
/** Spawn the authenticated host's app-server with the same least-privilege env used by runs. */
export function spawnCodexAppServer(bin, cwd, extraEnv) {
    try {
        return nodeSpawn(bin, ['app-server'], {
            cwd,
            env: buildCodexAppServerEnv(extraEnv),
        });
    }
    catch (error) {
        throw codexSpawnError(error, bin);
    }
}
/** Minimal newline-JSON request correlator shared by runs and short-lived discovery. */
export class CodexAppServerRpc {
    child;
    nextId = 1;
    pending = new Map();
    constructor(child) {
        this.child = child;
    }
    allocateId() {
        return this.nextId++;
    }
    request(method, params) {
        const id = this.allocateId();
        const promise = new Promise((resolve, reject) => {
            this.pending.set(id, { resolve, reject });
        });
        this.write({ id, method, params });
        return promise;
    }
    notify(method, params) {
        this.write({ method, params });
    }
    respond(message) {
        this.write(message);
    }
    dispatchResponse(message) {
        if (typeof message.id !== 'number' || (message.result === undefined && message.error === undefined))
            return false;
        const pending = this.pending.get(message.id);
        if (!pending)
            return false;
        this.pending.delete(message.id);
        if (message.error)
            pending.reject(new Error(codexErrorText(message.error)));
        else
            pending.resolve(message.result ?? {});
        return true;
    }
    async initialize() {
        await this.request('initialize', {
            clientInfo: { name: 'cezar', title: 'cezar', version: '0.1.0' },
            capabilities: { experimentalApi: true },
        });
        this.notify('initialized', {});
    }
    rejectPending(message = 'codex app-server exited') {
        for (const request of this.pending.values())
            request.reject(new Error(message));
        this.pending.clear();
    }
    write(message) {
        if (this.child.stdin.destroyed)
            return;
        try {
            this.child.stdin.write(`${JSON.stringify(message)}\n`);
        }
        catch {
            // The read/exit path owns settlement when stdin disappears.
        }
    }
}
/**
 * Close stdin, then escalate SIGTERM→SIGKILL for a server that ignores EOF.
 * `onSignal` fires when the watchdog actually signals: the caller needs to
 * know a non-zero exit was its own doing, not a codex failure (#703).
 */
export function endCodexAppServer(child, onTimers, onSignal) {
    try {
        child.stdin.end();
    }
    catch {
        // already gone
    }
    // Real termination, not `child.killed` — the latter is set by the SIGTERM
    // this very watchdog sends, which would then suppress its own SIGKILL for an
    // app-server that handles the signal instead of dying from it (#844).
    const hasExited = trackChildExit(child);
    let killTimer;
    const termTimer = setTimeout(() => {
        if (!hasExited()) {
            onSignal?.();
            child.kill('SIGTERM');
        }
        killTimer = setTimeout(() => {
            if (!hasExited()) {
                onSignal?.();
                child.kill('SIGKILL');
            }
        }, EOF_KILL_GRACE_MS);
        killTimer.unref?.();
        onTimers?.(termTimer, killTimer);
    }, EOF_TERM_GRACE_MS);
    termTimer.unref?.();
    onTimers?.(termTimer, killTimer);
}
export function waitForCodexAppServerExit(child) {
    if (child.exitCode != null)
        return Promise.resolve(child.exitCode);
    return new Promise((resolve) => {
        let done = false;
        const finish = (code) => {
            if (done)
                return;
            done = true;
            clearTimeout(safety);
            resolve(code);
        };
        child.once('close', (code) => finish(code));
        child.once('exit', (code) => finish(code));
        child.once('error', () => finish(child.exitCode ?? null));
        const safety = setTimeout(() => finish(child.exitCode ?? null), EOF_TERM_GRACE_MS + EOF_KILL_GRACE_MS + KILL_GRACE_MS + 5_000);
        safety.unref?.();
    });
}
export function codexSpawnError(error, bin) {
    const code = error?.code;
    if (code === 'ENOENT') {
        return new Error(`\`${bin}\` not found on PATH — install the Codex CLI (npm i -g @openai/codex) and run \`codex\` once to log in`);
    }
    return error instanceof Error ? error : new Error(String(error));
}
function codexErrorText(error) {
    if (error && typeof error === 'object' && 'message' in error) {
        return String(error.message);
    }
    return typeof error === 'string' ? error : JSON.stringify(error);
}
//# sourceMappingURL=codex-app-server-transport.js.map