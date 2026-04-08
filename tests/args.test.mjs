/**
 * tests/args.test.mjs — Tests for the argument parser.
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { parseArgs } from "../scripts/lib/args.mjs";

describe("parseArgs", () => {
	it("parses command with boolean flag", () => {
		const result = parseArgs(["review", "--staged"]);
		assert.equal(result.command, "review");
		assert.deepStrictEqual(result.flags, { staged: true });
		assert.deepStrictEqual(result.positionals, []);
	});

	it("parses command with key-value flag (space-separated)", () => {
		const result = parseArgs(["review", "--files", "src/*.mjs"]);
		assert.equal(result.command, "review");
		assert.deepStrictEqual(result.flags, { files: "src/*.mjs" });
		assert.deepStrictEqual(result.positionals, []);
	});

	it("parses command with key=value flag", () => {
		const result = parseArgs(["review", "--files=src/*.mjs"]);
		assert.equal(result.command, "review");
		assert.deepStrictEqual(result.flags, { files: "src/*.mjs" });
		assert.deepStrictEqual(result.positionals, []);
	});

	it("collects positionals after command", () => {
		const result = parseArgs(["task", "fix", "the", "bug"]);
		assert.equal(result.command, "task");
		assert.deepStrictEqual(result.flags, {});
		assert.deepStrictEqual(result.positionals, ["fix", "the", "bug"]);
	});

	it("returns undefined command for empty argv", () => {
		const result = parseArgs([]);
		assert.equal(result.command, undefined);
		assert.deepStrictEqual(result.flags, {});
		assert.deepStrictEqual(result.positionals, []);
	});

	it("treats everything after -- as positional", () => {
		const result = parseArgs(["task", "--", "literal", "--arg"]);
		assert.equal(result.command, "task");
		assert.deepStrictEqual(result.flags, {});
		assert.deepStrictEqual(result.positionals, ["literal", "--arg"]);
	});

	it("disambiguates boolean flags from key-value pairs", () => {
		const result = parseArgs(["review", "--staged", "--files", "a.js"]);
		assert.equal(result.flags.staged, true);
		assert.equal(result.flags.files, "a.js");
	});

	it("handles multiple flags and positionals together", () => {
		const result = parseArgs(["review", "--staged", "--files=*.ts", "extra"]);
		assert.equal(result.command, "review");
		assert.equal(result.flags.staged, true);
		assert.equal(result.flags.files, "*.ts");
		assert.deepStrictEqual(result.positionals, ["extra"]);
	});

	it("treats flag at end of argv as boolean", () => {
		const result = parseArgs(["review", "--all"]);
		assert.equal(result.flags.all, true);
	});

	it("handles flag followed by another flag as boolean", () => {
		const result = parseArgs(["review", "--staged", "--all"]);
		assert.equal(result.flags.staged, true);
		assert.equal(result.flags.all, true);
	});
});
