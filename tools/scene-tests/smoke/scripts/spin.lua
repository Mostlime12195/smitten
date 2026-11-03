-- Spin: keeps turning. For coins, fans, saw blades.
local Spinner = {}

Spinner.turnsPerSecond = 0.5   -- negative spins the other way

function Spinner:update(dt)
  self.rotation += self.turnsPerSecond * math.pi * 2 * dt
end

return Spinner
