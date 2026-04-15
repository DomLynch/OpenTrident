import { createHash } from "node:crypto";
import os from "node:os";

export type ForkId =
  | "market"
  | "relationship"
  | "builder"
  | "ops"
  | "general";

const FORK_ID_ENV = "OPENTRIDENT_FORK_ID";

let _cachedForkInstanceId: string | null = null;

export function getForkId(): ForkId {
  const env = process.env[FORK_ID_ENV]?.trim().toLowerCase();
  if (env && isValidForkId(env)) return env as ForkId;
  return "general";
}

export function getForkInstanceId(): string {
  if (_cachedForkInstanceId) return _cachedForkInstanceId;
  const forkId = getForkId();
  const hostname = os.hostname();
  const pid = process.pid;
  _cachedForkInstanceId = createHash("sha256")
    .update(`${forkId}:${hostname}:${pid}`)
    .digest("hex")
    .slice(0, 16);
  return _cachedForkInstanceId;
}

export function isValidForkId(id: string): boolean {
  return (
    id === "market" ||
    id === "relationship" ||
    id === "builder" ||
    id === "ops" ||
    id === "general"
  );
}

export function buildForkSessionKey(forkId: ForkId, baseKey: string): string {
  return `${forkId}:${baseKey}`;
}

export function getForkFromSessionKey(sessionKey: string): ForkId {
  const colonIdx = sessionKey.indexOf(":");
  if (colonIdx < 0) return "general";
  const prefix = sessionKey.slice(0, colonIdx);
  return isValidForkId(prefix) ? (prefix as ForkId) : "general";
}

export interface ForkConfig {
  forkId: ForkId;
  instanceId: string;
  isIsolated: boolean;
  sessionPrefix: string;
}

export function getForkConfig(): ForkConfig {
  const forkId = getForkId();
  const instanceId = getForkInstanceId();
  const isIsolated = forkId !== "general";
  const sessionPrefix = `${forkId}:`;

  return {
    forkId,
    instanceId,
    isIsolated,
    sessionPrefix,
  };
}

export function buildForkStateDir(stateDir: string, forkId: ForkId): string {
  if (forkId === "general") return stateDir;
  return `${stateDir}-${forkId}`;
}

export const FORK_DESCRIPTIONS: Record<ForkId, string> = {
  market: "Trading and market analysis fork — high-frequency decisions, risk management",
  relationship: "Personal relationship context fork — confidential conversations, social context",
  builder: "Software engineering fork — code execution, deployment, infrastructure",
  ops: "Operations fork — monitoring, maintenance, system administration",
  general: "Default fork — shared context, no isolation",
};
