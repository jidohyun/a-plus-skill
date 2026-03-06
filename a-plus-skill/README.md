# A+ Skill (Skill Radar with Security Gate)

OpenClaw 스킬 추천에 보안 심사를 기본 결합한 로컬 우선 MVP입니다.

## 현재 구현 범위
- [x] 프로젝트 스캐폴딩
- [x] 추천 점수 계산기 (`fit/trend/stability/security`)
- [x] 정책 엔진 (`strict/balanced/fast`)
- [x] 보안 점수 계산 (스캔 신호 + 룰 기반 위험 패턴)
- [x] 추천 사유 생성기
- [x] 주간 리포트 문자열 렌더러
- [x] 기본 테스트 파일 + collector 테스트
- [x] ClawHub 실데이터 수집기(공개 skills 페이지 HTML 파싱)
- [x] OpenClaw 설치 플로우 실연동 (decision→install action + policy override + outcome 수집)
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

## 실데이터 수집 동작
- `src/collector/clawhubClient.ts`는 기본적으로 `https://clawhub.ai/skills?nonSuspicious=true`를 조회합니다.
- 필요 시 `CLAWHUB_BASE_URL` 환경변수로 수집 URL을 바꿀 수 있으며, 허용 호스트 allowlist(`clawhub.ai`, `clawhub.org`)를 벗어나면 기본 URL로 되돌립니다.
- 페이지 내 `<script>` JSON(예: `__NEXT_DATA__`)에서 스킬 메타데이터를 찾아 `SkillMeta[]`로 정규화합니다.
- 수집된 데이터는 그대로 추천 점수 계산과 주간 리포트 출력에 사용됩니다.

## 한계 및 fallback
- ClawHub 공개 페이지 구조가 바뀌면 파싱 정확도가 떨어질 수 있습니다.
- 네트워크 실패/응답 오류/파싱 실패(또는 품질 임계치 미달) 시 mock 데이터로 fallback 합니다.
- fallback 시 메타데이터(`source`, `degraded`, `fallbackReason`, `fetchedAt`)를 함께 반환해 조용한 실패를 방지합니다.
- degraded 상태에서는 추천 결정을 보수적으로 `hold`로 강제합니다.
- 현재는 공개 페이지 기반 경량 파싱이라, 비공개 지표나 정밀한 랭킹 정보는 반영하지 않습니다.

## 설치 플로우 정책(신규)
- decision(`recommend/caution/hold/block`)을 install action으로 변환합니다.
- 수집 degraded(`meta.degraded=true`)이면 `effectiveDecision=hold`로 강제합니다.
- 정책별 우회 규칙:
  - `strict`: hold는 `INSTALL_OVERRIDE_TOKEN` + `INSTALL_CONFIRM=true` 필요, block은 우회 불가
  - `balanced`: hold는 override 가능, block은 `INSTALL_OVERRIDE_TOKEN` + `INSTALL_OVERRIDE_STRONG_TOKEN` + `INSTALL_OVERRIDE_REASON` + `INSTALL_CONFIRM=true` 필요
  - `fast`: hold/block 모두 `INSTALL_OVERRIDE_TOKEN` + `INSTALL_CONFIRM=true`로 허용
- 기본값은 안전 모드: 확인/우회가 없으면 hold/block 설치는 실행되지 않습니다.

### 설치 관련 환경변수
- `INSTALL_POLICY`: `strict | balanced | fast` (기본 `balanced`)
- `INSTALL_CONFIRM`: `true/1/yes`일 때만 확인 완료로 간주
- `INSTALL_OVERRIDE_TOKEN`: hold/block 우회 토큰
- `INSTALL_OVERRIDE_STRONG_TOKEN`: balanced block 우회용 추가 토큰
- `INSTALL_OVERRIDE_REASON`: balanced block 우회 사유
- `OPENCLAW_INSTALL_COMMAND`: 실제 설치 커맨드 베이스 (기본 `openclaw skill install`)

## 산출 예시
- top 추천 리스트 + 보안 상태(`recommend/caution/hold/block`)
- install action(`auto-install/override-install/confirm-install/skip-install`)
- 구조화된 설치 실행 결과(`installed/skipped/failed`)
- 주간 리포트 텍스트
