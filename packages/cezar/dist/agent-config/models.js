import { RUNNER_IDS } from '../core/agent-runner.js';
import { claudeModelSettingsStrategy } from './model-settings/claude.js';
import { codexModelSettingsStrategy } from './model-settings/codex.js';
import { opencodeModelSettingsStrategy } from './model-settings/opencode.js';
import { piModelSettingsStrategy } from './model-settings/pi.js';
/**
 * Each runner owns its native-settings policy. Adding another backend means
 * registering its strategy here; vendor precedence, environment variables,
 * and provider composition stay inside that runner's module.
 */
const MODEL_SETTINGS_STRATEGIES = {
    claude: claudeModelSettingsStrategy,
    codex: codexModelSettingsStrategy,
    opencode: opencodeModelSettingsStrategy,
    pi: piModelSettingsStrategy,
};
export function readAgentModelSettings(runner, repoRoot, env = process.env) {
    return MODEL_SETTINGS_STRATEGIES[runner].read(repoRoot, env);
}
/** Read the current default model for each installed/configured coding agent. */
export async function readAgentModelDefaults(repoRoot, env = process.env) {
    const entries = await Promise.all(RUNNER_IDS.map(async (runner) => [
        runner,
        (await readAgentModelSettings(runner, repoRoot, env)).model,
    ]));
    return Object.fromEntries(entries.filter((entry) => entry[1] !== undefined));
}
/** Read the provider that the agent itself will use for a bare model id. */
export async function readAgentModelProvider(runner, repoRoot, env = process.env) {
    return (await readAgentModelSettings(runner, repoRoot, env)).provider;
}
//# sourceMappingURL=models.js.map