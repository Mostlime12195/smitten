-- The flag at the end of the level. Its picture is part of the scene's
-- tiles, so this object is only a hitbox: the box placed in the scene.

local Goal = smitten.object {}

function Goal:touch(other)
  if other.type == "player" then self.scene:win() end
end

return Goal
