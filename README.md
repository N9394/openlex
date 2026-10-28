# OpenLex

Open-source, local-first legal AI. OpenLex reads contracts, searches the law and drafts with you, in **Microsoft Word**, in the **desktop app** or in your **terminal**. It runs on your machine, uses the model you choose, and every answer quotes its source.

- Website and downloads: https://openlex.pinemarshlands.com
- Licence: Apache-2.0

```sh
curl -fsSL https://openlex.pinemarshlands.com/install | bash    # or: brew install n9394/openlex/openlex
openlex serve
```

## What's in this repository

| Product | Path | What it is |
|---|---|---|
| **Engine + CLI** | `sidecar/` | The local engine every front end shares (agent loop, model providers, data policy, matters, firm library, workflows, law search, MCP, local API) and the `openlex` command line. Node ≥ 20. |
| **Word add-in** (+ Outlook) | `add-in/` | The task pane in Word (review, suggested edits as tracked changes and comments, review grid, skills) and the Outlook mail pane. Served by the engine. |
| **Desktop app** | `desktop/` | Electron shell (`electron/`), React UI (`client/`), the app's API server (`server/`, compiled JavaScript) with newer modules in `server-fixes/`. Runs the local model, Qdrant, embeddings and the engine. |
| Skills and playbooks | `sidecar/skills/`, `sidecar/playbooks/` | Starter skills (`SKILL.md`) and review checklists. Firms add their own as files. |
| Docs | `docs/` | [Harness map](docs/HARNESS.md) (`openlex.json`), [Local API](docs/LOCAL_API.md). |
| Benchmarks | `benchmarks/legalbench/` | LegalBench runner, judge and leaderboard. |
| Scripts | `scripts/` | Install script, CLI package, Word plugin installers, certificates. |

## What it does

- **Bring your own model:** local (llama.cpp / Ollama), Anthropic, OpenAI, Azure OpenAI, Mistral, AWS Bedrock, Google Vertex AI, OpenRouter or any OpenAI-compatible endpoint. A different model per task if you like (harness map). Keys stay in the OS keychain.
- **Data policy per matter:** local-only by default. Cloud providers, web access and connectors must be allowed, optionally only in approved regions (e.g. EU). Privileged matters never leave the machine. Names and identifiers can be pseudonymised before a cloud call. Every model, web and connector call is audited (metadata, never content).
- **Verified, never invented:** reviews, chronologies and grid cells keep only answers whose quote appears word for word in the document; a judge checks suggested edits against the cited law.
- **The firm's own data:** precedents and past work (.docx, PDF with on-device OCR, text) indexed locally per matter; a clause library of the firm's standard wording; connectors (MCP) to DMS, mail and databases.
- **Workflows:** checklist review, chronologies, translation with number and glossary checks, version comparison with materiality, review grids (Excel export), plans with checkpoints, lists and deadlines, monitors on official sources (EUR-Lex, the Austrian federal gazette, RSS, pages).
- **Customisable at every turn:** one `openlex.json` (firm layer, user layer, firm locks) for model routing per task, firm rules at each decision point (hooks), agent profiles (`@researcher`, `@drafter` …) and features. Skills and playbooks are plain files.
- **Safe by construction:** the agent cannot run code or reach the network from a shell (the shell tool is off by default and sandboxed when a firm turns it on), cannot leave the workspace or change the firm's rules, and every overwrite keeps the previous version.

## Install the terminal app and CLI

Needs [Node.js](https://nodejs.org) 20 or newer. No admin rights; the installer verifies the release checksum and writes only to `~/.openlex`.

```bash
curl -fsSL https://openlex.pinemarshlands.com/install | bash          # macOS, Linux
```

```powershell
irm https://openlex.pinemarshlands.com/install.ps1 | iex             # Windows (PowerShell)
```

On Windows the installer puts `openlex.cmd` into `%USERPROFILE%\.openlex\bin` and adds that folder to your user PATH; no Node yet → `winget install OpenJS.NodeJS.LTS`. Use Windows Terminal for the full-screen app. A specific version: `OPENLEX_VERSION=0.2.0` (Windows: `$env:OPENLEX_VERSION = '0.2.0'`) before the line. Running the line again upgrades. Uninstall: delete `~/.openlex` (Windows: `Remove-Item -Recurse -Force "$env:USERPROFILE\.openlex"` and remove its `bin` folder from your user PATH); your matters in `~/.lexvault` are kept.

## Terminal app

Type `openlex` (no arguments) in a terminal and a full-screen app opens: no commands to learn. It starts OpenLex in the background if needed, walks you through choosing where the AI runs and where client data may go, and then shows your matters. In a matter you can ask questions (answers come with the sources found and proposed changes), add documents by dragging them into the window, and run the larger tasks: checklist review, chronology, translation, comparing two versions, a review grid, or a plan you approve step by step. The bar at the bottom always shows the matter, the AI model and where client data may go. Arrow keys and Enter to choose, Esc to go back, `?` for help. See [docs/guides/terminal-app.md](docs/guides/terminal-app.md).

## Install the CLI

| | |
|---|---|
| Script (macOS, Linux, WSL) | `curl -fsSL https://openlex.pinemarshlands.com/install \| bash` installs into `~/.openlex`, checks the release checksum and links `openlex` into `~/.local/bin`. |
| Homebrew | `brew install n9394/openlex/openlex` |
| Manual | Download `openlex-<version>.tar.gz` from [Releases](https://github.com/N9394/openlex/releases), unpack, run `./openlex`. |
| From source | `cd sidecar && npm install && npm link` |

All need Node.js 20 or newer. Models are not included: add a cloud key, or run a local model (`brew install llama.cpp`; OpenLex finds `llama-server` on `PATH`) with a GGUF in `~/.lexvault/models/`.

## Use the CLI

Start the engine once (`openlex serve`, or open Word with the add-in, or the desktop app); every command talks to it.

```bash
openlex serve                                   # the local engine (keeps running)
openlex                                         # the terminal app (same as: openlex tui)
openlex status                                  # engine, model, readiness
openlex use anthropic                           # or: use local · use openrouter:qwen/qwen3.5-9b · use azure --base-url …
openlex key anthropic                           # your own API key, stored in the OS keychain
openlex policy allow anthropic --regions eu --redact   # where client data may go (default: nowhere)
openlex ask "Is the liability cap enforceable under Austrian law?" --file contract.docx
openlex ask "@researcher /research-memo is a 2-year non-compete valid in Austria?"

# matters and the firm's data
openlex matters
openlex matters new "Alpine share deal" --client "Alpine Holding" --privileged   # privileged: never leaves this computer
openlex clauses --type liability                # the firm's own clause wording

# workflows on a matter's documents
openlex review --matter <id> [--playbook nda]   # checklist review, verbatim quotes only
openlex chronology --matter <id>
openlex translate contract.docx --to en         # Word translation + review table + checks
openlex compare v1.docx v2.docx                 # redline with materiality
openlex grid new "DD grid" --columns cols.json --matter <id>
openlex grid run <grid-id>
openlex plan "Due diligence on the supplier contracts" --matter <id>   # proposes, you approve
openlex lists new "Closing checklist"
openlex monitors add eurlex "artificial intelligence" --topics high-risk

# customisation
openlex skills
openlex skills draft "check supplier contracts for 60-day payment terms"
openlex playbook draft precedents/*.docx --title "Our NDA standard" --save our-nda
openlex agents
openlex map [--matter <id>] [--agent researcher]  # which model handles each task, firm rules, profiles
openlex map set routes routes.json
openlex decide "text" --question "Is Austrian law chosen?"   # System One decision model (Kev / Jev)
```

`--json` prints raw results for scripts. For your own integrations, use the [local API](docs/LOCAL_API.md).

## Word add-in

Development:

```bash
cd sidecar && npm install && npm start            # the engine (or: openlex serve)
scripts/gen-cert.sh && scripts/trust-cert-mac.sh  # localhost certificate (Office.js needs HTTPS)
add-in/sideload-mac.sh                            # load the add-in into Word
```

Outlook: with the engine running, add `add-in/outlook-manifest.xml` via Outlook → Get Add-ins → My add-ins → Add a custom add-in → From file.

Installers: `scripts/package-mac.sh` (pkg; fetches llama.cpp and Qdrant from their official releases) and `scripts/package-win.sh` (NSIS). Code-only updates: `scripts/build-update.sh`. Ready-made installers are on the [download page](https://openlex.pinemarshlands.com/download).

## Desktop app

```bash
cd desktop/server && npm ci && npx prisma generate     # API server (once)
cd desktop/client && npm install && npm run dev        # UI
cd desktop/electron && npm install && npm run start:dev
```

Packaging: `cd desktop/electron && npm run package:mac` (or `package:win`, `package:linux`). This builds the UI, stages the server with `server-fixes/`, the engine, skills and playbooks, and fetches llama.cpp and Qdrant. See [desktop/server/README.md](desktop/server/README.md) for the server's settings.

## Use OpenLex from another MCP client

```json
{ "mcpServers": { "openlex": { "command": "node", "args": ["/path/to/openlex/sidecar/src/mcp/server.js"] } } }
```

The firm library is not exposed over MCP unless `~/.lexvault/mcp-expose.json` contains `{ "firmLibrary": true }`. MCP clients usually forward tool results to a cloud model.

## Data on disk

Everything lives under `~/.lexvault` (the name is kept for compatibility): `providers.json`, `policy.json`, `matters.json`, `library.json`, `openlex.json` (your layer of the harness map), `audit/llm-calls.jsonl`, `run/` (engine registry and hub token, 0600). Work files go to the workspace folder (`~/LexVault` by default), with earlier versions in `.openlex/history/`. API keys are in the OS keychain, never in these files.

## Tests

```bash
cd sidecar && npm test                                    # engine (offline)
OPENLEX_TEST_NETWORK=1 node --test test/web.test.js       # + live RIS and browser
node --test desktop/electron/test/                        # app ↔ Word hub, engine bootstrap
```

## Community build and distributions

The code here has no built-in server: it is the **community build**, with no licence check and no update feed. A company that distributes OpenLex with its own licences, updates, law packs and models ships a `distribution.json` next to the engine (format: `distribution.example.json`; lookup: `sidecar/src/distribution.js`; build scripts read the path from `OPENLEX_DISTRIBUTION`). That file never belongs in this repository.

## Help with setup and data

OpenLex is free to use. [Pine & Marshlands](https://openlex.pinemarshlands.com/#services) offers **paid** consulting: setting OpenLex up on a firm's infrastructure, gathering and preparing the legal data a practice needs, and connecting existing systems (DMS, internal databases, legal databases the firm subscribes to).

## Licence

Apache-2.0. See [LICENSE](LICENSE). Law data packs and model weights are distributed separately under their own terms.
