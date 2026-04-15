import type { SessionEntry } from "../config/sessions/types.js";
import { resolveHeartbeatAttention } from "../infra/heartbeat-attention.js";
import type { SystemEvent } from "../infra/system-events.js";
import { generateStrategicGoals } from "./strategic-initiator.js";
import type { PlannerDomain, PlannerEnvelope, PlannerItem } from "./types.js";

const SOURCE = "planner-inbox";

function mapDomain(id: string): PlannerDomain {
  switch (id) {
    case "relationship_drift":
    case "relationship_followthrough":
      return "relationship";
    case "project_stale":
      return "project";
    case "market_unreviewed":
      return "market";
    case "decision_backlog":
      return "decision";
    default:
      return "general";
  }
}

function compactWhitespace(text: string): string {
  return text.replace(/\s+/g, " ").trim();
}

function buildEnvelope(item: { id: string; summary: string; evidence: string[] }): PlannerEnvelope {
  return {
    from: SOURCE,
    to: "planner",
    intent: "attention",
    body: item.summary,
    evidence: item.evidence,
    metadata: { attentionId: item.id },
  };
}

type PlannerInboxEntry = Pick<
  SessionEntry,
  "updatedAt" | "lastChannel" | "lastTo" | "lastHeartbeatText" | "lastHeartbeatSentAt"
>;

export async function buildPlannerInbox(params: {
  nowMs: number;
  entry?: PlannerInboxEntry;
  pendingEvents?: readonly SystemEvent[];
}): Promise<PlannerItem[]> {
  const attention = resolveHeartbeatAttention(params);
  const strategic = await generateStrategicGoals();
  const attentionItems = attention.map((signal) => {
    const evidence = (signal.evidence ?? []).map((line) => compactWhitespace(line)).filter(Boolean);
    return {
      id: signal.id,
      intent: "attention" as const,
      domain: mapDomain(signal.id),
      score: signal.score,
      summary: compactWhitespace(signal.summary),
      evidence,
      source: SOURCE,
      envelope: buildEnvelope({ id: signal.id, summary: signal.summary, evidence }),
    } satisfies PlannerItem;
  });
  return [...attentionItems, ...strategic].sort((a, b) => b.score - a.score);
}