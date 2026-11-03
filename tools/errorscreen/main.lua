-- Errors after one second, to check that the error screen doesn't stall the
-- page (it pumps events every frame). The script of main.scene's root piece.
local t = 0
function update(dt)
  t = t + dt
  if t > 1 then error("deliberate error for the error-screen test") end
end
function draw() smitten.graphics.print("erroring soon...", 10, 10) end
