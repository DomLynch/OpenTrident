import type { PlannerStateRow } from "./types.js";

export type PlannerRecoveryAction = {
  rowId: string;
  action: "retry" | "escalate";
  reason: string;
};

export function resolvePlannerRecoveryActions(params: {
  nowMs: number;
  rows: readonly PlannerStateRow[];
}): PlannerRecoveryAction[] {
  const actions: PlannerRecoveryAction[] = [];
  for (const row of params.rows) {
    if (row.status !== "running" && row.status !== "spawned" && row.status !== "blocked") {
      continue;
    }
    const ageMs = Math.max(0, params.nowMs - row.updatedAt);
    if (ageMs >= 6 * 60 * 60 * 1000) {
      actions.push({ rowId: row.id, action: "escalate", reason: "planner-stale-run" });
    } else if (ageMs >= 90 * 60 * 1000 && row.status === "blocked") {
      actions.push({ rowId: row.id, action: "retry", reason: "planner-blocked" });
    }
  }
  return actions;
}