import { generateBoard, getDailySeedString, hashStringToSeed, ROWS, COLS, CELL_SIZE, CELL_COUNT } from "./board.js";
import { createDragController } from "./drag.js";
import { runCountdown, createGameTimer, GAME_DURATION_SECONDS } from "./timer.js";
import { createScoreTracker } from "./score.js";

const CLIENT_ID_KEY = "appleGameClientId";
const NICKNAME_KEY = "appleGameNickname";
const LEADERBOARD_PERIODS = ["daily", "weekly", "alltime"];

const screens = {
  title: document.getElementById("screen-title"),
  game: document.getElementById("screen-game"),
  result: document.getElementById("screen-result"),
  leaderboard: document.getElementById("screen-leaderboard"),
  rules: document.getElementById("screen-rules"),
};

function showScreen(name) {
  for (const key of Object.keys(screens)) {
    screens[key].classList.toggle("active", key === name);
  }
}

const boardEl = document.getElementById("board");
const boardHitOverlayEl = document.getElementById("board-hit-overlay");
const countdownOverlay = document.getElementById("countdown-overlay");
const scoreValueEl = document.getElementById("score-value");
const applesLeftValueEl = document.getElementById("apples-left-value");
const timerBarEl = document.getElementById("timer-bar");
const timerLabelEl = document.getElementById("timer-label");
const resultScoreEl = document.getElementById("result-score");
const resultAccuracyEl = document.getElementById("result-accuracy");
const resultMaxRemovalEl = document.getElementById("result-max-removal");
const resultReasonEl = document.getElementById("result-reason");
const titleTaglineEl = document.getElementById("title-tagline");
const dailyNoteEl = document.getElementById("daily-note");
const btnDailyEl = document.getElementById("btn-daily");
const todayTopScoreEl = document.getElementById("today-top-score");
const top5ListEl = document.getElementById("top5-list");
const submitSectionEl = document.getElementById("submit-section");
const nicknameInputEl = document.getElementById("nickname-input");
const btnSubmitScoreEl = document.getElementById("btn-submit-score");
const submitMessageEl = document.getElementById("submit-message");
const leaderboardListEl = document.getElementById("leaderboard-list");

titleTaglineEl.textContent = `드래그해서 합이 10이 되는 사과를 지우세요. 제한 시간 ${GAME_DURATION_SECONDS}초, 총 ${CELL_COUNT}개의 사과`;
applesLeftValueEl.textContent = String(CELL_COUNT);

function getClientId() {
  let id = localStorage.getItem(CLIENT_ID_KEY);
  if (!id) {
    id = crypto.randomUUID();
    localStorage.setItem(CLIENT_ID_KEY, id);
  }
  return id;
}

function dailyPlayedKey(date) {
  return `dailyPlayed:${date}`;
}

function hasDailyPlayed(date) {
  return localStorage.getItem(dailyPlayedKey(date)) === "1";
}

function markDailyPlayed(date) {
  localStorage.setItem(dailyPlayedKey(date), "1");
}

function refreshDailyButtonState() {
  const date = getDailySeedString();
  if (hasDailyPlayed(date)) {
    btnDailyEl.disabled = true;
    dailyNoteEl.textContent = "오늘은 이미 도전하셨습니다. 내일 다시 도전해주세요!";
    dailyNoteEl.classList.add("already-played");
  } else {
    btnDailyEl.disabled = false;
    dailyNoteEl.textContent = "데일리 챌린지는 하루에 한 번만 도전할 수 있습니다.";
    dailyNoteEl.classList.remove("already-played");
  }
}

async function fetchJson(url, options) {
  const res = await fetch(url, options);
  let data = null;
  try {
    data = await res.json();
  } catch {
    // ignore
  }
  return { ok: res.ok, status: res.status, data };
}

function renderLeaderboardEntries(listEl, entries, emptyMessage) {
  listEl.innerHTML = "";
  if (!entries || entries.length === 0) {
    const li = document.createElement("li");
    li.className = "leaderboard-empty top5-empty";
    li.textContent = emptyMessage;
    listEl.appendChild(li);
    return;
  }
  entries.forEach((entry, i) => {
    const li = document.createElement("li");
    const rank = document.createElement("span");
    rank.className = "rank";
    rank.textContent = `#${i + 1}`;
    const nickname = document.createElement("span");
    nickname.className = "nickname";
    nickname.textContent = entry.nickname;
    const score = document.createElement("span");
    score.className = "score";
    score.textContent = String(entry.score);
    li.append(rank, nickname, score);
    listEl.appendChild(li);
  });
}

async function loadTop5() {
  try {
    const { ok, data } = await fetchJson("/api/leaderboard?period=daily&limit=5");
    if (!ok || !data) throw new Error("failed");
    renderLeaderboardEntries(top5ListEl, data.entries, "집계 중...");
    todayTopScoreEl.textContent = data.entries.length > 0 ? String(data.entries[0].score) : "-";
    return data.entries.length > 0 ? data.entries[0].score : 0;
  } catch {
    renderLeaderboardEntries(top5ListEl, [], "랭킹을 불러올 수 없습니다");
    todayTopScoreEl.textContent = "-";
    return 0;
  }
}

async function loadLeaderboardTab(period) {
  leaderboardListEl.innerHTML = '<li class="leaderboard-empty">불러오는 중...</li>';
  try {
    const { ok, data } = await fetchJson(`/api/leaderboard?period=${period}&limit=100`);
    if (!ok || !data) throw new Error("failed");
    renderLeaderboardEntries(leaderboardListEl, data.entries, "아직 등록된 기록이 없습니다");
  } catch {
    renderLeaderboardEntries(leaderboardListEl, [], "랭킹을 불러올 수 없습니다");
  }
}

document.getElementById("btn-view-leaderboard").addEventListener("click", () => {
  showScreen("leaderboard");
  loadLeaderboardTab("daily");
});

document.getElementById("btn-view-rules").addEventListener("click", () => {
  showScreen("rules");
});

document.getElementById("btn-rules-back").addEventListener("click", () => {
  showScreen("title");
});

document.getElementById("btn-leaderboard-back").addEventListener("click", () => {
  showScreen("title");
});

for (const period of LEADERBOARD_PERIODS) {
  document.getElementById(`tab-${period}`).addEventListener("click", (e) => {
    for (const p of LEADERBOARD_PERIODS) {
      document.getElementById(`tab-${p}`).classList.toggle("active", p === period);
    }
    loadLeaderboardTab(period);
  });
}

let removed = null;
let values = null;
let cellEls = [];
let centers = [];
let dragController = null;
let timer = null;
let scoreTracker = null;
let ended = false;
let mode = "practice";
let currentDate = null;
let gameStartedAt = 0;
let inputLog = [];
let todayTopScore = 0;
let toppedTodayScore = false;
let scoreSubmitted = false;

function buildBoardDom(boardValues) {
  boardEl.innerHTML = "";
  cellEls = [];
  centers = [];
  for (let i = 0; i < CELL_COUNT; i++) {
    const row = Math.floor(i / COLS);
    const col = i % COLS;
    const cell = document.createElement("div");
    cell.className = "apple";
    const span = document.createElement("span");
    span.textContent = String(boardValues[i]);
    cell.appendChild(span);
    boardEl.appendChild(cell);
    cellEls.push(cell);
    centers.push({ x: col * CELL_SIZE + CELL_SIZE / 2, y: row * CELL_SIZE + CELL_SIZE / 2 });
  }
}

function isRemoved(index) {
  return removed[index] === 1;
}

function updateSidePanel() {
  scoreValueEl.textContent = String(scoreTracker.score);
  let left = 0;
  for (let i = 0; i < CELL_COUNT; i++) {
    if (!isRemoved(i)) left++;
  }
  applesLeftValueEl.textContent = String(left);

  if (mode === "daily" && !toppedTodayScore && scoreTracker.score > todayTopScore) {
    toppedTodayScore = true;
    scoreValueEl.classList.remove("score-flash");
    // restart animation
    requestAnimationFrame(() => scoreValueEl.classList.add("score-flash"));
  }
  return left;
}

function onDragCommit(includedIndices) {
  if (ended) return;
  scoreTracker.recordDrag(includedIndices.length);
  if (mode === "daily" && includedIndices.length > 0) {
    inputLog.push({ indices: includedIndices.slice(), t: Date.now() - gameStartedAt });
  }
  for (const idx of includedIndices) {
    removed[idx] = 1;
    cellEls[idx].classList.add("removed");
  }
  const left = updateSidePanel();
  if (includedIndices.length > 0 && left === 0) {
    endGame("perfect");
  }
}

function onTimerTick(remaining, urgent) {
  const pct = Math.max(0, (remaining / GAME_DURATION_SECONDS) * 100);
  timerBarEl.style.width = `${pct}%`;
  timerBarEl.classList.toggle("urgent", urgent);
  timerLabelEl.classList.toggle("urgent", urgent);
  timerLabelEl.textContent = `남은 시간 ${remaining}초`;
}

function resetSubmitSection() {
  submitMessageEl.textContent = "";
  submitMessageEl.className = "submit-message";
  btnSubmitScoreEl.disabled = false;
  nicknameInputEl.disabled = false;
  nicknameInputEl.value = localStorage.getItem(NICKNAME_KEY) || "";
}

function endGame(reason) {
  if (ended) return;
  ended = true;
  if (timer) timer.stop();
  if (dragController) dragController.destroy();

  const summary = scoreTracker.getSummary();
  resultScoreEl.textContent = String(summary.score);
  resultAccuracyEl.textContent = `정확도 ${Math.round(summary.accuracy * 100)}% (${summary.successfulDrags}/${summary.totalDrags})`;
  resultMaxRemovalEl.textContent = `최대 1회 제거 ${summary.maxRemovalCount}개`;
  resultReasonEl.textContent =
    reason === "perfect" ? "퍼펙트! 모든 사과를 제거했습니다" : reason === "quit" ? "포기" : "시간 종료";

  if (mode === "daily") {
    submitSectionEl.style.display = "flex";
    resetSubmitSection();
  } else {
    submitSectionEl.style.display = "none";
  }

  showScreen("result");
}

async function startGame(gameMode, seed) {
  mode = gameMode;
  ended = false;
  inputLog = [];
  toppedTodayScore = false;
  todayTopScore = 0;
  scoreSubmitted = false;

  if (mode === "daily") {
    currentDate = getDailySeedString();
    todayTopScore = await loadTop5();
  }

  const board = generateBoard(seed);
  values = board.values;
  removed = new Uint8Array(CELL_COUNT);
  scoreTracker = createScoreTracker();
  buildBoardDom(values);
  updateSidePanel();
  timerBarEl.style.width = "100%";
  timerBarEl.classList.remove("urgent");
  timerLabelEl.classList.remove("urgent");
  timerLabelEl.textContent = `남은 시간 ${GAME_DURATION_SECONDS}초`;

  showScreen("game");
  countdownOverlay.classList.add("active");

  runCountdown(
    (n) => {
      countdownOverlay.textContent = String(n);
    },
    () => {
      countdownOverlay.classList.remove("active");
      gameStartedAt = Date.now();
      dragController = createDragController({
        boardEl,
        frameEl: boardHitOverlayEl,
        cellEls,
        centers,
        values,
        isRemoved,
        onCommit: onDragCommit,
      });
      timer = createGameTimer({
        durationSeconds: GAME_DURATION_SECONDS,
        onTick: onTimerTick,
        onExpire: () => endGame("timeup"),
      });
      timer.start();
    }
  );
}

btnDailyEl.addEventListener("click", () => {
  const date = getDailySeedString();
  if (hasDailyPlayed(date)) {
    refreshDailyButtonState();
    return;
  }
  markDailyPlayed(date);
  refreshDailyButtonState();
  const seed = hashStringToSeed(`daily:${date}`);
  startGame("daily", seed);
});

document.getElementById("btn-practice").addEventListener("click", () => {
  const seed = (Math.random() * 0xffffffff) >>> 0;
  startGame("practice", seed);
});

document.getElementById("btn-quit").addEventListener("click", () => {
  if (confirm("게임을 포기하시겠습니까?")) {
    endGame("quit");
  }
});

document.getElementById("btn-retry").addEventListener("click", () => {
  if (mode === "daily" && !scoreSubmitted) {
    const leave = confirm(
      "정말 랭킹 등록을 하지 않으시겠습니까? 데일리 챌린지는 오늘 하루동안은 다시 플레이가 불가능합니다."
    );
    if (!leave) return;
  }
  refreshDailyButtonState();
  showScreen("title");
});

btnSubmitScoreEl.addEventListener("click", async () => {
  const nickname = nicknameInputEl.value.trim();
  if (nickname.length === 0) {
    submitMessageEl.textContent = "닉네임을 입력해주세요.";
    submitMessageEl.className = "submit-message error";
    return;
  }
  if (nickname.length > 12) {
    submitMessageEl.textContent = "닉네임은 최대 12자입니다.";
    submitMessageEl.className = "submit-message error";
    return;
  }

  btnSubmitScoreEl.disabled = true;
  nicknameInputEl.disabled = true;
  submitMessageEl.textContent = "등록 중...";
  submitMessageEl.className = "submit-message";

  const summary = scoreTracker.getSummary();
  const payload = {
    date: currentDate,
    nickname,
    clientId: getClientId(),
    score: summary.score,
    accuracy: summary.accuracy,
    maxRemoval: summary.maxRemovalCount,
    inputLog,
  };

  try {
    const { ok, status, data } = await fetchJson("/api/scores", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });

    if (ok && data && data.ok) {
      localStorage.setItem(NICKNAME_KEY, nickname);
      submitMessageEl.textContent = `등록 완료! 오늘 순위 #${data.rank} / ${data.total}명`;
      submitMessageEl.className = "submit-message success";
      scoreSubmitted = true;
      loadTop5();
    } else if (status === 409 && data && data.error === "nickname taken") {
      submitMessageEl.textContent = "이미 사용 중인 닉네임입니다. 다른 닉네임을 입력해주세요.";
      submitMessageEl.className = "submit-message error";
      btnSubmitScoreEl.disabled = false;
      nicknameInputEl.disabled = false;
    } else if (status === 409 && data && data.error === "already submitted today") {
      submitMessageEl.textContent = "오늘 랭킹에는 이미 등록하셨습니다.";
      submitMessageEl.className = "submit-message success";
      scoreSubmitted = true;
    } else if (data && data.error === "stale date") {
      submitMessageEl.textContent = "날짜가 바뀌었습니다. 페이지를 새로고침한 뒤 다시 시도해주세요.";
      submitMessageEl.className = "submit-message error";
      btnSubmitScoreEl.disabled = false;
      nicknameInputEl.disabled = false;
    } else if (data && data.error === "verification failed") {
      submitMessageEl.textContent = "기록을 검증하지 못했습니다. 새로고침 후 데일리 챌린지를 다시 플레이해주세요.";
      submitMessageEl.className = "submit-message error";
      btnSubmitScoreEl.disabled = false;
      nicknameInputEl.disabled = false;
    } else {
      const detail = data && data.error ? ` (${data.error})` : "";
      submitMessageEl.textContent = `등록에 실패했습니다${detail}. 잠시 후 다시 시도해주세요.`;
      submitMessageEl.className = "submit-message error";
      btnSubmitScoreEl.disabled = false;
      nicknameInputEl.disabled = false;
    }
  } catch {
    submitMessageEl.textContent = "네트워크 오류로 등록하지 못했습니다.";
    submitMessageEl.className = "submit-message error";
    btnSubmitScoreEl.disabled = false;
    nicknameInputEl.disabled = false;
  }
});

refreshDailyButtonState();
loadTop5();
