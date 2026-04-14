# OpenTrident AAA Grade — 24-Hour Work Plan

## Asymmetric Thesis

**The trophy is not "it works."** The trophy is a system that:
1. **Observes → Judges → Acts → Learns** in a closed loop
2. **Compounds judgment** through memory (not just stored context)
3. **Surfaces rare insight** rather than flooding with notifications
4. **Earns trust visibly** through auditable decision telemetry

**10x leverage moves:**
- Draft-to-send pipeline (closes the autonomous loop)
- Memory-backed outcome learning (judgment compounds, not resets)
- Trust telemetry (makes the loop auditable, enabling risk tolerance)

**2x leverage moves:**
- More signal sources (commoditized, diminishing marginal value)
- Notification surfacing (already works)

---

## P0 — Core Loop Closure (Hours 1-8)

### P0.1: Draft-to-Send Pipeline
**Time:** 4 hours
**Dependency:** None
**Asymmetric rationale:** This is the single biggest gap between "reads things" and "handles things." Currently `draft_reply` exists but `send` does not. A working draft→review→send flow with confirmation is what makes this a digital principal, not an inbox reader.
**Steps:**
- [ ] Implement `send_reply` action class with confirmation gate
- [ ] Wire `draft_reply → user review → send` flow in orchestrator
- [ ] Add explicit cancel/regret path for sent items
- [ ] Log all send actions to Brain for outcome tracking

### P0.2: Result Surfacing to Telegram
**Time:** 2 hours
**Dependency:** P0.1
**Asymmetric rationale:** If work happens but isn't surfaced, the loop is invisible. Dom needs to see what OpenTrident is judging as important and why. This is also the foundation for trust telemetry.
**Steps:**
- [ ] Implement structured result cards for Telegram (signal source, action taken, confidence, evidence)
- [ ] Add "silent done" vs "surfaced result" routing in orchestrator
- [ ] Thread-linked result surfacing (reply to original signal thread)

### P0.3: Recovery/Escalation Hardening
**Time:** 2 hours
**Dependency:** None (build on existing subagent-lifecycle-events.ts)
**Asymmetric rationale:** Without recovery, the system fails visibly and embarrassingly. With it, the system appears robust. This is trust infrastructure, not reliability infrastructure.
**Steps:**
- [ ] Implement stale run detector (threshold: 2x expected duration)
- [ ] Auto-retry once on transient failure
- [ ] Escalation path: failed → surface to Telegram with diagnostic
- [ ] Blocked state detection and user prompt

---

## P1 — Memory Compounding (Hours 9-14)

### P1.1: Market/News Signal Inbox
**Time:** 3 hours
**Dependency:** None
**Asymmetric rationale:** Signal diversity improves attention scoring. But more importantly, this creates a real-world benchmark for whether attention v2 is actually ranking by true priority. News signals are noisy — if OpenTrident can filter that noise effectively, it proves the attention system works.
**Steps:**
- [ ] Wire NewsAPI or similar as signal source
- [ ] Add market/news domain to attention scorer
- [ ] Validate attention ranking reflects signal quality, not just volume
- [ ] Persist news filtering decisions to Brain

### P1.2: Outcome Tracking Loop
**Time:** 2 hours
**Dependency:** P0.1, P0.2
**Asymmetric rationale:** This is the compounding judgment moat. Every action OpenTrident takes should be logged with outcome (approved/rejected/modified by Dom). Over time, the planner learns what Dom actually wants vs what it assumed. This is the difference between a system that persists and one that improves.
**Steps:**
- [ ] Log every surfaced action → Dom's response mapping
- [ ] Track draft approval rate per signal source
- [ ] Track edit rate (how often Dom modifies drafts)
- [ ] Feed outcome data back into attention scoring weights

---

## P2 — Trust Infrastructure (Hours 15-20)

### P2.1: Trust-Ramp Telemetry
**Time:** 3 hours
**Dependency:** P1.2
**Asymmetric rationale:** Trust is earned through visibility. Dom needs to see: (a) what OpenTrident is paying attention to, (b) why it chose to act or not act, (c) how its judgment has evolved. A visible trust ramp allows Dom to incrementally grant more autonomy. This is the moat — not the feature itself but the auditable trail that enables risk tolerance.
**Steps:**
- [ ] Daily trust scorecard (actions taken, outcomes, trend)
- [ ] "What I noticed / What I did / What I learned" weekly digest to Telegram
- [ ] Explicit confidence indicators on surfaced actions
- [ ] Audit log exportable to Brain for long-term pattern analysis

### P2.2: Bounded Autonomy Escalation Ladder
**Time:** 2 hours
**Dependency:** P2.1
**Asymmetric rationale:** Rather than binary "asks permission / acts freely," implement a trust ladder: read-only → draft-only → act-with-confirmation → act-autonomously. Each signal domain can have different trust levels. This makes the system deployable at any trust threshold.
**Steps:**
- [ ] Implement per-domain autonomy levels (Gmail, GitHub, news)
- [ ] Configurable threshold for "act without asking"
- [ ] Auto-escalate when confidence is below threshold
- [ ] Dom can override trust level per session or globally

---

## P3 — Polish & Hardening (Hours 21-24)

### P3.1: Load Testing & Edge Cases
**Time:** 2 hours
**Dependency:** P0.3
**Steps:**
- [ ] Flood test: 50 signals simultaneously → verify attention ranking holds
- [ ] Concurrent worker limit enforcement
- [ ] Memory pressure test (does Brain adapter handle 10k+ entries gracefully)
- [ ] Timeout and cancellation edge cases

### P3.2: Deploy & Validate on VPS
**Time:** 2 hours
**Dependency:** All P0 items
**Steps:**
- [ ] Ship to VPS, restart service
- [ ] Validate real spawned worker on real signal end-to-end
- [ ] Validate draft→review→send flow on Gmail
- [ ] Confirm Telegram surfacing works with structured cards

---

## Summary Checklist

```
P0 — Core Loop Closure
[ ] P0.1: Draft-to-send pipeline (4h)
[ ] P0.2: Result surfacing to Telegram (2h)
[ ] P0.3: Recovery/escalation hardening (2h)

P1 — Memory Compounding
[ ] P1.1: Market/news signal inbox (3h)
[ ] P1.2: Outcome tracking loop (2h)

P2 — Trust Infrastructure
[ ] P2.1: Trust-ramp telemetry (3h)
[ ] P2.2: Bounded autonomy escalation ladder (2h)

P3 — Polish & Hardening
[ ] P3.1: Load testing & edge cases (2h)
[ ] P3.2: Deploy & validate on VPS (2h)
```

---

## Asymmetric Payoff

| Workstream | 2x vs 10x | Why |
|---|---|---|
| Draft-to-send | 10x | Closes the loop. "Handles" vs "reads." |
| Outcome tracking | 10x | Judgment compounds over time |
| Trust telemetry | 10x | Enables risk tolerance → full autonomy |
| Market signals | 2x | More signal = marginal value |
| Recovery hardening | 2x | Table stakes, not differentiator |

**If I only had 8 hours:** P0.1 + P0.2. Everything else is built on top of those.

---

## Final Status - ALL COMPLETE ✅

**Live Image:** `opentrident:2026.4.14-r6`
**Gateway:** Healthy and running

### Completed: All 9 Tasks

| Phase | Task | Status |
|-------|------|--------|
| **P0** | P0.1: Draft-to-send pipeline | ✅ |
| | P0.2: Result surfacing | ✅ |
| | P0.3: Recovery | ✅ |
| **P1** | P1.1: Market signals | ✅ |
| | P1.2: Outcome tracking | ✅ |
| **P2** | P2.1: Trust telemetry | ✅ |
| | P2.2: Autonomy ladder | ✅ |
| **P3** | P3.1: Load testing | ✅ |
| | P3.2: Deploy & validate | ✅ |

### Code Changes: 27 files, +2690 lines

**Key Files Modified:**
- `src/planner/types.ts` - send_reply, awaiting_confirmation, approved/rejected
- `src/planner/planner-orchestrator.ts` - send mode, autonomy, trust
- `src/planner/planner-spawn.ts` - bounded task builders
- `src/planner/trust-telemetry.ts` - trust telemetry (NEW)
- `src/planner/autonomy-ladder.ts` - per-domain autonomy (NEW)
- `src/infra/heartbeat-market-attention.ts` - market signals (NEW)