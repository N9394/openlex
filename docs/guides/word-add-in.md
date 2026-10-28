# Word add-in

OpenLex in Word reviews contracts clause by clause and suggests edits as tracked changes and comments. It also searches the law and fills review grids, all inside the document.

## Install

1. Download the installer for macOS (`.pkg`) or Windows (`.exe`) from the [download page](https://openlex.pinemarshlands.com/download).
2. Run it. It installs the local engine, starts it when you log in, and adds OpenLex to Word. It also sets up the certificate Word needs to talk to the engine on your computer.
3. Restart Word. **OpenLex** appears on the **Home** tab: click **OpenLex Chat** to open the pane.

If the button doesn't appear, go to **Insert → My Add-ins → Shared Folder** (Windows) or **Insert → Add-ins → My Add-ins** (Mac) and pick OpenLex.

> The current installers still use the old name LexVault and ask you to sign in on first start. The next release removes both.

## First steps in the pane

- **Settings → Model:** choose where the AI runs (see [Choose your AI](choose-your-ai.md)).
- **Settings → Data policy:** decide where client data may go (see [Client data rules](client-data-rules.md)).
- **Matter:** link the document to a matter, so the matter's rules, documents and notes apply.

## What you can do

- Ask about the open document: *"Is the liability cap enforceable under Austrian law?"*
- Ask for changes: *"Make the termination clause fairer to the supplier."* Suggestions arrive as cards. Accept one and it becomes a tracked change.
- Run a skill with `/`, for example `/nda-review`, or let OpenLex suggest one.
- Outlook: the same engine also offers an Outlook pane that summarises e-mails, drafts replies and files e-mails into a matter.

## Using it together with the terminal app and the desktop app

All three share one engine on your computer, so a matter created in one is visible in the others.
