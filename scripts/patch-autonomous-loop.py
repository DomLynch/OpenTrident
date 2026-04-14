#!/usr/bin/env python3
"""Patch heartbeat-runner.ts to add autonomous loop gate guard on spawns."""

def patch_heartbeat_runner(content: str) -> str:
    if 'checkAutonomousGate' not in content:
        old = 'import { processWorkerResults } from "../planner/planner-result-handler.js";'
        new = old + '\nimport { checkAutonomousGate } from "../planner/autonomous-loop.js";'
        content = content.replace(old, new)

    if 'const autonomousGate = await checkAutonomousGate' not in content:
        marker = '  if (plannerDecision?.mode === "spawn_readonly" && plannerRow && !spawnRateLimited) {'
        gate_var = '  let autonomousGate = { canRun: true };\n  try {\n    autonomousGate = await checkAutonomousGate({\n      nowMs: startedAt,\n      entry,\n      plannerRows,\n    });\n  } catch {}\n\n'
        content = content.replace(marker, gate_var + marker)

    for mode in ['"spawn_readonly"', '"send"', '"draft_reply"', '"draft_issue"', '"brief"']:
        old = f'  if (plannerDecision?.mode === {mode} && plannerRow && !spawnRateLimited) {{'
        new = f'  if (plannerDecision?.mode === {mode} && plannerRow && !spawnRateLimited && autonomousGate.canRun) {{'
        content = content.replace(old, new)

    return content


if __name__ == "__main__":
    import sys
    filepath = sys.argv[1] if len(sys.argv) > 1 else "/opt/opentrident/src/infra/heartbeat-runner.ts"
    with open(filepath, "r", encoding="utf-8") as f:
        content = f.read()
    patched = patch_heartbeat_runner(content)
    with open(filepath, "w", encoding="utf-8") as f:
        f.write(patched)
    print(f"Patched {filepath}")
