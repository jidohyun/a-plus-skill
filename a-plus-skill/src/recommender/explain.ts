export function buildReasons(input: {
  fitScore: number;
  trendScore: number;
  securityScore: number;
}) {
  const reasons: string[] = [];

  if (input.fitScore >= 85) {
    reasons.push('사용자 프로필과의 적합도가 매우 높습니다.');
  } else if (input.fitScore >= 75) {
    reasons.push('사용자 프로필과 기능 적합도가 높습니다.');
  } else if (input.fitScore < 45) {
    reasons.push('사용자 프로필과의 적합도가 낮아 우선순위가 떨어집니다.');
  }

  if (input.trendScore >= 85) {
    reasons.push('현재 사용량과 성장 신호가 매우 강합니다.');
  } else if (input.trendScore >= 70) {
    reasons.push('최근 인기도/성장 신호가 긍정적입니다.');
  } else if (input.trendScore < 40) {
    reasons.push('현재 사용량/성장 신호가 약합니다.');
  }

  if (input.securityScore < 40) {
    reasons.push('보안 게이트 기준을 넘지 못해 차단이 권장됩니다.');
  } else if (input.securityScore < 55) {
    reasons.push('보안 점수가 caution 기준에 못 미쳐 수동 검토가 필요합니다.');
  } else if (input.securityScore < 70) {
    reasons.push('보안 신호는 통과했지만 상위 추천 기준에는 못 미칩니다.');
  } else if (input.securityScore >= 85) {
    reasons.push('보안 신호가 매우 강합니다.');
  } else {
    reasons.push('보안 신호가 양호합니다.');
  }

  return reasons;
}
