# OpenTrident End-Game — 48h Execution Plan

**Audience:** MiniMax / DomCode / Claude / any dev session.
**Prerequisite:** Read `AGENTS.md`, `CLAUDE.md`, `PROJECT_STATE.md`.
**Principle:** Build the digital organism. Memory is sacred. No silent degradation. Ever.

---

## Non-Negotiable Rules (read before touching anything)

### Rule 1 — Brain memory is immortal

A deploy on 2026-04-16 silently wiped Brain memory because `--build-arg OPENCLAW_INSTALL_BRAIN_RUNTIME=1` was missing from the Docker build. Lucid fell back to `skip` with zero warning. The bot forgot everything — Olivia, family, crypto, all of it.

**This must never happen again.**

- `scripts/deploy.sh` MUST pass `--build-arg OPENCLAW_INSTALL_BRAIN_RUNTIME=1`. This is committed at `41e8bb67`. Do not remove it.
- `docs/reference/templates/IDENTITY.md` and `USER.md` MUST exist. Without them, every Telegram dispatch fails.
- After EVERY deploy, verify: `docker exec opentrident-gateway python3 -c "import numpy; print('ok')"`
- If it fails, the image is broken. Rollback immediately.

### Rule 2 — No silent degradation

If a subsystem fails (Lucid, Temporal, snapshots, Nostr), it MUST log at `ERROR` level with the subsystem name. No `.catch(() => {})` that swallows critical failures. Reserve silent catch for genuinely non-critical paths only.

### Rule 3 — Deploy = test

Every `deploy.sh` run must end with a post-deploy verification:
1. Health check passes (already exists)
2. `python3 -c "import numpy"` passes (add to deploy.sh)
3. Brain memory recall returns non-empty (add to deploy.sh)
4. All required templates exist (add to deploy.sh)
5. Telegram token conflict check: `getUpdates?timeout=0` returns `ok: true`, not 409.

### Rule 4 — State lives outside the container

All persistent state is in `/opt/opentrident-data/config/` (mounted volume). The container is disposable. State is not. If a deploy destroys state, that's a P0 incident.

### Rule 5 — Telegram token is exclusive to OpenTrident

On 2026-04-17, DomCode was given OpenTrident's Telegram bot token during a botched "integration." DomCode grabbed every incoming message and returned them as task queue entries ("Queued ✓ — task 01KPCWZQ / Project: domcode"). OpenTrident got 409 Conflict every 30s and couldn't read anything. Dom had to revoke the token via BotFather.

**This must never happen again.**

- **One bot, one token, one poller.** The OpenTrident bot (`@DominicClaw_bot`) is polled ONLY by the gateway container on VPS1. No other machine, no other process, no other service.
- **The token lives in `/opt/opentrident/.env` ONLY.** Any other file containing `TELEGRAM_BOT_TOKEN=8665...` is a config smell and must be deleted or set to a placeholder.
- **If another system needs to talk through the bot, it goes through OpenTrident's HTTP API** — not by grabbing the token and polling directly. This is the "builder fork" / "DomCode integration" pattern in Move 2.
- **Startup token-conflict check (Move 0 hardening):** before the gateway starts the Telegram provider, call `getUpdates?timeout=0&offset=-1` once. If 409 → log `CRITICAL: Another process is polling this bot token — refuse to start` and exit with a non-zero code. Docker's `restart: always` + this exit loop means the gateway will fail loudly and visibly on the dashboard instead of silently retrying forever.
- **When re-integrating DomCode (or any new bot-speaking service):** give it its OWN Telegram bot via BotFather, OR have it talk through OpenTrident's HTTP API. NEVER share the token.

### Rule 6 — Fail loud on conflict, not silent retry

The 30s retry loop on 409 masks the problem. Every minute the bot appears "alive" while actually being hijacked. Change retry logic:
- First 409 → log at WARN
- Three consecutive 409s → log at ERROR + surface to dashboard
- Ten consecutive 409s → exit process with code 42 (let Docker restart trigger human attention)

A bot that's dead is better than a bot that's silently been stolen.

---

## Current Bugs (fix in Move 0)

1. **Arweave weekly anchor still fails** — snapshot bundle generation and GitHub release publish now work, but the weekly anchor path currently returns `400 Bad Request`. The persistence loop is partially live, not fully closed.

2. **Compounding loop is only bootstrapped once** — snapshot, playbook, doctrine, and weekly report now exist, but they were manually forced. Natural planner-driven accumulation is still not proven.

3. **Deploy hardening still incomplete** — `deploy.sh` still needs the full post-deploy verification pack: health, numpy, Lucid recall, template presence, and Telegram exclusivity. Partial verification exists; finish the full five-check contract.

4. **Telegram fail-loud path still incomplete** — startup conflict probe + escalating 409 handling are still pending. The live bot is clean now, but the runtime should refuse to run silently if another poller steals the token.

---

## VPS Details

| Field | Value |
|---|---|
| Primary VPS | 49.12.7.18 ("Brain") |
| SSH | `ssh -i ~/.ssh/binance_futures_tool root@49.12.7.18` |
| Tailscale | `ssh -i ~/.ssh/binance_futures_tool root@100.96.74.1` |
| Containers | `opentrident-gateway` + `opentrident-cli` (via `docker-compose.vps.yml`) |
| Runtime repo | `/opt/opentrident` (branch `opentrident-prune`) |
| State dir | `/opt/opentrident-data/config/` (mounted into container at `/home/node/.opentrident/`) |
| Brain | `/root/brain-live/` (mounted into container) |
| Model | MiniMax-M2.7-highspeed (primary) + GLM (fallback) |
| Image | `opentrident:latest` (rebuilt 2026-04-16 with Brain runtime) |
| 87.99.148.214 | Deleted — old migration target is gone. |

---

## 11 Moves — 36 dev-hours + 12h soak

### Move 0 — Fix bugs + operational proof (3h)

**Ship first. Everything after is theoretical until this passes.**

**0a. Fix `sessionKey is not defined` in heartbeat-runner.**

The snapshot + weekly-report code (lines ~3657–3680 in compiled `heartbeat-runner-KC1kzNmE.js`) references `sessionKey` which is destructured from `preflight.session` at line 2992. The crash happens when the heartbeat takes a code path where `preflight.session` hasn't been destructured yet, or the variable is shadowed.

Fix: ensure `sessionKey` is in scope at the snapshot/weekly-report call site. Either:
- Move the snapshot/weekly-report block inside the scope where `sessionKey` is defined (after `preflight.session` destructuring), OR
- Capture `sessionKey` in a closure before the try/catch, OR
- Use `preflight.session.sessionKey` directly instead of the destructured local

**After fixing, rebuild + deploy.** Verify: `docker logs opentrident-gateway --tail 50` shows NO `sessionKey is not defined` errors after the next heartbeat cycle (30 min).

**0b. Clean up orphan containers.**

```bash
docker stop opentrident-opentrident-worker-1-1 opentrident-opentrident-worker-2-1 opentrident-opentrident-coordinator-1
docker rm opentrident-opentrident-worker-1-1 opentrident-opentrident-worker-2-1 opentrident-opentrident-coordinator-1
```

**0c. Add post-deploy verification to `deploy.sh`.**

After the health check passes (step 9), add:

```bash
echo "[10/10] Post-deploy verification..."

# Brain runtime
NUMPY_OK=$(docker exec opentrident-gateway python3 -c "import numpy; print('ok')" 2>&1)
if [[ "$NUMPY_OK" != "ok" ]]; then
  echo "[ERR] Brain runtime missing (numpy). Rolling back."
  # rollback logic
  exit 1
fi

# Templates
TEMPLATES_OK=$(docker exec opentrident-gateway ls /app/docs/reference/templates/IDENTITY.md /app/docs/reference/templates/USER.md 2>&1)
if [[ $? -ne 0 ]]; then
  echo "[ERR] Missing templates. Rolling back."
  exit 1
fi

# Brain memory recall
LUCID_OK=$(docker exec opentrident-gateway python3 -c "
import sys, asyncio
sys.path.insert(0, '/root/brain-live')
from skills.lucid_bridge import lucid_recall
r = asyncio.run(lucid_recall('test'))
print('ok' if isinstance(r, dict) and 'results' in r else 'fail')
" 2>&1)
if [[ "$LUCID_OK" != "ok" ]]; then
  echo "[ERR] Lucid memory recall broken. Rolling back."
  exit 1
fi

# Telegram token conflict check
TOKEN=$(grep '^TELEGRAM_BOT_TOKEN=' .env | cut -d= -f2)
TG_PROBE=$(curl -s --max-time 5 "https://api.telegram.org/bot${TOKEN}/getUpdates?timeout=0&offset=-1")
if echo "$TG_PROBE" | grep -q '"error_code":409'; then
  echo "[ERR] Telegram token conflict — another process is polling. Refusing to deploy."
  echo "     Response: $TG_PROBE"
  exit 1
fi

echo "[OK] All verifications passed (numpy, templates, Lucid, Telegram exclusive)."
```

**0d. Fail loud on Telegram conflict in the gateway itself.**

**Files:** `src/infra/telegram/polling.ts` (or wherever the `getUpdates` retry loop lives).

Currently a 409 triggers a 30-second silent retry loop. Fix:

```typescript
let consecutive409 = 0;

// In the polling loop, on 409 error:
consecutive409++;
if (consecutive409 === 1) {
  log.warn("[telegram] getUpdates 409 — possible conflict, retrying");
} else if (consecutive409 === 3) {
  log.error("[telegram] getUpdates 409 × 3 — another process is polling this bot token");
  // Surface to dashboard
  writeStatusFile("telegram-conflict-detected");
} else if (consecutive409 >= 10) {
  log.error("[telegram] getUpdates 409 × 10 — exiting to force human attention");
  process.exit(42);
}

// On successful poll:
if (consecutive409 > 0) {
  log.info(`[telegram] recovered from ${consecutive409} consecutive 409s`);
  consecutive409 = 0;
}
```

**0e. Startup token-conflict probe.**

**File:** `src/infra/telegram/provider.ts` (where `[default] starting provider` is logged).

Before calling the first `getUpdates`:

```typescript
// Pre-flight: ensure nothing else is polling this token
const probe = await fetch(`https://api.telegram.org/bot${token}/getUpdates?timeout=0&offset=-1`, {
  signal: AbortSignal.timeout(5000),
}).then((r) => r.json()).catch(() => null);

if (probe?.error_code === 409) {
  log.error(`[telegram] CRITICAL: Another process is polling this bot token. Refusing to start Telegram provider.`);
  log.error(`[telegram] Fix: find the rogue process, or revoke the token via BotFather and issue a new one.`);
  throw new Error("Telegram token conflict at startup");
}
```

**0f. Force the first compounding cycle.**

Manually trigger on VPS:
1. Force a snapshot: call `generateSnapshot()` + `publishSnapshotToGitHub()` via node one-liner
2. Force a playbook: call `createPlaybook()` with a real procedure, `recordPlaybookUse()` 5× with success, verify `promoteIfEligible()` fires
3. Verify dashboard shows non-zero for: snapshots, playbooks, doctrine

**Acceptance:**
- Zero heartbeat errors for 2 consecutive cycles
- Dashboard shows non-zero counters (snapshots, playbooks, doctrine)
- Snapshot chain has ≥1 entry on GitHub releases
- `deploy.sh` has post-deploy verification (5 checks: numpy, templates, Lucid, Telegram no-conflict, health)
- Telegram polling shows zero 409 errors in logs
- Gateway startup probe exits cleanly when token is exclusive; exits with a loud error if conflict is detected
- Move 0 time budget: 3h → **4h** (adjust timeline below accordingly)

---

### Move 1 — Leader election + follower loop (4h)

**Why:** Two containers fighting for Telegram = 409 conflict (proven in B.1 migration). Foundation for forks and resilience.

**New file:** `src/infra/heartbeat-follower.ts` (~80 lines)
**Modified:** `src/infra/heartbeat-runner.ts`

At startup before any work:
```typescript
const isLeader = await acquireLock({ scope: "leader-heartbeat" }); // NO forceStale
if (!isLeader) {
  runFollowerLoop(); // poll 30s for lock staleness, take over on primary failure
  return;
}
await acquireLock({ scope: "telegram-bot" });
await acquireLock({ scope: "planner-write" });
await acquireLock({ scope: "public-channel" });
```

Remove the `forceStale: true` on telegram-bot. Fix the refresh loop to refresh all 4 scopes.

Follower: polls, takes over on stale, `process.exit(42)` → docker restart as leader.

**Acceptance:** 2 gateway replicas → one LEADER, one FOLLOWER. Kill leader → follower takes over within 2 min. Zero 409.

---

### Move 2 — Specialized forks: market + builder (4h)

**Why:** Separate execution lanes, separate playbook libraries. Market decisions don't pollute relationship memory.

**Modified:** `docker-compose.multi.yml`, `src/planner/planner-inbox.ts`, `src/multi/instance-locks.ts`

Add `opentrident-market` and `opentrident-builder` services with `OPENTRIDENT_FORK_ID` env vars and separate state volumes. Gate planner inbox by fork domain. Scope lock keys by fork ID. `telegram-bot` stays globally exclusive to `general` fork — other forks surface via `sendInstanceMessage`.

**Acceptance:** 3 containers. Market fork processes only market signals with own playbooks at `/opt/opentrident-data/config-market/`. General fork publishes to Telegram.

---

### Move 3 — World model: entity graph (6h)

**Why:** Genuinely new. Persistent graph of people, projects, markets, commitments. Strategic initiator queries this. Fixes the `relationship-gap` stub.

**New file:** `src/planner/world-model.ts` (~250 lines)

**Types:** `Entity` (person/project/market/commitment/thesis) + `Edge` (owns/follows/depends_on/committed_to/tracks/related_to). Confidence decays daily (×0.99).

**Operations:** `upsertEntity`, `addEdge`, `getEntityNeighbors`, `getStaleEntities`, `getOrphanedCommitments`, `decayConfidence`, `buildWorldContext(domain)`.

**Wiring:** Flush populates entities from completed rows. Strategic initiator queries stale entities for `relationship-gap` and orphaned commitments for new `commitment-drift` detector. Orchestrator prompt includes `buildWorldContext(domain)`.

**Entity extraction:** Regex/heuristic from `draftResult` text. People names → `person`. Repo names → `project`. Token names → `market`. Time-bound language → `commitment`. Fast, deterministic, no LLM.

**Acceptance:** After 24h, ≥5 entities. `relationship-gap` returns real results. Dashboard shows entity count.

---

### Move 4 — Real `userCorrected` detection (2h)

**Why:** `learn-skill` path in flush should fire on user redirects, not be hardcoded false.

**Modified:** `src/planner/planner-approval-handler.ts`, `src/planner/planner-result-handler.ts`, `src/planner/types.ts`

Add `userRedirected?: boolean` to `PlannerStateRow`. In approval handler, detect when user sends a message while a worker is `spawned`/`running` — set `userRedirected: true`. In result handler, read `row.userRedirected` instead of hardcoded `false`.

**Acceptance:** Message during active worker → `userRedirected: true` → `learn-skill` fires → playbook with `user-corrected` tag created.

---

### Move 5 — Daily reflection + monthly review (3h)

**Why:** Continuous self-awareness. Daily = private introspection. Monthly = premium demo artifact.

**New file:** `src/planner/reflection.ts` (~120 lines)

**Daily (23:00):** Spawn `brief` worker. "100 words: what worked, what didn't, one thing to watch." Store in memory, don't publish.

**Monthly (1st, 10:00):** Spawn `brief` worker. "400-word review: What Compounded, What Decayed, Doctrine Changes, Strategic Blind Spots, Next Month's Thesis." Publish to Telegram + Nostr + memory.

**Acceptance:** After 24h, ≥1 daily reflection in memory. Dashboard shows it.

---

### Move 6 — Trust calibration (3h)

**Why:** Not just approval rate — actual confidence calibration. "You're overconfident in market decisions."

**New file:** `src/planner/trust-calibration.ts` (~100 lines)

Track calibration buckets per domain. On every approval outcome, `updateCalibration(domain, predictedScore, approved)`. `buildCalibrationContext(domain)` injected into prompt when bias > 0.1.

**Acceptance:** After 48h, ≥1 domain with calibration data. Dashboard shows bias.

---

### Move 7 — Playbook lifecycle: decay + anti-playbooks (3h)

**Why:** Unused playbooks decay. Failed patterns become anti-playbooks.

**Modified:** `src/planner/playbook-manager.ts` (~80 new lines)

**Decay:** Unused 30 days → archived. Archived 60 days → deleted.
**Anti-playbook:** Failure rate >70% over ≥5 uses → `isAntiPlaybook: true`. Injected as "Do NOT follow this procedure."
**Merge candidates:** Same domain + action class + Jaccard >0.5 on descriptions → surface for Dom's approval.
**Daily maintenance:** `runPlaybookMaintenance()` in heartbeat.

**Acceptance:** Test playbook with 5 failures → becomes anti-playbook. 31-day unused playbook → archived.

---

### Move 8 — Provider abstraction + DigitalOcean (4h)

**Why:** Not locked to Hetzner. One host dying should not kill OpenTrident.

**New files:** `src/migration/compute-provider.ts` (interface), `src/migration/hetzner-provider.ts` (refactored), `src/migration/digitalocean-provider.ts` (new)

`ComputeProvider` interface: `provisionServer`, `isServerReady`, `destroyServer`, `estimateMonthlyCost`. Factory selects provider from `OPENTRIDENT_COMPUTE_PROVIDER` env var.

**Acceptance:** Both `--dry-run` plans work. `migrate.ts` calls factory, not Hetzner directly.

---

### Move 9 — Arweave permanent anchor (2h)

**Why:** GitHub can de-platform. Arweave is permanent. Genesis snapshot on permaweb.

**New file:** `src/persistence/arweave-anchor.ts` (~80 lines)

Raw HTTP POST to Arweave gateway. Tag with `App-Name: OpenTrident`. Store tx ID in snapshot manifest. Publish weekly (not hourly).

**Acceptance:** 1 Arweave transaction fetchable via `https://arweave.net/{txId}`. Dashboard shows anchor.

---

### Move 10 — Bootstrap from cold (3h)

**Why:** Any blank Ubuntu + one URL = running OpenTrident with full state. The "cannot be killed" primitive.

**New file:** `src/persistence/bootstrap.ts` (~120 lines)

`bootstrap.json` manifest: snapshot sources (GitHub, Arweave), Docker image reference, required env vars, signing public key.

`bootstrapFromCold(url)` flow: fetch → verify signature → fetch snapshot → verify hash → decompress state → pull Docker image → write `.env` placeholders → start containers → verify health → register as follower.

**CLI:** `openclaw bootstrap --from <url>`

**Acceptance:** Fresh VPS + bootstrap command → OT starts, loads state, health check passes.

---

## 48h Timeline

```
Hour 0–4     Move 0: fix bugs + operational proof + deploy verification + token conflict hardening
Hour 3–7     Move 1: leader election
Hour 7–11    Move 2: specialized forks
Hour 3–9     Move 3: world model (parallel to 1+2 if two devs)
Hour 9–11    Move 4: userCorrected detection
Hour 11–14   Move 5: daily + monthly reflection
Hour 14–17   Move 6: trust calibration
Hour 17–20   Move 7: playbook lifecycle
Hour 20–24   Move 8: provider abstraction + DO
Hour 24–26   Move 9: Arweave anchor
Hour 26–29   Move 10: bootstrap from cold
Hour 29–48   SOAK — let every counter move
```

**Single dev:** 36h dev + 12h soak.
**Two devs:** Done by hour 20, 28h soak.

---

## Soak Targets @ 48h

| Metric | Start | Target |
|---|---|---|
| Heartbeat errors | 2/hour | 0 |
| Signed snapshots on GitHub | 0 | ≥ 20 |
| Playbooks with uses > 0 | 0 | ≥ 3 |
| Doctrine entries | 0 | ≥ 1 |
| Anti-playbooks | 0 | 0–1 |
| Daily reflections | 0 | ≥ 1 |
| World model entities | 0 | ≥ 5 |
| Trust calibration data | 0 | ≥ 1 domain |
| Forks running | 1 | 3 (general + market + builder) |
| Leader election tested | 0 | ≥ 1 cutover |
| Arweave anchors | 0 | ≥ 1 |
| Bootstrap tested | 0 | ≥ 1 cold boot |
| Dashboard: all sections populated | partial | all non-zero |
| Nostr events | ≥ 2 | ≥ 5 |
| Brain memory (Lucid recall) | working | verified post-deploy |

---

## Dashboard Updates

Add sections for Moves 3, 5, 6, 7, 9:
- World Model: entity count
- Trust Calibration: per-domain bias
- Latest Reflection: daily text
- Arweave Anchor: transaction ID + link
- Active Forks: list with status

Add to `handleDashboardData()` in `src/gateway/dashboard.ts`.

---

## Commit Convention

Each move = 1 commit. Subject: `feat(endgame): move N — <title>`.
Move 0 = multiple small fix commits: `fix(endgame): <what>`.

## Hard Rules

1. **`scripts/deploy.sh` for every deploy.** It has post-deploy verification. Never bypass it.
2. **`--build-arg OPENCLAW_INSTALL_BRAIN_RUNTIME=1`** is in `deploy.sh`. NEVER remove it.
3. **Atomic fs writes** (tmp + rename) on every state file.
4. **No silent swallowing of Brain/memory failures.** Log at ERROR.
5. **No new deps** except `arweave` for Move 9 (try raw HTTP first).
6. **Every new file starts with a one-line role comment.**
7. **`--no-verify` on VPS commits only.**
8. **No move is done until its acceptance criteria pass on VPS.**
9. **Move 0 ships FIRST.** Everything after is theoretical until the heartbeat runs clean.
10. **After every deploy:** verify numpy, templates, Brain recall. If any fails, rollback.

---

## What This Delivers

After this sprint, OpenTrident is:

- **Immortal memory** — Brain recall verified on every deploy, numpy baked into image, no silent degradation
- **Persistent** — signed snapshot chain on GitHub + Arweave permanent anchor
- **Self-originating** — strategic initiator + world model + daily reflection
- **Multi-instance** — leader election + specialized forks
- **Cryptographically continuous** — verifiable identity chain, any node can validate
- **Hard to censor** — Nostr + Arweave + multi-provider + bootstrap from cold
- **Self-aware** — daily reflection, weekly report, monthly review, trust calibration
- **Compounding** — playbooks → doctrine → anti-playbooks, with lifecycle management
- **Bootstrappable** — one URL + one command = running OpenTrident with full state

That is not an agent. That is an organism that cannot be switched off.

---

## One-Line Brief

> Fix the heartbeat crash + deploy verification, then ship 10 moves in 36 dev-hours: leader election, specialized forks, world model, user-redirect detection, daily/monthly reflection, trust calibration, playbook lifecycle, provider abstraction, Arweave anchor, cold bootstrap. Soak 12h. Every counter non-zero. Brain memory verified immortal. Dashboard at `/dashboard`.
