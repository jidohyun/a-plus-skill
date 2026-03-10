import { describe, expect, it } from 'vitest';
import {
  INSTALL_AUDIT_GENESIS_PREV_HASH,
  INSTALL_AUDIT_SCHEMA_VERSION,
  computeInstallAuditHash,
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

  it('enforces strict/balanced/fast gate behavior', () => {
    const failedIntegrity = {
      ok: false,
      line: 3,
      reason: 'hash mismatch',
      verifiedCount: 0,
      lastHash: INSTALL_AUDIT_GENESIS_PREV_HASH
    } as const;

    expect(() => enforceAuditIntegrityPolicy('strict', failedIntegrity, '/tmp/install-events.jsonl')).toThrow(
      /\[strict\]/
    );

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
