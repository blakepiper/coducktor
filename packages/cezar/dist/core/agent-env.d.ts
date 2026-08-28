/**
 * Least-privilege environment for spawned agent backends (#427).
 *
 * Every backend used to inherit the FULL parent environment
 * (`{ ...process.env, ...spec.env }`), handing `GITHUB_TOKEN`,
 * `ANTHROPIC_API_KEY`, `AWS_*` and any other host secret to a process an
 * attacker-controlled prompt can drive. Instead we build an explicit,
 * curated child env: a base allowlist of the non-secret vars a shell / dev
 * toolchain genuinely needs, plus the specific auth vars the chosen backend
 * requires, plus cezar's own `CEZ_*` namespace and the per-run `spec.env`.
 * Everything else — notably arbitrary secrets — is dropped by default.
 *
 * Zero-config: the safe env is the default and needs no configuration. Two
 * opt-in escape hatches (both read from the host env, both off by default):
 *   - `CEZ_ENV_PASSTHROUGH=A,B,C` forwards those extra named vars;
 *   - `CEZ_AGENT_ENV_FULL=1` restores the legacy full-`process.env` behavior.
 */
import type { AgentBackend } from './agent-runner.ts';
export declare function looksSecret(name: string): boolean;
export interface BuildChildEnvOptions {
    backend: AgentBackend;
    /** Per-run env (CEZ_HANDOFF_FILE etc.) — always applied, wins over host. */
    extraEnv?: Record<string, string>;
    /** Source env; defaults to `process.env`. */
    source?: NodeJS.ProcessEnv;
}
/**
 * Build the curated child environment for a spawned backend. `extraEnv`
 * (the runner's `spec.env`) is applied last so per-run vars always win.
 */
export declare function buildChildEnv(opts: BuildChildEnvOptions): NodeJS.ProcessEnv;
