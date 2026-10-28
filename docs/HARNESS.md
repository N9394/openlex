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

- `openlex map [--matter ID] [--agent NAME]` prints, per role, the models tried in order (struck ones are skipped by the matter's data policy, with the reason), the agent profiles, the hooks per decision point, the features, and any problems in the files.
- `openlex map set <section> <file.json>` validates a section and writes it to **your** layer (`~/.lexvault/openlex.json`); `openlex map set <section> --clear` removes it. Sections the firm locked are refused.
- The firm layer is the plain file `<workspace>/openlex.json`; edit and version it like playbooks and skills.
- API: `GET /api/harness?matterId=&agent=` (effective map, candidates, your raw layer, problems) and `POST /api/harness/section { section, value }`.
