import { describe, expect, it } from 'vitest';
import { renderWeeklyReport } from '../src/report/weeklyReport.js';
import type { CollectorMeta, RecommendationResult } from '../src/types/index.js';

function makeItem(overrides: Partial<RecommendationResult> = {}): RecommendationResult {
  return {
    slug: 'demo/weather',
    fitScore: 10,
    trendScore: 20,
    stabilityScore: 30,
    securityScore: 90,
    finalScore: 50,
    reasons: ['trusted author', 'strong security score', 'recent updates'],
    decision: 'recommend',
    ...overrides
  };
}

describe('weekly report render', () => {
  it('includes fallback reason in fallback mode', () => {
    const meta: CollectorMeta = {
      source: 'fallback',
      degraded: true,
      fallbackReason: 'FETCH_ERROR_TIMEOUT',
      fetchedAt: '2026-03-30T00:00:00.000Z'
    };

    const out = renderWeeklyReport([makeItem()], meta);
    expect(out).toContain('source=fallback');
    expect(out).toContain('degraded=true');
    expect(out).toContain('fallbackReason=FETCH_ERROR_TIMEOUT');
  });

  it('uses fallbackReason=NONE in live mode', () => {
    const meta: CollectorMeta = {
      source: 'live',
      degraded: false,
      fetchedAt: '2026-03-30T00:00:00.000Z'
    };

    const out = renderWeeklyReport([makeItem()], meta);
    expect(out).toContain('source=live');
    expect(out).toContain('fallbackReason=NONE');
  });

  it('includes top recommendation reasons and limits them to two', () => {
    const meta: CollectorMeta = {
      source: 'live',
      degraded: false,
      fetchedAt: '2026-03-30T00:00:00.000Z'
    };

    const out = renderWeeklyReport([makeItem()], meta);
    expect(out).toContain('why trusted author; strong security score');
    expect(out).not.toContain('recent updates');
  });

  it('uses fallback reason placeholder when item reasons are empty', () => {
    const meta: CollectorMeta = {
      source: 'live',
      degraded: false,
      fetchedAt: '2026-03-30T00:00:00.000Z'
    };

    const out = renderWeeklyReport([makeItem({ reasons: [] })], meta);
    expect(out).toContain('why reason unavailable');
  });
});
