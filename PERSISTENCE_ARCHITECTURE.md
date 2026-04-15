# OpenTrident Persistence Architecture

## Goal

OpenTrident persists across host failures by separating its **identity**, **state**, and **runtime** into independently replicable bundles. Any compatible node can bootstrap from the latest verified bundle without depending on a single server.

---

## The Four Bundles

### Bundle 1: Identity (`identity-bundle.json`)

Canonical answer to "who is OpenTrident?" — portable, signed, versioned.

```json
{
  "version": 1,
  "bundleId": "ot-identity-2026.04.15-abc123",
  "instanceId": "opentrident-primary-1",
  "generatedAt": 1744700000000,
  "expiresAt": 1752296000000,
  "files": {
    "SYSTEM_PROMPT.md": "<content>",
    "AGENTS.md": "<content>",
    "CLAUDE.md": "<content>",
    "VALUES.md": "<content>",
    "DOMAIN.md": "<content>"
  },
  "envVars": {
    "TELEGRAM_BOT_TOKEN": "placeholder:SET_IN_DEPLOY",
    "OPENTRIDENT_GATEWAY_TOKEN": "placeholder:SET_IN_DEPLOY",
    "OPENROUTER_API_KEY": "placeholder:SET_IN_DEPLOY",
    "MINIMAX_API_KEY": "placeholder:SET_IN_DEPLOY",
    "HETZNER_API_TOKEN": "placeholder:SET_IN_DEPLOY"
  },
  "config": {
    "heartbeatIntervalMs": 1800000,
    "maxSpawnsPerHour": 10,
    "autonomyLadder": { ... },
    "watchlist": [ ... ]
  },
  "signature": "base64-ed25519-signature-over-sha256-of-canonical-json",
  "signingKeyId": "ed25519:abc123...xyz789"
}
```

**Key properties:**
- `instanceId` — unique per deployment, not per identity. Identity persists across migrations; instance ID changes when a new primary boots.
- `signature` — Ed25519 signature over canonical JSON (sorted keys, no whitespace). Any node can verify without knowing secrets.
- `envVars` — names are committed, values are `placeholder:SET_IN_DEPLOY`. Actual secrets injected at bootstrap from env or vault.
- `expiresAt` — identity bundles expire. Forces periodic refresh and prevents replay of stale identity.

**Signing key storage:**
- Primary stores signing key encrypted at rest: `~/.opentrident/identity-signing-key.enc`
- Passphrase stored in env var `OPENTRIDENT_IDENTITY_PASSPHRASE`
- Key never transmitted. Only signatures travel.
- On new primary election, a new signing key is generated and the identity bundle is re-signed.

---

### Bundle 2: State Snapshot (`state-snapshot-{cid}.json.gz`)

Point-in-time capture of everything OpenTrident has learned and decided.

```json
{
  "version": 1,
  "snapshotId": "snap-2026.04.15-def456",
  "parentSnapshotId": "snap-2026.04.14-ccc111",
  "instanceId": "opentrident-primary-1",
  "generatedAt": 1744700000000,
  "contentHash": "sha256-...",
  "manifest": {
    "planner-state.json": { "bytes": 4096, "hash": "sha256-..." },
    "trust-telemetry.json": { "bytes": 2048, "hash": "sha256-..." },
    "memory.json": { "bytes": 81920, "hash": "sha256-..." },
    "event-journal.jsonl": { "bytes": 32768, "hash": "sha256-..." },
    "market-attention.json": { "bytes": 5120, "hash": "sha256-..." },
    "planner-goals.json": { "bytes": 3072, "hash": "sha256-..." }
  },
  "metadata": {
    "totalPlannerRows": 47,
    "pendingApprovals": 2,
    "trustScore": 0.83,
    "lastHeartbeat": 1744699998000
  },
  "signature": "base64-ed25519-signature"
}
```

Actual content gzipped and stored separately (content-addressed by CID).

**Snapshot chain:**
- Each snapshot references its parent (`parentSnapshotId`)
- Full state restore: fetch chain from latest snapshot back to genesis
- Incremental restore: fetch latest snapshot + replay WAL entries since then

**Event journal (`event-journal.jsonl`):**
```
{"ts":1744700000000,"type":"planner-goal-created","goalId":"g-001","domain":"market","score":0.72}
{"ts":1744700001000,"type":"worker-spawned","workerId":"w-042","actionClass":"brief"}
{"ts":1744700002000,"type":"trust-approval","domain":"market","approved":true}
{"ts":1744700003000,"type":"planner-goal-completed","goalId":"g-001","outcome":"approved"}
```

Append-only. Every significant event logged. Used for replay and audit.

---

### Bundle 3: Runtime Manifest (`runtime-manifest.json`)

What Docker image + compose config to run, without secrets.

```json
{
  "version": 1,
  "runtimeId": "ot-runtime-2026.04.10",
  "dockerImage": "opentrident:2026.4.15-r174041",
  "imageDigest": "sha256:abc123...",
  "composeFile": "docker-compose.vps.yml",
  "composeFileContent": "<yaml>",
  "deployScript": "<bash>",
  "healthCheckPath": "/healthz",
  "healthCheckPort": 18889,
  "requiredEnvVars": [
    "TELEGRAM_BOT_TOKEN",
    "OPENTRIDENT_GATEWAY_TOKEN",
    "MINIMAX_API_KEY",
    "OPENROUTER_API_KEY",
    "OPENTRIDENT_INSTANCE_ID",
    "OPENTRIDENT_STATE_DIR",
    "OPENTRIDENT_CONFIG_DIR"
  ],
  "entrypoint": "openclaw gateway"
}
```

Runtime bundle is publish-on-deploy. Each `scripts/deploy.sh` run publishes a new version to:
- GitHub releases (`DomLynch/OpenTrident-runtime`)
- IPFS (via Infura or Pinata gateway)

---

### Bundle 4: Bootstrap Manifest (`bootstrap.json`)

The single file that lets any blank machine become an OpenTrident node.

```json
{
  "version": 1,
  "bootstrapId": "bs-2026.04.15-ghi789",
  "instanceId": "opentrident-primary-1",
  "generatedAt": 1744700000000,
  "identityBundleId": "ot-identity-2026.04.15-abc123",
  "stateSnapshotId": "snap-2026.04.15-def456",
  "stateSnapshotCIDs": {
    "ipfs": "QmX...",
    "arweave": "ar://abc...",
    "github": "https://github.com/DomLynch/OpenTrident-runtime/releases/download/snap-def456/state-snapshot-def456.json.gz"
  },
  "runtimeManifestId": "ot-runtime-2026.04.10",
  "runtimeImageCID": {
    "ipfs": "QmY..."
  },
  "peers": [
    "https://vps1.opentrident.dom:8443",
    "tor:openotrivalnjxq.onion:8443"
  ],
  "signatures": {
    "identity": "base64-ed25519",
    "state": "base64-ed25519"
  }
}
```

**Bootstrap flow (new node):**
1. Fetch `bootstrap.json` from known URL or IPNS/GitHub
2. Verify signatures against known signing key (fingerprint committed in identity bundle)
3. Fetch identity bundle → verify signature → load identity
4. Fetch state snapshot by CID → verify chain → restore state
5. Pull Docker image by digest (content-addressed)
6. Start containers with env vars injected
7. New node is now current primary or a follower

---

## Leader Election

### Scoped Locks (already built)

`src/multi/instance-locks.ts` provides file-based scoped locks with 2-minute stale threshold.

**Scopes:**
- `telegram-bot` — only one instance may poll Telegram
- `leader-heartbeat` — only one instance runs the strategic loop
- `planner-write` — only one instance writes to planner state
- `public-channel` — only one instance publishes to public channels

**Lock file format (`instance-locks-v1.json`):**
```json
{
  "version": 1,
  "locks": {
    "telegram-bot": {
      "instanceId": "opentrident-primary-1",
      "acquiredAt": 1744699000000,
      "expiresAt": 1744699300000
    }
  }
}
```

Stored in replicated state directory. All instances see the same file.

**Lock acquisition at startup:**
```
1. Try acquireLock({ scope: "leader-heartbeat" })
2. If acquired → this instance is primary
3. If not acquired → this instance is follower
4. Primary runs heartbeat + planner
5. Followers poll for lock status, take over if primary disappears
```

**Takeover sequence:**
```
1. Follower detects primary lock expired
2. Follower acquires stale lock with forceStale: true
3. New primary broadcasts "election won" to peers
4. Telegram polling migrates to new primary
5. Old primary on recovery sees it lost lock → becomes follower or escalates
```

### Follower Behavior

Followers do NOT run planners or poll Telegram. They:
- Mirror state from primary (via state snapshot replication)
- Serve read requests (e.g., health checks, status queries)
- Stand ready to take over within 2 minutes of primary failure
- Run isolated workers assigned by primary via instance messaging

---

## Replication Model

### Primary → Follower Replication

**Continuous (within a session):**
- State writes go to shared NFS volume or brain memory (already shared)
- Planner state, trust telemetry, memory — all write to shared location
- No replication needed for in-process writes — all instances see same files

**Periodic snapshots (cross-session):**
- Primary publishes signed state snapshot every 30 minutes to:
  - IPFS (via Pinata/Infura gateway)
  - Arweave (permanent anchor)
  - GitHub releases (latest-snapshot tag)
  - Local NFS mount on home server (if available)

**Snapshot publication:**
```
cron (every 30 min):
  1. Write-lock planner state
  2. Generate state-snapshot-{cid}.json.gz
  3. Sign snapshot with identity signing key
  4. Update bootstrap.json with new snapshot CID
  5. Upload to IPFS, Arweave, GitHub
  6. Re-sign bootstrap.json
  7. Release planner write-lock
```

**Follower restore:**
```
on startup OR when detecting stale state:
  1. Fetch bootstrap.json
  2. Verify signatures
  3. Fetch latest state snapshot by CID
  4. Verify snapshot chain
  5. Decompress into state directory
  6. Resume as follower
```

### Content-Addressed Storage

All artifacts addressed by `sha256` of content, not by filename or URL.

**CID format:**
```
ot-{kind}-{first8chars(sha256)}-{timestamp}
Examples:
  ot-identity-abc12345-1744700000
  ot-state-def67890-1744700000
  ot-artifact-ghi11223-1744700000
```

Content-hash addressing means:
- Same content always has same CID — deduplication automatic
- Tampering is detectable — hash mismatch
- Any node can fetch from any provider that has the content

### Replicated State Locations

| Content | Primary Location | Replication Targets |
|---------|-----------------|---------------------|
| Identity bundle | GitHub releases | IPFS, Arweave |
| State snapshot | IPFS + Arweave | GitHub releases |
| Runtime image | Docker Hub | IPFS (image tar) |
| Bootstrap manifest | GitHub releases | IPFS |
| Event journal | Local NFS + brain memory | IPFS (append log) |
| Planner state | Shared NFS / brain memory | Snapshots on IPFS |

---

## Free/Open Network Targets

### Tier 1: Always Available (no setup cost)

**GitHub Releases** (`DomLynch/OpenTrident-runtime`)
- Identity bundles, state snapshots, runtime manifests
- Published via `gh release create`
- Access: public HTTPS
- Weakness: GitHub can de-platform

**GitHub Gist** (for small artifacts)
- Event journal entries, lock files, health status
- Public, versioned, editable by API
- Access: public HTTPS + personal access token for writes

### Tier 2: Distributed/Resilient (free tier available)

**IPFS via Pinata** (pinning service, free tier: 1GB)
- State snapshots, identity bundles, runtime artifacts
- Access: Pinata API + public IPFS gateway
- Pinning keeps content available
- Weakness: Pinata free tier is centralized, IPFS gateway can be blocked

**Arweave** (permanent storage, purchase once ~$1-5)
- Identity bundle + latest state snapshot permanently archived
- Access: Arweave gateway (public)
- Strength: truly permanent, censorship-resistant
- Weakness: purchase required, gateway can still be blocked regionally

**Cloudflare R2** (S3-compatible, free tier: 10GB/month)
- State snapshots, artifacts
- Access: S3 API + public bucket URL
- Weakness: Cloudflare account needed, can de-platform

### Tier 3: Network Overlay (anonymous access)

**Tor Hidden Services**
- OpenTrident control plane on `.onion` address
- Bootstrap manifest served over HTTPS on hidden service
- Access: Tor Browser or Tor daemon
- Strength: nearly impossible to censor or block
- Weakness: latency, complexity, requires Tor daemon running

**Yggdrasil** (mesh overlay, no ISP cooperation needed)
- Peer-to-peer addresses: `02:...` from any internet connection
- No public IP or ISP cooperation required
- Strength: completely self-contained network
- Weakness: both ends need Yggdrasil running, still experimental

### Tier 4: Long-Term Archive

**Permaweb / Arweave**
- Identity + genesis state stored permanently
- Content never deleted
- Access: public Arweave gateway
- Use case: genesis snapshot, founding identity

**IPFS Cluster** (self-hosted)
- Run your own IPFS pinning cluster across multiple machines
- Home server + VPS1 + cheap OVH VPS
- Strength: no third-party dependency
- Weakness: operational complexity

---

## Provider Abstraction

### Compute Layer Interface

```typescript
interface ComputeProvider {
  name(): string;

  // Provision
  provisionServer(opts: {
    location: string;
    serverType: string;
    sshKeyFingerprint: string;
    image?: string;
  }): Promise<{ serverId: string; ip: string; sshPort: number }>;

  // Check
  isServerReady(serverId: string): Promise<boolean>;

  // Decommission
  destroyServer(serverId: string): Promise<void>;

  // Access
  getSSHCommand(serverId: string, user: string): string;
}
```

**Implementations:**
- `HetznerComputeProvider` — current, uses Hetzner Cloud API
- `DigitalOceanProvider` — future, uses DO API
- `AkashProvider` — future, uses Akash RPC (crypto-paid)
- `ManualProvider` — for SSH-accessible servers without API

### Storage Layer Interface

```typescript
interface ContentStorage {
  name(): string;

  // Publish
  publish(content: Buffer, metadata: Record<string, string>): Promise<{ cid: string; url: string }>;

  // Fetch
  fetch(cid: string): Promise<Buffer>;

  // List
  list(prefix?: string): Promise<Array<{ cid: string; metadata: Record<string, string> }>>;

  // Delete
  delete(cid: string): Promise<void>;
}
```

**Implementations:**
- `IPFSStorage` — Pinata/Infura gateway
- `ArweaveStorage` — Arweave gateway + ArConnect wallet
- `GitHubReleaseStorage` — GitHub Releases API
- `LocalStorage` — local filesystem (for NFS/home server)

---

## Implementation Order

### Phase P1: Signed Identity + Snapshot (1 week)

1. Create `src/persistence/identity-bundle.ts`
   - `generateIdentityBundle()` — collects identity files + config
   - `signIdentityBundle(bundle, signingKey)` — Ed25519 sign
   - `verifyIdentityBundle(bundle)` — verify signature
   - `publishIdentityBundle(bundle)` — publish to GitHub releases

2. Create `src/persistence/state-snapshot.ts`
   - `generateSnapshot(stateDir)` — gzips all state files, generates manifest
   - `signSnapshot(snapshot)` — sign manifest
   - `verifySnapshot(snapshot)` — verify chain + signature
   - `publishSnapshot(snapshot)` — publish to IPFS + Arweave + GitHub

3. Create `src/persistence/bootstrap.ts`
   - `generateBootstrap(identityId, snapshotId, runtimeId)` — creates bootstrap.json
   - `publishBootstrap(bootstrap)` — publish to GitHub releases
   - `fetchAndVerifyBootstrap(url)` — fetch + verify signatures

4. Wire into deploy script: after each `docker build`, publish new runtime manifest + identity bundle

### Phase P2: Replication + Failover (1 week)

1. Extend `src/multi/instance-locks.ts` with leader election logic
2. Add follower mode to heartbeat-runner: when `leader-heartbeat` lock not held, skip strategic loop
3. Add snapshot publication cron to heartbeat-runner (every 30 min)
4. Add bootstrap refresh: on follower startup, fetch latest bootstrap.json, restore state
5. Test: kill primary → verify follower takes over within 2 minutes

### Phase P3: Multi-Cloud Provisioning (1 week)

1. Implement `DigitalOceanComputeProvider`
2. Implement `AkashComputeProvider`
3. Add provider selection logic: choose cheapest available that meets specs
4. Test: provision a DO VPS, deploy OpenTrident to it, failover to it

### Phase P4: Permanent Anchors (3 days)

1. Set up Arweave wallet (~$5)
2. Publish genesis identity bundle + genesis state snapshot to Arweave
3. Add Arweave as replication target in snapshot publication
4. Verify: fetch genesis state from Arweave gateway directly

---

## Key Files

```
src/
  persistence/
    identity-bundle.ts     # Generate, sign, verify, publish identity
    state-snapshot.ts      # Snapshot, sign, verify, publish state
    bootstrap.ts           # Bootstrap manifest generation and publication
    content-storage.ts     # Storage provider interface
    providers/
      ipfs-storage.ts     # IPFS via Pinata
      arweave-storage.ts  # Arweave via ArConnect
      github-storage.ts    # GitHub Releases
    compute-providers/
      hetzner-provider.ts  # Already: Hetzner Cloud API
      do-provider.ts       # DigitalOcean API
      akash-provider.ts     # Akash RPC
    leader-election.ts    # Leader election over instance locks
    replication.ts         # Snapshot publication + follower restore
```

---

## Security Properties

| Threat | Protection |
|--------|------------|
| Host compromised | Secrets never on disk — placeholder values in bundle, injected at boot |
| State tampered | SHA256 content hash + Ed25519 signature on every bundle |
| Identity stolen | Signing key encrypted at rest, passphrase in env |
| Replay attack | Identity bundles expire + sequence numbers in event journal |
| Single provider failure | State replicated to IPFS + Arweave + GitHub simultaneously |
| Botnet/takeover | All write actions require planner confirmation until autonomy ladder promotes |
| Secrets leaked | `HETZNER_API_TOKEN` etc. never in identity bundle — only names, not values |
