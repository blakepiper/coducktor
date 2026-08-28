import { closeSync, existsSync, mkdirSync, openSync, readFileSync, renameSync, statSync, unlinkSync, writeFileSync, } from 'node:fs';
import { randomUUID } from 'node:crypto';
import { collectSecretValues, redactDeep } from '../core/secret-redaction.js';
import { join } from 'node:path';
import { automationDefinitionSchema, automationDefinitionsFileSchema, automationLogRecordSchema, automationReceiptSchema, automationStateFileSchema, } from './types.js';
const DEFINITIONS = 'automations.json';
const STATE = 'automation-state.json';
const RECEIPTS = 'automation-receipts.ndjson';
const LOG = 'automation-log.ndjson';
const POLL_LOCK = 'automation-poll.lock';
const RETENTION_MS = 90 * 24 * 60 * 60 * 1_000;
export class AutomationStore {
    dataDir;
    options;
    definitionsFile = { version: 1, automations: [] };
    stateFile = { version: 1, states: {} };
    definitions = new Map();
    warned = new Set();
    logSeq = 0;
    now;
    secrets = collectSecretValues();
    static open(dataDir, options = {}) {
        const store = new AutomationStore(dataDir, options);
        store.load();
        return store;
    }
    constructor(dataDir, options) {
        this.dataDir = dataDir;
        this.options = options;
        this.now = options.now ?? (() => new Date());
    }
    list() {
        return [...this.definitions.values()].sort((a, b) => a.name.localeCompare(b.name));
    }
    get(id) {
        return this.definitions.get(id);
    }
    create(input, id = randomUUID()) {
        if (this.definitions.has(id) || this.isTombstoned(id))
            throw new Error('automation id unavailable');
        const now = this.now().toISOString();
        const definition = automationDefinitionSchema.parse({
            ...input,
            id,
            revision: 1,
            createdAt: now,
            updatedAt: now,
        });
        this.definitions.set(id, definition);
        this.persistDefinitions();
        return definition;
    }
    update(id, expectedRevision, input) {
        const current = this.definitions.get(id);
        if (!current)
            throw new Error('automation not found');
        if (current.revision !== expectedRevision)
            throw new Error('automation revision conflict');
        const definition = automationDefinitionSchema.parse({
            ...current,
            ...input,
            id,
            revision: current.revision + 1,
            createdAt: current.createdAt,
            updatedAt: this.now().toISOString(),
        });
        this.definitions.set(id, definition);
        const state = this.state(id);
        if (state)
            this.setState(id, { ...state, revision: definition.revision });
        this.persistDefinitions();
        return definition;
    }
    delete(id) {
        if (!this.definitions.delete(id))
            return false;
        this.definitionsFile.tombstones = {
            ...this.definitionsFile.tombstones,
            [id]: this.now().toISOString(),
        };
        this.persistDefinitions();
        return true;
    }
    state(id) {
        return this.stateFile.states[id];
    }
    setState(id, state) {
        this.stateFile.states = { ...this.stateFile.states, [id]: state };
        this.atomicJson(STATE, this.stateFile);
    }
    receipts() {
        return this.readNdjson(RECEIPTS, automationReceiptSchema);
    }
    latestReceipts() {
        const latest = new Map();
        for (const row of this.receipts())
            latest.set(row.receiptKey, row);
        return latest;
    }
    appendReceipt(receipt) {
        this.appendNdjson(RECEIPTS, redactDeep(automationReceiptSchema.parse(receipt), this.secrets));
    }
    reserveReceipt(input) {
        const receiptKey = `${input.automationId}:${input.eventId}`;
        if (this.latestReceipts().has(receiptKey))
            return undefined;
        const now = this.now().toISOString();
        const receipt = automationReceiptSchema.parse({
            ...input,
            receiptKey,
            receiptId: randomUUID(),
            status: 'reserved',
            observedAt: now,
            updatedAt: now,
        });
        this.appendReceipt(receipt);
        return receipt;
    }
    appendLog(record) {
        const parsed = automationLogRecordSchema.parse({
            ...record,
            seq: ++this.logSeq,
            ts: record.ts ?? this.now().toISOString(),
        });
        this.appendNdjson(LOG, redactDeep(parsed, this.secrets));
        return parsed;
    }
    logs(options = {}) {
        const limit = Math.min(Math.max(options.limit ?? 100, 1), 100);
        return this.readNdjson(LOG, automationLogRecordSchema)
            .filter((row) => !options.automationId || row.automationId === options.automationId)
            .filter((row) => !options.result || row.result === options.result)
            .filter((row) => !options.event || row.event === options.event)
            .filter((row) => !options.since || row.ts >= options.since)
            .filter((row) => !options.cursor || row.seq < options.cursor)
            .slice(-limit)
            .reverse();
    }
    compact() {
        const cutoff = this.now().getTime() - RETENTION_MS;
        const latest = [...this.latestReceipts().values()].filter((row) => Date.parse(row.updatedAt) >= cutoff);
        this.rewriteNdjson(RECEIPTS, latest);
        const logs = this.readNdjson(LOG, automationLogRecordSchema);
        this.rewriteNdjson(LOG, logs.slice(-10_000));
    }
    maybeCompact() {
        if (this.receipts().length > 20_000 || this.readNdjson(LOG, automationLogRecordSchema).length > 10_500) {
            this.compact();
        }
    }
    acquireLease(staleAfterMs = 10 * 60_000) {
        mkdirSync(this.dataDir, { recursive: true });
        const path = join(this.dataDir, POLL_LOCK);
        try {
            const fd = openSync(path, 'wx', 0o600);
            writeFileSync(fd, JSON.stringify({ pid: process.pid, startedAt: this.now().toISOString() }));
            return new AutomationLease(path, fd);
        }
        catch {
            try {
                if (this.now().getTime() - statSync(path).mtimeMs > staleAfterMs) {
                    unlinkSync(path);
                    return this.acquireLease(staleAfterMs);
                }
            }
            catch {
                // A contender removed the lock or the directory is read-only.
            }
            return undefined;
        }
    }
    load() {
        mkdirSync(this.dataDir, { recursive: true });
        this.loadDefinitions();
        this.stateFile = this.readJson(STATE, automationStateFileSchema, {
            version: 1,
            states: {},
        });
        const logs = this.readNdjson(LOG, automationLogRecordSchema);
        this.logSeq = logs.at(-1)?.seq ?? 0;
    }
    loadDefinitions() {
        this.definitionsFile = this.readJson(DEFINITIONS, automationDefinitionsFileSchema, {
            version: 1,
            automations: [],
        });
        for (const raw of this.definitionsFile.automations) {
            const parsed = automationDefinitionSchema.safeParse(raw);
            if (parsed.success)
                this.definitions.set(parsed.data.id, parsed.data);
            else
                this.warnOnce('definitions', 'Ignored an invalid GitHub automation definition.');
        }
    }
    persistDefinitions() {
        this.pruneTombstones();
        this.definitionsFile.automations = [...this.definitions.values()];
        this.atomicJson(DEFINITIONS, this.definitionsFile);
    }
    isTombstoned(id) {
        const deletedAt = this.definitionsFile.tombstones?.[id];
        return Boolean(deletedAt && Date.parse(deletedAt) >= this.now().getTime() - RETENTION_MS);
    }
    pruneTombstones() {
        const cutoff = this.now().getTime() - RETENTION_MS;
        this.definitionsFile.tombstones = Object.fromEntries(Object.entries(this.definitionsFile.tombstones ?? {}).filter(([, timestamp]) => Date.parse(timestamp) >= cutoff));
    }
    readJson(filename, schema, fallback) {
        const path = join(this.dataDir, filename);
        if (!existsSync(path))
            return fallback;
        try {
            const parsed = schema.safeParse(JSON.parse(readFileSync(path, 'utf8')));
            if (parsed.success)
                return parsed.data;
        }
        catch {
            // Warn once below.
        }
        this.warnOnce(filename, `Ignored corrupt automation state in ${filename}.`);
        return fallback;
    }
    readNdjson(filename, schema) {
        const path = join(this.dataDir, filename);
        if (!existsSync(path))
            return [];
        const rows = [];
        for (const line of readFileSync(path, 'utf8').split('\n')) {
            if (!line)
                continue;
            try {
                const parsed = schema.safeParse(JSON.parse(line));
                if (parsed.success)
                    rows.push(parsed.data);
                else
                    this.warnOnce(filename, `Skipped a malformed row in ${filename}.`);
            }
            catch {
                this.warnOnce(filename, `Skipped a malformed row in ${filename}.`);
            }
        }
        return rows;
    }
    atomicJson(filename, value) {
        mkdirSync(this.dataDir, { recursive: true });
        const path = join(this.dataDir, filename);
        const temporary = `${path}.tmp`;
        writeFileSync(temporary, `${JSON.stringify(value, null, 2)}\n`, { mode: 0o600 });
        renameSync(temporary, path);
    }
    appendNdjson(filename, value) {
        mkdirSync(this.dataDir, { recursive: true });
        const path = join(this.dataDir, filename);
        const fd = openSync(path, 'a', 0o600);
        try {
            writeFileSync(fd, `${JSON.stringify(value)}\n`);
        }
        finally {
            closeSync(fd);
        }
    }
    rewriteNdjson(filename, rows) {
        const path = join(this.dataDir, filename);
        const temporary = `${path}.tmp`;
        writeFileSync(temporary, rows.map((row) => JSON.stringify(row)).join('\n') + (rows.length ? '\n' : ''), {
            mode: 0o600,
        });
        renameSync(temporary, path);
    }
    warnOnce(key, message) {
        if (this.warned.has(key))
            return;
        this.warned.add(key);
        this.options.warn?.(message);
    }
}
export class AutomationLease {
    path;
    fd;
    released = false;
    constructor(path, fd) {
        this.path = path;
        this.fd = fd;
    }
    release() {
        if (this.released)
            return;
        this.released = true;
        closeSync(this.fd);
        try {
            unlinkSync(this.path);
        }
        catch {
            // Already removed during shutdown cleanup.
        }
    }
}
//# sourceMappingURL=store.js.map