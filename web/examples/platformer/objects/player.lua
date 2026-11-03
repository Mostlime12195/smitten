-- The player. Running, jumping, landing and the camera all come from the
-- platformer behavior; change the numbers below to tune how it feels.

local Player = smitten.object {
  sprite = "sprites/player",
  behaviors = { "platformer" },
  camera = true,         -- the camera follows the player
  width = 10,            -- the hitbox is a bit smaller than the 16×16 sprite
  height = 13,
  speed = 95,            -- running speed, pixels per second
  jumpSpeed = 265,
}

function Player:jumped()
  smitten.sfx("sfx/jump"):play()
end

function Player:update(dt)
  -- Spikes and water are tiles with a "damage" property (tiles/terrain).
  if self:touchingTile("damage") then self:hurt() end
end

function Player:fell() -- off the bottom of the level
  self:hurt()
end

function Player:hurt()
  smitten.sfx("sfx/hurt"):play()
  self:respawn()
end

return Player
