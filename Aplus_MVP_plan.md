# A+ 통합안 MVP 아키텍처 & 배포 체크리스트

> 프로젝트명: **A+ (Skill Radar with Security Gate)**  
> 목표: OpenClaw 스킬 추천에 **보안 심사 파이프라인**을 기본 탑재해, 설치 의사결정을 자동화

---

## 1) MVP 아키텍처 다이어그램 (텍스트)

```text
[User (Discord/CLI)]
        |
        v
[OpenClaw Agent]
        |
        v
[A+ Skill (로컬 엔진)]
   |         |            |
   |         |            +--> [Policy Engine]
   |         |                  - strict / balanced / fast
   |         |
   |         +--> [Security Gate]
   |                - 메타 보안 신호(ClawHub scan)
   |                - 룰 기반 검사(위험 명령/권한/외부통신)
   |                - 위험도 점수 + 상태(추천/주의/보류/차단)
   |
   +--> [Recommender Engine]
            - 사용자 프로필 매칭
            - 인기/성장/안정성 점수
            - 설명 가능한 추천 사유 생성
            |
            v
      [Ranked Results]
            |
            +--> 설치 전 검토 화면/메시지
            +--> 주간 리포트(Discord/Telegram)

(선택) [Trend Cache API]
- 클라우드에 공개 메타만 캐시
- 로컬 엔진이 주기 동기화
```

---

## 2) 통합 포인트 설계

### A. 설치 플로우 통합 (핵심)
- 트리거: 사용자가 “스킬 추천/설치” 요청
- 흐름:
  1. 후보 수집
  2. 추천 점수 계산
  3. 보안 점수 계산
  4. 정책 적용(strict/balanced/fast)
  5. 최종 액션 제안(설치/보류/차단)

### B. 운영 리포트 통합
- 주기: 주 1회(기본)
- 채널: Discord DM(기본), 필요 시 Telegram
- 내용:
  - 급상승 스킬 TOP N
  - 내 프로필 맞춤 추천 TOP N
  - 위험 스킬/주의 업데이트

### C. 사용자 프로필 통합
- 프로필 예시: 개발형 / 업무자동화형 / 개인비서형
- 정책 예시: strict / balanced / fast

---

## 3) 폴더 구조 (MVP)

```text
a-plus-skill/
├── SKILL.md
├── package.json
├── src/
│   ├── index.ts                 # 엔트리
│   ├── collector/
│   │   └── clawhubClient.ts     # ClawHub 메타 수집
│   ├── recommender/
│   │   ├── scoring.ts           # 추천 점수 계산
│   │   └── explain.ts           # 추천 사유 생성
│   ├── security/
│   │   ├── rules.ts             # 룰 기반 검사
│   │   ├── scanAdapter.ts       # 스캔 결과 해석
│   │   └── riskScoring.ts       # 보안 점수 계산
│   ├── policy/
│   │   └── policyEngine.ts      # strict/balanced/fast
│   ├── report/
│   │   └── weeklyReport.ts      # 주간 리포트 생성
│   └── types/
│       └── index.ts
├── config/
│   ├── policy.default.json
│   └── profile.default.json
├── data/
│   └── cache.json               # 로컬 캐시(옵션)
├── tests/
│   ├── scoring.test.ts
│   ├── security.test.ts
│   └── policy.test.ts
└── README.md
```

---

## 4) 데이터 스키마 (초안)

### skill_meta
- `slug`: string
- `name`: string
- `author`: string
- `downloads`: number
- `installs_current`: number
- `stars`: number
- `versions`: number
- `summary`: string
- `security_scan_status`: `benign | suspicious | unknown`
- `security_confidence`: `low | medium | high`
- `updated_at`: datetime

### recommendation_result
- `slug`: string
- `fit_score`: number (0~100)
- `trend_score`: number (0~100)
- `stability_score`: number (0~100)
- `security_score`: number (0~100)
- `final_score`: number (0~100)
- `decision`: `recommend | caution | hold | block`
- `reasons`: string[]

---

## 5) 점수 모델 (MVP 버전)

- `final_score = 0.35*fit + 0.20*trend + 0.15*stability + 0.30*security`
- 기본 임계값:
  - `recommend`: final >= 75 && security >= 70
  - `caution`: final >= 60 && security >= 55
  - `hold`: final >= 45 || security >= 40
  - `block`: security < 40

> 정책별 조정
- strict: security 가중치 +10%, 차단 기준 상향
- balanced: 기본
- fast: trend/fit 가중치 상향, 차단 기준 완화

---

## 6) 첫 배포 체크리스트 (MVP)

### 개발 준비
- [ ] Node 22+ 환경 확인
- [ ] OpenClaw 로컬 실행 확인
- [ ] 프로젝트 스캐폴딩 완료

### 데이터/추천
- [ ] ClawHub 메타 수집기 구현
- [ ] 추천 점수 계산기 구현
- [ ] 추천 사유(설명문) 생성기 구현

### 보안 게이트
- [ ] 메타 보안 신호 반영
- [ ] 룰 기반 검사(위험 명령 패턴) 구현
- [ ] 보안 점수 계산 + 상태 결정

### 정책/통합
- [ ] 정책 엔진(strict/balanced/fast) 구현
- [ ] OpenClaw 설치 플로우 연동
- [ ] 결과 포맷(추천/주의/보류/차단) 메시지화

### 리포트
- [ ] 주간 리포트 템플릿 구현
- [ ] Discord DM 전송 테스트

### 테스트/배포
- [ ] 단위 테스트(스코어/보안/정책)
- [ ] 샘플 데이터로 E2E 시뮬레이션
- [ ] SKILL.md/README 정리
- [ ] ClawHub 업로드 패키지 생성

---

## 7) MVP 산출물 정의

1. `A+ Skill` 설치 가능 패키지 1개  
2. 추천 + 보안 통합 결과 메시지 포맷  
3. 주간 리포트 자동 생성/전송  
4. 기본 정책 3종(strict/balanced/fast)

---

## 8) 확장 로드맵 (다음 단계)

- v1.1: 급상승 탐지(시간대별 증가율)
- v1.2: 사용자 피드백 반영(추천 정밀도 개선)
- v1.3: 설치 후 안정성 추적(실패율/롤백 제안)
- v2.0: 클라우드 캐시 API + 팀 대시보드
