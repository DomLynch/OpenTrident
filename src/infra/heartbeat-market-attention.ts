import { createHash } from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import { resolveStateDir } from "../config/paths.js";
import { loadWatchlist, scoreWithWatchlist, type WatchlistEntry } from "../config/market-watchlist.js";
import type { SystemEvent } from "./system-events.js";

const MARKET_SIGNAL_CACHE_FILE = "market-attention-v1.json";
const MARKET_SIGNAL_INTERVAL_MS = 15 * 60 * 1000;
const MARKET_CIRCUIT_BREAKER_MS = 5 * 60 * 1000;
const MAX_SIGNALS = 30;
const MAX_PRICE_ALERTS = 10;

const COINGECKO_SIMPLE_PRICE_URL =
  "https://api.coingecko.com/api/v3/simple/price?ids=bitcoin,ethereum,solana,BNB,XRP,cardano,dogecoin,polkadot,avalanche-2,chainlink&vs_currencies=usd&include_24hr_change=true";
const HN_ALGOLIA_SEARCH_URL = "https://hn.algolia.com/api/v1/search?tags=front_page&hitsPerPage=20";

const CRYPTO_COMPARE_NEWS_URL = "https://min-api.cryptocompare.com/data/v2/news/?lang=EN";

const DEFAULT_RSS_FEEDS = [
  "https://cointelegraph.com/rss",
  "https://www.theblock.co/rss.xml",
];

export type MarketSignal = {
  fingerprint: string;
  key: string;
  text: string;
  score: number;
  source: "coingecko" | "hackernews" | "rss" | "news";
};

type MarketCache = {
  seen: Record<string, number>;
  signals: MarketSignal[];
  lastFetchMs: number;
  consecutiveFailures: number;
  circuitOpenedAtMs: number;
  priceLastFetchMs: number;
  cachedPrices: Record<string, { price: number; change24h: number }>;
};

function buildFingerprint(value: string): string {
  return createHash("sha1").update(value).digest("hex");
}

function compactWhitespace(text: string): string {
  return text.replace(/\s+/g, " ").trim();
}

function stripHtmlTags(html: string): string {
  return html.replace(/<[^>]*>/g, " ").replace(/\s+/g, " ").trim();
}

async function loadMarketCache(statePath: string): Promise<MarketCache> {
  try {
    const raw = await fs.readFile(statePath, "utf8");
    const parsed = JSON.parse(raw) as Partial<MarketCache>;
    return {
      seen: typeof parsed.seen === "object" && parsed.seen ? parsed.seen : {},
      signals: Array.isArray(parsed.signals) ? parsed.signals : [],
      lastFetchMs: typeof parsed.lastFetchMs === "number" ? parsed.lastFetchMs : 0,
      consecutiveFailures:
        typeof parsed.consecutiveFailures === "number" ? parsed.consecutiveFailures : 0,
      circuitOpenedAtMs:
        typeof parsed.circuitOpenedAtMs === "number" ? parsed.circuitOpenedAtMs : 0,
      priceLastFetchMs: typeof parsed.priceLastFetchMs === "number" ? parsed.priceLastFetchMs : 0,
      cachedPrices: typeof parsed.cachedPrices === "object" && parsed.cachedPrices
        ? parsed.cachedPrices
        : {},
    };
  } catch {
    return {
      seen: {},
      signals: [],
      lastFetchMs: 0,
      consecutiveFailures: 0,
      circuitOpenedAtMs: 0,
      priceLastFetchMs: 0,
      cachedPrices: {},
    };
  }
}

async function saveMarketCache(statePath: string, cache: MarketCache): Promise<void> {
  await fs.mkdir(path.dirname(statePath), { recursive: true });
  await fs.writeFile(statePath, JSON.stringify(cache, null, 2), "utf8");
}

function parseMarketSignals(
  rawSignals: Array<{ text: string; source: MarketSignal["source"] }>,
  watchlist: WatchlistEntry[],
): MarketSignal[] {
  return rawSignals
    .slice(0, MAX_SIGNALS)
    .map(({ text, source }) => {
      const key = `market:${buildFingerprint(text)}`;
      return {
        fingerprint: buildFingerprint(key),
        key,
        text: compactWhitespace(text),
        score: scoreWithWatchlist(text, watchlist),
        source,
      };
    })
    .filter((s) => s.score >= 0.3);
}

async function fetchWithTimeout(url: string, timeoutMs = 8000): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(url, {
      signal: controller.signal,
      headers: { "User-Agent": "OpenTrident/1.0 (market signals)" },
    });
    clearTimeout(timer);
    return response;
  } catch {
    clearTimeout(timer);
    throw new Error(`fetch failed: ${url}`);
  }
}

async function fetchCoinGeckoPrices(): Promise<string[]> {
  const signals: string[] = [];
  try {
    const response = await fetchWithTimeout(COINGECKO_SIMPLE_PRICE_URL, 8000);
    if (!response.ok) throw new Error(`CoinGecko ${response.status}`);
    const data = (await response.json()) as Record<
      string,
      { usd?: number; usd_24h_change?: number }
    >;
    for (const [coin, info] of Object.entries(data)) {
      const price = info.usd ?? 0;
      const change = info.usd_24h_change ?? 0;
      signals.push(
        `${coin.toUpperCase()} @ $${price.toLocaleString()} (${change >= 0 ? "+" : ""}${change.toFixed(2)}% 24h)`,
      );
    }
  } catch {
    // CoinGecko fetch failed, continue with other sources
  }
  return signals;
}

async function fetchHackerNews(watchlist: WatchlistEntry[]): Promise<string[]> {
  const signals: string[] = [];
  try {
    const response = await fetchWithTimeout(HN_ALGOLIA_SEARCH_URL, 8000);
    if (!response.ok) throw new Error(`HN ${response.status}`);
    const data = (await response.json()) as {
      hits?: Array<{ title?: string; url?: string; _tags?: string[] }>;
    };
    if (!data.hits) return signals;
    for (const hit of data.hits.slice(0, 10)) {
      const title = hit.title ?? "";
      const url = hit.url ?? "";
      if (!title) continue;
      if (
        scoreWithWatchlist(title, watchlist) >= 0.3 ||
        /(bitcoin|ethereum|crypto|defi|token|trading|chain|blockchain|nft|web3)/i.test(
          title + " " + url,
        )
      ) {
        signals.push(`[HN] ${title} — ${url}`);
      }
    }
  } catch {
    // HN fetch failed
  }
  return signals;
}

async function fetchRSSFeed(feedUrl: string, watchlist: WatchlistEntry[]): Promise<string[]> {
  const signals: string[] = [];
  try {
    const response = await fetchWithTimeout(feedUrl, 10000);
    if (!response.ok) throw new Error(`RSS ${response.status}`);
    const xml = await response.text();
    const text = stripHtmlTags(xml);
    const items = text.split(/\.\s+/).filter(
      (s) =>
        s.length > 20 &&
        s.length < 300 &&
        (/(bitcoin|ethereum|crypto|market|trading|defi|token|chain)/i.test(s) ||
          scoreWithWatchlist(s, watchlist) >= 0.4),
    );
    signals.push(...items.slice(0, 5).map((s) => `[RSS] ${s.trim()}`));
  } catch {
    // RSS fetch failed
  }
  return signals;
}

async function fetchCryptoNews(): Promise<string[]> {
  try {
    const response = await fetchWithTimeout(CRYPTO_COMPARE_NEWS_URL, 8000);
    if (!response.ok) return [];
    const data = (await response.json()) as {
      Data?: Array<{ title?: string; body?: string }>;
    };
    if (!data.Data) return [];
    return data.Data.slice(0, MAX_SIGNALS)
      .map((item) => item.title ?? item.body ?? "")
      .filter((t) => t.length > 10);
  } catch {
    return [];
  }
}

export async function collectHeartbeatMarketEvents(params?: {
  nowMs?: number;
  stateDir?: string;
}): Promise<SystemEvent[]> {
  const nowMs = params?.nowMs ?? Date.now();
  const stateDir = params?.stateDir ?? resolveStateDir();
  const statePath = path.join(stateDir, MARKET_SIGNAL_CACHE_FILE);

  const [cache, watchlistConfig] = await Promise.all([
    loadMarketCache(statePath),
    loadWatchlist(stateDir),
  ]);

  if (
    cache.circuitOpenedAtMs > 0 &&
    nowMs - cache.circuitOpenedAtMs < MARKET_CIRCUIT_BREAKER_MS
  ) {
    const events: SystemEvent[] = [];
    for (const signal of cache.signals) {
      const previous = cache.seen[signal.fingerprint] ?? 0;
      if (previous > 0 && nowMs - previous < MARKET_SIGNAL_INTERVAL_MS) continue;
      events.push({
        text: signal.text,
        ts: nowMs,
        contextKey: `market:${signal.fingerprint}`,
        trusted: true,
      });
    }
    return events;
  }

  const needsFullFetch = nowMs - cache.lastFetchMs >= MARKET_SIGNAL_INTERVAL_MS;
  const needsPriceUpdate = nowMs - cache.priceLastFetchMs >= 5 * 60 * 1000;

  const rawSignals: Array<{ text: string; source: MarketSignal["source"] }> = [];

  if (needsFullFetch) {
    const [hnSignals, newsSignals, ...rssResults] = await Promise.all([
      fetchHackerNews(watchlistConfig.entries),
      fetchCryptoNews(),
      ...DEFAULT_RSS_FEEDS.map((url) => fetchRSSFeed(url, watchlistConfig.entries)),
    ]);

    rawSignals.push(...hnSignals.map((t) => ({ text: t, source: "hackernews" as const })));
    rawSignals.push(...newsSignals.map((t) => ({ text: t, source: "news" as const })));
    for (const rss of rssResults) {
      rawSignals.push(...rss.map((t) => ({ text: t, source: "rss" as const })));
    }
  }

  if (needsPriceUpdate) {
    const priceSignals = await fetchCoinGeckoPrices();
    rawSignals.push(...priceSignals.map((t) => ({ text: t, source: "coingecko" as const })));
  }

  if (rawSignals.length === 0) {
    const events: SystemEvent[] = [];
    for (const signal of cache.signals) {
      const previous = cache.seen[signal.fingerprint] ?? 0;
      if (previous > 0 && nowMs - previous < MARKET_SIGNAL_INTERVAL_MS) continue;
      events.push({
        text: signal.text,
        ts: nowMs,
        contextKey: `market:${signal.fingerprint}`,
        trusted: true,
      });
    }
    return events;
  }

  const newSignals = parseMarketSignals(rawSignals, watchlistConfig.entries);

  const mergedSignals = [...newSignals];
  for (const existing of cache.signals) {
    if (!mergedSignals.some((s) => s.fingerprint === existing.fingerprint)) {
      mergedSignals.push(existing);
    }
  }

  const nextSeen = { ...cache.seen };
  const events: SystemEvent[] = [];

  for (const signal of mergedSignals.slice(0, MAX_SIGNALS)) {
    const previous = nextSeen[signal.fingerprint] >= 0;
    if (previous > 0 && nowMs - previous < MARKET_SIGNAL_INTERVAL_MS) continue;
    nextSeen[signal.fingerprint] = nowMs;
    events.push({
      text: signal.text,
      ts: nowMs,
      contextKey: `market:${signal.fingerprint}`,
      trusted: true,
    });
  }

  let consecutiveFailures = cache.consecutiveFailures;
  if (rawSignals.length === 0) {
    consecutiveFailures++;
    if (consecutiveFailures >= 3) {
      cache.circuitOpenedAtMs = nowMs;
    }
  } else {
    consecutiveFailures = 0;
    cache.circuitOpenedAtMs = 0;
  }

  await saveMarketCache(statePath, {
    seen: nextSeen,
    signals: mergedSignals.slice(0, MAX_SIGNALS),
    lastFetchMs: needsFullFetch ? nowMs : cache.lastFetchMs,
    consecutiveFailures,
    circuitOpenedAtMs: cache.circuitOpenedAtMs,
    priceLastFetchMs: needsPriceUpdate ? nowMs : cache.priceLastFetchMs,
    cachedPrices: cache.cachedPrices,
  });

  return events;
}

export function parseMarketSignalsForTest(
  rawSignals: string[],
  watchlist?: WatchlistEntry[],
): MarketSignal[] {
  return parseMarketSignals(
    rawSignals.map((text) => ({ text, source: "news" as const })),
    watchlist ?? [],
  );
}
