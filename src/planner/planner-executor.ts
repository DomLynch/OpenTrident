import { recordActionOutcome } from "./trust-telemetry.js";
import { adjustDomainAutonomy } from "./autonomy-ladder.js";
import { updatePlannerRow } from "./planner-state.js";
import type { PlannerStateRow } from "./types.js";

export async function executeApprovedSend(params: {
  row: PlannerStateRow;
  approvedContent: string;
  nowMs: number;
  stateDir?: string;
}): Promise<{ ok: boolean; error?: string }> {
  return { ok: false, error: "sendMessage not available in identity repo" };
}

export function parseApprovalResponse(
  text: string,
): { approved: boolean; content?: string } | null {
  const lower = text.toLowerCase().trim();
  if (
    lower === "yes" ||
    lower === "send" ||
    lower === "send it" ||
    lower === "do it" ||
    lower === "approve" ||
    lower === "go" ||
    lower === "y" ||
    lower === "confirmed"
  ) {
    return { approved: true };
  }
  if (
    lower === "no" ||
    lower === "cancel" ||
    lower === "dont" ||
    lower === "don't" ||
    lower === "stop" ||
    lower === "abort"
  ) {
    return { approved: false };
  }
  return null;
}