# The OpenLex harness map (`openlex.json`)

OpenLex is built for legal work, but every turn of the harness is yours to change: which model does what, what gets checked where, which agent profiles exist, which features are on. All of it lives in one JSON file, in layers:

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

## `features`

Switch whole features on or off for everyone (firm layer) or yourself:

```json
{ "features": { "browser": false, "monitors": true, "skillSuggestions": true } }
```

## Coming next

`hooks` (checks and actions at each decision point) and `agents` (named agent profiles) use the same file.
