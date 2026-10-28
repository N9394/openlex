# The OpenLex harness map (`openlex.json`)

OpenLex is built for legal work, but every turn of the harness is yours to change: which model does what and how each model is driven, what gets checked where, which agent profiles exist, which features are on. All of it lives in one JSON file, in layers:

| Layer | File | Who |
|---|---|---|
| Built-in defaults | (in the engine) | OpenLex |
| Firm | `<workspace>/openlex.json` | The firm. Keep it under version control like playbooks and skills. |
| User | `~/.lexvault/openlex.json` | Each lawyer. |

Later layers win, section by section. The firm can lock sections so users can't override them:

```json
{ "lock": ["routes"] }
```

Edits apply without a restart. A broken file never stops the engine: that layer is skipped and reported (`openlex map`, `GET /api/harness`).

See the effective map at any time:

```
openlex map [--matter ID]
```

## `routes`: which model handles which role

Every model call has a role:

| Role | Used for |
|---|---|
| `plan` | The agent's first step (which tools, what to read); plan proposals |
| `analyze` | Reading tool results between steps |
| `write` | The final answer and suggestions |
| `judge` | Checking suggestions against sources |
| `extract` | Review, chronology, grid cells, playbook building, change ratings |
| `translate` | Document translation |
| `summarize` | Monitor alert summaries |
| `draft` | Drafting new skills |

A target is `"<provider>"` or `"<provider>:<model>"` (providers: `local`, `anthropic`, `openai`, `azure`, `mistral`, `openrouter`, `bedrock`, `vertex`, `custom`). Keys and endpoints are set as usual in Settings → Model provider.

```json
{
  "routes": {
    "roles": {
      "plan": "anthropic:claude-sonnet-5-5",
      "write": "anthropic:claude-opus-5-5",
      "judge": "local",
      "extract": "mistral",
      "translate": "mistral"
    },
    "rules": [
      { "when": { "privileged": true }, "use": "local" },
      { "when": { "role": "write", "minChars": 60000 }, "use": "vertex:gemini-3-pro" },
      { "when": { "matters": ["m_123"] }, "use": ["azure", "local"] }
    ],
    "fallback": ["local"]
  }
}
```

How a call picks its model:

1. The first rule whose `when` matches. Conditions, all optional and all must match: `role` (one or a list), `matters` (ids), `privileged`, `minChars` / `maxChars` (prompt size), `policy` (`local-only` or `allow-list`).
2. The role's target.
3. The active provider from Settings.
4. The `fallback` list.

The engine tries them in that order. **The data policy always has the last word**: a candidate the matter's policy doesn't allow is skipped (and audited), never called. A missing key, a network error, a rate limit or a 5xx also moves on to the next candidate, but only before any text was shown to the lawyer; OpenLex never switches models in the middle of an answer. The audit log records the role and which route was taken.

With no `routes` section, every call goes to the active provider, as before.

## `models`: model profiles

OpenLex works with any model. It doesn't check model names in code; a **profile** says how to drive each model. The first profile whose `match` patterns fit the model name (case-insensitive regular expressions) and whose `kind` fits the provider is used. Otherwise the generic local or generic hosted profile applies.

| Field | Values | What it changes |
|---|---|---|
| `kind` | `local`, `hosted`, `any` | Which providers the profile applies to. |
| `match` | list of patterns | Model names it applies to (required for a new profile). |
| `thinking` | `native`, `inline`, `off` | `native`: the model thinks in its own trace when a step asks for it. `inline`: no native thinking, a one-line `reasoning` field in each tool call instead. `off`: never think. |
| `tools` | `native`, `json` | The provider's tool-calling API, or the text-JSON tool protocol (for models with weak tool calling). |
| `temperature` | 0–2 or `null` | `null` never sends one (for models that reject it). |
| `ctx` | tokens | Context window to budget against (caps the depth preset). |
| `maxOutput` | tokens | Cap on output tokens per call. |
| `thinkingBudget` | tokens | Local only: llama.cpp `--reasoning-budget`. |
| `instructions` | text | Extra lines added to the system prompt for this model. |

Built-ins: `lotus-2`, `lotus`, `qwen3-local`, `openai-reasoning`, `claude`, `deepseek-reasoner`, `small-hosted`. A map entry with a built-in's name changes only the fields you give; a new name adds a profile that is tried before the built-ins:

```json
{
  "models": {
    "lotus-2": { "thinkingBudget": 200 },
    "firm-gateway": { "kind": "hosted", "match": ["^firm/"], "tools": "json", "ctx": 16000,
                      "instructions": "Answer in German unless asked otherwise." }
  }
}
```

`openlex models` shows the model and profile each role gets, plus all profiles in lookup order. `openlex models <model name> [--local]` shows the profile for one model. API: `GET /api/models`, `GET /api/models?model=NAME&kind=local|hosted`.

## `prompts`: when each instruction reaches the model

Instructions arrive at the turn that needs them, not all up front. Change a block's wording or trigger, add your own, or switch one off. See [PROMPTS.md](PROMPTS.md), and run `openlex prompts "question"` to see what each step gets.

## `sources`

The firm's own databases, DMS, folders and the legal databases it subscribes to, as searchable sources for the agent (`http`, `mcp`, `folder` adapters, no code). See [SOURCES.md](SOURCES.md).

## `features`

Switch whole features on or off for everyone (firm layer) or yourself:

```json
{ "features": { "browser": false, "monitors": true, "skillSuggestions": true } }
```

`shell` (the agent's `run_bash` tool) is **off by default**. When a firm turns it on, it is still limited to read/organise commands (`ls`, `find`, `grep`, `cat`, `head`, `tail`, `wc`, `sort`, `diff`, `stat`, `tree`, `du`, `mkdir`, `cp`/`mv` without overwriting, read-only `git`). Nothing that runs code, reaches the network or deletes is ever available. Every path must stay inside the workspace (symlinks resolved). Commands get no environment secrets and run inside the OS sandbox (macOS Seatbelt, Linux bubblewrap): writes only in the workspace, no reads in the home folder, no network. Without an OS sandbox it stays off unless `"shellWithoutSandbox": true`.

The agent's file tools never write `openlex.json`, `skills/`, `playbooks/` or `.openlex/`, and every overwrite keeps the previous version in `.openlex/history/` (20 per file).

## `hooks`: firm rules at each decision point

| Decision point | Fires | Carries | What a hook can do |
|---|---|---|---|
| `before_model` | before each model is tried | `role, provider, model, local, chars, privileged` | `deny`: that model is skipped and the route moves on |
| `before_tool` | before the agent runs a tool | `tool, args` | `deny`: the agent is told the tool is blocked |
| `after_tool` | after a tool ran | `tool, args, ok, chars` | observe (commands, audit) |
| `before_answer` | before the answer is final | `text` | `warn`: a note under the answer; `deny`: the answer is withheld |
| `on_suggestion` | for each suggested change | `text` (proposed), `summary, severity` | `flag`: a note on the card (never auto-applied); `deny`: dropped |
| `before_web` | before any web request, monitors included | `host, url, call` | `deny`: refused |
| `after_workflow` | after review, chronology, translate, compare, grid, plan | `workflow, files, stats` | observe, e.g. file outputs into the DMS |

Every event also carries `matterId`. Three hook types:

**Rules** (the default): conditions plus an action (`allow`, `deny`, `warn`, `flag`). Conditions, all optional and all must match: `tool`, `role`, `provider`, `workflow`, `host` (`*.example.com` globs), `local`, `privileged`, `matters`, `regex` / `notRegex` on the event text (`(?i)` = ignore case), `minChars` / `maxChars`.

**Commands**: a local program that gets the event as JSON on stdin and may print `{"decision": "allow|deny|warn|flag", "message": "…"}`. Exit code 2 means deny. A command that fails or runs past `timeoutMs` (default 10 s) is treated as allowed, unless the hook says `"onError": "deny"`. Commands receive document content: they are programs you configured on your own machine, and OpenLex sends nothing anywhere itself.

**Decide**: asks the decision model (Kev, your own, or Jev under the data policy) a yes/no question about the event text; at or above `threshold` the hook's `action` applies. Skipped when no decision model is configured.

```json
{
  "hooks": {
    "before_tool": [
      { "match": { "tool": ["web_fetch", "web_save"] }, "action": "deny", "reason": "No open-web research on client matters." }
    ],
    "before_answer": [
      { "match": { "notRegex": "§|Art\\.|Article|Section", "minChars": 400 }, "action": "warn", "message": "No legal citation in this answer; verify before use." },
      { "type": "decide", "question": "Does this answer give tax advice?", "threshold": 0.7, "action": "warn", "message": "Tax advice: involve the tax team." }
    ],
    "on_suggestion": [
      { "match": { "regex": "(?i)\\bindemnif" }, "action": "flag", "message": "Indemnity change: partner sign-off." }
    ],
    "before_model": [
      { "match": { "privileged": true, "local": false }, "action": "deny" }
    ],
    "after_workflow": [
      { "type": "command", "command": "python3 /opt/firm/dms_upload.py", "timeoutMs": 30000 }
    ]
  }
}
```

Every deny, warn and flag is written to the audit log (decision point, hook number, action), never the content. Hooks run in order; the first deny wins.

## `permissions`: what the agent may do without asking

Before the agent runs any tool, OpenLex decides whether it may: right away, only after the lawyer says yes, or never. Reading is free; anything that writes, runs, sends data out or uses a connector asks first.

```json
"permissions": {
  "allow": ["write_file", "web_fetch:eur-lex.europa.eu", "mcp:dms:*"],
  "ask":   ["search_ris"],
  "deny":  ["run_bash"],
  "matters": { "m_8f2c": { "allow": ["write_file:Acme/**"] } }
}
```

**Order: deny wins.** For each tool call:

1. a `deny` rule (firm or user) matches → refused, nobody is asked;
2. a firm `ask` rule matches → asked, and "Always allow" is not offered (the firm wants a yes every time);
3. an `allow` rule matches (firm, user, or this matter's `matters.<id>.allow`) → allowed;
4. a user `ask` rule matches → asked;
5. otherwise the built-in default below.

Both layers are read separately: a user's own `allow` never removes a firm `deny`. The firm can `"lock": ["permissions"]`; then only the firm's rules count, including per-matter answers, and the apps stop offering "Always allow".

**Patterns.** A tool name (`*` and `?` work: `export_*`), optionally followed by `:` and what the call touches:

| Tool | After the `:` | Example |
|---|---|---|
| File tools (`write_file`, `append_file`, `read_file`, `list_directory`, `export_document`, …) | Path in the workspace; `*` stays inside a folder, `**` crosses folders | `write_file:Acme/**` |
| Web tools (`web_fetch`, `web_save`, `download_to_matter`) | Host; `*.europa.eu` includes `europa.eu` | `web_fetch:*.europa.eu` |
| `run_bash` | The command; `git *` also covers a bare `git` | `run_bash:git *` |
| `search_sources` | Source names, comma-separated | `search_sources:beck,juris` |
| Connector tools | `mcp:server:tool`; `mcp:*` is every connector | `mcp:dms:*` |

**Built-in defaults.**

| Default | Tools | Why |
|---|---|---|
| allow | `get_document_map`, `get_range_text`, `get_clause_analysis`, `remember`, `recall`, `risk_scorecard`, `run_playbook` | Reading the open document and the agent's own notes. |
| allow | `propose_suggestions` | Each proposed change is a card the lawyer accepts or rejects. |
| allow | `search_law`, `get_law_section`, `search_ris`, `search_eurlex`, `get_eu_law` | The law: local packs and the official sources, read-only. Their web access still follows the data policy. |
| allow | `search_firm_library`, `find_clause` | The firm's own knowledge, indexed on this computer. |
| allow | `read_file`, `list_directory`, `search_local_files`, `search_docs` | Reading the workspace folder (never outside it). |
| allow | `get_tool_schemas`, `tool_picker`, `compress_context`, `delegate_task` | Housekeeping. `delegate_task` is a fresh model call without tools. |
| allow / ask | `search_sources` | Allowed when every source searched is on this computer or the firm network; asked when the query goes outside. |
| ask | `write_file`, `append_file`, `export_document` | Writes a file. |
| ask | `sync_calendar` | Changes the lawyer's calendar. |
| ask | `run_bash` | Runs a command (also needs `features.shell`, off by default). |
| ask | `web_fetch`, `web_save`, `download_to_matter` | Opens the web with the lawyer's saved logins. |
| ask | every connector tool (`mcp__…`), any tool not listed | Unknown effects. |

**Asking.** The front end that started the run gets a `permission` event and the engine waits for the answer: *Allow once*, *Always allow (this matter)*, *Always allow*, or *Don't allow*. "Always" answers are saved to your layer (`permissions.allow`, or `permissions.matters.<id>.allow` for one matter), as narrow as is still useful: the host for web tools, `server:tool` for connectors, the program for commands, the tool for file writes. No answer within 5 minutes (`OPENLEX_PERMISSION_TIMEOUT_MS`), a closed window, or a caller that cannot answer (a script, `openlex ask --json` or piped, the MCP server, scheduled monitors) means **no**. A refused call reaches the model as a tool error ("The lawyer declined: …"), so the agent continues and says what it could not do. Every decision is audited (tool, decision, who decided; never arguments or content).

Change the rules with `openlex permissions allow|ask|deny PATTERN [--matter ID]`, `openlex permissions remove PATTERN`, the terminal app (Settings → *What OpenLex may do without asking*, or `/permissions` in a chat), or `openlex map set permissions FILE.json`.

## `agents`: named profiles

A profile is a way of working: extra instructions, the tools it may use, its own model routes and a depth budget. Use one with `@name` at the start of a message (Word, CLI) or, without the "@" (hard to type on German and Austrian keyboards), `as researcher: …` (also `als …:`, matched against the profile name or title), `agent` in `/api/chat`, or set it as a matter's default (`matter.agent`). Profiles combine with skills: `@drafter /rebalance-clause make §7 fairer`.

Built in: `@associate` (the default), `@researcher` (statute and EU law memo, no document edits, deep budget), `@reviewer` (risk review with anchored fixes), `@drafter` (firm wording first). The firm and user layers add profiles or change these by name:

```json
{
  "agents": {
    "tax-desk": {
      "title": "Tax desk",
      "description": "Austrian tax questions only.",
      "instructions": "Answer for Austrian tax law only. Search the EStG, UStG and BAO before answering…",
      "tools": ["search_law", "get_law_section", "search_ris"],
      "routes": { "write": "anthropic:claude-opus-5-5", "plan": "local" },
      "depth": "deep",
      "skills": ["research-memo"]
    },
    "drafter": { "routes": { "write": "custom" } }
  }
}
```

- `instructions` go after OpenLex's legal rules (sources, citations, verbatim anchors), which always stay.
- `tools` is an allow-list; with a skill active, only tools both allow can run. Reading the document, notes and proposing changes are always allowed.
- `routes` apply before the routing map's role routes. The firm's routing rules and the data policy still come first.
- `depth`: `fast`, `balanced`, `deep` or `ultra` (tool hops and context budget).

`openlex agents` lists them; `openlex map` shows the effective map including profiles and hooks.

## Seeing and changing the map

The map is part of the open-source engine and is read and changed as files, from the command line or over the local API; the apps don't carry a settings screen for it.

- `openlex map [--matter ID] [--agent NAME]` prints, per role, the models tried in order (struck ones are skipped by the matter's data policy, with the reason), the agent profiles, the hooks per decision point, the permission rules, the features, and any problems in the files.
- `openlex map set <section> <file.json>` validates a section and writes it to **your** layer (`~/.lexvault/openlex.json`); `openlex map set <section> --clear` removes it. Sections the firm locked are refused.
- The firm layer is the plain file `<workspace>/openlex.json`; edit and version it like playbooks and skills.
- API: `GET /api/harness?matterId=&agent=` (effective map, candidates, your raw layer, problems) and `POST /api/harness/section { section, value }`.
