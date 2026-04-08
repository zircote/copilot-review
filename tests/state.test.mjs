/**
 * tests/state.test.mjs — Tests for job state persistence.
 */

import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { readJob, writeJob, listJobs, deleteJob } from '../scripts/lib/state.mjs';
import { createTempDir, cleanupTempDir } from './helpers.mjs';

describe('state.mjs', () => {
  let tmpDir;

  before(async () => {
    tmpDir = await createTempDir();
  });

  after(async () => {
    await cleanupTempDir(tmpDir);
  });

  it('writeJob + readJob roundtrip', async () => {
    const record = {
      jobId: 'job-1',
      sessionId: 'session-1',
      type: 'review',
      status: 'pending',
      createdAt: '2026-04-07T00:00:00.000Z',
      updatedAt: '2026-04-07T00:00:00.000Z',
    };
    await writeJob(tmpDir, 'job-1', record);
    const loaded = await readJob(tmpDir, 'job-1');
    assert.deepStrictEqual(loaded, record);
  });

  it('readJob returns null for missing job', async () => {
    const result = await readJob(tmpDir, 'nonexistent-job');
    assert.equal(result, null);
  });

  it('listJobs returns all written jobs', async () => {
    // job-1 already written above
    const record2 = {
      jobId: 'job-2',
      sessionId: 'session-2',
      type: 'task',
      status: 'running',
      createdAt: '2026-04-07T00:00:00.000Z',
      updatedAt: '2026-04-07T00:00:00.000Z',
    };
    await writeJob(tmpDir, 'job-2', record2);

    const jobs = await listJobs(tmpDir);
    const ids = jobs.map(j => j.jobId).sort();
    assert.ok(ids.includes('job-1'));
    assert.ok(ids.includes('job-2'));
  });

  it('listJobs returns [] for empty directory', async () => {
    const emptyDir = await createTempDir();
    try {
      const jobs = await listJobs(emptyDir);
      assert.deepStrictEqual(jobs, []);
    } finally {
      await cleanupTempDir(emptyDir);
    }
  });

  it('deleteJob removes a job', async () => {
    const record = {
      jobId: 'job-del',
      sessionId: 'session-del',
      type: 'review',
      status: 'completed',
      createdAt: '2026-04-07T00:00:00.000Z',
      updatedAt: '2026-04-07T00:00:00.000Z',
    };
    await writeJob(tmpDir, 'job-del', record);
    assert.ok(await readJob(tmpDir, 'job-del'));

    await deleteJob(tmpDir, 'job-del');
    assert.equal(await readJob(tmpDir, 'job-del'), null);
  });

  it('deleteJob no-ops for missing job', async () => {
    await assert.doesNotReject(() => deleteJob(tmpDir, 'never-existed'));
  });

  it('writeJob creates jobs directory if missing', async () => {
    const freshDir = await createTempDir();
    try {
      const record = {
        jobId: 'job-fresh',
        sessionId: 'session-fresh',
        type: 'review',
        status: 'pending',
        createdAt: '2026-04-07T00:00:00.000Z',
        updatedAt: '2026-04-07T00:00:00.000Z',
      };
      await writeJob(freshDir, 'job-fresh', record);
      const loaded = await readJob(freshDir, 'job-fresh');
      assert.deepStrictEqual(loaded, record);
    } finally {
      await cleanupTempDir(freshDir);
    }
  });

  it('preserves complex data through serialization', async () => {
    const record = {
      jobId: 'job-complex',
      sessionId: 'session-complex',
      type: 'review',
      status: 'completed',
      createdAt: '2026-04-07T00:00:00.000Z',
      updatedAt: '2026-04-07T01:00:00.000Z',
      claudeSessionId: 'claude-123',
      result: { summary: 'All good', verdict: 'approve', findings: [] },
      error: null,
    };
    await writeJob(tmpDir, 'job-complex', record);
    const loaded = await readJob(tmpDir, 'job-complex');
    assert.deepStrictEqual(loaded.result, record.result);
    assert.equal(loaded.claudeSessionId, 'claude-123');
  });
});
