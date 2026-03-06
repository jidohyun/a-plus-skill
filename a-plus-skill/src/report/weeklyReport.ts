import type { RecommendationResult } from '../types/index.js';

export function renderWeeklyReport(items: RecommendationResult[]): string {
  const head = '📊 A+ 주간 추천 리포트\n';
  const body = items
    .slice(0, 5)
    .map(
      (it, i) =>
        `${i + 1}. ${it.slug} | score ${it.finalScore.toFixed(1)} | security ${it.securityScore} | ${it.decision}`
    )
    .join('\n');

  return `${head}\n${body}`;
}
