-- Spin: keeps turning. For coins, fans, saw blades.

turnsPerSecond = 0.5   -- negative spins the other way

function update(dt)
  rotation += turnsPerSecond * math.pi * 2 * dt
end
