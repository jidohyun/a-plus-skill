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
    expect(out).toContain('decisions recommend=1 caution=0 hold=0 block=0');
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

  it('includes decision distribution summary across report items', () => {
    const meta: CollectorMeta = {
      source: 'live',
      degraded: false,
      fetchedAt: '2026-03-30T00:00:00.000Z'
    };

    const out = renderWeeklyReport(
      [
        makeItem({ slug: 'one/skill', decision: 'recommend' }),
        makeItem({ slug: 'two/skill', decision: 'caution' }),
        makeItem({ slug: 'three/skill', decision: 'hold' }),
        makeItem({ slug: 'four/skill', decision: 'block' })
      ],
      meta
    );

    expect(out).toContain('decisions recommend=1 caution=1 hold=1 block=1');
  });

  it('adds context-aware decision explanations', () => {
    const meta: CollectorMeta = {
      source: 'live',
      degraded: false,
      fetchedAt: '2026-03-30T00:00:00.000Z'
    };

    const out = renderWeeklyReport(
      [
        makeItem({ slug: 'one/skill', decision: 'recommend', securityScore: 95, trendScore: 88, fitScore: 40, stabilityScore: 35 }),
        makeItem({ slug: 'two/skill', decision: 'caution', fitScore: 75, trendScore: 61, stabilityScore: 20, securityScore: 18 }),
        makeItem({ slug: 'three/skill', decision: 'hold', trendScore: 52, fitScore: 49, stabilityScore: 20, securityScore: 18 }),
        makeItem({ slug: 'four/skill', decision: 'block', securityScore: 20, trendScore: 85, fitScore: 80, stabilityScore: 77 })
      ],
      meta
    );

    expect(out).toContain('recommended because security and trend signals are both strong');
    expect(out).toContain('cautioned because fit is promising but trend still needs review');
    expect(out).toContain('held because trend is not strong enough to offset weaker signals');
    expect(out).toContain('blocked primarily due to security risk');
  });

  it('includes top scoring signals for each item', () => {
    const meta: CollectorMeta = {
      source: 'live',
      degraded: false,
      fetchedAt: '2026-03-30T00:00:00.000Z'
    };

    const out = renderWeeklyReport(
      [
        makeItem({
          fitScore: 42,
          trendScore: 91,
          stabilityScore: 12,
          securityScore: 88
        })
      ],
      meta
    );

    expect(out).toContain('topSignals trend=91.0, security=88.0');
    expect(out).not.toContain('fit=42.0, stability=12.0');
  });

  it('adds conservative takeaway when collector is degraded', () => {
    const meta: CollectorMeta = {
      source: 'fallback',
      degraded: true,
      fallbackReason: 'FETCH_ERROR_TIMEOUT',
      fetchedAt: '2026-03-30T00:00:00.000Z'
    };

    const out = renderWeeklyReport([makeItem()], meta);
    expect(out).toContain('takeaway collector fallback active (FETCH_ERROR_TIMEOUT); treat recommendations conservatively');
  });

  it('adds block-focused takeaway when blocked items exist', () => {
    const meta: CollectorMeta = {
      source: 'live',
      degraded: false,
      fetchedAt: '2026-03-30T00:00:00.000Z'
    };

    const out = renderWeeklyReport([
      makeItem({ decision: 'block' }),
      makeItem({ slug: 'two/skill', decision: 'recommend' })
    ], meta);
    expect(out).toContain('takeaway block decisions are present; review risk-sensitive skills first');
  });

  it('adds strong-cycle takeaway when only recommends are present', () => {
    const meta: CollectorMeta = {
      source: 'live',
      degraded: false,
      fetchedAt: '2026-03-30T00:00:00.000Z'
    };

    const out = renderWeeklyReport([
      makeItem({ slug: 'one/skill', decision: 'recommend' }),
      makeItem({ slug: 'two/skill', decision: 'recommend' })
    ], meta);
    expect(out).toContain('takeaway recommendation quality looks strong this cycle');
  });
});
