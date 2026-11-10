local ground
local player
local startX = 0

function setup()
  ground = root():find("Ground")
  player = root():find("Player")
end

steps = {
  { 0.2, function()
    check("the floor is the terrain ground", ground:getTerrain(5, 20) == "ground", ground:getTerrain(5, 20))
    check("the end of a platform has a different tile from its middle", ground:getTile(12, 15) ~= ground:getTile(14, 15))
    check("the pond has the water tile", ground:getTile(40, 19) == 32, ground:getTile(40, 19))
    local before = ground:getTile(21, 19)
    ground:setTerrain(20, 19, nil)
    check("setTerrain() digs a hole", ground:getTile(20, 19) == -1)
    check("the cell next to the hole gets a new edge", ground:getTile(21, 19) ~= before)
    ground:setTerrain(20, 19, "ground")
    check("setTerrain() fills the hole again", ground:getTile(21, 19) == before)
  end },
  { 1.0, function()
    check("the player stands on the tiles", player:onGround() and near(player.y, 294, 2), player.y)
    startX = player.x
    smitten.input.press("right")
  end },
  { 4.5, function()
    smitten.input.release("right")
    check("the player runs", player.x > startX + 100, player.x - startX)
    local view = { camera():getView() }
    check("the camera follows the player", view[1] > 20, view[1])
    done()
  end },
}
