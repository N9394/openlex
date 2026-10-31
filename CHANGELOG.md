# Changelog

All notable changes to OpenLex are listed here. The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and versions follow [Semantic Versioning](https://semver.org/spec/v2.0.0.html) (before 1.0, a minor version may contain breaking changes).

## [Unreleased]

### Added
- **GOWA (General OpenLex Worker Agent), OpenLex's own decision model: the infrastructure.** It is mmBERT-small with one Kev-style decision head. It answers yes/no, choice and score questions with calibrated probabilities on this computer, through the same System One API as a local Kev or Jev (`decide.json` → `{ "provider": "gowa" }`). The weights are not trained yet, so the engine shows "GOWA small v0 — not yet available". Model management (a pinned download with SHA-256 per file, size, remove), loading on first use, unloading when idle, a CPU thread cap and batching are ready. So are `openlex gowa`, `/api/decide/gowa` and `/api/decide/tasks`. The training pipeline is in `models/gowa/`: licence register, converters, labelling script for public texts, training, int8 export, evaluation, Colab notebook.
- **Tasks behind switches, all off by default:** the redaction check v2 (candidates from patterns, lists, heuristics, first names, capitalised words and GLiNER; GOWA classifies each one in context, and the lawyer reviews), a prompt-injection flag in the permission prompt (it never blocks), clause types on analysis cards, law-search reranking, request routing, and claim-support hints for the judge. Each task call adds one line to the AI record with counts and confidences, never content.
- **Rule checks for the judge, on now:** numbers, dates and § / Art. references in a claim that do not appear in the cited source are handed to the judge agent as "possible mismatches". The judge always runs and decides. If the judge is unavailable, the lawyer sees these pointers as "possible mismatch (automatic check, please verify)".

## [0.3.4] - 2026-10-31

(0.3.1–0.3.3 were built but not published; their changes, listed below, ship with this release.)

### Fixed
- **The redaction check no longer claims a name finder that did not run.** The optional name finder needs a native ONNX runtime, which the 0.3.x installers and the CLI did not contain: the model could be downloaded but never ran, and the check still said "with name finder". Now the engine tells apart *available* (the runtime loads on this computer) from *installed* (the model files are there); Settings offers the download only where it can run; and each check says "basic detection" unless the model really went through every text of that check — with the reason (did not run for this text / needs the desktop app / cannot run on this computer). The data line and the AI record note "checked by you (basic detection)" or "(with name finder)" (English and German).

### Changed
- **The desktop app now includes the ONNX runtime** (onnxruntime-node, CPU only) for its own platform, plus a small JavaScript tokenizer (`@huggingface/tokenizers`, which replaces `@huggingface/transformers` and with it `sharp` and a second copy of the runtime). Other platforms' binaries and the Windows GPU (DirectML) files are left out; the packages are checked against the lockfile's SHA-512. The name finder and the in-process BGE-M3 embedder share this one runtime; the embedder now says at once when there is none instead of downloading 569 MB first. Intel Macs: the runtime has had no build for them since 1.24, so there the app says the name finder cannot run on this computer.
- **The CLI tarball and Homebrew stay lean:** no ONNX runtime. There the redaction check says plainly that the name finder needs the desktop app.

## [0.3.3] - 2026-10-30

(0.3.2 was built but not published; its changes are in the 0.3.2 section below and ship with this release.)

### Fixed
- **The bundled search database (Qdrant) no longer sends usage statistics.** Qdrant reports anonymous telemetry by default; OpenLex now starts it with telemetry disabled (config and environment), in the engine and the desktop app.

### Added
- **Redaction check (Schwärzen mit Prüfung).** Before a question or a document goes to an online AI service, the lawyer sees what OpenLex hides — names, organisations, addresses, ID and register numbers, IBANs, contact details, dates of birth — marked in the text and grouped; each can be unticked, any selected text can be added ("also hide this", for the whole matter), and a preview shows what the AI will see. Choices are remembered per matter. On by default for every online call with a question or a document; the firm can lock it and add firm-wide names and patterns (`openlex.json` → `redaction`). Only-this-computer setups skip it. Chat, analysis, Word review, panels and batch runs (one check for all documents) wait for it; the Word pane shows a compact list, the terminal app a numbered list. Detection runs on this computer: per-country patterns with check digits (AT, DE, CH, CZ, SK, PL, RO, HU, US), the matter's and the firm's lists, titles and legal forms, and an optional name finder (GLiNER-X small, Apache-2.0, ~190 MB, downloaded only on request and checked by SHA-256). Placeholders are stable per matter; answers and exports show the real names. The AI record notes each check and each online call in counts only. A help, not a guarantee: see [docs/guides/redaction-check.md](docs/guides/redaction-check.md).

### Changed
- The data line and the AI record say "names and numbers hidden (pseudonymised)" / "Namen und Nummern verdeckt (pseudonymisiert)", with "checked by you" when the call went through the redaction check.

### Security
- **Prompt injection: answers never load anything by themselves.** The desktop app, the Word pane and the Outlook pane show an image in an answer as "[image: website]" instead of loading it, do not render raw HTML, and open links only on a click (full address on hover; a question first when the address looks like it carries data). The built desktop page and the Office panes carry a Content-Security-Policy without remote sources; the desktop window cancels requests to other computers, stays on the app and opens only web and mail links in the browser. With "hide names" on, placeholders are never put back inside a web address.
- **Prompt injection: documents are data.** The open document and every outside tool result (files, web pages, law sources, connectors) reach the AI inside marked blocks it is told to treat as data; text inside cannot close its block. Once something was read, opening a web page the lawyer did not name, saving outside the matter's folder, running a program, switching on a law source, asking for a key or using a sending connector is asked even with an "always allow" rule (narrow rules for a host or path still count), and the question says it came up while reading. Web addresses, searches and connector arguments that carry the client's name, a placeholder, a long copied passage or an encoded string are asked with a warning every time; the AI record notes why, without content. Red-team tests with an obeying fake model (English and German). See [SECURITY.md → Prompt injection](SECURITY.md#prompt-injection) and [Hidden instructions in documents](docs/guides/hidden-instructions.md).

## [0.3.2] - 2026-10-30

(0.3.1 was built but not published; its changes are included here.)

### Changed
- **Neutral role names.** OpenLex prepares material and the lawyer decides; names that sound like legal representation are gone: the default "Associate" is now "Assistant" (DE "Assistenz"), the panel templates "Claimant's counsel"/"Defendant's counsel" are now "Claimant's side"/"Defendant's side" (DE "Klägerseite"/"Beklagtenseite"). The core prompt describes OpenLex as an assistant that prepares material for the lawyer and gives no legal advice. Internal ids (`associate`, `claimant-counsel`, …) stay the same.


### Fixed
- **Desktop app with a licence (distribution builds) sets up the AI like the community app.** It no longer downloads a fixed model at first start or quits with "model setup failed" when that download fails: the first-start setup page (On this computer · I brought my own key · I need help) handles it. A distribution can recommend its own model (`"localModel"` in `distribution.json`); it is offered on the "On this computer" card and downloads only on a click, with progress. A failed download says so and the app keeps running.
- **Model files are never deleted at start.** The licensed app used to remove every GGUF that was not its tier's model; now all of them stay (Settings → AI removes one when you ask). "Download again" in Settings → Dependencies replaces the file only once the new one is complete and verified.
- **German names in a German app.** Detected document languages are named in the app's language ("Deutsch", not "German") on the analysis card (also inside batches), in the translation and drafting language lists, and in the analysis report (`Sprache: Deutsch`). The built-in agents and the panel templates have German names and descriptions (Juristischer Mitarbeiter, Recherche, Prüfer, Entwurfsverfasser, Klägervertretung, Beklagtenvertretung, Advocatus Diaboli, Compliance-Prüfung) in the app's "Working as", `/as`, the panel and the agent editor; the engine sends them as `de` (`GET /api/agents`) and `titleDe` (chat and panel events). The firm's and your own agents keep their names (they can add `"de": { "title": … }` in `openlex.json`); "als Recherche: …" works too. The Word pane and the terminal app are English and keep the English names.
- **"Based on" says where the law came from.** The line under the sources named "the law collection on this computer" even when a section came from RIS or EUR-Lex. Law texts read online (`get_law_source`, `get_eu_law`) are now listed with their source, and the line says "RIS Austria (online)", "your offline copy of RIS Austria" (RIS outside its hours, or a downloaded copy) or "the law collection on this computer", only for what was really used; with no law at all it just asks to check the sources. App (chat, `/sources`, panel) and terminal; English and German.
- **Word pane: long matter names are no longer cut off.** The matter picker at the top shows the number above and the whole name below (it wraps), instead of "2026-014 · Alpine shai…" at 350 px; choosing still uses the native list (keyboard and screen readers unchanged).
- **macOS in-app updates.** Releases now also ship `OpenLex-X.Y.Z-mac-arm64.zip` and `-mac-x64.zip` (checksums, Sigstore bundles, attestations and SBOMs like the dmg) plus `latest-mac.yml`, `latest.yml` and `latest-linux.yml` update metadata. The updater installs the zip without Squirrel.Mac (which needs a Developer ID signature): it checks the new app's signature and bundle id, swaps the app bundle with a rollback on failure and restarts; when it cannot (app not writable, run from the dmg), it says so and shows the download. It also refuses update files without a SHA-512, of the wrong type or architecture, or with names outside the updates folder.

### Changed
- The desktop app finds `distribution.json` in `$OPENLEX_DISTRIBUTION`, then in its settings folder (`<userData>/distribution.json`, so installers can drop it there), then in the installer; the licence token stays in `<userData>/token.txt`. Documented in `desktop/electron/README.md`.

## [0.3.0] - 2026-10-30

First release with the desktop app as a download (macOS, Windows, Linux; unsigned public builds, signed builds through support). The app now runs entirely on the open engine.

### Added
- **The desktop app through the install line.** `curl -fsSL https://openlex.pinemarshlands.com/install | bash -s -- --app` (macOS, Linux) and `$env:OPENLEX_APP = 1; irm https://openlex.pinemarshlands.com/install.ps1 | iex` (Windows; also `-App` when run as a script block) download the app from the GitHub release, check its sha256 (and its signature or GitHub attestation when `cosign` or `gh` is installed, saying which checks ran) and stop on a mismatch. macOS: the dmg for Apple Silicon or Intel, `OpenLex.app` copied into `/Applications` (or `~/Applications` when that is not writable, no sudo), with a note when an old `LexVault.app` is still there; Windows: the installer runs silently for the current user, no admin; Linux: the AppImage into `~/Applications` with a menu entry. Because nothing is downloaded through a browser, there are no Gatekeeper or SmartScreen warnings; this is the recommended way until the app is signed by Apple and Microsoft. `--all` (`OPENLEX_ALL=1`) installs the app and the CLI; without either, the scripts install the CLI as before. The CLI's checksum can now also come from `SHA256SUMS`. CI tests the app install on macOS, Linux and Windows (PowerShell 5.1 and 7) against a fake local release, including a checksum mismatch.
- **Panel: agents working together.** `/team` or the "Panel" switch next to "Working as": several agents answer the same question **side by side** (attributed, in the agents' order), **debate** for N rounds (default 2; each must cite sources; a moderator — the judge or a chosen agent — sums up agreement, disagreement, the stronger position and open questions, citing only sources the agents brought and dropping quotes not found word for word), or **draft and review** (drafter → reviewer → drafter revises). One lane per agent with its step in plain words, who is speaking and what left the computer; Stop stops all. Before a panel on online AI an estimate (calls × agents × rounds, from `prices.json`) to start; the monthly limit stops it between turns and keeps what was said; at most 3 agents at once (`openlex.json` → `panel.concurrency`), the AI on this computer one at a time. Each agent follows the data policy: an agent set to an online AI does not see a privileged matter and the lawyer is told. Result card with Word / PDF / Markdown export and "keep with the matter" (Saved, found by the search); the AI record lists which agent used which AI. Terminal: the same panel as plain text (`/team …: question`, `/team go` after the estimate). API: `POST /api/panel/estimate`, `POST /api/panel/run` (streamed), `GET /api/panel?id=`, `GET /api/panels`, `POST /api/panel/export`.
- **Your own agents without JSON.** `/agent new`, `/agent edit NAME`, `/agent from-chat` ("make an agent from this conversation"): name, what it does, which sources it may use (in plain words), where it runs, how thorough. Templates: Claimant's counsel, Defendant's counsel, Devil's advocate, Drafter, Researcher, Compliance checker. Saved in your `openlex.json`, or the firm's for firm-wide agents (`"lock": ["agents"]` fixes the list). API: `POST /api/agents/save|delete|propose`.
- **The judge is on by default for answers.** Besides proposed changes, prose answers that rest on sources get a second pass (quotes must be found word for word; one check call). Settings → "Check answers with a second pass (recommended)", `/judge on|off`, `GET/POST /api/config/judge`; a firm keeps it on with `"lock": ["judge"]`. The turn summary says whether it ran.
- **More law sources, online by default, by country.** OpenLex is the harness; the lawyer brings the data. New connectors (free unless noted): Legalize (statutes of 30+ countries with history: online with the lawyer's free key, 2,000 look-ups a month, or a git clone on this computer for offline work; "last updated" per country, flagged after 60 days), opencaselaw.ch (Swiss case law, CC0, over its MCP), Fedlex (Swiss federal law, SPARQL), Open Legal Data (German case law, community source), NeuRIS federal case law, gesetze-im-internet.de (German federal laws online, or all of them on this computer), legislation.gov.uk and Find Case Law (UK), BWB and rechtspraak.nl (NL), Légifrance and Judilibre (FR, one free PISTE key), eCFR, GovInfo (free key) and CourtListener (free token) (US), Sejm ELI and SAOS (PL), legislatie.just.ro (RO) and an opt-in Romanian community copy ("community data, no licence file"). Hungary, Cyprus and South Africa: "No open source allows automated access here", with the pages to read in the browser and a permission-request template.
- **Ansvar first where it covers the country** (free plan: 100 searches a day, browser sign-in); the official sources stay on as the second source.
- **"Work fully offline":** one switch in `/law` that shows what it would download and how big it is, downloads after a yes (from the source itself, at its rate limit), and then answers only from this computer. Single sources can also be kept locally; every copy shows its size and last update and can be removed (`/api/sources/law/download`, `/api/sources/law/offline`, `openlex sources download|remove|offline`).
- **The AI sets sources up:** agent tools `law_sources_status`, `enable_law_source` (asked first) and `request_law_source_key` (a secure field in the chat; the key goes straight into the OS keychain, never into the conversation).
- `/law` in the desktop app: grouped by country, a country filter, German words (`statusDe`), sign-in, keys, local copies.
- The agent's own web tools keep to the source terms too: they refuse NJT, CyLaw, lawlibrary.org.za and SAFLII, and RIS outside its night window.
- **Documents in the desktop app's chat, and the full document analysis as a chat tool.** Attach (paperclip) or drop Word, PDF (scans read by text recognition on this computer), Excel, e-mail (.eml) and text files; the engine reads them (`POST /api/document/read`, through the permissions broker and the matter's data rule) and says how each will be read. `/analyse` (app, terminal, Word) or the button on an attached document runs the full analysis as a chat turn with live steps and shows it as a card: at a glance (kind, parties, purpose, governing law, key points, overall risk), risks with quote, place, law and a double-checked fix, deadlines, obligations per party, key terms, notable and possibly missing clauses, legal terms in plain words — with export buttons for **Word, PDF and CSV**, and "Read the document" with every finding highlighted. The analysis is kept in the matter's conversation, so it shows again in every window. This replaces the old Upload page's analysis (legacy server).
- **Large documents by model.** A cloud model reads the whole document when it fits its context window with headroom, and providers that cache (Claude, Bedrock: an explicit breakpoint; OpenAI, DeepSeek, Mistral: automatically) keep it for follow-up questions; beyond the window the document is read in big parts guided by its outline. The local model keeps the outline + sections on demand, and a new setting **"Memory for the local AI"** (`/api/config/local-memory`, automatic by default) decides its context size (llama.cpp `--ctx-size`) and so how much fits at once. See [docs/LARGE_DOCUMENTS.md](docs/LARGE_DOCUMENTS.md).
- **Big batches:** a folder or many documents analysed one by one in the background with progress, Stop and Resume; before a big cloud run an estimate ("about 480 pages, roughly 640,000 tokens to Claude (EU), est. $3.10") to confirm (`/api/batch/*`).
- **One size rule for files:** about 100 MB per file everywhere in the engine (replacing 10, 20 and 50 MB limits), configurable, with one plain sentence above it.
- **Law sources:** OpenLex connects to where the law is published instead of maintaining its own copy. Official paths only. Free, without a key: RIS Austria (following the RIS open-data terms: one request every two seconds, live only 20:00–05:00 Vienna time, at weekends and on Austrian holidays, otherwise the lawyer's local copy with its date; an optional night copy), EUR-Lex (Cellar), German federal law (NeuRIS, "test phase, licence not yet published"), Slov-Lex Slovakia, e-Sbírka Czechia (the state's CC0 open data; the lawyer's free REST key from the Ministry of the Interior is an optional upgrade). Paid gateway with the lawyer's own account: Ansvar, by browser sign-in (OAuth 2.1, device code or PKCE, tokens in the OS keychain and renewed) or a Premium service credential. Every law-source answer says "Check the official version before relying on it." Step-by-step access guides per source in SOURCES.md. One interface with provenance on every result (source, URL, retrieval date, licence), the data policy and permissions applied, plain messages when a source is offline. `/law` in the terminal app (and Settings), `openlex sources` (`openlex sources signin ansvar`), `GET /api/sources/law`, agent tools `search_law_sources` and `get_law_source`. See [docs/SOURCES.md](docs/SOURCES.md).
- **The same "/" commands in every window.** One list in the engine (`sidecar/src/commands.js`, `GET /api/commands?surface=app|word|tui&lang=en|de`) with plain descriptions in English and German and which window supports each command. The terminal app reads it instead of keeping its own copy; the Word pane's "/" menu now shows the commands it supports (/model, /data, /as, /record, /clear, /help) before the firm's instructions; the desktop app's chat gets a "/" menu (also Ctrl+K / ⌘K) with /model, /data, /matter, /copy, /save, /word, /activity, /record, /clear and /help, run through the engine.
- **The desktop app's chat runs on the engine.** Questions go to `POST /api/chat` like in the terminal app and the Word pane: the steps in plain words while OpenLex works, where the data went (always visible), Stop (keeps the answer so far), what the answer is based on (law sections open in full), proposed changes with their check, and the permission questions as a small dialog (Allow once / Always / Don't allow). Conversations live in the engine (`GET /api/sessions?matterId=…`, `GET /api/session?id=…`, `sessionId` on `/api/chat`): a matter's conversation started in the terminal app or Word shows up in the app and the other way round. /as, /sources, /privileged, /permissions and /law now work in the app too.
- The dashboard's recent conversations come from the engine (`GET /api/sessions`), from every window.
- **The rest of the old desktop app on the engine, as chat tools** (`/investigate`, `/diligence`, `/draft`, `/save`, `/saved` in the app and the terminal app, EN+DE): an investigation over several documents (smart scan of long documents, quoted findings per document, law for what matters, a comparison across the documents and a second check that removes — and lists — statements the quotes do not support); due diligence of a data room (a review grid per document, quoted red flags in four tiers, change of control always flagged, what the data room lacks, a summary); drafting (write a draft or work on an attached document: changes by instruction with before/after and undo, ideas, a law check, fill-ins to make a template, every version kept, Send to Word). Each is a card in the chat with **Word, PDF, CSV and Excel** exports and "Save with the matter", and comes back with the conversation. Many documents run on the batch machinery (background, Stop, Resume, estimate). **Saved** (the old Vault) keeps answers, notes, clauses, documents and results per matter; the **AI record** page replaces the old Audit page; **Ctrl+K** searches matters, conversations, saved items, drafts, documents and commands through the engine.
- A quiet hint line under the question field in the desktop app and the Word pane: "Type / for commands · ⌘K · /help" (hidden while you type).

### Changed
- **The old desktop server (`desktop/server`) is off by default.** The desktop app no longer starts it (`OPENLEX_LEGACY_SERVER=1` switches it on for a comparison); the sidebar's Analyse, Investigate, Draft and Due diligence open the chat with the command, Settings and the dashboard use the engine, and the old pages' addresses say where they went. The code stays in the repository for now.

## [0.2.3] - 2026-10-29

### Security
- The legacy desktop server (`desktop/server`) listened on all network interfaces; it now listens on `127.0.0.1` only. A test checks that every server in the engine, the desktop shell and the legacy server binds to loopback.

### Added
- **AI record:** a tamper-evident log of what the AI did (which model, which sources, what was sent online, which actions were approved), hash-chained so later edits are detectable, readable and exportable from the Word pane, the terminal app and the CLI.
- Releases are built, signed and attested on GitHub: a reproducible CLI tarball, an SBOM (CycloneDX), Sigstore signatures (`*.bundle`) and GitHub build provenance for every file. The install scripts are release files too (`releases/latest/download/install.sh` and `install.ps1`). How to check a download: [docs/VERIFY.md](docs/VERIFY.md).
- The install scripts also check the signature (with `cosign`) or the GitHub attestation (with `gh`) when those tools are installed, and say which checks were made.
- CI on Linux, macOS and Windows with Node 20 and 22, and a packaging smoke test.
- SECURITY.md, CONTRIBUTING.md and this changelog.

### Changed
- Prompts, start-up messages, report footers, exports and user agents say OpenLex instead of LexVault. Data folders, settings and identifiers that existing installs depend on keep their names.
- `npm test` runs `node --test test/*.test.js` (Node 22 no longer accepts a folder).

### Fixed
- Windows: on-device OCR kept umlauts and the section sign (PowerShell now reads and writes UTF-8).
- Changes to `openlex.json` made twice within the same second are no longer missed.
- Two saves of a file within the same millisecond no longer overwrite each other's earlier-version copy.
- Windows: the plugin updater extracts with the system `tar.exe`, not a GNU tar from Git for Windows on PATH.
- Desktop app: the engine log file handle is no longer leaked on every engine start.

## [0.2.2] - 2026-10-29

### Added
- Word add-in redesigned around one main action, **Review this contract**: choose the side you act for, a firm checklist and focus areas; each finding becomes a tracked change plus a comment with the legal basis, with a summary, Accept/Reject per finding and Save as Word/PDF.
- **What can I do here?** menu (⌘K / Ctrl+K) in the Word pane; plain progress steps, "Your data" line, numbered sources and "checked against …" on every suggestion.
- Document analysis (`openlex analyse`, `/analyse`, Word menu): summary, parties, key terms, deadlines, obligations and risks with suggested fixes; every finding quotes the document word for word. Readable and Word reports.
- Matter at a glance (`openlex matters show`), recall search (`openlex recall`) and a matter memo export.
- Terminal app: works in the folder it is started in (reads freely, asks before saving or renaming, always asks before deleting, cannot reach anything outside); first-run tour, "Did you mean …?", `/copy`, `/save`, `/transcript`; accessibility settings (screen-reader mode, reduced motion, plain ASCII, no colour-only meaning).

### Fixed
- Comments in Word work again; the draft is never overwritten; the pane follows Word's light/dark theme and works with keyboard and screen reader.

## [0.2.1] - 2026-10-28

### Added
- Full-screen terminal app (`openlex`): setup wizard, matters with a privileged switch, chat with sources, files dropped into the window, every task in an Actions menu.
- Commands to change things mid-session: `/model`, `/key`, `/data`, `/as`, `/privileged`, `/permissions`, `/clear`; on the command line `openlex use`, `key`, `policy`, `providers`, `test`.
- Permissions: saving files, running commands, opening the web or using a connector needs the lawyer's OK (once, this matter, always, or no); firm rules that forbid something always win.
- Model profiles (`openlex models`) drive thinking, tool calling, temperature and context.
- Staged prompts: a plain question starts with ~360 tokens of instructions instead of ~1,900 (`openlex prompts` shows them).
- The firm's own databases and subscriptions as data sources; guides for lawyers in `docs/guides`.
- Windows installer `install.ps1` (beta, not yet tested on real Windows).

### Changed
- `run_bash` is off by default and sandboxed.
- Privileged matters cannot be opened up to a cloud model.
- The desktop app works without an account.

## [0.2.0] - 2026-10-27

### Added
- First open-source release of the OpenLex engine and CLI (community build), installable with Homebrew or from the release tarball.
- Bring your own model: cloud keys (Anthropic, OpenAI, Azure, Mistral, OpenRouter, Bedrock, Vertex) or a local llama.cpp; data policy local-only until a provider is allowed.
- Matters with per-matter data policy, firm library and clause library; workflows (review, chronology, translate, compare); review grid with Excel export; skills and playbooks as files; plans with checkpoints; monitors (EUR-Lex, Austrian federal gazette, RSS, pages); lists.
- The harness map (`openlex.json`): model routing per role, hooks at decision points, agent profiles. System One decision-model connector; MCP client and server; local API.

[Unreleased]: https://github.com/N9394/openlex/compare/v0.2.2...HEAD
[0.2.2]: https://github.com/N9394/openlex/compare/v0.2.1...v0.2.2
[0.2.1]: https://github.com/N9394/openlex/compare/v0.2.0...v0.2.1
[0.2.0]: https://github.com/N9394/openlex/releases/tag/v0.2.0
