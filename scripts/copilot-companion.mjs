/**
 * copilot-companion.mjs — Main CLI entry point for copilot-review plugin.
 *
 * Dispatches subcommands: setup, review, adversarial-review, task, status, result, cancel.
 * Invoked by Claude Code command .md files.
 */

import { parseArgs } from './lib/args.mjs';
import { CopilotReviewClient, resolveToken, AuthError } from './lib/copilot-client.mjs';
import { SessionManager } from './lib/session-manager.mjs';
import { getDiff } from './lib/git.mjs';
import { runReview } from './lib/review.mjs';
import { renderReview, renderJobList, renderJobResult, renderError } from './lib/render.mjs';
import { readJob, listJobs } from './lib/state.mjs';

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
  return process.env.CLAUDE_PLUGIN_DATA || '/tmp/copilot-review';
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
  'adversarial-review': handleAdversarialReview,
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
      'No GitHub token found.\n\n' +
      'Set one of these environment variables:\n' +
      '  COPILOT_GITHUB_TOKEN  (preferred)\n' +
      '  GH_TOKEN\n' +
      '  GITHUB_TOKEN\n\n' +
      'The token needs "Copilot Requests" permission.\n'
    );
    process.exit(EXIT_USER_ERROR);
  }

  const masked = token.slice(0, 4) + '...' + token.slice(-4);
  process.stdout.write(`Authentication: OK (token: ${masked})\n`);

  try {
    const client = await createClient();
    process.stdout.write('Copilot SDK connection: OK\n');
    await client.stop();
  } catch (err) {
    process.stdout.write(`Copilot SDK connection: FAILED — ${err.message}\n`);
    process.exit(EXIT_SDK_ERROR);
  }
}

/**
 * @param {Record<string, string|boolean>} flags
 * @param {string[]} _positionals
 */
async function handleReview(flags, _positionals) {
  await runReviewMode('standard', flags);
}

/**
 * @param {Record<string, string|boolean>} flags
 * @param {string[]} _positionals
 */
async function handleAdversarialReview(flags, _positionals) {
  await runReviewMode('adversarial', flags);
}

/**
 * Shared logic for standard and adversarial review.
 * @param {'standard'|'adversarial'} mode
 * @param {Record<string, string|boolean>} flags
 */
async function runReviewMode(mode, flags) {
  const staged = flags.staged === true;
  const files = typeof flags.files === 'string' ? flags.files.split(',') : undefined;

  const diff = await getDiff({ staged, files });
  if (!diff) {
    process.stdout.write('No changes to review.\n');
    process.exit(EXIT_OK);
  }

  const client = await createClient();
  const sessionManager = createSessionManager(client);

  try {
    const result = await runReview({
      client,
      sessionManager,
      diff,
      mode,
      options: { claudeSessionId: process.env.CLAUDE_SESSION_ID },
    });

    process.stdout.write(renderReview(result) + '\n');

    // Exit 3 if prose fallback was used
    const isProseFallback = result.summary?.includes('prose review') ||
      result.summary?.includes('JSON parsing failed');
    process.exit(isProseFallback ? EXIT_PROSE_FALLBACK : EXIT_OK);
  } finally {
    await client.stop();
  }
}

/**
 * @param {Record<string, string|boolean>} flags
 * @param {string[]} positionals
 */
async function handleTask(flags, positionals) {
  const prompt = positionals.join(' ');
  if (!prompt) {
    process.stderr.write('Usage: copilot-companion task <prompt...>\n');
    process.exit(EXIT_USER_ERROR);
  }

  const client = await createClient();
  const sessionManager = createSessionManager(client);

  try {
    const job = await sessionManager.createTaskSession({
      claudeSessionId: process.env.CLAUDE_SESSION_ID,
    });

    await sessionManager.updateSession(job.jobId, { status: 'running' });

    const responseText = await client.send(job.sessionId, prompt);
    await sessionManager.updateSession(job.jobId, { status: 'completed', result: responseText });

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
    jobs = jobs.filter(j => j.claudeSessionId === process.env.CLAUDE_SESSION_ID);
  }

  process.stdout.write(renderJobList(jobs) + '\n');
}

/**
 * @param {Record<string, string|boolean>} _flags
 * @param {string[]} positionals
 */
async function handleResult(_flags, positionals) {
  const jobId = positionals[0];
  if (!jobId) {
    process.stderr.write('Usage: copilot-companion result <job-id>\n');
    process.exit(EXIT_USER_ERROR);
  }

  const dataDir = getDataDir();
  const job = await readJob(dataDir, jobId);
  if (!job) {
    process.stderr.write(`Job not found: ${jobId}\n`);
    process.exit(EXIT_USER_ERROR);
  }

  process.stdout.write(renderJobResult(job) + '\n');
}

/**
 * @param {Record<string, string|boolean>} _flags
 * @param {string[]} positionals
 */
async function handleCancel(_flags, positionals) {
  const jobId = positionals[0];
  if (!jobId) {
    process.stderr.write('Usage: copilot-companion cancel <job-id>\n');
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

  if (!command || command === 'help') {
    const cmds = Object.keys(COMMANDS).join(', ');
    process.stdout.write(
      'copilot-review — Use GitHub Copilot to review code from Claude Code.\n\n' +
      `Commands: ${cmds}\n\n` +
      'Usage:\n' +
      '  copilot-companion setup              Verify auth configuration\n' +
      '  copilot-companion review [--staged]   Review current diff\n' +
      '  copilot-companion adversarial-review  Adversarial review mode\n' +
      '  copilot-companion task <prompt...>    Run a Copilot task\n' +
      '  copilot-companion status [--all]      List jobs\n' +
      '  copilot-companion result <job-id>     Show job result\n' +
      '  copilot-companion cancel <job-id>     Cancel a job\n'
    );
    process.exit(command ? EXIT_OK : EXIT_USER_ERROR);
  }

  const handler = COMMANDS[command];
  if (!handler) {
    process.stderr.write(
      `Unknown command: ${command}\n\nAvailable commands: ${Object.keys(COMMANDS).join(', ')}\n`
    );
    process.exit(EXIT_USER_ERROR);
  }

  await handler(flags, positionals);
}

main().catch(err => {
  if (err instanceof AuthError) {
    process.stderr.write(
      `${err.message}\n\nRun "copilot-companion setup" for configuration help.\n`
    );
    process.exit(EXIT_USER_ERROR);
  }

  process.stderr.write(renderError(err) + '\n');
  process.exit(EXIT_SDK_ERROR);
});
