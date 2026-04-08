# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [0.1.0] - 2026-04-07

### Added

- Standard code review via `/copilot-review:review` with `--staged` and `--files` options
- Adversarial security-focused review via `/copilot-review:adversarial-review`
- Task delegation via `/copilot-review:task`
- Job management: `/copilot-review:status`, `/copilot-review:result`, `/copilot-review:cancel`
- Auth verification via `/copilot-review:setup`
- 3-layer response parsing: JSON fence extraction, retry, prose fallback
- `copilot-rescue` agent for delegating investigation tasks
- `copilot-review-prompting` skill for interpreting review output
- Session lifecycle hooks for client startup/shutdown
- Circuit breaker (3 consecutive failures per session)
- Diff truncation at 100KB with warning
- 121 unit tests across 7 test files with 8 response fixtures
- Review output schema with structured findings and severity levels
- Exit codes: 0 (success), 1 (user error), 2 (SDK error), 3 (prose fallback)
