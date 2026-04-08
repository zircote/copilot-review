/**
 * copilot-client.mjs — CopilotReviewClient class.
 *
 * Wrapper around @github/copilot-sdk providing:
 * - Auth resolution (COPILOT_GITHUB_TOKEN > GH_TOKEN > GITHUB_TOKEN)
 * - Session lifecycle (create, resume, list)
 * - Prompt send/streaming with blob attachments
 * - Circuit breaker (3 consecutive failures = unhealthy)
 * - Graceful shutdown
 */

import { randomBytes } from 'node:crypto';

/** @type {typeof import('@github/copilot-sdk').CopilotClient | null} */
let _CopilotClient = null;

/**
 * Lazy-load the Copilot SDK to avoid import failures when the SDK
 * has ESM resolution issues (e.g., vscode-jsonrpc missing .js extension).
 * This allows resolveToken() and error classes to work without the SDK.
 * @returns {Promise<typeof import('@github/copilot-sdk').CopilotClient>}
 */
async function getCopilotClient() {
  if (!_CopilotClient) {
    const sdk = await import('@github/copilot-sdk');
    _CopilotClient = sdk.CopilotClient;
  }
  return _CopilotClient;
}

// ---------------------------------------------------------------------------
// Error classes
// ---------------------------------------------------------------------------

export class AuthError extends Error {
  /** @param {string} message */
  constructor(message) {
    super(message);
    this.name = 'AuthError';
  }
}

export class CircuitBreakerError extends Error {
  /** @param {string} sessionId */
  constructor(sessionId) {
    super(`Circuit breaker open for session ${sessionId}: 3 consecutive failures`);
    this.name = 'CircuitBreakerError';
    this.sessionId = sessionId;
  }
}

export class SessionNotFoundError extends Error {
  /** @param {string} sessionId */
  constructor(sessionId) {
    super(`Session not found: ${sessionId}`);
    this.name = 'SessionNotFoundError';
    this.sessionId = sessionId;
  }
}

// ---------------------------------------------------------------------------
// Auth resolution
// ---------------------------------------------------------------------------

const TOKEN_ENV_VARS = ['COPILOT_GITHUB_TOKEN', 'GH_TOKEN', 'GITHUB_TOKEN'];

/**
 * Resolve a GitHub token from environment variables.
 * @returns {string | null} The first token found, or null.
 */
export function resolveToken() {
  for (const key of TOKEN_ENV_VARS) {
    const val = process.env[key];
    if (val) return val;
  }
  return null;
}

// ---------------------------------------------------------------------------
// Circuit breaker constants
// ---------------------------------------------------------------------------

const CIRCUIT_BREAKER_THRESHOLD = 3;

// ---------------------------------------------------------------------------
// CopilotReviewClient
// ---------------------------------------------------------------------------

export class CopilotReviewClient {
  /** @type {import('@github/copilot-sdk').CopilotClient | null} */
  #client = null;

  /** @type {Map<string, any>} Active sessions keyed by sessionId */
  #sessions = new Map();

  /** @type {Map<string, number>} Consecutive failure counts per session */
  #failures = new Map();

  /** @type {string} GitHub auth token */
  #token;

  /** @type {string | undefined} Default model override */
  #model;

  /**
   * @param {{ token?: string, model?: string }} opts
   */
  constructor({ token, model } = {}) {
    this.#token = token ?? resolveToken();
    if (!this.#token) {
      throw new AuthError(
        'No GitHub token found. Set COPILOT_GITHUB_TOKEN, GH_TOKEN, or GITHUB_TOKEN. ' +
        'Run /copilot-review setup for help.'
      );
    }
    this.#model = model;
  }

  /**
   * Initialize the SDK client and verify auth.
   * @returns {Promise<void>}
   */
  async start() {
    try {
      const CopilotClient = await getCopilotClient();
      this.#client = new CopilotClient({ githubToken: this.#token });
      await this.#client.start();
    } catch (err) {
      if (err instanceof AuthError) throw err;
      throw new AuthError(`Failed to start Copilot client: ${err.message}`);
    }
  }

  /**
   * Create a new session.
   * @param {{ systemMessage?: string, model?: string }} [opts]
   * @returns {Promise<{ sessionId: string, session: any }>}
   */
  async createSession(opts = {}) {
    this.#requireClient();
    const sessionId = `review-${Date.now()}-${randomBytes(4).toString('hex')}`;
    const sessionOpts = {
      ...(opts.systemMessage && { systemMessage: opts.systemMessage }),
      ...(opts.model || this.#model) && { model: opts.model || this.#model },
      onPermissionRequest: async () => ({ kind: 'approved' }),
    };
    const session = await this.#client.createSession(sessionOpts);
    this.#sessions.set(sessionId, session);
    this.#failures.set(sessionId, 0);
    return { sessionId, session };
  }

  /**
   * Resume an existing session by ID.
   * @param {string} sessionId
   * @returns {{ sessionId: string, session: any }}
   */
  resumeSession(sessionId) {
    const session = this.#sessions.get(sessionId);
    if (!session) throw new SessionNotFoundError(sessionId);
    return { sessionId, session };
  }

  /**
   * List all active sessions.
   * @returns {{ sessionId: string, healthy: boolean }[]}
   */
  listSessions() {
    const result = [];
    for (const [sessionId] of this.#sessions) {
      result.push({
        sessionId,
        healthy: (this.#failures.get(sessionId) ?? 0) < CIRCUIT_BREAKER_THRESHOLD,
      });
    }
    return result;
  }

  /**
   * Send a prompt to a session and wait for the full response.
   * @param {string} sessionId
   * @param {string} prompt
   * @param {{ name: string, data: string, mimeType?: string }[]} [attachments]
   * @returns {Promise<string>} The assistant's response text.
   */
  async send(sessionId, prompt, attachments = []) {
    this.#requireHealthy(sessionId);
    const session = this.#getSession(sessionId);
    const content = this.#buildContent(prompt, attachments);

    try {
      const response = await session.sendAndWait({ content });
      this.#failures.set(sessionId, 0);
      return this.#extractText(response);
    } catch (err) {
      this.#recordFailure(sessionId);
      throw err;
    }
  }

  /**
   * Send a prompt with streaming deltas.
   * @param {string} sessionId
   * @param {string} prompt
   * @param {{ name: string, data: string, mimeType?: string }[]} [attachments]
   * @param {(delta: any) => void} [onDelta]
   * @returns {Promise<string>} The assistant's full response text.
   */
  async sendStreaming(sessionId, prompt, attachments = [], onDelta) {
    this.#requireHealthy(sessionId);
    const session = this.#getSession(sessionId);
    const content = this.#buildContent(prompt, attachments);

    if (onDelta) {
      session.on('assistant.message_delta', onDelta);
    }

    try {
      const response = await session.sendAndWait({ content });
      this.#failures.set(sessionId, 0);
      return this.#extractText(response);
    } catch (err) {
      this.#recordFailure(sessionId);
      throw err;
    } finally {
      if (onDelta) {
        session.off('assistant.message_delta', onDelta);
      }
    }
  }

  /**
   * Abort a running turn in the given session.
   * @param {string} sessionId
   * @returns {Promise<void>}
   */
  async abort(sessionId) {
    const session = this.#getSession(sessionId);
    await session.abort();
  }

  /**
   * Compact session context to free token budget.
   * @param {string} sessionId
   * @returns {Promise<void>}
   */
  async compact(sessionId) {
    const session = this.#getSession(sessionId);
    await session.compaction.compact();
  }

  /**
   * Gracefully shut down the client and all sessions.
   * @returns {Promise<Error[]>} Any errors encountered during shutdown.
   */
  async stop() {
    const errors = [];
    if (this.#client) {
      try {
        await this.#client.stop();
      } catch (err) {
        errors.push(err);
      }
    }
    this.#sessions.clear();
    this.#failures.clear();
    return errors;
  }

  // -----------------------------------------------------------------------
  // Private helpers
  // -----------------------------------------------------------------------

  #requireClient() {
    if (!this.#client) {
      throw new Error('Client not started. Call start() first.');
    }
  }

  /**
   * @param {string} sessionId
   * @returns {any}
   */
  #getSession(sessionId) {
    const session = this.#sessions.get(sessionId);
    if (!session) throw new SessionNotFoundError(sessionId);
    return session;
  }

  /**
   * @param {string} sessionId
   */
  #requireHealthy(sessionId) {
    this.#getSession(sessionId); // throws if missing
    const count = this.#failures.get(sessionId) ?? 0;
    if (count >= CIRCUIT_BREAKER_THRESHOLD) {
      throw new CircuitBreakerError(sessionId);
    }
  }

  /**
   * @param {string} sessionId
   */
  #recordFailure(sessionId) {
    const count = this.#failures.get(sessionId) ?? 0;
    this.#failures.set(sessionId, count + 1);
  }

  /**
   * Build the content array for sendAndWait.
   * @param {string} prompt
   * @param {{ name: string, data: string, mimeType?: string }[]} attachments
   * @returns {any[]}
   */
  #buildContent(prompt, attachments) {
    /** @type {any[]} */
    const content = [{ type: 'text', text: prompt }];
    for (const att of attachments) {
      content.push({
        type: 'blob',
        name: att.name,
        data: att.data,
        mimeType: att.mimeType ?? 'text/plain',
      });
    }
    return content;
  }

  /**
   * Extract text from a Copilot SDK response.
   * @param {any} response
   * @returns {string}
   */
  #extractText(response) {
    if (typeof response === 'string') return response;
    if (response?.content) {
      const textParts = response.content
        .filter(/** @param {any} c */ c => c.type === 'text')
        .map(/** @param {any} c */ c => c.text);
      return textParts.join('');
    }
    return String(response);
  }
}
