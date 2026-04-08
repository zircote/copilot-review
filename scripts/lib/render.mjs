/**
 * render.mjs — Terminal output formatting.
 *
 * Provides: renderReview(), renderJobList(), renderJobResult(), renderError().
 * All output is markdown-flavored text for Claude Code consumption.
 */

import { enrichJob } from './job-control.mjs';

/** Severity display order and labels. */
const SEVERITY_ORDER = ['critical', 'warning', 'suggestion', 'nitpick'];
const SEVERITY_LABELS = {
  critical: 'CRITICAL',
  warning: 'WARNING',
  suggestion: 'SUGGESTION',
  nitpick: 'NITPICK',
};

/**
 * Format a ReviewResult for display as markdown.
 * @param {import('./review.mjs').ReviewResult} result
 * @param {{ proseFallback?: boolean }} [options]
 * @returns {string}
 */
export function renderReview(result, { proseFallback = false } = {}) {
  const lines = [];

  lines.push(`## Code Review: ${result.verdict}`);
  lines.push('');

  if (proseFallback) {
    lines.push('**Note:** Copilot returned a prose review. Structured JSON parsing failed.');
    lines.push('');
  }

  lines.push(result.summary);
  lines.push('');
  lines.push(`Verdict: **${result.verdict}**`);
  lines.push('');

  if (!result.findings || result.findings.length === 0) {
    lines.push('No issues found.');
    return lines.join('\n');
  }

  lines.push(`### Findings (${result.findings.length})`);
  lines.push('');

  // Group by severity in order
  for (const severity of SEVERITY_ORDER) {
    const group = result.findings.filter(f => f.severity === severity);
    if (group.length === 0) continue;

    for (const f of group) {
      const label = SEVERITY_LABELS[f.severity] || f.severity;
      const location = f.line ? `\`${f.file}:${f.line}\`` : `\`${f.file}\``;
      lines.push(`**${label}** ${location} — ${f.message}`);
      if (f.suggestion) {
        lines.push(`  Suggestion: ${f.suggestion}`);
      }
      lines.push('');
    }
  }

  return lines.join('\n');
}

/**
 * Format a list of jobs as a markdown table.
 * @param {import('./session-manager.mjs').JobRecord[]} jobs
 * @returns {string}
 */
export function renderJobList(jobs) {
  if (!jobs || jobs.length === 0) {
    return 'No Copilot jobs found.';
  }

  const lines = [];
  lines.push('## Copilot Jobs');
  lines.push('');
  lines.push('| ID | Type | Status | Created | Duration |');
  lines.push('|----|------|--------|---------|----------|');

  for (const job of jobs) {
    const enriched = enrichJob(job);
    const duration = enriched.duration || '—';
    lines.push(`| ${enriched.shortId} | ${job.type} | ${job.status} | ${enriched.age} | ${duration} |`);
  }

  lines.push('');
  lines.push(`${jobs.length} job${jobs.length === 1 ? '' : 's'} total`);

  return lines.join('\n');
}

/**
 * Format a full detail view of a single job.
 * @param {import('./session-manager.mjs').JobRecord} job
 * @returns {string}
 */
export function renderJobResult(job) {
  const lines = [];

  lines.push(`## Job: ${job.jobId}`);
  lines.push('');
  lines.push(`- **Type:** ${job.type}`);
  lines.push(`- **Status:** ${job.status}`);
  lines.push(`- **Created:** ${job.createdAt}`);
  lines.push(`- **Updated:** ${job.updatedAt}`);
  lines.push('');

  if (job.result) {
    lines.push('### Result');
    lines.push('');
    if (job.type === 'review' || job.type === 'adversarial-review') {
      lines.push(renderReview(job.result));
    } else {
      lines.push(typeof job.result === 'string' ? job.result : JSON.stringify(job.result, null, 2));
    }
    lines.push('');
  }

  if (job.error) {
    lines.push('### Error');
    lines.push('');
    lines.push(job.error);
    lines.push('');
  }

  return lines.join('\n');
}

/**
 * Format an error for user display with optional remediation.
 * @param {Error} error
 * @param {{ remediation?: string }} [options]
 * @returns {string}
 */
export function renderError(error, { remediation } = {}) {
  const name = error.name || 'Error';
  const lines = [];

  lines.push(`## Error: ${name}`);
  lines.push('');
  lines.push(error.message);
  lines.push('');

  // Auto-remediation for known error types
  const hint = remediation || getAutoRemediation(name);
  if (hint) {
    lines.push(hint);
    lines.push('');
  }

  return lines.join('\n');
}

/**
 * Return auto-remediation text for known error names.
 * @param {string} errorName
 * @returns {string|undefined}
 */
function getAutoRemediation(errorName) {
  switch (errorName) {
    case 'AuthError':
      return 'Run /copilot-review:setup to configure authentication.';
    case 'CircuitBreakerError':
      return 'Copilot is experiencing issues. Try /copilot-review:cancel <job-id> and retry.';
    default:
      return undefined;
  }
}
