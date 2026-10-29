# Changelog

All notable changes to OpenLex are listed here. The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and versions follow [Semantic Versioning](https://semver.org/spec/v2.0.0.html) (before 1.0, a minor version may contain breaking changes).

## [Unreleased]

### Security
- The legacy desktop server (`desktop/server`) listened on all network interfaces; it now listens on `127.0.0.1` only. A test checks that every server in the engine, the desktop shell and the legacy server binds to loopback.

### Added
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
