-- The player: running, jumping with a variable height, and getting hurt.

local Player = {}
Player.__index = Player

local RUN_SPEED = 95
local ACCELERATION = 900
local GRAVITY = 760
local JUMP_SPEED = 265
local MAX_FALL = 420

function Player.new(object)
  local self = setmetatable({}, Player)
  -- The collision box is a little smaller than the 16×16 sprite.
  self.width, self.height = 10, 13
  self.spawnX = object.x + (object.width - self.width) / 2
  self.spawnY = object.y + object.height - self.height
  self.x, self.y = self.spawnX, self.spawnY
  self.vx, self.vy = 0, 0
  self.facing = 1
  self.onGround = false
  self.anim = smitten.sprite("sprites/player"):animation("idle")
  return self
end

function Player:respawn()
  smitten.sfx("sfx/hurt"):play()
  self.x, self.y = self.spawnX, self.spawnY
  self.vx, self.vy = 0, 0
end

-- True when any tile under the player's box has a "damage" property.
function Player:touchesDanger(level)
  for _, layer in ipairs({ "ground", "decor" }) do
    for py = self.y + 2, self.y + self.height - 1, 4 do
      for px = self.x + 1, self.x + self.width - 1, 4 do
        local tile = level:getTile(layer, math.floor(px / level.tileWidth), math.floor(py / level.tileHeight))
        if tile >= 0 and level:tileProperties(tile).damage then return true end
      end
    end
  end
  return false
end

function Player:update(dt, game)
  local level = game.level
  local dir = 0
  if smitten.input.down("left") then dir -= 1 end
  if smitten.input.down("right") then dir += 1 end
  if dir ~= 0 then self.facing = dir end

  -- Accelerate towards the running speed instead of jumping to it.
  local target = dir * RUN_SPEED
  local change = ACCELERATION * dt
  if self.vx < target then self.vx = math.min(self.vx + change, target)
  elseif self.vx > target then self.vx = math.max(self.vx - change, target) end

  if smitten.input.pressed("jump") and self.onGround then
    self.vy = -JUMP_SPEED
    smitten.sfx("sfx/jump"):play()
  end
  -- Letting go of jump early makes a shorter jump.
  local gravity = if self.vy < 0 and not smitten.input.down("jump") then GRAVITY * 2.2 else GRAVITY
  self.vy = math.min(self.vy + gravity * dt, MAX_FALL)

  local hit = smitten.collide.move(level, self, self.vx * dt, self.vy * dt)
  if hit.x then self.vx = 0 end
  if hit.y then self.vy = 0 end
  self.onGround = hit.ground

  if self.y > level.pixelHeight or self:touchesDanger(level) then
    self:respawn()
  end

  local name = if not self.onGround then (if self.vy < 0 then "jump" else "fall")
    elseif dir ~= 0 then "run" else "idle"
  self.anim:play(name)
  self.anim:update(dt)
end

function Player:draw()
  -- The sprite's origin is its bottom middle; negative x scale flips it.
  love.graphics.setColor(1, 1, 1)
  self.anim:draw(math.floor(self.x + self.width / 2), math.floor(self.y + self.height), 0, self.facing, 1)
end

return Player
