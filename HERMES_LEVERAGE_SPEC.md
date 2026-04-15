# Hermes Leverage Spec

**Audience:** Implementer (MiniMax / Claude / Codex / human).
**Prerequisite reading:** `AGENTS.md`, `CLAUDE.md`, `HERMES_PORT_PLAN.md`.
**Status:** Substrate is built. Compounding loop is open. This spec closes it.

---

## Context

The 5 Hermes primitives are implemented and deployed on VPS `r225021`:

| File | Lines | Status |
|---|---|---|
| `src/multi/instance-locks.ts` | 263 | Built, under-wired |
| `src/multi/fork-isolation.ts` | 86 | Built, unconfigured |
| `src/planner/memory-query.ts` | 394 | Built, fully wired ✅ |
| `src/planner/playbook-manager.ts` | 323 | Built, **write-only** |
| `src/planner/planner-flush.ts` | 299 | Built, starved of real signals |

A full audit traced every call site. Four structural breaks keep the loop open:

1. **`findPlaybooks` is never called** — playbooks accumulate into a vault the orchestrator never opens.
2. **Flush signals are stub values** — `userCorrected`, `nonTrivialWorkflow`, real tool count, real error count are hardcoded or derived from weak proxies.
3. **Only 1 of 5 lock scopes is held** — `telegram-bot` with `forceStale: true` (which defeats it). No leader election.
4. **No fork is ever configured** — `OPENTRIDENT_FORK_ID` is only referenced inside the file that defines it. Every container runs as `general`.

This spec fixes all four in ordered moves by asymmetric return.

---

## Principles

- **No new abstractions.** Use existing seams. Every move extends a function that already exists.
- **Ship reversible.** Each move is independently deployable and independently revertable.
- **Test against real state.** Not synthetic fixtures. Deploy to VPS, observe the counter you care about, verify it moves.
- **Keep the substrate.** We do NOT rewrite any of the 5 primitive files. We add call sites and data flow.

---

# Move 1 — Wire `findPlaybooks` into the orchestrator

**Goal:** Every spawn decision consults past-proven procedures. Every approved outcome becomes leverage on the next similar decision.

**Asymmetry:** 20 lines turns 323 lines of dead playbook infrastructure live. Highest leverage ratio in the system.

## Files

- `src/planner/planner-orchestrator.ts` (edit)
- `src/planner/playbook-manager.ts` (no changes — function already exists at line 223)

## Implementation

### Step 1.1 — Import `findPlaybooks`

File: `src/planner/planner-orchestrator.ts`, add to imports block (top of file, around line 7 next to `searchSessions`):

```typescript
import { searchSessions } from "./memory-query.js";
import { findPlaybooks, recordPlaybookUse, type Playbook } from "./playbook-manager.js";
```

### Step 1.2 — Extend `buildPromptBlock` signature

File: `src/planner/planner-orchestrator.ts`, function `buildPromptBlock` at line 23.

Current:
```typescript
async function buildPromptBlock(params: {
  decision: PlannerDecision;
  previousHeartbeatText?: string;
  similarSessions?: readonly { sessionKey: string; title: string; snippet: string; score: number }[];
}): Promise<string | undefined> {
```

Change to:
```typescript
async function buildPromptBlock(params: {
  decision: PlannerDecision;
  previousHeartbeatText?: string;
  similarSessions?: readonly { sessionKey: string; title: string; snippet: string; score: number }[];
  relevantPlaybooks?: readonly Playbook[];
}): Promise<string | undefined> {
```

### Step 1.3 — Render playbook section in prompt

File: `src/planner/planner-orchestrator.ts`, inside `buildPromptBlock`, after the "Similar past sessions" block (around line 104), add:

```typescript
  if (params.relevantPlaybooks && params.relevantPlaybooks.length > 0) {
    lines.push("");
    lines.push("Proven playbooks for this pattern (apply the winning procedure — do not reinvent):");
    for (const p of params.relevantPlaybooks.slice(0, 3)) {
      const uses = p.successCount + p.failureCount;
      const rate = uses > 0 ? ((p.successCount / uses) * 100).toFixed(0) : "new";
      const procedure = p.procedure.length > 400
        ? `${p.procedure.slice(0, 399)}…`
        : p.procedure;
      lines.push(`- [${p.id}] ${p.name} (${rate}% success over ${uses} uses)`);
      lines.push(`  ${procedure.replace(/\n/g, "\n  ")}`);
    }
    lines.push("- If one of these playbooks fits, follow it. If none fit, proceed from scratch and a new playbook may be written on success.");
  }
```

### Step 1.4 — Query playbooks before building the prompt

File: `src/planner/planner-orchestrator.ts`, inside `resolvePlannerDecision`, right after the `similarSessions` block (around line 206). Current shape:

```typescript
  const similarSessions = spawnModes.includes(mode)
    ? await searchSessions({ ... }).catch(() => ({ sessions: [] as const }))
    : undefined;
```

Add immediately after:

```typescript
  const relevantPlaybooks = spawnModes.includes(mode)
    ? await findPlaybooks({
        domain: safeGoal.domain,
        actionClass: safeGoal.actionClass,
      }).catch(() => [] as Playbook[])
    : undefined;
```

Then extend the `buildPromptBlock` call at line 214 to pass it:

```typescript
  decision.promptBlock = await buildPromptBlock({
    decision,
    previousHeartbeatText: params.entry?.lastHeartbeatText,
    similarSessions: similarSessions?.sessions,
    relevantPlaybooks,
  });
```

### Step 1.5 — Record playbook use on outcome

File: `src/planner/planner-flush.ts`, function `executeFlush` around line 125.

When the decision action is `record-telemetry` or `write-memory` AND the row was spawned with a playbook reference, we want to update that playbook's success/failure counter. Currently the row doesn't carry `playbookId`. Add the plumbing:

**1.5a — Extend `PlannerStateRow` type**

File: `src/planner/types.ts`, add to `PlannerStateRow`:

```typescript
/** Playbook that was selected to guide this row, if any. */
playbookId?: string;
```

**1.5b — Attach playbook ID to the decision when one was picked**

File: `src/planner/planner-orchestrator.ts`, inside `resolvePlannerDecision`. After computing `relevantPlaybooks`, set the selected playbook on the decision:

```typescript
  const selectedPlaybookId = relevantPlaybooks && relevantPlaybooks.length > 0
    ? relevantPlaybooks[0].id
    : undefined;

  const decision: PlannerDecision = {
    mode,
    topItem: sanitizedItem,
    goal: safeGoal,
    candidates,
    playbookId: selectedPlaybookId,  // new field
  };
```

**1.5c — Extend `PlannerDecision` type**

File: `src/planner/types.ts`:

```typescript
export type PlannerDecision = {
  mode: PlannerDecisionMode;
  topItem?: PlannerItem;
  goal?: PlannerGoal;
  candidates: readonly PlannerItem[];
  promptBlock?: string;
  playbookId?: string;  // new
};
```

**1.5d — Wire playbook use recording in flush**

File: `src/planner/planner-flush.ts`, inside `executeFlush`. After the existing action dispatch logic, before the return:

```typescript
  // Update the selected playbook's success/failure counter
  if (params.row?.playbookId && params.outcome) {
    const success = params.outcome === "completed"
      || params.outcome === "approved"
      || params.outcome === "modified";
    await recordPlaybookUse({
      playbookId: params.row.playbookId,
      success,
      stateDir: params.stateDir,
    }).catch(() => {});
  }
```

Add import at top:
```typescript
import { createPlaybook, recordPlaybookUse } from "./playbook-manager.js";
```

**1.5e — Persist `playbookId` into the planner row when it's created**

The row creation happens in whatever spawn path writes the planner state. Search for `updatePlannerRow` calls that transition from the decision. Pass through `decision.playbookId` into the row's `playbookId` field.

## Acceptance Criteria — Move 1

1. Compile & deploy succeeds.
2. After 48 hours of production heartbeats, run:
   ```bash
   docker exec opentrident-gateway node -e "
     const fs = require('fs');
     const store = JSON.parse(fs.readFileSync('/opt/opentrident-data/config/playbooks/playbook-store.json','utf8'));
     const used = Object.values(store.playbooks).filter(p => p.successCount + p.failureCount > 0);
     console.log('Playbooks with recorded use:', used.length);
   "
   ```
   Expected: at least 1 playbook has `successCount + failureCount > 0` within 48h of production signals.

3. Inspect a recent heartbeat `promptBlock` in session store — confirm a "Proven playbooks" section appears when a matching playbook exists.

---

# Move 2 — Populate flush signals with real execution data

**Goal:** Unlock the `learn-skill` and `promote-playbook` paths in `planner-flush.ts`. Today they are dead because their discriminators are stub values.

## The dead discriminators

In `src/planner/planner-flush.ts` `decideFlush` at line 35:

```typescript
const toolCalls = params.toolCallCount ?? 0;
const errors = params.errorCount ?? 0;
const isComplex = toolCalls >= 5 || params.nonTrivialWorkflow === true;

if (params.userCorrected && toolCalls >= 3) {
  return { action: "learn-skill", ... };   // DEAD — userCorrected is always false
}

if (isComplex && errors > 0 && toolCalls >= 3) {
  return { action: "learn-skill", ... };   // DEAD — errorCount is always 0 or 1 (final status only)
}
```

The call sites feed:

```typescript
// planner-result-handler.ts:132-148
const toolCallCount = snapshot.messageCount ?? 0;    // MESSAGE count, not tool count
const errorCount = snapshot.status === "failed" ? 1 : 0;  // binary final status
...
  nonTrivialWorkflow: toolCallCount >= 5,   // derived from stub
  userCorrected: false,                     // HARDCODED
```

## Files

- `src/config/sessions/types.ts` (or the file defining the child session entry shape — add counter fields)
- `src/config/sessions/store-load.ts` or lifecycle writer (increment counters on tool events)
- `src/planner/planner-result-handler.ts` (read real counters)
- `src/planner/planner-approval-handler.ts` (flag mid-task user redirect)

## Implementation

### Step 2.1 — Add counter fields to child session snapshot

Find where the child session entry is written. Grep for `messageCount` increments in the session store. Add alongside:

```typescript
// In the type that describes a session entry:
toolCallCount?: number;    // incremented on every tool_use event
toolErrorCount?: number;   // incremented on every tool_result error
userRedirectCount?: number; // incremented when user sends a message while a worker is running
```

### Step 2.2 — Instrument the lifecycle writer

Find the SDK / gateway handler that records events into the child session store. For every `tool_use` event emitted by the SDK, increment `toolCallCount`. For every `tool_result` with `is_error: true`, increment `toolErrorCount`.

If the instrumentation point is unclear, search for where `messageCount` is incremented — add the new counters next to it. Follow the existing atomic write pattern.

### Step 2.3 — Mid-task user redirect detection

File: `src/planner/planner-approval-handler.ts`.

The approval handler intercepts user replies. When a reply lands and the referenced planner row is still in status `spawned` or `running`:
- This is a redirect, not an approval.
- Increment `userRedirectCount` on the child session entry.
- Log the redirect to memory as `key: redirect:{rowId}`.

Pseudocode to add near the existing handler:

```typescript
// If the row is still active, the user is redirecting, not approving
if (row.status === "spawned" || row.status === "running") {
  if (row.childSessionKey) {
    await incrementChildSessionCounter(row.childSessionKey, "userRedirectCount", 1);
  }
  await recordMemory({
    key: `redirect:${row.id}`,
    value: JSON.stringify({ reply: reply.slice(0, 200), rowTitle: row.title }),
    category: "decision",
    source: "user-redirect",
  }).catch(() => {});
  // fall through — don't treat as approval
}
```

Add a small helper `incrementChildSessionCounter` in the session store module.

### Step 2.4 — Feed real counters into flush

File: `src/planner/planner-result-handler.ts`, function `handleWorkerResult` around line 132. Replace:

```typescript
const toolCallCount = snapshot.messageCount ?? 0;
const errorCount = snapshot.status === "failed" ? 1 : 0;
await executeFlush({
  ...
  nonTrivialWorkflow: toolCallCount >= 5,
  userCorrected: false,
});
```

With:

```typescript
const toolCallCount = snapshot.toolCallCount ?? 0;
const errorCount = snapshot.toolErrorCount ?? (snapshot.status === "failed" ? 1 : 0);
const userRedirects = snapshot.userRedirectCount ?? 0;
const nonTrivialWorkflow = toolCallCount >= 5 || errorCount >= 2;
const userCorrected = userRedirects > 0;

await executeFlush({
  trigger: "worker-complete",
  row,
  outcome: newStatus === "done" ? "completed"
    : newStatus === "awaiting_confirmation" ? "approved"
    : newStatus === "failed" ? "failed"
    : "rejected",
  draftResult,
  toolCallCount,
  errorCount,
  nonTrivialWorkflow,
  userCorrected,
}).catch(() => {});
```

Update the `ChildSessionSnapshot` type at line 12 to include the new fields.

### Step 2.5 — Same treatment in `planner-executor.ts`

File: `src/planner/planner-executor.ts` around line 102. The `planner-row-close` flush also hardcodes `nonTrivialWorkflow: false`. Thread the same real counters through if the row has a `childSessionKey`.

## Acceptance Criteria — Move 2

1. Compile & deploy succeeds.
2. After 48 hours on production heartbeats, run a query against the playbook store and confirm at least one playbook was created with the `learned` tag (from the `learn-skill` path in flush).
3. Search memory entries for `key LIKE 'redirect:%'` — should show at least one entry if any Telegram redirect has happened.
4. Inspect a completed child session's store entry and verify `toolCallCount`, `toolErrorCount`, `userRedirectCount` are populated with non-stub values.

---

# Move 3 — Real leader election

**Goal:** Two OpenTrident containers can run simultaneously without the Telegram 409 split-brain that hit the B.1 migration.

## Files

- `src/infra/heartbeat-runner.ts` (replace the 1-line stub at 1967 with real election)
- `src/infra/heartbeat-follower.ts` (new, ~80 lines)

## Implementation

### Step 3.1 — Remove the `forceStale` cheat

File: `src/infra/heartbeat-runner.ts` line 1967. Current:
```typescript
(async () => { await acquireLock({ scope: "telegram-bot", forceStale: true }).catch(() => {}); })();
```

Delete this line. Replace with an IIFE that does real election at startup (see step 3.2).

### Step 3.2 — Startup election

At the top of the heartbeat startup path (where the runner initializes state — find the `startHeartbeatRunner` function or equivalent), before any work begins:

```typescript
import {
  acquireLock,
  refreshLock,
  releaseLock,
  forceReleaseStaleLocks,
  getLockStatus,
} from "../multi/instance-locks.js";
import { runFollowerLoop } from "./heartbeat-follower.js";

// ---- Startup election ----
async function runStartupElection(): Promise<"leader" | "follower"> {
  // Clean any stale locks first (2-min threshold is enforced inside the module)
  await forceReleaseStaleLocks({}).catch(() => {});

  const becameLeader = await acquireLock({ scope: "leader-heartbeat" });
  if (!becameLeader) {
    const status = await getLockStatus({ scope: "leader-heartbeat" });
    log(`[election] Running as FOLLOWER — leader is ${status.entry?.hostname}`);
    return "follower";
  }

  // Leader acquires the writable scopes
  await acquireLock({ scope: "telegram-bot" });
  await acquireLock({ scope: "planner-write" });
  await acquireLock({ scope: "public-channel" });
  log(`[election] Running as LEADER — acquired telegram-bot, planner-write, public-channel`);
  return "leader";
}

const role = await runStartupElection();

if (role === "follower") {
  await runFollowerLoop();
  return;  // Do NOT start the full heartbeat
}
```

### Step 3.3 — Fix the refresh loop

File: `src/infra/heartbeat-runner.ts` around lines 1853-1854. Currently:

```typescript
refreshLock({ scope: "telegram-bot" }).catch(() => {}),
refreshLock({ scope: "planner-write" }).catch(() => {}),
```

Add the leader and public scopes:

```typescript
refreshLock({ scope: "leader-heartbeat" }).catch(() => {}),
refreshLock({ scope: "telegram-bot" }).catch(() => {}),
refreshLock({ scope: "planner-write" }).catch(() => {}),
refreshLock({ scope: "public-channel" }).catch(() => {}),
```

This refresh tick must run at least every 60s (half of the 2-min stale threshold).

### Step 3.4 — Follower loop

File: `src/infra/heartbeat-follower.ts` (new).

```typescript
import { getLockStatus, acquireLock, releaseLock } from "../multi/instance-locks.js";

const FOLLOWER_POLL_MS = 30_000;
const LEADER_TAKEOVER_BACKOFF_MS = 5_000;

/**
 * Follower loop: mirror state, do nothing active, poll for leader failure.
 *
 * Followers do NOT:
 *  - run the planner
 *  - spawn workers
 *  - poll Telegram
 *  - run strategic initiator
 *  - write to planner state (planner-write lock is not held)
 *
 * Followers DO:
 *  - keep the process alive
 *  - periodically check whether leader-heartbeat lock is stale
 *  - on stale, attempt promotion
 */
export async function runFollowerLoop(): Promise<void> {
  while (true) {
    await new Promise((r) => setTimeout(r, FOLLOWER_POLL_MS));

    const leaderStatus = await getLockStatus({ scope: "leader-heartbeat" }).catch(() => ({
      held: false,
      byMe: false,
      entry: null,
    }));

    if (leaderStatus.held && !leaderStatus.byMe) {
      // Leader still alive — continue polling
      continue;
    }

    // Leader gone — attempt takeover
    const won = await acquireLock({ scope: "leader-heartbeat" }).catch(() => false);
    if (!won) {
      // Lost the race — wait and retry
      await new Promise((r) => setTimeout(r, LEADER_TAKEOVER_BACKOFF_MS));
      continue;
    }

    // Won. Bootstrap as leader.
    console.log("[follower→leader] Leader lock acquired — promoting");
    await acquireLock({ scope: "telegram-bot" }).catch(() => {});
    await acquireLock({ scope: "planner-write" }).catch(() => {});
    await acquireLock({ scope: "public-channel" }).catch(() => {});

    // Kick the process — simplest thing is to exit with a restart code
    // and let docker restart:always bring us back up as leader.
    console.log("[follower→leader] Exiting for restart as leader");
    process.exit(42);
  }
}
```

Docker's `restart: always` + `exit 42` gives a clean transition without holding mixed state.

### Step 3.5 — Migration cutover uses `migrateLock`

File: `src/migration/migrate.ts`. In the `executeMigration` flow, when the new server is healthy and before decommissioning the old server, call `migrateLock` for each scope the old primary held. This is what the primitive was designed for.

```typescript
// After new server is healthy, before decommissioning old server
await migrateLock({
  scope: "leader-heartbeat",
  targetInstanceId: newInstanceId,
  targetHostname: newHostname,
  targetPid: newPid,
});
// Same for telegram-bot, planner-write, public-channel
```

The `targetInstanceId` must be obtained from the new host (query its lock-file or compute the hash using its hostname+pid).

## Acceptance Criteria — Move 3

1. `docker compose -f docker-compose.multi.yml up -d` with 2 replicas of the gateway container.
2. Only 1 container logs "Running as LEADER". The other logs "Running as FOLLOWER".
3. The leader's gateway serves healthy at `127.0.0.1:18889/healthz`. The follower is running but idle.
4. `docker stop opentrident-gateway` (the leader). Within 2 minutes, the follower logs "[follower→leader] Leader lock acquired", exits 42, docker restarts it, and it comes up as leader.
5. No 409 Telegram polling conflict during the transition.

---

# Move 4 — Spawn the first real fork (`market`)

**Goal:** Run a specialized market fork that processes only market-domain signals, with its own playbook library and memory.

## Files

- `docker-compose.multi.yml` (add service)
- `src/planner/planner-inbox.ts` (gate by fork)
- `src/infra/heartbeat-runner.ts` (log fork ID on startup)

## Implementation

### Step 4.1 — Add the market service

File: `docker-compose.multi.yml`. Add a new service:

```yaml
  opentrident-market:
    image: ${OPENTRIDENT_IMAGE:-opentrident:latest}
    container_name: opentrident-market
    restart: always
    env_file: .env
    environment:
      - OPENTRIDENT_FORK_ID=market
      - OPENTRIDENT_STATE_DIR=/opt/opentrident-data/config-market
      - OPENTRIDENT_CONFIG_DIR=/opt/opentrident-data/config-market
      # Market fork uses its own Telegram chat if available; otherwise shares the main bot
      - TELEGRAM_FORK_CHAT_ID=${TELEGRAM_MARKET_CHAT_ID:-}
    volumes:
      - /opt/opentrident-data/config-market:/opt/opentrident-data/config-market
      - /var/run/docker.sock:/var/run/docker.sock:ro
    command: ["openclaw", "gateway"]
    depends_on:
      - opentrident-gateway
```

The `config-market` volume is distinct from the main `config` volume. `fork-isolation.ts:buildForkStateDir` already returns `${stateDir}-market` for fork `market`, but since we pass `OPENTRIDENT_STATE_DIR` directly, the fork writes to the volume we specify.

### Step 4.2 — Fork-gated inbox filtering

File: `src/planner/planner-inbox.ts`, function `buildPlannerInbox` around line 45.

At the top of the function:

```typescript
import { getForkId, type ForkId } from "../multi/fork-isolation.js";

const FORK_DOMAIN_ALLOWLIST: Record<ForkId, readonly PlannerDomain[] | null> = {
  market: ["market"],
  relationship: ["relationship"],
  builder: ["project"],
  ops: ["general", "decision"],
  general: null, // null = all domains
};
```

At the end of `buildPlannerInbox`, before returning, filter by fork:

```typescript
  const forkId = getForkId();
  const allowlist = FORK_DOMAIN_ALLOWLIST[forkId];
  if (allowlist === null) {
    return items;
  }
  return items.filter((item) => allowlist.includes(item.domain));
```

This means:
- The `market` fork only sees market-domain items.
- The `general` fork (main container) sees everything — so nothing regresses for the main runtime.
- You can later spawn a `relationship` or `builder` fork by changing the env var.

### Step 4.3 — Fork-scoped leader election

Problem: if both `general` and `market` forks run `leader-heartbeat` election against the same lock file, they'll fight for the same lock.

Fix: scope lock names by fork ID. File: `src/multi/instance-locks.ts`.

Extend `LockScope` to accept fork-qualified scopes. Simpler: change `acquireLock` to compute a fork-scoped lock key internally:

```typescript
import { getForkId } from "./fork-isolation.js";

function forkScopedKey(scope: LockScope): string {
  const forkId = getForkId();
  return forkId === "general" ? scope : `${forkId}:${scope}`;
}
```

Then in every read/write of `file.locks[scope]`, use `forkScopedKey(scope)` as the key. The lock file's `locks` record type changes from a fixed-shape object to `Record<string, LockEntry | null>`.

Update the `LockFile` shape:
```typescript
export type LockFile = {
  locks: Record<string, LockEntry | null>;  // was Record<LockScope, LockEntry | null>
  updatedAt: number;
};
```

Each fork now holds its own `leader-heartbeat`, `telegram-bot`, `planner-write`, `public-channel` without colliding with the `general` fork.

However: `telegram-bot` MUST still be globally exclusive (Telegram's API enforces one poller). Solution: the market fork does NOT acquire `telegram-bot`. It surfaces its output to the general fork via instance-messaging (which already exists), and the general fork publishes to Telegram.

In step 3.2's startup election, change the leader block:
```typescript
// Leader acquires fork-scoped writable scopes
await acquireLock({ scope: "leader-heartbeat" });
await acquireLock({ scope: "planner-write" });
await acquireLock({ scope: "public-channel" });

// telegram-bot is special — ONLY the general fork holds it
if (getForkId() === "general") {
  await acquireLock({ scope: "telegram-bot" });
}
```

### Step 4.4 — Output surfacing from market fork to general fork

The market fork produces briefs/decisions but cannot send to Telegram directly. Use the existing `instance-messaging.ts` primitives.

In the market fork's `planner-result-handler.ts` flow, after `executeFlush`, if the result has a `draftResult` to surface:

```typescript
import { sendInstanceMessage } from "../multi/instance-messaging.js";

if (getForkId() !== "general" && draftResult) {
  await sendInstanceMessage({
    from: `fork:${getForkId()}`,
    to: "fork:general",
    intent: "surface-request",
    body: draftResult,
    metadata: {
      domain: row.domain,
      title: row.title,
      rowId: row.id,
    },
  });
}
```

On the general fork side, `pollInstanceMessages` is already called from the heartbeat. Add a handler: when a `surface-request` message arrives, route it through the general fork's surface pipeline.

### Step 4.5 — Boot logging

File: `src/infra/heartbeat-runner.ts`. At startup, log the fork ID so we can verify both containers are running distinct forks:

```typescript
import { getForkId } from "../multi/fork-isolation.js";
console.log(`[boot] OpenTrident fork=${getForkId()} instance=${getLocalInstanceId()}`);
```

## Acceptance Criteria — Move 4

1. `docker compose -f docker-compose.multi.yml up -d` brings up both `opentrident-gateway` (general fork) and `opentrident-market` (market fork).
2. Logs:
   - general fork: `[boot] OpenTrident fork=general ...`
   - market fork: `[boot] OpenTrident fork=market ...`
3. State directories are distinct:
   - `/opt/opentrident-data/config/` (general, has all existing state)
   - `/opt/opentrident-data/config-market/` (market, fresh)
4. After a market signal arrives, only the market fork's planner processes it. The market fork's `planner-v1.json` grows; the general fork's does not (for market items).
5. Market fork produces a brief, surfaces it via `sendInstanceMessage`, general fork receives it and publishes to Telegram.
6. Only the general fork holds `telegram-bot` lock. Market fork holds `market:leader-heartbeat` in the same lock file without collision.

---

# Execution Order

```
Move 1 (20 min)   → Move 2 (2 hrs)   → Move 3 (3 hrs)   → Move 4 (4 hrs)
wire readback       real signals       leader election    first specialized fork
```

**Independent revert path:** Each move is a separate commit. If Move 4 breaks, revert Move 4; Moves 1-3 keep the value.

## Deploy rhythm

1. **Move 1 ships first.** It has the highest return-to-effort ratio in the system. After Move 1, watch for `playbook-created` memory entries over the next 48h; confirm at least 1 playbook has non-zero `successCount`.

2. **Move 2 ships second.** It makes Move 1 dramatically more valuable because now playbooks are created from the situations that actually contain information (corrections, recoveries), not just from happy-path completions.

3. **Move 3 ships third.** This is the biggest behavioral change — two containers now coordinate. Test in the multi-compose first. Do NOT deploy to the single-container VPS2 primary without testing this in isolation.

4. **Move 4 ships fourth.** This requires Move 3 because the fork-scoped locks assume leader election works.

---

# Global Rules

1. Use `scripts/deploy.sh` for every deploy. Do NOT use `docker build` directly.
2. Commit each move separately with subject `feat(hermes-leverage): move N — <title>`.
3. All new files follow existing module style — no default exports, named imports only, `.js` extensions in imports.
4. Every new fs write uses the atomic tmp+rename pattern from `instance-locks.ts`.
5. Every new external call wrapped in `.catch(() => {})` unless the failure path is explicitly handled.
6. No new dependencies. Everything ships with Node stdlib + already-installed packages.
7. Pre-commit hooks fail on VPS — use `git commit --no-verify` when deploying from VPS.

---

# What This Delivers

Today:
- Playbooks accumulate into a vault the agent never opens
- Flush runs rich logic on stub signals
- Locks are decorative, not electoral
- Forks are theoretical, never configured

After this spec:
- Every spawn decision consults past-proven playbooks → **compounding judgment**
- Learn-skill actually fires when the agent makes a recovery or gets corrected → **the situations with the most information become reusable procedures**
- Multi-instance coordination is real → **hot standby, clean cutover, no 409**
- The first specialized fork runs alongside the generalist → **Dom's team structure**

That is the Hermes advantage. The substrate was correct. These four moves extract the leverage.
