import { readFile } from 'node:fs/promises';
import { agentHomePaths, claudeStateFilePath } from '../paths.js';
import { CONFIG_FILES } from './catalog.js';
import { hashBytes, statConfigPath } from './files.js';
const HOSTED_REASON = 'agent config is edited from the machine that owns the checkout (this cockpit runs in hosted mode)';
/** ~/.claude.json can be large (per-project history); cap the read. */
const CLAUDE_JSON_CAP = 2 * 1024 * 1024;
async function versionOf(path, exists) {
    if (!exists)
        return null;
    try {
        return hashBytes(await readFile(path, 'utf8'));
    }
    catch {
        return null;
    }
}
/** Read the user-scope MCP server *names* from ~/.claude.json — never its contents, never for writing. */
export async function readUserMcpServers(env) {
    // Claude's own MCP state file. Sibling of `~/.claude/` by default, INSIDE the
    // dir once CLAUDE_CONFIG_DIR relocates it — `claudeStateFilePath` owns that rule.
    const path = claudeStateFilePath(agentHomePaths(env).claude, env);
    try {
        const { size } = await statConfigPath(path);
        if (size > CLAUDE_JSON_CAP)
            return { path, servers: [], readable: false };
        const raw = await readFile(path, 'utf8');
        const parsed = JSON.parse(raw);
        const servers = parsed.mcpServers && typeof parsed.mcpServers === 'object' ? Object.keys(parsed.mcpServers) : [];
        return { path, servers, readable: true };
    }
    catch (err) {
        // ENOENT → readable (no servers); anything else → not readable
        if (err.code === 'ENOENT')
            return { path, servers: [], readable: true };
        return { path, servers: [], readable: false };
    }
}
export async function listAgentConfig(repoRoot, env, editable) {
    const home = agentHomePaths(env);
    const files = await Promise.all(CONFIG_FILES.map(async (def) => {
        const path = def.resolve(repoRoot, home);
        const { exists, size } = await statConfigPath(path);
        return {
            id: def.id,
            runners: def.runners,
            kind: def.kind,
            scope: def.scope,
            label: def.label,
            path,
            format: def.format,
            tracked: def.tracked,
            seeded: Boolean(def.seeded),
            holdsMcp: Boolean(def.holdsMcp),
            precedence: def.precedence,
            hotReload: def.hotReload,
            docsUrl: def.docsUrl,
            exists,
            size,
            version: await versionOf(path, exists),
            writable: editable,
            readOnlyReason: editable ? undefined : HOSTED_REASON,
        };
    }));
    return {
        editable,
        files,
        userMcp: editable ? await readUserMcpServers(env) : null,
    };
}
//# sourceMappingURL=service.js.map