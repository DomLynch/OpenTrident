import fs from "node:fs/promises";
import path from "node:path";
import { resolveStateDir } from "../config/paths.js";
import { retryAsync } from "../infra/retry.js";
import { buildForkStateDir, getForkId } from "../multi/fork-isolation.js";

const MEMORY_FILE = "memory-v1.json";
const FILE_RETRY_CONFIG = { attempts: 3, minDelayMs: 100, maxDelayMs: 2000, jitter: 0.1 };

function resolveForkStateDir(stateDir?: string): string {
  const base = stateDir ?? resolveStateDir();
  return buildForkStateDir(base, getForkId());
}

export type MemoryEntry = {
  id: string;
  timestamp: number;
  category: "preference" | "decision" | "project" | "context" | "relationship";
  key: string;
  value: string;
  source: string;
};

export type MemoryStore = {
  entries: MemoryEntry[];
  lastUpdated: number;
};

function createEmptyStore(): MemoryStore {
  return { entries: [], lastUpdated: Date.now() };
}

async function loadMemory(statePath: string): Promise<MemoryStore> {
  return retryAsync(
    async () => {
      const raw = await fs.readFile(statePath, "utf8");
      return JSON.parse(raw) as MemoryStore;
    },
    { ...FILE_RETRY_CONFIG, label: "loadMemory" },
  ).catch(() => createEmptyStore());
}

async function saveMemory(statePath: string, store: MemoryStore): Promise<void> {
  const dir = path.dirname(statePath);
  await retryAsync(
    async () => {
      await fs.mkdir(dir, { recursive: true });
      await fs.writeFile(statePath, JSON.stringify(store, null, 2), "utf8");
    },
    { ...FILE_RETRY_CONFIG, label: "saveMemory" },
  );
}

export async function recordMemory(params: {
  key: string;
  value: string;
  category: MemoryEntry["category"];
  source: string;
  stateDir?: string;
}): Promise<void> {
  const stateDir = resolveForkStateDir(params.stateDir);
  const statePath = path.join(stateDir, MEMORY_FILE);
  const store = await loadMemory(statePath);

  const existing = store.entries.findIndex((e) => e.key === params.key);
  const entry: MemoryEntry = {
    id: `${params.key}:${Date.now()}`,
    timestamp: Date.now(),
    category: params.category,
    key: params.key,
    value: params.value,
    source: params.source,
  };

  if (existing >= 0) {
    store.entries[existing] = entry;
  } else {
    store.entries.push(entry);
  }

  if (store.entries.length > 500) {
    store.entries = store.entries
      .sort((a, b) => b.timestamp - a.timestamp)
      .slice(0, 500);
  }

  store.lastUpdated = Date.now();
  await saveMemory(statePath, store);
}

export async function recallMemory(params: {
  key: string;
  stateDir?: string;
}): Promise<MemoryEntry | null> {
  const stateDir = resolveForkStateDir(params.stateDir);
  const statePath = path.join(stateDir, MEMORY_FILE);
  const store = await loadMemory(statePath);
  return store.entries.find((e) => e.key === params.key) ?? null;
}

export async function recallByCategory(params: {
  category: MemoryEntry["category"];
  stateDir?: string;
}): Promise<MemoryEntry[]> {
  const stateDir = resolveForkStateDir(params.stateDir);
  const statePath = path.join(stateDir, MEMORY_FILE);
  const store = await loadMemory(statePath);
  return store.entries
    .filter((e) => e.category === params.category)
    .sort((a, b) => b.timestamp - a.timestamp);
}

export async function buildMemoryContext(stateDir?: string): Promise<string> {
  const stateDirVal = resolveForkStateDir(stateDir);
  const statePath = path.join(stateDirVal, MEMORY_FILE);
  const store = await loadMemory(statePath);
  if (store.entries.length === 0) {
    return "No prior memory available.";
  }

  const recent = store.entries
    .sort((a, b) => b.timestamp - a.timestamp)
    .slice(0, 20);

  const lines = ["## Memory Context (from OpenTrident)"];
  const categories = ["preference", "decision", "project", "relationship"] as const;
  for (const cat of categories) {
    const catEntries = recent.filter((e) => e.category === cat);
    if (catEntries.length > 0) {
      lines.push(`\n### ${cat.charAt(0).toUpperCase() + cat.slice(1)}`);
      for (const entry of catEntries.slice(0, 5)) {
        const date = new Date(entry.timestamp).toISOString().split("T")[0];
        lines.push(`- [${date}] ${entry.key}: ${entry.value}`);
      }
    }
  }
  return lines.join("");
}