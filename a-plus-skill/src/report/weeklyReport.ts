import type { CollectorMeta, RecommendationResult } from '../types/index.js';

function summarizeReasons(reasons: string[]): string {
  const cleaned = reasons.map((reason) => reason.trim()).filter(Boolean);
  if (cleaned.length === 0) return 'reason unavailable';
  return cleaned.slice(0, 2).join('; ');
}

function summarizeDecisionCounts(items: RecommendationResult[]): string {
  const counts = {
    recommend: 0,
    caution: 0,
    hold: 0,
    block: 0
  };

  for (const item of items) {
    counts[item.decision] += 1;
  }

  return `recommend=${counts.recommend} caution=${counts.caution} hold=${counts.hold} block=${counts.block}`;
}

export function renderWeeklyReport(items: RecommendationResult[], meta: CollectorMeta): string {
  const mode = meta.degraded ? 'fallback' : 'live';
  const fallbackReason = mode === 'fallback' ? meta.fallbackReason ?? 'UNKNOWN' : 'NONE';
  const decisionSummary = summarizeDecisionCounts(items);
  const head = `📊 A+ 주간 추천 리포트\nsource=${mode} degraded=${meta.degraded} fallbackReason=${fallbackReason} fetchedAt=${meta.fetchedAt}\ndecisions ${decisionSummary}\n`;
  const body = items
    .slice(0, 5)
    .map((it, i) => {
      const outcome = it.installOutcome ? ` | outcome ${it.installOutcome.status}` : '';
      const action = it.installAction ? ` | action ${it.installAction}` : '';
      const reasons = ` | why ${summarizeReasons(it.reasons)}`;
      return `${i + 1}. ${it.slug} | score ${it.finalScore.toFixed(1)} | security ${it.securityScore} | ${it.decision}${action}${outcome}${reasons}`;
    })
    .join('\n');

  return `${head}\n${body}`;
}
