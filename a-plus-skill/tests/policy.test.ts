import { createHmac } from 'node:crypto';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { __resetOverrideNonceCacheForTests, decide, planInstallAction } from '../src/policy/policyEngine.js';

const TEST_SIGNING_SECRET = 'test-signing-secret';

function signOverrideToken(iat: number, exp: number, nonce: string, secret = TEST_SIGNING_SECRET): string {
  const payload = `${iat}.${exp}.${nonce}`;
  return createHmac('sha256', secret).update(payload).digest('base64url');
}

function makeOverrideToken({
  iat,
  exp,
  nonce = 'AbCdEfGhIjKlMnOpQrStUvWX',
  sig
}: {
  iat: number;
  exp: number;
  nonce?: string;
  sig?: string;
}): string {
  const resolvedSig = sig ?? signOverrideToken(iat, exp, nonce);
  return `ovr1.${iat}.${exp}.${nonce}.${resolvedSig}`;
}

function makeCurrentOverrideToken(overrides: { iatOffset?: number; expOffset?: number; nonce?: string; sig?: string } = {}): string {
  const now = Math.floor(Date.now() / 1000);
  const iat = now + (overrides.iatOffset ?? -10);
  const exp = now + (overrides.expOffset ?? 120);
  return makeOverrideToken({ iat, exp, nonce: overrides.nonce, sig: overrides.sig });
}

beforeEach(() => {
  __resetOverrideNonceCacheForTests();
  process.env.INSTALL_OVERRIDE_SIGNING_SECRET = TEST_SIGNING_SECRET;
});

afterEach(() => {
  __resetOverrideNonceCacheForTests();
  delete process.env.NODE_ENV;
  delete process.env.INSTALL_OVERRIDE_MAX_TTL_SEC;
  delete process.env.INSTALL_OVERRIDE_CLOCK_SKEW_SEC;
  delete process.env.INSTALL_OVERRIDE_ALLOW_LEGACY;
  delete process.env.INSTALL_OVERRIDE_SIGNING_SECRET;
  delete process.env.INSTALL_OVERRIDE_NONCE_STORE;
  delete process.env.INSTALL_OVERRIDE_NONCE_DIR;
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

    const pending = planInstallAction('strict', 'hold', {
      confirmed: false,
      overrideToken: makeCurrentOverrideToken(),
      overrideReason: 'urgent-fix'
    });
    expect(pending.canInstall).toBe(false);
    expect(pending.notes).toContain('hold override pending: confirmation missing');

    const missingReason = planInstallAction('strict', 'hold', {
      confirmed: true,
      overrideToken: makeCurrentOverrideToken({ nonce: 'MnOpQrStUvWxYzAbCdEfGhIj' }),
      overrideReason: 'short'
    });
    expect(missingReason.canInstall).toBe(false);
    expect(missingReason.notes).toContain('hold override pending: reason missing or too short');

    const allowed = planInstallAction('strict', 'hold', {
      confirmed: true,
      overrideToken: makeCurrentOverrideToken({ nonce: 'ZyXwVuTsRqPoNmLkJiHgFeDc' }),
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
    expect(denied.notes).toContain('balanced policy: block override pending: strong override token missing or invalid');

    const pending = planInstallAction('balanced', 'block', {
      confirmed: false,
      overrideToken: makeCurrentOverrideToken(),
      strongOverrideToken: makeCurrentOverrideToken({ nonce: 'ZyXwVuTsRqPoNmLkJiHgFeDc' }),
      overrideReason: 'business critical'
    });
    expect(pending.canInstall).toBe(false);
    expect(pending.notes).toContain('balanced policy: block override pending: confirmation missing');

    const missingReason = planInstallAction('balanced', 'block', {
      confirmed: true,
      overrideToken: makeCurrentOverrideToken({ nonce: 'MnOpQrStUvWxYzAbCdEfGhIj' }),
      strongOverrideToken: makeCurrentOverrideToken({ nonce: 'QwErTyUiOpAsDfGhJkLzXcVb' }),
      overrideReason: 'short'
    });
    expect(missingReason.canInstall).toBe(false);
    expect(missingReason.notes).toContain('balanced policy: block override pending: reason missing or too short');

    const allowed = planInstallAction('balanced', 'block', {
      confirmed: true,
      overrideToken: makeCurrentOverrideToken({ nonce: 'MnOpQrStUvWxYzAbCdEfGhIj' }),
      strongOverrideToken: makeCurrentOverrideToken({ nonce: 'QwErTyUiOpAsDfGhJkLzXcVb' }),
      overrideReason: 'business critical'
    });
    expect(allowed.canInstall).toBe(true);
    expect(allowed.action).toBe('override-install');
  });

  it('balanced block notes identify which override token condition is missing', () => {
    const missingPrimary = planInstallAction('balanced', 'block', {
      confirmed: true,
      strongOverrideToken: makeCurrentOverrideToken(),
      overrideReason: 'business critical'
    });
    expect(missingPrimary.canInstall).toBe(false);
    expect(missingPrimary.notes).toContain('balanced policy: block override pending: primary override token missing or invalid');

    const missingStrong = planInstallAction('balanced', 'block', {
      confirmed: true,
      overrideToken: makeCurrentOverrideToken(),
      overrideReason: 'business critical'
    });
    expect(missingStrong.canInstall).toBe(false);
    expect(missingStrong.notes).toContain('balanced policy: block override pending: strong override token missing or invalid');
  });

  it('balanced block still rejects identical override tokens early', () => {
    const token = makeCurrentOverrideToken();
    const plan = planInstallAction('balanced', 'block', {
      confirmed: true,
      overrideToken: token,
      strongOverrideToken: token,
      overrideReason: 'business critical'
    });

    expect(plan.canInstall).toBe(false);
    expect(plan.notes).toContain('balanced policy: override tokens must be distinct');
  });

  it('fast policy allows block only with valid token + reason + confirmation', () => {
    const denied = planInstallAction('fast', 'block', {
      confirmed: true,
      overrideToken: 'token'
    });
    expect(denied.canInstall).toBe(false);

    const pending = planInstallAction('fast', 'block', {
      confirmed: false,
      overrideToken: makeCurrentOverrideToken(),
      overrideReason: 'operator approved'
    });
    expect(pending.canInstall).toBe(false);
    expect(pending.notes).toContain('fast policy: block override pending: confirmation missing');

    const missingReason = planInstallAction('fast', 'block', {
      confirmed: true,
      overrideToken: makeCurrentOverrideToken({ nonce: 'MnOpQrStUvWxYzAbCdEfGhIj' }),
      overrideReason: 'short'
    });
    expect(missingReason.canInstall).toBe(false);
    expect(missingReason.notes).toContain('fast policy: block override pending: reason missing or too short');

    const allowed = planInstallAction('fast', 'block', {
      confirmed: true,
      overrideToken: makeCurrentOverrideToken({ nonce: 'ZyXwVuTsRqPoNmLkJiHgFeDc' }),
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

  it('rejects missing signature token', () => {
    const now = Math.floor(Date.now() / 1000);
    const tokenWithoutSig = `ovr1.${now - 10}.${now + 120}.AbCdEfGhIjKlMnOpQrStUvWX`;

    const plan = planInstallAction('fast', 'hold', {
      confirmed: true,
      overrideToken: tokenWithoutSig,
      overrideReason: 'operator approved'
    });
    expect(plan.canInstall).toBe(false);
  });

  it('rejects bad signature token', () => {
    const plan = planInstallAction('fast', 'hold', {
      confirmed: true,
      overrideToken: makeCurrentOverrideToken({ sig: 'invalidsig' }),
      overrideReason: 'operator approved'
    });
    expect(plan.canInstall).toBe(false);
  });

  it('accepts valid signature token', () => {
    const plan = planInstallAction('fast', 'hold', {
      confirmed: true,
      overrideToken: makeCurrentOverrideToken(),
      overrideReason: 'operator approved'
    });
    expect(plan.canInstall).toBe(true);
  });

  it('rejects replay when identical token is reused', () => {
    const token = makeCurrentOverrideToken();

    const first = planInstallAction('fast', 'hold', {
      confirmed: true,
      overrideToken: token,
      overrideReason: 'operator approved'
    });
    expect(first.canInstall).toBe(true);

    const second = planInstallAction('fast', 'hold', {
      confirmed: true,
      overrideToken: token,
      overrideReason: 'operator approved'
    });
    expect(second.canInstall).toBe(false);
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

  it('rejects balanced block override when both tokens are identical', () => {
    const token = makeCurrentOverrideToken();
    const plan = planInstallAction('balanced', 'block', {
      confirmed: true,
      overrideToken: token,
      strongOverrideToken: token,
      overrideReason: 'business critical'
    });

    expect(plan.canInstall).toBe(false);
    expect(plan.action).toBe('confirm-install');
  });

  it('allows balanced block override with distinct valid tokens', () => {
    const plan = planInstallAction('balanced', 'block', {
      confirmed: true,
      overrideToken: makeCurrentOverrideToken({ nonce: 'AbCdEfGhIjKlMnOpQrStUvWX' }),
      strongOverrideToken: makeCurrentOverrideToken({ nonce: 'ZyXwVuTsRqPoNmLkJiHgFeDc' }),
      overrideReason: 'business critical'
    });

    expect(plan.canInstall).toBe(true);
    expect(plan.action).toBe('override-install');
  });

  it('always rejects legacy length-based token regardless of env', () => {
    const legacyToken = '12345678901234567890';

    process.env.NODE_ENV = 'development';
    process.env.INSTALL_OVERRIDE_ALLOW_LEGACY = 'true';
    const devAttempt = planInstallAction('fast', 'hold', {
      confirmed: true,
      overrideToken: legacyToken,
      overrideReason: 'operator approved'
    });

    process.env.NODE_ENV = 'production';
    process.env.INSTALL_OVERRIDE_ALLOW_LEGACY = 'true';
    const prodAttempt = planInstallAction('fast', 'hold', {
      confirmed: true,
      overrideToken: legacyToken,
      overrideReason: 'operator approved'
    });

    expect(devAttempt.canInstall).toBe(false);
    expect(devAttempt.action).toBe('confirm-install');
    expect(prodAttempt.canInstall).toBe(false);
    expect(prodAttempt.action).toBe('confirm-install');
  });

  it('enforces hard caps for ttl and skew even with oversized env values', () => {
    process.env.INSTALL_OVERRIDE_MAX_TTL_SEC = '99999';
    process.env.INSTALL_OVERRIDE_CLOCK_SKEW_SEC = '99999';

    const now = Math.floor(Date.now() / 1000);
    const token = makeOverrideToken({
      iat: now - 100,
      exp: now + 901,
      nonce: 'AbCdEfGhIjKlMnOpQrStUvWX'
    });

    const plan = planInstallAction('fast', 'hold', {
      confirmed: true,
      overrideToken: token,
      overrideReason: 'operator approved'
    });

    expect(plan.canInstall).toBe(false);
  });
});
