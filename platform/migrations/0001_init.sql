-- Smitten's game-sharing site: games, reports, play counts and rate limits.
-- Every statement is idempotent (IF NOT EXISTS) because the Worker also runs
-- this file once per isolate, so `wrangler dev` works without a migration
-- step (src/db.js).

-- One row per published game. The game itself (game.love) and its thumbnail
-- live in R2 under games/<id>/.
CREATE TABLE IF NOT EXISTS games (
  id TEXT PRIMARY KEY,
  title TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  modules TEXT NOT NULL DEFAULT '[]',
  engine_version TEXT NOT NULL DEFAULT '',
  remix_of TEXT,
  token_hash TEXT NOT NULL,
  has_thumbnail INTEGER NOT NULL DEFAULT 0,
  game_size INTEGER NOT NULL DEFAULT 0,
  version INTEGER NOT NULL DEFAULT 1,
  plays INTEGER NOT NULL DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'public',
  hidden_by TEXT,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS games_newest ON games (status, created_at DESC);
CREATE INDEX IF NOT EXISTS games_popular ON games (status, plays DESC);
CREATE INDEX IF NOT EXISTS games_remix_of ON games (remix_of);

-- Reports from players. Open reports (resolved = 0) from different people
-- hide a game once there are REPORT_THRESHOLD of them; an admin restoring the
-- game resolves them. ip_hash is a salted hash, never the address.
CREATE TABLE IF NOT EXISTS reports (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  game_id TEXT NOT NULL,
  reason TEXT NOT NULL,
  note TEXT NOT NULL DEFAULT '',
  ip_hash TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  resolved INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS reports_open ON reports (game_id, resolved);

-- Play counting: one play per person per game per day.
CREATE TABLE IF NOT EXISTS plays (
  game_id TEXT NOT NULL,
  ip_hash TEXT NOT NULL,
  day INTEGER NOT NULL,
  PRIMARY KEY (game_id, ip_hash, day)
);

-- Fixed-window rate limit counters ("publish:<ip hash>", "report:<ip hash>").
CREATE TABLE IF NOT EXISTS rate_limits (
  key TEXT NOT NULL,
  window_start INTEGER NOT NULL,
  count INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (key, window_start)
);
