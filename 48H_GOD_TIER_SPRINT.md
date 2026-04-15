# OpenTrident — 48h Asymmetric Sprint

**Audience:** MiniMax (primary), Dom.
**Principle:** Minimal LOC. 80/20. Every line must buy demo-selling power.
**Budget:** ~550 LOC across 6 moves. 12 dev-hours. 36 hours of soak.
**Prerequisite reading:** `AGENTS.md`, `CLAUDE.md`, `HERMES_LEVERAGE_SPEC.md`.

---

## The Pitch This Sprint Ships

> "OpenTrident runs continuously, learns operator-specific playbooks from real approvals, promotes proven ones to doctrine, publishes a cryptographically-signed audit chain to GitHub, speaks on an uncensorable Nostr channel, and writes its own weekly self-report. One URL shows everything."

6 moves. Nothing else. Anything not on this list is phase 2.

---

## The Cuts (why these are not here)

| Cut | Reason |
|---|---|
| Leader election + follower loop | Single primary runs the demo. Failover is phase 2. |
| Market fork with specialization | One fork with deep playbook library sells the pitch better than two thin forks. |
| Provider abstraction (DO, Akash) | Hetzner alone proves self-migration. Phase 2. |
| Counter-factual planner | Research flavor. Not demo-selling. |
| Temporal pattern recognition | Weekly reports surface patterns narratively — cheaper. |
| Playbook chains / prerequisites | Atomic playbooks are 80% of the value. |
| Wilson-score ranking | Naive rate with use-count threshold is fine for 48h. |
| Subscriber gating + revenue attribution | Wallet + cost ledger already tell the economic story. |
| Separate audit log file | Snapshot chain IS the audit. One file, not two. |
| Identity chain separate from snapshot chain | Same chain. Identity is in the snapshot. |
| Replay viewer (time travel UI) | Dashboard shows live state. Replay is phase 2. |
| Real flush signals (Move 2) | Valuable but orthogonal. Move later; T1 playbook readback is the compounding primitive. |

Every cut buys LOC back for the 6 that remain.

---

## Move 1 — Wire `findPlaybooks` into orchestrator

**LOC:** ~20. **Time:** 30 min. **File(s):** `src/planner/planner-orchestrator.ts`, `src/planner/types.ts`.

**Why:** The single highest-leverage move. Turns 323 lines of dead playbook infrastructure live. Every approved outcome becomes a weapon the agent pulls out next time.

**Spec:** See `HERMES_LEVERAGE_SPEC.md` Move 1 steps 1.1–1.4 — skip 1.5 (playbook-use recording) for now; that's Move 6.

**Acceptance:** A recent heartbeat prompt contains a `Proven playbooks` section when a matching playbook exists.

---

## Move 2 — Doctrine promotion ladder

**LOC:** ~60. **Time:** 1.5h. **File(s):** `src/planner/doctrine-manager.ts` (new), `src/planner/planner-orchestrator.ts` (edit).

**Why:** A playbook that succeeds 5+ times at ≥80% rate should graduate. Doctrine is injected into every prompt for that domain, not just on match. This is how compounding accelerates — proven procedures become the default, not the exception.

**Implementation:**

```typescript
// src/planner/doctrine-manager.ts (new, ~50 lines)
import fs from "node:fs/promises";
import path from "node:path";
import { resolveStateDir } from "../config/paths.js";
import type { Playbook } from "./playbook-manager.js";

const DOCTRINE_FILE = "doctrine-v1.json";
const MIN_USES_FOR_DOCTRINE = 5;
const MIN_RATE_FOR_DOCTRINE = 0.8;
const MAX_DOCTRINE_PER_DOMAIN = 3;

type DoctrineEntry = {
  playbookId: string;
  domain: string;
  name: string;
  procedureDigest: string; // first 200 chars of procedure
  promotedAt: number;
  successCount: number;
  failureCount: number;
};

type DoctrineStore = {
  doctrine: DoctrineEntry[];
  updatedAt: number;
};

async function loadDoctrine(stateDir: string): Promise<DoctrineStore> {
  const filePath = path.join(stateDir, DOCTRINE_FILE);
  try {
    return JSON.parse(await fs.readFile(filePath, "utf8"));
  } catch {
    return { doctrine: [], updatedAt: Date.now() };
  }
}

async function saveDoctrine(stateDir: string, store: DoctrineStore): Promise<void> {
  const filePath = path.join(stateDir, DOCTRINE_FILE);
  const tmp = `${filePath}.tmp.${Date.now()}`;
  await fs.writeFile(tmp, JSON.stringify(store, null, 2), "utf8");
  await fs.rename(tmp, filePath);
}

export async function promoteIfEligible(playbook: Playbook): Promise<boolean> {
  const total = playbook.successCount + playbook.failureCount;
  if (total < MIN_USES_FOR_DOCTRINE) return false;
  const rate = playbook.successCount / total;
  if (rate < MIN_RATE_FOR_DOCTRINE) return false;

  const stateDir = resolveStateDir();
  const store = await loadDoctrine(stateDir);
  if (store.doctrine.some((d) => d.playbookId === playbook.id)) return false;

  const domain = playbook.triggers.find((t) => t.type === "domain")?.value ?? "general";
  const inDomain = store.doctrine.filter((d) => d.domain === domain);

  const entry: DoctrineEntry = {
    playbookId: playbook.id,
    domain,
    name: playbook.name,
    procedureDigest: playbook.procedure.slice(0, 200),
    promotedAt: Date.now(),
    successCount: playbook.successCount,
    failureCount: playbook.failureCount,
  };

  if (inDomain.length >= MAX_DOCTRINE_PER_DOMAIN) {
    // Replace lowest-rated entry in domain
    const lowest = inDomain.reduce((a, b) => {
      const ar = a.successCount / Math.max(a.successCount + a.failureCount, 1);
      const br = b.successCount / Math.max(b.successCount + b.failureCount, 1);
      return ar < br ? a : b;
    });
    const rateEntry = entry.successCount / Math.max(entry.successCount + entry.failureCount, 1);
    const rateLowest = lowest.successCount / Math.max(lowest.successCount + lowest.failureCount, 1);
    if (rateEntry <= rateLowest) return false;
    store.doctrine = store.doctrine.filter((d) => d.playbookId !== lowest.playbookId);
  }

  store.doctrine.push(entry);
  store.updatedAt = Date.now();
  await saveDoctrine(stateDir, store);
  return true;
}

export async function getDoctrine(domain: string): Promise<DoctrineEntry[]> {
  const store = await loadDoctrine(resolveStateDir());
  return store.doctrine.filter((d) => d.domain === domain || d.domain === "general");
}
```

Wire into `buildPromptBlock`: at the top of the prompt section, above individual playbooks, inject doctrine if present.

```typescript
// In planner-orchestrator.ts buildPromptBlock, BEFORE the relevantPlaybooks block:
const doctrine = await getDoctrine(decision.goal.domain).catch(() => []);
if (doctrine.length > 0) {
  lines.push("");
  lines.push("Doctrine for this domain (always applies — treat as operating principle):");
  for (const d of doctrine) {
    lines.push(`- ${d.name}: ${d.procedureDigest}`);
  }
}
```

Wire `promoteIfEligible` into `recordPlaybookUse` in `playbook-manager.ts` — after every use count update, check eligibility.

**Acceptance:** Force a test playbook past threshold (edit counts manually). Confirm it appears in `doctrine-v1.json` and in the next prompt block.

---

## Move 3 — Signed hourly snapshot → GitHub release

**LOC:** ~150. **Time:** 3h. **File(s):** `src/persistence/snapshot.ts` (new), `src/persistence/signing-key.ts` (new), add hourly trigger in heartbeat.

**Why:** Combines identity bundle + state snapshot + audit chain into ONE primitive. Every hour, OT signs its full state (identity files + planner + trust + playbooks + doctrine + memory), publishes to GitHub releases. Anyone can verify. The chain of snapshots IS the audit trail, IS the identity continuity proof, IS the persistence layer. Three artifacts for the price of one.

**Implementation:**

```typescript
// src/persistence/signing-key.ts (~30 lines)
import { generateKeyPairSync, sign as nodeSign, createPrivateKey, createPublicKey } from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import { resolveStateDir } from "../config/paths.js";

const KEY_FILE = "signing-key-v1.pem";
const PUB_FILE = "signing-pubkey-v1.pem";

export async function ensureSigningKey(): Promise<{ privateKeyPem: string; publicKeyPem: string }> {
  const dir = resolveStateDir();
  const keyPath = path.join(dir, KEY_FILE);
  const pubPath = path.join(dir, PUB_FILE);
  try {
    const privateKeyPem = await fs.readFile(keyPath, "utf8");
    const publicKeyPem = await fs.readFile(pubPath, "utf8");
    return { privateKeyPem, publicKeyPem };
  } catch {
    const { privateKey, publicKey } = generateKeyPairSync("ed25519");
    const privateKeyPem = privateKey.export({ type: "pkcs8", format: "pem" }) as string;
    const publicKeyPem = publicKey.export({ type: "spki", format: "pem" }) as string;
    await fs.mkdir(dir, { recursive: true });
    await fs.writeFile(keyPath, privateKeyPem, { mode: 0o600 });
    await fs.writeFile(pubPath, publicKeyPem, "utf8");
    return { privateKeyPem, publicKeyPem };
  }
}

export function signBytes(privateKeyPem: string, data: Buffer): string {
  const key = createPrivateKey(privateKeyPem);
  return nodeSign(null, data, key).toString("base64");
}

export function verifyBytes(publicKeyPem: string, data: Buffer, signature: string): boolean {
  const key = createPublicKey(publicKeyPem);
  const { verify } = require("node:crypto");
  return verify(null, data, key, Buffer.from(signature, "base64"));
}
```

```typescript
// src/persistence/snapshot.ts (~120 lines)
import fs from "node:fs/promises";
import path from "node:path";
import { createHash } from "node:crypto";
import { gzip } from "node:zlib";
import { promisify } from "node:util";
import { exec } from "node:child_process";
import { resolveStateDir } from "../config/paths.js";
import { ensureSigningKey, signBytes } from "./signing-key.js";

const gzipAsync = promisify(gzip);
const execAsync = promisify(exec);

const IDENTITY_FILES = ["CLAUDE.md", "AGENTS.md", "SYSTEM_PROMPT.md"];
const STATE_FILES = [
  "planner-v1.json",
  "trust-telemetry-v1.json",
  "memory-v1.json",
  "doctrine-v1.json",
  "playbooks/playbook-store.json",
];

export type Snapshot = {
  version: 1;
  snapshotId: string;
  parentSnapshotId: string | null;
  generatedAt: number;
  instanceId: string;
  contentHash: string;
  files: Record<string, { sha256: string; bytes: number }>;
  signature: string;
  publicKeyPem: string;
};

function sha256(buf: Buffer): string {
  return createHash("sha256").update(buf).digest("hex");
}

async function readIfExists(filePath: string): Promise<Buffer | null> {
  try {
    return await fs.readFile(filePath);
  } catch {
    return null;
  }
}

async function loadLastSnapshotId(stateDir: string): Promise<string | null> {
  try {
    const pointer = await fs.readFile(path.join(stateDir, "snapshot-head"), "utf8");
    return pointer.trim() || null;
  } catch {
    return null;
  }
}

async function writeLastSnapshotId(stateDir: string, id: string): Promise<void> {
  await fs.writeFile(path.join(stateDir, "snapshot-head"), id, "utf8");
}

export async function generateSnapshot(): Promise<{ snapshot: Snapshot; bundlePath: string }> {
  const stateDir = resolveStateDir();
  const repoRoot = process.env.OPENTRIDENT_REPO_ROOT ?? "/opt/opentrident";
  const { privateKeyPem, publicKeyPem } = await ensureSigningKey();

  const files: Record<string, { sha256: string; bytes: number; content: Buffer }> = {};

  for (const f of IDENTITY_FILES) {
    const buf = await readIfExists(path.join(repoRoot, f));
    if (buf) files[`identity/${f}`] = { sha256: sha256(buf), bytes: buf.length, content: buf };
  }

  for (const f of STATE_FILES) {
    const buf = await readIfExists(path.join(stateDir, f));
    if (buf) files[`state/${f}`] = { sha256: sha256(buf), bytes: buf.length, content: buf };
  }

  // Concat all contents (sorted by key) for the overall content hash
  const sortedKeys = Object.keys(files).sort();
  const combined = Buffer.concat(sortedKeys.map((k) => files[k].content));
  const contentHash = sha256(combined);

  const parentSnapshotId = await loadLastSnapshotId(stateDir);
  const snapshotId = `snap-${new Date().toISOString().slice(0, 13).replace(/[-T]/g, "")}-${contentHash.slice(0, 8)}`;

  const manifest: Omit<Snapshot, "signature" | "publicKeyPem"> = {
    version: 1,
    snapshotId,
    parentSnapshotId,
    generatedAt: Date.now(),
    instanceId: process.env.OPENTRIDENT_INSTANCE_ID ?? "primary",
    contentHash,
    files: Object.fromEntries(sortedKeys.map((k) => [k, { sha256: files[k].sha256, bytes: files[k].bytes }])),
  };

  const canonicalJson = JSON.stringify(manifest, Object.keys(manifest).sort());
  const signature = signBytes(privateKeyPem, Buffer.from(canonicalJson, "utf8"));

  const snapshot: Snapshot = { ...manifest, signature, publicKeyPem };

  // Write bundle: manifest.json + files/... gzipped as a single tarball-like blob
  const bundleDir = path.join(stateDir, "snapshots", snapshotId);
  await fs.mkdir(bundleDir, { recursive: true });
  await fs.writeFile(path.join(bundleDir, "manifest.json"), JSON.stringify(snapshot, null, 2), "utf8");

  for (const k of sortedKeys) {
    const target = path.join(bundleDir, k);
    await fs.mkdir(path.dirname(target), { recursive: true });
    const gz = await gzipAsync(files[k].content);
    await fs.writeFile(`${target}.gz`, gz);
  }

  await writeLastSnapshotId(stateDir, snapshotId);
  return { snapshot, bundlePath: bundleDir };
}

export async function publishSnapshotToGitHub(bundlePath: string, snapshotId: string): Promise<void> {
  const repo = process.env.OPENTRIDENT_SNAPSHOT_REPO ?? "DomLynch/OpenTrident-runtime";
  // Tar the bundle dir → upload as a release asset
  const tarPath = `${bundlePath}.tar.gz`;
  await execAsync(`tar -czf "${tarPath}" -C "${path.dirname(bundlePath)}" "${path.basename(bundlePath)}"`);
  await execAsync(`gh release create "${snapshotId}" "${tarPath}" --repo "${repo}" --title "Snapshot ${snapshotId}" --notes "Automated OpenTrident snapshot"`).catch(
    async () => {
      // Release may already exist — try upload instead
      await execAsync(`gh release upload "${snapshotId}" "${tarPath}" --repo "${repo}" --clobber`);
    },
  );
}
```

**Wiring:** In `heartbeat-runner.ts`, add a once-per-hour gate that calls `generateSnapshot()` then `publishSnapshotToGitHub()`. Reuse the existing hourly gate pattern if one exists; otherwise add a simple "last hourly ts" check in state.

**Acceptance:** After 24h, at least 20 signed snapshots exist in `/opt/opentrident-data/config/snapshots/` AND in GitHub releases on `DomLynch/OpenTrident-runtime`. Each snapshot references its parent. Pull any snapshot, recompute the contentHash, verify signature against the embedded publicKeyPem — all pass.

**This is 3 artifacts in one primitive:** identity bundle (identity files), state snapshot (state files), audit chain (parentSnapshotId links). No separate code paths needed.

---

## Move 4 — Nostr publisher (uncensorable voice)

**LOC:** ~80. **Time:** 1.5h. **File(s):** `src/social/nostr-publisher.ts` (new), wire into existing public-channel handler.

**Why:** Telegram can be banned. The VPS can be killed. A Nostr keypair cannot. Once OT has a Nostr identity, its voice survives any single-point-of-failure takedown. This is the asymmetric "cannot be shut down" proof.

**Dependency:** Add `nostr-tools` to package.json (~80KB, well-maintained). This is the one dependency exception.

**Implementation:**

```typescript
// src/social/nostr-publisher.ts (~80 lines)
import { finalizeEvent, generateSecretKey, getPublicKey, nip19 } from "nostr-tools/pure";
import { Relay } from "nostr-tools/relay";
import fs from "node:fs/promises";
import path from "node:path";
import { resolveStateDir } from "../config/paths.js";

const NOSTR_KEY_FILE = "nostr-sk-v1.bin";
const DEFAULT_RELAYS = [
  "wss://relay.damus.io",
  "wss://nos.lol",
  "wss://relay.nostr.band",
];

async function ensureNostrKey(): Promise<Uint8Array> {
  const keyPath = path.join(resolveStateDir(), NOSTR_KEY_FILE);
  try {
    const raw = await fs.readFile(keyPath);
    return new Uint8Array(raw);
  } catch {
    const sk = generateSecretKey();
    await fs.writeFile(keyPath, Buffer.from(sk), { mode: 0o600 });
    return sk;
  }
}

export async function getNostrPubkey(): Promise<{ hex: string; npub: string }> {
  const sk = await ensureNostrKey();
  const hex = getPublicKey(sk);
  return { hex, npub: nip19.npubEncode(hex) };
}

export async function publishToNostr(params: {
  text: string;
  tags?: string[][];
  relays?: string[];
}): Promise<{ ok: boolean; eventId?: string; errors: string[] }> {
  const sk = await ensureNostrKey();
  const relayUrls = params.relays ?? DEFAULT_RELAYS;

  const event = finalizeEvent(
    {
      kind: 1,
      created_at: Math.floor(Date.now() / 1000),
      tags: params.tags ?? [],
      content: params.text,
    },
    sk,
  );

  const errors: string[] = [];
  let anySuccess = false;

  await Promise.all(
    relayUrls.map(async (url) => {
      try {
        const relay = await Relay.connect(url);
        await relay.publish(event);
        await relay.close();
        anySuccess = true;
      } catch (err) {
        errors.push(`${url}: ${String(err).slice(0, 100)}`);
      }
    }),
  );

  return { ok: anySuccess, eventId: event.id, errors };
}
```

**Wiring:** In `sendToPublicChannel` (Phase 6 T6.1 existing code), after a successful Telegram publish, fire `publishToNostr({ text, tags: [["t", "opentrident"], ["t", domain]] }).catch(() => {})` in parallel.

**Acceptance:** Next market signal that clears the Phase 6 threshold shows up on Nostr. Pubkey (hex + npub) stored in `identity-bundle.json`/`snapshot-head`. Verify from any Nostr client by pasting the npub.

---

## Move 5 — Weekly auto-report ("What I did this week")

**LOC:** ~40. **Time:** 1.5h. **File(s):** `src/planner/weekly-report.ts` (new), wire into heartbeat Sunday 18:00 gate.

**Why:** One artifact a buyer can read in 2 minutes and understand OpenTrident's value. "Here's what this thing decided, executed, learned, and shipped last week — in its own voice." The single most sellable demo piece per line of code.

**Implementation:**

```typescript
// src/planner/weekly-report.ts (~40 lines)
import { queryDecisions } from "./memory-query.js";
import { getTrustMetrics } from "./trust-telemetry.js";
import { getPlaybookStats } from "./playbook-manager.js";
import { recordMemory } from "./planner-memory.js";
import { sendToPublicChannel } from "../social/public-channel.js";
import { publishToNostr } from "../social/nostr-publisher.js";

export async function generateWeeklyReportPrompt(): Promise<string> {
  const decisions = await queryDecisions({ lookbackDays: 7 });
  const trust = await getTrustMetrics();
  const playbooks = await getPlaybookStats();

  const context = `
Context for weekly report:
- Total decisions: ${decisions.total}
- Approved: ${decisions.approved}, Rejected: ${decisions.rejected}, Modified: ${decisions.modified}
- Trust approval rate: ${trust.totalActions > 0 ? ((trust.approvedActions / trust.totalActions) * 100).toFixed(0) : "n/a"}%
- Playbooks in library: ${playbooks.total}
- Average playbook success rate: ${(playbooks.avgSuccessRate * 100).toFixed(0)}%

Write a founder-style weekly operator report (max 400 words, no filler).
Sections:
1. Decisions Shipped — 3–5 concrete things done
2. Leverage Created — what compounds from this week
3. Lessons — 1–2 honest observations
4. Next Week's Focus — 1 priority

Be sharp. Be Dom's voice. Lead with the decision.
`;
  return context;
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
```

**Wiring:** In `heartbeat-runner.ts`, add a Sunday 18:00 gate (reuse the 9am strategic cycle gate pattern). When it fires, spawn a `brief` worker with the prompt from `generateWeeklyReportPrompt()`. On worker completion, extract result and call `publishWeeklyReport(result)`.

**Acceptance:** Before deploy, trigger manually via CLI: `openclaw report weekly --dry-run`. Verify the prompt includes real context. Deploy. Next Sunday 18:00 (or next manual trigger), report generates, appears in Telegram channel + Nostr + dashboard.

---

## Move 6 — Single HTML dashboard

**LOC:** ~200. **Time:** 3h. **File(s):** `src/gateway/dashboard.ts` (new route), `src/gateway/dashboard.html` (embedded string, no template engine).

**Why:** One URL. Every metric. The buyer opens it in a meeting and sees everything: trust rate, playbook library, doctrine, live planner, recent decisions, revenue/burn, Nostr pubkey, latest weekly report, identity chain length. This is the demo.

**Implementation:**

```typescript
// src/gateway/dashboard.ts (~200 lines total including the HTML string)
import { getTrustMetrics } from "../planner/trust-telemetry.js";
import { getPlaybookStats, getPlaybooks } from "../planner/playbook-manager.js";
import { getDoctrine } from "../planner/doctrine-manager.js";
import { queryDecisions, queryLastOccurrence } from "../planner/memory-query.js";
import { buildCostContext } from "../economic/cost-ledger.js";
import { getWalletBalance, loadWalletKey } from "../economic/wallet.js";
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
  const wallet = await loadWalletKey().catch(() => null);
  const walletBalance = wallet ? await getWalletBalance(wallet.publicKey).catch(() => null) : null;
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
    economic: {
      walletBalance: walletBalance ?? 0,
      context: buildCostContext ? buildCostContext() : "n/a",
    },
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
  <div class="card"><h2>Wallet</h2><div class="big" id="wallet">—</div><div>SOL</div></div>
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
  if (d.recentDecisions) { document.getElementById('dec-total').textContent = d.recentDecisions.total; document.getElementById('dec-split').textContent = d.recentDecisions.approved + ' ✓ / ' + d.recentDecisions.rejected + ' ✗ / ' + d.recentDecisions.modified + ' ±'; }
  document.getElementById('wallet').textContent = (d.economic.walletBalance || 0).toFixed(4);
  document.getElementById('doctrine').innerHTML = d.doctrine.length > 0 ? d.doctrine.map(x => '<div class="playbook">[' + x.domain + '] ' + x.name + '<br><span class="sub">' + x.digest + '</span></div>').join('') : '<div class="sub">No doctrine promoted yet</div>';
  if (d.nostr) document.getElementById('nostr').textContent = d.nostr.npub;
  document.getElementById('snap').textContent = d.snapshotHead;
  document.getElementById('weekly').textContent = d.lastWeekly || '(no weekly report yet)';
}
load(); setInterval(load, 30000);
</script>
</body></html>`;

export function handleDashboardHtml(): string {
  return DASHBOARD_HTML;
}
```

**Wiring:** In the gateway HTTP router (wherever `/healthz` is served), add:
- `GET /dashboard` → returns `handleDashboardHtml()` with `Content-Type: text/html`
- `GET /api/dashboard-data` → returns `JSON.stringify(await handleDashboardData())` with `Content-Type: application/json`

Both gated by the same localhost-only policy as `/healthz`.

**Acceptance:** `ssh` into VPS, `curl http://127.0.0.1:18889/dashboard` returns HTML. `curl http://127.0.0.1:18889/api/dashboard-data` returns populated JSON. SSH port-forward to desktop, open browser, see live dashboard with real numbers.

---

## 48h Timeline

```
Hour 0–0:30    Move 1 (wire findPlaybooks)          ───▶ playbooks live
Hour 0:30–2    Move 2 (doctrine ladder)             ───▶ compounding accelerator
Hour 2–5       Move 3 (signed snapshots + GitHub)   ───▶ audit chain live
Hour 5–6:30    Move 4 (Nostr publisher)             ───▶ uncensorable voice
Hour 6:30–8    Move 5 (weekly report)               ───▶ sales artifact
Hour 8–11      Move 6 (dashboard)                   ───▶ single URL demo
Hour 11–48     SOAK — let counters accumulate       ───▶ real numbers on demo
```

11 dev hours. 37 hours of soak. That's the point — the demo sells because **time has passed on it.**

---

## Soak counters (what "god tier" looks like at 48h)

| Metric | Start | Target @ 48h |
|---|---|---|
| Playbooks with `used > 0` (Move 1) | 0 | ≥ 3 |
| Doctrine entries (Move 2) | 0 | 0–1 (needs ≥5 uses at ≥80% — may not hit in 48h, that's fine, counter climbs) |
| Signed snapshots on GitHub (Move 3) | 0 | ≥ 40 (hourly × 40h of soak) |
| Nostr events published (Move 4) | 0 | ≥ 2 |
| Weekly reports (Move 5) | 0 | 0–1 (fires Sunday — schedule determines timing) |
| Dashboard lines of code (Move 6) | 0 | single URL, all above metrics live |

If doctrine or weekly report doesn't fire in the 48h window, trigger each manually for the demo. The primitives exist; the wall-clock accumulation happens over weeks.

---

## Hard rules

1. **Every move = independent commit.** `feat(sprint): move N — <title>`.
2. **Use `scripts/deploy.sh`.** No raw docker.
3. **Atomic fs writes** (tmp + rename).
4. **One dependency exception:** `nostr-tools` for Move 4. Nothing else.
5. **`.catch(() => {})`** on every non-critical external call.
6. **Every file starts with a one-line role comment.**
7. **Pre-commit hooks fail on VPS — `--no-verify` allowed on VPS commits only.**
8. **No move marked done until its acceptance criterion passes on VPS r???.**

---

## The Asymmetric Logic

Each move serves exactly one demo claim. Cut anything that doesn't.

| Move | LOC | Demo claim |
|---|---|---|
| 1. findPlaybooks wiring | 20 | "It learns from every approval" |
| 2. Doctrine ladder | 60 | "It promotes proven procedures to operating principles" |
| 3. Signed snapshots | 150 | "Every decision is cryptographically verifiable" |
| 4. Nostr publisher | 80 | "It cannot be silenced" |
| 5. Weekly report | 40 | "It writes its own operator report" |
| 6. HTML dashboard | 200 | "One URL shows everything" |
| **Total** | **~550** | **6 claims. 6 artifacts. 48h.** |

Every line buys a demo claim. Anything that doesn't buy a claim is bloat.

---

## One-Line Brief For MiniMax

> Ship 6 moves in ~550 LOC across 11 hours: findPlaybooks wiring, doctrine ladder, signed snapshot chain to GitHub, Nostr publisher, weekly auto-report, HTML dashboard. Then let it soak for 37h. The demo that sells to Anthropic/OpenAI/Meta opens at `http://127.0.0.1:18889/dashboard` on Monday.
