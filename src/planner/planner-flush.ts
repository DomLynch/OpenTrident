import { recordActionOutcome } from "./trust-telemetry.js";
import { createPlaybook } from "./playbook-manager.js";
import { recordMemory } from "./planner-memory.js";
import { getTrustMetrics } from "./trust-telemetry.js";
import type { PlannerStateRow } from "./types.js";

export type FlushContext = {
  trigger: "worker-complete" | "planner-row-close" | "migration-finish" | "strategic-cycle";
  row?: PlannerStateRow;
  outcome?: "approved" | "rejected" | "modified" | "completed" | "failed";
  draftResult?: string;
  stateDir?: string;
};

export type FlushDecision = {
  action: "write-memory" | "promote-playbook" | "record-telemetry" | "nothing";
  reason: string;
  detail?: string;
};

export async function decideFlush(params: FlushContext): Promise<FlushDecision> {
  const { row, outcome } = params;

  if (params.trigger === "worker-complete" && row) {
    const isHighValue = row.score !== undefined && row.score >= 0.7;
    const hasDraft = Boolean(params.draftResult && params.draftResult.trim().length > 50);

    if (outcome === "completed" && isHighValue && hasDraft) {
      return {
        action: "promote-playbook",
        reason: `High-value task (score=${row.score}) completed with substantive output`,
        detail: `actionClass=${row.actionClass}, domain=${row.domain}`,
      };
    }

    if (outcome === "completed") {
      return {
        action: "write-memory",
        reason: "Worker completed successfully",
        detail: `actionClass=${row.actionClass}, domain=${row.domain}`,
      };
    }

    if (outcome === "failed") {
      return {
        action: "record-telemetry",
        reason: "Worker failed — record for trust telemetry, no playbook",
      };
    }
  }

  if (params.trigger === "planner-row-close" && row) {
    if (outcome === "approved" || outcome === "modified") {
      return {
        action: "write-memory",
        reason: `Planner row ${outcome} by user`,
        detail: `domain=${row.domain}, title=${row.title}`,
      };
    }

    if (outcome === "rejected") {
      return {
        action: "record-telemetry",
        reason: "Planner row rejected — record in telemetry only",
      };
    }
  }

  if (params.trigger === "migration-finish") {
    return {
      action: "write-memory",
      reason: "Migration completed — record outcome in memory",
    };
  }

  if (params.trigger === "strategic-cycle") {
    return {
      action: "write-memory",
      reason: "Strategic cycle completed — record what was generated",
    };
  }

  return {
    action: "nothing",
    reason: "No flush-worthy event detected",
  };
}

export async function executeFlush(params: FlushContext): Promise<{
  flushDecision: FlushDecision;
  memoryRecorded?: boolean;
  playbookCreated?: boolean;
  telemetryRecorded?: boolean;
}> {
  const flushDecision = await decideFlush(params);

  let memoryRecorded = false;
  let playbookCreated = false;
  let telemetryRecorded = false;

  if (flushDecision.action === "record-telemetry") {
    if (params.row && params.outcome) {
      await recordActionOutcome({
        actionClass: params.row.actionClass ?? "unknown",
        domain: params.row.domain ?? "general",
        source: params.row.source ?? "planner",
        outcome: params.outcome as "approved" | "rejected" | "modified",
        stateDir: params.stateDir,
      }).catch(() => {});
      telemetryRecorded = true;
    }
  }

  if (flushDecision.action === "write-memory") {
    if (params.row) {
      await recordMemory({
        key: `outcome:${params.row.id}`,
        value: JSON.stringify({
          outcome: params.outcome,
          actionClass: params.row.actionClass,
          domain: params.row.domain,
          title: params.row.title,
          summary: params.row.summary,
          draftResult: params.draftResult?.slice(0, 500),
          triggeredBy: params.trigger,
          score: params.row.score,
        }),
        category: "decision",
        source: "planner-flush",
        stateDir: params.stateDir,
      }).catch(() => {});
      memoryRecorded = true;
    }
  }

  if (flushDecision.action === "promote-playbook" && params.row) {
    const trustMetrics = await getTrustMetrics(params.stateDir);
    const domainRate = trustMetrics.byDomain[params.row.domain ?? "general"];
    const approvalRate = domainRate ? domainRate.approved / Math.max(domainRate.total, 1) : 0.8;

    const sourceItemId = params.row.source === "strategic-initiator" ? params.row.id : undefined;

    const playbook = await createPlaybook({
      name: `[${params.row.domain ?? "general"}] ${params.row.title ?? "Untitled"}`.slice(0, 80),
      category: mapDomainToCategory(params.row.domain),
      description: params.row.summary ?? flushDecision.reason,
      triggers: [
        { type: "domain", value: params.row.domain ?? "general" },
        { type: "action-class", value: params.row.actionClass ?? "spawn_readonly" },
        { type: "source", value: params.row.source ?? "planner" },
      ],
      procedure: params.draftResult?.slice(0, 2000) ?? params.row.summary ?? "No procedure recorded",
      sourceItemId,
      tags: [params.row.domain ?? "general", approvalRate >= 0.8 ? "high-trust" : "medium-trust"],
      stateDir: params.stateDir,
    }).catch(() => null);

    if (playbook) {
      playbookCreated = true;
      await recordMemory({
        key: `playbook:created:${playbook.id}`,
        value: JSON.stringify({ playbookId: playbook.id, name: playbook.name }),
        category: "decision",
        source: "planner-flush",
        stateDir: params.stateDir,
      }).catch(() => {});
    }
  }

  return {
    flushDecision,
    memoryRecorded,
    playbookCreated,
    telemetryRecorded,
  };
}

function mapDomainToCategory(domain: string | undefined): "markets" | "relationships" | "engineering" | "migration" | "ops" | "general" {
  switch (domain) {
    case "market": return "markets";
    case "relationship": return "relationships";
    case "project": return "engineering";
    case "migration": return "migration";
    case "ops": return "ops";
    default: return "general";
  }
}
