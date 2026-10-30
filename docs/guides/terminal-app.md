# The OpenLex terminal app

A full-screen app in the terminal window. You choose everything with the arrow keys and Enter; there are no commands to remember (a few optional ones, typed with `/`, change the setup during a conversation).

## Installing it

You need Node.js 20 or newer. On macOS or Linux, paste into the terminal:

```
curl -fsSL https://openlex.pinemarshlands.com/install | bash
```

On Windows, open **Windows Terminal** (or PowerShell) and paste:

```
irm https://openlex.pinemarshlands.com/install.ps1 | iex
```

No Node.js yet? The Windows installer tells you; install it with `winget install OpenJS.NodeJS.LTS`, open a new window and paste the line again. The installer needs no administrator rights. It checks the download's checksum, installs into `%USERPROFILE%\.openlex` and adds `%USERPROFILE%\.openlex\bin` to your own PATH; nothing else changes. Paste the same line again to update.

To remove OpenLex from Windows: `Remove-Item -Recurse -Force "$env:USERPROFILE\.openlex"`, then remove `…\.openlex\bin` from *Path* under *Edit environment variables for your account*. On macOS and Linux: `rm -rf ~/.openlex ~/.local/bin/openlex`. Your matters and settings in `.lexvault` stay; delete that folder too to remove everything.

## Starting it

Open Terminal (macOS), Windows Terminal or any Linux terminal and type:

```
openlex
```

OpenLex starts in the background if it isn't running yet. This takes a few seconds the first time. When you quit the app, it stops OpenLex again unless Word or the desktop app started it.

Start it **in the folder of a client or matter** and OpenLex works there: `cd ~/Clients/Alpine` and then `openlex` (or `openlex --folder ~/Clients/Alpine` from anywhere). See *Working in a folder* below.

The very first time, after the two setup questions, three short screens show what OpenLex can do, how to ask and where your data goes. Esc skips them; `?` then `t` shows them again.

## Keys

| Key | What it does |
|---|---|
| ↑ ↓ | Move through a list. In an empty question field: your earlier questions |
| Enter | Choose, or send your question |
| Ctrl+J (or Alt+Enter) | A new line in a question |
| Esc | Go back one step, close a question box, or stop the work in progress (what is done is kept). Esc never quits. With text typed it first says the text is kept |
| Ctrl+C | Stop the answer being written. Pressed twice: quit (the bottom line says "Press Ctrl+C again to quit") |
| Ctrl+K | All commands, as a list |
| Ctrl+B | In a conversation: what the last answer is based on, in full |
| PgUp PgDn | Scroll the conversation (Fn+↑ / Fn+↓ on a Mac keyboard) |
| Tab | In a question: choose who OpenLex works as, or complete a `/` command. In a file name: complete it |
| 1 to 9 | Choose that item in a list or a question box directly |
| ? | Help (when nothing is typed) |
| Ctrl+L | Draw the screen again |

The top line shows where you are (*OpenLex › Alpine share deal › Review*). The bar at the bottom always shows the matter you are in, the folder you work in, which AI is used, where client data may go, and the keys you can use on that screen.

You can also type `help` or `?` as a question to see the commands, and `exit` or `quit` to leave. A mistyped command gets a suggestion (*"There is no command /modle. Did you mean /model? Press Enter to use it."*).

## First start: two questions

1. **Where should the AI run?**
   - *On this computer.* The most private option. It needs a capable machine (16 GB of memory or more) and a model. The model is a large download, so the app doesn't fetch it by itself: install it from the OpenLex desktop app's Settings. If you already use Ollama or LM Studio, choose that instead.
   - *With my own key.* Anthropic, OpenAI, Mistral or OpenRouter. Paste your key. It stays hidden on screen and is stored in your computer's keychain, never in a file.
   - *With my firm's cloud account.* Azure OpenAI, AWS Bedrock or Google Vertex. Your IT team has the details the app asks for.
   - *Another server my firm runs.* For example a firm gateway. You will be asked whether the server runs inside the firm.
2. **May client documents be sent to it?**
   - *No, keep everything on this computer.* This is the default, and the most private answer.
   - *Only for matters I choose.* Nothing is sent until you allow it for a matter. You are asked when you create one, and you can change it in the matter.
   - *Yes, for all matters.*

   You can also switch on *EU data centres only* and *Hide client names before sending*.

The app then checks that the AI answers, and shows ✓ or ✗ with a plain explanation. You can skip setup and come back to it any time under **Settings**.

## Your matters

The first screen lists your matters. Privileged ones are marked **[privileged]**. You can also choose:

- **New matter.** Give it a name, optionally the client, and say whether it is privileged. *Privileged* means nothing from this matter ever leaves this computer, whatever the other settings say.
- **Quick question (no matter).** Ask a legal question without opening a matter (Q). In a working folder: about the documents there.
- **Settings.** Which AI, your keys, where client data may go, what OpenLex may do without asking, the working folder, the folder where results are saved, and *Accessibility*.

N creates a new matter, Q opens a quick question, `/` filters the list by name or client.

## Working in a folder

Like a coding assistant works in the folder you start it in, OpenLex works in the folder of a client or matter:

```
cd ~/Clients/Alpine
openlex
```

- **Reading is allowed.** OpenLex reads the Word, PDF and text files in this folder (and its subfolders) when your question needs them: *"Summarise the contract in this folder"*, *"Which deadlines are in these documents?"*. The first time OpenLex works in a folder it says so — *"OpenLex can read the files in this folder: ~/Clients/Alpine (12 documents)"* — and you can answer **Don't let OpenLex read this folder**.
- **Every change is asked first.** Before OpenLex saves, adds to, renames or deletes a file there, it asks: *"OpenLex wants to **save** obligations.csv in this folder: ~/Clients/Alpine. Allow?"* — **1 Allow once** (Enter), **2 Always allow (this folder)** (a), **3 Don't allow** (n or Esc). *Always allow (this folder)* is remembered for this folder only. Deleting is asked **every time** (there is no "always"), and a copy of the deleted file is kept in OpenLex's history, so it can be restored.
- **Nothing outside.** Files outside this folder and your matter folders are refused without asking — also through links (aliases) that point elsewhere, `..` or another spelling of the same name. Hidden files and folders (like `.git`), system folders, OpenLex's own data and your firm's configuration are off-limits too.
- **The whole home folder** (what a new terminal window usually opens in) or the whole computer is too broad: OpenLex warns *"That's your whole home folder"* and offers to work without a folder, to choose the folder of one client, or — only if you say so — to use it anyway.
- **Big folders** are fine: listings and searches stop after a set number of files and say so.
- **The documents of the folder for a matter.** In a matter, *Use the 12 documents in this folder for this matter* adds the folder to the matter in one step (your files stay where they are), so reviews, chronologies and grids include them.
- **Changing it.** `/folder ~/Clients/Beta` (or drag a folder in after `/folder`), `/folder none` to stop, or Settings → *Working folder*. The bottom bar shows *Working in: ~/Clients/Alpine*.

While OpenLex works, the steps say what it does with files in plain words: *Reading “SPA.docx” in this folder*, *Saving “obligations.csv” in this folder*, *Not done — “x.csv” is outside the folder you are working in (never allowed)*.

## Inside a matter

- **Ask a question.** Type it and press Enter. While OpenLex works you see what it is doing, step by step (see *What the screens tell you* below). The answer appears as it is written, followed by **Based on** (the law and passages it used) and any **proposed changes** as cards. Esc stops an answer. PgUp and PgDn scroll back.
- **Ask about a file.** Drag one or more files into the question field (or paste their paths). They appear above the field as *+ SPA draft 3.docx · 2.1 MB*; Backspace in the empty field removes the last one. With one file the question is about that file; with several, all of them are included. The files are also copied into the matter's folder (your originals are unchanged). Word, PDF and text files work; a scanned PDF without text is sent without it, and the app says so. Pasting a block of text with line breaks keeps it as one question: nothing is sent until you press Enter. A long block (five lines or more, an email for example) is shown as one chip, *[Pasted 214 lines]*, and sent with your question; Ctrl+O puts it into the field to edit.
- **Add documents.** Drag files or a whole folder from Finder or Explorer into the window and press Enter. Typing the path works too, and Tab completes file names. Files are copied into the matter's folder and your originals are not changed. Folders are added where they are.
- **Actions…**
  - *Review the documents against a checklist.* Every document is checked point by point. A finding is kept only if its quote really appears in the document.
  - *Build a chronology.* Dated events from all documents, with each date checked against its quote.
  - *Translate a document.* A Word translation and a side-by-side file for checking.
  - *Compare two versions.* Pick the older version, then the newer one. Shows what changed, with the important changes rated.
  - *Ask the same questions of every document (review grid).* Type your questions one by one. You get one row per document and one column per question, saved as Excel.
  - *Plan a larger task (you approve each step).* Describe the goal. OpenLex proposes the steps and nothing runs until you approve them. At each pause you decide whether to continue.
  - *Use your firm's instructions.* Instructions your firm wrote for recurring tasks.

  While an action runs you see how far it is and how long it will take (see below). At the end you can open each result file, or the folder, directly.
- **Recent activity.** The last requests in this matter: when, what was asked, what OpenLex looked at, where the data went and the result. `/activity` opens it from the conversation.
- **AI record.** The checkable record to show a client or your data protection officer: which AI ran where, whether names were hidden, what was looked up online, every permission decision — never the content. `l` shows only what left this computer, `p` / `c` export a PDF / CSV into the matter folder, `v` checks that nothing was changed. `/record` opens it from the conversation (`/record all` for every matter). See [The AI record](ai-record.md).
- **Working as.** Changes how OpenLex approaches your questions: *Assistant* (the default), *Researcher* (legal research memo with exact citations, no document edits), *Reviewer* (risks, with proposed fixes) or *Drafter* (drafts in your firm's wording). Your firm may add its own. The choice is kept for the matter. You never need to type "@" (hard to find on German and Austrian keyboards). Press Tab in the question field, or start a question with `as researcher:`.
- **Privileged: keep on this computer (On/Off).** Turning it on takes effect immediately. Turning it off needs you to type *yes*.
- **Use the documents in this folder for this matter.** Shown when you work in a folder whose documents the matter doesn't have yet.
- **Client data for this matter.** Shown when a cloud AI is set up. Allows or blocks sending this matter's documents to it.

## What the screens tell you

OpenLex is built so that you always know what is going on, without technical knowledge.

**While it answers a question**, a numbered list grows under your question, one line per step, with how long each step took:

```
 OpenLex is working on it · 10 s so far
  1 ✓ Working out how to answer                                             3 s
  2 ✓ Reading clause 4 (Gewährleistung)                                     2 s
  3 ▸ Searching Austrian law: “Gewährleistung Frist”                        5 s
       found: ABGB § 933, ABGB § 932
     • Next: writing the answer
 ✓ Nothing has left this computer so far
 Esc stop · the answer so far is kept
```

✓ is done, ▸ is what it is doing now, • is what comes next. Steps say what is read ("Reading clause 4"), what is searched and with which words ("Searching Austrian law: …"), when an official source is checked ("Checking the official source (RIS, Austria's federal law database)"), when your firm's precedents are searched, and when proposed changes are checked against the law they cite. If a step fails, the line says what that means for the answer, for example *"Couldn't reach RIS; the answer uses the copy of the law on this computer instead."*

**Where your data went** is always the last line of the list, and stays under the answer afterwards:

- *✓ Stayed on this computer* — nothing left your computer.
- *! Sent to: Claude (Anthropic, EU) — names hidden · 2 times* — your question or document text went to that AI service, that many times; "names hidden" means the client names you listed were replaced before sending. This line is shown in warning colour so it cannot be missed.
- *Looked up online: RIS …* — only search words or a web address went to a public law database or website, not your documents.

**What the answer is based on** follows each answer:

```
 Based on:
   [1] ABGB § 933 — Das Recht auf die Gewährleistung muss gerichtlich …
   [2] ABGB § 932 — Der Übernehmer kann wegen eines Mangels die …
   [3] Your document: clause 4 (Gewährleistung)
   Ctrl+B or /sources: see each one in full
```

Ctrl+B (or `/sources`) lists them all; Enter opens the full text of a law section. Each proposed change says whether it was checked: *checked against ABGB § 933 ✓*, or *could not be verified — review carefully*.

**Larger work** (review, chronology, grid, translation, plan) shows how far it is and how long is left, with every document:

```
 Document 3 of 12 · about 7 minutes left · 1 min 40 s so far
 ███████░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░ 17%
   ✓ Lease 01.docx                                                         42 s
   ✓ Lease 02.docx                                                         46 s
   ▸ Lease 03.docx — checking it point by point                            12 s
   • Lease 04.docx
```

The time left is estimated from the documents finished so far, so it appears after the first one.

**Stopping.** Esc stops at any time, and the app says what was kept: *"Stopped by you. Kept: the answer so far (120 words), 2 law sections it found. Nothing more is sent or saved."* For larger work, what was done so far is saved in the matter folder.

**Recent activity** (matter menu, or `/activity`) lists each request with when, what was asked, what was looked at, where the data went and the result. It never shows document text or answers.

Press `?` and then → for a one-screen summary of all this inside the app.

## Changing the setup during a conversation

Type `/` in the question field to see the commands. They change things without leaving the conversation, and each answers with one line, for example *"Now using Claude (Anthropic, EU), an online AI service. Client data for this matter: may go to Anthropic (EU only)."* The bar at the bottom changes at once.

| Command | What it does |
|---|---|
| `/model` | Choose where the AI runs. `/model local`, `/model anthropic` or `/model openrouter:qwen/qwen3.5-9b` switch directly. |
| `/key` | Add or replace the key for the AI in use (`/key mistral` for another), then check that it works. The key stays hidden. |
| `/data` | Where client data of this matter may go: keep it on this computer, allow the AI in use, EU data centres only, or hide client names. |
| `/as` | Who OpenLex works as (`/as researcher`). |
| `/privileged on` / `off` | Keep this matter on this computer. Turning it off asks you to confirm. |
| `/permissions` | What OpenLex may do without asking (see below). |
| `/folder` | The folder OpenLex works in: `/folder ~/Clients/Beta`, `/folder none`. |
| `/sources` | What the last answer is based on, in full (same as Ctrl+B). |
| `/copy` | Copy the last answer, to paste it into an email or Word. |
| `/save` | Save the last answer as a file (Markdown) in the working folder, or the matter's folder. Asked first, like any save. |
| `/transcript` | When you quit, the conversation is printed in the terminal window, where you can scroll, select and copy it. |
| `/activity` | Recent activity: what OpenLex did, and where the data went. |
| `/record` | The AI record for this matter (`/record all`: every matter), to show a client; export and check it. |
| `/clear` | Start a new conversation in this matter. |
| `/help` | The list of commands. |

Ctrl+K shows the same list without typing `/`. Under the newest answer a dim line suggests what to do next. A change of AI applies from your next question; an answer that is being written finishes with the AI it started with. Other words after `/` use your firm's instructions of that name. Changes made in Word or with the `openlex` command appear here too.

## When OpenLex asks first

OpenLex reads documents and searches the law without asking. Before it **saves, renames or deletes a file, opens a web page, runs a command, adds to your calendar or uses a connector** to another system, it stops and asks in one sentence, for example *"OpenLex wants to **save** obligations.csv in Acme/. Allow?"*, with a short bell (Settings → Accessibility turns it off). The choices are numbered; *Allow once* is always the one highlighted at first:

- **1 Allow once** (Enter): just this time.
- **Always allow (this matter)** (a): don't ask again in this matter. In a working folder: **Always allow (this folder)**.
- **Always allow** (A): don't ask again anywhere.
- **Don't allow** (n or Esc): OpenLex carries on without it and tells you what it could not do.

Deleting a file is asked every time. Nothing happens until you choose. If you don't answer within five minutes, the answer is no. Your firm can allow or block things for everyone; a firm block always wins. To see or remove what you allowed: Settings → *What OpenLex may do without asking*, or `/permissions`. The Word pane shows the same question as a card with the same four buttons.

## When something goes wrong

The app says what happened, why, and what to do, for example:

```
 ✗ The AI service could not be reached.
   The internet connection may be off, or the firm server may not be running.
   Check the connection and try again.
```

Your question goes back into the field, so pressing Enter tries again. The technical details are written to `~/.lexvault/logs/tui.log`, and the background engine's to `~/.lexvault/logs/engine.log`. Send these to IT if you need help.

## Accessibility

Settings → *Accessibility*:

- **Screen-reader mode** — plain lines without boxes, colours or animation; lines start with *you:*, *OpenLex:*, *error:*, *Permission required:*; lists are numbered (answer with the number). Also on with `OPENLEX_ACCESSIBLE=1`.
- **Reduced motion** — no spinners.
- **Colours** — *Auto* uses your terminal's own colour scheme (so its contrast settings apply), *None*, or *High contrast*. Nothing is shown by colour alone: every coloured mark also has a symbol or a word (*✓ Stayed on this computer*, *! Sent to …*, *[privileged]*).
- **Plain ASCII symbols** — for terminals that show ✓ or ─ as boxes.
- **Bell** when OpenLex asks you something.

The app lays itself out for 80×24 and larger; smaller windows drop the AI line first, then the client-data line; below 60 columns it asks for a wider window.

## The plain commands

`openlex ask "…"` works in the folder you run it in, like the app (`--folder DIR` for another, `--no-folder` for none; the whole home folder is not used without asking). It shows the same plain sentences while it works (a spinner line with the time so far in a terminal), then what the answer is based on and where the data went:

```
OpenLex can read the files in this folder: ~/Clients/Alpine (3 documents). It asks before it saves, renames or deletes anything here.
  • Reading “SPA.docx” in this folder
  • Searching Austrian law: “Gewährleistung Frist”
The warranty period is two years …
Based on:
  [1] ABGB § 933
Done after 9 s · 4 steps
✓ Stayed on this computer
```

The answer goes to standard output and everything else to standard error, so `openlex ask … > answer.txt` keeps only the answer. `openlex review` and `openlex chronology` show *Document 3 of 12: Lease 3.docx* and end with what was saved and where the data went.

## For IT

- `openlex tui` opens the same app. Without a terminal, for example in scripts, `openlex` prints the command list as before, and every command (`openlex status`, `openlex ask …`, …) works unchanged.
- Permissions from scripts: `openlex ask` in a terminal asks on one line (*[y]es once / [a]lways / [n]o*). Piped or with `--json` it never asks and anything that would need a yes is refused, unless you pass `--allow write_file:Acme/**` (patterns, this run only) or `--yes` (everything that would be asked, this run only). Firm blocks still apply. Rules: `openlex permissions [list | allow PATTERN [--matter ID] | ask PATTERN | deny PATTERN | remove PATTERN]`; the format is in `docs/HARNESS.md` → `permissions`.
- `NO_COLOR=1` turns colours off. `OPENLEX_ASCII=1` (or `--ascii`) uses plain ASCII symbols, which old consoles need; a non-UTF-8 locale and `TERM=dumb` do the same. `OPENLEX_ACCESSIBLE=1` (or `INK_SCREEN_READER=true`) starts in screen-reader mode, `OPENLEX_REDUCED_MOTION=1` without animation. `OPENLEX_FULL_REPAINT=1` redraws the whole screen each time, for terminals that garble partial updates. `OPENLEX_KEEP_ENGINE=1` keeps the background engine running after the app quits.
- Working folder: `openlex --folder DIR`, `openlex ask … --folder DIR | --no-folder`. The engine takes it per request (`folder` in the local API, see `docs/LOCAL_API.md`); rules for it are path patterns like `write_file:~/Clients/Alpine/**` (`docs/HARNESS.md` → `permissions`). To forbid a folder for good: `openlex permissions deny '*:~/Clients/Alpine/**'`.
- Windows: Windows Terminal is recommended. The old console window (conhost) gets plain ASCII symbols automatically (`OPENLEX_ASCII=0` turns the symbols back on). In Git Bash's own window (mintty) Node may not see an interactive terminal, and `openlex` then prints the command list; use Windows Terminal. Logs are in `%USERPROFILE%\.lexvault\logs`. Install for all users or offline: unpack the release `.tar.gz` anywhere and run its `openlex.cmd`; `OPENLEX_HOME` and `OPENLEX_BIN_DIR` move the installer's folders.
- The app needs a terminal of at least 80×24 characters.
