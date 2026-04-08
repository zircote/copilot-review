---
description: Verify Copilot auth and configuration
allowed-tools: ["Bash"]
---

Verify GitHub Copilot authentication and configuration.

`node $CLAUDE_PLUGIN_ROOT/scripts/copilot-companion.mjs setup`

Display the setup status to the user. If auth is missing, provide instructions for configuring a GitHub token with Copilot Requests permission.
