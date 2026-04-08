# copilot-review

A Claude Code plugin that uses GitHub Copilot as the backend for code reviews and task delegation.

## Prerequisites

- **Node.js 20.0+**
- **GitHub Copilot subscription** (Individual or Business)
- **GitHub Personal Access Token** with `copilot` scope
- **Claude Code** with plugin support
- **GitHub CLI (`gh`)** -- required only for PR review mode (`--pr`). Install from https://cli.github.com and authenticate with `gh auth login`.

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

### Review

```
/copilot-review:review [<range>] [--pr <ref>] [--staged] [--base <ref>] [--head <ref>] [--files <glob>]
```

Run a Copilot-powered code review on a git diff. The command supports several diff source modes, described below.

#### Working tree (default)

Reviews uncommitted changes in the working tree.

```bash
/copilot-review:review
```

#### Staged changes

Reviews only staged (indexed) changes.

```bash
/copilot-review:review --staged
```

#### Pull request

Reviews a GitHub pull request diff fetched via the `gh` CLI. Requires `gh` to be installed and authenticated.

```bash
/copilot-review:review --pr 42
/copilot-review:review --pr '#42'
/copilot-review:review --pr owner/repo#42
/copilot-review:review --pr https://github.com/owner/repo/pull/42
```

When owner/repo is omitted, the plugin detects the repository from the `origin` remote.

#### Diff range (positional)

Pass a range as the first positional argument. Supports three-dot (merge-base) and two-dot (direct) syntax, with partial forms.

| Format | Meaning |
|---|---|
| `sha1...sha2` | Three-dot merge-base diff |
| `sha1..sha2` | Two-dot direct diff |
| `...sha2` | `HEAD...sha2` (merge-base) |
| `sha1...` | `sha1...HEAD` (merge-base) |
| `sha1` | Bare ref, treated as `sha1...HEAD` |

```bash
/copilot-review:review abc123...def456       # Three-dot range (merge-base)
/copilot-review:review abc123..def456        # Two-dot range (direct diff)
/copilot-review:review ...feature-branch     # Changes on feature-branch since divergence
/copilot-review:review v1.0.0               # Changes since v1.0.0 tag
```

#### Cold review (flag syntax)

Same as range mode, using named flags instead of positional syntax. Uses three-dot (merge-base) diff.

```bash
/copilot-review:review --base v1.0.0                    # Changes since v1.0.0
/copilot-review:review --base main                       # Branch changes vs main
/copilot-review:review --base abc123 --head def456       # Specific commit range
```

#### File filtering

Any mode can be combined with `--files` to restrict the diff to specific paths.

```bash
/copilot-review:review --files src
/copilot-review:review --staged --files "src/**/*.js"
/copilot-review:review --base main --files "lib,tests"
```

### Adversarial Review

```
/copilot-review:adversarial-review [<range>] [--pr <ref>] [--staged] [--base <ref>] [--head <ref>] [--files <glob>]
```

Run an adversarial security-focused review. Accepts the same options and modes as `review`. Uses a stricter prompt that prioritizes vulnerability detection and requires a minimum of 3 findings.

```bash
/copilot-review:adversarial-review --staged
/copilot-review:adversarial-review --pr 42
/copilot-review:adversarial-review --base main --files "src/**/*.js"
```

### Task

```
/copilot-review:task <prompt...>
```

Delegate a coding task to Copilot.

```bash
/copilot-review:task Explain the authentication flow in this project
/copilot-review:task Suggest refactoring opportunities in src/lib/
```

### Job Management

Reviews and tasks run as tracked jobs. Use these commands to inspect and manage them.

#### Status

```bash
/copilot-review:status           # Jobs from the current Claude session
/copilot-review:status --all     # All jobs across sessions
```

#### Result

```bash
/copilot-review:result <job-id>  # Display the full result of a completed job
```

#### Cancel

```bash
/copilot-review:cancel <job-id>  # Cancel a running job
```

### Setup

```bash
/copilot-review:setup            # Verify GitHub Copilot auth and SDK connectivity
```

## Chunked Review

Large diffs (over 100KB) are automatically split by file and reviewed in chunks. The plugin:

1. Splits the unified diff into per-file hunks.
2. Groups files into chunks targeting ~80KB each. Files larger than the target get their own chunk (never split mid-file).
3. Reviews each chunk in a separate Copilot session.
4. Merges the results into a single consolidated review.

Progress is reported to stderr as each chunk completes. No user action is required -- chunking is transparent.

## Review Output

Reviews return structured results with:

- **Verdict:** `approve`, `request_changes`, or `comment`
- **Summary:** High-level description of the review findings
- **Findings** with severity levels:

| Severity | Meaning | Action |
|---|---|---|
| `critical` | Bugs, security vulnerabilities, data loss risks | Must fix before merge |
| `warning` | Performance issues, API misuse, missing error handling | Should fix |
| `suggestion` | Style improvements, naming, idiomatic patterns | Nice to have |
| `nitpick` | Minor formatting and trivial choices | Informational |

## Architecture

The plugin uses `@github/copilot-sdk` to create Copilot sessions with customized system prompts that instruct the model to return structured JSON reviews. Diffs are inlined in the prompt text.

Response parsing uses a 3-layer strategy:

1. **JSON fence extraction** -- Extracts JSON from ```json code fences
2. **Retry** -- Sends a follow-up prompt demanding JSON-only output (max 1 retry)
3. **Prose fallback** -- Wraps raw text as a review comment if JSON parsing fails

## Testing

```bash
npm test                 # Run all tests
npm run test:coverage    # Run with coverage reporting
npm run lint             # Run Biome linting
npm run format:check     # Check formatting
```

## Troubleshooting

### "No GitHub token found"

Set one of: `COPILOT_GITHUB_TOKEN`, `GH_TOKEN`, or `GITHUB_TOKEN`. The token needs `copilot` scope. Create a fine-grained PAT at https://github.com/settings/tokens.

### "Failed to start Copilot client"

- Verify your token is valid and not expired.
- Ensure you have an active GitHub Copilot subscription.
- Check that `@github/copilot-sdk` is installed: `npm install`.

### "Invalid PR reference"

The `--pr` flag accepts these formats: `42`, `#42`, `owner/repo#42`, or a full GitHub PR URL. Other formats are rejected.

### PR review requires `gh` CLI

The `--pr` mode uses `gh api` to fetch PR diffs from GitHub. Install the GitHub CLI from https://cli.github.com and run `gh auth login`.

### "Copilot returned a prose review"

The response parsing fell through to prose fallback. This happens occasionally -- re-run the review for structured output. Keep diffs focused (smaller diffs get better JSON compliance).

### SDK version issues

The plugin uses `@github/copilot-sdk@^0.2.1`. If you encounter protocol errors, ensure you're on a compatible version: `npm ls @github/copilot-sdk`.

## Known Limitations

- **Non-deterministic** -- Same diff may produce different reviews on subsequent runs.
- **No streaming** -- Reviews return complete results, not incremental.
- **No inline annotations** -- Findings reference file:line but do not integrate with IDE diff views.
- **No incremental review** -- Each review is a fresh session. Copilot does not carry context between reviews.

## Provenance

This is a clean-room implementation inspired by the architecture of [openai/codex-plugin-cc](https://github.com/openai/codex-plugin-cc). No code was copied -- only the plugin's public architecture was referenced. The backend was replaced with GitHub Copilot via `@github/copilot-sdk`.

### Key Technical Decisions

- **SDK over raw ACP** -- `@github/copilot-sdk` abstracts the JSON-RPC protocol and manages subprocess lifecycle. Raw ACP broke in Feb 2026 when `--headless` was removed.
- **Clean-room** -- References only public Copilot SDK docs and the Codex plugin's architecture (not source). No Apache-2.0 obligations.
- **Prompt-engineered reviews** -- Copilot has no `review/start` API. Reviews use `session.sendAndWait()` with customized system prompts (SDK v0.2.x `customize` mode) requesting structured JSON output.
- **Multi-layer response parsing** -- JSON fence extraction, retry with stricter prompt, prose fallback.

## License

MIT
