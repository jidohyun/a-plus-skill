import type { SkillMeta } from '../types/index.js';
import { normalizeScan } from './scanAdapter.js';
import { ruleRiskFromText } from './rules.js';

export function securityScore(meta: SkillMeta): number {
  const base = normalizeScan(meta);
  const ruleRisk = ruleRiskFromText(meta.summary);
  return Math.max(0, Math.min(100, base - ruleRisk * 0.3));
}
