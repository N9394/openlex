# LexVault App (the airgapped product)

The Electron app that runs entirely on the user's machine. The Launcher writes
a signed license file and starts this binary; nothing here ever touches the
network. All five services run as supervised child processes:

```
LexVault.app (Electron)
├─ main process — license + supervisor + window
├─ Qdrant binary           ← 127.0.0.1:16333
├─ Embeddings (BGE-M3)     ← 127.0.0.1:11435
├─ llama.cpp server        ← 127.0.0.1:11434  (pretends to be Ollama)
└─ Express backend         ← 127.0.0.1:18000  (the existing product/server)
        ↑
        | http://
        ↓
    Vite SPA (loaded from file://)
```

No account, no sign-in. Without a license the App boots in community mode
(own API key, local GGUF in `userData/models/llm`, or a llama-server / Ollama
endpoint; no pack sync, no licence polling). A distribution build can add a
license by pasting a token in Settings → License. Auth middleware reads
`LEXVAULT_LICENSE_PATH` when set, else uses the local community user, and
auto-authenticates every request to the single user on this machine. All
LLM/embedding/Qdrant calls go to localhost.

## Layout

```
electron/
├─ package.json            ← electron-builder config
├─ main/
│  ├─ main.js              ← boot, license verify, window
│  └─ preload.js           ← window.lexvault bridge (identity, openExternal)
├─ sidecars/
│  └─ supervisor.js        ← spawns + waits for Qdrant, embeddings, LLM, backend
├─ scripts/
│  └─ prepare-resources.js ← stages product/server + product/client-vite into resources/
└─ resources/
   ├─ server/              ← Express dist (built from product/server)
   ├─ client/              ← Vite dist (built from product/client-vite)
   ├─ bin/                 ← native binaries (qdrant, llama-server) — Launcher fills these
   ├─ models/              ← LLM GGUFs + BGE-M3 — Launcher fills these
   └─ public_key.pem       ← Ed25519 license verify key
```

## Dev — run against the cloud backend, no local sidecars

The fastest inner loop: keep the Vite dev server and an existing OpenLex
backend running, and just open them inside Electron.

```bash
# Terminal 1 — Vite dev server
cd product/client-vite && npm run dev   # serves http://localhost:5173

# Terminal 2 — Electron shell
cd product/electron && npm install
npm run start:dev
# (env: LEXVAULT_DEV_BACKEND=http://127.0.0.1:8000 LEXVAULT_DEV_FRONTEND=http://localhost:5173)
```

Pointing `LEXVAULT_DEV_BACKEND` at `http://<your-server>:8000` works too, if
you prefer to dev against prod.

## Build a packaged airgapped binary

```bash
cd product/electron
npm install
npm run package:mac     # → dist/LexVault-0.1.0-{arm64,x64}-mac.zip
npm run package:linux   # → dist/LexVault-0.1.0.AppImage
npm run package:win     # → dist/LexVault Setup 0.1.0.exe
```

Before the binary will actually boot offline, the Launcher needs to download
into `userData`:

1. **Native sidecars** → `userData/bin/qdrant-{platform}-{arch}`,
   `userData/bin/llama-server-{platform}-{arch}`, `userData/bin/embeddings/run.sh`
2. **Models** → `userData/models/llm/qwen3.5-9b-q4_k_m.gguf` (or whichever GGUF
   matches the detected hardware tier), `userData/models/embeddings/bge-m3/`
3. **License** → `userData/license.json` (signed Ed25519 envelope from the
   license-server)

Until those are in place the supervisor will fail with a "binary missing"
error pointing at the expected path — the Launcher should treat that as its
to-do list.

## What changed in the existing product to make this work

- `product/fixes/authMiddleware.js` — `LEXVAULT_LOCAL_MODE=1` short-circuits
  the JWT/cookie flow and reads identity from the license file
- `product/fixes/server.js` — on boot, upserts a User row matching the
  license's `account_id` so existing Prisma joins keep working
- `product/client-vite/src/lib/api.ts` — picks up `?backend=...` query param
  written by the Electron main, falls back to relative URLs in cloud builds

The cloud deployment is unchanged: `LEXVAULT_LOCAL_MODE` is unset there, so
the auth middleware behaves identically to before, and the SPA's relative
URLs still hit the same nginx proxy.

## Known gaps (next iterations)

- Embeddings sidecar is currently a Python `run.sh` shim — needs an ONNX-only
  drop-in so we can stop bundling Python
- `prisma generate` + migrations need to run on first boot in the user's
  appData; right now the `localModeBootstrap` assumes the schema is already
  applied (the Launcher should run `prisma migrate deploy` post-install)
- llama.cpp's HTTP shape isn't 100% Ollama-compatible — the `--api-prefix
  /api` flag covers `/api/chat` and `/api/tags`, but the existing fallback
  code occasionally probes `/api/version` which we'll have to either stub or
  patch
- No "deal with revoked entitlement" UI yet — the launcher's IPC event
  `entitlements-changed` is wired to the renderer but not handled
