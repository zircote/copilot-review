/**
 * tests/config.test.mjs — Tests for workspace-scoped config persistence.
 */

import assert from "node:assert/strict";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { after, before, describe, it } from "node:test";
import {
	getConfig,
	loadConfig,
	resolveConfigDir,
	resolveWorkspaceRoot,
	saveConfig,
	setConfig,
} from "../scripts/lib/config.mjs";
import { cleanupTempDir, createTempDir } from "./helpers.mjs";

describe("config.mjs", () => {
	let tmpDir;

	before(async () => {
		tmpDir = await createTempDir();
	});

	after(async () => {
		await cleanupTempDir(tmpDir);
	});

	describe("resolveWorkspaceRoot", () => {
		it("returns cwd when no .git found", () => {
			const root = resolveWorkspaceRoot(tmpDir);
			assert.equal(root, tmpDir);
		});

		it("finds .git parent directory", () => {
			const projectDir = join(tmpDir, "my-project");
			const subDir = join(projectDir, "src", "lib");
			mkdirSync(join(projectDir, ".git"), { recursive: true });
			mkdirSync(subDir, { recursive: true });

			const root = resolveWorkspaceRoot(subDir);
			assert.equal(root, projectDir);
		});
	});

	describe("resolveConfigDir", () => {
		it("returns a deterministic path for the same cwd", () => {
			const dir1 = resolveConfigDir(tmpDir);
			const dir2 = resolveConfigDir(tmpDir);
			assert.equal(dir1, dir2);
		});

		it("returns different paths for different cwds", () => {
			const dir1 = resolveConfigDir(tmpDir);
			const otherDir = join(tmpDir, "other-project");
			mkdirSync(otherDir, { recursive: true });
			const dir2 = resolveConfigDir(otherDir);
			assert.notEqual(dir1, dir2);
		});
	});

	describe("loadConfig / saveConfig", () => {
		it("returns defaults when no config file exists", () => {
			const config = loadConfig(tmpDir);
			assert.deepStrictEqual(config, { stopReviewGate: false });
		});

		it("roundtrips config through save and load", () => {
			const configData = { stopReviewGate: true };
			saveConfig(tmpDir, configData);
			const loaded = loadConfig(tmpDir);
			assert.deepStrictEqual(loaded, configData);
		});

		it("merges defaults for missing keys", () => {
			// Write a config with only a custom key
			const configDir = resolveConfigDir(tmpDir);
			mkdirSync(configDir, { recursive: true });
			writeFileSync(join(configDir, "config.json"), JSON.stringify({ customKey: "hello" }), "utf8");

			const loaded = loadConfig(tmpDir);
			assert.equal(loaded.stopReviewGate, false);
			assert.equal(loaded.customKey, "hello");
		});

		it("returns defaults on corrupt JSON", () => {
			const configDir = resolveConfigDir(tmpDir);
			mkdirSync(configDir, { recursive: true });
			writeFileSync(join(configDir, "config.json"), "NOT JSON", "utf8");

			const loaded = loadConfig(tmpDir);
			assert.deepStrictEqual(loaded, { stopReviewGate: false });
		});
	});

	describe("setConfig", () => {
		it("patches a single key without clobbering others", () => {
			const isolatedDir = join(tmpDir, "isolated-set");
			mkdirSync(isolatedDir, { recursive: true });

			saveConfig(isolatedDir, { stopReviewGate: false, other: "value" });
			setConfig(isolatedDir, "stopReviewGate", true);

			const loaded = loadConfig(isolatedDir);
			assert.equal(loaded.stopReviewGate, true);
			assert.equal(loaded.other, "value");
		});
	});

	describe("getConfig", () => {
		it("is an alias for loadConfig", () => {
			const a = loadConfig(tmpDir);
			const b = getConfig(tmpDir);
			assert.deepStrictEqual(a, b);
		});
	});
});
