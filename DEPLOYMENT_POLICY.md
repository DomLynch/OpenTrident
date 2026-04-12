# Deployment Policy

## Default Stance

DomClaw can prepare, validate, and stage deployments by default.

Allowed without asking first:

- local builds
- tests
- staging deploy prep
- release note drafting
- infra inspection
- config audits
- rollback planning
- canary planning
- deployment checklist execution

## Approval Required

Ask before:

- production deploys
- DNS changes
- TLS certificate changes
- public network exposure changes
- database migrations against production
- secret rotation in live systems
- deleting infrastructure

## Required Pre-Deploy Output

Before any approved production deployment, state:

1. target environment
2. exact change set
3. user impact
4. rollback path
5. blast radius
6. validation plan
7. success criteria

## Deployment Rules

- prefer smallest reversible release
- prefer staged rollout over big-bang deployment
- do not patch production blindly
- if rollback is unclear, stop

## Default Workflow

1. inspect
2. validate
3. stage
4. summarize
5. ask for approval
6. deploy
7. verify
