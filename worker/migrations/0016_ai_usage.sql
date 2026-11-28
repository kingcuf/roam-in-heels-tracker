-- AI Analyst: one row per question (cost + the report, which doubles as a
-- 24-hour answer cache), and a small key/value table for the credit budget.
CREATE TABLE IF NOT EXISTS ai_usage (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  at            TEXT NOT NULL,          -- ISO timestamp
  user          TEXT,
  model         TEXT,
  in_tokens     INTEGER DEFAULT 0,      -- uncached input
  cached_tokens INTEGER DEFAULT 0,
  out_tokens    INTEGER DEFAULT 0,      -- output + thinking
  cost_usd      REAL DEFAULT 0,         -- our estimate from the price table
  question      TEXT,
  ok            INTEGER DEFAULT 1,      -- 0 = failed (still billed if tokens were used)
  cached        INTEGER DEFAULT 0,      -- 1 = served from cache, cost 0
  cache_key     TEXT,
  report        TEXT                    -- JSON, for the cache
);
CREATE INDEX IF NOT EXISTS ai_usage_key ON ai_usage(cache_key);
CREATE INDEX IF NOT EXISTS ai_usage_at ON ai_usage(at);

CREATE TABLE IF NOT EXISTS ai_settings (
  k TEXT PRIMARY KEY,
  v TEXT
);
