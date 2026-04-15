import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { exec } from "node:child_process";
import { promisify } from "node:util";
import { generateDeploymentManifest, saveManifest, type DeploymentManifest } from "./deployment-manifest.js";
import { runHealthChecks, type HealthCheckResult } from "./health-monitor.js";
import { provisionServer, checkServerReady, getServerIp, decommissionServer, type ProvisionParams } from "./compute-provisioner.js";
import { executeFlush } from "../planner/planner-flush.js";

const execAsync = promisify(exec);

export type MigrationResult = {
  success: boolean;
  reason: string;
  steps: MigrationStep[];
  newServerId?: string;
  newServerIp?: string;
  error?: string;
};

export type MigrationStep = {
  name: string;
  status: "pending" | "running" | "done" | "failed" | "skipped";
  message?: string;
};

export type MigrationReason = "disk-low" | "memory-high" | "gateway-failing" | "manual" | "test";

async function executeStep(step: MigrationStep, fn: () => Promise<void>): Promise<void> {
  step.status = "running";
  try {
    await fn();
    step.status = "done";
  } catch (err) {
    step.status = "failed";
    step.message = String(err);
    throw err;
  }
}

async function sshExec(sshKeyPath: string, user: string, host: string, command: string): Promise<string> {
  const { stdout, stderr } = await execAsync(
    `ssh -i "${sshKeyPath}" -o StrictHostKeyChecking=no -o ConnectTimeout=30 ${user}@${host} "${command.replace(/"/g, '\\"')}"`
  );
  return (stdout + stderr).trim();
}

async function sshExecInteractive(sshKeyPath: string, user: string, host: string, command: string): Promise<void> {
  return new Promise((resolve, reject) => {
    exec(
      `ssh -i "${sshKeyPath}" -o StrictHostKeyChecking=no -o ConnectTimeout=30 ${user}@${host} "${command.replace(/"/g, '\\"')}"`,
      (err, stdout, stderr) => {
        if (err) reject(new Error(`${err.message}\n${stderr}`));
        else resolve();
      }
    );
  });
}

export interface DeployToNewServerParams {
  newServerIp: string;
  sshKeyPath: string;
  sshUser?: string;
  imageName?: string;
  stateDir?: string;
  composeFile?: string;
  envFile?: string;
  runtimeDir?: string;
  healthCheckPort?: number;
}

export async function deployToNewServer(params: DeployToNewServerParams): Promise<void> {
  const {
    newServerIp,
    sshKeyPath,
    sshUser = "root",
    imageName = "opentrident:latest",
    stateDir = "/opt/opentrident-data",
    composeFile = "docker-compose.vps.yml",
    envFile = ".env",
    runtimeDir = "/opt/opentrident",
    healthCheckPort = 18889,
  } = params;

  const ssh = (cmd: string) => sshExec(sshKeyPath, sshUser, newServerIp, cmd);
  const sshi = (cmd: string) => sshExecInteractive(sshKeyPath, sshUser, newServerIp, cmd);

  let localTmpDir: string;
  try {
    localTmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "opentrident-migrate-"));
  } catch {
    localTmpDir = "";
  }

  const cleanup = () => {
    if (localTmpDir) {
      fs.rm(localTmpDir, { recursive: true, force: true }).catch(() => {});
    }
  };

  try {
    console.log(`[deploy] Installing Docker on ${newServerIp}...`);
    await sshi(`curl -fsSL https://get.docker.com | sh`);
    await sshi(`systemctl enable docker`);
    await sshi(`update-alternatives --set iptables /usr/sbin/iptables-legacy || true`);
    await sshi(`update-alternatives --set ip6tables /usr/sbin/ip6tables-legacy || true`);
    await sshi(`systemctl start docker`);
    await sshi(`systemctl status docker --no-pager || true`);

    console.log(`[deploy] Installing docker-compose on ${newServerIp}...`);
    await sshi(`curl -L "https://github.com/docker/compose/releases/download/v2.24.0/docker-compose-linux-x86_64" -o /usr/local/bin/docker-compose && chmod +x /usr/local/bin/docker-compose`);

    const imageTar = path.join(localTmpDir, "opentrident-image.tar");

    console.log(`[deploy] Saving Docker image ${imageName}...`);
    await execAsync(`docker save ${imageName} -o "${imageTar}"`);

    console.log(`[deploy] Copying image to ${newServerIp}...`);
    await sshi(`mkdir -p /tmp`);
    await execAsync(`scp -i "${sshKeyPath}" -o StrictHostKeyChecking=no "${imageTar}" ${sshUser}@${newServerIp}:/tmp/opentrident-image.tar`);

    console.log(`[deploy] Loading Docker image on ${newServerIp}...`);
    await sshi(`docker load -i /tmp/opentrident-image.tar`);
    await sshi(`rm /tmp/opentrident-image.tar`);

    console.log(`[deploy] Copying state directory to ${newServerIp}...`);
    const stateHostDir = process.env.OPENTRIDENT_CONFIG_DIR ?? "/opt/opentrident-data/config";
    await sshi(`mkdir -p "${stateHostDir}"`);
    await execAsync(
      `rsync -avz -e "ssh -i '${sshKeyPath}' -o StrictHostKeyChecking=no" ` +
      `"${stateHostDir}/" ${sshUser}@${newServerIp}:"${stateHostDir}/"`
    );

    console.log(`[deploy] Copying runtime to ${newServerIp}...`);
    await sshi(`mkdir -p ${runtimeDir}`);
    await execAsync(
      `rsync -avz -e "ssh -i '${sshKeyPath}' -o StrictHostKeyChecking=no" ` +
      `--exclude='.git' --exclude='node_modules' --exclude='dist' --exclude='*.log' ` +
      `--exclude='.env' --exclude='*.tar' --exclude='.DS_Store' ` +
      `"./" ${sshUser}@${newServerIp}:${runtimeDir}/`
    );

    const composeContent = await fs.readFile(composeFile, "utf-8");
    await sshi(`mkdir -p ${runtimeDir} && cat > ${runtimeDir}/${path.basename(composeFile)} << 'COMPOSE_EOF'\n${composeContent}\nCOMPOSE_EOF`);

    const envContent = await fs.readFile(envFile, "utf-8");
    await sshi(`cat > ${runtimeDir}/${envFile} << 'ENV_EOF'\n${envContent}\nENV_EOF`);

    await sshi(`grep -q 'DOCKER_BUILDKIT=1' ${runtimeDir}/${envFile} || echo 'DOCKER_BUILDKIT=1' >> ${runtimeDir}/${envFile}`);
    await sshi(`grep -q 'OPENTRIDENT_IMAGE=' ${runtimeDir}/${envFile} || echo 'OPENTRIDENT_IMAGE=${imageName}' >> ${runtimeDir}/${envFile}`);

    console.log(`[deploy] Starting containers on ${newServerIp}...`);
    await sshi(`cd ${runtimeDir} && DOCKER_BUILDKIT=1 docker compose -f ${path.basename(composeFile)} up -d`);

    console.log(`[deploy] Waiting for gateway to be ready on ${newServerIp}...`);
    let healthOk = false;
    for (let i = 0; i < 30; i++) {
      await new Promise(r => setTimeout(r, 2000));
      try {
        const result = await ssh(`curl -sf http://127.0.0.1:${healthCheckPort}/healthz`);
        if (result.includes('"ok":true') || result.includes('"status":"live"')) {
          healthOk = true;
          console.log(`[deploy] Gateway healthy after ${(i + 1) * 2}s`);
          break;
        }
      } catch {
        // not ready yet
      }
    }
    if (!healthOk) {
      throw new Error(`Gateway failed to become healthy on ${newServerIp} after 60s`);
    }

    cleanup();
    console.log(`[deploy] Deployment to ${newServerIp} complete and verified`);
  } finally {
    cleanup();
  }
}

export async function executeMigration(params: {
  reason: string;
  targetProvider: "hetzner" | "manual";
  dryRun: boolean;
  serverType?: string;
  location?: string;
}): Promise<MigrationResult> {
  const { reason, targetProvider, dryRun, serverType = "cpx21", location = "ash" } = params;

  const steps: MigrationStep[] = [
    { name: "generate_manifest", status: "pending" },
    { name: "run_health_checks", status: "pending" },
    { name: "provision_server", status: "pending" },
    { name: "deploy_to_new_server", status: "pending" },
    { name: "run_health_checks_new", status: "pending" },
    { name: "update_dns", status: "pending" },
    { name: "parallel_run", status: "pending" },
    { name: "decommission_old", status: "pending" },
  ];

  const result: MigrationResult = {
    success: false,
    reason,
    steps,
  };

  if (dryRun) {
    steps.forEach((s) => (s.status = "skipped"));
    return {
      ...result,
      success: true,
      steps: steps.map((s) => ({ ...s, message: `(dry-run) Would ${s.name}` })),
    };
  }

  try {
    await executeStep(steps[0], async () => {
      const manifest = await generateDeploymentManifest();
      await saveManifest(manifest);
      steps[0].message = `Manifest generated with ${Object.keys(manifest.state).length} state files`;
    });

    await executeStep(steps[1], async () => {
      const health = await runHealthChecks();
      if (!health.overallHealthy) {
        throw new Error(`Health checks failed: ${health.migrationReason ?? "unknown"}`);
      }
      steps[1].message = "All health checks passed";
    });

    const sshKeyPath = process.env.SSH_KEY_PATH ?? `${os.homedir()}/.ssh/binance_futures_tool`;

    if (targetProvider === "hetzner") {
      await executeStep(steps[2], async () => {
        const provisionResult = await provisionServer({
          serverType,
          location,
          sshKeyFingerprint: process.env.HETZNER_SSH_KEY_FINGERPRINT ?? "",
          image: "ubuntu-24.04",
          dryRun: false,
        } as ProvisionParams);
        if (provisionResult.dryRun) {
          throw new Error("Provision returned dry-run result unexpectedly");
        }
        result.newServerId = provisionResult.id;
        steps[2].message = `Server ${provisionResult.id} created, IP: ${provisionResult.ip}`;
      });

      await executeStep(steps[3], async () => {
        if (!result.newServerId) throw new Error("No server ID");
        const ready = await checkServerReady(result.newServerId);
        if (!ready.ready) {
          throw new Error(`Server not ready after polling`);
        }
        result.newServerIp = ready.ip ?? null;
        steps[3].message = `Server ready at ${result.newServerIp}, starting deployment...`;

        await deployToNewServer({
          newServerIp: result.newServerIp,
          sshKeyPath,
        });
        steps[3].message = `Deployment complete on ${result.newServerIp}`;
      });
    } else {
      steps[2].status = "skipped";
      steps[2].message = "Manual provider - skipping server creation";
      steps[3].status = "skipped";
      steps[3].message = "Manual provider - waiting for user to deploy";
    }

    await executeStep(steps[4], async () => {
      if (!result.newServerIp) throw new Error("No new server IP");
      const sshKeyPath = process.env.SSH_KEY_PATH ?? `${os.homedir()}/.ssh/binance_futures_tool`;
      const healthResult = await sshExec(sshKeyPath, "root", result.newServerIp,
        `curl -sf http://127.0.0.1:18889/healthz || curl -sf http://127.0.0.1:18891/health`);
      if (!healthResult.includes('"ok":true') && !healthResult.includes('"status":"live"')) {
        throw new Error(`New server health check failed: ${healthResult}`);
      }
      steps[4].message = `New server healthy: ${healthResult}`;
    });

    steps[5].status = "skipped";
    steps[5].message = "Manual DNS update required - surface instructions";

    steps[6].status = "skipped";
    steps[6].message = "Run both old + new in parallel for 1 hour";

    steps[7].status = "skipped";
    steps[7].message = "Decommission old server after parallel run";

    result.success = true;

    await executeFlush({
      trigger: "migration-finish",
    }).catch(() => {});
  } catch (err) {
    result.error = String(err);
    if (result.newServerId && targetProvider === "hetzner") {
      try {
        await decommissionServer(result.newServerId);
        steps[7].message = `Decommissioned failed server ${result.newServerId}`;
      } catch {
        steps[7].message = `Failed to decommission server ${result.newServerId}`;
      }
    }
  }

  return result;
}

export async function migrateCommand(params: { reason?: string; dryRun?: boolean; targetProvider?: string; serverType?: string; location?: string }): Promise<void> {
  const { reason = "test", dryRun = true, targetProvider = "manual", serverType, location } = params;

  console.log(`=== MIGRATION ${dryRun ? "(DRY RUN)" : ""} ===`);
  console.log(`Reason: ${reason}`);
  console.log(`Target: ${targetProvider}`);
  console.log("");

  const result = await executeMigration({
    reason,
    targetProvider: targetProvider as "hetzner" | "manual",
    dryRun,
    serverType,
    location,
  });

  console.log("\n=== MIGRATION RESULT ===");
  console.log(`Success: ${result.success}`);
  console.log(`Reason: ${result.reason}`);

  if (result.error) {
    console.log(`Error: ${result.error}`);
  }

  if (result.newServerId) {
    console.log(`New Server ID: ${result.newServerId}`);
    console.log(`New Server IP: ${result.newServerIp ?? "unknown"}`);
  }

  console.log("\nSteps:");
  for (const step of result.steps) {
    const icon = step.status === "done" ? "✅" : step.status === "failed" ? "❌" : step.status === "skipped" ? "⏭️" : step.status === "running" ? "🔄" : "⏳";
    console.log(`  ${icon} ${step.name}: ${step.status} ${step.message ? `- ${step.message}` : ""}`);
  }
}