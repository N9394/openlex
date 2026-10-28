# OpenLex

An open, local-first harness for legal work. It runs inside Microsoft Word and as a desktop app. The firm decides which model it uses and where client data may go.

- **Bring your own model:** local (llama.cpp / Ollama, Lotus by default), Anthropic, OpenAI, Azure OpenAI, Mistral, AWS Bedrock, Google Vertex AI, OpenRouter or any OpenAI-compatible endpoint. Each model is driven by a profile (thinking, tool protocol, temperature, context window), not by checks on its name; firms can change or add profiles in `openlex.json` ([docs/HARNESS.md](docs/HARNESS.md)). API keys are stored in the OS keychain.
- **Data policy per matter:** local-only by default. Cloud providers, web access and external connectors have to be allow-listed, optionally limited to approved regions (for example EU only). Privileged matters always stay on the machine. Every model, web and connector call is written to an audit log (metadata only, never content).
- **Redact-before-send:** client names, listed parties, e-mail addresses, IBANs and phone numbers are replaced with placeholders before a cloud call and restored locally in the answer.
- **Verified answers:** law search over local jurisdiction packs, a judge that checks suggestions against sources, and whole-matter workflows that drop any finding without a verbatim quote.
- **The firm's own data:** precedents, templates and past work (.docx, PDF including scans via on-device OCR, text) are indexed locally (firm library), scoped per matter. A clause library shows the firm's standard wording per clause type and how often it is used.
- **Workflows:** whole-matter review against a checklist, chronologies, contract translation with number/glossary checks, and version comparison.
- **Review grid:** rows are documents, columns are your questions (text, yes/no, choice, date, amount, or built on another column's answer). Every cell quotes its document; answers whose quote isn't found are flagged. Exports to Excel.
- **Skills and playbooks as files:** reusable instructions (`SKILL.md`) run with `/name` and are suggested when they fit; starters for NDA, DPA (GDPR Art. 28), lease, employment, M&A red flags, summaries, clause rebalancing and research memos. Draft new skills from a plain-language request, and build a review playbook from the firm's own precedents.
- **Plans you approve first:** describe a goal; OpenLex proposes steps (review, chronology, grid, translation, comparison, research, skills) and checkpoints where you decide. Nothing runs before you approve, independent steps run side by side, and every run ends in a report.
- **Lists and monitors per matter:** checklists and trackers with owners, due dates and an audit trail (seeded from chronologies and reviews, exported to Excel and your calendar), and watches on official sources (new EU acts, the Austrian federal gazette, any RSS feed or public page) that alert you when something relevant appears.
- **Decision models:** any endpoint that speaks the System One API (Kev, your own model, or Jev under the data policy) answers yes/no, pick-one and score questions with calibrated probabilities.
- **Connectors:** OpenLex is an MCP client (DMS, mail, drives, court portals) and an MCP server (its law search for Claude, Cursor, opencode …).
- **Web, carefully:** official sources first (RIS for Austrian federal law, EUR-Lex data for EU law), plus a browser that uses the lawyer's own sign-ins. OpenLex never sees passwords, and every saved page keeps its provenance.
- **One hub, offline:** the Word add-in and the desktop app share one local engine: the same matters, settings and model, with handoff between them. No network is needed.

## Guides

Start with [Getting started](docs/guides/getting-started.md). All guides: [docs/guides](docs/guides/README.md) (choose your AI, client data rules, Word add-in, desktop app, firm setup, troubleshooting).

## Layout

| Path | What |
|---|---|
| `sidecar/` | The engine: agent loop, providers, data policy, matters, firm library, workflows, MCP, web. Node ≥ 20. |
| `add-in/` | Word task pane and Outlook mail pane (Office.js), both served by the sidecar. Manifests: `manifest.xml` (Word), `outlook-manifest.xml` (Outlook). |
| `desktop/electron/` | Desktop app shell (Electron): local llama.cpp, Qdrant, embeddings, the backend, and the engine. |
| `desktop/client/` | Desktop app UI (React + Vite). |
| `desktop/server-fixes/` | Backend modules overlaid onto the compiled Express server at packaging time (`OPENLEX_SERVER_DIR`). |
| `scripts/` | Packaging, certificates, installers. |

## Quick start (development)

```bash
cd sidecar && npm install && npm start          # engine on https://localhost:18001 (http without a cert)
scripts/gen-cert.sh && scripts/trust-cert-mac.sh  # localhost certificate for Office.js
add-in/sideload-mac.sh                           # load the add-in into Word
```

Outlook: with the engine running, add `add-in/outlook-manifest.xml` via Outlook → Get Add-ins → My add-ins → Add a custom add-in → From file. The pane summarises a message, drafts a reply and files the email into a matter. Filed emails become searchable and are included in that matter's review and chronology.

Desktop app (dev): `cd desktop/client && npm install && npm run dev`, then `cd desktop/electron && npm install && npm run start:dev`.

Pick a model in **Settings → Model**. Cloud models also need **Settings → Data policy** to allow them.

### Use OpenLex law search from another MCP client

```json
{ "mcpServers": { "openlex": { "command": "node", "args": ["/path/to/openlex/sidecar/src/mcp/server.js"] } } }
```

The firm library is **not** exposed over MCP unless `~/.lexvault/mcp-expose.json` contains `{ "firmLibrary": true }`. MCP clients usually forward tool results to a cloud model.

## Command line

```bash
cd sidecar && npm link        # installs `openlex`
openlex status
openlex use anthropic                     # or: use local · use openrouter:qwen/qwen3.5-9b · use azure --base-url …
openlex key anthropic                     # your own API key, stored in the OS keychain
openlex policy allow anthropic --regions eu --redact   # where client data may go (default: nowhere)
openlex ask "Is the liability cap enforceable under Austrian law?" --file contract.docx
openlex review --matter <id>              # checklist over the matter's documents
openlex translate contract.docx --to en   # Word translation + review table + checks
openlex compare v1.docx v2.docx           # redline and materiality
openlex clauses --type liability          # the firm's own clauses
```

The CLI talks to the same running engine as Word and the app. For your own integrations, see [docs/LOCAL_API.md](docs/LOCAL_API.md).

## Data on disk

Everything lives under `~/.lexvault` (the name is kept for compatibility with existing installs): `providers.json`, `policy.json`, `matters.json`, `library.json`, `mcp-servers.json`, `audit/llm-calls.jsonl`, `run/` (hub registry and token, 0600), `browser-profile/`. API keys are kept in the OS keychain, not in these files.

## Tests

```bash
cd sidecar && npm test                                    # engine (offline)
OPENLEX_TEST_NETWORK=1 node --test test/web.test.js       # + live RIS and browser
node --test desktop/electron/test/                        # app ↔ Word hub, engine bootstrap
```

## Community build and distributions

The code here has no built-in server: it is the **community build**. There is no licence check and no update feed. Use your own model keys or a local model, and add law packs and models locally.

A company that distributes OpenLex (with its own licences, updates, law packs and models) ships a `distribution.json` next to the engine. See `distribution.example.json` for the format, and `sidecar/src/distribution.js` for where it is looked up. Build scripts take the path from `OPENLEX_DISTRIBUTION`; the file itself never belongs in this repository.

## Licence

Apache-2.0. See [LICENSE](LICENSE). Jurisdiction data packs and model weights are distributed separately under their own terms.
