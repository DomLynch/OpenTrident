import type { SessionEntry } from "../config/sessions/types.js";
import type { SystemEvent } from "./system-events.js";

export type HeartbeatAttentionSignal = {
  id: string;
  score: number;
  summary: string;
  evidence?: string[];
};

type HeartbeatAttentionSessionState = Pick<
  SessionEntry,
  "updatedAt" | "lastChannel" | "lastTo" | "lastHeartbeatText" | "lastHeartbeatSentAt"
>;

const PROJECT_KEYWORDS = [
  "repo", "project", "deploy", "deployment", "build", "release",
  "incident", "outage", "pr ", "pull request", "merge", "commit",
  "ship", "launch", "code", "bug", "fix",
];

const MARKET_KEYWORDS = [
  "market", "crypto", "bitcoin", "btc", "ethereum", "eth", "trade",
  "trading", "position", "token", "portfolio", "macro", "stocks", "price",
  "coingecko", "solana", "bnb", "ripple", "defi", "yield",
];

const DECISION_KEYWORDS = [
  "decide", "decision", "choose", "should", "approve", "review",
  "priority", "prioritize", "sign off", "yes or no", "go/no-go", "go no go",
];

const RELATIONSHIP_KEYWORDS = [
  "reply", "respond", "follow up", "follow-up", "intro", "introduction",
  "reach out", "check in", "check-in", "coffee", "meet", "meeting",
  "call", "text back", "message back", "follow through", "follow-through",
];

function clamp01(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.min(1, Math.max(0, value));
}

function compactWhitespace(text: string): string {
  return text.replace(/\s+/g, " ").trim();
}

function trimEvidence(text: string, maxChars = 140): string {
  const compact = compactWhitespace(text);
  if (compact.length <= maxChars) return compact;
  return `${compact.slice(0, Math.max(0, maxChars - 1)).trimEnd()}…`;
}

function formatAge(ageMs: number): string {
  const minutes = Math.max(0, Math.round(ageMs / 60_000));
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.round(minutes / 60);
  if (hours < 48) return `${hours}h`;
  return `${Math.round(hours / 24)}d`;
}

function normalizeEventText(text: string): string {
  return compactWhitespace(text).toLowerCase();
}

function hasKeyword(text: string, keywords: readonly string[]): boolean {
  const normalized = normalizeEventText(text);
  return keywords.some((keyword) => normalized.includes(keyword));
}

function oldestEventAgeMs(events: readonly SystemEvent[], nowMs: number): number {
  const oldestTs = events.reduce(
    (minTs, event) => Math.min(minTs, typeof event.ts === "number" ? event.ts : nowMs),
    nowMs,
  );
  return Math.max(0, nowMs - oldestTs);
}

function buildEventPressureSignal(params: {
  id: string;
  nowMs: number;
  events: readonly SystemEvent[];
  baseScore: number;
  summary: (ageMs: number, count: number) => string;
}): HeartbeatAttentionSignal | null {
  const events = params.events;
  if (events.length === 0) return null;
  const ageMs = oldestEventAgeMs(events, params.nowMs);
  const agePressure = clamp01(Math.min(0.24, ageMs / (12 * 60 * 60 * 1000) / 3.5));
  const countPressure = clamp01(Math.min(0.24, events.length * 0.08));
  return {
    id: params.id,
    score: clamp01(params.baseScore + agePressure + countPressure),
    summary: params.summary(ageMs, events.length),
    evidence: events.slice(0, 3).map((event) => trimEvidence(event.text)),
  };
}

export function resolveHeartbeatAttention(params: {
  nowMs: number;
  entry?: HeartbeatAttentionSessionState;
  pendingEvents?: readonly SystemEvent[];
}): HeartbeatAttentionSignal[] {
  const attention: HeartbeatAttentionSignal[] = [];
  const pendingEvents = Array.isArray(params.pendingEvents) ? params.pendingEvents : [];

  if (pendingEvents.length > 0) {
    const oldestAgeMs = oldestEventAgeMs(pendingEvents, params.nowMs);
    const eventPressure = clamp01(0.55 + Math.min(0.25, pendingEvents.length * 0.08));
    const agePressure = clamp01(Math.min(0.2, oldestAgeMs / (6 * 60 * 60 * 1000) / 5));
    attention.push({
      id: "pending_signals",
      score: clamp01(eventPressure + agePressure),
      summary: `${pendingEvents.length} pending signal${pendingEvents.length === 1 ? "" : "s"} waiting for judgment`,
      evidence: pendingEvents.slice(0, 3).map((event) => trimEvidence(event.text)),
    });
  }

  const updatedAt =
    typeof params.entry?.updatedAt === "number" ? params.entry.updatedAt : undefined;
  const lastChannel = params.entry?.lastChannel?.trim();
  const lastTo = params.entry?.lastTo?.trim();
  if (updatedAt && lastChannel && lastTo) {
    const ageMs = Math.max(0, params.nowMs - updatedAt);
    if (ageMs >= 6 * 60 * 60 * 1000) {
      const score = clamp01(0.28 + Math.min(0.62, ageMs / (72 * 60 * 60 * 1000)));
      attention.push({
        id: "relationship_drift",
        score,
        summary: `No recent interaction on ${lastChannel} with ${lastTo} for ${formatAge(ageMs)}`,
      });
    }
  }

  const projectEvents = pendingEvents.filter((event) =>
    hasKeyword(event.text, PROJECT_KEYWORDS),
  );
  const marketEvents = pendingEvents.filter((event) =>
    hasKeyword(event.text, MARKET_KEYWORDS),
  );
  const relationshipEvents = pendingEvents.filter((event) =>
    hasKeyword(event.text, RELATIONSHIP_KEYWORDS),
  );
  const decisionEvents = pendingEvents.filter((event) => {
    const normalized = normalizeEventText(event.text);
    return normalized.includes("?") || hasKeyword(normalized, DECISION_KEYWORDS);
  });

  const projectSignal = buildEventPressureSignal({
    id: "project_stale",
    nowMs: params.nowMs,
    events: projectEvents,
    baseScore: 0.32,
    summary: (ageMs, count) =>
      `${count} project signal${count === 1 ? "" : "s"} unreviewed; oldest ${formatAge(ageMs)}`,
  });
  if (projectSignal) attention.push(projectSignal);

  const marketSignal = buildEventPressureSignal({
    id: "market_unreviewed",
    nowMs: params.nowMs,
    events: marketEvents,
    baseScore: 0.34,
    summary: (ageMs, count) =>
      `${count} market signal${count === 1 ? "" : "s"} unreviewed; oldest ${formatAge(ageMs)}`,
  });
  if (marketSignal) attention.push(marketSignal);

  const decisionSignal = buildEventPressureSignal({
    id: "decision_backlog",
    nowMs: params.nowMs,
    events: decisionEvents,
    baseScore: 0.38,
    summary: (ageMs, count) =>
      `${count} decision prompt${count === 1 ? "" : "s"} unresolved; oldest ${formatAge(ageMs)}`,
  });
  if (decisionSignal) attention.push(decisionSignal);

  const relationshipSignal = buildEventPressureSignal({
    id: "relationship_followthrough",
    nowMs: params.nowMs,
    events: relationshipEvents,
    baseScore: 0.33,
    summary: (ageMs, count) =>
      `${count} relationship follow-through signal${count === 1 ? "" : "s"} pending; oldest ${formatAge(ageMs)}`,
  });
  if (relationshipSignal) attention.push(relationshipSignal);

  const lastHeartbeatText =
    typeof params.entry?.lastHeartbeatText === "string"
      ? compactWhitespace(params.entry.lastHeartbeatText)
      : "";
  const lastHeartbeatSentAt =
    typeof params.entry?.lastHeartbeatSentAt === "number"
      ? params.entry.lastHeartbeatSentAt
      : undefined;

  if (updatedAt && lastHeartbeatSentAt && lastHeartbeatText) {
    const idleAgeMs = Math.max(0, params.nowMs - updatedAt);
    const surfacedAgeMs = Math.max(0, params.nowMs - lastHeartbeatSentAt);

    if (
      !projectSignal &&
      idleAgeMs >= 18 * 60 * 60 * 1000 &&
      surfacedAgeMs >= 12 * 60 * 60 * 1000 &&
      hasKeyword(lastHeartbeatText, PROJECT_KEYWORDS)
    ) {
      attention.push({
        id: "project_stale",
        score: clamp01(0.31 + Math.min(0.34, idleAgeMs / (72 * 60 * 60 * 1000))),
        summary: `Project lane has been quiet for ${formatAge(idleAgeMs)} since the last surfaced item`,
        evidence: [trimEvidence(lastHeartbeatText, 180)],
      });
    }

    if (
      !marketSignal &&
      surfacedAgeMs >= 12 * 60 * 60 * 1000 &&
      hasKeyword(lastHeartbeatText, MARKET_KEYWORDS)
    ) {
      attention.push({
        id: "market_unreviewed",
        score: clamp01(0.29 + Math.min(0.32, surfacedAgeMs / (48 * 60 * 60 * 1000))),
        summary: `Market context has gone unreviewed for ${formatAge(surfacedAgeMs)}`,
        evidence: [trimEvidence(lastHeartbeatText, 180)],
      });
    }

    if (
      !relationshipSignal &&
      idleAgeMs >= 24 * 60 * 60 * 1000 &&
      hasKeyword(lastHeartbeatText, RELATIONSHIP_KEYWORDS)
    ) {
      attention.push({
        id: "relationship_followthrough",
        score: clamp01(0.3 + Math.min(0.28, idleAgeMs / (96 * 60 * 60 * 1000))),
        summary: `A follow-through thread has been idle for ${formatAge(idleAgeMs)}`,
        evidence: [trimEvidence(lastHeartbeatText, 180)],
      });
    }
  }

  return attention.toSorted((left, right) => right.score - left.score);
}

export function buildHeartbeatAttentionPrompt(params: {
  basePrompt: string;
  nowMs: number;
  entry?: HeartbeatAttentionSessionState;
  pendingEvents?: readonly SystemEvent[];
}): string {
  const attention = resolveHeartbeatAttention(params);
  const lines: string[] = [
    "Decide whether anything genuinely needs attention right now.",
    "Use current signals, recalled memory, and your judgment. Do not run a fixed checklist.",
    "",
    "Current attention pressures:",
  ];

  if (attention.length === 0) {
    lines.push("- none above threshold");
  } else {
    for (const signal of attention) {
      lines.push(`- ${signal.id} | score=${signal.score.toFixed(2)} | ${signal.summary}`);
      for (const evidence of signal.evidence ?? []) {
        lines.push(`  evidence: ${evidence}`);
      }
    }
  }

  const lastHeartbeatText =
    typeof params.entry?.lastHeartbeatText === "string"
      ? compactWhitespace(params.entry.lastHeartbeatText)
      : "";
  const lastHeartbeatSentAt =
    typeof params.entry?.lastHeartbeatSentAt === "number"
      ? params.entry.lastHeartbeatSentAt
      : undefined;
  if (lastHeartbeatText && lastHeartbeatSentAt) {
    lines.push(
      "",
      `Most recent surfaced item (${formatAge(Math.max(0, params.nowMs - lastHeartbeatSentAt))} ago): ${trimEvidence(lastHeartbeatText, 220)}`,
    );
  }

  lines.push(
    "",
    "Rules:",
    "- Surface only the single highest-leverage item if something materially matters.",
    "- If nothing materially changed, reply HEARTBEAT_OK.",
    "- Do not repeat the previous heartbeat unless the underlying state changed.",
    "",
    `Base heartbeat instruction: ${params.basePrompt}`,
  );

  return lines.join("\n");
}
