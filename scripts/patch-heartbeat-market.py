#!/usr/bin/env python3
"""Patch heartbeat-runner.ts on VPS to wire in market events collector."""

import re

def patch_heartbeat_runner(content: str) -> str:
    # Add import for collectHeartbeatMarketEvents
    if 'collectHeartbeatMarketEvents' not in content:
        content = re.sub(
            r'(import \{ collectHeartbeatGmailEvents \} from "./heartbeat-gmail-attention\.js";)',
            r'\1\nimport { collectHeartbeatMarketEvents } from "./heartbeat-market-attention.js";',
            content
        )

    # Update the Promise.all destructuring and call
    old_promise_all = '''  const [gmailEventEntries, repoEventEntries, githubEventEntries] =
    reasonFlags.isExecEventReason || reasonFlags.isCronEventReason
      ? [[], [], []]
      : await Promise.all([
          collectHeartbeatGmailEvents({ nowMs: params.nowMs }),
          collectHeartbeatRepoEvents({ nowMs: params.nowMs }),
          collectHeartbeatGithubEvents({ nowMs: params.nowMs }),
        ]);
  const pendingEventEntries = [
    ...queuedEventEntries,
    ...gmailEventEntries,
    ...repoEventEntries,
    ...githubEventEntries,
  ];'''

    new_promise_all = '''  const [gmailEventEntries, repoEventEntries, githubEventEntries, marketEventEntries] =
    reasonFlags.isExecEventReason || reasonFlags.isCronEventReason
      ? [[], [], [], []]
      : await Promise.all([
          collectHeartbeatGmailEvents({ nowMs: params.nowMs }),
          collectHeartbeatRepoEvents({ nowMs: params.nowMs }),
          collectHeartbeatGithubEvents({ nowMs: params.nowMs }),
          collectHeartbeatMarketEvents({ nowMs: params.nowMs }),
        ]);
  const pendingEventEntries = [
    ...queuedEventEntries,
    ...gmailEventEntries,
    ...repoEventEntries,
    ...githubEventEntries,
    ...marketEventEntries,
  ];'''

    content = content.replace(old_promise_all, new_promise_all)
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
