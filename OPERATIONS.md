# OpenTrident Operations Runbook

## Quick Commands

```bash
# Check gateway health
curl http://127.0.0.1:18889/healthz

# View running containers
docker ps --format 'table {{.Names}}\t{{.Image}}\t{{.Status}}'

# View logs
docker logs opentrident-gateway --tail 100 -f

# SSH into VPS
ssh -i ~/.ssh/binance_futures_tool root@49.12.7.18

# Restart gateway
ssh -i ~/.ssh/binance_futures_tool root@49.12.7.18 "cd /opt/opentrident && docker compose -f docker-compose.vps.yml restart opentrident-gateway"

# Tail live logs
ssh -i ~/.ssh/binance_futures_tool root@49.12.7.18 "docker logs opentrident-gateway -f --tail 50"
```

## Deployment

### Standard Deploy
```bash
# 1. SSH to VPS
ssh -i ~/.ssh/binance_futures_tool root@49.12.7.18

# 2. Navigate to runtime
cd /opt/opentrident

# 3. Commit changes (bypass pre-commit hooks for speed)
git add <files> && git commit --no-verify -m "feat: description"

# 4. Push to runtime repo
git push opentrident opentrident-prune:opentrident-prune

# 5. Add pnpm-lock.yaml temporarily
git add pnpm-lock.yaml

# 6. Build Docker image (uses local pnpm-lock.yaml)
docker build -t opentrident:<version> .

# 7. Unstage pnpm-lock.yaml (keep it untracked)
git reset HEAD pnpm-lock.yaml

# 8. Update .env with new image tag
sed -i 's/OPENTRIDENT_IMAGE=opentrident:<old>/OPENTRIDENT_IMAGE=opentrident:<new>/' .env

# 9. Tag as latest
docker tag opentrident:<version> opentrident:latest

# 10. Redeploy
docker compose -f docker-compose.vps.yml down && docker compose -f docker-compose.vps.yml up -d

# 11. Wait and verify
sleep 30 && curl http://127.0.0.1:18889/healthz
```

### Emergency Rollback
```bash
# Immediate rollback to previous image
sed -i 's/OPENTRIDENT_IMAGE=opentrident:<current>/OPENTRIDENT_IMAGE=opentrident:<previous>/' .env
docker compose -f docker-compose.vps.yml up -d
sleep 15 && curl http://127.0.0.1:18889/healthz
```

### Image History
```
r12 = 2026.4.14-r12  (current)  Trust ramp loop + autonomy auto-adjust
r11 = 2026.4.14-r11  Circuit breaker + retry-wrapped I/O
r10 = 2026.4.14-r10  Send mode handler + planner-executor
r9  = 2026.4.14-r9   Autonomy ladder wired into orchestrator (fix)
r8  = 2026.4.14-r8   Types + goal-origination expanded
r7  = 2026.4.14-r7   Market attention initial
r6  = 2026.4.14-r6   Baseline runtime
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
ssh -i ~/.ssh/binance_futures_tool root@49.12.7.18 "grep TELEGRAM_BOT_TOKEN /opt/opentrident/.env"

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

## Secrets

| Secret | Location | Notes |
|--------|----------|-------|
| Telegram Bot Token | `.env` (`TELEGRAM_BOT_TOKEN`) | Rotate via BotFather, update in `.env` |
| Gateway Token | `.env` (`OPENTRIDENT_GATEWAY_TOKEN`) | Used for internal auth |
| GitHub CLI Auth | `/root/.config/gh` | Mounted read-only into container |

## Development

### Testing changes locally
```bash
# Build on VPS (don't commit)
cd /opt/opentrident
git add <changed-files>

# Build test image
docker build -t opentrident:test .

# Deploy test
docker compose -f docker-compose.vps.yml up -d

# Verify
sleep 20 && curl http://127.0.0.1:18889/healthz

# If good: commit, push, build prod
```
