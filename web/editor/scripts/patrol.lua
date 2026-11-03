-- Patrol: walks back and forth, turning around at walls and at the edges of
-- platforms. A classic platformer enemy. Attach it to a scripted Body.
local Patrol = {}

Patrol.speed = 80           -- pixels per second
Patrol.gravity = 1800
Patrol.turnAtEdges = true   -- turn around instead of walking off a platform

function Patrol:ready()
  self.direction = 1
end

function Patrol:physicsUpdate(dt)
  self.vx = self.direction * self.speed
  self.vy = math.min(self.vy + self.gravity * dt, 1000)
  local wasOnGround = self:onGround()
  local x, y = self.x, self.y
  self:move()
  if self:onWall() then
    self.direction = -self.direction
  elseif self.turnAtEdges and wasOnGround and not self:onGround() then
    -- About to walk off: step back and turn around.
    self.x, self.y = x, y
    self.vy = 0
    self.direction = -self.direction
  end
  local sprite = self:findChildOfType("Sprite")
  if sprite then sprite.flipX = self.direction < 0 end
end

return Patrol
