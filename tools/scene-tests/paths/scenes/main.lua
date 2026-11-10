-- Checks smitten.paths inside the running engine: a grid from a painted
-- Tiles piece, a graph, the scene's Walkable pieces, agents followed by
-- scripted Bodies, and debugDraw. The algorithms themselves are tested
-- under plain Lua (tools/paths-tests/test.lua).
-- Prints PASS or FAIL for each check, then DONE (tools/scene-tests/run.mjs
-- reads them).

local paths = smitten.paths
local passed, failed = 0, 0

dotOnScreen = false   -- where scene points 100, 50 and 160, 50 are on screen (scripts/drawer.lua)

local function check(name, ok, detail)
  if ok then
    passed += 1
    print("PASS " .. name)
  else
    failed += 1
    print("FAIL " .. name .. (if detail ~= nil then ": " .. tostring(detail) else ""))
  end
end

local function list(path) return if path then table.concat(path, ",") else "nil" end
local function near(a, b, tol) return math.abs(a - b) <= (tol or 0.01) end

local function checks()
  -- A grid from the painted tiles: a walled room, 12 by 8 cells, with a
  -- wall down column 6 that leaves a gap at row 6.
  local grid = Ground:newPathGrid()
  check("grid: size", grid.columns == 12 and grid.rows == 8 and grid.cellWidth == 16, grid.columns .. "x" .. grid.rows)
  check("grid: solid tiles", grid:isSolid(6, 3) and grid:isSolid(0, 0) and not grid:isSolid(6, 6) and not grid:isSolid(2, 2))
  local cells = grid:findPath(2, 2, 9, 2)
  check("grid: round the wall", cells and #cells / 2 == 16, list(cells))
  local through = false
  for i = 1, (if cells then #cells else 0), 2 do
    if cells[i] == 6 and cells[i + 1] == 6 then through = true end
  end
  check("grid: through the gap", through)
  local points = grid:findPoints(41, 39, 150, 44)
  check("grid: points are cell centers", points and #points == 32 and points[1] == 40 and points[2] == 40 and points[31] == 152 and points[32] == 40, list(points))
  check("grid: cellAt and cellCenter", list({ grid:cellAt(150, 44) }) == "9,2" and list({ grid:cellCenter(9, 2) }) == "152,40")

  -- The grid follows the tiles.
  Ground:setTile(6, 2, -1)
  cells = grid:findPath(2, 2, 9, 2)
  check("grid: follows setTile (opened)", cells and #cells / 2 == 8, list(cells))
  Ground:setTile(6, 2, 0)
  cells = grid:findPath(2, 2, 9, 2)
  check("grid: follows setTile (closed)", cells and #cells / 2 == 16, list(cells))
  Ground:fill(6, 1, 1, 5, -1)
  cells = grid:findPath(2, 2, 9, 2)
  check("grid: follows fill", cells and #cells / 2 == 8, list(cells))
  Ground:fill(6, 1, 1, 5, 0)
  Ground:setTile(6, 6, 0)
  check("grid: no way", grid:findPath(2, 2, 9, 2) == nil)
  cells = grid:findPath(2, 2, 9, 2, { partial = true })
  check("grid: partial", cells and cells[#cells - 1] == 5 and cells[#cells] == 2, list(cells))
  Ground:setTile(6, 6, -1)
  -- A tile's cost setting: tile 1 costs 6, so the path goes round it.
  Ground:setTile(3, 2, 1)
  check("grid: tile cost", grid:getCost(3, 2) == 6 and not grid:isSolid(3, 2))
  cells = grid:findPath(2, 2, 4, 2)
  check("grid: round a costly tile", cells and #cells / 2 == 5, list(cells))
  Ground:setTile(3, 2, -1)
  local diagonal = Ground:newPathGrid({ diagonals = "noCorners" })
  cells = diagonal:findPath(1, 1, 4, 4)
  check("grid: diagonals", cells and #cells / 2 == 4, list(cells))
  local ok, err = pcall(function() Ground:newPathGrid({ diagonals = "sometimes" }) end)
  check("grid: a clear error", not ok and tostring(err):find('diagonals can be "always", "never", "noCorners"', 1, true) ~= nil, err)
  check("grid: the error is at the script's line", tostring(err):find("scenes/main.lua:", 1, true) ~= nil, err)
  ok, err = pcall(function() grid:setSolid(40, 2) end)
  check("grid: out of range", not ok and tostring(err):find("there's no cell 40, 2 in this grid", 1, true) ~= nil, err)
  local plain = paths.newGrid(8, 8, { cellSize = 32, x = 100 })
  plain:fillSolid(3, 0, 1, 7)
  points = plain:findPoints(116, 16, 244, 16)
  check("grid: made by hand", points and #points / 2 == 19 and points[#points - 1] == 244, list(points))

  -- A graph.
  local graph = paths.newGraph()
  graph:addPoint("gate", 0, 0)
  graph:addPoint("well", 100, 0)
  graph:addPoint("barn", 100, 80)
  graph:addPoint("pond", 0, 80)
  graph:connect("gate", "well")
  graph:connect("well", "barn")
  graph:connect("gate", "pond")
  graph:connect("pond", "barn")
  graph:setWeight("well", 3)
  check("graph: path", list(graph:findPath("gate", "barn")) == "gate,pond,barn", list(graph:findPath("gate", "barn")))
  check("graph: points", list(graph:findPoints("gate", "barn")) == "0,0,0,80,100,80")
  check("graph: closestPoint", graph:closestPoint(90, 70) == "barn")
  ok, err = pcall(function() graph:connect("gate", "bran") end)
  check("graph: did you mean", not ok and tostring(err):find('no point "bran" (did you mean "barn"?)', 1, true) ~= nil, err)

  -- The scene's Walkable pieces: a floor 400 by 300 around 600, 200, with
  -- a pillar 100 by 100 cut out of its middle.
  check("area: isWalkable", paths.isWalkable(450, 190) and not paths.isWalkable(600, 200) and not paths.isWalkable(100, 100))
  local cx, cy = paths.closestPoint(600, 160)
  check("area: closestPoint", near(cx, 600) and near(cy, 150), tostring(cx) .. "," .. tostring(cy))
  local path = paths.findPath(450, 190, 750, 190)
  local shortest = 2 * math.sqrt(100 ^ 2 + 40 ^ 2) + 100
  check("area: round the pillar", path and #path == 8, list(path))
  check("area: hugging its corners", path and near(path[3], 550) and near(path[4], 150) and near(path[5], 650) and near(path[6], 150), list(path))
  check("area: the shortest way", path and near(paths.length(path), shortest, 0.01), path and paths.length(path))
  path = paths.findPath(450, 60, 750, 70)
  check("area: straight when nothing is in the way", path and #path == 4, list(path))
  Pillar.active = false
  path = paths.findPath(450, 190, 750, 190)
  check("area: a hole turned off", path and #path == 4 and paths.isWalkable(600, 200), list(path))
  Pillar.active = true
  Pillar.x = 700
  check("area: a hole that moved", paths.isWalkable(600, 200) and not paths.isWalkable(700, 200))
  Pillar.x = 600
  -- A piece made while the game runs, turned a quarter: it covers
  -- 1980..2000 by 0..100.
  local extra = spawn("Walkable", { x = 2000, y = 0, rotation = 90, points = { 0, 0, 100, 0, 100, 20, 0, 20 } })
  extra:tag("far")
  check("area: a turned piece", paths.isWalkable(1990, 50) and not paths.isWalkable(2050, 10))
  check("area: tags", paths.isWalkable(1990, 50, { tags = "far" }) and not paths.isWalkable(450, 190, { tags = "far" }))
  check("area: no way to an island", paths.findPath(450, 190, 1990, 50) == nil)
  path = paths.findPath(450, 190, 1990, 50, { partial = true })
  check("area: partial", path and near(path[#path - 1], 800) and near(path[#path], 50), list(path))
  extra:destroy()
  check("area: a removed piece", not paths.isWalkable(1990, 50))
  local area = paths.newArea({ { 0, 0, 100, 0, 100, 100, 0, 100 } }, { { 40, 40, 60, 40, 60, 60, 40, 60 } })
  check("area: made by hand", area:isWalkable(10, 10) and not area:isWalkable(50, 50) and #area:findPath(10, 50, 90, 50) == 8)

  -- Helpers.
  check("length", paths.length({ 0, 0, 30, 0, 30, 40 }) == 70)
  local px, py, done = paths.pointAt({ 0, 0, 30, 0, 30, 40 }, 50)
  check("pointAt", px == 30 and py == 20 and done == false)

  return grid
end

-- These wait, so they run straight in ready() (an error here stops the test).
local function movingChecks(grid)
  -- Agents: two scripted Bodies ask theirs where to go and move there.
  -- The chaser walks the tile room (the walls are solid: cutting a corner
  -- would stop it); the walker crosses the floor round the pillar.
  Chaser.agent = paths.newAgent({ finder = grid, reach = 3 })
  Chaser.agent:setTarget(152, 40)
  Walker.agent = paths.newAgent({ reach = 3 })
  Walker.agent:setTarget(750, 190)
  local waited = 0
  while waited < 8 and not (Chaser.agent:isDone() and Walker.agent:isDone()) do
    wait(0.1)
    waited += 0.1
  end
  check("agent: the chaser arrives", Chaser.agent:isDone() and near(Chaser.x, 152, 3.5) and near(Chaser.y, 40, 3.5), Chaser.x .. "," .. Chaser.y)
  check("agent: the long way round took a while", waited > 1.5, waited)
  check("agent: the walker arrives", Walker.agent:isDone() and near(Walker.x, 750, 3.5) and near(Walker.y, 190, 3.5), Walker.x .. "," .. Walker.y)
  check("agent: over the pillar's corners", near(Walker.highest, 150, 4), Walker.highest)
  -- The target moves: the chaser plans again and goes back.
  Chaser.agent:setTarget(40, 100)
  waited = 0
  while waited < 8 and not Chaser.agent:isDone() do
    wait(0.1)
    waited += 0.1
  end
  check("agent: a new target", near(Chaser.x, 40, 3.5) and near(Chaser.y, 104, 3.5), Chaser.x .. "," .. Chaser.y)

  -- debugDraw from a moved, turned piece lands where the scene says.
  waited = 0
  while waited < 3 and not Drawer.result do
    wait(0.1)
    waited += 0.1
  end
  local result = Drawer.result or { error = "draw() never ran" }
  check("debugDraw: runs", result.error == nil, result.error)
  check("debugDraw: in scene coordinates", result.r and result.r > 0.9 and result.a > 0.9 and result.a2 == 0,
    tostring(result.r) .. " " .. tostring(result.a) .. " " .. tostring(result.a2))
end

-- How long searches take here (to read, not checked): the same searches as
-- tools/paths-tests/test.lua time.
local function timings()
  local now = smitten.timer.getTime
  local function time(name, n, fn)
    local t0 = now()
    for _ = 1, n do fn() end
    print(("TIME %s: %.3f ms"):format(name, (now() - t0) / n * 1000))
  end
  local grid = paths.newGrid(100, 100)
  time("grid 100x100, empty, corner to corner", 20, function() grid:findPath(0, 0, 99, 99) end)
  for c = 2, 98, 4 do
    grid:fillSolid(c, 0, 1, 100)
    grid:setSolid(c, if c % 8 == 2 then 99 else 0, false)
  end
  time("grid 100x100, snaking maze, corner to corner", 20, function() grid:findPath(0, 0, 99, 99) end)
  grid:setSolid(99, 99)
  time("grid 100x100, no way", 20, function() grid:findPath(0, 0, 99, 99, { partial = true }) end)
  local holes = {}
  for r = 0, 5 do
    for c = 0, 7 do
      holes[#holes + 1] = { 40 + c * 100, 40 + r * 100, 100 + c * 100, 50 + r * 100, 90 + c * 100, 100 + r * 100, 30 + c * 100, 90 + r * 100 }
    end
  end
  local area
  time("area with 48 holes, building it", 5, function() area = paths.newArea({ { 0, 0, 840, 0, 840, 640, 0, 640 } }, holes) end)
  time("area with 48 holes, corner to corner", 50, function() area:findPath(5, 5, 835, 635) end)
end

function ready()
  local ok, grid = pcall(checks)
  if ok then
    movingChecks(grid)
    timings()
  else
    failed += 1
    print("FAIL the checks stopped: " .. tostring(grid))
  end
  print(`DONE {passed} passed, {failed} failed`)
end

function draw()
  -- This piece is at 0, 0: its coordinates are the scene's.
  local g = smitten.graphics
  local x, y = g.transformPoint(100, 50)
  local x2, y2 = g.transformPoint(160, 50)
  dotOnScreen = { x = x, y = y, x2 = x2, y2 = y2 }
  paths.debugDraw()
  paths.debugDraw(Walker.agent or nil)
end
