import type { SessionEntry } from "../config/sessions/types.js";
import type { SystemEvent } from "../infra/system-events.js";
import { getAutonomyLevel, getDomainAutonomyConfig, requiresConfirmation } from "./autonomy-ladder.js";
import { originatePlannerGoal } from "./goal-origination.js";
import { buildPlannerInbox } from "./planner-inbox.js";
import { getTrustMetrics } from "./trust-telemetry.js";
import { sanitizeEvidence, validateActionClass, validatePlannerDomain } from "./planner-security.js";
import type { PlannerDecision, PlannerDecisionMode, PlannerItem } from "./types.js";

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

async function buildPromptBlock(params: {
  decision: PlannerDecision;
  previousHeartbeatText?: string;
}): Promise<string | undefined> {
  const { decision } = params;
  if (!decision.goal || !decision.topItem) {
    return undefined;
  }
  const isSpawnedWorker = decision.mode !== "idle" && decision.mode !== "surface";
  const lines = [
    "Planner view:",
    `- top attention: ${decision.topItem.id} | score=${decision.topItem.score.toFixed(2)} | ${decision.topItem.summary}`,
    `- synthesized goal: ${decision.goal.title}`,
    `- goal summary: ${decision.goal.summary}`,
    `- recommended action class: ${decision.goal.actionClass}`,
  ];

  if (decision.mode === "spawn_readonly") {
    lines.push("- This goal spawns a bounded read-only worker to investigate and surface findings.");
    lines.push("- No confirmation needed — surface the result directly when the worker completes.");
  } else if (decision.mode === "draft_reply") {
    lines.push("- This goal spawns a bounded worker to draft a message.");
    lines.push("- Result will be surfaced for Dom's review before any send occurs.");
    lines.push("- When surfacing, use: ## Draft for Review + the draft + approve/reject instructions.");
  } else if (decision.mode === "draft_issue") {
    lines.push("- This goal spawns a bounded worker to draft a GitHub issue.");
    lines.push("- Result will be surfaced for Dom's review before the issue is created.");
    lines.push("- When surfacing, use: ## Issue Draft + the draft + approve/reject instructions.");
  } else if (decision.mode === "brief") {
    lines.push("- This goal spawns a bounded analyst worker to produce a structured brief.");
    lines.push("- Brief is surfaced directly — no confirmation needed.");
    lines.push("- When surfacing, use: ## Brief + Situation + Analysis + Recommendations.");
  } else if (decision.mode === "send") {
    lines.push("- This goal spawns a bounded worker to draft a send action.");
    lines.push("- DOM MUST APPROVE before any send occurs — this is irreversible.");
    lines.push("- When surfacing, use: ## Action Required + what will be sent + approve/reject.");
  }

  lines.push(
    "- blast radius rule: draft_reply and send_reply require surfacing for confirmation. No autonomous sends, pushes, writes, merges, trades, or irreversible actions.",
  );

  for (const evidence of sanitizeEvidence(decision.topItem.evidence).slice(0, 3)) {
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
    const trustMetrics = await getTrustMetrics();
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
  if (!topItem) return undefined;
  if (topItem.id !== "pending_signals") return topItem;
  return candidates.find((item) => item.id !== "pending_signals" && item.score >= 0.4) ?? topItem;
}

function resolveMode(params: {
  goalActionClass: string;
  score: number;
  autonomyLevel: string;
  needsConfirmation: boolean;
}): PlannerDecisionMode {
  const { goalActionClass, score, autonomyLevel, needsConfirmation } = params;

  if (score < 0.33) return "idle";

  if (autonomyLevel === "read_only" && goalActionClass !== "spawn_readonly") {
    return "surface";
  }

  if (goalActionClass === "send_reply") {
    if (score >= 0.55) return "send";
    return "surface";
  }

  if (goalActionClass === "surface_only") {
    return "surface";
  }

  if (goalActionClass === "spawn_readonly") {
    if (score >= 0.55) return "spawn_readonly";
    return "surface";
  }

  if (goalActionClass === "draft_reply") {
    if (score >= 0.55) return "draft_reply";
    return "surface";
  }

  if (goalActionClass === "draft_issue") {
    if (score >= 0.55) return "draft_issue";
    return "surface";
  }

  if (goalActionClass === "brief") {
    if (score >= 0.5) return "brief";
    return "surface";
  }

  return "surface";
}

type PlannerSessionEntry = Pick<
  SessionEntry,
  "updatedAt" | "lastChannel" | "lastTo" | "lastHeartbeatText" | "lastHeartbeatSentAt"
>;

export async function resolvePlannerDecision(params: {
  nowMs: number;
  entry?: PlannerSessionEntry;
  pendingEvents?: readonly SystemEvent[];
}): Promise<PlannerDecision> {
  const candidates = buildPlannerInbox(params);
  const topItem = selectTopPlannerCandidate(candidates);
  if (!topItem || topItem.score < 0.33) {
    return { mode: "idle", candidates };
  }
  const goal = originatePlannerGoal(topItem);
  const sanitizedItem: PlannerItem = {
    ...topItem,
    evidence: sanitizeEvidence(topItem.evidence),
  };
  const safeDomain = validatePlannerDomain(goal.domain) ? goal.domain : sanitizedItem.domain;
  const safeActionClass = validateActionClass(goal.actionClass) ? goal.actionClass : "surface_only";
  const safeGoal = {
    ...goal,
    domain: safeDomain,
    actionClass: safeActionClass,
  };
  const autonomyConfig = await getDomainAutonomyConfig();
  const autonomyLevel = getAutonomyLevel(safeGoal.domain, autonomyConfig);
  const needsConfirmation = requiresConfirmation(safeGoal.domain, safeGoal.actionClass, autonomyConfig);
  const mode = resolveMode({
    goalActionClass: safeGoal.actionClass,
    score: sanitizedItem.score,
    autonomyLevel,
    needsConfirmation,
  });

  const decision: PlannerDecision = {
    mode,
    topItem: sanitizedItem,
    goal: safeGoal,
    candidates,
  };
  decision.promptBlock = await buildPromptBlock({
    decision,
    previousHeartbeatText: params.entry?.lastHeartbeatText,
  });
  return decision;
}