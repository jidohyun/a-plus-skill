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

  it('adds natural-language decision explanations', () => {
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

    expect(out).toContain('recommended because the overall profile is strong');
    expect(out).toContain('cautioned because some signals are mixed');
    expect(out).toContain('held because the current signal is not strong enough');
    expect(out).toContain('blocked because risk or confidence thresholds were missed');
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
});
