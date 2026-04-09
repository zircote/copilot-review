---
description: Verify Copilot auth and configuration
allowed-tools: ["Bash"]
---

Verify GitHub Copilot authentication and configuration.

`node $CLAUDE_PLUGIN_ROOT/scripts/copilot-companion.mjs setup $ARGUMENTS`

Display the setup status to the user. If auth is missing, provide instructions for configuring a GitHub token with Copilot Requests permission.

Pass `--enable-review-gate` to require Copilot review before session stop.
Pass `--disable-review-gate` to disable the stop review gate.
