import type { SystemEvent } from "./system-events.js";

export async function collectHeartbeatGithubEvents(_params?: {
  nowMs?: number;
}): Promise<SystemEvent[]> {
  return [];
}
