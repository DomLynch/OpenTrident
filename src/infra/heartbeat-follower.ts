import { getLockStatus } from "../multi/instance-locks.js";
import { acquireLock } from "../multi/instance-locks.js";

const FOLLOWER_POLL_INTERVAL_MS = 30 * 1000;
const STALE_THRESHOLD_MS = 2 * 60 * 1000;

export async function tryBecomeLeader(): Promise<boolean> {
  return await acquireLock({ scope: "leader-heartbeat" });
}

export function runFollowerLoop(): never {
  let consecutiveStale = 0;

  const checkInterval = setInterval(async () => {
    try {
      const status = await getLockStatus({ scope: "leader-heartbeat" });
      const isStale = !status.held || (status.entry !== null && Date.now() - status.entry.lastSeenAt > STALE_THRESHOLD_MS);

      if (isStale) {
        consecutiveStale++;
      } else {
        consecutiveStale = 0;
      }

      if (consecutiveStale >= 2) {
        clearInterval(checkInterval);
        console.log("[follower] Leader stale (2 checks). Attempting to become leader...");
        const won = await tryBecomeLeader();
        if (won) {
          console.log("[follower] Took over as leader. Exiting with 42 to restart as leader.");
          process.exit(42);
        } else {
          console.log("[follower] Lock taken by another instance. Continuing follower mode.");
          consecutiveStale = 0;
        }
      }
    } catch {
      consecutiveStale++;
    }
  }, FOLLOWER_POLL_INTERVAL_MS);

  process.on("SIGINT", () => {
    clearInterval(checkInterval);
    process.exit(0);
  });
  process.on("SIGTERM", () => {
    clearInterval(checkInterval);
    process.exit(0);
  });

  console.log("[follower] Running in follower mode. Polling leader-heartbeat every 30s.");
  return process.exit(0) as never;
}
