import type { AgentBackend, AgentRunner, RunnerId } from './agent-runner.ts';
/**
 * The single place that maps a backend id onto a concrete runner. Everything
 * that used to `new ClaudeCliRunner()` (the planner and the workflow engine)
 * goes through here so switching the agent backend is one function call.
 * `claude-cli` is the legacy id for `claude`.
 */
export declare function createRunner(backend: AgentBackend | RunnerId | undefined): AgentRunner;
