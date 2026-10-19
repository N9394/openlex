# LexVault Word Plugin — sidecar

Local agent engine for the Word add-in. Airgapped by construction:
- llama.cpp (Lotus 4B) on :11434
- local Qdrant `legal_chunks_local` on :16333 (built from signed .lvpack packs)
- embeddings: App service :11435 → local llama.cpp bge-m3 (dense) → in-process ONNX (P1)
- the ONLY outbound call: license/subscription check (license.js)

See `../SPEC.md` for the full architecture.

## Run (dev)

```bash
npm install            # hyparquet (parquet) + optional better-sqlite3
npm start              # → http://127.0.0.1:18001 (spawns its own Qdrant)
```

The sidecar attaches to an already-running App Qdrant (:16333) if present,
otherwise spawns `bin/qdrant` (or userData/bin/qdrant-*, or PATH) with a
config at `~/.lexvault/qdrant/qdrant.yaml`. Point `LEXVAULT_LLM_MODEL` at
any local llama.cpp/Ollama chat model for dev (Lotus in production).

## KV cache (asymmetric — TurboQuant research outcome)

TurboQuant (TBQ3_0/TBQ4_0 KV cache types, arXiv:2504.19874) was researched
for this plugin. Outcome: **not shippable** — the upstream PR (#21089) was
closed without merging, so the types are not in mainline llama.cpp, and our
bundled build (b10333) doesn't accept them (`--help` shows only
f32/f16/bf16/q8_0/q4_0/q4_1/iq4_nl/q5_0/q5_1). Forks that carry TBQ are
CPU-only, halve generation speed, and crash on Metal KV offload (Apple
Silicon) — strictly worse for this product.

The research thread's *practical* finding IS implemented: **asymmetric KV
quantization**. K feeds softmax (3-bit precision floor) while V is linearly
combined ("V compression is essentially free"), so:

```
-ctk q8_0   (K: keep precision — softmax input)
-ctv q4_0   (V: compress — ~free quality cost)
--flash-attn on
```

Read from the shared tier registry (`hardware-tiers.json`, same source as
the App supervisor + license server) at spawn — context window, KV types,
and GPU layers per tier. ~25% KV-cache memory reduction at 32K ctx (2.0 →
1.5 GiB) vs the previous default f16, with no measurable quality loss.
Verified end-to-end (clean spawn + agent loop + suites).

## Auto-update (SPEC §7.3)

The sidecar polls the license server's plugin update manifest on the same
6h tick as the license watchdog (the plugin's ONE outbound channel):

- `GET /api/app/update/plugin-{mac,win}` (token) → JSON manifest
  `{ version, filename, sha256, size_bytes, notes }`
- `GET /api/app/update/plugin/{filename}` (token) → payload zip
  (`sidecar/src` + `add-in` — code updates, not full installers)

Check-only at boot + every 6h. Download/apply are user-triggered from the
pane (Settings → Update) with SSE progress; apply backs up the current
code, swaps files, restarts the sidecar. Payload extraction via bsdtar
(ships with macOS and Windows 10+). Published via
`scripts/build-update.sh` (bumps version, zips, sha256, deploys manifest +
payload to `/opt/lexvault-packs/plugins/`).

Verified: no-token short-circuit (never phones home), manifest poll,
version compare, sha256-gated download with resume, extract + swap
(5/5 tests).

## Tests

```bash
npm test                        # downloads + runtime + attach (mock server)
node test/downloads.test.js     # mock license server only
node test/runtime.test.js       # real spawn: llama-server + Lotus GGUF
node test/attach.test.js        # fake App supervisor: attach vs spawn
```

`downloads.test.js` runs against a local mock license server (ephemeral
port, throwaway data dir) — never touches the real server or `~/.lexvault`.
Covers: registry fetch + cache, 401 gate (no token / wrong token), progress
events, cached short-circuit, sha256 gate (corrupt final + mismatched
download), resume via Range from `.partial`, pack version lookup.

`runtime.test.js` spawns the bundled llama-server with the downloaded Lotus
GGUF on a free port, verifies `/api/v1/models` + one real chat completion,
then reaps it. Skips when the model file is not installed.

`attach.test.js` spins a fake App supervisor (`/healthz` + `/api/tags`
answered without loading a model, everything else passed through to a real
llama-server) and proves: attach without spawning our own llama-server,
cheap ping via `/api/tags`, chat through the proxy, embeddings attach probe
(`GET /` on :11435), and own-spawn when no App is present.

## Embeddings (B1 — in-process ONNX BGE-M3)

Fallback chain, all local:

1. **App embeddings service** :11435 (`GET /` health, `POST /api/hybrid` per
   text) — full-version client present → attach.
2. **In-process ONNX** (`onnx_bge.js`): `bge-m3-int8.onnx` (569 MB, registry
   variant, sha256-verified download via downloads.js) + tokenizer assets
   from HF `aapot/bge-m3-onnx` (static, ~22 MB — ship with the installer).
   Dense + sparse heads — full production parity for plugin-only installs.
3. **llama.cpp / Ollama** `/v1/embeddings` — dense only (sparse degraded).

Encode output matches the App's `/api/hybrid` shape (`{dense, sparse:
{indices, values}}`) so search.js is backend-agnostic. Verified: tokenizer
fetch + load, 1024-d dense shape, sparse aggregation, fallback ordering.
Full inference test runs when a login token is present (the 569 MB model is
token-gated like every other download).

## Clause analysis (B2 — structured extraction)

`src/clause.js` — LLM-free structured extraction per section: parties,
obligations/rights/prohibitions/warranties (modal-verb rules), values,
durations, dates, and a **favoring verdict** (the party with fewer duties
and more rights is favored). ~400 tokens vs ~2K raw; deterministic. This
is what `get_clause_analysis` returns to the agent, and the red-flag
driver for `search_law` (only risky clauses trigger law search).

Suggestion normalization (spec §5.1): model-produced suggestions are
mapped into the canonical `{type, severity, summary, anchor, basis}`
shape before the Judge sees them; missing fields are filled from what the
model did provide, nothing is invented.

## App-attach (B3)

The sidecar reuses the full-version App's services when they're running —
never two model servers on one machine:

| Service | Probe | Behavior |
|---|---|---|
| Qdrant :16333 | `GET /readyz` | attach, else spawn own binary |
| LLM :11434 | `GET /healthz` **first** (App proxy answers without loading the model; `/api/v1/models` would lazy-spawn 6 GB) → `/api/tags` → `/api/v1/models` | attach to App proxy (lazy model), else spawn own llama-server |
| Embeddings :11435 | `GET /` (health JSON, no model load) | attach (`/api/hybrid` per text), else llama.cpp `/v1/embeddings`, else in-process ONNX (P1) |

The App's LLM proxy answers `/api/tags` with placeholder names — the
sidecar's `resolveModelName()` picks the first model the service reports so
requests never 404 with "model not found".

## llama.cpp surface note (b10333+)

The bundled `bin/llama-server` (llama.cpp 0.0.10333) mounts the OpenAI
surface under `--api-prefix /api`:
`/api/v1/chat/completions`, `/api/v1/models`, `/api/health`.
Older builds / Ollama answer at `/v1/chat/completions` + `/api/tags`.
`llm.js` probes both once and caches the winner; `runtime.js` same for the
model list. Thinking is disabled via `chat_template_kwargs:
{enable_thinking: false}` (plus `think: false` for Ollama parity) — without
it the Qwen3-family Lotus emits `reasoning_content` and burns the token
budget.

## Verified end-to-end (2026-08-07)

- Real AT pack (`at-2026-07-09.lvpack`, 90,931 chunks) ingested: signature
  + sha256 verified, upserted into `legal_chunks_local` (binary quantized).
- Hybrid search returns GmbH-Gesetz § 16 as #1 for "Abberufung des
  Geschäftsführers ohne Grund" — matches the Lotus benchmark target.
- Agent loop: plan → search_law ×3 → write, with SSE streaming.

## Endpoints

| Route | Purpose |
|---|---|
| `GET /health` | liveness |
| `GET /api/status` | model / qdrant / embeddings backend / license / packs |
| `GET /api/setup/status` | first-run state: token set?, model installed?, packs installed? |
| `POST /api/config/token` | save the login token (the one phone-home identity) |
| `POST /api/download/model` | download Lotus GGUF / bge-m3 → SSE progress → spawn llama |
| `POST /api/download/pack` | download + ingest a jurisdiction pack → SSE progress |
| `POST /api/document/map` | build heading map from body text |
| `POST /api/document/section` | one section (raw + compressed) |
| `POST /api/document/analyze` | full clause analysis → SSE suggestions |
| `POST /api/chat` | agent loop → SSE (step/suggestion/text/done/error) |
| `POST /api/packs/ingest` | ingest a .lvpack → SSE progress |
| `GET /api/license/status` | subscription state (from watchdog) |
| `GET /api/jurisdictions` | installed vs available |
| `GET /api/packs` | local .lvpack inventory + installed state |
| `*` | serves the add-in static files (taskpane.html etc.) |

## Agent flow (per user action, ≤5 LLM calls)

`PLAN (1) → tool hops (≤3: document map / range / clause analysis / law
search / law section / remember/recall) → WRITE (1) → JUDGE (1)`

All calls temp 0, thinking disabled, 8K context budget. Tools return
compressed output (lawDigest, compressed sections) so context stays small.

## TODO (P1)

- suggestion dedup + ledger UI wiring
- tokenizer assets into the installer bundle (currently fetched from HF in
  dev; the airgap promise means they ship with the plugin, never fetched)
- Windows spawn: llama DLL resolution verified by layout (exe in bin/ +
  libs dir prepended to PATH); needs a real Windows smoke test
- `bin/qdrant` is a dev convenience (aarch64-darwin); production packaging
  ships per-platform binaries via the Launcher

## Verified (2026-08-09)

- Download manager: 10/10 checks (resume via Range, sha256 gate, progress
  events, 401 gate, cached short-circuit, registry cache) — `npm test`.
- Runtime: spawn + attach of llama-server with Lotus GGUF, real chat
  completion, single-process invariant, clean reaping.
- App-attach: attach to App LLM proxy without spawning, cheap ping, chat
  through proxy, embeddings attach probe, own-spawn fallback.
- Agent loop end-to-end via `POST /api/chat` against Lotus (step events,
  tool hops, text, done — no errors).
- First-run endpoints (`/api/setup/status`, `/api/download/*`) return real
  state over HTTPS on :18001.
