---
description: Run an adversarial security-focused Copilot code review on a diff (working tree, staged, or commit range)
argument-hint: "[<range>] [--pr <ref>] [--staged] [--base <ref>] [--head <ref>] [--files <glob>]"
allowed-tools: ["Bash"]
---

Run an adversarial security-focused code review using GitHub Copilot on a git diff.

Supports these modes:
- **Working tree** (default): Reviews uncommitted changes
- **Staged** (`--staged`): Reviews only staged changes
- **Pull request** (`--pr <ref>`): Reviews a GitHub PR diff fetched via `gh` CLI. Accepts `42`, `#42`, `owner/repo#42`, or a full GitHub PR URL.
- **Range** (`sha1...sha2`): Reviews a diff range. Supports three-dot (`...`, merge-base) and two-dot (`..`, direct) syntax. Partial forms like `...sha2` or bare `sha1` also work.
- **Cold review** (`--base <ref>`): Same as range, using flag syntax. Optionally specify `--head <ref>` (defaults to HEAD).

`node $CLAUDE_PLUGIN_ROOT/scripts/copilot-companion.mjs adversarial-review $ARGUMENTS`

Display the review output to the user. If the exit code is non-zero, explain the error and suggest remediation.
