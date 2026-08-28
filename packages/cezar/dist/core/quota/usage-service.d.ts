import type { AutoProvider } from '../runner-selection.ts';
import type { ProviderAccountRef, ProviderQuotaHealth, ProviderUsageSnapshot, ProviderUsageWindow } from './types.ts';
export interface ProviderUsageReading {
    health: ProviderQuotaHealth;
    source: string;
    windows: readonly ProviderUsageWindow[];
    error?: {
        code: string;
        message: string;
    };
}
/** Adapter boundary: implementations must return only normalized, sanitized data. */
export interface ProviderUsageAdapter {
    provider: AutoProvider;
    read(account: ProviderAccountRef): Promise<ProviderUsageReading>;
}
/** Persistence is deliberately injected. The service never knows credential locations or raw payloads. */
export interface ProviderUsageSnapshotStore {
    load(): Promise<readonly ProviderUsageSnapshot[]>;
    save(snapshots: readonly ProviderUsageSnapshot[]): Promise<void>;
}
export interface ProviderUsageServiceOptions {
    adapters: readonly ProviderUsageAdapter[];
    cacheTtlMs: number;
    /** Refresh cached accounts in the background without tying refreshes to UI reads. */
    refreshIntervalMs?: number;
    store?: ProviderUsageSnapshotStore;
    now?: () => number;
}
type UsageListener = (snapshot: ProviderUsageSnapshot) => void;
/**
 * Process-shared cache for provider usage. It serializes only each account's
 * refresh; the coordinator owns cross-account selection and reservations.
 */
export declare class ProviderUsageService {
    #private;
    private readonly options;
    constructor(options: ProviderUsageServiceOptions);
    /** Load a prior sanitized cache. Restored values always begin stale. */
    restore(): Promise<void>;
    get(account: ProviderAccountRef): ProviderUsageSnapshot | undefined;
    onChange(listener: UsageListener): () => void;
    refresh(account: ProviderAccountRef, force?: boolean): Promise<ProviderUsageSnapshot>;
    dispose(): void;
}
export {};
