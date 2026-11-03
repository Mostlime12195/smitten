-- Physics checks: run in the player (tools/stress/run.mjs test-physics).
-- Each check prints "check <name> ok" or "check <name> FAIL <values>"; the
-- last line is "checks <passed>/<total>".

local GRAVITY = 1800
local steps = 0
local passed, total = 0, 0
local start = {}
local hits = {}
local events = {}

local function check(name, ok, ...)
  total += 1
  if ok then passed += 1 end
  print("check", name, ok and "ok" or "FAIL", ...)
end

-- Scripted bodies: walk with gravity, like platformer.lua.
local function walk(b, vx, dt)
  b.vx = vx
  b.vy = math.min(b.vy + GRAVITY * dt, 1000)
  b:move()
end

function ready()
  print("ready")
  for _, n in ipairs({ "Walker", "Stander", "Slider", "Jumper", "Platform", "Rider", "Pusher", "Crate", "Bob", "Ghost", "Dropped" }) do
    local p = find(n)
    start[n] = { x = p.x, y = p.y }
  end
  Dropped:on("hit", function(other, contact) hits[#hits + 1] = { other = other, contact = contact } end)
  Gate:on("entered", function(o) events[#events + 1] = "gate in " .. o.name end)
  Gate:on("exited", function(o) events[#events + 1] = "gate out " .. o.name end)
  Dropped:on("entered", function(z) events[#events + 1] = "box in " .. z.name end)

  -- Queries right away.
  local hit = raycast(640, 0, 640, 720)
  check("raycast hits the ball", hit and hit.piece == Ball and math.abs(hit.y - 90) < 1 and hit.ny < -0.99, hit and hit.piece.name, hit and hit.y)
  local tagged = raycast(900, 666, 1280, 666, "crate")
  check("raycast with tags", tagged and tagged.piece == Crate and math.abs(tagged.x - 1040) < 1, tagged and tagged.x)
  local none = raycast(5, 5, 6, 6)
  check("raycast misses", none == nil)
  local at = piecesAt(1060, 666)
  check("piecesAt", #at == 1 and at[1] == Crate, #at)
  local near = overlap("circle", 640, 300, 30)
  local found = false
  for _, q in ipairs(near) do if q == Platform then found = true end end
  check("overlap circle", found, #near)
  check("overlap rect", #overlap("rect", 1060, 666, 10, 10) == 1)
  local gx, gy = getGravity()
  check("gravity", gx == 0 and gy == 980, gx, gy)

  -- Impulses change the speed at once: impulse / mass.
  Floater:applyImpulse(0, -400)
  check("applyImpulse", math.abs(Floater.vy + 400) < 0.01, Floater.vy)
  Floater.mass = 2
end

function physicsUpdate(dt)
  steps += 1
  walk(Walker, 120, dt)
  walk(Stander, 0, dt)
  walk(Slider, 0, dt)
  walk(Rider, 0, dt)
  walk(Pusher, steps > 20 and 150 or 0, dt)
  -- Jump at step 30 from the floor, up through the one-way tiles.
  if steps == 30 then Jumper.vy = -900 end
  walk(Jumper, 0, dt)
  Platform.x = start.Platform.x + math.sin(steps / 30) * 80

  -- Throw the ball: grab it, drag it right quickly, let go.
  if steps == 10 then Ball:grab(640, 100) end
  if steps > 10 and steps < 25 then Ball:dragTo(640 + (steps - 10) * 12, 100) end
  if steps == 25 then
    Ball:drop()
    start.throw = Ball.vx
  end

  if steps == 30 then start.ride = Rider.x - Platform.x end
  start.bobY = math.max(start.bobY or 0, Bob.y)
  if steps == 2 then
    local dx = Floater.x - 1200
    check("impulse moves it", Floater.y < 400, Floater.y)
  end

  if steps == 120 then
    -- Up the ramp at full speed (two seconds at 120 px/s).
    check("walker climbs the ramp", Walker.y < start.Walker.y - 30 and Walker.x > start.Walker.x + 235 and Walker:onGround(), Walker.x, Walker.y, Walker:onGround())
    check("stander stays on the slope", math.abs(Stander.x - start.Stander.x) < 1 and Stander:onGround(), Stander.x - start.Stander.x)
    check("slider slides down the steep slope", Slider.x > start.Slider.x + 20, Slider.x - start.Slider.x)
    check("jumper lands on the one-way tiles", math.abs(Jumper.y + 12 - 512) < 1.5 and Jumper:onGround(), Jumper.y, Jumper:onGround())
    check("rider rides the platform", math.abs((Rider.x - Platform.x) - start.ride) < 4 and Rider:onGround(),
      Rider.x - Platform.x, Platform.x)
    check("pusher pushes the crate", Crate.x > start.Crate.x + 60 and Pusher.x > start.Pusher.x + 60, Crate.x, Pusher.x)
    check("thrown ball keeps going", start.throw > 200 and Ball.vx > 100 and Ball.x > 900, start.throw, Ball.vx, Ball.x)
    local bx, by = Bob.x - 1100, Bob.y - 100
    check("pendulum swings on its pin", start.bobY > 175 and math.abs(math.sqrt(bx * bx + by * by) - 80) < 1, start.bobY, Bob.x, Bob.y)
    local sx, sy = Swing.x - 300, Swing.y - 100
    check("rope holds", math.sqrt(sx * sx + sy * sy) < 101.5, math.sqrt(sx * sx + sy * sy))
    check("ghost passes through", Ghost.y > 200, Ghost.y)
    check("zone events", table.concat(events, ",") == "gate in Dropped,box in Gate,gate out Dropped", table.concat(events, ","))
    local h = hits[1]
    check("hit with contact", h and h.other == Map and h.contact.ny < -0.99 and h.contact.impulse > 0, h and h.other.name,
      h and h.contact.ny, h and h.contact.impulse)
    check("one hit while resting", #hits == 1, #hits)
    check("touching", Dropped:isTouching(Map) and Crate:isTouching(Pusher) == true, Dropped:isTouching(Map))
    local cs = Dropped:contacts()
    check("contacts", #cs == 1 and cs[1].piece == Map, #cs)
    check("asleep", Dropped.asleep == true or Dropped.vy == 0, Dropped.asleep)
    setGravity(0, -200)
    Dropped:wake()
  end
  if steps == 160 then
    check("gravity changed", Dropped.y < 640, Dropped.y)
    print(("checks %d/%d"):format(passed, total))
  end
end
