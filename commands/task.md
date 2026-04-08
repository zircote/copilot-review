---
description: Delegate a coding task to Copilot
argument-hint: "<task description>"
allowed-tools: ["Bash"]
---

Delegate a coding task to GitHub Copilot for background execution.

`node $CLAUDE_PLUGIN_ROOT/scripts/copilot-companion.mjs task $ARGUMENTS`

Display the job ID and status to the user. Use `/copilot-review status` to check progress and `/copilot-review result <job-id>` to retrieve results.
