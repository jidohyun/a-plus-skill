import { describe, expect, it } from 'vitest';
import { buildReasons } from '../src/recommender/explain.js';

describe('buildReasons', () => {
  it('emits stronger positive reasons for very high fit/trend/security', () => {
    const reasons = buildReasons({ fitScore: 88, trendScore: 91, securityScore: 92 });
    expect(reasons).toContain('사용자 프로필과의 적합도가 매우 높습니다.');
    expect(reasons).toContain('현재 사용량과 성장 신호가 매우 강합니다.');
    expect(reasons).toContain('보안 신호가 매우 강합니다.');
  });

  it('emits cautionary reasons for weak fit/trend and mid security', () => {
    const reasons = buildReasons({ fitScore: 40, trendScore: 30, securityScore: 58 });
    expect(reasons).toContain('사용자 프로필과의 적합도가 낮아 우선순위가 떨어집니다.');
    expect(reasons).toContain('현재 사용량/성장 신호가 약합니다.');
    expect(reasons).toContain('보안 신호는 통과했지만 상위 추천 기준에는 못 미칩니다.');
  });

  it('prioritizes gate-oriented reasons before weaker secondary signals', () => {
    const reasons = buildReasons({ fitScore: 40, trendScore: 30, securityScore: 20 });
    expect(reasons[0]).toBe('보안 게이트 기준을 넘지 못해 차단이 권장됩니다.');
    expect(reasons[1]).toBe('사용자 프로필과의 적합도가 낮아 우선순위가 떨어집니다.');
  });

  it('emits gate-oriented reason when security is below block threshold', () => {
    const reasons = buildReasons({ fitScore: 90, trendScore: 90, securityScore: 20 });
    expect(reasons).toContain('보안 게이트 기준을 넘지 못해 차단이 권장됩니다.');
  });
});
