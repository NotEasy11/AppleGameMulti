import { generateBoard, getDailySeedString, ROWS, COLS, CELL_SIZE, CELL_COUNT } from "./board.js";
import { createDragController } from "./drag.js";
import { runCountdown, createGameTimer, GAME_DURATION_SECONDS } from "./timer.js";
import { createScoreTracker } from "./score.js";

const ACCOUNT_KEY = "appleGameAccount";
const LEADERBOARD_PERIODS = ["daily", "weekly", "alltime"];
const PIN_PATTERN = /^\d{4,8}$/;

const screens = {
  title: document.getElementById("screen-title"),
  account: document.getElementById("screen-account"),
  admin: document.getElementById("screen-admin"),
  game: document.getElementById("screen-game"),
  result: document.getElementById("screen-result"),
  leaderboard: document.getElementById("screen-leaderboard"),
  rules: document.getElementById("screen-rules"),
};

function showScreen(name) {
  for (const key of Object.keys(screens)) {
    screens[key].classList.toggle("active", key === name);
  }
  if (name === "title") {
    loadTitleRanking();
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
const submitAccountLabelEl = document.getElementById("submit-account-label");
const btnSubmitScoreEl = document.getElementById("btn-submit-score");
const submitMessageEl = document.getElementById("submit-message");
const leaderboardListEl = document.getElementById("leaderboard-list");
const titleRankingListEl = document.getElementById("title-ranking-list");
const accountStatusEl = document.getElementById("account-status");
const accountIntroEl = document.getElementById("account-intro");
const accountNameInputEl = document.getElementById("account-name-input");
const accountPinInputEl = document.getElementById("account-pin-input");
const accountMessageEl = document.getElementById("account-message");
const adminClearDateInputEl = document.getElementById("admin-clear-date-input");
const adminResetNameInputEl = document.getElementById("admin-reset-name-input");
const adminResetDateInputEl = document.getElementById("admin-reset-date-input");
const adminMessageEl = document.getElementById("admin-message");

titleTaglineEl.textContent = `드래그해서 합이 10이 되는 사과를 지우세요. 제한 시간 ${GAME_DURATION_SECONDS}초, 총 ${CELL_COUNT}개의 사과`;
applesLeftValueEl.textContent = String(CELL_COUNT);

function getAccount() {
  try {
    const raw = localStorage.getItem(ACCOUNT_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (parsed && typeof parsed.name === "string" && typeof parsed.pin === "string") {
      return parsed;
    }
  } catch {
    // ignore
  }
  return null;
}

function setAccount(name, pin, isAdmin) {
  localStorage.setItem(ACCOUNT_KEY, JSON.stringify({ name, pin, isAdmin: !!isAdmin }));
}

function clearAccount() {
  localStorage.removeItem(ACCOUNT_KEY);
}

function dailyPlayedKey(date, name) {
  return `dailyPlayed:${date}:${name}`;
}

function hasDailyPlayed(date, name) {
  return localStorage.getItem(dailyPlayedKey(date, name)) === "1";
}

function markDailyPlayed(date, name) {
  localStorage.setItem(dailyPlayedKey(date, name), "1");
}

function clearDailyPlayed(date, name) {
  localStorage.removeItem(dailyPlayedKey(date, name));
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

function refreshAccountStatus() {
  const account = getAccount();
  accountStatusEl.textContent = "";
  if (account) {
    const strong = document.createElement("strong");
    strong.textContent = account.name;
    const logoutLink = document.createElement("span");
    logoutLink.className = "account-link";
    logoutLink.textContent = "로그아웃";
    logoutLink.addEventListener("click", () => {
      clearAccount();
      refreshAccountStatus();
      refreshDailyButtonState();
    });
    accountStatusEl.append(strong, document.createTextNode("님으로 로그인됨 "), logoutLink);
    if (account.isAdmin) {
      const adminLink = document.createElement("span");
      adminLink.className = "account-link";
      adminLink.textContent = " · 관리자";
      adminLink.addEventListener("click", () => openAdminScreen());
      accountStatusEl.appendChild(adminLink);
    }
  } else {
    const link = document.createElement("span");
    link.className = "account-link";
    link.textContent = "로그인 / 계정 만들기";
    link.addEventListener("click", () => openAccountScreen());
    accountStatusEl.appendChild(link);
  }
}

function openAccountScreen() {
  accountMessageEl.textContent = "";
  accountMessageEl.className = "submit-message";
  const account = getAccount();
  accountNameInputEl.value = account ? account.name : "";
  accountPinInputEl.value = "";
  showScreen("account");
}

function refreshDailyButtonState() {
  const account = getAccount();
  if (!account) {
    btnDailyEl.disabled = false;
    dailyNoteEl.textContent = "데일리 챌린지는 로그인 후 하루에 한 번만 도전할 수 있습니다.";
    dailyNoteEl.classList.remove("already-played");
    return;
  }
  const date = getDailySeedString();
  if (hasDailyPlayed(date, account.name)) {
    btnDailyEl.disabled = false;
    dailyNoteEl.textContent = "오늘은 이미 도전하셨습니다. 내일 다시 도전해주세요!";
    dailyNoteEl.classList.add("already-played");
  } else {
    btnDailyEl.disabled = false;
    dailyNoteEl.textContent = "데일리 챌린지는 하루에 한 번만 도전할 수 있습니다.";
    dailyNoteEl.classList.remove("already-played");
  }
}

async function syncDailyStatus() {
  const account = getAccount();
  if (!account) {
    refreshDailyButtonState();
    return;
  }
  try {
    const { ok, data } = await fetchJson("/api/daily-status", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: account.name, pin: account.pin }),
    });
    if (ok && data && data.ok) {
      if (data.alreadyPlayed) {
        markDailyPlayed(data.date, account.name);
      } else {
        clearDailyPlayed(data.date, account.name);
      }
    }
  } catch {
    // network failure: fall back to whatever local cache already has
  }
  refreshDailyButtonState();
}

const ACCOUNT_ERROR_MESSAGES = {
  "name taken": "이미 사용 중인 이름입니다.",
  "account not found": "등록되지 않은 이름입니다. 계정을 먼저 만들어주세요.",
  "invalid pin": "이름 또는 PIN이 올바르지 않습니다.",
  "account locked": "로그인 실패가 많아 잠시 잠겼습니다. 5분 후 다시 시도해주세요.",
  "invalid name": "이름을 1~12자로 입력해주세요.",
};

async function submitAccountForm(url) {
  const name = accountNameInputEl.value.trim();
  const pin = accountPinInputEl.value.trim();
  if (name.length === 0 || name.length > 12) {
    accountMessageEl.textContent = "이름을 1~12자로 입력해주세요.";
    accountMessageEl.className = "submit-message error";
    return;
  }
  if (!PIN_PATTERN.test(pin)) {
    accountMessageEl.textContent = "PIN은 숫자 4~8자리로 입력해주세요.";
    accountMessageEl.className = "submit-message error";
    return;
  }

  accountMessageEl.textContent = "처리 중...";
  accountMessageEl.className = "submit-message";

  try {
    const { ok, data } = await fetchJson(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name, pin }),
    });
    if (ok && data && data.ok) {
      setAccount(data.name, pin, data.isAdmin);
      refreshAccountStatus();
      syncDailyStatus();
      showScreen("title");
      return;
    }
    accountMessageEl.textContent =
      (data && ACCOUNT_ERROR_MESSAGES[data.error]) || "처리에 실패했습니다. 잠시 후 다시 시도해주세요.";
    accountMessageEl.className = "submit-message error";
  } catch {
    accountMessageEl.textContent = "네트워크 오류가 발생했습니다.";
    accountMessageEl.className = "submit-message error";
  }
}

document.getElementById("btn-account-login").addEventListener("click", () => {
  submitAccountForm("/api/account/login");
});

document.getElementById("btn-account-register").addEventListener("click", () => {
  submitAccountForm("/api/account/register");
});

document.getElementById("btn-account-back").addEventListener("click", () => {
  showScreen("title");
});

function openAdminScreen() {
  const account = getAccount();
  if (!account || !account.isAdmin) return;
  adminMessageEl.textContent = "";
  adminMessageEl.className = "submit-message";
  adminClearDateInputEl.value = "";
  adminResetNameInputEl.value = "";
  adminResetDateInputEl.value = "";
  showScreen("admin");
}

document.getElementById("btn-admin-back").addEventListener("click", () => {
  showScreen("title");
});

document.getElementById("btn-admin-clear-scores").addEventListener("click", async () => {
  const account = getAccount();
  if (!account) return;
  const date = adminClearDateInputEl.value.trim();
  const label = date ? `${date} 기록만` : "전체 기록을";
  if (!confirm(`정말 ${label} 삭제하시겠습니까? 되돌릴 수 없습니다.`)) return;

  adminMessageEl.textContent = "처리 중...";
  adminMessageEl.className = "submit-message";
  try {
    const { ok, data } = await fetchJson("/api/admin/clear-scores", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: account.name, pin: account.pin, date: date || undefined }),
    });
    if (ok && data && data.ok) {
      adminMessageEl.textContent = `초기화 완료 (${data.cleared === "all" ? "전체" : data.cleared})`;
      adminMessageEl.className = "submit-message success";
      loadTop5();
    } else {
      adminMessageEl.textContent = `실패: ${(data && data.error) || "알 수 없는 오류"}`;
      adminMessageEl.className = "submit-message error";
    }
  } catch {
    adminMessageEl.textContent = "네트워크 오류가 발생했습니다.";
    adminMessageEl.className = "submit-message error";
  }
});

document.getElementById("btn-admin-reset-daily").addEventListener("click", async () => {
  const account = getAccount();
  if (!account) return;
  const targetName = adminResetNameInputEl.value.trim();
  if (targetName.length === 0) {
    adminMessageEl.textContent = "대상 계정 이름을 입력해주세요.";
    adminMessageEl.className = "submit-message error";
    return;
  }
  const date = adminResetDateInputEl.value.trim();

  adminMessageEl.textContent = "처리 중...";
  adminMessageEl.className = "submit-message";
  try {
    const { ok, data } = await fetchJson("/api/admin/reset-daily", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: account.name, pin: account.pin, targetName, date: date || undefined }),
    });
    if (ok && data && data.ok) {
      adminMessageEl.textContent = `${data.targetName}님의 ${data.date} 플레이 기록을 초기화했습니다.`;
      adminMessageEl.className = "submit-message success";
    } else {
      adminMessageEl.textContent = `실패: ${(data && data.error) || "알 수 없는 오류"}`;
      adminMessageEl.className = "submit-message error";
    }
  } catch {
    adminMessageEl.textContent = "네트워크 오류가 발생했습니다.";
    adminMessageEl.className = "submit-message error";
  }
});

function formatShortDate(dateStr) {
  if (typeof dateStr !== "string") return "";
  const parts = dateStr.split("-");
  if (parts.length !== 3) return dateStr;
  return `${parseInt(parts[1], 10)}/${parseInt(parts[2], 10)}`;
}

function renderLeaderboardEntries(listEl, entries, emptyMessage, showDate) {
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
    if (showDate && entry.date) {
      const date = document.createElement("span");
      date.className = "date";
      date.textContent = formatShortDate(entry.date);
      li.appendChild(date);
    }
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

async function loadTitleRanking() {
  try {
    const { ok, data } = await fetchJson("/api/leaderboard?period=daily&limit=10");
    if (!ok || !data) throw new Error("failed");
    renderLeaderboardEntries(titleRankingListEl, data.entries, "아직 등록된 기록이 없습니다");
  } catch {
    renderLeaderboardEntries(titleRankingListEl, [], "랭킹을 불러올 수 없습니다");
  }
}

async function loadLeaderboardTab(period) {
  leaderboardListEl.innerHTML = '<li class="leaderboard-empty">불러오는 중...</li>';
  try {
    const { ok, data } = await fetchJson(`/api/leaderboard?period=${period}&limit=100`);
    if (!ok || !data) throw new Error("failed");
    renderLeaderboardEntries(leaderboardListEl, data.entries, "아직 등록된 기록이 없습니다", true);
  } catch {
    renderLeaderboardEntries(leaderboardListEl, [], "랭킹을 불러올 수 없습니다", true);
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
  document.getElementById(`tab-${period}`).addEventListener("click", () => {
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
  submitAccountLabelEl.textContent = "";
  const account = getAccount();
  if (account) {
    const strong = document.createElement("strong");
    strong.textContent = account.name;
    submitAccountLabelEl.append(strong, document.createTextNode("님으로 등록됩니다"));
  }
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

btnDailyEl.addEventListener("click", async () => {
  const account = getAccount();
  if (!account) {
    accountIntroEl.textContent = "데일리 챌린지는 로그인 후 이용할 수 있습니다.";
    openAccountScreen();
    return;
  }

  const date = getDailySeedString();

  btnDailyEl.disabled = true;
  try {
    const { ok, data } = await fetchJson("/api/daily-start", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: account.name, pin: account.pin, date }),
    });

    if (ok && data && data.ok) {
      markDailyPlayed(date, account.name);
      startGame("daily", data.seed);
      return;
    }
    if (data && data.error === "already played today") {
      markDailyPlayed(date, account.name);
    } else if (data && (data.error === "invalid pin" || data.error === "account not found")) {
      clearAccount();
      refreshAccountStatus();
      accountIntroEl.textContent = "로그인 정보가 유효하지 않습니다. 다시 로그인해주세요.";
      openAccountScreen();
      return;
    } else if (data && data.error === "account locked") {
      alert("로그인 실패가 많아 잠시 계정이 잠겼습니다. 5분 후 다시 시도해주세요.");
    } else {
      alert("데일리 챌린지를 시작하지 못했습니다. 잠시 후 다시 시도해주세요.");
    }
  } catch {
    alert("네트워크 오류로 시작하지 못했습니다.");
  }
  refreshDailyButtonState();
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
  syncDailyStatus();
  showScreen("title");
});

btnSubmitScoreEl.addEventListener("click", async () => {
  const account = getAccount();
  if (!account) {
    submitMessageEl.textContent = "로그인 정보가 없습니다. 다시 로그인해주세요.";
    submitMessageEl.className = "submit-message error";
    return;
  }

  btnSubmitScoreEl.disabled = true;
  submitMessageEl.textContent = "등록 중...";
  submitMessageEl.className = "submit-message";

  const summary = scoreTracker.getSummary();
  const payload = {
    name: account.name,
    pin: account.pin,
    date: currentDate,
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
      submitMessageEl.textContent = `등록 완료! 오늘 순위 #${data.rank} / ${data.total}명`;
      submitMessageEl.className = "submit-message success";
      scoreSubmitted = true;
      loadTop5();
    } else if (status === 409 && data && data.error === "already submitted today") {
      submitMessageEl.textContent = "오늘 랭킹에는 이미 등록하셨습니다.";
      submitMessageEl.className = "submit-message success";
      scoreSubmitted = true;
    } else if (data && (data.error === "invalid pin" || data.error === "account not found")) {
      submitMessageEl.textContent = "로그인 정보가 유효하지 않습니다. 다시 로그인해주세요.";
      submitMessageEl.className = "submit-message error";
      clearAccount();
      refreshAccountStatus();
      btnSubmitScoreEl.disabled = false;
    } else if (data && data.error === "stale date") {
      submitMessageEl.textContent = "날짜가 바뀌었습니다. 페이지를 새로고침한 뒤 다시 시도해주세요.";
      submitMessageEl.className = "submit-message error";
      btnSubmitScoreEl.disabled = false;
    } else if (data && data.error === "verification failed") {
      submitMessageEl.textContent = "기록을 검증하지 못했습니다. 새로고침 후 데일리 챌린지를 다시 플레이해주세요.";
      submitMessageEl.className = "submit-message error";
      btnSubmitScoreEl.disabled = false;
    } else {
      const detail = data && data.error ? ` (${data.error})` : "";
      submitMessageEl.textContent = `등록에 실패했습니다${detail}. 잠시 후 다시 시도해주세요.`;
      submitMessageEl.className = "submit-message error";
      btnSubmitScoreEl.disabled = false;
    }
  } catch {
    submitMessageEl.textContent = "네트워크 오류로 등록하지 못했습니다.";
    submitMessageEl.className = "submit-message error";
    btnSubmitScoreEl.disabled = false;
  }
});

refreshAccountStatus();
syncDailyStatus();
loadTop5();
loadTitleRanking();
