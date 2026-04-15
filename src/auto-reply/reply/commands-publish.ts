import { deliverOutboundPayloads } from "../../infra/outbound/deliver-runtime.js";
import { buildOutboundSessionContext } from "../../infra/outbound/session-context.js";
import { publishToNostr } from "../../social/nostr-publisher.js";
import type { CommandHandler } from "./commands-types.js";
import type { ReplyPayload } from "./types.js";

const COMMAND_REGEX = /^\/?publish(?:\s|$)/i;

type PublishResult = { ok: true; messageId: string } | { ok: false; error: string };

function parsePublishCommand(raw: string): { content: string } | null {
  const trimmed = raw.trim();
  const commandMatch = trimmed.match(COMMAND_REGEX);
  if (!commandMatch) return null;
  const rest = trimmed.slice(commandMatch[0].length).trim();
  if (!rest) return null;
  return { content: rest };
}

export async function sendToPublicChannel(content: string): Promise<PublishResult> {
  const channelId = process.env.TELEGRAM_PUBLIC_CHANNEL_ID;
  if (!channelId) {
    return { ok: false, error: "TELEGRAM_PUBLIC_CHANNEL_ID not configured" };
  }

  const { loadConfig } = await import("../../config/config.js");
  const cfg = loadConfig();

  const payload: ReplyPayload = { text: content };

  const outboundSession = buildOutboundSessionContext({
    cfg,
    sessionKey: "public:heartbeat",
  });

  try {
    const results = await deliverOutboundPayloads({
      cfg,
      channel: "telegram",
      to: channelId,
      payloads: [payload],
      replyToId: null,
      threadId: null,
      session: outboundSession,
      abortSignal: undefined,
    });

    const last = results.at(-1);
    if (!last?.messageId) {
      return { ok: false, error: "No messageId returned from delivery" };
    }
    return { ok: true, messageId: last.messageId };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return { ok: false, error: msg };
  }
}

export const handlePublishCommand: CommandHandler = async (params) => {
  const parsed = parsePublishCommand(params.command.body);
  if (!parsed) return null;

  const senderId = params.command.senderId;
  const authorizedUsers = (process.env.TELEGRAM_AUTHORIZED_USERS ?? "").split(",").map((s) => s.trim()).filter(Boolean);
  const isAuthorized = authorizedUsers.length === 0 || authorizedUsers.includes(String(senderId));

  if (!isAuthorized) {
    return {
      shouldContinue: false,
      reply: { text: "Unauthorized" },
    };
  }

  const result = await sendToPublicChannel(parsed.content);

  if (!result.ok) {
    return { shouldContinue: false, reply: { text: `Failed: ${result.error}` } };
  }

  publishToNostr({ text: parsed.content, tags: [["t", "opentrident"]] }).catch(() => {});

  return {
    shouldContinue: false,
    reply: { text: `Published` },
  };
};