-- A night scene to try the lights with: the torch follows the mouse and
-- flickers; the crates, the pillar and the wall of tiles throw shadows; the
-- lamp's bulb and the sign have lit off, so they glow.

function update(dt)
  local x, y = mouse()
  if x > 0 and y > 0 and x < screenWidth() and y < screenHeight() then
    Torch.x, Torch.y = x, y
  end
  Torch.brightness = 0.95 + rnd(0.1)
end
