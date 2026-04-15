import fs from "node:fs/promises";
import path from "node:path";
import { resolveStateDir } from "../config/paths.js";
import type { MemoryEntry } from "./planner-memory.js";
import type { PlannerDomain, PlannerStateRow, PlannerStateStatus } from "./types.js";

const MS_PER_DAY = 86_400_000;

type PlannerStateFile = { sessions: Record<string, PlannerStateRow[]> };

async function loadPlannerState(stateDir: string): Promise<readonly PlannerStateRow[]> {
  const filePath = path.join(stateDir, "planner-v1.json");
  try {
    const raw = await fs.readFile(filePath, "utf8");
    const data = JSON.parse(raw) as PlannerStateFile;
    const rows: PlannerStateRow[] = [];
    for (const sessionRows of Object.values(data.sessions ?? {})) {
      rows.push(...sessionRows);
    }
    return rows;
  } catch {
    return [];
  }
}

async function loadMemoryEntries(stateDir: string): Promise<readonly MemoryEntry[]> {
  const filePath = path.join(stateDir, "memory-v1.json");
  try {
    const raw = await fs.readFile(filePath, "utf8");
    const data = JSON.parse(raw) as { entries: MemoryEntry[] };
    return data.entries ?? [];
  } catch {
    return [];
  }
}

export type { MemoryEntry };

export interface DecisionQueryResult {
  domain: PlannerDomain;
  total: number;
  approved: number;
  rejected: number;
  modified: number;
  rows: readonly PlannerStateRow[];
}

export interface FrequencyQueryResult {
  category: MemoryEntry["category"];
  keyPattern: string;
  count: number;
  averageIntervalDays: number | null;
  lastSeenMs: number | null;
  lastSeenDaysAgo: number | null;
}

export interface LastOccurrenceResult {
  lastSeenMs: number;
  daysSince: number;
  entry: MemoryEntry;
}

export interface FollowUpResult {
  followUp: MemoryEntry;
  latencyDays: number;
}

const OUTCOME_STATUSES: readonly PlannerStateStatus[] = ["approved", "rejected", "modified"];

export async function queryDecisions(params: {
  domain?: PlannerDomain;
  lookbackDays: number;
  outcome?: "approved" | "rejected" | "modified" | "all";
  stateDir?: string;
}): Promise<DecisionQueryResult> {
  const stateDir = params.stateDir ?? resolveStateDir();
  const cutoffMs = Date.now() - params.lookbackDays * MS_PER_DAY;
  const rows = await loadPlannerState(stateDir);

  const filtered = rows.filter((r) => {
    if (r.createdAt < cutoffMs) return false;
    if (params.domain && r.domain !== params.domain) return false;
    if (params.outcome && params.outcome !== "all" && r.status !== params.outcome) return false;
    if (!params.outcome && !OUTCOME_STATUSES.includes(r.status)) return false;
    return true;
  });

  const approved = filtered.filter((r) => r.status === "approved").length;
  const rejected = filtered.filter((r) => r.status === "rejected").length;
  const modified = filtered.filter((r) => r.status === "modified").length;

  return {
    domain: params.domain ?? "general",
    total: filtered.length,
    approved,
    rejected,
    modified,
    rows: filtered,
  };
}

export async function queryLastOccurrence(params: {
  category: MemoryEntry["category"];
  keyPattern: string | RegExp;
  stateDir?: string;
}): Promise<LastOccurrenceResult | null> {
  const stateDir = params.stateDir ?? resolveStateDir();
  const entries = await loadMemoryEntries(stateDir);
  const pattern = params.keyPattern instanceof RegExp
    ? params.keyPattern
    : new RegExp(params.keyPattern, "i");

  const matches = entries
    .filter((e) => e.category === params.category && pattern.test(e.key))
    .sort((a, b) => b.timestamp - a.timestamp);

  if (matches.length === 0) return null;
  const entry = matches[0];
  return {
    lastSeenMs: entry.timestamp,
    daysSince: Math.round((Date.now() - entry.timestamp) / MS_PER_DAY),
    entry,
  };
}

export async function queryFollowUps(params: {
  triggerKey: string;
  withinDays: number;
  stateDir?: string;
}): Promise<readonly FollowUpResult[]> {
  const stateDir = params.stateDir ?? resolveStateDir();
  const entries = await loadMemoryEntries(stateDir);
  const trigger = entries.find((e) => e.key === params.triggerKey);
  if (!trigger) return [];

  const cutoffMs = trigger.timestamp + params.withinDays * MS_PER_DAY;
  return entries
    .filter((e) => e.timestamp > trigger.timestamp && e.timestamp <= cutoffMs)
    .map((e) => ({
      followUp: e,
      latencyDays: Math.round((e.timestamp - trigger.timestamp) / MS_PER_DAY),
    }));
}

export async function queryFrequency(params: {
  category: MemoryEntry["category"];
  keyPattern: string | RegExp;
  lookbackDays: number;
  stateDir?: string;
}): Promise<FrequencyQueryResult> {
  const stateDir = params.stateDir ?? resolveStateDir();
  const cutoffMs = Date.now() - params.lookbackDays * MS_PER_DAY;
  const entries = await loadMemoryEntries(stateDir);
  const pattern = params.keyPattern instanceof RegExp
    ? params.keyPattern
    : new RegExp(params.keyPattern, "i");

  const matches = entries
    .filter((e) => e.category === params.category && pattern.test(e.key) && e.timestamp >= cutoffMs)
    .sort((a, b) => a.timestamp - b.timestamp);

  const count = matches.length;
  const lastSeenMs = matches.length > 0 ? matches[matches.length - 1].timestamp : null;

  let averageIntervalDays: number | null = null;
  if (matches.length >= 2) {
    const intervals = matches.slice(1).map((e, i) =>
      (e.timestamp - matches[i].timestamp) / MS_PER_DAY
    );
    averageIntervalDays = Math.round(intervals.reduce((a, b) => a + b, 0) / intervals.length);
  }

  return {
    category: params.category,
    keyPattern: String(params.keyPattern),
    count,
    averageIntervalDays,
    lastSeenMs,
    lastSeenDaysAgo: lastSeenMs ? Math.round((Date.now() - lastSeenMs) / MS_PER_DAY) : null,
  };
}
