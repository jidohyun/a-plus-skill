import { spawnSync } from 'node:child_process';
import { resolve } from 'node:path';
import { dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const THIS_DIR = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(THIS_DIR, '..');
const SCRIPT_PATH = resolve(REPO_ROOT, 'scripts', 'maintenance-status.mjs');

describe('maintenance-status script', () => {
  it('runs bundled maintenance checks and prints summary + section headers', () => {
    const result = spawnSync('node', [SCRIPT_PATH], {
      cwd: REPO_ROOT,
      env: { ...process.env },
      encoding: 'utf8'
    });

    expect([0, 2]).toContain(result.status ?? 1);
    expect(result.stdout).toContain('maintenance_status overall=');
    expect(result.stdout).toContain('severity=');
    expect(result.stdout).toContain('issue_count=');
    expect(result.stdout).toContain('ops_gate_code=');
    expect(result.stdout).toContain('collector_mode=');
    expect(result.stdout).toContain('fast_cap_reason=');
    expect(result.stdout).toContain('delivery_failures=');
    expect(result.stdout).toContain('primary_issue=');
    expect(result.stdout).toContain('recommended_action=');
    expect(result.stdout).toContain('[ops_status_gate]');
    expect(result.stdout).toContain('[collector_status]');
    expect(result.stdout).toContain('[fast_cap_inspect]');
    expect(result.stdout).toContain('[delivery_failures]');
  });

  it('supports json output for automation', () => {
    const result = spawnSync('node', [SCRIPT_PATH, '--json'], {
      cwd: REPO_ROOT,
      env: { ...process.env },
      encoding: 'utf8'
    });

    expect([0, 2]).toContain(result.status ?? 1);
    const parsed = JSON.parse(result.stdout);
    expect(parsed.summary).toBeTruthy();
    expect(parsed.summary.overall).toBeTruthy();
    expect(parsed.summary.severity).toBeTruthy();
    expect(typeof parsed.summary.issue_count).toBe('number');
    expect(Array.isArray(parsed.checks)).toBe(true);
    expect(parsed.checks.some((check: { label: string }) => check.label === 'ops_status_gate')).toBe(true);
  });
});
