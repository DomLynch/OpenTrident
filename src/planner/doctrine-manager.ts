import fs from "node:fs/promises";
import path from "node:path";
import { resolveStateDir } from "../config/paths.js";
import type { Playbook } from "./playbook-manager.js";

const DOCTRINE_FILE = "doctrine-v1.json";
const MIN_USES_FOR_DOCTRINE = 5;
const MIN_RATE_FOR_DOCTRINE = 0.8;
const MAX_DOCTRINE_PER_DOMAIN = 3;

export type DoctrineEntry = {
  playbookId: string;
  domain: string;
  name: string;
  procedureDigest: string;
  promotedAt: number;
  successCount: number;
  failureCount: number;
};

type DoctrineStore = {
  doctrine: DoctrineEntry[];
  updatedAt: number;
};

async function loadDoctrine(stateDir: string): Promise<DoctrineStore> {
  const filePath = path.join(stateDir, DOCTRINE_FILE);
  try {
    return JSON.parse(await fs.readFile(filePath, "utf8"));
  } catch {
    return { doctrine: [], updatedAt: Date.now() };
  }
}

async function saveDoctrine(stateDir: string, store: DoctrineStore): Promise<void> {
  const filePath = path.join(stateDir, DOCTRINE_FILE);
  const tmp = `${filePath}.tmp.${Date.now()}`;
  await fs.writeFile(tmp, JSON.stringify(store, null, 2), "utf8");
  await fs.rename(tmp, filePath);
}

export async function promoteIfEligible(playbook: Playbook): Promise<boolean> {
  const total = playbook.successCount + playbook.failureCount;
  if (total < MIN_USES_FOR_DOCTRINE) return false;
  const rate = playbook.successCount / total;
  if (rate < MIN_RATE_FOR_DOCTRINE) return false;

  const stateDir = resolveStateDir();
  const store = await loadDoctrine(stateDir);
  if (store.doctrine.some((d) => d.playbookId === playbook.id)) return false;

  const domain = playbook.triggers.find((t) => t.type === "domain")?.value ?? "general";
  const inDomain = store.doctrine.filter((d) => d.domain === domain);

  const entry: DoctrineEntry = {
    playbookId: playbook.id,
    domain,
    name: playbook.name,
    procedureDigest: playbook.procedure.slice(0, 200),
    promotedAt: Date.now(),
    successCount: playbook.successCount,
    failureCount: playbook.failureCount,
  };

  if (inDomain.length >= MAX_DOCTRINE_PER_DOMAIN) {
    const lowest = inDomain.reduce((a, b) => {
      const ar = a.successCount / Math.max(a.successCount + a.failureCount, 1);
      const br = b.successCount / Math.max(b.successCount + b.failureCount, 1);
      return ar < br ? a : b;
    });
    const rateEntry = entry.successCount / Math.max(entry.successCount + entry.failureCount, 1);
    const rateLowest = lowest.successCount / Math.max(lowest.successCount + lowest.failureCount, 1);
    if (rateEntry <= rateLowest) return false;
    store.doctrine = store.doctrine.filter((d) => d.playbookId !== lowest.playbookId);
  }

  store.doctrine.push(entry);
  store.updatedAt = Date.now();
  await saveDoctrine(stateDir, store);
  return true;
}

export async function getDoctrine(domain: string): Promise<DoctrineEntry[]> {
  const store = await loadDoctrine(resolveStateDir());
  return store.doctrine.filter((d) => d.domain === domain || d.domain === "general");
}
