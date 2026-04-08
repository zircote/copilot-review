/**
 * fs.mjs — File system helpers.
 *
 * Provides: ensureDir(), readJSON(), writeJSON(), resolvePluginPath().
 */

import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

/**
 * Ensure a directory exists (recursive mkdir).
 * @param {string} dirPath
 * @returns {Promise<void>}
 */
export async function ensureDir(dirPath) {
	await mkdir(dirPath, { recursive: true });
}

/**
 * Read and parse a JSON file. Returns null on ENOENT.
 * @param {string} filePath
 * @returns {Promise<object|null>}
 */
export async function readJSON(filePath) {
	try {
		const raw = await readFile(filePath, "utf-8");
		return JSON.parse(raw);
	} catch (err) {
		if (err.code === "ENOENT") return null;
		throw err;
	}
}

/**
 * Write an object as formatted JSON.
 * @param {string} filePath
 * @param {object} data
 * @returns {Promise<void>}
 */
export async function writeJSON(filePath, data) {
	await ensureDir(dirname(filePath));
	await writeFile(filePath, `${JSON.stringify(data, null, 2)}\n`, "utf-8");
}

/**
 * Resolve a path relative to the plugin root directory.
 * Uses CLAUDE_PLUGIN_ROOT env var, or falls back to two directories up
 * from this file (scripts/lib/ → plugin root).
 * @param {string} relative
 * @returns {string}
 */
export function resolvePluginPath(relative) {
	const root = process.env.CLAUDE_PLUGIN_ROOT || resolve(__dirname, "..", "..");
	return resolve(root, relative);
}
