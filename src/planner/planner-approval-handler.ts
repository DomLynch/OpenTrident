import fs from "node:fs/promises";
import { loadConfig } from "../config/config.js";
import { resolveStorePath } from "../config/sessions/paths.js";
import { readSessionStoreReadOnly } from "../config/sessions/store-read.js";
import { buildOutboundSessionContext } from "../infra/outbound/session-context.js";
import { deliverOutboundPayloads } from "../infra/outbound/deliver-runtime.js";
import type { ReplyPayload } from "../auto-reply/types.js";
import { parseApprovalResponse } from "./planner-executor.js";
import { updatePlannerRow } from "./planner-state.js";
import type { PlannerStateRow } from "./types.js";

export type ApprovalCheckResult =
  | { handled: true; approved: boolean; message: string }
  | { handled: false };

function findPendingConfirmationRow(
  rows: readonly PlannerStateRow[],
): PlannerStateRow | undefined {
  return rows.find((row) => row.status === "awaiting_confirmation");
}

async function executeSend(params: {
  row: PlannerStateRow;
  approvedContent: string;
  nowMs: number;
}): Promise<{ ok: boolean; error?: string }> {
  const cfg = loadConfig();

  const storePath = resolveStorePath(undefined, { agentId: "main" });
  let store: Record<string, Record<string, unknown>> = {};
  try {
    store = readSessionStoreReadOnly(storePath) as Record<string, Record<string, unknown>>;
  } catch {
    return { ok: false, error: "Could not load session store" };
  }

  const entry = store[params.row.sessionKey];
  if (!entry) {
    return { ok: false, error: `Session not found: ${params.row.sessionKey}` };
  }

  const deliveryContext = entry.deliveryContext as Record<string, unknown> | undefined;
  const lastChannel =
    (entry.lastChannel as string | undefined) ??
    (deliveryContext?.channel as string | undefined);
  const lastTo =
    (entry.lastTo as string | undefined) ?? (deliveryContext?.to as string | undefined);
  const lastAccountId = deliveryContext?.accountId as string | undefined;
  const lastThreadId = deliveryContext?.threadId as string | number | undefined;

  const channel = lastChannel?.trim().toLowerCase() || "telegram";
  const to = lastTo?.trim();

  if (!to) {
    return { ok: false, error: `No delivery target for session: ${params.row.sessionKey}` };
  }

  const payload: ReplyPayload = { text: params.approvedContent };

  const outboundSession = buildOutboundSessionContext({
    cfg,
    sessionKey: params.row.sessionKey,
  });

  try {
    const results = await deliverOutboundPayloads({
      cfg,
      channel: channel as "telegram" | "slack" | "discord" | "whatsapp" | "web" | "signal",
      to,
      accountId: lastAccountId,
      payloads: [payload],
      replyToId: null,
      threadId: lastThreadId ?? null,
      session: outboundSession,
      abortSignal: undefined,
    });

    const last = results.at(-1);
    const messageId = last?.messageId;

    await updatePlannerRow({
      sessionKey: params.row.sessionKey,
      rowId: params.row.id,
      nowMs: params.nowMs,
      patch: {
        status: "done",
        sentAt: params.nowMs,
        draftResult: params.approvedContent,
        note: messageId ? `Sent: messageId=${messageId}` : "Sent",
      },
    });

    return { ok: true };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return { ok: false, error: message };
  }
}

export async function checkAndHandleApproval(params: {
  sessionKey: string;
  inboundText: string;
  nowMs: number;
}): Promise<ApprovalCheckResult> {
  const storePath = resolveStorePath(undefined, { agentId: "main" });
  let store: Record<string, Record<string, unknown>> = {};
  try {
    store = readSessionStoreReadOnly(storePath) as Record<string, Record<string, unknown>>;
  } catch {
    return { handled: false };
  }

  const statePath = storePath.replace(/[^/]+\.json$/, "planner-v1.json");
  let plannerState: { sessions?: Record<string, PlannerStateRow[]> } = {};
  try {
    const raw = await fs.readFile(statePath, "utf8");
    plannerState = JSON.parse(raw);
  } catch {
    return { handled: false };
  }

  const rows = plannerState.sessions?.[params.sessionKey] ?? [];
  const pendingRow = findPendingConfirmationRow(rows);
  if (!pendingRow) {
    return { handled: false };
  }

  const parsed = parseApprovalResponse(params.inboundText);
  if (!parsed) {
    return { handled: false };
  }

  if (parsed.approved) {
    const content = parsed.modified ? parsed.content : pendingRow.draftResult ?? params.inboundText;

    const sent = await executeSend({
      row: pendingRow,
      approvedContent: content,
      nowMs: params.nowMs,
    });

    if (!sent.ok) {
      await updatePlannerRow({
        sessionKey: params.sessionKey,
        rowId: pendingRow.id,
        nowMs: params.nowMs,
        patch: {
          status: "failed",
          note: `Send failed: ${sent.error}`,
        },
      });
      return { handled: true, approved: false, message: `Send failed: ${sent.error}` };
    }

    return {
      handled: true,
      approved: true,
      message: "Sent. ✅",
    };
  }

  await updatePlannerRow({
    sessionKey: params.sessionKey,
    rowId: pendingRow.id,
    nowMs: params.nowMs,
    patch: {
      status: "rejected",
      confirmedAt: params.nowMs,
      note: "Rejected by Dom via Telegram reply",
    },
  });

  return {
    handled: true,
    approved: false,
    message: "Rejected. The draft has been discarded.",
  };
}
