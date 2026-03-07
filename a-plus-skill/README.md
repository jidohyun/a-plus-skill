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
- [x] Discord DM 실제 전송 연동(분할/재시도/실패 로그)

## 폴더
- `src/collector`: 후보 스킬 수집
- `src/recommender`: 점수 계산/설명
- `src/security`: 보안 규칙/점수화
- `src/policy`: 설치 정책 결정
- `src/report`: 주간 리포트 생성
- `src/delivery`: 리포트 전송(Discord DM / Telegram)

## 실행
```bash
npm ci --include=dev
npm run dev
```

> preflight가 devDependencies(typescript/vitest/tsx) 누락 시 즉시 실패시킵니다.

## 리포트 전송 설정 (Discord DM / Telegram)
- `REPORT_DELIVERY`: `none | discord-dm | telegram` (기본 `none`)
- `REPORT_DELIVERY_LOCKED` (선택): `discord-dm` 또는 `telegram`으로 고정. 잠금값과 다르면 전송을 스킵하며 reason=`lock_mismatch`로 기록합니다.
- `REPORT_DELIVERY_FAIL_HARD` (선택, 기본 `true`): 전송 실패 시 프로세스를 실패(exit != 0)로 처리
- `REPORT_DELIVERY_INLINE_ROTATE` (선택, 기본 `false`): 인프로세스 로그 로테이션 사용 여부. 기본은 **append-only**이며, 운영 환경에서는 외부 `logrotate`/시스템 로거 위임을 권장합니다.
- `REPORT_DELIVERY_LOG_MAX_BYTES` (선택, 기본 `1048576`): `REPORT_DELIVERY_INLINE_ROTATE=true`일 때만 적용되는 인프로세스 로테이션 임계치
- Discord DM
  - `DISCORD_BOT_TOKEN`: Discord Bot 토큰 (`Bot <token>` 인증에 사용)
  - `DISCORD_DM_USER_ID`: DM 수신 대상 Discord user id
- Telegram
  - `TELEGRAM_BOT_TOKEN`: Telegram Bot 토큰
  - `TELEGRAM_CHAT_ID`: 수신 대상 chat id (개인/그룹/채널)

`REPORT_DELIVERY=none`이면 전송을 스킵하고 기존 콘솔 출력만 수행합니다.

## 리포트 실행
```bash
# 기본(콘솔 출력 + 전송 off)
npm run report:send

# Discord DM 전송 (.env 또는 안전한 secret 주입 권장)
REPORT_DELIVERY=discord-dm npm run report:send

# Telegram 전송 (.env 또는 안전한 secret 주입 권장)
REPORT_DELIVERY=telegram npm run report:send
```

> 보안 주의: 토큰을 커맨드라인 인라인으로 넣지 마세요. shell history/process list에 남을 수 있습니다.
> Telegram은 Bot API 제한(429)을 반환할 수 있으며, 본 구현은 `retry_after`를 파싱해 chunk 전송 재시도 지연(ms)으로 매핑합니다.
> Telegram Bot API 특성상 토큰이 요청 URL 경로에 포함되므로, 프록시/APM/access log에 URL 원문을 남기지 않도록 운영 설정을 권장합니다.

## cron 예시
```cron
# 매주 월요일 09:00 UTC (환경변수는 별도 envfile/systemd/secret store에서 주입)
0 9 * * 1 cd /home/node/.openclaw/workspace/a-plus-skill && REPORT_DELIVERY=discord-dm npm run report:send

# Telegram 전송 버전
0 9 * * 1 cd /home/node/.openclaw/workspace/a-plus-skill && REPORT_DELIVERY=telegram npm run report:send
```

## 전송 실패 로그
- 기본 경로: `data/report-delivery.log` (기본 정책: append-only)
- 권장 운영: 외부 `logrotate` 또는 시스템 로거(journald 등)로 순환 관리
- 선택적 인프로세스 로테이션(비기본): `REPORT_DELIVERY_INLINE_ROTATE=true`일 때만 `data/report-delivery.log.1` 사용
- 기록 내용: event/chunk 번호/시도 횟수/code/status (lock_mismatch는 `expected`/`actual` 포함)
- 주요 reason
  - `lock_mismatch`: `REPORT_DELIVERY`가 `REPORT_DELIVERY_LOCKED`와 불일치
  - `unsupported REPORT_DELIVERY mode`: 지원하지 않는 전송 모드
- 재시도: chunk별 최대 3회 (지수 백오프)

실패 요약 확인:
```bash
# 최근 24시간(기본)
npm run delivery:failures

# 최근 6시간
npm run delivery:failures -- --hours 6
```

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
- degraded 상태에서는 추천 결정을 보수적으로 `hold`로 강제하고, 설치는 정책/override와 무관하게 hard-block(`skip-install`)합니다.
- 현재는 공개 페이지 기반 경량 파싱이라, 비공개 지표나 정밀한 랭킹 정보는 반영하지 않습니다.

## 설치 플로우 정책(신규)
- decision(`recommend/caution/hold/block`)을 install action으로 변환합니다.
- 수집 degraded(`meta.degraded=true`)이면 `effectiveDecision=hold`로 강제하고 설치는 항상 `skip-install` 처리합니다(override 불가).
- 정책별 우회 규칙:
  - `strict`: hold는 **강한** `INSTALL_OVERRIDE_TOKEN`(20자+) + `INSTALL_OVERRIDE_REASON` + `INSTALL_CONFIRM=true` 필요, block은 우회 불가
  - `balanced`: hold는 strong token+reason+confirm 필요, block은 strong token 2개(`INSTALL_OVERRIDE_TOKEN`, `INSTALL_OVERRIDE_STRONG_TOKEN`) + reason + confirm 필요
  - `fast`: hold/block 모두 strong token(20자+) + reason + confirm 필요
- 기본값은 안전 모드: 확인/우회가 없으면 hold/block 설치는 실행되지 않습니다.
- degraded 상태에서는 정책과 무관하게 설치는 항상 `skip-install`입니다.

### 설치 관련 환경변수
- `INSTALL_POLICY`: `strict | balanced | fast` (기본 `balanced`)
- `INSTALL_CONFIRM`: `true/1/yes`일 때만 확인 완료로 간주
- `INSTALL_OVERRIDE_TOKEN`: hold/block 우회 토큰
- `INSTALL_OVERRIDE_STRONG_TOKEN`: balanced block 우회용 추가 토큰
- `INSTALL_OVERRIDE_REASON`: balanced block 우회 사유
- `OPENCLAW_INSTALL_COMMAND`: 설치 커맨드 베이스 (기본 `openclaw skill install`)
  - 보안상 첫 토큰은 `openclaw`만 허용되며, 서브커맨드는 반드시 `skill install`로 시작해야 합니다.

## 산출 예시
- top 추천 리스트 + 보안 상태(`recommend/caution/hold/block`)
- install action(`auto-install/override-install/confirm-install/skip-install`)
- 구조화된 설치 실행 결과(`installed/skipped/failed`)
- 주간 리포트 텍스트
