import type { InstallPlan, InstallPolicyContext, Policy, RecommendationResult } from '../types/index.js';

export function decide(policy: Policy, score: number, security: number): RecommendationResult['decision'] {
  const strictBoost = policy === 'strict' ? 10 : 0;
  const fastPenalty = policy === 'fast' ? -10 : 0;
  const securityGate = security + strictBoost + fastPenalty;

  if (securityGate < 40) return 'block';
  if (score >= 75 && securityGate >= 70) return 'recommend';
  if (score >= 60 && securityGate >= 55) return 'caution';
  return 'hold';
}

function hasToken(v?: string): boolean {
  return Boolean(v && v.trim().length > 0);
}

export function planInstallAction(
  policy: Policy,
  decision: RecommendationResult['decision'],
  context: InstallPolicyContext = {}
): InstallPlan {
  const notes: string[] = [];
  const effectiveDecision = context.degraded ? 'hold' : decision;

  if (context.degraded) {
    notes.push('degraded mode: effectiveDecision forced to hold');
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
    const canOverride = hasToken(context.overrideToken);
    if (canOverride && context.confirmed) {
      notes.push('hold overridden with token + confirmation');
      return {
        policy,
        originalDecision: decision,
        effectiveDecision,
        action: 'override-install',
        canInstall: true,
        notes
      };
    }

    notes.push(policy === 'strict' ? 'strict policy: hold requires override token' : 'hold requires confirmation + override');
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
    const hasStrongOverride = hasToken(context.overrideToken) && hasToken(context.strongOverrideToken);
    if (hasStrongOverride && hasToken(context.overrideReason) && context.confirmed) {
      notes.push('balanced policy: block overridden with strong override + reason + confirmation');
      return {
        policy,
        originalDecision: decision,
        effectiveDecision,
        action: 'override-install',
        canInstall: true,
        notes
      };
    }

    notes.push('balanced policy: block needs override token + strong override token + reason + confirmation');
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
  if (hasToken(context.overrideToken) && context.confirmed) {
    notes.push('fast policy: block overridden with confirmation + override token');
    return {
      policy,
      originalDecision: decision,
      effectiveDecision,
      action: 'override-install',
      canInstall: true,
      notes
    };
  }

  notes.push('fast policy: block needs confirmation + override token');
  return {
    policy,
    originalDecision: decision,
    effectiveDecision,
    action: 'confirm-install',
    canInstall: false,
    notes
  };
}
