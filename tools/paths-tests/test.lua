-- Tests for smitten.paths' pathfinders under plain Lua 5.1 (they use
-- nothing of the engine). From the repository's root:
--
--   lua5.1 tools/paths-tests/test.lua
--
-- Grid and graph paths are compared with a plain Dijkstra search on random
-- grids and graphs; area paths with the true shortest path (through the
-- corners that can see each other) on random rooms with holes.

local root = (arg and arg[0] or ""):match("^(.*)tools[/\\]paths%-tests[/\\]") or ""
table.insert(package.loaders, 2, function(name)
	local dir, file = name:match("^love%.(%w+)%.?(%w*)$")
	if not dir then return nil end
	if file == "" then file = "init" end
	local path = root .. "love/src/modules/" .. dir .. "/" .. file .. ".lua"
	local f = io.open(path, "r")
	if not f then return "\n\tno file " .. path end
	f:close()
	return assert(loadfile(path))
end)

local paths = require("love.paths")
local gridFromTiles = require("love.paths.grid").fromTiles

local passed, failed = 0, 0
local function check(name, ok, detail)
	if ok then
		passed = passed + 1
	else
		failed = failed + 1
		print("FAIL " .. name .. (detail and (": " .. tostring(detail)) or ""))
	end
end

local function fails(name, fn, want)
	local ok, err = pcall(fn)
	check(name, not ok and tostring(err):find(want, 1, true) ~= nil, ok and "no error" or err)
end

local function same(a, b)
	if a == nil or b == nil then return a == b end
	if #a ~= #b then return false end
	for i = 1, #a do
		if a[i] ~= b[i] then return false end
	end
	return true
end

local function near(a, b, tol) return math.abs(a - b) <= (tol or 1e-6) end

-- A small random number generator of our own, so every run is the same.
local seed = 12345
local function rnd()
	seed = (seed * 1103515245 + 12345) % 2147483648
	return seed / 2147483648
end
local function rint(a, b) return a + math.floor(rnd() * (b - a + 1)) end

---------------------------------------------------------------------------
-- Grids

do
	local grid = paths.newGrid(5, 4)
	check("grid: size", grid.columns == 5 and grid.rows == 4 and grid.cellWidth == 16)
	check("grid: straight", same(grid:findPath(0, 0, 3, 0), { 0, 0, 1, 0, 2, 0, 3, 0 }))
	check("grid: same cell", same(grid:findPath(2, 2, 2, 2), { 2, 2 }))
	grid:setSolid(1, 0)
	grid:setSolid(1, 1)
	grid:setSolid(1, 2)
	check("grid: isSolid", grid:isSolid(1, 0) and not grid:isSolid(0, 0) and grid:isSolid(-1, 0) and grid:isSolid(0, 9))
	local path = grid:findPath(0, 0, 2, 0)
	check("grid: around a wall", path and #path / 2 == 9 and path[#path - 1] == 2 and path[#path] == 0, path and table.concat(path, ","))
	check("grid: same path twice", same(path, grid:findPath(0, 0, 2, 0)))
	grid:setSolid(1, 3)
	check("grid: no way", grid:findPath(0, 0, 2, 0) == nil)
	path = grid:findPath(0, 0, 4, 0, { partial = true })
	check("grid: partial", path and path[#path - 1] == 0 and path[#path] == 0 and #path == 2, path and table.concat(path, ","))
	path = grid:findPath(0, 3, 4, 3, { partial = true })
	check("grid: partial stays", same(path, { 0, 3 }))
	check("grid: solid goal", grid:findPath(0, 0, 1, 1) == nil)
	path = grid:findPath(0, 0, 1, 1, { partial = true })
	check("grid: partial to a solid goal", same(path, { 0, 0, 0, 1 }), path and table.concat(path, ","))
	grid:setSolid(1, 3, false)
	check("grid: opened again", grid:findPath(0, 0, 2, 0) ~= nil)
	grid:clear()
	check("grid: clear", not grid:isSolid(1, 0))
	grid:fillSolid(1, 0, 2, 4)
	check("grid: fillSolid", grid:isSolid(2, 3) and grid:findPath(0, 0, 4, 0) == nil)
	grid:fillSolid(1, 0, 2, 4, false)

	-- Points: the centers of cells.
	local g2 = paths.newGrid(4, 4, { cellSize = 10, x = 100, y = 50 })
	check("grid: cellAt", same({ g2:cellAt(115, 51) }, { 1, 0 }) and same({ g2:cellAt(99, 49) }, { -1, -1 }))
	check("grid: cellCenter", same({ g2:cellCenter(1, 0) }, { 115, 55 }))
	check("grid: findPoints", same(g2:findPoints(101, 51, 128, 52), { 105, 55, 115, 55, 125, 55 }))
	check("grid: findPoints clamps", same(g2:findPoints(0, 0, 1000, 55), { 105, 55, 115, 55, 125, 55, 135, 55 }))
	check("grid: follow drops the first", same(g2:_follow(101, 51, 128, 52), { 115, 55, 125, 55 }))
	local g3 = paths.newGrid(3, 3, { firstColumn = -1, firstRow = 10, cellWidth = 8, cellHeight = 4 })
	check("grid: first cell", g3:contains(-1, 10) and not g3:contains(2, 10) and same(g3:findPath(-1, 10, 1, 10), { -1, 10, 0, 10, 1, 10 }))
	check("grid: cell sizes", same({ g3:cellCenter(-1, 10) }, { 4, 2 }) and same({ g3:cellAt(9, 5) }, { 0, 11 }))

	-- Diagonals.
	local d = paths.newGrid(3, 3, { diagonals = "always" })
	check("grid: diagonal", same(d:findPath(0, 0, 2, 2), { 0, 0, 1, 1, 2, 2 }))
	d:setSolid(1, 0)
	check("grid: always cuts corners", same(d:findPath(0, 0, 1, 1), { 0, 0, 1, 1 }))
	local nc = paths.newGrid(3, 3, { diagonals = "noCorners" })
	nc:setSolid(1, 0)
	check("grid: noCorners doesn't", same(nc:findPath(0, 0, 1, 1), { 0, 0, 0, 1, 1, 1 }))

	-- Costs.
	local c = paths.newGrid(3, 3)
	c:setCost(1, 0, 10)
	check("grid: getCost", c:getCost(1, 0) == 10 and c:getCost(0, 0) == 1)
	path = c:findPath(0, 0, 2, 0)
	check("grid: avoids a costly cell", path and #path / 2 == 5, path and table.concat(path, ","))
	c:setCost(1, 0, 2.5)
	check("grid: goes through a cheap enough one", same(c:findPath(0, 0, 2, 0), { 0, 0, 1, 0, 2, 0 }))
	-- Your own cost: a one-way step (never from column 1 back to column 0).
	local own = paths.newGrid(3, 1)
	own.cost = function(c1, r1, c2, r2)
		if c2 < c1 then return nil end
		return 1
	end
	check("grid: own cost", own:findPath(0, 0, 2, 0) ~= nil and own:findPath(2, 0, 0, 0) == nil)
	local version = own.version
	own:setSolid(1, 0)
	check("grid: version", own.version > version)

	fails("grid: bad size", function() paths.newGrid(0, 3) end, "at least 1")
	fails("grid: bad diagonals", function() paths.newGrid(3, 3, { diagonals = "allways" }) end, 'diagonals can be')
	fails("grid: bad heuristic", function() paths.newGrid(3, 3, { heuristic = "x" }) end, "heuristic can be")
	fails("grid: out of range", function() grid:setSolid(5, 0) end, "there's no cell 5, 0 in this grid (columns go from 0 to 4")
	fails("grid: findPath out of range", function() grid:findPath(0, 0, 0, 4) end, "rows from 0 to 3")
	fails("grid: bad cost", function() grid:setCost(0, 0, 0) end, "above 0")
	fails("grid: findPoints numbers", function() grid:findPoints(1, 2, 3) end, "four numbers")
	local ok, err = pcall(function() grid:setSolid(9, 9) end)
	check("grid: errors point at the caller", tostring(err):find("test.lua", 1, true) ~= nil, err)
end

-- Random grids against Dijkstra.
local function gridDijkstra(solid, weight, cols, rows, si, gi, diagonals)
	local distance, done = {}, {}
	distance[si] = 0
	local DX = { 0, 1, 0, -1, 1, 1, -1, -1 }
	local DY = { -1, 0, 1, 0, -1, 1, 1, -1 }
	while true do
		local cur, best = nil, math.huge
		for i, d in pairs(distance) do
			if not done[i] and d < best then cur, best = i, d end
		end
		if not cur then return nil end
		if cur == gi then return best end
		done[cur] = true
		local c = (cur - 1) % cols
		local r = (cur - 1 - c) / cols
		for d = 1, diagonals == "never" and 4 or 8 do
			local nc, nr = c + DX[d], r + DY[d]
			if nc >= 0 and nc < cols and nr >= 0 and nr < rows then
				local ni = nr * cols + nc + 1
				local ok = not solid[ni]
				if ok and d > 4 and diagonals == "noCorners" and (solid[r * cols + nc + 1] or solid[nr * cols + c + 1]) then ok = false end
				if ok then
					local nd = best + (d > 4 and math.sqrt(2) or 1) * weight[ni]
					if not distance[ni] or nd < distance[ni] then distance[ni] = nd end
				end
			end
		end
	end
end

do
	local modes = { "never", "always", "noCorners" }
	local heuristics = { never = { "manhattan", "euclidean", "chebyshev" }, always = { "octile", "euclidean", "chebyshev" } }
	heuristics.noCorners = heuristics.always
	local wrong, invalid, cases, reachable = 0, 0, 0, 0
	for trial = 1, 400 do
		local cols, rows = rint(1, 14), rint(1, 14)
		local mode = modes[rint(1, 3)]
		local heuristic = heuristics[mode][rint(1, 3)]
		local grid = paths.newGrid(cols, rows, { diagonals = mode, heuristic = heuristic })
		local solid, weight = {}, {}
		local density = rnd() * 0.45
		local weighted = rnd() < 0.5
		for r = 0, rows - 1 do
			for c = 0, cols - 1 do
				local i = r * cols + c + 1
				solid[i] = rnd() < density
				weight[i] = 1
				if solid[i] then grid:setSolid(c, r) end
				if weighted and rnd() < 0.4 then
					weight[i] = ({ 0.25, 0.5, 2, 3.5, 7 })[rint(1, 5)]
					grid:setCost(c, r, weight[i])
				end
			end
		end
		for _ = 1, 6 do
			local sc, sr, gc, gr = rint(0, cols - 1), rint(0, rows - 1), rint(0, cols - 1), rint(0, rows - 1)
			local si, gi = sr * cols + sc + 1, gr * cols + gc + 1
			local want = (not solid[gi]) and gridDijkstra(solid, weight, cols, rows, si, gi, mode) or nil
			local path = grid:findPath(sc, sr, gc, gr)
			cases = cases + 1
			if (want == nil) ~= (path == nil) then
				wrong = wrong + 1
			elseif path then
				reachable = reachable + 1
				-- The path is real: starts and ends right, steps are neighbours, nothing solid.
				local cost = 0
				local ok = path[1] == sc and path[2] == sr and path[#path - 1] == gc and path[#path] == gr
				for i = 3, #path, 2 do
					local dc, dr = path[i] - path[i - 2], path[i + 1] - path[i - 1]
					local index = path[i + 1] * cols + path[i] + 1
					if solid[index] or math.abs(dc) > 1 or math.abs(dr) > 1 or (dc == 0 and dr == 0) then ok = false end
					if dc ~= 0 and dr ~= 0 then
						if mode == "never" then ok = false end
						if mode == "noCorners" and (solid[path[i - 1] * cols + path[i] + 1] or solid[path[i + 1] * cols + path[i - 2] + 1]) then ok = false end
						cost = cost + math.sqrt(2) * weight[index]
					else
						cost = cost + weight[index]
					end
				end
				if not ok then invalid = invalid + 1 end
				if not near(cost, want, 1e-9) then wrong = wrong + 1 end
				-- A partial search finds the same when there is a way.
				if not same(path, grid:findPath(sc, sr, gc, gr, { partial = true })) then wrong = wrong + 1 end
			else
				local partial = grid:findPath(sc, sr, gc, gr, { partial = true })
				if not partial or partial[1] ~= sc or partial[2] ~= sr then invalid = invalid + 1 end
			end
		end
	end
	check(("random grids: %d searches (%d with a way) cost what Dijkstra's do"):format(cases, reachable), wrong == 0, wrong .. " differ")
	check("random grids: every path is walkable", invalid == 0, invalid .. " aren't")
end

-- A grid from a Tiles piece (a stand-in with the methods the grid uses).
do
	local info = { [0] = { solid = true }, [1] = {}, [2] = { solid = true, oneWay = true }, [3] = { cost = 4 } }
	local tiles = { solid = true, _grid = {} }
	function tiles:getTile(c, r) return self._grid[r] and self._grid[r][c] or -1 end
	function tiles:tileInfo(t) return info[t] or {} end
	function tiles:getTileSize() return 16, 16 end
	function tiles:cellAt(x, y) return math.floor(x / 16), math.floor(y / 16) end
	function tiles:cellCenter(c, r) return c * 16 + 8, r * 16 + 8 end
	local function set(c, r, t)
		tiles._grid[r] = tiles._grid[r] or {}
		tiles._grid[r][c] = t
	end
	-- Floor from 2..8 x 3..7 with a wall down column 5 (rows 3..6).
	for r = 3, 7 do
		for c = 2, 8 do set(c, r, 1) end
	end
	for r = 3, 6 do set(5, r, 0) end
	set(6, 3, 2)
	set(6, 4, 3)
	local grid = gridFromTiles(tiles, {})
	check("tiles grid: covers the painted cells", grid.firstColumn == 2 and grid.firstRow == 3 and grid.columns == 7 and grid.rows == 5)
	check("tiles grid: solid tiles", grid:isSolid(5, 3) and not grid:isSolid(4, 3) and grid:isSolid(1, 3))
	check("tiles grid: one-way tiles are open", not grid:isSolid(6, 3))
	check("tiles grid: cost", grid:getCost(6, 4) == 4)
	local path = grid:findPath(4, 3, 6, 3)
	check("tiles grid: round the wall, not through the costly tile", path and #path / 2 == 13, path and #path / 2)
	check("tiles grid: points", same(grid:findPoints(40, 120, 72, 120), { 40, 120, 56, 120, 72, 120 }))
	-- Tiles:setTile tells the grid.
	set(5, 4, nil)
	grid:_tileChanged(5, 4)
	path = grid:findPath(4, 4, 6, 4)
	check("tiles grid: a tile removed", path and #path / 2 == 3 and not grid:isSolid(5, 4))
	set(5, 4, 0)
	grid:_tileChanged(5, 4)
	check("tiles grid: a tile put back", grid:isSolid(5, 4))
	grid:_tileChanged(100, 100) -- outside: ignored
	-- A big change marks it stale; it reads the tiles again when next used.
	for r = 3, 6 do set(5, r, 1) end
	set(9, 3, 1)
	grid._stale = true
	check("tiles grid: refresh when stale", not grid:isSolid(5, 3) and grid.columns == 8)
	local empties = gridFromTiles(tiles, { empty = "solid", margin = 1, diagonals = "always",
		solid = function(_, tile) return tile == 3 end })
	check("tiles grid: options", empties.firstColumn == 1 and empties:isSolid(1, 2) and empties:isSolid(6, 4) and not empties:isSolid(6, 3)
		and empties.diagonals == "always")
	local fixed = gridFromTiles(tiles, { column = 0, row = 0, columns = 20, rows = 10 })
	check("tiles grid: fixed size", fixed.columns == 20 and fixed.firstColumn == 0 and not fixed:isSolid(0, 0))
	fails("tiles grid: bad option", function() tiles.newPathGrid = function(self, o) return gridFromTiles(self, o) end
		tiles:newPathGrid({ empty = "wall" }) end, '"open" or "solid"')
end

---------------------------------------------------------------------------
-- Graphs

do
	local graph = paths.newGraph()
	graph:addPoint("a", 0, 0)
	graph:addPoint("b", 10, 0)
	graph:addPoint("c", 20, 0)
	graph:addPoint("d", 10, 10)
	graph:connect("a", "b")
	graph:connect("b", "c")
	graph:connect("a", "d")
	graph:connect("d", "c")
	check("graph: path", same(graph:findPath("a", "c"), { "a", "b", "c" }))
	check("graph: points", same(graph:findPoints("a", "c"), { 0, 0, 10, 0, 20, 0 }))
	check("graph: to itself", same(graph:findPath("a", "a"), { "a" }))
	check("graph: list", same(graph:points(), { "a", "b", "c", "d" }) and same(graph:neighbors("a"), { "b", "d" }))
	check("graph: isConnected", graph:isConnected("a", "b") and not graph:isConnected("a", "c"))
	graph:setDisabled("b")
	check("graph: disabled point", same(graph:findPath("a", "c"), { "a", "d", "c" }) and graph:isDisabled("b"))
	check("graph: disabled goal", graph:findPath("a", "b") == nil)
	check("graph: partial to a disabled goal", same(graph:findPath("a", "b", { partial = true }), { "a" }))
	graph:setDisabled("b", false)
	graph:setWeight("b", 5)
	check("graph: weight", same(graph:findPath("a", "c"), { "a", "d", "c" }) and graph:getWeight("b") == 5)
	graph:setWeight("b", 1)
	graph:disconnect("b", "c")
	check("graph: disconnect", same(graph:findPath("a", "c"), { "a", "d", "c" }))
	graph:connect("b", "c", false)
	check("graph: one way", same(graph:findPath("a", "c"), { "a", "b", "c" }) and same(graph:findPath("c", "a"), { "c", "d", "a" }))
	check("graph: closestPoint", graph:closestPoint(11, 2) == "b" and graph:closestPoint(11, 8) == "d")
	local x, y, p, q = graph:closestPosition(5, -3)
	check("graph: closestPosition", x == 5 and y == 0 and p == "a" and q == "b", tostring(x) .. "," .. tostring(y))
	x, y, p, q = graph:closestPosition(-5, -5)
	check("graph: closestPosition at a point", x == 0 and y == 0 and p == "a" and q == "a")
	graph:setPosition("d", 10, 1)
	check("graph: setPosition", same({ graph:getPosition("d") }, { 10, 1 }))
	graph.cost = function(from, to) return (from == "a" and to == "b") and 1000 or 1 end
	check("graph: own cost", same(graph:findPath("a", "c"), { "a", "d", "c" }))
	graph.cost = nil
	graph.estimate = function() return 0 end
	check("graph: own estimate", same(graph:findPath("a", "c"), { "a", "b", "c" }))
	graph.estimate = nil
	graph:removePoint("b")
	check("graph: removePoint", not graph:hasPoint("b") and same(graph:neighbors("a"), { "d" }) and same(graph:findPath("a", "c"), { "a", "d", "c" }))
	graph:addPoint("island", 500, 500)
	check("graph: no way", graph:findPath("a", "island") == nil)
	check("graph: partial", same(graph:findPath("a", "island", { partial = true }), { "a", "d", "c" }))
	check("graph: follow", same(graph:_follow(1, 1, 19, 1), { 0, 0, 10, 1, 20, 0 }))
	graph:addPoint(7, 1, 2)
	check("graph: number ids", graph:hasPoint(7) and graph:closestPoint(1, 2) == 7)
	fails("graph: unknown point", function() graph:connect("a", "islnd") end, 'this graph has no point "islnd"')
	fails("graph: unknown number", function() graph:findPath("a", 99) end, "no point 99")
	fails("graph: self", function() graph:connect("a", "a") end, "itself")
	fails("graph: bad id", function() graph:addPoint({}, 1, 2) end, "needs an id first")
	fails("graph: bad weight", function() graph:setWeight("a", -1) end, "above 0")
	graph:clear()
	check("graph: clear", #graph:points() == 0 and graph:closestPoint(0, 0) == nil)
end

do
	local wrong, invalid, cases, reachable = 0, 0, 0, 0
	for trial = 1, 300 do
		local n = rint(1, 25)
		local graph = paths.newGraph()
		local pts = {}
		for i = 1, n do
			pts[i] = { x = rint(0, 100), y = rint(0, 100), weight = rnd() < 0.3 and ({ 0.5, 2, 4 })[rint(1, 3)] or 1, out = {}, disabled = rnd() < 0.1 }
			graph:addPoint(i, pts[i].x, pts[i].y, pts[i].weight)
			if pts[i].disabled then graph:setDisabled(i) end
		end
		for _ = 1, rint(0, n * 2) do
			local a, b = rint(1, n), rint(1, n)
			if a ~= b then
				local both = rnd() < 0.7
				graph:connect(a, b, both)
				pts[a].out[b] = true
				if both then pts[b].out[a] = true end
			end
		end
		local function dijkstra(s, t)
			if pts[s].disabled or pts[t].disabled then return nil end
			local distance, done = { [s] = 0 }, {}
			while true do
				local cur, best = nil, math.huge
				for i, d in pairs(distance) do
					if not done[i] and d < best then cur, best = i, d end
				end
				if not cur then return nil end
				if cur == t then return best end
				done[cur] = true
				for q in pairs(pts[cur].out) do
					if not pts[q].disabled then
						local nd = best + math.sqrt((pts[q].x - pts[cur].x) ^ 2 + (pts[q].y - pts[cur].y) ^ 2) * pts[q].weight
						if not distance[q] or nd < distance[q] then distance[q] = nd end
					end
				end
			end
		end
		for _ = 1, 6 do
			local s, t = rint(1, n), rint(1, n)
			local want = dijkstra(s, t)
			local path = graph:findPath(s, t)
			cases = cases + 1
			if (want == nil) ~= (path == nil) then
				wrong = wrong + 1
			elseif path then
				reachable = reachable + 1
				local cost = 0
				local ok = path[1] == s and path[#path] == t
				for i = 2, #path do
					local a, b = path[i - 1], path[i]
					if not pts[a].out[b] or pts[b].disabled then ok = false end
					cost = cost + math.sqrt((pts[b].x - pts[a].x) ^ 2 + (pts[b].y - pts[a].y) ^ 2) * pts[b].weight
				end
				if not ok then invalid = invalid + 1 end
				if not near(cost, want, 1e-9) then wrong = wrong + 1 end
				if not same(path, graph:findPath(s, t)) then wrong = wrong + 1 end
			end
		end
	end
	check(("random graphs: %d searches (%d with a way) cost what Dijkstra's do"):format(cases, reachable), wrong == 0, wrong .. " differ")
	check("random graphs: every path follows connections", invalid == 0, invalid .. " don't")
end

---------------------------------------------------------------------------
-- Areas

local function pathLength(path) return paths.length(path) end

local function pointInPolygon(poly, x, y)
	local isIn = false
	local n = #poly / 2
	local j = n
	for i = 1, n do
		local xi, yi, xj, yj = poly[i * 2 - 1], poly[i * 2], poly[j * 2 - 1], poly[j * 2]
		if ((yi > y) ~= (yj > y)) and (x < (xj - xi) * (y - yi) / (yj - yi) + xi) then isIn = not isIn end
		j = i
	end
	return isIn
end

local function edgeDistance(poly, x, y)
	local best = math.huge
	local n = #poly / 2
	local j = n
	for i = 1, n do
		local ax, ay, bx, by = poly[j * 2 - 1], poly[j * 2], poly[i * 2 - 1], poly[i * 2]
		local dx, dy = bx - ax, by - ay
		local t = ((x - ax) * dx + (y - ay) * dy) / (dx * dx + dy * dy)
		t = math.max(0, math.min(1, t))
		best = math.min(best, math.sqrt((ax + dx * t - x) ^ 2 + (ay + dy * t - y) ^ 2))
		j = i
	end
	return best
end

-- Walkable worked out straight from the polygons (not from the area's
-- pieces): in some area, and not inside a hole. Points on an edge count.
local function walkable(areas, holes, x, y)
	local tol = 1e-6
	for _, h in ipairs(holes) do
		if pointInPolygon(h, x, y) and edgeDistance(h, x, y) > tol then return false end
	end
	for _, a in ipairs(areas) do
		if pointInPolygon(a, x, y) or edgeDistance(a, x, y) <= tol then return true end
	end
	return false
end

local function segmentWalkable(areas, holes, x1, y1, x2, y2, step)
	local len = math.sqrt((x2 - x1) ^ 2 + (y2 - y1) ^ 2)
	local n = math.max(1, math.ceil(len / (step or 0.5)))
	for i = 0, n do
		local t = i / n
		if not walkable(areas, holes, x1 + (x2 - x1) * t, y1 + (y2 - y1) * t) then return false end
	end
	return true
end

local function pathWalkable(areas, holes, path)
	for i = 3, #path, 2 do
		if not segmentWalkable(areas, holes, path[i - 2], path[i - 1], path[i], path[i + 1]) then return false end
	end
	return true
end

-- The true shortest path's length: Dijkstra over the start, the goal and
-- every corner, joined where one can see the other.
local function shortest(areas, holes, sx, sy, gx, gy)
	local xs, ys = { sx, gx }, { sy, gy }
	for _, list in ipairs({ areas, holes }) do
		for _, poly in ipairs(list) do
			for i = 1, #poly, 2 do
				if walkable(areas, holes, poly[i], poly[i + 1]) then
					xs[#xs + 1], ys[#ys + 1] = poly[i], poly[i + 1]
				end
			end
		end
	end
	local n = #xs
	local distance, done = { 0 }, {}
	local sees = {}
	while true do
		local cur, best = nil, math.huge
		for i, d in pairs(distance) do
			if not done[i] and d < best then cur, best = i, d end
		end
		if not cur then return nil end
		if cur == 2 then return best end
		done[cur] = true
		for q = 1, n do
			if not done[q] then
				local d = best + math.sqrt((xs[q] - xs[cur]) ^ 2 + (ys[q] - ys[cur]) ^ 2)
				if (not distance[q] or d < distance[q]) and segmentWalkable(areas, holes, xs[cur], ys[cur], xs[q], ys[q], 0.25) then
					distance[q] = d
				end
			end
		end
	end
end

do
	-- A room with a square pillar in the middle.
	local room = { 0, 0, 400, 0, 400, 300, 0, 300 }
	local pillar = { 150, 100, 250, 100, 250, 200, 150, 200 }
	local area = paths.newArea({ room }, { pillar })
	check("area: walkable", area:isWalkable(10, 10) and not area:isWalkable(200, 150) and not area:isWalkable(-5, 10))
	check("area: edges count", area:isWalkable(0, 0) and area:isWalkable(150, 150) and area:isWalkable(400, 300))
	local x, y = area:closestPoint(200, 110)
	check("area: closestPoint in a hole", x == 200 and y == 100, tostring(x) .. "," .. tostring(y))
	x, y = area:closestPoint(-30, 500)
	check("area: closestPoint outside", x == 0 and y == 300)
	x, y = area:closestPoint(20, 30)
	check("area: closestPoint inside", x == 20 and y == 30)
	local path = area:findPath(20, 20, 380, 30)
	check("area: straight when it can", same(path, { 20, 20, 380, 30 }), path and table.concat(path, ","))
	path = area:findPath(50, 140, 350, 140)
	local want = math.sqrt(100 ^ 2 + 40 ^ 2) * 2 + 100
	check("area: hugs the pillar's corners", path and same(path, { 50, 140, 150, 100, 250, 100, 350, 140 }), path and table.concat(path, ","))
	check("area: that path's length", path and near(pathLength(path), want, 1e-6))
	path = area:findPath(50, 160, 350, 160)
	check("area: the other way round", path and same(path, { 50, 160, 150, 200, 250, 200, 350, 160 }), path and table.concat(path, ","))
	path = area:findPath(140, 150, 260, 150)
	check("area: round one side", path and near(pathLength(path), 2 * math.sqrt(10 ^ 2 + 50 ^ 2) + 100, 1e-6), path and table.concat(path, ","))
	path = area:findPath(240, 150, 380, 150)
	check("area: starting in a hole starts at its edge", path and path[1] == 250 and path[2] == 150 and #path == 4, path and table.concat(path, ","))
	path = area:findPath(20, 20, 20, 20)
	check("area: nowhere to go", same(path, { 20, 20, 20, 20 }))
	check("area: same path twice", same(area:findPath(50, 140, 350, 140), area:findPath(50, 140, 350, 140)))
	check("area: pieces", #area:pieces() >= 4)

	-- Two rooms that overlap, two that only touch, and one far away.
	local a = { 0, 0, 100, 0, 100, 100, 0, 100 }
	local b = { 80, 40, 200, 40, 200, 60, 80, 60 }     -- overlaps a
	local c = { 200, 0, 300, 0, 300, 100, 200, 100 }   -- touches b's end
	local far = { 500, 0, 600, 0, 600, 100, 500, 100 }
	area = paths.newArea({ a, b, c, far })
	path = area:findPath(10, 10, 290, 90)
	check("area: joined rooms", path and near(pathLength(path), math.sqrt(90 ^ 2 + 30 ^ 2) * 2 + math.sqrt(100 ^ 2 + 20 ^ 2), 1e-6)
		and pathWalkable({ a, b, c, far }, {}, path), path and table.concat(path, ","))
	check("area: no way to an island", area:findPath(10, 10, 550, 50) == nil)
	path = area:findPath(10, 10, 550, 50, { partial = true })
	check("area: partial goes as near as it can", path and path[#path - 1] == 300 and path[#path] == 50, path and table.concat(path, ","))
	path = area:findPath(550, 50, 10, 10, { partial = true })
	check("area: partial from an island", path and path[#path - 1] == 500 and path[#path] == 10, path and table.concat(path, ","))
	path = area:findPath(10, 10, 400, 50)
	check("area: a goal outside counts as the nearest place", path and path[#path - 1] == 300 and path[#path] == 50)

	-- A U-shaped room (a polygon with a dent): round the dent.
	local u = { 0, 0, 300, 0, 300, 200, 200, 200, 200, 50, 100, 50, 100, 200, 0, 200 }
	area = paths.newArea({ u })
	path = area:findPath(50, 180, 250, 180)
	check("area: dented polygon", path and same(path, { 50, 180, 100, 50, 200, 50, 250, 180 }), path and table.concat(path, ","))
	-- The same polygon listed the other way round.
	local reversed = {}
	for i = #u - 1, 1, -2 do reversed[#reversed + 1], reversed[#reversed + 2] = u[i], u[i + 1] end
	area = paths.newArea(reversed)
	path = area:findPath(50, 180, 250, 180)
	check("area: either winding, one polygon", path and same(path, { 50, 180, 100, 50, 200, 50, 250, 180 }), path and table.concat(path, ","))

	-- Holes that overlap each other and stick out of the area.
	area = paths.newArea({ room }, { { 100, -50, 140, -50, 140, 200, 100, 200 }, { 120, 150, 300, 150, 300, 200, 120, 200 } })
	path = area:findPath(50, 100, 200, 100)
	check("area: overlapping holes", path and same(path, { 50, 100, 100, 200, 300, 200, 300, 150, 200, 100 }), path and table.concat(path, ","))
	-- A hole that cuts the area in two.
	area = paths.newArea({ room }, { { 190, -10, 210, -10, 210, 310, 190, 310 } })
	check("area: cut in two", area:findPath(50, 100, 350, 100) == nil and area:findPath(50, 100, 150, 250) ~= nil)

	area = paths.newArea({}, {})
	check("area: empty", area:findPath(0, 0, 1, 1) == nil and not area:isWalkable(0, 0) and area:closestPoint(0, 0) == nil)
	area = paths.newArea({ { 0, 0, 10, 0, 20, 0 } })
	check("area: flat polygon is nothing", #area:pieces() == 0)
	fails("area: bad polygon", function() paths.newArea({ { 0, 0, 1, 1 } }) end, "at least 3 corners")
	fails("area: bad list", function() paths.newArea("x") end, "list of polygons")
	fails("area: findPath numbers", function() paths.newArea({ room }):findPath(1, 2, 3) end, "four numbers")
end

-- Random rooms with holes against the true shortest path.
do
	local cases, compared, walkableFails, disagreements, shorter = 0, 0, 0, 0, 0
	local worst, total = 1, 0
	local over2, over10 = 0, 0
	for trial = 1, 120 do
		local areas = { { 0, 0, 200, 0, 200, 150, 0, 150 } }
		if rnd() < 0.5 then
			local x, y = rint(120, 220), rint(-40, 100)
			areas[#areas + 1] = { x, y, x + rint(30, 120), y, x + rint(30, 120), y + rint(30, 120), x - rint(0, 30), y + rint(30, 120) }
		end
		local holes = {}
		for _ = 1, rint(1, 5) do
			local x, y = rint(10, 180), rint(10, 130)
			if rnd() < 0.5 then
				local w, h = rint(8, 60), rint(8, 60)
				holes[#holes + 1] = { x, y, x + w, y, x + w, y + h, x, y + h }
			else
				holes[#holes + 1] = { x, y, x + rint(10, 60), y + rint(-20, 20), x + rint(-20, 40), y + rint(15, 60) }
			end
		end
		local area = paths.newArea(areas, holes)
		for _ = 1, 4 do
			local sx, sy, gx, gy
			repeat sx, sy = rint(1, 199) + 0.5, rint(1, 149) + 0.5 until walkable(areas, holes, sx, sy)
			repeat gx, gy = rint(1, 199) + 0.5, rint(1, 149) + 0.5 until walkable(areas, holes, gx, gy)
			cases = cases + 1
			local path = area:findPath(sx, sy, gx, gy)
			local best = shortest(areas, holes, sx, sy, gx, gy)
			if (path == nil) ~= (best == nil) then
				disagreements = disagreements + 1
			elseif path then
				compared = compared + 1
				if not (path[1] == sx and path[2] == sy and path[#path - 1] == gx and path[#path] == gy) or not pathWalkable(areas, holes, path) then
					walkableFails = walkableFails + 1
				end
				local ratio = best > 0 and pathLength(path) / best or 1
				if ratio < 1 - 1e-3 then shorter = shorter + 1 end
				if ratio > 1.02 then over2 = over2 + 1 end
				if ratio > 1.10 then over10 = over10 + 1 end
				if ratio > worst then worst = ratio end
				total = total + ratio
			end
		end
	end
	print(("random areas: %d searches, %d compared; longer than the shortest by 2%%+: %d, by 10%%+: %d; worst x%.3f, mean x%.4f; disagree on whether there's a way: %d")
		:format(cases, compared, over2, over10, worst, total / math.max(1, compared), disagreements))
	check("random areas: every path stays where it's walkable", walkableFails == 0, walkableFails .. " don't")
	check("random areas: no path is shorter than the shortest", shorter == 0, shorter)
	check("random areas: agree on whether there's a way", disagreements <= cases * 0.01, disagreements)
	check("random areas: paths are near the shortest on average", total / math.max(1, compared) < 1.01, total / math.max(1, compared))
	check("random areas: few paths are 10% longer than the shortest", over10 <= compared * 0.03, over10)
end

-- The scene's Walkable pieces (stand-ins: a position, points, tags).
do
	package.loaded["love.scene.nodes2d"] = { globalMatrix = function(n) return n.scaleX, 0, 0, n.scaleY, n.x, n.y end }
	local function walkable(x, y, points, hole, tags)
		local piece = { x = x, y = y, scaleX = 1, scaleY = 1, points = points, hole = hole or false, active = true, tags = tags or "" }
		function piece:hasAnyTag(list)
			for tag in list:gmatch("[^,%s]+") do
				if self.tags:find(tag, 1, true) then return true end
			end
			return false
		end
		paths._add(piece)
		return piece
	end
	local printed = {}
	local realPrint = print
	print = function(...) printed[#printed + 1] = ... end
	check("scene: nothing walkable", paths.findPath(0, 0, 10, 10) == nil and not paths.isWalkable(0, 0))
	paths.findPath(0, 0, 10, 10)
	print = realPrint
	check("scene: says so once", #printed == 1 and printed[1]:find("no Walkable pieces", 1, true) ~= nil)

	local square = { -100, -100, 100, -100, 100, 100, -100, 100 }
	local floor = walkable(100, 100, square, false, "land")
	local pillar = walkable(100, 100, { -20, -20, 20, -20, 20, 20, -20, 20 }, true, "land")
	check("scene: isWalkable", paths.isWalkable(10, 10) and not paths.isWalkable(100, 100) and not paths.isWalkable(300, 10))
	local path = paths.findPath(20, 95, 180, 95)
	check("scene: round the hole", same(path, { 20, 95, 80, 80, 120, 80, 180, 95 }), path and table.concat(path, ","))
	check("scene: closestPoint", same({ paths.closestPoint(100, 90) }, { 100, 80 }) and same({ paths.closestPoint(300, 50) }, { 200, 50 }))
	local area = paths.getArea()
	check("scene: the area is kept", paths.getArea() == area)
	pillar.x = 130
	check("scene: a moved piece is noticed", paths.getArea() ~= area and paths.isWalkable(100, 100) and not paths.isWalkable(130, 100))
	pillar.active = false
	check("scene: active off", paths.isWalkable(130, 100))
	pillar.active = true
	floor.scaleX = 2
	check("scene: scaled", paths.isWalkable(290, 10))
	floor.scaleX = 1
	local island = walkable(500, 100, { -100, -100, 100, -100, 100, 100, -100, 100 }, false, "sea")
	check("scene: tags", paths.isWalkable(500, 100) and not paths.isWalkable(500, 100, { tags = "land" }) and paths.isWalkable(500, 100, "sea, air")
		and paths.findPath(10, 10, 20, 20, { tags = "sea" })[1] == 400)
	area = paths.getArea()
	island.points[1] = -300
	check("scene: a point changed in place isn't noticed", paths.getArea() == area)
	paths.refresh()
	check("scene: until refresh()", paths.getArea() ~= area and paths.isWalkable(330, 50))
	paths._remove(island)
	check("scene: a removed piece", not paths.isWalkable(500, 100))
	-- An agent with no finder uses them, and plans again when they change.
	local agent = paths.newAgent({ reach = 2 })
	agent:setTarget(180, 95)
	local nx, ny = agent:next(20, 95)
	check("scene: agent's first corner", near(nx, 110) and near(ny, 80), tostring(nx) .. "," .. tostring(ny))
	pillar.active = false
	nx, ny = agent:next(21, 95)
	check("scene: agent plans again when the area changes", nx == 180 and ny == 95)
	fails("scene: findPath numbers", function() paths.findPath(1, 2, 3) end, "four numbers")
	fails("scene: bad tags", function() paths.isWalkable(1, 2, 3) end, "tags is a list of tags")
	paths._remove(floor)
	paths._remove(pillar)
end

---------------------------------------------------------------------------
-- Helpers and agents

do
	local path = { 0, 0, 30, 0, 30, 40 }
	check("length", paths.length(path) == 70 and paths.length({}) == 0 and paths.length({ 5, 5 }) == 0)
	local x, y, done = paths.pointAt(path, 15)
	check("pointAt: on the first part", x == 15 and y == 0 and done == false)
	x, y, done = paths.pointAt(path, 50)
	check("pointAt: on the second part", x == 30 and y == 20 and done == false)
	x, y, done = paths.pointAt(path, 70)
	check("pointAt: the end", x == 30 and y == 40 and done == true)
	x, y, done = paths.pointAt(path, -3)
	check("pointAt: before the start", x == 0 and y == 0 and done == false)
	fails("length: not a path", function() paths.length(5) end, "flat list of points")
end

-- Walks a point along an agent's directions at a speed; returns the steps it took.
local function walk(agent, x, y, speed, maxSteps)
	for step = 1, maxSteps do
		local nx, ny = agent:next(x, y)
		if agent:isDone() then return step, x, y end
		local dx, dy = nx - x, ny - y
		local d = math.sqrt(dx * dx + dy * dy)
		if d > speed then dx, dy = dx / d * speed, dy / d * speed end
		x, y = x + dx, y + dy
	end
	return nil, x, y
end

do
	-- Over a grid.
	local grid = paths.newGrid(10, 10, { cellSize = 16 })
	grid:fillSolid(5, 0, 1, 9)
	local agent = paths.newAgent({ finder = grid, reach = 3 })
	check("agent: done with no target", agent:isDone() and same({ agent:next(5, 6) }, { 5, 6 }))
	agent:setTarget(152, 8)
	check("agent: not done once it has a target", not agent:isDone())
	local steps, x, y = walk(agent, 8, 8, 2, 2000)
	check("agent: reaches the target over a grid", steps ~= nil and math.abs(x - 152) <= 3 and math.abs(y - 8) <= 3, tostring(x) .. "," .. tostring(y))
	check("agent: took the long way", steps and steps > 100 and steps < 220, steps)
	local planned = agent:path()
	check("agent: path", planned and planned[#planned - 1] == 152 and planned[#planned] == 8)
	-- The grid changes while it walks: it plans again.
	agent:setTarget(8, 8)
	x, y = 152, 8
	for _ = 1, 10 do
		local nx, ny = agent:next(x, y)
		local d = math.sqrt((nx - x) ^ 2 + (ny - y) ^ 2)
		x, y = x + (nx - x) / d * 2, y + (ny - y) / d * 2
	end
	local before = agent:path()
	grid:setSolid(5, 0, false)
	grid:setSolid(5, 9)
	agent:next(x, y)
	check("agent: plans again when the grid changes", agent:path() ~= before and #agent:path() < #before)
	steps, x, y = walk(agent, x, y, 2, 2000)
	check("agent: and still arrives", steps ~= nil and math.abs(x - 8) <= 3 and math.abs(y - 8) <= 3)
	-- No way: blocked, and it stays put.
	grid:setSolid(5, 0)
	local stuck = paths.newAgent({ finder = grid, partial = false })
	stuck:setTarget(152, 8)
	check("agent: blocked", same({ stuck:next(8, 8) }, { 8, 8 }) and stuck:isBlocked() and not stuck:isDone())
	local count = 0
	local counting = paths.newAgent({ finder = function(x1, y1, x2, y2)
		count = count + 1
		return { x1, y1, x2, y2 }
	end, replan = 20 })
	counting:setTarget(100, 0)
	counting:next(0, 0)
	counting:next(1, 0)
	check("agent: plans once", count == 1)
	counting:setTarget(110, 0)
	counting:next(2, 0)
	check("agent: a target that moved a little keeps the path", count == 1)
	counting:setTarget(130, 0)
	local nx, ny = counting:next(3, 0)
	check("agent: a target that moved far plans again", count == 2 and nx == 130 and ny == 0)
	counting:setTarget(140, 0)
	nx, ny = counting:next(128, 0)
	check("agent: at the end it goes the rest of the way", count == 3 and nx == 140 and ny == 0 and not counting:isDone())
	nx, ny = counting:next(139, 0)
	check("agent: done", counting:isDone() and count == 3)
	counting:stop()
	check("agent: stop", counting:isDone() and counting:path() == nil and counting:getTarget() == nil)
	fails("agent: bad finder", function() paths.newAgent({ finder = 5 }) end, "finder must be")
	fails("agent: next needs a position", function() agent:next() end, "where the piece is now")

	-- Over a graph: to the nearest point, along the connections, to the point nearest the target.
	local graph = paths.newGraph()
	graph:addPoint(1, 0, 0)
	graph:addPoint(2, 100, 0)
	graph:addPoint(3, 100, 100)
	graph:connect(1, 2)
	graph:connect(2, 3)
	local walker = paths.newAgent({ finder = graph, reach = 2 })
	walker:setTarget(105, 95)
	steps, x, y = walk(walker, 5, 10, 3, 500)
	check("agent: over a graph", steps ~= nil and math.abs(x - 100) <= 2 and math.abs(y - 100) <= 2, tostring(x) .. "," .. tostring(y))

	-- Over an area.
	local area = paths.newArea({ { 0, 0, 400, 0, 400, 300, 0, 300 } }, { { 150, 100, 250, 100, 250, 200, 150, 200 } })
	local free = paths.newAgent({ finder = area, reach = 2 })
	free:setTarget(350, 140)
	steps, x, y = walk(free, 50, 140, 2, 1000)
	local want = (math.sqrt(100 ^ 2 + 40 ^ 2) * 2 + 100) / 2
	check("agent: over an area", steps ~= nil and math.abs(x - 350) <= 2 and math.abs(y - 140) <= 2 and steps < want + 10, steps)
end

---------------------------------------------------------------------------
-- How long searches take (for docs/pathfinding.md)

if arg and arg[1] == "time" then
	local function time(name, n, fn)
		local t0 = os.clock()
		for _ = 1, n do fn() end
		print(("%-58s %8.3f ms"):format(name, (os.clock() - t0) / n * 1000))
	end
	for _, size in ipairs({ 32, 100, 200 }) do
		local grid = paths.newGrid(size, size)
		time(("grid %dx%d, empty, corner to corner"):format(size, size), 20, function() grid:findPath(0, 0, size - 1, size - 1) end)
		local diag = paths.newGrid(size, size, { diagonals = "noCorners" })
		time(("grid %dx%d, empty, diagonals, corner to corner"):format(size, size), 20, function() diag:findPath(0, 0, size - 1, size - 1) end)
		-- Walls with gaps at alternating ends: a path that snakes through the whole grid.
		for c = 2, size - 2, 4 do
			grid:fillSolid(c, 0, 1, size)
			grid:setSolid(c, (c % 8 == 2) and size - 1 or 0, false)
		end
		time(("grid %dx%d, snaking maze, corner to corner"):format(size, size), 10, function() grid:findPath(0, 0, size - 1, size - 1) end)
		grid:setSolid(size - 1, size - 1)
		time(("grid %dx%d, no way (searches every cell it can reach)"):format(size, size), 10, function() grid:findPath(0, 0, size - 1, size - 1, { partial = true }) end)
	end
	local graph = paths.newGraph()
	local n = 0
	for r = 1, 30 do
		for c = 1, 30 do
			n = n + 1
			graph:addPoint(n, c * 20, r * 20)
			if c > 1 then graph:connect(n, n - 1) end
			if r > 1 then graph:connect(n, n - 30) end
		end
	end
	time("graph, 900 points, corner to corner", 20, function() graph:findPath(1, 900) end)
	local holes = {}
	for r = 0, 5 do
		for c = 0, 7 do holes[#holes + 1] = { 40 + c * 100, 40 + r * 100, 100 + c * 100, 50 + r * 100, 90 + c * 100, 100 + r * 100, 30 + c * 100, 90 + r * 100 } end
	end
	local area
	time("area, 48 holes: building it", 3, function() area = paths.newArea({ { 0, 0, 840, 0, 840, 640, 0, 640 } }, holes) end)
	print("  pieces: " .. #area:pieces())
	time("area, 48 holes: corner to corner", 50, function() area:findPath(5, 5, 835, 635) end)
end

print(("DONE %d passed, %d failed"):format(passed, failed))
os.exit(failed == 0 and 0 or 1)
