#!/bin/bash
set -euo pipefail

COMPOSE_FILE="${COMPOSE_FILE:-docker-compose.vps.yml}"
COMPOSE_PROJECT="${COMPOSE_PROJECT:-opentrident}"
RETENTION=3
MIN_FREE_GB=10
HEALTH_URL="${HEALTH_URL:-http://localhost:18889/healthz}"
HEALTH_WAIT=30
HEALTH_INTERVAL=3

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$SCRIPT_DIR/.."

TAG_VERSION=$(date +%Y.%-m.%-d)
FULL_TAG="${TAG_VERSION}-r$(date +%H%M%S)"
LATEST_TAG="latest"

echo "=== OpenTrident Deploy ==="
echo "Version tag : $FULL_TAG"
echo "Compose file: $COMPOSE_FILE"

# 1. Preflight: check disk space
echo ""
echo "[1/8] Checking disk space..."
AVAIL_KB=$(df . | awk 'NR==2 {print $4}')
AVAIL_GB=$((AVAIL_KB / 1024 / 1024))
echo "  Available: ${AVAIL_GB}GB"
if (( AVAIL_GB < MIN_FREE_GB )); then
  echo "  ERROR: Less than ${MIN_FREE_GB}GB free. Skipping deploy."
  echo "  Run manual cleanup first: docker images opentrident --format '{{.Tag}}' | ..."
  exit 1
fi

# 2. Preflight: prune old images before build (free space for build)
echo ""
echo "[2/8] Pre-build cleanup (old images)..."
PREV_TAG=""
for tag in $(docker images opentrident --format '{{.Tag}}' 2>/dev/null | grep -v "${LATEST_TAG}" | sort -t'-' -k2 -rn | tail -n +$((RETENTION + 1))); do
  echo "  Removing opentrident:${tag}"
  docker rmi "opentrident:${tag}" 2>/dev/null || true
done

# 3. Preflight: prune build cache before build
echo ""
echo "[3/8] Pre-build cleanup (build cache)..."
docker builder prune -af --filter "until=168h" 2>/dev/null || true

# 4. Save previous tag for rollback
echo ""
echo "[4/8] Saving previous image tag..."
PREV_TAG=$(grep "^OPENTRIDENT_IMAGE=" .env 2>/dev/null | cut -d= -f2 || echo "")
echo "  Previous: ${PREV_TAG:-none}"

# 5. Build image with layer caching (no --no-cache)
echo ""
echo "[5/8] Building image (with layer cache)..."
docker build -t "opentrident:${FULL_TAG}" -t "opentrident:${LATEST_TAG}" .

# 6. Stop running containers
echo ""
echo "[6/8] Stopping containers..."
docker compose -f "$COMPOSE_FILE" down

# 7. Update .env with new image tag
echo ""
echo "[7/8] Updating .env..."
sed -i "s/OPENTRIDENT_IMAGE=.*/OPENTRIDENT_IMAGE=opentrident:${FULL_TAG}/" .env

# 8. Start containers
echo ""
echo "[8/8] Starting containers..."
docker compose -f "$COMPOSE_FILE" up -d

# 9. Health check with auto-rollback
echo ""
echo "[9/9] Health check (${HEALTH_WAIT}s timeout)..."
HEALTH_OK=false
for i in $(seq 1 $((HEALTH_WAIT / HEALTH_INTERVAL))); do
  sleep "$HEALTH_INTERVAL"
  if curl -sf "$HEALTH_URL" > /dev/null 2>&1; then
    HEALTH_OK=true
    break
  fi
  echo "  Waiting... ${i}/$((HEALTH_WAIT / HEALTH_INTERVAL))"
done

if [[ "$HEALTH_OK" == "true" ]]; then
  echo ""
  echo "[OK] Deploy complete — healthy."
  docker images opentrident --format "  {{.Repository}}:{{.Tag}}  {{.Size}}"
  docker ps --filter "name=${COMPOSE_PROJECT}" --format "  {{.Names}}: {{.Status}}"
else
  echo ""
  echo "[WARN] Health check failed. Rolling back..."
  if [[ -n "$PREV_TAG" ]]; then
    sed -i "s/OPENTRIDENT_IMAGE=.*/OPENTRIDENT_IMAGE=${PREV_TAG}/" .env
    echo "  Reverted .env to ${PREV_TAG}"
  else
    echo "  No previous tag to roll back to."
  fi
  docker compose -f "$COMPOSE_FILE" up -d
  echo "[ERR] Deploy failed and rollback attempted."
  exit 1
fi