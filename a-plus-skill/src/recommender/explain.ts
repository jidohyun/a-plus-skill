export function buildReasons(input: {
  fitScore: number;
  trendScore: number;
  securityScore: number;
}) {
  const reasons: Array<{ priority: number; text: string }> = [];
  const pushReason = (priority: number, text: string) => {
    if (!reasons.some((entry) => entry.text === text)) {
      reasons.push({ priority, text });
    }
  };

  if (input.securityScore < 40) {
    pushReason(100, '보안 게이트 기준을 넘지 못해 차단이 권장됩니다.');
  } else if (input.securityScore < 55) {
    pushReason(90, '보안 점수가 caution 기준에 못 미쳐 수동 검토가 필요합니다.');
  } else if (input.securityScore < 70) {
    pushReason(70, '보안 신호는 통과했지만 상위 추천 기준에는 못 미칩니다.');
  } else if (input.securityScore >= 85) {
    pushReason(60, '보안 신호가 매우 강합니다.');
  } else {
    pushReason(40, '보안 신호가 양호합니다.');
  }

  if (input.fitScore >= 85) {
    pushReason(55, '사용자 프로필과의 적합도가 매우 높습니다.');
  } else if (input.fitScore >= 75) {
    pushReason(45, '사용자 프로필과 기능 적합도가 높습니다.');
  } else if (input.fitScore < 45) {
    pushReason(65, '사용자 프로필과의 적합도가 낮아 우선순위가 떨어집니다.');
  }

  if (input.trendScore >= 85) {
    pushReason(50, '현재 사용량과 성장 신호가 매우 강합니다.');
  } else if (input.trendScore >= 70) {
    pushReason(35, '최근 인기도/성장 신호가 긍정적입니다.');
  } else if (input.trendScore < 40) {
    pushReason(50, '현재 사용량/성장 신호가 약합니다.');
  }

  return reasons.sort((a, b) => b.priority - a.priority).map((entry) => entry.text);
}
