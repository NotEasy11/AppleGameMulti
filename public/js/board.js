export const ROWS = 12;
export const COLS = 19;
export const CELL_COUNT = ROWS * COLS;
export const CELL_SIZE = 44;
export const TARGET_SUM = 10;
export const MIN_VALID_RECTS = 30;
export const MAX_GENERATION_ATTEMPTS = 200;

export function mulberry32(seed) {
  let a = seed >>> 0;
  return function () {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function hashStringToSeed(str) {
  let hash = 5381;
  for (let i = 0; i < str.length; i++) {
    hash = ((hash << 5) + hash + str.charCodeAt(i)) | 0;
  }
  return hash >>> 0;
}

export function getDailySeedString(date = new Date()) {
  // date.getTime() is always a timezone-agnostic UTC epoch, so a flat
  // +9h shift gives the correct KST calendar date regardless of the
  // caller's own local timezone. (Do NOT factor in
  // date.getTimezoneOffset() here - that double-counts the caller's
  // local offset and produces a wrong date for any non-UTC caller.)
  const kst = new Date(date.getTime() + 9 * 60 * 60000);
  return kst.toISOString().slice(0, 10);
}

function generateValues(rng) {
  const values = new Uint8Array(CELL_COUNT);
  for (let i = 0; i < CELL_COUNT; i++) {
    values[i] = 1 + Math.floor(rng() * 9);
  }
  return values;
}

function buildPrefixSum(values) {
  const prefix = new Int32Array((ROWS + 1) * (COLS + 1));
  const stride = COLS + 1;
  for (let r = 0; r < ROWS; r++) {
    for (let c = 0; c < COLS; c++) {
      const above = prefix[r * stride + (c + 1)];
      const left = prefix[(r + 1) * stride + c];
      const topLeft = prefix[r * stride + c];
      prefix[(r + 1) * stride + (c + 1)] = above + left - topLeft + values[r * COLS + c];
    }
  }
  return prefix;
}

function rectSum(prefix, r1, c1, r2, c2) {
  const stride = COLS + 1;
  return (
    prefix[(r2 + 1) * stride + (c2 + 1)] -
    prefix[r1 * stride + (c2 + 1)] -
    prefix[(r2 + 1) * stride + c1] +
    prefix[r1 * stride + c1]
  );
}

export function countValidRects(prefix) {
  let count = 0;
  for (let r1 = 0; r1 < ROWS; r1++) {
    for (let r2 = r1; r2 < ROWS; r2++) {
      for (let c1 = 0; c1 < COLS; c1++) {
        for (let c2 = c1; c2 < COLS; c2++) {
          if (rectSum(prefix, r1, c1, r2, c2) === TARGET_SUM) count++;
        }
      }
    }
  }
  return count;
}

export function generateBoard(seed) {
  for (let attempt = 0; attempt < MAX_GENERATION_ATTEMPTS; attempt++) {
    const rng = mulberry32((seed + attempt * 2654435761) >>> 0);
    const values = generateValues(rng);
    const prefix = buildPrefixSum(values);
    const validCount = countValidRects(prefix);
    if (validCount >= MIN_VALID_RECTS) {
      return { values, seed, attempt, validCount };
    }
  }
  throw new Error("Failed to generate a valid board within attempt budget");
}
