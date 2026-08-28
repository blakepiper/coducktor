import { type ConfigFileDef } from './catalog.ts';
/**
 * Assembles the `GET /api/agent-config` payload: every catalog file's current
 * on-disk state plus, locally, a read-only listing of the MCP servers Claude
 * keeps in its own state file (`~/.claude.json`). In hosted mode (`editable`
 * false) writes are refused server-side and the `~/.claude.json` listing is
 * withheld — it is host state a hosted client is not trusted to see.
 */
export interface ConfigFileListing {
    id: string;
    runners: ConfigFileDef['runners'];
    kind: ConfigFileDef['kind'];
    scope: ConfigFileDef['scope'];
    label: string;
    path: string;
    format: ConfigFileDef['format'];
    tracked: ConfigFileDef['tracked'];
    seeded: boolean;
    holdsMcp: boolean;
    precedence: string;
    hotReload?: string;
    docsUrl: string;
    exists: boolean;
    size: number;
    /** sha256 of the bytes, or null when absent. */
    version: string | null;
    /** False in hosted mode (whole feature) — the client renders read-only up front. */
    writable: boolean;
    readOnlyReason?: string;
}
export interface UserMcpListing {
    path: string;
    servers: string[];
    readable: boolean;
}
export interface AgentConfigListing {
    editable: boolean;
    files: ConfigFileListing[];
    /** null in hosted mode (host-state disclosure guard). */
    userMcp: UserMcpListing | null;
}
/** Read the user-scope MCP server *names* from ~/.claude.json — never its contents, never for writing. */
export declare function readUserMcpServers(env: NodeJS.ProcessEnv): Promise<UserMcpListing>;
export declare function listAgentConfig(repoRoot: string, env: NodeJS.ProcessEnv, editable: boolean): Promise<AgentConfigListing>;
