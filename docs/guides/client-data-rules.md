# Client data rules

OpenLex decides on every single call whether client text may leave your computer. The rules are yours.

## The default: nothing leaves

Out of the box, only a model on your own computer may receive client text. A cloud model, the web and outside connectors are all blocked until you allow them.

## Allowing a cloud model

For all matters:

```bash
openlex policy allow anthropic
```

For one matter only (the matter's ID is shown in the matter list):

```bash
openlex policy allow azure --matter <matter-id>
```

Back to fully local:

```bash
openlex policy local-only
```

You can allow several at once: `openlex policy allow azure,web`. `web` covers official sources on the internet such as EUR-Lex. `mcp:<name>` covers a connector.

## Extra safeguards

- **EU only:** `--regions eu` allows a cloud model only if it runs in an EU region (Mistral; Azure, Bedrock or Vertex in an EU region). A provider without a fixed region is refused.
- **Hide names before sending:** `--redact` replaces client names, the matter's listed parties, e-mail addresses, IBANs and phone numbers with placeholders before anything is sent. The real names are put back on your computer when the answer arrives.

```bash
openlex policy allow anthropic --regions eu --redact
```

## Privileged matters

A matter marked *privileged* always stays on your computer, whatever else is allowed. OpenLex refuses to open it up to a cloud model. To do that, you would first have to remove the privileged mark, deliberately.

## The audit log

Every model, web and connector call is written to `~/.lexvault/audit/llm-calls.jsonl`. Each entry records which model was used, for which matter, whether the call was allowed, and how long it took. The content itself is never logged. `openlex policy` shows the log's location.

## For firms

The firm can fix rules for everyone and lock them, so a single user can't loosen them. See [Set up OpenLex for your firm](firm-setup.md).
