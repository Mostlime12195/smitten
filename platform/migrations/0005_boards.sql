-- Leaderboards (src/boards.js): optional score tables a game's owner adds
-- to it. The game sends scores from each player's browser, so they can be
-- faked: these are for fun, and the owner can remove scores and reset.

-- A game has a few boards, each with a short key ("best") its scripts use.
CREATE TABLE boards (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  game_id TEXT NOT NULL,
  key TEXT NOT NULL,
  title TEXT NOT NULL,
  sort TEXT NOT NULL DEFAULT 'high',     -- 'high' (bigger is better) | 'low' (times)
  keep TEXT NOT NULL DEFAULT 'best',     -- 'best' (one row per player) | 'all'
  format TEXT NOT NULL DEFAULT 'number', -- 'number' | 'time' (seconds, shown as 1:23.45)
  unit TEXT NOT NULL DEFAULT '',         -- shown after a number: "points"
  min_value REAL,                        -- scores outside min..max are refused
  max_value REAL,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  UNIQUE (game_id, key)
);

-- player is "u:<user id>" for someone signed in, else "g:<salted hash of
-- the address and the guest name>": never the address itself. name is the
-- guest's name; an account's name is read from users when listing.
CREATE TABLE scores (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  board_id INTEGER NOT NULL REFERENCES boards (id) ON DELETE CASCADE,
  player TEXT NOT NULL,
  user_id INTEGER,
  name TEXT NOT NULL DEFAULT '',
  value REAL NOT NULL,
  created_at INTEGER NOT NULL
);
CREATE INDEX scores_ranking ON scores (board_id, value);
CREATE INDEX scores_player ON scores (board_id, player);
CREATE INDEX scores_user ON scores (user_id) WHERE user_id IS NOT NULL;
