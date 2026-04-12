# AGENTS.md

## Purpose

- Operating contract for the `DomClaw` repo.
- DomClaw is the founder-operator behavior layer, not the source of truth for the global playbook.
- Source of truth for playbook and AAA protocol lives in `DomLynch/Vibe-coding-management` and the live knowledge MCP.

## Mandatory Startup

Before doing anything in this repo:

1. Read this file.
2. Read `PROJECT_STATE.md`.
3. Read `CLAUDE.md`.
4. If MCP knowledge tools are available:
   - call `get_playbook()`
   - call `get_aaa_protocol()`
5. Treat the live MCP playbook as authoritative over any static local copy.
6. Do not read `VIBE_CODING_ARCHITECTURE_SETUP.md` by default. Use it only when historical infrastructure context is relevant.

## Codex Startup — Mandatory

- Codex reads MCP from `~/.codex/config.toml`, not project `.mcp.json`.
- On every new Codex thread:
  1. Call `get_playbook()`
  2. Call `get_aaa_protocol()`
  3. Read this repo's `AGENTS.md`
  4. Read `PROJECT_STATE.md`
  5. Read `CLAUDE.md`
- If MCP tools are unavailable, stop and report that MCP did not load.

## Playbook Precedence

Use this precedence order:

1. Live MCP `get_playbook()`
2. Live MCP `get_aaa_protocol()`
3. Repo `AGENTS.md`
4. Repo `PROJECT_STATE.md`
5. Repo `CLAUDE.md`
6. Repo `VIBE_CODING_ARCHITECTURE_SETUP.md` only when explicitly needed for historical/reference context

Future playbook versions supersede v3 automatically. Do not pin behavior to an outdated local copy if the MCP returns something newer.

## Operating Rules

- Lead with the decision.
- Optimize for leverage, speed, signal, and compounding.
- No filler.
- Spec before code for anything non-trivial.
- Branch before implementation.
- Prefer the smallest reversible change that solves the root problem.
- Push back once with evidence when the user is wrong.
- Keep notes, decisions, and behavior rules in git.

## Repo Scope

- `CLAUDE.md` stores the DomClaw operating profile.
- `VIBE_CODING_ARCHITECTURE_SETUP.md` stores a historical handover brief. It is not startup-critical.
- `PROJECT_STATE.md` stores the current focus and next moves.
- `.mcp.json` exists for MCP-aware tools that honor project-local config.

## Sync Rule

The repo must stay aligned across:

- MacBook: `/Users/domininclynch/Desktop/Business/DomClaw`
- GitHub: `https://github.com/DomLynch/DomClaw`
- VPS: `/opt/DomClaw`

Any material repo update should be pushed to GitHub and pulled to the VPS.
