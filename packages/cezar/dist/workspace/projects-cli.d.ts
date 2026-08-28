/**
 * `cezar projects` (spec 2026-07-20-multi-project-workspace, step 5.2) — the
 * terminal twin of Settings → Projects, for the operator who is on a server (or
 * an ssh session) and has no cockpit in front of them.
 *
 * It talks to `~/.cezar/config.json` through `./projects.js` directly, NOT over
 * HTTP: the whole point is that it works with no server running, on a box where
 * the cockpit is behind an nginx login. `CEZ_HOME` therefore selects which
 * workspace it operates on, exactly as it does for `serve`.
 */
export interface ProjectsCommandIo {
    log: (line: string) => void;
    error: (line: string) => void;
}
/**
 * Run one `projects` subcommand. Returns the process exit code (0 ok, 1 for a
 * usage error, an unknown id, or a folder the registration guards refuse) so
 * `src/index.ts` can assign it to `process.exitCode` like every other command.
 */
export declare function runProjectsCommand(args: string[], opts: {
    defaultRoot: string;
    bootProjectId?: string;
    env?: NodeJS.ProcessEnv;
    io?: ProjectsCommandIo;
}): Promise<number>;
