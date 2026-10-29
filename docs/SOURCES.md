# Law sources

OpenLex is the harness; you bring the data. OpenLex does not keep its own law database: it connects to free or cheap sources that others maintain (official open-data services, community projects, and services you subscribe to) and tells you exactly where each passage came from. It only uses published interfaces or official editions, never the private service behind a website, and it keeps to each source's terms.

Type **`/law`** in the app or the terminal app (or `openlex sources` on the command line) to see the sources grouped by country, in plain words, in English or German:

```
Ansvar: sign in free or paste your key: how to get it
RIS Austria: connected, free (live look-ups only 20:00–05:00 and at weekends; your local copy now)
EUR-Lex: connected, free
German federal law (NeuRIS): connected, free (test phase, licence not yet published)
Fedlex Switzerland: connected, free
opencaselaw.ch: connected, free (community source)
Légifrance: needs your free PISTE key: how to get it
Hungary: No open source allows automated access here; OpenLex can open pages for you to read (browser)
```

Choose a source to switch it off or on, to sign in, to paste a key, to see how to get one, or to keep it on this computer. Every answer that uses a source shows the citation, the web address, the day it was looked up and the licence, and the line "Check the official version before relying on it." A look-up is not legal advice.

## Online by default; "Work fully offline" when you want it

OpenLex looks things up live, per question: nothing to install, nothing to download. Austria, Germany, the EU and Switzerland work from the start without any action.

**Work fully offline** is one switch in `/law` (or `openlex sources offline on`). It first shows what it would download for your countries and how big it is (for example the German federal laws from gesetze-im-internet.de and a country from Legalize), downloads only after you say yes, keeps the copies in OpenLex's data folder (updated once a day) and from then on answers only from this computer. Without the switch you can also keep a single source on this computer (`/law` → the source → Keep it on this computer). Every copy shows its size and its last update, and can be removed in `/law`. Downloads come from the source itself, never through OpenLex, and keep to the source's rate limits.

## The sources

| Source | What it is | Licence | What you need |
|---|---|---|---|
| **Ansvar** | Law-research service (Ansvar Systems, Sweden): national law of the EU, EEA and EFTA countries, the UK and EU law, each answer with its source. **Suggested first where it covers your country:** free plan, 100 searches a day, one country per question. | Your own Ansvar account; Ansvar's [terms](https://ansvar.eu/terms) | free plan: sign in with your browser ([guide](#ansvar)) |
| **RIS Austria** | Austria's official federal law database (Rechtsinformationssystem des Bundes): current consolidated federal law, with in-force dates. The RIS terms allow live look-ups only 20:00–05:00 Vienna time, at weekends and on Austrian public holidays; at other times OpenLex answers from your local copy and says so ([guide](#ris)). | Open government data, CC BY 4.0 | nothing ([guide](#ris)) |
| **EUR-Lex** | EU law from the EU Publications Office's open data service (Cellar; OpenLex does not use the EUR-Lex website, which blocks programs): regulations, directives, decisions, in-force status, consolidated versions. Find an act by number ("2016/679"), name ("GDPR") or title words. | © European Union, free reuse with attribution ([Decision 2011/833/EU](https://eur-lex.europa.eu/content/legal-notice/legal-notice.html)) | nothing ([guide](#eurlex)) |
| **German federal law (NeuRIS)** | Federal statutes and regulations, and decisions of the federal courts (BVerfG, BGH, BVerwG, BFH, BAG, BSG, BPatG), from the federal government's new legal information portal ([rechtsinformationen.bund.de](https://docs.rechtsinformationen.bund.de/)). Still a public test service: coverage may be incomplete, and no licence for the portal's data has been published yet, so OpenLex labels it "(test phase, licence not yet published)". | Statutes and court decisions are official works, no copyright (§ 5 UrhG) | nothing ([guide](#neuris)) |
| **German federal laws (gesetze-im-internet.de)** | The official consolidated edition of all federal statutes and regulations (about 6,000), current versions, from the Federal Ministry of Justice. Find a law by its abbreviation ("§ 433 BGB") or words of its title. Can also be kept on this computer for the offline mode. | Official works, no copyright (§ 5 UrhG); free use and reuse | nothing ([guide](#gii)) |
| **Open Legal Data (German case law)** | Over 400,000 German court decisions of all levels, federal and Länder, with full-text search. A community project, not a state service ([guide](#openlegaldata)). | Decisions are official works (§ 5 UrhG); the collection is a community project (dumps under ODbL) | nothing; optional free token ([guide](#openlegaldata)) |
| **Slov-Lex Slovakia** | Slovak law from the Ministry of Justice's portal, current consolidated version. Looked up by the number of the law ("513/1991") or its common name ("Obchodný zákonník"); Slov-Lex has no public full-text search. | Official works, no copyright (§ 5 of Act 185/2015 Z. z.) | nothing ([guide](#slovlex)) |
| **e-Sbírka Czechia** | The Czech state's electronic Collection of Laws, from its official open data (CC0): look-up by number, full-text search and the consolidated text in force. With your own free key, OpenLex uses the official REST API and its relevance search instead. | Official works, no copyright (§ 3 of Act 121/2000 Sb.); open data CC0 | nothing; optional free key ([guide](#esbirka)) |
| **Fedlex Switzerland** | Swiss federal law from the Federal Chancellery's official publication platform: the Classified Compilation (SR), the consolidated version in force (or on a past date), in German, French or Italian. Find an act by its SR number ("220", "SR 210") or by words of its title or its abbreviation ("Obligationenrecht", "DSG"); open one article ("Art. 41"). | Federal acts are free of copyright (Art. 5 URG) | nothing ([guide](#fedlex)) |
| **opencaselaw.ch** | Swiss court decisions: the federal courts and all 26 cantons, about a million decisions, updated daily. A community project collects them from the courts' official publications; every result links to the court's own page. Open a decision or one consideration ("E. 2"). | CC0 (the European Court of Human Rights part excepted); decisions are free of copyright (Art. 5 URG) | nothing ([guide](#opencaselaw)) |
| **Legalize (laws of many countries)** | Consolidated statutes of 30+ countries from the volunteer Legalize project (one git repository per country, every reform a dated version: the text on a past date). Community source; freshness shown per country. | Under the official source's terms, as each repository states | your free key (2,000 look-ups a month), or a copy on this computer for offline work ([guide](#legalize)) |
| **legislation.gov.uk** | UK legislation from The National Archives: Acts and statutory instruments of the UK, Scotland, Wales and Northern Ireland, revised with later amendments, and how a section read on a past date. Find an Act by its title, words in the text, or its number ("2018 c. 12", "S.I. 2018/1234"). | Open Government Licence v3.0 | nothing ([guide](#ukleg)) |
| **Find Case Law (UK)** | Judgments and tribunal decisions of the courts of England and Wales and the UK, from The National Archives (2001 onwards). Search by words, or open a judgment by its neutral citation ("[2024] UKSC 12"). | Open Justice Licence (reading and reuse); computational analysis needs TNA's separate free licence | nothing ([guide](#ukcaselaw)) |
| **Dutch law (BWB)** | Dutch national legislation from the Basiswettenbestand (wetten.overheid.nl): the version in force today, found by title, BWBR identifier or "6:162 BW"; one article or the whole law. | CC0 | nothing ([guide](#bwb)) |
| **Dutch case law (rechtspraak.nl)** | Published decisions of Dutch courts from the judiciary's open data, found by ECLI, with the full text. No search by words. | Public Domain Mark | nothing ([guide](#rechtspraak)) |
| **Légifrance** | French codes and consolidated laws, ordinances and decrees from the official Légifrance API of the DILA, in the version in force today (or on a date you name). Find an article by words or as you would cite it ("Art. 1240 C. civ."). | Licence Ouverte 2.0 (Etalab) | your free PISTE key, shared with Judilibre ([guide](#piste)) |
| **Judilibre** | French court decisions from the Cour de cassation's open data: the Cour de cassation, the cours d'appel and, as they are published, the tribunaux judiciaires. Pseudonymised by the court. Open a whole decision or one part of it (dispositif, motivations). | Licence Ouverte 2.0 (Etalab); no profiling of judges (art. L111-13 COJ) | your free PISTE key, shared with Légifrance ([guide](#piste)) |
| **eCFR (US federal regulations)** | The Code of Federal Regulations, updated daily by the Office of the Federal Register, from the official eCFR API. Every section also as it stood on a date you name. | US government work, public domain (17 U.S.C. § 105) | nothing ([guide](#ecfr)) |
| **GovInfo (US Code, laws, federal courts)** | The US Government Publishing Office's official publications: the United States Code, public laws, and opinions of the federal courts. | US government work, public domain (17 U.S.C. § 105) | your free key from api.data.gov ([guide](#govinfo)) |
| **CourtListener (US case law)** | US court decisions, federal and state, collected by the Free Law Project, a non-profit. A community source: kept by a non-profit, not by a court. | Opinions are public domain; the Free Law Project's [terms](https://www.courtlistener.com/terms/) apply | your free CourtListener token ([guide](#courtlistener)) |
| **Sejm ELI (Poland)** | Polish statutes and regulations from the Sejm's official ELI service (Journal of Laws, Monitor Polski): search by words of the title or by the journal reference ("Dz.U. 1964 nr 16 poz. 93"), in-force status, and the consolidated text the Sejm Chancellery prepares (unofficial; the binding text is the one in the journal). | Statutes are not protected by copyright (art. 4 of the Polish Copyright Act) | nothing ([guide](#sejm)) |
| **SAOS (Polish court judgments)** | Judgments of the Polish common courts (current), the Supreme Court (to about 2016) and the Constitutional Tribunal (to about 2015), from the University of Warsaw's research collection. Not an official court service; no administrative courts. Newest first. | Judgments are not protected by copyright; SAOS states no licence for its collection (community source) | nothing ([guide](#saos)) |
| **legislatie.just.ro (Romania)** | Romanian legislation from the Ministry of Justice's official free web service: by number and year ("31/1991"), by title words or by words of the text. | Official texts, no copyright (art. 9 of Law 8/1996) | nothing ([guide](#rolegis)) |
| **Romanian law (community data, no licence file)** | Off until you switch it on. A volunteer's daily export of legislatie.just.ro (about 250,000 acts), downloaded once to this computer and searched there. | No licence file; the texts themselves are official and free of copyright | your yes to a download of about 1.1 GB ([guide](#rodata)) |

All free sources without a key are switched on from the start (the Romanian community data is off until you switch it on). They are only used when your client-data rule allows online look-ups (below).

## Cheapest complete option, country by country

| Country | Statutes | Case law | Cost | Gaps |
|---|---|---|---|---|
| Austria | **Ansvar free plan** (sign in); RIS (free; live only 20:00–05:00 and at weekends, otherwise your local copy); Legalize (free key) | RIS case law: not connected yet | €0 | Live RIS in office hours (the RIS terms) |
| Germany | **Ansvar free plan**; NeuRIS and gesetze-im-internet.de (free, no key) | NeuRIS (federal courts) and Open Legal Data (Länder courts, community source), free | €0 | Land statutes (Landesrecht); only a small share of decisions is published |
| Switzerland | **Ansvar free plan**; Fedlex (free, no key) | opencaselaw.ch (free, no key, CC0) | €0 | Cantonal statutes (no open interface) |
| European Union | **Ansvar free plan**; EUR-Lex / Cellar (free, no key) | CJEU via EUR-Lex | €0 | ECtHR (HUDOC has no open interface) |
| Czechia | **Ansvar free plan**; e-Sbírka open data (free, no key; free REST key optional) | not connected yet (justice.cz open data: lower courts only) | €0 | Supreme courts (per page only) |
| Slovakia | **Ansvar free plan**; Slov-Lex (free, by number) | not connected yet (Ministry of Justice interface: terms to be confirmed) | €0 | Case law |
| Poland | **Ansvar free plan**; Sejm ELI (free, no key) | SAOS (free, no key; community source) | €0 | Administrative courts (NSA, WSA); recent Supreme Court and Constitutional Tribunal decisions (read them on sn.pl and trybunal.gov.pl) |
| Romania | **Ansvar free plan**; legislatie.just.ro free web service (no key); optional offline copy from the community data (no licence file) | none open (ReJust has no interface; Sintact's API is paid) | €0 for statutes | Case law; the consolidated text is on the act's web page |
| Netherlands | **Ansvar free plan**; Dutch law (BWB), free | rechtspraak.nl open data, free (by ECLI; search by words in the browser) | €0 | Search inside law texts (titles only); case-law search by words |
| France | **Ansvar free plan**; Légifrance via PISTE (free key) | Judilibre via PISTE (same free key); Conseil d'État decisions are not covered yet | **€0** | administrative case law (JADE) not connected yet |
| United Kingdom | **Ansvar free plan**; legislation.gov.uk (free, no key) | Find Case Law (free, no key) | €0 | Older judgments (before 2001) and some tribunals; judgments at scale for AI need TNA's computational-analysis licence |
| United States (federal) | eCFR (free, no key) + GovInfo US Code and public laws (free key) | CourtListener (free token) + GovInfo federal court opinions (free key) | €0 (CourtListener membership $10–100 a month for heavy use) | State statutes and regulations; California's regulations (CCR) are only on a site whose terms restrict reuse |
| Hungary | read njt.hu in your browser | birosag.hu in your browser | €0 (manual) | **No automated access** ([why](#no-automated-access)) |
| Cyprus | CyLaw / Official Gazette in your browser | CyLaw in your browser | €0 (manual) | **No automated access** ([why](#no-automated-access)) |
| South Africa | gov.za Acts in your browser | SAFLII in your browser | €0 (manual) | **No affordable automated access** ([why](#no-automated-access)) |

Where Ansvar's free plan covers a country it is the suggested first step (one sign-in for many countries); the official sources stay on as the second source and answer without any account. For one key across many countries' statutes, Legalize costs €29 a month after its free 2,000 look-ups.

## The AI sets sources up for you

When a question needs a country that has no connected source, the AI says so and proposes the best free one: first Ansvar's free plan where it covers the country, otherwise the official source. It uses three steps, each visible in the activity:

- **What is connected** (`law_sources_status`): read only, never asked.
- **Switch a source on** (`enable_law_source`): OpenLex asks you first (Allow once / Always / Don't allow). Free sources only; a paid plan only when you ask.
- **Your free key or sign-in** (`request_law_source_key`): OpenLex shows a secure field with the steps to get the key ("Open legalize.dev/api, sign up, paste the key here"), or a "Sign in with your browser" button for Ansvar. The key goes straight into this computer's keychain: it is never part of the conversation and the AI never sees it. Do not paste keys into the chat.

## Getting access, source by source

Keys and sign-ins are kept in this computer's keychain (macOS Keychain, Windows DPAPI, Linux Secret Service), never in a file, and only sent to the service they belong to.

<a id="ansvar"></a>
### Ansvar: the free plan first (sign in with your browser), or a service credential

Ansvar is a law-research service with its own plans (see [ansvar.eu/pricing](https://ansvar.eu/pricing)). **Its free plan is the first thing to try where it covers your country** (the EU, EEA and EFTA countries, the UK and EU law): 100 searches a day, one country per question, no card. OpenLex keeps the official sources on in the background as the second source. You need your own Ansvar account. Each lawyer uses their own: Ansvar counts a credential as a seat, and its terms forbid sharing or reselling access. Time: a few minutes. Cost: your Ansvar plan.

**Any plan, including the free and Solo plans: sign in with your browser.**

1. Create your account on [ansvar.eu](https://ansvar.eu) if you do not have one.
2. `/law` → Ansvar → Sign in with your browser (or `openlex sources signin ansvar`).
3. Ansvar's sign-in page opens. Type the code OpenLex shows, sign in, and allow access.
4. Back in OpenLex, Ansvar shows "connected, signed in". OpenLex renews the sign-in by itself; when Ansvar ends it, OpenLex says "sign in again".

If OpenLex says "Ansvar's browser sign-in is not available for OpenLex yet", Ansvar has not opened its sign-in to OpenLex yet. Until then, use a service credential (Premium plan), or one of the free official sources below.

Hungary and Cyprus: Ansvar is not suggested there, because the official sites forbid automated access and a copy's provenance would need checking with Ansvar first.

**Premium plan and above: a service credential.**

1. In your Ansvar workspace, create a *service credential*.
2. Paste it as `client-id:client-secret` in `/law` → Ansvar → Paste a service credential (or `openlex sources key ansvar`).

Setting this up for your firm? We do it as part of support: https://calendly.com/nicolas-jansa

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

Federal statutes and regulations, and the decisions of the federal courts, from the federal government's new legal information portal. Nothing to register: OpenLex uses its documented interface (no key; at most 600 requests a minute, which OpenLex keeps to). Time: none. Cost: none.

It is still in its public test phase and has not published a licence for its data yet, so OpenLex labels it "(test phase, licence not yet published)": check important passages on [gesetze-im-internet.de](https://www.gesetze-im-internet.de) or in the court's own publication as well. Statutes and court decisions are official works without copyright (§ 5 UrhG).

A search returns statutes first, then federal court decisions. A decision opens with its Leitsatz, Tenor, Tatbestand and Gründe.

Setting this up for your firm? We do it as part of support: https://calendly.com/nicolas-jansa

<a id="gii"></a>
### German federal laws (gesetze-im-internet.de)

The official consolidated edition of all German federal statutes and regulations, published by the Federal Ministry of Justice with the Federal Office of Justice and updated daily. Current versions only (no earlier versions). The site allows free use and reuse ("zur freien Nutzung und Weiterverwendung"); statutes are official works without copyright (§ 5 UrhG). Nothing to register, no key. Time: none. Cost: none.

- **Online (the default):** OpenLex fetches the list of laws once a day, finds a law by its abbreviation ("BGB", "§ 433 BGB") or the words of its title, and reads the law's official XML when you open it.
- **Offline mode (optional):** in `/law`, "Work fully offline" can keep all federal laws on this computer. OpenLex shows the size first (an estimate, roughly 100–300 MB including the search index), and only downloads after you say yes. It downloads from gesetze-im-internet.de itself, one request a second (about 1.5 hours), and builds a search index on this computer. After that, look-ups of German federal law never leave this computer. Remove the copy in `/law` at any time.

Setting this up for your firm? We do it as part of support: https://calendly.com/nicolas-jansa

<a id="openlegaldata"></a>
### Open Legal Data (German case law)

Over 400,000 German court decisions of all levels, federal and Länder, with full-text search, from the Open Legal Data project ([de.openlegaldata.io](https://de.openlegaldata.io); code MIT, database dumps under ODbL). Works without a key. Cost: none.

**A community source.** Open Legal Data is a volunteer project, not a state service. It collects decisions from the courts' own publication portals, and some of those portals ask bots not to collect them (their robots rules). The decisions themselves are official works without copyright (§ 5 UrhG), but OpenLex labels this source "community source" so you know where the collection comes from. Where the record names the court's own page, OpenLex shows it: check the decision there before relying on it.

**Optional free token** (raises the limits):

1. Open [de.openlegaldata.io](https://de.openlegaldata.io) and sign up (free).
2. On your account page, copy your API token.
3. `/law` → Open Legal Data → Add your free key (optional), or `openlex sources key openlegaldata`.

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

<a id="fedlex"></a>
### Fedlex Switzerland

Nothing to register. OpenLex reads Swiss federal law from the Federal Chancellery's open linked-data interface for Fedlex (the SPARQL endpoint at fedlex.data.admin.ch) and the text from Fedlex's official file store: the consolidated version in force today, or the one in force on a date you name. It finds an act by its SR number or by words of its title, and opens one article ("Art. 41 OR"). Time: none. Cost: none.

- **Languages:** German, French and Italian, the official languages. Fedlex also has English translations of some acts; they are not legally binding, so OpenLex does not use them.
- **Licence:** federal acts are not protected by copyright (Art. 5 of the Copyright Act, URG). Fedlex's terms page for reusers is at [fedlex.admin.ch](https://www.fedlex.admin.ch/de/broadcasters).
- **Pace:** Fedlex publishes no request limit; OpenLex sends one request at a time, at most two a second.
- **Not covered:** cantonal law (there is no open cantonal interface; LexFind has no API).

Setting this up for your firm? We do it as part of support: https://calendly.com/nicolas-jansa

<a id="opencaselaw"></a>
### opencaselaw.ch

Nothing to register. opencaselaw.ch is a free community project that collects Swiss court decisions from the courts' official publication channels (the Federal Supreme Court, the other federal courts and the courts of all 26 cantons; about a million decisions, updated daily) and publishes them under CC0. OpenLex uses its published MCP server (mcp.opencaselaw.ch, no key) for the search, the full decision and single considerations ("E. 2"). Time: none. Cost: none.

- **A community source, not the state:** OpenLex says so in `/law`. Each result links to the court's own publication where there is one: check the decision there before relying on it.
- **Licence:** CC0 for the decisions (the European Court of Human Rights judgments in the collection are excluded from CC0); Swiss court decisions are free of copyright anyway (Art. 5 URG).
- **Pace:** no published limit; OpenLex sends one request at a time, a few a second at most.

Setting this up for your firm? We do it as part of support: https://calendly.com/nicolas-jansa

<a id="legalize"></a>
### Legalize (laws of many countries)

[Legalize](https://legalize.dev) is a volunteer project that keeps the consolidated statutes of 30+ countries as one public git repository per country ([github.com/legalize-dev](https://github.com/legalize-dev)): each law is a Markdown file, each reform a dated commit, so the text on any past date can be read. The texts come from the official sources and stay under their terms, stated in each country's repository (for example CC BY 4.0 with RIS attribution for Austria, public domain for Germany and Czechia, CC0 for the Netherlands, OGL for the UK); the pipeline code is MIT. A community source, not an official edition: OpenLex says so in `/law`.

- **Online (the default): your free key.** Open [legalize.dev/api](https://legalize.dev/api), sign up (free, no card), create an API key (it starts with `leg_`), and paste it in `/law` → Legalize → Paste your key (or `openlex sources key legalize`). Free: 2,000 look-ups a month; €29 a month (or €290 a year) for 50,000. Time: two minutes. Legalize also has an MCP connector (legalize.dev/mcp) with a browser sign-in; OpenLex uses the REST API, which needs only the key.
- **Offline (only when you ask):** `/law` → Legalize → Keep a country on this computer, or the "Work fully offline" switch. OpenLex shows the size first (taken from GitHub; today's texts only by default, the full history on request for past dates), then clones the country's repository from GitHub into OpenLex's data folder, builds a search index on this computer and runs `git pull` once a day. Git must be installed ([git-scm.com](https://git-scm.com)). Remove a country in `/law` at any time.
- **Freshness:** `/law` shows when each country was last updated. A country not updated for more than 60 days is flagged ("may be out of date"); on 2026-10-30 that was the case for CH, PL, US, FR, SK and RO (last updated 2026-06-23), while AT, DE, CZ, NL, UK and EU were updated that week.
- **Austria and the RIS terms:** legalize-at is built from the RIS open-data interface (README: "Bundesrecht konsolidiert" via the RIS OGD API, CC BY 4.0). Its README does not say that it keeps to the RIS usage terms (night window, one request every two seconds, no parallel requests), and its pipeline code fetches with several parallel requests. When you use legalize-at, you read from GitHub or legalize.dev, not from RIS, so the RIS terms are a matter for the repository's maintainer; OpenLex itself only contacts RIS in the hours the terms allow.

Setting this up for your firm? We do it as part of support: https://calendly.com/nicolas-jansa

<a id="ukleg"></a>
### legislation.gov.uk

Nothing to register. OpenLex uses the published data interface of [legislation.gov.uk](https://www.legislation.gov.uk/developer), run by The National Archives: free, no key. It covers Acts and statutory instruments of the UK, Scotland, Wales and Northern Ireland, revised with later amendments ("revised legislation"), and retained EU law. Time: none. Cost: none.

- **Search** by title or words ("employment rights"), or open an item by its number: "2018 c. 12", "S.I. 2018/1234", or the address part from a search result ("ukpga/1996/18").
- **One section** ("94", "s. 94", "reg. 3", "Sch. 1") as it stands today, with the service's note on how up to date the revised text is. Without a section, OpenLex shows the table of contents.
- **On a past date:** ask for a date (YYYY-MM-DD) and OpenLex shows the section as it read then (point in time).

Licence: Open Government Licence v3.0 (Crown and Parliamentary copyright). The service allows at most 1,500 requests per 5 minutes and asks programs to say who they are: OpenLex sends one request at a time, 200 ms apart, and names itself.

Setting this up for your firm? We do it as part of support: https://calendly.com/nicolas-jansa

<a id="ukcaselaw"></a>
### Find Case Law (UK)

Nothing to register. OpenLex uses the published interface of [Find Case Law](https://caselaw.nationalarchives.gov.uk), The National Archives' service for judgments and tribunal decisions of the courts of England and Wales and the UK (2001 onwards). Free, no key. Time: none. Cost: none.

- **Search** by words; results come by relevance, with the court, the date and the neutral citation.
- **Open a judgment** by its neutral citation ("[2024] UKSC 12", "[2022] EWCA Civ 379") or from a search result, or **one paragraph** of it ("23").

**The licence for AI use.** Reading and reusing judgments is free under the [Open Justice Licence](https://caselaw.nationalarchives.gov.uk/open-justice-licence). That licence does **not** cover *computational analysis*: programmatic searching in bulk across the records to identify, extract or enrich content (for example, feeding many judgments to an AI model). That needs a separate licence from The National Archives, which is free; you [apply here](https://caselaw.nationalarchives.gov.uk/re-use-find-case-law-records/licence-application-process) (a questionnaire; the answer can take a few weeks). OpenLex only makes **per-question look-ups** for you, like a person using the site: one search, then the judgments you open. It does not download, index or analyse the collection. If your firm plans to analyse judgments at scale, apply for the licence first.

Rate limit: at most 1,000 requests per 5 minutes; OpenLex sends one request at a time, 300 ms apart.

Setting this up for your firm? We do it as part of support: https://calendly.com/nicolas-jansa

<a id="bwb"></a>
### Dutch law (BWB)

Dutch national legislation from the Basiswettenbestand, the state's collection behind [wetten.overheid.nl](https://wetten.overheid.nl), run by KOOP. OpenLex finds a law by words in its title ("huurprijzen woonruimte"), by its identifier (BWBR…) or by a Civil Code article ("6:162 BW"), and reads the version in force today, or one article of it. The search covers titles only, not the text of the law.

Licence: CC0 (open data of the Dutch government). Cost: none. Key: none. Time: none.

OpenLex uses the official search service (zoekservice.overheid.nl, SRU) and the official repository (repository.officiele-overheidspublicaties.nl). There is no published rate limit; OpenLex sends one request at a time, at most four a second.

Setting this up for your firm? We do it as part of support: https://calendly.com/nicolas-jansa

<a id="rechtspraak"></a>
### Dutch case law (rechtspraak.nl)

Published decisions of Dutch courts from the judiciary's open data service ([data.rechtspraak.nl](https://www.rechtspraak.nl/Uitspraken/Paginas/Open-Data.aspx)): the summary (inhoudsindicatie) and the full text, with court, date and case number.

The open data service has no search by words. OpenLex finds a decision by its ECLI (for example ECLI:NL:HR:2019:1734). To search by words, use [uitspraken.rechtspraak.nl](https://uitspraken.rechtspraak.nl) in your browser, then give OpenLex the ECLI.

Licence: Public Domain Mark (no restrictions). Cost: none. Key: none. Time: none. OpenLex sends one request at a time, at most five a second.

Setting this up for your firm? We do it as part of support: https://calendly.com/nicolas-jansa

---

Rows for "The sources" table:

Row for the per-country "cheapest complete option" table:

<a id="piste"></a>
### Légifrance and Judilibre (France): one free PISTE key

Both are official French services. OpenLex reaches them through **PISTE**, the French State's API gateway, with an application of your own. The data is free under the Licence Ouverte 2.0 (Etalab). One key serves both. Time: about 10 minutes. Cost: none.

1. **Create an account** at [piste.gouv.fr](https://piste.gouv.fr) (an e-mail address is enough).
2. **Create an application** (Applications → Create an application). Any name, for example "OpenLex".
3. **Subscribe it to the APIs** "Légifrance" and "Judilibre", and **accept their terms of use (CGU)**. Without this, OpenLex says "did not accept the key: subscribe your PISTE application …".
4. **Copy the OAuth credentials** of the application in production: the *client id* and the *client secret*.
5. **Paste them** in `/law` → Légifrance (or Judilibre) → Paste your key, as `client-id:client-secret` (or `openlex sources key legifrance`). The key goes into this computer's keychain once and is used for both.

OpenLex exchanges the key for a short-lived token (OAuth 2.0 client credentials) and only ever sends the secret to PISTE's token service. It asks one request at a time, a few a second at most, to stay within PISTE's quotas for your application.

**What you can ask.** Légifrance: words ("responsabilité du fait des choses"), or a reference as you would write it ("Art. 1240 C. civ.", "article L. 121-1 du code de la consommation"); the article comes with its status, and an old version says that it is not in force. Judilibre: words; a decision opens in full or as one part (`dispositif`, `motivations`, `moyens`, `exposé`).

**Terms to know.** Court decisions are published pseudonymised. French law forbids reusing the identity data of judges and court clerks to evaluate, analyse, compare or predict their professional practice (art. L111-13 of the Code de l'organisation judiciaire). OpenLex only looks decisions up, one question at a time.

Setting this up for your firm? We do it as part of support: https://calendly.com/nicolas-jansa

<a id="ecfr"></a>
### eCFR (US federal regulations)

Nothing to register. OpenLex uses the official eCFR API of the Office of the Federal Register and the Government Publishing Office (www.ecfr.gov), which is free and needs no key. A search finds sections by their words; OpenLex then reads one section, or one part of a title, as it stands today (the date the eCFR is up to date for), or as it stood on a date you name. Federal regulations are works of the US government and have no copyright. Time: none. Cost: none.

The eCFR is an editorial compilation, updated daily; the official legal edition is the annual CFR on govinfo.gov. OpenLex sends one request at a time, half a second apart.

Setting this up for your firm? We do it as part of support: https://calendly.com/nicolas-jansa

<a id="govinfo"></a>
### GovInfo (US Code, laws, federal courts): your free key

GovInfo is the US Government Publishing Office's official publication service. OpenLex searches three of its collections: the United States Code, public and private laws, and opinions of the federal courts. Everything in them is a US government work without copyright.

GovInfo needs a key from api.data.gov. It is free and comes at once. Time: two minutes. Cost: none.

1. Open https://api.data.gov/signup.
2. Enter your first name, last name and e-mail, and send the form.
3. Copy the key (40 letters and digits). It is shown on the page and sent by e-mail.
4. Add it: `/law` → GovInfo → Paste your key, or `openlex sources key govinfo`.

A key allows 1,000 requests an hour. OpenLex sends one request at a time, a second apart, and sends the key only to api.govinfo.gov, in a header (never in a web address). Some court opinions are published only as PDF; OpenLex reads the PDF on this computer, and if it cannot, it gives the court's docket text and the link.

Setting this up for your firm? We do it as part of support: https://calendly.com/nicolas-jansa

<a id="courtlistener"></a>
### CourtListener (US case law): your free token

CourtListener is run by the Free Law Project, a US non-profit. It collects decisions of federal and state courts, with their citations. The opinions themselves are public domain; the collection is the Free Law Project's, and its [terms](https://www.courtlistener.com/terms/) apply. OpenLex labels it "community source": it is kept by a non-profit, not by a court, so check important decisions against the court's own copy.

The API needs your own free token. Time: five minutes. Cost: none for light use.

1. Open https://www.courtlistener.com/sign-in/ and create an account (confirm your e-mail).
2. Open https://www.courtlistener.com/profile/api/ and copy your API token.
3. Add it: `/law` → CourtListener → Paste your key, or `openlex sources key courtlistener`.

The free token has a small allowance (a few requests a minute, a limited number a day). OpenLex keeps to it: one request at a time, 12 seconds apart, so a search with the full text of a decision takes about half a minute. If you use it a lot, a Free Law Project membership ($10–100 a month) raises the allowance; the token stays the same.

Setting this up for your firm? We do it as part of support: https://calendly.com/nicolas-jansa

<a id="sejm"></a>
### Sejm ELI (Poland)

Nothing to register. OpenLex uses the Sejm's official ELI interface (api.sejm.gov.pl/eli), which is free and needs no key. Time: none. Cost: none.

- **Search** finds acts by the words of their title ("kodeks cywilny") or by their journal reference ("Dz.U. 1964 nr 16 poz. 93", "Dz. U. z 2024 r. poz. 1061", "M.P. 2023 poz. 5"). There is no full-text search over the content of the acts.
- **The text** is the consolidated text the Sejm Chancellery prepares (tekst ujednolicony). It is unofficial: the binding text is the one published in the Journal of Laws, and OpenLex says so with every answer. Where there is no consolidated text, OpenLex shows the text as published (without later amendments) and says that too.
- The interface publishes no rate limit. OpenLex sends one request at a time, a third of a second apart.

Setting this up for your firm? We do it as part of support: https://calendly.com/nicolas-jansa

<a id="saos"></a>
### SAOS (Polish court judgments)

Nothing to register. SAOS (System Analizy Orzeczeń Sądowych) is a research collection of Polish court judgments run by ICM at the University of Warsaw, with a documented open interface and no key. Time: none. Cost: none.

- **What it has:** current judgments of the common courts; the Supreme Court up to about 2016; the Constitutional Tribunal up to about 2015. No administrative courts (NSA, WSA). Recent Supreme Court and Constitutional Tribunal decisions: read them on sn.pl and trybunal.gov.pl.
- **Search** is by words (newest judgments first; SAOS has no relevance ranking) or by case number ("I ACa 756/12").
- **Licence:** judgments are official documents without copyright (art. 4 of the Polish Copyright Act). SAOS states no licence for its collection, so OpenLex labels it a community source.
- **Terms note:** SAOS's robots.txt asks web crawlers to stay out of its interface. OpenLex does not crawl: it makes one look-up per question, one request at a time, a second apart. If your firm wants certainty, ask SAOS (saos.org.pl) for confirmation.

Setting this up for your firm? We do it as part of support: https://calendly.com/nicolas-jansa

<a id="rolegis"></a>
### legislatie.just.ro (Romania)

Nothing to register. OpenLex uses the Ministry of Justice's official free web service for the legislation portal (FreeWebService: it asks for a session token, then searches). No key. Time: none. Cost: none.

- **Search** by number and year ("Legea nr. 31/1991", "287/2009"), by words of the title ("codul muncii"), or, when the title gives nothing, by words of the text.
- **The text** is what the free service returns with each act. For the consolidated version (forma consolidată), open the act's page on legislatie.just.ro; OpenLex gives the link with every answer.
- **Plain http:** the service's own description publishes a plain-http address, and its https side does not answer programs. Your search words (never a document) therefore travel unencrypted to the ministry.
- No published rate limit. OpenLex sends one request at a time, a second apart, and reuses the session token.

Setting this up for your firm? We do it as part of support: https://calendly.com/nicolas-jansa

<a id="rodata"></a>
### Romanian law (community data, no licence file)

Off until you switch it on, and used only from a copy on your computer. It is a daily export of the acts on legislatie.just.ro to Parquet files, kept by a volunteer on GitHub ([scriptogre/romanian-law-data](https://github.com/scriptogre/romanian-law-data)): about 250,000 acts with their text.

- **Why it is off:** the repository has no licence file and says the data was collected from the portal's public pages. The texts are official and free of copyright (art. 9 of Law 8/1996), but the collection is not published as open data. Use the official service ([legislatie.just.ro](#rolegis)) first; switch this on only if you want a full local copy of Romanian legislation for offline work.
- **How:** `/law` → Romanian law (community data) → Switch it on → Download. OpenLex shows the size first (about 1.1 GB from GitHub, plus about as much again for the search index on this computer) and downloads only after you say yes. Progress is shown; the copy can be removed from `/law` at any time.
- **Searching** happens on this computer only; nothing is sent anywhere. Each answer says "From your local copy of the community data of <date> (no licence file)". OpenLex warns when the copy is more than 60 days old; download again to refresh it.
- Time: the download and the index take from a few minutes to an hour, depending on your connection. Cost: none.

Setting this up for your firm? We do it as part of support: https://calendly.com/nicolas-jansa

<a id="no-automated-access"></a>
### Hungary, Cyprus, South Africa: no automated access

`/law` says: "No open source allows automated access here; OpenLex can open pages for you to read (browser)". OpenLex does not look up the law of these countries by program, and its own web tools refuse these sites too:

- **Hungary:** the terms of the national law database (Nemzeti Jogszabálytár, njt.hu) forbid automated queries, bulk downloads and building a database. Court decisions: birosag.hu.
- **Cyprus:** CyLaw's terms forbid automated indexing; the Official Gazette is not consolidated.
- **South Africa:** lawlibrary.org.za (AfricanLII) is licensed for non-commercial use only and forbids scraping and bulk downloading; SAFLII reserves its content against AI use; the Laws.Africa API costs from R500,000 a year per country.

You can read these sites yourself in your browser (`/law` opens them). If your firm needs automated access, ask the operator for permission. A template:

> Subject: Request for permission to query [database] by software for our own legal work
>
> Dear [operator],
>
> We are a law firm ([name, address]). We use OpenLex, an application that runs on our own computers, to look up the law for our clients' matters. We would like to query [database] by software, one look-up at a time when a lawyer asks a question (no bulk download, no database of our own, no redistribution), with at most [N] requests a day, identified as "OpenLex ([firm name], [contact e-mail])".
>
> May we do so, and under which conditions? We will keep to any limits you set and stop at any time on request.
>
> Kind regards, [name]

Addresses: Hungary — the operator of njt.hu (MKIFK Zrt.); Cyprus — CyLaw (the Cyprus Bar Association's KINOP); South Africa — Laws.Africa / AfricanLII and SAFLII.

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

The law sources are switched in the `sources` section of `openlex.json` by id (`ris`, `eurlex`, `neuris`, `slovlex`, `esbirka`, `ansvar`, `legalize`, `opencaselaw`, `fedlex`, `openlegaldata`, `gii`, `ukleg`, `ukcaselaw`, `bwb`, `rechtspraak`, `legifrance`, `judilibre`, `ecfr`, `govinfo`, `courtlistener`, `sejm`, `saos`, `rolegis`, `rodata`):

```json
{ "sources": { "neuris": { "type": "connector", "enabled": false }, "rodata": { "type": "connector", "enabled": true } }, "lock": ["sources"] }
```

The agent uses them through `search_law_sources`, `get_law_source`, `law_sources_status`, `enable_law_source` and `request_law_source_key`; the local API has `/api/sources/law`, `/api/sources/law/signin`, `/api/sources/law/download` (size first; `confirm: true` downloads), `/api/sources/law/download/remove` and `/api/sources/law/offline` (see [LOCAL_API.md](LOCAL_API.md)). Command line: `openlex sources on|off <id>`, `openlex sources key <id>`, `openlex sources signin ansvar`, `openlex sources download legalize AT [--yes] [--history]`, `openlex sources remove legalize AT`, `openlex sources offline on|off [--countries AT,DE] [--yes]`, `openlex sources test <id>`, `openlex sources search "Gewährleistung" --law --jurisdiction AT`.

The agent's own web tools (`web_fetch`, `web_save`, `download_to_matter`, and the pages they load) keep to the same source terms: they refuse njt.hu, cylaw.org, lawlibrary.org.za and saflii.org, and RIS outside its night window, with one plain sentence.

Ansvar's sign-in uses OAuth 2.1 against Ansvar's own sign-in server, found from the gateway's published metadata: OpenLex registers itself as a public client (no secret), uses a device code (or a browser redirect to this computer with PKCE when device codes are refused), and keeps the tokens in the keychain. A firm that has been given a client id by Ansvar can set it with the environment variable `OPENLEX_ANSVAR_CLIENT_ID`; OpenLex then does not register itself.

# Data sources: plug in your firm's data and subscriptions

Law firms already have data: a knowledge base, a DMS, precedent folders, internal databases, and subscriptions to legal databases and commentaries. OpenLex searches them as **sources**, next to its law packs and the law sources above, without code.

Sources live in the `sources` section of `openlex.json` (firm layer in the workspace, or your own layer). The agent finds them with the `search_sources` tool, filtered by kind and jurisdiction, and every result keeps its source and citation, so answers can quote it.

```bash
openlex sources                              # law sources and configured sources
openlex sources add oldp                     # a ready-made preset
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
| `oldp` | caselaw (DE) | German court decisions from [Open Legal Data](https://de.openlegaldata.io) as a firm source, free, no key (the built-in law source `openlegaldata` does the same with full texts). |

More presets are added once their responses have been checked against the live service. For a service that needs your own account (for example CourtListener for US case law), add an `http` source with its search URL, map its fields, and store your token with `openlex sources key`.

Commercial legal databases usually allow automated access only through an official API or connector agreed with the publisher. Use those; OpenLex does not scrape them. Pine & Marshlands helps firms set up these connections as a [paid service](https://openlex.pinemarshlands.com/#services).
