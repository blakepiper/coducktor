/**
 * Rendering environment assignments into a shell command line — the CLI-handoff half of agent
 * profiles (spec 2026-07-29-agent-profiles).
 *
 * A run executed under a second account only resumes under that same account: `claude --resume
 * <id>` reads `<CLAUDE_CONFIG_DIR>/sessions`, so a handoff without the variable does not fail
 * loudly — it silently starts a fresh conversation. The variable therefore has to travel with
 * every command cezar hands to a terminal, and it has to SURVIVE the command, because the window
 * stays open and the user types the next `claude` in it themselves. Hence `export` / `set` rather
 * than a one-shot `VAR=v cmd` prefix.
 *
 * There is no portable spelling: `VAR=v cmd` is meaningless to `cmd.exe`, and `set "VAR=v"` is
 * meaningless to a POSIX shell. So this renders per platform, and — the load-bearing part —
 * refuses rather than guesses. `null` means "this value cannot be embedded safely here", and
 * every caller must then fail closed: opening a terminal on the WRONG account is worse than not
 * opening one, because the user cannot see which account a shell is pointed at.
 */
/** POSIX single-quoting — the `'\''` dance, so any character but a control one is inert. */
export declare function shellQuote(value: string): string;
/**
 * Assignments that persist for the rest of the shell session, or `null` when any value cannot be
 * embedded safely on `platform`. An empty `env` renders `''` — the zero-config path adds nothing.
 *
 * The result is a PREFIX ready to concatenate: it already ends with its own separator.
 */
export declare function renderEnvPrefix(env: Record<string, string>, platform: NodeJS.Platform): string | null;
/** `renderEnvPrefix` applied to a command, or `null` when the env cannot be rendered safely. */
export declare function withEnvPrefix(command: string, env: Record<string, string>, platform: NodeJS.Platform): string | null;
