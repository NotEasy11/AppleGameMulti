CREATE TABLE IF NOT EXISTS multiplayer_matches (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  mode TEXT NOT NULL CHECK (mode IN ('race', 'coop')),
  room_code TEXT NOT NULL,
  player1_name TEXT NOT NULL,
  player1_score INTEGER NOT NULL,
  player2_name TEXT NOT NULL,
  player2_score INTEGER NOT NULL,
  winner_name TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_mp_matches_mode ON multiplayer_matches (mode);
