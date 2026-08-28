# Keymap reference

Coducktor uses a small Neovim-style Normal-mode grammar. Printable product actions live behind
visible controls or Ex commands. Text surfaces keep ordinary editing input, while `Ctrl-W`
remains reserved for cockpit window navigation.

User overrides are read from `$DUCK_HOME/keymap.toml` (normally
`~/.coducktor/keymap.toml`) and merge over `crates/coducktor-tui/default-keymap.toml`.

## Normal mode

| Key | Meaning |
| --- | --- |
| `h` / `j` / `k` / `l` | Move left / down / up / right in the focused view |
| `gg` / `G` | First / last item |
| `Ctrl-U` / `Ctrl-D` | Half page up / down |
| `/`, then `n` / `N` | Search, next match, previous match |
| `i` | Enter Insert mode in a chat composer |
| `gt` / `gT` | Next / previous tab |
| `za` / `Enter` | Toggle the selected reasoning or tool card |
| `zR` / `zM` | Expand / collapse every reasoning and tool card |
| `:` | Open the Ex command line |
| `Ctrl-O` / `Ctrl-I` | Older / newer cockpit location |

`g`, `z`, and `Ctrl-W` appear as pending prefixes in the status line. `Esc` or an invalid suffix
cancels a prefix. The `za`, `zR`, and `zM` actions can be overridden in `keymap.toml` as
`toggle-transcript-item`, `expand-transcript`, and `collapse-transcript`; clamped output hints show
the configured toggle key.

## Windows and text input

| Key | Meaning |
| --- | --- |
| `Ctrl-W h/j/k/l` | Focus the window in that direction |
| `Ctrl-W w` | Cycle to the next window |
| `Ctrl-W p` | Return to the previously focused window |

New Chat and an idle chat composer start in Insert mode. `Tab` moves through Message, Harness,
Model, Reasoning, Skills, Base branch, Worktree, and Git mode; `Shift-Tab` moves backward. `Enter`
opens a focused picker or submits from the composer. While a turn is active, typing retains a
draft but submission is disabled.

`Esc` leaves a chat composer without touching the provider turn. `Ctrl-C`, the Cancel header
action, and `:stop` stop a live turn without archiving the chat or discarding its draft.

Scratchpad is modal: `i`/`a`/`I`/`A`/`o`/`O` enter Insert mode, `Esc` returns to Normal mode,
`h`/`j`/`k`/`l`, `gg`/`G`, `0`/`$`, and `Ctrl-U`/`Ctrl-D` move, `x` and `dd` delete, and `v`
starts a selection for `y` or `d`. Arrow keys, Shift-selection, clipboard shortcuts, bracketed
paste, and mouse click/drag remain available for conventional editing.

## Ex commands

| Command | Effect |
| --- | --- |
| `:open <route>` | Navigate to a route such as `/tasks`, `/new`, or `/p/<project>/git` |
| `:back` / `:forward` | Move through cockpit history |
| `:new` | Open New Chat |
| `:stop` | Cancel the current live chat turn after confirmation |
| `:archive` | Archive the current eligible chat or legacy record |
| `:delete` | Delete the current removable record or settings row after confirmation |
| `:theme <dark\|lazyvim\|lakes>` | Switch theme |
| `:%y` | Copy the entire open scratchpad to the system clipboard |
| `:clear-scratchpad` | Clear the current scratchpad after confirmation |
| `:sidebar` | Toggle the sidebar |
| `:help` | Open the key and command reference |
| `:q` / `:quit` | Quit using the normal confirmation policy |

## Screen behavior

- Chats, All Chats, Skills, Settings, Git, and GitHub lists use `j`/`k` and arrow keys for
  selection; `Enter` opens or activates the selected control.
- Conversation transcripts use `j`/`k`, `gg`/`G`, paging, and search. `Enter` or `za` toggles a
  selected expandable activity item; `zR` expands every reasoning and tool card, and `zM`
  collapses them. Changes, Files, and Commits use `gt`/`gT`.
- A chat header offers Cancel while a turn runs, and Git mode, Archive/Restore, Mark unread, and
  Delete while it is settled. **Restart session** appears only after the harness refused to resume
  its own session; it confirms first and sends nothing — the next message you write carries a
  bounded excerpt of the chat into the new session.
- The IDE tree uses `h` or `Left` for the parent and `l`, `Enter`, or `Right` to open an entry.
- In project and Global Settings, `l` moves into values and `h` returns to the section list.
- Structured question cards and confirmation dialogs retain their displayed local keys.

Every visible product control is mouse-operable, including chat cards and menus, Git/GitHub tabs,
settings rows, sidebar navigation, confirmations, pickers, and composer buttons. Mouse and
keyboard are complementary, never exclusive:

- Clicking any pane focuses it — transcript, composer, IDE explorer or editor, Git/GitHub panes,
  Settings sections or values — exactly as the pane-focus keys do. Vim keys then apply to the
  clicked pane.
- The chat and New Chat composers place the caret where you click (the completion menu closes).
- The IDE editor and the scratchpad support click-to-caret and click-drag selection; the wheel
  scrolls both.
- The embedded terminal supports click-drag text selection; releasing a non-empty selection
  copies it to the clipboard, and the wheel scrolls scrollback.
- The wheel scrolls the pane under the cursor: transcripts, tables, diff panes, the GitHub list,
  Settings rows, and the Skills list — independent of keyboard focus.
- The command palette is clickable: a row click selects and runs it, a click elsewhere closes it.
