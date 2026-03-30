import { spawnSync } from 'node:child_process';
import { resolve } from 'node:path';
import { dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const THIS_DIR = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(THIS_DIR, '..');
const SCRIPT_PATH = resolve(REPO_ROOT, 'scripts', 'scoring-calibration.mjs');
const TSX_LOADER = resolve(REPO_ROOT, 'node_modules', 'tsx', 'dist', 'loader.mjs');

describe('scoring calibration script', () => {
  it('prints score distributions and decision counts', () => {
    const result = spawnSync('node', ['--import', TSX_LOADER, SCRIPT_PATH], {
      cwd: REPO_ROOT,
      env: { ...process.env },
      encoding: 'utf8'
    });

    expect(result.status).toBe(0);
    expect(result.stdout).toContain('scoring_calibration');
    expect(result.stdout).toContain('fit min=');
    expect(result.stdout).toContain('trend min=');
    expect(result.stdout).toContain('stability min=');
    expect(result.stdout).toContain('security min=');
    expect(result.stdout).toContain('final min=');
    expect(result.stdout).toContain('decision_counts');
    expect(result.stdout).toContain('- recommend:');
    expect(result.stdout).toContain('- caution:');
    expect(result.stdout).toContain('- hold:');
    expect(result.stdout).toContain('- block:');
  });
});
