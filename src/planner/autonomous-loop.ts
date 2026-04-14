import { getTrustMetrics } from "./trust-telemetry.js";
import { readPlannerRows } from "./planner-state.js";
import { recordMemory } from "./planner-memory.js";
import { getDomainAutonomyConfig } from "./autonomy-ladder.js";
import type { PlannerDecision, PlannerStateRow } from "./types.js";
import type { SessionEntry } from "../config/sessions/types.js";

const ACTIVE_STATUSES = new Set(["spawned", "running"]);
const AUTONOMOUS_APPROVAL_RATE_THRESHOLD = 0.7;
const AUTONOMOUS_MIN_APPROVED_ACTIONS = 5;
const MAX_CONCURRENT_AUTONOMOUS = 3;

export type AutonomousGateStatus = {
  canRun: boolean;
  reason?: string;
  approvalRate?: number;
  approvedActions?: number;
  activeWorkers?: number;
};

export async function checkAutonomousGate(params: {
  nowMs: number;
  entry?: Pick<SessionEntry, "updatedAt" | "lastHeartbeatSentAt">;
  plannerRows?: readonly PlannerStateRow[];
}): Promise<AutonomousGateStatus> {
  const { nowMs, entry, plannerRows } = params;

  const rows = plannerRows ?? (await readPlannerRows({ sessionKey: undefined }).catch(() => []));

  const trustMetrics = await getTrustMetrics().catch(() => null);
  if (trustMetrics) {
    if (trustMetrics.totalActions < AUTONOMOUS_MIN_APPROVED_ACTIONS) {
      return {
        canRun: false,
        reason: `cold start: only ${trustMetrics.totalActions}/${AUTONOMOUS_MIN_APPROVED_ACTIONS} prior actions`,
        approvedActions: trustMetrics.approvedActions,
      };
    }
    const approvalRate =
      trustMetrics.totalActions > 0
        ? trustMetrics.approvedActions / trustMetrics.totalActions
        : 0;
    if (approvalRate < AUTONOMOUS_APPROVAL_RATE_THRESHOLD) {
      return {
        canRun: false,
        reason: `approval rate ${(approvalRate * 100).toFixed(0)}% below ${AUTONOMOUS_APPROVAL_RATE_THRESHOLD * 100}% threshold`,
        approvalRate,
        approvedActions: trustMetrics.approvedActions,
      };
    }
  }

  const activeWorkers = rows.filter((r) => ACTIVE_STATUSES.has(r.status));
  if (activeWorkers.length >= MAX_CONCURRENT_AUTONOMOUS) {
    return {
      canRun: false,
      reason: `active workers at max capacity (${activeWorkers.length}/${MAX_CONCURRENT_AUTONOMOUS})`,
      activeWorkers: activeWorkers.length,
    };
  }

  if (entry) {
    const updatedAt = entry.updatedAt ?? 0;
    const lastHeartbeatSentAt = entry.lastHeartbeatSentAt ?? 0;
    const idleMs = nowMs - updatedAt;
    const surfaceMs = nowMs - lastHeartbeatSentAt;

    if (idleMs < 5 * 60 * 1000) {
      return { canRun: false, reason: "active Telegram conversation within last 5 minutes" };
    }
    if (surfaceMs < 30 * 1000) {
      return { canRun: false, reason: "recent surface within 30 seconds" };
    }
  }

  const autonomyConfig = await getDomainAutonomyConfig().catch(() => ({}));
  const hasAutonomousDomain = Object.values(autonomyConfig).some((v) => v === "act_autonomously");
  if (!hasAutonomousDomain) {
    return { canRun: false, reason: "no domain has act_autonomously level configured" };
  }

  return {
    canRun: true,
    approvalRate: trustMetrics
      ? trustMetrics.approvedActions / trustMetrics.totalActions
      : undefined,
    approvedActions: trustMetrics?.approvedActions,
    activeWorkers: activeWorkers.length,
  };
}

export async function recordAutonomousAction(params: {
  goalId: string;
  goalTitle: string;
  actionClass: string;
  domain: string;
  outcome: "spawned" | "completed" | "approved" | "rejected";
  stateDir?: string;
}): Promise<void> {
  const key = `autonomous:${params.goalId}:${params.outcome}:${Date.now()}`;
  const value = `${params.outcome.toUpperCase()} — ${params.goalTitle} (${params.actionClass}) in ${params.domain}`;
  await recordMemory({
    key,
    value,
    category: "decision",
    source: "autonomous-loop",
    stateDir: params.stateDir,
  }).catch(() => {});
}
