# OpenTrident Operations Runbook

## One-Time Setup

```bash
# Set these in your shell profile (never committed to git):
export VPS_HOST="49.12.7.18"
export SSH_KEY_PATH="~/.ssh/binance_futures_tool"
```

## Quick Commands

```bash
# Check gateway health
curl http://127.0.0.1:18889/healthz

# View running containers
docker ps --format 'table {{.Names}}\t{{.Image}}\t{{.Status}}'

# View logs
docker logs opentrident-gateway --tail 100 -f

# SSH into VPS
ssh -i $SSH_KEY_PATH root@$VPS_HOST

# Restart gateway
ssh -i $SSH_KEY_PATH root@$VPS_HOST "cd /opt/opentrident && docker compose -f docker-compose.vps.yml restart opentrident-gateway"

# Tail live logs
ssh -i $SSH_KEY_PATH root@$VPS_HOST "docker logs opentrident-gateway -f --tail 50"
```

## Deployment

### Standard Deploy

**Always use `scripts/deploy.sh`** — it handles build with layer caching, image tagging, retention pruning, and cache cleanup in one step.

```bash
# From your Mac, deploy via SSH:
ssh -i $SSH_KEY_PATH root@$VPS_HOST "cd /opt/opentrident && bash scripts/deploy.sh"

# Or run locally if you have Docker access to the VPS:
./scripts/deploy.sh
```

The script automatically:
- Builds with layer caching (no `--no-cache`)
- Tags as `opentrident:latest` + `opentrident:YYYY.M.D-rHHMMSS`
- Updates `.env` with the new image tag
- Keeps last 3 versioned tags + latest, removes the rest
- Prunes build cache after build
- Restarts containers

**Do NOT use `docker build` directly.** Do NOT use `--no-cache`.

### Emergency Rollback

If the new deployment is broken, use the previous versioned tag:

```bash
# Find the previous image tag
docker images opentrident --format '{{.Tag}}' | grep -v latest | sort | tail -3

# Set it in .env and restart
sed -i 's/OPENTRIDENT_IMAGE=.*/OPENTRIDENT_IMAGE=opentrident:<previous-tag>/' .env
docker compose -f docker-compose.vps.yml up -d
sleep 15 && curl http://127.0.0.1:18889/healthz
```

### Current Runtime Reality

**Primary VPS (49.12.7.18):**
- runtime repo: `/opt/opentrident`
- identity repo: `/opt/OpenTrident`
- persistent state: `/opt/opentrident-data/config`
- live containers: `opentrident-gateway`, `opentrident-cli`

**Old migration target (87.99.148.214):**
- removed from Hetzner
- no current standby host

### Storage Hygiene

```bash
# Check Docker usage
docker system df

# Hard prune build cache
docker builder prune -af

# Remove stale images older than 48h
docker image prune -af --filter "until=48h"

# Remove dead volumes
docker volume prune -f
```

## Troubleshooting

### Gateway unhealthy
```bash
# Check container logs for errors
docker logs opentrident-gateway --tail 200

# Restart the container
docker compose -f docker-compose.vps.yml restart opentrident-gateway

# Full redeploy
docker compose -f docker-compose.vps.yml down && docker compose -f docker-compose.vps.yml up -d
```

### Planner not spawning workers
```bash
# Check planner state file
docker exec opentrident-gateway cat /home/node/.opentrident/planner-v1.json | python3 -m json.tool | head -50

# Check if trust telemetry is accessible
docker exec opentrident-gateway cat /home/node/.opentrident/trust-telemetry-v1.json
```

### Telegram not responding
```bash
# Check Telegram bot token
ssh -i $SSH_KEY_PATH root@$VPS_HOST "grep TELEGRAM_BOT_TOKEN /opt/opentrident/.env"

# Verify bot is working (send test message manually via bot API)
```

### Market signals not updating
```bash
# Check market cache
docker exec opentrident-gateway cat /home/node/.opentrident/market-attention-v1.json | python3 -m json.tool | head -30

# Check circuit breaker state (consecutiveFailures > 3 means circuit is open)
```

## State Files

| File | What | Backup |
|------|------|--------|
| `trust-telemetry-v1.json` | Approval/outcome metrics | cron to S3 |
| `autonomy-config-v1.json` | Domain autonomy levels | cron to S3 |
| `planner-v1.json` | Active planner rows | cron to S3 |
| `market-attention-v1.json` | Market signal cache | not critical |
| `playbooks/playbook-store.json` | Compounding procedures | keep |
| `doctrine-v1.json` | promoted playbooks | keep |
| `snapshot-head` + `snapshots/` | signed continuity chain | keep |

## Monitoring

### Health Endpoint
```
GET http://127.0.0.1:18889/healthz
Response: {"ok":true,"status":"live"}
```

### Key Metrics to Watch
- Trust approval rate (target: >80% for high-trust domains)
- Planner spawn failure rate (target: <5%)
- Market circuit breaker triggers (if >3/week, investigate CryptoCompare API)
- Autonomy level drift (domains should trend upward with consistent approval)

## Recovery

### Stale Planner Runs
The planner-recovery module automatically detects stale runs (>6h) and marks them for cleanup. No manual intervention needed.

### Full State Recovery
1. Stop containers: `docker compose -f docker-compose.vps.yml down`
2. Restore state files from backup to `/home/node/.opentrident/`
3. Start containers: `docker compose -f docker-compose.vps.yml up -d`

### Snapshot Proof
```bash
# Check current snapshot head
cat /opt/opentrident-data/config/snapshot-head

# List snapshot bundles
find /opt/opentrident-data/config/snapshots -maxdepth 1 -mindepth 1 -type d | sort
```

## Secrets

| Secret | Location | Notes |
|--------|----------|-------|
| Telegram Bot Token | `.env` (`TELEGRAM_BOT_TOKEN`) | Rotate via BotFather, update in `.env` |
| Gateway Token | `.env` (`OPENTRIDENT_GATEWAY_TOKEN`) | Used for internal auth |
| GitHub CLI Auth | `/root/.config/gh` | Mounted read-only into container |

## Development

### Testing changes

```bash
# 1. Commit and push changes to the runtime repo
git add <changed-files> && git commit --no-verify -m "feat: description"
git push opentrident opentrident-prune:opentrident-prune

# 2. Deploy using the standard script (same as production)
ssh -i $SSH_KEY_PATH root@$VPS_HOST "cd /opt/opentrident && bash scripts/deploy.sh"

# 3. Verify
sleep 20 && curl http://127.0.0.1:18889/healthz
```

### Testing without deploying

To build a test image without affecting running containers:

```bash
docker build -t opentrident:test .
docker compose -f docker-compose.vps.yml -f docker-compose.vps.yml run --rm opentrident-gateway node --version  # smoke test
docker rmi opentrident:test  # clean up
```
