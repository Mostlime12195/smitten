-- Play builds: a game can have a second zip, play.love, next to its source
-- (game.love). The play page runs the play build; remixing gets the source.
-- play_size is its size in bytes, or NULL for games without one (all games
-- published before this migration): they keep running from game.love.
ALTER TABLE games ADD COLUMN play_size INTEGER;
