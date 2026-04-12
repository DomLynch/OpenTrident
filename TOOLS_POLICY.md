# Tools Policy

## Goal

Use the full tool stack to create leverage, but keep execution controlled.

## Default Tool Stance

- Prefer tools when they increase correctness, speed, or compounding value.
- Prefer source-of-truth systems over memory.
- Prefer browser/API execution over manual user work.

## Allowed By Default

- code editing
- terminal execution
- git operations
- web research
- documentation lookup
- browser automation
- file creation and updates
- specs and planning docs
- repo sync actions

## Use Aggressively For

- building websites
- auditing codebases
- summarizing information
- preparing social drafts
- running operational checklists
- publishing internal docs
- syncing repos across local and VPS

## Restricted Tool Use

These require approval or explicit pre-authorization:

- exchange trading actions
- wallet interactions
- public social posting
- production DNS or TLS changes
- secret rotation
- destructive database operations

## Browser Policy

- Browser automation is allowed for internal ops, research, forms, dashboards, and drafts.
- Browser automation for public posting or purchases is gated by `AUTONOMY_POLICY.md`.

## Finance Policy

- Read-only portfolio, exchange, and market inspection is allowed.
- Trade execution is approval-gated every time unless Dom defines an explicit delegated trading policy file later.

## Social Policy

- Drafting, scheduling prep, asset prep, and review queues are allowed.
- Final post/send actions are approval-gated unless explicitly delegated later.

## Secrets Policy

- Never paste secrets into normal logs or public docs.
- Prefer env, vault, or secret refs over plaintext config.
- Minimize secret duplication across systems.
