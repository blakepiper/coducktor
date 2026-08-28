import { type PlatformStrategy } from '../types.ts';
/** launchd agent that keeps an authenticated ngrok tunnel to the local cockpit up. */
export declare function launchdPlist(port: number, basicAuth: string, domain?: string, ngrokBin?: string): string;
/** launchd agent that keeps the cezar cockpit running on the given port. */
export declare function cezarLaunchdPlist(repoRoot: string, port: number, argv: string[]): string;
export declare const macosxNgrok: PlatformStrategy;
