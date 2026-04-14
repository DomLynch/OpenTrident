import { loadConfig } from "../config/config.js";
import { resolveStorePath } from "../config/sessions/paths.js";
import { readSessionStoreReadOnly } from "../config/sessions/store-read.js";
import { buildOutboundSessionContext } from "../infra/outbound/session-context.js";
import { deliverOutboundPayloads } from "../infra/outbound/deliver-runtime.js";
import type { ReplyPayload } from "../auto-reply/types.js";
import { updatePlannerRow } from "./planner-state.js";
import type { PlannerStateRow } from "./types.js";

export async function executeApprovedSend(params: {
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
  const lastChannel = (entry.lastChannel as string | undefined) ?? deliveryContext?.channel as string | undefined;
  const lastTo = (entry.lastTo as string | undefined) ?? deliveryContext?.to as string | undefined;
  const lastAccountId = deliveryContext?.accountId as string | undefined;
  const lastThreadId = deliveryContext?.threadId as string | number | undefined;

  const channel = lastChannel?.trim().toLowerCase() || "telegram";
  const to = lastTo?.trim();

  if (!to) {
    return { ok: false, error: `No delivery target for session: ${params.row.sessionKey}` };
  }

  const payload: ReplyPayload = {
    text: params.approvedContent,
  };

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
