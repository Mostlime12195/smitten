-- A spinning coin; touching it collects it.

local Coin = {}
Coin.__index = Coin

function Coin.new(object)
  local self = setmetatable({}, Coin)
  self.x, self.y = object.x + 3, object.y + 3
  self.width, self.height = 10, 10
  self.anim = smitten.sprite("sprites/coin"):animation("spin")
  self.bob = (object.x / 16) % 6 -- so coins don't all bob together
  return self
end

function Coin:update(dt, game)
  self.anim:update(dt)
  self.bob += dt
  if smitten.collide.overlaps(self, game.player) then
    game:collect(self)
  end
end

function Coin:draw()
  love.graphics.setColor(1, 1, 1)
  self.anim:draw(self.x + 5, math.floor(self.y + 5 + math.sin(self.bob * 4) * 1.5))
end

return Coin
