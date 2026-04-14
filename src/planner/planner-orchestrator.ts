import type { SessionEntry } from "../config/sessions/types.js";
import type { SystemEvent } from "../infra/system-events.js";
import { getAutonomyLevel, requiresConfirmation } from "./autonomy-ladder.js";
import { originatePlannerGoal } from "./goal-origination.js";
import { buildPlannerInbox } from "./planner-inbox.js";
import { getTrustMetrics } from "./trust-telemetry.js";
import type { PlannerDecision, PlannerItem } from "./types.js";

const SPAWNABLE_ACTION_CLASSES = new Set([
  "spawn_readonly",
  "draft_reply",
  "draft_issue",
  "brief",
  "send_reply",
]);

function compactWhitespace(text: string): string {
  return text.replace(/\s+/g, " ").trim();
}

function trimEvidence(text: string, maxChars = 160): string {
  const compact = compactWhitespace(text);
  if (compact.length <= maxChars) {
    return compact;
  }
  return `${compact.slice(0, Math.max(0, maxChars - 1)).trimEnd()}…`;
}

function buildPromptBlock(params: {
  decision: PlannerDecision;
  previousHeartbeatText?: string;
}): string | undefined {
  const { decision } = params;
  if (!decision.goal || !decision.topItem) {
    return undefined;
  }
  const isSpawnedWorker = decision.mode === "spawn_readonly" || decision.mode === "send";
  const lines = [
    "Planner view:",
    `- top attention: ${decision.topItem.id} | score=${decision.topItem.score.toFixed(2)} | ${decision.topItem.summary}`,
    `- synthesized goal: ${decision.goal.title}`,
    `- goal summary: ${decision.goal.summary}`,
    `- recommended action class: ${decision.goal.actionClass}`,
  ];

  if (isSpawnedWorker) {
    lines.push("- This goal will spawn a bounded worker to produce a result.");
    lines.push("- When surfacing the result, use this format:");
    lines.push("  ## Result: [Goal Title]");
    lines.push("  ### Signal");
    lines.push("  [What triggered this attention]");
    lines.push("  ### Analysis");
    lines.push("  [What the worker found/reasoned]");
    lines.push("  ### Recommendation");
    lines.push("  [Proposed next step]");
    if (decision.mode === "send") {
      lines.push("  ### Action Required");
      lines.push("  [Dom must approve/confirm before any send occurs]");
    }
  }

  lines.push(
    "- blast radius rule: draft_reply and send_reply require surfacing for confirmation. No autonomous sends, pushes, writes, merges, trades, or irreversible actions.",
  );

  for (const evidence of decision.topItem.evidence.slice(0, 3)) {
    lines.push(`  evidence: ${trimEvidence(evidence)}`);
  }

  const backup = decision.candidates.filter((item) => item.id !== decision.topItem?.id).slice(0, 2);
  if (backup.length > 0) {
    lines.push("- backup candidates:");
    for (const item of backup) {
      lines.push(`  - ${item.id} | score=${item.score.toFixed(2)} | ${item.summary}`);
    }
  }

  if (params.previousHeartbeatText?.trim()) {
    lines.push(`- previous surfaced item: ${trimEvidence(params.previousHeartbeatText, 220)}`);
  }

  try {
    const trustMetrics = getTrustMetrics();
    if (trustMetrics.totalActions > 0) {
      lines.push("");
      lines.push("Trust telemetry (last 7 days):");
      const approvalRate =
        trustMetrics.totalActions > 0
          ? ((trustMetrics.approvedActions / trustMetrics.totalActions) * 100).toFixed(0)
          : "0";
      lines.push(`- Approval rate: ${approvalRate}% (${trustMetrics.totalActions} actions)`);
    }
  } catch {
    // Trust telemetry not available
  }

  return lines.join("\n");
}

function selectTopPlannerCandidate(candidates: readonly PlannerItem[]): PlannerItem | undefined {
  const topItem = candidates[0];
  if (!topItem) {
    return undefined;
  }
  if (topItem.id !== "pending_signals") {
    return topItem;
  }
  return candidates.find((item) => item.id !== "pending_signals" && item.score >= 0.4) ?? topItem;
}

type PlannerSessionEntry = Pick<
  SessionEntry,
  "updatedAt" | "lastChannel" | "lastTo" | "lastHeartbeatText" | "lastHeartbeatSentAt"
>;

export function resolvePlannerDecision(params: {
  nowMs: number;
  entry?: PlannerSessionEntry;
  pendingEvents?: readonly SystemEvent[];
}): PlannerDecision {
  const candidates = buildPlannerInbox(params);
  const topItem = selectTopPlannerCandidate(candidates);
  if (!topItem || topItem.score < 0.33) {
    return { mode: "idle", candidates };
  }
  const goal = originatePlannerGoal(topItem);
  let mode: "idle" | "surface" | "spawn_readonly" | "send" = "surface";
  const _autonomyLevel = getAutonomyLevel(topItem.domain);
  const needsConfirmation = requiresConfirmation(topItem.domain, goal.actionClass);

  if (goal.actionClass === "send_reply" && topItem.score >= 0.55) {
    mode = needsConfirmation ? "send" : "spawn_readonly";
  } else if (SPAWNABLE_ACTION_CLASSES.has(goal.actionClass) && topItem.score >= 0.55) {
    mode = needsConfirmation ? "spawn_readonly" : "spawn_readonly";
  }
  const decision: PlannerDecision = {
    mode,
    topItem,
    goal,
    candidates,
  };
  decision.promptBlock = buildPromptBlock({
    decision,
    previousHeartbeatText: params.entry?.lastHeartbeatText,
  });
  return decision;
}
