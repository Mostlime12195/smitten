-- Follows its agent (given by scenes/main.lua): asks it where to head and
-- moves there itself.

speed = 120
agent = false
highest = 100000   -- the smallest y it has been at

function physicsUpdate(dt)
  if not agent then return end
  local nx, ny = agent:next(x, y)
  local dx, dy = nx - x, ny - y
  local d = math.sqrt(dx * dx + dy * dy)
  if agent:isDone() or d == 0 then
    vx, vy = 0, 0
  else
    local s = math.min(speed, d / dt)
    vx, vy = dx / d * s, dy / d * s
  end
  move()
  highest = math.min(highest, y)
end
