# Data sources: plug in your firm's data and subscriptions

Law firms already have data: a knowledge base, a DMS, precedent folders, internal databases, and subscriptions to legal databases and commentaries. OpenLex searches them as **sources**, next to its law packs and the official sources (EUR-Lex, RIS), without code.

Sources live in the `sources` section of `openlex.json` (firm layer in the workspace, or your own layer). The agent finds them with the `search_sources` tool, filtered by kind and jurisdiction, and every result keeps its source and citation, so answers can quote it.

```bash
openlex sources                              # configured sources and presets
openlex sources add openlegaldata            # a ready-made preset
openlex sources add firm-kb --file kb.json   # your own definition
openlex sources key firm-kb <token>          # credentials go to the OS keychain
openlex sources test firm-kb
openlex sources search "Vertragsstrafe" --kind caselaw
```

## Three kinds of adapter

### `http`: any search API

```json
{
  "sources": {
    "firm-kb": {
      "type": "http",
      "kind": "firm",
      "title": "Firm knowledge base",
      "url": "https://kb.firm.example/api/search?q={query}&jurisdiction={jurisdiction}",
      "auth": { "header": "Authorization", "prefix": "Bearer " },
      "results": "data.hits",
      "fields": {
        "id": "ref",
        "title": "heading",
        "text": "body",
        "citation": "{ref} ({meta.updated})",
        "url": "link",
        "date": "meta.updated"
      },
      "jurisdictions": ["AT", "DE"]
    }
  }
}
```

- Placeholders: `{query}`, `{jurisdiction}`, `{lang}`, `{limit}` in the `url`, or in a JSON `body` (then the request is a POST).
- `results` is the dotted path to the list of hits; each `fields` entry is a dotted path (`snippets.0.text`) or a template (`"{court} {date}"`).
- `auth`: the key is read from the OS keychain (`openlex sources key <name> <key>`), never from the file.
- A source on this machine or the local network counts as local; anything else is remote.

### `mcp`: a connector

Any tool of a connected MCP server: a publisher's connector, a DMS (iManage, NetDocuments, SharePoint), a database server.

```json
{ "commentary": { "type": "mcp", "kind": "commentary", "tool": "mcp__beck__search", "args": { "q": "{query}" }, "results": "items", "fields": { "title": "t", "text": "excerpt", "citation": "cite" }, "jurisdictions": ["DE"] } }
```

JSON output is mapped like `http`; plain-text output becomes one result.

### `folder`: documents on disk

```json
{ "precedents": { "type": "folder", "kind": "firm", "path": "~/Firm/Precedents" } }
```

The folder is indexed into the local firm library (.docx, PDF with on-device OCR, text) and searched there. Nothing leaves the machine.

## Kinds

`law`, `caselaw`, `commentary`, `firm`, `other`. The agent asks for a kind ("what does the commentary say", "our own position") and a jurisdiction; sources outside that kind or jurisdiction are not queried.

## Rules that always apply

- **Data policy:** a remote source is only queried if the matter's policy allows `source:<name>` (MCP sources: the MCP server). Local sources and folders need nothing. Privileged matters stay local.
- **Firm rules:** `before_web` hooks apply to http sources (e.g. deny a host for certain matters).
- **Audit:** every query is logged with source, timing and result count, never the query text or the results.
- **No private-network pivots:** a remote source's URL must resolve to a public address.

## Presets

| Preset | Kind | What |
|---|---|---|
| `openlegaldata` | caselaw (DE) | German court decisions from [Open Legal Data](https://de.openlegaldata.io), free, no key. |

More presets are added once their responses have been checked against the live service. For a service that needs your own account (for example CourtListener for US case law), add an `http` source with its search URL, map its fields, and store your token with `openlex sources key`.

Commercial legal databases usually allow automated access only through an official API or connector agreed with the publisher. Use those; OpenLex does not scrape them. Pine & Marshlands helps firms set up these connections as a [paid service](https://openlex.pinemarshlands.com/#services).
