-- A small gravity: before version 3 that was the Body's own multiplier, and
-- jumpSpeed() didn't take it for the script's.
gravity = 8

function leap()
  return jumpSpeed(100)
end
