/**
 * tests/stop-review-gate.test.mjs — Tests for stop review gate logic.
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { buildStopReviewPrompt, parseStopReviewOutput } from "../scripts/stop-review-gate-hook.mjs";

describe("stop-review-gate-hook", () => {
	describe("parseStopReviewOutput", () => {
		it("parses ALLOW response", () => {
			const result = parseStopReviewOutput("ALLOW: looks good, no issues found");
			assert.equal(result.ok, true);
			assert.equal(result.reason, null);
		});

		it("parses BLOCK response", () => {
			const result = parseStopReviewOutput("BLOCK: missing error handling in auth module");
			assert.equal(result.ok, false);
			assert.ok(result.reason.includes("missing error handling"));
		});

		it("handles multiline output (uses first line only)", () => {
			const result = parseStopReviewOutput("ALLOW: no code changes\nSome additional context here");
			assert.equal(result.ok, true);
		});

		it("returns error for empty output", () => {
			const result = parseStopReviewOutput("");
			assert.equal(result.ok, false);
			assert.ok(result.reason.includes("no output"));
		});

		it("returns error for null output", () => {
			const result = parseStopReviewOutput(null);
			assert.equal(result.ok, false);
			assert.ok(result.reason.includes("no output"));
		});

		it("returns error for unrecognized format", () => {
			const result = parseStopReviewOutput("Some random text that is not ALLOW or BLOCK");
			assert.equal(result.ok, false);
			assert.ok(result.reason.includes("unexpected answer"));
		});

		it("handles BLOCK with empty reason", () => {
			const result = parseStopReviewOutput("BLOCK:");
			assert.equal(result.ok, false);
			assert.ok(result.reason.includes("BLOCK:"));
		});

		it("handles Windows-style line endings", () => {
			const result = parseStopReviewOutput("ALLOW: all clear\r\nExtra line");
			assert.equal(result.ok, true);
		});
	});

	describe("buildStopReviewPrompt", () => {
		it("includes last assistant message when provided", () => {
			const prompt = buildStopReviewPrompt({
				last_assistant_message: "I edited foo.js to fix the bug",
			});
			assert.ok(prompt.includes("I edited foo.js to fix the bug"));
			assert.ok(prompt.includes("Previous Claude response:"));
		});

		it("produces valid prompt without last_assistant_message", () => {
			const prompt = buildStopReviewPrompt({});
			assert.ok(prompt.includes("ALLOW"));
			assert.ok(prompt.includes("BLOCK"));
			assert.ok(!prompt.includes("Previous Claude response:"));
		});

		it("handles empty input", () => {
			const prompt = buildStopReviewPrompt();
			assert.ok(prompt.includes("stop-gate review"));
		});

		it("trims whitespace-only messages", () => {
			const prompt = buildStopReviewPrompt({
				last_assistant_message: "   \n  ",
			});
			assert.ok(!prompt.includes("Previous Claude response:"));
		});
	});
});
