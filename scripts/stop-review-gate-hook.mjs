#!/usr/bin/env node

/**
 * stop-review-gate-hook.mjs — Stop hook for Copilot review gate.
 *
 * When enabled via /copilot-review:setup --enable-review-gate, this hook
 * fires before a Claude Code session ends. It sends the last assistant
 * message to Copilot for review and blocks session termination if Copilot
 * finds issues with code changes from the last turn.
 *
 * All operations are synchronous because this hook blocks session stop.
 */

import { spawnSync } from "node:child_process";
import { readFileSync, realpathSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { getConfig, resolveWorkspaceRoot } from "./lib/config.mjs";
import { resolveToken } from "./lib/copilot-client.mjs";
import { interpolateTemplate, loadPromptTemplate } from "./lib/prompts.mjs";

const STOP_REVIEW_TIMEOUT_MS = 15 * 60 * 1000;
const SCRIPT_DIR = dirname(fileURLToPath(import.meta.url));
const ROOT_DIR = resolve(SCRIPT_DIR, "..");

// ---------------------------------------------------------------------------
// Hook I/O
// ---------------------------------------------------------------------------

function readHookInput() {
	const raw = readFileSync(0, "utf8").trim();
	if (!raw) return {};
	try {
		return JSON.parse(raw);
	} catch {
		return {};
	}
}

function emitDecision(payload) {
	process.stdout.write(`${JSON.stringify(payload)}\n`);
}

function logNote(message) {
	if (message) process.stderr.write(`${message}\n`);
}

// ---------------------------------------------------------------------------
// Review prompt construction
// ---------------------------------------------------------------------------

/**
 * Build the stop-gate review prompt from the template.
 * @param {object} input - Hook input context.
 * @param {string} [input.last_assistant_message]
 * @returns {string}
 */
export function buildStopReviewPrompt(input = {}) {
	const lastMessage = String(input.last_assistant_message ?? "").trim();
	const template = loadPromptTemplate(ROOT_DIR, "stop-review-gate");
	const claudeResponseBlock = lastMessage ? `Previous Claude response:\n${lastMessage}` : "";
	return interpolateTemplate(template, {
		CLAUDE_RESPONSE_BLOCK: claudeResponseBlock,
	});
}

// ---------------------------------------------------------------------------
// Output parsing
// ---------------------------------------------------------------------------

/**
 * Parse the ALLOW/BLOCK decision from Copilot's response.
 * @param {string} rawOutput
 * @returns {{ ok: boolean, reason: string | null }}
 */
export function parseStopReviewOutput(rawOutput) {
	const text = String(rawOutput ?? "").trim();
	if (!text) {
		return {
			ok: false,
			reason:
				"The stop-time Copilot review returned no output. " +
				"Run /copilot-review:review manually or bypass the gate.",
		};
	}

	const firstLine = text.split(/\r?\n/, 1)[0].trim();
	if (firstLine.startsWith("ALLOW:")) {
		return { ok: true, reason: null };
	}
	if (firstLine.startsWith("BLOCK:")) {
		const reason = firstLine.slice("BLOCK:".length).trim() || text;
		return {
			ok: false,
			reason: `Copilot stop-time review found issues that still need fixes: ${reason}`,
		};
	}

	return {
		ok: false,
		reason:
			"The stop-time Copilot review returned an unexpected answer. " +
			"Run /copilot-review:review manually or bypass the gate.",
	};
}

// ---------------------------------------------------------------------------
// Review execution
// ---------------------------------------------------------------------------

function runStopReview(cwd, input = {}) {
	const scriptPath = join(SCRIPT_DIR, "copilot-companion.mjs");
	const prompt = buildStopReviewPrompt(input);

	const result = spawnSync(process.execPath, [scriptPath, "task", prompt, "--json"], {
		cwd,
		env: { ...process.env },
		encoding: "utf8",
		timeout: STOP_REVIEW_TIMEOUT_MS,
	});

	if (result.error?.code === "ETIMEDOUT") {
		return {
			ok: false,
			reason:
				"The stop-time Copilot review timed out after 15 minutes. " +
				"Run /copilot-review:review manually or bypass the gate.",
		};
	}

	if (result.status !== 0) {
		const detail = String(result.stderr || result.stdout || "").trim();
		return {
			ok: false,
			reason: detail
				? `The stop-time Copilot review failed: ${detail}`
				: "The stop-time Copilot review failed. " +
					"Run /copilot-review:review manually or bypass the gate.",
		};
	}

	try {
		const payload = JSON.parse(result.stdout);
		return parseStopReviewOutput(payload?.rawOutput);
	} catch {
		return {
			ok: false,
			reason:
				"The stop-time Copilot review returned invalid JSON. " +
				"Run /copilot-review:review manually or bypass the gate.",
		};
	}
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

function main() {
	const input = readHookInput();
	const cwd = input.cwd || process.env.CLAUDE_PROJECT_DIR || process.cwd();
	const workspaceRoot = resolveWorkspaceRoot(cwd);
	const config = getConfig(workspaceRoot);

	if (!config.stopReviewGate) {
		return;
	}

	const token = resolveToken();
	if (!token) {
		logNote(
			"copilot-review: No GitHub token found for review gate. " +
				"Run /copilot-review:setup to configure.",
		);
		return;
	}

	const review = runStopReview(cwd, input);
	if (!review.ok) {
		emitDecision({ decision: "block", reason: review.reason });
	}
}

// Only run main when invoked directly (not when imported for testing)
const isDirectRun = (() => {
	try {
		return realpathSync(fileURLToPath(import.meta.url)) === realpathSync(process.argv[1]);
	} catch {
		return false;
	}
})();

if (isDirectRun) {
	try {
		main();
	} catch (error) {
		const message = error instanceof Error ? error.message : String(error);
		process.stderr.write(`copilot-review stop gate error: ${message}\n`);
		process.exitCode = 1;
	}
}
