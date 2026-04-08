# copilot-review

A Claude Code plugin that uses GitHub Copilot as the backend for code reviews and task delegation.

## Prerequisites

- **Node.js 20.0+**
- **GitHub Copilot subscription** (Individual or Business)
- **GitHub Personal Access Token** with "Copilot Requests" permission
- **Claude Code** with plugin support

## Installation

```bash
claude plugin install <owner>/copilot-review
```

Or clone and link locally:

```bash
git clone https://github.com/<owner>/copilot-review.git
cd copilot-review
npm install
```

## Configuration

Set a GitHub token with Copilot access. The plugin checks these environment variables in order:

1. `COPILOT_GITHUB_TOKEN` (preferred)
2. `GH_TOKEN`
3. `GITHUB_TOKEN`

```bash
export COPILOT_GITHUB_TOKEN=ghp_xxxxxxxxxxxx
```

Verify your setup:

```
/copilot-review setup
```

## Commands

### `/copilot-review review [--staged] [--files <glob>]`

Run a standard code review on the current git diff.

```
/copilot-review review              # Review all uncommitted changes
/copilot-review review --staged     # Review only staged changes
/copilot-review review --files src  # Review changes in src/ only
```

### `/copilot-review adversarial-review [--staged] [--files <glob>]`

Run an adversarial security-focused review. Uses a stricter prompt that prioritizes vulnerability detection.

### `/copilot-review task <prompt>`

Delegate a coding task to Copilot.

```
/copilot-review task Explain the authentication flow in this project
```

### `/copilot-review status [--all]`

Show active and completed jobs. By default, shows only the current session's jobs.

### `/copilot-review result <job-id>`

Display the full result of a completed job.

### `/copilot-review cancel <job-id>`

Cancel a running job.

### `/copilot-review setup`

Verify GitHub Copilot authentication and SDK connectivity.

## Review Output

Reviews return structured results with:

- **Verdict:** `approve`, `request_changes`, or `comment`
- **Findings** with severity levels:
  - `critical` — Bugs, security vulnerabilities, data loss risks
  - `warning` — Performance issues, API misuse, missing error handling
  - `suggestion` — Style improvements, naming, idiomatic patterns
  - `nitpick` — Minor formatting and trivial choices

## Architecture

The plugin prompt-engineers Copilot to act as a code reviewer. Copilot has no dedicated review API, so reviews are constructed via `session.sendAndWait()` with system prompts requesting structured JSON output.

Response parsing uses a 3-layer strategy:
1. **JSON fence extraction** — Extracts JSON from ````json``` code fences
2. **Retry** — Sends a follow-up prompt demanding JSON-only output (max 1 retry)
3. **Prose fallback** — Wraps raw text as a review comment if JSON parsing fails

## Troubleshooting

### "No GitHub token found"

Set one of: `COPILOT_GITHUB_TOKEN`, `GH_TOKEN`, or `GITHUB_TOKEN`. The token needs "Copilot Requests" permission. Create a fine-grained PAT at https://github.com/settings/tokens.

### "Failed to start Copilot client"

- Verify your token is valid and not expired
- Ensure you have an active GitHub Copilot subscription
- Check that `@github/copilot-sdk` is installed: `npm install`

### "Copilot returned a prose review"

The response parsing fell through to prose fallback. This happens occasionally — re-run the review for structured output. Keep diffs focused (smaller diffs get better JSON compliance).

### SDK version issues

The plugin pins `@github/copilot-sdk@^0.2.1`. If you encounter protocol errors, ensure you're on a compatible version: `npm ls @github/copilot-sdk`.

## License

MIT
