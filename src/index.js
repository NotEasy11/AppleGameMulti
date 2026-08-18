import {
  generateBoard,
  hashStringToSeed,
  getDailySeedString,
  TARGET_SUM,
} from "../public/js/board.js";
import { GameRoom } from "./gameRoom.js";

export { GameRoom };

const GAME_DURATION_MS = 120_000;
const TIMING_GRACE_MS = 10_000;
const MAX_NAME_LENGTH = 12;
const MAX_LEADERBOARD_LIMIT = 100;
const MAX_LOGIN_ATTEMPTS = 5;
const LOGIN_LOCK_MS = 5 * 60 * 1000;
const PIN_PATTERN = /^\d{4,8}$/;
const ROOM_CODE_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
const ROOM_CODE_LENGTH = 6;
const MAX_ROOM_CODE_ATTEMPTS = 10;

function jsonResponse(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      "content-type": "application/json; charset=utf-8",
      "cache-control": "no-store",
    },
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
    "SELECT pin_hash, pin_salt, failed_attempts, locked_until, is_admin FROM accounts WHERE name = ?"
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

  return { ok: true, name: trimmed, isAdmin: !!row.is_admin };
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

  return jsonResponse({ ok: true, name: trimmed, isAdmin: false });
}

async function handleLogin(request, env) {
  const body = await safeJson(request);
  if (!body) return jsonResponse({ error: "invalid json" }, 400);
  const auth = await verifyAccount(env, body.name, body.pin);
  if (!auth.ok) return jsonResponse({ error: auth.error }, auth.status);
  return jsonResponse({ ok: true, name: auth.name, isAdmin: auth.isAdmin });
}

async function handleAdminClearScores(request, env) {
  const body = await safeJson(request);
  if (!body) return jsonResponse({ error: "invalid json" }, 400);
  const auth = await verifyAccount(env, body.name, body.pin);
  if (!auth.ok) return jsonResponse({ error: auth.error }, auth.status);
  if (!auth.isAdmin) return jsonResponse({ error: "forbidden" }, 403);

  const { date } = body;
  if (date !== undefined && date !== null && date !== "") {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return jsonResponse({ error: "invalid date" }, 400);
    await env.DB.prepare("DELETE FROM scores WHERE date = ?").bind(date).run();
    return jsonResponse({ ok: true, cleared: date });
  }

  await env.DB.prepare("DELETE FROM scores").run();
  return jsonResponse({ ok: true, cleared: "all" });
}

async function handleAdminResetDaily(request, env) {
  const body = await safeJson(request);
  if (!body) return jsonResponse({ error: "invalid json" }, 400);
  const auth = await verifyAccount(env, body.name, body.pin);
  if (!auth.ok) return jsonResponse({ error: auth.error }, auth.status);
  if (!auth.isAdmin) return jsonResponse({ error: "forbidden" }, 403);

  const targetName = validateName(body.targetName);
  if (!targetName) return jsonResponse({ error: "invalid targetName" }, 400);
  const date =
    typeof body.date === "string" && /^\d{4}-\d{2}-\d{2}$/.test(body.date) ? body.date : getDailySeedString();

  await env.DB.prepare("DELETE FROM daily_plays WHERE date = ? AND account_name = ?")
    .bind(date, targetName)
    .run();
  await env.DB.prepare("DELETE FROM scores WHERE date = ? AND account_name = ?")
    .bind(date, targetName)
    .run();

  return jsonResponse({ ok: true, date, targetName });
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

async function handleDailyStatus(request, env) {
  const body = await safeJson(request);
  if (!body) return jsonResponse({ error: "invalid json" }, 400);
  const auth = await verifyAccount(env, body.name, body.pin);
  if (!auth.ok) return jsonResponse({ error: auth.error }, auth.status);

  const today = getDailySeedString();
  const existingByAccount = await env.DB.prepare(
    "SELECT 1 FROM daily_plays WHERE date = ? AND account_name = ?"
  )
    .bind(today, auth.name)
    .first();

  return jsonResponse({ ok: true, date: today, alreadyPlayed: !!existingByAccount });
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
      "SELECT account_name as nickname, score, date, created_at FROM scores WHERE date = ? ORDER BY score DESC, created_at ASC LIMIT ?";
    params = [today, limit];
  } else if (period === "weekly") {
    query =
      "SELECT nickname, score, date, created_at FROM (" +
      "SELECT account_name as nickname, score, date, created_at, " +
      "ROW_NUMBER() OVER (PARTITION BY account_name ORDER BY score DESC, created_at ASC) as rn " +
      "FROM scores WHERE date >= ?" +
      ") WHERE rn = 1 ORDER BY score DESC LIMIT ?";
    params = [weekStartDate(today), limit];
  } else if (period === "alltime") {
    query =
      "SELECT nickname, score, date, created_at FROM (" +
      "SELECT account_name as nickname, score, date, created_at, " +
      "ROW_NUMBER() OVER (PARTITION BY account_name ORDER BY score DESC, created_at ASC) as rn " +
      "FROM scores" +
      ") WHERE rn = 1 ORDER BY score DESC LIMIT ?";
    params = [limit];
  } else {
    return jsonResponse({ error: "invalid period" }, 400);
  }

  const { results } = await env.DB.prepare(query)
    .bind(...params)
    .all();
  return jsonResponse({ period, date: today, entries: results ?? [] });
}

function generateRoomCode() {
  let code = "";
  for (let i = 0; i < ROOM_CODE_LENGTH; i++) {
    code += ROOM_CODE_ALPHABET[Math.floor(Math.random() * ROOM_CODE_ALPHABET.length)];
  }
  return code;
}

async function handleCreateRoom(request, env) {
  const body = await safeJson(request);
  if (!body) return jsonResponse({ error: "invalid json" }, 400);
  const auth = await verifyAccount(env, body.name, body.pin);
  if (!auth.ok) return jsonResponse({ error: auth.error }, auth.status);

  const mode = body.mode;
  if (mode !== "race" && mode !== "coop") return jsonResponse({ error: "invalid mode" }, 400);

  for (let attempt = 0; attempt < MAX_ROOM_CODE_ATTEMPTS; attempt++) {
    const code = generateRoomCode();
    const id = env.GAME_ROOM.idFromName(code);
    const stub = env.GAME_ROOM.get(id);
    const res = await stub.fetch("https://room/init", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ code, mode, hostName: auth.name }),
    });
    if (res.ok) {
      return jsonResponse({ ok: true, code, mode });
    }
  }
  return jsonResponse({ error: "failed to create room" }, 500);
}

async function handleRoomWebSocket(request, env, code) {
  const url = new URL(request.url);
  const name = url.searchParams.get("name");
  const pin = url.searchParams.get("pin");
  const auth = await verifyAccount(env, name, pin);
  if (!auth.ok) return jsonResponse({ error: auth.error }, auth.status);

  const id = env.GAME_ROOM.idFromName(code.toUpperCase());
  const stub = env.GAME_ROOM.get(id);
  const forwardUrl = new URL("https://room/ws");
  forwardUrl.searchParams.set("name", auth.name);
  return stub.fetch(forwardUrl.toString(), request);
}

async function handleMultiplayerLeaderboard(request, env) {
  const url = new URL(request.url);
  const mode = url.searchParams.get("mode") || "race";
  const limitParam = parseInt(url.searchParams.get("limit") || "20", 10);
  const limit = Math.min(Math.max(1, Number.isNaN(limitParam) ? 20 : limitParam), MAX_LEADERBOARD_LIMIT);

  if (mode === "race") {
    const { results } = await env.DB.prepare(
      "SELECT winner_name as nickname, COUNT(*) as wins FROM multiplayer_matches " +
        "WHERE mode = 'race' AND winner_name IS NOT NULL " +
        "GROUP BY winner_name ORDER BY wins DESC LIMIT ?"
    )
      .bind(limit)
      .all();
    return jsonResponse({ mode, entries: results ?? [] });
  }

  if (mode === "coop") {
    const { results } = await env.DB.prepare(
      "SELECT player1_name, player2_name, player1_score as score, created_at " +
        "FROM multiplayer_matches WHERE mode = 'coop' ORDER BY score DESC, created_at ASC LIMIT ?"
    )
      .bind(limit)
      .all();
    return jsonResponse({ mode, entries: results ?? [] });
  }

  return jsonResponse({ error: "invalid mode" }, 400);
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
    if (url.pathname === "/api/daily-status" && request.method === "POST") {
      return handleDailyStatus(request, env);
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
    if (url.pathname === "/api/admin/clear-scores" && request.method === "POST") {
      return handleAdminClearScores(request, env);
    }
    if (url.pathname === "/api/admin/reset-daily" && request.method === "POST") {
      return handleAdminResetDaily(request, env);
    }
    if (url.pathname === "/api/multiplayer/rooms" && request.method === "POST") {
      return handleCreateRoom(request, env);
    }
    if (url.pathname === "/api/multiplayer/leaderboard" && request.method === "GET") {
      return handleMultiplayerLeaderboard(request, env);
    }
    const roomWsMatch = url.pathname.match(/^\/api\/multiplayer\/rooms\/([A-Z0-9]{6})\/ws$/i);
    if (roomWsMatch) {
      return handleRoomWebSocket(request, env, roomWsMatch[1]);
    }
    return env.ASSETS.fetch(request);
  },
};
