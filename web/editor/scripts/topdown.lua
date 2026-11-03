-- Top-down player: walks in any direction with the arrow keys, WASD or a
-- gamepad. Attach it to a Body whose motion is "scripted".
local Walker = {}

Walker.speed = 200          -- top speed (pixels per second)
Walker.acceleration = 2000  -- how quickly it speeds up and stops
Walker.turnToFace = false   -- rotate to face the way it walks

function Walker:physicsUpdate(dt)
  local x, y = smitten.input.vector("left", "right", "up", "down")
  local step = self.acceleration * dt
  self.vx = smitten.math.approach(self.vx, x * self.speed, step)
  self.vy = smitten.math.approach(self.vy, y * self.speed, step)
  self:move()

  local moving = math.abs(self.vx) > 5 or math.abs(self.vy) > 5
  if self.turnToFace and moving then self.rotation = math.atan2(self.vy, self.vx) end
  local sprite = self:findChildOfType("Sprite")
  if sprite then
    if x ~= 0 and not self.turnToFace then sprite.flipX = x < 0 end
    local name = if moving then "walk" else "idle"
    if sprite:hasAnimation(name) and sprite.animation ~= name then sprite:play(name) end
  end
end

return Walker
