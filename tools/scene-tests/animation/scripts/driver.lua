-- Moves main.lua's checks on once a frame, also while the game is paused,
-- and counts the game's time (game.clock: the frames' dt added up).
function update(dt)
  game.clock += dt
  game.lastDt = dt
  game.step()
end
