import fs from "node:fs/promises";
import path from "node:path";
import { resolveStateDir } from "../config/paths.js";
import { retryAsync } from "../infra/retry.js";
import { buildForkStateDir, getForkId } from "../multi/fork-isolation.js";
import type { PlannerDecision, PlannerStateRow, PlannerStateStatus } from "./types.js";

const STATE_FILENAME = "planner-v1.json";
const MAX_ROWS_PER_SESSION = 20;
const FILE_RETRY_CONFIG = { attempts: 3, minDelayMs: 100, maxDelayMs: 2000, jitter: 0.1 };

function resolveForkStateDir(stateDir?: string): string {
  const base = stateDir ?? resolveStateDir();
  return buildForkStateDir(base, getForkId());
}

type PlannerStateFile = {
  sessions: Record<string, PlannerStateRow[]>;
};

function defaultState(): PlannerStateFile {
  return { sessions: {} };
}

async function loadPlannerStateFrom(filePath: string): Promise<PlannerStateFile> {
  return retryAsync(
    async () => {
      const raw = await fs.readFile(filePath, "utf8");
      const parsed = JSON.parse(raw) as PlannerStateFile;
      return parsed && typeof parsed === "object" && parsed.sessions ? parsed : defaultState();
    },
    { ...FILE_RETRY_CONFIG, label: "loadPlannerState" },
  ).catch(() => defaultState());
}

async function savePlannerStateTo(filePath: string, state: PlannerStateFile): Promise<void> {
  const dir = path.dirname(filePath);
  await retryAsync(
    async () => {
      await fs.mkdir(dir, { recursive: true });
      await fs.writeFile(filePath, `${JSON.stringify(state, null, 2)}\n`, "utf8");
    },
    { ...FILE_RETRY_CONFIG, label: "savePlannerState" },
  );
}

export async function recordPlannerDecision(params: {
  sessionKey: string;
  nowMs: number;
  decision: PlannerDecision;
  stateDir?: string;
  status?: PlannerStateStatus;
  childSessionKey?: string;
  runId?: string;
  note?: string;
}): Promise<PlannerStateRow | undefined> {
  if (!params.sessionKey.trim()) {
    return undefined;
  }
  if (!params.decision.goal || !params.decision.topItem) {
    return undefined;
  }
  const stateDir = resolveForkStateDir(params.stateDir);
  const filePath = path.join(stateDir, STATE_FILENAME);
  const state = await loadPlannerStateFrom(filePath);
  const row: PlannerStateRow = {
    id: `${params.sessionKey}:${params.decision.goal.id}:${params.nowMs}`,
    sessionKey: params.sessionKey,
    status: params.status ?? "selected",
    mode: params.decision.mode,
    title: params.decision.goal.title,
    summary: params.decision.goal.summary,
    domain: params.decision.goal.domain,
    actionClass: params.decision.goal.actionClass,
    sourceItemId: params.decision.goal.sourceItemId,
    score: params.decision.topItem.score,
    createdAt: params.nowMs,
    updatedAt: params.nowMs,
    evidence: params.decision.topItem.evidence,
    ...(params.childSessionKey ? { childSessionKey: params.childSessionKey } : {}),
    ...(params.runId ? { runId: params.runId } : {}),
    ...(params.note ? { note: params.note } : {}),
    ...(params.decision.playbookId ? { playbookId: params.decision.playbookId } : {}),
  };
  const rows = state.sessions[params.sessionKey] ?? [];
  state.sessions[params.sessionKey] = [row, ...rows].slice(0, MAX_ROWS_PER_SESSION);
  await savePlannerStateTo(filePath, state);
  return row;
}

export async function updatePlannerRow(params: {
  sessionKey: string;
  rowId: string;
  nowMs: number;
  stateDir?: string;
  patch: Partial<Pick<PlannerStateRow, "status" | "summary" | "evidence" | "childSessionKey" | "runId" | "note" | "draftResult" | "confirmedAt" | "sentAt" | "retryCount" | "downgradedFrom" | "deferredUntil">>;
}): Promise<PlannerStateRow | undefined> {
  const stateDir = resolveForkStateDir(params.stateDir);
  const filePath = path.join(stateDir, STATE_FILENAME);
  const state = await loadPlannerStateFrom(filePath);
  const rows = state.sessions[params.sessionKey] ?? [];
  const index = rows.findIndex((row) => row.id === params.rowId);
  if (index < 0) {
    return undefined;
  }
  const current = rows[index];
  const next: PlannerStateRow = {
    ...current,
    ...params.patch,
    updatedAt: params.nowMs,
  };
  rows[index] = next;
  state.sessions[params.sessionKey] = rows.slice(0, MAX_ROWS_PER_SESSION);
  await savePlannerStateTo(filePath, state);
  return next;
}

export async function readPlannerRows(params: {
  sessionKey: string;
  stateDir?: string;
}): Promise<readonly PlannerStateRow[]> {
  const stateDir = resolveForkStateDir(params.stateDir);
  const filePath = path.join(stateDir, STATE_FILENAME);
  const state = await loadPlannerStateFrom(filePath);
  return state.sessions[params.sessionKey] ?? [];
}