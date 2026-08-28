/**
 * Open a real terminal window at `cwd` running `command` — the "take over the
 * agent session locally" handoff. Cross-platform strategy ported from
 * github-janitor's `openInTerminal.ts`: macOS via osascript, Windows via
 * cmd/start, Linux by probing common emulators with a temp launch script
 * (which sidesteps per-emulator quoting rules). WSL (#361) reuses the Linux
 * script but hands it to a Windows-side terminal through interop, re-entering
 * the distro with `wsl.exe` — there is no Linux desktop of its own to open
 * `x-terminal-emulator` etc. on.
 *
 * Returns true when a launcher was started without an immediate error; the
 * caller shows a copy-the-command fallback otherwise.
 */
export declare function openInTerminal(cwd: string, command: string, 
/** Environment the opened shell must carry — today, the agent account's config dir (spec
 *  2026-07-29-agent-profiles). Rendered per platform and made to PERSIST, because the window
 *  stays open and the user types the next `claude` in it themselves. An empty/absent env
 *  changes nothing about the command. Returns false without launching anything when the
 *  values cannot be embedded safely: a terminal silently aimed at the wrong account is worse
 *  than no terminal, since nothing in the window would say so. */
env?: Record<string, string>): Promise<boolean>;
/** The Windows-side (bin, args) candidates for launching `scriptPath` inside `distro` through
 *  WSL interop, in try-order — Windows Terminal first, a classic console window as fallback. Pure
 *  (no spawning) so the exact command line is unit-testable without a real WSL host.
 *
 *  Every launcher here is shell-free by construction, and must stay that way: routing through
 *  `cmd.exe` (`/c start …`) would reintroduce BatBadBut (CVE-2024-27980, see #459). Passing an
 *  argument array is NOT protection when the binary is a shell — libuv only quotes arguments
 *  containing space, tab or quote, so a space-free `distro` like `a&calc&` would reach `cmd`
 *  live and be interpreted. `wt.exe` and `conhost.exe` parse no metacharacters, so the same
 *  input is inert. `distro` is additionally validated at the source (`wslDistroName`). */
export declare function wslTerminalLaunchers(scriptPath: string, distro: string): Array<[string, string[]]>;
/** Grace period before a launch script's directory is removed. Generous next to the
 *  ~250 ms each emulator candidate is given, because the cost of being early is a
 *  window that never opens, and the cost of being late is a few hundred bytes. */
export declare const LAUNCH_SCRIPT_TTL_MS = 60000;
/**
 * Writes the temp launch script shared by the plain-Linux and WSL branches — `cd` into
 * the worktree, run `command`, then drop into an interactive shell so the window stays
 * open — and schedules its own removal (#785).
 *
 * Every "open in terminal" used to leave its `cez-term-*` directory behind forever. On a
 * host whose `/tmp` is a tmpfs that never reboots, cezar's own litter is part of what
 * exhausts the directory the agents' output capture depends on, so the opener cleans up
 * after itself. Deleting the script mid-run is safe: the emulator has already `exec`'d
 * bash on it, and POSIX keeps an unlinked file's inode alive for every open descriptor.
 * The timer is `unref`'d — a pending cleanup must never be the reason `cezar serve`
 * refuses to exit.
 *
 * Exported for the regression test, which must prove the directory does not survive
 * without spawning a real terminal emulator.
 */
export declare function createLaunchScript(cwd: string, command: string, ttlMs?: number): string;
/**
 * A test that reaches a real launcher opens a window on the developer's machine — a Terminal on
 * macOS, a `cmd` window on Windows, an emulator on Linux — and #820 is what that looks like: a
 * suite run left a Terminal sitting in a `cez-profiles-home-*` fixture directory the same run had
 * already deleted. Throwing beats returning `false`: a silent refusal would let the omission
 * survive as a passing test, and the fix is always the same one line — inject the launcher seam
 * (`openTerminal` / `openFile` / `openApp` on `ServerDeps`) instead of reaching the real one.
 *
 * `CEZ_ALLOW_TEST_SPAWN=1` is the deliberate exception, for a file that has replaced
 * `node:child_process` with a mock: nothing reaches a real process there, and asserting the argv a
 * launcher WOULD pass is exactly how the Windows launcher-safety cases (#469, BatBadBut) are
 * pinned. Set it around those tests, never process-wide.
 *
 * Exported so `open-in-app.ts` shares this one definition rather than keeping a second copy that
 * could drift.
 */
export declare function refuseSpawnUnderTest(bin: string, args: readonly string[]): void;
