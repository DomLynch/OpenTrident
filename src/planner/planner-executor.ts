import { recordActionOutcome } from "./trust-telemetry.js";
import { adjustDomainAutonomy } from "./autonomy-ladder.js";
import { updatePlannerRow } from "./planner-state.js";
import { executeFlush } from "./planner-flush.js";
import type { PlannerStateRow } from "./types.js";

export type ApprovalResult =
  | { approved: true; modified: false; content?: undefined }
  | { approved: true; modified: true; content: string }
  | { approved: false; modified: false };

export function parseApprovalResponse(text: string): ApprovalResult | null {
  const lower = text.toLowerCase().trim();

  if (
    lower === "yes" ||
    lower === "send" ||
    lower === "send it" ||
    lower === "do it" ||
    lower === "approve" ||
    lower === "go" ||
    lower === "y" ||
    lower === "confirmed" ||
    lower === "looks good" ||
    lower === "lg" ||
    lower === "lgtm" ||
    lower === "ship it" ||
    lower === "post it" ||
    lower === "publish"
  ) {
    return { approved: true, modified: false };
  }

  if (
    lower === "no" ||
    lower === "cancel" ||
    lower === "dont" ||
    lower === "don't" ||
    lower === "stop" ||
    lower === "abort" ||
    lower === "kill" ||
    lower === "discard" ||
    lower === "reject"
  ) {
    return { approved: false, modified: false };
  }

  return null;
}

export async function executeApprovedSend(params: {
  row: PlannerStateRow;
  approvedContent: string;
  nowMs: number;
  stateDir?: string;
}): Promise<{ ok: boolean; error?: string }> {
  return { ok: false, error: "sendMessage not available in identity repo" };
}

export async function recordApprovalOutcome(params: {
  row: PlannerStateRow;
  result: "approved" | "rejected" | "modified";
  content?: string;
  nowMs: number;
}): Promise<void> {
  const { row, result, nowMs } = params;

  const statusMap: Record<string, PlannerStateRow["status"]> = {
    approved: "approved",
    rejected: "rejected",
    modified: "modified",
  };

  await updatePlannerRow({
    sessionKey: row.sessionKey,
    rowId: row.id,
    nowMs,
    patch: {
      status: statusMap[result] ?? "rejected",
      draftResult: params.content ?? row.draftResult,
      confirmedAt: nowMs,
    },
  });

  await recordActionOutcome({
    actionClass: row.actionClass,
    domain: row.domain,
    source: "planner-approval",
    outcome: result,
  });

  if (row.domain) {
    await adjustDomainAutonomy({
      domain: row.domain,
      total: 1,
      approved: result === "approved" ? 1 : 0,
      rejected: result === "rejected" ? 1 : 0,
      modified: result === "modified" ? 1 : 0,
    });
  }

  await executeFlush({
    trigger: "planner-row-close",
    row,
    outcome: result,
    draftResult: params.content,
  }).catch(() => {});
}
