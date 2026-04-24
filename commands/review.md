---
description: Run a Copilot-powered code review on a diff (working tree, staged, or commit range)
argument-hint: "[<range>] [--pr <ref>] [--staged] [--base <ref>] [--head <ref>] [--files <glob>] [--background]"
allowed-tools: ["Bash"]
---

Run a code review using GitHub Copilot on a git diff.

Supports these modes:
- **Working tree** (default): Reviews uncommitted changes
- **Staged** (`--staged`): Reviews only staged changes
- **Pull request** (`--pr <ref>`): Reviews a GitHub PR diff fetched via `gh` CLI. Accepts `42`, `#42`, `owner/repo#42`, or a full GitHub PR URL.
- **Range** (`sha1...sha2`): Reviews a diff range. Supports three-dot (`...`, merge-base) and two-dot (`..`, direct) syntax. Partial forms like `...sha2` or bare `sha1` also work.
- **Cold review** (`--base <ref>`): Same as range, using flag syntax. Optionally specify `--head <ref>` (defaults to HEAD).

Add `--background` to run the review in a detached process. Returns a job ID immediately.

`node $CLAUDE_PLUGIN_ROOT/scripts/copilot-companion.mjs review $ARGUMENTS`

**If `--background` was used:** the command prints a job ID and a job file path. You MUST:

1. Use the `Monitor` tool to wait for the job to reach a terminal state. Command:
   `until jq -e '.status == "completed" or .status == "failed" or .status == "cancelled"' <job-file> >/dev/null 2>&1; do sleep 3; done; jq -r '.status' <job-file>`
   Substitute `<job-file>` with the path printed by the command. Pick a generous `timeout_ms` (e.g. 900000).
2. When Monitor fires, run `/copilot-review:result <job-id>` to fetch and display the full review output.
3. If the final status is `failed` or `cancelled`, surface the error and suggest remediation instead of displaying results.

**If `--background` was NOT used:** display the review output that the command produced directly. If the exit code is non-zero, explain the error and suggest remediation.
