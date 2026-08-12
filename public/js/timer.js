export const GAME_DURATION_SECONDS = 120;
export const URGENT_THRESHOLD_SECONDS = 10;
export const COUNTDOWN_STEPS = [3, 2, 1];
export const COUNTDOWN_STEP_MS = 700;

export function runCountdown(onStep, onDone) {
  let i = 0;
  function next() {
    if (i >= COUNTDOWN_STEPS.length) {
      onDone();
      return;
    }
    onStep(COUNTDOWN_STEPS[i]);
    i++;
    setTimeout(next, COUNTDOWN_STEP_MS);
  }
  next();
}

export function createGameTimer({ durationSeconds = GAME_DURATION_SECONDS, onTick, onExpire }) {
  let remaining = durationSeconds;
  let intervalId = null;

  function tick() {
    remaining -= 1;
    const urgent = remaining <= URGENT_THRESHOLD_SECONDS;
    onTick(remaining, urgent);
    if (remaining <= 0) {
      stop();
      onExpire();
    }
  }

  function start() {
    onTick(remaining, remaining <= URGENT_THRESHOLD_SECONDS);
    intervalId = setInterval(tick, 1000);
  }

  function stop() {
    if (intervalId !== null) {
      clearInterval(intervalId);
      intervalId = null;
    }
  }

  return { start, stop, get remaining() { return remaining; } };
}
