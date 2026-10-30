# Getting started

OpenLex is free and open source. You don't need an account to use it.

There are three ways in. They share one engine on your computer, so your matters, settings and documents are the same everywhere:

| | For | Install |
|---|---|---|
| **Terminal app** | Everyone, on macOS, Linux and Windows. The leanest version. | One line in the terminal (below) |
| **Word add-in** | Working inside contracts: review, suggested edits as tracked changes, law search | Installer from the [download page](https://openlex.pinemarshlands.com/download) |
| **Desktop app** | Research, document analysis, due diligence | Installer from [GitHub Releases](https://github.com/N9394/openlex/releases/latest) ([how to install](desktop-app.md)) |

## 1. Install

Open the Terminal app (macOS: press ⌘ Space, type *Terminal*, press Enter) and paste:

```bash
curl -fsSL https://openlex.pinemarshlands.com/install | bash
```

On **Windows**, open Windows Terminal or PowerShell and paste this instead (no admin needed; it installs into `%USERPROFILE%\.openlex`):

```powershell
irm https://openlex.pinemarshlands.com/install.ps1 | iex
```

You need Node.js 20 or newer (on Windows: `winget install OpenJS.NodeJS.LTS`). If you don't have it, install it from [nodejs.org](https://nodejs.org) first. With Homebrew you can instead run `brew install n9394/openlex/openlex`.

The installer only writes to `~/.openlex`. It checks the release checksum and changes nothing else on your computer.

## 2. Choose where the AI runs

You decide which AI model OpenLex uses. You can run it on your own computer, use your own key with a provider such as Anthropic or OpenAI, or use your firm's cloud account (Azure OpenAI, AWS Bedrock, Google Vertex AI). See [Choose your AI](choose-your-ai.md).

The quickest start with a key you already have:

```bash
openlex use anthropic          # or openai, mistral, openrouter …
openlex key anthropic          # paste the key; it is stored in your computer's keychain
openlex test                   # one tiny call to check it works
```

## 3. Decide where client data may go

Out of the box, **nothing leaves your computer**. A cloud model only receives text after you allow it, for all matters or matter by matter. See [Client data rules](client-data-rules.md).

```bash
openlex policy allow anthropic --regions eu --redact
```

## 4. Ask your first question

```bash
openlex ask "Is a two-year non-compete enforceable for an employee in Austria?"
openlex ask "Summarise the termination rights" --file contract.docx
```

Every answer cites its sources: the statute section, or a verbatim quote from your document.

## Next

- [Your matters](matters.md): analyse a whole document (`openlex analyse contract.docx`), see a matter at a glance, find things again
- [Choose your AI](choose-your-ai.md): local, your own key, or your firm's cloud
- [Client data rules](client-data-rules.md): per matter, privileged matters, EU only, hiding names
- [Word add-in](word-add-in.md) · [Desktop app](desktop-app.md)
- [Set up OpenLex for your firm](firm-setup.md)
- [Troubleshooting](troubleshooting.md)
- Need help setting it up? [We offer paid setup and data services.](https://openlex.pinemarshlands.com/#services)
