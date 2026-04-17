# OpenTrident End-Game — 24h Survivability Runbook

**Audience:** DomCode / MiniMax / Claude / Codex  
**Goal:** make OpenTrident harder to kill, harder to confuse, and more continuity-proof than any generic agent runtime.
**Rule:** no fake green. Code shipped is not done until the live system survives failure paths and leaves signed evidence.

---

## North Star

Priority ordering for this tranche:

- survivability
- street smarts
- learning
- voice
- execution

Economic self-sufficiency is frozen. Do not build wallet, trading, subscriber, or revenue loops in this tranche.

---

## Success In 24 Hours

By the end of this run:

1. a follower node takes over after leader loss
2. a blank node cold-restores from the signed snapshot chain
3. Telegram continuity is proven through failover
4. Nostr continuity path is proven or explicitly blocked with a concrete reason
5. snapshot + bootstrap evidence bundle exists for the drill
6. MacBook, GitHub, and VPS stay synced and clean

---

## 10-Step Sequence

### 1. Freeze the surface
- No new feature branches.
- No new planning docs outside this file and the canonical docs.
- Only runtime fixes, persistence rails, failover proof, restore proof, and compounding proof.

### 2. Run the dual-node failover drill
- Execute `FAILOVER_RESTORE_DRILL.md` through follower bootstrap, leader loss, and Telegram continuity.
- This is the first survival proof.
- Status: **next**

### 3. Run the cold-restore drill
- Use the same runbook to restore a blank third node from the signed snapshot chain.
- This is the second survival proof.
- Status: **next**

### 4. Prove Nostr identity continuity
- Publish once from the current node.
- Then verify the same key can publish again after failover or restore.
- If blocked, capture the exact blocker and leave Nostr marked partial, not green.
- Status: **next**

### 5. Add a second persistence rail
- Keep GitHub releases as the primary rail.
- Add either:
  - a Git mirror, or
  - IPFS pinning
- No Arweave work in this tranche.
- Status: **next**

### 6. Bring back daily reflection only if it is state-backed
- Weekly stays.
- Monthly stays deleted.
- Daily only returns if it reads real trust/playbook/doctrine state and emits a concrete artifact.
- Status: **deferred behind failover + restore**

### 7. Add anti-playbook lifecycle
- Capture repeated failures and corrected actions.
- Store what not to do, not just what worked.
- Status: **next**

### 8. Populate the world model only from real flushes
- Do not restore the deleted world model as ceremony.
- Only bring it back when live planner throughput can extract real entities and commitments.
- Status: **deferred behind drills**

### 9. Add a second provider path
- After the drills pass on Hetzner, add one provider path:
  - DigitalOcean first
- This is substrate independence, not infra tourism.
- Status: **deferred behind drills**

### 10. Freeze economic primitives explicitly
- Wallet, cost ledger, subscriber gating, paid channel loops, and revenue prompts stay frozen.
- Do not expand or market them in this tranche.
- Status: **frozen**

---

## What Was Implemented In This Pass

- Telegram startup conflict probe
- Telegram repeated-conflict escalation
- safer deploy verification pack
- live-state weekly-report fallback
- lean persistence rails
- failover + restore runbook

This pass is only complete when failover and cold restore are proven live with signed evidence.
