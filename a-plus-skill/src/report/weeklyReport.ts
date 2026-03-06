import type { CollectorMeta, RecommendationResult } from '../types/index.js';

export function renderWeeklyReport(items: RecommendationResult[], meta: CollectorMeta): string {
  const mode = meta.degraded ? `fallback (${meta.fallbackReason ?? 'unknown'})` : 'live';
  const head = `📊 A+ 주간 추천 리포트\nsource=${mode} fetchedAt=${meta.fetchedAt}\n`;
  const body = items
    .slice(0, 5)
    .map(
      (it, i) =>
        `${i + 1}. ${it.slug} | score ${it.finalScore.toFixed(1)} | security ${it.securityScore} | ${it.decision}`
    )
    .join('\n');

  return `${head}\n${body}`;
}
