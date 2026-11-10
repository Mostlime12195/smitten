-- Pickup: collected when something with a tag (the player) touches it.
-- Attach it to a Zone. It tells the scene with a "collected" event, so the
-- scene's root script can count score with function collected(item).

collector = "player"   -- the tag of what can collect it
sound = ""             -- a sound to play when collected: a name like "coin", or a file
worth = 1               -- how much it counts for

function entered(other)
  if not other:is(collector) then return end
  if sound ~= "" then sfx(sound) end
  root():emit("collected", self)
  destroy()
end
