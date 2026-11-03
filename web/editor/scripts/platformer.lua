-- Platformer player: runs with the left and right actions and jumps with
-- jump (space) or up. Attach it to a Body whose motion is "scripted".
-- It's your script now: change anything.
local Player = {}

Player.speed = 220          -- top running speed (pixels per second)
Player.acceleration = 2400  -- how quickly it speeds up and stops
Player.jumpHeight = 96      -- how high a full jump goes (pixels)
Player.gravity = 1800       -- how fast it falls
Player.maxFallSpeed = 1000
Player.airJumps = 0         -- extra jumps in the air: 1 is a double jump
Player.upJumps = true       -- the up action jumps too

local COYOTE_TIME = 0.1     -- a jump still works this long after leaving a ledge
local JUMP_BUFFER = 0.12    -- a jump pressed this long before landing still happens

function Player:ready()
  self.coyote, self.buffer, self.airLeft = 0, 0, self.airJumps
end

function Player:update(dt)
  -- Read presses every frame, so none are missed between physics steps.
  if smitten.input.pressed("jump") or (self.upJumps and smitten.input.pressed("up")) then
    self.buffer = JUMP_BUFFER
  end
end

function Player:jump()
  self.vy = -math.sqrt(2 * self.gravity * self.jumpHeight)
  self.coyote, self.buffer = 0, 0
  self:emit("jumped")
end

function Player:physicsUpdate(dt)
  local dir = smitten.input.axis("left", "right")
  self.vx = smitten.math.approach(self.vx, dir * self.speed, self.acceleration * dt)
  self.vy = math.min(self.vy + self.gravity * dt, self.maxFallSpeed)

  if self:onGround() then
    self.coyote, self.airLeft = COYOTE_TIME, self.airJumps
  else
    self.coyote -= dt
  end
  if self.buffer > 0 then
    if self.coyote > 0 then
      self:jump()
    elseif self.airLeft > 0 then
      self.airLeft -= 1
      self:jump()
    end
    self.buffer -= dt
  end
  -- Letting go of jump early makes a lower jump.
  local holding = smitten.input.down("jump") or (self.upJumps and smitten.input.down("up"))
  if self.vy < 0 and not holding then self.vy *= 0.85 end

  local wasOnGround = self:onGround()
  self:move()
  if self:onGround() and not wasOnGround then self:emit("landed") end
  self:animate(dir)
end

-- Plays idle, run, jump and fall on a Sprite inside the player, if its
-- .sprite file has them, and faces it the way it runs.
function Player:animate(dir)
  local sprite = self:findChildOfType("Sprite")
  if not sprite then return end
  if dir ~= 0 then sprite.flipX = dir < 0 end
  local name
  if self:onGround() then
    name = if math.abs(self.vx) > 5 then "run" else "idle"
  else
    name = if self.vy < 0 then "jump" else "fall"
  end
  if sprite:hasAnimation(name) and sprite.animation ~= name then sprite:play(name) end
end

return Player
