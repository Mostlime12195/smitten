-- Fly straight: keeps moving the way it faces. For bullets, arrows, clouds.
-- It removes itself once it leaves the screen or gets too old.

speed = 500           -- pixels per second
lifetime = 3          -- seconds before it disappears (0: never)
removeOffscreen = true

local age = 0

function physicsUpdate(dt)
  local dx, dy = smitten.math.direction(rotation)
  if move then
    vx, vy = dx * speed, dy * speed
    move()
  else
    translate(dx * speed * dt, dy * speed * dt)
  end
  age += dt
  if lifetime > 0 and age > lifetime then destroy() end
  if removeOffscreen then
    local sx, sy = smitten.scene.worldToScreen(worldPosition())
    local d = smitten.display
    if sx < d.viewX - 64 or sy < d.viewY - 64 or sx > d.viewX + d.viewWidth + 64 or sy > d.viewY + d.viewHeight + 64 then
      destroy()
    end
  end
end
