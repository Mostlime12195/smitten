-- Chase: moves towards the first piece with a tag (the player, by default).
-- Works on scripted Bodies (they stop at walls) and on any other piece.

target = "player"    -- the tag of what to chase
speed = 120          -- pixels per second
stopDistance = 0     -- stop this close
turnToFace = false   -- rotate to face the target

function physicsUpdate(dt)
  local other = first(target)
  if not other then return end
  local px, py = worldPosition()
  local tx, ty = other:worldPosition()
  local dx, dy = tx - px, ty - py
  local d = math.sqrt(dx * dx + dy * dy)
  if turnToFace then rotation = math.atan2(dy, dx) end
  local going = d > stopDistance and d > 0
  if move then
    vx = if going then dx / d * speed else 0
    vy = if going then dy / d * speed else 0
    move()
  elseif going then
    moveToward(tx, ty, math.min(speed * dt, d - stopDistance))
  end
end
