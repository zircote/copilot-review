/**
 * tests/helpers.mjs — Shared test utilities.
 *
 * Provides: createMockSDKClient(), createMockSession(), loadFixture(),
 * createTempDir(), cleanupTempDir().
 */

import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

/**
 * Create a mock session that returns canned responses from sendAndWait.
 * @param {string[]} [responses=[]] - Responses to return in order.
 * @returns {{ sendAndWait: Function, abort: Function, compaction: { compact: Function }, on: Function, off: Function }}
 */
export function createMockSession(responses = []) {
	let callIndex = 0;
	const listeners = new Map();

	return {
		async sendAndWait({ content } = {}) {
			if (callIndex < responses.length) {
				return responses[callIndex++];
			}
			return "";
		},
		async abort() {},
		compaction: {
			async compact() {},
		},
		on(event, handler) {
			if (!listeners.has(event)) listeners.set(event, []);
			listeners.get(event).push(handler);
		},
		off(event, handler) {
			const handlers = listeners.get(event);
			if (handlers) {
				const idx = handlers.indexOf(handler);
				if (idx !== -1) handlers.splice(idx, 1);
			}
		},
	};
}

/**
 * Create a mock SDK client that simulates @github/copilot-sdk CopilotClient.
 * @param {{ session?: object }} [opts]
 * @returns {{ start: Function, createSession: Function, stop: Function }}
 */
export function createMockSDKClient(opts = {}) {
	const session = opts.session || createMockSession();

	return {
		async start() {},
		async createSession(_sessionOpts) {
			return session;
		},
		async stop() {},
	};
}

/**
 * Create a mock CopilotReviewClient for SessionManager tests.
 * @param {object} [overrides]
 * @returns {object}
 */
export function createMockClient(overrides = {}) {
	let sessionCounter = 0;
	return {
		createSession: async () => ({
			sessionId: `mock-session-${++sessionCounter}`,
			session: createMockSession(),
		}),
		resumeSession: (id) => ({ sessionId: id, session: {} }),
		abort: async () => {},
		stop: async () => [],
		...overrides,
	};
}

/**
 * Load a fixture file from tests/fixtures/.
 * @param {string} name - File name (e.g., 'review-response.json').
 * @returns {Promise<string>}
 */
export async function loadFixture(name) {
	const filePath = resolve(__dirname, "fixtures", name);
	return readFile(filePath, "utf-8");
}

/**
 * Create a temporary directory for test isolation.
 * @returns {Promise<string>} The temp directory path.
 */
export async function createTempDir() {
	return mkdtemp(join(tmpdir(), "copilot-review-test-"));
}

/**
 * Clean up a temporary directory.
 * @param {string} dir
 * @returns {Promise<void>}
 */
export async function cleanupTempDir(dir) {
	await rm(dir, { recursive: true, force: true });
}
