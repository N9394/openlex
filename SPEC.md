# LexVault Word Plugin — Spec (v0.1 draft)

> Status: working draft, 2026-08-07. Companion recon: `word-plugin/RECON.md`.
> Product DNA: airgapped legal AI. The Word plugin is a **local work agent
> that lives inside Word** — reads the open document, analyzes it against
> downloaded law packs, and suggests edits as Word comments. Nothing leaves
> the machine except one subscription check.

---

## 1. Product concept

A Word add-in that behaves like a Copilot-style agent (task pane chat window,
LexVault dark styling) specialized for legal drafting:

- **Reads the open document** — structure, clauses, parties, jurisdiction.
- **Suggests changes as Word comments** anchored to specific ranges
  (marginalia: "rephrase this", "this favors the counterparty", "§ 4.2 of
  the Romanian Civil Code says X — your 3-year prescription period is
  wrong").
- **Marks phrasing alternatives** and **flags clauses that favor one side**,
  with the legal basis from the local law DB.
- **Verifies its own work** with a local Judge pass (proofreader) before any
  comment is posted.
- **Airgapped**: model (llama.cpp), embeddings, and law packs run locally.
  The document and all queries never leave the machine. The only outbound
  call is the subscription/license check.

Think "GitHub Copilot chat" but for Word, specialized in law, with the
LexVault visual language (`#0f0a07` background, `#d4a574` accent — already
in the launcher).

---

## 2. Model decision (answers to "which model?")

**Verdict: the fine-tuned Lotus 4B (`lotus-ai-q4km.gguf`) is the plugin's
model. No new fine-tune needed for v1.**

> **Update (2026-08-13)**: **Lotus 2 shipped** — `lotus-2-reasoning-q4km.gguf`
> (sha `ce8abbf3…`) supersedes the v1 card below for everything downloadable.
> Native thinking trained in (model gate `INLINE_REASONING: !model.includes('lotus-2')`),
> single tool call, clean JSON under thinking, file-tool capable. LegalBench
> (20 cases, `scripts/legalbench/`): v2 100% objective routing vs 9b 91% / v1
> 85%. Server-side inference stays OpenRouter 9B. Distribution requirements
> below are DONE (all tiers + sidecar default → `lotus-2-reasoning-q4_k_m`).

| Question | Answer | Why |
|---|---|---|
| Fine-tune gemma4 e2b? | **No (v1)** | We already have a model that beats the 9B on our own 35-test legal benchmark (93% vs 75%). Retraining = months, and gemma gives us nothing Lotus lacks for this workload (short outputs, tool routing, no need for giant context). |
| Stay with qwen3.5 9B? | **9B stays as the server-side deep-reasoning tier only** | The plugin must run on `cpu-low` (16 GB RAM laptops). 9B Q4 = 5.7 GB + KV cache — too heavy as the default. And on tool routing the 9B is the *worst* of the three (53%, and it hallucinated German banking law in T2). |
| Use the fine-tuned Lotus? | **Yes — primary, for plugin and product-wide routing** | Spec card: 100% routing, 100% language, 95% rerank precision, 88% live RAG. It is exactly a tool-hopping legal agent. 2.7 GB GGUF already built on the server. |
| Replace 9B everywhere? | **Not yet — two-tier model strategy** | Lotus wins routing/reranking/short-generation. Long-form (M&A synthesis, deep investigation reports) is untested on the 4B. Ship Lotus for: plugin, routing, reranking, judge, small tasks. Keep 9B for long-form generation on the server. A/B test on the server after the plugin ships. |

**Product-wide model policy (decided 2026-08-07):**
```
Everything DOWNLOADABLE ........ Lotus 4B (GGUF, local) — router, reranker,
                                judge, generation in the plugin/App/edge
Everything SERVER-SIDE .......... stays on OpenRouter (qwen3.5 9B) — zero
                                change to production inference today
```
Server routing/rerank/judge stays 9B-via-OpenRouter for now (no local GPU
pool on the server; swapping would mean running a local model there — not
the plan). The plugin and App run Lotus locally. This gives us one model
everywhere local, and the server untouched.

**Distribution requirements:**
1. ~~Copy `lotus-ai-q4km.gguf` into `/opt/lexvault-packs/models/`~~ — **done
   2026-08-07** (v1) and superseded: `lotus-2-reasoning-q4km.gguf` published
   there 2026-08-13.
2. ~~License-server `hardware-tiers.json`: `cpu-low`/`cpu-mid` already pick the
   4B — switch them to the Lotus GGUF (same family, same size class, just
   better). `apple-mid`/`apple-hi` can keep 9B or take Lotus~~ — **done**:
   ALL 3 tiers → `lotus-2-reasoning-q4_k_m` (policy: everything downloadable =
   Lotus 2, server stays OpenRouter 9B). Verified publicly served.

---

## 3. Architecture

### 3.1 Two-piece deployment

```
┌────────────────────── Microsoft Word (desktop, Win/macOS) ──────────────────────┐
│  Word add-in (Office.js task pane)                                            │
│   · Ribbon: "LexVault" tab  · Task pane: chat + document map + suggestions   │
│   · Posts comments via Word JS API (comment.add, ranges)                      │
│                        │  http://127.0.0.1:18001  (websocket/SSE)             │
└────────────────────────┼──────────────────────────────────────────────────────┘
                         ▼
┌────────────────────── Local sidecar (the "agent brain") ───────────────────────┐
│  lexvault-word-sidecar  (auto-started by the add-in)                          │
│   · llama.cpp server      (Lotus 4B GGUF)      — 127.0.0.1:11434              │
│   · BGE-M3 (onnxruntime)  embeddings          — in-process                    │
│   · Qdrant binary          (bundled)          — 127.0.0.1:16333               │
│       → legal_chunks_local, binary quantization, ingested from packs         │
│       → THE RAG engine: dense (binary ANN + int8 rescore) + sparse → RRF     │
│   · Express agent API      (pane frontend)    — 127.0.0.1:18001 (HTTP+SSE)    │
│   · Agent loop + tool dispatch + memory (SQLite) + Judge pass                 │
│   · License watchdog (the one phone-home)                                      │
│   · Reads packs/models from the shared userData dir                           │
└────────────────────────────────────────────────────────────────────────────────┘
```

**Why Office.js + sidecar (not a native Office COM/VSTO plugin):**
- Office.js task pane is the only cross-platform (Win + macOS) way to get a
  chat pane with document access, and it matches "chat window like Copilot".
- Comments (`Word.Comment.add`), ranges, selection, document text all
  available via the JS API — no COM registration pain, no per-Office-Version
  binaries.
- The sidecar holds the model + DB; the add-in is a thin UI. Sidecar is
  shared with the full App where present (see §6).

### 3.2 Where the law lives and how RAG works (the Qdrant question)

**Storage**: law data ships as `.lvpack` archives (signed, immutable) in
`userData/packs/` — those are the source of truth on disk. They are NOT
queryable directly; on first install the sidecar ingests each pack into a
**local Qdrant** (bundled binary, same as the App does) as collection
`legal_chunks_local` with the exact binary-quantization config from
`DATA_PACKAGING.md`:
- `dense.bin` → 1024-d binary vectors (always_ram, 128 B/chunk)
- `int8_dense.bin` → rescore vectors
- `sparse.bin` → BGE-M3 sparse vectors
- `chunks.parquet` → payload (content, source_name, source_type)

**RAG pipeline (identical to production `enhancedSearch`)**: query → BGE-M3
dense + sparse → Qdrant binary ANN with int8 rescore (top-K, oversampling) +
sparse search → RRF fusion → Lotus rerank (temp 0) → top-5 chunks with
source digests into the agent context.

Why Qdrant and not a hand-rolled in-process index: the App already has the
proven ingestion path (`/api/internal/ingest-pack`), Qdrant's binary index is
C++-fast and RAM-cheap, and reusing it means the plugin's retrieval behaves
byte-for-byte like production — one pipeline to maintain, one to test.
Hand-writing binary hamming + int8 rescore + sparse + RRF would be
re-implementing a search engine for zero user-visible benefit.

If the App is already running (full-version client), the sidecar probes
:16333 and attaches to the App's Qdrant — no duplicate index, same packs.
Plugin-only clients run their own Qdrant on the same port (nothing else
listens there).

**Add-in manifest (`manifest.xml`)**: TaskPane + custom ribbon tab "LexVault"
(chat, Analyze document, Refresh law pack status), `SupportsPinning`,
permissions `ReadWriteDocument`. For airgap, the add-in's HTML/JS is served
from `http://127.0.0.1:18001` (sidecar) — catalog sideload only, never an
AppSource/Central catalog URL. Windows: sideload via registry
`HKCU\Software\Microsoft\Office\Word\Addins`. macOS: sideload via
`~/Library/Containers/com.microsoft.Word/Data/Documents/wef/`.

### 3.3 Agent loop (small-context, tool-hopping)

The plugin runs a **bounded agent**: at most 3 tool hops per user action,
8K-token working context (fits `cpu-low` = 16K ctx with room for KV + output).

```
User action (chat message or "Analyze document")
  1. PLAN      — 1 LLM call: what does this need? (lookup? analyze? compare?)
                 Output: tool plan JSON. Context: <outline + last user msg + memory>
  2. TOOL HOP  — per step: dispatch 1 tool, append only the *tool result*
                 (compressed) back into the window
  3. WRITE     — 1 LLM call producing suggestion JSON (see §4)
  4. JUDGE     — 1 LLM call, temp 0: proofread each suggestion against its
                 cited source chunk + the document range it anchors to
  5. POST      — verified suggestions → Word comments (batched)
```

Tools exposed to the model (the "multi-tool hopping" Lotus is good at):

| Tool | Input | Output (compressed) |
|---|---|---|
| `get_document_map` | — | Heading tree + paragraph id ranges, ~600 tok |
| `get_range_text(start, end)` | paragraph ids | Up to ~2K tokens of raw text |
| `get_clause_analysis(paragraph ids)` | range | Rights/obligations table, parties, favoring, ~400 tok |
| `search_law(queries[], jurisdiction)` | up to 3 queries | Top 5 chunks each: source name + § + 2-sentence digest, ~500 tok |
| `get_law_section(chunk_id)` | chunk id | Full section text for citation/Judge, ~800 tok |
| `propose_suggestions(json)` | — | Validated suggestion JSON |
| `remember(fact)` / `recall(topic)` | — | Persistent doc memory (SQLite) |

All LLM calls: temp 0, thinking disabled (`think: false` / llama.cpp
`--no-warmup` equivalent), max 600 output tokens except WRITE (1,200).

### 3.4 Document analysis pipeline (the "Analyze" action)

1. `get_document_map` — Office.js `document.getBody()` → walk paragraphs via
   `ooxml` or ranges API; headings detected by style name / outline level.
   Fallback: first-line heuristic. Roman numerals & numbered clauses kept.
2. **Jurisdiction detection** — one Lotus call on the header + first 1K chars
   ("which country's law governs, what language"). Defaults to the user's
   installed packs.
3. **Section map** — chunk document into sections (≤ 2K chars each); build a
   per-section embedding digest. **Never put the whole document in context.**
4. Per-section (queued, up to N in parallel on multi-core):
   - clause structure + parties + favoring flags (Lotus)
   - `search_law` with up to 3 queries **only for flagged/risky clauses**
   - draft suggestions (Lotus) → Judge → post as comments
5. Session summary written to memory: counts, suggested/committed/rejected.

Latency budget: first comment appears in ~10–20s on `cpu-mid`; full doc
(N sections) streams comments as sections complete (SSE to the pane, comment
posted per suggestion as the Judge clears it).

---

## 4. Context compression & memory (the hard requirements)

**Constraint**: `cpu-low` = 16K ctx total; plugin working budget = **8K
tokens**. A 60-page contract is ~60–100K tokens. It must fit without
degrading.

### 4.1 Compression stack (all local)

| Layer | Technique | Tokens out |
|---|---|---|
| **Document** | Heading/outline map only, paragraph-id ranges. Never full text. | ~600 |
| **Section** | 2K-char sections; extractive compression: keep verbatim only clauses with modal verbs (shall/must/may/may not), numbers, dates, defined terms (acronyms + first-definition); drop boilerplate (governing-law recitals etc. matched against a small stop-list). | 2K → ~700 (≈65% reduction) |
| **Facts** | Clause analysis outputs a structured table (party, obligation, right, condition, value, date, favoring) instead of prose. | ~400/section |
| **Law chunks** | Retrieval returns source name + § + 2-sentence digest; full text fetched on demand (only for citations + Judge). | ~100/chunk vs ~800 |
| **Judge context** | Reconstructs only: suggestion + anchored range text + the 1 cited chunk. | ~1.5K |
| **Memory** | Never conversation transcript. Facts table + suggestion ledger only. | ~300 |

Defined-term extraction doubles as a glossary the agent can inject when a
clause references a defined term — better precision than raw RAG.

### 4.2 Memory management (SQLite, per document)

- **doc-memory** (`doc:{file_id}`): facts table (entity → what the doc says),
  terminology glossary, sections processed, suggestions ledger
  (id, range, status: posted/committed/rejected/duplicate) — prevents
  re-suggesting the same edit and gives the chat "what have we changed so
  far?" without re-reading the doc.
- **session-memory**: the last 4 user turns (bounded, oldest dropped).
- **cross-doc memory**: clause patterns this firm/office favors, user
  preferences (e.g. "never suggest British English spellings").
- Everything stored locally, encrypted at rest with a key derived from the
  license (defeats casual forensic reads; consistent with the product's
  zero-trust pitch).

### 4.3 Cost control

- Each user action = ≤ 5 LLM calls (plan, hops, write, judge) — bounded,
  displayed as progress steps in the pane.
- KV cache: llama.cpp slot reuse across calls in the same action (default
  in llama-server). `cache_type_k/v = q8_0` per hardware-tiers.json.
- Streaming: the pane streams each step (like the existing SSE patterns in
  researchChatService.js), so the lawyer sees progress, not a spinner.

---

## 5. Suggestions & the Judge (proofreader)

### 5.1 Suggestion model

Every suggestion is structured JSON before it becomes a Word comment:

```json
{
  "id": "s-042",
  "anchor": { "paragraphId": "p-118", "start": 12, "end": 140 },
  "type": "rephrase | flag-favoring | legal-risk | alternative | compliance",
  "severity": "high | medium | low",
  "summary": "3-month prescription is wrong for RO civil claims",
  "proposed_text": "…(optional, for rephrase/alternative)…",
  "basis": { "jurisdiction": "RO", "source": "Legea 287/2009 Codul Civil", "section": "Art. 2517", "chunk_id": "…" },
  "verdict": { "status": "verified | unsupported | rewritten", "by": "judge" }
}
```

Word comment = `summary` (+ optional inline replacement offered in the pane
"Apply" button → replaces the range; uses `document.getRange().insertText`).
Favoring analysis: "Clause X requires only Buyer to indemnify — favors Seller.
Typical DE practice splits mutual caps; GmbHG § 43 duties suggest…" with the
cited statute.

### 5.2 Judge (local proofreader)

- Runs on **every suggestion batch** before posting: one Lotus call at
  temp 0, context = suggestion + anchored range text + the cited law chunk.
  Verdict per suggestion: `verified` / `unsupported` (drop) / `rewrite`
  (regenerate once from source, then re-judge).
- Also does a **copy-edit pass** on proposed_text: grammar, jurisdiction
  spelling, correct statute names ("GmbH-Gesetz § 16", never "[1]").
- Same architecture as the product's Judge (researchChatService.js) — reuse
  the prompt pattern, but with the tiny context budget.
- Judge verdicts are recorded in the doc-memory ledger → audit trail that
  survives into exports (see §7).

---

## 6. Licensing, phone-home, and the "full version" question

### 6.1 The one call outside

On launch + every 6h (+ on manual refresh): `GET /api/app/license` with the
login token → returns Ed25519-signed payload (expiry, seats, jurisdictions,
tier). **Nothing else leaves the machine.** Behavior:

- Valid → run fully offline (packs already downloaded keep working through
  the 30-day offline grace — exactly the launcher's existing
  `LICENSE_VALIDITY_DAYS=35` + `OFFLINE_GRACE_DAYS=30` semantics).
- Expired & offline past grace → suggestions stop; analysis history and
  existing comments remain readable (never destructive).
- Signature verify with the embedded public key (same as
  `launcher/src/main/main.js:verifyLicense`).

### 6.2 Full-version clients — same DB, same backend?

The product already answers this: **packs are the shared, immutable DB**; the
local Qdrant is only a cache that can be rebuilt from packs
(`DATA_PACKAGING.md` §client-side). Therefore:

- **Plugin-only client**: sidecar runs its own bundled Qdrant (:16333) +
  llama.cpp, ingests `userData/packs/*.lvpack` on first run. Pack sizes: ~35
  MB (CY) to ~870 MB (RO).
- **Full client (Launcher + App + plugin)**: the sidecar **reuses the App's
  running services** — same llama :11434, same Qdrant :16333 (port probe +
  attach), same embeddings :11435, same `userData` packs/models dirs, same
  license file. **One data dir, one license, no sync problem** — because
  both read the same signed, immutable packs and share one index. No second
  backend: the sidecar's :18001 HTTP API is the plugin's backend; where the
  App is present, the plugin can optionally call the App's Express :18000
  (documents, vault, audit) so Word work lands in the same vault as the rest
  of LexVault.
- **Backend identity**: `LEXVAULT_LOCAL_MODE` auth (license-file identity)
  already makes the whole stack single-user-without-login — the plugin
  follows the same pattern.

### 6.3 Entitlements

License payload already carries `jurisdictions` — plugin enables/disables
pack search accordingly. `maxSeats` is enforced server-side; plugin is a
device, registered via the existing `/api/account/devices` device flow
(launcher already sends device registration on license fetch).

---

## 7. Deliverables & packaging (three download options)

### 7.1 Distributables

| Option | Contents | Approx size |
|---|---|---|
| **A. Word plugin only** | Installer (Win/mac): manifest.xml + pane assets + `lexvault-word-sidecar` (llama.cpp + onnxruntime + qdrant binary) | ~250–350 MB |
| **B. Full software** | Existing Launcher + App + everything in A (plugin auto-registered) | existing + A |
| **C. Data + models** | Packs (per jurisdiction, from license-server `/api/app/packs`) + Lotus GGUF 2.7 GB + bge-m3 569 MB (from `/api/app/model/`) | as today |

All three flow through the existing license-server endpoints — **no new
backend surface needed**, just two new routes:
`GET /api/app/plugin/{mac,win}` (signed installer, auth not required for
download, license needed to run) and the tier registry gains a
`plugin_models` entry pointing at the Lotus GGUF.

### 7.2 Website integration

- **Fix the broken flow first** (RECON §3): nginx `location /api/` →
  `proxy_pass http://lexvault-license-server:8100;` so `/api/app/mac`,
  `/api/public-key`, `/api/billing/*` work again. This is the blocking
  prerequisite for everything below.
- **`/download` restructure** → three cards:
  1. **Word plugin** ("works with the LexVault you already have, or standalone")
  2. **Full software** ("Launcher + App + Word plugin")
  3. System requirements + install steps per option; law pack picker after
     license.
- **`/pricing`** update: plugin tier (from ~€19–29/seat/mo) vs full tier
  (existing €99+). Pricing details in `PRICING.md` when ready.
- New marketing copy for the plugin: "your contracts, analyzed against
  in-force law, before they leave your desk" — fits the Heppner/§ 203 StGB
  airgap argument perfectly (comment-level privilege protection).

### 7.3 Versioning & updates

- Add-in updates via sidecar (pane checks `GET /api/app/update/plugin-{ver}`
  only when license check runs — same single-phone-home).
- Pack updates: existing delta-pack plan in DATA_PACKAGING.md (phase 2).

---

## 8. UI (LexVault styling, Copilot-in-Word pattern)

Task pane, dark theme from the launcher (`--bg:#0f0a07; --accent:#d4a574;
--text:#f4ead8`), tabs:

1. **Chat** — agent conversation, streaming steps ("Reading § 4.2…",
   "Searching Codul Civil…", "Judge: verifying…").
2. **Document map** — headings with status badges (analyzed / flagged N /
   clean); click → jump to range.
3. **Suggestions** — the comment ledger; each row: severity chip, summary,
   basis (source §), Apply / Reject; opens the Word comment when double-
   clicked.
4. **Settings** — jurisdiction(s), language, aggression level (conservative /
   balanced / aggressive for "favors which side" flags), packs installed +
   disk usage, license status, "check subscription" button (the one
   phone-home).

Ribbon tab "LexVault": Analyze document · Toggle pane · Pack status.

---

## 9. Open questions for the next working session

1. **Lotus GGUF licensing** — is `lotus-ai-q4km.gguf` the final artifact, or
   do we rebuild from `lora_adapter/` + base with current training data
   (2,041 examples on disk vs ~2,800 claimed in the spec card)?
   **→ Resolved (2026-08-13)**: Lotus 2 (`lotus-2-reasoning-q4km.gguf`, trained
   from 2,031-example v3 dataset incl. think-wrapped tools + JSON + file tools)
   is now the production model. v1 remains downloadable. Next data iteration
   targets citation precision (wrong statute numbers).
2. **Signed installers** — skip code signing for v1 (Safari/Windows warnings
   already accepted for the launcher) or pay for a cert? Affects download UX.
3. **`.lvpack` delta packs** — needed before "just the plugin" pack downloads
   get painful at RO (870 MB full download per update).
4. **Text extraction limits** — Office.js `getBody()` truncation on huge
   docs; plan chunked `getRange()` walks with per-section calls (also better
   for the compression layer anyway).
5. **Embedding on disk in plugin-only mode** — BGE-M3 onnx (569 MB) vs
   llama.cpp's built-in embedding support (reuses the already-loaded Lotus
   model process). Recommend onnx for v1 (proven in App), evaluate llama.cpp
   embeddings later to save RAM.
6. **Comment anchor persistence** — Word comments anchor to text ranges;
   need to handle edits after posting (comment stays, range shifts — native
   Word behavior, but the suggestion ledger should track "stale range").

---

## 10. Build order (proposed)

### Status (2026-08-09, iteration 4)

| Area | State |
|---|---|
| Server distribution | ✅ nginx proxy, Lotus GGUF published, tiers → Lotus, stale shim fixed |
| Spec + recon docs | ✅ `SPEC.md`, `RECON.md`, `TEST.md` |
| Sidecar agent core | ✅ plan→tools→write→judge, SSE, 8K ctx, compression, memory, license watchdog |
| Law retrieval | ✅ pack ingest (real AT pack, 90,931 chunks) + hybrid search, GmbH-Gesetz §16 hit |
| Standalone Qdrant | ✅ spawns own qdrant binary or attaches to App's |
| Embeddings | ✅ in-process ONNX BGE-M3 (dense + sparse, onnxruntime-node) as backend 2; app-attach :11435 first; llama dense fallback last. Inference test gated on token (model download is token-gated); tokenizer + fallback ordering verified |
| Add-in UI | ✅ task pane 4 tabs, ribbon, icons, sideload scripts |
| HTTPS for Office.js | ✅ self-signed cert flow + trust scripts; serving verified |
| First-run setup flow | ✅ downloads.js + runtime.js + `/api/download/*` + `/api/setup/status` + pane wiring |
| Download manager | ✅ verified: resume (Range), sha256 gate, progress, 401 gate (10/10 tests) |
| Runtime supervisor | ✅ verified: spawn + attach Lotus GGUF, real completion, clean reaping |
| App-attach (llama+embeddings) | ✅ verified: /healthz-first probe (no lazy 6 GB spawn), cheap /api/tags ping, embeddings /api/hybrid attach; own-spawn fallback (3/3 tests) |
| Clause analysis | ✅ structured extraction (parties/obligations/rights/prohibitions/warranties/values/durations/favoring), LLM-free ~400 tok; suggestion normalization; wired into get_clause_analysis (5/5 tests) |
| llama.cpp surface | ✅ adapted to b10333 (`--api-prefix /api`, `/api/v1/models`, `chat_template_kwargs.enable_thinking`) |
| KV cache | ✅ asymmetric q8_0-K / q4_0-V + flash-attn from tier registry (TurboQuant research: TBQ types not in mainline — PR #21089 closed; asymmetric split is the implementable win, ~25% KV memory at 32K) |
| Windows installer | ✅ `scripts/package-win.sh` + NSIS: per-user install, bundled node.exe + llama (CPU) + qdrant + add-in, WEF + HKCU sideload, cert trust, auto-start. 196 MB — **live on /download** |
| macOS installer | ✅ `scripts/package-mac.sh` + pkgbuild: arm64 + x64, /Library install, LaunchAgent, per-user WEF sideload + keychain trust. 293/297 MB — **live on /download** |
| First Word click-through | 🕐 TEST.md checklist — pending user on real doc |
| Plugin packaging/download page | ✅ routes + cards live; page probes endpoints and enables buttons when installers publish |

### Remaining

1. **P0 — first Word click-through** (user): trust cert + sideload + TEST.md.
2. **P1 — BGE-M3 full inference test with token** (569 MB download gated on
   login; everything up to `session.run` is verified).
3. **P1 — suggestion dedup + ledger UI wiring** (stale-anchor handling,
   "already suggested" suppression in the pane).
4. **P2 — Lotus in dev/test**: `scripts/import-lotus.sh` (GGUF → Ollama).
5. **P2 — code signing** for installers (both platforms unsigned — the
   download page already documents the macOS Gatekeeper / Windows SmartScreen
   workarounds).
6. **P2 — Windows x64 llama build is CPU-only**; CUDA bundle (~1 GB) optional
   later. macOS pkg installs system-wide (`/Library`); a per-user variant
   (`~/Applications`) can drop the admin prompt.
