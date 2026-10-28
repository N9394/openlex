# Troubleshooting

**"OpenLex engine is not running"**
Open Word with the add-in, start the desktop app, or run `openlex serve` in a terminal.

**"Blocked by data policy"**
Your rules don't allow this model for this matter. That is working as intended. Allow it with `openlex policy allow <name>` (add `--matter <id>` for one matter), or use a local model. See [Client data rules](client-data-rules.md).

**"no API key set"**
Run `openlex key <provider>` and paste the key. Check it with `openlex test`.

**"has no pinned region; the policy only allows eu"**
You allowed only EU regions, but this service has no fixed region. Choose an EU service (Mistral, or Azure, Bedrock or Vertex in an EU region), or remove `--regions eu`.

**The local model is slow or doesn't answer**
Check `openlex status`. On computers with less than 16 GB of memory, use a cloud key instead. See [hardware](desktop-app.md#hardware-for-local-models).

**The Word button is missing**
Restart Word. Then look under **Insert → My Add-ins**. See [Word add-in](word-add-in.md).

**Where are the logs?**
The engine's log goes to the terminal where `openlex serve` runs, or to the app's log folder. The record of which calls were made is in `~/.lexvault/audit/llm-calls.jsonl`.

**Still stuck?**
Open an issue on [GitHub](https://github.com/N9394/openlex/issues). For a firm-wide setup, [we can help for a fee](https://openlex.pinemarshlands.com/#services).
