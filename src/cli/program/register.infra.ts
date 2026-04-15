import type { Command } from "commander";
import { healthCheckCommand } from "../../migration/health-monitor.js";
import { migrateCommand } from "../../migration/migrate.js";
import { provisionCommand } from "../../migration/compute-provisioner.js";
import { defaultRuntime } from "../../runtime.js";
import { runCommandWithRuntime } from "../cli-utils.js";

export function registerInfraCommand(program: Command) {
  const infra = program.command("infra").description("Infrastructure management");

  infra
    .command("health-check")
    .description("Run infrastructure health checks (disk, memory, Telegram, model API, SSL)")
    .action(async () => {
      await runCommandWithRuntime(defaultRuntime, async () => {
        await healthCheckCommand();
      });
    });

  infra
    .command("provision")
    .description("Provision a new VPS on Hetzner (dry-run by default)")
    .option("--server-type <type>", "Server type (cpx11/cpx21/cpx31/cpx41/cpx51)", "cpx21")
    .option("--location <location>", "Location (ash/hil/fsn1/hel1/sin)", "ash")
    .option("--dry-run", "Show provisioning plan without creating server", true)
    .option("--no-dry-run", "Actually provision the server (requires HETZNER_API_TOKEN)")
    .action(async (opts) => {
      await runCommandWithRuntime(defaultRuntime, async () => {
        await provisionCommand({
          serverType: opts.serverType,
          location: opts.location,
          dryRun: opts.dryRun !== false,
        });
      });
    });

  infra
    .command("migrate")
    .description("Execute full self-migration (generates manifest, provisions server, deploys, health checks)")
    .option("--reason <reason>", "Migration reason (disk-low/memory-high/gateway-failing/manual/test)", "test")
    .option("--target <provider>", "Target provider (hetzner/manual)", "manual")
    .option("--server-type <type>", "Server type for hetzner (cpx11/cpx21/cpx31/cpx41/cpx51)", "cpx21")
    .option("--location <location>", "Location for hetzner (ash/hil/fsn1/hel1/sin)", "ash")
    .option("--dry-run", "Show migration plan without executing", true)
    .option("--no-dry-run", "Actually execute migration (requires HETZNER_API_TOKEN)")
    .action(async (opts) => {
      await runCommandWithRuntime(defaultRuntime, async () => {
        await migrateCommand({
          reason: opts.reason,
          dryRun: opts.dryRun !== false,
          targetProvider: opts.target,
          serverType: opts.serverType,
          location: opts.location,
        });
      });
    });
}