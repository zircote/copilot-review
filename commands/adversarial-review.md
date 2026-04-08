---
description: Run an adversarial security-focused Copilot code review
argument-hint: "[--staged] [--files <glob>]"
allowed-tools: ["Bash"]
---

Run an adversarial security-focused code review using GitHub Copilot on the current git diff.

`node $CLAUDE_PLUGIN_ROOT/scripts/copilot-companion.mjs adversarial-review $ARGUMENTS`

Display the review output to the user. If the exit code is non-zero, explain the error and suggest remediation.
