# CLAUDE.md — copilot-review

## Project

A Claude Code plugin that uses GitHub Copilot (via `@github/copilot-sdk`) as the backend agent for code reviews and task delegation. Clean-room implementation — does not copy code from openai/codex-plugin-cc.

## Implementation Plan

See `PLAN.md` for the full 7-phase implementation plan with 22 hours estimated effort.

## Research

All research artifacts are in the sibling repo at `~/Projects/zircote/research/reports/codex-copilot-port/`:

- `architectural-proposals.md` — SDK vs CLI architecture comparison (we chose SDK)
- `copilot-backend-feasibility.json` — SDK API surface, auth, streaming, review capabilities, code sketches
- `protocol-mapping.json` — Codex-to-Copilot method mapping with replacement code for every RPC method
- `tech-assessment.json` — codex-plugin-cc architecture analysis (what to learn from, not copy)
- `regulatory.json` — licensing and naming constraints (clean-room, no "OpenAI"/"Codex" branding)

## Key Technical Decisions

- **SDK over raw ACP** — `@github/copilot-sdk` abstracts the JSON-RPC protocol, manages subprocess lifecycle, pins CLI version. Raw ACP already broke once (Feb 2026, `--headless` removal).
- **Clean-room** — reference only public Copilot SDK docs and Codex plugin architecture (not source). No Apache-2.0 obligations.
- **Prompt-engineered reviews** — Copilot has no `review/start` API. Reviews are constructed via `session.sendAndWait()` with diff-as-blob attachment and structured system prompts requesting JSON output.
- **Multi-layer response parsing** — JSON fence extraction → retry with stricter prompt → prose fallback.

## Critical References

- Copilot SDK: https://github.com/github/copilot-sdk/blob/main/nodejs/README.md
- SDK Auth: https://github.com/github/copilot-sdk/blob/main/docs/auth/index.md
- ACP Breaking Change: https://github.com/github/copilot-cli/issues/1606
- Copilot Code Review: https://docs.github.com/en/copilot/concepts/agents/code-review

## Auth

Token resolution: `COPILOT_GITHUB_TOKEN` > `GH_TOKEN` > `GITHUB_TOKEN`. PAT must have "Copilot Requests" permission.

## Commands

| Command | Description |
|---------|-------------|
| `/copilot-review setup` | Verify auth and SDK connectivity |
| `/copilot-review review [--staged] [--files <glob>]` | Standard code review on current diff |
| `/copilot-review adversarial-review [--staged] [--files <glob>]` | Security-focused adversarial review |
| `/copilot-review task <prompt>` | Delegate a coding task to Copilot |
| `/copilot-review status [--all]` | List jobs (current session by default) |
| `/copilot-review result <job-id>` | Show completed job result |
| `/copilot-review cancel <job-id>` | Cancel a running job |

## When to Use

- **`review`** — General code quality review before committing or merging
- **`adversarial-review`** — Security-sensitive code, auth flows, input handling, crypto
- **`task`** — Delegate investigation or explanation tasks to Copilot for a second opinion

## Known Limitations

- **No streaming output** — Reviews return complete results, not incremental
- **Non-deterministic** — Same diff may produce different reviews on subsequent runs
- **Prose fallback possible** — If Copilot doesn't return valid JSON, the review falls back to raw prose with a warning
- **Diff size limit** — Diffs over 100KB are truncated. Large PRs should be reviewed in parts using `--files`
- **No inline annotations** — Findings reference file:line but don't integrate with IDE diff views

## Testing

Target 90% coverage. Mock Copilot SDK responses for unit tests. Test JSON parsing with well-formed, malformed, and prose-only responses.

```bash
npm test                 # Run all tests
npm run test:coverage    # Run with coverage reporting
```

## Exit Codes

| Code | Meaning |
|------|---------|
| 0 | Success |
| 1 | User error (bad args, no auth, unknown command) |
| 2 | Copilot SDK error |
| 3 | Review completed with prose fallback (JSON parsing failed) |
