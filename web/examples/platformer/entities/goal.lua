-- The flag at the end of the level (its picture is part of the map).

local Goal = {}
Goal.__index = Goal

function Goal.new(object)
  return setmetatable({ x = object.x, y = object.y, width = object.width, height = object.height }, Goal)
end

function Goal:update(dt, game)
  if smitten.collide.overlaps(self, game.player) then game:win() end
end

return Goal
