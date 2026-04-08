---
description: Run a Copilot-powered code review on the current diff
argument-hint: "[--staged] [--files <glob>]"
allowed-tools: ["Bash"]
---

Run a code review using GitHub Copilot on the current git diff.

`node $CLAUDE_PLUGIN_ROOT/scripts/copilot-companion.mjs review $ARGUMENTS`

Display the review output to the user. If the exit code is non-zero, explain the error and suggest remediation.
