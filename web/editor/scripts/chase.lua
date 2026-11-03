-- Chase: moves towards the first piece with a tag (the player, by default).
-- Works on scripted Bodies (they stop at walls) and on any other piece.
local Chaser = {}

Chaser.target = "player"    -- the tag of what to chase
Chaser.speed = 120          -- pixels per second
Chaser.stopDistance = 0     -- stop this close
Chaser.turnToFace = false   -- rotate to face the target

function Chaser:physicsUpdate(dt)
  local target = smitten.scene.first(self.target)
  if not target then return end
  local x, y = self:worldPosition()
  local tx, ty = target:worldPosition()
  local dx, dy = tx - x, ty - y
  local d = math.sqrt(dx * dx + dy * dy)
  if self.turnToFace then self.rotation = math.atan2(dy, dx) end
  local go = d > self.stopDistance and d > 0
  if self.move then
    self.vx = if go then dx / d * self.speed else 0
    self.vy = if go then dy / d * self.speed else 0
    self:move()
  elseif go then
    self:moveToward(tx, ty, math.min(self.speed * dt, d - self.stopDistance))
  end
end

return Chaser
