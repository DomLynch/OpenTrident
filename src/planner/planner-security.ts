const MAX_EVIDENCE_LENGTH = 4000;
const MAX_EVIDENCE_ITEMS = 20;
const MAX_SESSION_SPAWNS_PER_HOUR = 10;
const EVIDENCE_INJECTION_RE = /[\x00-\x08\x0B\x0C\x0E-\x1F]/;

export function sanitizeEvidenceItem(item: string): string {
  let cleaned = item.replace(EVIDENCE_INJECTION_RE, "");
  if (cleaned.length > MAX_EVIDENCE_LENGTH) {
    cleaned = cleaned.slice(0, MAX_EVIDENCE_LENGTH);
  }
  return cleaned;
}

export function sanitizeEvidence(items: string[]): string[] {
  return items.slice(0, MAX_EVIDENCE_ITEMS).map(sanitizeEvidenceItem);
}

export function validatePlannerDomain(domain: string): domain is string {
  const valid = ["general", "relationship", "project", "market", "decision"];
  return valid.includes(domain);
}

export function validateActionClass(actionClass: string): actionClass is string {
  const valid = ["surface_only", "spawn_readonly", "draft_reply", "draft_issue", "brief", "send_reply"];
  return valid.includes(actionClass);
}

export function countRecentSpawns(rows: readonly { updatedAt: number }[], nowMs: number): number {
  const oneHourAgo = nowMs - 60 * 60 * 1000;
  return rows.filter((r) => r.updatedAt > oneHourAgo).length;
}

export function isSpawnRateLimited(
  rows: readonly { updatedAt: number }[],
  nowMs: number,
): boolean {
  return countRecentSpawns(rows, nowMs) >= MAX_SESSION_SPAWNS_PER_HOUR;
}