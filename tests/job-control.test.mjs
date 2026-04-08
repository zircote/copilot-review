/**
 * tests/job-control.test.mjs — Tests for job-control.mjs filtering, enrichment, sorting.
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
	enrichJob,
	filterJobs,
	formatDuration,
	formatRelativeTime,
	sortJobs,
} from "../scripts/lib/job-control.mjs";

// ---------------------------------------------------------------------------
// Helper: create a job record
// ---------------------------------------------------------------------------

function makeJob(overrides = {}) {
	return {
		jobId: `job-${Date.now()}-test`,
		sessionId: "session-test",
		type: "review",
		status: "pending",
		createdAt: new Date().toISOString(),
		updatedAt: new Date().toISOString(),
		...overrides,
	};
}

// ---------------------------------------------------------------------------
// filterJobs
// ---------------------------------------------------------------------------

describe("filterJobs", () => {
	const jobs = [
		makeJob({ jobId: "j1", type: "review", status: "completed", claudeSessionId: "cs-1" }),
		makeJob({ jobId: "j2", type: "task", status: "running", claudeSessionId: "cs-1" }),
		makeJob({ jobId: "j3", type: "review", status: "running", claudeSessionId: "cs-2" }),
	];

	it("returns all jobs when no filter", () => {
		const result = filterJobs(jobs);
		assert.equal(result.length, 3);
	});

	it("filters by claudeSessionId", () => {
		const result = filterJobs(jobs, { claudeSessionId: "cs-1" });
		assert.equal(result.length, 2);
		assert.ok(result.every((j) => j.claudeSessionId === "cs-1"));
	});

	it("filters by status", () => {
		const result = filterJobs(jobs, { status: "running" });
		assert.equal(result.length, 2);
		assert.ok(result.every((j) => j.status === "running"));
	});

	it("filters by type", () => {
		const result = filterJobs(jobs, { type: "task" });
		assert.equal(result.length, 1);
		assert.equal(result[0].jobId, "j2");
	});

	it("applies multiple filters as intersection", () => {
		const result = filterJobs(jobs, { status: "running", type: "review" });
		assert.equal(result.length, 1);
		assert.equal(result[0].jobId, "j3");
	});
});

// ---------------------------------------------------------------------------
// enrichJob
// ---------------------------------------------------------------------------

describe("enrichJob", () => {
	it("adds shortId (16 chars max)", () => {
		const job = makeJob({ jobId: "job-1234567890123456-abcdef" });
		const enriched = enrichJob(job);
		assert.equal(enriched.shortId, "job-123456789012");
		assert.equal(enriched.shortId.length, 16);
	});

	it("adds age as relative time string", () => {
		const tenMinAgo = new Date(Date.now() - 10 * 60 * 1000).toISOString();
		const enriched = enrichJob(makeJob({ createdAt: tenMinAgo }));
		assert.ok(enriched.age.includes("m ago"));
	});

	it("adds duration for completed jobs", () => {
		const start = "2026-04-01T00:00:00Z";
		const end = "2026-04-01T00:02:30Z";
		const enriched = enrichJob(makeJob({ status: "completed", createdAt: start, updatedAt: end }));
		assert.equal(enriched.duration, "2m 30s");
	});

	it("duration is null for running jobs", () => {
		const enriched = enrichJob(makeJob({ status: "running" }));
		assert.equal(enriched.duration, null);
	});

	it("adds duration for failed jobs", () => {
		const start = "2026-04-01T00:00:00Z";
		const end = "2026-04-01T00:00:45Z";
		const enriched = enrichJob(makeJob({ status: "failed", createdAt: start, updatedAt: end }));
		assert.equal(enriched.duration, "45s");
	});
});

// ---------------------------------------------------------------------------
// sortJobs
// ---------------------------------------------------------------------------

describe("sortJobs", () => {
	const jobs = [
		makeJob({ jobId: "j-old", createdAt: "2026-01-01T00:00:00Z" }),
		makeJob({ jobId: "j-new", createdAt: "2026-04-01T00:00:00Z" }),
		makeJob({ jobId: "j-mid", createdAt: "2026-02-01T00:00:00Z" }),
	];

	it("sorts by createdAt descending by default", () => {
		const sorted = sortJobs(jobs);
		assert.equal(sorted[0].jobId, "j-new");
		assert.equal(sorted[1].jobId, "j-mid");
		assert.equal(sorted[2].jobId, "j-old");
	});

	it("sorts ascending when requested", () => {
		const sorted = sortJobs(jobs, { order: "asc" });
		assert.equal(sorted[0].jobId, "j-old");
		assert.equal(sorted[2].jobId, "j-new");
	});

	it("sorts by a different field", () => {
		const typed = [
			makeJob({ jobId: "j1", type: "task" }),
			makeJob({ jobId: "j2", type: "review" }),
			makeJob({ jobId: "j3", type: "adversarial-review" }),
		];
		const sorted = sortJobs(typed, { by: "type", order: "asc" });
		assert.equal(sorted[0].type, "adversarial-review");
		assert.equal(sorted[1].type, "review");
		assert.equal(sorted[2].type, "task");
	});

	it("does not mutate the original array", () => {
		const original = [...jobs];
		sortJobs(jobs);
		assert.equal(jobs[0].jobId, original[0].jobId);
	});
});

// ---------------------------------------------------------------------------
// formatRelativeTime
// ---------------------------------------------------------------------------

describe("formatRelativeTime", () => {
	it("formats seconds ago", () => {
		const fiveSecAgo = new Date(Date.now() - 5000).toISOString();
		assert.equal(formatRelativeTime(fiveSecAgo), "5s ago");
	});

	it("formats minutes ago", () => {
		const threeMinAgo = new Date(Date.now() - 3 * 60 * 1000).toISOString();
		assert.equal(formatRelativeTime(threeMinAgo), "3m ago");
	});

	it("formats hours ago", () => {
		const twoHoursAgo = new Date(Date.now() - 2 * 60 * 60 * 1000).toISOString();
		assert.equal(formatRelativeTime(twoHoursAgo), "2h ago");
	});

	it("formats days ago", () => {
		const oneDayAgo = new Date(Date.now() - 25 * 60 * 60 * 1000).toISOString();
		assert.equal(formatRelativeTime(oneDayAgo), "1d ago");
	});
});

// ---------------------------------------------------------------------------
// formatDuration
// ---------------------------------------------------------------------------

describe("formatDuration", () => {
	it("formats short durations as seconds", () => {
		assert.equal(formatDuration("2026-01-01T00:00:00Z", "2026-01-01T00:00:15Z"), "15s");
	});

	it("formats minutes with seconds", () => {
		assert.equal(formatDuration("2026-01-01T00:00:00Z", "2026-01-01T00:02:30Z"), "2m 30s");
	});

	it("formats exact minutes without trailing seconds", () => {
		assert.equal(formatDuration("2026-01-01T00:00:00Z", "2026-01-01T00:05:00Z"), "5m");
	});

	it("formats hours with minutes", () => {
		assert.equal(formatDuration("2026-01-01T00:00:00Z", "2026-01-01T01:05:00Z"), "1h 5m");
	});

	it("formats exact hours without trailing minutes", () => {
		assert.equal(formatDuration("2026-01-01T00:00:00Z", "2026-01-01T02:00:00Z"), "2h");
	});

	it("returns 0s for identical timestamps", () => {
		assert.equal(formatDuration("2026-01-01T00:00:00Z", "2026-01-01T00:00:00Z"), "0s");
	});
});
