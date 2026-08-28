import * as clack from '@clack/prompts';
import { type Ui } from './types.ts';
/**
 * The interactive surface, implemented over `@clack/prompts` — the one place
 * the TUI library is imported. `types.ts`, the engine and the steps talk to
 * the `Ui` interface only, so `@clack/prompts` never enters the server/runtime
 * import graph (AGENTS.md keeps that stack tiny).
 *
 * Every prompt maps clack's cancel symbol to the `CANCEL` sentinel instead of
 * throwing, so a Ctrl-C mid-install is a value the engine can persist-and-exit
 * on, not an exception.
 */
/** The subset of `@clack/prompts` the UI uses — injectable for unit tests. */
export interface PromptBackend {
    intro: typeof clack.intro;
    outro: typeof clack.outro;
    note: typeof clack.note;
    log: typeof clack.log;
    select: typeof clack.select;
    multiselect: typeof clack.multiselect;
    confirm: typeof clack.confirm;
    text: typeof clack.text;
    password: typeof clack.password;
    spinner: typeof clack.spinner;
    isCancel: typeof clack.isCancel;
}
/** The real interactive UI. */
export declare function createClackUi(backend?: PromptBackend): Ui;
/**
 * Non-interactive UI for `--yes`, `CEZ_DRY_RUN`, and unit tests. Prompts resolve
 * to deterministic safe defaults (initial value, or the first option, or ""),
 * logs go to the console. It never touches stdin, so it can drive the engine
 * headless. Optional `answers` override defaults per-prompt-message.
 */
export declare function createAutoUi(answers?: Record<string, unknown>, sink?: (m: string) => void, opts?: {
    /**
     * Enforce each prompt's `validate` on auto-answers (real `--yes` runs must
     * fail closed on an unanswerable prompt). Off for CEZ_DRY_RUN previews,
     * which must walk every step with placeholder-grade values.
     */
    strictValidate?: boolean;
}): Ui;
