import type { Policy, RecommendationResult } from '../types/index.js';

export function decide(policy: Policy, score: number, security: number): RecommendationResult['decision'] {
  const strictBoost = policy === 'strict' ? 10 : 0;
  const fastPenalty = policy === 'fast' ? -10 : 0;
  const securityGate = security + strictBoost + fastPenalty;

  if (securityGate < 40) return 'block';
  if (score >= 75 && securityGate >= 70) return 'recommend';
  if (score >= 60 && securityGate >= 55) return 'caution';
  return 'hold';
}
