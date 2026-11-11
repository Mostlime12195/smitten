-- Cloud saves (src/cloud.js): values that a game's scripts keep on the
-- account of the person who plays (smitten.cloud). data is the game's JSON
-- text, as it sent it; size is its length in bytes (UTF-8). Deleting the
-- account or the game deletes its saves.
--
-- Numbered 0007 and tracked by name (src/db.js), so it applies whether or
-- not a 0006 is there before it.

CREATE TABLE cloud_saves (
  user_id INTEGER NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  game_id TEXT NOT NULL REFERENCES games (id) ON DELETE CASCADE,
  key TEXT NOT NULL,
  data TEXT NOT NULL,
  size INTEGER NOT NULL,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  PRIMARY KEY (user_id, game_id, key)
) WITHOUT ROWID;
CREATE INDEX cloud_saves_game ON cloud_saves (game_id);
