-- A spinning coin: touching it collects it.

local Coin = smitten.object {
  sprite = "sprites/coin",   -- plays its "spin" animation
  width = 10,                -- the hitbox, around the middle of the sprite
  height = 10,
  offsetY = -5,
}

function Coin:touch(other)
  if other.type == "player" then
    smitten.sfx("sfx/coin"):play()
    self:destroy()
  end
end

return Coin
