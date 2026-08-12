-- Replace the anonymous clientId-based identity model with real
-- name+PIN accounts. Pre-launch scores table is rebuilt clean.

DROP TABLE IF EXISTS nicknames;

CREATE TABLE IF NOT EXISTS accounts (
  name TEXT PRIMARY KEY,
  pin_hash TEXT NOT NULL,
  pin_salt TEXT NOT NULL,
  failed_attempts INTEGER NOT NULL DEFAULT 0,
  locked_until TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS daily_plays (
  date TEXT NOT NULL,
  account_name TEXT NOT NULL,
  ip TEXT,
  started_at TEXT NOT NULL DEFAULT (datetime('now')),
  PRIMARY KEY (date, account_name)
);
CREATE INDEX IF NOT EXISTS idx_daily_plays_date_ip ON daily_plays (date, ip);

DROP TABLE IF EXISTS scores;

CREATE TABLE scores (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  date TEXT NOT NULL,
  account_name TEXT NOT NULL,
  score INTEGER NOT NULL,
  accuracy REAL NOT NULL DEFAULT 0,
  max_removal INTEGER NOT NULL DEFAULT 0,
  input_log TEXT NOT NULL,
  ip TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_scores_date_score ON scores (date, score DESC);
CREATE UNIQUE INDEX IF NOT EXISTS idx_scores_date_account ON scores (date, account_name);
CREATE INDEX IF NOT EXISTS idx_scores_account ON scores (account_name);
