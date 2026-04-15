import { recordActionOutcome } from "./trust-telemetry.js";
import { createPlaybook, recordPlaybookUse } from "./playbook-manager.js";
import { recordMemory } from "./planner-memory.js";
import { getTrustMetrics } from "./trust-telemetry.js";
import { indexSessionIfNeeded } from "./memory-query.js";
import type { PlannerStateRow } from "./types.js";

export type FlushContext = {
  trigger:
    | "worker-complete"
    | "planner-row-close"
    | "migration-finish"
    | "strategic-cycle";
  row?: PlannerStateRow;
  outcome?: "approved" | "rejected" | "modified" | "completed" | "failed";
  draftResult?: string;
  stateDir?: string;
  toolCallCount?: number;
  errorCount?: number;
  userCorrected?: boolean;
  nonTrivialWorkflow?: boolean;
};

export type FlushDecision = {
  action:
    | "write-memory"
    | "promote-playbook"
    | "record-telemetry"
    | "learn-skill"
    | "nothing";
  reason: string;
  detail?: string;
};

export async function decideFlush(params: FlushContext): Promise<FlushDecision> {
  const { row, outcome } = params;

  if (params.trigger === "worker-complete" && row) {
    const isHighValue = row.score !== undefined && row.score >= 0.7;
    const hasDraft = Boolean(
      params.draftResult && params.draftResult.trim().length > 50,
    );
    const toolCalls = params.toolCallCount ?? 0;
    const errors = params.errorCount ?? 0;
    const isComplex =
      toolCalls >= 5 || params.nonTrivialWorkflow === true;

    if (params.userCorrected && toolCalls >= 3) {
      return {
        action: "learn-skill",
        reason: `User corrected approach after ${toolCalls} tool calls — capture the corrected workflow`,
        detail: `actionClass=${row.actionClass}, domain=${row.domain}, title=${row.title}`,
      };
    }

    if (isComplex && errors > 0 && toolCalls >= 3) {
      return {
        action: "learn-skill",
        reason: `Error recovered after ${errors} error(s) across ${toolCalls} tool calls — record successful recovery pattern`,
        detail: `actionClass=${row.actionClass}, domain=${row.domain}`,
      };
    }

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
      await indexSessionIfNeeded({
        sessionKey: params.row.sessionKey,
        domain: params.row.domain,
        title: params.row.title,
        summary: params.row.summary,
        status: params.row.status,
        createdAt: params.row.createdAt,
        updatedAt: params.row.updatedAt,
        stateDir: params.stateDir,
      }).catch(() => {});
      memoryRecorded = true;
    }
  }

  if (flushDecision.action === "promote-playbook" && params.row) {
    const trustMetrics = await getTrustMetrics(params.stateDir);
    const domainRate = trustMetrics.byDomain[params.row.domain ?? "general"];
    const approvalRate = domainRate
      ? domainRate.approved / Math.max(domainRate.total, 1)
      : 0.8;

    const sourceItemId =
      params.row.sourceItemId === params.row.id ? params.row.id : undefined;

    const result = await createPlaybook({
      name: `[${params.row.domain ?? "general"}] ${params.row.title ?? "Untitled"}`.slice(
        0,
        80,
      ),
      category: mapDomainToCategory(params.row.domain),
      description: params.row.summary ?? flushDecision.reason,
      triggers: [
        { type: "domain", value: params.row.domain ?? "general" },
        {
          type: "action-class",
          value: params.row.actionClass ?? "spawn_readonly",
        },
        {
          type: "source",
          value: params.row.sourceItemId ? "child-item" : "planner",
        },
      ],
      procedure:
        params.draftResult?.slice(0, 2000) ??
        params.row.summary ??
        "No procedure recorded",
      sourceItemId,
      tags: [
        params.row.domain ?? "general",
        approvalRate >= 0.8 ? "high-trust" : "medium-trust",
      ],
      stateDir: params.stateDir,
    }).catch(() => ({ playbook: null }));

    if (result.playbook) {
      playbookCreated = true;
      await recordMemory({
        key: `playbook:created:${result.playbook.id}`,
        value: JSON.stringify({
          playbookId: result.playbook.id,
          name: result.playbook.name,
        }),
        category: "decision",
        source: "planner-flush",
        stateDir: params.stateDir,
      }).catch(() => {});
    } else if (result.blockedReason) {
      flushDecision.reason += ` [blocked: ${result.blockedReason}]`;
    }
  }

  if (flushDecision.action === "learn-skill" && params.row) {
    const result = await createPlaybook({
      name: `[learned] ${params.row.title ?? "Untitled procedure"}`.slice(0, 80),
      category: mapDomainToCategory(params.row.domain),
      description: `Learned from ${flushDecision.reason}: ${params.row.summary ?? ""}`.slice(
        0,
        200,
      ),
      triggers: [
        { type: "domain", value: params.row.domain ?? "general" },
        { type: "keyword", value: params.row.title ?? "" },
      ],
      procedure:
        params.draftResult?.slice(0, 2000) ??
        params.row.summary ??
        flushDecision.reason,
      sourceItemId: params.row.id,
      tags: [
        "learned",
        params.userCorrected ? "user-corrected" : "",
        params.errorCount ? "error-recovery" : "",
      ].filter(Boolean),
      stateDir: params.stateDir,
    }).catch(() => ({ playbook: null }));

    if (result.playbook) {
      playbookCreated = true;
      await recordMemory({
        key: `skill:learned:${result.playbook.id}`,
        value: JSON.stringify({
          playbookId: result.playbook.id,
          name: result.playbook.name,
          reason: flushDecision.reason,
        }),
        category: "context",
        source: "planner-flush",
        stateDir: params.stateDir,
      }).catch(() => {});
    } else if (result.blockedReason) {
      flushDecision.reason += ` [blocked: ${result.blockedReason}]`;
    }
  }

  if (params.row?.playbookId && params.outcome) {
    const success = params.outcome === "completed"
      || params.outcome === "approved"
      || params.outcome === "modified";
    await recordPlaybookUse({
      playbookId: params.row.playbookId,
      success,
      stateDir: params.stateDir,
    }).catch(() => {});
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
