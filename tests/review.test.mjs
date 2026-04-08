/**
 * tests/review.test.mjs — Tests for review.mjs parsing and validation.
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
	buildProseFallback,
	extractJsonFromFence,
	loadSystemPrompt,
	validateReview,
} from "../scripts/lib/review.mjs";
import { loadFixture } from "./helpers.mjs";

// ---------------------------------------------------------------------------
// extractJsonFromFence
// ---------------------------------------------------------------------------

describe("extractJsonFromFence", () => {
	it("extracts well-formed JSON from a code fence", async () => {
		const text = await loadFixture("well-formed-json.txt");
		const result = extractJsonFromFence(text);
		assert.ok(result);
		assert.equal(result.summary, "Clean code with minor suggestions.");
		assert.equal(result.verdict, "comment");
		assert.equal(result.findings.length, 1);
		assert.equal(result.findings[0].file, "src/index.js");
		assert.equal(result.findings[0].line, 10);
		assert.equal(result.findings[0].severity, "suggestion");
		assert.equal(result.findings[0].suggestion, "const x = 42;");
	});

	it("fixes trailing commas and parses", async () => {
		const text = await loadFixture("json-trailing-comma.txt");
		const result = extractJsonFromFence(text);
		assert.ok(result);
		assert.equal(result.verdict, "request_changes");
		assert.equal(result.findings.length, 1);
		assert.equal(result.findings[0].severity, "critical");
	});

	it("extracts JSON when prose surrounds the fence", async () => {
		const text = await loadFixture("json-with-prose.txt");
		const result = extractJsonFromFence(text);
		assert.ok(result);
		assert.equal(result.verdict, "request_changes");
		assert.equal(result.findings[0].file, "server.js");
		assert.equal(result.findings[0].line, 25);
	});

	it("returns null when no fence is present", async () => {
		const text = await loadFixture("json-no-fence.txt");
		const result = extractJsonFromFence(text);
		assert.equal(result, null);
	});

	it("returns null for malformed JSON in fence", async () => {
		const text = await loadFixture("malformed-json.txt");
		const result = extractJsonFromFence(text);
		assert.equal(result, null);
	});

	it("returns null for empty input", () => {
		assert.equal(extractJsonFromFence(""), null);
	});

	it("extracts first fence when multiple are present", async () => {
		const text = await loadFixture("multiple-fences.txt");
		const result = extractJsonFromFence(text);
		assert.ok(result);
		assert.equal(result.summary, "First review.");
		assert.equal(result.verdict, "approve");
	});

	it("returns null for null input", () => {
		assert.equal(extractJsonFromFence(null), null);
	});

	it("returns null for undefined input", () => {
		assert.equal(extractJsonFromFence(undefined), null);
	});

	it("returns null for non-string input", () => {
		assert.equal(extractJsonFromFence(42), null);
	});
});

// ---------------------------------------------------------------------------
// validateReview
// ---------------------------------------------------------------------------

describe("validateReview", () => {
	const validReview = {
		summary: "All good.",
		verdict: "approve",
		findings: [],
	};

	const validReviewWithFindings = {
		summary: "Issues found.",
		verdict: "request_changes",
		findings: [{ file: "a.js", severity: "critical", message: "Bug here." }],
	};

	it("accepts a valid complete review", () => {
		const { valid, errors } = validateReview(validReviewWithFindings);
		assert.equal(valid, true);
		assert.deepEqual(errors, []);
	});

	it("accepts empty findings with approve verdict", () => {
		const { valid, errors } = validateReview(validReview);
		assert.equal(valid, true);
		assert.deepEqual(errors, []);
	});

	it("rejects missing summary", () => {
		const { valid, errors } = validateReview({ verdict: "approve", findings: [] });
		assert.equal(valid, false);
		assert.ok(errors.some((e) => e.includes("summary")));
	});

	it("rejects empty summary", () => {
		const { valid, errors } = validateReview({ summary: "", verdict: "approve", findings: [] });
		assert.equal(valid, false);
		assert.ok(errors.some((e) => e.includes("summary")));
	});

	it("rejects invalid verdict", () => {
		const { valid, errors } = validateReview({ summary: "Ok.", verdict: "maybe", findings: [] });
		assert.equal(valid, false);
		assert.ok(errors.some((e) => e.includes("verdict")));
	});

	it("rejects findings that is not an array", () => {
		const { valid, errors } = validateReview({
			summary: "Ok.",
			verdict: "approve",
			findings: "none",
		});
		assert.equal(valid, false);
		assert.ok(errors.some((e) => e.includes("findings must be an array")));
	});

	it("rejects finding missing file", () => {
		const { valid, errors } = validateReview({
			summary: "Ok.",
			verdict: "comment",
			findings: [{ severity: "warning", message: "Oops." }],
		});
		assert.equal(valid, false);
		assert.ok(errors.some((e) => e.includes("file")));
	});

	it("rejects finding missing severity", () => {
		const { valid, errors } = validateReview({
			summary: "Ok.",
			verdict: "comment",
			findings: [{ file: "a.js", message: "Oops." }],
		});
		assert.equal(valid, false);
		assert.ok(errors.some((e) => e.includes("severity")));
	});

	it("rejects finding missing message", () => {
		const { valid, errors } = validateReview({
			summary: "Ok.",
			verdict: "comment",
			findings: [{ file: "a.js", severity: "warning" }],
		});
		assert.equal(valid, false);
		assert.ok(errors.some((e) => e.includes("message")));
	});

	it("rejects invalid severity enum value", () => {
		const { valid, errors } = validateReview({
			summary: "Ok.",
			verdict: "comment",
			findings: [{ file: "a.js", severity: "high", message: "Oops." }],
		});
		assert.equal(valid, false);
		assert.ok(errors.some((e) => e.includes("severity")));
	});

	it("accepts optional line as positive integer", () => {
		const { valid } = validateReview({
			summary: "Ok.",
			verdict: "comment",
			findings: [{ file: "a.js", severity: "warning", message: "Oops.", line: 5 }],
		});
		assert.equal(valid, true);
	});

	it("rejects line of zero", () => {
		const { valid, errors } = validateReview({
			summary: "Ok.",
			verdict: "comment",
			findings: [{ file: "a.js", severity: "warning", message: "Oops.", line: 0 }],
		});
		assert.equal(valid, false);
		assert.ok(errors.some((e) => e.includes("line")));
	});

	it("rejects negative line", () => {
		const { valid, errors } = validateReview({
			summary: "Ok.",
			verdict: "comment",
			findings: [{ file: "a.js", severity: "warning", message: "Oops.", line: -1 }],
		});
		assert.equal(valid, false);
		assert.ok(errors.some((e) => e.includes("line")));
	});

	it("accepts optional suggestion as string", () => {
		const { valid } = validateReview({
			summary: "Ok.",
			verdict: "comment",
			findings: [{ file: "a.js", severity: "warning", message: "Oops.", suggestion: "Fix it." }],
		});
		assert.equal(valid, true);
	});

	it("rejects non-string suggestion", () => {
		const { valid, errors } = validateReview({
			summary: "Ok.",
			verdict: "comment",
			findings: [{ file: "a.js", severity: "warning", message: "Oops.", suggestion: 123 }],
		});
		assert.equal(valid, false);
		assert.ok(errors.some((e) => e.includes("suggestion")));
	});

	it("rejects null input", () => {
		const { valid, errors } = validateReview(null);
		assert.equal(valid, false);
		assert.ok(errors.length > 0);
	});

	it("rejects array input", () => {
		const { valid, errors } = validateReview([]);
		assert.equal(valid, false);
		assert.ok(errors.length > 0);
	});
});

// ---------------------------------------------------------------------------
// buildProseFallback
// ---------------------------------------------------------------------------

describe("buildProseFallback", () => {
	it("creates synthetic ReviewResult from prose", () => {
		const result = buildProseFallback("The code looks fine.");
		assert.equal(
			result.summary,
			"Copilot returned a prose review (structured JSON parsing failed).",
		);
		assert.equal(result.verdict, "comment");
		assert.equal(result.findings.length, 1);
		assert.equal(result.findings[0].file, "(prose review)");
		assert.equal(result.findings[0].severity, "suggestion");
		assert.equal(result.findings[0].message, "The code looks fine.");
	});

	it("truncates long text to 4000 chars", () => {
		const longText = "x".repeat(5000);
		const result = buildProseFallback(longText);
		assert.equal(result.findings[0].message.length, 4000);
	});

	it("handles empty string", () => {
		const result = buildProseFallback("");
		assert.equal(result.verdict, "comment");
		assert.equal(result.findings[0].message, "");
	});
});

// ---------------------------------------------------------------------------
// loadSystemPrompt
// ---------------------------------------------------------------------------

describe("loadSystemPrompt", () => {
	it("loads standard review prompt", async () => {
		const prompt = await loadSystemPrompt("standard");
		assert.equal(typeof prompt, "string");
		assert.ok(prompt.length > 0);
		assert.ok(prompt.includes("code reviewer"));
	});

	it("loads adversarial review prompt", async () => {
		const prompt = await loadSystemPrompt("adversarial");
		assert.equal(typeof prompt, "string");
		assert.ok(prompt.length > 0);
		assert.ok(prompt.includes("adversarial"));
	});
});
