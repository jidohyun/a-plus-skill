import type { CollectorMeta, RecommendationResult } from '../types/index.js';

export function renderWeeklyReport(items: RecommendationResult[], meta: CollectorMeta): string {
  const mode = meta.degraded ? 'fallback' : 'live';
  const fallbackReason = mode === 'fallback' ? meta.fallbackReason ?? 'UNKNOWN' : 'NONE';
  const head = `📊 A+ 주간 추천 리포트\nsource=${mode} degraded=${meta.degraded} fallbackReason=${fallbackReason} fetchedAt=${meta.fetchedAt}\n`;
  const body = items
    .slice(0, 5)
    .map((it, i) => {
      const outcome = it.installOutcome ? ` | outcome ${it.installOutcome.status}` : '';
      const action = it.installAction ? ` | action ${it.installAction}` : '';
      return `${i + 1}. ${it.slug} | score ${it.finalScore.toFixed(1)} | security ${it.securityScore} | ${it.decision}${action}${outcome}`;
    })
    .join('\n');

  return `${head}\n${body}`;
}
