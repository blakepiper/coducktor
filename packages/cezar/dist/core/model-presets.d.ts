import type { RunnerId } from './agent-runner.ts';
/**
 * The model-preset ids each runner's picker offers — the ids of the web composer's
 * `MODELS_BY_RUNNER` (packages/web/src/routes/new-task-form.ts), hand-mirrored the same way the
 * API types are. `''` (auto) is implicit and never listed.
 *
 * This is a cross-runner GUARD, not a whitelist: models stay free-form everywhere (custom ids
 * and config presets must keep working), so the only thing ever rejected is a model that is
 * recognizably ANOTHER runner's preset — the corruption a client/server resolution mismatch
 * can produce (#401 review). Unknown ids never conflict (fail-open).
 *
 * OpenCode lists nothing here on purpose (#794): its models are discovered from the host
 * (`opencode-model-catalog.ts`), so any hard-coded list would be one release away from naming
 * models the user's provider does not have. Its half of the guard is the structural check in
 * {@link modelConflictsWithRunner} instead, which needs no vendor knowledge at all.
 */
export declare const KNOWN_PRESETS_BY_RUNNER: Record<RunnerId, readonly string[]>;
/** True when `model` is recognizably a preset of a runner OTHER than `runner` (and not also one
 *  of `runner`'s own presets), or when its provider prefix is one this runner is known not to
 *  serve. `''`/unknown/custom ids never conflict. */
export declare function modelConflictsWithRunner(model: string, runner: RunnerId): boolean;
