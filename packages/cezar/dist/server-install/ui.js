import * as clack from '@clack/prompts';
import { CANCEL, PreflightError } from './types.js';
import { StepAborted } from './steps.js';
const realBackend = {
    intro: clack.intro,
    outro: clack.outro,
    note: clack.note,
    log: clack.log,
    select: clack.select,
    multiselect: clack.multiselect,
    confirm: clack.confirm,
    text: clack.text,
    password: clack.password,
    spinner: clack.spinner,
    isCancel: clack.isCancel,
};
/** Map a clack result to `T | CANCEL`, never a thrown cancel. */
function unwrap(value, isCancel) {
    return isCancel(value) ? CANCEL : value;
}
/** The real interactive UI. */
export function createClackUi(backend = realBackend) {
    // clack renders a prompt at stdin-EOF and never resolves — a piped/ssh'd
    // invocation would hang forever while holding the single-writer install
    // lock. Refuse up front with the way out. (Injected fake backends are for
    // tests, which have no TTY.)
    if (backend === realBackend && (!process.stdin.isTTY || !process.stdout.isTTY)) {
        throw new PreflightError('this terminal is not interactive — re-run from a TTY, or pass --yes (or CEZ_DRY_RUN=1) for non-interactive mode');
    }
    const wrapValidate = (validate) => validate ? (v) => validate(v ?? '') : undefined;
    return {
        intro: (m) => backend.intro(m),
        outro: (m) => backend.outro(m),
        note: (m, title) => backend.note(m, title),
        // Raw, un-boxed: clack's note() draws a bordered box that breaks when a long
        // command wraps. Write straight to stdout so the command stays selectable.
        message: (m) => process.stdout.write(`\n${m}\n`),
        info: (m) => backend.log.info(m),
        success: (m) => backend.log.success(m),
        warn: (m) => backend.log.warn(m),
        error: (m) => backend.log.error(m),
        async select(opts) {
            // clack's `Option<Value>` is a conditional type that can't resolve against
            // an unconstrained generic; cast the options and keep the explicit T.
            const res = await backend.select({
                message: opts.message,
                options: opts.options,
                initialValue: opts.initialValue,
            });
            return unwrap(res, backend.isCancel);
        },
        async multiselect(opts) {
            const res = await backend.multiselect({
                message: opts.message,
                options: opts.options,
                required: opts.required ?? false,
            });
            return unwrap(res, backend.isCancel);
        },
        async confirm(opts) {
            return unwrap(await backend.confirm(opts), backend.isCancel);
        },
        async text(opts) {
            return unwrap(await backend.text({ ...opts, validate: wrapValidate(opts.validate) }), backend.isCancel);
        },
        async password(opts) {
            return unwrap(await backend.password({ ...opts, validate: wrapValidate(opts.validate) }), backend.isCancel);
        },
        spinner() {
            const s = backend.spinner();
            return {
                start: (m) => s.start(m),
                stop: (m) => s.stop(m),
                message: (m) => s.message(m),
            };
        },
    };
}
/**
 * Non-interactive UI for `--yes`, `CEZ_DRY_RUN`, and unit tests. Prompts resolve
 * to deterministic safe defaults (initial value, or the first option, or ""),
 * logs go to the console. It never touches stdin, so it can drive the engine
 * headless. Optional `answers` override defaults per-prompt-message.
 */
export function createAutoUi(answers = {}, sink = () => { }, opts = {}) {
    const answer = (message, fallback) => (message in answers ? answers[message] : fallback);
    const checkValid = (message, v, validate) => {
        if (!opts.strictValidate)
            return;
        const invalid = validate?.(v);
        if (invalid !== undefined) {
            throw new StepAborted(`cannot auto-answer "${message}" (${invalid}) — run without --yes to answer it`);
        }
    };
    return {
        intro: sink,
        outro: sink,
        note: (m) => sink(m),
        message: sink,
        info: sink,
        success: sink,
        warn: sink,
        error: sink,
        async select(opts) {
            return answer(opts.message, opts.initialValue ?? opts.options[0]?.value);
        },
        async multiselect(opts) {
            return answer(opts.message, []);
        },
        async confirm(opts) {
            return answer(opts.message, opts.initialValue ?? true);
        },
        // A placeholder is a HINT, never an answer — auto-adopting it turned the
        // example domain `cezar.ngrok.app` into real input under `--yes`.
        async text(o) {
            const v = String(answer(o.message, o.initialValue ?? ''));
            checkValid(o.message, v, o.validate);
            return v;
        },
        async password(o) {
            const v = String(answer(o.message, ''));
            checkValid(o.message, v, o.validate);
            return v;
        },
        spinner() {
            return { start: (m) => m && sink(m), stop: (m) => m && sink(m), message: (m) => sink(m) };
        },
    };
}
//# sourceMappingURL=ui.js.map