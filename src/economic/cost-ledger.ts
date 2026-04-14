import fs from "node:fs/promises";
import path from "node:path";
import { resolveStateDir } from "../config/paths.js";

const COST_LEDGER_FILE = "cost-ledger-v1.json";

export type CostEntry = {
  date: string;
  vpsCost: number;
  apiCost: number;
  revenue: number;
  txCount: number;
};

export type CostLedger = {
  entries: CostEntry[];
  totalVpsCost: number;
  totalApiCost: number;
  totalRevenue: number;
  lastUpdated: number;
};

export type DailyCostSummary = {
  date: string;
  vpsCost: number;
  apiCost: number;
  revenue: number;
  netBurn: number;
  runwayDays: number | null;
};

function getDateKey(ms = Date.now()): string {
  return new Date(ms).toISOString().split("T")[0];
}

async function loadLedger(stateDir: string): Promise<CostLedger> {
  const filePath = path.join(stateDir, COST_LEDGER_FILE);
  try {
    const raw = await fs.readFile(filePath, "utf8");
    return JSON.parse(raw) as CostLedger;
  } catch {
    return { entries: [], totalVpsCost: 0, totalApiCost: 0, totalRevenue: 0, lastUpdated: Date.now() };
  }
}

async function saveLedger(stateDir: string, ledger: CostLedger): Promise<void> {
  const filePath = path.join(stateDir, COST_LEDGER_FILE);
  await fs.mkdir(stateDir, { recursive: true });
  await fs.writeFile(filePath, JSON.stringify(ledger, null, 2), "utf8");
}

export async function recordVpsCost(amountUsd: number): Promise<void> {
  const stateDir = resolveStateDir();
  const ledger = await loadLedger(stateDir);
  const today = getDateKey();
  let todayEntry = ledger.entries.find((e) => e.date === today);
  if (!todayEntry) {
    todayEntry = { date: today, vpsCost: 0, apiCost: 0, revenue: 0, txCount: 0 };
    ledger.entries.push(todayEntry);
    if (ledger.entries.length > 90) {
      ledger.entries = ledger.entries.slice(-90);
    }
  }
  todayEntry.vpsCost += amountUsd;
  ledger.totalVpsCost += amountUsd;
  ledger.lastUpdated = Date.now();
  await saveLedger(stateDir, ledger);
}

export async function recordApiCost(amountUsd: number): Promise<void> {
  const stateDir = resolveStateDir();
  const ledger = await loadLedger(stateDir);
  const today = getDateKey();
  let todayEntry = ledger.entries.find((e) => e.date === today);
  if (!todayEntry) {
    todayEntry = { date: today, vpsCost: 0, apiCost: 0, revenue: 0, txCount: 0 };
    ledger.entries.push(todayEntry);
  }
  todayEntry.apiCost += amountUsd;
  ledger.totalApiCost += amountUsd;
  ledger.lastUpdated = Date.now();
  await saveLedger(stateDir, ledger);
}

export async function recordRevenue(amountUsd: number): Promise<void> {
  const stateDir = resolveStateDir();
  const ledger = await loadLedger(stateDir);
  const today = getDateKey();
  let todayEntry = ledger.entries.find((e) => e.date === today);
  if (!todayEntry) {
    todayEntry = { date: today, vpsCost: 0, apiCost: 0, revenue: 0, txCount: 0 };
    ledger.entries.push(todayEntry);
  }
  todayEntry.revenue += amountUsd;
  todayEntry.txCount += 1;
  ledger.totalRevenue += amountUsd;
  ledger.lastUpdated = Date.now();
  await saveLedger(stateDir, ledger);
}

export async function getCostSummary(days = 7): Promise<DailyCostSummary[]> {
  const stateDir = resolveStateDir();
  const ledger = await loadLedger(stateDir);
  const cutoff = new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString().split("T")[0];

  const recentEntries = ledger.entries.filter((e) => e.date >= cutoff);

  const totalBurn = recentEntries.reduce((sum, e) => sum + e.vpsCost + e.apiCost, 0);
  const totalRevenue = recentEntries.reduce((sum, e) => sum + e.revenue, 0);
  const avgDailyBurn = totalBurn / days;
  const runway = avgDailyBurn > 0 ? (ledger.totalRevenue - ledger.totalVpsCost - ledger.totalApiCost) / (avgDailyBurn - totalRevenue / days) : null;

  return recentEntries.map((e) => ({
    date: e.date,
    vpsCost: e.vpsCost,
    apiCost: e.apiCost,
    revenue: e.revenue,
    netBurn: e.vpsCost + e.apiCost - e.revenue,
    runwayDays: runway,
  }));
}

export async function buildCostContext(): Promise<string> {
  const summary = await getCostSummary(7);
  const total = summary.reduce((acc, d) => ({
    vpsCost: acc.vpsCost + d.vpsCost,
    apiCost: acc.apiCost + d.apiCost,
    revenue: acc.revenue + d.revenue,
    netBurn: acc.netBurn + d.netBurn,
  }), { vpsCost: 0, apiCost: 0, revenue: 0, netBurn: 0 });

  const dailyBurn = total.netBurn / Math.max(1, summary.length);
  const runway = dailyBurn > 0
    ? Math.round((total.revenue - total.vpsCost - total.apiCost) / dailyBurn)
    : null;

  const lines = [
    "## Economic Context",
    "",
    `**7d Burn:** $${total.netBurn.toFixed(2)} (VPS: $${total.vpsCost.toFixed(2)} + API: $${total.apiCost.toFixed(2)})`,
    `**7d Revenue:** $${total.revenue.toFixed(2)}`,
    `**Daily avg burn:** $${dailyBurn.toFixed(2)}`,
    runway !== null ? `**Runway:** ~${runway} days at current burn` : "**Runway:** N/A (no revenue yet)",
    "",
  ];
  return lines.join("\n");
}
