import { generateBoard, getDailySeedString, hashStringToSeed, ROWS, COLS, CELL_SIZE, CELL_COUNT } from "./board.js";
import { createDragController } from "./drag.js";
import { runCountdown, createGameTimer, GAME_DURATION_SECONDS } from "./timer.js";
import { createScoreTracker } from "./score.js";

const screens = {
  title: document.getElementById("screen-title"),
  game: document.getElementById("screen-game"),
  result: document.getElementById("screen-result"),
};

function showScreen(name) {
  for (const key of Object.keys(screens)) {
    screens[key].classList.toggle("active", key === name);
  }
}

const boardEl = document.getElementById("board");
const boardFrameEl = document.getElementById("board-frame");
const countdownOverlay = document.getElementById("countdown-overlay");
const scoreValueEl = document.getElementById("score-value");
const applesLeftValueEl = document.getElementById("apples-left-value");
const timerBarEl = document.getElementById("timer-bar");
const timerLabelEl = document.getElementById("timer-label");
const resultScoreEl = document.getElementById("result-score");
const resultAccuracyEl = document.getElementById("result-accuracy");
const resultMaxRemovalEl = document.getElementById("result-max-removal");
const resultReasonEl = document.getElementById("result-reason");

let removed = null;
let values = null;
let cellEls = [];
let centers = [];
let dragController = null;
let timer = null;
let scoreTracker = null;
let ended = false;

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

function effectiveValue(index) {
  return isRemoved(index) ? 0 : values[index];
}

function updateSidePanel() {
  scoreValueEl.textContent = String(scoreTracker.score);
  let left = 0;
  for (let i = 0; i < CELL_COUNT; i++) {
    if (!isRemoved(i)) left++;
  }
  applesLeftValueEl.textContent = String(left);
  return left;
}

function onDragCommit(includedIndices) {
  if (ended) return;
  scoreTracker.recordDrag(includedIndices.length);
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
  showScreen("result");
}

function startGame(seed) {
  ended = false;
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
      dragController = createDragController({
        boardEl,
        frameEl: boardFrameEl,
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

document.getElementById("btn-daily").addEventListener("click", () => {
  const seed = hashStringToSeed(`daily:${getDailySeedString()}`);
  startGame(seed);
});

document.getElementById("btn-practice").addEventListener("click", () => {
  const seed = (Math.random() * 0xffffffff) >>> 0;
  startGame(seed);
});

document.getElementById("btn-quit").addEventListener("click", () => {
  if (confirm("게임을 포기하시겠습니까?")) {
    endGame("quit");
  }
});

document.getElementById("btn-retry").addEventListener("click", () => {
  showScreen("title");
});
