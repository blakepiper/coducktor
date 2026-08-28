export type RunnerFailureKind = 'quota_exhausted' | 'unknown';
export declare function classifyRunnerFailure(message: string | undefined): RunnerFailureKind;
