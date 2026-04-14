import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { recordActionOutcome, getTrustMetrics, buildTrustScorecard } from "./trust-telemetry.js";

const TEST_STATE_DIR = "/tmp/opentrident-test-state";

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

describe("recordActionOutcome", () => {
  it("records first approved action correctly", async () => {
    await recordActionOutcome({
      actionClass: "draft_reply",
      domain: "relationship",
      source: "planner_spawn",
      outcome: "approved",
      stateDir: TEST_STATE_DIR,
    });
    const metrics = await getTrustMetrics(TEST_STATE_DIR);
    expect(metrics.totalActions).toBe(1);
    expect(metrics.approvedActions).toBe(1);
    expect(metrics.rejectedActions).toBe(0);
    expect(metrics.modifiedActions).toBe(0);
  });

  it("accumulates by domain correctly", async () => {
    await recordActionOutcome({
      actionClass: "draft_reply", domain: "relationship", source: "src1", outcome: "approved", stateDir: TEST_STATE_DIR,
    });
    await recordActionOutcome({
      actionClass: "draft_reply", domain: "relationship", source: "src2", outcome: "rejected", stateDir: TEST_STATE_DIR,
    });
    await recordActionOutcome({
      actionClass: "draft_reply", domain: "market", source: "src3", outcome: "approved", stateDir: TEST_STATE_DIR,
    });
    const metrics = await getTrustMetrics(TEST_STATE_DIR);
    expect(metrics.totalActions).toBe(3);
    expect(metrics.approvedActions).toBe(2);
    expect(metrics.rejectedActions).toBe(1);
    expect(metrics.byDomain.relationship?.total).toBe(2);
    expect(metrics.byDomain.relationship?.approved).toBe(1);
    expect(metrics.byDomain.relationship?.rejected).toBe(1);
    expect(metrics.byDomain.market?.approved).toBe(1);
  });

  it("accumulates by source correctly", async () => {
    await recordActionOutcome({
      actionClass: "brief", domain: "market", source: "github", outcome: "approved", stateDir: TEST_STATE_DIR,
    });
    await recordActionOutcome({
      actionClass: "brief", domain: "market", source: "github", outcome: "approved", stateDir: TEST_STATE_DIR,
    });
    await recordActionOutcome({
      actionClass: "brief", domain: "market", source: "gmail", outcome: "rejected", stateDir: TEST_STATE_DIR,
    });
    const metrics = await getTrustMetrics(TEST_STATE_DIR);
    expect(metrics.bySource.github?.total).toBe(2);
    expect(metrics.bySource.gmail?.total).toBe(1);
  });

  it("handles modified outcome", async () => {
    await recordActionOutcome({
      actionClass: "send_reply", domain: "general", source: "planner", outcome: "modified", stateDir: TEST_STATE_DIR,
    });
    const metrics = await getTrustMetrics(TEST_STATE_DIR);
    expect(metrics.modifiedActions).toBe(1);
    expect(metrics.totalActions).toBe(1);
  });

  it("maintains daily trend for multiple days", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-04-14T12:00:00Z"));
    await recordActionOutcome({
      actionClass: "draft_reply", domain: "general", source: "s1", outcome: "approved", stateDir: TEST_STATE_DIR,
    });
    vi.setSystemTime(new Date("2026-04-13T12:00:00Z"));
    await recordActionOutcome({
      actionClass: "draft_reply", domain: "general", source: "s2", outcome: "rejected", stateDir: TEST_STATE_DIR,
    });
    vi.useRealTimers();
    const metrics = await getTrustMetrics(TEST_STATE_DIR);
    expect(metrics.dailyTrend.length).toBeGreaterThanOrEqual(2);
  });
});

describe("getTrustMetrics", () => {
  it("returns empty metrics when no file exists", async () => {
    const metrics = await getTrustMetrics("/tmp/nonexistent-dir");
    expect(metrics.totalActions).toBe(0);
    expect(metrics.approvedActions).toBe(0);
    expect(metrics.dailyTrend).toEqual([]);
  });
});

describe("buildTrustScorecard", () => {
  it("formats empty metrics correctly", () => {
    const scorecard = buildTrustScorecard({
      totalActions: 0, approvedActions: 0, rejectedActions: 0, modifiedActions: 0,
      byDomain: {}, bySource: {}, dailyTrend: [], lastUpdated: Date.now(),
    });
    expect(scorecard).toContain("0%");
    expect(scorecard).toContain("Trust Telemetry");
  });

  it("shows approval rate with 1 decimal", () => {
    const scorecard = buildTrustScorecard({
      totalActions: 3, approvedActions: 1, rejectedActions: 2, modifiedActions: 0,
      byDomain: {}, bySource: {}, dailyTrend: [], lastUpdated: Date.now(),
    });
    expect(scorecard).toContain("33.3%");
  });

  it("shows per-domain breakdown when domains present", () => {
    const scorecard = buildTrustScorecard({
      totalActions: 2, approvedActions: 1, rejectedActions: 1, modifiedActions: 0,
      byDomain: { market: { total: 2, approved: 1, rejected: 1, modified: 0 } },
      bySource: {}, dailyTrend: [], lastUpdated: Date.now(),
    });
    expect(scorecard).toContain("market");
    expect(scorecard).toContain("50%");
  });
});
