/**
 * git.mjs — Git diff collection and repository helpers.
 *
 * Provides: getDiff({ staged, files }), getGitRoot(), getStagedFiles().
 * Uses execFile (not exec) to avoid shell injection.
 */

import { execFile as execFileCb } from "node:child_process";
import { promisify } from "node:util";

const execFile = promisify(execFileCb);

/** Maximum diff size in bytes before truncation. */
const MAX_DIFF_BYTES = 102400;

/**
 * Get the absolute path to the repository root.
 * @returns {Promise<string>}
 * @throws {Error} If not inside a git repository.
 */
export async function getGitRoot() {
	const { stdout } = await execFile("git", ["rev-parse", "--show-toplevel"]);
	return stdout.trim();
}

/**
 * Collect a git diff.
 * @param {object} [options]
 * @param {boolean} [options.staged=false] - If true, diff only staged changes.
 * @param {string[]|null} [options.files=null] - File patterns to restrict the diff.
 * @returns {Promise<string>} The diff text, possibly truncated.
 */
export async function getDiff({ staged = false, files = null } = {}) {
	const args = ["diff"];
	if (staged) args.push("--staged");
	if (files && files.length > 0) {
		args.push("--");
		args.push(...files);
	}

	const { stdout } = await execFile("git", args, { maxBuffer: 10 * 1024 * 1024 });

	if (!stdout) return "";

	const totalBytes = Buffer.byteLength(stdout, "utf-8");
	if (totalBytes <= MAX_DIFF_BYTES) return stdout;

	const totalKB = Math.round(totalBytes / 1024);
	const truncated = Buffer.from(stdout, "utf-8").subarray(0, MAX_DIFF_BYTES).toString("utf-8");
	return truncated + `\n\n[DIFF TRUNCATED: showing first 100KB of ${totalKB}KB]`;
}

/**
 * List files that are currently staged.
 * @returns {Promise<string[]>} Array of staged file paths (relative to repo root).
 */
export async function getStagedFiles() {
	const { stdout } = await execFile("git", ["diff", "--staged", "--name-only"]);
	if (!stdout.trim()) return [];
	return stdout.trim().split("\n");
}
