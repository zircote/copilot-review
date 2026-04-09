/**
 * tests/prompts.test.mjs — Tests for synchronous prompt template utilities.
 */

import assert from "node:assert/strict";
import { dirname, resolve } from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";
import { interpolateTemplate, loadPromptTemplate } from "../scripts/lib/prompts.mjs";

const ROOT_DIR = resolve(dirname(fileURLToPath(import.meta.url)), "..");

describe("prompts.mjs", () => {
	describe("loadPromptTemplate", () => {
		it("reads a prompt file from the prompts directory", () => {
			const content = loadPromptTemplate(ROOT_DIR, "stop-review-gate");
			assert.ok(content.includes("{{CLAUDE_RESPONSE_BLOCK}}"));
			assert.ok(content.includes("ALLOW"));
			assert.ok(content.includes("BLOCK"));
		});

		it("throws on missing template", () => {
			assert.throws(() => loadPromptTemplate(ROOT_DIR, "nonexistent-template"), { code: "ENOENT" });
		});
	});

	describe("interpolateTemplate", () => {
		it("replaces a single placeholder", () => {
			const result = interpolateTemplate("Hello {{NAME}}!", { NAME: "world" });
			assert.equal(result, "Hello world!");
		});

		it("replaces multiple placeholders", () => {
			const result = interpolateTemplate("{{A}} and {{B}}", { A: "one", B: "two" });
			assert.equal(result, "one and two");
		});

		it("removes unmatched placeholders", () => {
			const result = interpolateTemplate("before {{MISSING}} after", {});
			assert.equal(result, "before  after");
		});

		it("handles empty variables object", () => {
			const result = interpolateTemplate("no {{VARS}} here", {});
			assert.equal(result, "no  here");
		});

		it("preserves text without placeholders", () => {
			const result = interpolateTemplate("plain text", { KEY: "value" });
			assert.equal(result, "plain text");
		});
	});
});
