-- Fly straight: keeps moving the way it faces. For bullets, arrows, clouds.
-- It removes itself once it leaves the screen or gets too old.
local Flyer = {}

Flyer.speed = 500           -- pixels per second
Flyer.lifetime = 3          -- seconds before it disappears (0: never)
Flyer.removeOffscreen = true

function Flyer:ready()
  self.age = 0
end

function Flyer:physicsUpdate(dt)
  local dx, dy = math.cos(self.rotation), math.sin(self.rotation)
  if self.move then
    self.vx, self.vy = dx * self.speed, dy * self.speed
    self:move()
  else
    self:translate(dx * self.speed * dt, dy * self.speed * dt)
  end
  self.age += dt
  if self.lifetime > 0 and self.age > self.lifetime then self:destroy() end
  if self.removeOffscreen then
    local sx, sy = smitten.scene.worldToScreen(self:worldPosition())
    local d = smitten.display
    if sx < d.viewX - 64 or sy < d.viewY - 64 or sx > d.viewX + d.viewWidth + 64 or sy > d.viewY + d.viewHeight + 64 then
      self:destroy()
    end
  end
end

return Flyer
