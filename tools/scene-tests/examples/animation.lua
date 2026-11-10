local door
local slab
local player


function setup()
  door = root():find("Door")
  slab = door:find("Slab")
  player = root():find("Player")
end

steps = {
  { 0.3, function()
    check("the door starts closed", slab.scaleY == 1 and door:find("Sign").text == "Closed")
    player.x, player.y = 680, 360
  end },
  { 0.3, function()
    -- Wait for the creak: the call key at 0 seconds plays it.
    if not door:find("Creak"):isPlaying() then return false end
    check("the call key plays the creak", true)
  end },
  { 1.6, function()
    check("the door opens when the player comes near", slab.scaleY < 0.1, slab.scaleY)
    check("the script waited for the animation", door:find("Sign").text == "Open", door:find("Sign").text)
    player.x, player.y = 300, 360
  end },
  { 3.6, function()
    check("the door closes when the player goes away", near(slab.scaleY, 1, 0.01), slab.scaleY)
    check("the sign says closed", door:find("Sign").text == "Closed", door:find("Sign").text)
    done()
  end },
}
