/**
 * tests/session-manager.test.mjs — Tests for SessionManager.
 */

import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";
import { SessionManager } from "../scripts/lib/session-manager.mjs";
import { readJob } from "../scripts/lib/state.mjs";
import { cleanupTempDir, createMockClient, createTempDir } from "./helpers.mjs";

describe("SessionManager", () => {
	let tmpDir;
	let mockClient;
	let manager;

	before(async () => {
		tmpDir = await createTempDir();
		mockClient = createMockClient();
		manager = new SessionManager({ dataDir: tmpDir, client: mockClient });
	});

	after(async () => {
		await cleanupTempDir(tmpDir);
	});

	it("createReviewSession creates a pending job record", async () => {
		const job = await manager.createReviewSession({ claudeSessionId: "claude-1" });

		assert.ok(job.jobId.startsWith("job-"));
		assert.ok(job.sessionId.startsWith("mock-session-"));
		assert.equal(job.type, "review");
		assert.equal(job.status, "pending");
		assert.equal(job.claudeSessionId, "claude-1");
		assert.ok(job.createdAt);
		assert.ok(job.updatedAt);

		// Verify persisted to disk
		const loaded = await readJob(tmpDir, job.jobId);
		assert.deepStrictEqual(loaded, job);
	});

	it("createTaskSession creates with type=task", async () => {
		const job = await manager.createTaskSession({});
		assert.equal(job.type, "task");
		assert.equal(job.status, "pending");
	});

	it("getSession returns the job record", async () => {
		const job = await manager.createReviewSession({});
		const loaded = await manager.getSession(job.jobId);
		assert.deepStrictEqual(loaded, job);
	});

	it("getSession returns null for missing job", async () => {
		const result = await manager.getSession("nonexistent-job");
		assert.equal(result, null);
	});

	it("listSessions returns all jobs", async () => {
		const jobs = await manager.listSessions();
		assert.ok(jobs.length >= 3); // we've created at least 3 above
	});

	it("listSessions filters by claudeSessionId", async () => {
		const job = await manager.createReviewSession({ claudeSessionId: "unique-claude-99" });
		const filtered = await manager.listSessions({ claudeSessionId: "unique-claude-99" });
		assert.equal(filtered.length, 1);
		assert.equal(filtered[0].jobId, job.jobId);
	});

	it("listSessions filters by status", async () => {
		const pending = await manager.listSessions({ status: "pending" });
		assert.ok(pending.every((j) => j.status === "pending"));
	});

	it("listSessions filters by type", async () => {
		const tasks = await manager.listSessions({ type: "task" });
		assert.ok(tasks.every((j) => j.type === "task"));
		assert.ok(tasks.length >= 1);
	});

	it("updateSession changes status with valid transition", async () => {
		const job = await manager.createReviewSession({});
		await manager.updateSession(job.jobId, { status: "running" });

		const updated = await manager.getSession(job.jobId);
		assert.equal(updated.status, "running");
		assert.ok(updated.updatedAt, "updatedAt should be set");
	});

	it("updateSession stores result data", async () => {
		const job = await manager.createReviewSession({});
		await manager.updateSession(job.jobId, { status: "running" });
		await manager.updateSession(job.jobId, {
			status: "completed",
			result: { summary: "Looks good", verdict: "approve" },
		});

		const updated = await manager.getSession(job.jobId);
		assert.equal(updated.status, "completed");
		assert.deepStrictEqual(updated.result, { summary: "Looks good", verdict: "approve" });
	});

	it("updateSession rejects invalid transitions", async () => {
		const job = await manager.createReviewSession({});
		await manager.updateSession(job.jobId, { status: "running" });
		await manager.updateSession(job.jobId, { status: "completed" });

		await assert.rejects(() => manager.updateSession(job.jobId, { status: "running" }), {
			message: /Invalid state transition: completed -> running/,
		});
	});

	it("updateSession rejects transition from failed", async () => {
		const job = await manager.createReviewSession({});
		await manager.updateSession(job.jobId, { status: "running" });
		await manager.updateSession(job.jobId, { status: "failed", error: "SDK timeout" });

		await assert.rejects(() => manager.updateSession(job.jobId, { status: "running" }), {
			message: /Invalid state transition/,
		});
	});

	it("updateSession throws for missing job", async () => {
		await assert.rejects(() => manager.updateSession("no-such-job", { status: "running" }), {
			message: /Job not found/,
		});
	});

	it("cleanupSession cancels a running job", async () => {
		const job = await manager.createReviewSession({});
		await manager.updateSession(job.jobId, { status: "running" });

		await manager.cleanupSession(job.jobId);

		const updated = await manager.getSession(job.jobId);
		assert.equal(updated.status, "cancelled");
	});

	it("cleanupSession cancels a pending job", async () => {
		const job = await manager.createReviewSession({});

		await manager.cleanupSession(job.jobId);

		const updated = await manager.getSession(job.jobId);
		assert.equal(updated.status, "cancelled");
	});

	it("cleanupSession no-ops for completed jobs", async () => {
		const job = await manager.createReviewSession({});
		await manager.updateSession(job.jobId, { status: "running" });
		await manager.updateSession(job.jobId, { status: "completed" });

		await manager.cleanupSession(job.jobId);

		const updated = await manager.getSession(job.jobId);
		assert.equal(updated.status, "completed"); // unchanged
	});

	it("cleanupSession no-ops for missing job", async () => {
		await assert.doesNotReject(() => manager.cleanupSession("nonexistent"));
	});

	it("cleanupAll cancels all active jobs", async () => {
		// Create a fresh manager with its own temp dir
		const freshDir = await createTempDir();
		try {
			const freshManager = new SessionManager({ dataDir: freshDir, client: mockClient });

			const j1 = await freshManager.createReviewSession({});
			await freshManager.updateSession(j1.jobId, { status: "running" });

			const j2 = await freshManager.createTaskSession({});
			// j2 is pending

			const j3 = await freshManager.createReviewSession({});
			await freshManager.updateSession(j3.jobId, { status: "running" });
			await freshManager.updateSession(j3.jobId, { status: "completed" });

			await freshManager.cleanupAll();

			assert.equal((await freshManager.getSession(j1.jobId)).status, "cancelled");
			assert.equal((await freshManager.getSession(j2.jobId)).status, "cancelled");
			assert.equal((await freshManager.getSession(j3.jobId)).status, "completed"); // untouched
		} finally {
			await cleanupTempDir(freshDir);
		}
	});
});
