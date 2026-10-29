# Law sources

OpenLex connects you to the places where the law is published, and to services you already pay for, instead of keeping its own law database up to date. It tells you exactly where each passage came from.

Type **`/sources`** in the terminal app (or `openlex sources` on the command line, or Settings → Where OpenLex looks up the law) to see the list in plain words:

```
RIS Austria: connected, free
EUR-Lex: connected, free
German federal law (NeuRIS): connected, free (test phase)
Slov-Lex Slovakia: connected, free
e-Sbírka Czechia: connected, free
Ansvar: paste your key
```

Choose a source to switch it off or on, or to paste a key. Every answer that uses a source shows the citation, the web address, the day it was looked up and the licence.

## The sources

| Source | What it is | Licence | Key |
|---|---|---|---|
| **RIS Austria** | Austria's official federal law database (Rechtsinformationssystem des Bundes): current consolidated federal law, with in-force dates. | Open government data, [CC BY 4.0](https://www.data.gv.at/katalog/dataset/ris-bundesrecht-konsolidiert) | none, free |
| **EUR-Lex** | EU law from the EU Publications Office: regulations, directives, decisions, in-force status, consolidated versions. Find an act by number ("2016/679"), name ("GDPR") or title words. | © European Union, free reuse with attribution ([Decision 2011/833/EU](https://eur-lex.europa.eu/content/legal-notice/legal-notice.html)) | none, free |
| **German federal law (NeuRIS)** | Federal statutes and regulations from the federal government's new legal information portal ([rechtsinformationen.bund.de](https://docs.rechtsinformationen.bund.de/)). Still a public test service: coverage may be incomplete and may change. | Official works, no copyright (§ 5 UrhG) | none, free |
| **Slov-Lex Slovakia** | Slovak law from the Ministry of Justice's portal, current consolidated version. Looked up by the number of the law ("513/1991") or its common name ("Obchodný zákonník"); Slov-Lex has no public full-text search. | Official works, no copyright (§ 5 of Act 185/2015 Z. z.) | none, free |
| **e-Sbírka Czechia** | The Czech state's electronic Collection of Laws: full-text search and the current consolidated text. | Official works, no copyright (§ 3 of Act 121/2000 Sb.) | none needed; optional free key from the Digital and Information Agency for the registered API |
| **Ansvar** | A paid law-research service by Ansvar Systems (Sweden): national law of many countries, EU law and guidance, each answer with its source. EU-hosted. | Your own Ansvar subscription; Ansvar's [terms](https://ansvar.eu/terms) apply | your own key |

Official sources are switched on from the start. They are only used when your client-data rule allows online look-ups (below).

## Adding a key

- **Ansvar.** Ansvar's Premium plan and the plans above it can create a *service credential* in the Ansvar workspace. Paste it as `client-id:client-secret` in `/sources` → Ansvar → Paste your key (or `openlex sources key ansvar`). Each lawyer uses their own credential: Ansvar counts a credential as a seat, and its terms forbid sharing or reselling access. Ansvar's free and Solo plans sign in through the browser instead; OpenLex does not support that sign-in yet.
- **e-Sbírka (optional).** With a key for the registered e-Sbírka API: `openlex sources key esbirka`. Without one, OpenLex uses the public e-Sbírka service.

Keys are kept in this computer's keychain (macOS Keychain, Windows DPAPI, Linux Secret Service), never in a file, and only sent to the service they belong to.

## What leaves this computer

- Only the **search words** (or the number of the law) go to the source, never your document.
- **Client-data rule.** Official sources count as online look-ups: they are used only when the matter's rule allows `web`. A paid service is a third party of its own and needs `source:ansvar` as well. Privileged matters never go online. In `/sources`, "Allow online look-ups" adds `web` to the rule; on the command line, `openlex policy allow web,<your AI service>`.
- **Your firm's rules** apply: a firm can switch a source off for everyone and lock the list (`openlex.json`, `"lock": ["sources"]`), deny it in the permissions (`search_law_sources:ansvar`), or block a host with a `before_web` hook.
- OpenLex asks before it uses a paid service; official sources are read-only and need no asking.
- Every look-up is logged (source, time, number of results), never the search words.
- If a source is down or there is no connection, OpenLex says so in one sentence and answers with what it has.

## Your firm's subscriptions (ASPI, Codexis, beck-online, RDB …)

OpenLex does not log into or scrape paid legal databases. When a publisher offers an official API or MCP connector, add it as a firm source (below: `http` or `mcp`), with the firm's own credentials, under its agreement with the publisher. A ready-made connector for these databases is not part of OpenLex yet.

## For the person who sets up OpenLex

The law sources are switched in the `sources` section of `openlex.json` by id (`ris`, `eurlex`, `neuris`, `slovlex`, `esbirka`, `ansvar`):

```json
{ "sources": { "neuris": { "type": "connector", "enabled": false } }, "lock": ["sources"] }
```

The agent uses them through `search_law_sources` and `get_law_source`; the local API has `/api/sources/law` (see [LOCAL_API.md](LOCAL_API.md)). Command line: `openlex sources on|off <id>`, `openlex sources test <id>`, `openlex sources search "Gewährleistung" --law --jurisdiction AT`.

# Data sources: plug in your firm's data and subscriptions

Law firms already have data: a knowledge base, a DMS, precedent folders, internal databases, and subscriptions to legal databases and commentaries. OpenLex searches them as **sources**, next to its law packs and the law sources above, without code.

Sources live in the `sources` section of `openlex.json` (firm layer in the workspace, or your own layer). The agent finds them with the `search_sources` tool, filtered by kind and jurisdiction, and every result keeps its source and citation, so answers can quote it.

```bash
openlex sources                              # law sources and configured sources
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
