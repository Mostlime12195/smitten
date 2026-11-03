-- Tiles: a grid of tiles from a .tileset file, painted in the editor.
--
-- The painted cells are stored in the scene as one rectangle:
--   "cells": { "x": 0, "y": 0, "w": 64, "h": 12, "data": "-1*130,3*5,..." }
-- data lists tile numbers row by row (-1 is empty); "n*k" repeats n k times.
-- Drawing uses one SpriteBatch, rebuilt when a cell changes.

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

local function ensure(self)
	if self._cellsSource ~= self.cells then
		self._grid = decodeCells(self.cells)
		self._cellsSource = self.cells
		self._dirty = true
	end
	if self._tilesetPath ~= self.tileset then
		self._tilesetPath = self.tileset
		self._ts = (self.tileset ~= nil and self.tileset ~= "") and assets.tileset(self.tileset) or nil
		self._dirty = true
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
	self._dirty = true
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

function Tiles:_draw()
	local ts = ensure(self)
	if not ts then return end
	if self._dirty or not self._batch or self._batchImage ~= ts.image then
		local n = 0
		for _, row in pairs(self._grid) do
			for _ in pairs(row) do n = n + 1 end
		end
		local batch = love.graphics.newSpriteBatch(ts.image, math.max(n, 1), "static")
		for cy, row in pairs(self._grid) do
			for cx, tile in pairs(row) do
				local q = ts.quads[tile + 1]
				if q then batch:add(q, cx * ts.tileWidth, cy * ts.tileHeight) end
			end
		end
		self._batch, self._batchImage, self._dirty = batch, ts.image, false
	end
	love.graphics.draw(self._batch)
end

return Tiles
