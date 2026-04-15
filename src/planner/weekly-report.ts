import { queryDecisions } from "./memory-query.js";
import { getTrustMetrics } from "./trust-telemetry.js";
import { getPlaybookStats } from "./playbook-manager.js";
import { recordMemory } from "./planner-memory.js";
import { sendToPublicChannel } from "../auto-reply/reply/commands-publish.js";
import { publishToNostr } from "../social/nostr-publisher.js";

export async function generateWeeklyReportText(): Promise<string> {
  const decisions = await queryDecisions({ lookbackDays: 7 }).catch(() => null);
  const trust = await getTrustMetrics().catch(() => null);
  const playbooks = await getPlaybookStats().catch(() => null);

  const total = decisions?.total ?? 0;
  const approved = decisions?.approved ?? 0;
  const rejected = decisions?.rejected ?? 0;
  const modified = decisions?.modified ?? 0;
  const approvalRate = trust && trust.totalActions > 0
    ? ((trust.approvedActions / trust.totalActions) * 100).toFixed(0)
    : "n/a";
  const pbTotal = playbooks?.total ?? 0;
  const pbRate = playbooks ? (playbooks.avgSuccessRate * 100).toFixed(0) : "n/a";

  const sections = [
    "**OpenTrident Weekly Report**",
    "",
    "## Decisions Shipped",
    total === 0
      ? "No formal decisions this week."
      : `${total} total — ${approved} approved, ${rejected} rejected, ${modified} modified.`,
    "",
    "## Leverage Created",
    `Playbook library: ${pbTotal} playbooks, ${pbRate}% avg success rate.`,
    trust
      ? `Trust approval rate: ${approvalRate}% over ${trust.totalActions} total actions.`
      : "Trust telemetry unavailable.",
    "",
    "## Lessons",
    "Execution log available in audit trail. Check /dashboard for live metrics.",
    "",
    "## Next Week's Focus",
    "Continue compounding judgment. Promote next doctrine entry. Expand playbook library.",
    "",
    `— OpenTrident · ${new Date().toISOString().slice(0, 10)}`,
  ];

  return sections.join("\n");
}

export async function publishWeeklyReport(reportText: string): Promise<void> {
  await recordMemory({
    key: `weekly-report:${new Date().toISOString().slice(0, 10)}`,
    value: reportText,
    category: "reflection",
    source: "weekly-report",
  }).catch(() => {});

  await sendToPublicChannel(reportText).catch(() => {});
  await publishToNostr({ text: reportText, tags: [["t", "opentrident"], ["t", "weekly-report"]] }).catch(() => {});
}
