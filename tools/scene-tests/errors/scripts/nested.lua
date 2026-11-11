-- Makes one more piece with this same script while its own top level runs,
-- so the engine needs a second copy of this script's code at that moment.
depth = (game.nestDepth or 0) + 1
inner = nil
game.nestDepth = depth
if depth < 2 then
  inner = make("Group", {}, "scripts/nested.lua")
end
game.nestDepth = depth - 1
