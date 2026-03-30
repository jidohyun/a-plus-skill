import { createHmac, timingSafeEqual } from 'node:crypto';
import { getOverrideNonceStore, __resetOverrideNonceStoreForTests } from './overrideNonceStore.js';
import type { InstallPlan, InstallPolicyContext, Policy, RecommendationResult } from '../types/index.js';

const DECISION_HYSTERESIS_BAND = 1;
const HARD_MAX_TTL_SEC = 900;
const HARD_MAX_CLOCK_SKEW_SEC = 120;

function applyConservativeHysteresis(score: number): number {
  let adjusted = score;

  if (Math.abs(adjusted - 75) <= DECISION_HYSTERESIS_BAND) {
    adjusted = Math.min(adjusted, 74);
  }

  if (Math.abs(adjusted - 60) <= DECISION_HYSTERESIS_BAND) {
    adjusted = Math.min(adjusted, 59);
  }

  return adjusted;
}

export function decide(policy: Policy, score: number, security: number): RecommendationResult['decision'] {
  const strictBoost = policy === 'strict' ? 10 : 0;
  const fastPenalty = policy === 'fast' ? -10 : 0;
  const securityGate = security + strictBoost + fastPenalty;
  const bufferedScore = applyConservativeHysteresis(score);

  if (securityGate < 40) return 'block';
  if (bufferedScore >= 75 && securityGate >= 70) return 'recommend';
  if (bufferedScore >= 60 && securityGate >= 55) return 'caution';
  return 'hold';
}

function parsePositiveIntEnv(name: string, fallback: number, max: number): number {
  const raw = process.env[name];
  if (!raw) return Math.min(fallback, max);

  const parsed = Number.parseInt(raw, 10);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    return Math.min(fallback, max);
  }

  return Math.min(parsed, max);
}

function isSimpleRepeatedPattern(value: string): boolean {
  if (value.length === 0) return true;

  for (let unitLen = 1; unitLen <= Math.floor(value.length / 2); unitLen += 1) {
    if (value.length % unitLen !== 0) continue;

    const unit = value.slice(0, unitLen);
    if (unit.repeat(value.length / unitLen) === value) {
      return true;
    }
  }

  return false;
}

type ParsedOverrideToken = {
  token: string;
  iat: number;
  exp: number;
  nonce: string;
  sig: string;
};

function getOverrideSigningSecret(): string {
  return process.env.INSTALL_OVERRIDE_SIGNING_SECRET?.trim() ?? '';
}

function parseSignedOverrideToken(v?: string): ParsedOverrideToken | null {
  const token = v?.trim() ?? '';
  if (!token) return null;

  const match = /^ovr1\.(\d{10})\.(\d{10})\.([A-Za-z0-9_-]+)\.([A-Za-z0-9_-]+)$/.exec(token);
  if (!match) return null;

  const [, iatRaw, expRaw, nonce, sig] = match;
  const iat = Number.parseInt(iatRaw, 10);
  const exp = Number.parseInt(expRaw, 10);

  if (!Number.isFinite(iat) || !Number.isFinite(exp)) return null;

  return { token, iat, exp, nonce, sig };
}

function verifySignature(token: ParsedOverrideToken, secret: string): boolean {
  const payload = `${token.iat}.${token.exp}.${token.nonce}`;
  const expected = createHmac('sha256', secret).update(payload).digest('base64url');

  const expectedBuf = Buffer.from(expected);
  const actualBuf = Buffer.from(token.sig);

  if (expectedBuf.length !== actualBuf.length) return false;
  return timingSafeEqual(expectedBuf, actualBuf);
}

function isValidSignedOverrideToken(parsed: ParsedOverrideToken): boolean {
  const { iat, exp, nonce } = parsed;

  if (exp <= iat) return false;

  const maxTtlSec = parsePositiveIntEnv('INSTALL_OVERRIDE_MAX_TTL_SEC', HARD_MAX_TTL_SEC, HARD_MAX_TTL_SEC);
  if (exp - iat > maxTtlSec) return false;

  const clockSkewSec = parsePositiveIntEnv(
    'INSTALL_OVERRIDE_CLOCK_SKEW_SEC',
    60,
    HARD_MAX_CLOCK_SKEW_SEC
  );
  const nowSec = Math.floor(Date.now() / 1000);
  if (nowSec < iat - clockSkewSec || nowSec > exp + clockSkewSec) return false;

  if (nonce.length < 22) return false;
  if (new Set(nonce).size < 10) return false;
  if (isSimpleRepeatedPattern(nonce)) return false;

  const secret = getOverrideSigningSecret();
  if (!secret) return false;
  if (!verifySignature(parsed, secret)) return false;

  const nonceStore = getOverrideNonceStore();
  nonceStore.gc(nowSec);

  return true;
}

function markOverrideTokenUsed(token: ParsedOverrideToken): boolean {
  const nowSec = Math.floor(Date.now() / 1000);
  return getOverrideNonceStore().consume(token.nonce, token.exp, nowSec);
}

type OverrideValidationResult = {
  valid: boolean;
  parsed: ParsedOverrideToken | null;
};

function validateOverrideToken(v?: string): OverrideValidationResult {
  const token = v?.trim() ?? '';
  if (!token) return { valid: false, parsed: null };

  const parsed = parseSignedOverrideToken(token);
  if (!parsed) return { valid: false, parsed: null };
  if (!isValidSignedOverrideToken(parsed)) return { valid: false, parsed: null };

  return { valid: true, parsed };
}

function hasReason(v?: string): boolean {
  const reason = v?.trim() ?? '';
  return reason.length >= 8;
}

export function __resetOverrideNonceCacheForTests(): void {
  __resetOverrideNonceStoreForTests();
}

export function planInstallAction(
  policy: Policy,
  decision: RecommendationResult['decision'],
  context: InstallPolicyContext = {}
): InstallPlan {
  const notes: string[] = [];
  const effectiveDecision = context.degraded ? 'hold' : decision;

  if (context.degraded) {
    notes.push('degraded mode: install is hard-blocked regardless of policy/override');
    return {
      policy,
      originalDecision: decision,
      effectiveDecision,
      action: 'skip-install',
      canInstall: false,
      notes
    };
  }

  if (effectiveDecision === 'recommend' || effectiveDecision === 'caution') {
    return {
      policy,
      originalDecision: decision,
      effectiveDecision,
      action: 'auto-install',
      canInstall: true,
      notes
    };
  }

  if (effectiveDecision === 'hold') {
    const override = validateOverrideToken(context.overrideToken);
    const hasValidReason = hasReason(context.overrideReason);
    const canOverride = override.valid && hasValidReason;
    if (canOverride && context.confirmed) {
      const consumed = override.parsed ? markOverrideTokenUsed(override.parsed) : true;
      if (!consumed) {
        notes.push('hold override rejected: nonce replay detected');
        return {
          policy,
          originalDecision: decision,
          effectiveDecision,
          action: 'confirm-install',
          canInstall: false,
          notes
        };
      }

      notes.push('hold overridden with strong token + reason + confirmation');
      return {
        policy,
        originalDecision: decision,
        effectiveDecision,
        action: 'override-install',
        canInstall: true,
        notes
      };
    }

    if (override.valid && hasValidReason && !context.confirmed) {
      notes.push('hold override pending: confirmation missing');
    }

    notes.push(
      policy === 'strict'
        ? 'strict policy: hold requires strong override token + reason + confirmation'
        : 'hold requires strong override token + reason + confirmation'
    );
    return {
      policy,
      originalDecision: decision,
      effectiveDecision,
      action: 'confirm-install',
      canInstall: false,
      notes
    };
  }

  // effectiveDecision === 'block'
  if (policy === 'strict') {
    notes.push('strict policy: block cannot be overridden');
    return {
      policy,
      originalDecision: decision,
      effectiveDecision,
      action: 'skip-install',
      canInstall: false,
      notes
    };
  }

  if (policy === 'balanced') {
    const rawOverride = context.overrideToken?.trim() ?? '';
    const rawStrongOverride = context.strongOverrideToken?.trim() ?? '';

    if (rawOverride && rawStrongOverride && rawOverride === rawStrongOverride) {
      notes.push('balanced policy: override tokens must be distinct');
      return {
        policy,
        originalDecision: decision,
        effectiveDecision,
        action: 'confirm-install',
        canInstall: false,
        notes
      };
    }

    const override = validateOverrideToken(context.overrideToken);
    const strongOverride = validateOverrideToken(context.strongOverrideToken);
    const hasValidReason = hasReason(context.overrideReason);
    const hasStrongOverride = override.valid && strongOverride.valid;

    const nonceConflict = Boolean(
      override.parsed && strongOverride.parsed && override.parsed.nonce === strongOverride.parsed.nonce
    );

    if (!nonceConflict && hasStrongOverride && hasValidReason && context.confirmed) {
      const overrideConsumed = override.parsed ? markOverrideTokenUsed(override.parsed) : true;
      const strongConsumed = strongOverride.parsed ? markOverrideTokenUsed(strongOverride.parsed) : true;

      if (!overrideConsumed || !strongConsumed) {
        notes.push('balanced policy: block override rejected due to nonce replay');
        return {
          policy,
          originalDecision: decision,
          effectiveDecision,
          action: 'confirm-install',
          canInstall: false,
          notes
        };
      }

      notes.push('balanced policy: block overridden with strong override tokens + reason + confirmation');
      return {
        policy,
        originalDecision: decision,
        effectiveDecision,
        action: 'override-install',
        canInstall: true,
        notes
      };
    }

    if (!nonceConflict && hasStrongOverride && hasValidReason && !context.confirmed) {
      notes.push('balanced policy: block override pending: confirmation missing');
    }

    notes.push('balanced policy: block needs strong override token + strong override token + reason + confirmation');
    return {
      policy,
      originalDecision: decision,
      effectiveDecision,
      action: 'confirm-install',
      canInstall: false,
      notes
    };
  }

  // fast policy
  const override = validateOverrideToken(context.overrideToken);
  const hasValidReason = hasReason(context.overrideReason);
  if (override.valid && hasValidReason && context.confirmed) {
    const consumed = override.parsed ? markOverrideTokenUsed(override.parsed) : true;
    if (!consumed) {
      notes.push('fast policy: block override rejected due to nonce replay');
      return {
        policy,
        originalDecision: decision,
        effectiveDecision,
        action: 'confirm-install',
        canInstall: false,
        notes
      };
    }

    notes.push('fast policy: block overridden with strong token + reason + confirmation');
    return {
      policy,
      originalDecision: decision,
      effectiveDecision,
      action: 'override-install',
      canInstall: true,
      notes
    };
  }

  if (override.valid && hasValidReason && !context.confirmed) {
    notes.push('fast policy: block override pending: confirmation missing');
  }

  notes.push('fast policy: block needs strong override token + reason + confirmation');
  return {
    policy,
    originalDecision: decision,
    effectiveDecision,
    action: 'confirm-install',
    canInstall: false,
    notes
  };
}
