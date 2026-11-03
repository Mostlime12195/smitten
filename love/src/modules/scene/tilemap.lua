-- Tiles: a grid of tiles from a .tileset file, painted in the editor.
--
-- The painted cells are stored in the scene as one rectangle:
--   "cells": { "x": 0, "y": 0, "w": 64, "h": 12, "data": "-1*130,3*5,..." }
-- data lists tile numbers row by row (-1 is empty); "n*k" repeats n k times.
-- Drawing uses a SpriteBatch for each 32x32 cells, drawn only when it's on
-- screen and rebuilt only when one of its cells changes.

local nodeLib = require("love.scene.node")
local assets = require("love.assets")
local physics2d = require("love.scene.physics2d")
local nodes2d = require("love.scene.nodes2d")

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
-- counts changes, for rigid2d's solid tiles.
local function changedAll(self)
	self._oldChunks = self._oldChunks or self._chunks
	self._chunks = nil
	self._changes = (self._changes or 0) + 1
end

local function ensure(self)
	if self._cellsSource ~= self.cells then
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
	for cy = y0, y0 + CHUNK - 1 do
		local row = grid[cy]
		if row then
			for cx = x0, x0 + CHUNK - 1 do
				local tile = row[cx]
				local q = tile and ts.quads[tile + 1]
				if q then batch:add(q, cx * tw, cy * th) end
			end
		end
	end
	chunk.batch, chunk.image, chunk.dirty = n > 0 and batch or nil, ts.image, false
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
	for _, chunk in pairs(self._chunks) do
		if chunk.kx >= kx0 and chunk.kx <= kx1 and chunk.ky >= ky0 and chunk.ky <= ky1 then
			if chunk.dirty or chunk.image ~= ts.image then buildChunk(self, chunk, ts) end
			if chunk.batch then g.draw(chunk.batch) end
		end
	end
end

return Tiles
