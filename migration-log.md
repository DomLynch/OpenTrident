# Migration Log — 2026-04-15

## Overview

First real self-migration of OpenTrident from VPS1 (49.12.7.18, Nuremberg) to VPS2 (87.99.148.214, Ashburn VA).

## Timeline (UTC)

| Time | Event |
|------|-------|
| 10:27 | VPS2 provisioned (cpx21, ash, Ubuntu 24.04) |
| 10:29 | First SSH attempt — password expired issue |
| 10:35 | Hetzner rescue mode enabled |
| 10:40 | Shadow file fixed, SSH key injected via rescue mode |
| 10:42 | VPS2 rebooted, SSH key access verified |
| 10:43 | Docker installed on VPS2 |
| 10:44 | Docker image transferred (640MB tar) from VPS1 |
| 10:45 | State files rsynced (4.1MB) |
| 10:46 | Runtime repo rsynced (103MB) |
| 10:47 | .env file copied to VPS2 |
| 10:48 | Docker containers started on VPS2 |
| 10:49 | VPS2 health check: healthy |
| 14:41 | Both VPS1 and VPS2 Telegram polling → 409 conflict |
| 14:44 | VPS1 gateway stopped (Telegram conflict resolution) |
| 14:45 | VPS1 CLI + workers stopped |
| 14:46 | VPS2 gateway restarted (clear conflict state) |
| 14:46 | Telegram polling clean on VPS2 — migration complete |

## Manual Steps Required

### SSH Key Setup (20 min)
VPS2 (Hetzner) cloud-init SSH key injection did NOT work on first boot. Root password was forced to expire on first login, blocking SSH key auth.

**Workaround:** Hetzner rescue mode + manual shadow file edit:
1. `POST /servers/{id}/actions/enable_rescue` with type=linux64
2. Reboot server
3. SSH to rescue image, mount disk, `sed -i 's/:0:/:20000:/' /mnt/etc/shadow`
4. Inject SSH key into `/mnt/root/.ssh/authorized_keys`
5. Reboot normally

**Fix for future:** Pre-create SSH key in Hetzner console, reference by fingerprint in `HETZNER_SSH_KEY_FINGERPRINT` env var.

### Hetzner API Token
`HETZNER_API_TOKEN` added to VPS1 .env. Was not present before migration attempt.

### BuildKit Required
Docker build on VPS2 failed without `DOCKER_BUILDKIT=1`. Image pre-loaded from VPS1 instead.

**Fix for future:** `export DOCKER_BUILDKIT=1` in deploy.sh or set `DOCKER_BUILDKIT=1` as daemon flag.

## Telegram Polling Conflict

Both VPS1 and VPS2 were polling Telegram simultaneously with the same bot token. Telegram responded with 409 Conflict to both.

**Resolution:** Stopped VPS1 gateway and all containers. VPS2 took over polling cleanly after VPS1 containers were stopped.

**Implication for self-migration:** The migration cutover is not clean with polling mode — there's a window where both servers conflict. Telegram resolves by giving messages to one instance, but the other gets continuous 409 errors until stopped.

**Fix for future (B.3/B.4):** Use leader election to ensure only one instance polls at a time. Or switch to webhook mode with a proxy that routes to the active leader.

## State Transfer

State files (4.1MB) transferred via rsync from VPS1 `/opt/opentrident-data/config/` to VPS2 same path. Included:
- planner-v1.json
- trust-telemetry-v1.json
- memory (SQLite at memory/main.sqlite)
- deployment-manifest.json
- market-attention-v1.json
- strategic-goals-v1.json

## Migration Result

| Criterion | Status |
|-----------|--------|
| New VPS running OpenTrident healthy | ✅ |
| Telegram bot responding from new host | ✅ (after conflict resolution) |
| Planner state intact on new host | ✅ (files transferred) |
| Memory accessible on new host | ✅ (SQLite present) |
| Trust telemetry accessible on new host | ✅ |
| Old VPS containers stopped | ✅ |
| VPS2 image tag | `opentrident:2026.4.15-r134636` |

## Bugs Found

1. **migrate.ts `deploy_to_new_server` is a stub** — generates manifest, provisions server, but never transfers deployment or runs deploy.sh. Manual rsync + docker load + docker compose was used instead.

2. **compute-provisioner.ts server types outdated** — uses `cx21` which is deprecated. Current API uses `cpx21`. Also `nbg1` not available for cpx21.

3. **No SSH key pre-configuration** — HETZNER_SSH_KEY_FINGERPRINT not set, cloud-init SSH injection didn't work.

4. **Deploy script needs BuildKit** — `DOCKER_BUILDKIT=1` required but not set.

## Post-Mortem

### What Worked
- Hetzner API provisioning via direct curl
- Docker image pre-loading (avoided 10+ min build)
- State file transfer via rsync
- SSH key injection via rescue mode
- Telegram polling conflict identified and resolved

### What Would Fail Next Time
1. Automatic deployment (deploy_to_new_server is stub)
2. DNS/webhook cutover (no public endpoint, polling mode only)
3. Rebuild from scratch on new host (no BuildKit default, no Hetzner SSH key)
4. cpx21 in nbg1 (location not available)

### Recommended Fixes (B.2)
1. Implement `deploy_to_new_server` in migrate.ts with rsync + docker load
2. Update server type from cx21 to cpx21 in compute-provisioner.ts
3. Add ash/hil locations as fallback for cpx21
4. Set HETZNER_SSH_KEY_FINGERPRINT in env before provisioning
5. Add `DOCKER_BUILDKIT=1` to deploy.sh

## New Server Details

| Field | Value |
|-------|-------|
| Provider | Hetzner Cloud |
| Server Type | cpx21 (4GB RAM, 80GB SSD) |
| Location | Ashburn, VA (ash) — nbg1 not available |
| IP | 87.99.148.214 |
| Server ID | 127036753 |
| Image | Ubuntu 24.04 |
| Docker Version | 29.1.3 |
| OpenTrident Image | opentrident:2026.4.15-r134636 |
| Containers | opentrident-gateway, opentrident-cli |
| Gateway Port | 127.0.0.1:18889 |
| Telegram | Polling (no webhook) |

## Old Server Status

All containers stopped. VPS1 (49.12.7.18) at `opentrident:2026.4.14-r35` (multi-instance: coordinator + 2 workers) and `opentrident:2026.4.15-r134636` (gateway + cli) are both offline.

Ready for decommission.
