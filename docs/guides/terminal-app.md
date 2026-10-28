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

## Keys

| Key | What it does |
|---|---|
| ↑ ↓ | Move through a list |
| Enter | Choose, or send your question |
| Esc | Go back one step, or stop the work in progress (what is done is kept) |
| Ctrl+B | In a conversation: what the last answer is based on, in full |
| Tab | In a question: choose who OpenLex works as. In a file name: complete it |
| 1 to 9 | Choose that item in a list directly |
| ? | Help (when you are not typing) |
| Ctrl+C | Quit |

The bar at the bottom always shows the matter you are in, which AI is used, where client data may go, and the keys you can use on that screen.

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
- **Quick question (no matter).** Ask a legal question without opening a matter.
- **Settings.** Which AI, your keys, where client data may go, and the folder where results are saved.

## Inside a matter

- **Ask a question.** Type it and press Enter. While OpenLex works you see what it is doing, step by step (see *What the screens tell you* below). The answer appears as it is written, followed by **Based on** (the law and passages it used) and any **proposed changes** as cards. Esc stops an answer. PgUp and PgDn scroll back.
- **Ask about a file.** Drag one or more files into the question field (or paste their paths). They appear above the field as *📎 SPA draft 3.docx · 2.1 MB*; Backspace in the empty field removes the last one. With one file the question is about that file; with several, all of them are included. The files are also copied into the matter's folder (your originals are unchanged). Word, PDF and text files work; a scanned PDF without text is sent without it, and the app says so. Pasting a block of text with line breaks keeps it as one question: nothing is sent until you press Enter.
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
- **Working as.** Changes how OpenLex approaches your questions: *Associate* (the default), *Researcher* (legal research memo with exact citations, no document edits), *Reviewer* (risks, with proposed fixes) or *Drafter* (drafts in your firm's wording). Your firm may add its own. The choice is kept for the matter. You never need to type "@" (hard to find on German and Austrian keyboards). Press Tab in the question field, or start a question with `as researcher:`.
- **Privileged: keep on this computer (On/Off).** Turning it on takes effect immediately. Turning it off asks you to confirm first.
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
| `/sources` | What the last answer is based on, in full (same as Ctrl+B). |
| `/activity` | Recent activity: what OpenLex did, and where the data went. |
| `/clear` | Start a new conversation in this matter. |
| `/help` | The list of commands. |

A change of AI applies from your next question; an answer that is being written finishes with the AI it started with. Other words after `/` use your firm's instructions of that name. Changes made in Word or with the `openlex` command appear here too.

## When OpenLex asks first

OpenLex reads documents and searches the law without asking. Before it **saves a file, opens a web page, runs a command, adds to your calendar or uses a connector** to another system, it stops and asks, for example *"OpenLex wants to save a file: Save obligations.csv in Acme/"*. You choose:

- **Allow once** (Enter): just this time.
- **Always allow (this matter)** (a): don't ask again in this matter.
- **Always allow** (A): don't ask again anywhere.
- **Don't allow** (n or Esc): OpenLex carries on without it and tells you what it could not do.

Nothing happens until you choose. If you don't answer within five minutes, the answer is no. Your firm can allow or block things for everyone; a firm block always wins. To see or remove what you allowed: Settings → *What OpenLex may do without asking*, or `/permissions`. The Word pane shows the same question as a card with the same four buttons.

## When something goes wrong

The app shows one plain sentence and what to do, for example *"The AI service did not accept your key. Check the key in Settings → Which AI."* The technical details are written to `~/.lexvault/logs/tui.log`, and the background engine's to `~/.lexvault/logs/engine.log`. Send these to IT if you need help.

## For IT

- `openlex tui` opens the same app. Without a terminal, for example in scripts, `openlex` prints the command list as before, and every command (`openlex status`, `openlex ask …`, …) works unchanged.
- Permissions from scripts: `openlex ask` in a terminal asks on one line (*[y]es once / [a]lways / [n]o*). Piped or with `--json` it never asks and anything that would need a yes is refused, unless you pass `--allow write_file:Acme/**` (patterns, this run only) or `--yes` (everything that would be asked, this run only). Firm blocks still apply. Rules: `openlex permissions [list | allow PATTERN [--matter ID] | ask PATTERN | deny PATTERN | remove PATTERN]`; the format is in `docs/HARNESS.md` → `permissions`.
- `NO_COLOR=1` turns colours off. `OPENLEX_ASCII=1` uses plain ASCII symbols, which old consoles need. `OPENLEX_KEEP_ENGINE=1` keeps the background engine running after the app quits.
- Windows: Windows Terminal is recommended. The old console window (conhost) gets plain ASCII symbols automatically (`OPENLEX_ASCII=0` turns the symbols back on). In Git Bash's own window (mintty) Node may not see an interactive terminal, and `openlex` then prints the command list; use Windows Terminal. Logs are in `%USERPROFILE%\.lexvault\logs`. Install for all users or offline: unpack the release `.tar.gz` anywhere and run its `openlex.cmd`; `OPENLEX_HOME` and `OPENLEX_BIN_DIR` move the installer's folders.
- The app needs a terminal of at least 80×24 characters.
