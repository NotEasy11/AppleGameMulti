# AppleGameMulti — 작업 인수인계 (Claude용)

이 파일은 다른 PC/새 세션의 Claude가 바로 작업을 이어받기 위한 요약이다. 작업 전 이 파일을 먼저 읽을 것.

## 사용자 작업 규칙 (중요)
- **어떤 작업이든 실행 전에 반드시 사용자에게 확인을 받고 진행한다.** (파일 수정, 커밋, push, 배포 등)
- 사용자와는 한국어로 대화한다.

## 프로젝트 개요
- 사과게임(12×19 격자의 숫자 사과를 드래그로 묶어 합이 10이면 제거) 웹 게임.
- 스택: **Cloudflare Workers** + **D1**(SQLite DB, `apple-game-db`) + **Durable Objects**(`GameRoom`, 실시간 멀티플레이).
- 프론트는 빌드 없는 순수 HTML/CSS/ES 모듈 (`public/`), Workers의 정적 자산(`ASSETS`)으로 서빙.
- 의존성은 `wrangler` 하나뿐.

## 구현된 기능
- 계정: 이름 + PIN(4~8자리) 가입/로그인, PIN은 salt+해시 저장, 5회 실패 시 5분 잠금.
- 일일 챌린지: 날짜 기반 시드로 모두 같은 판, 하루 1회, 일간/주간/전체 랭킹. 서버가 입력 로그를 재생(replay)해 점수 검증.
- 연습 모드: 난이도 3단계 — easy(새싹, 150초) / normal(사과, 120초) / hard(황금사과, 90초), 난이도별 랭킹.
- 2인 실시간 멀티(방 코드 6자리, 웹소켓): race(각자 같은 판, 점수 경쟁) / coop(한 판 공유, 합산) / duel(한 판 공유, 먼저 지우는 사람이 점수). 모드별 랭킹(race·duel 승패).
- 관리자(`accounts.is_admin = 1`인 계정): 점수 초기화, 일일 플레이 리셋, 계정 목록, 차단/해제.
- 타이틀 화면: 왼쪽 일일 랭킹 Top10, 오른쪽 멀티 랭킹 패널. 보드 사과는 🍎 이모지 + 제거 팝 효과.
- API는 CORS 허용(`*`).

## 파일 구조
| 경로 | 역할 |
|---|---|
| `src/index.js` | Worker 진입점. 모든 `/api/*` 라우팅, 계정/점수/랭킹/관리자/방 생성 |
| `src/gameRoom.js` | Durable Object `GameRoom`. 방 상태, 웹소켓 메시지 처리, 결과 DB 저장 |
| `public/index.html` | 단일 페이지 UI |
| `public/js/main.js` | 화면 전환, API 호출, 게임 흐름, 멀티 클라이언트 |
| `public/js/board.js` | 보드 생성(시드 RNG), 상수, `PRACTICE_DIFFICULTIES` — **서버와 공유**하므로 수정 시 양쪽 영향 |
| `public/js/drag.js` | 드래그 선택 박스 |
| `public/js/timer.js` | 카운트다운/타이머 |
| `public/js/score.js` | 점수·정확도 집계 |
| `public/css/tokens.css`, `app.css` | 디자인 토큰, 스타일 |
| `migrations/0001~0006_*.sql` | D1 스키마 (accounts, daily_plays, scores, multiplayer_matches, practice_scores) |
| `wrangler.jsonc` | Worker 설정 (D1 바인딩 `DB`, DO 바인딩 `GAME_ROOM`) |
| `.github/workflows/deploy-cloudflare.yml` | 자동 배포 |

## API 목록 (`src/index.js`)
- 계정: `POST /api/account/register`, `POST /api/account/login`
- 일일: `POST /api/daily-start`, `POST /api/daily-status`, `GET /api/daily-seed`, `POST /api/scores`, `GET /api/leaderboard`
- 연습: `POST /api/practice/scores`, `GET /api/practice/leaderboard`
- 관리자: `POST /api/admin/clear-scores`, `/reset-daily`, `/accounts`, `/set-banned`
- 멀티: `POST /api/multiplayer/rooms`(방 생성), 방 웹소켓 연결, `GET /api/multiplayer/leaderboard`
- 웹소켓 메시지: `start`, `try_remove`, `score_update`, `final_result`, `quit` → 서버 `roster`, `game_start`, `removed`, `rejected`, `opponent_score`, `opponent_left`, `game_over`

## 브랜치 / 배포
- 작업 브랜치: `claude/wizardly-faraday-fj0ckr`
- 배포 브랜치: `claude/repo-permissions-check-3lciu7` — **이 브랜치에 push하면** GitHub Actions가 `d1 migrations apply --remote` 후 `wrangler deploy` 실행.
- 필요한 GitHub Secrets: `CLOUDFLARE_API_TOKEN`, `CLOUDFLARE_ACCOUNT_ID` (이미 설정되어 있음).
- 인수인계 시점 기준 두 브랜치 최신 코드 동일 (`7b7b059 Allow cross-origin requests to the API`).
- 새 DB 변경은 `migrations/0007_*.sql`처럼 번호를 이어서 추가 (기존 파일 수정 금지).

## 다른 PC에서 시작하기
```bash
git clone https://github.com/NotEasy11/AppleGameMulti.git
cd AppleGameMulti
git checkout claude/wizardly-faraday-fj0ckr
npm install
npx wrangler d1 migrations apply apple-game-db --local   # 로컬 DB 준비
npm run dev                                               # http://localhost:8787
```
- `.gitignore`에 `.dev.vars`, `.wrangler/`, `node_modules/`, `.claude/settings.local.json` 포함.
- 로컬 관리자 테스트: 가입 후 `npx wrangler d1 execute apple-game-db --local --command "UPDATE accounts SET is_admin=1 WHERE name='이름'"`

## 확인 필요 / 다음 할 일 후보
- ⚠️ `migrations/0004_multiplayer.sql`의 `multiplayer_matches.mode`에 `CHECK (mode IN ('race','coop'))` 제약이 있는데, 코드는 `duel` 결과도 이 테이블에 INSERT 함 → **duel 결과 저장이 실패할 가능성** 있음 (코드 읽고 추정, 실행 검증은 안 함). 실제 배포 DB 확인 후 필요하면 테이블 재생성 마이그레이션 추가.
- `README.md`가 권한 테스트용 임시 내용이라 정리 필요.
- 이전 대화 기록은 이 파일에 포함되지 않았음(인수인계 세션에서 볼 수 없었음). 사용자에게 남은 작업을 물어볼 것.
