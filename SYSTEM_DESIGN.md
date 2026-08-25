# 사과게임 (AppleGameMulti) 시스템 기획서

현재 구현 상태를 기준으로 정리한 시스템 기획서입니다. 코드(`src/`, `public/`, `migrations/`)를 기준으로 작성했으며, 실제 동작과 문서가 어긋나면 코드가 우선입니다.

## 1. 개요

- **장르**: 웹 기반 실시간 퍼즐 게임 ("사과게임" / Apple Game 클론)
- **핵심 규칙**: 가로×세로 격자에 1~9 숫자가 적힌 사과가 배치되어 있고, 드래그로 사각 영역을 선택해 그 안의 숫자 합이 정확히 10이 되면 해당 사과들이 제거된다.
- **제공 모드**
  - 연습 모드 (기록 미저장, 랜덤 시드)
  - 데일리 챌린지 (계정 로그인 필요, 하루 1회, 전역 랭킹 등록)
  - 실시간 2인 멀티플레이 — 레이스 / 협동 / 대결(듀얼) 3종
- **플랫폼**: Cloudflare Workers + D1(SQLite) + Durable Objects 기반 서버, 정적 자산은 `public/`에서 서빙되는 바닐라 JS SPA(화면 전환 방식) 클라이언트.

## 2. 핵심 게임플레이

| 항목 | 값 | 근거 |
|---|---|---|
| 보드 크기 | 12행 × 19열 (총 228칸) | `public/js/board.js` (`ROWS=12, COLS=19`) |
| 셀 값 범위 | 1~9 (균등 난수) | `generateValues` |
| 목표 합 | 10 | `TARGET_SUM` |
| 제한 시간 | 120초 | `GAME_DURATION_SECONDS` / `GAME_DURATION_MS` |
| 카운트다운 | 3-2-1 (스텝당 700ms) | `timer.js` |
| 조작 | 마우스/포인터 드래그로 사각 선택 영역 지정 → 합이 10이면 제거 | `drag.js` |

### 2.1 보드 생성 로직
- 시드 기반 의사난수(`mulberry32`)로 보드를 생성하여 **같은 시드 → 항상 같은 보드**가 보장된다. 이는 데일리 챌린지의 전역 동일 조건 보장과 서버 측 점수 재검증(replay)의 기반이 된다.
- 2차원 프리픽스 합을 이용해 모든 부분 사각형 합을 O(1)에 계산하고, 유효한(합=10) 사각형이 최소 30개 이상 나올 때까지(`MIN_VALID_RECTS=30`) 시드를 변형해가며 재시도한다(`MAX_GENERATION_ATTEMPTS=200`). 너무 재미없는(풀이 경로가 적은) 보드가 나오지 않도록 하는 안전장치.
- 완전 소거("퍼펙트") 시 즉시 게임 종료 처리.

### 2.2 점수 판정
- 한 번의 드래그(커밋)당 제거된 사과 개수만큼 점수 획득.
- 클라이언트가 매 드래그의 `{indices, t}`(제거된 칸 인덱스, 게임 시작 후 경과 ms)를 `inputLog`로 누적 기록 — 데일리 챌린지 한정.
- 정확도(`accuracy`) = 성공한 드래그 수 / 전체 드래그 시도 수, 최대 1회 제거 개수(`maxRemovalCount`)도 함께 집계되어 결과 화면에 노출.

## 3. 화면 흐름 (클라이언트 SPA)

`public/js/main.js`가 단일 페이지 내에서 아래 화면(`section`)들을 `display` 토글 방식으로 전환한다.

```
title(타이틀)
 ├─ account(로그인/회원가입) ─ 로그인 성공 시 title로 복귀
 ├─ admin(관리자 화면, 관리자 계정만 진입 가능)
 ├─ rules(게임 방법 설명)
 ├─ leaderboard(전역 랭킹: daily/weekly/alltime 탭)
 ├─ game(싱글 플레이: 연습 또는 데일리) → result(결과) → title
 ├─ mpEntry(멀티 진입: 방 생성/참가) → mpLobby(대기실) → mpGame(대결) → mpResult(결과)
 └─ mpLeaderboard(멀티 랭킹: race/duel/coop 탭)
```

타이틀 화면 진입 시 매번 일일 랭킹 Top10과 멀티플레이 랭킹(선택된 모드 탭)을 갱신해서 보여준다.

## 4. 계정 시스템

- **인증 방식**: 별도 이메일/OAuth 없이 `이름(닉네임) + PIN` 조합만으로 계정을 식별한다. 이름은 1~12자, PIN은 숫자 4~8자리(`PIN_PATTERN = /^\d{4,8}$/`).
- **저장**: `accounts` 테이블에 `pin_hash`, `pin_salt`(각 계정마다 16바이트 랜덤 salt)를 저장. `salt:pin` 문자열을 SHA-256으로 해시하여 저장/검증(`hashPin`).
- **로그인 실패 잠금**: 5회 연속 PIN 오류 시 5분간 계정 잠금(`MAX_LOGIN_ATTEMPTS=5`, `LOGIN_LOCK_MS=5분`). 로그인 성공 시 실패 카운트 초기화.
- **밴(정지)**: `is_banned` 플래그가 설정된 계정은 모든 인증 요청에서 403으로 거부.
- **클라이언트 세션 보관**: 로그인/가입 성공 시 `localStorage`에 `{name, pin, isAdmin}`을 평문 저장하고, 이후 모든 API 호출에 함께 실어 보낸다(별도 세션 토큰/쿠키 없음). PIN이 브라우저에 평문으로 남는 구조이므로 보안 강도는 낮음(§10 참고).
- **관리자 권한**: `accounts.is_admin` 플래그. 관리자 로그인 시 타이틀 상단에 "관리자" 링크가 노출되어 관리자 화면 진입 가능.

## 5. 싱글 플레이 모드

### 5.1 연습 모드
- 매번 `Math.random()` 기반 완전 랜덤 시드로 보드 생성.
- 기록 저장/랭킹 등록 없음. 자유 연습용.

### 5.2 데일리 챌린지
- **시드**: 그날 날짜(KST 기준, `getDailySeedString`이 UTC epoch에 +9시간을 더해 계산) 문자열 `daily:YYYY-MM-DD`를 해싱한 값을 시드로 사용 → 같은 날 접속한 모든 유저가 동일한 보드를 받는다.
- **1일 1회 제한**:
  1. 클라이언트가 `POST /api/daily-start`로 서버에 참가 등록을 시도한다.
  2. 서버는 `daily_plays(date, account_name)`에 UNIQUE 제약이 있어 이미 참가한 계정이면 409(`already played today`)를 반환한다.
  3. 클라이언트도 로컬 캐시(`localStorage`의 `dailyPlayed:{date}:{name}`)로 버튼 비활성/안내 문구를 즉시 반영하되, 화면 진입/재접속 시 `POST /api/daily-status`로 서버 상태와 동기화하여 캐시 불일치를 방지한다(자정 롤오버, 다른 기기 플레이 등 케이스 대응).
- **점수 제출 및 서버 재검증**(`POST /api/scores`):
  - 클라이언트가 `score`, `accuracy`, `maxRemoval`, `inputLog`(각 드래그의 제거 인덱스+타임스탬프)를 전송.
  - 서버는 같은 시드로 보드를 재생성한 뒤, `inputLog`를 처음부터 다시 재생(`replayLog`)하여: 인덱스 범위/중복 제거 여부/이미 제거된 칸 재사용 여부/합계=10 여부를 모두 검증하고 점수를 재계산한다.
  - 재계산 점수가 클라이언트가 주장한 점수와 다르면 400(`verification failed`)으로 거부 — **클라이언트 조작으로 점수를 위조할 수 없는 구조**.
  - `scores(date, account_name)`에 UNIQUE 제약이 있어 하루 1건만 등록 가능(409 `already submitted today`).
  - 제출 시각 기준 해당 날짜 랭킹 등수(`rank`)와 전체 참가자 수(`total`)를 즉시 응답.
  - 타이밍 값(`inputLog` 마지막 이벤트의 t)이 `게임시간(120s)+여유(10s)`를 넘으면 거부해 비정상적으로 긴 세션을 걸러낸다.

## 6. 랭킹 / 리더보드

### 6.1 싱글(데일리) 랭킹 — `GET /api/leaderboard?period=daily|weekly|alltime`
- **daily**: 오늘 하루 점수 내림차순 (동점 시 먼저 제출한 순).
- **weekly**: 최근 7일(오늘 포함, `weekStartDate`가 오늘 -6일 계산)간 계정별 **최고 점수 1건**만 집계해 정렬.
- **alltime**: 전체 기간 계정별 최고 점수 1건만 집계해 정렬.
- 조회 개수는 `limit` 파라미터(최대 100, `MAX_LEADERBOARD_LIMIT`)로 제한.
- 타이틀 화면에는 daily Top10, 결과 화면 하단에는 daily Top5가 상시 노출.

### 6.2 멀티플레이 랭킹 — `GET /api/multiplayer/leaderboard?mode=race|duel|coop`
- **race / duel**: 계정별 누적 승/패 수를 집계하여 승수 내림차순, 패수 오름차순으로 정렬한 리더보드.
- **coop**: 협동 매치 각각을 (플레이어1+플레이어2 팀, 팀 점수) 형태로 점수 내림차순 정렬해 노출(개인전이 아닌 매치 단위 기록).

## 7. 멀티플레이 시스템

### 7.1 아키텍처
- 방(Room) 하나당 Cloudflare **Durable Object**(`GameRoom`) 인스턴스 1개가 대응되며, 6자리 방 코드로 DO를 식별(`idFromName(code)`). 같은 방 코드는 항상 같은 DO 인스턴스로 라우팅되어 서버가 방의 상태(참가자, 보드, 점수)를 단일 진실 소스로 관리한다.
- 방장/게스트는 각자 WebSocket으로 DO에 연결하고, 이후 모든 게임 이벤트는 DO를 경유해 브로드캐스트된다.
- 방 상태는 `state.storage`에 영속화되어(`persist()`) DO가 재시작되어도 방 정보가 유지된다.

### 7.2 방 생성/참가 흐름
1. `POST /api/multiplayer/rooms` (mode: race|coop|duel) → 서버가 6자리 랜덤 코드(중복 없는 알파벳 `ABCDEFGHJKLMNPQRSTUVWXYZ23456789`, 혼동되는 0/O/1/I 제외)를 생성하고 해당 DO에 `/init`을 호출해 방을 `lobby` 상태로 초기화. 최대 10회까지 코드 중복 시 재시도.
2. 호스트/게스트가 `GET /api/multiplayer/rooms/{CODE}/ws?name=&pin=` 으로 WebSocket 연결 시도 → 서버가 이름+PIN을 계정 검증(`verifyAccount`) 후에만 DO로 연결을 넘긴다(계정 도용 방지).
3. 방장 이름과 일치하면 `host`, 방이 `lobby`이고 게스트 자리가 비어있으면 새 연결자가 `guest`로 배정. 그 외(정원 초과 등)는 거부.
4. 동일 role의 기존 연결이 있으면(새로고침 등) 이전 연결을 정리하고 교체.
5. 참가자 변동마다 `roster` 메시지를 모두에게 브로드캐스트(모드/상태/호스트명/게스트명).
6. 호스트가 게스트가 있는 상태에서 `start` 메시지를 보내면 서버가 새 랜덤 시드로 보드를 생성해 `game_start`를 브로드캐스트하고 상태를 `playing`으로 전환.

### 7.3 모드별 규칙
| 모드 | 보드 | 판정 주체 | 승패 기준 |
|---|---|---|---|
| **레이스(race)** | 참가자마다 각자 화면에서 동일 시드의 보드를 독립적으로 플레이 | 각자 클라이언트가 로컬 판정, 종료 시 `final_result`(점수+inputLog)를 서버에 제출 → 서버가 `verifyScore`로 재검증 | 재검증된 점수가 더 높은 쪽 승. 시간 만료 또는 둘 다 보드를 완전 클리어(퍼펙트) 시 종료 |
| **협동(coop)** | 하나의 공유 보드를 두 명이 함께 플레이 | 모든 제거 시도(`try_remove`)를 서버가 직접 검증(합=10, 미제거 칸 여부)하고 승인/거부 후 브로드캐스트 | 승패 없음(팀 점수만 기록). 완전 클리어 또는 시간 만료로 종료 |
| **대결(duel)** | 하나의 공유 보드를 두 명이 동시에 보며 실시간 쟁탈전 | coop과 동일하게 서버가 각 시도를 검증하지만, 제거한 사람의 점수로 각자 누적 | 최종 점수가 더 높은 쪽 승. 동점이면 무승부 |

- 레이스 모드를 제외한 나머지 두 모드는 **서버가 신뢰의 원천**이라 클라이언트 조작으로 부정 이득을 볼 수 없다(모든 제거 시도를 서버가 재계산). 레이스는 종료 시점에만 `inputLog` replay로 사후 검증한다.
- **연결 종료 처리**: 대기실에서 게스트가 나가면 자리를 다시 오픈, 게임 중 한쪽이 끊기면 `opponent_left` 통지 후 coop/duel은 즉시 결과 처리, race는 이탈자를 0점 처리하고 즉시 종료.
- **경기 결과 저장**: 매 경기 종료 시 `multiplayer_matches`에 모드/방코드/두 플레이어명/점수/승자명을 기록(coop은 승자 없음, `player1/2_score` 둘 다 팀 점수와 동일하게 기록). DB 기록 실패는 게임 종료 브로드캐스트를 막지 않는 best-effort 처리.

## 8. 관리자 기능 (관리자 계정 전용)

`/api/admin/*` 엔드포인트는 모두 요청 바디에 로그인 정보(name/pin)를 함께 실어 서버가 매 요청마다 계정을 재검증하고, `is_admin`이 아니면 403.

- **점수 초기화** (`/api/admin/clear-scores`): 특정 날짜 또는 전체 `scores` 삭제.
- **개인 데일리 초기화** (`/api/admin/reset-daily`): 특정 계정의 특정 날짜 `daily_plays`/`scores` 기록을 삭제해 재도전을 허용.
- **계정 목록 조회** (`/api/admin/accounts`): 전체 계정의 이름/관리자여부/밴여부 목록.
- **밴/밴해제** (`/api/admin/set-banned`): 특정 계정의 `is_banned` 토글. 관리자 화면에서 계정명을 드롭다운으로 선택하거나 자유 입력으로도 지정 가능.

## 9. 기술 아키텍처

```
브라우저(SPA, public/js/*.js)
   │ fetch(JSON) / WebSocket
   ▼
Cloudflare Worker (src/index.js)  ── 정적 자산은 ASSETS 바인딩으로 public/ 서빙
   │                     │
   ▼                     ▼
D1 Database (SQLite)   Durable Object "GameRoom" (src/gameRoom.js, 방 코드별 1개 인스턴스)
 - accounts             - 인메모리 소켓 맵 + storage 영속화
 - daily_plays          - 방 상태머신: empty → lobby → playing → finished
 - scores
 - multiplayer_matches
```

- **런타임**: Cloudflare Workers, 배포/로컬 개발은 `wrangler`(`wrangler dev` / `wrangler deploy`).
- **DB**: Cloudflare D1(`apple-game-db`), 스키마 변경은 `migrations/*.sql`로 순차 관리(0001~0005).
- **동시성 상태 관리**: 각 멀티플레이 방은 독립된 Durable Object로 격리되어 방 간 상태 충돌이 없다.
- **클라이언트**: 빌드 도구 없이 순수 ES 모듈(`public/js/*.js`)로 작성. `board.js`(보드/시드 로직), `drag.js`(드래그 선택 입력), `timer.js`(카운트다운/타이머), `score.js`(점수 집계), `main.js`(화면 전환 + 전체 오케스트레이션 + 서버 통신).
- **핵심 설계 포인트**: 보드 생성 로직(`board.js`)이 서버(`src/index.js`, `src/gameRoom.js`)와 클라이언트에서 동일 모듈을 공유(import)하기 때문에, "같은 시드 → 같은 보드"가 서버/클라이언트 양쪽에서 항상 동일하게 재현되고, 이 덕분에 서버가 클라이언트의 플레이 로그만으로 점수를 독립적으로 재계산/검증할 수 있다.

## 10. 데이터 모델 (D1 스키마 요약)

| 테이블 | 주요 컬럼 | 설명 |
|---|---|---|
| `accounts` | name(PK), pin_hash, pin_salt, failed_attempts, locked_until, is_admin, is_banned, created_at | 계정 기본 정보 |
| `daily_plays` | date, account_name (복합 PK), ip, started_at | 계정별 하루 1회 참가 기록 |
| `scores` | id(PK), date, account_name, score, accuracy, max_removal, input_log(JSON 문자열), ip, created_at | 데일리 챌린지 제출 기록. `(date, account_name)` UNIQUE |
| `multiplayer_matches` | id(PK), mode, room_code, player1_name/score, player2_name/score, winner_name, created_at | 멀티플레이 경기 결과 |

인덱스: `scores(date, score DESC)`, `scores(account_name)`, `daily_plays(date, ip)`, `multiplayer_matches(mode)` 등이 조회 성능을 위해 설정되어 있다.

## 11. 부정행위 방지 / 보안 요약

- 서버가 시드로부터 보드를 직접 재생성하므로 클라이언트가 임의의 보드를 주장할 수 없다.
- 모든 점수 제출은 원본 조작 로그(`inputLog`)를 서버가 재생(replay)하여 검증하며, 클라이언트가 주장한 점수와 다르면 거부한다.
- PIN은 계정별 salt와 함께 SHA-256 해시로만 저장되며 평문 저장되지 않는다(단, 클라이언트 로컬 저장소에는 평문 PIN이 남아있어 기기 탈취 시 노출 위험은 있음).
- 로그인 실패 5회 시 5분 잠금으로 무차별 대입 시도를 완화.
- 관리자 API는 매 호출마다 계정 재검증 + `is_admin` 확인을 거친다.
- 협동/대결 모드는 모든 조작을 서버가 실시간으로 검증해 클라이언트 조작 여지가 사실상 없다.

## 12. 알려진 이슈 / 향후 개선 과제

- `migrations/0004_multiplayer.sql`의 `multiplayer_matches.mode` 컬럼에는 `CHECK (mode IN ('race','coop'))` 제약이 남아있는데, 이후 추가된 **대결(duel) 모드**는 이 체크를 갱신하는 마이그레이션이 없다. SQLite가 CHECK 제약을 강제하는 환경이라면 duel 경기 결과 저장(`recordMatch`)이 실패할 수 있으므로, `mode IN ('race','coop','duel')`로 완화하는 마이그레이션 추가가 필요하다.
- 계정 세션이 `localStorage`에 평문 PIN으로 저장되는 구조라, 별도 토큰 기반 세션으로 전환하면 보안이 개선된다.
- 레이스 모드는 종료 시점에만 서버 검증이 이루어지므로, 진행 중 상대 점수 실시간 공유(`opponent_score`)는 클라이언트 자기 신고 값이라 스포일러성 어뷰징(허위 점수 과시) 가능성이 있다(단, 최종 판정에는 영향 없음).
- 방 코드 충돌 재시도는 최대 10회로 제한되어 있어 이론상 동시 대량 방 생성 시 실패할 수 있다(현재 트래픽 규모에서는 낮은 확률).
