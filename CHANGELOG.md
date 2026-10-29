# Changelog

All notable changes to OpenLex are listed here. The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and versions follow [Semantic Versioning](https://semver.org/spec/v2.0.0.html) (before 1.0, a minor version may contain breaking changes).

## [Unreleased]

### Added
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
