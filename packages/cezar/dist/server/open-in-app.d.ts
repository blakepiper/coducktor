import type { RunnerId } from '../core/agent-runner.ts';
/**
 * "Open in…" session takeover (#open-in): detect the editors / file managers / terminals on THIS
 * machine, and open a run's worktree in the one the user picks — the desktop-app equivalent of
 * the "cd <path>" hint. Local-only; the server gates these behind `localHandoff` (CEZ_REMOTE).
 *
 * Detection is best-effort and cross-platform: an editor counts as present if its CLI is on PATH
 * or (macOS) its .app bundle is installed. Finder/file-manager and Terminal are always offered.
 *
 * WSL (#361): when this process itself runs inside WSL, `process.platform` reads `linux` but the
 * user's GUI apps mostly live on the Windows side, reachable through interop. `resolveOnPath`
 * additionally probes directly-spawnable `.com`/`.exe` suffixes there (Node's own PATH lookup
 * only does that under real win32), and `openInApp`/`openFileManager` translate the worktree path
 * to its `\\wsl$\…` (or `C:\…`) form before handing it to a resolved Windows-side binary — a WSL-native
 * launcher (e.g. VS Code's Remote-WSL `code` shim) keeps the POSIX path unchanged.
 */
export interface OpenTarget {
    id: string;
    label: string;
    /** A stable icon key the UI maps to a concrete icon component (#361). Optional so an older
     *  server talking to a newer client (or vice versa) just falls back to a generic icon —
     *  never a protocol break. */
    icon?: string;
}
/** Is `bin` (with a directly-spawnable Windows suffix under win32/WSL interop) on PATH?
 *  Returns the exact resolved name (which may carry the suffix) — pure filesystem probe, no
 *  child process — or null. `.cmd`/`.bat` are intentionally excluded: modern Node refuses to
 *  spawn them directly, while launching them through a shell would reintroduce the BatBadBut
 *  command-injection surface fixed in #459. An unavailable target is safer than one the menu
 *  offers and then silently fails to open (#469 review).
 *
 *  The optional environment arguments keep Windows/WSL suffix behavior testable on any host. */
export declare function resolveOnPath(bin: string, platform?: NodeJS.Platform, wsl?: boolean, searchPath?: string): string | null;
/** The runner behind a `cli:<runner>` open target, or null when the id isn't a CLI handoff. */
export declare function agentCliRunner(targetId: string): RunnerId | null;
/** The open targets available on this machine: the file manager, a terminal, every detected
 *  editor, and every installed coding-agent CLI. Order is stable so the menu never reshuffles. */
export declare function detectOpenTargets(): OpenTarget[];
/** The (bin, args) a file-manager launch resolves to — pure so the per-platform routing
 *  (including the WSL→Explorer interop branch) is unit-testable without spawning anything.
 *  `platform`/`wsl` default to the real environment; tests pass them explicitly. */
export declare function fileManagerLaunch(dir: string, platform?: NodeJS.Platform, wsl?: boolean): {
    bin: string;
    args: string[];
};
/** Open a single worktree FILE with whatever application the OS has registered as its
 *  default handler — the diff pane's "open in default app" action for images (#365). Distinct
 *  from `openFileManager` above: that opens a *directory* in the file manager; this launches
 *  the file itself (e.g. the OS's default image viewer), never a directory listing. Local-only
 *  by construction — the caller gates this behind `localHandoff`.
 *
 *  `path` is worktree CONTENT — a filename some cloned repo or coding agent chose — so it is
 *  hostile input, and it must never reach a process that re-parses its command line. That rules
 *  `cmd.exe` out on Windows: an argument array does NOT protect you there, because libuv quotes
 *  a spawn arg only when it contains a space/tab/quote and passes everything else verbatim, so
 *  `cmd /c start "" C:\dev\proj\a&calc&.png` would let cmd's `&` run `calc` (BatBadBut,
 *  CVE-2024-27980). `explorer <file>` hands the file to its registered handler with no such
 *  re-parsing — the same launcher `openFileManager` already uses for directories. */
export declare function openFileInDefaultApp(path: string): Promise<boolean>;
/** Open `dir` in the given target. Unknown/unavailable target → false (the caller 409s). */
export declare function openInApp(targetId: string, dir: string): Promise<boolean>;
/** The path argument to hand a resolved binary: a Windows-suffixed name found through WSL
 *  interop needs the Windows-side path; a bare-name binary (native Linux, or a WSL-aware shim
 *  like VS Code's Remote-WSL `code`) takes the POSIX path unchanged. `wsl` defaults to the real
 *  environment; tests pass it explicitly so this needs no global platform stubbing. */
export declare function launchPathFor(resolvedBin: string, dir: string, wsl?: boolean): string;
