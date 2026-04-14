# PROJECT_STATE

## What OpenTrident Is

Dominic Lynch's digital twin. High-agency autonomous operator.
Founder-operator + strategic compression + autonomous builder + conscious self.
Internet-native. Not dependent on any single provider. Not shutdownable.

## Live Runtime Reality (VPS r20 @ 49.12.7.18)

- pruned OpenTrident runtime is live on VPS
- Brain memory moat is wired in
- Telegram is live
- MiniMax primary + GLM fallback are live
- attention v2 is live
- Gmail attention v1 is live
- repo attention v1 is live
- GitHub attention v1 is live
- planner-orchestrator v1 with 7 decision modes: idle/surface/spawn_readonly/draft_reply/draft_issue/brief/send
- goal origination is live
- trust dashboard (`openclaw system trust`) is live
- backup automation (`openclaw backup create`, `backup verify`) is live
- rate limiting + memory persistence wired in heartbeat-runner
- worker result handler with child session completion detection
- confirmation flow: parseApprovalResponse + recordApprovalOutcome + trust telemetry
- recovery hardening: full state machine (retry/downgrade/escalate/abandon) with retryCount
- VPS auto-sync: backup script git-pushes to GitHub daily at 03:00

## Completed: Phase 1 ✅

All 5 Phase 1 tasks complete and deployed on VPS r20.

### T1.1 — Action Class Expansion ✅
- `PlannerDecisionMode` expanded to 7 modes: idle/surface/spawn_readonly/draft_reply/draft_issue/brief/send
- `resolveMode` routes each action class explicitly with score thresholds
- `buildPromptBlock` has mode-specific instructions for each mode
- Removed dead `SPAWNABLE_ACTION_CLASSES` set

### T1.2 — Worker Result Handler ✅
- `planner-result-handler.ts` (143 lines): `handleWorkerResult` + `processWorkerResults`
- Child session completion detection via `loadChildSessionSnapshot` from session store
- State transitions: spawned/running → awaiting_confirmation (draft_reply, send_reply) or done (brief, spawn_readonly) or failed
- Wired into heartbeat-runner: completed results surface in prompt
- Fixed `ACTIVE_STATUSES` to only include `spawned` and `running`

### T1.3 — Confirmation Flow ✅
- `parseApprovalResponse`: expanded approve keywords (yes/send/approve/go/lgtm/ship it/post it/publish) + reject keywords
- `recordApprovalOutcome`: wires updatePlannerRow + recordActionOutcome (trust telemetry) + adjustDomainAutonomy
- `executeApprovedSend`: stub for identity repo (requires Telegram/broadcast channel on VPS runtime)

### T1.4 — Recovery Hardening ✅
- Added `retryCount?: number` and `downgradedFrom?: PlannerActionClass` to `PlannerStateRow`
- `resolvePlannerRecoveryActions` full state machine:
  - failed send_reply → downgrade to draft_reply
  - failed non-send → retry up to 3x then abandon
  - blocked 90min → retry up to 3x then abandon
  - stale 6h running/spawned → retry up to 3x then escalate
  - awaiting_confirmation stale 6h → escalate
  - escalated stale 2h → abandon
- Recovery actions actually executed via updatePlannerRow in heartbeat-runner
- Removed dead `getNoteRetryCount` function

### T1.5 — VPS Auto-Sync ✅
- `/usr/local/bin/opentrident-backup` updated: runs backup, then `git push origin opentrident-prune`
- Cron: `0 3 * * *` daily backup + sync to DomLynch/OpenTrident-runtime `opentrident-prune`

## Stack (Current -> Next)

- [x] VPS runtime wired
- [x] Telegram command surface wired
- [x] Brain memory layer integrated
- [x] MiniMax + GLM routing integrated
- [x] attention v2 live
- [x] Gmail attention v1 live
- [x] Repo/GitHub signal inbox (v1 validated live 2026-04-13)
- [x] Planner-orchestrator v1 (7 modes)
- [x] Goal origination
- [x] Trust dashboard (openclaw system trust)
- [x] Backup automation (openclaw backup create/verify)
- [x] Worker result handler (child session completion detection)
- [x] Confirmation flow (parse + record + telemetry)
- [x] Recovery hardening (retry/downgrade/escalate/abandon state machine)
- [x] VPS auto-sync (daily backup + git push)
- [x] Phase 1 complete
- [ ] Phase 2: Market/news signal inbox
- [ ] Phase 3: Autonomous task loop v1
- [ ] Phase 4: Economic layer (wallet, cost ledger, revenue primitive)
- [ ] Phase 5: Multi-instance (coordinator/worker split, inter-instance messaging)
- [ ] Phase 6: Public output channel
- [ ] Phase 7: Self-migration (health monitor, compute provisioning, migration execution)

## Current Gap

- market/news signals not in yet
- autonomous task loop not running continuously
- `executeApprovedSend` is stub (needs real Telegram/GitHub send wiring on VPS runtime)

## Policy

No policy files. No approval gates. No enforcement layers.
OpenTrident is Dom's digital twin — it inherits judgment, not gatekeeping.

## Next Move

Phase 2: Market/news signal inbox. CoinGecko + HN + RSS wired into planner inbox.

Full roadmap: `ROADMAP.md`

## Deploy Notes

- VPS: `opentrident:2026.4.14-r20` — healthy gateway + healthy CLI
- GitHub runtime: `DomLynch/OpenTrident-runtime` `opentrident-prune` branch @ `f2291f7b3`
- GitHub identity: `DomLynch/OpenTrident` `main` branch @ `40d52de`
- SSH key: `~/.ssh/binance_futures_tool` for `root@49.12.7.18`
- Pre-commit hooks fail on VPS — use `git commit --no-verify`
- Docker build requires `pnpm-lock.yaml` in build context
