import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { describe, expect, it } from 'vitest';
import {
  INSTALL_AUDIT_GENESIS_PREV_HASH,
  INSTALL_AUDIT_SCHEMA_VERSION,
  computeInstallAuditHash,
  getInstallAuditAnchorPath,
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
});
