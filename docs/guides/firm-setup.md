# Set up OpenLex for your firm

Everything a firm configures lives in plain files. You can version them, review them and roll them out like any other document.

## The firm folder

OpenLex works in a folder per user, `~/LexVault` by default. For a firm, point everyone at a shared or synced folder, and keep these in it:

| In the firm folder | What it does |
|---|---|
| `openlex.json` | The firm's rules: which model does what, firm checks at each step, agent profiles, model profiles, features, data sources ([reference](../HARNESS.md)) |
| `skills/<name>/SKILL.md` | The firm's own reusable instructions, run with `/name` |
| `playbooks/*.json` | Review checklists |
| `precedents/` | Vetted clauses and templates the AI should follow |

Each user's own `~/.lexvault/openlex.json` comes after the firm file and can change what the firm allows. The firm can **lock** sections so users can't change them:

```json
{ "lock": ["routes", "hooks", "models"] }
```

## A typical firm file

```json
{
  "routes": {
    "roles": { "write": "azure", "judge": "local" },
    "rules": [{ "when": { "privileged": true }, "use": "local" }],
    "fallback": ["local"]
  },
  "hooks": {
    "before_answer": [{ "match": { "notRegex": "§|Art\\." }, "action": "warn", "message": "No citation: verify before relying on this." }],
    "on_suggestion": [{ "match": { "regex": "(?i)indemnif" }, "action": "flag", "message": "Indemnities need partner sign-off." }]
  },
  "lock": ["routes", "hooks"]
}
```

Check what is in effect with `openlex map` (add `--matter <id>` to see one matter).

## The firm's own data

- **Precedents and past work:** add folders to the firm library (Word pane or desktop app → Settings → Library). They are indexed on each computer, never uploaded.
- **Your DMS and the databases you subscribe to:** connect them as sources. See [Data sources](../SOURCES.md).

## Rolling out

1. Decide where the AI runs and get the keys or the cloud account ([Choose your AI](choose-your-ai.md)).
2. Write the firm's `openlex.json`, and lock what must not change.
3. Install the Word add-in and/or the desktop app on each machine, or the terminal app for technical staff.
4. Point everyone's workspace at the firm folder.

We offer paid help with all of this, from planning to training. See [setup and data services](https://openlex.pinemarshlands.com/#services).
