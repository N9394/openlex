# OpenLex desktop client (Vite)

Fast, lightweight frontend for the OpenLex desktop app, built with Vite + React + Tailwind CSS.

## Features

- **Dashboard** - Quick access to all features
- **Research** - RAG-powered legal search with streaming responses
- **Analyse** - Upload and analyze legal documents
- **Create** - AI-assisted document drafting
- **Vault** - Save clauses and templates
- **Audit** - Activity logging
- **Settings** - User preferences

## Development

```bash
# Install dependencies
npm install

# Start dev server
npm run dev
```

Opens at http://localhost:3000 (proxies API to :8000)

## Build

```bash
# Production build (outputs to dist/)
npm run build

# Preview production build
npm run preview
```

## Deploy

Build the image and run it next to the OpenLex server (the container serves on port 3000 and proxies `/api` to `openlex-server:8000` on the `openlex-network` Docker network, see `nginx.conf`):

```bash
docker build -t openlex-client:latest .
docker run -d --name openlex-client --network openlex-network -p 3000:3000 openlex-client:latest
```

## Design System

Dark Academia theme with:
- **Colors**: obsidian, deep-brown, leather, parchment, cream, gold accent
- **Fonts**: Crimson Text (serif), Inter (sans)
- **Shadows**: Premium card shadows with gold glow effects

## API Endpoints Used

- `POST /api/auth/login`
- `POST /api/auth/register`
- `GET /api/auth/me`
- `POST /api/research/conversations`
- `POST /api/research/conversations/:id/messages/stream` (SSE)
- `POST /api/docs/upload`
- `GET /api/docs/:id`
- `POST /api/navigator/query`
- `POST /api/drafts`
- `GET /api/vault/items`
- `POST /api/vault/items`
- `DELETE /api/vault/items/:id`
- `GET /api/audit/logs`
