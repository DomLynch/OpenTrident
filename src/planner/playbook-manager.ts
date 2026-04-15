import fs from "node:fs/promises";
import path from "node:path";
import { resolveStateDir } from "../config/paths.js";

const PLAYBOOK_DIR = "playbooks";

export type PlaybookCategory = "markets" | "relationships" | "engineering" | "migration" | "ops" | "general";

export type PlaybookTrigger = {
  type: "domain" | "action-class" | "source" | "keyword" | "pattern";
  value: string;
};

export type Playbook = {
  id: string;
  name: string;
  category: PlaybookCategory;
  description: string;
  triggers: PlaybookTrigger[];
  procedure: string;
  successCount: number;
  failureCount: number;
  lastUsedAt: number;
  createdAt: number;
  sourceItemId?: string;
  tags: string[];
};

type PlaybookStore = {
  playbooks: Record<string, Playbook>;
  updatedAt: number;
};

const MAX_PROCEDURE_LENGTH = 2000;
const MIN_PROCEDURE_LENGTH = 20;

function getPlaybookDir(stateDir: string): string {
  return path.join(stateDir, PLAYBOOK_DIR);
}

async function loadStore(stateDir: string): Promise<PlaybookStore> {
  const filePath = path.join(getPlaybookDir(stateDir), "playbook-store.json");
  try {
    const raw = await fs.readFile(filePath, "utf8");
    return JSON.parse(raw) as PlaybookStore;
  } catch {
    return { playbooks: {}, updatedAt: Date.now() };
  }
}

async function saveStore(stateDir: string, store: PlaybookStore): Promise<void> {
  const dir = getPlaybookDir(stateDir);
  await fs.mkdir(dir, { recursive: true });
  const filePath = path.join(dir, "playbook-store.json");
  store.updatedAt = Date.now();
  await fs.writeFile(filePath, JSON.stringify(store, null, 2), "utf8");
}

export async function createPlaybook(params: {
  name: string;
  category: PlaybookCategory;
  description: string;
  triggers: PlaybookTrigger[];
  procedure: string;
  sourceItemId?: string;
  tags?: string[];
  stateDir?: string;
}): Promise<Playbook | null> {
  const stateDir = params.stateDir ?? resolveStateDir();
  const procedure = params.procedure.trim();

  if (procedure.length < MIN_PROCEDURE_LENGTH || procedure.length > MAX_PROCEDURE_LENGTH) {
    return null;
  }

  const id = `playbook-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const playbook: Playbook = {
    id,
    name: params.name.trim(),
    category: params.category,
    description: params.description.trim(),
    triggers: params.triggers,
    procedure,
    successCount: 0,
    failureCount: 0,
    lastUsedAt: Date.now(),
    createdAt: Date.now(),
    sourceItemId: params.sourceItemId,
    tags: params.tags ?? [],
  };

  const store = await loadStore(stateDir);
  store.playbooks[id] = playbook;
  await saveStore(stateDir, store);

  return playbook;
}

export async function recordPlaybookUse(params: {
  playbookId: string;
  success: boolean;
  stateDir?: string;
}): Promise<void> {
  const stateDir = params.stateDir ?? resolveStateDir();
  const store = await loadStore(stateDir);
  const playbook = store.playbooks[params.playbookId];

  if (!playbook) return;

  if (params.success) {
    playbook.successCount++;
  } else {
    playbook.failureCount++;
  }

  playbook.lastUsedAt = Date.now();
  await saveStore(stateDir, store);
}

export async function getPlaybooks(params: {
  category?: PlaybookCategory;
  tag?: string;
  stateDir?: string;
}): Promise<Playbook[]> {
  const stateDir = params.stateDir ?? resolveStateDir();
  const store = await loadStore(stateDir);
  let playbooks = Object.values(store.playbooks);

  if (params.category) {
    playbooks = playbooks.filter((p) => p.category === params.category);
  }

  if (params.tag) {
    playbooks = playbooks.filter((p) => p.tags.includes(params.tag!));
  }

  return playbooks.sort((a, b) => {
    const aRate = a.successCount / Math.max(a.successCount + a.failureCount, 1);
    const bRate = b.successCount / Math.max(b.successCount + b.failureCount, 1);
    return bRate - aRate;
  });
}

export async function findPlaybooks(params: {
  domain?: string;
  actionClass?: string;
  source?: string;
  keyword?: string;
  stateDir?: string;
}): Promise<Playbook[]> {
  const stateDir = params.stateDir ?? resolveStateDir();
  const store = await loadStore(stateDir);
  const all = Object.values(store.playbooks);

  return all.filter((playbook) => {
    for (const trigger of playbook.triggers) {
      if (trigger.type === "domain" && params.domain && trigger.value === params.domain) return true;
      if (trigger.type === "action-class" && params.actionClass && trigger.value === params.actionClass) return true;
      if (trigger.type === "source" && params.source && trigger.value === params.source) return true;
      if (trigger.type === "keyword" && params.keyword && playbook.description.toLowerCase().includes(trigger.value.toLowerCase())) return true;
    }
    return false;
  }).sort((a, b) => {
    const aRate = a.successCount / Math.max(a.successCount + a.failureCount, 1);
    const bRate = b.successCount / Math.max(b.successCount + b.failureCount, 1);
    return bRate - aRate;
  });
}

export async function updatePlaybook(params: {
  playbookId: string;
  patch: Partial<Pick<Playbook, "name" | "description" | "procedure" | "tags">>;
  stateDir?: string;
}): Promise<boolean> {
  const stateDir = params.stateDir ?? resolveStateDir();
  const store = await loadStore(stateDir);
  const playbook = store.playbooks[params.playbookId];

  if (!playbook) return false;

  if (params.patch.name !== undefined) playbook.name = params.patch.name.trim();
  if (params.patch.description !== undefined) playbook.description = params.patch.description.trim();
  if (params.patch.procedure !== undefined) {
    const p = params.patch.procedure.trim();
    if (p.length < MIN_PROCEDURE_LENGTH || p.length > MAX_PROCEDURE_LENGTH) return false;
    playbook.procedure = p;
  }
  if (params.patch.tags !== undefined) playbook.tags = params.patch.tags;

  await saveStore(stateDir, store);
  return true;
}

export async function deletePlaybook(params: {
  playbookId: string;
  stateDir?: string;
}): Promise<boolean> {
  const stateDir = params.stateDir ?? resolveStateDir();
  const store = await loadStore(stateDir);

  if (!store.playbooks[params.playbookId]) return false;
  delete store.playbooks[params.playbookId];
  await saveStore(stateDir, store);
  return true;
}

export async function getPlaybookStats(stateDir?: string): Promise<{
  total: number;
  byCategory: Record<PlaybookCategory, number>;
  bySource: Record<string, number>;
  avgSuccessRate: number;
}> {
  const stateDir = stateDir ?? resolveStateDir();
  const store = await loadStore(stateDir);
  const playbooks = Object.values(store.playbooks);

  const byCategory: Record<PlaybookCategory, number> = {
    markets: 0, relationships: 0, engineering: 0, migration: 0, ops: 0, general: 0,
  };

  const bySource: Record<string, number> = {};
  let totalSuccess = 0;
  let totalUses = 0;

  for (const p of playbooks) {
    byCategory[p.category]++;
    if (p.sourceItemId) {
      bySource[p.sourceItemId] = (bySource[p.sourceItemId] ?? 0) + 1;
    }
    totalSuccess += p.successCount;
    totalUses += p.successCount + p.failureCount;
  }

  return {
    total: playbooks.length,
    byCategory,
    bySource,
    avgSuccessRate: totalUses > 0 ? totalSuccess / totalUses : 0,
  };
}
