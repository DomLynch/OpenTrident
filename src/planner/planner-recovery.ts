import type { PlannerStateRow } from "./types.js";

export type PlannerRecoveryAction = {
  rowId: string;
  action: "retry" | "escalate" | "downgrade" | "abandon";
  reason: string;
};

const STALE_THRESHOLD_MS = 6 * 60 * 60 * 1000;
const BLOCKED_RETRY_THRESHOLD_MS = 90 * 60 * 1000;
const MAX_RETRIES = 3;
const ESCALATED_STALE_THRESHOLD_MS = 2 * 60 * 60 * 1000;

function getRetryCount(row: PlannerStateRow): number {
  return row.retryCount ?? 0;
}

function getNoteRetryCount(note: string | undefined): number {
  if (!note) return 0;
  const match = note.match(/retryCount:(\d+)/);
  return match ? parseInt(match[1], 10) : 0;
}

export function resolvePlannerRecoveryActions(params: {
  nowMs: number;
  rows: readonly PlannerStateRow[];
}): PlannerRecoveryAction[] {
  const actions: PlannerRecoveryAction[] = [];

  for (const row of params.rows) {
    const ageMs = Math.max(0, params.nowMs - row.updatedAt);
    const retryCount = getRetryCount(row);

    if (row.status === "failed") {
      if (row.actionClass === "send_reply" && !row.downgradedFrom) {
        actions.push({
          rowId: row.id,
          action: "downgrade",
          reason: "send_reply failed, downgrading to draft_reply for review before any send",
        });
      } else if (retryCount < MAX_RETRIES) {
        actions.push({
          rowId: row.id,
          action: "retry",
          reason: `failed row, retry ${retryCount + 1} of ${MAX_RETRIES}`,
        });
      } else {
        actions.push({
          rowId: row.id,
          action: "abandon",
          reason: `exceeded max retries (${MAX_RETRIES}), dropping row`,
        });
      }
      continue;
    }

    if (row.status === "escalated") {
      if (ageMs >= ESCALATED_STALE_THRESHOLD_MS) {
        actions.push({
          rowId: row.id,
          action: "abandon",
          reason: "escalated row stale beyond 2h, abandoning",
        });
      }
      continue;
    }

    if (row.status === "blocked") {
      if (ageMs >= BLOCKED_RETRY_THRESHOLD_MS) {
        if (retryCount < MAX_RETRIES) {
          actions.push({
            rowId: row.id,
            action: "retry",
            reason: `blocked for ${Math.round(ageMs / 60000)}min, retry ${retryCount + 1} of ${MAX_RETRIES}`,
          });
        } else {
          actions.push({
            rowId: row.id,
            action: "abandon",
            reason: `blocked and max retries (${MAX_RETRIES}) exceeded`,
          });
        }
      }
      continue;
    }

    if (row.status === "running" || row.status === "spawned") {
      if (ageMs >= STALE_THRESHOLD_MS) {
        if (retryCount < MAX_RETRIES) {
          actions.push({
            rowId: row.id,
            action: "retry",
            reason: `stale for ${Math.round(ageMs / 60000)}min, retry ${retryCount + 1} of ${MAX_RETRIES}`,
          });
        } else {
          actions.push({
            rowId: row.id,
            action: "escalate",
            reason: `stale for ${Math.round(ageMs / 60000)}min and max retries exceeded, escalating`,
          });
        }
      }
      continue;
    }

    if (row.status === "awaiting_confirmation") {
      if (ageMs >= STALE_THRESHOLD_MS) {
        actions.push({
          rowId: row.id,
          action: "escalate",
          reason: `confirmation pending for ${Math.round(ageMs / 60000)}min, escalating for review`,
        });
      }
      continue;
    }
  }

  return actions;
}
