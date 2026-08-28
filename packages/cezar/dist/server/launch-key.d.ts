/**
 * Launch-key (spec 011): a random secret baked into the bookmarklets so only
 * pages that got it from THIS cockpit can auto-start a run via `/new?auto=1`.
 * A rogue web page can navigate the browser to localhost, but it cannot read
 * `.ai/cezar/launch-key` — without the key `/new` only prefills the form.
 */
export declare function ensureLaunchKey(dataDir: string): string;
