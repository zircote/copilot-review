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

/**
 * @typedef {object} DiffRange
 * @property {string} base - Base ref (SHA, branch, tag).
 * @property {string} head - Head ref.
 * @property {boolean} threeDot - True for merge-base diff (...), false for direct diff (..).
 */

/**
 * Parse a git diff range string into base/head/style.
 *
 * Supported formats:
 *  - `sha1...sha2`  → three-dot merge-base diff
 *  - `sha1..sha2`   → two-dot direct diff
 *  - `...sha2`      → HEAD...sha2
 *  - `sha1...`      → sha1...HEAD
 *  - `..sha2`       → HEAD..sha2
 *  - `sha1..`       → sha1..HEAD
 *  - `sha1`         → sha1...HEAD (bare ref, defaults to three-dot)
 *
 * @param {string} range - The range string.
 * @returns {DiffRange|null} Parsed range or null if input is empty/falsy.
 */
export function parseDiffRange(range) {
	if (!range) return null;

	// Three-dot: sha1...sha2 (greedy base to handle dots in refs like v1.0.0)
	const threeDotMatch = range.match(/^(.*)\.\.\.(.*)$/);
	if (threeDotMatch) {
		return {
			base: threeDotMatch[1] || "HEAD",
			head: threeDotMatch[2] || "HEAD",
			threeDot: true,
		};
	}

	// Two-dot: sha1..sha2 (greedy base to handle dots in refs)
	const twoDotMatch = range.match(/^(.*)\.\.(.*)$/);
	if (twoDotMatch) {
		return {
			base: twoDotMatch[1] || "HEAD",
			head: twoDotMatch[2] || "HEAD",
			threeDot: false,
		};
	}

	// Bare ref: treat as ref...HEAD
	return { base: range, head: "HEAD", threeDot: true };
}

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
 *
 * Modes (checked in priority order — first match wins, others are ignored):
 *  1. `range`           → parsed DiffRange (from parseDiffRange), uses .. or ... as appropriate
 *  2. `base` + `head`   → `git diff <base>...<head>`  (three-dot merge-base diff)
 *  3. `base` only       → `git diff <base>...HEAD`
 *  4. `staged`          → `git diff --staged`
 *  5. default            → `git diff` (working-tree changes)
 *
 * When `range` is set, `base`, `head`, and `staged` are all ignored.
 *
 * @param {object} [options]
 * @param {boolean} [options.staged=false] - If true, diff only staged changes.
 * @param {string|null} [options.base=null] - Base ref for commit-range diff (tag, branch, SHA).
 * @param {string|null} [options.head=null] - Head ref (defaults to HEAD when base is set).
 * @param {DiffRange|null} [options.range=null] - Parsed diff range (from parseDiffRange).
 * @param {string[]|null} [options.files=null] - File patterns to restrict the diff.
 * @returns {Promise<string>} The full diff text.
 */
export async function getRawDiff({
	staged = false,
	base = null,
	head = null,
	range = null,
	files = null,
} = {}) {
	const args = ["diff"];

	if (range) {
		// Use parsed range with correct dot notation
		const sep = range.threeDot ? "..." : "..";
		args.push(`${range.base}${sep}${range.head}`);
	} else if (base) {
		// Commit-range mode: three-dot diff shows changes since merge-base
		const headRef = head || "HEAD";
		args.push(`${base}...${headRef}`);
	} else if (staged) {
		args.push("--staged");
	}

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
 * @param {string|null} [options.base=null] - Base ref for commit-range diff.
 * @param {string|null} [options.head=null] - Head ref (defaults to HEAD when base is set).
 * @param {DiffRange|null} [options.range=null] - Parsed diff range (from parseDiffRange).
 * @param {string[]|null} [options.files=null] - File patterns to restrict the diff.
 * @returns {Promise<string>} The diff text, possibly truncated.
 */
export async function getDiff({
	staged = false,
	base = null,
	head = null,
	range = null,
	files = null,
} = {}) {
	const stdout = await getRawDiff({ staged, base, head, range, files });
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
 * @typedef {object} RemoteInfo
 * @property {string} owner - Repository owner (user or org).
 * @property {string} repo - Repository name.
 */

/**
 * Parse the GitHub owner/repo from the origin remote URL.
 *
 * Handles HTTPS (`https://github.com/owner/repo.git`) and
 * SSH (`git@github.com:owner/repo.git`) formats.
 *
 * @param {string} [remote='origin'] - Git remote name.
 * @returns {Promise<RemoteInfo>}
 * @throws {Error} If the remote URL cannot be parsed.
 */
export async function getRemoteInfo(remote = "origin") {
	const { stdout } = await execFile("git", ["remote", "get-url", remote]);
	const url = stdout.trim();

	// HTTPS: https://github.com/owner/repo.git
	// SSH:   git@github.com:owner/repo.git
	const match = url.match(/github\.com[:/]([^/]+)\/([^/.]+?)(?:\.git)?$/);
	if (!match) {
		throw new Error(`Cannot parse GitHub owner/repo from remote URL: ${url}`);
	}

	return { owner: match[1], repo: match[2] };
}

/**
 * @typedef {object} PrRef
 * @property {string|null} owner - Repository owner, or null to auto-detect.
 * @property {string|null} repo - Repository name, or null to auto-detect.
 * @property {number} number - The pull request number.
 */

/**
 * Parse a pull request reference into its components.
 *
 * Supported formats:
 *  - `42`                                    → PR #42 in the current repo
 *  - `owner/repo#42`                         → PR #42 in owner/repo
 *  - `https://github.com/owner/repo/pull/42` → PR #42 in owner/repo
 *
 * @param {string} ref - The PR reference string.
 * @returns {PrRef|null} Parsed PR ref, or null if the format is unrecognised.
 */
export function parsePrRef(ref) {
	if (!ref) return null;

	// Full GitHub URL: https://github.com/owner/repo/pull/42
	const urlMatch = ref.match(/github\.com\/([^/]+)\/([^/]+)\/pull\/(\d+)/);
	if (urlMatch) {
		return {
			owner: urlMatch[1],
			repo: urlMatch[2],
			number: Number.parseInt(urlMatch[3], 10),
		};
	}

	// owner/repo#42
	const nwoMatch = ref.match(/^([^/]+)\/([^#]+)#(\d+)$/);
	if (nwoMatch) {
		return {
			owner: nwoMatch[1],
			repo: nwoMatch[2],
			number: Number.parseInt(nwoMatch[3], 10),
		};
	}

	// Bare number: 42 or #42
	const numMatch = ref.match(/^#?(\d+)$/);
	if (numMatch) {
		return {
			owner: null,
			repo: null,
			number: Number.parseInt(numMatch[1], 10),
		};
	}

	return null;
}

/**
 * Fetch the diff for a GitHub pull request using `gh api`.
 *
 * @param {PrRef} prRef - Parsed PR reference (from parsePrRef).
 * @returns {Promise<string>} The unified diff text.
 * @throws {Error} If `gh` CLI is unavailable or the request fails.
 */
export async function getPrDiff(prRef) {
	let { owner, repo } = prRef;

	if (!owner || !repo) {
		const remote = await getRemoteInfo();
		owner = owner || remote.owner;
		repo = repo || remote.repo;
	}

	const { stdout } = await execFile(
		"gh",
		[
			"api",
			`repos/${owner}/${repo}/pulls/${prRef.number}`,
			"-H",
			"Accept: application/vnd.github.diff",
		],
		{ maxBuffer: 50 * 1024 * 1024 },
	);
	return stdout || "";
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
