import type { SystemEvent } from "./system-events.js";

export async function collectHeartbeatGmailEvents(_params?: {
  nowMs?: number;
}): Promise<SystemEvent[]> {
  return [];
}
