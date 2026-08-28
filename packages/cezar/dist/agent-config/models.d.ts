import { type RunnerId } from '../core/agent-runner.ts';
import type { AgentModelSettings } from './model-settings/types.ts';
/** The model defaults exposed by the coding agents' own settings files. */
export type AgentModelDefaults = Partial<Record<RunnerId, string>>;
export declare function readAgentModelSettings(runner: RunnerId, repoRoot: string, env?: NodeJS.ProcessEnv): Promise<AgentModelSettings>;
/** Read the current default model for each installed/configured coding agent. */
export declare function readAgentModelDefaults(repoRoot: string, env?: NodeJS.ProcessEnv): Promise<AgentModelDefaults>;
/** Read the provider that the agent itself will use for a bare model id. */
export declare function readAgentModelProvider(runner: RunnerId, repoRoot: string, env?: NodeJS.ProcessEnv): Promise<string | undefined>;
