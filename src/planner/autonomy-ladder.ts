import fs from "node:fs/promises";
import path from "node:path";
import type { PlannerDomain } from "./types.js";

export type AutonomyLevel =
  | "read_only"
  | "draft_only"
  | "act_with_confirmation"
  | "act_autonomously";

export type DomainAutonomyConfig = {
  [domain in PlannerDomain]?: AutonomyLevel;
};

const AUTONOMY_CONFIG_FILE = "autonomy-config-v1.json";

const DEFAULT_AUTONOMY: DomainAutonomyConfig = {
  general: "draft_only",
  relationship: "act_with_confirmation",
  project: "draft_only",
  market: "act_with_confirmation",
  decision: "act_with_confirmation",
};

const LEVEL_ORDER: AutonomyLevel[] = [
  "read_only",
  "draft_only",
  "act_with_confirmation",
  "act_autonomously",
];

export function getAutonomyLevel(
  domain: PlannerDomain,
  config?: DomainAutonomyConfig,
): AutonomyLevel {
  return config?.[domain] ?? DEFAULT_AUTONOMY[domain] ?? "draft_only";
}

export function canActAutonomously(
  domain: PlannerDomain,
  actionClass: string,
  config?: DomainAutonomyConfig,
): boolean {
  const level = getAutonomyLevel(domain, config);
  if (level === "act_autonomously") return true;
  if (level === "act_with_confirmation" && actionClass === "draft_reply") return true;
  if (level === "draft_only" && actionClass === "spawn_readonly") return true;
  return false;
}

export function requiresConfirmation(
  domain: PlannerDomain,
  actionClass: string,
  config?: DomainAutonomyConfig,
): boolean {
  const level = getAutonomyLevel(domain, config);
  if (actionClass === "send_reply") return true;
  if (level === "act_with_confirmation") return true;
  return false;
}

export function getEscalationReason(
  domain: PlannerDomain,
  actionClass: string,
  config?: DomainAutonomyConfig,
): string | undefined {
  const level = getAutonomyLevel(domain, config);
  if (level === "read_only" && actionClass !== "spawn_readonly") {
    return `${domain} domain is read-only mode`;
  }
  if (actionClass === "send_reply" && level !== "act_autonomously") {
    return "send_reply requires confirmation";
  }
  return undefined;
}

export function computeNextAutonomyLevel(
  current: AutonomyLevel,
  approved: number,
  rejected: number,
  modified: number,
): AutonomyLevel {
  const total = approved + rejected + modified;
  if (total < 3) return current;
  const approvalRate = approved / total;
  const demotionRate = (rejected + modified * 0.5) / total;
  if (approvalRate >= 0.9 && demotionRate < 0.1) {
    const idx = LEVEL_ORDER.indexOf(current);
    if (idx < LEVEL_ORDER.length - 1) return LEVEL_ORDER[idx + 1];
  }
  if (demotionRate >= 0.4) {
    const idx = LEVEL_ORDER.indexOf(current);
    if (idx > 0) return LEVEL_ORDER[idx - 1];
  }
  return current;
}

async function loadAutonomyConfig(stateDir: string): Promise<DomainAutonomyConfig> {
  const filePath = path.join(stateDir, AUTONOMY_CONFIG_FILE);
  try {
    const raw = await fs.readFile(filePath, "utf8");
    return JSON.parse(raw) as DomainAutonomyConfig;
  } catch {
    return {};
  }
}

async function saveAutonomyConfig(stateDir: string, config: DomainAutonomyConfig): Promise<void> {
  const filePath = path.join(stateDir, AUTONOMY_CONFIG_FILE);
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await fs.writeFile(filePath, JSON.stringify(config, null, 2), "utf8");
}

export async function adjustDomainAutonomy(params: {
  domain: PlannerDomain;
  total: number;
  approved: number;
  rejected: number;
  modified: number;
  stateDir?: string;
}): Promise<AutonomyLevel> {
  const stateDir = params.stateDir ?? process.env.OPENTRIDENT_STATE_DIR ?? ".";
  const config = await loadAutonomyConfig(stateDir);
  const current = getAutonomyLevel(params.domain, config);
  const next = computeNextAutonomyLevel(
    current,
    params.approved,
    params.rejected,
    params.modified,
  );
  if (next !== current) {
    const updatedConfig: DomainAutonomyConfig = { ...config, [params.domain]: next };
    await saveAutonomyConfig(stateDir, updatedConfig);
  }
  return next;
}

export async function getDomainAutonomyConfig(
  stateDir?: string,
): Promise<DomainAutonomyConfig> {
  const stateDirVal = stateDir ?? process.env.OPENTRIDENT_STATE_DIR ?? ".";
  const saved = await loadAutonomyConfig(stateDirVal);
  return { ...DEFAULT_AUTONOMY, ...saved };
}
