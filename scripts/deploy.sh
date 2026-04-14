#!/bin/bash
set -euo pipefail

COMPOSE_FILE="${COMPOSE_FILE:-docker-compose.vps.yml}"
COMPOSE_PROJECT="${COMPOSE_PROJECT:-opentrident}"
RETENTION=3

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$SCRIPT_DIR/.."

TAG_VERSION=$(date +%Y.%-m.%-d)
FULL_TAG="${TAG_VERSION}-r$(date +%H%M%S)"
LATEST_TAG="latest"

echo "=== OpenTrident Deploy ==="
echo "Version tag : $FULL_TAG"
echo "Compose file: $COMPOSE_FILE"

# 1. Build image with layer caching (no --no-cache)
echo ""
echo "[1/6] Building image (with layer cache)..."
docker build -t "opentrident:${FULL_TAG}" -t "opentrident:${LATEST_TAG}" .

# 2. Stop running containers
echo ""
echo "[2/6] Stopping containers..."
docker compose -f "$COMPOSE_FILE" down

# 3. Update .env with new image tag
echo ""
echo "[3/6] Updating .env..."
sed -i "s/OPENTRIDENT_IMAGE=.*/OPENTRIDENT_IMAGE=opentrident:${FULL_TAG}/" .env

# 4. Prune old images (keep last $RETENTION versioned tags + latest)
echo ""
echo "[4/6] Pruning old images (keeping last $RETENTION versioned + latest)..."
for tag in $(docker images opentrident --format '{{.Tag}}' | grep -v "${LATEST_TAG}" | sort -t'-' -k2 -rn | tail -n +$((RETENTION + 1))); do
  echo "  Removing opentrident:${tag}"
  docker rmi "opentrident:${tag}" 2>/dev/null || true
done

# 5. Prune build cache (keep last 24h)
echo ""
echo "[5/6] Pruning build cache..."
docker builder prune -f --filter "until=24h"

# 6. Start containers
echo ""
echo "[6/6] Starting containers..."
docker compose -f "$COMPOSE_FILE" up -d

# Verify
echo ""
echo "[OK] Deploy complete."
docker images opentrident --format "  {{.Repository}}:{{.Tag}}  {{.Size}}"
echo ""
docker ps --filter "name=${COMPOSE_PROJECT}" --format "  {{.Names}}: {{.Status}}"