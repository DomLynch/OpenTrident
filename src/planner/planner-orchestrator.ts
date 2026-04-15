import type { SessionEntry } from "../config/sessions/types.js";
import type { SystemEvent } from "../infra/system-events.js";
import { getAutonomyLevel, getDomainAutonomyConfig, requiresConfirmation } from "./autonomy-ladder.js";
import { originatePlannerGoal } from "./goal-origination.js";
import { buildPlannerInbox } from "./planner-inbox.js";
import { getTrustMetrics } from "./trust-telemetry.js";
import { searchSessions } from "./memory-query.js";
import { findPlaybooks, type Playbook } from "./playbook-manager.js";
import { getDoctrine } from "./doctrine-manager.js";
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
  similarSessions?: readonly { sessionKey: string; title: string; snippet: string; score: number }[];
  relevantPlaybooks?: readonly Playbook[];
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

  if (params.similarSessions && params.similarSessions.length > 0) {
    lines.push("");
    lines.push("Similar past sessions (for context — avoid repeating approaches that failed):");
    for (const s of params.similarSessions.slice(0, 3)) {
      const snippet = s.snippet.length > 120 ? `${s.snippet.slice(0, 119)}…` : s.snippet;
      lines.push(`- [${s.sessionKey}] ${s.title}: ${snippet}`);
    }
  }

  const doctrine = await getDoctrine(decision.goal.domain).catch(() => []);
  if (doctrine.length > 0) {
    lines.push("");
    lines.push("Doctrine (always applies — treat as operating principle):");
    for (const d of doctrine) {
      lines.push(`- ${d.name}: ${d.procedureDigest}`);
    }
  }

  if (params.relevantPlaybooks && params.relevantPlaybooks.length > 0) {
    lines.push("");
    lines.push("Proven playbooks for this pattern (apply the winning procedure — do not reinvent):");
    for (const p of params.relevantPlaybooks.slice(0, 3)) {
      const uses = p.successCount + p.failureCount;
      const rate = uses > 0 ? ((p.successCount / uses) * 100).toFixed(0) : "new";
      const procedure = p.procedure.length > 400
        ? `${p.procedure.slice(0, 399)}…`
        : p.procedure;
      lines.push(`- [${p.id}] ${p.name} (${rate}% success over ${uses} uses)`);
      lines.push(`  ${procedure.replace(/\n/g, "\n  ")}`);
    }
    lines.push("- If one of these playbooks fits, follow it. If none fit, proceed from scratch and a new playbook may be written on success.");
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
  const candidates = await buildPlannerInbox(params);
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

  const spawnModes = ["spawn_readonly", "draft_reply", "draft_issue", "brief", "send"];
  const similarSessions = spawnModes.includes(mode)
    ? await searchSessions({
        query: `${safeGoal.domain} ${safeGoal.title} ${sanitizedItem.summary}`,
        limit: 3,
        minScore: 0.3,
      }).catch(() => ({ sessions: [] as const }))
    : undefined;

  const relevantPlaybooks = spawnModes.includes(mode)
    ? await findPlaybooks({
        domain: safeGoal.domain,
        actionClass: safeGoal.actionClass,
      }).catch(() => [] as Playbook[])
    : undefined;

  const selectedPlaybookId = relevantPlaybooks && relevantPlaybooks.length > 0
    ? relevantPlaybooks[0].id
    : undefined;

  const decision: PlannerDecision = {
    mode,
    topItem: sanitizedItem,
    goal: safeGoal,
    candidates,
    playbookId: selectedPlaybookId,
  };
  decision.promptBlock = await buildPromptBlock({
    decision,
    previousHeartbeatText: params.entry?.lastHeartbeatText,
    similarSessions: similarSessions?.sessions,
    relevantPlaybooks,
  });
  return decision;
}