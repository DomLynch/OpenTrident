import { createHash } from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import { resolveStateDir } from "../config/paths.js";
import type { SystemEvent } from "./system-events.js";

const MARKET_SIGNAL_CACHE_FILE = "market-attention-v1.json";
const MARKET_SIGNAL_INTERVAL_MS = 60 * 60 * 1000;
const MAX_SIGNALS = 20;

export type MarketSignal = {
  fingerprint: string;
  key: string;
  text: string;
  score: number;
};

type MarketCache = {
  seen: Record<string, number>;
  signals: MarketSignal[];
  lastFetchMs: number;
};

function buildFingerprint(value: string): string {
  return createHash("sha1").update(value).digest("hex");
}

function compactWhitespace(text: string): string {
  return text.replace(/\s+/g, " ").trim();
}

async function loadMarketCache(statePath: string): Promise<MarketCache> {
  try {
    const raw = await fs.readFile(statePath, "utf8");
    const parsed = JSON.parse(raw) as Partial<MarketCache>;
    return {
      seen: typeof parsed.seen === "object" && parsed.seen ? parsed.seen : {},
      signals: Array.isArray(parsed.signals) ? parsed.signals : [],
      lastFetchMs: typeof parsed.lastFetchMs === "number" ? parsed.lastFetchMs : 0,
    };
  } catch {
    return { seen: {}, signals: [], lastFetchMs: 0 };
  }
}

async function saveMarketCache(statePath: string, cache: MarketCache): Promise<void> {
  await fs.mkdir(path.dirname(statePath), { recursive: true });
  await fs.writeFile(statePath, JSON.stringify(cache, null, 2), "utf8");
}

function scoreMarketSignal(text: string): number {
  const lower = text.toLowerCase();
  const highImpact = [
    "btc",
    "bitcoin",
    "eth",
    "ethereum",
    "fed",
    "rate",
    "inflation",
    "crash",
    "surge",
    "all-time",
    " ath ",
  ];
  const mediumImpact = ["crypto", "market", "trading", "price", "volatile", "wall street"];

  let score = 0.3;
  for (const term of highImpact) {
    if (lower.includes(term)) {
      score = Math.max(score, 0.7);
    }
  }
  for (const term of mediumImpact) {
    if (lower.includes(term)) {
      score = Math.max(score, 0.5);
    }
  }
  return Math.min(1, score);
}

export async function collectHeartbeatMarketEvents(params?: {
  nowMs?: number;
  stateDir?: string;
}): Promise<SystemEvent[]> {
  const nowMs = params?.nowMs ?? Date.now();
  const stateDir = params?.stateDir ?? resolveStateDir();
  const statePath = path.join(stateDir, MARKET_SIGNAL_CACHE_FILE);

  const cache = await loadMarketCache(statePath);

  if (nowMs - cache.lastFetchMs < MARKET_SIGNAL_INTERVAL_MS && cache.signals.length > 0) {
    return cache.signals.map((signal) => ({
      text: compactWhitespace(signal.text),
      ts: nowMs,
      contextKey: `market:${signal.fingerprint}`,
      trusted: true,
    }));
  }

  const events: SystemEvent[] = [];
  const nextSeen = { ...cache.seen };

  for (const signal of cache.signals) {
    const previous = nextSeen[signal.fingerprint] ?? 0;
    if (previous > 0 && nowMs - previous < MARKET_SIGNAL_INTERVAL_MS) {
      continue;
    }
    nextSeen[signal.fingerprint] = nowMs;
    events.push({
      text: compactWhitespace(signal.text),
      ts: nowMs,
      contextKey: `market:${signal.fingerprint}`,
      trusted: true,
    });
  }

  await saveMarketCache(statePath, {
    seen: nextSeen,
    signals: cache.signals,
    lastFetchMs: nowMs,
  });

  return events;
}

export function parseMarketSignals(rawSignals: string[]): MarketSignal[] {
  return rawSignals
    .slice(0, MAX_SIGNALS)
    .map((text) => {
      const key = `market:${buildFingerprint(text)}`;
      return {
        fingerprint: buildFingerprint(key),
        key,
        text,
        score: scoreMarketSignal(text),
      };
    })
    .filter((s) => s.score >= 0.3);
}
