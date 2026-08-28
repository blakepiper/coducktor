import { parse as parseToml } from 'smol-toml';
import { CONFIG_FILES } from '../catalog.js';
import { readConfigFile } from '../files.js';
import { stripJsonComments } from '../validate.js';
/** Remove JSONC trailing commas without touching commas inside string values. */
function stripJsonTrailingCommas(input) {
    let out = '';
    let inString = false;
    let escaped = false;
    for (let index = 0; index < input.length; index++) {
        const character = input[index];
        if (inString) {
            out += character;
            if (escaped)
                escaped = false;
            else if (character === '\\')
                escaped = true;
            else if (character === '"')
                inString = false;
            continue;
        }
        if (character === '"') {
            inString = true;
            out += character;
            continue;
        }
        if (character === ',') {
            let next = index + 1;
            while (/\s/.test(input[next] ?? ''))
                next++;
            if (input[next] === '}' || input[next] === ']')
                continue;
        }
        out += character;
    }
    return out;
}
function valueAtPath(value, path) {
    return path.split('.').reduce((current, segment) => {
        if (!current || typeof current !== 'object' || Array.isArray(current))
            return undefined;
        return current[segment];
    }, value);
}
function parseConfigContent(content, format) {
    return format === 'toml'
        ? parseToml(content)
        : JSON.parse(format === 'jsonc' ? stripJsonTrailingCommas(stripJsonComments(content)) : content);
}
function stringAtPath(content, format, path) {
    try {
        const value = valueAtPath(parseConfigContent(content, format), path);
        return typeof value === 'string' && value.trim() ? value.trim() : undefined;
    }
    catch {
        return undefined;
    }
}
export async function readNativeSettingsFiles(runner, repoRoot, env) {
    const definitions = CONFIG_FILES.filter((definition) => definition.kind === 'settings' &&
        definition.runners.includes(runner) &&
        definition.modelKey !== undefined &&
        definition.modelPriority !== undefined).sort((left, right) => (right.modelPriority ?? 0) - (left.modelPriority ?? 0));
    const files = [];
    for (const definition of definitions) {
        const file = await readConfigFile(definition.id, repoRoot, env);
        if (!file || 'error' in file || !file.exists)
            continue;
        files.push({ def: definition, content: file.content });
    }
    return files;
}
export function firstConfiguredModel(files) {
    for (const { def, content } of files) {
        for (const key of def.modelKeys ?? [def.modelKey]) {
            const model = stringAtPath(content, def.format, key);
            if (model)
                return model;
        }
    }
    return undefined;
}
export function firstConfiguredProvider(files) {
    for (const { def, content } of files) {
        if (!def.modelProviderKey)
            continue;
        const provider = stringAtPath(content, def.format, def.modelProviderKey);
        if (provider)
            return provider;
    }
    return undefined;
}
//# sourceMappingURL=shared.js.map