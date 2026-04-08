/**
 * state.mjs — Job state persistence.
 *
 * CRUD operations for job records stored as JSON files
 * at $CLAUDE_PLUGIN_DATA/jobs/{jobId}.json.
 */

import { mkdir, readdir, readFile, unlink, writeFile } from "node:fs/promises";
import { join } from "node:path";

/**
 * Ensure the jobs directory exists under dataDir.
 * @param {string} dataDir
 * @returns {Promise<string>} The jobs directory path.
 */
async function ensureJobsDir(dataDir) {
	const dir = join(dataDir, "jobs");
	await mkdir(dir, { recursive: true });
	return dir;
}

/**
 * Read a single job record by ID.
 * @param {string} dataDir
 * @param {string} jobId
 * @returns {Promise<import('./session-manager.mjs').JobRecord | null>}
 */
export async function readJob(dataDir, jobId) {
	const filePath = join(dataDir, "jobs", `${jobId}.json`);
	try {
		const raw = await readFile(filePath, "utf-8");
		return JSON.parse(raw);
	} catch (err) {
		if (err.code === "ENOENT") return null;
		throw err;
	}
}

/**
 * Write (create or update) a job record.
 * @param {string} dataDir
 * @param {string} jobId
 * @param {import('./session-manager.mjs').JobRecord} record
 * @returns {Promise<void>}
 */
export async function writeJob(dataDir, jobId, record) {
	const dir = await ensureJobsDir(dataDir);
	const filePath = join(dir, `${jobId}.json`);
	await writeFile(filePath, JSON.stringify(record, null, 2), "utf-8");
}

/**
 * List all job records in the data directory.
 * @param {string} dataDir
 * @returns {Promise<import('./session-manager.mjs').JobRecord[]>}
 */
export async function listJobs(dataDir) {
	const dir = join(dataDir, "jobs");
	let entries;
	try {
		entries = await readdir(dir);
	} catch (err) {
		if (err.code === "ENOENT") return [];
		throw err;
	}

	const jobs = [];
	for (const entry of entries) {
		if (!entry.endsWith(".json")) continue;
		const jobId = entry.replace(/\.json$/, "");
		const record = await readJob(dataDir, jobId);
		if (record) jobs.push(record);
	}
	return jobs;
}

/**
 * Delete a job record.
 * @param {string} dataDir
 * @param {string} jobId
 * @returns {Promise<void>}
 */
export async function deleteJob(dataDir, jobId) {
	const filePath = join(dataDir, "jobs", `${jobId}.json`);
	try {
		await unlink(filePath);
	} catch (err) {
		if (err.code === "ENOENT") return;
		throw err;
	}
}
