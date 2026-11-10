-- One player scene for every player: the calls below name no player, so
-- they read this piece's `player` (set on each placed copy).
player = 1

jumped = false
held = false
move = 0
dirX, dirY = 0, 0
other = false
anyone = false

function update(dt)
  jumped = pressed("jump")
  held = down("jump")
  move = axis("left", "right")
  dirX, dirY = vector("left", "right", "up", "down")
  -- A number still wins, and the module reads every player.
  other = down("jump", player == 1 and 2 or 1)
  anyone = smitten.input.down("jump")
end
