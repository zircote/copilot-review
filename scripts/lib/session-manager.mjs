/**
 * session-manager.mjs — Session lifecycle and job persistence.
 *
 * Maps internal job IDs to Copilot session IDs.
 * Persists job state to $CLAUDE_PLUGIN_DATA/jobs/.
 * Enforces state machine transitions: pending -> running -> completed|failed|cancelled.
 */

import { randomBytes } from 'node:crypto';
import { readJob, writeJob, listJobs } from './state.mjs';

// ---------------------------------------------------------------------------
// Types (JSDoc)
// ---------------------------------------------------------------------------

/**
 * @typedef {'review' | 'adversarial-review' | 'task'} JobType
 * @typedef {'pending' | 'running' | 'completed' | 'failed' | 'cancelled'} JobStatus
 *
 * @typedef {Object} JobRecord
 * @property {string} jobId
 * @property {string} sessionId        - Copilot SDK session ID
 * @property {JobType} type
 * @property {JobStatus} status
 * @property {string} createdAt        - ISO 8601
 * @property {string} updatedAt        - ISO 8601
 * @property {string} [claudeSessionId] - Claude Code session that owns this job
 * @property {any} [result]
 * @property {string} [error]
 */

// ---------------------------------------------------------------------------
// State machine
// ---------------------------------------------------------------------------

/** @type {Record<JobStatus, JobStatus[]>} */
const VALID_TRANSITIONS = {
  pending:   ['running', 'cancelled'],
  running:   ['completed', 'failed', 'cancelled'],
  completed: [],
  failed:    [],
  cancelled: [],
};

/**
 * @param {JobStatus} from
 * @param {JobStatus} to
 */
function assertTransition(from, to) {
  const allowed = VALID_TRANSITIONS[from];
  if (!allowed || !allowed.includes(to)) {
    throw new Error(`Invalid state transition: ${from} -> ${to}`);
  }
}

// ---------------------------------------------------------------------------
// SessionManager
// ---------------------------------------------------------------------------

export class SessionManager {
  /** @type {string} */
  #dataDir;

  /** @type {import('./copilot-client.mjs').CopilotReviewClient} */
  #client;

  /**
   * @param {{ dataDir: string, client: import('./copilot-client.mjs').CopilotReviewClient }} opts
   */
  constructor({ dataDir, client }) {
    this.#dataDir = dataDir;
    this.#client = client;
  }

  /**
   * Create a new review session.
   * @param {{ systemMessage?: string, model?: string, claudeSessionId?: string }} [opts]
   * @returns {Promise<JobRecord>}
   */
  async createReviewSession(opts = {}) {
    return this.#createSession('review', opts);
  }

  /**
   * Create a new task session.
   * @param {{ systemMessage?: string, model?: string, claudeSessionId?: string }} [opts]
   * @returns {Promise<JobRecord>}
   */
  async createTaskSession(opts = {}) {
    return this.#createSession('task', opts);
  }

  /**
   * Resume an existing job by looking up the Copilot session.
   * @param {string} jobId
   * @returns {Promise<JobRecord>}
   */
  async resumeSession(jobId) {
    const record = await readJob(this.#dataDir, jobId);
    if (!record) throw new Error(`Job not found: ${jobId}`);
    // Ensure the Copilot session is still tracked
    this.#client.resumeSession(record.sessionId);
    return record;
  }

  /**
   * Get a single job record (or null if not found).
   * @param {string} jobId
   * @returns {Promise<JobRecord | null>}
   */
  async getSession(jobId) {
    return readJob(this.#dataDir, jobId);
  }

  /**
   * List jobs, optionally filtered.
   * @param {{ claudeSessionId?: string, status?: JobStatus, type?: JobType }} [filter]
   * @returns {Promise<JobRecord[]>}
   */
  async listSessions(filter = {}) {
    const jobs = await listJobs(this.#dataDir);
    return jobs.filter(job => {
      if (filter.claudeSessionId && job.claudeSessionId !== filter.claudeSessionId) return false;
      if (filter.status && job.status !== filter.status) return false;
      if (filter.type && job.type !== filter.type) return false;
      return true;
    });
  }

  /**
   * Update a job record with status transition enforcement.
   * @param {string} jobId
   * @param {Partial<Pick<JobRecord, 'status' | 'result' | 'error'>>} update
   * @returns {Promise<void>}
   */
  async updateSession(jobId, update) {
    const record = await readJob(this.#dataDir, jobId);
    if (!record) throw new Error(`Job not found: ${jobId}`);

    if (update.status) {
      assertTransition(record.status, update.status);
      record.status = update.status;
    }
    if (update.result !== undefined) record.result = update.result;
    if (update.error !== undefined) record.error = update.error;
    record.updatedAt = new Date().toISOString();

    await writeJob(this.#dataDir, jobId, record);
  }

  /**
   * Cancel and clean up a single session.
   * @param {string} jobId
   * @returns {Promise<void>}
   */
  async cleanupSession(jobId) {
    const record = await readJob(this.#dataDir, jobId);
    if (!record) return;

    if (record.status === 'running' || record.status === 'pending') {
      try {
        await this.#client.abort(record.sessionId);
      } catch {
        // Best-effort abort
      }
      record.status = 'cancelled';
      record.updatedAt = new Date().toISOString();
      await writeJob(this.#dataDir, jobId, record);
    }
  }

  /**
   * Cancel all running/pending jobs.
   * @returns {Promise<void>}
   */
  async cleanupAll() {
    const jobs = await listJobs(this.#dataDir);
    const active = jobs.filter(j => j.status === 'running' || j.status === 'pending');
    await Promise.allSettled(active.map(j => this.cleanupSession(j.jobId)));
  }

  // -----------------------------------------------------------------------
  // Private
  // -----------------------------------------------------------------------

  /**
   * @param {JobType} type
   * @param {{ systemMessage?: string, model?: string, claudeSessionId?: string }} opts
   * @returns {Promise<JobRecord>}
   */
  async #createSession(type, opts) {
    const { sessionId } = await this.#client.createSession({
      systemMessage: opts.systemMessage,
      model: opts.model,
    });

    const jobId = `job-${Date.now()}-${randomBytes(4).toString('hex')}`;
    const now = new Date().toISOString();

    /** @type {JobRecord} */
    const record = {
      jobId,
      sessionId,
      type,
      status: 'pending',
      createdAt: now,
      updatedAt: now,
      ...(opts.claudeSessionId && { claudeSessionId: opts.claudeSessionId }),
    };

    await writeJob(this.#dataDir, jobId, record);
    return record;
  }
}
