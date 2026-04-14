import { spawnSubagentDirect } from "../agents/subagent-spawn.js";
import type { OpenClawConfig } from "../config/config.js";
import type { SessionEntry } from "../config/sessions/types.js";
import type { PlannerDecision, PlannerStateRow } from "./types.js";

const ACTIVE_SPAWN_STATUSES = new Set(["spawned", "running"]);
const ACTIVE_SPAWN_WINDOW_MS = 6 * 60 * 60 * 1000;

const SPAWNABLE_ACTION_CLASSES = new Set([
  "spawn_readonly",
  "draft_reply",
  "draft_issue",
  "brief",
  "send_reply",
]);

export type PlannerSpawnResult =
  | {
      status: "accepted";
      childSessionKey?: string;
      runId?: string;
      note: string;
    }
  | {
      status: "skipped";
      reason: "not-spawn-readonly" | "existing-active-spawn" | "no-delivery-target";
      note: string;
    }
  | {
      status: "error";
      error: string;
      note: string;
    };

function trimEvidenceLine(value: string, maxChars = 220): string {
  const compact = value.replace(/\s+/g, " ").trim();
  if (compact.length <= maxChars) {
    return compact;
  }
  return `${compact.slice(0, Math.max(0, maxChars - 1)).trimEnd()}…`;
}

export function buildPlannerBoundedTask(decision: PlannerDecision): string | undefined {
  if (
    !SPAWNABLE_ACTION_CLASSES.has(decision.goal?.actionClass ?? "") ||
    !decision.goal ||
    !decision.topItem
  ) {
    return undefined;
  }
  const evidence = decision.topItem.evidence
    .slice(0, 4)
    .map((line) => `- ${trimEvidenceLine(line)}`);
  const evidenceBlock = evidence.length > 0 ? evidence : ["- No additional evidence provided."];

  switch (decision.goal.actionClass) {
    case "brief":
      return [
        "You are a bounded OpenTrident analyst worker.",
        "",
        `Goal: ${decision.goal.title}`,
        `Summary: ${decision.goal.summary}`,
        `Primary attention: ${decision.topItem.id} | score=${decision.topItem.score.toFixed(2)}`,
        "",
        "Evidence:",
        ...evidenceBlock,
        "",
        "Rules:",
        "- Produce a structured brief only. No sends, pushes, writes, merges, trades, or irreversible actions.",
        "- Be analytical and concise.",
        "",
        "Return format:",
        "## Brief",
        "### Situation",
        "[Current state and context]",
        "### Analysis",
        "[Key observations and reasoning]",
        "### Recommendations",
        "[Proposed next steps if any]",
      ].join("\n");
    case "draft_reply":
    case "send_reply":
      return [
        "You are a bounded OpenTrident draft writer.",
        "",
        `Goal: ${decision.goal.title}`,
        `Summary: ${decision.goal.summary}`,
        `Primary attention: ${decision.topItem.id} | score=${decision.topItem.score.toFixed(2)}`,
        "",
        "Evidence:",
        ...evidenceBlock,
        "",
        "Rules:",
        "- Draft the response/outreach message only. No sends, pushes, writes, merges, trades, or irreversible actions.",
        "- Match the tone and style appropriate for the relationship context.",
        "- Produce a complete draft ready for review.",
        "",
        "Return format:",
        "## Draft Message",
        "### To",
        "[Recipient]",
        "### Subject/Context",
        "[Brief context for the message]",
        "### Message Body",
        "[Complete draft message]",
        "",
        "### Notes for Dom",
        "[Any considerations or things Dom should know before sending]",
      ].join("\n");
    case "draft_issue":
      return [
        "You are a bounded OpenTrident draft writer.",
        "",
        `Goal: ${decision.goal.title}`,
        `Summary: ${decision.goal.summary}`,
        `Primary attention: ${decision.topItem.id} | score=${decision.topItem.score.toFixed(2)}`,
        "",
        "Evidence:",
        ...evidenceBlock,
        "",
        "Rules:",
        "- Draft the GitHub issue or PR comment only. No pushes, writes, merges, trades, or irreversible actions.",
        "- Follow GitHub issue conventions and be concise but complete.",
        "",
        "Return format:",
        "## Draft Issue/PR Comment",
        "### Title",
        "[Issue title or PR comment subject]",
        "### Body",
        "[Complete draft - use markdown as appropriate]",
        "### Labels/Tags",
        "[Suggested labels if creating an issue]",
      ].join("\n");
    case "spawn_readonly":
    default:
      return [
        "You are a bounded OpenTrident read-only worker.",
        "",
        `Goal: ${decision.goal.title}`,
        `Summary: ${decision.goal.summary}`,
        `Primary attention: ${decision.topItem.id} | score=${decision.topItem.score.toFixed(2)}`,
        "",
        "Evidence:",
        ...evidenceBlock,
        "",
        "Rules:",
        "- Read-only or draft-producing actions only.",
        "- No sends, pushes, writes, merges, trades, or irreversible actions.",
        "- Inspect, reason, and return a concise result.",
        "",
        "Return format:",
        "1. What matters",
        "2. Evidence",
        "3. Recommended next step",
      ].join("\n");
  }
}

export function hasActivePlannerSpawn(params: {
  rows: readonly PlannerStateRow[];
  decision: PlannerDecision;
  nowMs: number;
  excludeRowId?: string;
}): boolean {
  if (!params.decision.goal) {
    return false;
  }
  return params.rows.some((row) => {
    if (params.excludeRowId && row.id === params.excludeRowId) {
      return false;
    }
    if (row.sourceItemId !== params.decision.goal?.sourceItemId) {
      return false;
    }
    if (row.actionClass !== "spawn_readonly") {
      return false;
    }
    if (!ACTIVE_SPAWN_STATUSES.has(row.status)) {
      return false;
    }
    return params.nowMs - row.updatedAt < ACTIVE_SPAWN_WINDOW_MS;
  });
}

export async function spawnPlannerReadonlyTask(params: {
  cfg: OpenClawConfig;
  agentId: string;
  sessionKey: string;
  nowMs: number;
  decision: PlannerDecision;
  existingRows: readonly PlannerStateRow[];
  currentRowId?: string;
  entry?: Pick<
    SessionEntry,
    | "lastChannel"
    | "lastAccountId"
    | "lastTo"
    | "lastThreadId"
    | "groupId"
    | "groupChannel"
    | "space"
  >;
}): Promise<PlannerSpawnResult> {
  const task = buildPlannerBoundedTask(params.decision);
  if (!task || !params.decision.goal) {
    return {
      status: "skipped",
      reason: "not-spawn-readonly",
      note: "Planner decision did not qualify for read-only spawning.",
    };
  }
  if (
    hasActivePlannerSpawn({
      rows: params.existingRows,
      decision: params.decision,
      nowMs: params.nowMs,
      excludeRowId: params.currentRowId,
    })
  ) {
    return {
      status: "skipped",
      reason: "existing-active-spawn",
      note: `Planner already has an active read-only worker for ${params.decision.goal.title}.`,
    };
  }
  if (!params.entry?.lastChannel || !params.entry.lastTo) {
    return {
      status: "skipped",
      reason: "no-delivery-target",
      note: "Planner spawn skipped because the session has no delivery target for worker results.",
    };
  }

  const result = await spawnSubagentDirect(
    {
      task,
      label: `planner:${params.decision.goal.id}`,
      agentId: params.agentId,
      mode: "run",
      cleanup: "keep",
      sandbox: "inherit",
      lightContext: true,
      expectsCompletionMessage: true,
      runTimeoutSeconds: 20 * 60,
    },
    {
      agentSessionKey: params.sessionKey,
      agentChannel: params.entry.lastChannel,
      agentAccountId: params.entry.lastAccountId,
      agentTo: params.entry.lastTo,
      agentThreadId: params.entry.lastThreadId,
      agentGroupId: params.entry.groupId ?? null,
      agentGroupChannel: params.entry.groupChannel ?? null,
      agentGroupSpace: params.entry.space ?? null,
    },
  );

  if (result.status === "accepted") {
    return {
      status: "accepted",
      childSessionKey: result.childSessionKey,
      runId: result.runId,
      note: `Spawned read-only worker for ${params.decision.goal.title}.`,
    };
  }
  return {
    status: "error",
    error: result.error ?? result.status,
    note: `Read-only worker spawn failed for ${params.decision.goal.title}: ${result.error ?? result.status}`,
  };
}
