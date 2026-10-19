#!/bin/bash
# LexVault Client Deployment Script
# Run this script to build and push the Docker image

set -e

# Configuration
IMAGE_NAME="lexvault-client"
REGISTRY="${DOCKER_REGISTRY:-}"  # e.g., "docker.io/yourusername" or "ghcr.io/yourusername"
TAG="${1:-latest}"
SERVER="root@${OPENLEX_DEPLOY_HOST:?set OPENLEX_DEPLOY_HOST to your server}"

echo "=== LexVault Client Build & Deploy ==="

# Step 1: Build locally
echo "Building Vite app..."
npm run build

# Step 2: Build Docker image
if [ -n "$REGISTRY" ]; then
    FULL_IMAGE="$REGISTRY/$IMAGE_NAME:$TAG"
else
    FULL_IMAGE="$IMAGE_NAME:$TAG"
fi

echo "Building Docker image: $FULL_IMAGE"
docker build -t "$FULL_IMAGE" .

# Step 3: Push to registry (if registry is set)
if [ -n "$REGISTRY" ]; then
    echo "Pushing to registry..."
    docker push "$FULL_IMAGE"

    # Step 4: Deploy to server
    echo "Deploying to production server..."
    ssh "$SERVER" "docker pull $FULL_IMAGE && docker stop legalclarity-client 2>/dev/null || true && docker rm legalclarity-client 2>/dev/null || true && docker run -d --name legalclarity-client --network legalclarity-network -p 3000:3000 $FULL_IMAGE"
else
    # Alternative: Save image and transfer via SCP
    echo "No registry set. Saving image for transfer..."
    docker save "$FULL_IMAGE" | gzip > lexvault-client.tar.gz
    echo "Image saved to lexvault-client.tar.gz"
    echo ""
    echo "To deploy manually:"
    echo "  1. scp lexvault-client.tar.gz $SERVER:/tmp/"
    echo "  2. ssh $SERVER 'gunzip -c /tmp/lexvault-client.tar.gz | docker load'"
    echo "  3. ssh $SERVER 'docker stop legalclarity-client; docker rm legalclarity-client; docker run -d --name legalclarity-client --network legalclarity-network -p 3000:3000 $FULL_IMAGE'"
fi

echo "Done!"
