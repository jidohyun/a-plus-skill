# A+ Skill (Skill Radar with Security Gate)

OpenClaw 스킬 추천에 보안 심사를 기본 결합한 로컬 우선 MVP입니다.

## 현재 구현 범위
- [x] 프로젝트 스캐폴딩
- [x] 추천 점수 계산기 (`fit/trend/stability/security`)
- [x] 정책 엔진 (`strict/balanced/fast`)
- [x] 보안 점수 계산 (스캔 신호 + 룰 기반 위험 패턴)
- [x] 추천 사유 생성기
- [x] 주간 리포트 문자열 렌더러
- [x] 기본 테스트 파일 3개
- [ ] ClawHub 실데이터 수집기(현재 mock)
- [ ] OpenClaw 설치 플로우 실연동
- [ ] Discord/Telegram 실제 전송 연동

## 폴더
- `src/collector`: 후보 스킬 수집
- `src/recommender`: 점수 계산/설명
- `src/security`: 보안 규칙/점수화
- `src/policy`: 설치 정책 결정
- `src/report`: 주간 리포트 생성

## 실행
```bash
npm ci --include=dev
npm run dev
```

> preflight가 devDependencies(typescript/vitest/tsx) 누락 시 즉시 실패시킵니다.

## 테스트
```bash
npm run test
npm run typecheck
npm run build
```

## 산출 예시
- top 추천 리스트 + 보안 상태(`recommend/caution/hold/block`)
- 주간 리포트 텍스트
