# OpenTrident Planner-Orchestrator Spec

## Purpose

Turn OpenTrident from `attention -> notification` into:

`signals -> attention -> planner -> spawned work -> result -> memory`

This is the first real step from autonomous assistant toward second-principal behavior.

## Status

Planner-orchestrator v1 is already live.

Shipped:
- planner inbox/state
- goal origination
- bounded surface-first orchestration
- Gmail + repo + GitHub-backed inputs

Next:
- richer read-only / draft-producing worker spawning
- recovery/escalation hardening
- additional signal domains like market/news

## Current Runtime Reality

Live runtime is **not** greenfield. It already has the core primitives:

- attention scoring and heartbeat prompting
- system event intake
- subagent spawn
- session lifecycle persistence
- daemon / cron / gateway plumbing

So the planner-orchestrator should be a **thin layer on top**, not a new framework.

## Canonical Repos

- Identity repo: `/Users/domininclynch/Desktop/Business/OpenTrident`
- Live runtime repo on VPS: `/opt/opentrident`
- Runtime snapshot repo: `https://github.com/DomLynch/OpenTrident-runtime`
- Brain memory substrate: `/Users/domininclynch/Desktop/Business/Brain - 18-03-2026`

## Real Runtime Seams To Use

### Attention / heartbeat
- `/opt/opentrident/src/infra/heartbeat-attention.ts`
- `/opt/opentrident/src/infra/heartbeat-runner.ts`
- `/opt/opentrident/src/infra/heartbeat-gmail-attention.ts`

What exists:
- ranked attention pressures
- idle-only heartbeat execution
- Gmail-derived signals already entering heartbeat
- repo/GitHub-derived signals already entering heartbeat

### Session lifecycle
- `/opt/opentrident/src/gateway/session-lifecycle-state.ts`
- `/opt/opentrident/src/agents/subagent-lifecycle-events.ts`

What exists:
- `running -> done/failed/killed/timeout` style lifecycle persistence
- derived runtime timing and terminal outcomes

### Spawn / worker execution
- `/opt/opentrident/src/agents/subagent-spawn.ts`
- `/opt/opentrident/src/agents/subagent-spawn.runtime.ts`
- `/opt/opentrident/src/agents/subagent-spawn-plan.ts`

What exists:
- subagent spawn API
- model/thinking plan application
- attachment/materialization support
- cleanup hooks
- active-run counting and registration

### Sessions / store / targeting
- `/opt/opentrident/src/config/sessions.ts`
- `/opt/opentrident/src/commands/sessions.ts`
- `/opt/opentrident/src/channels/session-envelope.ts`
- `/opt/opentrident/src/channels/session.ts`

What exists:
- persisted sessions
- session addressing
- channel/session metadata

## External Patterns To Borrow

### 1. hcom
Use as reference for:
- message envelope
- routing semantics
- reply/thread linkage

Steal:
- `from`
- `to`
- `intent`
- `thread`
- `reply_to`
- `body`

Do **not** build a giant chat bus first. Use the envelope shape.

### 2. agent-orchestrator
Use as reference for:
- orchestrator-as-coordinator
- worker lifecycle
- stuck/recovery scanner

Steal:
- coordinator spawns work, does not do the work itself
- explicit session states
- recovery/escalation pass

### 3. swarms
Use one idea only:
- run-until-done loop with self-assessed completion

### 4. maestro
Use as reference library for future specialist worker prompts only.

## What To Build Next

### Layer 1: Planner inbox
New runtime module:
- `src/planner/planner-inbox.ts`

Responsibility:
- normalize inputs from:
  - Gmail attention
  - heartbeat pending events
  - repo/GitHub signals
  - market/news signals later

Output:
- planner-ready items with:
  - source
  - urgency
  - domain
  - summary
  - evidence
  - thread/session reference if present

Status:
- implemented in v1

### Layer 2: Planner state
New runtime module:
- `src/planner/planner-state.ts`

Responsibility:
- keep lightweight planner rows:
  - `candidate`
  - `selected`
  - `spawned`
  - `running`
  - `blocked`
  - `done`
  - `dropped`

This is **not** a new database first. Reuse the existing session/config store patterns.

Status:
- implemented in v1

### Layer 3: Goal origination
New runtime module:
- `src/planner/goal-origination.ts`

Responsibility:
- convert top attention pressure into explicit goals

Examples:
- `relationship_followthrough` -> “respond to X / follow up with Y”
- `decision_backlog` -> “produce go/no-go recommendation”
- `project_stale` -> “inspect deployment / repo / release drift”

Important:
- planner must not only prioritize tasks
- it must synthesize the next goal from pressure + memory + identity

Status:
- implemented in v1

### Layer 4: Orchestrator
New runtime module:
- `src/planner/planner-orchestrator.ts`

Responsibility:
- choose:
  - stay silent
  - surface to Telegram
  - spawn subagent
  - create bounded execution task

It should use existing spawn/lifecycle runtime rather than inventing new worker infrastructure.

Status:
- implemented in v1 as bounded surface-first orchestration

### Layer 5: Recovery / escalation
New runtime module:
- `src/planner/planner-recovery.ts`

Responsibility:
- detect:
  - stale spawned runs
  - failed runs
  - repeated no-progress loops
- respond by:
  - retry
  - downgrade
  - surface to user

## Minimal Message Envelope

Use this shape across planner/orchestrator flows:

```ts
type PlannerEnvelope = {
  from: string;
  to: string;
  intent:
    | "signal"
    | "attention"
    | "goal"
    | "task"
    | "result"
    | "escalation";
  thread?: string;
  reply_to?: string;
  body: string;
  evidence?: string[];
  metadata?: Record<string, unknown>;
};
```

This is enough for v1.

## Lifecycle Model

Planner lifecycle should be:

`candidate -> selected -> spawned -> running -> done`

Terminal alternates:
- `blocked`
- `dropped`
- `failed`
- `escalated`

Subagent lifecycle already exists. Do not duplicate it. Wrap it.

## First Build Slice

Shipped in v1:

1. planner reads live Gmail + repo + GitHub-backed attention output
2. planner chooses top item
3. planner synthesizes a goal
4. planner surfaces one bounded next step
5. planner records result

That was enough for v1.

## Next Slice

Build this next:

1. keep the current planner core
2. allow richer read-only / draft-producing worker spawning
3. add recovery/escalation around spawned work
4. keep write/send/push actions behind confirmation

## What To Skip

- no dashboard first
- no marketplace
- no giant multi-agent framework
- no role zoo
- no generalized bus infrastructure first
- no economic layer yet

## Success Condition

OpenTrident can:
- observe real signals
- convert them into goals
- choose one next action
- run or surface that action
- track the lifecycle cleanly

## End State This Enables

This planner-orchestrator is the bridge from:
- `attention-driven assistant`

to:
- `goal-originating digital principal`

It is not the final end game.
It is the first infrastructure layer that makes:
- economic agency
- multi-instance workstreams
- self-directed initiative

possible.
