# OpenTrident Architecture

## Overview

OpenTrident is Dom Lynch's digital twin — a memory-backed autonomous operator running on VPS at `49.12.7.18` with Telegram as the primary surface. It surfaces attention, drafts responses, and executes actions within blast-radius constraints, calibrated by a trust telemetry system.

## System Architecture

```
┌─────────────────────────────────────────────────────────────────────┐
│                         Telegram (Dom)                               │
└─────────────────────────────────────────────────────────────────────┘
                                ▲
                                │ inbound message
                                ▼
┌─────────────────────────────────────────────────────────────────────┐
│                     OpenTrident Gateway (Docker)                      │
│  ┌──────────────┐  ┌──────────────────┐  ┌──────────────────────┐  │
│  │ auto-reply  │  │  heartbeat-runner │  │  outbound send service │  │
│  │ + commands   │  │  (every 60s)      │  │  (Telegram API)      │  │
│  └──────────────┘  └──────────────────┘  └──────────────────────┘  │
│         │                  │                        │                │
│         ▼                  ▼                        ▼                │
│  ┌──────────────┐  ┌──────────────────┐  ┌──────────────────────┐  │
│  │ planner-     │  │ planner-orchestrator│  │ trust-telemetry     │  │
│  │ inbox       │  │ (mode decisions)    │  │ (approval tracking)  │  │
│  └──────────────┘  └──────────────────┘  └──────────────────────┘  │
│                          │                                         │
│                          ▼                                         │
│  ┌──────────────┐  ┌──────────────────┐  ┌──────────────────────┐  │
│  │ autonomy-   │  │ planner-spawn     │  │ heartbeat-market-    │  │
│  │ ladder      │  │ (bounded tasks)   │  │ attention (Crypto)  │  │
│  └──────────────┘  └──────────────────┘  └──────────────────────┘  │
└─────────────────────────────────────────────────────────────────────┘
                                │
                    ┌───────────┴───────────┐
                    ▼                       ▼
          ┌──────────────────┐   ┌──────────────────────┐
          │ planner-state.json│   │ trust-telemetry.json │
          │ (session-scoped) │   │ (approval rates)     │
          └──────────────────┘   └──────────────────────┘
```

## Core Modules

### Planner Orchestrator (`src/planner/planner-orchestrator.ts`)
Entry point: `resolvePlannerDecision()`. Builds an inbox of candidate attention items, scores them, selects the top item, originates a goal, and resolves a mode.

**Modes**: `idle | surface | spawn_readonly | send`
- `idle`: no item meets threshold
- `surface`: item surfaced to Dom for awareness
- `spawn_readonly`: bounded worker spawned for analysis/draft
- `send`: bounded worker spawned to produce a draft requiring Dom confirmation before Telegram send

**Decision factors**:
- Item score threshold: 0.33 minimum, 0.55 for spawn, 0.70 for autonomous spawn
- Autonomy level per domain (from autonomy ladder)
- Blast-radius rules enforced in prompt

### Planner Spawn (`src/planner/planner-spawn.ts`)
Spawns bounded subagents via `spawnSubagentDirect()`. Task prompt is built by `buildPlannerBoundedTask()` which returns formatted prompts for each action class.

**Action classes**:
- `brief`: Market analysis — structured brief format
- `draft_reply`: Relationship follow-up — message draft format
- `draft_issue`: Project issues — GitHub issue format
- `send_reply`: Telegram draft requiring confirmation
- `spawn_readonly`: General read-only analysis

### Trust Telemetry (`src/planner/trust-telemetry.ts`)
Tracks every planner action outcome. Persists to `trust-telemetry-v1.json`.

**Metrics tracked**:
- Overall approval rate (approved / total)
- Per-domain breakdown
- Per-source breakdown
- 7-day rolling daily trend

**File I/O**: All reads/writes wrapped with 3-attempt exponential backoff retry.

### Autonomy Ladder (`src/planner/autonomy-ladder.ts`)
Defines per-domain autonomy levels. Persisted to `autonomy-config-v1.json`.

**Levels** (in order of increasing trust):
1. `read_only` — only `spawn_readonly` allowed
2. `draft_only` — `spawn_readonly` + `draft_reply` allowed
3. `act_with_confirmation` — most actions allowed with confirmation
4. `act_autonomously` — all actions including `send_reply` with minimal friction

**Auto-adjustment** (trust ramp loop):
- After 3+ outcomes for a domain:
  - 90%+ approval rate → level UP
  - 40%+ demotion rate (rejected + modified×0.5) → level DOWN

### Planner Executor (`src/planner/planner-executor.ts`)
Handles execution of approved sends and approval parsing.

**`executeApprovedSend()`**: Calls Telegram sendMessage, updates planner row, records outcome, triggers autonomy adjust.
**`parseApprovalResponse()`**: Recognizes yes/no approval patterns.

### Market Attention (`src/infra/heartbeat-market-attention.ts`)
Scrapes CryptoCompare News API every 60 minutes. Scores signals by keyword impact. Circuit breaker: 3 consecutive failures → 5 minute cooldown.

**High-impact keywords**: btc, bitcoin, eth, fed, rate, inflation, crash, surge, ath, sec, etf, halving, blackrock, spot
**Medium-impact**: crypto, market, trading, price, volatile, wall street, regulation, adoption, institutional

### Heartbeat Runner (`src/infra/heartbeat-runner.ts`)
Runs every 60s per active session. Orchestrates the full loop:
1. Fetch pending events (github, gmail, system signals, market attention)
2. Build planner inbox from events
3. `resolvePlannerDecision()` → mode
4. For `spawn_readonly`: spawn bounded worker, track child session
5. For `send`: spawn bounded worker, set `awaiting_confirmation` status
6. Append planner prompt block to agent prompt
7. Execute agent run

### Planner State (`src/planner/planner-state.ts`)
Persistent planner row storage per session. JSON file at `planner-v1.json`. Max 20 rows per session.

**Statuses**: `candidate | selected | spawned | running | done | failed | blocked | escalated | dropped | awaiting_confirmation | approved | rejected | modified`

## Data Flow

```
Inbound Telegram message
    ↓
auto-reply handler (commands, reactions)
    ↓
heartbeat-runner (every 60s)
    ↓
planner-inbox: github-attention + gmail-attention + market-attention + system-events
    ↓
planner-orchestrator: resolvePlannerDecision()
    ├── score < 0.33 → idle
    ├── score 0.33-0.55 → surface
    ├── score >= 0.55 + needsConfirmation = false → spawn_readonly
    └── score >= 0.55 + needsConfirmation = true → send (awaiting_confirmation)
    ↓
planner-spawn: buildPlannerBoundedTask() + spawnSubagentDirect()
    ↓
bounded worker produces result
    ↓
result delivered to Dom via Telegram
    ↓
Dom approves/rejects/modifies
    ↓
planner-executor: executeApprovedSend() or rejection
    ↓
trust-telemetry: recordActionOutcome()
    ↓
autonomy-ladder: adjustDomainAutonomy() (if total >= 3 for domain)
```

## State Files

| File | Location | Purpose |
|------|----------|---------|
| `planner-v1.json` | `~/.opentrident/` | Planner rows per session |
| `trust-telemetry-v1.json` | `~/.opentrident/` | Approval/outcome metrics |
| `autonomy-config-v1.json` | `~/.opentrident/` | Per-domain autonomy levels |
| `market-attention-v1.json` | `~/.opentrident/` | Market signal cache + circuit state |

## Blast Radius Rules

1. `send_reply` always requires Dom confirmation — no autonomous Telegram sends
2. `draft_reply` and `draft_issue` require surfacing before execution
3. `spawn_readonly` and `brief` are the only truly autonomous actions
4. `surface_only` surfaces for awareness without spawning
5. No writes, pushes, merges, trades, or irreversible actions without explicit Dom approval

## Deployment

- Runtime: `/opt/opentrident` on VPS at `49.12.7.18`
- Docker image: `opentrident:latest` (tagged with date/version)
- Compose: `docker-compose.vps.yml`
- State dir: `/home/node/.opentrident` (Docker volume mount)
- Workspace: `/opt/opentrident-data/workspace`
