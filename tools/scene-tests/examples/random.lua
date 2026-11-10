local cave
local seedLabel
local player
local function signature()
  local out = {}
  for row = 0, 21 do
    for column = 0, 39 do out[#out + 1] = if cave:getTile(column, row) >= 0 then "#" else "." end
  end
  return table.concat(out)
end

local first = ""

function setup()
  cave = root():find("Cave")
  seedLabel = root():find("UI/Seed")
  player = root():find("Player")
end

steps = {
  { 0.3, function()
    first = signature()
    local rock = #cave:cellsWith()
    check("the cave has rock and air", rock > 100 and rock < 40 * 22 - 100, rock)
    check("the seed shows", seedLabel.text:find("^Seed: 1%.") ~= nil, seedLabel.text)
    check("the player is in the air, not in the rock", not cave:isSolid(cave:cellAt(player.x, player.y)))
    cave:makeCave()
    check("the same seed makes the same cave", signature() == first)
    tap("newCave")
  end },
  { 0.6, function()
    check("R makes a new seed", seedLabel.text:find("^Seed: 1%.") == nil, seedLabel.text)
    check("a new seed makes a different cave", signature() ~= first)
    done()
  end },
}
