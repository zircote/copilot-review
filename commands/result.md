---
description: Display results of a completed Copilot job
argument-hint: "<job-id>"
allowed-tools: ["Bash"]
---

Display the full results of a completed Copilot job.

`node $CLAUDE_PLUGIN_ROOT/scripts/copilot-companion.mjs result $ARGUMENTS`

Present the results to the user. If the job is still running, show its current status.
