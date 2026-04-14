import type { PlannerGoal, PlannerItem } from "./types.js";

function slugify(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 64);
}

export function originatePlannerGoal(item: PlannerItem): PlannerGoal {
  switch (item.id) {
    case "project_stale":
      return {
        id: `goal-${slugify(item.id)}`,
        title: "Inspect project drift",
        summary:
          "Review the project/deploy signal and produce a draft GitHub issue or PR comment identifying the drift and recommended fix.",
        actionClass: "draft_issue",
        domain: item.domain,
        sourceItemId: item.id,
      };
    case "market_unreviewed":
      return {
        id: `goal-${slugify(item.id)}`,
        title: "Inspect market context",
        summary:
          "Review the market signal and produce an analytical brief covering the key drivers, likely market impact, and recommended watch points.",
        actionClass: "brief",
        domain: item.domain,
        sourceItemId: item.id,
      };
    case "decision_backlog":
      return {
        id: `goal-${slugify(item.id)}`,
        title: "Force a decision",
        summary: "Surface the unresolved decision and produce a concise recommendation for Dom.",
        actionClass: "surface_only",
        domain: item.domain,
        sourceItemId: item.id,
      };
    case "relationship_drift":
    case "relationship_followthrough":
      return {
        id: `goal-${slugify(item.id)}`,
        title: "Close the loop",
        summary: "Draft a response or outreach message for the relationship follow-up need.",
        actionClass: "draft_reply",
        domain: item.domain,
        sourceItemId: item.id,
      };
    default:
      return {
        id: `goal-${slugify(item.id)}`,
        title: "Review pending signal",
        summary:
          "Surface the highest-leverage pending signal and propose the next low-blast-radius step.",
        actionClass: "surface_only",
        domain: item.domain,
        sourceItemId: item.id,
      };
  }
}