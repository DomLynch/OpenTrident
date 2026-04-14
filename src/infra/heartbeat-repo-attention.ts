import type { SystemEvent } from "./system-events.js";

export async function collectHeartbeatRepoEvents(_params?: {
  nowMs?: number;
}): Promise<SystemEvent[]> {
  return [];
}
