import { firstConfiguredModel, readNativeSettingsFiles } from './shared.js';
export const opencodeModelSettingsStrategy = {
    runner: 'opencode',
    async read(repoRoot, env) {
        return { model: firstConfiguredModel(await readNativeSettingsFiles('opencode', repoRoot, env)) };
    },
};
//# sourceMappingURL=opencode.js.map