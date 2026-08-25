import {
  generateBoard,
  getDailySeedString,
  ROWS,
  COLS,
  CELL_SIZE,
  CELL_COUNT,
  PRACTICE_DIFFICULTIES,
} from "./board.js";
import { createDragController } from "./drag.js";
import { runCountdown, createGameTimer, GAME_DURATION_SECONDS } from "./timer.js";
import { createScoreTracker } from "./score.js";

const ACCOUNT_KEY = "appleGameAccount";
const LEADERBOARD_PERIODS = ["daily", "weekly", "alltime"];
const PRACTICE_DIFFICULTY_KEYS = ["easy", "normal", "hard"];
const PIN_PATTERN = /^\d{4,8}$/;

const screens = {
  title: document.getElementById("screen-title"),
  account: document.getElementById("screen-account"),
  admin: document.getElementById("screen-admin"),
  practiceSelect: document.getElementById("screen-practice-select"),
  game: document.getElementById("screen-game"),
  result: document.getElementById("screen-result"),
  leaderboard: document.getElementById("screen-leaderboard"),
  rules: document.getElementById("screen-rules"),
  mpEntry: document.getElementById("screen-mp-entry"),
  mpLobby: document.getElementById("screen-mp-lobby"),
  mpGame: document.getElementById("screen-mp-game"),
  mpResult: document.getElementById("screen-mp-result"),
  mpLeaderboard: document.getElementById("screen-mp-leaderboard"),
  practiceLeaderboard: document.getElementById("screen-practice-leaderboard"),
};

function showScreen(name) {
  for (const key of Object.keys(screens)) {
    screens[key].classList.toggle("active", key === name);
  }
  if (name === "title") {
    loadTitleRanking();
    loadTitleMpRanking(titleMpRankingMode);
    loadTitlePracticeRanking(titlePracticeRankingMode);
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
const titleMpRankingListEl = document.getElementById("title-mp-ranking-list");
const titlePracticeRankingListEl = document.getElementById("title-practice-ranking-list");
const practiceLeaderboardListEl = document.getElementById("practice-leaderboard-list");
const accountStatusEl = document.getElementById("account-status");
const accountIntroEl = document.getElementById("account-intro");
const accountNameInputEl = document.getElementById("account-name-input");
const accountPinInputEl = document.getElementById("account-pin-input");
const accountMessageEl = document.getElementById("account-message");
const adminClearDateInputEl = document.getElementById("admin-clear-date-input");
const adminResetNameSelectEl = document.getElementById("admin-reset-name-select");
const adminResetDateInputEl = document.getElementById("admin-reset-date-input");
const adminMessageEl = document.getElementById("admin-message");
const adminBanSelectEl = document.getElementById("admin-ban-select");
const adminAccountsListEl = document.getElementById("admin-accounts-list");
const adminBanMessageEl = document.getElementById("admin-ban-message");

// ---------- Multiplayer DOM refs ----------
const mpEntryMessageEl = document.getElementById("mp-entry-message");
const mpJoinCodeInputEl = document.getElementById("mp-join-code-input");
const mpLobbyCodeEl = document.getElementById("mp-lobby-code");
const mpLobbyModeEl = document.getElementById("mp-lobby-mode");
const mpLobbyHostEl = document.getElementById("mp-lobby-host");
const mpLobbyGuestEl = document.getElementById("mp-lobby-guest");
const mpLobbyMessageEl = document.getElementById("mp-lobby-message");
const btnMpStartEl = document.getElementById("btn-mp-start");
const mpBoardEl = document.getElementById("mp-board");
const mpBoardHitOverlayEl = document.getElementById("mp-board-hit-overlay");
const mpCountdownOverlayEl = document.getElementById("mp-countdown-overlay");
const mpTimerBarEl = document.getElementById("mp-timer-bar");
const mpTimerLabelEl = document.getElementById("mp-timer-label");
const mpMyLabelEl = document.getElementById("mp-my-label");
const mpMyScoreEl = document.getElementById("mp-my-score");
const mpOpponentLabelEl = document.getElementById("mp-opponent-label");
const mpOpponentScoreEl = document.getElementById("mp-opponent-score");
const mpApplesLeftValueEl = document.getElementById("mp-apples-left-value");
const mpStatusNoteEl = document.getElementById("mp-status-note");
const mpResultReasonEl = document.getElementById("mp-result-reason");
const mpResultScoreEl = document.getElementById("mp-result-score");
const mpLeaderboardListEl = document.getElementById("mp-leaderboard-list");

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
  const res = await fetch(url, { cache: "no-store", ...options });
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
  banned:
    "본인의 계정은 관리자의 권한으로\nBAN 당하셨습니다. \n이의가 있으시면 관리자와 \n직접 소통하길 바랍니다.",
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

async function loadAdminAccounts() {
  const account = getAccount();
  if (!account) return;
  try {
    const { ok, data } = await fetchJson("/api/admin/accounts", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: account.name, pin: account.pin }),
    });
    if (!ok || !data || !data.ok) throw new Error("failed");
    const accounts = data.accounts || [];
    adminAccountsListEl.innerHTML = "";
    accounts.forEach((acc) => {
      const option = document.createElement("option");
      option.value = acc.name;
      if (acc.isBanned) option.label = "잠김 상태";
      adminAccountsListEl.appendChild(option);
    });
  } catch {
    adminAccountsListEl.innerHTML = "";
  }
}

function openAdminScreen() {
  const account = getAccount();
  if (!account || !account.isAdmin) return;
  adminMessageEl.textContent = "";
  adminMessageEl.className = "submit-message";
  adminBanMessageEl.textContent = "";
  adminBanMessageEl.className = "submit-message";
  adminClearDateInputEl.value = "";
  adminResetNameSelectEl.value = "";
  adminResetDateInputEl.value = "";
  adminBanSelectEl.value = "";
  showScreen("admin");
  loadAdminAccounts();
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
  const targetName = adminResetNameSelectEl.value.trim();
  if (targetName.length === 0) {
    adminMessageEl.textContent = "대상 계정을 선택해주세요.";
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

async function submitSetBanned(banned) {
  const account = getAccount();
  if (!account) return;
  const targetName = adminBanSelectEl.value.trim();
  if (targetName.length === 0) {
    adminBanMessageEl.textContent = "대상 계정을 선택해주세요.";
    adminBanMessageEl.className = "submit-message error";
    return;
  }
  if (banned && !confirm(`${targetName} 계정을 잠그시겠습니까?`)) return;

  adminBanMessageEl.textContent = "처리 중...";
  adminBanMessageEl.className = "submit-message";
  try {
    const { ok, data } = await fetchJson("/api/admin/set-banned", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: account.name, pin: account.pin, targetName, banned }),
    });
    if (ok && data && data.ok) {
      adminBanMessageEl.textContent = banned
        ? `${data.targetName} 계정을 잠갔습니다.`
        : `${data.targetName} 계정의 잠금을 해제했습니다.`;
      adminBanMessageEl.className = "submit-message success";
      loadAdminAccounts();
    } else {
      adminBanMessageEl.textContent = `실패: ${(data && data.error) || "알 수 없는 오류"}`;
      adminBanMessageEl.className = "submit-message error";
    }
  } catch {
    adminBanMessageEl.textContent = "네트워크 오류가 발생했습니다.";
    adminBanMessageEl.className = "submit-message error";
  }
}

document.getElementById("btn-admin-ban").addEventListener("click", () => submitSetBanned(true));
document.getElementById("btn-admin-unban").addEventListener("click", () => submitSetBanned(false));

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

let titleMpRankingMode = "race";

async function loadTitleMpRanking(mode) {
  titleMpRankingMode = mode;
  titleMpRankingListEl.innerHTML = '<li class="leaderboard-empty">불러오는 중...</li>';
  try {
    const { ok, data } = await fetchJson(`/api/multiplayer/leaderboard?mode=${mode}&limit=10`);
    if (!ok || !data) throw new Error("failed");
    renderMpLeaderboardInto(titleMpRankingListEl, mode, data.entries);
  } catch {
    renderMpLeaderboardInto(titleMpRankingListEl, mode, []);
  }
}

let titlePracticeRankingMode = "easy";

async function loadTitlePracticeRanking(difficulty) {
  titlePracticeRankingMode = difficulty;
  titlePracticeRankingListEl.innerHTML = '<li class="leaderboard-empty">불러오는 중...</li>';
  try {
    const { ok, data } = await fetchJson(`/api/practice/leaderboard?difficulty=${difficulty}&limit=10`);
    if (!ok || !data) throw new Error("failed");
    renderLeaderboardEntries(titlePracticeRankingListEl, data.entries, "아직 등록된 기록이 없습니다");
  } catch {
    renderLeaderboardEntries(titlePracticeRankingListEl, [], "랭킹을 불러올 수 없습니다");
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
let currentPracticeDifficulty = null;
let currentSeed = null;
let gameStartedAt = 0;
let inputLog = [];
let todayTopScore = 0;
let toppedTodayScore = false;
let scoreSubmitted = false;

function applyPopOutEffect(cellEl, index) {
  const row = Math.floor(index / COLS);
  const col = index % COLS;
  const centerX = (COLS * CELL_SIZE) / 2;
  const centerY = (ROWS * CELL_SIZE) / 2;
  let dx = col * CELL_SIZE + CELL_SIZE / 2 - centerX;
  let dy = row * CELL_SIZE + CELL_SIZE / 2 - centerY;
  if (dx === 0 && dy === 0) {
    const angle = Math.random() * Math.PI * 2;
    dx = Math.cos(angle);
    dy = Math.sin(angle);
  }
  const len = Math.hypot(dx, dy);
  const distance = 70 + Math.random() * 50;
  const rot = (Math.random() - 0.5) * 240;
  cellEl.style.setProperty("--pop-dx", `${(dx / len) * distance}px`);
  cellEl.style.setProperty("--pop-dy", `${(dy / len) * distance}px`);
  cellEl.style.setProperty("--pop-rot", `${rot}deg`);
  cellEl.classList.add("removed");
}

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
  if ((mode === "daily" || mode === "practice") && includedIndices.length > 0) {
    inputLog.push({ indices: includedIndices.slice(), t: Date.now() - gameStartedAt });
  }
  for (const idx of includedIndices) {
    removed[idx] = 1;
    applyPopOutEffect(cellEls[idx], idx);
  }
  const left = updateSidePanel();
  if (includedIndices.length > 0 && left === 0) {
    endGame("perfect");
  }
}

let activeDurationSeconds = GAME_DURATION_SECONDS;

function onTimerTick(remaining, urgent) {
  const pct = Math.max(0, (remaining / activeDurationSeconds) * 100);
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
  } else {
    submitAccountLabelEl.textContent = "로그인 후 랭킹에 등록할 수 있습니다";
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

  if (mode === "daily" || mode === "practice") {
    submitSectionEl.style.display = "flex";
    resetSubmitSection();
  } else {
    submitSectionEl.style.display = "none";
  }

  showScreen("result");
}

async function startGame(gameMode, seed, difficultyKey) {
  mode = gameMode;
  ended = false;
  inputLog = [];
  toppedTodayScore = false;
  todayTopScore = 0;
  scoreSubmitted = false;
  currentSeed = seed;

  const difficulty = mode === "practice" ? PRACTICE_DIFFICULTIES[difficultyKey] || PRACTICE_DIFFICULTIES.normal : {};
  currentPracticeDifficulty = mode === "practice" ? difficulty.key : null;
  activeDurationSeconds = difficulty.durationSeconds ?? GAME_DURATION_SECONDS;

  if (mode === "daily") {
    currentDate = getDailySeedString();
    todayTopScore = await loadTop5();
  }

  const board = generateBoard(seed, {
    minValidRects: difficulty.minValidRects,
    maxValidRects: difficulty.maxValidRects,
  });
  values = board.values;
  removed = new Uint8Array(CELL_COUNT);
  scoreTracker = createScoreTracker();
  buildBoardDom(values);
  updateSidePanel();
  timerBarEl.style.width = "100%";
  timerBarEl.classList.remove("urgent");
  timerLabelEl.classList.remove("urgent");
  timerLabelEl.textContent = `남은 시간 ${activeDurationSeconds}초`;

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
        durationSeconds: activeDurationSeconds,
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
  showScreen("practiceSelect");
});

document.getElementById("btn-practice-select-back").addEventListener("click", () => {
  showScreen("title");
});

for (const key of PRACTICE_DIFFICULTY_KEYS) {
  document.getElementById(`btn-difficulty-${key}`).addEventListener("click", () => {
    const seed = (Math.random() * 0xffffffff) >>> 0;
    startGame("practice", seed, key);
  });
}

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
    openAccountScreen();
    return;
  }

  btnSubmitScoreEl.disabled = true;
  submitMessageEl.textContent = "등록 중...";
  submitMessageEl.className = "submit-message";

  const isPractice = mode === "practice";
  const summary = scoreTracker.getSummary();
  const payload = isPractice
    ? {
        name: account.name,
        pin: account.pin,
        difficulty: currentPracticeDifficulty,
        seed: currentSeed,
        score: summary.score,
        accuracy: summary.accuracy,
        maxRemoval: summary.maxRemovalCount,
        inputLog,
      }
    : {
        name: account.name,
        pin: account.pin,
        date: currentDate,
        score: summary.score,
        accuracy: summary.accuracy,
        maxRemoval: summary.maxRemovalCount,
        inputLog,
      };

  try {
    const { ok, status, data } = await fetchJson(isPractice ? "/api/practice/scores" : "/api/scores", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });

    if (ok && data && data.ok) {
      submitMessageEl.textContent = isPractice
        ? `등록 완료! 난이도 순위 #${data.rank} / ${data.total}명`
        : `등록 완료! 오늘 순위 #${data.rank} / ${data.total}명`;
      submitMessageEl.className = "submit-message success";
      scoreSubmitted = true;
      if (!isPractice) loadTop5();
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
      submitMessageEl.textContent = isPractice
        ? "기록을 검증하지 못했습니다. 새로고침 후 다시 플레이해주세요."
        : "기록을 검증하지 못했습니다. 새로고침 후 데일리 챌린지를 다시 플레이해주세요.";
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

// ==================== Multiplayer ====================

let mpSocket = null;
let mpRole = null; // "host" | "guest"
let mpMode = null; // "race" | "coop"
let mpCode = null;
let mpHostName = null;
let mpGuestName = null;
let mpRosterReceived = false;

let mpValues = null;
let mpRemoved = null;
let mpCellEls = [];
let mpCenters = [];
let mpDragController = null;
let mpTimer = null;
let mpScoreTracker = null;
let mpCoopScore = 0;
let mpDuelMyScore = 0;
let mpGameStartedAt = 0;
let mpInputLog = [];
let mpEnded = false;

function mpWsUrl(code, account) {
  const proto = location.protocol === "https:" ? "wss:" : "ws:";
  return `${proto}//${location.host}/api/multiplayer/rooms/${code}/ws?name=${encodeURIComponent(
    account.name
  )}&pin=${encodeURIComponent(account.pin)}`;
}

function connectMpSocket(code) {
  mpRosterReceived = false;
  const account = getAccount();
  mpSocket = new WebSocket(mpWsUrl(code, account));
  mpSocket.addEventListener("message", (evt) => {
    let msg;
    try {
      msg = JSON.parse(evt.data);
    } catch {
      return;
    }
    if (msg.type === "roster") mpRosterReceived = true;
    handleMpMessage(msg);
  });
  mpSocket.addEventListener("close", () => {
    if (!mpRosterReceived) {
      mpEntryMessageEl.textContent = "방에 참가하지 못했습니다. 코드를 확인해주세요.";
      mpEntryMessageEl.className = "submit-message error";
      showScreen("mpEntry");
      return;
    }
    if (screens.mpLobby.classList.contains("active")) {
      mpLobbyMessageEl.textContent = "연결이 끊어졌습니다.";
      mpLobbyMessageEl.className = "submit-message error";
    }
  });
}

function handleMpMessage(msg) {
  if (msg.type === "roster") {
    mpMode = msg.mode;
    renderMpLobby(msg);
  } else if (msg.type === "game_start") {
    startMpGame(msg.mode, msg.seed, msg.durationMs);
  } else if (msg.type === "removed") {
    applyMpRemoval(msg);
  } else if (msg.type === "opponent_score") {
    mpOpponentScoreEl.textContent = String(msg.score);
  } else if (msg.type === "opponent_left") {
    if (screens.mpGame.classList.contains("active")) {
      mpStatusNoteEl.textContent = "상대방과의 연결이 끊어졌습니다.";
    }
  } else if (msg.type === "game_over") {
    endMpGame(msg);
  }
}

function renderMpLobby(roster) {
  mpHostName = roster.hostName;
  mpGuestName = roster.guestName;
  mpLobbyModeEl.textContent =
    roster.mode === "race"
      ? "레이스 모드 (각자 보드에서 점수 대결)"
      : roster.mode === "duel"
      ? "대결 모드 (하나의 보드를 함께 보며 실시간 대결)"
      : "협동 모드 (하나의 보드를 함께 공략)";
  mpLobbyHostEl.textContent = roster.hostName || "-";
  mpLobbyGuestEl.textContent = roster.guestName || "대기 중...";
  btnMpStartEl.style.display = mpRole === "host" ? "block" : "none";
  btnMpStartEl.disabled = !roster.guestName;
}

async function createMpRoom(mode) {
  const account = getAccount();
  if (!account) {
    accountIntroEl.textContent = "멀티플레이는 로그인 후 이용할 수 있습니다.";
    openAccountScreen();
    return;
  }
  mpEntryMessageEl.textContent = "방을 만드는 중...";
  mpEntryMessageEl.className = "submit-message";
  try {
    const { ok, data } = await fetchJson("/api/multiplayer/rooms", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: account.name, pin: account.pin, mode }),
    });
    if (!ok || !data || !data.ok) {
      mpEntryMessageEl.textContent = "방을 만들지 못했습니다. 잠시 후 다시 시도해주세요.";
      mpEntryMessageEl.className = "submit-message error";
      return;
    }
    mpRole = "host";
    mpMode = mode;
    mpCode = data.code;
    mpLobbyCodeEl.textContent = mpCode;
    mpLobbyMessageEl.textContent = "";
    connectMpSocket(mpCode);
    showScreen("mpLobby");
  } catch {
    mpEntryMessageEl.textContent = "네트워크 오류가 발생했습니다.";
    mpEntryMessageEl.className = "submit-message error";
  }
}

function joinMpRoom() {
  const account = getAccount();
  if (!account) {
    accountIntroEl.textContent = "멀티플레이는 로그인 후 이용할 수 있습니다.";
    openAccountScreen();
    return;
  }
  const code = mpJoinCodeInputEl.value.trim().toUpperCase();
  if (code.length !== 6) {
    mpEntryMessageEl.textContent = "6자리 방 코드를 입력해주세요.";
    mpEntryMessageEl.className = "submit-message error";
    return;
  }
  mpRole = "guest";
  mpCode = code;
  mpLobbyCodeEl.textContent = code;
  mpLobbyMessageEl.textContent = "";
  connectMpSocket(code);
  showScreen("mpLobby");
}

function buildMpBoardDom(boardValues) {
  mpBoardEl.innerHTML = "";
  mpCellEls = [];
  mpCenters = [];
  for (let i = 0; i < CELL_COUNT; i++) {
    const row = Math.floor(i / COLS);
    const col = i % COLS;
    const cell = document.createElement("div");
    cell.className = "apple";
    const span = document.createElement("span");
    span.textContent = String(boardValues[i]);
    cell.appendChild(span);
    mpBoardEl.appendChild(cell);
    mpCellEls.push(cell);
    mpCenters.push({ x: col * CELL_SIZE + CELL_SIZE / 2, y: row * CELL_SIZE + CELL_SIZE / 2 });
  }
}

function mpIsRemoved(index) {
  return mpRemoved[index] === 1;
}

function updateMpSidePanel() {
  let left = 0;
  for (let i = 0; i < CELL_COUNT; i++) {
    if (!mpIsRemoved(i)) left++;
  }
  mpApplesLeftValueEl.textContent = String(left);
  if (mpMode === "coop") {
    mpMyScoreEl.textContent = String(mpCoopScore);
  } else if (mpMode === "duel") {
    mpMyScoreEl.textContent = String(mpDuelMyScore);
  } else {
    mpMyScoreEl.textContent = String(mpScoreTracker.score);
  }
  return left;
}

function finishMpRaceEarly() {
  if (mpEnded) return;
  mpEnded = true;
  if (mpTimer) mpTimer.stop();
  if (mpDragController) mpDragController.destroy();
  mpSocket.send(JSON.stringify({ type: "final_result", score: mpScoreTracker.score, inputLog: mpInputLog }));
  mpStatusNoteEl.textContent = "보드를 모두 지웠습니다! 상대방의 결과를 기다리는 중...";
}

function onMpDragCommit(includedIndices) {
  if (mpEnded) return;
  if (mpMode === "coop" || mpMode === "duel") {
    if (includedIndices.length > 0) {
      mpSocket.send(JSON.stringify({ type: "try_remove", indices: includedIndices }));
    }
    return;
  }
  mpScoreTracker.recordDrag(includedIndices.length);
  if (includedIndices.length > 0) {
    mpInputLog.push({ indices: includedIndices.slice(), t: Date.now() - mpGameStartedAt });
    for (const idx of includedIndices) {
      mpRemoved[idx] = 1;
      applyPopOutEffect(mpCellEls[idx], idx);
    }
    if (mpSocket && mpSocket.readyState === WebSocket.OPEN) {
      mpSocket.send(JSON.stringify({ type: "score_update", score: mpScoreTracker.score }));
    }
  }
  const left = updateMpSidePanel();
  if (includedIndices.length > 0 && left === 0) {
    finishMpRaceEarly();
  }
}

function applyMpRemoval(msg) {
  for (const idx of msg.indices) {
    mpRemoved[idx] = 1;
    if (mpCellEls[idx]) applyPopOutEffect(mpCellEls[idx], idx);
  }
  if (msg.mode === "coop") {
    mpCoopScore = msg.score;
  } else if (msg.mode === "duel") {
    mpDuelMyScore = mpRole === "host" ? msg.hostScore : msg.guestScore;
    const oppScore = mpRole === "host" ? msg.guestScore : msg.hostScore;
    mpOpponentScoreEl.textContent = String(oppScore);
  }
  updateMpSidePanel();
}

function onMpTimerTick(remaining, urgent) {
  const pct = Math.max(0, (remaining / GAME_DURATION_SECONDS) * 100);
  mpTimerBarEl.style.width = `${pct}%`;
  mpTimerBarEl.classList.toggle("urgent", urgent);
  mpTimerLabelEl.classList.toggle("urgent", urgent);
  mpTimerLabelEl.textContent = `남은 시간 ${remaining}초`;
}

function onMpTimerExpire() {
  if (mpEnded) return;
  mpEnded = true;
  if (mpDragController) mpDragController.destroy();
  if (mpMode === "race") {
    mpSocket.send(JSON.stringify({ type: "final_result", score: mpScoreTracker.score, inputLog: mpInputLog }));
  } else {
    mpSocket.send(JSON.stringify({ type: "final_result" }));
  }
  mpStatusNoteEl.textContent = "결과를 계산하는 중...";
}

function startMpGame(mode, seed, durationMs) {
  mpMode = mode;
  mpEnded = false;
  mpInputLog = [];
  mpCoopScore = 0;
  mpDuelMyScore = 0;
  mpStatusNoteEl.textContent = "";

  const board = generateBoard(seed);
  mpValues = board.values;
  mpRemoved = new Uint8Array(CELL_COUNT);
  mpScoreTracker = createScoreTracker();

  const partnerName = mpRole === "host" ? mpGuestName : mpHostName;
  if (mode === "coop") {
    mpMyLabelEl.textContent = "우리 점수";
    mpOpponentLabelEl.textContent = "함께 플레이 중";
    mpOpponentScoreEl.textContent = partnerName || "-";
  } else {
    mpMyLabelEl.textContent = "내 점수";
    mpOpponentLabelEl.textContent = `${partnerName || "상대"} 점수`;
    mpOpponentScoreEl.textContent = "0";
  }

  buildMpBoardDom(mpValues);
  updateMpSidePanel();

  mpTimerBarEl.style.width = "100%";
  mpTimerBarEl.classList.remove("urgent");
  mpTimerLabelEl.classList.remove("urgent");
  mpTimerLabelEl.textContent = `남은 시간 ${Math.round(durationMs / 1000)}초`;

  showScreen("mpGame");
  mpCountdownOverlayEl.classList.add("active");

  runCountdown(
    (n) => {
      mpCountdownOverlayEl.textContent = String(n);
    },
    () => {
      mpCountdownOverlayEl.classList.remove("active");
      mpGameStartedAt = Date.now();
      mpDragController = createDragController({
        boardEl: mpBoardEl,
        frameEl: mpBoardHitOverlayEl,
        cellEls: mpCellEls,
        centers: mpCenters,
        values: mpValues,
        isRemoved: mpIsRemoved,
        onCommit: onMpDragCommit,
      });
      mpTimer = createGameTimer({
        durationSeconds: Math.round(durationMs / 1000),
        onTick: onMpTimerTick,
        onExpire: onMpTimerExpire,
      });
      mpTimer.start();
    }
  );
}

function endMpGame(result) {
  if (mpTimer) mpTimer.stop();
  if (mpDragController) mpDragController.destroy();
  mpEnded = true;

  if (result.mode === "race" || result.mode === "duel") {
    const account = getAccount();
    const myScore = mpRole === "host" ? result.hostScore : result.guestScore;
    const oppScore = mpRole === "host" ? result.guestScore : result.hostScore;
    const draw = !result.winnerName;
    const iWon = !draw && account && result.winnerName === account.name;
    const reasonPrefix =
      result.mode === "duel" && result.reason === "perfect"
        ? "퍼펙트! "
        : result.mode === "duel" && result.reason === "opponent_disconnected"
        ? "상대방과 연결이 끊어졌습니다. "
        : "";
    mpResultReasonEl.textContent =
      reasonPrefix + (draw ? "무승부입니다!" : iWon ? "승리했습니다! 🎉" : "패배했습니다");
    mpResultScoreEl.textContent = `${myScore} : ${oppScore}`;
  } else {
    mpResultReasonEl.textContent =
      result.reason === "perfect"
        ? "퍼펙트! 모든 사과를 함께 제거했습니다"
        : result.reason === "opponent_disconnected"
        ? "상대방과 연결이 끊어져 종료되었습니다"
        : "시간 종료";
    mpResultScoreEl.textContent = String(result.score);
  }

  showScreen("mpResult");
}

function renderMpLeaderboardInto(listEl, mode, entries) {
  listEl.innerHTML = "";
  if (!entries || entries.length === 0) {
    const li = document.createElement("li");
    li.className = "leaderboard-empty";
    li.textContent = mode === "coop" ? "아직 등록된 협동 기록이 없습니다" : "아직 기록된 승리가 없습니다";
    listEl.appendChild(li);
    return;
  }
  const isWinLoss = mode === "race" || mode === "duel";
  entries.forEach((entry, i) => {
    const li = document.createElement("li");
    const rank = document.createElement("span");
    rank.className = "rank";
    rank.textContent = `#${i + 1}`;
    const nickname = document.createElement("span");
    nickname.className = "nickname";
    nickname.textContent = isWinLoss ? entry.nickname : `${entry.player1_name} & ${entry.player2_name}`;
    const score = document.createElement("span");
    score.className = "score";
    score.textContent = isWinLoss ? `${entry.wins}승 ${entry.losses}패` : String(entry.score);
    li.append(rank, nickname, score);
    listEl.appendChild(li);
  });
}

function renderMpLeaderboard(mode, entries) {
  renderMpLeaderboardInto(mpLeaderboardListEl, mode, entries);
}

async function loadMpLeaderboardTab(mode) {
  mpLeaderboardListEl.innerHTML = '<li class="leaderboard-empty">불러오는 중...</li>';
  try {
    const { ok, data } = await fetchJson(`/api/multiplayer/leaderboard?mode=${mode}&limit=20`);
    if (!ok || !data) throw new Error("failed");
    renderMpLeaderboard(mode, data.entries);
  } catch {
    renderMpLeaderboard(mode, []);
  }
}

async function loadPracticeLeaderboardTab(difficulty) {
  practiceLeaderboardListEl.innerHTML = '<li class="leaderboard-empty">불러오는 중...</li>';
  try {
    const { ok, data } = await fetchJson(`/api/practice/leaderboard?difficulty=${difficulty}&limit=20`);
    if (!ok || !data) throw new Error("failed");
    renderLeaderboardEntries(practiceLeaderboardListEl, data.entries, "아직 등록된 기록이 없습니다");
  } catch {
    renderLeaderboardEntries(practiceLeaderboardListEl, [], "랭킹을 불러올 수 없습니다");
  }
}

document.getElementById("btn-mp-entry").addEventListener("click", () => {
  mpEntryMessageEl.textContent = "";
  mpJoinCodeInputEl.value = "";
  showScreen("mpEntry");
});

document.getElementById("btn-mp-entry-back").addEventListener("click", () => showScreen("title"));

document.getElementById("btn-mp-create-race").addEventListener("click", () => createMpRoom("race"));
document.getElementById("btn-mp-create-duel").addEventListener("click", () => createMpRoom("duel"));
document.getElementById("btn-mp-create-coop").addEventListener("click", () => createMpRoom("coop"));
document.getElementById("btn-mp-join").addEventListener("click", () => joinMpRoom());

btnMpStartEl.addEventListener("click", () => {
  if (mpSocket && mpSocket.readyState === WebSocket.OPEN) {
    mpSocket.send(JSON.stringify({ type: "start" }));
  }
});

document.getElementById("btn-mp-lobby-leave").addEventListener("click", () => {
  if (mpSocket) {
    try {
      mpSocket.close();
    } catch {
      // ignore
    }
  }
  showScreen("mpEntry");
});

document.getElementById("btn-mp-quit").addEventListener("click", () => {
  if (!confirm("게임을 포기하고 나가시겠습니까?")) return;
  if (mpSocket) {
    try {
      mpSocket.send(JSON.stringify({ type: "quit" }));
      mpSocket.close();
    } catch {
      // ignore
    }
  }
  if (mpTimer) mpTimer.stop();
  if (mpDragController) mpDragController.destroy();
  mpEnded = true;
  showScreen("title");
});

document.getElementById("btn-mp-result-rematch").addEventListener("click", () => {
  if (mpSocket) {
    try {
      mpSocket.close();
    } catch {
      // ignore
    }
  }
  mpEntryMessageEl.textContent = "";
  showScreen("mpEntry");
});

document.getElementById("btn-mp-result-title").addEventListener("click", () => {
  if (mpSocket) {
    try {
      mpSocket.close();
    } catch {
      // ignore
    }
  }
  showScreen("title");
});

document.getElementById("btn-view-mp-leaderboard").addEventListener("click", () => {
  showScreen("mpLeaderboard");
  loadMpLeaderboardTab("race");
});

document.getElementById("btn-mp-leaderboard-back").addEventListener("click", () => showScreen("title"));

document.getElementById("mp-tab-race").addEventListener("click", (e) => {
  document.querySelectorAll("#screen-mp-leaderboard .tab-button").forEach((b) => b.classList.remove("active"));
  e.target.classList.add("active");
  loadMpLeaderboardTab("race");
});

document.getElementById("mp-tab-duel").addEventListener("click", (e) => {
  document.querySelectorAll("#screen-mp-leaderboard .tab-button").forEach((b) => b.classList.remove("active"));
  e.target.classList.add("active");
  loadMpLeaderboardTab("duel");
});

document.getElementById("mp-tab-coop").addEventListener("click", (e) => {
  document.querySelectorAll("#screen-mp-leaderboard .tab-button").forEach((b) => b.classList.remove("active"));
  e.target.classList.add("active");
  loadMpLeaderboardTab("coop");
});

document.getElementById("title-mp-tab-race").addEventListener("click", (e) => {
  document.querySelectorAll(".title-mp-tabs .tab-button").forEach((b) => b.classList.remove("active"));
  e.target.classList.add("active");
  loadTitleMpRanking("race");
});

document.getElementById("title-mp-tab-duel").addEventListener("click", (e) => {
  document.querySelectorAll(".title-mp-tabs .tab-button").forEach((b) => b.classList.remove("active"));
  e.target.classList.add("active");
  loadTitleMpRanking("duel");
});

document.getElementById("title-mp-tab-coop").addEventListener("click", (e) => {
  document.querySelectorAll(".title-mp-tabs .tab-button").forEach((b) => b.classList.remove("active"));
  e.target.classList.add("active");
  loadTitleMpRanking("coop");
});

document.getElementById("btn-view-practice-leaderboard").addEventListener("click", () => {
  showScreen("practiceLeaderboard");
  loadPracticeLeaderboardTab("easy");
});

document.getElementById("btn-practice-leaderboard-back").addEventListener("click", () => showScreen("title"));

for (const key of PRACTICE_DIFFICULTY_KEYS) {
  document.getElementById(`practice-tab-${key}`).addEventListener("click", (e) => {
    document.querySelectorAll("#screen-practice-leaderboard .tab-button").forEach((b) => b.classList.remove("active"));
    e.target.classList.add("active");
    loadPracticeLeaderboardTab(key);
  });

  document.getElementById(`title-practice-tab-${key}`).addEventListener("click", (e) => {
    document.querySelectorAll(".title-practice-tabs .tab-button").forEach((b) => b.classList.remove("active"));
    e.target.classList.add("active");
    loadTitlePracticeRanking(key);
  });
}

refreshAccountStatus();
syncDailyStatus();
loadTop5();
loadTitleRanking();
loadTitleMpRanking("race");
loadTitlePracticeRanking("easy");
