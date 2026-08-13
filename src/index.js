import {
  generateBoard,
  hashStringToSeed,
  getDailySeedString,
  TARGET_SUM,
} from "../public/js/board.js";

const GAME_DURATION_MS = 120_000;
const TIMING_GRACE_MS = 10_000;
const MAX_NAME_LENGTH = 12;
const MAX_LEADERBOARD_LIMIT = 100;
const MAX_LOGIN_ATTEMPTS = 5;
const LOGIN_LOCK_MS = 5 * 60 * 1000;
const PIN_PATTERN = /^\d{4,8}$/;

function jsonResponse(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "content-type": "application/json; charset=utf-8" },
  });
}

async function safeJson(request) {
  try {
    return await request.json();
  } catch {
    return null;
  }
}

function getIp(request) {
  return request.headers.get("cf-connecting-ip") || "unknown";
}

function dailySeedFor(dateStr) {
  return hashStringToSeed(`daily:${dateStr}`);
}

function weekStartDate(dateStr) {
  const d = new Date(`${dateStr}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() - 6);
  return d.toISOString().slice(0, 10);
}

function toHex(buffer) {
  return [...new Uint8Array(buffer)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

function generateSalt() {
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  return toHex(bytes.buffer);
}

async function hashPin(pin, salt) {
  const data = new TextEncoder().encode(`${salt}:${pin}`);
  const digest = await crypto.subtle.digest("SHA-256", data);
  return toHex(digest);
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

function validateName(name) {
  const trimmed = typeof name === "string" ? name.trim() : "";
  if (trimmed.length === 0 || trimmed.length > MAX_NAME_LENGTH) return null;
  return trimmed;
}

async function verifyAccount(env, name, pin) {
  const trimmed = validateName(name);
  if (!trimmed) return { ok: false, status: 400, error: "invalid name" };
  if (typeof pin !== "string" || !PIN_PATTERN.test(pin)) {
    return { ok: false, status: 400, error: "invalid pin" };
  }

  const row = await env.DB.prepare(
    "SELECT pin_hash, pin_salt, failed_attempts, locked_until FROM accounts WHERE name = ?"
  )
    .bind(trimmed)
    .first();
  if (!row) return { ok: false, status: 404, error: "account not found" };

  if (row.locked_until && new Date(row.locked_until).getTime() > Date.now()) {
    return { ok: false, status: 423, error: "account locked" };
  }

  const hash = await hashPin(pin, row.pin_salt);
  if (hash !== row.pin_hash) {
    const attempts = (row.failed_attempts || 0) + 1;
    const lockUntil = attempts >= MAX_LOGIN_ATTEMPTS ? new Date(Date.now() + LOGIN_LOCK_MS).toISOString() : null;
    await env.DB.prepare("UPDATE accounts SET failed_attempts = ?, locked_until = ? WHERE name = ?")
      .bind(attempts, lockUntil, trimmed)
      .run();
    return { ok: false, status: 401, error: "invalid pin" };
  }

  if (row.failed_attempts > 0 || row.locked_until) {
    await env.DB.prepare("UPDATE accounts SET failed_attempts = 0, locked_until = NULL WHERE name = ?")
      .bind(trimmed)
      .run();
  }

  return { ok: true, name: trimmed };
}

async function handleRegister(request, env) {
  const body = await safeJson(request);
  if (!body) return jsonResponse({ error: "invalid json" }, 400);
  const { name, pin } = body;

  const trimmed = validateName(name);
  if (!trimmed) return jsonResponse({ error: "invalid name" }, 400);
  if (typeof pin !== "string" || !PIN_PATTERN.test(pin)) {
    return jsonResponse({ error: "invalid pin" }, 400);
  }

  const existing = await env.DB.prepare("SELECT 1 FROM accounts WHERE name = ?").bind(trimmed).first();
  if (existing) return jsonResponse({ error: "name taken" }, 409);

  const salt = generateSalt();
  const hash = await hashPin(pin, salt);
  await env.DB.prepare("INSERT INTO accounts (name, pin_hash, pin_salt) VALUES (?, ?, ?)")
    .bind(trimmed, hash, salt)
    .run();

  return jsonResponse({ ok: true, name: trimmed });
}

async function handleLogin(request, env) {
  const body = await safeJson(request);
  if (!body) return jsonResponse({ error: "invalid json" }, 400);
  const auth = await verifyAccount(env, body.name, body.pin);
  if (!auth.ok) return jsonResponse({ error: auth.error }, auth.status);
  return jsonResponse({ ok: true, name: auth.name });
}

async function handleDailyStart(request, env) {
  const body = await safeJson(request);
  if (!body) return jsonResponse({ error: "invalid json" }, 400);
  const auth = await verifyAccount(env, body.name, body.pin);
  if (!auth.ok) return jsonResponse({ error: auth.error }, auth.status);

  const today = getDailySeedString();
  if (body.date !== today) return jsonResponse({ error: "stale date" }, 400);

  const ip = getIp(request);

  const existingByAccount = await env.DB.prepare(
    "SELECT 1 FROM daily_plays WHERE date = ? AND account_name = ?"
  )
    .bind(today, auth.name)
    .first();
  if (existingByAccount) return jsonResponse({ error: "already played today" }, 409);

  try {
    await env.DB.prepare("INSERT INTO daily_plays (date, account_name, ip) VALUES (?, ?, ?)")
      .bind(today, auth.name, ip)
      .run();
  } catch (err) {
    if (String(err && err.message).includes("UNIQUE")) {
      return jsonResponse({ error: "already played today" }, 409);
    }
    throw err;
  }

  return jsonResponse({ ok: true, date: today, seed: dailySeedFor(today) });
}

async function handleDailySeed(request) {
  const url = new URL(request.url);
  const date = url.searchParams.get("date") || getDailySeedString();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return jsonResponse({ error: "invalid date" }, 400);
  return jsonResponse({ date, seed: dailySeedFor(date) });
}

async function handleSubmitScore(request, env) {
  const body = await safeJson(request);
  if (!body) return jsonResponse({ error: "invalid json" }, 400);

  const auth = await verifyAccount(env, body.name, body.pin);
  if (!auth.ok) return jsonResponse({ error: auth.error }, auth.status);

  const { date, score, inputLog } = body;
  if (typeof date !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    return jsonResponse({ error: "invalid date" }, 400);
  }
  const today = getDailySeedString();
  if (date !== today) return jsonResponse({ error: "stale date" }, 400);
  if (typeof score !== "number" || !Number.isInteger(score) || score < 0) {
    return jsonResponse({ error: "invalid score" }, 400);
  }
  if (!Array.isArray(inputLog)) return jsonResponse({ error: "invalid inputLog" }, 400);
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

  const ip = getIp(request);

  try {
    await env.DB.prepare(
      "INSERT INTO scores (date, account_name, score, accuracy, max_removal, input_log, ip) VALUES (?, ?, ?, ?, ?, ?, ?)"
    )
      .bind(
        date,
        auth.name,
        score,
        typeof body.accuracy === "number" ? body.accuracy : 0,
        typeof body.maxRemoval === "number" ? body.maxRemoval : 0,
        JSON.stringify(inputLog),
        ip
      )
      .run();
  } catch (err) {
    if (String(err && err.message).includes("UNIQUE")) {
      return jsonResponse({ error: "already submitted today" }, 409);
    }
    throw err;
  }

  const rankRow = await env.DB.prepare("SELECT COUNT(*) as rank FROM scores WHERE date = ? AND score > ?")
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
      "SELECT account_name as nickname, score, created_at FROM scores WHERE date = ? ORDER BY score DESC, created_at ASC LIMIT ?";
    params = [today, limit];
  } else if (period === "weekly") {
    query =
      "SELECT account_name as nickname, MAX(score) as score, MIN(created_at) as created_at FROM scores WHERE date >= ? GROUP BY account_name ORDER BY score DESC LIMIT ?";
    params = [weekStartDate(today), limit];
  } else if (period === "alltime") {
    query =
      "SELECT account_name as nickname, MAX(score) as score, MIN(created_at) as created_at FROM scores GROUP BY account_name ORDER BY score DESC LIMIT ?";
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
    if (url.pathname === "/api/account/register" && request.method === "POST") {
      return handleRegister(request, env);
    }
    if (url.pathname === "/api/account/login" && request.method === "POST") {
      return handleLogin(request, env);
    }
    if (url.pathname === "/api/daily-start" && request.method === "POST") {
      return handleDailyStart(request, env);
    }
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
