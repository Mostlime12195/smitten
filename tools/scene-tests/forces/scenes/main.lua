-- Forces in zones, seeds, generators of their own and noise. Prints PASS
-- or FAIL for each check, then DONE (tools/scene-tests/run.mjs reads them).
--
-- Bodies fall from y = 0 with the scene's gravity (0, 980), each in a
-- column of its own, with the zones being tested around them. A probe reads
-- a speed at two steps after the body is inside and works out the
-- acceleration in between: physics steps are 1/60 of a second.

local passed, failed = 0, 0
local steps = 0
local probes = {}
local later = {}   -- step -> functions to run then
local randomDone = false
local finished = false
local events = {}

local function check(name, ok, ...)
  if ok then
    passed += 1
    print("PASS " .. name)
  else
    failed += 1
    local parts = {}
    for i = 1, select("#", ...) do parts[#parts + 1] = tostring((select(i, ...))) end
    print("FAIL " .. name .. ": " .. table.concat(parts, " "))
  end
end

local function near(a, b, tol) return type(a) == "number" and math.abs(a - b) <= tol end

local function at(step, fn)
  later[step] = later[step] or {}
  table.insert(later[step], fn)
end

---------------------------------------------------------------------------
-- Pieces

local column = 0

-- The x of the next free column.
local function nextColumn()
  column += 1
  return column * 400
end

local function ball(x, y, props)
  props = props or {}
  props.motion = props.motion or "physics"
  props.shape, props.radius, props.x, props.y = "circle", 6, x, y
  return spawn("Body", props)
end

local function zone(x, y, w, h, props)
  props = props or {}
  props.shape, props.width, props.height, props.x, props.y = "rectangle", w, h, x, y
  return spawn("Zone", props)
end

-- The acceleration of b along "vx" or "vy" between two steps.
local function probe(name, b, axis, s1, s2, want, tol)
  probes[#probes + 1] = { name = name, b = b, axis = axis, s1 = s1, s2 = s2, want = want, tol = tol or (math.abs(want) * 0.01 + 2) }
end

-- A ratio of speeds between two steps (drag).
local function ratio(name, b, axis, s1, s2, want, tol)
  probes[#probes + 1] = { name = name, b = b, axis = axis, s1 = s1, s2 = s2, want = want, tol = tol, ratio = true }
end

---------------------------------------------------------------------------
-- The zones' cases

local free, plain, unforced

local function forceCases()
  -- A body on its own, one in a Zone with default settings, and one in a
  -- Zone with force settings but forces off: all three fall the same.
  local x = nextColumn()
  free = ball(x, 0)
  x = nextColumn()
  zone(x, 0, 300, 2000)
  plain = ball(x, 0)
  x = nextColumn()
  zone(x, 0, 300, 2000, { gravity = "replace", gravityY = -500, drag = 5, spinDrag = 5, pushX = 300 })
  unforced = ball(x, 0)
  probe("free fall is the scene's gravity", free, "vy", 10, 40, 980)

  x = nextColumn()
  local z = zone(x, 0, 300, 2000, { forces = true, gravity = "add", gravityY = -490 })
  local b = ball(x, 0)
  z:on("entered", function(o) if o == b then events[#events + 1] = "entered" end end)
  probe("add: the zone's gravity adds to the scene's", b, "vy", 10, 40, 490)

  x = nextColumn()
  zone(x, 0, 300, 2000, { forces = true, gravity = "replace", gravityX = 120, gravityY = -300 })
  b = ball(x, 0)
  probe("replace: the zone's gravity instead (down)", b, "vy", 10, 40, -300)
  probe("replace: the zone's gravity instead (sideways)", b, "vx", 10, 40, 120)

  x = nextColumn()
  zone(x, 0, 300, 2000, { forces = true, gravity = "replace", gravityY = -300 })
  b = ball(x, 0, { gravityScale = 2 })
  probe("gravityScale multiplies a replacing zone's gravity", b, "vy", 10, 40, -600)

  x = nextColumn()
  zone(x, 0, 300, 2000, { forces = true, gravity = "add", gravityY = -490 })
  b = ball(x, 0, { gravityScale = 0.5 })
  probe("gravityScale multiplies the scene's and an adding zone's gravity", b, "vy", 10, 40, 245)

  x = nextColumn()
  zone(x, 0, 300, 2000, { forces = true, gravity = "replace" })
  b = ball(x, 0)
  probe("replace with 0, 0 floats", b, "vy", 10, 40, 0)

  -- Towards the center: from 100 px to the left, it speeds up to the right.
  x = nextColumn()
  zone(x, 0, 300, 300, { forces = true, gravity = "replace", toCenter = true, gravityStrength = 500 })
  b = ball(x - 100, 0)
  probe("toCenter pulls towards the zone's position", b, "vx", 5, 25, 500)
  probe("toCenter: no pull sideways of the line to the center", b, "vy", 5, 25, 0)

  -- Drag: a speed of 300 sideways falls off as exp(-drag * time).
  x = nextColumn()
  zone(x, 0, 300, 600, { forces = true, gravity = "replace", drag = 2 })
  b = ball(x - 120, 0, { vx = 300 })
  ratio("drag slows bodies down", b, "vx", 10, 40, math.exp(-2 * 30 / 60), 0.02)
  probe("drag: replace 0, 0 still floats", b, "vy", 10, 40, 0)

  x = nextColumn()
  zone(x, 0, 300, 600, { forces = true, gravity = "replace", drag = 1 })
  zone(x, 0, 300, 600, { forces = true, drag = 1 })
  b = ball(x - 120, 0, { vx = 300 })
  ratio("the drags of overlapping zones add up", b, "vx", 10, 40, math.exp(-2 * 30 / 60), 0.02)

  x = nextColumn()
  zone(x, 0, 300, 600, { forces = true, gravity = "replace", spinDrag = 3 })
  b = ball(x, 0, { spin = 360 })
  ratio("spinDrag slows turning down", b, "spin", 10, 40, math.exp(-3 * 30 / 60), 0.03)

  -- A push is a force: a body of 2 kg pushed with 200 speeds up by 100.
  x = nextColumn()
  zone(x, 0, 300, 600, { forces = true, gravity = "replace", pushX = 200 })
  b = ball(x - 100, 0, { mass = 2 })
  probe("push is a force (mass 2)", b, "vx", 10, 40, 100)

  x = nextColumn()
  zone(x, 0, 300, 2000, { forces = true, pushY = -490 })
  b = ball(x, 0)
  probe("push with the scene's gravity", b, "vy", 10, 40, 490)

  -- Overlapping: one zone replaces, two add.
  x = nextColumn()
  zone(x, 0, 300, 2000, { forces = true, gravity = "replace", gravityY = -200 })
  zone(x, 0, 300, 2000, { forces = true, gravity = "add", gravityY = 50 })
  zone(x, 0, 300, 2000, { forces = true, gravity = "add", gravityY = 30 })
  b = ball(x, 0)
  probe("adding zones add to a replacing one", b, "vy", 10, 40, -120)

  -- Only what the zone detects; not when it's off.
  x = nextColumn()
  zone(x, 0, 300, 2000, { forces = true, gravity = "replace", detects = "floaty" })
  local tagged = ball(x - 60, 0)
  tagged:tag("floaty")
  b = ball(x + 60, 0)
  probe("detects: a body with the tag floats", tagged, "vy", 10, 40, 0)
  probe("detects: a body without it falls", b, "vy", 10, 40, 980)

  x = nextColumn()
  zone(x, 0, 300, 2000, { forces = true, gravity = "replace", active = false })
  b = ball(x, 0)
  probe("a zone that isn't active pushes nothing", b, "vy", 10, 40, 980)

  -- Scripted bodies don't feel zone forces (their scripts move them).
  x = nextColumn()
  zone(x, 0, 300, 2000, { forces = true, gravity = "replace", gravityY = -500, pushX = 300 })
  local scripted = ball(x, 0, { motion = "scripted" })
  at(40, function()
    check("a scripted body isn't moved by a force zone", scripted.x == x and scripted.y == 0 and scripted.vx == 0 and scripted.vy == 0,
      scripted.x, scripted.y, scripted.vx, scripted.vy)
  end)

  -- Forces turned on and off while a body is inside.
  x = nextColumn()
  local switch = zone(x, 0, 300, 3000, { gravity = "replace" })
  b = ball(x, 0)
  at(20, function() switch.forces = true end)
  at(50, function() switch.forces = false end)
  probe("forces turned on while inside", b, "vy", 25, 45, 0)
  probe("forces turned off again", b, "vy", 55, 85, 980)

  -- A zone taken away while a body is inside.
  x = nextColumn()
  local gone = zone(x, 0, 300, 2000, { forces = true, gravity = "replace" })
  b = ball(x, 0)
  at(20, function() gone:destroy() end)
  probe("before the zone goes", b, "vy", 5, 18, 0)
  probe("after the zone went", b, "vy", 25, 55, 980)

  -- Leaving: a body going right out of a floating zone falls again.
  x = nextColumn()
  zone(x, 0, 200, 600, { forces = true, gravity = "replace" })
  local leaver = ball(x, 0, { vx = 600 })
  local left = nil
  leaver:on("exited", function()
    if left then return end
    left = steps
    probe("leaving: the scene's gravity again", leaver, "vy", left + 5, left + 35, 980)
  end)
  probe("leaving: no fall while inside", leaver, "vy", 3, 9, 0)
  at(70, function() check("leaving: exited came", left ~= nil and left > 5 and left < 20, left) end)

  -- Two zones that replace: the one it went into last wins.
  x = nextColumn() + 800
  column += 3
  zone(x, 0, 400, 1000, { forces = true, gravity = "replace", gravityY = -200 })
  local second = zone(x + 300, 0, 400, 1000, { forces = true, gravity = "replace", gravityY = -400 })
  local mover = ball(x - 100, 0, { vx = 300 })
  local inSecond = nil
  second:on("entered", function(o)
    if o ~= mover or inSecond then return end
    inSecond = steps
    probe("overlap: the one it went into last wins", mover, "vy", inSecond + 2, inSecond + 14, -400)
  end)
  probe("overlap: only the first zone", mover, "vy", 10, 30, -200)
  at(100, function() check("overlap: went into the second", inSecond ~= nil and inSecond > 30 and inSecond < 50, inSecond) end)
end

-- Every step: the default zones change nothing, and the probes.
local worst = 0

local function stepChecks()
  if free and steps <= 60 then
    for _, b in ipairs({ plain, unforced }) do
      worst = math.max(worst, math.abs(b.y - free.y), math.abs(b.vy - free.vy), math.abs(b.vx - free.vx))
    end
    if steps == 60 then
      check("a default Zone and one with forces off change nothing", worst < 1e-4, worst)
    end
  end
  for _, p in ipairs(probes) do
    if steps == p.s1 then p.v1 = p.b[p.axis] end
    if steps == p.s2 and p.v1 then
      local v2 = p.b[p.axis]
      if p.ratio then
        local r = v2 / p.v1
        check(p.name, near(r, p.want, p.tol), r, "wanted", p.want)
      else
        local a = (v2 - p.v1) * 60 / (p.s2 - p.s1)
        check(p.name, near(a, p.want, p.tol), a, "wanted", p.want)
      end
    end
  end
  if steps == 45 then check("a force zone still sends entered", events[1] == "entered", events[1]) end
end

---------------------------------------------------------------------------
-- Random numbers and noise

local function same(a, b)
  if #a ~= #b then return false end
  for i = 1, #a do if a[i] ~= b[i] then return false end end
  return true
end

-- A mix of everything that seed() makes repeatable.
local function draws()
  local list = { "a", "b", "c", "d", "e" }
  local out = { rnd(), rnd(10), rnd({ "x", "y", "z" }), choose(1, 2, 3, 4), smitten.math.random(1, 6),
    smitten.math.random(), smitten.math.chance(0.5) and 1 or 0, smitten.math.pick(list), smitten.math.randomFloat(-1, 1),
    smitten.math.randomNormal(1, 0) }
  for _, v in ipairs(smitten.math.shuffle(list)) do out[#out + 1] = v end
  return out
end

-- The worked example of docs/random.md: a cave in a Tiles piece.
local function makeCave(tiles, caveSeed)
  tiles:clear()
  local cave = smitten.math.newNoise({ seed = caveSeed, scale = 12, octaves = 3 })
  local hills = smitten.math.newNoise({ seed = caveSeed, scale = 30, octaves = 2 })
  for column = 0, 59 do
    local ground = math.floor(5 + hills:get(column) * 10)
    for row = ground, 29 do
      if cave:get(column, row) > 0.5 then tiles:setTile(column, row, 0) end
    end
  end
end

local function caveText(tiles)
  local out = {}
  for row = 0, 29 do
    for column = 0, 59 do out[#out + 1] = tiles:getTile(column, row) >= 0 and "#" or "." end
  end
  return table.concat(out)
end

local function randomChecks()
  -- The first numbers after a seed, worked out from LÖVE's generator
  -- (xorshift64*, its seed hashed): the same in every browser.
  check("seed returns the seed", seed(42) == 42)
  local got = { rnd(), rnd(), rnd(), rnd() }
  check("seed(42): the first numbers", same(got, { 0.6237065366691175, 0.8257080695655126, 0.2190717750823592, 0.33328089174881015 }),
    string.format("%.17g %.17g %.17g %.17g", got[1], got[2], got[3], got[4]))
  seed(42)
  local a = draws()
  seed(42)
  local b = draws()
  check("seed: rnd, choose, random, chance, pick, shuffle repeat", same(a, b))
  seed(43)
  check("another seed, other numbers", not same(a, draws()))
  local s = seed()
  check("seed() makes up a whole number", type(s) == "number" and s == math.floor(s), s)
  local s2 = seed()
  check("seed() twice, two seeds", s ~= s2, s, s2)
  seed(s)
  local c = draws()
  seed(s)
  check("the seed seed() made repeats too", same(c, draws()))
  local ok, err = pcall(seed, {})
  check("seed({}) says what a seed is", not ok and tostring(err):find("a seed is a number or a string", 1, true), err)

  -- Generators of their own.
  local r = smitten.math.newRandom(7)
  got = { r:rnd(), r:rnd(), r:rnd() }
  check("newRandom(7): the first numbers", same(got, { 0.18697835341699598, 0.6277087391428564, 0.16773929801030207 }),
    string.format("%.17g %.17g %.17g", got[1], got[2], got[3]))
  check("getSeed", r:getSeed() == 7)
  local cave = smitten.math.newRandom("cave")
  local first = cave:rnd()
  check("a string seed", first == 0.49915516152072414, string.format("%.17g", first))
  seed(5)
  local alone = { rnd(), rnd(), rnd() }
  seed(5)
  local other = smitten.math.newRandom(1)
  local mixed = {}
  for i = 1, 3 do
    for _ = 1, 4 do other:rnd() end
    mixed[i] = rnd()
  end
  check("a generator doesn't change the game's numbers", same(alone, mixed))
  local st = r:getState()
  local nexts = { r:rnd(), r:random(1, 100), r:rnd(5) }
  r:setState(st)
  check("getState and setState", same(nexts, { r:rnd(), r:random(1, 100), r:rnd(5) }))
  local deck = { 1, 2, 3, 4, 5, 6, 7, 8, 9, 10 }
  r:shuffle(deck)
  local sorted = { unpack(deck) }
  table.sort(sorted)
  check("a generator's shuffle", same(sorted, { 1, 2, 3, 4, 5, 6, 7, 8, 9, 10 }) and not same(deck, sorted), table.concat(deck, ","))
  local ints = true
  for _ = 1, 200 do
    local v = r:random(3, 5)
    ints = ints and (v == 3 or v == 4 or v == 5)
  end
  check("random(3, 5)", ints)

  -- Noise
  check("noise(0.5, 0.25)", near(noise(0.5, 0.25), 0.16975223030158965, 1e-12), string.format("%.17g", noise(0.5, 0.25)))
  check("noise(3.7)", near(noise(3.7), 0.58448043164750008, 1e-12), noise(3.7))
  check("noise(1.5, 2.25, 0.75)", near(noise(1.5, 2.25, 0.75), 0.87821261153930252, 1e-12), noise(1.5, 2.25, 0.75))
  local lo, hi, smooth = 1, 0, 0
  for i = 0, 399 do
    local x, y = (i % 20) * 0.37, math.floor(i / 20) * 0.41
    local v = noise(x, y)
    lo, hi = math.min(lo, v), math.max(hi, v)
    smooth = math.max(smooth, math.abs(v - noise(x + 0.01, y)), math.abs(v - noise(x, y + 0.01)))
  end
  check("noise is from 0 to 1", lo >= 0 and hi <= 1, lo, hi)
  check("noise goes up and down", hi - lo > 0.5, lo, hi)
  check("noise is smooth", smooth < 0.03, smooth)

  local n1 = smitten.math.newNoise({ seed = 3, scale = 40, octaves = 4 })
  local n2 = smitten.math.newNoise({ seed = 3, scale = 40, octaves = 4 })
  local n3 = smitten.math.newNoise({ seed = 4, scale = 40, octaves = 4 })
  local agree, differ, inRange, steady = true, false, true, 0
  lo, hi = 1, 0
  for x = 0, 300, 13 do
    for y = 0, 200, 17 do
      local v = n1:get(x, y)
      agree = agree and v == n2:get(x, y)
      differ = differ or v ~= n3:get(x, y)
      inRange = inRange and v >= 0 and v <= 1
      lo, hi = math.min(lo, v), math.max(hi, v)
      steady = math.max(steady, math.abs(v - n1:get(x + 1, y)))
    end
  end
  check("newNoise: one seed, the same noise", agree)
  check("newNoise: another seed, other noise", differ)
  check("newNoise: from 0 to 1", inRange, lo, hi)
  check("newNoise: goes up and down", hi - lo > 0.3, lo, hi)
  check("newNoise: smooth at scale 40", steady < 0.1, steady)

  -- The cave of the docs: the same from the same seed.
  makeCave(Cave, 1)
  local one = caveText(Cave)
  makeCave(Cave, 1)
  local again = caveText(Cave)
  makeCave(Cave, 2)
  local two = caveText(Cave)
  local _, filled = one:gsub("#", "")
  check("a cave from a seed repeats", one == again)
  check("another seed, another cave", one ~= two)
  check("the cave is part rock, part air", filled > 150 and filled < 1200, filled)
end

-- Particles and the camera's shake draw their own random numbers.
local function decorationChecks()
  seed(9)
  local before = { rnd(), rnd(), rnd() }
  seed(9)
  Sparks:start()
  View:shake(8, 0.5)
  wait(0.4)
  local after = { rnd(), rnd(), rnd() }
  Sparks:stop()
  check("particles and shake don't use up seeded numbers", same(before, after))
  check("the particles really ran", Sparks:getCount() > 0, Sparks:getCount())
end

---------------------------------------------------------------------------

function ready()
  randomChecks()
  forceCases()
  task(function()
    decorationChecks()
    randomDone = true
  end)
end

function physicsUpdate(dt)
  steps += 1
  if later[steps] then
    for _, fn in ipairs(later[steps]) do fn() end
  end
  stepChecks()
  if steps >= 130 and randomDone and not finished then
    finished = true
    print(string.format("DONE %d passed, %d failed", passed, failed))
  end
end
