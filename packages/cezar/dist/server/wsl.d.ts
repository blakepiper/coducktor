/** True when this process is running inside WSL. The Linux kernel WSL ships identifies itself
 *  in `/proc/version` (contains "microsoft"); WSL also sets `WSL_DISTRO_NAME`/`WSL_INTEROP` for
 *  every process it starts, which is cheaper to check first. */
export declare function isWsl(env?: NodeJS.ProcessEnv, platform?: NodeJS.Platform, procVersion?: string): boolean;
/** The distro name Windows-side tools address this environment as (`wsl.exe -d <name>`, the
 *  `\\wsl$\<name>\…` UNC prefix). Falls back to "Ubuntu" — WSL's own default — when unset or
 *  when the name fails `SAFE_DISTRO_NAME`, so no unvalidated env value is ever interpolated into
 *  a command line or a path. The launchers this feeds are shell-free anyway
 *  (`wslTerminalLaunchers`); this is the belt to their braces. */
export declare function wslDistroName(env?: NodeJS.ProcessEnv): string;
/** Pure POSIX → Windows path translation, no `wslpath` required (used as its fallback, and
 *  directly in tests). Two cases:
 *   - `/mnt/<drive>/…` (the Windows filesystem mounted into WSL) → `<DRIVE>:\…`, the native path,
 *     not a UNC round-trip through the distro.
 *   - anything else (the Linux filesystem proper) → `\\wsl$\<Distro>\…`, the UNC path Windows
 *     apps use to reach into the distro. */
export declare function toWindowsPath(posixPath: string, distro?: string): string;
/** The reverse of the UNC case above: `\\wsl$\<Distro>\…` or `\\wsl.localhost\<Distro>\…` →
 *  the POSIX path WSL-side tools expect. Anything else (a plain `C:\…`, an unrecognized UNC
 *  share) passes through unchanged — it isn't a WSL path to begin with. */
export declare function toPosixPath(windowsPath: string): string;
/** The translation actually used at launch time: prefer the real `wslpath -w` (it knows about
 *  every mount, not just `/mnt/<drive>`), falling back to the pure `toWindowsPath` above when
 *  `wslpath` is missing or errors — degrade, never throw. */
export declare function translateToWindowsPath(posixPath: string): string;
