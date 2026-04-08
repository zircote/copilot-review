/**
 * tests/git.test.mjs — Tests for git helpers.
 *
 * Runs against the actual copilot-review git repository.
 */

import assert from "node:assert/strict";
import { resolve } from "node:path";
import { describe, it } from "node:test";
import { getDiff, getGitRoot, getStagedFiles } from "../scripts/lib/git.mjs";

describe("git.mjs", () => {
	it("getGitRoot returns an absolute path", async () => {
		const root = await getGitRoot();
		assert.ok(resolve(root) === root, "should be absolute");
		assert.ok(root.length > 0);
	});

	it("getDiff returns a string", async () => {
		const diff = await getDiff();
		assert.equal(typeof diff, "string");
	});

	it("getDiff with staged=true does not error", async () => {
		const diff = await getDiff({ staged: true });
		assert.equal(typeof diff, "string");
	});

	it("getDiff with files filter does not error", async () => {
		const diff = await getDiff({ files: ["package.json"] });
		assert.equal(typeof diff, "string");
	});

	it("getStagedFiles returns an array", async () => {
		const files = await getStagedFiles();
		assert.ok(Array.isArray(files));
	});
});
