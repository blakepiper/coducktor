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
| `:` | Open the Ex command line |
| `Ctrl-O` / `Ctrl-I` | Older / newer cockpit location |

`g` and `Ctrl-W` appear as pending prefixes in the status line. `Esc` or an invalid suffix cancels
a prefix.

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

`Esc` from an active chat cancels the provider turn; it never archives the chat or discards the
draft. In other text surfaces it returns to Normal mode or closes the local overlay as shown.
Terminal, Scratchpad, config editors, dialogs, and other literal text controls retain their normal
editing keys.

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
| `:clear-scratchpad` | Clear the current scratchpad after confirmation |
| `:sidebar` | Toggle the sidebar |
| `:help` | Open the key and command reference |
| `:q` / `:quit` | Quit using the normal confirmation policy |

## Screen behavior

- Chats, All Chats, Skills, Settings, Git, and GitHub lists use `j`/`k` and arrow keys for
  selection; `Enter` opens or activates the selected control.
- Conversation transcripts use `j`/`k`, `gg`/`G`, paging, and search. `Enter` toggles a selected
  expandable activity item. Changes, Files, and Commits use `gt`/`gT`.
- The IDE tree uses `h` or `Left` for the parent and `l`, `Enter`, or `Right` to open an entry.
- In project and Global Settings, `l` moves into values and `h` returns to the section list.
- Structured question cards and confirmation dialogs retain their displayed local keys.

Every visible product control is mouse-operable, including chat cards and menus, Git/GitHub tabs,
settings rows, sidebar navigation, confirmations, pickers, and composer buttons.
