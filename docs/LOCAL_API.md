# OpenLex local API

The OpenLex engine is one local process that every front end shares: the Word add-in, the Outlook add-in, the desktop app and the `openlex` CLI. They all see the same matters, data policy, model provider, firm library, clause library and audit log. Nothing here needs a network connection, except calls the data policy allows (cloud models, web sources).

This page documents the API for people building their own integrations, such as a DMS plug-in, a script or another editor.

## Finding the engine

The engine writes `~/.lexvault/run/sidecar.json` while it runs (mode 0600, removed on exit):

```json
{ "url": "https://127.0.0.1:18001", "version": "0.2.0", "ca": "/Users/me/.lexvault/certs/cert.pem", "pid": 4242, "startedAt": "…" }
```

- `url` is HTTPS when the localhost certificate exists (Office.js needs it) and HTTP otherwise.
- `ca` is the certificate to trust for that URL. Pass it as the CA, and don't disable verification.
- If `pid` is no longer running, the file is stale.

To start the engine yourself, run `openlex serve` or `npm start` in `sidecar/`. The desktop app starts it automatically when Word isn't already running it.

## Access rules

- **Same machine only.** The engine binds to 127.0.0.1.
- **No browser pages.** Any request with a foreign `Origin` header is refused (403). Local processes send no `Origin` and are allowed. Extra trusted origins (for example the desktop app's renderer) are listed in `OPENLEX_TRUSTED_ORIGINS`.
- **Hub endpoints** (`/api/hub/*`) also need `Authorization: Bearer <token>`, where the token is the content of `~/.lexvault/run/hub.token` (0600, same OS user). The Word pane is same-origin and doesn't need it.
- **The data policy applies to every route.** Each model, web and connector call is checked against the matter's policy and written to `~/.lexvault/audit/llm-calls.jsonl`, with metadata only and never content.

Pass `matterId` to run a request under a matter's policy. Without it, the default policy applies.

## Streaming responses

Long-running routes answer with Server-Sent Events: `Content-Type: text/event-stream`, one JSON object per `data:` line, and a blank line between events. The last event is always `{"type":"done",…}` or `{"type":"error","message":…}`.

## Endpoints

### Status and setup
| Method | Path | What |
|---|---|---|
| GET | `/health` | Liveness. |
| GET | `/api/status` | Model/provider state: `{ model: { name, provider, local, loaded, error } }`. |
| GET | `/api/setup/status`, `/api/license/status` | First-run and licence state. |

### Asking and drafting
| Method | Path | Body / query | What |
|---|---|---|---|
| POST | `/api/chat` | `{ message, text?, docId, matterId? }` | Runs the agent on a document (`text`) or a free question. SSE events: `step`, `reasoning`, `law` (sources found), `text` (answer, possibly streamed in pieces), `suggestion` (a proposed change: `{ type, severity, summary, anchor, proposed_text, basis }`), `scorecard`, `done`. |
| POST | `/api/session/clear` | `{ docId }` | Forgets the conversation for a document. |
| GET | `/api/law/section` | `?id=` | Full text of a law chunk from the local packs. |

### Matters
| Method | Path | Body / query | What |
|---|---|---|---|
| GET | `/api/matters` | `?all=1`, `?docId=` | List matters, the active one, and the matter bound to a document. |
| POST | `/api/matters` | `{ title, number?, client?, privileged?, redactTerms? }` | Create. Privileged matters are always local-only. |
| POST | `/api/matters/update` | `{ id, patch }` | Rename, close, set redact terms… |
| POST | `/api/matters/bind` | `{ id, docId, title? }` | Bind a document (Word doc, e-mail, file) to a matter. |
| POST | `/api/matters/policy` | `{ id, rule }` | Set the matter's data policy (see below). |

### Data policy and models
| Method | Path | Body | What |
|---|---|---|---|
| GET/POST | `/api/policy` | `{ rule }` | Default policy. A rule is `{ mode: "local-only" }`, or `{ mode: "allow-list", providers: ["anthropic","web","mcp:dms"], redact?: true, regions?: ["eu"] }`. |
| GET | `/api/providers` | | Catalog plus active provider: local, anthropic, openai, azure, mistral, openrouter, bedrock, vertex, custom. |
| POST | `/api/providers` | `{ active?, provider?, overrides? }` | Choose a provider. Overrides can set `baseUrl`, `model`, `ctx`, `region`, `project`, `apiVersion`, `nativeTools`, and `local` (custom only). |
| POST | `/api/providers/key` | `{ provider, key }` (`key: null` removes it) | Stores the key in the OS keychain. Keys are never returned. |
| POST | `/api/providers/test` | `{ provider }` | One tiny call, still subject to the policy. |

### Firm data
| Method | Path | Body / query | What |
|---|---|---|---|
| GET | `/api/library` | | Indexed folders and counts. |
| POST | `/api/library/folders` | `{ path, matterId? }` | Add a folder, firm-wide or for one matter, and index it. |
| POST | `/api/library/folders/remove` | `{ path }` | Remove a folder. |
| POST | `/api/library/sync` | | Re-index now (incremental). |
| GET | `/api/clauses` | `?matterId=&type=&q=` | Clause library: counts per type and the firm's clauses, most-used wording first. |
| POST | `/api/mail/file` | `{ matterId, subject, from, to, date, body }` | File an e-mail into a matter. It becomes searchable and part of the matter's workflows. |

### Workflows
| Method | Path | Body | What |
|---|---|---|---|
| GET | `/api/workflows/playbooks` | | Review checklists: built-in plus `playbooks/*.json` in the workspace. |
| GET | `/api/workflows/documents` | `?matterId=` | Documents in the matter's folders, plus supported translation languages. |
| POST | `/api/workflows/run` | `{ type: "review", matterId, playbook?, folder? }` | Checklist review of every document. A finding is kept only if its quote is verbatim in the document. |
| | | `{ type: "chronology", matterId, folder? }` | Dated events, with each date checked against the quote. |
| | | `{ type: "translate", file, target, glossary?, matterId? }` | Word translation, side-by-side review file, and per-paragraph number and glossary checks. |
| | | `{ type: "compare", fileA, fileB, rate?, matterId? }` | Paragraph and word diff, with changes rated by materiality. |

All workflows stream `progress` events and end with `{ type: "done", files, stats }`. The output files are written to the matter's workspace folder. A `file` can be an absolute path or a file name inside the matter's folders.

### Lists
Checklists and trackers per matter. Every change is written to the list's audit trail (who, when, field, from → to); "who" is the OS user unless `by` is given.
| Method | Path | Body / query | What |
|---|---|---|---|
| GET | `/api/lists` | `?matterId=` | Lists with open and overdue counts. |
| GET | `/api/lists/get` | `?id=` | One list with items and audit trail. Item: `{ id, text, owner, due, status: open\|done\|blocked\|n/a, note, source? }`. |
| GET | `/api/lists/sources` | `?matterId=` | Chronology and review CSVs in the matter folder that can seed a list. |
| POST | `/api/lists` | `{ matterId, title, items? }` | Create. |
| POST | `/api/lists/items`, `/api/lists/items/update`, `/api/lists/items/delete` | `{ id, item }`, `{ id, itemId, patch }`, `{ id, itemId }` | Add, change, remove an item. |
| POST | `/api/lists/seed` | `{ id, file, all? }` | Add items from a chronology CSV (future dates → due items) or a review CSV (high-risk findings; `all` for every finding), with the source document and quote. No duplicates. |
| POST | `/api/lists/export` | `{ id }` | `.xlsx` (items + audit trail), `.csv` and `.ics` (open items with a due date, all-day events). |
| POST | `/api/lists/rename`, `/api/lists/delete` | `{ id, title }`, `{ id }` | |

### Monitors
Watches on official sources: `eurlex` (new EU acts whose title matches `query`), `ris` (new Austrian federal gazette entries), `rss` (any RSS/Atom feed), `page` (a public page; alerts when its text changes). The first check sets the baseline; alerts are only for items that appear afterwards. Topics filter the items (by the decision model when configured, else by words). A check needs "web" allowed by the data policy, and only the monitor's own query or URL leaves the machine. Due monitors are checked every 15 minutes while the engine runs (`OPENLEX_MONITORS=0` turns that off); new alerts are pushed to the hub as `monitor-alert`.
| Method | Path | Body / query | What |
|---|---|---|---|
| GET | `/api/monitors` | `?matterId=` | Monitors with last run and last error. |
| POST | `/api/monitors` | `{ title, matterId, source: { type, query\|url, lang? }, topics?, everyHours?, summarize? }` | Create (at most hourly). |
| POST | `/api/monitors/update`, `/api/monitors/delete` | `{ id, patch }`, `{ id }` | A new source resets the baseline. |
| POST | `/api/monitors/check` | `{ id? }` | Check one now, or every due monitor. |
| GET | `/api/monitors/alerts` | `?matterId=&unread=1` | Alerts, newest first. |
| POST | `/api/monitors/alerts/read`, `/api/monitors/alerts/file` | `{ ids }`, `{ id }` | Mark read; file an alert into its matter folder as a note with its source. |

### Plans
The model proposes a plan for a goal from capabilities OpenLex already has; nothing runs until the lawyer approves. Step kinds: `review`, `chronology`, `grid`, `translate`, `compare`, `research`, `skill`, and `checkpoint` (the run pauses until the lawyer decides). Unusable steps (unknown kind, a document not in the matter, an unknown skill or playbook) are dropped with a note; steps after a checkpoint always wait for it.
| Method | Path | Body / query | What |
|---|---|---|---|
| GET | `/api/plans` | `?matterId=` | List plans. |
| GET | `/api/plans/get` | `?id=` | One plan with its steps (`status`: pending, running, waiting, done, failed, skipped). |
| POST | `/api/plans` | `{ goal, matterId, documents? }` | Propose a plan (status `proposed`). |
| POST | `/api/plans/update` | `{ id, steps?, goal? }` | The lawyer's edits, re-validated. Only before running. |
| POST | `/api/plans/approve` | `{ id }` | Approve. |
| POST | `/api/plans/run` | `{ id }` | SSE. Runs or resumes; independent steps run side by side on hosted models, one at a time locally. Ends with `done` (`status`: done, failed, waiting, paused, stopped; `report` path; the `waiting` checkpoint). |
| POST | `/api/plans/decide` | `{ id, stepId, decision: continue\|stop, note? }` | The lawyer's decision at a checkpoint. `stop` skips the rest and writes the report. |

### Skills
A skill is a `SKILL.md` file (frontmatter `name`, `title`, `description`, `triggers`, optional `tools` allow-list and `output`, then instructions). Bundled starters live in `sidecar/skills/`; the firm's own go in the workspace `skills/<name>/SKILL.md` and replace a bundled one with the same name. In `/api/chat`, a message starting with `/<name>` (or `skill: "<name>"` in the body) runs the agent with that skill: a `skill` event comes first. Without one, a `skill_suggestion` event may propose a match (decision model when configured, else keywords; `suggestSkill: false` turns it off).
| Method | Path | Body / query | What |
|---|---|---|---|
| GET | `/api/skills` | | All skills (bundled + firm; invalid files listed with `error`). |
| GET | `/api/skills/get` | `?name=` | One skill plus its `SKILL.md` text. |
| GET | `/api/skills/suggest` | `?q=` | Best-matching skill for a request, or `null`. |
| POST | `/api/skills` | `{ content }` | Save a firm skill from `SKILL.md` text (validated). |
| POST | `/api/skills/draft` | `{ request, examples?, name? }` | The model drafts a `SKILL.md` from a plain-language request. Never saved automatically. |
| POST | `/api/skills/delete` | `{ name }` | Delete a firm skill (bundled ones can only be overridden). |
| POST | `/api/workflows/playbooks/draft` | `{ files?, matterId?, title, focus? }` | Review checklist from the firm's precedents; a check's firm `standard` is kept only with a verbatim quote from them. |
| POST | `/api/workflows/playbooks` | `{ name, playbook }` | Save a playbook to the workspace `playbooks/` folder. |

### Data sources
The firm's databases and subscriptions as searchable sources (see [SOURCES.md](SOURCES.md)).
| Method | Path | Body | What |
|---|---|---|---|
| GET | `/api/sources` | | Configured sources (type, kind, local/remote, problems) and presets. |
| POST | `/api/sources/search` | `{ query, kind?, jurisdiction?, sources?, matterId? }` | Search allowed sources in parallel → `{ results, searched, skipped }`. |
| POST | `/api/sources/test` | `{ name, query? }` | One quick query. |
| POST | `/api/sources/add`, `/api/sources/remove` | `{ name, source? }`, `{ name }` | Add a preset or definition to your layer; remove it. |
| POST | `/api/sources/key` | `{ name, key }` | Store the source's key in the OS keychain (`null` removes it). |

### Review grid
Rows are documents, columns are questions, and every cell is an answer with a verbatim quote from its document.
| Method | Path | Body / query | What |
|---|---|---|---|
| GET | `/api/grids` | `?matterId=` | List grids. |
| POST | `/api/grids` | `{ matterId, title, columns, documents? }` | Create. Without `documents`, the matter's folders are used. A column is `{ label, prompt, type: text\|yesno\|choice\|date\|number, options?, dependsOn?: [columnId], reference?: file }`. |
| GET | `/api/grids/view` | `?id=` | Rows with cells in column order. A cell is `{ value, quote, location, status, locked? }`; status is `ok`, `unverified` (quote not in the document), `invalid` (doesn't fit the type), `not_found`, `edited` or `error`. |
| POST | `/api/grids/run` | `{ id, documents?, columns?, force? }` | SSE. Fills missing, failed and stale cells (a dependent column is stale when its input changed); `force` recomputes every unlocked cell. Events: `progress` (`step: cell` with the new value, `step: document`), `done` with stats. |
| POST | `/api/grids/cell` | `{ id, document, column, value?, locked? }` | The lawyer's own value (locks the cell), or lock/unlock. |
| POST | `/api/grids/update` | `{ id, patch: { title?, columns?, documents? } }` | Change columns or rows; cells of removed ones are dropped. |
| POST | `/api/grids/export` | `{ id }` | Writes `.xlsx` (grid + sources sheet) and `.csv` to the matter's workspace folder. |
| POST | `/api/grids/delete` | `{ id }` | Delete the grid (documents are not touched). |

### Decision models (Jev / Kev compatible)
Any endpoint that speaks the System One API (`POST {url}/v1/systemone`): a local Kev server, your own decision model, or Jev. It returns typed answers with calibrated probabilities instead of text. An endpoint on this machine or the local network counts as local; anything else needs `decide` on the matter's allow-list (and an approved region when the policy has regions).
| Method | Path | Body | What |
|---|---|---|---|
| GET/POST | `/api/decide/config` | `{ url, model?, region? }` or `{ clear: true }` | Configure the endpoint. Remote endpoints must use https. |
| POST | `/api/decide/key` | `{ key }` | Optional bearer key, stored in the OS keychain. |
| POST | `/api/decide` | `{ state, questions, matterId? }` | `questions: { id: { type: noul\|choice\|score, instructions, criteria } }`. Returns `answers` as the endpoint sent them, plus `summary: { id: { answer, p, confidence } }`. |
| POST | `/api/decide/test` | | One tiny call, still subject to the policy. |

### Connectors (MCP) and web
| Method | Path | Body | What |
|---|---|---|---|
| GET | `/api/mcp` | | Configured MCP servers and their tools. |
| POST | `/api/mcp/servers` | `{ name, config }` | Add or update a server: `{ command, args }` (stdio) or `{ url, remote: true }`. |
| POST | `/api/mcp/servers/remove` | `{ name }` | Remove a server. |
| POST | `/api/web/login` | `{ url }` | Opens a visible browser for the lawyer to sign in. The session is kept and the password never is. |

### Hub (app ↔ Word, needs the hub token)
| Method | Path | What |
|---|---|---|
| GET | `/api/hub/info` | Who is connected. |
| GET | `/api/hub/events?from=myapp` | SSE stream of hub events: `insert-text`, `open-in-app`, `provider-changed`, `policy-changed`, `matter-changed`. |
| POST | `/api/hub/events` | `{ type, data }`. Publish an event, for example `{ "type": "insert-text", "data": { "text": "…" } }` puts text at the cursor in Word. |

### Workspace and packs
`GET /api/workspace`, `POST /api/workspace/reveal`, `POST /api/config/workspace`, `GET /api/packs`, `POST /api/packs/ingest`, `POST /api/packs/delete`, `GET /api/jurisdictions`, and `POST /api/download/{model,pack}` manage the local workspace folder, law packs and model downloads.

## MCP server

`sidecar/src/mcp/server.js` exposes OpenLex law search to MCP clients (Claude, Cursor, opencode …) over stdio. The firm library is exposed only when `~/.lexvault/mcp-expose.json` contains `{ "firmLibrary": true }`. See the README.

## Environment

Every `LEXVAULT_*` variable can also be given as `OPENLEX_*`, for example `OPENLEX_DATA_DIR`. The old names keep working.

| Variable | Effect |
|---|---|
| `LEXVAULT_DATA_DIR` | Data folder (default `~/.lexvault`). |
| `OPENLEX_WORKSPACE` | Default workspace folder (default `~/LexVault`). The Settings choice still wins. |
| `LEXVAULT_SIDECAR_PORT` | Port (default 18001). |
| `OPENLEX_KEY_<PROVIDER>` | API key override, for example `OPENLEX_KEY_ANTHROPIC`. |
| `OPENLEX_TRUSTED_ORIGINS` | Extra allowed `Origin`s, comma-separated. |
| `OPENLEX_OCR=0` / `OPENLEX_OCR_LANGS` | Turns OCR off, or sets the OCR languages. |
| `LEXVAULT_KEEPALIVE=1` | Keeps the engine running when Word and Outlook are closed. |
