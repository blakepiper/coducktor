import { z } from 'zod';
/**
 * The agent-config surface (spec #404): the settings / memory / MCP files the installed agent
 * CLIs read, listed and edited through `GET/PUT /agent-config[/:id]`.
 */
export declare const agentConfigFormatSchema: z.ZodEnum<{
    json: "json";
    jsonc: "jsonc";
    markdown: "markdown";
    toml: "toml";
}>;
export type AgentConfigFormat = z.infer<typeof agentConfigFormatSchema>;
export declare const agentConfigScopeSchema: z.ZodEnum<{
    local: "local";
    project: "project";
    user: "user";
}>;
export type AgentConfigScope = z.infer<typeof agentConfigScopeSchema>;
/** `settings` = behavior knobs; `memory` = instruction/markdown; `mcp` = a dedicated MCP file. */
export declare const agentConfigKindSchema: z.ZodEnum<{
    mcp: "mcp";
    memory: "memory";
    settings: "settings";
}>;
export type AgentConfigKind = z.infer<typeof agentConfigKindSchema>;
/** Git status BY CONVENTION — it drives the honest label; it is not read from git. */
export declare const agentConfigTrackedSchema: z.ZodEnum<{
    gitignored: "gitignored";
    "outside-repo": "outside-repo";
    tracked: "tracked";
}>;
export type AgentConfigTracked = z.infer<typeof agentConfigTrackedSchema>;
/** One catalog file plus its current on-disk state. */
export declare const agentConfigFileSchema: z.ZodObject<{
    id: z.ZodString;
    runners: z.ZodArray<z.ZodEnum<{
        claude: "claude";
        codex: "codex";
        opencode: "opencode";
        pi: "pi";
    }>>;
    kind: z.ZodEnum<{
        mcp: "mcp";
        memory: "memory";
        settings: "settings";
    }>;
    scope: z.ZodEnum<{
        local: "local";
        project: "project";
        user: "user";
    }>;
    label: z.ZodString;
    path: z.ZodString;
    format: z.ZodEnum<{
        json: "json";
        jsonc: "jsonc";
        markdown: "markdown";
        toml: "toml";
    }>;
    tracked: z.ZodEnum<{
        gitignored: "gitignored";
        "outside-repo": "outside-repo";
        tracked: "tracked";
    }>;
    seeded: z.ZodBoolean;
    holdsMcp: z.ZodBoolean;
    precedence: z.ZodString;
    hotReload: z.ZodOptional<z.ZodString>;
    docsUrl: z.ZodString;
    exists: z.ZodBoolean;
    size: z.ZodNumber;
    version: z.ZodNullable<z.ZodString>;
    writable: z.ZodBoolean;
    readOnlyReason: z.ZodOptional<z.ZodString>;
}, z.core.$strip>;
export type AgentConfigFile = z.infer<typeof agentConfigFileSchema>;
/** Read-only listing of the MCP servers Claude keeps in `~/.claude.json`. */
export declare const userMcpListingSchema: z.ZodObject<{
    path: z.ZodString;
    servers: z.ZodArray<z.ZodString>;
    readable: z.ZodBoolean;
}, z.core.$strip>;
export type UserMcpListing = z.infer<typeof userMcpListingSchema>;
/** `GET /agent-config` — the whole panel in one read. */
export declare const agentConfigListingSchema: z.ZodObject<{
    editable: z.ZodBoolean;
    files: z.ZodArray<z.ZodObject<{
        id: z.ZodString;
        runners: z.ZodArray<z.ZodEnum<{
            claude: "claude";
            codex: "codex";
            opencode: "opencode";
            pi: "pi";
        }>>;
        kind: z.ZodEnum<{
            mcp: "mcp";
            memory: "memory";
            settings: "settings";
        }>;
        scope: z.ZodEnum<{
            local: "local";
            project: "project";
            user: "user";
        }>;
        label: z.ZodString;
        path: z.ZodString;
        format: z.ZodEnum<{
            json: "json";
            jsonc: "jsonc";
            markdown: "markdown";
            toml: "toml";
        }>;
        tracked: z.ZodEnum<{
            gitignored: "gitignored";
            "outside-repo": "outside-repo";
            tracked: "tracked";
        }>;
        seeded: z.ZodBoolean;
        holdsMcp: z.ZodBoolean;
        precedence: z.ZodString;
        hotReload: z.ZodOptional<z.ZodString>;
        docsUrl: z.ZodString;
        exists: z.ZodBoolean;
        size: z.ZodNumber;
        version: z.ZodNullable<z.ZodString>;
        writable: z.ZodBoolean;
        readOnlyReason: z.ZodOptional<z.ZodString>;
    }, z.core.$strip>>;
    userMcp: z.ZodNullable<z.ZodObject<{
        path: z.ZodString;
        servers: z.ZodArray<z.ZodString>;
        readable: z.ZodBoolean;
    }, z.core.$strip>>;
}, z.core.$strip>;
export type AgentConfigListing = z.infer<typeof agentConfigListingSchema>;
/** `GET /agent-config/:id` and the `PUT` echo — one file's bytes plus its stale-write token. */
export declare const agentConfigFileContentSchema: z.ZodObject<{
    id: z.ZodString;
    path: z.ZodString;
    exists: z.ZodBoolean;
    content: z.ZodString;
    version: z.ZodNullable<z.ZodString>;
}, z.core.$strip>;
export type AgentConfigFileContent = z.infer<typeof agentConfigFileContentSchema>;
/**
 * `PUT /agent-config/:id` body. `version` is the token from the read that produced `content` —
 * `null` means "I expect no file to exist yet" (the create path); a mismatch is a 409.
 */
export declare const setAgentConfigInputSchema: z.ZodObject<{
    content: z.ZodString;
    version: z.ZodNullable<z.ZodString>;
}, z.core.$strip>;
export type SetAgentConfigInput = z.infer<typeof setAgentConfigInputSchema>;
