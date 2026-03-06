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

function hasStrongToken(v?: string): boolean {
  const token = v?.trim() ?? '';
  // lightweight hardening: require sufficiently long mixed token
  return token.length >= 20;
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
    const canOverride = hasStrongToken(context.overrideToken) && hasReason(context.overrideReason);
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
    const hasStrongOverride = hasStrongToken(context.overrideToken) && hasStrongToken(context.strongOverrideToken);
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
  if (hasStrongToken(context.overrideToken) && hasReason(context.overrideReason) && context.confirmed) {
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
