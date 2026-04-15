import { exec } from "node:child_process";
import { promisify } from "node:util";
import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";

const execAsync = promisify(exec);

export type ServerType = {
  id: string;
  name: string;
  cores: number;
  memory: number;
  disk: number;
  pricePerMonth: number;
};

export type ProvisionedServer = {
  id: string;
  name: string;
  ip: string;
  status: string;
};

export type ProvisionParams = {
  serverType: string;
  location: string;
  sshKeyFingerprint: string;
  image: string;
  dryRun: boolean;
};

const SERVER_TYPES: Record<string, ServerType> = {
  "cx11": { id: "cx11", name: "CX11", cores: 1, memory: 2, disk: 20, pricePerMonth: 3.89 },
  "cx21": { id: "cx21", name: "CX21", cores: 2, memory: 4, disk: 40, pricePerMonth: 6.89 },
  "cx31": { id: "cx31", name: "CX31", cores: 2, memory: 8, disk: 80, pricePerMonth: 11.89 },
  "cx41": { id: "cx41", name: "CX41", cores: 4, memory: 16, disk: 160, pricePerMonth: 19.89 },
  "cx51": { id: "cx51", name: "CX51", cores: 4, memory: 32, disk: 240, pricePerMonth: 39.89 },
};

const LOCATIONS: Record<string, string> = {
  "nbg1": "Nuremberg 1 (Germany)",
  "fsn1": "Falkenstein 1 (Germany)",
  "hel1": "Helsinki 1 (Finland)",
  "ash": "Ashburn, VA (USA)",
  "hil": "Hill Country, TX (USA)",
};

const CLOUD_INIT = `#cloud-config
packages:
  - docker.io
  - docker-compose-v2
  - git
runcmd:
  - systemctl enable docker
  - systemctl start docker
`;

export async function listAvailableServers(): Promise<ServerType[]> {
  return Object.values(SERVER_TYPES);
}

export async function provisionServer(params: ProvisionParams): Promise<ProvisionedServer | { dryRun: true; plan: string }> {
  const { serverType, location, sshKeyFingerprint, image, dryRun } = params;
  const serverInfo = SERVER_TYPES[serverType];

  if (!serverInfo) {
    throw new Error(`Unknown server type: ${serverType}. Available: ${Object.keys(SERVER_TYPES).join(", ")}`);
  }

  const locationName = LOCATIONS[location] ?? location;

  const plan = `
=== HETZNER SERVER PROVISIONING PLAN ===

Server Type: ${serverInfo.name} (${serverInfo.cores} vCPU, ${serverInfo.memory}GB RAM, ${serverInfo.disk}GB SSD)
Location: ${locationName}
Image: ${image}
SSH Key: ${sshKeyFingerprint || "(none)"}
Monthly Cost: €${serverInfo.pricePerMonth}

Cloud-Init Script:
${CLOUD_INIT}

Estimated provisioning time: 2-5 minutes
Estimated total monthly cost (with bandwidth): €${serverInfo.pricePerMonth + 5}

To provision manually:
1. Login to Hetzner Cloud Console
2. Create new server with above specs
3. Add SSH key
4. Select ${image} image
5. Run cloud-init user data
`;

  if (dryRun) {
    return { dryRun: true, plan };
  }

  const apiToken = process.env.HETZNER_API_TOKEN;
  if (!apiToken) {
    throw new Error("HETZNER_API_TOKEN not set");
  }

  try {
    const createResp = await fetch("https://api.hetzner.cloud/v1/servers", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        name: `opentrident-${Date.now()}`,
        server_type: serverType,
        location,
        image,
        ssh_keys: sshKeyFingerprint ? [sshKeyFingerprint] : [],
        user_data: CLOUD_INIT,
      }),
    });

    if (!createResp.ok) {
      const err = await createResp.json() as { error?: { message?: string } };
      throw new Error(`Hetzner API error: ${err.error?.message ?? createResp.statusText}`);
    }

    const data = await createResp.json() as { server: { id: string; name: string; public_net?: { ipv4?: { ip?: string } } } };
    const server = data.server;

    return {
      id: server.id,
      name: server.name,
      ip: server.public_net?.ipv4?.ip ?? "unknown",
      status: "creating",
    };
  } catch (err) {
    throw new Error(`Failed to provision server: ${err}`);
  }
}

export async function checkServerReady(serverId: string): Promise<{ ready: boolean; ip?: string }> {
  const apiToken = process.env.HETZNER_API_TOKEN;
  if (!apiToken) throw new Error("HETZNER_API_TOKEN not set");

  try {
    const resp = await fetch(`https://api.hetzner.cloud/v1/servers/${serverId}`, {
      headers: { Authorization: `Bearer ${apiToken}` },
    });

    if (!resp.ok) {
      throw new Error(`Server check failed: ${resp.statusText}`);
    }

    const data = await resp.json() as { server: { status: string; public_net?: { ipv4?: { ip?: string } } } };
    return {
      ready: data.server.status === "running",
      ip: data.server.public_net?.ipv4?.ip,
    };
  } catch (err) {
    return { ready: false };
  }
}

export async function getServerIp(serverId: string): Promise<string | null> {
  const apiToken = process.env.HETZNER_API_TOKEN;
  if (!apiToken) throw new Error("HETZNER_API_TOKEN not set");

  try {
    const resp = await fetch(`https://api.hetzner.cloud/v1/servers/${serverId}`, {
      headers: { Authorization: `Bearer ${apiToken}` },
    });

    if (!resp.ok) return null;

    const data = await resp.json() as { server: { public_net?: { ipv4?: { ip?: string } } } };
    return data.server.public_net?.ipv4?.ip ?? null;
  } catch {
    return null;
  }
}

export async function decommissionServer(serverId: string): Promise<void> {
  const apiToken = process.env.HETZNER_API_TOKEN;
  if (!apiToken) throw new Error("HETZNER_API_TOKEN not set");

  const resp = await fetch(`https://api.hetzner.cloud/v1/servers/${serverId}`, {
    method: "DELETE",
    headers: { Authorization: `Bearer ${apiToken}` },
  });

  if (!resp.ok) {
    throw new Error(`Failed to decommission server: ${resp.statusText}`);
  }
}

export async function provisionCommand(params: { serverType?: string; location?: string; dryRun?: boolean }): Promise<void> {
  const { serverType = "cx21", location = "nbg1", dryRun = true } = params;

  const servers = await listAvailableServers();
  const selected = servers.find((s) => s.id === serverType);

  const sshKeyFingerprint = process.env.HETZNER_SSH_KEY_FINGERPRINT;

  const result = await provisionServer({
    serverType,
    location,
    sshKeyFingerprint: sshKeyFingerprint ?? "",
    image: "ubuntu-24.04",
    dryRun,
  });

  if (result.dryRun) {
    console.log(result.plan);
  } else {
    console.log(JSON.stringify(result, null, 2));
  }
}