# LexVault Client (Vite)

Fast, lightweight frontend for LexVault built with Vite + React + Tailwind CSS.

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

## Docker Deployment

### Option 1: With Docker Registry

```bash
# Set your registry
export DOCKER_REGISTRY=docker.io/yourusername

# Build and deploy
./deploy.sh
```

### Option 2: Manual Transfer

```bash
# Build image
docker build -t lexvault-client:latest .

# Save to file
docker save lexvault-client:latest | gzip > lexvault-client.tar.gz

# Transfer to server
scp lexvault-client.tar.gz root@$OPENLEX_DEPLOY_HOST:/tmp/

# On server: load and run
ssh root@$OPENLEX_DEPLOY_HOST
gunzip -c /tmp/lexvault-client.tar.gz | docker load
docker stop legalclarity-client
docker rm legalclarity-client
docker run -d \
  --name legalclarity-client \
  --network legalclarity-network \
  -p 3000:3000 \
  lexvault-client:latest
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
