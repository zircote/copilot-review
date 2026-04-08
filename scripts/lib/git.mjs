/**
 * git.mjs — Git diff collection and repository helpers.
 *
 * Provides: getDiff({ staged, files }), getGitRoot(), getStagedFiles().
 * Uses execFile (not exec) to avoid shell injection.
 */

import { execFile as execFileCb } from "node:child_process";
import { promisify } from "node:util";

const execFile = promisify(execFileCb);

/** Maximum diff size in bytes for single-shot review. */
const MAX_DIFF_BYTES = 102400;

/** Maximum bytes per chunk when splitting for chunked review. */
const CHUNK_TARGET_BYTES = 81920;

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
 * Collect the raw git diff without truncation.
 * @param {object} [options]
 * @param {boolean} [options.staged=false] - If true, diff only staged changes.
 * @param {string[]|null} [options.files=null] - File patterns to restrict the diff.
 * @returns {Promise<string>} The full diff text.
 */
export async function getRawDiff({ staged = false, files = null } = {}) {
	const args = ["diff"];
	if (staged) args.push("--staged");
	if (files && files.length > 0) {
		args.push("--");
		args.push(...files);
	}
	const { stdout } = await execFile("git", args, { maxBuffer: 50 * 1024 * 1024 });
	return stdout || "";
}

/**
 * Collect a git diff, truncated for single-shot review.
 * @param {object} [options]
 * @param {boolean} [options.staged=false] - If true, diff only staged changes.
 * @param {string[]|null} [options.files=null] - File patterns to restrict the diff.
 * @returns {Promise<string>} The diff text, possibly truncated.
 */
export async function getDiff({ staged = false, files = null } = {}) {
	const stdout = await getRawDiff({ staged, files });
	if (!stdout) return "";

	const totalBytes = Buffer.byteLength(stdout, "utf-8");
	if (totalBytes <= MAX_DIFF_BYTES) return stdout;

	const totalKB = Math.round(totalBytes / 1024);
	const truncated = Buffer.from(stdout, "utf-8").subarray(0, MAX_DIFF_BYTES).toString("utf-8");
	return `${truncated}\n\n[DIFF TRUNCATED: showing first 100KB of ${totalKB}KB]`;
}

/**
 * @typedef {object} FileDiff
 * @property {string} file - The file path from the diff header.
 * @property {string} diff - The full diff text for this file (including header).
 * @property {number} bytes - Byte size of the diff text.
 */

/**
 * Split a unified diff into per-file hunks.
 * @param {string} rawDiff - The full unified diff text.
 * @returns {FileDiff[]}
 */
export function splitDiffByFile(rawDiff) {
	if (!rawDiff) return [];

	const fileDiffs = [];
	// Split on "diff --git" boundaries, keeping the delimiter
	const parts = rawDiff.split(/^(?=diff --git )/m);

	for (const part of parts) {
		if (!part.trim()) continue;

		// Extract file path from "diff --git a/path b/path"
		const headerMatch = part.match(/^diff --git a\/.+ b\/(.+)/m);
		const file = headerMatch ? headerMatch[1] : "(unknown)";

		fileDiffs.push({
			file,
			diff: part,
			bytes: Buffer.byteLength(part, "utf-8"),
		});
	}

	return fileDiffs;
}

/**
 * Group per-file diffs into chunks that stay under a byte size target.
 * Files larger than the target get their own chunk (never split mid-file).
 * @param {FileDiff[]} fileDiffs - Per-file diffs from splitDiffByFile().
 * @param {number} [targetBytes] - Target max bytes per chunk.
 * @returns {string[]} Array of diff text chunks.
 */
export function groupIntoChunks(fileDiffs, targetBytes = CHUNK_TARGET_BYTES) {
	if (fileDiffs.length === 0) return [];

	const chunks = [];
	let currentChunk = "";
	let currentBytes = 0;

	for (const fd of fileDiffs) {
		// If adding this file would exceed the target and we already have content, flush
		if (currentBytes > 0 && currentBytes + fd.bytes > targetBytes) {
			chunks.push(currentChunk);
			currentChunk = "";
			currentBytes = 0;
		}
		currentChunk += fd.diff;
		currentBytes += fd.bytes;
	}

	if (currentChunk) {
		chunks.push(currentChunk);
	}

	return chunks;
}

/**
 * Check whether a diff is too large for single-shot review.
 * @param {string} diff - The diff text.
 * @returns {boolean}
 */
export function needsChunking(diff) {
	return Buffer.byteLength(diff, "utf-8") > MAX_DIFF_BYTES;
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
