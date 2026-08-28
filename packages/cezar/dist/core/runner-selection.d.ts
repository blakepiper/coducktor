import type { RunnerId } from './agent-runner.ts';
/**
 * A requested runner may be a concrete executable backend or the quota-aware
 * selection policy. `auto` deliberately does not belong in `RUNNER_IDS`:
 * runner construction, sessions, models, and persisted backend affinity all
 * require a concrete backend.
 */
export type RunnerSelection = RunnerId | 'auto';
export declare const AUTO_PROVIDER_IDS: readonly ['claude', 'codex'];
export type AutoProvider = (typeof AUTO_PROVIDER_IDS)[number];
export declare function isAutoProvider(value: string): value is AutoProvider;
