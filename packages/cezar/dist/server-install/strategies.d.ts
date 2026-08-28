import { type PlatformId, type PlatformStrategy } from './types.ts';
export declare function getStrategy(id: string): PlatformStrategy | undefined;
/** Ids that actually have a registered strategy (a subset of PLATFORM_IDS while phased). */
export declare function availablePlatformIds(): PlatformId[];
