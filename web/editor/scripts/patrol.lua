-- Patrol: walks back and forth, turning around at walls and at the edges of
-- platforms. A classic platformer enemy. Attach it to a scripted Body.

speed = 80           -- pixels per second
gravity = 1800
turnAtEdges = true   -- turn around instead of walking off a platform

local facing = 1

function physicsUpdate(dt)
  vx = facing * speed
  vy = math.min(vy + gravity * dt, 1000)
  local wasOnGround = onGround()
  local oldX, oldY = x, y
  move()
  if onWall() then
    facing = -facing
  elseif turnAtEdges and wasOnGround and not onGround() then
    -- About to walk off: step back and turn around.
    x, y = oldX, oldY
    vy = 0
    facing = -facing
  end
  local sprite = findChildOfType("Sprite")
  if sprite then sprite.flipX = facing < 0 end
end
