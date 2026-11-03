-- Smitten's game-sharing site: accounts, games, moderation and limits.
-- src/db.js applies the files in this folder in order, once each (it keeps
-- the number of the last one in PRAGMA user_version), each in a transaction.

-- Accounts. A person signs in with a password, with Hack Club, or both.
-- No email addresses or real names: usernames and display names are public.
CREATE TABLE users (
  id INTEGER PRIMARY KEY AUTOINCREMENT, -- never reused: rate limits, plays and reports refer to it
  username TEXT NOT NULL UNIQUE COLLATE NOCASE,
  display_name TEXT NOT NULL,
  password_hash TEXT,                    -- scrypt$<logN>$<r>$<p>$<salt>$<hash>, or NULL
  hackclub_id TEXT UNIQUE,               -- the "sub" from Hack Club Auth, or NULL
  status TEXT NOT NULL DEFAULT 'active', -- 'active' | 'banned'
  ban_reason TEXT,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

-- Signed-in browsers (kind 'web', a cookie) and editors (kind 'editor', a
-- bearer token). Only the SHA-256 of a token is stored.
CREATE TABLE sessions (
  id TEXT PRIMARY KEY,                   -- public id, for listing and revoking
  token_hash TEXT NOT NULL UNIQUE,
  user_id INTEGER NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  kind TEXT NOT NULL,
  origin TEXT,                           -- the editor's origin
  created_at INTEGER NOT NULL,
  last_used_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL
);
CREATE INDEX sessions_user ON sessions (user_id);

-- One-time codes the sign-in popup hands to the editor, exchanged for an
-- editor token with the verifier whose SHA-256 is the challenge.
CREATE TABLE editor_codes (
  code_hash TEXT PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  origin TEXT NOT NULL,
  challenge TEXT NOT NULL,
  expires_at INTEGER NOT NULL
);

-- Recovery codes (an HMAC with the server's secret), each good for one
-- password reset.
CREATE TABLE recovery_codes (
  user_id INTEGER NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  code_hash TEXT NOT NULL,
  used_at INTEGER,
  PRIMARY KEY (user_id, code_hash)
);

-- Password reset links made by a moderator.
CREATE TABLE password_resets (
  token_hash TEXT PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  expires_at INTEGER NOT NULL
);

-- One row per published game; its files are in <DATA_DIR>/games/<id>/.
-- owner_id is the account. Games published before accounts have only
-- token_hash (the SHA-256 of their edit token) until their owner claims them.
CREATE TABLE games (
  id TEXT PRIMARY KEY,
  owner_id INTEGER,
  token_hash TEXT,
  title TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  modules TEXT NOT NULL DEFAULT '[]',
  engine_version TEXT NOT NULL DEFAULT '',
  remix_of TEXT,
  has_thumbnail INTEGER NOT NULL DEFAULT 0,
  game_size INTEGER NOT NULL DEFAULT 0,
  version INTEGER NOT NULL DEFAULT 1,
  plays INTEGER NOT NULL DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'public', -- 'public' | 'hidden'
  hidden_by TEXT,                        -- 'reports' | 'admin' | 'ban'
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);
CREATE INDEX games_newest ON games (status, created_at DESC);
CREATE INDEX games_popular ON games (status, plays DESC);
CREATE INDEX games_remix_of ON games (remix_of);
CREATE INDEX games_owner ON games (owner_id, created_at DESC);

-- Reports. reporter is "u:<user id>" or "ip:<salted hash>". Open reports
-- from REPORT_THRESHOLD different reporters hide a game until a moderator
-- restores it, which resolves them.
CREATE TABLE reports (
  id INTEGER PRIMARY KEY,
  game_id TEXT NOT NULL,
  reason TEXT NOT NULL,
  note TEXT NOT NULL DEFAULT '',
  reporter TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  resolved INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX reports_open ON reports (game_id, resolved);

-- One play per viewer (account or IP hash) per game per day.
CREATE TABLE plays (
  game_id TEXT NOT NULL,
  viewer TEXT NOT NULL,
  day INTEGER NOT NULL,
  PRIMARY KEY (game_id, viewer, day)
);

-- Fixed-window rate limit counters.
CREATE TABLE rate_limits (
  key TEXT NOT NULL,
  window_start INTEGER NOT NULL,
  count INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (key, window_start)
);

-- What moderators did.
CREATE TABLE admin_log (
  id INTEGER PRIMARY KEY,
  at INTEGER NOT NULL,
  action TEXT NOT NULL,
  target TEXT NOT NULL,
  detail TEXT NOT NULL DEFAULT ''
);
