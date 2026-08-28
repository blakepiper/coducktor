import type { AutoProvider } from '../runner-selection.ts';
import type { ProviderAccountRef, ProviderUsageSnapshot } from './types.ts';
export interface UsageSnapshotReader {
    get(account: ProviderAccountRef): ProviderUsageSnapshot | undefined;
    refresh(account: ProviderAccountRef, force?: boolean): Promise<ProviderUsageSnapshot>;
}
/** Read a stable provider-order report without exposing profile paths or env. */
export declare function readUsageReport(usage: UsageSnapshotReader, accounts: Readonly<Record<AutoProvider, ProviderAccountRef>>, refresh: boolean): Promise<ProviderUsageSnapshot[]>;
export declare function formatUsageReport(snapshots: readonly ProviderUsageSnapshot[]): string;
