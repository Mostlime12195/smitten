-- Address bans: a moderator can stop a network from making accounts,
-- publishing and reporting (playing stays open). Only salted hashes of
-- addresses are kept, the same ones rate limits use.
CREATE TABLE address_bans (
  ip_hash TEXT PRIMARY KEY,
  reason TEXT NOT NULL DEFAULT '',
  created_at INTEGER NOT NULL,
  expires_at INTEGER                     -- NULL: until a moderator lifts it
);

-- The addresses an account was used from lately (kept 30 days), so banning
-- the account can ban its addresses too.
CREATE TABLE user_addresses (
  user_id INTEGER NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  ip_hash TEXT NOT NULL,
  last_seen INTEGER NOT NULL,
  PRIMARY KEY (user_id, ip_hash)
);
