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

function explainDecision(item: RecommendationResult): string {
  const ranked: Array<[string, number]> = [
    ['fit', item.fitScore] as [string, number],
    ['trend', item.trendScore] as [string, number],
    ['stability', item.stabilityScore] as [string, number],
    ['security', item.securityScore] as [string, number]
  ].sort((a, b) => b[1] - a[1]);

  const top = ranked[0]?.[0] ?? 'overall';
  const second = ranked[1]?.[0] ?? 'overall';

  switch (item.decision) {
    case 'recommend':
      return `recommended because ${top} and ${second} signals are both strong`;
    case 'caution':
      return `cautioned because ${top} is promising but ${second} still needs review`;
    case 'hold':
      return `held because ${top} is not strong enough to offset weaker signals`;
    case 'block':
      return item.securityScore < 40
        ? 'blocked primarily due to security risk'
        : `blocked because ${top} and ${second} did not clear the required thresholds`;
  }
}

function summarizeTopSignals(item: RecommendationResult): string {
  const scored: Array<[string, number]> = [
    ['fit', item.fitScore] as [string, number],
    ['trend', item.trendScore] as [string, number],
    ['stability', item.stabilityScore] as [string, number],
    ['security', item.securityScore] as [string, number]
  ].sort((a, b) => b[1] - a[1]);

  return scored
    .slice(0, 2)
    .map(([label, score]) => `${label}=${Number(score).toFixed(1)}`)
    .join(', ');
}

function buildTakeaway(items: RecommendationResult[], meta: CollectorMeta): string {
  const counts = {
    recommend: 0,
    caution: 0,
    hold: 0,
    block: 0
  };

  for (const item of items) {
    counts[item.decision] += 1;
  }

  if (meta.degraded) {
    return `takeaway collector fallback active (${meta.fallbackReason ?? 'UNKNOWN'}); treat recommendations conservatively`;
  }

  if (counts.block > 0) {
    return 'takeaway block decisions are present; review risk-sensitive skills first';
  }

  if (counts.hold > counts.recommend) {
    return 'takeaway hold decisions dominate; current signals support a cautious install posture';
  }

  if (counts.recommend > 0 && counts.block === 0 && counts.hold === 0) {
    return 'takeaway recommendation quality looks strong this cycle';
  }

  return 'takeaway mixed recommendation profile; review item-level explanations before acting';
}

export function renderWeeklyReport(items: RecommendationResult[], meta: CollectorMeta): string {
  const mode = meta.degraded ? 'fallback' : 'live';
  const fallbackReason = mode === 'fallback' ? meta.fallbackReason ?? 'UNKNOWN' : 'NONE';
  const decisionSummary = summarizeDecisionCounts(items);
  const takeaway = buildTakeaway(items, meta);
  const head = `📊 A+ 주간 추천 리포트\nsource=${mode} degraded=${meta.degraded} fallbackReason=${fallbackReason} fetchedAt=${meta.fetchedAt}\ndecisions ${decisionSummary}\n${takeaway}\n`;
  const body = items
    .slice(0, 5)
    .map((it, i) => {
      const outcome = it.installOutcome ? ` | outcome ${it.installOutcome.status}` : '';
      const action = it.installAction ? ` | action ${it.installAction}` : '';
      const narrative = ` | ${explainDecision(it)}`;
      const topSignals = ` | topSignals ${summarizeTopSignals(it)}`;
      const reasons = ` | why ${summarizeReasons(it.reasons)}`;
      return `${i + 1}. ${it.slug} | score ${it.finalScore.toFixed(1)} | security ${it.securityScore} | ${it.decision}${action}${outcome}${narrative}${topSignals}${reasons}`;
    })
    .join('\n');

  return `${head}\n${body}`;
}
