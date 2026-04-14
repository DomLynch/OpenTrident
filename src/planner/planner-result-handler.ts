import fs from "node:fs/promises";
import path from "node:path";
import { resolveStorePath } from "../config/sessions/paths.js";
import { loadSessionStore } from "../config/sessions/store-load.js";
import { updatePlannerRow } from "./planner-state.js";
import type { PlannerStateRow } from "./types.js";

const CHILD_COMPLETION_CHECK_WINDOW_MS = 30_000;

type ChildSessionSnapshot = {
  status?: string;
  messageCount?: number;
  lastMessageAt?: number;
  endedAt?: number;
  lastMessage?: string;
};

function buildChildSessionStorePath(sessionKey: string): string {
  return resolveStorePath(undefined, { agentId: "main" }).replace(
    /[^/]+\.json$/,
    "",
  ).replace(/session$/, `session-${sessionKey.replace(/[^a-zA-Z0-9]/g, "-")}.json`);
}

async function loadChildSessionSnapshot(childSessionKey: string): Promise<ChildSessionSnapshot | null> {
  try {
    const storePath = buildChildSessionStorePath(childSessionKey);
    const raw = await fs.readFile(storePath, "utf8");
    const store = JSON.parse(raw) as Record<string, unknown>;
    const entry = store[childSessionKey] as Record<string, unknown> | undefined;
    if (!entry) return null;
    const lastMessageObj = entry.lastMessage as Record<string, unknown> | undefined;
    return {
      status: entry.status as string | undefined,
      messageCount: entry.messageCount as number | undefined,
      lastMessageAt: entry.lastMessageAt as number | undefined,
      endedAt: entry.endedAt as number | undefined,
      lastMessage: typeof lastMessageObj?.text === "string" ? lastMessageObj.text : undefined,
    };
  } catch {
    return null;
  }
}

function extractWorkerResultText(snapshot: ChildSessionSnapshot, row: PlannerStateRow): string | undefined {
  if (snapshot.lastMessage) {
    const trimmed = snapshot.lastMessage.trim();
    if (trimmed.length > 0) return trimmed;
  }
  return undefined;
}

export type HandleWorkerResultParams = {
  row: PlannerStateRow;
  sessionKey: string;
  nowMs: number;
};

export async function handleWorkerResult(params: HandleWorkerResultParams): Promise<{
  updated: boolean;
  newStatus?: string;
  draftResult?: string;
}> {
  const { row, sessionKey, nowMs } = params;

  const ACTIVE_STATUSES = new Set(["spawned", "running", "selected", "candidate"]);
  if (!ACTIVE_STATUSES.has(row.status)) {
    return { updated: false };
  }

  if (!row.childSessionKey) {
    return { updated: false };
  }

  const snapshot = await loadChildSessionSnapshot(row.childSessionKey);
  if (!snapshot) {
    return { updated: false };
  }

  const isEnded =
    snapshot.status === "done" ||
    snapshot.status === "failed" ||
    snapshot.status === "timeout" ||
    snapshot.endedAt !== undefined;

  if (!isEnded) {
    return { updated: false };
  }

  const draftResult = extractWorkerResultText(snapshot, row);
  const needsConfirmation = row.actionClass === "draft_reply" || row.actionClass === "send_reply";

  let newStatus: PlannerStateRow["status"];
  let patch: Parameters<typeof updatePlannerRow>[0]["patch"] = {
    draftResult,
    updatedAt: nowMs,
  };

  if (snapshot.status === "failed" || snapshot.status === "timeout") {
    newStatus = "failed";
    patch.note = `Worker ${snapshot.status}: ${draftResult?.slice(0, 200) ?? "no output"}`;
  } else if (needsConfirmation) {
    newStatus = "awaiting_confirmation";
  } else {
    newStatus = "done";
  }

  patch.status = newStatus;

  await updatePlannerRow({
    sessionKey,
    rowId: row.id,
    nowMs,
    patch,
  });

  return { updated: true, newStatus, draftResult };
}

export async function processWorkerResults(params: {
  rows: readonly PlannerStateRow[];
  sessionKey: string;
  nowMs: number;
}): Promise<Array<{ row: PlannerStateRow; draftResult?: string; newStatus: string }>> {
  const results: Array<{ row: PlannerStateRow; draftResult?: string; newStatus: string }> = [];

  for (const row of params.rows) {
    const result = await handleWorkerResult({
      row,
      sessionKey: params.sessionKey,
      nowMs: params.nowMs,
    });
    if (result.updated && result.newStatus && result.draftResult !== undefined) {
      results.push({
        row,
        draftResult: result.draftResult,
        newStatus: result.newStatus,
      });
    }
  }

  return results;
}
