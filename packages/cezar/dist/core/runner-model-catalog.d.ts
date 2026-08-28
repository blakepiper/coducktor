import type { RunnerId } from './agent-runner.ts';
export interface ModelOption {
    id: string;
    label: string;
    description: string;
    reasoningEfforts?: string[];
}
export type ModelCatalogSource = 'live' | 'cache' | 'unavailable';
export interface RunnerModelCatalogResult {
    runner: RunnerId;
    models: ModelOption[];
    source: ModelCatalogSource;
    stale: boolean;
    reason?: string;
}
export interface RunnerModelCatalogAdapter {
    discover(): Promise<ModelOption[]>;
}
export interface RunnerModelCatalogOptions {
    adapters: Partial<Record<RunnerId, RunnerModelCatalogAdapter>>;
    now?: () => number;
    ttlMs?: number;
}
/** Host-level, in-memory model discovery cache shared by every workspace. */
export declare class RunnerModelCatalog {
    #private;
    constructor(options: RunnerModelCatalogOptions);
    get(runner: RunnerId): Promise<RunnerModelCatalogResult>;
}
