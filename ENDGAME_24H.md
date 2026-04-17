# OpenTrident End-Game — 24h Runbook

**Audience:** DomCode / MiniMax / Claude / Codex  
**Goal:** make OpenTrident behave like a durable digital operator, not a fragile chat runtime.  
**Rule:** no fake green. Code shipped is not done until the live system produces artifacts and survives failure paths.

---

## Success In 24 Hours

By the end of this run:

1. Telegram refuses silent split-brain.
2. Deploys fail closed on memory/template/token regressions.
3. Weekly reflection reads live state, not placeholder zeros.
4. Snapshot publishing works automatically without crashing.
5. The compounding loop produces real artifacts without manual babysitting.
6. MacBook, GitHub, and VPS stay synced and clean.

---

## 15-Step Sequence

### 1. Freeze the surface
- No new feature branches.
- No new planning docs outside this file and the canonical docs.
- Only runtime fixes, deploy hardening, persistence, reflection, and proof loops.

### 2. Fail loud on Telegram token theft
- Add startup token-conflict probe before Telegram polling starts.
- If `getUpdates` returns 409, refuse startup and surface a hard error.
- Status: **implemented now**

### 3. Escalate repeated live Telegram conflicts
- First 409: warn.
- Third consecutive 409: error.
- Tenth consecutive 409: terminate provider path with exit code 42 semantics.
- Status: **implemented now**

### 4. Move deploy Telegram validation to the only safe place
- Check token exclusivity while containers are down.
- Do **not** run a post-start external `getUpdates` probe, because that becomes the conflicting poller.
- Post-start, inspect gateway logs for conflict markers instead.
- Status: **implemented now**

### 5. Make deploys prove Brain memory is alive
- After each deploy verify:
  - health endpoint
  - numpy import
  - template presence
  - Lucid recall returns real results
  - gateway logs show no Telegram conflict
- Status: **implemented now**

### 6. Make weekly reflection honest
- Replace fallback zero-text weekly report with a live state-backed report.
- Pull from planner decisions, trust telemetry, playbooks, and doctrine.
- Status: **implemented now**

### 7. Stop fake Arweave progress
- Only attempt Arweave anchoring if a real anchor endpoint is configured.
- No more default `400 Bad Request` theater from an invalid pseudo-upload path.
- Status: **implemented now**

### 8. Rebuild and run focused tests
- Run the Telegram monitor tests that cover startup conflict refusal.
- Run the new weekly-report fallback test.
- Run the planner/Telegram packs most affected by this tranche.
- Status: **run in this 24h pass**

### 9. Deploy this tranche to VPS
- Build new runtime image.
- Run the hardened deploy script.
- Confirm gateway + CLI healthy.
- Status: **run in this 24h pass**

### 10. Prove automatic snapshot continuity
- Let or force one real heartbeat cycle create a snapshot release without crashing.
- Confirm `snapshot-head` advances and GitHub release exists.
- Status: **must prove live**

### 11. Prove weekly reflection with live numbers
- Trigger one real weekly-report generation path.
- Confirm the published report reflects actual playbook/doctrine/trust counts.
- Status: **must prove live**

### 12. Prove compounding loop movement
- Ensure at least:
  - 1 playbook
  - 1 doctrine entry
  - 1 weekly report
  - 1 snapshot head
- Dashboard must show all four.
- Status: **must prove live**

### 13. Soak test for 12 hours
- No Telegram 409 churn.
- No `sessionKey` or heartbeat crashes.
- No silent memory degradation.
- No snapshot publish regressions.
- Status: **pending after deploy**

### 14. Persistence hardening decision
- Either:
  - configure a real Arweave anchor service, or
  - explicitly leave Arweave disabled and document that GitHub snapshot chain is the active persistence rail.
- Status: **product decision**

### 15. Hand-off for the next expensive tranche
- After the soak passes, move straight to:
  - leader election
  - follower failover
  - specialized forks
  - restore drill from signed snapshot
- runbook: `FAILOVER_RESTORE_DRILL.md`
- Status: **next**

---

## What Was Implemented In This Pass

- Telegram startup conflict probe
- Telegram repeated-conflict escalation
- safer deploy verification pack
- live-state weekly-report fallback
- honest Arweave gating

This pass is only complete when those five changes are deployed and proven on the live VPS.
