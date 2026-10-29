# Law sources

OpenLex connects you to the places where the law is published, and to services you already pay for, instead of keeping its own law database up to date. It tells you exactly where each passage came from. It only uses official paths: a published interface or an official edition, never the private service behind a website. Where the official path asks you to register or get a key, OpenLex asks for it too, and this page says how to get it.

Type **`/law`** in the terminal app (or `openlex sources` on the command line, or Settings → Where OpenLex looks up the law) to see the list in plain words:

```
RIS Austria: connected, free (live look-ups only 20:00–05:00 and at weekends; your local copy now)
EUR-Lex: connected, free
German federal law (NeuRIS): connected, free (test phase, licence not yet published)
Slov-Lex Slovakia: connected, free
e-Sbírka Czechia: connected, free
Ansvar: sign in or paste your key: how to get it
```

Choose a source to switch it off or on, to sign in, to paste a key, to see how to get one, or (RIS Austria) to keep a local copy. Every answer that uses a source shows the citation, the web address, the day it was looked up and the licence, and the line "Check the official version before relying on it." A look-up is not legal advice.

## The sources

| Source | What it is | Licence | What you need |
|---|---|---|---|
| **RIS Austria** | Austria's official federal law database (Rechtsinformationssystem des Bundes): current consolidated federal law, with in-force dates. The RIS terms allow live look-ups only 20:00–05:00 Vienna time, at weekends and on Austrian public holidays; at other times OpenLex answers from your local copy and says so ([guide](#ris)). | Open government data, CC BY 4.0 | nothing ([guide](#ris)) |
| **EUR-Lex** | EU law from the EU Publications Office's open data service (Cellar; OpenLex does not use the EUR-Lex website, which blocks programs): regulations, directives, decisions, in-force status, consolidated versions. Find an act by number ("2016/679"), name ("GDPR") or title words. | © European Union, free reuse with attribution ([Decision 2011/833/EU](https://eur-lex.europa.eu/content/legal-notice/legal-notice.html)) | nothing ([guide](#eurlex)) |
| **German federal law (NeuRIS)** | Federal statutes and regulations from the federal government's new legal information portal ([rechtsinformationen.bund.de](https://docs.rechtsinformationen.bund.de/)). Still a public test service: coverage may be incomplete and may change, and a licence for the portal's data has not been published yet, so OpenLex labels it "(test phase, licence not yet published)". | Statutes are official works, no copyright (§ 5 UrhG) | nothing ([guide](#neuris)) |
| **Slov-Lex Slovakia** | Slovak law from the Ministry of Justice's portal, current consolidated version. Looked up by the number of the law ("513/1991") or its common name ("Obchodný zákonník"); Slov-Lex has no public full-text search. | Official works, no copyright (§ 5 of Act 185/2015 Z. z.) | nothing ([guide](#slovlex)) |
| **e-Sbírka Czechia** | The Czech state's electronic Collection of Laws, from its official open data (CC0): look-up by number, full-text search and the consolidated text in force. With your own free key, OpenLex uses the official REST API and its relevance search instead. | Official works, no copyright (§ 3 of Act 121/2000 Sb.); open data CC0 | nothing; optional free key ([guide](#esbirka)) |
| **Ansvar** | A paid law-research service by Ansvar Systems (Sweden): national law of many countries, EU law and guidance, each answer with its source. EU-hosted. | Your own Ansvar account; Ansvar's [terms](https://ansvar.eu/terms) apply | your Ansvar account: sign in, or a service credential ([guide](#ansvar)) |

All sources except Ansvar are switched on from the start. They are only used when your client-data rule allows online look-ups (below).

## Getting access, source by source

Keys and sign-ins are kept in this computer's keychain (macOS Keychain, Windows DPAPI, Linux Secret Service), never in a file, and only sent to the service they belong to.

<a id="ris"></a>
### RIS Austria

Nothing to register. OpenLex uses the Federal Chancellery's open-data interface for the RIS (data.bka.gv.at), which is free and needs no key. Time: none. Cost: none.

The [RIS open-data terms](https://data.bka.gv.at/ris/api/v2.6/) are binding for every application, and OpenLex keeps to them:

- **At most one request every two seconds, never two at once.** OpenLex sends every RIS request through one queue.
- **Live look-ups only outside office hours:** 20:00–05:00 Vienna time, at weekends and on Austrian public holidays. At other times OpenLex does not contact RIS. It answers from your local copy (what you looked up live before) and says "RIS only allows live lookups 20:00–05:00 and on weekends; using your local copy from 2026-10-31" (the day of the copy). If there is no copy, it says so in one sentence.
- **Keep a local copy (optional):** `/law` → RIS Austria → Keep a local copy, or `openlex sources nightcopy ris on`. OpenLex then fetches what you asked for during the day, and refreshes copies older than a week, in the next allowed hours: at most 60 requests a night, single look-ups, not a mass download. The copy stays on this computer.
- **A full mirror** of RIS for your firm is a mass download: the terms ask you to announce it first to ris.it@bka.gv.at (purpose, the program's name and contact address, the IP addresses, and when it runs).

Setting this up for your firm? We do it as part of support: https://calendly.com/nicolas-jansa

<a id="eurlex"></a>
### EUR-Lex

Nothing to register. OpenLex uses the EU Publications Office's open data service (Cellar: SPARQL and REST), which is free and needs no key. It does not read the EUR-Lex website, which blocks programs. (EUR-Lex also has a SOAP web service that needs an EU Login and a request form; OpenLex does not need it.) Time: none. Cost: none.

Setting this up for your firm? We do it as part of support: https://calendly.com/nicolas-jansa

<a id="neuris"></a>
### German federal law (NeuRIS)

Nothing to register. OpenLex uses the documented interface of the federal government's new legal information portal (no key; at most 600 requests a minute). It is still in its public test phase and has not published a licence for its data yet, so OpenLex labels it "(test phase, licence not yet published)": check important passages on [gesetze-im-internet.de](https://www.gesetze-im-internet.de) as well. OpenLex reads statutes only; court decisions (now at `/v1/rechtsprechung`) are not used yet. Time: none. Cost: none.

Setting this up for your firm? We do it as part of support: https://calendly.com/nicolas-jansa

<a id="slovlex"></a>
### Slov-Lex Slovakia

Nothing to register. OpenLex reads the Ministry of Justice's official static edition of Slov-Lex, which is free and needs no key. Time: none. Cost: none.

Slovak court decisions (the Ministry of Justice's open interface): coming once the ministry confirms the terms for reuse.

Setting this up for your firm? We do it as part of support: https://calendly.com/nicolas-jansa

<a id="esbirka"></a>
### e-Sbírka Czechia: works without a key; your free key is an upgrade

Nothing to register to start. OpenLex uses the state's official open data for e-Sbírka (published under CC0 at [opendata.eselpoint.cz](https://opendata.eselpoint.cz/datove-sady-esbirka/)): a law by its number, full-text search over the versions in force, and the text of a law or one § of it. It does not use the service behind the e-Sbírka website.

With your own free key, OpenLex uses the official e-Sbírka REST API instead, with the state's own relevance search. The key comes from the **Ministry of the Interior**. Time: about 15 minutes to fill in the form, then up to 10 working days for the answer. Cost: none.

1. **You need a data box** (datová schránka). Every Czech advokát has one.
2. **Get the form** "Žádost o registraci klienta veřejného REST API e-Sbírky" ([Zadost o registraci klienta.pdf](https://opendata.eselpoint.cz/dokumentace/Zadost%20o%20registraci%20klienta.pdf); e-Sbírka's page for software makers: [e-sbirka.gov.cz/restful-api](https://e-sbirka.gov.cz/restful-api)).
3. **Fill it in.** Name, e-mail and your data box ID. For the reason: that you look up Czech law for your legal work with OpenLex, an application on your own computer. For the data: laws and their current consolidated text, and full-text search. For the capacity, a single lawyer's use is small, for example: at most 2 requests a second, 1 connection at a time, during office hours, about 200 calls a day, peaks during the working day.
4. **Send it from your data box** to the Ministry of the Interior's data box `6bnaawp`, with the subject the form names (at the time of writing: "eSbírka – registrace REST API").
5. **The answer comes by data box** within 10 working days: a letter with the conditions of use and your access key.
6. **Add the key:** `/law` → e-Sbírka Czechia → Add your free key, or `openlex sources key esbirka`. Keep to the conditions in the letter (for example, the number of requests).

Setting this up for your firm? We do it as part of support: https://calendly.com/nicolas-jansa

<a id="ansvar"></a>
### Ansvar: sign in, or a service credential

Ansvar is a paid service with its own plans (see [ansvar.eu](https://ansvar.eu)); you need your own Ansvar account. Each lawyer uses their own: Ansvar counts a credential as a seat, and its terms forbid sharing or reselling access. Time: a few minutes. Cost: your Ansvar plan.

**Any plan, including the free and Solo plans: sign in with your browser.**

1. Create your account on [ansvar.eu](https://ansvar.eu) if you do not have one.
2. `/law` → Ansvar → Sign in with your browser (or `openlex sources signin ansvar`).
3. Ansvar's sign-in page opens. Type the code OpenLex shows, sign in, and allow access.
4. Back in OpenLex, Ansvar shows "connected, signed in". OpenLex renews the sign-in by itself; when Ansvar ends it, OpenLex says "sign in again".

If OpenLex says "Ansvar's browser sign-in is not available for OpenLex yet", Ansvar has not opened its sign-in to OpenLex; use a service credential, or ask Ansvar.

**Premium plan and above: a service credential.**

1. In your Ansvar workspace, create a *service credential*.
2. Paste it as `client-id:client-secret` in `/law` → Ansvar → Paste a service credential (or `openlex sources key ansvar`).

Setting this up for your firm? We do it as part of support: https://calendly.com/nicolas-jansa

## What leaves this computer

- Only the **search words** (or the number of the law) go to the source, never your document.
- **Client-data rule.** Official sources count as online look-ups: they are used only when the matter's rule allows `web`. A paid service is a third party of its own and needs `source:ansvar` as well. Privileged matters never go online. In `/law`, "Allow online look-ups" adds `web` to the rule; on the command line, `openlex policy allow web,<your AI service>`.
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

The agent uses them through `search_law_sources` and `get_law_source`; the local API has `/api/sources/law` and `/api/sources/law/signin` (see [LOCAL_API.md](LOCAL_API.md)). Command line: `openlex sources on|off <id>`, `openlex sources key <id>`, `openlex sources signin ansvar`, `openlex sources test <id>`, `openlex sources search "Gewährleistung" --law --jurisdiction AT`.

Ansvar's sign-in uses OAuth 2.1 against Ansvar's own sign-in server, found from the gateway's published metadata: OpenLex registers itself as a public client (no secret), uses a device code (or a browser redirect to this computer with PKCE when device codes are refused), and keeps the tokens in the keychain. A firm that has been given a client id by Ansvar can set it with the environment variable `OPENLEX_ANSVAR_CLIENT_ID`; OpenLex then does not register itself.

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
