/**
 * copilot-companion.mjs — Main CLI entry point for copilot-review plugin.
 *
 * Dispatches subcommands: setup, review, adversarial-review, task, status, result, cancel.
 * Invoked by Claude Code command .md files.
 */

import { parseArgs } from "./lib/args.mjs";
import { AuthError, CopilotReviewClient, resolveToken } from "./lib/copilot-client.mjs";
import {
	getPrDiff,
	getRawDiff,
	groupIntoChunks,
	needsChunking,
	parseDiffRange,
	parsePrRef,
	splitDiffByFile,
} from "./lib/git.mjs";
import { renderError, renderJobList, renderJobResult, renderReview } from "./lib/render.mjs";
import { runChunkedReview, runReview } from "./lib/review.mjs";
import { SessionManager } from "./lib/session-manager.mjs";
import { listJobs, readJob } from "./lib/state.mjs";

// ---------------------------------------------------------------------------
// Exit codes
// ---------------------------------------------------------------------------

const EXIT_OK = 0;
const EXIT_USER_ERROR = 1;
const EXIT_SDK_ERROR = 2;
const EXIT_PROSE_FALLBACK = 3;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Resolve the data directory for job persistence.
 * @returns {string}
 */
function getDataDir() {
	return process.env.CLAUDE_PLUGIN_DATA || "/tmp/copilot-review";
}

/**
 * Create a CopilotReviewClient and start it.
 * @returns {Promise<CopilotReviewClient>}
 */
async function createClient() {
	const client = new CopilotReviewClient({});
	await client.start();
	return client;
}

/**
 * Create a SessionManager backed by a live client.
 * @param {CopilotReviewClient} client
 * @returns {SessionManager}
 */
function createSessionManager(client) {
	return new SessionManager({ dataDir: getDataDir(), client });
}

// ---------------------------------------------------------------------------
// Command table
// ---------------------------------------------------------------------------

const COMMANDS = {
	setup: handleSetup,
	review: handleReview,
	"adversarial-review": handleAdversarialReview,
	task: handleTask,
	status: handleStatus,
	result: handleResult,
	cancel: handleCancel,
};

// ---------------------------------------------------------------------------
// Handlers
// ---------------------------------------------------------------------------

/** @param {Record<string, string|boolean>} _flags */
async function handleSetup(_flags) {
	const token = resolveToken();
	if (!token) {
		process.stdout.write(
			"No GitHub token found.\n\n" +
				"Set one of these environment variables:\n" +
				"  COPILOT_GITHUB_TOKEN  (preferred)\n" +
				"  GH_TOKEN\n" +
				"  GITHUB_TOKEN\n\n" +
				'The token needs "Copilot Requests" permission.\n',
		);
		process.exit(EXIT_USER_ERROR);
	}

	const masked = `${token.slice(0, 4)}...${token.slice(-4)}`;
	process.stdout.write(`Authentication: OK (token: ${masked})\n`);

	try {
		const client = await createClient();
		process.stdout.write("Copilot SDK connection: OK\n");
		await client.stop();
	} catch (err) {
		process.stdout.write(`Copilot SDK connection: FAILED — ${err.message}\n`);
		process.exit(EXIT_SDK_ERROR);
	}
}

/**
 * @param {Record<string, string|boolean>} flags
 * @param {string[]} positionals
 */
async function handleReview(flags, positionals) {
	await runReviewMode("standard", flags, positionals);
}

/**
 * @param {Record<string, string|boolean>} flags
 * @param {string[]} positionals
 */
async function handleAdversarialReview(flags, positionals) {
	await runReviewMode("adversarial", flags, positionals);
}

/**
 * Shared logic for standard and adversarial review.
 * @param {'standard'|'adversarial'} mode
 * @param {Record<string, string|boolean>} flags
 * @param {string[]} positionals
 */
async function runReviewMode(mode, flags, positionals = []) {
	const staged = flags.staged === true;
	const files = typeof flags.files === "string" ? flags.files.split(",") : undefined;
	const prFlag = typeof flags.pr === "string" ? flags.pr : null;
	const prRef = parsePrRef(prFlag);

	let rawDiff;

	if (prRef) {
		// PR mode: fetch diff from GitHub API via gh CLI
		rawDiff = await getPrDiff(prRef);
	} else if (prFlag) {
		// --pr was given but couldn't be parsed
		process.stderr.write(
			`Invalid PR reference: ${prFlag}\n` +
				"Accepted formats: 42, #42, owner/repo#42, https://github.com/owner/repo/pull/42\n",
		);
		process.exit(EXIT_USER_ERROR);
	} else {
		// Local diff modes: range positional, --base/--head, --staged, or working tree
		const rangeArg = positionals[0] || null;
		const range = parseDiffRange(rangeArg);
		const base = range ? null : typeof flags.base === "string" ? flags.base : null;
		const head = range ? null : typeof flags.head === "string" ? flags.head : null;
		rawDiff = await getRawDiff({ staged, base, head, range, files });
	}
	if (!rawDiff) {
		process.stdout.write("No changes to review.\n");
		process.exit(EXIT_OK);
	}

	const client = await createClient();
	const sessionManager = createSessionManager(client);

	try {
		let result;

		if (needsChunking(rawDiff)) {
			// Large diff: split by file and review in chunks
			const fileDiffs = splitDiffByFile(rawDiff);
			const chunks = groupIntoChunks(fileDiffs);

			process.stderr.write(
				`Diff is ${Math.round(Buffer.byteLength(rawDiff, "utf-8") / 1024)}KB — ` +
					`reviewing in ${chunks.length} chunks (${fileDiffs.length} files).\n`,
			);

			result = await runChunkedReview({
				client,
				sessionManager,
				chunks,
				mode,
				options: { claudeSessionId: process.env.CLAUDE_SESSION_ID },
				onProgress: ({ chunk, total }) => {
					process.stderr.write(`Reviewing chunk ${chunk}/${total}...\n`);
				},
			});
		} else {
			// Small diff: single-shot review
			result = await runReview({
				client,
				sessionManager,
				diff: rawDiff,
				mode,
				options: { claudeSessionId: process.env.CLAUDE_SESSION_ID },
			});
		}

		process.stdout.write(`${renderReview(result)}\n`);

		// Exit 3 if prose fallback was used
		const isProseFallback =
			result.summary?.includes("prose review") || result.summary?.includes("JSON parsing failed");
		process.exit(isProseFallback ? EXIT_PROSE_FALLBACK : EXIT_OK);
	} finally {
		await client.stop();
	}
}

/**
 * @param {Record<string, string|boolean>} flags
 * @param {string[]} positionals
 */
async function handleTask(_flags, positionals) {
	const prompt = positionals.join(" ");
	if (!prompt) {
		process.stderr.write("Usage: copilot-companion task <prompt...>\n");
		process.exit(EXIT_USER_ERROR);
	}

	const client = await createClient();
	const sessionManager = createSessionManager(client);

	try {
		const job = await sessionManager.createTaskSession({
			claudeSessionId: process.env.CLAUDE_SESSION_ID,
		});

		await sessionManager.updateSession(job.jobId, { status: "running" });

		const responseText = await client.send(job.sessionId, prompt);
		await sessionManager.updateSession(job.jobId, { status: "completed", result: responseText });

		process.stdout.write(`Job: ${job.jobId}\n\n${responseText}\n`);
	} catch (err) {
		process.stderr.write(`Task failed: ${err.message}\n`);
		process.exit(EXIT_SDK_ERROR);
	} finally {
		await client.stop();
	}
}

/** @param {Record<string, string|boolean>} flags */
async function handleStatus(flags) {
	const dataDir = getDataDir();
	let jobs = await listJobs(dataDir);

	// Filter to current Claude session unless --all is set
	if (!flags.all && process.env.CLAUDE_SESSION_ID) {
		jobs = jobs.filter((j) => j.claudeSessionId === process.env.CLAUDE_SESSION_ID);
	}

	process.stdout.write(`${renderJobList(jobs)}\n`);
}

/**
 * @param {Record<string, string|boolean>} _flags
 * @param {string[]} positionals
 */
async function handleResult(_flags, positionals) {
	const jobId = positionals[0];
	if (!jobId) {
		process.stderr.write("Usage: copilot-companion result <job-id>\n");
		process.exit(EXIT_USER_ERROR);
	}

	const dataDir = getDataDir();
	const job = await readJob(dataDir, jobId);
	if (!job) {
		process.stderr.write(`Job not found: ${jobId}\n`);
		process.exit(EXIT_USER_ERROR);
	}

	process.stdout.write(`${renderJobResult(job)}\n`);
}

/**
 * @param {Record<string, string|boolean>} _flags
 * @param {string[]} positionals
 */
async function handleCancel(_flags, positionals) {
	const jobId = positionals[0];
	if (!jobId) {
		process.stderr.write("Usage: copilot-companion cancel <job-id>\n");
		process.exit(EXIT_USER_ERROR);
	}

	const client = await createClient();
	const sessionManager = createSessionManager(client);

	try {
		await sessionManager.cleanupSession(jobId);
		process.stdout.write(`Cancelled job: ${jobId}\n`);
	} finally {
		await client.stop();
	}
}

// ---------------------------------------------------------------------------
// Main dispatch
// ---------------------------------------------------------------------------

async function main() {
	const { command, flags, positionals } = parseArgs();

	if (!command || command === "help") {
		const cmds = Object.keys(COMMANDS).join(", ");
		process.stdout.write(
			"copilot-review — Use GitHub Copilot to review code from Claude Code.\n\n" +
				`Commands: ${cmds}\n\n` +
				"Usage:\n" +
				"  /copilot-review:setup              Verify auth configuration\n" +
				"  /copilot-review:review [options]    Review current diff\n" +
				"  /copilot-review:adversarial-review  Adversarial review mode\n" +
				"  /copilot-review:task <prompt...>    Run a Copilot task\n" +
				"  /copilot-review:status [--all]      List jobs\n" +
				"  /copilot-review:result <job-id>     Show job result\n" +
				"  /copilot-review:cancel <job-id>     Cancel a job\n\n" +
				"Review options:\n" +
				"  <range>              Diff range: sha1...sha2, sha1..sha2, ...sha2, sha1\n" +
				"  --pr <ref>           Review a GitHub PR (42, owner/repo#42, or URL)\n" +
				"  --staged             Review only staged changes\n" +
				"  --base <ref>         Base ref for cold review (tag, branch, SHA)\n" +
				"  --head <ref>         Head ref (default: HEAD)\n" +
				"  --files <glob,...>    Restrict to specific files\n\n" +
				"Examples:\n" +
				"  /copilot-review:review --pr 42                 Review PR #42 in current repo\n" +
				"  /copilot-review:review --pr owner/repo#42      Review PR #42 in owner/repo\n" +
				"  /copilot-review:review abc123...def456         Three-dot range (merge-base)\n" +
				"  /copilot-review:review abc123..def456          Two-dot range (direct diff)\n" +
				"  /copilot-review:review ...feature-branch       Changes on feature-branch\n" +
				"  /copilot-review:review v1.0.0                  Changes since v1.0.0\n" +
				"  /copilot-review:review --base v1.0.0           Same, using flag syntax\n" +
				"  /copilot-review:review --base main             Review branch vs main\n" +
				"  /copilot-review:review --base abc123 --head def456  Review commit range\n",
		);
		process.exit(command ? EXIT_OK : EXIT_USER_ERROR);
	}

	const handler = COMMANDS[command];
	if (!handler) {
		process.stderr.write(
			`Unknown command: ${command}\n\nAvailable commands: ${Object.keys(COMMANDS).join(", ")}\n`,
		);
		process.exit(EXIT_USER_ERROR);
	}

	await handler(flags, positionals);
}

main().catch((err) => {
	if (err instanceof AuthError) {
		process.stderr.write(`${err.message}\n\nRun "/copilot-review:setup" for configuration help.\n`);
		process.exit(EXIT_USER_ERROR);
	}

	process.stderr.write(`${renderError(err)}\n`);
	process.exit(EXIT_SDK_ERROR);
});
