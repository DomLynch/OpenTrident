import fs from "node:fs/promises";
import path from "node:path";
import { resolveStateDir } from "../config/paths.js";

const MESSAGES_FILE = "instance-messages-v1.json";

export type MessageIntent = "task" | "result" | "status" | "escalation" | "heartbeat";

export type InstanceMessage = {
  id: string;
  from: string;
  to: string;
  intent: MessageIntent;
  thread?: string;
  body: string;
  metadata?: Record<string, unknown>;
  createdAt: number;
  readAt?: number;
};

export type MessageInbox = {
  messages: InstanceMessage[];
  lastPolledAt: number;
};

async function getMessagesPath(stateDir: string): Promise<string> {
  return path.join(stateDir, MESSAGES_FILE);
}

async function loadMessages(stateDir: string): Promise<InstanceMessage[]> {
  const filePath = await getMessagesPath(stateDir);
  try {
    const raw = await fs.readFile(filePath, "utf8");
    return JSON.parse(raw) as InstanceMessage[];
  } catch {
    return [];
  }
}

async function saveMessages(stateDir: string, messages: InstanceMessage[]): Promise<void> {
  const filePath = await getMessagesPath(stateDir);
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await fs.writeFile(filePath, JSON.stringify(messages, null, 2), "utf8");
}

export async function sendInstanceMessage(params: {
  from: string;
  to: string;
  intent: MessageIntent;
  body: string;
  thread?: string;
  metadata?: Record<string, unknown>;
  stateDir?: string;
}): Promise<string> {
  const stateDir = params.stateDir ?? resolveStateDir();
  const messages = await loadMessages(stateDir);
  const id = `msg-${params.from}-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
  const message: InstanceMessage = {
    id,
    from: params.from,
    to: params.to,
    intent: params.intent,
    body: params.body,
    thread: params.thread,
    metadata: params.metadata,
    createdAt: Date.now(),
  };
  messages.push(message);

  const MAX_MESSAGES = 1000;
  if (messages.length > MAX_MESSAGES) {
    messages.splice(0, messages.length - MAX_MESSAGES);
  }

  await saveMessages(stateDir, messages);
  return id;
}

export async function pollInstanceMessages(params: {
  instanceId: string;
  sinceMs?: number;
  stateDir?: string;
}): Promise<InstanceMessage[]> {
  const stateDir = params.stateDir ?? resolveStateDir();
  const messages = await loadMessages(stateDir);
  const since = params.sinceMs ?? Date.now() - 60_000;

  const myMessages = messages.filter(
    (m) =>
      (m.to === params.instanceId || m.to === "broadcast") &&
      m.createdAt >= since &&
      !m.readAt,
  );

  for (const msg of myMessages) {
    msg.readAt = Date.now();
  }
  await saveMessages(stateDir, messages);

  return myMessages;
}

export async function getOutboxMessages(params: {
  instanceId: string;
  stateDir?: string;
}): Promise<InstanceMessage[]> {
  const stateDir = params.stateDir ?? resolveStateDir();
  const messages = await loadMessages(stateDir);
  return messages.filter((m) => m.from === params.instanceId && m.readAt === undefined);
}

export async function clearOldMessages(params: {
  olderThanMs?: number;
  stateDir?: string;
}): Promise<number> {
  const stateDir = params.stateDir ?? resolveStateDir();
  const messages = await loadMessages(stateDir);
  const cutoff = Date.now() - (params.olderThanMs ?? 24 * 60 * 60 * 1000);
  const before = messages.length;
  const remaining = messages.filter((m) => m.createdAt >= cutoff || m.readAt === undefined);
  await saveMessages(stateDir, remaining);
  return before - remaining.length;
}
