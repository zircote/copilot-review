---
name: copilot-review-prompting
description: Guidance for working with Copilot code reviews — interpreting output, handling parsing failures, and prompt optimization tips.
version: 1.0.0
---

# Copilot Review Prompting

## Overview

The copilot-review plugin uses prompt-engineered reviews via GitHub Copilot's `session.sendAndWait()` API. Copilot has no dedicated review endpoint — all review logic is constructed through system prompts requesting structured JSON output.

## Review Output Format

Reviews return a structured JSON result:

```json
{
  "summary": "High-level summary of findings",
  "verdict": "approve | request_changes | comment",
  "findings": [
    {
      "file": "path/to/file.js",
      "line": 42,
      "severity": "critical | warning | suggestion | nitpick",
      "message": "Description of the issue",
      "suggestion": "Optional suggested fix"
    }
  ]
}
```

## Interpreting Severity Levels

| Severity | Meaning | Action Required |
|----------|---------|-----------------|
| critical | Bugs, security vulnerabilities, data loss risks | Must fix before merge |
| warning | Performance issues, API misuse, missing error handling | Should fix, may be acceptable with justification |
| suggestion | Style improvements, better naming, idiomatic patterns | Nice to have, not blocking |
| nitpick | Minor formatting, whitespace, trivial choices | Informational only |

## Verdict Interpretation

- **approve**: No critical or warning findings. Code is ready to merge.
- **request_changes**: One or more critical/warning findings require attention.
- **comment**: Informational review with suggestions but no blocking issues.

## Response Parsing

The plugin uses a 3-layer parsing strategy:

1. **Layer 1 — JSON fence extraction**: Regex extracts content from ````json ... ```` fences. Handles trailing commas (common LLM error).
2. **Layer 2 — Retry**: If Layer 1 fails, sends a follow-up prompt demanding JSON-only output. Maximum 1 retry.
3. **Layer 3 — Prose fallback**: If both layers fail, wraps raw text as a single "suggestion" finding with verdict "comment".

## When Prose Fallback Occurs

The output will include a warning: "Copilot returned a prose review (structured JSON parsing failed)."

Common causes:
- Copilot model returned explanation text before/after the JSON fence
- Response was truncated (hit token limit mid-JSON)
- Unusual diff content confused the model's output formatting

When this happens:
- The review content is still useful — just not structured
- Consider re-running the review (results may vary between runs)
- Check if the diff is unusually large (>100KB triggers truncation)

## Optimizing Review Quality

### For better JSON compliance:
- Keep diffs focused — smaller, targeted diffs get better structured output
- Use `--staged` to review only staged changes instead of the full working tree
- Use `--files pattern` to scope to specific files

### For better finding quality:
- Use adversarial mode (`/copilot-review adversarial-review`) for security-sensitive code
- Standard mode is better for general code quality
- Adversarial mode requires a minimum of 3 findings, which can surface subtle issues

### Model-specific notes:
- GPT-5: Generally strong JSON compliance. Rarely falls to Layer 2.
- GPT-4.1: Good JSON compliance but occasionally adds explanatory text around fences.
- Both models benefit from the explicit "no text outside the fence" instruction in the system prompt.

## Limitations

- **No incremental review**: Each review is a fresh session. Copilot doesn't carry context between reviews.
- **Diff size limits**: Diffs over 100KB are truncated. Very large PRs should be reviewed in parts using `--files`.
- **Non-deterministic**: Same diff may produce different reviews on subsequent runs. This is inherent to LLM-based review.
- **No inline annotations**: Findings reference file:line but don't integrate with IDE diff views.
