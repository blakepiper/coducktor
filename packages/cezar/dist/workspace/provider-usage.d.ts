import type { ProviderUsageSnapshot } from '../core/quota/types.ts';
import type { ProviderUsageSnapshotStore } from '../core/quota/usage-service.ts';
/**
 * Small durable cache for provider usage. It deliberately drops adapter error
 * details: they are transient, potentially provider-controlled, and are not
 * necessary to restore an advisory stale snapshot after restart.
 */
export declare class FileProviderUsageSnapshotStore implements ProviderUsageSnapshotStore {
    private readonly path;
    constructor(path?: string);
    load(): Promise<readonly ProviderUsageSnapshot[]>;
    save(snapshots: readonly ProviderUsageSnapshot[]): Promise<void>;
}
