import fs from "node:fs/promises";
import path from "node:path";
import { resolveStateDir } from "../config/paths.js";
import { buildForkStateDir, getForkId } from "../multi/fork-isolation.js";
import type { MemoryEntry } from "./planner-memory.js";
import type { PlannerDomain, PlannerStateRow, PlannerStateStatus } from "./types.js";

const MS_PER_DAY = 86_400_000;

function resolveForkStateDir(stateDir?: string): string {
  const base = stateDir ?? resolveStateDir();
  return buildForkStateDir(base, getForkId());
}

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
  const stateDir = resolveForkStateDir(params.stateDir);
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
  const stateDir = resolveForkStateDir(params.stateDir);
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
  const stateDir = resolveForkStateDir(params.stateDir);
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
  const stateDir = resolveForkStateDir(params.stateDir);
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

const SESSION_INDEX_FILE = "session-index-v1.json";
const MAX_INDEXED_SESSIONS = 500;
const MAX_SNIPPET_CHARS = 2000;
const DEFAULT_SEARCH_LIMIT = 5;

export interface SessionSummary {
  sessionKey: string;
  domain: PlannerDomain;
  title: string;
  status: PlannerStateStatus;
  createdAt: number;
  updatedAt: number;
  snippet: string;
  score: number;
  matchedTerms: string[];
}

export interface SessionSearchResult {
  query: string;
  totalSessions: number;
  returned: number;
  sessions: SessionSummary[];
}

type SessionIndex = {
  sessions: IndexedSession[];
  lastUpdated: number;
};

type IndexedSession = {
  sessionKey: string;
  domain: PlannerDomain;
  title: string;
  status: PlannerStateStatus;
  createdAt: number;
  updatedAt: number;
  terms: string[];
  snippet: string;
};

function tokenize(text: string): string[] {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .split(/\s+/)
    .filter((t) => t.length > 2);
}

function computeScore(terms: string[], queryTerms: string[]): number {
  const querySet = new Set(queryTerms);
  const matched = terms.filter((t) => querySet.has(t));
  if (matched.length === 0) return 0;
  return matched.length / queryTerms.length;
}

async function loadSessionIndex(stateDir: string): Promise<SessionIndex> {
  const filePath = path.join(stateDir, SESSION_INDEX_FILE);
  try {
    const raw = await fs.readFile(filePath, "utf8");
    return JSON.parse(raw) as SessionIndex;
  } catch {
    return { sessions: [], lastUpdated: 0 };
  }
}

async function saveSessionIndex(stateDir: string, index: SessionIndex): Promise<void> {
  const filePath = path.join(stateDir, SESSION_INDEX_FILE);
  await fs.mkdir(stateDir, { recursive: true });
  const tmpName = `.session-index.tmp.${Date.now()}.${Math.random().toString(36).slice(2, 6)}`;
  const tmpPath = path.join(stateDir, tmpName);
  await fs.writeFile(tmpPath, JSON.stringify(index, null, 2), "utf8");
  await fs.rename(tmpPath, filePath);
}

export async function rebuildSessionIndex(params: {
  stateDir?: string;
} = {}): Promise<number> {
  const stateDir = resolveForkStateDir(params.stateDir);
  const plannerRows = await loadPlannerState(stateDir);

  const indexed: IndexedSession[] = plannerRows
    .sort((a, b) => b.updatedAt - a.updatedAt)
    .slice(0, MAX_INDEXED_SESSIONS)
    .map((row) => {
      const titleText = `${row.title ?? ""} ${row.summary ?? ""} ${row.domain ?? ""}`;
      const terms = [...new Set(tokenize(titleText))];
      const snippet = (row.summary ?? row.title ?? "").slice(0, MAX_SNIPPET_CHARS);
      return {
        sessionKey: row.sessionKey,
        domain: row.domain,
        title: row.title,
        status: row.status,
        createdAt: row.createdAt,
        updatedAt: row.updatedAt,
        terms,
        snippet,
      };
    });

  const index: SessionIndex = { sessions: indexed, lastUpdated: Date.now() };
  await saveSessionIndex(stateDir, index);
  return indexed.length;
}

export async function searchSessions(params: {
  query: string;
  limit?: number;
  domain?: PlannerDomain;
  minScore?: number;
  statusFilter?: PlannerStateStatus[];
  stateDir?: string;
}): Promise<SessionSearchResult> {
  const stateDir = resolveForkStateDir(params.stateDir);
  const limit = params.limit ?? DEFAULT_SEARCH_LIMIT;
  const queryTerms = tokenize(params.query);

  if (queryTerms.length === 0) {
    return { query: params.query, totalSessions: 0, returned: 0, sessions: [] };
  }

  const index = await loadSessionIndex(stateDir);

  let sessions = index.sessions
    .map((s) => ({
      sessionKey: s.sessionKey,
      domain: s.domain,
      title: s.title,
      status: s.status,
      createdAt: s.createdAt,
      updatedAt: s.updatedAt,
      snippet: s.snippet,
      score: computeScore(s.terms, queryTerms),
      matchedTerms: s.terms.filter((t) => queryTerms.includes(t)),
    }))
    .filter((s) => s.matchedTerms.length > 0);

  if (params.domain) {
    sessions = sessions.filter((s) => s.domain === params.domain);
  }

  if (params.statusFilter && params.statusFilter.length > 0) {
    sessions = sessions.filter((s) => params.statusFilter!.includes(s.status));
  }

  if (params.minScore !== undefined) {
    sessions = sessions.filter((s) => s.score >= params.minScore!);
  }

  sessions.sort((a, b) => b.score - a.score);
  const top = sessions.slice(0, limit);

  return {
    query: params.query,
    totalSessions: index.sessions.length,
    returned: top.length,
    sessions: top,
  };
}

export async function indexSessionIfNeeded(params: {
  sessionKey: string;
  domain: PlannerDomain;
  title: string;
  summary?: string;
  status: PlannerStateStatus;
  createdAt: number;
  updatedAt: number;
  stateDir?: string;
}): Promise<void> {
  const stateDir = resolveForkStateDir(params.stateDir);
  const index = await loadSessionIndex(stateDir);

  const existingIdx = index.sessions.findIndex(
    (s) => s.sessionKey === params.sessionKey,
  );
  const terms = [...new Set(tokenize(`${params.title} ${params.summary ?? ""}`))];
  const snippet = (params.summary ?? params.title ?? "").slice(
    0,
    MAX_SNIPPET_CHARS,
  );

  const entry: IndexedSession = {
    sessionKey: params.sessionKey,
    domain: params.domain,
    title: params.title,
    status: params.status,
    createdAt: params.createdAt,
    updatedAt: params.updatedAt,
    terms,
    snippet,
  };

  if (existingIdx >= 0) {
    index.sessions[existingIdx] = entry;
  } else {
    index.sessions.unshift(entry);
    if (index.sessions.length > MAX_INDEXED_SESSIONS) {
      index.sessions = index.sessions
        .sort((a, b) => b.updatedAt - a.updatedAt)
        .slice(0, MAX_INDEXED_SESSIONS);
    }
  }

  index.lastUpdated = Date.now();
  await saveSessionIndex(stateDir, index);
}
