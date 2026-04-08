/**
 * tests/git.test.mjs — Tests for git helpers.
 *
 * Runs against the actual copilot-review git repository.
 */

import assert from "node:assert/strict";
import { execFile as execFileCb } from "node:child_process";
import { resolve } from "node:path";
import { describe, it } from "node:test";
import { promisify } from "node:util";
import {
	getDiff,
	getGitRoot,
	getPrDiff,
	getRawDiff,
	getRemoteInfo,
	getStagedFiles,
	parseDiffRange,
	parsePrRef,
} from "../scripts/lib/git.mjs";

const execFile = promisify(execFileCb);

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

	describe("parseDiffRange", () => {
		it("returns null for falsy input", () => {
			assert.equal(parseDiffRange(null), null);
			assert.equal(parseDiffRange(""), null);
			assert.equal(parseDiffRange(undefined), null);
		});

		it("parses three-dot range sha1...sha2", () => {
			const r = parseDiffRange("abc123...def456");
			assert.deepEqual(r, { base: "abc123", head: "def456", threeDot: true });
		});

		it("parses two-dot range sha1..sha2", () => {
			const r = parseDiffRange("abc123..def456");
			assert.deepEqual(r, { base: "abc123", head: "def456", threeDot: false });
		});

		it("parses ...sha2 (leading three-dot)", () => {
			const r = parseDiffRange("...feature-branch");
			assert.deepEqual(r, { base: "HEAD", head: "feature-branch", threeDot: true });
		});

		it("parses sha1... (trailing three-dot)", () => {
			const r = parseDiffRange("v1.0.0...");
			assert.deepEqual(r, { base: "v1.0.0", head: "HEAD", threeDot: true });
		});

		it("parses ..sha2 (leading two-dot)", () => {
			const r = parseDiffRange("..feature-branch");
			assert.deepEqual(r, { base: "HEAD", head: "feature-branch", threeDot: false });
		});

		it("parses sha1.. (trailing two-dot)", () => {
			const r = parseDiffRange("v1.0.0..");
			assert.deepEqual(r, { base: "v1.0.0", head: "HEAD", threeDot: false });
		});

		it("parses bare ref as three-dot to HEAD", () => {
			const r = parseDiffRange("v1.0.0");
			assert.deepEqual(r, { base: "v1.0.0", head: "HEAD", threeDot: true });
		});

		it("handles branch names with slashes", () => {
			const r = parseDiffRange("origin/main...feature/my-branch");
			assert.deepEqual(r, { base: "origin/main", head: "feature/my-branch", threeDot: true });
		});
	});

	describe("cold review (--base/--head)", () => {
		/** Get the first commit SHA in the repo for a stable base ref. */
		async function getFirstCommit() {
			const { stdout } = await execFile("git", ["rev-list", "--max-parents=0", "HEAD"]);
			return stdout.trim().split("\n")[0];
		}

		it("getRawDiff with base returns a non-empty diff", async () => {
			const firstCommit = await getFirstCommit();
			const diff = await getRawDiff({ base: firstCommit });
			assert.equal(typeof diff, "string");
			assert.ok(diff.length > 0, "diff from first commit to HEAD should be non-empty");
		});

		it("getDiff with base returns a string", async () => {
			const firstCommit = await getFirstCommit();
			const diff = await getDiff({ base: firstCommit });
			assert.equal(typeof diff, "string");
			assert.ok(diff.length > 0);
		});

		it("getRawDiff with base and head returns a string", async () => {
			const diff = await getRawDiff({ base: "HEAD~1", head: "HEAD" });
			assert.equal(typeof diff, "string");
		});

		it("getRawDiff with base and files filter works", async () => {
			const firstCommit = await getFirstCommit();
			const diff = await getRawDiff({ base: firstCommit, files: ["package.json"] });
			assert.equal(typeof diff, "string");
			assert.ok(diff.includes("package.json") || diff === "", "should scope to package.json");
		});

		it("getRawDiff with parsed range (three-dot) works", async () => {
			const firstCommit = await getFirstCommit();
			const range = parseDiffRange(`${firstCommit}...HEAD`);
			const diff = await getRawDiff({ range });
			assert.equal(typeof diff, "string");
			assert.ok(diff.length > 0, "three-dot range should produce output");
		});

		it("getRawDiff with parsed range (two-dot) works", async () => {
			const range = parseDiffRange("HEAD~1..HEAD");
			const diff = await getRawDiff({ range });
			assert.equal(typeof diff, "string");
		});

		it("getRawDiff with range and files filter works", async () => {
			const firstCommit = await getFirstCommit();
			const range = parseDiffRange(`${firstCommit}...HEAD`);
			const diff = await getRawDiff({ range, files: ["package.json"] });
			assert.equal(typeof diff, "string");
			assert.ok(diff.includes("package.json") || diff === "", "should scope to package.json");
		});

		it("range takes precedence over base/head flags", async () => {
			const firstCommit = await getFirstCommit();
			const range = parseDiffRange(`${firstCommit}...HEAD`);
			// range should be used, base/head ignored
			const diff = await getRawDiff({ range, base: "nonexistent-ref", head: "also-nonexistent" });
			assert.equal(typeof diff, "string");
			assert.ok(diff.length > 0, "range should take precedence over base/head");
		});

		it("base takes precedence over staged", async () => {
			const firstCommit = await getFirstCommit();
			// When both base and staged are set, base wins (commit-range mode)
			const diff = await getRawDiff({ base: firstCommit, staged: true });
			assert.equal(typeof diff, "string");
			assert.ok(diff.length > 0, "base mode should produce output even with staged=true");
		});
	});

	describe("getRemoteInfo", () => {
		it("returns owner and repo for the current repository", async () => {
			const info = await getRemoteInfo();
			assert.equal(typeof info.owner, "string");
			assert.equal(typeof info.repo, "string");
			assert.ok(info.owner.length > 0, "owner should be non-empty");
			assert.ok(info.repo.length > 0, "repo should be non-empty");
		});

		it("parses this repo as zircote/copilot-review", async () => {
			const info = await getRemoteInfo();
			assert.equal(info.owner, "zircote");
			assert.equal(info.repo, "copilot-review");
		});
	});

	describe("parsePrRef", () => {
		it("returns null for falsy input", () => {
			assert.equal(parsePrRef(null), null);
			assert.equal(parsePrRef(""), null);
			assert.equal(parsePrRef(undefined), null);
		});

		it("parses bare number", () => {
			assert.deepEqual(parsePrRef("42"), {
				owner: null,
				repo: null,
				number: 42,
			});
		});

		it("parses #number", () => {
			assert.deepEqual(parsePrRef("#42"), {
				owner: null,
				repo: null,
				number: 42,
			});
		});

		it("parses owner/repo#number", () => {
			assert.deepEqual(parsePrRef("zircote/copilot-review#42"), {
				owner: "zircote",
				repo: "copilot-review",
				number: 42,
			});
		});

		it("parses full GitHub PR URL", () => {
			assert.deepEqual(parsePrRef("https://github.com/zircote/copilot-review/pull/42"), {
				owner: "zircote",
				repo: "copilot-review",
				number: 42,
			});
		});

		it("returns null for unrecognised format", () => {
			assert.equal(parsePrRef("not-a-pr-ref"), null);
			assert.equal(parsePrRef("owner/repo/42"), null);
		});
	});

	describe("getPrDiff", () => {
		it("fetches a diff for a known public PR", async () => {
			// Use a known public PR (cli/cli#1) to avoid depending on this repo having PRs
			try {
				const ref = parsePrRef("cli/cli#1");
				const diff = await getPrDiff(ref);
				assert.equal(typeof diff, "string");
				assert.ok(diff.length > 0, "PR diff should be non-empty");
			} catch (err) {
				if (err.message.includes("ENOENT")) {
					// gh CLI not installed — skip
					return;
				}
				throw err;
			}
		});

		it("throws for a non-existent PR", async () => {
			try {
				const ref = parsePrRef("zircote/copilot-review#999999");
				await getPrDiff(ref);
				assert.fail("Expected an error for non-existent PR");
			} catch (err) {
				if (err.message.includes("ENOENT")) return; // gh CLI not installed
				assert.ok(
					err.message.includes("404") || err.stderr?.includes("404") || err.code !== 0,
					"should fail with a not-found error",
				);
			}
		});
	});
});
