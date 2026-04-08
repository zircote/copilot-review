# Implementation Plan: Copilot-Powered Code Review Plugin for Claude Code

**Project:** copilot-review
**Based on:** Research session `codex-copilot-port` (2026-04-07)
**Architecture:** Proposal A — `@github/copilot-sdk` (Node.js SDK)

---

## Objective

Build a Claude Code plugin that uses GitHub Copilot (via `@github/copilot-sdk`) as the backend agent for code reviews and task delegation. This is a clean-room implementation inspired by [openai/codex-plugin-cc](https://github.com/openai/codex-plugin-cc) but using Copilot instead of Codex.

## Research References

All research artifacts are in the sibling repository at `~/Projects/zircote/research/reports/codex-copilot-port/`:

| File | What It Contains | When to Use |
|------|-----------------|-------------|
| [`architectural-proposals.md`](../research/reports/codex-copilot-port/architectural-proposals.md) | Full SDK vs CLI architecture comparison, code sketches, pros/cons | Overall architectural decisions |
| [`copilot-backend-feasibility.json`](../research/reports/codex-copilot-port/copilot-backend-feasibility.json) | SDK API surface, auth model, streaming, review capabilities, migration plan, risk assessment | Implementing the Copilot client layer |
| [`protocol-mapping.json`](../research/reports/codex-copilot-port/protocol-mapping.json) | Codex → Copilot method mapping with replacement code for each RPC method | Implementing session/turn/review logic |
| [`tech-assessment.json`](../research/reports/codex-copilot-port/tech-assessment.json) | codex-plugin-cc architecture breakdown, component reuse analysis, env var audit | Understanding what to port vs rewrite |
| [`copilot-api.json`](../research/reports/codex-copilot-port/copilot-api.json) | Claude Code plugin format vs Copilot CLI plugin format mapping | Plugin manifest and command structure |
| [`regulatory.json`](../research/reports/codex-copilot-port/regulatory.json) | Apache-2.0 analysis, trademark rules, clean-room compliance checklist | Naming and attribution decisions |

## Key External References

- **Copilot SDK README:** https://github.com/github/copilot-sdk/blob/main/nodejs/README.md
- **Copilot SDK Auth:** https://github.com/github/copilot-sdk/blob/main/docs/auth/index.md
- **Copilot SDK Getting Started:** https://github.com/github/copilot-sdk/blob/main/docs/getting-started.md
- **ACP Server Reference:** https://docs.github.com/en/copilot/reference/copilot-cli-reference/acp-server
- **ACP Breaking Change Issue:** https://github.com/github/copilot-cli/issues/1606
- **Copilot Code Review Docs:** https://docs.github.com/en/copilot/concepts/agents/code-review
- **Claude Code Plugin Format:** https://docs.anthropic.com/en/docs/claude-code/plugins
- **codex-plugin-cc Source (reference only):** https://github.com/openai/codex-plugin-cc

## Constraints

- **Clean-room implementation** — do not copy code from codex-plugin-cc. Reference only public Copilot SDK docs and the Codex plugin's _architecture_ (not source). See `regulatory.json` compliance checklist.
- **Naming** — cannot use "OpenAI" or "Codex" as product branding (Apache-2.0 Section 6, OpenAI App Developer Terms). Use descriptive names like "copilot-review" or "gh-review".
- **SDK version pinning** — pin `@github/copilot-sdk` in package.json. The ACP protocol broke silently in Feb 2026 when `--headless` was removed. SDK v0.2.0+ ships ESM+CJS dual builds and mitigates with `--no-auto-update`.
- **Node.js 20.0+** — required by both Claude Code plugins and the Copilot SDK.
- **No structured review API** — Copilot has no `review/start`. All review logic is prompt-engineered via `session.sendAndWait()`. This is the critical-path work item.

---

## Phase 1: Scaffold Plugin Structure (2 hours)

### 1.1 Initialize project

```
copilot-review/
├── .claude-plugin/
│   └── plugin.json
├── agents/
│   └── copilot-rescue.md
├── commands/
│   ├── review.md
│   ├── adversarial-review.md
│   ├── task.md
│   ├── status.md
│   ├── result.md
│   ├── cancel.md
│   └── setup.md
├── hooks/
│   └── hooks.json
├── skills/
│   └── copilot-review-prompting/
│       └── SKILL.md
├── prompts/
│   ├── review-system.md
│   └── adversarial-review-system.md
├── schemas/
│   └── review-output.schema.json
├── scripts/
│   ├── copilot-companion.mjs
│   └── lib/
│       ├── copilot-client.mjs
│       ├── review.mjs
│       ├── session-manager.mjs
│       ├── git.mjs
│       ├── state.mjs
│       ├── job-control.mjs
│       ├── render.mjs
│       ├── args.mjs
│       └── fs.mjs
├── tests/
│   ├── copilot-client.test.mjs
│   ├── review.test.mjs
│   ├── session-manager.test.mjs
│   ├── render.test.mjs
│   └── helpers.mjs
├── package.json
├── LICENSE
└── README.md
```

### 1.2 Create package.json

```json
{
  "name": "copilot-review",
  "version": "0.1.0",
  "private": true,
  "type": "module",
  "description": "Use GitHub Copilot from Claude Code to review code or delegate tasks.",
  "license": "MIT",
  "engines": { "node": ">=18.18.0" },
  "dependencies": {
    "@github/copilot-sdk": "^0.2.1"
  },
  "devDependencies": {
    "@types/node": "^22.0.0"
  },
  "scripts": {
    "test": "node --test tests/*.test.mjs"
  }
}
```

### 1.3 Create plugin.json

```json
{
  "name": "copilot-review",
  "description": "Use GitHub Copilot from Claude Code to review code or delegate tasks.",
  "version": "0.1.0"
}
```

### 1.4 Create hooks.json

Session lifecycle hooks for starting/stopping the Copilot client:

```json
{
  "hooks": {
    "SessionStart": [
      {
        "hooks": [
          {
            "type": "command",
            "command": "node $CLAUDE_PLUGIN_ROOT/scripts/session-lifecycle-hook.mjs start",
            "timeout": 30
          }
        ]
      }
    ],
    "SessionEnd": [
      {
        "hooks": [
          {
            "type": "command",
            "command": "node $CLAUDE_PLUGIN_ROOT/scripts/session-lifecycle-hook.mjs end",
            "timeout": 15
          }
        ]
      }
    ]
  }
}
```

**Deliverables:** Plugin directory structure, package.json, plugin.json, hooks.json, LICENSE, empty command/agent/skill files.

---

## Phase 2: Copilot Client Layer (4 hours)

This is the core backend replacement. Replaces what codex-plugin-cc does with `app-server.mjs` + `broker-lifecycle.mjs`.

### 2.1 `scripts/lib/copilot-client.mjs`

Wrapper around `@github/copilot-sdk` that provides a simplified interface for the plugin:

```javascript
// Key API to implement:
export class CopilotReviewClient {
  constructor(options)        // { token?, model? }
  async start()               // Initialize CopilotClient, verify auth
  async createSession(opts)   // Create new review session
  async resumeSession(id)     // Resume existing session
  async listSessions()        // List active sessions
  async send(sessionId, prompt, attachments) // Send prompt, return response
  async sendStreaming(sessionId, prompt, attachments, onDelta) // Streaming variant
  async abort(sessionId)      // Cancel running turn
  async compact(sessionId)    // Compact session context
  async stop()                // Graceful shutdown
}
```

**Reference:** `copilot-backend-feasibility.json` → `finding_2_sdk_api` for SDK API surface. `protocol-mapping.json` → `request_methods` for replacement code snippets.

### 2.2 `scripts/lib/session-manager.mjs`

Manages session lifecycle, maps job IDs to Copilot session IDs, handles session persistence:

- Create/resume/list sessions
- Map internal job IDs to Copilot sessionIds
- Persist session state to disk (data directory)
- Handle session errors and reconnection

### 2.3 Authentication

Token resolution order (from `copilot-backend-feasibility.json` → `finding_4_authentication`):

1. `COPILOT_GITHUB_TOKEN` (highest priority)
2. `GH_TOKEN`
3. `GITHUB_TOKEN`
4. Fail with setup instructions if none found

The `setup` command should verify token validity and Copilot subscription status.

**Deliverables:** `copilot-client.mjs`, `session-manager.mjs`, unit tests for both. Auth resolution working.

---

## Phase 3: Review Prompt Engineering (4 hours)

This is the **critical-path work item**. Copilot has no `review/start` — all review logic is prompt-engineered.

### 3.1 `prompts/review-system.md`

System message that sets Copilot as a code reviewer:

- Instruct structured JSON output matching `schemas/review-output.schema.json`
- Provide diff context handling instructions
- Set review criteria (bugs, security, performance, style)
- Constrain output format strictly

### 3.2 `prompts/adversarial-review-system.md`

Adversarial variant (from `copilot-backend-feasibility.json` → `finding_6_code_review_capabilities`):

- Strict adversarial persona via system message customization
- Higher sensitivity thresholds
- Security-focused review criteria

### 3.3 `schemas/review-output.schema.json`

Define the structured review output format:

```json
{
  "$schema": "http://json-schema.org/draft-07/schema#",
  "type": "object",
  "required": ["summary", "findings", "verdict"],
  "properties": {
    "summary": { "type": "string" },
    "verdict": { "enum": ["approve", "request_changes", "comment"] },
    "findings": {
      "type": "array",
      "items": {
        "type": "object",
        "required": ["file", "severity", "message"],
        "properties": {
          "file": { "type": "string" },
          "line": { "type": "integer" },
          "severity": { "enum": ["critical", "warning", "suggestion", "nitpick"] },
          "message": { "type": "string" },
          "suggestion": { "type": "string" }
        }
      }
    }
  }
}
```

### 3.4 `scripts/lib/review.mjs`

Review orchestration logic:

- Collect git diff via `lib/git.mjs`
- Construct review prompt from template + diff
- Send to Copilot via `copilot-client.mjs` with diff as blob attachment
- Parse response: attempt JSON extraction, fall back to prose parsing
- Validate against schema
- Return structured review result

**Key risk mitigation:** Copilot returns prose, not structured JSON. Implement:
1. JSON fence extraction (````json ... ```)
2. Retry with stricter prompt if parsing fails
3. Fallback to prose rendering if all parsing fails

**Deliverables:** System prompts, review schema, `review.mjs` with parsing logic, unit tests with mock Copilot responses.

---

## Phase 4: CLI Companion & Commands (4 hours)

### 4.1 `scripts/copilot-companion.mjs`

Main CLI entry point with subcommands:

| Subcommand | Description |
|-----------|-------------|
| `setup` | Verify Copilot auth, check subscription, configure model |
| `review` | Run standard code review on current diff |
| `adversarial-review` | Run adversarial security-focused review |
| `task` | Delegate a coding task to Copilot |
| `status` | Show active/completed jobs |
| `result` | Display results of a completed job |
| `cancel` | Cancel a running job |

### 4.2 Command `.md` files

One per subcommand in `commands/`. Each invokes `copilot-companion.mjs` with appropriate arguments:

```markdown
---
name: review
description: Run a Copilot-powered code review on the current diff
allowed-tools: ["Bash"]
---

Run a code review using GitHub Copilot:
`node $CLAUDE_PLUGIN_ROOT/scripts/copilot-companion.mjs review $ARGUMENTS`
```

### 4.3 Supporting libraries

- `lib/git.mjs` — collect staged/unstaged diffs, file lists
- `lib/state.mjs` — job state persistence to `$CLAUDE_PLUGIN_DATA`
- `lib/job-control.mjs` — job list filtering, status tracking
- `lib/render.mjs` — terminal output formatting for review results
- `lib/args.mjs` — argument parsing
- `lib/fs.mjs` — file helpers

**Deliverables:** `copilot-companion.mjs`, all command `.md` files, supporting libraries, unit tests.

---

## Phase 5: Agent & Skills (2 hours)

### 5.1 `agents/copilot-rescue.md`

Agent definition for delegating investigation or rescue work:

```markdown
---
name: copilot-rescue
description: Delegate investigation or fix to Copilot
tools: ["Bash", "Read", "Glob", "Grep"]
---

You are a rescue agent that delegates complex investigation or fix tasks
to GitHub Copilot via the copilot-review plugin...
```

### 5.2 `skills/copilot-review-prompting/SKILL.md`

Prompt engineering guidance for working with Copilot reviews — model-specific tips, output format expectations, retry strategies.

**Deliverables:** Agent `.md`, skill `SKILL.md`.

---

## Phase 6: Testing (4 hours)

### 6.1 Unit tests

| Test file | Coverage target |
|-----------|----------------|
| `copilot-client.test.mjs` | CopilotReviewClient: start, send, abort, stop |
| `session-manager.test.mjs` | Session create, resume, list, persist |
| `review.test.mjs` | Prompt construction, response parsing, JSON extraction, fallback |
| `render.test.mjs` | Output formatting for all review result types |
| `git.test.mjs` | Diff collection, file list |
| `state.test.mjs` | Job state CRUD |
| `commands.test.mjs` | Command argument parsing and dispatch |

### 6.2 Integration tests

- Mock Copilot SDK responses (structured JSON, prose, malformed)
- End-to-end: diff → review prompt → mock response → rendered output
- Auth failure handling
- Session recovery after crash

### 6.3 Test fixtures

- Sample diffs (small, large, multi-file)
- Sample Copilot responses (well-formed JSON, markdown with JSON fence, pure prose)
- Auth error responses

**Target:** 90% line/branch coverage across all metrics.

**Deliverables:** All test files, fixtures, passing test suite.

---

## Phase 7: Documentation (2 hours)

### 7.1 README.md

- Installation instructions (`/plugin install owner/copilot-review`)
- Prerequisites (GitHub Copilot subscription, PAT with Copilot Requests permission)
- Configuration (token setup, model selection)
- Usage examples for each command
- Troubleshooting (auth errors, SDK version issues)

### 7.2 CLAUDE.md

Plugin-specific instructions for Claude Code:
- Available commands and when to use them
- Review output format
- Known limitations

**Deliverables:** README.md, CLAUDE.md.

---

## Execution Summary

| Phase | Description | Effort | Depends On |
|-------|-------------|--------|------------|
| 1 | Scaffold plugin structure | 2h | — |
| 2 | Copilot client layer | 4h | Phase 1 |
| 3 | Review prompt engineering | 4h | Phase 1 |
| 4 | CLI companion & commands | 4h | Phase 2, 3 |
| 5 | Agent & skills | 2h | Phase 4 |
| 6 | Testing | 4h | Phase 4 |
| 7 | Documentation | 2h | Phase 6 |
| **Total** | | **22h** | |

Phases 2 and 3 can run in parallel. Phase 4 depends on both. Phases 5, 6, 7 are sequential after Phase 4.

## Known Risks

| Risk | Severity | Mitigation |
|------|----------|------------|
| Copilot SDK public preview instability | HIGH | Pin `@github/copilot-sdk` version. Use `--no-auto-update`. Monitor [copilot-cli#1606](https://github.com/github/copilot-cli/issues/1606). |
| No structured review output from Copilot | HIGH | Multi-layer parsing: JSON fence extraction → retry → prose fallback. Prototype prompts early (Phase 3). |
| Copilot subscription required | MEDIUM | Document clearly. BYOK mode as fallback for orgs without subscription. |
| Response quality variance | MEDIUM | Adversarial system prompt tuning. Schema validation with retry. |
| Claude Code plugin API changes | LOW | Standard plugin format is stable. Pin Claude Code version in docs. |
