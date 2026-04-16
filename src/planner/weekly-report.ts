import { queryDecisions } from "./memory-query.js";
import { getTrustMetrics } from "./trust-telemetry.js";
import { getPlaybookStats } from "./playbook-manager.js";
import { recordMemory } from "./planner-memory.js";
import { sendToPublicChannel } from "../auto-reply/reply/commands-publish.js";
import { publishToNostr } from "../social/nostr-publisher.js";
import { recordPlannerDecision, readPlannerRows, updatePlannerRow } from "./planner-state.js";
import { spawnPlannerReadonlyTask } from "./planner-spawn.js";
import { loadSessionStore, saveSessionStore } from "../config/sessions/store.js";
import { resolveStorePath } from "../config/sessions/paths.js";
import type { OpenClawConfig } from "../config/config.js";
import type { SessionEntry } from "../config/sessions/types.js";

const PENDING_WEEKLY_REPORT_KEY = "pendingWeeklyReportChildKey";

async function getPendingWeeklyReportChildKey(): Promise<string | undefined> {
  try {
    const storePath = resolveStorePath(undefined, { agentId: "main" });
    const store = loadSessionStore(storePath);
    return store[PENDING_WEEKLY_REPORT_KEY] as string | undefined;
  } catch {
    return undefined;
  }
}

async function setPendingWeeklyReportChildKey(key: string): Promise<void> {
  try {
    const storePath = resolveStorePath(undefined, { agentId: "main" });
    const store = loadSessionStore(storePath);
    store[PENDING_WEEKLY_REPORT_KEY] = key;
    await saveSessionStore(storePath, store);
  } catch {
    // ignore
  }
}

async function clearPendingWeeklyReportChildKey(): Promise<void> {
  try {
    const storePath = resolveStorePath(undefined, { agentId: "main" });
    const store = loadSessionStore(storePath);
    delete store[PENDING_WEEKLY_REPORT_KEY];
    await saveSessionStore(storePath, store);
  } catch {
    // ignore
  }
}

async function trySpawnWeeklyReportBrief(params: {
  cfg: OpenClawConfig;
  agentId: string;
  sessionKey: string;
  nowMs: number;
  entry: Pick<SessionEntry, "lastChannel" | "lastAccountId" | "lastTo" | "lastThreadId" | "groupId" | "groupChannel" | "space">;
}): Promise<string | null> {
  const decisions = await queryDecisions({ lookbackDays: 7 }).catch(() => null);
  const trust = await getTrustMetrics().catch(() => null);
  const playbooks = await getPlaybookStats().catch(() => null);

  const total = decisions?.total ?? 0;
  const approved = decisions?.approved ?? 0;
  const rejected = decisions?.rejected ?? 0;
  const modified = decisions?.modified ?? 0;
  const approvalRate = trust && trust.totalActions > 0
    ? ((trust.approvedActions / trust.totalActions) * 100).toFixed(0)
    : "n/a";
  const pbTotal = playbooks?.total ?? 0;
  const pbRate = playbooks ? (playbooks.avgSuccessRate * 100).toFixed(0) : "n/a";

  const goalId = `weekly-report-${Date.now()}`;
  const weeklyReportDecision = {
    mode: "brief" as const,
    goal: {
      id: goalId,
      title: "Generate OpenTrident Weekly Performance Report",
      summary: `Analyze the week's activity: ${total} decisions (${approved} approved, ${rejected} rejected, ${modified} modified), trust approval rate ${approvalRate}%, playbook library ${pbTotal} playbooks at ${pbRate}% success rate. Produce a structured markdown report with sections for Decisions Shipped, Leverage Created, Lessons Learned, and Next Week's Focus.`,
      actionClass: "brief" as const,
      domain: "general" as const,
      sourceItemId: goalId,
    },
    topItem: {
      id: goalId,
      intent: "result" as const,
      domain: "general" as const,
      score: 1.0,
      summary: "Weekly performance report generation",
      evidence: [
        `Decisions: ${total} total — ${approved} approved, ${rejected} rejected, ${modified} modified`,
        `Trust: ${approvalRate}% approval rate over ${trust?.totalActions ?? 0} total actions`,
        `Playbooks: ${pbTotal} playbooks at ${pbRate}% avg success rate`,
      ],
      source: "weekly-report",
      envelope: {
        from: "system",
        to: "planner",
        intent: "result",
        body: "Weekly report generation",
      },
    },
    candidates: [],
  };

  const existingRows = await readPlannerRows({ sessionKey: params.sessionKey });
  const recordResult = await recordPlannerDecision({
    sessionKey: params.sessionKey,
    nowMs: params.nowMs,
    decision: weeklyReportDecision,
  });
  if (!recordResult) return null;

  const spawnResult = await spawnPlannerReadonlyTask({
    cfg: params.cfg,
    agentId: params.agentId,
    sessionKey: params.sessionKey,
    nowMs: params.nowMs,
    decision: weeklyReportDecision,
    existingRows,
    currentRowId: recordResult.id,
    entry: params.entry,
  });

  if (spawnResult.status === "accepted" && spawnResult.childSessionKey) {
    await updatePlannerRow({
      sessionKey: params.sessionKey,
      rowId: recordResult.id,
      nowMs: params.nowMs,
      patch: {
        status: "spawned",
        childSessionKey: spawnResult.childSessionKey,
        runId: spawnResult.runId,
        note: spawnResult.note,
      },
    });
    await setPendingWeeklyReportChildKey(spawnResult.childSessionKey);
    return null;
  }

  return null;
}

export async function generateWeeklyReportText(params?: {
  cfg?: OpenClawConfig;
  agentId?: string;
  sessionKey?: string;
  nowMs?: number;
  entry?: Pick<SessionEntry, "lastChannel" | "lastAccountId" | "lastTo" | "lastThreadId" | "groupId" | "groupChannel" | "space">;
}): Promise<string | null> {
  if (!params?.cfg || !params?.agentId || !params?.sessionKey || !params?.entry) {
    return generateStaticWeeklyReportText();
  }

  const pendingChildKey = await getPendingWeeklyReportChildKey();
  if (pendingChildKey) {
    const rows = await readPlannerRows({ sessionKey: params.sessionKey });
    const pendingRow = rows.find((r) => r.childSessionKey === pendingChildKey);
    if (pendingRow?.draftResult) {
      await clearPendingWeeklyReportChildKey();
      return pendingRow.draftResult;
    }
    if (pendingRow && (pendingRow.status === "done" || pendingRow.status === "failed")) {
      await clearPendingWeeklyReportChildKey();
      if (pendingRow.draftResult) return pendingRow.draftResult;
      return generateStaticWeeklyReportText();
    }
    return null;
  }

  const spawned = await trySpawnWeeklyReportBrief({
    cfg: params.cfg,
    agentId: params.agentId,
    sessionKey: params.sessionKey,
    nowMs: params.nowMs ?? Date.now(),
    entry: params.entry,
  });
  return spawned;
}

function generateStaticWeeklyReportText(): string {
  const sections = [
    "**OpenTrident Weekly Report**",
    "",
    "## Decisions Shipped",
    "No formal decisions this week.",
    "",
    "## Leverage Created",
    "Playbook library: 0 playbooks, n/a avg success rate.",
    "Trust approval rate: n/a over 0 total actions.",
    "",
    "## Lessons",
    "Execution log available in audit trail. Check /dashboard for live metrics.",
    "",
    "## Next Week's Focus",
    "Continue compounding judgment. Promote next doctrine entry. Expand playbook library.",
    "",
    `— OpenTrident · ${new Date().toISOString().slice(0, 10)}`,
  ];
  return sections.join("\n");
}

export async function publishWeeklyReport(reportText: string): Promise<void> {
  await recordMemory({
    key: `weekly-report:${new Date().toISOString().slice(0, 10)}`,
    value: reportText,
    category: "reflection",
    source: "weekly-report",
  }).catch(() => {});

  await sendToPublicChannel(reportText).catch(() => {});
  await publishToNostr({ text: reportText, tags: [["t", "opentrident"], ["t", "weekly-report"]] }).catch(() => {});
}
