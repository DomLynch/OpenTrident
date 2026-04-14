import { resolve } from "node:path";
import { homedir } from "node:os";

export function resolveStateDir(): string {
  const override = process.env.OPENTRIDENT_STATE_DIR?.trim() ||
    process.env.OPENCLAW_STATE_DIR?.trim();
  if (override) {
    return resolve(homedir(), override);
  }
  return resolve(homedir(), ".opentrident");
}

export function resolveStorePath(
  storeFile?: string,
  opts?: { agentId?: string },
): string {
  const dir = resolveStateDir();
  if (storeFile) {
    return resolve(dir, storeFile);
  }
  if (opts?.agentId) {
    return resolve(dir, `sessions-${opts.agentId}.json`);
  }
  return resolve(dir, "sessions.json");
}
