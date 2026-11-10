-- Checks Lights, Occluders and the Tint by drawing small scenes to a canvas
-- and reading pixels back, then the window itself through a screenshot.
-- Prints PASS or FAIL for each check, then DONE (tools/scene-tests/run.mjs
-- reads them).

local nodes2d = require("love.scene.nodes2d")
local lights = require("love.scene.lights")
local g = smitten.graphics

local W, H = 200, 120
local passed, failed, state = 0, 0, "start"
local canvas, stage
local waited = 0

local function pass(name)
  passed += 1
  print("PASS " .. name)
end

local function fail(name, why)
  failed += 1
  print("FAIL " .. name .. ": " .. why)
end

local function check(name, ok, why)
  if ok then pass(name) else fail(name, why or "not so") end
end

-- A pixel is the color we want, give or take.
local function near(name, data, x, y, r, gr, b, tolerance)
  tolerance = tolerance or 0.03
  local pr, pg, pb = data:getPixel(x, y)
  if math.abs(pr - r) <= tolerance and math.abs(pg - gr) <= tolerance and math.abs(pb - b) <= tolerance then
    pass(name)
  else
    fail(name, ("pixel %d,%d is %.3f %.3f %.3f, wanted %.3f %.3f %.3f"):format(x, y, pr, pg, pb, r, gr, b))
  end
end

local function grey(name, data, x, y, v, tolerance)
  near(name, data, x, y, v, v, v, tolerance)
end

local function clear()
  for i = #stage.children, 1, -1 do stage.children[i]:remove() end
end

local function add(kind, props, parent)
  return (parent or stage):add(make(kind, props))
end

-- A grey floor over the whole view: what the lights shine on.
local function floor(v, props)
  local p = { x = W / 2, y = H / 2, width = W, height = H, color = { v, v, v, 1 } }
  for k, x in pairs(props or {}) do p[k] = x end
  return add("Shape", p)
end

local function box(x, y, w, h, color, props)
  local p = { x = x, y = y, width = w, height = h, color = color }
  for k, v in pairs(props or {}) do p[k] = v end
  return add("Shape", p)
end

-- Draws the stage to the canvas and returns its pixels.
local function shot()
  g.push("all")
  g.setCanvas(canvas)
  g.setScissor()
  g.origin()
  g.clear(0, 0, 0, 1)
  nodes2d.render(stage)
  g.pop()
  return g.readbackTexture(canvas)
end

local function checks()
  local d

  -- No lights: the usual renderer, untouched.
  clear()
  floor(0.25)
  box(50, 60, 20, 20, { 1, 0.5, 0.25, 1 })
  local before = lights._frames
  d = shot()
  grey("plain: floor", d, 150, 60, 0.25)
  near("plain: box", d, 50, 60, 1, 0.5, 0.25)
  check("plain: fast path", lights._frames == before and nodes2d._lights == 0,
    ("%d lit frames, %d lights counted"):format(lights._frames - before, nodes2d._lights))

  -- lit = false alone doesn't leave the fast path, and changes nothing.
  box(100, 60, 20, 20, { 0.5, 1, 0.5, 1 }, { lit = false })
  d = shot()
  near("unlit piece, no lights: same color", d, 100, 60, 0.5, 1, 0.5)
  check("unlit piece, no lights: fast path", lights._frames == before)

  -- A Tint multiplies.
  clear()
  floor(0.5)
  box(50, 60, 20, 20, { 1, 0.5, 0.25, 1 })
  local tint = add("Tint", { color = { 0.5, 1, 0.2, 1 } })
  d = shot()
  near("tint: floor", d, 150, 60, 0.25, 0.5, 0.1)
  near("tint: box", d, 50, 60, 0.5, 0.5, 0.05)
  check("tint: lit path", lights._frames == before + 1 and nodes2d._lights == 1,
    ("%d lit frames, %d counted"):format(lights._frames - before, nodes2d._lights))
  tint.off = true
  d = shot()
  grey("tint off: floor", d, 150, 60, 0.5)
  tint.off = false
  tint.color = { 1, 1, 1, 1 }
  d = shot()
  grey("white tint: unchanged", d, 150, 60, 0.5)
  near("white tint: box unchanged", d, 50, 60, 1, 0.5, 0.25)
  tint:remove()
  check("tint removed: counter back to 0", nodes2d._lights == 0)

  -- A point light adds inside its radius and not outside.
  clear()
  floor(0.25)
  local light = add("Light", { x = 100, y = 60, radius = 40 })
  d = shot()
  grey("light: center", d, 100, 60, 0.5)
  grey("light: half way", d, 120, 60, 0.37)
  grey("light: half way, below", d, 100, 80, 0.37)
  grey("light: outside", d, 150, 60, 0.25, 0.01)
  grey("light: outside, corner", d, 135, 95, 0.25, 0.01)
  check("light: float light map", lights._stats.float == true, "8 bit light maps are in use")
  light.brightness = 2
  d = shot()
  grey("brightness 2: center", d, 100, 60, 0.75)
  light.brightness = 1
  light.color = { 1, 0, 0.5, 1 }
  d = shot()
  near("color: center", d, 100, 60, 0.5, 0.25, 0.375)
  light.color = { 1, 1, 1, 1 }
  light.radius = 80
  d = shot()
  grey("radius 80: at 40", d, 140, 60, 0.37)
  light.radius = 40
  light.off = true
  d = shot()
  grey("light off", d, 100, 60, 0.25)
  light.off = false
  light.visible = false
  d = shot()
  grey("light hidden", d, 100, 60, 0.25)
  light.visible = true
  light.scaleX = 2
  d = shot()
  grey("light scaled: reaches further across", d, 140, 60, 0.37)
  grey("light scaled: not further down", d, 100, 105, 0.25, 0.01)
  light.scaleX = 1

  -- Lights add up, past white.
  local second = add("Light", { x = 100, y = 60, radius = 40, brightness = 3 })
  d = shot()
  grey("two lights add up", d, 100, 60, 1, 0.02)
  check("two lights counted", lights._stats.lights == 2 and lights._stats.groups == 1,
    ("%d lights, %d groups"):format(lights._stats.lights, lights._stats.groups))
  second:remove()

  -- A light out of view is skipped.
  light.x = 400
  d = shot()
  check("light out of view: skipped", lights._stats.lights == 0, lights._stats.lights .. " lights drawn")
  light.x = 100

  -- Blend modes.
  light.blend = "subtract"
  light.brightness = 0.5
  d = shot()
  grey("subtract: center", d, 100, 60, 0.125)
  grey("subtract: outside", d, 150, 60, 0.25, 0.01)
  light.blend = "mix"
  light.brightness = 1
  light.color = { 0, 1, 0, 1 }
  d = shot()
  near("mix: center", d, 100, 60, 0, 0.25, 0)
  grey("mix: outside", d, 150, 60, 0.25, 0.01)
  light.blend = "add"
  light.color = { 1, 1, 1, 1 }

  -- Night: a dark tint and a torch.
  tint = add("Tint", { color = { 0.2, 0.2, 0.4, 1 } })
  d = shot()
  near("night: dark away from the torch", d, 20, 20, 0.05, 0.05, 0.1)
  near("night: lit at the torch", d, 100, 60, 0.3, 0.3, 0.35)

  -- An unlit piece keeps its color, and its place in the draw order: lit
  -- under it, lit over it.
  local glow = box(60, 30, 30, 30, { 1, 1, 0.5, 1 }, { lit = false })
  local over = box(70, 40, 20, 20, { 1, 1, 1, 1 })
  d = shot()
  near("unlit: full color", d, 50, 20, 1, 1, 0.5)
  near("lit piece over the unlit one", d, 62, 32, 0.2, 0.2, 0.4)
  -- lit is inherited.
  local group = add("Group", { lit = false })
  box(180, 100, 20, 20, { 0.5, 1, 1, 1 }, nil)
  local inside = make("Shape", { x = 180, y = 20, width = 20, height = 20, color = { 0.5, 1, 1, 1 } })
  group:add(inside)
  d = shot()
  near("unlit group: its piece is unlit", d, 180, 20, 0.5, 1, 1)
  near("lit piece next to it is tinted", d, 180, 100, 0.1, 0.2, 0.4)

  -- Text is lit too.
  clear()
  add("Tint", { color = { 0.5, 0.5, 0.5, 1 } })
  add("Text", { x = 100, y = 60, text = "MMMM", size = 40 })
  d = shot()
  local brightest = 0
  for y = 40, 80 do
    for x = 40, 160 do
      local r = d:getPixel(x, y)
      if r > brightest then brightest = r end
    end
  end
  check("text under a tint", math.abs(brightest - 0.5) < 0.04, "its brightest pixel is " .. brightest)

  -- Layers: a light and a tint with a layer range.
  clear()
  box(50, 60, 100, 120, { 0.25, 0.25, 0.25, 1 })
  box(150, 60, 100, 120, { 0.25, 0.25, 0.25, 1 }, { layer = 1 })
  light = add("Light", { x = 100, y = 60, radius = 80, fromLayer = 1 })
  d = shot()
  grey("fromLayer 1: layer 0 not lit", d, 90, 60, 0.25, 0.01)
  grey("fromLayer 1: layer 1 lit", d, 110, 60, 0.49)
  light.fromLayer, light.toLayer = nil, 0
  d = shot()
  grey("toLayer 0: layer 0 lit", d, 90, 60, 0.49)
  grey("toLayer 0: layer 1 not lit", d, 110, 60, 0.25, 0.01)
  tint = add("Tint", { color = { 0.4, 0.4, 0.4, 1 }, fromLayer = 1 })
  d = shot()
  grey("tint fromLayer 1: layer 1 tinted", d, 180, 100, 0.1, 0.02)
  grey("tint fromLayer 1: layer 0 not", d, 10, 100, 0.25, 0.02)
  check("layers: two groups", lights._stats.groups == 2, lights._stats.groups .. " groups")

  -- Tags: a light that only lights "hero" pieces (and what's in them).
  clear()
  floor(0.25)
  local hero = add("Group", { x = 80, y = 60 })
  hero:tag("hero")
  hero:add(make("Shape", { width = 20, height = 20, color = { 0.25, 0.25, 0.25, 1 } }))
  local other = box(120, 60, 20, 20, { 0.25, 0.25, 0.25, 1 })
  other:tag("villain")
  light = add("Light", { x = 100, y = 60, radius = 80, lights = "hero, friend" })
  d = shot()
  grey("tags: hero lit", d, 80, 60, 0.46, 0.04)
  grey("tags: floor not lit", d, 100, 60, 0.25, 0.01)
  grey("tags: villain not lit", d, 120, 60, 0.25, 0.01)
  light.lights = ""
  d = shot()
  grey("tags: empty lights everything", d, 120, 60, 0.46, 0.04)

  -- Shadows from an Occluder.
  clear()
  floor(0.25)
  light = add("Light", { x = 60, y = 60, radius = 100, brightness = 2, shadows = true })
  local wall = add("Occluder", { x = 100, y = 60, shape = "rectangle", width = 10, height = 30 })
  d = shot()
  grey("shadow: behind the occluder", d, 125, 60, 0.25, 0.01)
  grey("shadow: far behind", d, 155, 62, 0.25, 0.01)
  check("shadow: not above it", d:getPixel(125, 20) > 0.3, "pixel is " .. d:getPixel(125, 20))
  check("shadow: not in front", d:getPixel(85, 60) > 0.5, "pixel is " .. d:getPixel(85, 60))
  check("shadow: the occluder itself is lit", d:getPixel(100, 60) > 0.45, "pixel is " .. d:getPixel(100, 60))
  check("shadow: edges counted", lights._stats.edges > 0 and lights._stats.shadowLights == 1,
    ("%d edges, %d shadow lights"):format(lights._stats.edges, lights._stats.shadowLights))
  wall.off = true
  d = shot()
  check("occluder off: lit again", d:getPixel(125, 60) > 0.3, "pixel is " .. d:getPixel(125, 60))
  local open = d:getPixel(125, 60)
  wall.off = false
  light.shadows = false
  d = shot()
  check("shadows off: lit", math.abs(d:getPixel(125, 60) - open) < 0.01, "pixel is " .. d:getPixel(125, 60))
  light.shadows = true
  wall:remove()
  d = shot()
  check("occluder removed: lit", math.abs(d:getPixel(125, 60) - open) < 0.01, "pixel is " .. d:getPixel(125, 60))
  stage:add(wall)

  -- The edges are kept until the occluder changes.
  d = shot()
  local rebuilt = lights._rebuilt
  d = shot()
  check("edges are cached", lights._rebuilt == rebuilt, (lights._rebuilt - rebuilt) .. " rebuilt")
  wall.y = 20
  d = shot()
  check("moving the occluder rebuilds them", lights._rebuilt == rebuilt + 1)
  check("moved occluder: old place lit", math.abs(d:getPixel(125, 60) - open) < 0.01)
  grey("moved occluder: shadow moved", d, 110, 18, 0.25, 0.01)
  wall.y = 60

  -- Shadow color, softness, shadowsFrom.
  light.shadowColor = { 0, 0, 0, 0.5 }
  d = shot()
  grey("half shadow", d, 125, 60, (0.25 + open) / 2, 0.015)
  light.shadowColor = { 0, 0, 0, 1 }
  d = shot()
  light.shadowSoftness = 6
  d = shot()
  grey("soft shadow: still dark inside", d, 125, 60, 0.25, 0.02)
  local a, b = d:getPixel(125, 34), d:getPixel(125, 31)
  local lo, hi = d:getPixel(125, 60), d:getPixel(125, 20)
  check("soft shadow: a blurred edge", a < hi - 0.01 and a > lo + 0.01 or b < hi - 0.01 and b > lo + 0.01,
    ("edge pixels %.3f %.3f between %.3f and %.3f"):format(a, b, lo, hi))
  light.shadowSoftness = 0
  wall:tag("thick")
  light.shadowsFrom = "glass"
  d = shot()
  check("shadowsFrom: other tags don't block", math.abs(d:getPixel(125, 60) - open) < 0.01)
  light.shadowsFrom = "glass, thick"
  d = shot()
  grey("shadowsFrom: the tag blocks", d, 125, 60, 0.25, 0.01)
  light.shadowsFrom = ""

  -- Shapes: circle, polygon, auto (inside a piece with a Shape; with a Shape inside).
  wall.shape, wall.radius = "circle", 12
  d = shot()
  grey("circle occluder: shadow", d, 130, 60, 0.25, 0.01)
  check("circle occluder: not beside it", d:getPixel(100, 30) > 0.3)
  wall.shape, wall.points = "polygon", { -5, -15, 5, -15, 5, 15, -5, 15 }
  d = shot()
  grey("polygon occluder: shadow", d, 125, 60, 0.25, 0.01)
  wall.points = { -5, 15, 5, 15, 5, -15, -5, -15 }
  d = shot()
  grey("polygon occluder, other winding: shadow", d, 125, 60, 0.25, 0.01)
  check("polygon occluder, other winding: front lit", d:getPixel(85, 60) > 0.5)
  wall:remove()
  local crate = add("Group", { x = 100, y = 60 })
  crate:add(make("Shape", { width = 10, height = 30, color = { 0.25, 0.25, 0.25, 1 } }))
  local auto = crate:add(make("Occluder"))
  d = shot()
  grey("auto occluder next to a Shape: shadow", d, 125, 60, 0.25, 0.01)
  grey("auto occluder next to a Shape: as tall as the Shape", d, 125, 40, 0.25, 0.01)
  check("auto occluder next to a Shape: not above", d:getPixel(125, 20) > 0.3)
  crate.rotation = math.pi / 2
  d = shot()
  check("auto occluder turns with its piece", d:getPixel(125, 40) > 0.3 and d:getPixel(125, 60) < 0.26,
    ("%.3f %.3f"):format(d:getPixel(125, 40), d:getPixel(125, 60)))
  crate:remove()
  local own = add("Occluder", { x = 100, y = 60 })
  own:add(make("Shape", { shape = "circle", radius = 12, color = { 0.25, 0.25, 0.25, 1 } }))
  d = shot()
  grey("auto occluder with a Shape inside: shadow", d, 130, 60, 0.25, 0.01)
  own:remove()

  -- Tiles that cast shadows: a wall of solid tiles (tile 0), 2 across, 3 down.
  light.radius = 140
  local tiles = add("Tiles", { tileset = "art/tiles.tileset", x = 96, y = 36, castShadows = true,
    cells = { x = 0, y = 0, w = 2, h = 3, data = "0*6" } })
  d = shot()
  grey("tiles: shadow behind the wall", d, 150, 60, 0.25, 0.01)
  check("tiles: lit in front", d:getPixel(85, 60) > 0.5)
  check("tiles: runs merged", lights._stats.edges <= 3, lights._stats.edges .. " edges cast")
  tiles.castShadows = false
  d = shot()
  check("tiles: castShadows off", d:getPixel(150, 60) > 0.3)
  tiles.castShadows = true
  d = shot()
  tiles:setTile(0, 1, -1)
  tiles:setTile(1, 1, -1)
  d = shot()
  check("tiles: a gap lets light through", d:getPixel(150, 60) > 0.3, "pixel is " .. d:getPixel(150, 60))
  grey("tiles: still a shadow beside the gap", d, 150, 30, 0.25, 0.01)
  tiles:remove()

  -- A sun: lights everything, shadows point the way it is turned.
  clear()
  floor(0.25)
  light = add("Light", { kind = "sun", brightness = 1, shadows = true })
  wall = add("Occluder", { x = 100, y = 60, shape = "rectangle", width = 10, height = 30 })
  d = shot()
  grey("sun: lights the view", d, 20, 100, 0.5)
  grey("sun: shadow to the right", d, 150, 60, 0.25, 0.01)
  grey("sun: none to the left", d, 50, 60, 0.5)
  grey("sun: none below", d, 100, 100, 0.5)
  light.rotation = math.pi / 2
  d = shot()
  grey("sun turned down: shadow below", d, 100, 100, 0.25, 0.01)
  grey("sun turned down: none to the right", d, 150, 60, 0.5)
  light.shadowLength = 20
  d = shot()
  grey("sun shadowLength: shadow near", d, 100, 85, 0.25, 0.01)
  grey("sun shadowLength: none past it", d, 100, 110, 0.5)

  -- Through a Camera: zoomed in 2x on 300, 200.
  clear()
  floor(0.25, { x = 300, y = 200, width = 400, height = 400 })
  light = add("Light", { x = 320, y = 200, radius = 20 })
  local camera = add("Camera", { x = 300, y = 200, zoom = 2 })
  camera:snap()
  d = shot()
  grey("camera: the light is where the piece is", d, 140, 60, 0.5)
  grey("camera: zoomed radius", d, 160, 60, 0.37)
  grey("camera: nothing at the middle", d, 95, 60, 0.25, 0.01)
  camera:remove()

  -- A scene file with lights (the demo scene): pieces made by the loader.
  clear()
  local demo = stage:add(make("scenes/demo.scene"))
  d = shot()
  check("demo scene: both lights, with shadows", lights._stats.lights == 2 and lights._stats.shadowLights == 2
    and lights._stats.edges > 4, ("%d lights, %d with shadows, %d edges"):format(lights._stats.lights,
    lights._stats.shadowLights, lights._stats.edges))
  near("demo scene: night away from the lights", d, 4, 116, 0.5 * 0.16, 0.55 * 0.18, 0.45 * 0.34)
  check("demo scene: lit by the torch", d:getPixel(100, 66) > 0.4, "pixel is " .. d:getPixel(100, 66))
  near("demo scene: the lamp's bulb glows", d, 172, 96, 1, 0.95, 0.7)
  check("demo scene: a default Light has no shadows and radius 200",
    make("Light").shadows == false and make("Light").radius == 200 and make("Occluder").shape == "auto")

  -- Dozens of lights still come out right.
  clear()
  floor(0.1)
  for i = 0, 39 do add("Light", { x = 10 + (i % 10) * 20, y = 15 + math.floor(i / 10) * 30, radius = 10 }) end
  d = shot()
  grey("40 lights: one of them", d, 110, 45, 0.2)
  check("40 lights drawn", lights._stats.lights == 40, lights._stats.lights .. " drawn")
end

-- The window: a torch in the top left of a night scene, through a screenshot
-- (the light map must line up with the screen, the right way up).
local function windowScene()
  clear()
  floor(0.5)
  add("Tint", { color = { 0.2, 0.2, 0.2, 1 } })
  add("Light", { x = 50, y = 30, radius = 30 })
  box(150, 30, 20, 20, { 1, 0.5, 0, 1 }, { lit = false })
  box(150, 90, 20, 20, { 1, 1, 1, 1 })
end

local function done()
  state = "done"
  print(`DONE {passed} passed, {failed} failed`)
  -- Leave something to look at: the demo scene.
  go("scenes/demo.scene")
end

local function windowChecks(image)
  local scale = g.getDPIScale()
  local function at(x, y)
    local wx, wy = smitten.display.toWindow(x + 0.5, y + 0.5)
    return math.floor(wx * scale), math.floor(wy * scale)
  end
  local x, y = at(50, 30)
  grey("window: lit at the torch", image, x, y, 0.6, 0.03)
  x, y = at(50, 90)
  grey("window: dark below it", image, x, y, 0.1)
  x, y = at(150, 30)
  near("window: unlit piece", image, x, y, 1, 0.5, 0)
  x, y = at(150, 90)
  grey("window: lit piece", image, x, y, 0.2)
  x, y = at(64, 30)
  grey("window: part way out", image, x, y, 0.36, 0.06)
end

function update(dt)
  if state == "start" then
    state = "window"
    stage = find("Stage")
    canvas = g.newCanvas(W, H, { dpiscale = 1 })
    local ok, err = pcall(checks)
    if not ok then fail("the checks stopped", tostring(err)) end
    ok, err = pcall(windowScene)
    if not ok then fail("the window scene stopped", tostring(err)) end
  elseif state == "window" then
    -- One frame has drawn the scene; ask for the next one's pixels.
    state = "waiting"
    g.captureScreenshot(function(image)
      local ok, err = pcall(windowChecks, image)
      if not ok then fail("the window checks stopped", tostring(err)) end
      done()
    end)
  elseif state == "waiting" then
    waited += 1
    if waited > 120 then
      fail("window", "the screenshot never came")
      done()
    end
  end
end
