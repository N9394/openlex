# The OpenLex terminal app

A full-screen app in the terminal window. You choose everything with the arrow keys and Enter; there are no commands to remember.

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
| Esc | Go back one step, or stop an answer while it is being written |
| Tab | In a question: choose who OpenLex works as. In a file name: complete it |
| 1 to 9 | Choose that item in a list directly |
| ? | Help (when you are not typing) |
| Ctrl+C | Quit |

The bar at the bottom always shows the matter you are in, the AI model, where client data may go, and the keys you can use on that screen.

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
- **Settings.** The AI model, your keys, where client data may go, and the folder where results are saved.

## Inside a matter

- **Ask a question.** Type it and press Enter. The answer appears as it is written, followed by the **sources found** (numbered, for example *[1] ABGB § 879*) and any **proposed changes** as cards (importance, proposed wording, legal basis). Esc stops an answer. PgUp and PgDn scroll back.
- **Add documents.** Drag files or a whole folder from Finder or Explorer into the window and press Enter. Typing the path works too, and Tab completes file names. Files are copied into the matter's folder and your originals are not changed. Folders are added where they are.
- **Actions…**
  - *Review the documents against a checklist.* Every document is checked point by point. A finding is kept only if its quote really appears in the document.
  - *Build a chronology.* Dated events from all documents, with each date checked against its quote.
  - *Translate a document.* A Word translation and a side-by-side file for checking.
  - *Compare two versions.* Pick the older version, then the newer one. Shows what changed, with the important changes rated.
  - *Ask the same questions of every document (review grid).* Type your questions one by one. You get one row per document and one column per question, saved as Excel.
  - *Plan a larger task (you approve each step).* Describe the goal. OpenLex proposes the steps and nothing runs until you approve them. At each pause you decide whether to continue.
  - *Use a firm skill.* Instructions your firm wrote for recurring tasks.

  While an action runs you see which document is being worked on. At the end you can open each result file, or the folder, directly.
- **Working as.** Changes how OpenLex approaches your questions: *Associate* (the default), *Researcher* (legal research memo with exact citations, no document edits), *Reviewer* (risks, with proposed fixes) or *Drafter* (drafts in your firm's wording). Your firm may add its own. The choice is kept for the matter. You never need to type "@" (hard to find on German and Austrian keyboards). Press Tab in the question field, or start a question with `as researcher:`.
- **Privileged: keep on this computer (On/Off).** Turning it on takes effect immediately. Turning it off asks you to confirm first.
- **Client data for this matter.** Shown when a cloud AI is set up. Allows or blocks sending this matter's documents to it.

## When something goes wrong

The app shows one plain sentence and what to do, for example *"The AI service did not accept your key. Check the key in Settings → AI model."* The technical details are written to `~/.lexvault/logs/tui.log`, and the background engine's to `~/.lexvault/logs/engine.log`. Send these to IT if you need help.

## For IT

- `openlex tui` opens the same app. Without a terminal, for example in scripts, `openlex` prints the command list as before, and every command (`openlex status`, `openlex ask …`, …) works unchanged.
- `NO_COLOR=1` turns colours off. `OPENLEX_ASCII=1` uses plain ASCII symbols, which old consoles need. `OPENLEX_KEEP_ENGINE=1` keeps the background engine running after the app quits.
- The app needs a terminal of at least 80×24 characters.
