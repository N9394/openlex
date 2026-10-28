# OpenLex desktop backend (`desktop/server`)

The Express API behind the desktop app (research, document analysis, investigations, M&A due diligence, workshop, teams). It ships as **compiled JavaScript** in `dist/`. The original TypeScript sources are not part of this repository; `dist/` is the source of truth and is edited directly. Newer versions of some modules live in `../server-fixes/` and are copied over `dist/` when the app is packaged (see `desktop/electron/scripts/prepare-resources.js`, `fixMap`).

```bash
cd desktop/server
npm ci                # once
npx prisma generate   # Prisma client for prisma/schema.prisma
npm start             # node dist/server.js
```

Inside the desktop app you never start it yourself: the Electron supervisor runs it with the right environment, next to the local model, Qdrant and the embeddings service, and routes its model calls through the OpenLex engine (so the data policy applies).

## Settings (environment)

| Variable | What |
|---|---|
| `PORT` | API port (the app sets it). |
| `DATABASE_URL` | SQLite file for Prisma, e.g. `file:./prod.db`. |
| `JWT_SECRET`, `DOCUMENT_ENCRYPTION_SECRET`, `INTEGRATION_ENCRYPTION_KEY` | Secrets for sessions and encrypted storage. Set your own random values; never commit them. |
| `QDRANT_URL`, `QDRANT_COLLECTION` | Vector index (default `http://127.0.0.1:6333`). |
| `EMBEDDINGS_URL`, `EMBEDDING_MODEL` | BGE-M3 embeddings service. |
| `LLM_PROVIDER`, `LOCAL_LLM_URL`, `OLLAMA_BASE_URL`, `OLLAMA_MODEL*` | Local model. |
| `OPENROUTER_API_KEY`, `OPENROUTER_MODEL` | Optional hosted model (only when you choose it). |
| `LLM_MAX_CONCURRENT`, `LLM_MAX_SLOTS`, `LLM_MAX_BACKGROUND`, `LLM_RESERVED_INTERACTIVE`, `LLM_REQUEST_TIMEOUT` | Scheduler limits. |
| `CLIENT_URL` | Where the UI runs (CORS). |
| `LEXVAULT_DATA_DIR`, `LEXVAULT_LOCAL_MODE`, `LEXVAULT_LICENSE_PATH` | Shared OpenLex data folder and local mode (the app sets these). |
| `COURTLISTENER_API_TOKEN`, `CANLII_API_KEY`, `LEGIFRANCE_ACCESS_TOKEN` | Optional case-law sources with your own keys. |
| `STRIPE_*` | Only for a hosted multi-user deployment with billing; unused in the desktop app. |
