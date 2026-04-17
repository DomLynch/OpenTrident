# OpenTrident Upstream Extractions

## Purpose

OpenTrident should not hard-fork generic orchestration products wholesale.

It should extract the smallest high-leverage primitives from upstream projects and
rebuild them inside the existing OpenTrident runtime.

This file is the source-of-truth for:
- what to borrow
- what to skip
- what to build next

## Decision

Do **not** fork 10 orchestration repos.

Do this instead:

1. evaluate `hcom` as infrastructure
2. strip-mine `agent-orchestrator`
3. copy one loop primitive from `swarms`
4. use `maestro` only as prompt inventory later

## Priority Order

### 1. hcom
Repo:
- `https://github.com/aannoo/hcom`

Why it matters:
- local message bus and event log
- agent-to-agent messaging across terminals
- explicit envelope semantics
- native Claude / Codex / Gemini / OpenCode support

Verified useful primitives:
- direct/broadcast routing
- `intent`
- `thread`
- `reply_to`
- event subscriptions
- bundle-based handoffs

What to take:
- envelope schema
- routing semantics
- event subscription model

What to skip:
- do not absorb the Rust codebase into OpenTrident
- do not rebuild a giant terminal-TUI first

Recommended action:
- treat `hcom` as a protocol/infrastructure reference first
- optionally install it later for evaluation in multi-instance dev workflows

### 2. agent-orchestrator
Repo:
- `https://github.com/ComposioHQ/agent-orchestrator`

Why it matters:
- closest product match to OpenTrident's future planner/orchestrator layer
- explicit orchestrator/worker split
- autonomous CI / review / recovery workflow

Verified useful primitives:
- orchestrator spawns isolated workers
- workers operate in distinct lifecycle states
- reactions route failures/comments back into active work
- plugin architecture proves surface separation

What to take:
- session lifecycle shape
- orchestrator-as-coordinator pattern
- stuck/recovery scanner
- worker supervision concepts

What to skip:
- dashboard
- CLI product layer
- marketplace/plugin breadth
- tmux/product chrome

Recommended action:
- strip-mine patterns, not codebase bulk

### 3. swarms
Repo:
- `https://github.com/The-Swarm-Corporation/swarms`

Why it matters:
- one useful autonomy primitive

What to take:
- `run-until-done` / `max_loops="auto"` style execution semantics

What to skip:
- framework abstractions
- swarm strategy bloat
- general-purpose orchestration surface

Recommended action:
- copy the loop idea only

### 4. maestro
Use only as:
- specialist role prompt inventory

What to take:
- role wording patterns for future spawned specialists

What to skip:
- orchestration architecture dependency

## 5 Core Primitives To Build

### 1. Planner envelope
Source inspiration:
- `hcom`

Build:
- one shared envelope type for planner/orchestrator flow

Fields:
- `from`
- `to`
- `intent`
- `thread`
- `reply_to`
- `body`
- `evidence`
- `metadata`

### 2. Session lifecycle
Source inspiration:
- `agent-orchestrator`

Build:
- planner-visible lifecycle wrapping existing OpenTrident session/subagent state

States:
- `candidate`
- `selected`
- `spawned`
- `running`
- `done`
- `failed`
- `blocked`
- `escalated`

### 3. Coordinator pattern
Source inspiration:
- `agent-orchestrator`

Build:
- planner coordinates
- spawned workers execute

Rule:
- planner should decide and supervise
- planner should not do the worker task itself

### 4. Run-until-done loop
Source inspiration:
- `swarms`

Build:
- spawned work continues until self-assessed complete, failed, or escalated

### 5. Recovery scanner
Source inspiration:
- `agent-orchestrator`

Build:
- detect stale runs
- retry / downgrade / escalate

## Where This Maps In OpenTrident

Live runtime seams already exist:

- attention:
  - `/opt/opentrident/src/infra/heartbeat-attention.ts`
  - `/opt/opentrident/src/infra/heartbeat-runner.ts`
  - `/opt/opentrident/src/infra/heartbeat-gmail-attention.ts`

- worker spawn:
  - `/opt/opentrident/src/agents/subagent-spawn.ts`
  - `/opt/opentrident/src/agents/subagent-spawn.runtime.ts`
  - `/opt/opentrident/src/agents/subagent-spawn-plan.ts`

- lifecycle:
  - `/opt/opentrident/src/gateway/session-lifecycle-state.ts`
  - `/opt/opentrident/src/agents/subagent-lifecycle-events.ts`

This is why OpenTrident should not adopt a new framework.
It already has the right substrate.

## Build Sequence

Shipped:
1. repo/GitHub signal inbox
2. planner inbox
3. planner state
4. goal origination
5. coordinator

Next:
1. recovery scanner hardening
2. richer bounded worker spawning
3. run-until-done worker loops
4. specialist role prompts later

## Success Condition

OpenTrident can:
- observe real signals
- synthesize a goal
- surface one next action
- track the resulting lifecycle cleanly

That bridge is now in place.

Next:
- move from surfaced goals to richer bounded execution
- harden recovery/escalation
- let workers run until done
