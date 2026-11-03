-- Hackatime (https://hackatime.hackclub.com), Hack Club's time tracker:
-- accounts can connect it (src/hackatime.js), so the editor gets the API key
-- with one click and game pages show the hours tracked for the game.

-- The Hackatime user id, and the OAuth access token encrypted with a key
-- derived from SECRET (AES-256-GCM: v1.<iv>.<ciphertext>.<tag>). Never the
-- token in plain text; the API key isn't kept at all.
ALTER TABLE users ADD COLUMN hackatime_id TEXT;
ALTER TABLE users ADD COLUMN hackatime_token TEXT;
ALTER TABLE users ADD COLUMN hackatime_connected_at INTEGER;
CREATE UNIQUE INDEX users_hackatime ON users (hackatime_id) WHERE hackatime_id IS NOT NULL;

-- The editor's project a game was published from (the "project" its
-- heartbeats name), and the time Hackatime tracked for it, refreshed at most
-- once an hour.
ALTER TABLE games ADD COLUMN hackatime_project TEXT;
ALTER TABLE games ADD COLUMN hackatime_seconds INTEGER;
ALTER TABLE games ADD COLUMN hackatime_checked_at INTEGER;
