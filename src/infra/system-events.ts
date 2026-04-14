export type SystemEvent = {
  text: string;
  ts: number;
  contextKey?: string;
  trusted?: boolean;
};

export function isCronSystemEvent(text: string): boolean {
  return text.startsWith("cron:");
}
