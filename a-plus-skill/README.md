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

## 빠른 시작 (처음 보는 사람용)
```bash
# 1) 의존성 설치
npm ci --include=dev

# 2) 현재 운영 상태 한 번에 확인
npm run maintenance:status

# 3) 추천 리포트 생성(기본: 콘솔 출력)
npm run report:send

# 4) 설치 감사 무결성 확인
npm run audit:verify

# 5) 최근 설치 결과 요약 확인
npm run install:summary
```

추천 운영 루틴:
- daily/수시 점검: `npm run maintenance:status`
- weekly 리포트 확인: `npm run report:send`
- 설치/정책 동작 확인: `npm run install:summary`
- 감사 체인 검증: `npm run audit:verify`

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

리포트 형식 예시:
```text
📊 A+ 주간 추천 리포트
source=live degraded=false fallbackReason=NONE fetchedAt=2026-03-30T00:00:00.000Z
decisions recommend=2 caution=1 hold=1 block=1
takeaway mixed recommendation profile; review item-level explanations before acting

1. demo/weather | score 82.5 | security 90 | recommend | action auto-install | recommended because both score and security cleared the top thresholds | topSignals security=90.0, trend=82.0 | why trusted author; strong security score
2. demo/agent | score 61.0 | security 58 | caution | cautioned because the item cleared caution thresholds but not the recommendation bar | topSignals trend=66.0, stability=61.0 | why active installs growing; score near caution threshold
```
- 헤더의 `decisions ...` 줄은 전체 추천 분포를 보여줍니다.
- `takeaway ...` 줄은 이번 배치의 전체 총평입니다.
- 각 항목의 decision 설명은 score/security threshold 관점으로 서술됩니다.
- `topSignals ...`는 fit/trend/stability/security 중 상위 2개 축을 보여줍니다.
- `why ...`는 `reasons[]` 중 상위 2개를 요약한 것입니다.
- `why` 문구는 `매우 강함 / 긍정적 / 약함 / 상위 추천 기준 미달 / 보안 게이트 미달` 같은 구간형 표현을 사용합니다.
- reason 목록은 보안 게이트/threshold 기반 이유를 앞에 두도록 우선순위 정렬됩니다.
- `fallbackReason`이 `NONE`이 아니면 collector가 fallback 경로였다는 뜻입니다.

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
  - 성공 시: `event=delivery_success mode=... chunk=.../... attempt=.../...`
  - 실패 시(기존 호환): `event=delivery_failed ...`
- collector 컨텍스트가 있으면 아래 필드도 함께 기록됩니다.
  - `collector_source=live|fallback`
  - `collector_degraded=true|false`
  - `collector_reason=NONE|<fallbackReason>`
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
- 요약 출력에는 `by collector source`, `by collector reason`이 포함되어 live/fallback 맥락까지 함께 집계됩니다.

## 테스트
```bash
npm run test
npm run typecheck
npm run build
```

## 추천 점수 보정 점검
```bash
npm run scoring:calibration

# 자동화/후처리용 JSON 출력
npm run scoring:calibration -- --json
```
- 현재 collector 결과를 기준으로 fit/trend/stability/security/final 분포를 보여줍니다.
- `decision_counts`를 함께 출력해 recommend/caution/hold/block 쏠림을 빠르게 확인할 수 있습니다.
- fallback/저샘플 상황에서는 `sample_quality=limited`와 보수적 해석 note가 함께 출력됩니다.
- 최근 보정에서는 `trend`가 과거 download bulk보다 `installsCurrent`(현재 활성도)를 더 반영하도록 가중치를 조정했습니다.
- profile fallback 시에도 완전히 평평한 fit 점수가 나오지 않도록 safe default profile을 강화했습니다.

## collector 상태 확인
```bash
npm run collector:status
# 예시 출력: collector_status mode=live degraded=false reason=NONE threshold=3 skillCount=12 fetchTimeoutMs=10000 fetchedAt=2026-03-07T05:30:00.000Z

# fallback이면 실패 코드로 보고 싶을 때
npm run collector:status -- --strict

# 자동화/후처리용 JSON 출력
npm run collector:status -- --json
```
- `mode=live`면 `reason=NONE`, `degraded=false`
- `mode=fallback`면 `reason`에 `fallbackReason` 코드가 출력됩니다.
- `skillCount`는 현재 collector가 반환한 skill 개수입니다.
- `fetchTimeoutMs`는 현재 적용 중인 ClawHub fetch timeout입니다.
- `--strict`(또는 `COLLECTOR_STATUS_STRICT=true`)이면 fallback일 때 exit code `2`로 종료합니다.
- `--json`은 `mode/degraded/reason/threshold/skillCount/fetchTimeoutMs/fetchedAt` 구조로 출력합니다.

## 실데이터 수집 동작
- `src/collector/clawhubClient.ts`는 기본적으로 `https://clawhub.ai/skills?nonSuspicious=true`를 조회합니다.
- 필요 시 `CLAWHUB_BASE_URL` 환경변수로 수집 URL을 바꿀 수 있으며, 아래 조건을 만족하지 않으면 기본 URL로 되돌립니다.
  - `https` 프로토콜
  - 허용 호스트 allowlist(`clawhub.ai`, `clawhub.org`)
  - 경로가 `/skills` 계열
- `MIN_PARSED_SKILLS`(기본 `3`)로 최소 파싱 스킬 수 임계치를 조정할 수 있습니다.
  - 정수 `1` 이상만 유효하며, 잘못된 값은 기본값(`3`)으로 자동 fallback 됩니다.
  - 내부 상한: `50` (과도 설정 방지)
  - 권장 범위: `1~10` (너무 낮으면 품질 저하, 너무 높으면 fallback 빈도 증가)
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
  - `strict`: hold는 **유효한 override token** + `INSTALL_OVERRIDE_REASON` + `INSTALL_CONFIRM=true` 필요, block은 우회 불가
  - `balanced`: hold는 valid token+reason+confirm 필요, block은 valid token 2개(`INSTALL_OVERRIDE_TOKEN`, `INSTALL_OVERRIDE_STRONG_TOKEN`) + reason + confirm 필요
  - `fast`: hold/block 모두 valid token + reason + confirm 필요
- note 가이던스(설치가 왜 막혔는지 설명):
  - confirmation만 빠졌으면 `... override pending: confirmation missing`
  - reason이 비었거나 너무 짧으면 `... override pending: reason missing or too short`
  - balanced block에서 토큰 조건이 부족하면
    - `... primary override token missing or invalid`
    - `... strong override token missing or invalid`
  - identical token 사용 시 `balanced policy: override tokens must be distinct`
  - nonce 재사용이면 `... rejected: nonce replay ...`
- 토폴로지 가드레일:
  - `INSTALL_TOPOLOGY` 지원값: `local-dev | single-instance | multi-instance` (기본 `single-instance`)
  - `INSTALL_TOPOLOGY=multi-instance`에서는 startup 시 보안 posture를 강제 검증(fail-fast)
  - `multi-instance`에서 `INSTALL_POLICY=fast`는 **허용되지 않음**(보안 우선 fail-fast)
- 기본값은 안전 모드: 확인/우회가 없으면 hold/block 설치는 실행되지 않습니다.
- degraded 상태에서는 정책과 무관하게 설치는 항상 `skip-install`입니다.

### 설치 관련 환경변수
- `INSTALL_POLICY`: `strict | balanced | fast` (기본 `balanced`)
- `INSTALL_TOPOLOGY`: `local-dev | single-instance | multi-instance` (기본 `single-instance`)
- `INSTALL_CONFIRM`: `true/1/yes`일 때만 확인 완료로 간주
- `INSTALL_OVERRIDE_TOKEN`: hold/block 우회 토큰
- `INSTALL_OVERRIDE_STRONG_TOKEN`: balanced block 우회용 추가 토큰
- `INSTALL_OVERRIDE_REASON`: balanced block 우회 사유
- `INSTALL_OVERRIDE_MAX_TTL_SEC`: override token 최대 TTL(초), 기본 `900` (hard cap `900`)
- `INSTALL_OVERRIDE_CLOCK_SKEW_SEC`: clock skew 허용 오차(초), 기본 `60` (hard cap `120`)
- `INSTALL_OVERRIDE_SIGNING_SECRET`: override token 서명 검증용 HMAC secret (**서명 토큰 사용 시 필수**)
- `INSTALL_OVERRIDE_NONCE_STORE`: nonce replay 방지 저장소 모드 `memory | file` (기본 `memory`)
- `INSTALL_OVERRIDE_NONCE_DIR`: `INSTALL_OVERRIDE_NONCE_STORE=file`일 때 nonce 파일 경로 (기본 `./data/override-nonces`)
- startup fail-fast 보안 검증:
  - `INSTALL_TOPOLOGY=multi-instance`면 `INSTALL_OVERRIDE_NONCE_STORE=file` **강제**
  - `INSTALL_TOPOLOGY=multi-instance`면 `INSTALL_OVERRIDE_NONCE_DIR`가 유효/쓰기 가능해야 함
  - `INSTALL_TOPOLOGY=multi-instance` + `INSTALL_POLICY=fast`는 즉시 실패

#### multi-instance 운영 체크리스트
- 모든 인스턴스에서 `INSTALL_TOPOLOGY=multi-instance` 설정
- 모든 인스턴스에서 `INSTALL_OVERRIDE_NONCE_STORE=file` 설정
- 모든 인스턴스가 **동일한 공유 nonce 디렉터리**(`INSTALL_OVERRIDE_NONCE_DIR`)를 읽기/쓰기 가능하게 마운트
- 앱 시작 시 fail-fast가 발생하면 install 루프 전에 설정/권한 문제를 먼저 해소

- `OPENCLAW_INSTALL_COMMAND`: 설치 커맨드 베이스 (기본 `openclaw skill install`)
  - 보안상 첫 토큰은 `openclaw`만 허용되며, 서브커맨드는 반드시 `skill install`로 시작해야 합니다.
- `INSTALL_COMMAND_TIMEOUT_MS`: 개별 `openclaw skill install` 실행 타임아웃(ms)
  - 기본값: `60000` (60초)
  - 비정상 입력(빈값/NaN/0 이하)은 기본값으로 fallback
  - 내부 범위: 최소 `1000` + 토폴로지별 hard cap으로 클램프
    - `INSTALL_TOPOLOGY=local-dev`: 최대 `300000`
    - `INSTALL_TOPOLOGY=single-instance`: 최대 `120000`
    - `INSTALL_TOPOLOGY=multi-instance`: 최대 `90000`
  - 타임아웃 시 종료 순서(가능한 플랫폼/POSIX 우선):
    1) detached process group에 `SIGTERM` (`process.kill(-pid, SIGTERM)`)
    2) grace 후 미종료 시 `SIGKILL` (`process.kill(-pid, SIGKILL)`)
    3) 그룹 signal 실패 시 `child.kill(...)` fallback
  - 결과는 항상 `failed(timeout)`으로 표준화됩니다.
- `INSTALL_TIMEOUT_RECOVERY_DELAY_MS`: timeout/SIGKILL 직후 다음 항목 처리 전 회복 지연(ms)
  - 기본값: `250`
  - `0~2000` 범위로 클램프 (0이면 지연 비활성)
- `INSTALL_AUDIT_LOG_PATH`: 설치 감사 이벤트 JSONL 경로(선택)
  - 기본값: `data/install-events.jsonl`
  - append-only로 기록되며, 디렉터리가 없으면 자동 생성
- `INSTALL_AUDIT_STALE_LOCK_MS`: 감사 로그 `.lock` stale 판정 기준(ms)
  - 기본값: `60000`
  - `30000~120000` 범위로 클램프
  - stale lock 감지 시 자동으로 lock 파일을 제거하고 즉시 재시도

#### 설치 감사 로그(JSONL)
- 기본 파일: `data/install-events.jsonl`
- 형식: 한 줄당 1개 JSON 이벤트(기계 판독 가능)
- 기록 시점: 각 skill 설치 시도 종료 시점(단일 통합 이벤트: decision+plan+outcome)
- 포함 필드(요약):
  - 무결성 필드: `schemaVersion`, `eventId`, `prevHash`, `hash`
  - 기본 필드: `ts`, `slug`, `policy`, `topology`
  - 결정/실행 필드: `originalDecision`, `effectiveDecision`, `action`, `canInstall`, `status`
  - 오류/성능 필드: `errorCode`, `timeoutMs`, `elapsedMs`
  - 상태 필드: `degraded`, `notes[]`
- `notes[]`에는 왜 설치가 막혔는지/허용됐는지가 들어갑니다. 예:
  - `hold override pending: confirmation missing`
  - `hold override pending: reason missing or too short`
  - `balanced policy: block override pending: strong override token missing or invalid`
  - `balanced policy: override tokens must be distinct`
- `prevHash`는 직전 이벤트의 `hash`와 연결됩니다(첫 이벤트는 `genesis`).
- `hash`는 canonical payload 기준 `SHA-256`으로 계산되어 변조/누락 사후 검증에 사용됩니다.
- 이벤트는 `skip-install/confirm-install/auto-install/override-install` 모두 기록됩니다.
- 로그 쓰기 실패는 설치 플로우를 중단하지 않고 경고만 남깁니다.
- 보안: note/error의 `token/secret` 및 `ovr1...` override token 패턴은 마스킹되어 기록됩니다.

예시:
```json
{"schemaVersion":1,"eventId":"b7b4a276-1efe-498f-b9fa-d91d9323120e","ts":"2026-03-07T12:00:00.000Z","slug":"acme/tool","policy":"strict","topology":"single-instance","originalDecision":"hold","effectiveDecision":"hold","action":"confirm-install","canInstall":false,"status":"skipped","degraded":false,"notes":["hold override pending: confirmation missing","strict policy: hold requires strong override token + reason + confirmation"],"prevHash":"genesis","hash":"f56d..."}
```

balanced block에서 strong token이 빠진 경우 예:
```json
{"schemaVersion":1,"eventId":"e15b8f62-7f5a-45fd-9c35-90db76e2bb56","ts":"2026-03-07T12:05:00.000Z","slug":"acme/tool","policy":"balanced","topology":"single-instance","originalDecision":"block","effectiveDecision":"block","action":"confirm-install","canInstall":false,"status":"skipped","degraded":false,"notes":["balanced policy: block override pending: strong override token missing or invalid","balanced policy: block needs strong override token + strong override token + reason + confirmation"],"prevHash":"f56d...","hash":"9ad1..."}
```

#### 감사 로그 무결성 검증
```bash
# 기본 경로(data/install-events.jsonl) 검증
npm run audit:verify

# 사용자 지정 로그 경로 검증
INSTALL_AUDIT_LOG_PATH=./data/install-events.jsonl npm run audit:verify
```

#### 설치 결과 요약
```bash
# 최근 24시간 설치 결과 요약
npm run install:summary

# 최근 6시간 설치 결과 요약
npm run install:summary -- --hours 6

# 자동화/후처리용 JSON 출력
npm run install:summary -- --json
```
- action/status/error/note 빈도를 집계합니다.
- 최근 3개 install audit 이벤트를 함께 보여줍니다.
- `--json`은 summary/counters/recent_events 구조로 출력됩니다.

#### 운영 상태 점검 (`ops:status`)
```bash
# 운영 상태 단일 라인 점검 (key=value)
npm run ops:status

# 유지보수용 묶음 점검(ops gate + collector + fast-cap + delivery summary)
# 첫 줄 예시: maintenance_status overall=healthy severity=info issue_count=0 ops_gate_code=0 collector_mode=live fast_cap_reason="not_initialized" delivery_failures=0 primary_issue="none" recommended_action="none"
npm run maintenance:status

# 자동화/cron용 JSON 출력
npm run maintenance:status -- --json

# fast-cap state/key 일관성 원인 점검
# - 정상 일관성 또는 미초기화(not_initialized): exit 0
# - 비정상/조사 필요: exit 2
npm run fast-cap:inspect

# strict 모드(기본 unhealthy): overall=unhealthy일 때만 exit 2
npm run ops:status -- --strict

# 운영 기본 권장 게이트 (nonhealthy): overall=degraded|unhealthy면 exit 2
npm run ops:status:gate

# 확장 strict 모드: overall=degraded|unhealthy면 exit 2
npm run ops:status -- --strict=nonhealthy

# 하위 호환 명시 모드: unhealthy일 때만 exit 2
npm run ops:status -- --strict=unhealthy
```

출력 필드:
- `policy`
- `audit_ok`, `audit_reason`, `audit_line`
- `strict_failures`, `strict_state_fault`
- `fast_cap_count`, `fast_cap_cap`, `fast_cap_tampered`, `fast_cap_reason`
- `delivery_health` (`healthy|degraded|unhealthy|disabled`)
- `delivery_last_success_age_sec` (최근 success 이벤트 경과 초, 없으면 `-1`)
- `delivery_failures`, `delivery_successes`
- `critical_flags_present` (`true|false`)
- `critical_flags` (comma-separated: `fast_cap_tampered`, `strict_state_fault`, `audit_failed`)
- `overall` (`healthy|degraded|unhealthy`)

판단 규칙:
- delivery 집계 소스: `data/report-delivery.log` + 회전 파일(`data/report-delivery.log.*`)
- `REPORT_DELIVERY=none`이면 `delivery_health=disabled`이며 overall에 영향 없음
- delivery 활성화 상태에서 최근 success 없음/성공 신호 stale면
  - `strict`: `overall=unhealthy`
  - `balanced`, `fast`: `overall=degraded`
- 로그 파싱 오류/로그 읽기 문제는 보수적으로 최소 `degraded` 처리
- `strict`: audit 실패 또는 strict state fault 또는 `fast_cap_tampered=true`면 `unhealthy`
- `balanced`: audit 실패/strict state fault/strict failures/`fast_cap_tampered=true`면 `degraded`
- `fast`: audit 실패는 허용 가능, 단 `fast_cap_tampered=true` 또는 cap 초과면 `unhealthy`

운영 팁:
- delivery stale 임계치 기본값은 `8일`이며, `OPS_DELIVERY_SUCCESS_STALE_SEC`로 조정할 수 있습니다.
- `fast_cap_tampered=true`는 운영자가 fast-cap state/key 쌍을 신뢰할 수 없다는 뜻입니다. partial delete(한쪽만 삭제)는 의도적으로 tamper로 간주합니다.
- fast-cap 복구 시에는 `data/fast-audit-fail-cap.json` 또는 `.key` 한쪽만 지우지 말고, 원인 확인 후 **둘 다 함께 초기화**하거나 그대로 보존해 조사하세요.
- 상세 운영 절차는 `docs/fast-cap-runbook.md`를 참고하세요.

문제 생겼을 때 추천 순서:
1. `npm run maintenance:status`
2. summary의 `primary_issue` / `recommended_action` 확인
3. 필요 시 세부 확인
   - collector: `npm run collector:status -- --strict`
   - fast-cap: `npm run fast-cap:inspect`
   - delivery: `npm run delivery:failures -- --hours 24`
   - install/audit: `npm run install:summary` / `npm run audit:verify`

`--strict` 종료 규약:
- 유효 strict mode: `unhealthy | nonhealthy`
- `--strict`(기본 `unhealthy`): `overall=unhealthy`일 때만 exit `2`
- `--strict=nonhealthy`: `overall=degraded|unhealthy`면 exit `2`
- `--strict=unhealthy`: `overall=unhealthy`일 때만 exit `2`
- invalid mode(`--strict=<...>`)는 fallback 없이 즉시 stderr 오류 출력 후 exit `2`

- 성공: `OK verified=<count> lastHash=<hash> path=...` 출력, exit code `0`
- 실패: `ERROR line=<line> reason=<이유> path=...` 출력, exit code `!= 0`
- Bootstrap/anchor/marker/fuse/latch 동작:
  - 최초 1회(감사 로그 파일 + `.anchor` + `.bootstrapped` + `.bootstrap-fuse` + `.bootstrap-latch` 모두 없음)만 bootstrap 성공으로 허용됩니다.
  - 감사 로그 append 성공 직후 `${auditPath}.anchor`, `${auditPath}.bootstrapped`, `${auditPath}.bootstrap-fuse`, `${auditPath}.bootstrap-latch`가 생성됩니다.
  - `.bootstrap-latch`만 남고 audit/anchor/marker/fuse가 동시에 사라진 상태도 `bootstrap re-entry blocked`로 무결성 실패 처리됩니다.
  - 이후 로그 파일이 ENOENT여도 anchor가 있으면 무결성 실패로 처리되어 strict 우회가 불가합니다.
- 런타임 설치 경로 연동 게이트(설치 루프 시작 전 자동 검증):
  - `strict`: 무결성 실패 시 즉시 fail-fast (설치 중단) + `data/install-ops-events.jsonl`에 `action=abort` 기록
    - primary/fallback ops evidence 기록이 모두 실패하면 strict gate throw는 유지
    - strict evidence fail-state(`data/strict-evidence-fail-state.json`)는 lock + temp->rename 원자 갱신으로 관리됩니다.
    - `STRICT_EVIDENCE_FAIL_OPEN_MAX`(기본 `2`, clamp `1..5`)의 1..N 구간은 경고(`evidence-write-failed`)만 남기고 strict throw를 유지하며, N+1부터는 `ops_evidence_write_failed`로 fail-closed 강화됩니다.
    - state file read(parse/권한/IO) fault는 0으로 복구하지 않고 즉시 fail-closed로 승격되며, 에러에 `strict_evidence_state_fault=<...>`가 포함됩니다.
  - `balanced`: 설치 action을 `skip-install`로 강등하고 `notes`에 사유(line/reason) 기록 + ops event(`action=demote`) 기록
    - primary 실패 시 fallback 기록 시도, 둘 다 실패하면 경고 로그 강화
  - `fast`: 경고만 기록하고 설치 계속 진행 (`notes`에 `audit_integrity=failed` 포함)
    - 단, 무결성 실패 상태의 설치 시도는 `FAST_AUDIT_FAIL_MAX_INSTALLS`(기본 `3`, clamp `1..20`)로 상한 적용. 초과분은 `skip-install`로 강등
- 가시성:
  - install audit event `notes`: `audit_integrity=ok|failed`, 실패 시 `audit_integrity_reason`, `audit_integrity_line`
  - ops event 로그(primary): `data/install-ops-events.jsonl`
  - ops event 로그(fallback): `data/install-ops-events.fallback.jsonl` (primary append 실패 시 best-effort)
  - fast cap 상태 파일: `data/fast-audit-fail-cap.json` (`schemaVersion/count/updatedAt/checksum`, lock + temp->rename 원자 갱신)
  - fast cap 키 파일: `data/fast-audit-fail-cap.key` (로컬 checksum 키)
  - key 존재 + state 누락/삭제, parse 실패, checksum 불일치(위변조) 감지 시 fail-open 없이 즉시 demote 경로로 유도
  - strict evidence 실패 누적 상태: `data/strict-evidence-fail-state.json`
  - `hash mismatch`: 특정 라인 내용이 변조되었을 가능성
  - `prevHash mismatch`: 중간 라인 삭제/누락으로 체인이 단절되었을 가능성
  - `malformed JSON`: 파일 깨짐 또는 수동 편집 오류

실패 시 대응 가이드:
1. 즉시 현재 로그 파일을 백업합니다.
2. 최근 배포/운영 변경 이력과 파일 접근 이력을 확인합니다.
3. 신뢰 가능한 백업/원본에서 로그를 복구하거나, 손상 구간 이후 이벤트를 별도 보관 후 재수집합니다.
4. 필요 시 `INSTALL_AUDIT_LOG_PATH`를 새 파일로 전환하고, 장애 보고에 손상 line/reason을 포함합니다.

#### Override token 형식 (`ovr1`)
- 포맷: `ovr1.<iat>.<exp>.<nonce>.<sig>`
- `iat`, `exp`: 10자리 unix seconds
- `sig` 계산:
  - payload: ``${iat}.${exp}.${nonce}``
  - algorithm: `HMAC-SHA256` (`base64url`)
  - key: `INSTALL_OVERRIDE_SIGNING_SECRET`
- 검증 규칙:
  - `exp > iat`
  - `exp - iat <= INSTALL_OVERRIDE_MAX_TTL_SEC` (hard cap: `900`초)
  - 현재 시각(`now`)이 `[iat - INSTALL_OVERRIDE_CLOCK_SKEW_SEC, exp + INSTALL_OVERRIDE_CLOCK_SKEW_SEC]` 범위 내 (clock skew hard cap: `120`초)
  - `nonce`는 길이 `22` 이상, unique char `10` 이상, 단순 반복 패턴(예: `aaaa...`, `abcdabcd...`) 거부
  - 서명 불일치 또는 누락 시 거부
  - nonce replay 방지: 이미 사용된 nonce 재사용 거부(`memory` 또는 `file` store, exp 기반 GC). `file` 모드는 프로세스 재시작/다중 프로세스 경계에서도 재사용 차단
  - balanced의 block 우회는 `INSTALL_OVERRIDE_TOKEN`과 `INSTALL_OVERRIDE_STRONG_TOKEN`이 **서로 다른 토큰/nonce**여야 함
- 레거시(길이 기반) override 토큰 경로는 완전 제거되었습니다. 환경변수로도 재활성화할 수 없습니다.

## 산출 예시
- top 추천 리스트 + 보안 상태(`recommend/caution/hold/block`)
- install action(`auto-install/override-install/confirm-install/skip-install`)
- 구조화된 설치 실행 결과(`installed/skipped/failed`)
- 주간 리포트 텍스트
