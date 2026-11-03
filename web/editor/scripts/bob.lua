-- Bob: floats gently up and down. For pickups, signs, ghosts.
local Bobber = {}

Bobber.height = 6      -- how far it moves, in pixels
Bobber.speed = 2       -- bobs per second

function Bobber:ready()
  self.startY = self.y
  self.time = math.random() * 10
end

function Bobber:update(dt)
  self.time += dt
  self.y = self.startY + math.sin(self.time * self.speed * math.pi) * self.height
end

return Bobber
