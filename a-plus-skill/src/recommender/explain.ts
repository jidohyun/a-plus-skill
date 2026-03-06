export function buildReasons(input: {
  fitScore: number;
  trendScore: number;
  securityScore: number;
}) {
  const reasons: string[] = [];

  if (input.fitScore >= 75) reasons.push('사용자 프로필과 기능 적합도가 높습니다.');
  if (input.trendScore >= 70) reasons.push('최근 인기도/성장 신호가 긍정적입니다.');

  if (input.securityScore < 40) {
    reasons.push('보안 위험도가 높아 차단이 권장됩니다.');
  } else if (input.securityScore < 60) {
    reasons.push('보안 신호가 애매하여 수동 검토가 필요합니다.');
  } else {
    reasons.push('보안 신호가 양호합니다.');
  }

  return reasons;
}
