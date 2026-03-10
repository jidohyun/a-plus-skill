import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { describe, expect, it, vi } from 'vitest';
import {
  INSTALL_AUDIT_GENESIS_PREV_HASH,
  INSTALL_AUDIT_SCHEMA_VERSION,
  computeInstallAuditHash,
  getInstallAuditAnchorPath,
  getInstallAuditBootstrapFusePath,
  getInstallAuditBootstrapLatchPath,
  getInstallAuditBootstrapMarkerPath,
  verifyInstallAuditFile,
  verifyInstallAuditLines
} from '../src/install/auditIntegrity.js';
import { applyAuditIntegrityGate, enforceAuditIntegrityPolicy } from '../src/index.js';
import { planInstallAction } from '../src/policy/policyEngine.js';
import type { InstallAuditEvent } from '../src/types/index.js';

function makeEvent(prevHash: string, patch: Partial<InstallAuditEvent> = {}): InstallAuditEvent {
  const base = {
    schemaVersion: INSTALL_AUDIT_SCHEMA_VERSION,
    eventId: patch.eventId ?? 'evt-1',
    ts: '2026-01-01T00:00:00.000Z',
    slug: 'demo/skill',
    policy: 'balanced',
    topology: 'single-instance',
    originalDecision: 'recommend',
    effectiveDecision: 'recommend',
    action: 'auto-install',
    canInstall: true,
    status: 'installed',
    degraded: false,
    notes: ['ok'],
    prevHash,
    ...patch
  } as Omit<InstallAuditEvent, 'hash'>;

  return {
    ...base,
    hash: computeInstallAuditHash(base)
  };
}

describe('audit integrity verification + gate policy', () => {
  it('verifies valid hash chain', () => {
    const first = makeEvent(INSTALL_AUDIT_GENESIS_PREV_HASH, { eventId: 'evt-1' });
    const second = makeEvent(first.hash, { eventId: 'evt-2', slug: 'demo/skill-2' });
    const result = verifyInstallAuditLines([JSON.stringify(first), JSON.stringify(second)]);

    expect(result.ok).toBe(true);
    expect(result.verifiedCount).toBe(2);
  });

  it('detects tampered event', () => {
    const event = makeEvent(INSTALL_AUDIT_GENESIS_PREV_HASH);
    const tampered = { ...event, status: 'failed' };

    const result = verifyInstallAuditLines([JSON.stringify(tampered)]);
    expect(result.ok).toBe(false);
    expect(result.reason).toContain('hash mismatch');
  });

  it('detects deleted line / chain break', () => {
    const first = makeEvent(INSTALL_AUDIT_GENESIS_PREV_HASH, { eventId: 'evt-1' });
    const second = makeEvent(first.hash, { eventId: 'evt-2' });

    const result = verifyInstallAuditLines([JSON.stringify(second)]);
    expect(result.ok).toBe(false);
    expect(result.reason).toContain('prevHash mismatch');
  });

  it('detects malformed json line', () => {
    const result = verifyInstallAuditLines(['{"broken":']);
    expect(result.ok).toBe(false);
    expect(result.reason).toContain('malformed JSON');
  });

  it('treats missing audit+anchor+marker as first bootstrap success', () => {
    const tempDir = mkdtempSync(join(tmpdir(), 'audit-integrity-'));
    const missingPath = join(tempDir, 'install-events.jsonl');

    try {
      const result = verifyInstallAuditFile(missingPath);
      expect(result.ok).toBe(true);
      expect(result.verifiedCount).toBe(0);
      expect(result.lastHash).toBe(INSTALL_AUDIT_GENESIS_PREV_HASH);
      expect(result.reason).toContain('bootstrap');
      expect(result.reason).toContain('ENOENT');
      expect(result.reason).toContain('anchor missing');
      expect(result.reason).toContain('marker missing');
      expect(result.reason).toContain('fuse missing');
      expect(result.reason).toContain('latch missing');
      expect(() => enforceAuditIntegrityPolicy('strict', result, missingPath)).not.toThrow();
    } finally {
      rmSync(tempDir, { recursive: true, force: true });
    }
  });

  it('fails verify when marker exists but audit+anchor are missing (bootstrap re-entry blocked)', () => {
    const tempDir = mkdtempSync(join(tmpdir(), 'audit-integrity-'));
    const missingPath = join(tempDir, 'install-events.jsonl');
    const markerPath = getInstallAuditBootstrapMarkerPath(missingPath);

    try {
      writeFileSync(markerPath, JSON.stringify({ createdAt: '2026-01-01T00:00:00.000Z', schemaVersion: 1 }), 'utf8');
      const result = verifyInstallAuditFile(missingPath);
      expect(result.ok).toBe(false);
      expect(result.reason).toContain('bootstrap re-entry blocked');
      expect(result.reason).toContain('marker exists');
      expect(result.reason).toContain('ENOENT');
    } finally {
      rmSync(tempDir, { recursive: true, force: true });
    }
  });

  it('fails verify when fuse exists and audit+anchor+marker are missing (bootstrap re-entry blocked)', () => {
    const tempDir = mkdtempSync(join(tmpdir(), 'audit-integrity-'));
    const missingPath = join(tempDir, 'install-events.jsonl');
    const fusePath = getInstallAuditBootstrapFusePath(missingPath);

    try {
      writeFileSync(fusePath, JSON.stringify({ createdAt: '2026-01-01T00:00:00.000Z', schemaVersion: 1 }), 'utf8');
      const result = verifyInstallAuditFile(missingPath);
      expect(result.ok).toBe(false);
      expect(result.reason).toContain('bootstrap re-entry blocked');
      expect(result.reason).toContain('fuse exists=true');
      expect(result.reason).toContain('ENOENT');
    } finally {
      rmSync(tempDir, { recursive: true, force: true });
    }
  });

  it('fails verify when latch exists and audit+anchor+marker+fuse are missing (bootstrap re-entry blocked)', () => {
    const tempDir = mkdtempSync(join(tmpdir(), 'audit-integrity-'));
    const missingPath = join(tempDir, 'install-events.jsonl');
    const latchPath = getInstallAuditBootstrapLatchPath(missingPath);

    try {
      writeFileSync(latchPath, JSON.stringify({ createdAt: '2026-01-01T00:00:00.000Z', schemaVersion: 1 }), 'utf8');
      const result = verifyInstallAuditFile(missingPath);
      expect(result.ok).toBe(false);
      expect(result.reason).toContain('bootstrap re-entry blocked');
      expect(result.reason).toContain('latch exists=true');
      expect(result.reason).toContain('ENOENT');
    } finally {
      rmSync(tempDir, { recursive: true, force: true });
    }
  });

  it('enforces strict/balanced/fast gate behavior and records strict/balanced ops events', () => {
    const failedIntegrity = {
      ok: false,
      line: 3,
      reason: 'hash mismatch',
      verifiedCount: 0,
      lastHash: INSTALL_AUDIT_GENESIS_PREV_HASH
    } as const;

    const tempDir = mkdtempSync(join(tmpdir(), 'audit-integrity-ops-'));
    const prevCwd = process.cwd();
    process.chdir(tempDir);

    try {
      expect(() => enforceAuditIntegrityPolicy('strict', failedIntegrity, '/tmp/install-events.jsonl')).toThrow(/\[strict\]/);
      enforceAuditIntegrityPolicy('balanced', failedIntegrity, '/tmp/install-events.jsonl');

      const opsPath = join(tempDir, 'data', 'install-ops-events.jsonl');
      const events = readFileSync(opsPath, 'utf8')
        .trim()
        .split('\n')
        .map((line) => JSON.parse(line) as Record<string, unknown>);

      expect(events).toHaveLength(2);
      expect(events[0]?.policy).toBe('strict');
      expect(events[0]?.action).toBe('abort');
      expect(events[1]?.policy).toBe('balanced');
      expect(events[1]?.action).toBe('demote');
      expect(events[1]?.line).toBe(3);
      expect(events[1]?.auditPath).toBe('/tmp/install-events.jsonl');
    } finally {
      process.chdir(prevCwd);
      rmSync(tempDir, { recursive: true, force: true });
    }

    const base = planInstallAction('balanced', 'recommend', {});
    const balancedPlan = applyAuditIntegrityGate('balanced', base, failedIntegrity);
    expect(balancedPlan.action).toBe('skip-install');
    expect(balancedPlan.canInstall).toBe(false);
    expect(balancedPlan.notes.join(' ')).toContain('audit_integrity=failed');

    const fastBase = planInstallAction('fast', 'recommend', {});
    const fastPlan = applyAuditIntegrityGate('fast', fastBase, failedIntegrity);
    expect(fastPlan.action).toBe('auto-install');
    expect(fastPlan.canInstall).toBe(true);
    expect(fastPlan.notes.join(' ')).toContain('audit_integrity=failed');
  });

  it('strict evidence write failure is fail-closed with explicit message when fail-state write throws', async () => {
    const tempDir = mkdtempSync(join(tmpdir(), 'audit-strict-fail-state-'));
    const prevCwd = process.cwd();
    process.chdir(tempDir);

    vi.resetModules();
    vi.doMock('node:fs', async () => {
      const actual = await vi.importActual<typeof import('node:fs')>('node:fs');
      return {
        ...actual,
        appendFileSync: vi.fn(() => {
          throw new Error('disk full');
        }),
        writeFileSync: vi.fn((path: Parameters<typeof actual.writeFileSync>[0], ...args: unknown[]) => {
          if (String(path).includes('strict-evidence-fail-state.json')) {
            const err = new Error('EACCES: permission denied, open strict fail state');
            (err as Error & { code?: string }).code = 'EACCES';
            throw err;
          }
          return (actual.writeFileSync as (...inner: unknown[]) => unknown)(path, ...args);
        })
      };
    });

    try {
      const { enforceAuditIntegrityPolicy: mockedEnforce } = await import('../src/index.js');
      const failedIntegrity = {
        ok: false,
        line: 7,
        reason: 'hash mismatch',
        verifiedCount: 0,
        lastHash: INSTALL_AUDIT_GENESIS_PREV_HASH
      } as const;

      const run = () => mockedEnforce('strict', failedIntegrity, '/tmp/install-events.jsonl');
      expect(run).toThrow(/ops_evidence_write_failed/);
      expect(run).toThrow(/fail_state_write_failed=.*EACCES/);
    } finally {
      vi.doUnmock('node:fs');
      vi.resetModules();
      process.chdir(prevCwd);
      rmSync(tempDir, { recursive: true, force: true });
    }
  });

  it('keeps strict base gate error when fail-state reset fails', async () => {
    vi.resetModules();
    vi.doMock('node:fs', async () => {
      const actual = await vi.importActual<typeof import('node:fs')>('node:fs');
      return {
        ...actual,
        writeFileSync: vi.fn((path: Parameters<typeof actual.writeFileSync>[0], ...args: unknown[]) => {
          if (String(path).includes('strict-evidence-fail-state.json')) {
            const err = new Error('EPERM: operation not permitted');
            (err as Error & { code?: string }).code = 'EPERM';
            throw err;
          }
          return (actual.writeFileSync as (...inner: unknown[]) => unknown)(path, ...args);
        })
      };
    });

    const { enforceAuditIntegrityPolicy: mockedEnforce } = await import('../src/index.js');
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const failedIntegrity = {
      ok: false,
      line: 11,
      reason: 'hash mismatch',
      verifiedCount: 0,
      lastHash: INSTALL_AUDIT_GENESIS_PREV_HASH
    } as const;

    const run = () => mockedEnforce('strict', failedIntegrity, '/tmp/install-events.jsonl');
    expect(run).toThrow(/^\[strict\] install audit integrity check failed/);
    expect(run).not.toThrow(/ops_evidence_write_failed/);
    expect(warn.mock.calls.some((args) => String(args[0] ?? '').includes('fail-state reset failed'))).toBe(true);

    warn.mockRestore();
    vi.doUnmock('node:fs');
    vi.resetModules();
  });

  it('keeps balanced demote + warns stronger when ops evidence primary/fallback both fail', async () => {
    vi.resetModules();
    vi.doMock('node:fs', async () => {
      const actual = await vi.importActual<typeof import('node:fs')>('node:fs');
      return {
        ...actual,
        appendFileSync: vi.fn(() => {
          throw new Error('disk full');
        })
      };
    });

    const { enforceAuditIntegrityPolicy: mockedEnforce } = await import('../src/index.js');
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const failedIntegrity = {
      ok: false,
      line: 8,
      reason: 'hash mismatch',
      verifiedCount: 0,
      lastHash: INSTALL_AUDIT_GENESIS_PREV_HASH
    } as const;

    expect(() => mockedEnforce('balanced', failedIntegrity, '/tmp/install-events.jsonl')).not.toThrow();
    expect(warn).toHaveBeenCalled();
    expect(warn.mock.calls.some((args) => String(args[0] ?? '').includes('evidence write failed'))).toBe(true);

    warn.mockRestore();
    vi.doUnmock('node:fs');
    vi.resetModules();
  });
});
