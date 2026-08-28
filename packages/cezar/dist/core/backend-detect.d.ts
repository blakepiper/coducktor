export interface BackendCheck {
    name: 'claude' | 'codex' | 'opencode' | 'pi' | 'gh' | 'git';
    available: boolean;
    version?: string;
    hint?: string;
}
/**
 * Probe the host for everything cez leans on: the agent CLIs (`claude`, and
 * the optional `codex` / `opencode` / `pi` alternatives), `gh` (GitHub auth for
 * PR creation) and `git`. Nothing is required except at least one agent CLI —
 * the GUI degrades gracefully, only offers the runners that are present, and
 * shows the hints for the rest.
 */
export declare function detectEnvironment(): Promise<BackendCheck[]>;
/** The host's GitHub token: logged-in `gh` first, `GITHUB_TOKEN` fallback. */
export declare function readHostGithubToken(): Promise<string | null>;
