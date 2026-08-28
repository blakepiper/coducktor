import { firstConfiguredModel, readNativeSettingsFiles } from './shared.js';
export const claudeModelSettingsStrategy = {
    runner: 'claude',
    async read(repoRoot, env) {
        // Claude Code gives ANTHROPIC_MODEL higher priority than settings files.
        if (env.ANTHROPIC_MODEL?.trim())
            return { model: env.ANTHROPIC_MODEL.trim() };
        return { model: firstConfiguredModel(await readNativeSettingsFiles('claude', repoRoot, env)) };
    },
};
//# sourceMappingURL=claude.js.map