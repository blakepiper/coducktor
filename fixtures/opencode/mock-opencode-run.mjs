#!/usr/bin/env node
// Test-only `opencode run --format json --auto` transport. One invocation is one turn; `--session`
// carries the native conversation identity into the next process.

import { appendFileSync } from 'node:fs';

const args = process.argv.slice(2);
const valueAfter = (flag) => {
  const index = args.indexOf(flag);
  return index >= 0 ? args[index + 1] : undefined;
};
const emit = (value) => process.stdout.write(`${JSON.stringify(value)}\n`);

if (process.env.DUCK_MOCK_ARGS_FILE) {
  appendFileSync(process.env.DUCK_MOCK_ARGS_FILE, `${JSON.stringify(args)}\n`);
}

if (args[0] !== 'run' || valueAfter('--format') !== 'json' || !args.includes('--auto')) {
  process.stderr.write('expected opencode run --format json --auto\n');
  process.exit(2);
}

// The real CLI does not begin an argument-supplied prompt while a piped stdin producer remains
// open. Waiting here makes the transport test prove Coducktor closes its unused stdin handle.
for await (const _chunk of process.stdin) {
  // This transport has no stdin protocol.
}

const sessionID = valueAfter('--session') ?? 'ses_mock_opencode_run';
const prompt = args.at(-1) ?? '';
if (prompt.includes('mock:slow')) {
  await new Promise((resolve) => setTimeout(resolve, 25_000));
}
if (prompt.includes('mock:malformed')) process.stdout.write('{not-json\n');
if (prompt.includes('mock:permission')) {
  emit({ type: 'permission_asked', sessionID, part: { message: 'permission required' } });
  process.exit(1);
}

emit({
  type: 'tool_use',
  sessionID,
  part: {
    type: 'tool',
    tool: 'read',
    callID: 'call_mock_read',
    state: {
      status: 'completed',
      input: { filePath: 'README.md' },
      output: 'mock read result',
      metadata: { exit: 0, truncated: false },
    },
  },
});
emit({
  type: 'text',
  sessionID,
  part: { type: 'text', id: 'text_mock', text: `OpenCode handled: ${prompt}` },
});
emit({
  type: 'step_finish',
  sessionID,
  part: {
    type: 'step-finish',
    reason: 'stop',
    tokens: { total: 12, input: 8, output: 4, reasoning: 0 },
    cost: 0.01,
  },
});
