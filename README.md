# copilot-review

A Claude Code plugin that uses GitHub Copilot as the backend for code reviews and task delegation.

## Prerequisites

- **Node.js 20.0+**
- **GitHub Copilot subscription** (Individual or Business)
- **GitHub Personal Access Token** with `copilot` scope
- **Claude Code** with plugin support

## Installation

```bash
claude plugin install zircote/copilot-review
```

Or clone and link locally:

```bash
git clone https://github.com/zircote/copilot-review.git
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

```bash
/copilot-review:setup
```

## Commands

### `/copilot-review:review [--staged] [--files <glob>]`

Run a standard code review on the current git diff.

```bash
/copilot-review:review              # Review all uncommitted changes
/copilot-review:review --staged     # Review only staged changes
/copilot-review:review --files src  # Review changes in src/ only
```

### `/copilot-review:adversarial-review [--staged] [--files <glob>]`

Run an adversarial security-focused review. Uses a stricter prompt that prioritizes vulnerability detection.

### `/copilot-review:task <prompt>`

Delegate a coding task to Copilot.

```bash
/copilot-review:task Explain the authentication flow in this project
```

### `/copilot-review:status [--all]`

Show active and completed jobs. By default, shows only the current session's jobs.

### `/copilot-review:result <job-id>`

Display the full result of a completed job.

### `/copilot-review:cancel <job-id>`

Cancel a running job.

### `/copilot-review:setup`

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

The plugin uses `@github/copilot-sdk` to create Copilot sessions with customized system prompts that instruct the model to return structured JSON reviews. Diffs are inlined in the prompt text.

Response parsing uses a 3-layer strategy:

1. **JSON fence extraction** — Extracts JSON from ```json code fences
2. **Retry** — Sends a follow-up prompt demanding JSON-only output (max 1 retry)
3. **Prose fallback** — Wraps raw text as a review comment if JSON parsing fails

## Testing

```bash
npm test                 # Run all tests
npm run test:coverage    # Run with coverage reporting
```

## Troubleshooting

### "No GitHub token found"

Set one of: `COPILOT_GITHUB_TOKEN`, `GH_TOKEN`, or `GITHUB_TOKEN`. The token needs `copilot` scope. Create a fine-grained PAT at https://github.com/settings/tokens.

### "Failed to start Copilot client"

- Verify your token is valid and not expired
- Ensure you have an active GitHub Copilot subscription
- Check that `@github/copilot-sdk` is installed: `npm install`

### "Copilot returned a prose review"

The response parsing fell through to prose fallback. This happens occasionally — re-run the review for structured output. Keep diffs focused (smaller diffs get better JSON compliance).

### SDK version issues

The plugin uses `@github/copilot-sdk@^0.2.1`. If you encounter protocol errors, ensure you're on a compatible version: `npm ls @github/copilot-sdk`.

## Known Limitations

- **Non-deterministic** — Same diff may produce different reviews on subsequent runs
- **No streaming** — Reviews return complete results, not incremental
- **Diff size limit** — Diffs over 100KB are truncated; use `--files` for large PRs
- **No inline annotations** — Findings reference file:line but don't integrate with IDE diff views

## Provenance

This is a clean-room implementation inspired by the architecture of [openai/codex-plugin-cc](https://github.com/openai/codex-plugin-cc). No code was copied — only the plugin's public architecture was referenced. The backend was replaced with GitHub Copilot via `@github/copilot-sdk`.

### Key Technical Decisions

- **SDK over raw ACP** — `@github/copilot-sdk` abstracts the JSON-RPC protocol and manages subprocess lifecycle. Raw ACP broke in Feb 2026 when `--headless` was removed.
- **Clean-room** — References only public Copilot SDK docs and the Codex plugin's architecture (not source). No Apache-2.0 obligations.
- **Prompt-engineered reviews** — Copilot has no `review/start` API. Reviews use `session.sendAndWait()` with customized system prompts (SDK v0.2.x `customize` mode) requesting structured JSON output.
- **Multi-layer response parsing** — JSON fence extraction → retry with stricter prompt → prose fallback.

## License

MIT
