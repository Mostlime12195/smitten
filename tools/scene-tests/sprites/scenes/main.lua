-- Checks that the game draws sprites made in the sprite editor as the
-- editor shows them (art/ is written by tools/scene-tests/make-sprites-fixture.mjs
-- with the editor's own code): a .sprite file with layers (one at 50%
-- opacity, one hidden, a line drawn with the mirror) draws its flattened
-- PNG, and a walk cycle cut from a sprite sheet (margin, spacing) has the
-- right frames and plays. The engine reads only the PNG and the frames; the
-- layers in the .sprite file are for the editor. Prints PASS or FAIL for
-- each check, then DONE (tools/scene-tests/run.mjs reads them).

local nodes2d = require("love.scene.nodes2d")
local g = smitten.graphics

local W, H = 64, 32
local passed, failed, state = 0, 0, "start"
local canvas, stage, expected, walker
local timer = 0
local seen = {}
local steps = 0

local function check(name, ok, why)
  if ok then
    passed += 1
    print("PASS " .. name)
  else
    failed += 1
    print("FAIL " .. name .. ": " .. tostring(why or "not so"))
  end
end

-- Draws the stage on white to the canvas and returns its pixels.
local function shot()
  g.push("all")
  g.setCanvas(canvas)
  g.setScissor()
  g.origin()
  g.clear(1, 1, 1, 1)
  nodes2d.render(stage)
  g.pop()
  return g.readbackTexture(canvas)
end

-- A pixel is the color we want (0-255), give or take 3.
local function near(name, data, x, y, rgb)
  local r, gr, b = data:getPixel(x, y)
  r, gr, b = math.floor(r * 255 + 0.5), math.floor(gr * 255 + 0.5), math.floor(b * 255 + 0.5)
  local ok = math.abs(r - rgb[1]) <= 3 and math.abs(gr - rgb[2]) <= 3 and math.abs(b - rgb[3]) <= 3
  check(name, ok, ("pixel %d,%d is %d %d %d, wanted %d %d %d"):format(x, y, r, gr, b, rgb[1], rgb[2], rgb[3]))
end

local function checks()
  expected = smitten.json.decode(assert(smitten.filesystem.read("expected.json")))

  -- The sprite with layers: an 8×8 frame, centered at 12, 12.
  local hero = stage:add(make("Sprite", { image = "art/hero.sprite", x = 12, y = 12, playing = false }))
  check("layers: the .sprite file with layers loads", hero ~= nil)
  check("layers: its animation is there", hero:hasAnimation("idle"))
  local w, h = hero:getSize()
  check("layers: the frame size is 8 x 8", w == 8 and h == 8, tostring(w) .. " x " .. tostring(h))
  for f = 0, 1 do
    hero.frame = f
    hero.playing = false
    local d = shot()
    for _, p in ipairs(expected.hero[f + 1]) do
      near(("layers: frame %d, pixel %d,%d is the layers flattened"):format(f, p.x, p.y), d, 8 + p.x, 8 + p.y, p.rgb)
    end
  end
  hero:remove()

  -- The walk cycle cut from a sheet: 6×6 frames, centered at 32, 12.
  walker = stage:add(make("Sprite", { image = "art/walk.sprite", x = 32, y = 12, playing = false }))
  check("sheet: the walk animation is there", walker:hasAnimation("walk"))
  local ww, wh = walker:getSize()
  check("sheet: the frame size is 6 x 6 (no margin or spacing in it)", ww == 6 and wh == 6, tostring(ww) .. " x " .. tostring(wh))
  for f = 0, 2 do
    walker.frame = f
    walker.playing = false
    local d = shot()
    near(("sheet: frame %d is cell %d of the sheet"):format(f, f), d, 32, 12, expected.walk[f + 1].rgb)
    -- The frame's corner pixel: the cell, not the grey margin of the sheet.
    near(("sheet: frame %d has no margin in it"):format(f), d, 29, 9, expected.walk[f + 1].rgb)
  end
  walker.frame = 0
  walker:play("walk")
end

local function done()
  print(`DONE {passed} passed, {failed} failed`)
  state = "done"
end

function update(dt)
  if state == "start" then
    state = "play"
    stage = find("Stage")
    canvas = g.newCanvas(W, H, { dpiscale = 1 })
    local ok, err = pcall(checks)
    if not ok then
      check("the checks ran", false, tostring(err))
      done()
    end
  elseif state == "play" then
    -- At 10 frames per second, the walk cycle shows its other frames soon.
    -- (The first step after the checks is long: they read pixels back. Count
    -- short steps, and at least 20 of them.)
    timer += math.min(dt, 0.05)
    steps += 1
    seen[walker.frame] = true
    if timer > 0.6 and steps >= 20 then
      local count = 0
      for _ in pairs(seen) do count += 1 end
      check("sheet: the walk animation plays (it shows more than one frame)", walker.playing and walker.animation == "walk" and count >= 2,
        "frames seen: " .. tostring(count) .. ", animation " .. tostring(walker.animation))
      done()
    end
  end
end
