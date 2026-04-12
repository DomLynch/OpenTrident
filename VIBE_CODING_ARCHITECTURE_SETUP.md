# NEW VIBE CODING ARCHITECTURE SETUP

Reference-only historical snapshot. Do not treat this file as the live source of truth for startup behavior. Use the knowledge MCP playbook and AAA protocol first.

Vibe Coding Infrastructure  
Full Handover Brief  
Dom Lynch | April 2026

## What Was Built

A complete agent-agnostic development infrastructure. One afternoon of setup. Every future coding session across every project, Claude Code, Codex, Cline, OpenHands, Cursor, whatever, is faster, consistent, and quality-controlled automatically.

Core idea: agents read rules from files, not from memory. Everything lives in git. A live server makes it available to any agent anywhere in the world.

## The 3 Components

1. GitHub Repo (source of truth)  
   `github.com/DomLynch/Vibe-coding-management`  
   Everything lives here. VPS pulls from it every 15 minutes automatically.

2. MCP Knowledge Server (live 24/7)  
   `https://mcp.domlynch.com/mcp`  
   A server running on VPS1 that any agent can query. Read-only. 8 tools.

3. Per-Project Files  
   Each project has `AGENTS.md`, `PROJECT_STATE.md`, `.mcp.json`, `specs/`, `decisions/` scaffolded automatically when you add a new project.

## File & Folder Map

```text
~/Desktop/Business/Vibe Coding Management/
├── AGENTS.md
├── VIBE_CODING_PLAYBOOK.md
├── AAA_LLM_BUILD_PROTOCOL.md
├── projects.yaml
│
├── project-agents/
│   ├── brain/AGENTS.md
│   ├── trader/AGENTS.md
│   ├── pvp/AGENTS.md
│   ├── pixelfps/AGENTS.md
│   └── researka/AGENTS.md
│
├── scripts/
│   ├── start-workspace.sh
│   ├── add-project.sh
│   └── health-check.sh
│
├── templates/
│   ├── AGENTS.md.template
│   ├── CLAUDE.md.template
│   ├── PROJECT_STATE.md.template
│   ├── spec.template.md
│   ├── handoff.template.md
│   └── mcp.json.template
│
├── subagents/
│   ├── code-reviewer.md
│   ├── test-runner.md
│   ├── browser-qa.md
│   └── prompt-to-spec.md
│
├── hooks/
│   ├── pre-commit-gate.sh
│   ├── post-edit-lint.sh
│   ├── session-context.sh
│   └── dangerous-write-block.sh
│
├── mcp-server/
│   ├── server.py
│   ├── requirements.txt
│   ├── mcp-knowledge.service
│   ├── mcp-knowledge-pull.service
│   └── mcp-knowledge-pull.timer
│
└── dev-knowledge/
    ├── patterns/
    ├── snippets/
    ├── post-mortems/
    └── protocols/
        ├── VIBE_CODING_PLAYBOOK.md
        └── AAA_LLM_BUILD_PROTOCOL.md
```

## Global Config

- `~/.claude/settings.json`: hooks
- `~/.claude/agents/`: global subagents
- `~/.claude.json`: user-scoped MCP
- `~/.codex/config.toml`: Codex MCP
- `~/.cline/data/settings/cline_mcp_settings.json`: Cline MCP

## MCP Server — 8 Tools

Running on VPS1 at `https://mcp.domlynch.com/mcp`

- `get_playbook`
- `get_aaa_protocol`
- `get_agents_md`
- `list_dev_knowledge`
- `get_dev_knowledge`
- `search_dev_knowledge`
- `list_doctrine`
- `get_doctrine`

## Active Projects

- Brain / NanoBot
- PIXELFPS Platform
- PVP Game Engine
- Elite Trader
- Researka

## VPS Infrastructure

VPS1: `49.12.7.18`

- MCP server: `/opt/mcp-knowledge/`
- Vibe coding repo clone: `/opt/vibe-coding/`
- Brain repo: `/root/brain/`
- Nginx + SSL via Let's Encrypt

Domains on VPS1:

- `https://mcp.domlynch.com/mcp` -> MCP server
- `https://domlynch.com` -> homepage

## How A New Dev Connects

### Step 1 — Configure MCP

For Claude Code / OpenHands:

```json
"knowledge": {
  "type": "http",
  "url": "https://mcp.domlynch.com/mcp"
}
```

For Codex:

```toml
[mcp_servers.knowledge]
url = "https://mcp.domlynch.com"
type = "http"
```

Codex appends `/mcp` internally. Keep `/mcp` only for raw HTTP MCP clients and project `.mcp.json`.

### Step 2 — Call At Session Start

- `get_playbook()`
- `get_agents_md("<PROJECT NAME>")`

### Step 3 — Standard Session Starter

You are working on a project for Dom Lynch.  
Read `AGENTS.md` and `PROJECT_STATE.md` before doing anything.  
MCP knowledge server: `https://mcp.domlynch.com/mcp` — call `get_playbook()` first.  
Quality standard: correct, testable, reversible — not looking done.  
Branch always. Spec before code. PR to main only. Never touch another project's files.

## Codex Startup — Mandatory

- Codex reads MCP from `~/.codex/config.toml`, not project `.mcp.json`.
- On every new Codex thread:
  1. Call `get_playbook()`
  2. Call `get_aaa_protocol()`
  3. Call `get_agents_md("[PROJECT NAME]")`
  4. Read `PROJECT_STATE.md` before changing anything
- If `get_agents_md()` fails, retry with session alias.
- If MCP tools are unavailable, stop and report that MCP did not load.

## Knowledge Update Flow

Edit locally -> git push -> GitHub -> VPS pulls every 15 min -> MCP serves updated content -> every agent gets the latest version.

No restarts needed. No manual deploys.

## Rules For Multi-Dev Work

1. Read-only MCP server.
2. One source of truth per project.
3. Never edit another project's files.
4. Specs before code.
5. Branch, never push to main directly.

## Architecture Summary

Think of it as:

- Mac = cockpit
- VPS = factory
- GitHub = source of truth
- MCP server = shared brain

## AAA Quality Protocol Starter

Use the live MCP version first. Static summary:

- define done before coding
- plan -> build -> review
- validate after every meaningful change
- review against DoD
- ship with handoff notes

## Daily Startup

```bash
cd "/Users/domininclynch/Desktop/Business/Vibe Coding Management"
./scripts/start-workspace.sh
./scripts/health-check.sh
```

## Plain-English Daily Guide

- You are the director.
- Agents are the builders.
- Spec first.
- Approve plans.
- Review diffs.

## Context-Loss Prevention

New session:

1. Read `AGENTS.md`
2. Read `PROJECT_STATE.md`
3. Query MCP on demand

For Codex specifically:

- `~/.codex/config.toml` must include the knowledge MCP
- each project `AGENTS.md` should require `get_playbook()`, `get_aaa_protocol()`, and `get_agents_md()`

## Source Of Truth

`github.com/DomLynch/Vibe-coding-management`
