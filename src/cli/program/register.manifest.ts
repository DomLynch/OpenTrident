import type { Command } from "commander";
import { manifestGenerateCommand } from "../../migration/deployment-manifest.js";
import { defaultRuntime } from "../../runtime.js";
import { runCommandWithRuntime } from "../cli-utils.js";

export function registerManifestCommand(program: Command) {
  const manifest = program
    .command("manifest")
    .description("Generate and validate OpenTrident deployment manifests");

  manifest
    .command("generate")
    .description("Generate a deployment manifest from current state")
    .action(async () => {
      await runCommandWithRuntime(defaultRuntime, async () => {
        await manifestGenerateCommand();
      });
    });
}