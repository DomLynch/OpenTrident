# PROJECT_STATE

## Decision

OpenTrident is live again as a memory-backed founder operator on one primary VPS.
The current job is not more surface area. The current job is persistence hardening, compounding judgment, and fail-loud operations.

## Live Reality

- primary VPS: `49.12.7.18`
- identity repo on VPS: `/opt/OpenTrident`
- runtime repo on VPS: `/opt/opentrident`
- persistent state: `/opt/opentrident-data/config`
- live containers: `opentrident-gateway`, `opentrident-cli`
- Telegram surface: live
- primary model: MiniMax M2.7 High Speed
- fallback model: GLM
- Brain memory: live again via Lucid + Temporal
- attention sources: Gmail, repo, GitHub, market
- planner: 7-mode orchestrator with trust telemetry and recovery logic

## Proven This Week

- Brain memory recall works again in production
- old Telegram token was revoked and the live bot is polling cleanly
- compounding loop was bootstrapped with real artifacts:
  - one signed snapshot bundle
  - one GitHub snapshot release
  - one playbook
  - one promoted doctrine entry
  - one weekly report
- Docker storage on VPS was cleaned hard:
  - image footprint reduced to ~7 GB
  - build cache reduced to 0 B
- old migration VPS `87.99.148.214` / Hetzner server `127036753` is gone

## What Is Real

- OpenTrident is not an identity-only spec anymore
- Brain-backed recall is a real moat
- persistence primitives now exist in production state, not just in code
- doctrine and playbook promotion are wired
- Nostr identity exists
- dashboard is live

## What Is Not Done

- automatic persistence still needs to prove itself without manual forcing
- Arweave anchoring is now gated honestly, but a real signed uploader path still is not configured
- weekly reports now read live state in fallback mode, but the autonomous weekly cycle still needs live proof
- specialized forks exist in code but only `general` is active
- world model is effectively empty
- Telegram fail-loud behavior needs live soak proof after deploy
- `deploy.sh` hardening needs live deploy proof after the new Brain/Telegram checks

## Canonical Files

Keep these as living truth:

- `AGENTS.md`
- `CLAUDE.md`
- `SYSTEM_PROMPT.md`
- `README.md`
- `PROJECT_STATE.md`
- `OPERATIONS.md`
- `ENDGAME_24H.md`
- `ENDGAME_48H.md`

Historical plans and superseded specs live in `archive/2026-04-cleanup/`.

## Current Priorities

1. keep snapshots/playbooks/doctrine/weekly reports running automatically
2. harden deploy verification so Brain memory cannot silently disappear again
3. add Telegram conflict fail-loud behavior
4. prove the first natural compounding cycle without manual bootstrap
5. only then activate specialized forks beyond `general`

## Non-Priorities

Do not optimize for:

- more dashboards
- more planning markdown
- more providers before failover is solid
- economics before persistence is trustworthy

## One-Sentence Summary

OpenTrident is now a live memory-backed operator with the first real compounding artifacts in state, but the next win is operational trust: make persistence automatic, loud on failure, and boring to maintain.
