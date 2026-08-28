import { type AutomationDefinition, type AutomationLogRecord, type AutomationReceipt, type AutomationRuntimeState } from './types.ts';
import type { GithubCandidate } from './github-poller.ts';
export interface AutomationStoreOptions {
    warn?: (message: string) => void;
    now?: () => Date;
}
export declare class AutomationStore {
    readonly dataDir: string;
    private readonly options;
    private definitionsFile;
    private stateFile;
    private definitions;
    private warned;
    private logSeq;
    private readonly now;
    private readonly secrets;
    static open(dataDir: string, options?: AutomationStoreOptions): AutomationStore;
    private constructor();
    list(): AutomationDefinition[];
    get(id: string): AutomationDefinition | undefined;
    create(input: Omit<AutomationDefinition, 'id' | 'revision' | 'createdAt' | 'updatedAt'>, id?: string): AutomationDefinition;
    update(id: string, expectedRevision: number, input: Omit<AutomationDefinition, 'id' | 'revision' | 'createdAt' | 'updatedAt'>): AutomationDefinition;
    delete(id: string): boolean;
    state(id: string): AutomationRuntimeState | undefined;
    setState(id: string, state: AutomationRuntimeState): void;
    receipts(): AutomationReceipt[];
    latestReceipts(): Map<string, AutomationReceipt>;
    appendReceipt(receipt: AutomationReceipt): void;
    reserveReceipt(input: {
        automationId: string;
        revision: number;
        eventId: string;
        candidate?: GithubCandidate;
    }): AutomationReceipt | undefined;
    appendLog(record: Omit<AutomationLogRecord, 'seq' | 'ts'> & Partial<Pick<AutomationLogRecord, 'ts'>>): AutomationLogRecord;
    logs(options?: {
        automationId?: string;
        result?: AutomationLogRecord['result'];
        event?: AutomationLogRecord['event'];
        since?: string;
        cursor?: number;
        limit?: number;
    }): AutomationLogRecord[];
    compact(): void;
    maybeCompact(): void;
    acquireLease(staleAfterMs?: number): AutomationLease | undefined;
    private load;
    private loadDefinitions;
    private persistDefinitions;
    private isTombstoned;
    private pruneTombstones;
    private readJson;
    private readNdjson;
    private atomicJson;
    private appendNdjson;
    private rewriteNdjson;
    private warnOnce;
}
export declare class AutomationLease {
    private readonly path;
    private readonly fd;
    private released;
    constructor(path: string, fd: number);
    release(): void;
}
