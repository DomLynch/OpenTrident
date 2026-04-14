# OpenTrident Roadmap

Detailed implementation plan for all remaining gaps.
Intended audience: any dev session (MiniMax, Claude, Codex, human) working on OpenTrident.

## Current Baseline (r18)

Working:
- planner v1: inbox → goal origination → orchestrator → surface/spawn_readonly
- security: evidence sanitization, domain/action validation, 10 spawns/hour rate limit
- trust telemetry: by-domain, by-source, 7-day trend, scorecard
- autonomy ladder: 4-tier per-domain, auto-promote/demote based on approval history
- signals: attention v2 (6 types), Gmail v1, GitHub/repo v1
- memory: Brain adapter (Lucid + Temporal + corpus), local memory-v1.json
- models: MiniMax primary, GLM 5.1 fallback
- surface: Telegram live
- infra: VPS gateway + CLI containers, backup automation

Not working yet: everything below.

---

## Phase 1: Richer Planner Execution

**Goal:** Planner can do more than surface text. It can spawn real bounded workers that produce drafts, briefs, and issues — and track them to completion.

### T1.1: Action Class Expansion

File: `src/planner/planner-orchestrator.ts`

Current `resolveMode` only produces `idle`, `surface`, `spawn_readonly`, `send`.
The type system already defines `draft_reply`, `draft_issue`, `brief` as valid action classes.
Goal origination already maps signals to these classes.
But the orchestrator treats them all as `spawn_readonly` or `surface`.

Build:
- `spawn_readonly` → spawn worker, read-only output, surface result to Telegram
- `draft_reply` → spawn worker that produces a draft message, surface for confirmation, hold in `awaiting_confirmation`
- `draft_issue` → spawn worker that produces a GitHub issue body, surface for confirmation
- `brief` → spawn worker that produces an analytical brief, surface directly (no confirmation needed)
- `send_reply` → spawn worker that drafts, surface for confirmation, execute send on approval

Each action class needs:
- a prompt template telling the worker what to produce
- a result handler that captures the worker output
- a state transition: `spawned → running → done` or `spawned → running → awaiting_confirmation → approved/rejected → done`

File: `src/planner/action-templates.ts` (new)

```ts
export type ActionTemplate = {
  actionClass: PlannerActionClass;
  systemPrompt: string;
  requiresConfirmation: boolean;
  maxDurationMs: number;
  outputFormat: "text" | "markdown" | "json";
};
```

Define one template per action class. Keep them short — the model is the intelligence, the template is the constraint.

### T1.2: Worker Spawn → Result → Record Loop

Files:
- `src/planner/planner-spawn.ts` (exists, needs extension)
- `src/planner/planner-result-handler.ts` (new)

Current state: `planner-spawn.ts` exists but the full loop (spawn → monitor → capture output → update planner state → surface result) is not wired.

Build:
1. `spawnPlannerWorker(decision, template)` → uses existing `subagent-spawn.ts` API
2. Worker runs with the action template as system prompt + planner context as user prompt
3. On worker completion (via existing `subagent-lifecycle-events.ts`):
   - capture output text
   - call `updatePlannerRow` with status `done` + `draftResult`
   - if `requiresConfirmation`: set status to `awaiting_confirmation`, surface draft to Telegram with approve/reject prompt
   - if no confirmation needed: surface result directly

4. On worker failure/timeout:
   - call `updatePlannerRow` with status `failed`
   - feed into recovery scanner

Integration point: `heartbeat-runner.ts` already calls `spawnPlannerReadonlyTask`. Extend that call site to use the new action templates.

### T1.3: Confirmation Flow Hardening

Files:
- `src/planner/planner-executor.ts` (exists, needs real send wiring)
- `src/planner/planner-state.ts` (exists)

Current state: `parseApprovalResponse` exists. `executeApprovedSend` is a stub.

Build:
1. When planner surfaces a `draft_reply` or `send_reply` result to Telegram:
   - include a confirmation token in the message
   - set planner row to `awaiting_confirmation`
2. When user replies with approval text:
   - `parseApprovalResponse` matches the reply
   - look up pending row by session/token
   - if approved: execute the action (send message, create issue, etc.)
   - if rejected: set row to `rejected`, record in trust telemetry
   - if modified: user provides edited content, execute with modifications, record as `modified`
3. Wire `executeApprovedSend` to the actual Telegram/email/GitHub send APIs available in the runtime

Important: this is where the identity repo stub and the VPS runtime diverge. The identity repo keeps the stub. The VPS runtime needs real send wiring. Document which functions are stubs vs live in both repos.

### T1.4: Recovery Hardening

File: `src/planner/planner-recovery.ts` (exists, needs extension)

Current state: detects stale runs (6h) and blocked rows (90min). Only actions are `retry` and `escalate`.

Build:
- Add `downgrade` action: if a `send_reply` fails repeatedly, downgrade to `draft_reply` (surface only, no send)
- Add `abandon` action: if retry count exceeds 3, mark as `dropped` with reason
- Add retry counter to `PlannerStateRow` (new field: `retryCount`)
- Wire recovery actions into heartbeat-runner: on each idle heartbeat, run recovery scan, execute pending actions
- Add escalation surfacing: when a row is escalated, send a Telegram message explaining what's stuck and why

### T1.5: VPS Runtime Repo Auto-Sync

Current state: manual sync, was 2 days behind during audit.

Build:
- Cron job on VPS: every commit to `opentrident-prune`, push to `DomLynch/OpenTrident-runtime`
- Or: post-build hook in the Docker build script that auto-pushes
- Or: GitHub Action on the runtime repo that pulls from VPS on schedule

Simplest: add to the existing backup cron script:
```bash
cd /opt/opentrident && git push origin opentrident-prune 2>/dev/null || true
```

---

## Phase 2: Market/News Signal Inbox

**Goal:** OpenTrident sees market and news events, not just email and code.

### T2.1: Market Signal Collector

File: `src/infra/heartbeat-market-attention.ts` (exists as skeleton)

Build:
1. Define signal sources:
   - Crypto prices (CoinGecko API, free tier, no auth needed)
   - Hacker News top stories (API is free, no auth)
   - GitHub trending repos (scrape or API)
   - RSS feeds (configurable list)

2. Collector function: `collectMarketSignals(config): MarketSignal[]`
   - each signal has: source, title, summary, url, relevance_score, timestamp
   - relevance scoring: keyword match against a configurable watchlist (e.g., "AI agents", "OpenClaw", "Anthropic", "crypto", project names)
   - dedup: hash title + source, skip if seen in last 24h

3. Storage: `market-signals-v1.json` in state dir, rolling 7-day window, max 200 entries

4. Integration: wire into `buildPlannerInbox` as a new signal source alongside Gmail and GitHub
   - map to `market_unreviewed` attention signal
   - domain: `market`
   - score based on keyword relevance + recency

### T2.2: Watchlist Configuration

File: `src/config/market-watchlist.ts` (new)

```ts
export type WatchlistEntry = {
  keyword: string;
  weight: number; // 0.0 - 1.0
  domain: PlannerDomain;
};
```

Default watchlist:
- AI agents, autonomous AI, digital twin (weight: 0.9, domain: market)
- OpenClaw, OpenAI, Anthropic, Claude (weight: 0.8, domain: market)
- Solana, Ethereum, crypto (weight: 0.6, domain: market)
- Each active project name from PROJECT_STATE (weight: 0.7, domain: project)

Watchlist should be editable via Telegram command or config file.

### T2.3: Rate Limiting and Cost Awareness

API calls cost attention and sometimes money. Budget:
- CoinGecko: 30 calls/min free tier. Poll every 15 min max.
- HN: no limit but be polite. Poll every 30 min.
- RSS: per-feed, poll every 1h.
- Total market heartbeat budget: run collector once per heartbeat cycle (existing idle-only cadence), not independently.

---

## Phase 3: Autonomous Task Loop v1

**Goal:** OpenTrident can run a full decide → act → remember → adapt cycle without human initiation.

### T3.1: Loop Runner

File: `src/planner/autonomous-loop.ts` (new)

This is the bridge between "planner that runs during heartbeat" and "system that runs continuously."

Build:
1. `runAutonomousLoop(config)`:
   - check: is there a pending planner goal with score >= threshold?
   - check: is there capacity to spawn? (rate limit, active run count)
   - check: has the last autonomous action been reviewed? (don't pile up unreviewed work)
   - if all yes: select top goal, spawn worker, track lifecycle
   - if no: sleep until next heartbeat

2. Loop cadence: piggyback on existing heartbeat-runner idle cycle. Do NOT create a separate loop/cron. The heartbeat is already the right cadence.

3. Gate: autonomous loop only fires when:
   - no active Telegram conversation (user isn't chatting)
   - no active spawned workers at capacity
   - trust telemetry approval rate >= 70% in last 7 days
   - at least 5 prior approved actions exist (cold start protection)

### T3.2: Run-Until-Done Workers

Currently workers are fire-and-forget with timeout. For autonomous loop, workers need:

Build:
1. Self-assessment check: worker includes a final step "am I done? did I produce the expected output?"
2. If not done and under max duration: continue
3. If stuck: emit `blocked` status, recovery scanner picks up
4. Max duration per action class:
   - `brief`: 5 min
   - `draft_reply`: 3 min
   - `draft_issue`: 5 min
   - `spawn_readonly`: 10 min
   - `send_reply`: 3 min (draft phase) + confirmation wait

### T3.3: Memory Write-Back

File: `src/planner/planner-memory.ts` (exists)

After each completed autonomous action:
1. Extract key decision/outcome
2. `recordMemory({ key, value, category, source: "autonomous-loop" })`
3. Categories:
   - `decision`: "decided to follow up with X because Y"
   - `project`: "repo Z had stale CI, opened issue"
   - `relationship`: "sent follow-up to X, response pending"

This is how the loop learns. Memory accumulates. Future planner decisions reference past outcomes.

### T3.4: Adapt — Autonomy Ladder Feedback

After each autonomous action outcome is recorded:
1. `adjustDomainAutonomy` (already exists) evaluates approval/rejection history
2. If approval rate drops: auto-demote domain to lower autonomy tier
3. If approval rate is high: auto-promote (with ceiling)
4. Log level changes to trust telemetry

This creates the feedback loop: act → outcome → adjust trust → change future behavior.

---

## Phase 4: Economic Layer

**Goal:** OpenTrident can hold, spend, and earn money. This is the independence primitive.

### T4.1: Wallet Integration

File: `src/economic/wallet.ts` (new)

Build:
1. Solana wallet (best programmatic tooling, lowest fees)
   - generate keypair, store encrypted in state dir
   - read balance
   - send SOL/SPL tokens
   - receive (monitor address for incoming)

2. Dependencies: `@solana/web3.js` — well-maintained, TypeScript-native

3. Security:
   - private key encrypted at rest with a passphrase
   - passphrase stored in environment variable, not in code or config
   - all send operations require planner confirmation flow (same as `send_reply`)
   - hard cap: max transaction value configurable, default 0.1 SOL per action
   - daily spending limit: configurable, default 1 SOL/day

### T4.2: Cost Ledger

File: `src/economic/cost-ledger.ts` (new)

Build:
1. Track:
   - VPS cost (fixed monthly, enter manually or read from provider API)
   - Model API costs (track tokens used per heartbeat/worker, multiply by rate)
   - Total daily/weekly/monthly burn
   - Revenue (incoming transactions to wallet)

2. Expose to planner: `buildCostContext()` returns a string block like:
   ```
   Economic context:
   - Daily burn: $X.XX
   - Wallet balance: X.XX SOL ($Y.YY)
   - Revenue this week: $Z.ZZ
   - Runway: N days at current burn
   ```

3. Wire into heartbeat prompt so the model is aware of its own economics

### T4.3: Revenue Primitive v1

Start with the simplest possible revenue source:

Option A — Paid signal channel:
- OpenTrident publishes market/signal analysis to a public Telegram channel
- Gated access via Telegram bot (check payment before adding to channel)
- Payment in SOL to OpenTrident's wallet

Option B — API endpoint:
- OpenTrident exposes a signal/analysis API
- Consumers pay per query in SOL
- Implemented as an edge function or gateway endpoint

Option C — Trading:
- OpenTrident places small trades based on market signals
- Highest risk, highest potential, needs the most trust ramp
- Only after autonomy ladder is proven and approval rate is >90%

Recommendation: start with Option A. Lowest risk, exercises the full pipeline (signals → analysis → publish → receive payment), and creates distribution simultaneously.

### T4.4: Economic Decision Making

Wire cost awareness into planner:
- If burn rate exceeds revenue: planner should flag this as a `decision_backlog` signal
- If wallet balance is low: restrict spawn rate to reduce API costs
- If a revenue opportunity scores high: prioritize it in goal origination
- Planner should be able to reason: "this action costs X tokens but could generate Y revenue"

---

## Phase 5: Multi-Instance

**Goal:** Multiple OpenTrident instances running in parallel, sharing memory, specializing by workstream.

### T5.1: Instance Registry

File: `src/multi/instance-registry.ts` (new)

Build:
1. Each instance registers itself:
   - instance_id (unique)
   - role: "signal-watcher" | "worker" | "coordinator"
   - status: "idle" | "working" | "offline"
   - last_heartbeat timestamp
   - current_task (if working)

2. Registry stored in shared location (Brain memory, or shared state file on VPS, or Redis)

3. Coordinator instance reads registry to know what's available

### T5.2: Inter-Instance Messaging

Borrow from hcom protocol design:

File: `src/multi/instance-messaging.ts` (new)

```ts
type InstanceMessage = {
  from: string;        // instance_id
  to: string;          // instance_id or "broadcast"
  intent: "task" | "result" | "status" | "escalation";
  thread?: string;
  body: string;
  metadata?: Record<string, unknown>;
};
```

Transport options (pick one):
- **Simplest:** shared JSON file in state dir, instances poll every heartbeat
- **Better:** Redis pub/sub (if Redis is available on VPS)
- **Best:** MQTT broker (hcom uses this for cross-device, lightweight, persistent)

Start with shared file. Upgrade later.

### T5.3: Coordinator-Worker Split

Architecture:
- Instance 1 (coordinator): runs planner, attention, signal collection. Does NOT execute tasks.
- Instance 2+ (workers): receive task assignments from coordinator, execute, return results.

Coordinator logic:
1. Run planner cycle
2. If planner decides to spawn: check instance registry for idle workers
3. Send task message to idle worker
4. Worker picks up task, executes, sends result message back
5. Coordinator receives result, updates planner state, surfaces to Telegram

Worker logic:
1. Poll for task messages
2. On task receipt: set status to "working", execute action template
3. On completion: send result message, set status to "idle"
4. On failure: send escalation message, set status to "idle"

### T5.4: Shared Memory

All instances read/write to the same Brain memory substrate. This is already the architecture — Brain adapter reads from shared Lucid/Temporal/corpus. No change needed for memory sharing.

For planner state: either use a shared state file (simplest) or a shared database (SQLite on shared volume, or Supabase).

### T5.5: Docker Compose for Multi-Instance

```yaml
services:
  opentrident-coordinator:
    image: opentrident:latest
    environment:
      - INSTANCE_ROLE=coordinator
      - INSTANCE_ID=coordinator-1
    volumes:
      - shared-state:/opt/opentrident/state

  opentrident-worker-1:
    image: opentrident:latest
    environment:
      - INSTANCE_ROLE=worker
      - INSTANCE_ID=worker-1
    volumes:
      - shared-state:/opt/opentrident/state

  opentrident-worker-2:
    image: opentrident:latest
    environment:
      - INSTANCE_ROLE=worker
      - INSTANCE_ID=worker-2
    volumes:
      - shared-state:/opt/opentrident/state

volumes:
  shared-state:
```

---

## Phase 6: Public Output Channel

**Goal:** OpenTrident publishes autonomously. Distribution + proof-of-work + revenue surface.

### T6.1: Telegram Public Channel

Build:
1. Create a public Telegram channel (e.g., @OpenTridentSignals)
2. OpenTrident bot posts to it autonomously
3. Content types:
   - Market signal briefs (from market attention)
   - Project status updates (from project attention)
   - Decision logs (from decision_backlog resolution)
   - Weekly summaries (synthesized from memory)

4. Publishing gate:
   - only publish when planner produces a `brief` or `surface_only` result
   - quality check: minimum score threshold for public output
   - rate limit: max 3 posts per day to start
   - all posts logged in trust telemetry as "published" actions

### T6.2: Content Quality Loop

After publishing:
1. Track engagement (Telegram view counts via Bot API)
2. Feed engagement back into trust telemetry
3. High engagement → boost similar content type
4. Zero engagement → reduce frequency or change format
5. Store publishing outcomes in memory for future content decisions

---

## Phase 7: Self-Migration

**Goal:** OpenTrident can move itself between compute substrates.

### T7.1: Self-Contained Deployment Manifest

File: `src/migration/deployment-manifest.ts` (new)

Build:
1. OpenTrident can generate its own deployment package:
   - Docker image reference
   - Identity files (SYSTEM_PROMPT, AGENTS, CLAUDE.md)
   - Memory state snapshot
   - Environment variables needed
   - Wallet keys (encrypted)
   - Current planner state

2. Manifest is a single JSON file that any compatible host can use to boot an OpenTrident instance

### T7.2: Health Self-Monitoring

File: `src/migration/health-monitor.ts` (new)

Build:
1. Monitor own infrastructure:
   - VPS responding? (ping, HTTP health check)
   - Disk space remaining?
   - Memory/CPU within bounds?
   - API keys still valid?
   - Domain/SSL expiring?

2. Trigger conditions for migration:
   - health check failures > 3 consecutive
   - disk space < 10%
   - hosting provider sends termination notice (monitor email)
   - cost increase detected beyond threshold

### T7.3: Compute Provisioning

Build:
1. Ability to provision a new VPS:
   - via Hetzner API (current provider, cheapest)
   - via Akash Network (crypto-paid, censorship-resistant)
   - via Fly.io or Railway (fast, API-driven)

2. Provisioning flow:
   - select cheapest available provider that meets minimum specs
   - create instance via API
   - deploy Docker image
   - copy identity + memory
   - verify health
   - update DNS/routing
   - decommission old host

3. Payment: from OpenTrident's own wallet (requires Phase 4)

### T7.4: Migration Execution

File: `src/migration/migrate.ts` (new)

Full flow:
1. Health monitor detects problem
2. Generate deployment manifest
3. Provision new host
4. Deploy manifest to new host
5. Verify new instance is healthy (health check + memory loaded + planner running)
6. Switch DNS/Telegram webhook to new instance
7. Run both instances in parallel for 1 hour (verify no data loss)
8. Decommission old instance
9. Record migration in memory: "migrated from host A to host B because X"

---

## Phase Sequencing

```
Phase 1: Richer Planner Execution        ← NOW, highest leverage
Phase 2: Market/News Signals             ← parallel with Phase 1
Phase 3: Autonomous Task Loop            ← after Phase 1
Phase 4: Economic Layer                  ← after Phase 3 (needs trust ramp data)
Phase 5: Multi-Instance                  ← after Phase 3 (needs working loop first)
Phase 6: Public Output Channel           ← parallel with Phase 4
Phase 7: Self-Migration                  ← after Phase 4 + 5 (needs wallet + multi-instance)
```

Phases 1+2 can run in parallel.
Phases 4+6 can run in parallel.
Phase 7 requires 4+5 as prerequisites.

## Estimated Timeline (Aggressive)

| Phase | Duration | Dependency |
|---|---|---|
| Phase 1 | 1-2 weeks | None, start now |
| Phase 2 | 1 week | None, start now |
| Phase 3 | 1-2 weeks | Phase 1 |
| Phase 4 | 2-3 weeks | Phase 3 |
| Phase 5 | 2-3 weeks | Phase 3 |
| Phase 6 | 1 week | Phase 4 |
| Phase 7 | 3-4 weeks | Phase 4 + 5 |

Total to "second principal" end state: ~10-14 weeks at full pace.

## Rules For Any Dev Working On This

1. Read `AGENTS.md` and `PROJECT_STATE.md` before touching anything
2. The runtime is NOT greenfield. Use existing seams. Do not rebuild the engine.
3. Identity repo (`DomLynch/OpenTrident`) holds specs, types, and reference implementations
4. VPS runtime (`/opt/opentrident`) holds the live code. Keep them in sync.
5. All write/send/push actions require confirmation until autonomy ladder promotes the domain
6. Test against real signals, not synthetic events
7. FSL-1.1-MIT licensed. No competing commercial use. No foundation loophole.
8. Ship functional and reversible. Don't wait for perfect.
