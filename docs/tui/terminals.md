# Interactive terminal verification

Last run: 2026-08-23 in a real tmux PTY at 120×40, from the locally built
`target/debug/coducktor`. These are interactive cockpit results; headless `coducktor run` output
was not counted.

The verification used isolated temporary `DUCK_HOME` and non-Git project directories so no source
checkout or user registry was changed. Each message requested an exact response and no tools. For
available harnesses, the second message was submitted from the same chat composer and the rendered
timeline was captured after the chat returned to idle.

## Harness matrix

| Harness | Local version and availability | First turn | Second turn / resume | Result |
| --- | --- | --- | --- | --- |
| Claude Code | 2.1.233; status `claude ok`, selectable | `CLAUDE TURN 1 OK` | `CLAUDE TURN 2 OK` in the same chat | Pass |
| Codex | codex-cli 0.149.0; status `codex ok`, selectable | `CODEX TURN 1 OK` | `CODEX TURN 2 OK` in the same chat | Pass |
| OpenCode | 1.18.18; status `opencode ok`, selectable | `OPENCODE TURN 1 OK` | `OPENCODE TURN 2 OK` in the same chat | Pass after stdin fix |
| pi | 0.83.0 installed, but `pi --list-models` reported no models and requested `/login`; omitted from the connected-harness picker | Not runnable | Not runnable | Unavailable locally |

The OpenCode exercise initially remained running with no provider events. Running the identical
native command directly completed, isolating the difference to Coducktor retaining an unused
piped stdin handle. Closing stdin immediately after spawn made both real interactive turns finish
normally; the focused runner tests cover the transport afterward.

## Cockpit observations

- New Chat rendered Message, Harness, Model, Reasoning, Skills, Base branch, Worktree, and Git
  mode. The non-Git temporary project correctly forced worktree off and Git manual.
- The connected-harness picker contained Claude, Codex, and OpenCode with no Auto row. pi was
  excluded because it had no configured model/provider.
- After each successful turn, the header returned to `idle`, the timeline showed the exact user
  message and exact assistant response, and the composer showed `Enter · send`.
- The second OpenCode turn rendered as a separate prompt/response pair after the durable
  turn-settlement resync; it did not merge into the first turn.
- Opening a stored chat after process recreation loaded its conversation history rather than the
  legacy task-history endpoint.
- `Esc` on the intentionally stalled pre-fix OpenCode turn cancelled it, reaped the native child,
  preserved the transcript, and returned the composer. This also verified the displayed
  `Esc cancels` contract against a real long-running child.
- Keyboard traversal reached the harness picker, chat cards, current-chat header actions, and the
  follow-up composer. Mouse behavior remains covered by the hitmap and screen snapshot tests.

## Reproduction shape

The real sessions followed this sequence:

```text
coducktor projects add --repo <temporary-project>
coducktor --repo <temporary-project>
:new
Tab, Enter, select harness, Enter, i
Reply with exactly <HARNESS> TURN 1 OK. Do not use tools.
open the new chat card
Reply with exactly <HARNESS> TURN 2 OK. Do not use tools.
```

The terminal was left through tmux after capture; the temporary state contains only disposable
manual-verification transcripts.
