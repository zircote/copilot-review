/**
 * prompts.mjs — Synchronous prompt template loading and interpolation.
 *
 * Used by the stop-review-gate hook (which must be fully synchronous).
 */

import { readFileSync } from "node:fs";
import { join } from "node:path";

/**
 * Load a prompt template from the prompts directory.
 * @param {string} rootDir - Plugin root directory.
 * @param {string} name - Template name (without .md extension).
 * @returns {string} Template content.
 */
export function loadPromptTemplate(rootDir, name) {
	return readFileSync(join(rootDir, "prompts", `${name}.md`), "utf8");
}

/**
 * Replace {{KEY}} placeholders in a template string.
 * Unmatched placeholders are replaced with empty strings.
 * @param {string} template
 * @param {Record<string, string>} variables
 * @returns {string}
 */
export function interpolateTemplate(template, variables) {
	return template.replace(/\{\{([A-Z_]+)\}\}/g, (_match, key) => variables[key] ?? "");
}
