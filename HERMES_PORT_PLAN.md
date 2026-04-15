# Hermes Port Plan

## Decision

Do **not** hard-fork Hermes Agent.

OpenTrident should port **4 narrow primitives**:
- profile isolation
- scoped gateway/token locks
- procedural-memory playbooks
- session/worker flush prompts

Everything else is product bulk.

## Why

Hermes has two things worth stealing:
1. a **real profile system**
2. a **practical learning loop pattern**

But its "learning loop" is mostly:
- system prompt nudges
- `skill_manage` tool
- session-end flush turn

That means:
- **profiles** are a subsystem worth porting
- **learning** is a pattern worth adapting
- **gateway/platform breadth** is not worth forking

## What To Port

### 1. Profiles

Hermes source:
- `hermes_cli/profiles.py`
- `website/docs/user-guide/profiles.md`

What it does:
- isolated profile homes
- cloned config / memory / skills
- active profile selection
- export / import
- wrapper aliases

OpenTrident target:
- new files:
  - `src/multi/profile-home.ts`
  - `src/multi/profile-manager.ts`
  - `src/multi/profile-export.ts`
- touch later:
  - `src/config/paths.ts`
  - `src/multi/instance-registry.ts`
  - `src/planner/planner-memory.ts`

OpenTrident adaptation:
- one canonical identity repo
- multiple isolated runtime forks
- each fork gets:
  - state
  - sessions
  - planner rows
  - trust telemetry
  - memory overlays
- do **not** duplicate the whole identity contract per profile

### 2. Scoped Gateway / Token Locks

Hermes source:
- `gateway/status.py`

What it does:
- file-based scoped locks
- prevents two instances from using the same token/identity at once
- reduces split-brain during multi-instance runs

OpenTrident target:
- new file:
  - `src/multi/instance-locks.ts`
- integrate into:
  - `src/multi/instance-registry.ts`
  - `src/infra/heartbeat-runner.ts`
  - migration cutover flow in `src/migration/migrate.ts`

OpenTrident adaptation:
- lock on:
  - Telegram bot token
  - public channel publisher role
  - primary-leader heartbeat role
- this directly addresses the Telegram 409 conflict class from migration

### 3. Procedural Memory / Playbook Manager

Hermes source:
- `tools/skill_manager_tool.py`
- `website/docs/user-guide/features/skills.md`
- `agent/prompt_builder.py`

What it does:
- create / patch / edit reusable skills
- stores procedural know-how as files
- guards writes with validation, size limits, and security scanning

OpenTrident target:
- new files:
  - `src/planner/playbook-manager.ts`
  - `src/planner/playbook-guard.ts`
- integrate into:
  - `src/planner/planner-result-handler.ts`
  - `src/planner/trust-telemetry.ts`
  - `src/planner/memory-query.ts`

OpenTrident adaptation:
- call them **playbooks**, not generic skills
- only promote:
  - approved strategies
  - successful worker patterns
  - corrected draft/send flows
  - migration fixes worth reusing
- store them as narrow reusable procedures, not giant prompt dumps

Suggested storage:
- `~/.opentrident/playbooks/`
- categories:
  - `markets/`
  - `relationships/`
  - `engineering/`
  - `migration/`
  - `ops/`

### 4. Session / Worker Flush Pattern

Hermes source:
- `gateway/run.py`
- `agent/prompt_builder.py`
- `website/docs/user-guide/sessions.md`

What it does:
- before reset, runs a final pass
- nudges the agent to save durable memories and skills

OpenTrident target:
- new file:
  - `src/planner/planner-flush.ts`
- integrate into:
  - `src/planner/planner-result-handler.ts`
  - `src/infra/heartbeat-runner.ts`
  - `src/migration/migrate.ts`

OpenTrident adaptation:
- run flush when:
  - worker completes
  - planner row closes
  - migration finishes
  - strategic cycle rolls over
- flush should decide:
  - update trust telemetry only
  - write memory
  - promote a playbook
  - do nothing

## What Not To Port

Do **not** port:
- Hermes full gateway layer
- Hermes skills hub / marketplace
- Hermes broad platform adapter surface
- Hermes whole CLI structure
- Hermes docs-driven product complexity

OpenTrident already has the right substrate.

## Exact OpenTrident Mapping

### Already Exists

- signals / heartbeat:
  - `src/infra/heartbeat-runner.ts`
  - `src/infra/heartbeat-gmail-attention.ts`
  - `src/infra/heartbeat-github-attention.ts`
  - `src/infra/heartbeat-repo-attention.ts`
  - `src/infra/heartbeat-market-attention.ts`

- planner:
  - `src/planner/planner-inbox.ts`
  - `src/planner/planner-state.ts`
  - `src/planner/goal-origination.ts`
  - `src/planner/planner-orchestrator.ts`
  - `src/planner/planner-recovery.ts`
  - `src/planner/planner-result-handler.ts`
  - `src/planner/strategic-initiator.ts`
  - `src/planner/memory-query.ts`
  - `src/planner/trust-telemetry.ts`

- multi-instance / migration:
  - `src/multi/instance-registry.ts`
  - `src/multi/instance-messaging.ts`
  - `src/migration/compute-provisioner.ts`
  - `src/migration/migrate.ts`
  - `src/migration/health-monitor.ts`

### Add Next

Phase H1:
- `src/multi/instance-locks.ts`
- integrate into migration + runtime leader paths

Phase H2:
- `src/planner/playbook-manager.ts`
- `src/planner/playbook-guard.ts`

Phase H3:
- `src/planner/planner-flush.ts`

Phase H4:
- `src/multi/profile-home.ts`
- `src/multi/profile-manager.ts`
- `src/multi/profile-export.ts`

## Recommended Order

1. **Scoped locks first**
- smallest diff
- fixes a real migration/runtime bug class now

2. **Playbook manager second**
- turns approved outcomes into reusable procedures
- this is the highest-value Hermes learning import

3. **Flush pattern third**
- closes the loop between worker completion and retained learning

4. **Profiles fourth**
- bigger refactor
- best done after locks + playbooks exist

## Success Condition

OpenTrident can:
- run multiple isolated forks safely
- prevent token/leader collisions
- convert proven outcomes into reusable playbooks
- flush durable learning from completed work

That is the Hermes value.
Not the whole repo.

## One-Line Brief

Port Hermes as:
- **profiles**
- **locks**
- **playbooks**
- **flush**

Do **not** port Hermes as a new foundation.
