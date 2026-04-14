import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { parseMarketSignals, scoreMarketSignal } from "./heartbeat-market-attention.js";

const TEST_STATE_DIR = "/tmp/opentrident-market-test";

async function cleanup() {
  const { rm } = await import("node:fs/promises");
  try {
    await rm(TEST_STATE_DIR, { recursive: true, force: true });
  } catch {}
}

beforeEach(async () => {
  await cleanup();
  vi.resetModules();
});

afterEach(async () => {
  await cleanup();
});

describe("scoreMarketSignal", () => {
  it("returns 0.3 baseline for plain text", () => {
    expect(scoreMarketSignal("hello world")).toBe(0.3);
  });

  it("returns 0.7 for high-impact keywords", () => {
    expect(scoreMarketSignal("Bitcoin just hit a new all-time high")).toBe(0.7);
    expect(scoreMarketSignal("Fed announces rate decision")).toBe(0.7);
    expect(scoreMarketSignal("Ethereum ETF approved by SEC")).toBe(0.7);
    expect(scoreMarketSignal("Crypto market crash")).toBe(0.7);
  });

  it("returns 0.5 for medium-impact keywords", () => {
    expect(scoreMarketSignal("Crypto trading volume surge")).toBe(0.5);
    expect(scoreMarketSignal("Market volatility alert")).toBe(0.5);
  });

  it("high-impact overrides medium-impact", () => {
    expect(scoreMarketSignal("Bitcoin crypto trading")).toBe(0.7);
  });

  it("max score is 1.0", () => {
    expect(scoreMarketSignal("BTC ETH Fed rate inflation crash surge")).toBeLessThanOrEqual(1);
  });
});

describe("parseMarketSignals", () => {
  it("returns empty array for empty input", () => {
    expect(parseMarketSignals([])).toEqual([]);
  });

  it("filters signals below 0.3 score", () => {
    const signals = [
      "hello world",  // 0.3 - borderline
      "Bitcoin ETF news", // 0.7 - included
    ];
    const result = parseMarketSignals(signals);
    expect(result.length).toBeGreaterThanOrEqual(1);
  });

  it("limits to MAX_SIGNALS (20)", () => {
    const signals = Array.from({ length: 30 }, (_, i) => \`Bitcoin news \${i}\`);
    const result = parseMarketSignals(signals);
    expect(result.length).toBeLessThanOrEqual(20);
  });

  it("assigns unique fingerprints to each signal", () => {
    const signals = ["Bitcoin news", "Ethereum news", "DeFi update"];
    const result = parseMarketSignals(signals);
    const fingerprints = result.map((s) => s.fingerprint);
    const unique = new Set(fingerprints);
    expect(unique.size).toBe(signals.length);
  });

  it("includes score and text in output", () => {
    const result = parseMarketSignals(["Bitcoin hits all-time high"]);
    expect(result[0]).toHaveProperty("fingerprint");
    expect(result[0]).toHaveProperty("key");
    expect(result[0]).toHaveProperty("text");
    expect(result[0]).toHaveProperty("score");
    expect(result[0].score).toBe(0.7);
  });
});
