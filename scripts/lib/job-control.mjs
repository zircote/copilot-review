/**
 * job-control.mjs — Job list filtering, sorting, and enrichment.
 *
 * Provides: filterJobs(), enrichJob(), sortJobs().
 * Adds computed fields like age, duration, and shortId.
 */

/**
 * @typedef {import('./session-manager.mjs').JobRecord} JobRecord
 *
 * @typedef {JobRecord & { age: string, duration: string|null, shortId: string }} EnrichedJobRecord
 */

/**
 * Format an ISO timestamp as a human-readable relative time.
 * @param {string} isoString - ISO 8601 timestamp.
 * @returns {string} e.g. "5s ago", "2m ago", "3h ago", "1d ago"
 */
export function formatRelativeTime(isoString) {
	const diffMs = Date.now() - new Date(isoString).getTime();
	const diffSec = Math.max(0, Math.floor(diffMs / 1000));

	if (diffSec < 60) return `${diffSec}s ago`;
	const diffMin = Math.floor(diffSec / 60);
	if (diffMin < 60) return `${diffMin}m ago`;
	const diffHr = Math.floor(diffMin / 60);
	if (diffHr < 24) return `${diffHr}h ago`;
	const diffDay = Math.floor(diffHr / 24);
	return `${diffDay}d ago`;
}

/**
 * Format the duration between two ISO timestamps as a human-readable string.
 * @param {string} startIso - ISO 8601 start timestamp.
 * @param {string} endIso - ISO 8601 end timestamp.
 * @returns {string} e.g. "15s", "2m 30s", "1h 5m"
 */
export function formatDuration(startIso, endIso) {
	const diffMs = new Date(endIso).getTime() - new Date(startIso).getTime();
	const totalSec = Math.max(0, Math.floor(diffMs / 1000));

	if (totalSec < 60) return `${totalSec}s`;

	const min = Math.floor(totalSec / 60);
	const sec = totalSec % 60;

	if (min < 60) {
		return sec > 0 ? `${min}m ${sec}s` : `${min}m`;
	}

	const hr = Math.floor(min / 60);
	const remainMin = min % 60;
	return remainMin > 0 ? `${hr}h ${remainMin}m` : `${hr}h`;
}

/**
 * Filter jobs by optional criteria.
 * @param {JobRecord[]} jobs
 * @param {{ claudeSessionId?: string, status?: string, type?: string }} [filter]
 * @returns {JobRecord[]}
 */
export function filterJobs(jobs, { claudeSessionId, status, type } = {}) {
	return jobs.filter((job) => {
		if (claudeSessionId && job.claudeSessionId !== claudeSessionId) return false;
		if (status && job.status !== status) return false;
		if (type && job.type !== type) return false;
		return true;
	});
}

/**
 * Enrich a job record with computed display fields.
 * @param {JobRecord} job
 * @returns {EnrichedJobRecord}
 */
export function enrichJob(job) {
	const age = formatRelativeTime(job.createdAt);

	const terminalStatuses = ["completed", "failed", "cancelled"];
	const duration =
		terminalStatuses.includes(job.status) && job.updatedAt
			? formatDuration(job.createdAt, job.updatedAt)
			: null;

	const shortId = job.jobId.slice(0, 16);

	return { ...job, age, duration, shortId };
}

/**
 * Sort jobs by a given field.
 * @param {JobRecord[]} jobs
 * @param {{ by?: string, order?: 'asc'|'desc' }} [options]
 * @returns {JobRecord[]}
 */
export function sortJobs(jobs, { by = "createdAt", order = "desc" } = {}) {
	const sorted = [...jobs].sort((a, b) => {
		const aVal = a[by];
		const bVal = b[by];
		if (aVal < bVal) return -1;
		if (aVal > bVal) return 1;
		return 0;
	});

	if (order === "desc") sorted.reverse();
	return sorted;
}
