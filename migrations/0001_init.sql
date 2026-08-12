CREATE TABLE IF NOT EXISTS nicknames (
  name TEXT PRIMARY KEY,
  client_id TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS scores (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  date TEXT NOT NULL,
  nickname TEXT NOT NULL,
  client_id TEXT NOT NULL,
  score INTEGER NOT NULL,
  accuracy REAL NOT NULL DEFAULT 0,
  max_removal INTEGER NOT NULL DEFAULT 0,
  input_log TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_scores_date_score ON scores (date, score DESC);
CREATE UNIQUE INDEX IF NOT EXISTS idx_scores_date_client ON scores (date, client_id);
CREATE INDEX IF NOT EXISTS idx_scores_nickname ON scores (nickname);
