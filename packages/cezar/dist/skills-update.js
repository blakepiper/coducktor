import { execFile } from 'node:child_process';
import { constants } from 'node:fs';
import { access, mkdir, open, readFile, rm, stat } from 'node:fs/promises';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';
import { promisify } from 'node:util';
const execFileAsync = promisify(execFile);
const CHECK_TTL_MS = 6 * 60 * 60 * 1_000;
const COMMAND_TIMEOUT_MS = 30_000;
const OUTPUT_CAP = 64 * 1_024;
const LOCK_STALE_MS = 2 * 60 * 1_000;
/** A manual apply distinguishes contention from ordinary unavailable state. */
export class SkillsUpdateConflictError extends Error {
    constructor() { super('another skills update operation is running'); this.name = 'SkillsUpdateConflictError'; }
}
/** Accept only GitHub's canonical host and the documented owner/repo shorthand. */
export function isOpenMercatoSkillsSource(value) {
    if (typeof value !== 'string')
        return false;
    const source = value.trim().replace(/\/$/, '');
    if (/^open-mercato\/skills(?:\.git)?$/i.test(source))
        return true;
    try {
        const url = new URL(source);
        return url.protocol === 'https:' && url.hostname.toLowerCase() === 'github.com'
            && /^\/open-mercato\/skills(?:\.git)?$/i.test(url.pathname);
    }
    catch {
        return false;
    }
}
async function readLock(path) {
    let parsed;
    try {
        parsed = JSON.parse(await readFile(path, 'utf8'));
    }
    catch (error) {
        return error.code === 'ENOENT' ? { kind: 'missing' } : { kind: 'invalid' };
    }
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed))
        return { kind: 'invalid' };
    const root = parsed;
    if (root.version !== undefined && (!Number.isInteger(root.version) || Number(root.version) < 1 || Number(root.version) > 3)) {
        return { kind: 'invalid' };
    }
    if (!root.skills || typeof root.skills !== 'object' || Array.isArray(root.skills))
        return { kind: 'invalid' };
    const names = Object.entries(root.skills).flatMap(([name, raw]) => {
        if (!name || !raw || typeof raw !== 'object' || Array.isArray(raw))
            return [];
        const entry = raw;
        return isOpenMercatoSkillsSource(entry.source) || isOpenMercatoSkillsSource(entry.sourceUrl) ? [name] : [];
    });
    return { kind: 'ok', names: [...new Set(names)].sort() };
}
function blankScope(scope) {
    return { scope, status: 'idle', available: false, skills: [], checkedAt: null, updatedAt: null };
}
function reasonFor(error) {
    const err = error;
    const text = String(err.message ?? '').toLowerCase();
    if (err.code === 'ENOENT')
        return 'npx is unavailable';
    if (err.killed || err.signal === 'SIGTERM' || text.includes('timed out'))
        return 'update check timed out';
    if (/(enotfound|eai_again|network|offline|fetch failed)/.test(text))
        return 'update check is offline';
    return 'update check failed';
}
async function defaultResolveNpx() {
    const name = process.platform === 'win32' ? 'npx.cmd' : 'npx';
    const adjacent = join(dirname(process.execPath), name);
    try {
        await access(adjacent, constants.X_OK);
        return adjacent;
    }
    catch {
        return name;
    }
}
async function defaultRun(file, args, cwd, timeoutMs) {
    const result = await execFileAsync(file, [...args], {
        cwd, shell: false, timeout: timeoutMs, maxBuffer: OUTPUT_CAP,
        env: { ...process.env, npm_config_yes: 'true', GIT_TERMINAL_PROMPT: '0' },
    });
    return { stdout: result.stdout, stderr: result.stderr };
}
/** Parse only explicit update lines naming a lock-authorized skill. */
function availableNames(output, names) {
    const lines = output.split(/\r?\n/);
    return names.filter((name) => lines.some((line) => line.toLowerCase().includes(name.toLowerCase()) && /update|out.of.date|new version/i.test(line)));
}
export class SkillsUpdateService {
    home;
    now;
    timeoutMs;
    runCommand;
    resolveNpx;
    invalidateCatalog;
    states = new Map();
    pending = new Map();
    globalScopeCache;
    operationTail = Promise.resolve();
    constructor(options = {}) {
        this.home = options.homeDir ?? homedir();
        this.now = options.now ?? Date.now;
        this.timeoutMs = options.timeoutMs ?? COMMAND_TIMEOUT_MS;
        this.runCommand = options.run ?? defaultRun;
        this.resolveNpx = options.resolveNpx ?? defaultResolveNpx;
        this.invalidateCatalog = options.invalidateCatalog ?? (() => undefined);
    }
    snapshot(repoRoot) {
        return this.states.get(repoRoot) ?? this.makeState();
    }
    check(repoRoot, force = false) {
        const cached = this.states.get(repoRoot);
        if (!force && cached?.checkedAt && this.now() - Date.parse(cached.checkedAt) < CHECK_TTL_MS)
            return Promise.resolve(cached);
        const active = this.pending.get(repoRoot);
        if (active)
            return active;
        const task = this.serialized(() => this.performCheck(repoRoot, force)).finally(() => this.pending.delete(repoRoot));
        this.pending.set(repoRoot, task);
        return task;
    }
    /** Apply only names proven available by the latest check. Browser callers
     * cannot widen this list: ownership is re-read from the lock immediately
     * before each fixed-argument invocation. */
    update(repoRoot, rejectIfBusy = false) {
        const active = this.pending.get(repoRoot);
        if (active)
            return rejectIfBusy ? Promise.reject(new SkillsUpdateConflictError()) : active;
        const task = this.serialized(() => this.performUpdate(repoRoot, rejectIfBusy)).finally(() => this.pending.delete(repoRoot));
        this.pending.set(repoRoot, task);
        return task;
    }
    evict(repoRoot) {
        this.states.delete(repoRoot);
    }
    async serialized(operation) {
        const previous = this.operationTail;
        let release;
        this.operationTail = new Promise((resolve) => { release = resolve; });
        await previous.catch(() => undefined);
        try {
            return await operation();
        }
        finally {
            release();
        }
    }
    makeState(scopes = [blankScope('project'), blankScope('global')]) {
        return { status: 'idle', available: false, autoUpdateEnabled: false, inherited: true,
            checkedAt: null, updatedAt: null, scopes, needsUpgradeNotes: false };
    }
    async performCheck(repoRoot, force = false, rejectIfBusy = false) {
        if (process.env.CEZ_DRY_RUN === '1') {
            const checkedAt = new Date(this.now()).toISOString();
            const scopes = [blankScope('project'), blankScope('global')].map((scope) => ({ ...scope, status: 'current', checkedAt }));
            const state = { ...this.makeState(scopes), status: 'current', checkedAt };
            this.states.set(repoRoot, state);
            return state;
        }
        const lockPath = join(this.home, '.cache', 'cez', 'skills-update.lock');
        let release;
        try {
            release = await this.acquireLock(lockPath, rejectIfBusy);
            const npx = await this.resolveNpx();
            if (!npx)
                throw Object.assign(new Error('missing executable'), { code: 'ENOENT' });
            const pairs = [
                ['project', join(repoRoot, 'skills-lock.json')],
                ['global', join(this.home, '.agents', '.skill-lock.json')],
            ];
            const scopes = [];
            for (const [scope, path] of pairs) {
                if (scope === 'global' && !force && this.globalScopeCache?.checkedAt
                    && this.now() - Date.parse(this.globalScopeCache.checkedAt) < CHECK_TTL_MS) {
                    scopes.push(this.globalScopeCache);
                }
                else {
                    const result = await this.checkScope(scope, path, repoRoot, npx);
                    if (scope === 'global')
                        this.globalScopeCache = result;
                    scopes.push(result);
                }
            }
            const available = scopes.some((scope) => scope.available);
            const checkedAt = new Date(this.now()).toISOString();
            const status = available ? 'available'
                : scopes.some((scope) => scope.status === 'error') ? 'error'
                    : scopes.every((scope) => scope.status === 'unavailable') ? 'unavailable' : 'current';
            const state = { ...this.makeState(scopes), status, available, checkedAt };
            this.states.set(repoRoot, state);
            return state;
        }
        catch (error) {
            if (error instanceof SkillsUpdateConflictError)
                throw error;
            const checkedAt = new Date(this.now()).toISOString();
            const reason = reasonFor(error);
            const scopes = [blankScope('project'), blankScope('global')].map((scope) => ({ ...scope, status: 'unavailable', checkedAt, reason }));
            const state = { ...this.makeState(scopes), status: 'unavailable', checkedAt };
            this.states.set(repoRoot, state);
            return state;
        }
        finally {
            await release?.();
        }
    }
    async performUpdate(repoRoot, rejectIfBusy) {
        if (process.env.CEZ_DRY_RUN === '1') {
            const updatedAt = new Date(this.now()).toISOString();
            const scopes = [blankScope('project'), blankScope('global')].map((scope) => ({ ...scope, status: 'current', checkedAt: updatedAt, updatedAt }));
            const state = { ...this.makeState(scopes), status: 'current', checkedAt: updatedAt, updatedAt, needsUpgradeNotes: true };
            this.states.set(repoRoot, state);
            return state;
        }
        let current = this.states.get(repoRoot);
        if (!current?.checkedAt)
            current = await this.performCheck(repoRoot, false, rejectIfBusy);
        if (!current.available)
            return current;
        const lockPath = join(this.home, '.cache', 'cez', 'skills-update.lock');
        let release;
        const completed = new Set();
        const outcomes = [];
        try {
            release = await this.acquireLock(lockPath, rejectIfBusy);
            const npx = await this.resolveNpx();
            if (!npx)
                throw Object.assign(new Error('missing executable'), { code: 'ENOENT' });
            for (const scope of ['project', 'global']) {
                const prior = current.scopes.find((entry) => entry.scope === scope) ?? blankScope(scope);
                if (!prior.available || prior.skills.length === 0) {
                    outcomes.push(prior);
                    continue;
                }
                const path = scope === 'project' ? join(repoRoot, 'skills-lock.json') : join(this.home, '.agents', '.skill-lock.json');
                const owned = await readLock(path);
                const names = owned.kind === 'ok' ? prior.skills.filter((name) => owned.names.includes(name)).sort() : [];
                if (names.length === 0) {
                    outcomes.push({ ...prior, status: 'unavailable', reason: 'installation metadata is unsupported' });
                    continue;
                }
                try {
                    await this.runCommand(npx, ['--yes', 'skills', 'update', ...names, scope === 'project' ? '-p' : '-g', '-y'], repoRoot, this.timeoutMs);
                    completed.add(scope);
                    outcomes.push({ ...prior, status: 'current', available: false, skills: [], updatedAt: new Date(this.now()).toISOString(), reason: undefined });
                }
                catch (error) {
                    outcomes.push({ ...prior, status: 'error', reason: reasonFor(error) });
                }
            }
        }
        catch (error) {
            if (error instanceof SkillsUpdateConflictError)
                throw error;
            const reason = reasonFor(error);
            for (const scope of ['project', 'global']) {
                const prior = current.scopes.find((entry) => entry.scope === scope) ?? blankScope(scope);
                outcomes.push({ ...prior, status: prior.available ? 'error' : prior.status, reason: prior.available ? reason : prior.reason });
            }
        }
        finally {
            await release?.();
        }
        // Recheck after releasing the cross-process lock: performCheck owns the
        // same lock and must observe the files written by every successful scope.
        this.states.set(repoRoot, { ...current, scopes: outcomes, status: outcomes.some((s) => s.status === 'error') ? 'error' : 'current' });
        if (completed.size > 0)
            await Promise.resolve(this.invalidateCatalog(repoRoot)).catch(() => undefined);
        const checked = await this.performCheck(repoRoot, true);
        const failedByScope = new Map(outcomes.filter((s) => s.status === 'error').map((s) => [s.scope, s]));
        const scopes = checked.scopes.map((scope) => failedByScope.get(scope.scope) ?? (completed.has(scope.scope) ? { ...scope, updatedAt: outcomes.find((s) => s.scope === scope.scope)?.updatedAt ?? null } : scope));
        const available = scopes.some((scope) => scope.available);
        const status = scopes.some((scope) => scope.status === 'error') ? 'error' : available ? 'available' : 'current';
        const updatedAt = completed.size > 0 ? new Date(this.now()).toISOString() : current.updatedAt;
        const final = { ...checked, scopes, available, status, updatedAt, needsUpgradeNotes: current.needsUpgradeNotes || completed.size > 0 };
        this.states.set(repoRoot, final);
        return final;
    }
    async checkScope(scope, path, cwd, npx) {
        const checkedAt = new Date(this.now()).toISOString();
        const lock = await readLock(path);
        if (lock.kind === 'missing')
            return { ...blankScope(scope), status: 'current', checkedAt, reason: 'installation is not tracked' };
        if (lock.kind === 'invalid')
            return { ...blankScope(scope), status: 'unavailable', checkedAt, reason: 'installation metadata is unsupported' };
        if (lock.names.length === 0)
            return { ...blankScope(scope), status: 'current', checkedAt, reason: 'Open Mercato installation is not tracked' };
        try {
            const args = ['--yes', 'skills', 'check', ...lock.names, ...(scope === 'project' ? ['-p'] : ['-g'])];
            const result = await this.runCommand(npx, args, cwd, this.timeoutMs);
            const skills = availableNames(`${result.stdout}\n${result.stderr}`, lock.names);
            return { ...blankScope(scope), status: skills.length ? 'available' : 'current', available: skills.length > 0, skills, checkedAt };
        }
        catch (error) {
            return { ...blankScope(scope), status: 'error', checkedAt, reason: reasonFor(error) };
        }
    }
    async acquireLock(path, rejectIfBusy = false) {
        await mkdir(dirname(path), { recursive: true });
        try {
            const handle = await open(path, 'wx', 0o600);
            await handle.writeFile(`${process.pid}\n${this.now()}\n`);
            await handle.close();
        }
        catch (error) {
            if (error.code !== 'EEXIST')
                throw error;
            const metadata = await this.readLockMetadata(path);
            const age = this.now() - metadata.timestamp;
            if (age <= LOCK_STALE_MS && metadata.alive) {
                if (rejectIfBusy)
                    throw new SkillsUpdateConflictError();
                throw new Error('another skills update check is running');
            }
            await rm(path, { force: true });
            const handle = await open(path, 'wx', 0o600);
            await handle.writeFile(`${process.pid}\n${this.now()}\n`);
            await handle.close();
        }
        return () => rm(path, { force: true });
    }
    async readLockMetadata(path) {
        const fallback = (await stat(path)).mtimeMs;
        try {
            const [pidText, timestampText] = (await readFile(path, 'utf8')).trim().split(/\s+/);
            const pid = Number(pidText);
            const timestamp = Number(timestampText);
            if (!Number.isSafeInteger(pid) || pid <= 0 || !Number.isFinite(timestamp))
                return { timestamp: fallback, alive: false };
            try {
                process.kill(pid, 0);
                return { timestamp, alive: true };
            }
            catch (error) {
                return { timestamp, alive: error.code === 'EPERM' };
            }
        }
        catch {
            return { timestamp: fallback, alive: false };
        }
    }
}
/** Post-listen owner for background checks. Its tail deliberately swallows
 * failures: update availability can never reject or delay server startup. */
export class SkillsUpdateCoordinator {
    service;
    autoUpdateEnabled;
    roots = new Map();
    tail = Promise.resolve();
    stopped = false;
    constructor(service, autoUpdateEnabled) {
        this.service = service;
        this.autoUpdateEnabled = autoUpdateEnabled;
    }
    start(projects) {
        for (const project of projects) {
            if (project.status !== 'missing')
                this.add(project.id, project.root);
        }
    }
    add(id, root) {
        if (this.stopped)
            return;
        this.roots.set(id, root);
        this.tail = this.tail.then(async () => {
            if (this.stopped || this.roots.get(id) !== root)
                return;
            const state = await this.service.check(root);
            if (state.available && await this.autoUpdateEnabled())
                await this.service.update(root);
        }).catch(() => undefined);
    }
    remove(id) {
        const root = this.roots.get(id);
        this.roots.delete(id);
        if (root)
            this.service.evict(root);
    }
    stop() {
        this.stopped = true;
        for (const root of this.roots.values())
            this.service.evict(root);
        this.roots.clear();
    }
    /** Test/lifecycle hook: resolves after all work queued so far. */
    settled() { return this.tail; }
}
//# sourceMappingURL=skills-update.js.map