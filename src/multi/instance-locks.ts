import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { createHash } from "node:crypto";
import { resolveStateDir } from "../config/paths.js";

const LOCK_FILE = "instance-locks-v1.json";

export type LockScope = "telegram-bot" | "public-channel" | "leader-heartbeat";

export type LockEntry = {
  scope: LockScope;
  instanceId: string;
  hostname: string;
  pid: number;
  acquiredAt: number;
  lastSeenAt: number;
};

export type LockFile = {
  locks: Record<LockScope, LockEntry | null>;
  updatedAt: number;
};

const STALE_THRESHOLD_MS = 2 * 60 * 1000;

function getLocalInstanceId(): string {
  const hostname = os.hostname();
  const pid = process.pid;
  return createHash("sha256").update(`${hostname}:${pid}:${Date.now()}`).digest("hex").slice(0, 16);
}

function getLocalHostname(): string {
  return os.hostname();
}

async function loadLockFile(stateDir: string): Promise<LockFile> {
  const filePath = path.join(stateDir, LOCK_FILE);
  try {
    const raw = await fs.readFile(filePath, "utf8");
    return JSON.parse(raw) as LockFile;
  } catch {
    return { locks: { "telegram-bot": null, "public-channel": null, "leader-heartbeat": null }, updatedAt: Date.now() };
  }
}

async function saveLockFile(stateDir: string, file: LockFile): Promise<void> {
  const filePath = path.join(stateDir, LOCK_FILE);
  file.updatedAt = Date.now();
  await fs.mkdir(stateDir, { recursive: true });
  await fs.writeFile(filePath, JSON.stringify(file, null, 2), "utf8");
}

function isLockStale(entry: LockEntry): boolean {
  return Date.now() - entry.lastSeenAt > STALE_THRESHOLD_MS;
}

export async function acquireLock(params: {
  scope: LockScope;
  stateDir?: string;
  forceStale?: boolean;
}): Promise<boolean> {
  const stateDir = params.stateDir ?? resolveStateDir();
  const file = await loadLockFile(stateDir);
  const existing = file.locks[params.scope];

  const localInstanceId = getLocalInstanceId();
  const localHostname = getLocalHostname();

  if (existing && !isLockStale(existing) && !params.forceStale) {
    if (existing.instanceId === localInstanceId) {
      existing.lastSeenAt = Date.now();
      await saveLockFile(stateDir, file);
      return true;
    }
    return false;
  }

  file.locks[params.scope] = {
    scope: params.scope,
    instanceId: localInstanceId,
    hostname: localHostname,
    pid: process.pid,
    acquiredAt: Date.now(),
    lastSeenAt: Date.now(),
  };

  await saveLockFile(stateDir, file);
  return true;
}

export async function releaseLock(params: {
  scope: LockScope;
  stateDir?: string;
}): Promise<void> {
  const stateDir = params.stateDir ?? resolveStateDir();
  const file = await loadLockFile(stateDir);
  const existing = file.locks[params.scope];

  if (!existing) return;

  const localInstanceId = getLocalInstanceId();
  if (existing.instanceId === localInstanceId) {
    file.locks[params.scope] = null;
    await saveLockFile(stateDir, file);
  }
}

export async function refreshLock(params: {
  scope: LockScope;
  stateDir?: string;
}): Promise<boolean> {
  const stateDir = params.stateDir ?? resolveStateDir();
  const file = await loadLockFile(stateDir);
  const existing = file.locks[params.scope];

  if (!existing) return false;

  const localInstanceId = getLocalInstanceId();
  if (existing.instanceId === localInstanceId) {
    existing.lastSeenAt = Date.now();
    await saveLockFile(stateDir, file);
    return true;
  }
  return false;
}

export async function getLockStatus(params: {
  scope: LockScope;
  stateDir?: string;
}): Promise<{ held: boolean; byMe: boolean; entry: LockEntry | null }> {
  const stateDir = params.stateDir ?? resolveStateDir();
  const file = await loadLockFile(stateDir);
  const existing = file.locks[params.scope];

  if (!existing || isLockStale(existing)) {
    return { held: false, byMe: false, entry: null };
  }

  const localInstanceId = getLocalInstanceId();
  return {
    held: true,
    byMe: existing.instanceId === localInstanceId,
    entry: existing,
  };
}

export async function getMyLocks(params: { stateDir?: string }): Promise<LockScope[]> {
  const stateDir = params.stateDir ?? resolveStateDir();
  const file = await loadLockFile(stateDir);
  const localInstanceId = getLocalInstanceId();

  return (Object.entries(file.locks) as [LockScope, LockEntry | null][])
    .filter(([, entry]) => entry?.instanceId === localInstanceId && !isLockStale(entry))
    .map(([scope]) => scope);
}

export async function forceReleaseStaleLocks(params: { stateDir?: string }): Promise<LockScope[]> {
  const stateDir = params.stateDir ?? resolveStateDir();
  const file = await loadLockFile(stateDir);
  const released: LockScope[] = [];

  for (const [scope, entry] of Object.entries(file.locks) as [LockScope, LockEntry | null][]) {
    if (entry && isLockStale(entry)) {
      file.locks[scope] = null;
      released.push(scope);
    }
  }

  if (released.length > 0) {
    await saveLockFile(stateDir, file);
  }

  return released;
}
