/**
 * review.mjs — Review orchestration and response parsing.
 *
 * Implements the 3-layer parsing strategy:
 * 1. JSON fence extraction from Copilot response
 * 2. Retry with stricter prompt (max 1 retry)
 * 3. Prose fallback with synthetic ReviewResult
 *
 * Also handles: prompt loading, schema validation, diff attachment.
 */

import { readFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

/** Root of the plugin (two levels up from scripts/lib/). */
const pluginRoot = resolve(__dirname, "..", "..");

/** Valid verdict values. */
const VALID_VERDICTS = ["approve", "request_changes", "comment"];

/** Valid severity values. */
const VALID_SEVERITIES = ["critical", "warning", "suggestion", "nitpick"];

/** Max raw text length in prose fallback. */
const MAX_PROSE_LENGTH = 4000;

/** Retry prompt sent when Layer 1 parsing fails. */
const RETRY_PROMPT =
	"Your previous response could not be parsed as valid JSON. Please respond with ONLY a ```json code fence containing the review in the exact format requested. No other text whatsoever.";

/**
 * @typedef {object} Finding
 * @property {string} file
 * @property {number} [line]
 * @property {string} severity
 * @property {string} message
 * @property {string} [suggestion]
 */

/**
 * @typedef {object} ReviewResult
 * @property {string} summary
 * @property {string} verdict
 * @property {Finding[]} findings
 */

/**
 * @typedef {object} ValidationResult
 * @property {boolean} valid
 * @property {string[]} errors
 */

/**
 * Load a system prompt file by review mode.
 * @param {'standard'|'adversarial'} mode
 * @returns {Promise<string>} The prompt file contents.
 */
export async function loadSystemPrompt(mode) {
	const filename = mode === "adversarial" ? "adversarial-review-system" : "review-system";
	const promptPath = resolve(pluginRoot, "prompts", `${filename}.md`);
	return readFile(promptPath, "utf-8");
}

/**
 * Extract and parse JSON from a ```json code fence.
 * @param {string} rawText - Raw response text from Copilot.
 * @returns {object|null} Parsed JSON object, or null if extraction/parsing fails.
 */
export function extractJsonFromFence(rawText) {
	if (!rawText || typeof rawText !== "string") return null;

	const fencePattern = /```json\s*\n?([\s\S]*?)```/;
	const match = rawText.match(fencePattern);
	if (!match) return null;

	let content = match[1].trim();

	// Fix common LLM error: trailing commas before ] or }
	content = content.replace(/,\s*([\]}])/g, "$1");

	try {
		return JSON.parse(content);
	} catch {
		return null;
	}
}

/**
 * Validate a parsed review object against the expected schema.
 * Hand-rolled validation — no external dependencies.
 * @param {object} parsed - Parsed JSON object.
 * @returns {ValidationResult}
 */
export function validateReview(parsed) {
	/** @type {string[]} */
	const errors = [];

	if (parsed == null || typeof parsed !== "object" || Array.isArray(parsed)) {
		return { valid: false, errors: ["Root must be a non-null object."] };
	}

	// summary
	if (typeof parsed.summary !== "string" || parsed.summary.length === 0) {
		errors.push("summary must be a non-empty string.");
	}

	// verdict
	if (!VALID_VERDICTS.includes(parsed.verdict)) {
		errors.push(
			`verdict must be one of: ${VALID_VERDICTS.join(", ")}. Got: ${String(parsed.verdict)}`,
		);
	}

	// findings
	if (!Array.isArray(parsed.findings)) {
		errors.push("findings must be an array.");
	} else {
		if (parsed.findings.length === 0 && parsed.verdict !== "approve") {
			// Allow empty findings only for approve
		}
		for (let i = 0; i < parsed.findings.length; i++) {
			const f = parsed.findings[i];
			const prefix = `findings[${i}]`;

			if (f == null || typeof f !== "object" || Array.isArray(f)) {
				errors.push(`${prefix} must be an object.`);
				continue;
			}

			if (typeof f.file !== "string" || f.file.length === 0) {
				errors.push(`${prefix}.file must be a non-empty string.`);
			}

			if (!VALID_SEVERITIES.includes(f.severity)) {
				errors.push(
					`${prefix}.severity must be one of: ${VALID_SEVERITIES.join(", ")}. Got: ${String(f.severity)}`,
				);
			}

			if (typeof f.message !== "string" || f.message.length === 0) {
				errors.push(`${prefix}.message must be a non-empty string.`);
			}

			if (f.line !== undefined) {
				if (!Number.isInteger(f.line) || f.line < 1) {
					errors.push(`${prefix}.line must be a positive integer if present.`);
				}
			}

			if (f.suggestion !== undefined) {
				if (typeof f.suggestion !== "string") {
					errors.push(`${prefix}.suggestion must be a string if present.`);
				}
			}
		}
	}

	return { valid: errors.length === 0, errors };
}

/**
 * Build a synthetic ReviewResult from raw prose when JSON parsing fails.
 * @param {string} rawText - The raw response text.
 * @returns {ReviewResult}
 */
export function buildProseFallback(rawText) {
	return {
		summary: "Copilot returned a prose review (structured JSON parsing failed).",
		verdict: "comment",
		findings: [
			{
				file: "(prose review)",
				severity: "suggestion",
				message:
					typeof rawText === "string"
						? rawText.slice(0, MAX_PROSE_LENGTH)
						: String(rawText).slice(0, MAX_PROSE_LENGTH),
			},
		],
	};
}

/**
 * Attempt to parse a Copilot response through Layer 1 (fence extraction + validation).
 * @param {string} rawText
 * @returns {ReviewResult|null} A valid ReviewResult, or null.
 */
function tryParseResponse(rawText) {
	const parsed = extractJsonFromFence(rawText);
	if (!parsed) return null;

	const { valid } = validateReview(parsed);
	if (!valid) return null;

	return /** @type {ReviewResult} */ (parsed);
}

/**
 * Run a code review via Copilot.
 *
 * @param {object} params
 * @param {object} params.client - CopilotReviewClient instance.
 * @param {object} params.sessionManager - SessionManager instance.
 * @param {string} params.diff - The diff text to review.
 * @param {'standard'|'adversarial'} [params.mode='standard'] - Review mode.
 * @param {object} [params.options] - Additional options (reserved for future use).
 * @returns {Promise<ReviewResult>}
 */
export async function runReview({ client, sessionManager, diff, mode = "standard", options = {} }) {
	// 1. Load system prompt
	const systemPrompt = await loadSystemPrompt(mode);

	// 2. Create job record (SessionManager creates the Copilot session internally)
	const jobType = mode === "adversarial" ? "adversarial-review" : "review";
	const job = await sessionManager.createReviewSession({
		systemMessage: systemPrompt,
		claudeSessionId: options.claudeSessionId,
	});

	// 3. Update job status to running
	await sessionManager.updateSession(job.jobId, { status: "running" });

	try {
		// 4. Build user prompt with inline diff
		// Note: Blob attachments are not supported by the Copilot CLI runtime.
		// The diff is inlined in the prompt text inside a code fence.
		const userPrompt = "Review the following diff:\n\n```diff\n" + diff + "\n```";

		// 5. Send to Copilot (Layer 1 attempt)
		const rawResponse = await client.send(job.sessionId, userPrompt);

		// Layer 1: Extract JSON from fence
		let result = tryParseResponse(rawResponse);

		// Layer 2: Retry with stricter prompt (max 1 retry)
		if (!result) {
			const retryResponse = await client.send(job.sessionId, RETRY_PROMPT);
			result = tryParseResponse(retryResponse);
		}

		// Layer 3: Prose fallback
		if (!result) {
			result = buildProseFallback(rawResponse);
		}

		// 6. Update job with result
		await sessionManager.updateSession(job.jobId, { status: "completed", result });
		return result;
	} catch (err) {
		await sessionManager.updateSession(job.jobId, { status: "failed", error: err.message });
		throw err;
	}
}
