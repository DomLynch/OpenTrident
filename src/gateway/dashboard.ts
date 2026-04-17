import { getTrustMetrics } from "../planner/trust-telemetry.js";
import { getPlaybooks } from "../planner/playbook-manager.js";
import { getDoctrine } from "../planner/doctrine-manager.js";
import { queryDecisions } from "../planner/memory-query.js";
import { queryLastOccurrence } from "../planner/memory-query.js";
import { getPlaybookStats } from "../planner/playbook-manager.js";
import { getNostrPubkey } from "../social/nostr-publisher.js";
import fs from "node:fs/promises";
import path from "node:path";
import { resolveStateDir } from "../config/paths.js";

export async function handleDashboardData(): Promise<Record<string, unknown>> {
  const trust = await getTrustMetrics().catch(() => null);
  const playbookStats = await getPlaybookStats().catch(() => null);
  const topPlaybooks = await getPlaybooks({}).catch(() => []);
  const doctrineAll = await getDoctrine("general").catch(() => []);
  const recentDecisions = await queryDecisions({ lookbackDays: 7 }).catch(() => null);
  const nostr = await getNostrPubkey().catch(() => null);
  const lastWeekly = await queryLastOccurrence({ category: "reflection", keyPattern: "weekly-report:" }).catch(() => null);
  const snapshotHead = await fs.readFile(path.join(resolveStateDir(), "snapshot-head"), "utf8").catch(() => "none");

  return {
    generatedAt: Date.now(),
    trust: trust ? {
      approvalRate: trust.totalActions > 0 ? Math.round((trust.approvedActions / trust.totalActions) * 100) : 0,
      totalActions: trust.totalActions,
      byDomain: trust.byDomain,
    } : null,
    playbooks: playbookStats ? {
      total: playbookStats.total,
      avgSuccessRate: Math.round(playbookStats.avgSuccessRate * 100),
      top: topPlaybooks.slice(0, 10).map((p) => ({
        name: p.name,
        category: p.category,
        successCount: p.successCount,
        failureCount: p.failureCount,
        successRate: Math.round((p.successCount / Math.max(p.successCount + p.failureCount, 1)) * 100),
      })),
    } : null,
    doctrine: doctrineAll.map((d) => ({ name: d.name, domain: d.domain, digest: d.procedureDigest.slice(0, 100) })),
    recentDecisions: recentDecisions ? {
      total: recentDecisions.total,
      approved: recentDecisions.approved,
      rejected: recentDecisions.rejected,
      modified: recentDecisions.modified,
    } : null,
    nostr: nostr ? { npub: nostr.npub, hex: nostr.hex } : null,
    lastWeekly: lastWeekly ? lastWeekly.entry.value.slice(0, 1000) : null,
    snapshotHead,
  };
}

const DASHBOARD_HTML = `<!DOCTYPE html>
<html><head>
<title>OpenTrident</title>
<style>
  body { font-family: -apple-system, sans-serif; background: #0a0a0a; color: #e8e8e8; max-width: 1200px; margin: 40px auto; padding: 0 20px; }
  h1 { font-size: 32px; margin-bottom: 4px; }
  .sub { color: #888; margin-bottom: 40px; }
  .grid { display: grid; grid-template-columns: 1fr 1fr; gap: 24px; }
  .card { background: #141414; border: 1px solid #2a2a2a; border-radius: 8px; padding: 20px; }
  .card h2 { font-size: 14px; text-transform: uppercase; color: #888; margin: 0 0 12px 0; letter-spacing: 0.1em; }
  .big { font-size: 36px; font-weight: 600; color: #4ade80; }
  .playbook { padding: 8px 0; border-bottom: 1px solid #2a2a2a; font-size: 13px; }
  .playbook:last-child { border: none; }
  .rate { color: #4ade80; font-weight: 600; float: right; }
  .rate.low { color: #f87171; }
  code { background: #1a1a1a; padding: 2px 6px; border-radius: 4px; font-size: 12px; word-break: break-all; }
  pre { white-space: pre-wrap; font-size: 12px; color: #bbb; }
</style>
</head><body>
<h1>OpenTrident</h1>
<div class="sub">Live operator dashboard · <span id="ts">—</span></div>
  <div class="grid">
    <div class="card"><h2>Trust</h2><div class="big"><span id="approval">—</span>%</div><div id="trust-total">—</div></div>
    <div class="card"><h2>Playbooks</h2><div class="big" id="pb-total">—</div><div>Avg success <span id="pb-rate">—</span>%</div></div>
    <div class="card"><h2>7-Day Decisions</h2><div class="big" id="dec-total">—</div><div><span id="dec-split">—</span></div></div>
    <div class="card" style="grid-column: span 2"><h2>Doctrine</h2><div id="doctrine">—</div></div>
  <div class="card" style="grid-column: span 2"><h2>Top Playbooks</h2><div id="playbooks">—</div></div>
  <div class="card" style="grid-column: span 2"><h2>Identity</h2>
    <div>Nostr: <code id="nostr">—</code></div>
    <div>Snapshot head: <code id="snap">—</code></div>
  </div>
  <div class="card" style="grid-column: span 2"><h2>Latest Weekly Report</h2><pre id="weekly">—</pre></div>
</div>
<script>
async function load() {
  const r = await fetch('/api/dashboard-data');
  const d = await r.json();
  document.getElementById('ts').textContent = new Date(d.generatedAt).toLocaleString();
  if (d.trust) { document.getElementById('approval').textContent = d.trust.approvalRate; document.getElementById('trust-total').textContent = d.trust.totalActions + ' actions'; }
  if (d.playbooks) { document.getElementById('pb-total').textContent = d.playbooks.total; document.getElementById('pb-rate').textContent = d.playbooks.avgSuccessRate;
    document.getElementById('playbooks').innerHTML = d.playbooks.top.map(p => '<div class="playbook">' + p.name + '<span class="rate' + (p.successRate < 70 ? ' low' : '') + '">' + p.successRate + '% · ' + (p.successCount + p.failureCount) + ' uses</span></div>').join('') || '<div class="sub">No playbooks yet</div>'; }
  if (d.recentDecisions) { document.getElementById('dec-total').textContent = d.recentDecisions.total; document.getElementById('dec-split').textContent = d.recentDecisions.approved + ' approved / ' + d.recentDecisions.rejected + ' rejected / ' + d.recentDecisions.modified + ' modified'; }
  document.getElementById('doctrine').innerHTML = d.doctrine && d.doctrine.length > 0 ? d.doctrine.map(x => '<div class="playbook">[' + x.domain + '] ' + x.name + '<br><span style="color:#888;font-size:12px">' + x.digest + '</span></div>').join('') : '<div class="sub">No doctrine promoted yet</div>';
  if (d.nostr) document.getElementById('nostr').textContent = d.nostr.npub;
  document.getElementById('snap').textContent = d.snapshotHead || 'none';
  document.getElementById('weekly').textContent = d.lastWeekly || '(no weekly report yet)';
}
load(); setInterval(load, 30000);
</script>
</body></html>`;

export function handleDashboardHtml(): string {
  return DASHBOARD_HTML;
}
