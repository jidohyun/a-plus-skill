import type { SkillMeta } from '../types/index.js';

export function securityScore(meta: SkillMeta): number {
  if (meta.securityScanStatus === 'benign') return 80;
  if (meta.securityScanStatus === 'suspicious') return 35;
  return 55;
}
