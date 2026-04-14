import base64
import os
import sys

# 1. Write planner-approval-handler.ts
src_path = "/opt/opentrident/src/planner/planner-approval-handler.ts"
with open("/tmp/approvalhandler.b64", "rb") as f:
    decoded = base64.b64decode(f.read())
with open(src_path, "wb") as f:
    f.write(decoded)
size = os.path.getsize(src_path)
print(f"Wrote planner-approval-handler.ts: {size} bytes")

# 2. Patch server-methods/chat.ts
chat_file = "/opt/opentrident/src/gateway/server-methods/chat.ts"
with open(chat_file, "r") as f:
    content = f.read()

# Add import after last import line
lines = content.split("\n")
last_import_idx = -1
for i, line in enumerate(lines):
    stripped = line.strip()
    if stripped.startswith("import ") or stripped.startswith("import{"):
        last_import_idx = i

print(f"Last import at line {last_import_idx + 1}")

new_import = 'import { checkAndHandleApproval } from "../../planner/planner-approval-handler.js";'
lines.insert(last_import_idx + 1, new_import)

# Find injection point: after sendPolicy deny block
injection_marker = "      return;\n    }\n\n    if (stopCommand) {"
replacement = """      return;
    }

    // Planner approval check — intercept approve/reject replies for pending drafts
    const approvalResult = await checkAndHandleApproval({
      sessionKey,
      inboundText: inboundMessage,
      nowMs: Date.now(),
    });
    if (approvalResult.handled) {
      respond(true, { ok: true, message: approvalResult.message }, undefined, {
        approvalHandled: true,
        approved: approvalResult.approved,
      });
      return;
    }

    if (stopCommand) {"""

if injection_marker not in content:
    print("ERROR: injection marker not found in chat.ts!")
    sys.exit(1)

new_content = content.replace(injection_marker, replacement)
with open(chat_file, "w") as f:
    f.write(new_content)
print("Patched server-methods/chat.ts")

# Verify the patch
with open(chat_file, "r") as f:
    patched = f.read()
if "checkAndHandleApproval" in patched:
    print("VERIFIED: checkAndHandleApproval is in patched chat.ts")
else:
    print("ERROR: patch verification failed!")
    sys.exit(1)
