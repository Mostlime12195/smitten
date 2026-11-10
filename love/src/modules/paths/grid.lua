-- A grid pathfinder: cells that are open or solid, each with a cost, and
-- the cheapest way from one cell to another (A*).
--
--   local grid = smitten.paths.newGrid(40, 30, { cellSize = 16 })
--   grid:setSolid(5, 3)
--   local cells = grid:findPath(0, 0, 12, 9)        -- {column, row, column, row, ...}
--   local path = grid:findPoints(x, y, tx, ty)      -- {x, y, x, y, ...}
--
-- Cells are numbered like a Tiles piece's: the first is column 0, row 0.
-- This file uses nothing of the engine, so it runs under plain Lua
-- (tools/paths-tests).

local heap = require("love.paths.heap")

local floor, sqrt, abs, huge = math.floor, math.sqrt, math.abs, math.huge
local SQRT2 = sqrt(2)

local Grid = {}
Grid.__index = Grid

-- Up, right, down, left, then the four diagonals.
local DX = { 0, 1, 0, -1, 1, 1, -1, -1 }
local DY = { -1, 0, 1, 0, -1, 1, 1, -1 }

local DIAGONALS = { never = true, always = true, noCorners = true }
local HEURISTICS = { manhattan = true, euclidean = true, octile = true, chebyshev = true }

local function didYouMean(name, options)
	local ok, util = pcall(require, "love.engine.util")
	if not ok or type(name) ~= "string" then return "" end
	local names = {}
	for k in pairs(options) do names[#names + 1] = k end
	table.sort(names)
	return util.didYouMean(name, names)
end

local function listOf(options)
	local names = {}
	for k in pairs(options) do names[#names + 1] = '"' .. k .. '"' end
	table.sort(names)
	return table.concat(names, ", ")
end

local function whole(v) return type(v) == "number" and v == floor(v) end

local function setOptions(self, options, level)
	local size = options.cellSize or 16
	self.cellWidth = options.cellWidth or size
	self.cellHeight = options.cellHeight or size
	if type(self.cellWidth) ~= "number" or type(self.cellHeight) ~= "number" or self.cellWidth <= 0 or self.cellHeight <= 0 then
		error("a grid's cellSize must be a number above 0", level + 1)
	end
	self.x, self.y = options.x or 0, options.y or 0
	local diagonals = options.diagonals or "never"
	if not DIAGONALS[diagonals] then
		error(("diagonals can be %s, not %q%s"):format(listOf(DIAGONALS), tostring(diagonals), didYouMean(diagonals, DIAGONALS)), level + 1)
	end
	self.diagonals = diagonals
	local heuristic = options.heuristic or (diagonals == "never" and "manhattan" or "octile")
	if not HEURISTICS[heuristic] then
		error(("heuristic can be %s, not %q%s"):format(listOf(HEURISTICS), tostring(heuristic), didYouMean(heuristic, HEURISTICS)), level + 1)
	end
	self.heuristic = heuristic
end

local function allocate(self, columns, rows, firstColumn, firstRow)
	self.columns, self.rows = columns, rows
	self.firstColumn, self.firstRow = firstColumn, firstRow
	local n = columns * rows
	local solid, weight, g, from, seen, closed = {}, {}, {}, {}, {}, {}
	for i = 1, n do
		solid[i], weight[i], g[i], from[i], seen[i], closed[i] = false, 1, 0, 0, 0, 0
	end
	self._solid, self._weight = solid, weight
	self._g, self._from, self._seen, self._closed = g, from, seen, closed
	self._search = 0
	self._minWeight = 1
end

---Makes a grid of open cells.
local function new(columns, rows, options)
	if not whole(columns) or not whole(rows) or columns < 1 or rows < 1 then
		error("newGrid(columns, rows) needs how many columns and rows the grid has (whole numbers, at least 1)", 3)
	end
	options = options or {}
	if type(options) ~= "table" then error("newGrid's third argument is a table of options, like { cellSize = 16 }", 3) end
	local self = setmetatable({}, Grid)
	setOptions(self, options, 3)
	allocate(self, columns, rows, options.firstColumn or 0, options.firstRow or 0)
	self._heap = heap.new()
	---Goes up whenever a cell changes: an agent following an older path plans again.
	self.version = 0
	return self
end

function Grid:contains(column, row)
	local c, r = column - self.firstColumn, row - self.firstRow
	return c >= 0 and c < self.columns and r >= 0 and r < self.rows and c == floor(c) and r == floor(r)
end

-- The index of a cell, or an error that says which cells there are.
local function index(self, column, row, what, level)
	if type(column) ~= "number" or type(row) ~= "number" then
		error(("%s needs a column and a row (numbers)"):format(what), level + 1)
	end
	local c, r = column - self.firstColumn, row - self.firstRow
	if c < 0 or c >= self.columns or r < 0 or r >= self.rows or c ~= floor(c) or r ~= floor(r) then
		error(("%s: there's no cell %s, %s in this grid (columns go from %d to %d, rows from %d to %d; grid:contains(column, row) checks)")
			:format(what, tostring(column), tostring(row), self.firstColumn, self.firstColumn + self.columns - 1,
				self.firstRow, self.firstRow + self.rows - 1), level + 1)
	end
	return r * self.columns + c + 1
end

local function refreshIfStale(self)
	if self._stale and self.refresh then self:refresh() end
end

function Grid:setSolid(column, row, solid)
	refreshIfStale(self)
	self._solid[index(self, column, row, "setSolid", 2)] = solid ~= false
	self.version = self.version + 1
end

---True if nothing can walk through the cell. Cells outside the grid are solid.
function Grid:isSolid(column, row)
	refreshIfStale(self)
	if not self:contains(column, row) then return true end
	return self._solid[(row - self.firstRow) * self.columns + (column - self.firstColumn) + 1]
end

function Grid:setCost(column, row, cost)
	refreshIfStale(self)
	if type(cost) ~= "number" or not (cost > 0) or cost == huge then
		error("setCost(column, row, cost) needs a cost above 0 (1 is normal, 3 is three times as slow); use setSolid to block a cell", 2)
	end
	self._weight[index(self, column, row, "setCost", 2)] = cost
	if cost < self._minWeight then self._minWeight = cost end
	self.version = self.version + 1
end

function Grid:getCost(column, row)
	refreshIfStale(self)
	return self._weight[index(self, column, row, "getCost", 2)]
end

function Grid:fillSolid(column, row, columns, rows, solid)
	refreshIfStale(self)
	columns, rows = columns or 1, rows or 1
	if columns < 1 or rows < 1 then return end
	index(self, column, row, "fillSolid", 2)
	index(self, column + columns - 1, row + rows - 1, "fillSolid", 2)
	local cells, cols = self._solid, self.columns
	local c0, r0 = column - self.firstColumn, row - self.firstRow
	for r = r0, r0 + rows - 1 do
		for i = r * cols + c0 + 1, r * cols + c0 + columns do cells[i] = solid ~= false end
	end
	self.version = self.version + 1
end

---Opens every cell and sets every cost back to 1.
function Grid:clear()
	local solid, weight = self._solid, self._weight
	for i = 1, self.columns * self.rows do solid[i], weight[i] = false, 1 end
	self._minWeight = 1
	self._stale = nil
	self.version = self.version + 1
end

---The cell under a point in the scene: column, row (it may be outside the grid).
function Grid:cellAt(x, y)
	local tiles = self._tiles
	if tiles then return tiles:cellAt(x, y) end
	return floor((x - self.x) / self.cellWidth) + self.firstColumn, floor((y - self.y) / self.cellHeight) + self.firstRow
end

---The scene position of a cell's center: x, y.
function Grid:cellCenter(column, row)
	local tiles = self._tiles
	if tiles then return tiles:cellCenter(column, row) end
	return self.x + (column - self.firstColumn + 0.5) * self.cellWidth, self.y + (row - self.firstRow + 0.5) * self.cellHeight
end

local function estimate(kind, dx, dy)
	if dx < 0 then dx = -dx end
	if dy < 0 then dy = -dy end
	if kind == "manhattan" then return dx + dy end
	if kind == "octile" then
		if dx > dy then return dx + (SQRT2 - 1) * dy end
		return dy + (SQRT2 - 1) * dx
	end
	if kind == "euclidean" then return sqrt(dx * dx + dy * dy) end
	return dx > dy and dx or dy
end

-- A* from cell index si to gi (both 1-based, inside the grid). Returns the
-- index the path ends at (gi, or with partial the reached cell nearest to
-- it), or nil. The path is then in self._from.
local function search(self, si, gi, partial)
	local cols, rows = self.columns, self.rows
	local solid, weight = self._solid, self._weight
	local g, from, seen, closed = self._g, self._from, self._seen, self._closed
	local id = self._search + 1
	self._search = id
	local hp = self._heap
	heap.clear(hp)
	local push, pop = heap.push, heap.pop
	local kind, scale = self.heuristic, self._minWeight
	local ndirs = self.diagonals == "never" and 4 or 8
	local noCorners = self.diagonals == "noCorners"
	local costFn, estimateFn = self.cost, self.estimate
	local c0, r0 = self.firstColumn, self.firstRow
	local gc = (gi - 1) % cols
	local gr = (gi - 1 - gc) / cols

	local sc = (si - 1) % cols
	local sr = (si - 1 - sc) / cols
	local h0
	if estimateFn then h0 = estimateFn(sc + c0, sr + r0, gc + c0, gr + r0) else h0 = estimate(kind, gc - sc, gr - sr) * scale end
	g[si], from[si], seen[si] = 0, 0, id
	push(hp, si, h0, h0, si)
	local best, bestH, bestG = si, h0, 0

	while true do
		local cur, f = pop(hp)
		if not cur then break end
		if closed[cur] ~= id then
			closed[cur] = id
			if cur == gi then return gi end
			local cg = g[cur]
			if partial then
				local h = f - cg
				if h < bestH or (h == bestH and cg < bestG) then best, bestH, bestG = cur, h, cg end
			end
			local cc = (cur - 1) % cols
			local cr = (cur - 1 - cc) / cols
			for d = 1, ndirs do
				local nc, nr = cc + DX[d], cr + DY[d]
				if nc >= 0 and nc < cols and nr >= 0 and nr < rows then
					local ni = nr * cols + nc + 1
					if not solid[ni] and closed[ni] ~= id
						and not (d > 4 and noCorners and (solid[cur + DX[d]] or solid[cur + DY[d] * cols])) then
						local step
						if costFn then
							step = costFn(cc + c0, cr + r0, nc + c0, nr + r0)
						else
							step = (d > 4 and SQRT2 or 1) * weight[ni]
						end
						if step then
							local ng = cg + step
							if seen[ni] ~= id or ng < g[ni] then
								g[ni], from[ni], seen[ni] = ng, cur, id
								local h
								if estimateFn then
									h = estimateFn(nc + c0, nr + r0, gc + c0, gr + r0)
								else
									h = estimate(kind, gc - nc, gr - nr) * scale
								end
								push(hp, ni, ng + h, h, ni)
							end
						end
					end
				end
			end
		end
	end
	if partial then return best end
	return nil
end

-- The cells from the start to index `last`, as {column, row, ...} (or with
-- points, the scene positions of their centers).
local function collect(self, last, points)
	local from, cols = self._from, self.columns
	local n = 0
	local i = last
	while i ~= 0 do
		n = n + 1
		i = from[i]
	end
	local out = {}
	local k = n * 2
	i = last
	while i ~= 0 do
		local c = (i - 1) % cols
		local r = (i - 1 - c) / cols + self.firstRow
		c = c + self.firstColumn
		if points then c, r = self:cellCenter(c, r) end
		out[k - 1], out[k] = c, r
		k = k - 2
		i = from[i]
	end
	return out
end

local function find(self, si, gi, options, points)
	local partial = false
	if options ~= nil then
		if type(options) ~= "table" then error("the last argument is a table of options, like { partial = true }", 3) end
		partial = options.partial == true
	end
	-- A solid goal can't be reached: only a partial path gets near it.
	if self._solid[gi] and not partial then return nil end
	local last = search(self, si, gi, partial)
	if not last then return nil end
	return collect(self, last, points)
end

---The cheapest path between two cells, as a flat list {column, row, column,
---row, ...} from the first cell to the last, or nil if there's no way.
---With { partial = true }, a path to the reachable cell nearest the goal.
function Grid:findPath(fromColumn, fromRow, toColumn, toRow, options)
	refreshIfStale(self)
	local si = index(self, fromColumn, fromRow, "findPath", 2)
	local gi = index(self, toColumn, toRow, "findPath", 2)
	return find(self, si, gi, options, false)
end

local function clampCell(self, column, row)
	local c, r = column - self.firstColumn, row - self.firstRow
	if c < 0 then c = 0 elseif c >= self.columns then c = self.columns - 1 end
	if r < 0 then r = 0 elseif r >= self.rows then r = self.rows - 1 end
	return r * self.columns + c + 1
end

---The cheapest path between two points in the scene, as a flat list of the
---centers of the cells to walk through: {x, y, x, y, ...}, or nil. Points
---outside the grid count as the nearest cell on its edge.
function Grid:findPoints(x1, y1, x2, y2, options)
	if type(x1) ~= "number" or type(y1) ~= "number" or type(x2) ~= "number" or type(y2) ~= "number" then
		error("findPoints(x1, y1, x2, y2) needs two points in the scene (four numbers)", 2)
	end
	refreshIfStale(self)
	local si = clampCell(self, self:cellAt(x1, y1))
	local gi = clampCell(self, self:cellAt(x2, y2))
	return find(self, si, gi, options, true)
end

-- For agents: the points to walk to from x1, y1. The first cell's center is
-- left out: the walker is already in that cell, and walking back to its
-- center first would look like a stutter.
function Grid:_follow(x1, y1, x2, y2, options)
	local path = self:findPoints(x1, y1, x2, y2, options)
	if path and #path > 2 then
		table.remove(path, 1)
		table.remove(path, 1)
	end
	return path
end

---------------------------------------------------------------------------
-- A grid made from a Tiles piece

local function tileIsSolid(tiles, tile, info)
	return tiles.solid ~= false and info.solid == true and not info.oneWay
end

-- Reads every cell again from the Tiles piece.
local function refresh(self)
	local tiles, options = self._tiles, self._options
	self._stale = nil
	tiles:getTile(0, 0) -- reads the painted cells if they changed
	local cells = tiles._grid or {}
	local margin = options.margin or 0
	local c0, r0, columns, rows = options.column, options.row, options.columns, options.rows
	if not (c0 and r0 and columns and rows) then
		-- The painted area, and `margin` cells around it.
		local x0, y0, x1, y1 = huge, huge, -huge, -huge
		for cy, row in pairs(cells) do
			for cx in pairs(row) do
				if cx < x0 then x0 = cx end
				if cx > x1 then x1 = cx end
				if cy < y0 then y0 = cy end
				if cy > y1 then y1 = cy end
			end
		end
		if x0 > x1 then x0, y0, x1, y1 = 0, 0, 0, 0 end
		c0, r0 = c0 or (x0 - margin), r0 or (y0 - margin)
		columns, rows = columns or (x1 + margin - c0 + 1), rows or (y1 + margin - r0 + 1)
		if columns < 1 then columns = 1 end
		if rows < 1 then rows = 1 end
	end
	if columns ~= self.columns or rows ~= self.rows or c0 ~= self.firstColumn or r0 ~= self.firstRow then
		allocate(self, columns, rows, c0, r0)
	end
	local solid, weight = self._solid, self._weight
	local isSolid = options.solid or tileIsSolid
	local emptySolid = options.empty == "solid"
	local costName = options.cost or "cost"
	local minWeight = 1
	local i = 0
	for r = r0, r0 + rows - 1 do
		local row = cells[r]
		for c = c0, c0 + columns - 1 do
			i = i + 1
			local tile = row and row[c]
			if tile then
				local info = tiles:tileInfo(tile)
				solid[i] = isSolid(tiles, tile, info) and true or false
				local w = info[costName]
				if type(w) == "number" and w > 0 and w < huge then
					weight[i] = w
					if w < minWeight then minWeight = w end
				else
					weight[i] = 1
				end
			else
				solid[i], weight[i] = emptySolid, 1
			end
		end
	end
	self._minWeight = minWeight
	self.version = self.version + 1
end

-- One cell of the Tiles piece changed (Tiles:setTile calls this).
local function tileChanged(self, column, row)
	if self._stale then return end
	if not self:contains(column, row) then return end
	local tiles, options = self._tiles, self._options
	local i = (row - self.firstRow) * self.columns + (column - self.firstColumn) + 1
	local cells = tiles._grid
	local tile = cells and cells[row] and cells[row][column]
	if tile then
		local info = tiles:tileInfo(tile)
		self._solid[i] = (options.solid or tileIsSolid)(tiles, tile, info) and true or false
		local w = info[options.cost or "cost"]
		if type(w) == "number" and w > 0 and w < huge then
			self._weight[i] = w
			if w < self._minWeight then self._minWeight = w end
		else
			self._weight[i] = 1
		end
	else
		self._solid[i], self._weight[i] = options.empty == "solid", 1
	end
	self.version = self.version + 1
end

---Makes a grid with the cells of a Tiles piece: solid tiles are solid cells.
local function fromTiles(tiles, options)
	options = options or {}
	if type(options) ~= "table" then error("newPathGrid's argument is a table of options, like { diagonals = \"noCorners\" }", 3) end
	if options.solid ~= nil and type(options.solid) ~= "function" then
		error("newPathGrid's solid option is a function(tiles, tile, info) that returns true for tiles nothing walks through", 3)
	end
	if options.empty ~= nil and options.empty ~= "open" and options.empty ~= "solid" then
		error(('newPathGrid\'s empty option can be "open" or "solid", not %q'):format(tostring(options.empty)), 3)
	end
	local self = setmetatable({}, Grid)
	setOptions(self, options, 3)
	self.cellWidth, self.cellHeight = tiles:getTileSize()
	self._tiles, self._options = tiles, options
	self._heap = heap.new()
	self.version = 0
	self.refresh = refresh
	self._tileChanged = tileChanged
	refresh(self)
	return self
end

return { new = new, fromTiles = fromTiles, Grid = Grid }
