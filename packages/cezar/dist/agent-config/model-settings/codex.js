import { firstConfiguredModel, firstConfiguredProvider, readNativeSettingsFiles, } from './shared.js';
export const codexModelSettingsStrategy = {
    runner: 'codex',
    async read(repoRoot, env) {
        const files = await readNativeSettingsFiles('codex', repoRoot, env);
        const provider = firstConfiguredProvider(files);
        const model = firstConfiguredModel(files);
        return {
            ...(model
                ? { model: provider && provider !== 'openai' && !model.includes('/') ? `${provider}/${model}` : model }
                : {}),
            ...(provider ? { provider } : {}),
        };
    },
};
//# sourceMappingURL=codex.js.map