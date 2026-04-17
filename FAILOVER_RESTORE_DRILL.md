# OpenTrident Failover + Restore Drill

**Decision:** this is the next expensive proof move.  
**Goal:** prove OpenTrident can survive leader loss and then cold-restore from the signed snapshot chain.  
**Standard:** no fake green. A drill only passes if Telegram continuity, failover state, and restored state all verify live.

---

## Scope

This runbook proves three things:

1. a second node can come up as a follower from the current bootstrap manifest
2. the follower can take over after leader loss
3. a third cold node can restore from the signed snapshot chain and boot cleanly

This is not a migration demo. It is a persistence drill.

---

## Current Live Inputs

- primary VPS: `49.12.7.18`
- primary runtime repo: `/opt/opentrident`
- primary identity repo: `/opt/OpenTrident`
- primary state dir: `/opt/opentrident-data/config`
- live snapshot head: `snap-2026041711-7171a6e8`
- current bootstrap manifest path: `/opt/opentrident-data/config/bootstrap.json`
- current bootstrap manifest snapshot URL: `snap-2026041709-fcfdc8e3`

**Load-bearing note:** the bootstrap manifest is currently stale relative to `snapshot-head`.  
Before the drill starts, regenerate bootstrap.json from the latest snapshot head.

**Second load-bearing note:** the current manifest uses `dockerImage: opentrident:latest`, which is a local tag, not a published registry image.  
That means nodes B and C must be pre-staged with the image from node A before bootstrap starts.

---

## Success Criteria

The drill only passes if all of these are true:

1. follower node boots from the refreshed bootstrap manifest
2. follower stays in follower mode while the leader is healthy
3. leader is intentionally stopped
4. follower takes over and becomes the active leader
5. Telegram still responds through the new leader
6. `/healthz` and `/readyz` stay green on the new leader
7. a third blank node restores from the signed snapshot chain
8. restored node comes up cleanly with the expected snapshot head
9. failover + restore evidence is captured in one log bundle

If any one of these fails, the drill is a failure.

---

## Timebox

- prep: 30 min
- follower bootstrap: 45 min
- forced leader-loss + takeover: 30 min
- cold restore on third node: 45 min
- evidence collection + teardown: 30 min

Total: about 3 hours.

---

## Infra Budget

Use cheap transient nodes for the drill:

- node A: existing primary `49.12.7.18`
- node B: temporary follower, Hetzner `cpx11`
- node C: temporary cold-restore node, Hetzner `cpx11`

Delete B and C after the drill unless one becomes the new primary.

---

## Preconditions

Do not start unless these are already true:

1. MacBook, GitHub, and VPS are synced and clean
2. primary node is healthy:
   - `/healthz`
   - `/readyz`
3. `snapshot-head` exists and is non-`none`
4. GitHub snapshot release for the latest snapshot head exists
5. `bootstrap.json` exists
6. Telegram bot is clean:
   - no 409 conflict churn
7. Docker footprint is bounded on the primary node

If any precondition fails, fix that first.

---

## Phase 0 — Regenerate Bootstrap Manifest

**Why:** current `bootstrap.json` points at `snap-2026041709-fcfdc8e3`, while live state is `snap-2026041711-7171a6e8`.

Run on primary:

```bash
ssh -i ~/.ssh/binance_futures_tool root@49.12.7.18
docker exec opentrident-gateway node /app/dist/index.js manifest bootstrap --json | tee /tmp/bootstrap.json
cp /tmp/bootstrap.json /opt/opentrident-data/config/bootstrap.json
cat /opt/opentrident-data/config/bootstrap.json
cat /opt/opentrident-data/config/snapshot-head
```

**Pass condition:** the snapshot URL inside `bootstrap.json` references the current `snapshot-head`.

---

## Phase 1 — Provision Follower Node

Provision node B in Hetzner:

- type: `cpx11`
- image: Ubuntu 24.04
- SSH key: existing MacBook Air M5 key
- name: `opentrident-follower-drill`

Record:

- public IP
- private/Tailscale IP if used
- server id

On node B:

```bash
ssh -i ~/.ssh/binance_futures_tool root@<NODE_B_IP>
apt-get update
apt-get install -y curl git rsync docker.io docker-compose-plugin nodejs npm
corepack enable || true
mkdir -p /opt/OpenTrident /opt/opentrident /opt/opentrident-data/config
```

Copy only what is needed:

```bash
rsync -avz -e "ssh -i ~/.ssh/binance_futures_tool" \
  root@49.12.7.18:/opt/OpenTrident/ /opt/OpenTrident/

rsync -avz -e "ssh -i ~/.ssh/binance_futures_tool" \
  root@49.12.7.18:/opt/opentrident/ /opt/opentrident/

rsync -avz -e "ssh -i ~/.ssh/binance_futures_tool" \
  root@49.12.7.18:/opt/opentrident-data/config/bootstrap.json /opt/opentrident-data/config/
```

Do **not** copy the full live state tree to the follower for this drill. The point is follower bootstrap from the signed path.

Install runtime deps so the host CLI can execute:

```bash
cd /opt/opentrident
pnpm install --prod
```

Pre-stage the live image from node A because the manifest references a local tag:

```bash
ssh -i ~/.ssh/binance_futures_tool root@49.12.7.18 \
  'docker save opentrident:latest | gzip -1' \
  | docker load
```

---

## Phase 2 — Bootstrap Follower From Manifest

On node B:

```bash
cd /opt/opentrident
cat /opt/opentrident-data/config/bootstrap.json
python3 -m http.server 18890 --directory /opt/opentrident-data/config
```

In a second shell, run the cold bootstrap command against that local URL:

```bash
cd /opt/opentrident
node dist/index.js bootstrap --from http://127.0.0.1:18890/bootstrap.json
```

Follower env rules:

- set unique `OPENTRIDENT_INSTANCE_ID`
- set follower mode explicitly if supported
- keep the same Telegram token only if the runtime follower path does **not** start polling while in follower mode

**Pass condition:** node B starts, reports follower state, and does **not** create a Telegram conflict while node A is still leader.

Evidence to capture:

```bash
curl -sf http://127.0.0.1:18889/api/dashboard-data
docker logs opentrident-gateway --tail 200
```

You want to see:

- follower mode
- observed leader present
- no takeover attempts
- no Telegram 409 churn

---

## Phase 3 — Force Leader Loss

On node A:

```bash
docker stop opentrident-gateway opentrident-cli
```

This is intentional leader loss. Do not delete state yet.

Now watch node B:

```bash
docker logs -f opentrident-gateway
curl -sf http://127.0.0.1:18889/api/dashboard-data
curl -sf http://127.0.0.1:18889/healthz
curl -sf http://127.0.0.1:18889/readyz
```

**Pass condition:**

- failover state changes from follower to leader
- takeover attempts increment
- last cycle status becomes live again
- Telegram responses now come from node B

Manual Telegram proof:

1. send a simple message to the bot
2. confirm response arrives
3. confirm node A is still down
4. confirm node B logs the response path

---

## Phase 4 — Cold Restore On Third Node

Provision node C:

- type: `cpx11`
- image: Ubuntu 24.04
- name: `opentrident-restore-drill`

On node C:

```bash
ssh -i ~/.ssh/binance_futures_tool root@<NODE_C_IP>
apt-get update
apt-get install -y curl git rsync docker.io docker-compose-plugin nodejs npm
corepack enable || true
mkdir -p /opt/OpenTrident /opt/opentrident /opt/opentrident-data/config
```

Copy only:

```bash
rsync -avz -e "ssh -i ~/.ssh/binance_futures_tool" \
  root@49.12.7.18:/opt/OpenTrident/ /opt/OpenTrident/

rsync -avz -e "ssh -i ~/.ssh/binance_futures_tool" \
  root@49.12.7.18:/opt/opentrident/ /opt/opentrident/

rsync -avz -e "ssh -i ~/.ssh/binance_futures_tool" \
  root@49.12.7.18:/opt/opentrident-data/config/bootstrap.json /opt/opentrident-data/config/
```

Install runtime deps and pre-stage the image:

```bash
cd /opt/opentrident
pnpm install --prod

ssh -i ~/.ssh/binance_futures_tool root@49.12.7.18 \
  'docker save opentrident:latest | gzip -1' \
  | docker load
```

Serve the manifest locally and restore from the signed snapshot chain only:

```bash
cd /opt/opentrident
python3 -m http.server 18890 --directory /opt/opentrident-data/config
```

Then in a second shell:

```bash
cd /opt/opentrident
node dist/index.js bootstrap --from http://127.0.0.1:18890/bootstrap.json
```

Then verify:

```bash
cat /opt/opentrident-data/config/snapshot-head
curl -sf http://127.0.0.1:18889/healthz
curl -sf http://127.0.0.1:18889/readyz
curl -sf http://127.0.0.1:18889/api/dashboard-data
```

**Pass condition:**

- restored node boots
- health is green
- snapshot head matches expected chain head or the manifest target
- signed snapshot verification passed as part of restore

---

## Phase 5 — Byte-Level State Checks

Compare load-bearing files between leader and restored node:

```bash
sha256sum /opt/opentrident-data/config/trust-telemetry-v1.json
sha256sum /opt/opentrident-data/config/bootstrap.json
sha256sum /opt/opentrident-data/config/snapshot-head
```

Also inspect:

- `planner-v1.json`
- `memory-v1.json`
- `doctrine-v1.json`
- `playbooks/playbook-store.json`

Not every file must match if the live leader advanced during the drill.  
What matters is:

- restore is internally coherent
- snapshot chain verifies
- no corrupted/missing state files

---

## Phase 6 — Evidence Bundle

Collect:

1. node A shutdown timestamp
2. node B takeover timestamp
3. Telegram response proof
4. node C restore timestamp
5. health checks from B and C
6. dashboard JSON from A pre-failure, B post-takeover, C post-restore
7. exact snapshot head used
8. exact bootstrap manifest used

Save to:

`/opt/opentrident-data/config/drills/failover-restore-YYYY-MM-DD/`

Minimum files:

- `primary-pre.json`
- `follower-post.json`
- `restore-post.json`
- `bootstrap.json`
- `snapshot-head.txt`
- `telegram-proof.txt`
- `sha256.txt`

---

## Rollback

If follower takeover fails:

1. restart node A
2. confirm Telegram returns to A
3. destroy node B
4. inspect follower logs and failover state

If cold restore fails:

1. keep node B as active leader if takeover already succeeded
2. destroy node C
3. fix restore path before retrying

Do not leave three half-configured nodes alive.

---

## Failure Modes To Watch

1. bootstrap manifest points at stale snapshot head
2. follower accidentally starts Telegram polling before takeover
3. leader/follower lock does not flip cleanly
4. restore path downloads bundle but fails signature verification
5. restored node boots with missing env or missing compose/runtime image
6. dashboard looks healthy but Telegram still points at the dead node

Any one of these makes the drill fail.

---

## AAA Pass Standard

This drill reaches AAA only if:

1. node B takes over with no human code changes mid-drill
2. Telegram continuity is proven live
3. node C restores from signed snapshots without ad-hoc file surgery
4. evidence bundle is written
5. both temporary nodes are destroyed or intentionally promoted after proof

Until then, persistence is promising, not proven.
