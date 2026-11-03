-- Bob: floats gently up and down. For pickups, signs, ghosts.

distance = 6        -- how far it moves, in pixels
bobsPerSecond = 1

local startY, t = 0, 0

function ready()
  startY = y
  t = rnd(10)
end

function update(dt)
  t += dt
  y = startY + math.sin(t * bobsPerSecond * math.pi * 2) * distance
end
