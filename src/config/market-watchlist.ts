import fs from "node:fs/promises";
import path from "node:path";
import { resolveStateDir } from "./paths.js";

const WATCHLIST_FILE = "market-watchlist-v1.json";

export type WatchlistEntry = {
  keyword: string;
  weight: number;
  domain: "market" | "project" | "general";
};

export type WatchlistConfig = {
  version: number;
  entries: WatchlistEntry[];
  updatedAt: number;
};

const DEFAULT_WATCHLIST: WatchlistEntry[] = [
  { keyword: "ai agent", weight: 0.9, domain: "market" },
  { keyword: "autonomous ai", weight: 0.9, domain: "market" },
  { keyword: "digital twin", weight: 0.85, domain: "market" },
  { keyword: "bitcoin", weight: 0.8, domain: "market" },
  { keyword: "ethereum", weight: 0.8, domain: "market" },
  { keyword: "solana", weight: 0.75, domain: "market" },
  { keyword: "bnb", weight: 0.7, domain: "market" },
  { keyword: "ripple", weight: 0.7, domain: "market" },
  { keyword: "cardano", weight: 0.7, domain: "market" },
  { keyword: "dogecoin", weight: 0.65, domain: "market" },
  { keyword: "polkadot", weight: 0.7, domain: "market" },
  { keyword: "avalanche", weight: 0.7, domain: "market" },
  { keyword: "chainlink", weight: 0.75, domain: "market" },
  { keyword: "defi", weight: 0.75, domain: "market" },
  { keyword: "yield farming", weight: 0.7, domain: "market" },
  { keyword: "layer 2", weight: 0.75, domain: "market" },
  { keyword: "rollup", weight: 0.7, domain: "market" },
  { keyword: "ordinal", weight: 0.65, domain: "market" },
  { keyword: "openclaw", weight: 0.9, domain: "project" },
  { keyword: "openai", weight: 0.75, domain: "market" },
  { keyword: "anthropic", weight: 0.75, domain: "market" },
  { keyword: "claude", weight: 0.7, domain: "market" },
  { keyword: "crypto regulation", weight: 0.7, domain: "market" },
  { keyword: "sec etf", weight: 0.8, domain: "market" },
  { keyword: "fed rate", weight: 0.8, domain: "market" },
  { keyword: "inflation", weight: 0.7, domain: "market" },
  { keyword: "blackrock", weight: 0.75, domain: "market" },
  { keyword: "institutional adoption", weight: 0.75, domain: "market" },
  { keyword: "crash", weight: 0.7, domain: "market" },
  { keyword: "surge", weight: 0.6, domain: "market" },
];

export function getDefaultWatchlist(): WatchlistEntry[] {
  return [...DEFAULT_WATCHLIST];
}

export async function loadWatchlist(stateDir?: string): Promise<WatchlistConfig> {
  const dir = stateDir ?? resolveStateDir();
  const filePath = path.join(dir, WATCHLIST_FILE);
  try {
    const raw = await fs.readFile(filePath, "utf8");
    const parsed = JSON.parse(raw) as Partial<WatchlistConfig>;
    if (parsed.version && Array.isArray(parsed.entries)) {
      return {
        version: parsed.version,
        entries: parsed.entries,
        updatedAt: parsed.updatedAt ?? Date.now(),
      };
    }
  } catch {}
  return {
    version: 1,
    entries: getDefaultWatchlist(),
    updatedAt: Date.now(),
  };
}

export async function saveWatchlist(
  entries: WatchlistEntry[],
  stateDir?: string,
): Promise<void> {
  const dir = stateDir ?? resolveStateDir();
  const filePath = path.join(dir, WATCHLIST_FILE);
  await fs.mkdir(dir, { recursive: true });
  const config: WatchlistConfig = {
    version: 1,
    entries,
    updatedAt: Date.now(),
  };
  await fs.writeFile(filePath, JSON.stringify(config, null, 2), "utf8");
}

export async function updateWatchlistEntry(
  keyword: string,
  weight: number | null,
  domain: WatchlistEntry["domain"] | null,
  stateDir?: string,
): Promise<WatchlistConfig> {
  const config = await loadWatchlist(stateDir);
  const existing = config.entries.findIndex(
    (e) => e.keyword.toLowerCase() === keyword.toLowerCase(),
  );
  if (existing >= 0) {
    if (weight !== null) config.entries[existing].weight = weight;
    if (domain !== null) config.entries[existing].domain = domain;
  } else {
    config.entries.push({
      keyword,
      weight: weight ?? 0.5,
      domain: domain ?? "market",
    });
  }
  config.updatedAt = Date.now();
  await saveWatchlist(config.entries, stateDir);
  return config;
}

export function scoreWithWatchlist(
  text: string,
  watchlist: WatchlistEntry[],
): number {
  const lower = text.toLowerCase();
  let maxWeight = 0.3;
  for (const entry of watchlist) {
    if (lower.includes(entry.keyword.toLowerCase())) {
      maxWeight = Math.max(maxWeight, entry.weight);
    }
  }
  return Math.min(1, maxWeight);
}
