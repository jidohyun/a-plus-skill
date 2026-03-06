import { describe, expect, it } from 'vitest';
import { decide, planInstallAction } from '../src/policy/policyEngine.js';

describe('policy', () => {
  it('blocks low security', () => {
    expect(decide('balanced', 90, 30)).toBe('block');
  });

  it('forces effective hold on degraded mode', () => {
    const plan = planInstallAction('balanced', 'recommend', { degraded: true });
    expect(plan.effectiveDecision).toBe('hold');
    expect(plan.canInstall).toBe(false);
  });

  it('strict policy allows hold only with override token + confirmation', () => {
    const denied = planInstallAction('strict', 'hold', { confirmed: true });
    expect(denied.canInstall).toBe(false);

    const allowed = planInstallAction('strict', 'hold', {
      confirmed: true,
      overrideToken: 'token'
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

  it('balanced policy overrides block only with strong override + reason + confirmation', () => {
    const denied = planInstallAction('balanced', 'block', {
      confirmed: true,
      overrideToken: 'token'
    });
    expect(denied.canInstall).toBe(false);

    const allowed = planInstallAction('balanced', 'block', {
      confirmed: true,
      overrideToken: 'token',
      strongOverrideToken: 'strong',
      overrideReason: 'business critical'
    });
    expect(allowed.canInstall).toBe(true);
    expect(allowed.action).toBe('override-install');
  });

  it('fast policy allows block on confirmation + override token', () => {
    const plan = planInstallAction('fast', 'block', {
      confirmed: true,
      overrideToken: 'token'
    });
    expect(plan.canInstall).toBe(true);
    expect(plan.action).toBe('override-install');
  });
});
