# OpenLex desktop app

The Electron app that runs entirely on the user's machine. No account, no
sign-in. The installers are called **OpenLex**; the app id
(`com.lexvault.app`) and the settings folder (`…/LexVault`, pinned in
`main/main.js`) keep their old names so existing installs keep their data.

```
OpenLex (Electron main process)
├─ Qdrant                  ← 127.0.0.1:16333   (bundled, official release)
├─ llama.cpp proxy/server  ← 127.0.0.1:11434   (bundled, official release; model: yours)
├─ OpenLex engine          ← 127.0.0.1:18001   (sidecar/, run with Electron's own Node)
└─ UI (desktop/client)       loaded from file://
Optional, only when a build ships them:
├─ embeddings service      ← 127.0.0.1:11435   (resources/bin/embeddings)
└─ old desktop server      ← 127.0.0.1:18000   (OPENLEX_BUNDLE_LEGACY_SERVER=1 at build,
                                                OPENLEX_LEGACY_SERVER=1 at run time)
```

Without a separate embeddings service the engine embeds on its own
(`sidecar/src/embeddings.js`: in-process ONNX BGE-M3 when installed, else
llama.cpp's embedding endpoint).

Community builds have no licence, download or update server: the user brings
an API key, a llama-server / Ollama endpoint, or a `.gguf` file. A
distributor's build adds its server with `OPENLEX_DISTRIBUTION=<path to
distribution.json>` (and `OPENLEX_PUBLIC_KEY_PATH` for licence checks) at
build time; that file never goes into this repository.

## Layout

```
electron/
├─ package.json              electron-builder config
├─ main/                     main process: boot, window, engine, updater (distributions only)
├─ sidecars/supervisor.js    starts Qdrant, the LLM proxy (and the optional services)
├─ scripts/
│  ├─ prepare-resources.js   stages UI, engine, binaries into resources/
│  ├─ fetch-sidecars.js      Qdrant + llama-server, sha256-pinned
│  ├─ stage-legacy-server.js the old server, only on request
│  ├─ after-pack.js          macOS ad hoc signature for unsigned builds
│  └─ smoke-packaged.js      starts the packaged engine (and app) and checks it answers
└─ test/                     node --test test/*.test.js (no Electron needed)
```

## Dev

```bash
cd desktop/electron && npm ci
npm run prepare-resources   # UI, engine, Qdrant, llama-server for this machine
npx electron .              # the real boot, from resources/
```

`LEXVAULT_DEV_FRONTEND=http://localhost:5173` loads the UI from Vite's dev
server (`cd desktop/client && npm run dev`) instead.

## Build an installer

```bash
cd desktop/electron && npm ci
npm run package:mac:arm64   # → dist/OpenLex-<version>-mac-arm64.dmg (also :x64)
npm run package:win         # → dist/OpenLex-<version>-windows-x64-setup.exe
npm run package:linux       # → dist/OpenLex-<version>-linux-x64.AppImage
npm run smoke               # packaged files, bundled Qdrant and engine answer
```

Builds are unsigned (macOS: ad hoc). The release workflow
(`.github/workflows/release.yml`) builds all four on every `v*` tag, adds
checksums, SBOMs, Sigstore signatures and attestations, and signs/notarizes
when the Apple / Azure secrets exist. CUDA llama.cpp for Windows (~600 MB) is
left out unless `OPENLEX_BUNDLE_CUDA=1`; NVIDIA cards use the Vulkan build.
