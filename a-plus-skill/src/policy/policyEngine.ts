import type { InstallPlan, InstallPolicyContext, Policy, RecommendationResult } from '../types/index.js';

const DECISION_HYSTERESIS_BAND = 1;

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

function hasToken(v?: string): boolean {
  return Boolean(v && v.trim().length > 0);
}

function parsePositiveIntEnv(name: string, fallback: number): number {
  const raw = process.env[name];
  if (!raw) return fallback;

  const parsed = Number.parseInt(raw, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
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

function isLegacyStrongToken(token: string): boolean {
  return token.length >= 20;
}

function isValidOverrideToken(v?: string): boolean {
  const token = v?.trim() ?? '';
  if (!token) return false;

  const allowLegacy = process.env.INSTALL_OVERRIDE_ALLOW_LEGACY === 'true';
  if (allowLegacy && isLegacyStrongToken(token)) {
    return true;
  }

  const match = /^ovr1\.(\d{10})\.(\d{10})\.([A-Za-z0-9_-]+)$/.exec(token);
  if (!match) return false;

  const [, iatRaw, expRaw, nonce] = match;
  const iat = Number.parseInt(iatRaw, 10);
  const exp = Number.parseInt(expRaw, 10);

  if (!Number.isFinite(iat) || !Number.isFinite(exp)) return false;
  if (exp <= iat) return false;

  const maxTtlSec = parsePositiveIntEnv('INSTALL_OVERRIDE_MAX_TTL_SEC', 900);
  if (exp - iat > maxTtlSec) return false;

  const clockSkewSec = parsePositiveIntEnv('INSTALL_OVERRIDE_CLOCK_SKEW_SEC', 60);
  const nowSec = Math.floor(Date.now() / 1000);
  if (nowSec < iat - clockSkewSec || nowSec > exp + clockSkewSec) return false;

  if (nonce.length < 22) return false;
  if (new Set(nonce).size < 10) return false;
  if (isSimpleRepeatedPattern(nonce)) return false;

  return true;
}

function hasReason(v?: string): boolean {
  const reason = v?.trim() ?? '';
  return reason.length >= 8;
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
    const canOverride = isValidOverrideToken(context.overrideToken) && hasReason(context.overrideReason);
    if (canOverride && context.confirmed) {
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
    const hasStrongOverride = isValidOverrideToken(context.overrideToken) && isValidOverrideToken(context.strongOverrideToken);
    if (hasStrongOverride && hasReason(context.overrideReason) && context.confirmed) {
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
  if (isValidOverrideToken(context.overrideToken) && hasReason(context.overrideReason) && context.confirmed) {
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
