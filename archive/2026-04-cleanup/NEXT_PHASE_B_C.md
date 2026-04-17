# OpenTrident — Next Phase: Moves B + C

Two parallel workstreams for DomCode / MiniMax.
Move B and Move C are independent — can run in parallel by different sessions.

Read first: `AGENTS.md` → `PROJECT_STATE.md` → `ROADMAP.md` → `OPERATIONS.md`

Deploy rule: Always use `scripts/deploy.sh`. Never raw `docker build`. Never `--no-cache`.

---

# Move B: First Real Self-Migration

## Goal

Stop simulating. Execute a real migration of OpenTrident to a second VPS, prove it works, then wire the system so it can self-trigger migration when its host fails.

## Why It Matters

Right now `openclaw infra migrate --dry-run` outputs a plan but nothing has ever moved. Until a real migration happens:
- We don't know if the migration code actually works end-to-end
- OpenTrident is still tethered to one VPS
- "Self-migration" is a spec, not a capability

A real migration proves substrate independence. A self-triggered migration proves autonomy.

## Phases

### B.1 — Supervised First Migration (1 day)

The goal is to do the migration once with human oversight, observe everything, fix what breaks.

**Steps:**

1. **Pre-flight audit** — read `src/migration/migrate.ts` and walk every step. List assumptions (env vars, file paths, network state, DNS, Telegram webhook). Document any step that would fail without real credentials.

2. **Provision a second Hetzner VPS** — use the real `openclaw infra provision` command (not dry-run). Match specs of current VPS. New IP becomes the migration target.

3. **Generate a real deployment manifest** from the current running instance: `openclaw manifest generate --output /tmp/migration-manifest.json`

4. **Transfer** — copy the manifest, state files, Docker image reference, and env vars to the new VPS.

5. **Boot the new instance** — run `scripts/deploy.sh` on the new host using the transferred image tag.

6. **Parallel health check** — verify both old and new instances are healthy and responding. Check:
   - Gateway health on both
   - Telegram bot responding on both (temporarily)
   - Planner state loaded correctly on new
   - Memory accessible on new
   - Trust telemetry accessible on new

7. **Cutover decision point** — if new instance is healthy, update Telegram webhook to point to new host. Watch for 1 hour. If no issues, decommission old.

8. **Post-mortem** — record the full flow in `/migration-log.md`. List every manual intervention needed. Every unexpected error. Every assumption that broke.

**Success criteria:**
- New VPS running OpenTrident healthy
- Telegram bot responding from new host
- Planner state intact (compare plannerRows before/after)
- Memory intact (compare memory-v1.json before/after)
- Old VPS decommissioned

**Blocker watch:**
- **DNS/webhook update is the risky step.** Telegram webhook points at a hostname or IP. If it's an IP, the cutover needs coordinated timing. If it's a hostname, the DNS update has propagation delay. Figure out which one early.
- **SSH key distribution.** New VPS needs the same SSH keys as old for future ops access. Pre-seed via cloud-init, or add post-boot.
- **Persistent volume state.** Brain memory substrate may live outside the Docker volume. If so, the migration must include that path too.

### B.2 — Fix What B.1 Broke (0.5-1 day)

The first migration will expose bugs. Expected bugs:
- Env vars not carried across
- File permissions wrong on new host
- Network rules missing
- DNS cache issues
- Telegram webhook confusion

For each, patch `src/migration/migrate.ts` and related modules so the next migration runs clean. Do NOT leave these as documentation. Code them.

### B.3 — Self-Trigger Wiring (1 day)

Once B.1 and B.2 prove the migration actually works, wire OpenTrident to trigger migration itself.

**Files to touch:**
- `src/migration/health-monitor.ts` — add migration trigger conditions
- `src/migration/migrate.ts` — add autonomous entry point
- `src/infra/heartbeat-runner.ts` — wire health check → migration trigger

**Trigger conditions:**
1. Disk space < 5GB for 3 consecutive health checks (15 min minimum)
2. Gateway health failing for 3 consecutive checks
3. Model API failing for 10 consecutive checks
4. Hetzner API returns server termination notice (poll Hetzner API for scheduled events)

**Guardrails:**
- Migration requires a non-dry-run wallet balance check: new VPS must be affordable within `DAILY_SPENDING_LIMIT_SOL` or don't migrate
- Surface migration intent to Telegram 5 minutes before executing — Dom can cancel with "abort migration"
- Post-migration, send Telegram summary: "Migrated from X to Y because Z. Cost: $W. Downtime: N seconds."

**Escalation path:**
- If migration fails: revert to old host, mark migration as `failed`, increment `migrationFailureCount`
- If `migrationFailureCount >= 3`: stop auto-triggering, surface `urgent` escalation to Telegram: "Migration failing repeatedly, human intervention needed"

### B.4 — Parallel Redundancy (1-2 days, optional but recommended)

Once migration works, run **two OpenTrident instances in parallel on different hosts** permanently. Not coordinator+worker. Two full instances, each capable of running alone.

**Why:** If one VPS dies, the other is already live. No migration needed, just promote the standby.

**Architecture:**
- Instance A = primary (current VPS)
- Instance B = standby (second VPS, provisioned in B.1)
- Both read from shared Brain memory substrate
- Both poll attention signals independently
- Coordination: leader election via shared state file timestamp
- Only leader sends to Telegram (avoid double-reply)
- If leader heartbeat stops > 2 minutes, follower promotes itself

**Files to build:**
- `src/multi/leader-election.ts` — simple timestamp-based leader lock
- `src/multi/instance-lifecycle.ts` — promotion/demotion logic
- `src/infra/heartbeat-runner.ts` — check leader status before acting

**Success criteria:**
- Two instances running, one leader, one follower
- Kill the leader container, follower promotes within 2 minutes
- Telegram continues receiving responses with no user-visible interruption

## Move B Deliverables

- Second VPS provisioned and running OpenTrident ✅
- Migration path validated end-to-end ✅
- Self-trigger wiring live ✅
- (Optional) Two-instance parallel redundancy ✅
- Post-mortem doc in repo
- Updated `OPERATIONS.md` with multi-host ops commands

## Move B Timeline

- B.1: Day 1 (supervised, ~4 hours active work)
- B.2: Day 2 (~4 hours fixes)
- B.3: Day 3 (~4 hours)
- B.4: Day 4-5 (~8 hours, optional)

Total: **3-5 days**.

---

# Move C: Goal Origination From Memory

## Goal

Add a strategic initiator that proposes goals OpenTrident should pursue, independent of any current attention signal. Turns OpenTrident from an intelligent responder into a goal-originating principal.

## Why It Matters

Current planner synthesizes goals by reacting to attention signals: "email came in → respond," "project has stale CI → open issue." This is reactive intelligence.

End-game OpenTrident thinks: "Dom hasn't reviewed his crypto positions in 12 days, memory shows his typical review cadence is 7 days, last 3 reviews resulted in profitable adjustments. Propose: run a position review brief today." No external signal. Pure initiative from memory + patterns.

This is the difference between a smart assistant and a second principal.

## Phases

### C.1 — Memory Query Infrastructure (1 day)

The current memory layer (`planner-memory.ts`) stores and retrieves entries but has no pattern recognition or strategic query API. Build one.

**Files to build:**
- `src/planner/memory-query.ts` (new)

**Query primitives:**

```typescript
// Find decisions of a type from the last N days
queryDecisions(params: {
  domain?: PlannerDomain;
  lookbackDays: number;
  outcome?: "approved" | "rejected" | "all";
}): MemoryEntry[]

// Find time gaps: "when did I last X?"
queryLastOccurrence(params: {
  category: MemoryEntry["category"];
  keyPattern: string;
}): { lastSeenMs: number; daysSince: number; entry: MemoryEntry } | null

// Find patterns: "what usually happens after X?"
queryFollowUps(params: {
  triggerKey: string;
  withinDays: number;
}): { followUp: MemoryEntry; latencyDays: number }[]

// Find frequency: "how often do I do X?"
queryFrequency(params: {
  category: MemoryEntry["category"];
  keyPattern: string;
  lookbackDays: number;
}): { count: number; averageIntervalDays: number; lastSeenMs: number }
```

**Data sources:**
- `memory-v1.json` (local memory store)
- Brain memory substrate (Lucid + Temporal + corpus) — query via existing Brain adapter
- `planner-v1.json` (planner state history)
- `trust-telemetry-v1.json` (decision outcomes)

**Test:** Each query primitive must return real results when run against live memory.

### C.2 — Strategic Initiator Module (1 day)

New module that runs once per day (or on explicit trigger) and proposes goals from memory patterns.

**Files to build:**
- `src/planner/strategic-initiator.ts` (new)

**Core function:**

```typescript
export async function generateStrategicGoals(params: {
  nowMs: number;
  lookbackDays?: number; // default 14
}): Promise<PlannerItem[]>
```

**Strategy detectors:**

Each detector reads memory patterns and generates a `PlannerItem` with domain, score, summary, and evidence.

1. **Review cadence detector** — "Dom reviews X every N days, last review was M days ago, M > N → propose review"
   - Checks: trading positions, project status, key relationships, financial ledger
   - Score: (M - N) / N, capped at 1.0

2. **Decision drift detector** — "Dom made a decision about X, N days passed, no follow-through action recorded"
   - Checks planner state for `selected`/`approved` goals with no `done` follow-up
   - Score: based on age + original decision score

3. **Pattern break detector** — "Dom typically does X on Tuesdays, this Tuesday passed, X didn't happen"
   - Checks trust telemetry for recurring patterns and their interruptions
   - Score: based on pattern confidence × interruption significance

4. **Stale commitment detector** — "Dom committed to X in memory, deadline approaching, no progress recorded"
   - Checks memory for `decision` entries with time-bound language ("by Friday", "next week")
   - Score: urgency + commitment significance

5. **Relationship gap detector** — "Dom hasn't interacted with person P in > typical cadence"
   - Uses Brain relationship_profiles for typical cadence
   - Score: (current gap - typical gap) / typical gap

6. **Market cadence detector** — "Dom normally checks market conditions every N days during volatile periods, volatility is high, last check was M days ago"
   - Combines market signal volatility with review cadence
   - Score: volatility × gap ratio

**Output format:** Each detector returns zero, one, or two `PlannerItem`s with:
- `id`: `strategic:<detector-name>:<specific-subject>`
- `intent`: `"goal"` (new intent type — add to types.ts)
- `domain`: inferred from subject
- `score`: 0.0-1.0
- `summary`: human-readable description
- `evidence`: memory entries that justify this goal
- `source`: `"strategic-initiator"`

### C.3 — Wire Into Planner Inbox (0.5 day)

Current `buildPlannerInbox` only reads from attention signals. Add strategic goals as a second input.

**File:** `src/planner/planner-inbox.ts`

**Change:**

```typescript
// Before
const attention = resolveHeartbeatAttention(params);
return attention.map(...);

// After
const attention = resolveHeartbeatAttention(params);
const strategic = await generateStrategicGoals({
  nowMs: params.nowMs,
  lookbackDays: 14,
});
const combined = [...attention.map(...), ...strategic];
return sortByScore(combined);
```

**Cadence:** Strategic goals don't regenerate every heartbeat. Cache them in `strategic-goals-v1.json`, regenerate once per 6 hours. Otherwise we burn cycles running memory queries on every heartbeat.

### C.4 — New Planner Intent + Trust Handling (0.5 day)

Strategic goals need distinct handling because they're higher-risk than reactive signals.

**Changes:**

1. Add `"strategic"` to `PlannerIntent` type
2. Strategic goals default to `surface_only` action class, never `send_reply`, even at high scores
3. Trust telemetry tracks strategic goal outcomes separately from reactive ones:
   - Add `"strategic-initiator"` as a source in `trust-telemetry-v1.json`
   - Approval rate for strategic goals is tracked independently
4. Autonomy ladder: strategic goals only promoted after 10+ approved strategic actions, not 5
5. Planner prompt block mentions source: "This is a strategic goal originated from memory patterns, not a reactive signal."

### C.5 — Daily Strategic Cycle (0.5 day)

Run strategic initiator once per day at a configurable time (default: 9am local).

**Files to touch:**
- `src/infra/heartbeat-runner.ts` — add strategic cycle gate
- `src/planner/strategic-initiator.ts` — expose `runDailyStrategicCycle()` entry point

**Logic:**

```typescript
// In heartbeat-runner, after planner decision, before worker spawn:
const nowHour = new Date(params.nowMs).getHours();
const strategicRunKey = `strategic:last-run:${getDateKey(params.nowMs)}`;
const alreadyRan = store[strategicRunKey] === true;

if (nowHour >= 9 && nowHour < 10 && !alreadyRan) {
  await runDailyStrategicCycle({ nowMs: params.nowMs });
  store[strategicRunKey] = true;
  await saveSessionStore(storePath, store);
}
```

### C.6 — Strategic Goal Review UI (0.5 day)

When a strategic goal is surfaced, it should be clearly labeled in Telegram so Dom knows it's origination, not reaction.

**Format:**

```
🎯 Strategic Goal (from memory patterns)

Goal: Review BTC position
Why: Last position review was 12 days ago, typical cadence is 7 days. Last 3 reviews averaged +4% adjustment.

Evidence:
- [2026-04-03] Reviewed BTC at $X, exited long
- [2026-03-27] Reviewed BTC at $Y, added to position
- [2026-03-20] Reviewed BTC at $Z, held

Score: 0.71
Action class: brief

Reply: approve / reject / remind me in 3 days
```

Add a new reply handler for "remind me in N days" — shifts the goal to `deferred` status until the date.

## Move C Deliverables

- `src/planner/memory-query.ts` with 4 query primitives
- `src/planner/strategic-initiator.ts` with 6 strategy detectors
- Strategic goals wired into planner inbox with 6-hour cache
- New intent type, trust handling, autonomy ramp for strategic goals
- Daily strategic cycle running at 9am
- Strategic goal Telegram format with "remind me" action

## Move C Success Criteria

Within 3 days of deploying Move C:
- At least one strategic goal has been surfaced to Dom that wasn't triggered by any external signal
- Dom has approved at least one strategic goal
- Trust telemetry shows strategic goals as a separate source
- The goal was useful (Dom rates it ≥ 0.7 on a post-hoc review)

The wow moment: Dom gets a Telegram message at 9am that says "I noticed you haven't reviewed X in 12 days, typical cadence is 7, propose reviewing it now" — and Dom thinks *"I was actually just thinking about that."*

## Move C Timeline

- C.1: Day 1 (~4 hours)
- C.2: Day 2 (~6 hours)
- C.3: Day 3 morning (~2 hours)
- C.4: Day 3 afternoon (~2 hours)
- C.5: Day 4 morning (~2 hours)
- C.6: Day 4 afternoon (~2 hours)

Total: **4 days** with careful testing.

---

# Parallelization

Move B and Move C are completely independent. Two MiniMax sessions can run them in parallel:

- **Session 1:** Move B — migration
- **Session 2:** Move C — goal origination

They touch different files. Zero conflict.

Merge points:
- Both commit to `main` on identity repo
- Both deploy with `scripts/deploy.sh`
- Both update `PROJECT_STATE.md` when complete

---

# Ordering If Sequential

If you only have one dev session, do **Move C first**.

Why:
1. Move C changes how OpenTrident *thinks*, Move B changes where it *runs*. Thinking matters more.
2. Move C is faster (4 days vs 3-5)
3. Move C generates strategic goals that will be valuable even while Move B is in progress
4. Move B has real risk (could break production), Move C is additive (surfaces new intent but doesn't change old behavior)

---

# Rules For Both Moves

1. No `--no-cache` builds. Use `scripts/deploy.sh`.
2. Commit after each phase completes. Push to both repos.
3. Never leave broken state — if something fails, fix before moving on.
4. Surface progress to Telegram via `/status` or direct message so Dom can check from his phone.
5. Write the post-mortem. Every move has one. Real documentation, not marketing.
6. If blocked > 1 hour, note it in PROJECT_STATE and move to the next phase.
7. Deploy to VPS after each phase, verify healthy, then move on.
