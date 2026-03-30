import { spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, resolve, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const THIS_DIR = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(THIS_DIR, '..');
const SCRIPT_PATH = resolve(REPO_ROOT, 'scripts', 'collector-status.mjs');
const TSX_LOADER = resolve(REPO_ROOT, 'node_modules', 'tsx', 'dist', 'loader.mjs');

function runCollectorStatus(env: NodeJS.ProcessEnv = {}, args: string[] = [], cwd?: string) {
  return spawnSync('node', ['--import', TSX_LOADER, SCRIPT_PATH, ...args], {
    cwd: cwd ?? REPO_ROOT,
    env: { ...process.env, ...env },
    encoding: 'utf8'
  });
}

function parseLine(stdout: string): Record<string, string> {
  const out = stdout.trim();
  const entries: Record<string, string> = {};
  const re = /(\w+)=((?:"(?:\\.|[^"])*")|[^\s]+)/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(out)) !== null) {
    const key = m[1]!;
    const raw = m[2]!;
    entries[key] = raw.startsWith('"') ? JSON.parse(raw) : raw;
  }
  return entries;
}

describe('collector-status script', () => {
  it('emits richer fallback diagnostics', () => {
    const dir = mkdtempSync(join(tmpdir(), 'collector-status-live-'));
    try {
      const result = runCollectorStatus({ MIN_PARSED_SKILLS: '3', CLAWHUB_FETCH_TIMEOUT_MS: '2500' }, [], dir);
      expect(result.status).toBe(0);
      const out = parseLine(result.stdout);
      expect(out.mode).toBe('fallback');
      expect(out.degraded).toBe('true');
      expect(out.reason).toBe('PARSE_BELOW_THRESHOLD_0');
      expect(out.threshold).toBe('3');
      expect(out.skillCount).toBe('2');
      expect(out.fetchTimeoutMs).toBe('2500');
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('returns exit 2 in strict mode when collector is fallback', () => {
    const dir = mkdtempSync(join(tmpdir(), 'collector-status-strict-'));
    try {
      const result = runCollectorStatus({ CLAWHUB_FETCH_TIMEOUT_MS: '1000' }, ['--strict'], dir);
      expect(result.status).toBe(2);
      const out = parseLine(result.stdout);
      expect(out.mode).toBe('fallback');
      expect(out.degraded).toBe('true');
      expect(out.reason).not.toBe('NONE');
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
