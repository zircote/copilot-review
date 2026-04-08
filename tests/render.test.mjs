/**
 * tests/render.test.mjs — Tests for render.mjs output formatting.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  renderReview,
  renderJobList,
  renderJobResult,
  renderError,
} from '../scripts/lib/render.mjs';

// ---------------------------------------------------------------------------
// renderReview
// ---------------------------------------------------------------------------

describe('renderReview', () => {
  it('renders approve with no findings', () => {
    const output = renderReview({
      summary: 'All good.',
      verdict: 'approve',
      findings: [],
    });
    assert.ok(output.includes('No issues found'));
    assert.ok(output.includes('approve'));
  });

  it('renders findings with severity labels and file:line', () => {
    const output = renderReview({
      summary: 'Issues found.',
      verdict: 'request_changes',
      findings: [
        { file: 'src/a.js', line: 10, severity: 'critical', message: 'Bug here.' },
        { file: 'src/b.js', severity: 'suggestion', message: 'Style issue.' },
      ],
    });
    assert.ok(output.includes('**CRITICAL**'));
    assert.ok(output.includes('`src/a.js:10`'));
    assert.ok(output.includes('**SUGGESTION**'));
    assert.ok(output.includes('`src/b.js`'));
    assert.ok(output.includes('Bug here.'));
    assert.ok(output.includes('Style issue.'));
  });

  it('groups findings by severity (critical first)', () => {
    const output = renderReview({
      summary: 'Mixed.',
      verdict: 'request_changes',
      findings: [
        { file: 'a.js', severity: 'nitpick', message: 'Nit.' },
        { file: 'b.js', severity: 'critical', message: 'Bug.' },
        { file: 'c.js', severity: 'warning', message: 'Perf.' },
      ],
    });
    const critIdx = output.indexOf('CRITICAL');
    const warnIdx = output.indexOf('WARNING');
    const nitIdx = output.indexOf('NITPICK');
    assert.ok(critIdx < warnIdx, 'CRITICAL should appear before WARNING');
    assert.ok(warnIdx < nitIdx, 'WARNING should appear before NITPICK');
  });

  it('shows prose fallback warning when proseFallback=true', () => {
    const output = renderReview(
      { summary: 'Prose.', verdict: 'comment', findings: [] },
      { proseFallback: true },
    );
    assert.ok(output.includes('Structured JSON parsing failed'));
  });

  it('shows verdict line', () => {
    const output = renderReview({
      summary: 'Ok.',
      verdict: 'comment',
      findings: [],
    });
    assert.ok(output.includes('Verdict: **comment**'));
  });

  it('renders suggestion field when present', () => {
    const output = renderReview({
      summary: 'Issues.',
      verdict: 'comment',
      findings: [
        { file: 'x.js', severity: 'suggestion', message: 'Use const.', suggestion: 'const x = 1;' },
      ],
    });
    assert.ok(output.includes('Suggestion: const x = 1;'));
  });
});

// ---------------------------------------------------------------------------
// renderJobList
// ---------------------------------------------------------------------------

describe('renderJobList', () => {
  it('returns message when no jobs', () => {
    assert.equal(renderJobList([]), 'No Copilot jobs found.');
  });

  it('returns message for null input', () => {
    assert.equal(renderJobList(null), 'No Copilot jobs found.');
  });

  it('renders a table for a single job', () => {
    const now = new Date().toISOString();
    const output = renderJobList([
      {
        jobId: 'job-1234567890123456-abcd',
        sessionId: 'sess-1',
        type: 'review',
        status: 'completed',
        createdAt: now,
        updatedAt: now,
      },
    ]);
    assert.ok(output.includes('## Copilot Jobs'));
    assert.ok(output.includes('| ID |'));
    assert.ok(output.includes('job-123456789012'));
    assert.ok(output.includes('1 job total'));
  });

  it('renders correct count for multiple jobs', () => {
    const now = new Date().toISOString();
    const jobs = [
      { jobId: 'job-aaa', sessionId: 's1', type: 'review', status: 'completed', createdAt: now, updatedAt: now },
      { jobId: 'job-bbb', sessionId: 's2', type: 'task', status: 'running', createdAt: now, updatedAt: now },
    ];
    const output = renderJobList(jobs);
    assert.ok(output.includes('2 jobs total'));
  });
});

// ---------------------------------------------------------------------------
// renderJobResult
// ---------------------------------------------------------------------------

describe('renderJobResult', () => {
  it('renders review job with result', () => {
    const output = renderJobResult({
      jobId: 'job-123',
      sessionId: 'sess-1',
      type: 'review',
      status: 'completed',
      createdAt: '2026-04-01T00:00:00Z',
      updatedAt: '2026-04-01T00:00:15Z',
      result: {
        summary: 'All good.',
        verdict: 'approve',
        findings: [],
      },
    });
    assert.ok(output.includes('## Job: job-123'));
    assert.ok(output.includes('**Type:** review'));
    assert.ok(output.includes('**Status:** completed'));
    assert.ok(output.includes('### Result'));
    assert.ok(output.includes('No issues found'));
  });

  it('renders task job with string result', () => {
    const output = renderJobResult({
      jobId: 'job-456',
      sessionId: 'sess-2',
      type: 'task',
      status: 'completed',
      createdAt: '2026-04-01T00:00:00Z',
      updatedAt: '2026-04-01T00:00:10Z',
      result: 'Task completed successfully.',
    });
    assert.ok(output.includes('Task completed successfully.'));
  });

  it('renders job with error', () => {
    const output = renderJobResult({
      jobId: 'job-789',
      sessionId: 'sess-3',
      type: 'review',
      status: 'failed',
      createdAt: '2026-04-01T00:00:00Z',
      updatedAt: '2026-04-01T00:00:05Z',
      error: 'Connection timeout.',
    });
    assert.ok(output.includes('### Error'));
    assert.ok(output.includes('Connection timeout.'));
  });
});

// ---------------------------------------------------------------------------
// renderError
// ---------------------------------------------------------------------------

describe('renderError', () => {
  it('renders basic error with name and message', () => {
    const err = new Error('Something broke');
    const output = renderError(err);
    assert.ok(output.includes('## Error: Error'));
    assert.ok(output.includes('Something broke'));
  });

  it('shows auto-remediation for AuthError', () => {
    const err = new Error('Invalid token');
    err.name = 'AuthError';
    const output = renderError(err);
    assert.ok(output.includes('copilot-review setup'));
  });

  it('shows auto-remediation for CircuitBreakerError', () => {
    const err = new Error('Service unavailable');
    err.name = 'CircuitBreakerError';
    const output = renderError(err);
    assert.ok(output.includes('experiencing issues'));
  });

  it('shows custom remediation when provided', () => {
    const err = new Error('Oops');
    const output = renderError(err, { remediation: 'Try restarting.' });
    assert.ok(output.includes('Try restarting.'));
  });
});
