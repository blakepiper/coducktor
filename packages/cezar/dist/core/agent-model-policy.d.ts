/** The server-side switch that makes native agent settings authoritative. */
export declare const AGENT_MODELS_LOCKED_ENV = "CEZ_AGENT_MODELS_LOCKED";
/**
 * Only the exact environment value `1` enables the process-wide lock. The
 * global workspace config or one repository may additionally opt in with
 * `"modelsLocked": true`; missing, unreadable, malformed, and false values
 * preserve ordinary model selection unless another source enables the lock.
 */
export declare function agentModelsLocked(repoRoot?: string, env?: NodeJS.ProcessEnv): boolean;
export declare const AGENT_MODELS_LOCKED_ERROR = "agent models are locked \u2014 configure the model in the native coding-agent settings";
