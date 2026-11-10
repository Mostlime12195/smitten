-- Tiles: a grid of tiles from a .tileset file, painted in the editor.
--
-- The painted cells are stored in the scene as one rectangle:
--   "cells": { "x": 0, "y": 0, "w": 64, "h": 12, "data": "-1*130,3*5,..." }
-- data lists tile numbers row by row (-1 is empty); "n*k" repeats n k times.
-- Drawing uses a SpriteBatch for each 32x32 cells, drawn only when it's on
-- screen and rebuilt only when one of its cells changes.
--
-- Animated tiles (the tileset's "animations") sit in the same batches. Each
-- chunk remembers where its animated cells are; when an animation moves on
-- to its next frame, only those cells' quads are changed, in the chunks on
-- screen. Between frame changes nothing is done: one comparison of the clock
-- against the time of the next change.
--
-- Terrains (the tileset's "terrains") are in love.scene.terrain: setTerrain
-- and fillTerrain pick the tiles that fit their neighbours.

local nodeLib = require("love.scene.node")
local assets = require("love.assets")
local physics2d = require("love.scene.physics2d")
local nodes2d = require("love.scene.nodes2d")
local terrainLib = require("love.scene.terrain")

local floor = math.floor

local Tiles = nodeLib.classes.Tiles

-- Decodes the cells property into a sparse grid: grid[cy][cx] = tile.
local function decodeCells(cells)
	local grid = {}
	if type(cells) ~= "table" or type(cells.data) ~= "string" then return grid end
	local x0, y0, w = cells.x or 0, cells.y or 0, cells.w or 0
	local i = 0
	for token in cells.data:gmatch("[^,]+") do
		local v, n = token:match("^(-?%d+)%*(%d+)$")
		v = tonumber(v or token)
		n = tonumber(n) or 1
		for _ = 1, n do
			if v and v >= 0 and w > 0 then
				local cy, cx = y0 + floor(i / w), x0 + i % w
				local row = grid[cy]
				if not row then
					row = {}
					grid[cy] = row
				end
				row[cx] = v
			end
			i = i + 1
		end
	end
	return grid
end

---Encodes a grid back into the cells format (used by the editor's tests).
function Tiles.encodeCells(grid)
	local x0, y0, x1, y1 = math.huge, math.huge, -math.huge, -math.huge
	for cy, row in pairs(grid) do
		for cx in pairs(row) do
			x0, x1 = math.min(x0, cx), math.max(x1, cx)
			y0, y1 = math.min(y0, cy), math.max(y1, cy)
		end
	end
	if x0 > x1 then return { x = 0, y = 0, w = 0, h = 0, data = "" } end
	local out, last, run = {}, nil, 0
	local function flush()
		if run > 0 then out[#out + 1] = run > 1 and (last .. "*" .. run) or tostring(last) end
	end
	for cy = y0, y1 do
		for cx = x0, x1 do
			local v = grid[cy] and grid[cy][cx] or -1
			if v == last then
				run = run + 1
			else
				flush()
				last, run = v, 1
			end
		end
	end
	flush()
	return { x = x0, y = y0, w = x1 - x0 + 1, h = y1 - y0 + 1, data = table.concat(out, ",") }
end

local CHUNK = 32 -- cells per side of a chunk

local function chunkKey(kx, ky) return kx * 4194304 + ky end

-- Everything needs drawing again (new cells or a new tileset). _changes
-- counts changes.
local function changedAll(self)
	self._oldChunks = self._oldChunks or self._chunks
	self._chunks = nil
	self._occ = nil -- the edges that block light (lights.lua)
	self._changes = (self._changes or 0) + 1
	-- Path grids made from these tiles read them again when next used.
	local grids = self._pathGrids
	if grids then
		for grid in pairs(grids) do grid._stale = true end
	end
end

local function ensure(self)
	-- (A piece with no painted cells has cells = nil: its grid still has to
	-- be made the first time.)
	if self._cellsSource ~= self.cells or self._grid == nil then
		self._grid = decodeCells(self.cells)
		self._cellsSource = self.cells
		changedAll(self)
	end
	if self._tilesetPath ~= self.tileset then
		self._tilesetPath = self.tileset
		self._ts = (self.tileset ~= nil and self.tileset ~= "") and assets.tileset(self.tileset) or nil
		changedAll(self)
	end
	return self._ts
end

function Tiles:_enter()
	ensure(self)
	physics2d.addTiles(self)
end

-- The clock of the animated tiles: it follows the game's speed and stops
-- while the game is paused (or animate is off).
function Tiles:_process(dt)
	if self.animate then self._time = (self._time or 0) + dt end
end

function Tiles:_exit()
	physics2d.removeTiles(self)
end

-- Tile size in scene units and the map's origin (scale and position only).
function Tiles:_cellSize()
	local ts = ensure(self)
	if not ts then return 0, 0, 0, 0 end
	local a, b, c, d, tx, ty = nodes2d.globalMatrix(self)
	return ts.tileWidth * a, ts.tileHeight * d, tx, ty
end

function Tiles:_solidAt(cx, cy)
	local row = self._grid[cy]
	local tile = row and row[cx]
	if not tile then return nil end
	local props = self._ts.tiles[tile]
	if props and props.solid then return props end
	return nil
end

function Tiles:_findInBox(x0, y0, x1, y1, property)
	local ts = ensure(self)
	if not ts then return nil end
	local tw, th, ox, oy = self:_cellSize()
	for cy = floor((y0 - oy) / th), floor((y1 - oy) / th) do
		local row = self._grid[cy]
		if row then
			for cx = floor((x0 - ox) / tw), floor((x1 - ox) / tw) do
				local tile = row[cx]
				local props = tile and ts.tiles[tile]
				if props and props[property] ~= nil then return props, cx, cy end
			end
		end
	end
	return nil
end

function Tiles:getTile(cx, cy)
	ensure(self)
	local row = self._grid[cy]
	return row and row[cx] or -1
end

function Tiles:setTile(cx, cy, tile)
	ensure(self)
	local row = self._grid[cy]
	if tile == nil or tile < 0 then
		if row then row[cx] = nil end
	else
		if not row then
			row = {}
			self._grid[cy] = row
		end
		row[cx] = tile
	end
	self._changes = (self._changes or 0) + 1
	physics2d.tileChanged(self, cx, cy)
	if self._occ then require("love.scene.lights")._tileChanged(self, cx, cy) end
	local grids = self._pathGrids
	if grids then
		for grid in pairs(grids) do grid:_tileChanged(cx, cy) end
	end
	local chunks = self._chunks
	if chunks then
		local kx, ky = floor(cx / CHUNK), floor(cy / CHUNK)
		local k = chunkKey(kx, ky)
		if chunks[k] then chunks[k].dirty = true else chunks[k] = { kx = kx, ky = ky, dirty = true } end
	end
end

function Tiles:tileInfo(tile)
	local ts = ensure(self)
	return ts and ts.tiles[tile] or {}
end

function Tiles:cellAt(x, y)
	local lx, ly = self:fromWorld(x, y)
	local ts = ensure(self)
	if not ts then return 0, 0 end
	return floor(lx / ts.tileWidth), floor(ly / ts.tileHeight)
end

function Tiles:cellPosition(cx, cy)
	local ts = ensure(self)
	if not ts then return 0, 0 end
	return self:toWorld(cx * ts.tileWidth, cy * ts.tileHeight)
end

function Tiles:cellsWith(tile)
	ensure(self)
	local out = {}
	for cy, row in pairs(self._grid) do
		for cx, t in pairs(row) do
			if tile == nil or t == tile then out[#out + 1] = { column = cx, row = cy, tile = t } end
		end
	end
	table.sort(out, function(p, q) return p.row < q.row or (p.row == q.row and p.column < q.column) end)
	return out
end

---Sets a rectangle of cells to one tile (-1 empties them).
function Tiles:fill(cx, cy, columns, rows, tile)
	ensure(self)
	local grid = self._grid
	for y = cy, cy + (rows or 1) - 1 do
		local row = grid[y]
		for x = cx, cx + (columns or 1) - 1 do
			if tile == nil or tile < 0 then
				if row then row[x] = nil end
			else
				if not row then
					row = {}
					grid[y] = row
				end
				row[x] = tile
			end
		end
	end
	changedAll(self)
	physics2d.tileAreaChanged(self, cx, cy, cx + (columns or 1) - 1, cy + (rows or 1) - 1)
end

---Empties every cell.
function Tiles:clear()
	ensure(self)
	self._grid = {}
	changedAll(self)
end

---The tile number under a point in the scene, or -1.
function Tiles:tileAt(x, y)
	return self:getTile(self:cellAt(x, y))
end

---True if the cell has a tile marked solid (and the Tiles piece is solid).
function Tiles:isSolid(cx, cy)
	ensure(self)
	if not self._ts or not self.solid then return false end
	return self:_solidAt(cx, cy) ~= nil
end

local AROUND = { { 0, -1 }, { 1, 0 }, { 0, 1 }, { -1, 0 } }
local AROUND8 = { { 0, -1 }, { 1, -1 }, { 1, 0 }, { 1, 1 }, { 0, 1 }, { -1, 1 }, { -1, 0 }, { -1, -1 } }

---The cells around one: a list of {column, row, tile} (tile -1 when empty),
---up, right, down, left; with diagonal, all eight, clockwise from up.
function Tiles:neighbors(cx, cy, diagonal)
	local out = {}
	for i, d in ipairs(diagonal and AROUND8 or AROUND) do
		local x, y = cx + d[1], cy + d[2]
		out[i] = { column = x, row = y, tile = self:getTile(x, y) }
	end
	return out
end

---The scene position of a cell's center.
function Tiles:cellCenter(cx, cy)
	local ts = ensure(self)
	if not ts then return 0, 0 end
	return self:toWorld((cx + 0.5) * ts.tileWidth, (cy + 0.5) * ts.tileHeight)
end

---The size of one cell in the scene (the tileset's tile size, scaled).
function Tiles:getTileSize()
	local tw, th = self:_cellSize()
	return math.abs(tw), math.abs(th)
end

---The painted area in the scene: x, y, width, height (all 0 when empty).
function Tiles:getBounds()
	local ts = ensure(self)
	local x0, y0, x1, y1 = math.huge, math.huge, -math.huge, -math.huge
	for cy, row in pairs(self._grid) do
		for cx in pairs(row) do
			if cx < x0 then x0 = cx end
			if cx > x1 then x1 = cx end
			if cy < y0 then y0 = cy end
			if cy > y1 then y1 = cy end
		end
	end
	if not ts or x0 > x1 then return 0, 0, 0, 0 end
	local ax, ay = self:toWorld(x0 * ts.tileWidth, y0 * ts.tileHeight)
	local bx, by = self:toWorld((x1 + 1) * ts.tileWidth, (y1 + 1) * ts.tileHeight)
	return math.min(ax, bx), math.min(ay, by), math.abs(bx - ax), math.abs(by - ay)
end

---A grid for finding paths through these tiles (smitten.paths): solid tiles
---are solid cells, and a tile's "cost" setting makes its cell cost more to
---cross. The grid follows setTile(), fill() and clear().
function Tiles:newPathGrid(options)
	local grid = require("love.paths.grid").fromTiles(self, options)
	-- Weak: a grid nobody uses any more is forgotten.
	self._pathGrids = self._pathGrids or setmetatable({}, { __mode = "k" })
	self._pathGrids[grid] = true
	return grid
end

---------------------------------------------------------------------------
-- Terrains

local function terrainNamed(self, ts, name, level)
	local t = ts.terrainByName[name]
	if t then return t end
	local names = {}
	for i = 1, #ts.terrains do names[i] = ts.terrains[i].name end
	if type(name) ~= "string" then
		error(("a terrain's name is text like \"grass\", not %s"):format(type(name) == "number" and tostring(name) or ("a " .. type(name))), level + 1)
	end
	if #names == 0 then
		error(("%s has no terrains yet: make one in the Tiles panel (Terrains)"):format(tostring(self.tileset)), level + 1)
	end
	error(("%s has no terrain called %q%s"):format(tostring(self.tileset), name,
		require("love.engine.util").didYouMean(name, names)), level + 1)
end

-- get(column, row) and set(column, row, tile) for love.scene.terrain, made
-- once for each Tiles piece.
local function access(self)
	local get = self._tget
	if not get then
		get = function(cx, cy)
			local row = self._grid[cy]
			return row and row[cx]
		end
		self._tget = get
		self._tset = function(cx, cy, tile) self:setTile(cx, cy, tile) end
	end
	return get, self._tset
end

local function needsTileset(self, what)
	local ts = ensure(self)
	if not ts then error(what .. "() needs a tileset: this Tiles piece has none", 3) end
	return ts
end

---Puts a terrain in a cell (nil: empties it) and picks the tiles of the
---cell and its eight neighbours again so they fit together.
function Tiles:setTerrain(cx, cy, name)
	local ts = needsTileset(self, "setTerrain")
	local t = nil
	if name ~= nil then t = terrainNamed(self, ts, name, 2) end
	local get, set = access(self)
	terrainLib.place(get, set, ts.terrainOf, cx, cy, t)
end

---The name of the terrain the cell's tile belongs to, or nil.
function Tiles:getTerrain(cx, cy)
	local ts = ensure(self)
	if not ts then return nil end
	local row = self._grid[cy]
	local t = row and ts.terrainOf[row[cx]]
	return t and t.name or nil
end

---Puts a terrain in a rectangle of cells (nil: empties them) and fits them
---and the cells around the rectangle.
function Tiles:fillTerrain(cx, cy, columns, rows, name)
	local ts = needsTileset(self, "fillTerrain")
	local t = nil
	if name ~= nil then t = terrainNamed(self, ts, name, 2) end
	if t and t.first == nil then return end
	columns, rows = columns or 1, rows or 1
	self:fill(cx, cy, columns, rows, t and t.first or -1)
	local get, set = access(self)
	local of = ts.terrainOf
	local x1, y1 = cx + columns - 1, cy + rows - 1
	for y = cy - 1, y1 + 1 do
		for x = cx - 1, x1 + 1 do
			terrainLib.refresh(get, set, of, x, y, x >= cx and x <= x1 and y >= cy and y <= y1)
		end
	end
end

---The names of the tileset's terrains, in the tileset's order.
function Tiles:terrains()
	local ts = ensure(self)
	local out = {}
	if ts then
		for i = 1, #ts.terrains do out[i] = ts.terrains[i].name end
	end
	return out
end

---------------------------------------------------------------------------
-- Animated tiles

-- Works out which frame every animation shows at the Tiles piece's time, and
-- when the next one changes. cur[animation][phase] is the tile to draw.
local function animationFrames(self, ts, time)
	local cur = self._animCur
	if not cur or self._animTs ~= ts then
		cur = {}
		self._animCur, self._animTs = cur, ts
	end
	local soonest = math.huge
	local list = ts.animated
	for i = 1, #list do
		local a = list[i]
		local c = cur[a]
		if not c then
			c = {}
			cur[a] = c
		end
		local ends, frames, total, phases = a.ends, a.frames, a.total, a.phases
		local n = #ends
		for p = 1, phases do
			local t = (time + (p - 1) / phases * total) % total
			local k = 1
			while k < n and t >= ends[k] do k = k + 1 end
			c[p] = frames[k]
			local left = ends[k] - t
			if left < soonest then soonest = left end
		end
	end
	self._animAt = time
	self._animNext = time + math.max(soonest, 1e-6)
	self._animVersion = (self._animVersion or 0) + 1
end

-- Which of an animation's starting points a cell uses (randomStart).
local function phaseOf(a, cx, cy)
	if a.phases == 1 then return 1 end
	return terrainLib.hash(cx, cy) % a.phases + 1
end

-- The chunks that have tiles: key -> {kx, ky, dirty = true}.
local function listChunks(self)
	local chunks = {}
	for cy, row in pairs(self._grid) do
		local ky = floor(cy / CHUNK)
		for cx in pairs(row) do
			local k = chunkKey(floor(cx / CHUNK), ky)
			if not chunks[k] then chunks[k] = { kx = floor(cx / CHUNK), ky = ky, dirty = true } end
		end
	end
	-- Keep the batches of the chunks that are still there.
	local old = self._oldChunks
	if old then
		for k, c in pairs(chunks) do
			if old[k] then c.batch = old[k].batch end
		end
	end
	return chunks
end

local function buildChunk(self, chunk, ts)
	local grid, tw, th = self._grid, ts.tileWidth, ts.tileHeight
	local x0, y0 = chunk.kx * CHUNK, chunk.ky * CHUNK
	local n = 0
	for cy = y0, y0 + CHUNK - 1 do
		local row = grid[cy]
		if row then
			for cx = x0, x0 + CHUNK - 1 do
				if row[cx] then n = n + 1 end
			end
		end
	end
	local batch = chunk.batch
	if batch and chunk.image == ts.image and batch:getBufferSize() >= n then
		batch:clear()
	elseif n > 0 then
		batch = love.graphics.newSpriteBatch(ts.image, n, "static")
	end
	-- The chunk's animated cells: id in the batch, x, y, animation, phase.
	local animations, cur = ts.animations, self._animCur
	local anim, na = chunk.anim, 0
	local quads = ts.quads
	for cy = y0, y0 + CHUNK - 1 do
		local row = grid[cy]
		if row then
			for cx = x0, x0 + CHUNK - 1 do
				local tile = row[cx]
				if tile then
					local a = cur and animations[tile]
					if a then
						local phase = phaseOf(a, cx, cy)
						local q = quads[cur[a][phase] + 1]
						if q then
							if not anim then
								anim = {}
								chunk.anim = anim
							end
							anim[na + 1], anim[na + 2], anim[na + 3] = batch:add(q, cx * tw, cy * th), cx * tw, cy * th
							anim[na + 4], anim[na + 5] = a, phase
							na = na + 5
						end
					else
						local q = quads[tile + 1]
						if q then batch:add(q, cx * tw, cy * th) end
					end
				end
			end
		end
	end
	if anim then
		for i = #anim, na + 1, -1 do anim[i] = nil end
	end
	chunk.animCount, chunk.animVersion = na, self._animVersion
	chunk.batch, chunk.image, chunk.dirty = n > 0 and batch or nil, ts.image, false
end

-- Shows the current frame in a chunk's animated cells.
local function animateChunk(self, chunk, ts)
	local anim, cur, quads, batch = chunk.anim, self._animCur, ts.quads, chunk.batch
	for i = 1, chunk.animCount, 5 do
		local q = quads[cur[anim[i + 3]][anim[i + 4]] + 1]
		if q then batch:set(anim[i], q, anim[i + 1], anim[i + 2]) end
	end
	chunk.animVersion = self._animVersion
end

function Tiles:_draw()
	local ts = ensure(self)
	if not ts then return end
	if not self._chunks then
		self._chunks = listChunks(self)
		self._oldChunks = nil
	end
	-- The part of the map on screen, in the map's own coordinates.
	local g = love.graphics
	local display = require("love.display")
	local w, h = g.getDimensions()
	w, h = math.max(w, display.width or 0), math.max(h, display.height or 0)
	local x0, y0, x1, y1 = math.huge, math.huge, -math.huge, -math.huge
	for i = 0, 3 do
		local x, y = g.inverseTransformPoint(i % 2 * w, floor(i / 2) * h)
		x0, y0, x1, y1 = math.min(x0, x), math.min(y0, y), math.max(x1, x), math.max(y1, y)
	end
	local cw, ch = CHUNK * ts.tileWidth, CHUNK * ts.tileHeight
	local kx0, ky0, kx1, ky1 = floor(x0 / cw), floor(y0 / ch), floor(x1 / cw), floor(y1 / ch)
	-- Animated tiles: has a frame ended since the last look?
	local version = nil
	if ts.animated[1] then
		local time = self._time or 0
		if self._animTs ~= ts or time >= self._animNext or time < self._animAt then animationFrames(self, ts, time) end
		version = self._animVersion
	end
	for _, chunk in pairs(self._chunks) do
		if chunk.kx >= kx0 and chunk.kx <= kx1 and chunk.ky >= ky0 and chunk.ky <= ky1 then
			if chunk.dirty or chunk.image ~= ts.image then
				buildChunk(self, chunk, ts)
			elseif version and chunk.animCount > 0 and chunk.animVersion ~= version then
				animateChunk(self, chunk, ts)
			end
			if chunk.batch then g.draw(chunk.batch) end
		end
	end
end

return Tiles
