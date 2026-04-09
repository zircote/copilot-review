/**
 * config.mjs — Synchronous workspace-scoped configuration.
 *
 * Provides persistent per-workspace config (e.g. stopReviewGate)
 * stored at $CLAUDE_PLUGIN_DATA/config/{slug}-{hash}/config.json.
 *
 * All operations are synchronous so the Stop hook can use them
 * without async/await (the hook blocks session termination).
 */

import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, realpathSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, dirname, join, resolve } from "node:path";

const CONFIG_FILE_NAME = "config.json";
const PLUGIN_DATA_ENV = "CLAUDE_PLUGIN_DATA";
const FALLBACK_CONFIG_ROOT = join(tmpdir(), "copilot-review-config");

/** @returns {{ stopReviewGate: boolean }} */
function defaultConfig() {
	return { stopReviewGate: false };
}

/**
 * Walk up from `cwd` to find the nearest directory containing `.git`.
 * Returns `cwd` itself as a fallback.
 * @param {string} cwd
 * @returns {string}
 */
export function resolveWorkspaceRoot(cwd) {
	let dir = resolve(cwd);

	while (dir) {
		if (existsSync(join(dir, ".git"))) return dir;
		const parent = dirname(dir);
		if (parent === dir) break;
		dir = parent;
	}

	return resolve(cwd);
}

/**
 * Compute the config directory for a workspace.
 * @param {string} cwd
 * @returns {string}
 */
export function resolveConfigDir(cwd) {
	const workspaceRoot = resolveWorkspaceRoot(cwd);
	let canonical = workspaceRoot;
	try {
		canonical = realpathSync(workspaceRoot);
	} catch {
		canonical = workspaceRoot;
	}

	const slugSource = basename(workspaceRoot) || "workspace";
	const slug = slugSource.replace(/[^a-zA-Z0-9._-]+/g, "-").replace(/^-+|-+$/g, "") || "workspace";
	const hash = createHash("sha256").update(canonical).digest("hex").slice(0, 16);

	const pluginDataDir = process.env[PLUGIN_DATA_ENV];
	const configRoot = pluginDataDir ? join(pluginDataDir, "config") : FALLBACK_CONFIG_ROOT;
	return join(configRoot, `${slug}-${hash}`);
}

/**
 * Load config from disk. Returns defaults if file is missing or corrupt.
 * @param {string} cwd
 * @returns {{ stopReviewGate: boolean }}
 */
export function loadConfig(cwd) {
	const configFile = join(resolveConfigDir(cwd), CONFIG_FILE_NAME);
	if (!existsSync(configFile)) return defaultConfig();

	try {
		const parsed = JSON.parse(readFileSync(configFile, "utf8"));
		return { ...defaultConfig(), ...parsed };
	} catch {
		return defaultConfig();
	}
}

/**
 * Write config to disk, creating directories as needed.
 * @param {string} cwd
 * @param {{ stopReviewGate: boolean }} config
 */
export function saveConfig(cwd, config) {
	const dir = resolveConfigDir(cwd);
	mkdirSync(dir, { recursive: true });
	const configFile = join(dir, CONFIG_FILE_NAME);
	writeFileSync(configFile, `${JSON.stringify(config, null, 2)}\n`, "utf8");
}

/**
 * Patch a single config key and persist.
 * @param {string} cwd
 * @param {string} key
 * @param {*} value
 */
export function setConfig(cwd, key, value) {
	const config = loadConfig(cwd);
	config[key] = value;
	saveConfig(cwd, config);
}

/**
 * Read current config. Alias for loadConfig.
 * @param {string} cwd
 * @returns {{ stopReviewGate: boolean }}
 */
export function getConfig(cwd) {
	return loadConfig(cwd);
}
