import { describe, expect, it } from 'vitest';
import { decide, planInstallAction } from '../src/policy/policyEngine.js';

describe('policy', () => {
  it('blocks low security', () => {
    expect(decide('balanced', 90, 30)).toBe('block');
  });

  it('forces effective hold on degraded mode and disallows any install', () => {
    const plan = planInstallAction('balanced', 'recommend', {
      degraded: true,
      confirmed: true,
      overrideToken: 'token',
      strongOverrideToken: 'strong',
      overrideReason: 'force'
    });
    expect(plan.effectiveDecision).toBe('hold');
    expect(plan.canInstall).toBe(false);
    expect(plan.action).toBe('skip-install');
  });

  it('strict policy allows hold only with strong override token + reason + confirmation', () => {
    const denied = planInstallAction('strict', 'hold', { confirmed: true, overrideToken: 'short' });
    expect(denied.canInstall).toBe(false);

    const allowed = planInstallAction('strict', 'hold', {
      confirmed: true,
      overrideToken: '12345678901234567890',
      overrideReason: 'urgent-fix'
    });
    expect(allowed.canInstall).toBe(true);
    expect(allowed.action).toBe('override-install');
  });

  it('strict policy never overrides block', () => {
    const plan = planInstallAction('strict', 'block', {
      confirmed: true,
      overrideToken: 'token',
      strongOverrideToken: 'strong',
      overrideReason: 'urgent'
    });
    expect(plan.canInstall).toBe(false);
    expect(plan.action).toBe('skip-install');
  });

  it('balanced policy overrides block only with two strong tokens + reason + confirmation', () => {
    const denied = planInstallAction('balanced', 'block', {
      confirmed: true,
      overrideToken: 'token'
    });
    expect(denied.canInstall).toBe(false);

    const allowed = planInstallAction('balanced', 'block', {
      confirmed: true,
      overrideToken: '12345678901234567890',
      strongOverrideToken: 'ABCDEFGHIJABCDEFGHIJ',
      overrideReason: 'business critical'
    });
    expect(allowed.canInstall).toBe(true);
    expect(allowed.action).toBe('override-install');
  });

  it('fast policy allows block only with strong token + reason + confirmation', () => {
    const denied = planInstallAction('fast', 'block', {
      confirmed: true,
      overrideToken: 'token'
    });
    expect(denied.canInstall).toBe(false);

    const allowed = planInstallAction('fast', 'block', {
      confirmed: true,
      overrideToken: '12345678901234567890',
      overrideReason: 'operator approved'
    });
    expect(allowed.canInstall).toBe(true);
    expect(allowed.action).toBe('override-install');
  });
});
