-- Pickup: collected when something with a tag (the player) touches it.
-- Attach it to a Zone. It tells the scene with a "collected" event, so a
-- script on the scene's root can count score with function Level:collected(item).
local Pickup = {}

Pickup.collector = "player"   -- the tag of what can collect it
Pickup.sound = ""             -- a sound file to play when collected (optional)
Pickup.points = 1

function Pickup:entered(other)
  if not other:hasTag(self.collector) then return end
  if self.sound ~= "" then smitten.assets.audio(self.sound):newSource():play() end
  smitten.scene.current:emit("collected", self)
  self:destroy()
end

return Pickup
