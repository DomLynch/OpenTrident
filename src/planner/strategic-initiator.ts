import fs from "node:fs/promises";
import path from "node:path";
import { resolveStateDir } from "../config/paths.js";
import { getTrustMetrics } from "./trust-telemetry.js";
import { queryFrequency, queryLastOccurrence } from "./memory-query.js";
import type { PlannerDomain, PlannerEnvelope, PlannerItem, PlannerStateRow } from "./types.js";

const SOURCE = "strategic-initiator";
const LOOKBACK_DEFAULT = 14;
const MS_PER_DAY = 86_400_000;
const STRATEGIC_CACHE_FILE = "strategic-goals-v1.json";
const STRATEGIC_CACHE_TTL_MS = 6 * 60 * 60 * 1000;

function makeEnvelope(): PlannerEnvelope {
  return { from: SOURCE, to: "planner", intent: "goal", body: "" };
}

function buildStrategicItem(params: {
  detector: string;
  subject: string;
  domain: PlannerDomain;
  score: number;
  summary: string;
  evidence: string[];
}): PlannerItem {
  return {
    id: `strategic:${params.detector}:${params.subject.replace(/[^a-z0-9]/gi, "-").slice(0, 40)}`,
    intent: "goal",
    domain: params.domain,
    score: Math.min(1, Math.max(0, params.score)),
    summary: params.summary,
    evidence: params.evidence,
    source: SOURCE,
    envelope: makeEnvelope(),
  };
}

async function loadMarketCache(): Promise<{ lastFetchMs: number } | null> {
  const filePath = path.join(resolveStateDir(), "market-attention-v1.json");
  try {
    const raw = await fs.readFile(filePath, "utf8");
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

async function loadPlannerState(): Promise<readonly PlannerStateRow[]> {
  const filePath = path.join(resolveStateDir(), "planner-v1.json");
  try {
    const raw = await fs.readFile(filePath, "utf8");
    const data = JSON.parse(raw) as { sessions: Record<string, PlannerStateRow[]> };
    const rows: PlannerStateRow[] = [];
    for (const sessionRows of Object.values(data.sessions ?? {})) {
      rows.push(...sessionRows);
    }
    return rows;
  } catch {
    return [];
  }
}

async function detectReviewCadence(): Promise<PlannerItem[]> {
  const items: PlannerItem[] = [];
  const keys = ["btc", "ethereum", "solana", "crypto", "trading", "position"];
  for (const key of keys) {
    const freq = await queryFrequency({ category: "decision", keyPattern: new RegExp(key, "i"), lookbackDays: 30 });
    if (freq.averageIntervalDays != null && freq.lastSeenDaysAgo != null && freq.lastSeenDaysAgo > freq.averageIntervalDays) {
      const overdue = freq.lastSeenDaysAgo - freq.averageIntervalDays;
      items.push(buildStrategicItem({
        detector: "review-cadence",
        subject: key,
        domain: "market",
        score: Math.min(1, overdue / freq.averageIntervalDays),
        summary: `Review ${key} position — typical cadence ${freq.averageIntervalDays}d, last review ${freq.lastSeenDaysAgo}d ago`,
        evidence: freq.lastSeenMs ? [`Last: ${new Date(freq.lastSeenMs).toISOString().split("T")[0]}`, `Typical: ${freq.averageIntervalDays}d`] : [],
      }));
    }
  }
  return items;
}

async function detectDecisionDrift(lookbackDays: number): Promise<PlannerItem[]> {
  const nowMs = Date.now();
  const cutoffMs = nowMs - lookbackDays * MS_PER_DAY;
  const rows = await loadPlannerState();
  return rows
    .filter((r) => (r.status === "selected" || r.status === "approved") && r.createdAt >= cutoffMs && r.updatedAt < nowMs - 3 * MS_PER_DAY)
    .map((r) => {
      const daysStale = Math.round((nowMs - r.updatedAt) / MS_PER_DAY);
      return buildStrategicItem({
        detector: "decision-drift",
        subject: r.title.replace(/[^a-z0-9]/gi, "-").slice(0, 30),
        domain: r.domain,
        score: Math.min(1, (daysStale / lookbackDays) * 0.8 + r.score * 0.2),
        summary: `Decision "${r.title}" made ${daysStale}d ago with no follow-through`,
        evidence: r.evidence ?? [],
      });
    });
}

async function detectPatternBreak(): Promise<PlannerItem[]> {
  const metrics = await getTrustMetrics();
  if (metrics.dailyTrend.length < 3) return [];
  const items: PlannerItem[] = [];
  const trend = metrics.dailyTrend;
  for (let i = 1; i < trend.length; i++) {
    if (trend[i - 1].actions > 0 && trend[i].actions === 0) {
      const date = trend[i].date;
      const dow = new Date(date).toLocaleDateString("en-US", { weekday: "long" });
      items.push(buildStrategicItem({
        detector: "pattern-break",
        subject: `day-${date}`,
        domain: "general",
        score: 0.5,
        summary: `${dow} (${date}) had no planner activity — breaking typical pattern`,
        evidence: [`${trend[i - 1].date}: ${trend[i - 1].actions} actions`, `${date}: 0 actions`],
      }));
    }
  }
  return items;
}

async function detectStaleCommitments(): Promise<PlannerItem[]> {
  const items: PlannerItem[] = [];
  const last = await queryLastOccurrence({ category: "decision", keyPattern: /./ });
  if (last && /\b(by|before|until|next|this|end of|in\s+\d|within)\s+\w+/i.test(last.entry.value)) {
    const daysSince = Math.round((Date.now() - last.lastSeenMs) / MS_PER_DAY);
    items.push(buildStrategicItem({
      detector: "stale-commitment",
      subject: last.entry.key.replace(/[^a-z0-9]/gi, "-").slice(0, 30),
      domain: "decision",
      score: Math.min(1, daysSince / 14),
      summary: `Commitment "${last.entry.key}" may be stale: "${last.entry.value.slice(0, 80)}"`,
      evidence: [`Recorded: ${new Date(last.lastSeenMs).toISOString().split("T")[0]}`],
    }));
  }
  return items;
}

async function detectRelationshipGap(): Promise<PlannerItem[]> {
  return [];
}

async function detectMarketCadence(): Promise<PlannerItem[]> {
  const cache = await loadMarketCache();
  if (!cache?.lastFetchMs) return [];
  const daysSince = Math.round((Date.now() - cache.lastFetchMs) / MS_PER_DAY);
  const typical = 3;
  if (daysSince <= typical) return [];
  return [buildStrategicItem({
    detector: "market-cadence",
    subject: "market-review",
    domain: "market",
    score: Math.min(1, (daysSince - typical) / typical),
    summary: `Market signals last reviewed ${daysSince}d ago — typical cadence ${typical}d during active periods`,
    evidence: [`Last review: ${new Date(cache.lastFetchMs).toISOString().split("T")[0]}`],
  })];
}

async function generateFreshGoals(): Promise<readonly PlannerItem[]> {
  const [reviewCadence, decisionDrift, patternBreak, staleCommitment, relationshipGap, marketCadence] =
    await Promise.all([
      detectReviewCadence(),
      detectDecisionDrift(LOOKBACK_DEFAULT),
      detectPatternBreak(),
      detectStaleCommitments(),
      detectRelationshipGap(),
      detectMarketCadence(),
    ]);
  return [...reviewCadence, ...decisionDrift, ...patternBreak, ...staleCommitment, ...relationshipGap, ...marketCadence]
    .sort((a, b) => b.score - a.score);
}

async function loadStrategicCache(): Promise<{ goals: PlannerItem[]; generatedAt: number } | null> {
  const filePath = path.join(resolveStateDir(), STRATEGIC_CACHE_FILE);
  try {
    const raw = await fs.readFile(filePath, "utf8");
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

async function saveStrategicCache(goals: PlannerItem[]): Promise<void> {
  const filePath = path.join(resolveStateDir(), STRATEGIC_CACHE_FILE);
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await fs.writeFile(filePath, JSON.stringify({ goals, generatedAt: Date.now() }, null, 2), "utf8");
}

export async function generateStrategicGoals(): Promise<PlannerItem[]> {
  const cache = await loadStrategicCache();
  const nowMs = Date.now();
  if (cache && nowMs - cache.generatedAt < STRATEGIC_CACHE_TTL_MS) {
    return cache.goals;
  }
  const goals = await generateFreshGoals();
  await saveStrategicCache(goals);
  return goals;
}
