import type { RunnerId } from '../../core/agent-runner.ts';
import { type ConfigFileDef } from '../catalog.ts';
export interface NativeSettingsFile {
    def: ConfigFileDef;
    content: string;
}
export declare function readNativeSettingsFiles(runner: RunnerId, repoRoot: string, env: NodeJS.ProcessEnv): Promise<NativeSettingsFile[]>;
export declare function firstConfiguredModel(files: readonly NativeSettingsFile[]): string | undefined;
export declare function firstConfiguredProvider(files: readonly NativeSettingsFile[]): string | undefined;
