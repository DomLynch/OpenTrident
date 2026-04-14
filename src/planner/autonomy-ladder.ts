import type { PlannerDomain } from "./types.js";

export type AutonomyLevel =
  | "read_only"
  | "draft_only"
  | "act_with_confirmation"
  | "act_autonomously";

export type DomainAutonomyConfig = {
  [domain in PlannerDomain]?: AutonomyLevel;
};

const DEFAULT_AUTONOMY: DomainAutonomyConfig = {
  general: "draft_only",
  relationship: "act_with_confirmation",
  project: "draft_only",
  market: "act_with_confirmation",
  decision: "act_with_confirmation",
};

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
  if (level === "act_autonomously") {
    return true;
  }
  if (level === "act_with_confirmation" && actionClass === "draft_reply") {
    return true;
  }
  if (level === "draft_only" && actionClass === "spawn_readonly") {
    return true;
  }
  return false;
}

export function requiresConfirmation(
  domain: PlannerDomain,
  actionClass: string,
  config?: DomainAutonomyConfig,
): boolean {
  const level = getAutonomyLevel(domain, config);
  if (actionClass === "send_reply") {
    return true;
  }
  if (level === "act_with_confirmation") {
    return true;
  }
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
