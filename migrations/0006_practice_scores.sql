CREATE TABLE IF NOT EXISTS practice_scores (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  difficulty TEXT NOT NULL,
  account_name TEXT NOT NULL,
  score INTEGER NOT NULL,
  accuracy REAL NOT NULL DEFAULT 0,
  max_removal INTEGER NOT NULL DEFAULT 0,
  seed INTEGER NOT NULL,
  input_log TEXT NOT NULL,
  ip TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_practice_scores_diff_score ON practice_scores (difficulty, score DESC);
CREATE INDEX IF NOT EXISTS idx_practice_scores_account ON practice_scores (account_name);
