import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';

const THIS_DIR = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(THIS_DIR, '..');
const SCRIPT_PATH = resolve(REPO_ROOT, 'scripts', 'ops-status.mjs');
const TSX_LOADER = resolve(REPO_ROOT, 'node_modules', 'tsx', 'dist', 'loader.mjs');

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

function runStatus(args: string[] = [], env: NodeJS.ProcessEnv = {}, cwd?: string) {
  return spawnSync('node', ['--import', TSX_LOADER, SCRIPT_PATH, ...args], {
    cwd: cwd ?? REPO_ROOT,
    env: { ...process.env, ...env },
    encoding: 'utf8'
  });
}

function fastCapChecksum(key: string, schemaVersion: number, count: number, updatedAt: string): string {
  return createHash('sha256').update(`${schemaVersion}:${count}:${updatedAt}:${key}`, 'utf8').digest('hex');
}

function writeTamperedFastCapState(dir: string): void {
  const dataDir = join(dir, 'data');
  mkdirSync(dataDir, { recursive: true });
  const keyPath = join(dataDir, 'fast-audit-fail-cap.key');
  const statePath = join(dataDir, 'fast-audit-fail-cap.json');
  const key = 'k'.repeat(64);
  const updatedAt = new Date().toISOString();
  writeFileSync(keyPath, `${key}\n`, 'utf8');
  writeFileSync(
    statePath,
    `${JSON.stringify(
      {
        schemaVersion: 1,
        count: 1,
        updatedAt,
        checksum: `${fastCapChecksum(key, 1, 1, updatedAt)}-tampered`
      },
      null,
      2
    )}\n`,
    'utf8'
  );
}

describe('ops-status script', () => {
  it('clean healthy', () => {
    const dir = mkdtempSync(join(tmpdir(), 'ops-status-healthy-'));
    try {
      const result = runStatus([], { INSTALL_POLICY: 'balanced' }, dir);
      expect(result.status).toBe(0);
      const out = parseLine(result.stdout);
      expect(out.policy).toBe('balanced');
      expect(out.audit_ok).toBe('true');
      expect(out.strict_failures).toBe('0');
      expect(out.strict_state_fault).toBe('false');
      expect(out.fast_cap_tampered).toBe('false');
      expect(out.critical_flags_present).toBe('false');
      expect(out.critical_flags).toBe('');
      expect(out.overall).toBe('healthy');
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('strict + audit fail => unhealthy', () => {
    const dir = mkdtempSync(join(tmpdir(), 'ops-status-strict-audit-'));
    try {
      const auditPath = join(dir, 'bad-audit.jsonl');
      writeFileSync(auditPath, '{broken', 'utf8');

      const result = runStatus([], { INSTALL_POLICY: 'strict', INSTALL_AUDIT_LOG_PATH: auditPath }, dir);
      expect(result.status).toBe(0);
      const out = parseLine(result.stdout);
      expect(out.audit_ok).toBe('false');
      expect(out.overall).toBe('unhealthy');
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('balanced + audit fail => degraded', () => {
    const dir = mkdtempSync(join(tmpdir(), 'ops-status-balanced-audit-'));
    try {
      const auditPath = join(dir, 'bad-audit.jsonl');
      writeFileSync(auditPath, '{broken', 'utf8');

      const result = runStatus([], { INSTALL_POLICY: 'balanced', INSTALL_AUDIT_LOG_PATH: auditPath }, dir);
      expect(result.status).toBe(0);
      const out = parseLine(result.stdout);
      expect(out.audit_ok).toBe('false');
      expect(out.strict_failures).toBe('0');
      expect(out.overall).toBe('degraded');
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('fast cap tampered => unhealthy', () => {
    const dir = mkdtempSync(join(tmpdir(), 'ops-status-fast-tamper-'));
    try {
      writeTamperedFastCapState(dir);

      const result = runStatus([], { INSTALL_POLICY: 'fast' }, dir);
      expect(result.status).toBe(0);
      const out = parseLine(result.stdout);
      expect(out.fast_cap_tampered).toBe('true');
      expect(out.critical_flags_present).toBe('true');
      expect(out.critical_flags).toBe('fast_cap_tampered');
      expect(out.overall).toBe('unhealthy');
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('strict state parse fault => unhealthy', () => {
    const dir = mkdtempSync(join(tmpdir(), 'ops-status-strict-state-'));
    try {
      const statePath = join(dir, 'data', 'strict-evidence-fail-state.json');
      mkdirSync(join(dir, 'data'), { recursive: true });
      writeFileSync(statePath, '{broken', 'utf8');

      const result = runStatus([], { INSTALL_POLICY: 'strict' }, dir);
      expect(result.status).toBe(0);
      const out = parseLine(result.stdout);
      expect(out.strict_state_fault).toBe('true');
      expect(out.overall).toBe('unhealthy');
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('strict policy reflects fast cap tampered as unhealthy', () => {
    const dir = mkdtempSync(join(tmpdir(), 'ops-status-strict-fast-tamper-'));
    try {
      writeTamperedFastCapState(dir);

      const result = runStatus([], { INSTALL_POLICY: 'strict' }, dir);
      expect(result.status).toBe(0);
      const out = parseLine(result.stdout);
      expect(out.fast_cap_tampered).toBe('true');
      expect(out.overall).toBe('unhealthy');
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('balanced policy reflects fast cap tampered as degraded', () => {
    const dir = mkdtempSync(join(tmpdir(), 'ops-status-balanced-fast-tamper-'));
    try {
      writeTamperedFastCapState(dir);

      const result = runStatus([], { INSTALL_POLICY: 'balanced' }, dir);
      expect(result.status).toBe(0);
      const out = parseLine(result.stdout);
      expect(out.fast_cap_tampered).toBe('true');
      expect(out.overall).toBe('degraded');
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('emits combined critical flags', () => {
    const dir = mkdtempSync(join(tmpdir(), 'ops-status-critical-flags-'));
    try {
      const statePath = join(dir, 'data', 'strict-evidence-fail-state.json');
      const auditPath = join(dir, 'bad-audit.jsonl');
      mkdirSync(join(dir, 'data'), { recursive: true });
      writeFileSync(statePath, '{broken', 'utf8');
      writeFileSync(auditPath, '{broken', 'utf8');

      const result = runStatus([], { INSTALL_POLICY: 'balanced', INSTALL_AUDIT_LOG_PATH: auditPath }, dir);
      expect(result.status).toBe(0);
      const out = parseLine(result.stdout);
      expect(out.critical_flags_present).toBe('true');
      expect(out.critical_flags).toBe('strict_state_fault,audit_failed');
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('--strict returns exit 2 when unhealthy', () => {
    const dir = mkdtempSync(join(tmpdir(), 'ops-status-strict-exit-'));
    try {
      const auditPath = join(dir, 'bad-audit.jsonl');
      writeFileSync(auditPath, '{broken', 'utf8');

      const result = runStatus(['--strict'], { INSTALL_POLICY: 'strict', INSTALL_AUDIT_LOG_PATH: auditPath }, dir);
      expect(result.status).toBe(2);
      const out = parseLine(result.stdout);
      expect(out.overall).toBe('unhealthy');
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('--strict returns exit 2 when degraded', () => {
    const dir = mkdtempSync(join(tmpdir(), 'ops-status-strict-degraded-exit-'));
    try {
      const statePath = join(dir, 'data', 'strict-evidence-fail-state.json');
      mkdirSync(join(dir, 'data'), { recursive: true });
      writeFileSync(statePath, `${JSON.stringify({ consecutiveFailures: 1 })}\n`, 'utf8');

      const result = runStatus(['--strict'], { INSTALL_POLICY: 'strict' }, dir);
      expect(result.status).toBe(2);
      const out = parseLine(result.stdout);
      expect(out.overall).toBe('degraded');
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('--strict=unhealthy keeps degraded as exit 0', () => {
    const dir = mkdtempSync(join(tmpdir(), 'ops-status-strict-unhealthy-mode-'));
    try {
      const statePath = join(dir, 'data', 'strict-evidence-fail-state.json');
      mkdirSync(join(dir, 'data'), { recursive: true });
      writeFileSync(statePath, `${JSON.stringify({ consecutiveFailures: 1 })}\n`, 'utf8');

      const result = runStatus(['--strict=unhealthy'], { INSTALL_POLICY: 'strict' }, dir);
      expect(result.status).toBe(0);
      const out = parseLine(result.stdout);
      expect(out.overall).toBe('degraded');
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
