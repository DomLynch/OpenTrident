import fs from "node:fs/promises";
import path from "node:path";
import { resolveStateDir } from "../config/paths.js";

const TELEMETRY_FILE = "trust-telemetry-v1.json";

export type TrustMetrics = {
  totalActions: number;
  approvedActions: number;
  rejectedActions: number;
  modifiedActions: number;
  byDomain: Record<string, { total: number; approved: number; rejected: number; modified: number }>;
  bySource: Record<string, { total: number; approved: number; rejected: number; modified: number }>;
  dailyTrend: Array<{ date: string; actions: number; approvalRate: number }>;
  lastUpdated: number;
};

type TelemetryCache = {
  metrics: TrustMetrics;
  dailyCounts: Record<
    string,
    { approved: number; rejected: number; modified: number; total: number }
  >;
};

function getDateKey(ms: number): string {
  return new Date(ms).toISOString().split("T")[0];
}

function createEmptyMetrics(): TrustMetrics {
  return {
    totalActions: 0,
    approvedActions: 0,
    rejectedActions: 0,
    modifiedActions: 0,
    byDomain: {},
    bySource: {},
    dailyTrend: [],
    lastUpdated: Date.now(),
  };
}

async function loadTelemetry(statePath: string): Promise<TelemetryCache> {
  try {
    const raw = await fs.readFile(statePath, "utf8");
    return JSON.parse(raw) as TelemetryCache;
  } catch {
    return { metrics: createEmptyMetrics(), dailyCounts: {} };
  }
}

async function saveTelemetry(statePath: string, cache: TelemetryCache): Promise<void> {
  await fs.mkdir(path.dirname(statePath), { recursive: true });
  await fs.writeFile(statePath, JSON.stringify(cache, null, 2), "utf8");
}

export async function recordActionOutcome(params: {
  actionClass: string;
  domain: string;
  source: string;
  outcome: "approved" | "rejected" | "modified";
  stateDir?: string;
}): Promise<void> {
  const stateDir = params.stateDir ?? resolveStateDir();
  const statePath = path.join(stateDir, TELEMETRY_FILE);
  const cache = await loadTelemetry(statePath);
  const today = getDateKey(Date.now());

  cache.metrics.totalActions++;
  cache.metrics.lastUpdated = Date.now();

  if (params.outcome === "approved") {
    cache.metrics.approvedActions++;
  } else if (params.outcome === "rejected") {
    cache.metrics.rejectedActions++;
  } else {
    cache.metrics.modifiedActions++;
  }

  if (!cache.metrics.byDomain[params.domain]) {
    cache.metrics.byDomain[params.domain] = { total: 0, approved: 0, rejected: 0, modified: 0 };
  }
  cache.metrics.byDomain[params.domain].total++;
  cache.metrics.byDomain[params.domain][params.outcome]++;

  if (!cache.metrics.bySource[params.source]) {
    cache.metrics.bySource[params.source] = { total: 0, approved: 0, rejected: 0, modified: 0 };
  }
  cache.metrics.bySource[params.source].total++;
  cache.metrics.bySource[params.source][params.outcome]++;

  if (!cache.dailyCounts[today]) {
    cache.dailyCounts[today] = { approved: 0, rejected: 0, modified: 0, total: 0 };
  }
  cache.dailyCounts[today].total++;
  cache.dailyCounts[today][params.outcome]++;

  const trendDays = Object.entries(cache.dailyCounts)
    .toSorted(([a], [b]) => b.localeCompare(a))
    .slice(0, 7)
    .map(([date, counts]) => ({
      date,
      actions: counts.total,
      approvalRate: counts.total > 0 ? counts.approved / counts.total : 0,
    }))
    .toReversed();

  cache.metrics.dailyTrend = trendDays;

  await saveTelemetry(statePath, cache);
}

export async function getTrustMetrics(stateDir?: string): Promise<TrustMetrics> {
  const statePath = path.join(stateDir ?? resolveStateDir(), TELEMETRY_FILE);
  const cache = await loadTelemetry(statePath);
  return cache.metrics;
}

export function buildTrustScorecard(metrics: TrustMetrics): string {
  const approvalRate =
    metrics.totalActions > 0
      ? ((metrics.approvedActions / metrics.totalActions) * 100).toFixed(1)
      : "0";

  const lines = [
    "## Trust Telemetry",
    "",
    `**Overall Approval Rate:** ${approvalRate}%`,
    `**Total Actions Tracked:** ${metrics.totalActions}`,
    "",
    "**Breakdown:**",
    `- Approved: ${metrics.approvedActions}`,
    `- Rejected: ${metrics.rejectedActions}`,
    `- Modified: ${metrics.modifiedActions}`,
  ];

  if (Object.keys(metrics.byDomain).length > 0) {
    lines.push("", "**By Domain:**");
    for (const [domain, stats] of Object.entries(metrics.byDomain)) {
      const rate = stats.total > 0 ? ((stats.approved / stats.total) * 100).toFixed(0) : "0";
      lines.push(`- ${domain}: ${rate}% approval (${stats.total} actions)`);
    }
  }

  if (metrics.dailyTrend.length > 0) {
    lines.push("", "**7-Day Trend:**");
    for (const day of metrics.dailyTrend.slice(-7)) {
      lines.push(`- ${day.date}: ${day.approvalRate.toFixed(0)}% approval rate`);
    }
  }

  return lines.join("\n");
}
