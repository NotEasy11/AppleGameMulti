import { generateBoard, TARGET_SUM } from "../public/js/board.js";

const GAME_DURATION_MS = 120_000;

function defaultRoom() {
  return {
    mode: null,
    status: "empty", // empty | lobby | playing | finished
    code: null,
    hostName: null,
    guestName: null,
    seed: null,
    startedAt: null,
  };
}

function jsonResponse(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" },
  });
}

export class GameRoom {
  constructor(state, env) {
    this.state = state;
    this.env = env;
    this.sockets = new Map(); // ws -> { name, role }
    this.values = null;
    this.removed = null;
    this.coopScore = 0;
    this.duelScores = { host: 0, guest: 0 };
    this.raceResults = new Map(); // role -> { name, score, inputLog }
    this.room = defaultRoom();
    this.loaded = this.state.blockConcurrencyWhile(async () => {
      const stored = await this.state.storage.get("room");
      if (stored) this.room = stored;
    });
  }

  async persist() {
    await this.state.storage.put("room", this.room);
  }

  async fetch(request) {
    await this.loaded;
    const url = new URL(request.url);

    if (url.pathname === "/init" && request.method === "POST") {
      return this.handleInit(request);
    }
    if (url.pathname === "/ws") {
      return this.handleWebSocketUpgrade(request);
    }
    return jsonResponse({ error: "not found" }, 404);
  }

  async handleInit(request) {
    if (this.room.status === "lobby" || this.room.status === "playing") {
      return jsonResponse({ error: "room in use" }, 409);
    }
    const body = await request.json().catch(() => null);
    if (!body || !body.code || !body.hostName || !["race", "coop", "duel"].includes(body.mode)) {
      return jsonResponse({ error: "invalid init" }, 400);
    }
    this.room = {
      mode: body.mode,
      status: "lobby",
      code: body.code,
      hostName: body.hostName,
      guestName: null,
      seed: null,
      startedAt: null,
    };
    this.values = null;
    this.removed = null;
    this.coopScore = 0;
    this.duelScores = { host: 0, guest: 0 };
    this.raceResults = new Map();
    await this.persist();
    return jsonResponse({ ok: true });
  }

  async handleWebSocketUpgrade(request) {
    const url = new URL(request.url);
    const name = url.searchParams.get("name");
    if (!name) return jsonResponse({ error: "missing name" }, 400);

    if (this.room.status === "empty") {
      return jsonResponse({ error: "room not found" }, 404);
    }

    let role;
    if (name === this.room.hostName) {
      role = "host";
    } else if (this.room.guestName === null && this.room.status === "lobby") {
      role = "guest";
      this.room.guestName = name;
      await this.persist();
    } else if (name === this.room.guestName) {
      role = "guest";
    } else {
      return jsonResponse({ error: "room full" }, 409);
    }

    // Replace any stale existing connection for this role (e.g. a page refresh).
    for (const [existingWs, existingInfo] of this.sockets.entries()) {
      if (existingInfo.role === role) {
        this.sockets.delete(existingWs);
        try {
          existingWs.close();
        } catch {
          // ignore
        }
      }
    }

    const pair = new WebSocketPair();
    const [client, server] = Object.values(pair);
    server.accept();
    this.sockets.set(server, { name, role });

    server.addEventListener("message", (evt) => this.handleMessage(server, evt));
    server.addEventListener("close", () => this.handleClose(server));
    server.addEventListener("error", () => this.handleClose(server));

    this.broadcastRoster();

    return new Response(null, { status: 101, webSocket: client });
  }

  send(ws, msg) {
    try {
      ws.send(JSON.stringify(msg));
    } catch {
      // ignore
    }
  }

  broadcast(msg, exclude) {
    for (const ws of this.sockets.keys()) {
      if (ws === exclude) continue;
      this.send(ws, msg);
    }
  }

  broadcastRoster() {
    this.broadcast({
      type: "roster",
      mode: this.room.mode,
      status: this.room.status,
      hostName: this.room.hostName,
      guestName: this.room.guestName,
    });
  }

  handleClose(ws) {
    const info = this.sockets.get(ws);
    this.sockets.delete(ws);
    if (!info) return;

    if (this.room.status === "lobby" && info.role === "guest") {
      // Reopen the guest slot so someone else can join.
      this.room.guestName = null;
      this.persist().catch(() => {});
      this.broadcastRoster();
      return;
    }

    this.broadcast({ type: "opponent_left", role: info.role });

    if (this.room.status === "playing") {
      if (this.room.mode === "coop") {
        this.finishCoop("opponent_disconnected").catch(() => {});
      } else if (this.room.mode === "duel") {
        this.finishDuel("opponent_disconnected").catch(() => {});
      } else if (this.room.mode === "race" && !this.raceResults.has(info.role)) {
        this.raceResults.set(info.role, { name: info.name, score: 0, inputLog: [] });
        if (this.raceResults.size >= 2) {
          this.finishRace().catch(() => {});
        }
      }
    }
  }

  async handleMessage(ws, evt) {
    let msg;
    try {
      msg = JSON.parse(evt.data);
    } catch {
      return;
    }
    const info = this.sockets.get(ws);
    if (!info) return;

    if (msg.type === "start" && info.role === "host" && this.room.status === "lobby") {
      if (!this.room.guestName) return;
      const seed = Math.floor(Math.random() * 0xffffffff);
      const board = generateBoard(seed);
      this.values = board.values;
      this.removed = new Uint8Array(this.values.length);
      this.coopScore = 0;
      this.duelScores = { host: 0, guest: 0 };
      this.raceResults = new Map();
      this.room.seed = seed;
      this.room.startedAt = Date.now();
      this.room.status = "playing";
      await this.persist();
      this.broadcast({
        type: "game_start",
        mode: this.room.mode,
        seed,
        durationMs: GAME_DURATION_MS,
      });
      return;
    }

    if (
      msg.type === "try_remove" &&
      (this.room.mode === "coop" || this.room.mode === "duel") &&
      this.room.status === "playing"
    ) {
      const indices = Array.isArray(msg.indices) ? msg.indices : [];
      let sum = 0;
      let valid = indices.length > 0;
      for (const idx of indices) {
        if (
          typeof idx !== "number" ||
          !Number.isInteger(idx) ||
          idx < 0 ||
          idx >= this.values.length ||
          this.removed[idx]
        ) {
          valid = false;
          break;
        }
        sum += this.values[idx];
      }
      if (valid && sum === TARGET_SUM) {
        for (const idx of indices) this.removed[idx] = 1;
        if (this.room.mode === "coop") {
          this.coopScore += indices.length;
          this.broadcast({ type: "removed", indices, by: info.role, mode: "coop", score: this.coopScore });
        } else {
          this.duelScores[info.role] += indices.length;
          this.broadcast({
            type: "removed",
            indices,
            by: info.role,
            mode: "duel",
            hostScore: this.duelScores.host,
            guestScore: this.duelScores.guest,
          });
        }
        let allRemoved = true;
        for (let i = 0; i < this.removed.length; i++) {
          if (!this.removed[i]) {
            allRemoved = false;
            break;
          }
        }
        if (allRemoved) {
          if (this.room.mode === "coop") await this.finishCoop("perfect");
          else await this.finishDuel("perfect");
        }
      } else {
        this.send(ws, { type: "rejected" });
      }
      return;
    }

    if (msg.type === "score_update" && this.room.mode === "race" && this.room.status === "playing") {
      this.broadcast({ type: "opponent_score", role: info.role, score: msg.score }, ws);
      return;
    }

    if (msg.type === "final_result" && this.room.status === "playing") {
      if (this.room.mode === "race") {
        this.raceResults.set(info.role, {
          name: info.name,
          score: typeof msg.score === "number" ? msg.score : 0,
          inputLog: Array.isArray(msg.inputLog) ? msg.inputLog : [],
        });
        if (this.raceResults.size >= 2) {
          await this.finishRace();
        }
      } else if (this.room.mode === "coop") {
        this.raceResults.set(info.role, { name: info.name, score: this.coopScore });
        if (this.raceResults.size >= 2) {
          await this.finishCoop("timeup");
        }
      } else if (this.room.mode === "duel") {
        this.raceResults.set(info.role, { name: info.name });
        if (this.raceResults.size >= 2) {
          await this.finishDuel("timeup");
        }
      }
      return;
    }

    if (msg.type === "quit") {
      this.broadcast({ type: "opponent_left", role: info.role }, ws);
      return;
    }
  }

  verifyScore(claimedScore, inputLog) {
    if (!Array.isArray(inputLog)) return 0;
    const removed = new Uint8Array(this.values.length);
    let score = 0;
    for (const entry of inputLog) {
      const indices = entry && entry.indices;
      if (!Array.isArray(indices) || indices.length === 0) continue;
      let sum = 0;
      const seen = new Set();
      let ok = true;
      for (const idx of indices) {
        if (typeof idx !== "number" || !Number.isInteger(idx) || idx < 0 || idx >= this.values.length) {
          ok = false;
          break;
        }
        if (seen.has(idx) || removed[idx]) {
          ok = false;
          break;
        }
        seen.add(idx);
        sum += this.values[idx];
      }
      if (!ok || sum !== TARGET_SUM) continue;
      for (const idx of indices) removed[idx] = 1;
      score += indices.length;
    }
    return score;
  }

  async finishRace() {
    if (this.room.status === "finished") return;
    this.room.status = "finished";
    await this.persist();

    const host = this.raceResults.get("host") || { name: this.room.hostName, score: 0, inputLog: [] };
    const guest = this.raceResults.get("guest") || { name: this.room.guestName, score: 0, inputLog: [] };
    const verifiedHost = this.verifyScore(host.score, host.inputLog);
    const verifiedGuest = this.verifyScore(guest.score, guest.inputLog);

    let winnerName = null;
    if (verifiedHost > verifiedGuest) winnerName = this.room.hostName;
    else if (verifiedGuest > verifiedHost) winnerName = this.room.guestName;

    await this.recordMatch({
      player1Score: verifiedHost,
      player2Score: verifiedGuest,
      winnerName,
    });

    this.broadcast({
      type: "game_over",
      mode: "race",
      hostScore: verifiedHost,
      guestScore: verifiedGuest,
      winnerName,
    });
  }

  async finishCoop(reason) {
    if (this.room.status === "finished") return;
    this.room.status = "finished";
    await this.persist();

    await this.recordMatch({
      player1Score: this.coopScore,
      player2Score: this.coopScore,
      winnerName: null,
    });

    this.broadcast({ type: "game_over", mode: "coop", score: this.coopScore, reason });
  }

  async finishDuel(reason) {
    if (this.room.status === "finished") return;
    this.room.status = "finished";
    await this.persist();

    const hostScore = this.duelScores.host;
    const guestScore = this.duelScores.guest;
    let winnerName = null;
    if (hostScore > guestScore) winnerName = this.room.hostName;
    else if (guestScore > hostScore) winnerName = this.room.guestName;

    await this.recordMatch({ player1Score: hostScore, player2Score: guestScore, winnerName });

    this.broadcast({ type: "game_over", mode: "duel", hostScore, guestScore, winnerName, reason });
  }

  async recordMatch({ player1Score, player2Score, winnerName }) {
    try {
      await this.env.DB.prepare(
        "INSERT INTO multiplayer_matches (mode, room_code, player1_name, player1_score, player2_name, player2_score, winner_name) VALUES (?, ?, ?, ?, ?, ?, ?)"
      )
        .bind(
          this.room.mode,
          this.room.code || "",
          this.room.hostName || "",
          player1Score || 0,
          this.room.guestName || "",
          player2Score || 0,
          winnerName
        )
        .run();
    } catch {
      // best-effort; do not block game-over broadcast on write failure
    }
  }
}
