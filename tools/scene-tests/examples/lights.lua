local player
local torch
local startX = 0

function setup()
  player = root():find("Player")
  torch = player:find("Torch")
end

steps = {
  { 0.3, function()
    check("the torch is in the player and has shadows", torch.shadows and torch.kind == "point")
    startX = player.x
    smitten.input.press("right")
  end },
  { 1.2, function()
    smitten.input.release("right")
    check("the player walks", player.x > startX + 40, player.x - startX)
    local tx, ty = torch:worldPosition()
    check("the torch moves with the player", near(tx, player.x) and near(ty, player.y), tx .. ", " .. ty)
    check("the torch flickers", torch.brightness ~= 1, torch.brightness)
    done()
  end },
}
