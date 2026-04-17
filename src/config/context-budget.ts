export const CONTEXT_BUDGET = {
  doctrine: 2000,
  playbooks: 3000,
  similarSessions: 2000,
  trustContext: 500,
  totalCeiling: 20000,
} as const;

const TRUNCATION_MARKER = "\n... [truncated]";

export function truncateToBudget(text: string, max: number): string {
  if (text.length <= max) {
    return text;
  }
  return `${text.slice(0, Math.max(0, max - TRUNCATION_MARKER.length)).trimEnd()}${TRUNCATION_MARKER}`;
}
