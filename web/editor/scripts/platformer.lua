-- Platformer player: runs with the left and right actions and jumps with
-- jump (space) or up. Attach it to a Body whose motion is "scripted".
-- It's your script now: change anything.

speed = 220          -- top running speed (pixels per second)
acceleration = 2400  -- how quickly it speeds up and stops
jumpHeight = 96      -- how high a full jump goes (pixels)
gravity = 1800       -- how fast it falls
maxFallSpeed = 1000
airJumps = 0         -- extra jumps in the air: 1 is a double jump
upJumps = true       -- the up action jumps too

local COYOTE_TIME = 0.1     -- a jump still works this long after leaving a ledge
local JUMP_BUFFER = 0.12    -- a jump pressed this long before landing still happens
local coyote, buffer, airLeft = 0, 0, 0

function ready()
  airLeft = airJumps
end

function update(dt)
  -- Read presses every frame, so none are missed between physics steps.
  if pressed("jump") or (upJumps and pressed("up")) then buffer = JUMP_BUFFER end
end

local function jump()
  vy = -jumpSpeed(jumpHeight)
  coyote, buffer = 0, 0
  emit("jumped")
end

-- Plays idle, run, jump and fall on a Sprite inside the player, if its
-- .sprite file has them, and faces it the way it runs.
local function animate(dir)
  local sprite = findChildOfType("Sprite")
  if not sprite then return end
  if dir ~= 0 then sprite.flipX = dir < 0 end
  local name
  if onGround() then
    name = if math.abs(vx) > 5 then "run" else "idle"
  else
    name = if vy < 0 then "jump" else "fall"
  end
  if sprite:hasAnimation(name) and sprite.animation ~= name then sprite:play(name) end
end

function physicsUpdate(dt)
  local dir = axis("left", "right")
  vx = approach(vx, dir * speed, acceleration * dt)
  vy = math.min(vy + gravity * dt, maxFallSpeed)

  if onGround() then
    coyote, airLeft = COYOTE_TIME, airJumps
  else
    coyote -= dt
  end
  if buffer > 0 then
    if coyote > 0 then
      jump()
    elseif airLeft > 0 then
      airLeft -= 1
      jump()
    end
    buffer -= dt
  end
  -- Letting go of jump early makes a lower jump.
  local holding = down("jump") or (upJumps and down("up"))
  if vy < 0 and not holding then vy *= 0.85 end

  local wasOnGround = onGround()
  move()
  if onGround() and not wasOnGround then emit("landed") end
  animate(dir)
end
