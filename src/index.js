import {
  generateBoard,
  hashStringToSeed,
  getDailySeedString,
  TARGET_SUM,
} from "../public/js/board.js";

const GAME_DURATION_MS = 120_000;
const TIMING_GRACE_MS = 10_000;
const MAX_NICKNAME_LENGTH = 12;
const MAX_LEADERBOARD_LIMIT = 100;

function jsonResponse(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "content-type": "application/json; charset=utf-8" },
  });
}

function dailySeedFor(dateStr) {
  return hashStringToSeed(`daily:${dateStr}`);
}

function weekStartDate(dateStr) {
  const d = new Date(`${dateStr}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() - 6);
  return d.toISOString().slice(0, 10);
}

function replayLog(values, inputLog) {
  const removed = new Uint8Array(values.length);
  let score = 0;
  for (const entry of inputLog) {
    const indices = entry && entry.indices;
    if (!Array.isArray(indices) || indices.length === 0) continue;
    let sum = 0;
    const seen = new Set();
    for (const idx of indices) {
      if (typeof idx !== "number" || !Number.isInteger(idx) || idx < 0 || idx >= values.length) {
        return null;
      }
      if (seen.has(idx) || removed[idx]) return null;
      seen.add(idx);
      sum += values[idx];
    }
    if (sum !== TARGET_SUM) return null;
    for (const idx of indices) removed[idx] = 1;
    score += indices.length;
  }
  return score;
}

async function handleDailySeed(request) {
  const url = new URL(request.url);
  const date = url.searchParams.get("date") || getDailySeedString();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return jsonResponse({ error: "invalid date" }, 400);
  return jsonResponse({ date, seed: dailySeedFor(date) });
}

async function handleSubmitScore(request, env) {
  let body;
  try {
    body = await request.json();
  } catch {
    return jsonResponse({ error: "invalid json" }, 400);
  }

  const { date, nickname, clientId, score, inputLog } = body;

  if (typeof date !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    return jsonResponse({ error: "invalid date" }, 400);
  }
  const today = getDailySeedString();
  if (date !== today) {
    return jsonResponse({ error: "stale date" }, 400);
  }
  if (typeof clientId !== "string" || clientId.length < 8 || clientId.length > 64) {
    return jsonResponse({ error: "invalid clientId" }, 400);
  }
  const trimmedNickname = typeof nickname === "string" ? nickname.trim() : "";
  if (trimmedNickname.length === 0 || trimmedNickname.length > MAX_NICKNAME_LENGTH) {
    return jsonResponse({ error: "invalid nickname" }, 400);
  }
  if (typeof score !== "number" || !Number.isInteger(score) || score < 0) {
    return jsonResponse({ error: "invalid score" }, 400);
  }
  if (!Array.isArray(inputLog)) {
    return jsonResponse({ error: "invalid inputLog" }, 400);
  }
  const lastT = inputLog.length > 0 ? inputLog[inputLog.length - 1].t : 0;
  if (typeof lastT !== "number" || lastT < 0 || lastT > GAME_DURATION_MS + TIMING_GRACE_MS) {
    return jsonResponse({ error: "invalid timing" }, 400);
  }

  const seed = dailySeedFor(date);
  const { values } = generateBoard(seed);
  const verifiedScore = replayLog(values, inputLog);
  if (verifiedScore === null || verifiedScore !== score) {
    return jsonResponse({ error: "verification failed" }, 400);
  }

  const existingNick = await env.DB.prepare("SELECT client_id FROM nicknames WHERE name = ?")
    .bind(trimmedNickname)
    .first();
  if (existingNick && existingNick.client_id !== clientId) {
    return jsonResponse({ error: "nickname taken" }, 409);
  }

  try {
    if (!existingNick) {
      await env.DB.prepare("INSERT INTO nicknames (name, client_id) VALUES (?, ?)")
        .bind(trimmedNickname, clientId)
        .run();
    }
    await env.DB.prepare(
      "INSERT INTO scores (date, nickname, client_id, score, accuracy, max_removal, input_log) VALUES (?, ?, ?, ?, ?, ?, ?)"
    )
      .bind(
        date,
        trimmedNickname,
        clientId,
        score,
        typeof body.accuracy === "number" ? body.accuracy : 0,
        typeof body.maxRemoval === "number" ? body.maxRemoval : 0,
        JSON.stringify(inputLog)
      )
      .run();
  } catch (err) {
    if (String(err && err.message).includes("UNIQUE")) {
      return jsonResponse({ error: "already submitted today" }, 409);
    }
    throw err;
  }

  const rankRow = await env.DB.prepare(
    "SELECT COUNT(*) as rank FROM scores WHERE date = ? AND score > ?"
  )
    .bind(date, score)
    .first();
  const totalRow = await env.DB.prepare("SELECT COUNT(*) as total FROM scores WHERE date = ?")
    .bind(date)
    .first();

  return jsonResponse({
    ok: true,
    rank: (rankRow?.rank ?? 0) + 1,
    total: totalRow?.total ?? 1,
  });
}

async function handleLeaderboard(request, env) {
  const url = new URL(request.url);
  const period = url.searchParams.get("period") || "daily";
  const limitParam = parseInt(url.searchParams.get("limit") || "100", 10);
  const limit = Math.min(Math.max(1, Number.isNaN(limitParam) ? 100 : limitParam), MAX_LEADERBOARD_LIMIT);
  const today = getDailySeedString();

  let query;
  let params;
  if (period === "daily") {
    query =
      "SELECT nickname, score, created_at FROM scores WHERE date = ? ORDER BY score DESC, created_at ASC LIMIT ?";
    params = [today, limit];
  } else if (period === "weekly") {
    query =
      "SELECT nickname, MAX(score) as score, MIN(created_at) as created_at FROM scores WHERE date >= ? GROUP BY nickname ORDER BY score DESC LIMIT ?";
    params = [weekStartDate(today), limit];
  } else if (period === "alltime") {
    query =
      "SELECT nickname, MAX(score) as score, MIN(created_at) as created_at FROM scores GROUP BY nickname ORDER BY score DESC LIMIT ?";
    params = [limit];
  } else {
    return jsonResponse({ error: "invalid period" }, 400);
  }

  const { results } = await env.DB.prepare(query)
    .bind(...params)
    .all();
  return jsonResponse({ period, date: today, entries: results ?? [] });
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (url.pathname === "/api/daily-seed" && request.method === "GET") {
      return handleDailySeed(request);
    }
    if (url.pathname === "/api/scores" && request.method === "POST") {
      return handleSubmitScore(request, env);
    }
    if (url.pathname === "/api/leaderboard" && request.method === "GET") {
      return handleLeaderboard(request, env);
    }
    return env.ASSETS.fetch(request);
  },
};
