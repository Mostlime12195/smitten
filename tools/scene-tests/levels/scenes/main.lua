-- Checks terrains, animated tiles and Backgrounds: terrain painting against
-- the cases the editor's matcher is checked with (terrain-cases.json), and
-- the rest by drawing small scenes to a canvas and reading pixels back.
-- Prints PASS or FAIL for each check, then DONE (tools/scene-tests/run.mjs
-- reads them).

local nodes2d = require("love.scene.nodes2d")
local lights = require("love.scene.lights")
local terrainLib = require("love.scene.terrain")
local assets = require("love.assets")
local json = smitten.json
local g = smitten.graphics

local W, H = 200, 120
local passed, failed = 0, 0
local canvas, stage, co

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

-- The flat color of a tile in art/tiles.png (make-levels-fixture.mjs).
local function tileColor(i)
  return ((i % 8) * 32 + 16) / 255, (math.floor(i / 8) * 20 + 16) / 255, 128 / 255
end

-- Which tile's color a pixel has, or nil.
local function tileAtPixel(data, x, y)
  local pr, pg, pb = data:getPixel(x, y)
  for i = 0, 95 do
    local r, gr, b = tileColor(i)
    if math.abs(pr - r) <= 0.02 and math.abs(pg - gr) <= 0.02 and math.abs(pb - b) <= 0.02 then return i end
  end
  return nil
end

local function isTile(name, data, x, y, tile)
  local got = tileAtPixel(data, x, y)
  check(name, got == tile, ("pixel %d,%d shows tile %s, wanted tile %s"):format(x, y, tostring(got), tostring(tile)))
end

local function clear()
  for i = #stage.children, 1, -1 do stage.children[i]:remove() end
end

local function add(kind, props, parent)
  return (parent or stage):add(make(kind, props))
end

local BLACK = { 0, 0, 0 }
local RED = { 1, 0.25, 0.25, 1 }
local GREEN = { 0.25, 1, 0.25, 1 }
local BLUE = { 0.25, 0.25, 1, 1 }

local function box(x, y, w, h, color, props, parent)
  local p = { x = x, y = y, width = w, height = h, color = color }
  for k, v in pairs(props or {}) do p[k] = v end
  return add("Shape", p, parent)
end

local function isColor(name, data, x, y, c, tolerance)
  near(name, data, x, y, c[1], c[2], c[3], tolerance)
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

-- Lets the game run for some frames (the checks run in a coroutine).
local function frames(n)
  for _ = 1, n do coroutine.yield() end
end

---------------------------------------------------------------------------
-- Terrains

local function terrainChecks()
  clear()
  local fixture = assets.readJSON("terrain-cases.json")
  local tiles = add("Tiles", { tileset = fixture.tileset })

  local names = tiles:terrains()
  check("terrains(): the tileset's, in order", table.concat(names, ",") == "grass,stone,water,pebbles", table.concat(names, ","))

  local function terrainOf(v)
    if v == nil or v == json.null then return nil end
    return v
  end

  for _, c in ipairs(fixture.cases) do
    tiles:clear()
    for _, s in ipairs(c.steps) do
      if s[1] == "set" then
        tiles:setTerrain(s[2], s[3], terrainOf(s[4]))
      elseif s[1] == "fill" then
        tiles:fillTerrain(s[2], s[3], s[4], s[5], terrainOf(s[6]))
      else
        tiles:setTile(s[2], s[3], s[4])
      end
    end
    local wrong = {}
    local seen = {}
    for _, cell in ipairs(tiles:cellsWith()) do
      local key = cell.column .. "," .. cell.row
      seen[key] = true
      if c.expect[key] ~= cell.tile then
        wrong[#wrong + 1] = ("%s is tile %d, wanted %s"):format(key, cell.tile, tostring(c.expect[key]))
      end
    end
    for key, tile in pairs(c.expect) do
      if not seen[key] then wrong[#wrong + 1] = ("%s is empty, wanted tile %d"):format(key, tile) end
    end
    check("terrain: " .. c.name, #wrong == 0, table.concat(wrong, "; "))
  end
  check("terrain: the cases were there", #fixture.cases >= 40, #fixture.cases .. " cases")

  -- getTerrain, and what plain tiles say.
  tiles:clear()
  tiles:fillTerrain(0, 0, 2, 2, "grass")
  tiles:setTerrain(5, 0, "stone")
  tiles:setTile(7, 0, 47)
  check("getTerrain: a terrain cell", tiles:getTerrain(1, 1) == "grass", tostring(tiles:getTerrain(1, 1)))
  check("getTerrain: another terrain", tiles:getTerrain(5, 0) == "stone", tostring(tiles:getTerrain(5, 0)))
  check("getTerrain: a plain tile", tiles:getTerrain(7, 0) == nil, tostring(tiles:getTerrain(7, 0)))
  check("getTerrain: an empty cell", tiles:getTerrain(20, 20) == nil)
  -- setTile stays exact.
  tiles:setTile(1, 0, 46)
  check("setTile: exact, next to terrain cells", tiles:getTile(1, 0) == 46 and tiles:getTile(0, 0) == 10,
    tiles:getTile(1, 0) .. ", " .. tiles:getTile(0, 0))
  -- Solid tiles made by a terrain block like any others (tile 0 is solid).
  tiles:clear()
  tiles:setTerrain(3, 3, "grass")
  check("terrain tiles keep their settings", tiles:isSolid(3, 3) and tiles:tileInfo(tiles:getTile(3, 3)).solid == true)

  -- Wrong names say what's there.
  local ok, err = pcall(tiles.setTerrain, tiles, 0, 0, "gras")
  check("setTerrain: unknown terrain is an error", not ok and tostring(err):find("no terrain called", 1, true) ~= nil
    and tostring(err):find("grass", 1, true) ~= nil, tostring(err))
  ok, err = pcall(tiles.fillTerrain, tiles, 0, 0, 2, 2, 7)
  check("fillTerrain: a number isn't a terrain", not ok and tostring(err):find("name", 1, true) ~= nil, tostring(err))
  local bare = add("Tiles", {})
  ok, err = pcall(bare.setTerrain, bare, 0, 0, "grass")
  check("setTerrain: no tileset is an error", not ok and tostring(err):find("tileset", 1, true) ~= nil, tostring(err))
  check("terrains(): none without a tileset", #bare:terrains() == 0)

  -- A terrain painted from a script is drawn: the 3 x 3 block's tiles.
  clear()
  tiles = add("Tiles", { tileset = fixture.tileset })
  tiles:fillTerrain(0, 0, 3, 3, "grass")
  local d = shot()
  isTile("terrain drawn: corner", d, 4, 4, 10)
  isTile("terrain drawn: middle", d, 12, 12, 46)
  isTile("terrain drawn: bottom right", d, 20, 20, 34)
  tiles:setTerrain(1, 1, nil)
  d = shot()
  isColor("terrain drawn: erased middle", d, 12, 12, BLACK)
  isTile("terrain drawn: the corner lost its inside corner", d, 4, 4, tiles:getTile(0, 0))
  check("terrain drawn: and it's another tile now", tiles:getTile(0, 0) ~= 10, "still tile 10")
end

---------------------------------------------------------------------------
-- Animated tiles

local function animationChecks()
  clear()
  local tiles = add("Tiles", { tileset = "art/terrain.tileset" })
  local ts = assets.tileset("art/terrain.tileset")
  check("animations: the tileset's two", #ts.animated == 2 and ts.animations[88] ~= nil and ts.animations[92] ~= nil)

  -- Tile 88: frames 88, 89, 90, 91, a quarter of a second each. Tile 5 is
  -- a plain tile beside it.
  tiles:setTile(0, 0, 88)
  tiles:setTile(1, 0, 5)
  tiles:setTile(40, 0, 88) -- in another chunk, off screen
  tiles._time = 0
  local d = shot()
  isTile("animated: first frame", d, 4, 4, 88)
  isTile("animated: the plain tile", d, 12, 4, 5)
  local version = tiles._animVersion
  d = shot()
  check("animated: nothing to do between frames", tiles._animVersion == version)
  tiles._time = 0.1
  d = shot()
  isTile("animated: still the first at 0.1 s", d, 4, 4, 88)
  check("animated: still nothing to do", tiles._animVersion == version)
  tiles._time = 0.3
  d = shot()
  isTile("animated: second frame at 0.3 s", d, 4, 4, 89)
  isTile("animated: the plain tile stays", d, 12, 4, 5)
  check("animated: one change", tiles._animVersion == version + 1, tostring(tiles._animVersion - version))
  tiles._time = 0.55
  d = shot()
  isTile("animated: third frame", d, 4, 4, 90)
  -- A cell changed while it animates: the chunk is built again mid-way.
  tiles:setTile(2, 0, 88)
  tiles:setTile(1, 0, 6)
  tiles._time = 0.8
  d = shot()
  isTile("animated: fourth frame", d, 4, 4, 91)
  isTile("animated: a cell added later is in step", d, 20, 4, 91)
  isTile("animated: the changed plain tile", d, 12, 4, 6)
  tiles._time = 1.05
  d = shot()
  isTile("animated: it loops", d, 4, 4, 88)
  tiles._time = 100.3
  d = shot()
  isTile("animated: much later", d, 4, 4, 89)
  check("animated: the cell still holds its own tile", tiles:getTile(0, 0) == 88)
  check("animated: settings come from the cell's tile", tiles:tileInfo(tiles:getTile(0, 0)).damage == 2)
  -- The chunk that was off screen catches up when it's seen.
  tiles.x = -320 + 8
  d = shot()
  isTile("animated: a chunk that was off screen", d, 12, 4, 89)
  tiles.x = 0

  -- The clock: runs with the game, stops with animate off and when paused,
  -- follows timeScale.
  tiles._time = 0
  frames(4)
  local t1 = tiles._time
  check("clock: runs", t1 > 0, tostring(t1))
  tiles.animate = false
  frames(3)
  check("clock: animate off stops it", tiles._time == t1, tostring(tiles._time - t1))
  tiles._time = 0.3
  d = shot()
  isTile("animate off: frozen on its frame", d, 4, 4, 89)
  frames(3)
  d = shot()
  isTile("animate off: still frozen", d, 4, 4, 89)
  tiles.animate = true
  pauseGame()
  frames(3)
  local t2 = tiles._time
  frames(4)
  check("clock: paused stops it", tiles._time == t2 and isPaused(), tostring(tiles._time - t2))
  d = shot()
  isTile("paused: frozen on its frame", d, 4, 4, tiles._time < 0.5 and 89 or 90)
  resumeGame()
  frames(3)
  check("clock: resumes", tiles._time > t2, tostring(tiles._time - t2))
  timeScale(0)
  frames(2)
  t2 = tiles._time
  frames(3)
  check("clock: timeScale 0 stops it", tiles._time == t2, tostring(tiles._time - t2))
  timeScale(1)

  -- Tile 92: frames 92 (0.5 s), 93 and 94 (0.25 s each), and every cell
  -- starts at one of 8 points of the loop, by its position.
  tiles:clear()
  for cx = 0, 15 do tiles:setTile(cx, 2, 92) end
  local function frameAt(cx, cy, time)
    local t = (time + (terrainLib.hash(cx, cy) % 8) / 8) % 1
    return t < 0.5 and 92 or t < 0.75 and 93 or 94
  end
  for _, time in ipairs({ 0.05, 0.3, 0.55, 0.8, 7.95 }) do
    tiles._time = time
    d = shot()
    local wrong, kinds = {}, {}
    for cx = 0, 15 do
      local got, want = tileAtPixel(d, cx * 8 + 4, 20), frameAt(cx, 2, time)
      kinds[want] = true
      if got ~= want then wrong[#wrong + 1] = ("cell %d shows %s, wanted %d"):format(cx, tostring(got), want) end
    end
    check(("random start: every cell's frame at %.2f s"):format(time), #wrong == 0, table.concat(wrong, "; "))
    if time == 0.05 then
      check("random start: cells differ", (kinds[92] and 1 or 0) + (kinds[93] and 1 or 0) + (kinds[94] and 1 or 0) >= 2)
    end
  end

  -- A tileset without animations never looks at the clock.
  clear()
  local plain = add("Tiles", { tileset = "art/plain.tileset" })
  plain:setTile(0, 0, 88)
  plain._time = 0.3
  d = shot()
  isTile("no animations: the tile as it is", d, 4, 4, 88)
  check("no animations: no animation state", plain._animVersion == nil)
  check("no terrains: an empty list", #plain:terrains() == 0 and plain:getTerrain(0, 0) == nil)
end

---------------------------------------------------------------------------
-- Backgrounds

local function backgroundChecks()
  clear()
  -- The camera starts on the scene's first screen: 0, 0 to 200, 120.
  local cam = add("Camera", { x = 100, y = 60 })
  local function look(x, y, zoom)
    cam.x, cam.y, cam.zoom = x, y, zoom or 1
    cam:snap()
  end
  look(100, 60)
  check("no Background yet", nodes2d._backgrounds() == 0, tostring(nodes2d._backgrounds()))

  -- Scenes without one draw the same with an idle one added.
  box(100, 60, 200, 120, { 0.2, 0.2, 0.2, 1 })
  box(50, 60, 20, 20, RED)
  local t = add("Tiles", { tileset = "art/terrain.tileset", x = 120, y = 20 })
  t:fillTerrain(0, 0, 4, 3, "grass")
  look(110, 64)
  local before = shot()
  local idle = add("Background", { scrollX = 1, scrollY = 1 })
  check("a Background is counted", nodes2d._backgrounds() == 1)
  local after = shot()
  local different = 0
  for y = 0, H - 1 do
    for x = 0, W - 1 do
      local r1, g1, b1 = before:getPixel(x, y)
      local r2, g2, b2 = after:getPixel(x, y)
      if r1 ~= r2 or g1 ~= g2 or b1 ~= b2 then different += 1 end
    end
  end
  check("an idle Background changes no pixel", different == 0, different .. " pixels differ")
  isColor("(and there was something to see)", before, 40, 56, RED)
  idle:remove()
  check("removed: counted out", nodes2d._backgrounds() == 0)

  -- scroll 0.5: half as far as the camera.
  clear()
  cam = add("Camera", { x = 100, y = 60 })
  look(100, 60)
  local bg = add("Background", { scrollX = 0.5, scrollY = 0.5 })
  box(50, 60, 20, 20, RED, nil, bg)
  local world = box(150, 60, 20, 20, GREEN)
  local d = shot()
  isColor("first screen: as placed", d, 50, 60, RED)
  isColor("first screen: a plain piece", d, 150, 60, GREEN)
  local sx, sy = bg:getScroll()
  check("first screen: getScroll is 0, 0", sx == 0 and sy == 0, sx .. ", " .. sy)
  look(140, 60)
  d = shot()
  isColor("camera 40 right: the plain piece moved 40", d, 110, 60, GREEN)
  isColor("camera 40 right: the Background moved 20", d, 30, 60, RED)
  isColor("camera 40 right: not where it was", d, 50, 60, BLACK)
  isColor("camera 40 right: not as far as a plain piece", d, 10, 60, BLACK)
  sx, sy = bg:getScroll()
  check("camera 40 right: getScroll is 20, 0", math.abs(sx - 20) < 1e-6 and sy == 0, sx .. ", " .. sy)
  look(100, 80)
  d = shot()
  isColor("camera 20 down: the Background moved 10 up", d, 50, 50, RED)
  isColor("camera 20 down: not 20", d, 50, 36, BLACK)
  bg.scrollY = 1
  d = shot()
  isColor("scrollY 1: moves with the scene", d, 50, 40, RED)
  bg.scrollY = 0.5

  -- scroll 0 stays on the screen; 1 moves like everything; 2 moves twice as far.
  look(140, 60)
  bg.scrollX = 0
  d = shot()
  isColor("scroll 0: fixed to the screen", d, 50, 60, RED)
  bg.scrollX = 1
  d = shot()
  isColor("scroll 1: with the scene", d, 10, 60, RED)
  look(110, 60)
  bg.scrollX = 2
  d = shot()
  isColor("scroll 2: twice as far (in front)", d, 30, 60, RED)
  bg.scrollX = 0.5

  -- Zoom scales everything about the middle of the screen.
  look(140, 60, 2)
  world.x = 140
  d = shot()
  isColor("zoom 2: the plain piece in the middle", d, 100, 60, GREEN)
  -- The Background's box is drawn as if at 50 + 20 = 70 in the scene: 2 * (70 - 140) + 100 = -40.
  bg.children[1].x = 110
  d = shot()
  isColor("zoom 2: the Background, half as far, twice as big", d, 66, 60, RED)
  isColor("zoom 2: its left edge", d, 58, 60, BLACK)
  look(100, 60, 2)
  d = shot()
  isColor("zoom 2 on the first screen: as placed, zoomed", d, 120, 60, RED)
  bg.children[1].x = 50
  world.x = 150
  look(140, 60)

  -- offsetX and offsetY shift it.
  bg.offsetX, bg.offsetY = 15, -20
  d = shot()
  isColor("offset: shifted", d, 45, 40, RED)
  isColor("offset: not where it was", d, 30, 60, BLACK)
  bg.offsetX, bg.offsetY = 0, 0

  -- Drift: slides by itself with the game's clock.
  bg.driftX = 10
  bg:_process(1.5)
  d = shot()
  isColor("drift: 15 px after 1.5 s at 10 px/s", d, 45, 60, RED)
  isColor("drift: left where it was", d, 24, 60, BLACK)
  local x0 = bg._dx
  frames(3)
  check("drift: runs with the game", bg._dx > x0, tostring(bg._dx - x0))
  pauseGame()
  frames(2)
  x0 = bg._dx
  frames(3)
  check("drift: stops while paused", bg._dx == x0, tostring(bg._dx - x0))
  resumeGame()
  bg.driftX = 0
  bg._dx = 0
  bg.driftY = -8
  bg:_process(0.5)
  d = shot()
  isColor("driftY: 4 px up after half a second", d, 30, 47, RED)
  isColor("driftY: its bottom edge moved", d, 30, 68, BLACK)
  bg.driftY = 0
  bg._dy = 0

  -- Edges: past one, it moves with the scene.
  look(60, 60)
  d = shot()
  isColor("no edge: 40 left of the first screen, moved 20", d, 70, 60, RED)
  bg.left = 0
  d = shot()
  isColor("left edge: stays put in the scene", d, 90, 60, RED)
  look(140, 60)
  d = shot()
  isColor("left edge: scrolls again right of it", d, 30, 60, RED)
  bg.left = nil
  bg.right = 220
  d = shot()
  isColor("right edge: the view may go 20 further", d, 20, 60, RED)
  bg.right = nil

  -- The Background's own position, turn and layer work like a Group's.
  look(140, 60)
  bg.x, bg.y = 20, 30
  d = shot()
  isColor("its own position adds", d, 50, 90, RED)
  bg.x, bg.y = 0, 0
  local cover = box(70, 60, 30, 30, BLUE)
  d = shot()
  isColor("drawn in scene order: a later piece is on top", d, 30, 60, BLUE)
  bg.layer = 1
  d = shot()
  isColor("layer 1: on top of layer 0", d, 30, 60, RED)
  bg.layer = 0
  cover:remove()
  bg.tint = { 0.5, 0.5, 0.5, 1 }
  d = shot()
  near("its tint colors what's inside", d, 30, 60, 0.5, 0.125, 0.125)
  bg.tint = { 1, 1, 1, 1 }
  bg.visible = false
  d = shot()
  isColor("hidden with what's inside", d, 30, 60, BLACK)
  bg.visible = true

  -- Repeating: a 10 px box every 50 px, as far as the view goes.
  clear()
  cam = add("Camera", { x = 100, y = 60 })
  look(100, 60)
  bg = add("Background", { scrollX = 0.5, scrollY = 1, repeatWidth = 50 })
  box(10, 60, 10, 10, RED, nil, bg)
  d = shot()
  for _, x in ipairs({ 10, 60, 110, 160 }) do isColor("repeat: a copy at " .. x, d, x, 60, RED) end
  for _, x in ipairs({ 35, 85, 135, 185 }) do isColor("repeat: a gap at " .. x, d, x, 60, BLACK) end
  isColor("repeat: only sideways", d, 10, 10, BLACK)
  look(140, 60)
  d = shot()
  for _, x in ipairs({ 40, 90, 140, 190 }) do isColor("repeat, camera 40 right: a copy at " .. x, d, x, 60, RED) end
  for _, x in ipairs({ 15, 65, 115, 165 }) do isColor("repeat, camera 40 right: a gap at " .. x, d, x, 60, BLACK) end
  look(100000, 60)
  d = shot()
  -- 99900 * 0.5 = 49950 = 999 * 50: the copies are where they started.
  isColor("repeat: endless (far away)", d, 10, 60, RED)
  isColor("repeat: endless, the gap", d, 35, 60, BLACK)
  look(-5000, 60)
  d = shot()
  isColor("repeat: endless (far the other way)", d, 60, 60, RED)
  look(100, 60, 0.5)
  d = shot()
  -- Zoomed out, the view is 400 wide: copies from -100 to 300 in the scene.
  for _, x in ipairs({ 5, 30, 55, 105, 180 }) do isColor("repeat, zoomed out: a copy at " .. x, d, x, 60, RED) end
  isColor("repeat, zoomed out: a gap", d, 17, 60, BLACK)
  look(100, 60)
  bg.driftX = -20
  bg:_process(1)
  d = shot()
  isColor("repeat and drift: moved 20 left", d, 40, 60, RED)
  isColor("repeat and drift: the gap moved too", d, 60, 60, BLACK)
  bg:_process(10)
  check("repeat and drift: the slide wraps", bg._dx >= 0 and bg._dx < 50, tostring(bg._dx))
  d = shot()
  isColor("repeat and drift: 220 px later, the same picture", d, 40, 60, RED)
  bg.driftX = 0
  bg._dx = 0
  -- Both ways.
  bg.repeatHeight = 40
  d = shot()
  local copies = 0
  for y = 20, 100, 40 do
    for x = 10, 160, 50 do
      local r, gr, b = d:getPixel(x, y)
      if math.abs(r - 1) < 0.03 and math.abs(gr - 0.25) < 0.03 then copies += 1 end
    end
  end
  check("repeat both ways: 4 x 3 copies in view", copies == 12, copies .. " found")
  isColor("repeat both ways: a gap", d, 35, 40, BLACK)
  bg.repeatHeight = 0
  -- A turned, scaled Background repeats along its own directions.
  bg.scaleX = 2
  d = shot()
  isColor("scaled: a copy every 100", d, 20, 60, RED)
  isColor("scaled: the next copy", d, 120, 60, RED)
  isColor("scaled: between", d, 70, 60, BLACK)
  bg.scaleX = 1

  -- Tiles inside a repeating Background: drawn in every copy.
  clear()
  cam = add("Camera", { x = 100, y = 60 })
  look(130, 60)
  bg = add("Background", { scrollX = 0, scrollY = 0, repeatWidth = 64 })
  local tiles = add("Tiles", { tileset = "art/terrain.tileset" }, bg)
  tiles:setTile(0, 0, 5)
  tiles:setTile(1, 0, 88)
  tiles._time = 0.3
  d = shot()
  for _, x in ipairs({ 4, 68, 132, 196 }) do isTile("tiles repeat: tile 5 at " .. x, d, x, 4, 5) end
  for _, x in ipairs({ 12, 76, 140 }) do isTile("tiles repeat: the animated one at " .. x, d, x, 4, 89) end
  isColor("tiles repeat: empty between", d, 40, 4, BLACK)

  -- A scene (a Group of pieces) inside works like single pieces.
  clear()
  cam = add("Camera", { x = 100, y = 60 })
  look(140, 60)
  bg = add("Background", { scrollX = 0.5 })
  local group = add("Group", { x = 40, y = 50 }, bg)
  box(10, 10, 20, 20, RED, nil, group)
  d = shot()
  isColor("a Group inside: moved with it", d, 30, 60, RED)

  -- Lights: what's inside a Background is lit where it's drawn.
  clear()
  cam = add("Camera", { x = 100, y = 60 })
  look(140, 60)
  bg = add("Background", { scrollX = 0.5, scrollY = 0.5 })
  box(50, 60, 20, 20, { 1, 1, 1, 1 }, nil, bg)
  world = box(150, 60, 20, 20, { 1, 1, 1, 1 })
  local tint = add("Tint", { color = { 0.5, 0.25, 0.25, 1 } })
  local litBefore = lights._frames
  d = shot()
  check("lit: drawn by the lights renderer", lights._frames == litBefore + 1)
  near("lit: the Background's piece, moved 20 and tinted", d, 30, 60, 0.5, 0.25, 0.25)
  near("lit: the plain piece, moved 40", d, 110, 60, 0.5, 0.25, 0.25)
  isColor("lit: nothing where it was placed", d, 50, 60, BLACK)
  -- A Light inside the Background shines where the Background is drawn.
  tint.color = { 0, 0, 0, 1 }
  local floor = box(140, 60, 400, 120, { 0.5, 0.5, 0.5, 1 })
  floor.layer = -1
  local light = add("Light", { x = 50, y = 60, radius = 30 }, bg)
  d = shot()
  near("lit: the light inside shines at its drawn place", d, 30, 30, 0, 0, 0)
  local r = d:getPixel(30, 60)
  check("lit: bright under it", r > 0.9, tostring(r))
  r = d:getPixel(42, 48)
  check("lit: its reach is around the drawn place", r > 0.05 and r < 0.5, tostring(r))
  r = d:getPixel(80, 60)
  check("lit: dark away from it", r < 0.02, tostring(r))
  light:remove()
  tint.color = { 0.5, 0.25, 0.25, 1 }
  floor:remove()
  -- Repeating, lit.
  bg.repeatWidth = 50
  d = shot()
  for _, x in ipairs({ 30, 80, 180 }) do near("lit and repeating: a copy at " .. x, d, x, 60, 0.5, 0.25, 0.25) end
  isColor("lit and repeating: a gap", d, 55, 60, BLACK)
  bg.lit = false
  d = shot()
  near("lit = false: the Background's pieces ignore the Tint", d, 30, 60, 1, 1, 1)
  near("lit = false: other pieces don't", d, 110, 60, 0.5, 0.25, 0.25)
  tint:remove()
  clear()
  check("all gone: no Background counted", nodes2d._backgrounds() == 0, tostring(nodes2d._backgrounds()))
end

local parts = { { "terrains", terrainChecks }, { "animated tiles", animationChecks }, { "backgrounds", backgroundChecks } }
local part = 0

-- Each part runs in a coroutine of its own, a bit more every frame.
function update(dt)
  if part > #parts then return end
  if not co then
    if not canvas then
      stage = find("../Stage")
      canvas = g.newCanvas(W, H, { dpiscale = 1 })
    end
    part += 1
    if part > #parts then
      print(`DONE {passed} passed, {failed} failed`)
      go("scenes/demo.scene")
      return
    end
    co = coroutine.create(parts[part][2])
  end
  local ok, err = coroutine.resume(co)
  if not ok then fail(parts[part][1] .. ": the checks stopped", debug.traceback(co, tostring(err))) end
  if coroutine.status(co) == "dead" then
    co = nil
    -- A part that stopped half way may have left the game paused.
    resumeGame()
    timeScale(1)
  end
end
