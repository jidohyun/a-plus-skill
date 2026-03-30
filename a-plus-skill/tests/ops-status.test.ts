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

function writeDeliveryLog(dir: string, lines: string[]): void {
  const path = join(dir, 'data', 'report-delivery.log');
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, `${lines.join('\n')}\n`, 'utf8');
}

function writeDeliveryLogRotated(dir: string, suffix: string, lines: string[]): void {
  const path = join(dir, 'data', `report-delivery.log.${suffix}`);
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, `${lines.join('\n')}\n`, 'utf8');
}

function isoSecondsAgo(secondsAgo: number): string {
  return new Date(Date.now() - secondsAgo * 1000).toISOString();
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
      expect(out.fast_cap_reason).toBe('none');
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
      expect(out.fast_cap_reason).toBe('checksum_mismatch');
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
      expect(out.fast_cap_reason).toBe('checksum_mismatch');
      expect(out.overall).toBe('degraded');
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('reports suspicious reset when fast-cap key exists without state', () => {
    const dir = mkdtempSync(join(tmpdir(), 'ops-status-fast-key-only-'));
    try {
      const dataDir = join(dir, 'data');
      mkdirSync(dataDir, { recursive: true });
      writeFileSync(join(dataDir, 'fast-audit-fail-cap.key'), `${'k'.repeat(64)}\n`, 'utf8');

      const result = runStatus([], { INSTALL_POLICY: 'balanced' }, dir);
      expect(result.status).toBe(0);
      const out = parseLine(result.stdout);
      expect(out.fast_cap_tampered).toBe('true');
      expect(out.fast_cap_reason).toBe('suspicious fast-cap reset: key exists while state missing');
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

  it('delivery success signal yields healthy', () => {
    const dir = mkdtempSync(join(tmpdir(), 'ops-status-delivery-success-'));
    try {
      writeDeliveryLog(dir, [
        `${isoSecondsAgo(90)} event=delivery_success mode=discord-dm chunk=1/1 attempt=1/3`,
        `${isoSecondsAgo(120)} event=delivery_failed mode=discord-dm chunk=1/1 attempt=1/3 code=NETWORK_ERROR`
      ]);

      const result = runStatus([], { INSTALL_POLICY: 'balanced', REPORT_DELIVERY: 'discord-dm' }, dir);
      expect(result.status).toBe(0);
      const out = parseLine(result.stdout);
      expect(out.delivery_health).toBe('healthy');
      expect(out.delivery_successes).toBe('1');
      expect(out.delivery_failures).toBe('1');
      expect(Number(out.delivery_last_success_age_sec)).toBeGreaterThanOrEqual(0);
      expect(out.overall).toBe('healthy');
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('ignores gzip rotated delivery logs when assessing health', () => {
    const dir = mkdtempSync(join(tmpdir(), 'ops-status-delivery-gzip-'));
    try {
      writeDeliveryLog(dir, [
        `${isoSecondsAgo(30)} event=delivery_success mode=discord-dm chunk=1/1 attempt=1/3`
      ]);
      writeDeliveryLogRotated(dir, '2.gz', ['this is not plain text log content']);

      const result = runStatus([], { INSTALL_POLICY: 'balanced', REPORT_DELIVERY: 'discord-dm' }, dir);
      expect(result.status).toBe(0);
      const out = parseLine(result.stdout);
      expect(out.delivery_health).toBe('healthy');
      expect(out.delivery_successes).toBe('1');
      expect(out.overall).toBe('healthy');
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('delivery failures without success => strict unhealthy', () => {
    const dir = mkdtempSync(join(tmpdir(), 'ops-status-delivery-strict-fail-only-'));
    try {
      writeDeliveryLog(dir, [
        `${isoSecondsAgo(60)} event=delivery_failed mode=discord-dm chunk=1/1 attempt=1/3 code=NETWORK_ERROR`
      ]);

      const result = runStatus([], { INSTALL_POLICY: 'strict', REPORT_DELIVERY: 'discord-dm' }, dir);
      expect(result.status).toBe(0);
      const out = parseLine(result.stdout);
      expect(out.delivery_health).toBe('unhealthy');
      expect(out.delivery_successes).toBe('0');
      expect(out.overall).toBe('unhealthy');
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('delivery failures without success => balanced/fast degraded', () => {
    const dir = mkdtempSync(join(tmpdir(), 'ops-status-delivery-non-strict-fail-only-'));
    try {
      writeDeliveryLog(dir, [
        `${isoSecondsAgo(60)} event=delivery_failed mode=telegram chunk=1/1 attempt=1/3 code=NETWORK_ERROR`
      ]);

      const balanced = runStatus([], { INSTALL_POLICY: 'balanced', REPORT_DELIVERY: 'telegram' }, dir);
      expect(balanced.status).toBe(0);
      const balancedOut = parseLine(balanced.stdout);
      expect(balancedOut.delivery_health).toBe('unhealthy');
      expect(balancedOut.overall).toBe('degraded');

      const fast = runStatus([], { INSTALL_POLICY: 'fast', REPORT_DELIVERY: 'telegram' }, dir);
      expect(fast.status).toBe(0);
      const fastOut = parseLine(fast.stdout);
      expect(fastOut.delivery_health).toBe('unhealthy');
      expect(fastOut.overall).toBe('degraded');
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('stale delivery success degrades strict to unhealthy and others to degraded', () => {
    const dir = mkdtempSync(join(tmpdir(), 'ops-status-delivery-stale-'));
    try {
      writeDeliveryLog(dir, [
        `${isoSecondsAgo(7200)} event=delivery_success mode=discord-dm chunk=1/1 attempt=1/3`
      ]);

      const strict = runStatus(
        [],
        { INSTALL_POLICY: 'strict', REPORT_DELIVERY: 'discord-dm', OPS_DELIVERY_SUCCESS_STALE_SEC: '300' },
        dir
      );
      const strictOut = parseLine(strict.stdout);
      expect(strictOut.delivery_health).toBe('unhealthy');
      expect(strictOut.overall).toBe('unhealthy');

      const balanced = runStatus(
        [],
        { INSTALL_POLICY: 'balanced', REPORT_DELIVERY: 'discord-dm', OPS_DELIVERY_SUCCESS_STALE_SEC: '300' },
        dir
      );
      const balancedOut = parseLine(balanced.stdout);
      expect(balancedOut.delivery_health).toBe('unhealthy');
      expect(balancedOut.overall).toBe('degraded');

      const fast = runStatus(
        [],
        { INSTALL_POLICY: 'fast', REPORT_DELIVERY: 'discord-dm', OPS_DELIVERY_SUCCESS_STALE_SEC: '300' },
        dir
      );
      const fastOut = parseLine(fast.stdout);
      expect(fastOut.delivery_health).toBe('unhealthy');
      expect(fastOut.overall).toBe('degraded');
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('REPORT_DELIVERY=none => delivery disabled and no overall impact', () => {
    const dir = mkdtempSync(join(tmpdir(), 'ops-status-delivery-disabled-'));
    try {
      writeDeliveryLog(dir, ['broken line']);

      const result = runStatus([], { INSTALL_POLICY: 'balanced', REPORT_DELIVERY: 'none' }, dir);
      expect(result.status).toBe(0);
      const out = parseLine(result.stdout);
      expect(out.delivery_health).toBe('disabled');
      expect(out.delivery_successes).toBe('0');
      expect(out.delivery_failures).toBe('0');
      expect(out.delivery_last_success_age_sec).toBe('-1');
      expect(out.overall).toBe('healthy');
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('delivery log parse fault is conservative (minimum degraded)', () => {
    const dir = mkdtempSync(join(tmpdir(), 'ops-status-delivery-parse-fault-'));
    try {
      writeDeliveryLog(dir, ['not-a-valid-log-line']);
      writeDeliveryLogRotated(dir, '1', [`${isoSecondsAgo(30)} event=delivery_success mode=discord-dm chunk=1/1 attempt=1/3`]);

      const result = runStatus([], { INSTALL_POLICY: 'balanced', REPORT_DELIVERY: 'discord-dm' }, dir);
      expect(result.status).toBe(0);
      const out = parseLine(result.stdout);
      expect(out.delivery_health).toBe('degraded');
      expect(out.overall).toBe('degraded');
      expect(out.delivery_successes).toBe('1');
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('delivery log missing is conservative by policy', () => {
    const dir = mkdtempSync(join(tmpdir(), 'ops-status-delivery-missing-'));
    try {
      const strict = runStatus([], { INSTALL_POLICY: 'strict', REPORT_DELIVERY: 'telegram' }, dir);
      const strictOut = parseLine(strict.stdout);
      expect(strictOut.delivery_health).toBe('unhealthy');
      expect(strictOut.overall).toBe('unhealthy');

      const balanced = runStatus([], { INSTALL_POLICY: 'balanced', REPORT_DELIVERY: 'telegram' }, dir);
      const balancedOut = parseLine(balanced.stdout);
      expect(balancedOut.delivery_health).toBe('unhealthy');
      expect(balancedOut.overall).toBe('degraded');
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

  it('--strict keeps degraded as exit 0', () => {
    const dir = mkdtempSync(join(tmpdir(), 'ops-status-strict-degraded-exit-'));
    try {
      const statePath = join(dir, 'data', 'strict-evidence-fail-state.json');
      mkdirSync(join(dir, 'data'), { recursive: true });
      writeFileSync(statePath, `${JSON.stringify({ consecutiveFailures: 1 })}\n`, 'utf8');

      const result = runStatus(['--strict'], { INSTALL_POLICY: 'strict' }, dir);
      expect(result.status).toBe(0);
      const out = parseLine(result.stdout);
      expect(out.overall).toBe('degraded');
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('--strict=nonhealthy returns exit 2 when degraded', () => {
    const dir = mkdtempSync(join(tmpdir(), 'ops-status-strict-nonhealthy-mode-'));
    try {
      const statePath = join(dir, 'data', 'strict-evidence-fail-state.json');
      mkdirSync(join(dir, 'data'), { recursive: true });
      writeFileSync(statePath, `${JSON.stringify({ consecutiveFailures: 1 })}\n`, 'utf8');

      const result = runStatus(['--strict=nonhealthy'], { INSTALL_POLICY: 'strict' }, dir);
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

  it('unknown --strict mode fails immediately with exit 2', () => {
    const dir = mkdtempSync(join(tmpdir(), 'ops-status-strict-unknown-mode-'));
    try {
      const result = runStatus(['--strict=weird-mode'], { INSTALL_POLICY: 'strict' }, dir);
      expect(result.status).toBe(2);
      expect(result.stderr).toContain('ERROR invalid --strict mode');
      expect(result.stderr).toContain('expected one of: "unhealthy", "nonhealthy"');
      expect(result.stdout.trim()).toBe('');
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
