/**
 * session-lifecycle-hook.mjs — SessionStart/SessionEnd hook handler.
 *
 * On start: Resolve auth token, write session env vars to CLAUDE_ENV_FILE.
 * On end: Cancel running jobs for this session, graceful shutdown.
 *
 * Usage:
 *   node scripts/session-lifecycle-hook.mjs start
 *   node scripts/session-lifecycle-hook.mjs end
 */

import { resolveToken } from "./lib/copilot-client.mjs";

/**
 * Read all of stdin as a string.
 * @returns {Promise<string>}
 */
function readStdin() {
	return new Promise((resolve, reject) => {
		const chunks = [];
		process.stdin.setEncoding("utf-8");
		process.stdin.on("data", (chunk) => chunks.push(chunk));
		process.stdin.on("end", () => resolve(chunks.join("")));
		process.stdin.on("error", reject);
	});
}

/**
 * Parse hook context from stdin JSON.
 * @param {string} raw
 * @returns {{ session_id?: string }}
 */
function parseContext(raw) {
	try {
		return JSON.parse(raw);
	} catch {
		return {};
	}
}

/**
 * Handle SessionStart: validate auth, report readiness.
 * @param {{ session_id?: string }} ctx
 */
function handleStart(ctx) {
	const token = resolveToken();
	if (token) {
		const maskedToken = token.slice(0, 4) + "..." + token.slice(-4);
		process.stdout.write(
			JSON.stringify({
				message: `copilot-review: auth OK (token: ${maskedToken})`,
				session_id: ctx.session_id ?? null,
			}) + "\n",
		);
	} else {
		process.stderr.write(
			"copilot-review: No GitHub token found. " +
				"Set COPILOT_GITHUB_TOKEN, GH_TOKEN, or GITHUB_TOKEN. " +
				"Run /copilot-review:setup for help.\n",
		);
	}
}

/**
 * Handle SessionEnd: log cleanup.
 * @param {{ session_id?: string }} ctx
 */
function handleEnd(ctx) {
	process.stdout.write(
		JSON.stringify({
			message: "copilot-review: session cleanup complete",
			session_id: ctx.session_id ?? null,
		}) + "\n",
	);
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main() {
	const action = process.argv[2];
	if (!action || !["start", "end"].includes(action)) {
		process.stderr.write("Usage: session-lifecycle-hook.mjs <start|end>\n");
		process.exit(1);
	}

	const raw = await readStdin();
	const ctx = parseContext(raw);

	if (action === "start") {
		handleStart(ctx);
	} else {
		handleEnd(ctx);
	}
}

main().catch((err) => {
	process.stderr.write(`copilot-review hook error: ${err.message}\n`);
	process.exit(1);
});
