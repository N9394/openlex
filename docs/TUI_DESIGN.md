# Terminal app: design rules

Rules for anyone changing the terminal app (`sidecar/tui/`) or the plain CLI output. The people using it are lawyers, not developers: every rule below serves someone who has never used a terminal before and must still always know where they are, what OpenLex is doing, and where their client data went.

The rules draw on public guidance: the [Command Line Interface Guidelines](https://clig.dev/), Nielsen Norman Group's [10 usability heuristics](https://www.nngroup.com/articles/ten-usability-heuristics/), the [Textual design guide](https://textual.textualize.io/), the [Ink README](https://github.com/vadimdemedes/ink), [no-color.org](https://no-color.org/), and the accessibility notes of other terminal assistants (Claude Code, Gemini CLI, GitHub CLI).

## Structure

- **Every screen** has a one-line header with breadcrumbs (`OpenLex › Alpine share deal › Review`) and, at the bottom, the status bar (matter · working folder · working as / which AI / where client data may go) and one line of key hints for *that* screen. The hints always include `? help` and the way back (`Esc …`); `Frame` (ui.mjs) adds them if a screen forgets. The footer is never hidden.
- **Small windows.** Designed for 80×24. Below 24 rows the AI line goes, below 18 the client-data line; below 60 columns the app shows only "Window too small — please make it wider". Test every new screen at 80×24 (the tests render at that size).
- **One accent colour**, used sparingly. Hierarchy comes from bold / normal / dim and spacing, not more colours. Rounded borders only on question boxes (permission) and cards; no box around the conversation.

## Keys (the same everywhere)

| Key | Meaning |
|---|---|
| Enter | choose / send |
| Esc | back, close a box, cancel, stop the work in progress. **Never quits.** With unsent text: first a hint that the text is kept |
| Ctrl+C | stops a running answer; on an idle screen the first press shows "Press Ctrl+C again to quit", a second within two seconds quits |
| ? | help, only when nothing is typed |
| ↑ ↓ / 1–9 | lists; numbered choices in question boxes |
| PgUp PgDn | scroll the conversation (hint "Fn+↑" on a Mac) |
| Ctrl+J, Alt+Enter | new line in a question (Shift+Enter where the terminal sends it apart from Enter) |
| / and Ctrl+K | commands: typed, or picked from a list. Every `/` command must also be in the Ctrl+K list or Settings |
| Ctrl+L | redraw |

No vim-only keys, no chords. Single letters act only where nothing is being typed (N and Q on the matter list).

## Safety and confirmation

- **Proportional confirmation.** Mild changes: none. Moderate (anything OpenLex does to files, the web, the calendar): a question box. Severe (turning *privileged* off): type *yes*.
- **Permission box.** One sentence with the verb in bold — "OpenLex wants to **save** obligations.csv in this folder: ~/Clients/Alpine. Allow?" — numbered choices, *Allow once* highlighted first, an *Always …* choice never the default, Esc = *Don't allow*, a short bell (Settings can turn it off). Deleting is asked every time.
- **Working folder.** Reading in the folder is allowed (a one-time notice the first time); every change is asked; outside is refused without asking. The home folder needs an explicit "use it anyway".

## Words

- Plain English, no jargon: never a tool name, model id, error code, JSON or stack trace on screen. `explain.mjs` turns engine events into sentences; `bin/friendly.js` turns errors into **what happened · why · what to do**. Raw details go to `~/.lexvault/logs/tui.log`.
- Never lose what the lawyer typed: after an error the question goes back into the field; drafts survive going back.
- Empty screens explain themselves and offer examples ("Try: Summarise the contract in this folder").
- Forgive: `help`, `?`, `exit`, `quit` work as words; a mistyped command gets "Did you mean /model?" with the suggestion in the field.

## Never colour alone

Meaning is always also in a symbol or a word: `✓ Stayed on this computer`, `! Sent to: Claude (Anthropic, EU)`, `✗ The AI service could not be reached.`, `[privileged]`.

## Colour, symbols, accessibility (theme.mjs)

- **Colours by role** (accent, ok, warn, bad), mapped to the terminal's 16 colours so the user's theme and contrast apply. An exact shade only with `COLORTERM=truecolor` *and* a known background (`COLORFGBG`). Never paint backgrounds.
- **No colour** with `NO_COLOR` (non-empty), `TERM=dumb`, output that is not a terminal, or Settings → Colours: None. Bold and inverse stay for the selection.
- **Symbols** are single-width (✓ ✗ • › … ▸); no emoji anywhere in the chrome. **ASCII** (`+ x - > | [x]`, `-` rules, `*` spinner, Up/Down for arrows) with `OPENLEX_ASCII=1` / `--ascii`, `TERM=dumb`, the old Windows console, or a non-UTF-8 locale.
- **Screen-reader mode** (`OPENLEX_ACCESSIBLE=1`, `INK_SCREEN_READER=true`, `TERM=dumb`, or Settings): no boxes, colours, spinners or alternate screen; lines labelled `you:`, `OpenLex:`, `error:`, `Permission required:`; menus numbered (`1. New matter (selected)`).
- **Reduced motion** (Settings, `OPENLEX_REDUCED_MOTION=1`, or not a terminal): spinners become a still "…".

## Rendering

- At most 30 frames a second, only changed lines (`incrementalRendering`); `OPENLEX_FULL_REPAINT=1` redraws everything for terminals that garble partial updates.
- Streamed answer text is applied in batches (every 60 ms), not one redraw per word. Only the lines that fit are rendered.
- The alternate screen is used without mouse capture, so selecting text with the mouse keeps working. `/copy` copies the last answer (OSC 52 plus the system's copy program), `/save` saves it as a file (asked first), `/transcript` prints the conversation into the normal terminal on quit.

## Tests

Offline only (`ink-testing-library`, a fake engine; no model, no keychain, no network). New screens need: header and footer present, Esc does not quit, the 80×24 frame captured (`OPENLEX_TUI_CAPTURE=1 node --test test/tui.test.js` prints them), and, for anything coloured, its meaning visible without colour.
