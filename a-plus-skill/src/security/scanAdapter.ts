import type { SkillMeta } from '../types/index.js';

export function normalizeScan(meta: SkillMeta): number {
  switch (meta.securityScanStatus) {
    case 'benign':
      return 85;
    case 'suspicious':
      return 35;
    default:
      return 55;
  }
}
