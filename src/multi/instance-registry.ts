import fs from "node:fs/promises";
import path from "node:path";
import { resolveStateDir } from "../config/paths.js";

const REGISTRY_FILE = "instance-registry-v1.json";

export type InstanceRole = "coordinator" | "worker" | "signal-watcher";
export type InstanceStatus = "idle" | "working" | "offline";

export type InstanceEntry = {
  instanceId: string;
  role: InstanceRole;
  status: InstanceStatus;
  lastHeartbeat: number;
  currentTask?: string;
  host?: string;
};

export type InstanceRegistry = {
  instances: Record<string, InstanceEntry>;
  updatedAt: number;
};

async function loadRegistry(stateDir: string): Promise<InstanceRegistry> {
  const filePath = path.join(stateDir, REGISTRY_FILE);
  try {
    const raw = await fs.readFile(filePath, "utf8");
    return JSON.parse(raw) as InstanceRegistry;
  } catch {
    return { instances: {}, updatedAt: Date.now() };
  }
}

async function saveRegistry(stateDir: string, registry: InstanceRegistry): Promise<void> {
  const filePath = path.join(stateDir, REGISTRY_FILE);
  registry.updatedAt = Date.now();
  await fs.mkdir(stateDir, { recursive: true });
  await fs.writeFile(filePath, JSON.stringify(registry, null, 2), "utf8");
}

export async function registerInstance(params: {
  instanceId: string;
  role: InstanceRole;
  host?: string;
  stateDir?: string;
}): Promise<void> {
  const stateDir = params.stateDir ?? resolveStateDir();
  const registry = await loadRegistry(stateDir);
  const now = Date.now();
  registry.instances[params.instanceId] = {
    instanceId: params.instanceId,
    role: params.role,
    status: "idle",
    lastHeartbeat: now,
    host: params.host,
  };
  await saveRegistry(stateDir, registry);
}

export async function updateInstanceHeartbeat(params: {
  instanceId: string;
  status?: InstanceStatus;
  currentTask?: string;
  stateDir?: string;
}): Promise<void> {
  const stateDir = params.stateDir ?? resolveStateDir();
  const registry = await loadRegistry(stateDir);
  const instance = registry.instances[params.instanceId];
  if (!instance) return;
  instance.lastHeartbeat = Date.now();
  if (params.status) instance.status = params.status;
  if (params.currentTask !== undefined) instance.currentTask = params.currentTask;
  await saveRegistry(stateDir, registry);
}

export async function deregisterInstance(params: {
  instanceId: string;
  stateDir?: string;
}): Promise<void> {
  const stateDir = params.stateDir ?? resolveStateDir();
  const registry = await loadRegistry(stateDir);
  delete registry.instances[params.instanceId];
  await saveRegistry(stateDir, registry);
}

export async function getActiveInstances(params: {
  role?: InstanceRole;
  stateDir?: string;
}): Promise<InstanceEntry[]> {
  const stateDir = params.stateDir ?? resolveStateDir();
  const registry = await loadRegistry(stateDir);
  const staleThreshold = Date.now() - 5 * 60 * 1000;
  return Object.values(registry.instances).filter((inst) => {
    if (params.role && inst.role !== params.role) return false;
    if (inst.lastHeartbeat < staleThreshold) return false;
    return inst.status !== "offline";
  });
}

export async function getIdleWorkers(params: { stateDir?: string }): Promise<InstanceEntry[]> {
  const workers = await getActiveInstances({ role: "worker", stateDir: params.stateDir });
  return workers.filter((w) => w.status === "idle");
}
