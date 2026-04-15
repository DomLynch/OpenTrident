import fs from "node:fs/promises";
import path from "node:path";
import { exec } from "node:child_process";
import { promisify } from "node:util";
import { generateDeploymentManifest, saveManifest, type DeploymentManifest } from "./deployment-manifest.js";
import { runHealthChecks, type HealthCheckResult } from "./health-monitor.js";
import { provisionServer, checkServerReady, getServerIp, decommissionServer, type ProvisionParams } from "./compute-provisioner.js";

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

export async function executeMigration(params: {
  reason: string;
  targetProvider: "hetzner" | "manual";
  dryRun: boolean;
  serverType?: string;
  location?: string;
}): Promise<MigrationResult> {
  const { reason, targetProvider, dryRun, serverType = "cx21", location = "nbg1" } = params;

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
        steps[3].message = `Server is ready at ${result.newServerIp}`;
      });
    } else {
      steps[2].status = "skipped";
      steps[2].message = "Manual provider - skipping server creation";
      steps[3].status = "skipped";
      steps[3].message = "Manual provider - waiting for user to deploy";
    }

    await executeStep(steps[4], async () => {
      const health = await runHealthChecks();
      if (!health.overallHealthy) {
        throw new Error(`New server health checks failed`);
      }
      steps[4].message = "New server healthy";
    });

    steps[5].status = "skipped";
    steps[5].message = "Manual DNS update required - surface instructions";

    steps[6].status = "skipped";
    steps[6].message = "Run both old + new in parallel for 1 hour";

    steps[7].status = "skipped";
    steps[7].message = "Decommission old server after parallel run";

    result.success = true;
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