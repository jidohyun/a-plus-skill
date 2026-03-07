import { afterEach, describe, expect, it } from 'vitest';
import { decide, planInstallAction } from '../src/policy/policyEngine.js';

function makeOverrideToken({
  iat,
  exp,
  nonce = 'AbCdEfGhIjKlMnOpQrStUvWX'
}: {
  iat: number;
  exp: number;
  nonce?: string;
}): string {
  return `ovr1.${iat}.${exp}.${nonce}`;
}

function makeCurrentOverrideToken(overrides: { iatOffset?: number; expOffset?: number; nonce?: string } = {}): string {
  const now = Math.floor(Date.now() / 1000);
  const iat = now + (overrides.iatOffset ?? -10);
  const exp = now + (overrides.expOffset ?? 120);
  return makeOverrideToken({ iat, exp, nonce: overrides.nonce });
}

afterEach(() => {
  delete process.env.INSTALL_OVERRIDE_MAX_TTL_SEC;
  delete process.env.INSTALL_OVERRIDE_CLOCK_SKEW_SEC;
  delete process.env.INSTALL_OVERRIDE_ALLOW_LEGACY;
});

describe('policy', () => {
  it('blocks low security', () => {
    expect(decide('balanced', 90, 30)).toBe('block');
  });

  it('applies deterministic hysteresis near score thresholds to prevent upward flips', () => {
    expect(decide('balanced', 60.5, 80)).toBe('hold');
    expect(decide('balanced', 75.2, 80)).toBe('caution');
    expect(decide('balanced', 61.2, 80)).toBe('caution');
    expect(decide('balanced', 76.5, 80)).toBe('recommend');
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

  it('strict policy allows hold only with valid override token + reason + confirmation', () => {
    const denied = planInstallAction('strict', 'hold', { confirmed: true, overrideToken: 'short' });
    expect(denied.canInstall).toBe(false);

    const allowed = planInstallAction('strict', 'hold', {
      confirmed: true,
      overrideToken: makeCurrentOverrideToken(),
      overrideReason: 'urgent-fix'
    });
    expect(allowed.canInstall).toBe(true);
    expect(allowed.action).toBe('override-install');
  });

  it('strict policy never overrides block', () => {
    const plan = planInstallAction('strict', 'block', {
      confirmed: true,
      overrideToken: makeCurrentOverrideToken(),
      strongOverrideToken: makeCurrentOverrideToken(),
      overrideReason: 'urgent'
    });
    expect(plan.canInstall).toBe(false);
    expect(plan.action).toBe('skip-install');
  });

  it('balanced policy overrides block only with two valid tokens + reason + confirmation', () => {
    const denied = planInstallAction('balanced', 'block', {
      confirmed: true,
      overrideToken: makeCurrentOverrideToken()
    });
    expect(denied.canInstall).toBe(false);

    const allowed = planInstallAction('balanced', 'block', {
      confirmed: true,
      overrideToken: makeCurrentOverrideToken(),
      strongOverrideToken: makeCurrentOverrideToken({ nonce: 'ZyXwVuTsRqPoNmLkJiHgFeDc' }),
      overrideReason: 'business critical'
    });
    expect(allowed.canInstall).toBe(true);
    expect(allowed.action).toBe('override-install');
  });

  it('fast policy allows block only with valid token + reason + confirmation', () => {
    const denied = planInstallAction('fast', 'block', {
      confirmed: true,
      overrideToken: 'token'
    });
    expect(denied.canInstall).toBe(false);

    const allowed = planInstallAction('fast', 'block', {
      confirmed: true,
      overrideToken: makeCurrentOverrideToken(),
      overrideReason: 'operator approved'
    });
    expect(allowed.canInstall).toBe(true);
    expect(allowed.action).toBe('override-install');
  });

  it('rejects malformed token format', () => {
    const plan = planInstallAction('fast', 'hold', {
      confirmed: true,
      overrideToken: 'ovr1.bad.payload',
      overrideReason: 'operator approved'
    });
    expect(plan.canInstall).toBe(false);
  });

  it('rejects token when ttl exceeds max', () => {
    process.env.INSTALL_OVERRIDE_MAX_TTL_SEC = '900';
    const now = Math.floor(Date.now() / 1000);
    const token = makeOverrideToken({
      iat: now - 10,
      exp: now + 1000,
      nonce: 'AbCdEfGhIjKlMnOpQrStUvWX'
    });

    const plan = planInstallAction('fast', 'hold', {
      confirmed: true,
      overrideToken: token,
      overrideReason: 'operator approved'
    });
    expect(plan.canInstall).toBe(false);
  });

  it('rejects expired token outside skew', () => {
    process.env.INSTALL_OVERRIDE_CLOCK_SKEW_SEC = '60';
    const token = makeCurrentOverrideToken({ iatOffset: -200, expOffset: -100 });

    const plan = planInstallAction('fast', 'hold', {
      confirmed: true,
      overrideToken: token,
      overrideReason: 'operator approved'
    });
    expect(plan.canInstall).toBe(false);
  });

  it('rejects future-issued token outside skew', () => {
    process.env.INSTALL_OVERRIDE_CLOCK_SKEW_SEC = '60';
    const token = makeCurrentOverrideToken({ iatOffset: 120, expOffset: 300 });

    const plan = planInstallAction('fast', 'hold', {
      confirmed: true,
      overrideToken: token,
      overrideReason: 'operator approved'
    });
    expect(plan.canInstall).toBe(false);
  });

  it('rejects low-entropy nonce', () => {
    const lowDiversity = makeCurrentOverrideToken({ nonce: 'aaaaaaaaaaaaaaaaaaaaaa' });
    const repeatedPattern = makeCurrentOverrideToken({ nonce: 'abcdabcdabcdabcdabcdabcd' });

    const lowDiversityPlan = planInstallAction('fast', 'hold', {
      confirmed: true,
      overrideToken: lowDiversity,
      overrideReason: 'operator approved'
    });
    expect(lowDiversityPlan.canInstall).toBe(false);

    const repeatedPatternPlan = planInstallAction('fast', 'hold', {
      confirmed: true,
      overrideToken: repeatedPattern,
      overrideReason: 'operator approved'
    });
    expect(repeatedPatternPlan.canInstall).toBe(false);
  });

  it('allows legacy length-based token only when explicit flag is enabled', () => {
    const legacyToken = '12345678901234567890';

    const disabled = planInstallAction('fast', 'hold', {
      confirmed: true,
      overrideToken: legacyToken,
      overrideReason: 'operator approved'
    });
    expect(disabled.canInstall).toBe(false);

    process.env.INSTALL_OVERRIDE_ALLOW_LEGACY = 'true';
    const enabled = planInstallAction('fast', 'hold', {
      confirmed: true,
      overrideToken: legacyToken,
      overrideReason: 'operator approved'
    });
    expect(enabled.canInstall).toBe(true);
    expect(enabled.action).toBe('override-install');
  });
});
