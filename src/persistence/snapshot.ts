import fs from "node:fs/promises";
import path from "node:path";
import { createHash } from "node:crypto";
import { gzip, gunzip } from "node:zlib";
import { promisify } from "node:util";
import { exec } from "node:child_process";
import { resolveStateDir } from "../config/paths.js";
import { ensureSigningKey, signBytes, verifyBytes } from "./signing-key.js";

const gzipAsync = promisify(gzip);
const gunzipAsync = promisify(gunzip);
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

const LAST_SNAPSHOT_TS_FILE = "last-snapshot-ts";

async function readLastSnapshotTs(stateDir: string): Promise<number> {
  try {
    const raw = await fs.readFile(path.join(stateDir, LAST_SNAPSHOT_TS_FILE), "utf8");
    return parseInt(raw.trim(), 10) || 0;
  } catch {
    return 0;
  }
}

async function writeLastSnapshotTs(stateDir: string, ts: number): Promise<void> {
  await fs.writeFile(path.join(stateDir, LAST_SNAPSHOT_TS_FILE), String(ts), "utf8");
}

const SNAPSHOT_INTERVAL_MS = 60 * 60 * 1000;

export async function shouldSnapshot(): Promise<boolean> {
  const stateDir = resolveStateDir();
  const lastTs = await readLastSnapshotTs(stateDir);
  return Date.now() - lastTs >= SNAPSHOT_INTERVAL_MS;
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
  await writeLastSnapshotTs(stateDir, Date.now());
  return { snapshot, bundlePath: bundleDir };
}

export async function publishSnapshotToGitHub(bundlePath: string, snapshotId: string): Promise<void> {
  const repo = process.env.OPENTRIDENT_SNAPSHOT_REPO ?? "DomLynch/OpenTrident-runtime";
  const tarPath = `${bundlePath}.tar.gz`;
  try {
    await execAsync(`tar -czf "${tarPath}" -C "${path.dirname(bundlePath)}" "${path.basename(bundlePath)}"`);
  } catch {
    return;
  }
  try {
    await execAsync(`gh release create "${snapshotId}" "${tarPath}" --repo "${repo}" --title "Snapshot ${snapshotId}" --notes "Automated OpenTrident snapshot"`);
  } catch {
    try {
      await execAsync(`gh release upload "${snapshotId}" "${tarPath}" --repo "${repo}" --clobber`);
    } catch {
      // Release may not exist, skip
    }
  }
}

export async function verifySnapshot(bundlePath: string): Promise<{ valid: boolean; error?: string }> {
  const manifestPath = path.join(bundlePath, "manifest.json");
  let snapshot: Snapshot;
  try {
    const raw = await fs.readFile(manifestPath, "utf8");
    snapshot = JSON.parse(raw) as Snapshot;
  } catch {
    return { valid: false, error: "Cannot read manifest.json" };
  }

  const sortedKeys = Object.keys(snapshot.files).sort();
  const rawContents: Buffer[] = [];
  for (const k of sortedKeys) {
    const gzPath = path.join(bundlePath, k + ".gz");
    try {
      const gz = await fs.readFile(gzPath);
      const decompressed = await gunzipAsync(gz);
      rawContents.push(decompressed);
    } catch {
      return { valid: false, error: `Cannot read file: ${k}` };
    }
  }

  const combined = Buffer.concat(rawContents);
  const contentHash = sha256(combined);

  if (contentHash !== snapshot.contentHash) {
    return { valid: false, error: "Content hash mismatch" };
  }

  const manifest = {
    version: snapshot.version,
    snapshotId: snapshot.snapshotId,
    parentSnapshotId: snapshot.parentSnapshotId,
    generatedAt: snapshot.generatedAt,
    instanceId: snapshot.instanceId,
    contentHash: snapshot.contentHash,
    files: snapshot.files,
  };
  const canonicalJson = JSON.stringify(manifest, Object.keys(manifest).sort());

  const valid = verifyBytes(
    snapshot.publicKeyPem,
    Buffer.from(canonicalJson, "utf8"),
    snapshot.signature,
  );

  if (!valid) {
    return { valid: false, error: "Signature verification failed" };
  }

  return { valid: true };
}
