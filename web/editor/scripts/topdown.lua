-- Top-down player: walks in any direction with the arrow keys, WASD or a
-- gamepad. Attach it to a Body whose motion is "scripted".

speed = 200          -- top speed (pixels per second)
acceleration = 2000  -- how quickly it speeds up and stops
turnToFace = false   -- rotate to face the way it walks

function physicsUpdate(dt)
  local dx, dy = vector("left", "right", "up", "down")
  local step = acceleration * dt
  vx = approach(vx, dx * speed, step)
  vy = approach(vy, dy * speed, step)
  move()

  local moving = math.abs(vx) > 5 or math.abs(vy) > 5
  if turnToFace and moving then rotation = smitten.math.angle(vx, vy) end
  local sprite = findChildOfType("Sprite")
  if sprite then
    if dx ~= 0 and not turnToFace then sprite.flipX = dx < 0 end
    local name = if moving then "walk" else "idle"
    if sprite:hasAnimation(name) and sprite.animation ~= name then sprite:play(name) end
  end
end
