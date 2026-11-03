-- smitten.map and smitten.tileset: tilemaps made with Smitten's map editor.
--
--   local level = smitten.map("maps/level1")    -- maps/level1.map.json
--   function love.draw() level:draw() end
--
-- Tile layers are drawn with SpriteBatches, one per tileset, in chunks of
-- CHUNK × CHUNK tiles. Chunks are built the first time they're on screen and
-- only the chunks inside the current view are drawn. The view is worked out
-- from the current render target (the window, or a canvas such as
-- smitten.screen's), the scissor rectangle and the current transform, so
-- love.graphics.translate/scale cameras work without telling the map.

local assets = require("smitten.assets").assets

local CHUNK = 32

local floor, ceil, min, max = math.floor, math.ceil, math.min, math.max

-- Error messages from inside the loaders, without the "file:line:" prefix.
local function clean(message)
	return (tostring(message):gsub("^[^:\n]*:%d+: ", ""))
end

local function checkFormat(path, data, format)
	if type(data) ~= "table" then error(("%s: expected a JSON object"):format(path), 0) end
	if data.format ~= nil and data.format ~= format then
		error(("%s: this is a %q file, not a %s file"):format(path, tostring(data.format), format), 0)
	end
	local version = data.version or 1
	if type(version) ~= "number" or version > 1 then
		error(("%s: made by a newer version of Smitten (%s version %s; this engine reads version 1). Update Smitten to load it.")
			:format(path, format, tostring(version)), 0)
	end
end

local function positiveInteger(path, data, field, default)
	local v = data[field]
	if v == nil then return default end
	if type(v) ~= "number" or v < 1 or v % 1 ~= 0 then
		error(("%s: %q should be a whole number of 1 or more, got %s"):format(path, field, tostring(v)), 0)
	end
	return v
end

---Parse "#rrggbb" (or "#rrggbbaa") into {r, g, b, a} with values from 0 to 1.
local function parseColor(s)
	if type(s) ~= "string" then return nil end
	local hex = s:match("^#(%x+)$")
	if not hex or (#hex ~= 6 and #hex ~= 8) then return nil end
	local c = {}
	for i = 1, #hex, 2 do c[#c + 1] = tonumber(hex:sub(i, i + 1), 16) / 255 end
	c[4] = c[4] or 1
	return c
end

-------------------------------------------------------------------------------
-- Tilesets

---@class smitten.Tileset
---@field path string the .tileset.json file
---@field image love.Image
---@field tileWidth integer
---@field tileHeight integer
---@field columns integer tiles per row in the image
---@field rows integer
---@field count integer number of tiles
local Tileset = {}
Tileset.__index = Tileset

local function loadTileset(path)
	local data = assets.readJSON(path)
	checkFormat(path, data, "smitten.tileset")
	if type(data.image) ~= "string" or data.image == "" then
		error(("%s: \"image\" should name the tileset's PNG"):format(path), 0)
	end
	local imagePath = assets.join(path, data.image)
	if not love.filesystem.getInfo(imagePath, "file") then
		error(("%s: can't find its image %s"):format(path, imagePath), 0)
	end
	local image = love.graphics.newImage(imagePath)
	image:setFilter("nearest", "nearest")
	local self = setmetatable({}, Tileset)
	self.path = path
	self.imagePath = imagePath
	self.image = image
	self.tileWidth = positiveInteger(path, data, "tileWidth", 16)
	self.tileHeight = positiveInteger(path, data, "tileHeight", 16)
	local iw, ih = image:getDimensions()
	self.columns = floor(iw / self.tileWidth)
	self.rows = floor(ih / self.tileHeight)
	self.count = self.columns * self.rows
	self._quads = {}
	self._properties = {}
	if data.tiles ~= nil and type(data.tiles) ~= "table" then
		error(("%s: \"tiles\" should be an object of tile properties"):format(path), 0)
	end
	for key, props in pairs(data.tiles or {}) do
		local n = tonumber(key)
		if n and type(props) == "table" then self._properties[n] = props end
	end
	return self
end

---A love Quad for a tile of this tileset (0-based), or nil if out of range.
---@param tile integer
---@return love.Quad?
function Tileset:quad(tile)
	if type(tile) ~= "number" or tile < 0 or tile >= self.count or tile % 1 ~= 0 then return nil end
	local q = self._quads[tile]
	if not q then
		local iw, ih = self.image:getDimensions()
		q = love.graphics.newQuad((tile % self.columns) * self.tileWidth, floor(tile / self.columns) * self.tileHeight,
			self.tileWidth, self.tileHeight, iw, ih)
		self._quads[tile] = q
	end
	return q
end

---A tile's properties from the .tileset.json (an empty table if it has none).
---@param tile integer
---@return table
function Tileset:properties(tile)
	return self._properties[tile] or {}
end

---Load a tileset (cached). The .tileset.json extension may be left out.
---@param path string e.g. "tiles/terrain"
---@return smitten.Tileset
local function tileset(path)
	local resolved = assets.resolve(path, { ".tileset.json" }, "tileset")
	local ok, value = pcall(assets.cached, "tileset", resolved, loadTileset)
	if not ok then error("smitten.tileset: " .. clean(value), 2) end
	return value
end

-------------------------------------------------------------------------------
-- Maps

---@class smitten.Map
---@field path string the .map.json file
---@field width integer in tiles
---@field height integer in tiles
---@field tileWidth integer
---@field tileHeight integer
---@field pixelWidth integer
---@field pixelHeight integer
---@field tilesets smitten.Tileset[]
---@field layers table[] every layer, in drawing order (each has name, type, visible, and data or objects)
---@field properties table
---@field background string? the background color as written in the file ("#rrggbb")
---@field backgroundColor number[]? the background color as {r, g, b, a}, for love.graphics.clear
local Map = {}
Map.__index = Map

local function loadMap(path)
	local data = assets.readJSON(path)
	checkFormat(path, data, "smitten.map")
	local self = setmetatable({}, Map)
	self.path = path
	self.width = positiveInteger(path, data, "width", 1)
	self.height = positiveInteger(path, data, "height", 1)
	self.tileWidth = positiveInteger(path, data, "tileWidth", 16)
	self.tileHeight = positiveInteger(path, data, "tileHeight", 16)
	self.pixelWidth = self.width * self.tileWidth
	self.pixelHeight = self.height * self.tileHeight
	self.properties = type(data.properties) == "table" and data.properties or {}
	self.background = type(data.background) == "string" and data.background or nil
	self.backgroundColor = parseColor(self.background)

	-- Tilesets, with tile numbers continuing from one to the next.
	self.tilesets = {}
	self._tileSet = {}    -- tile number -> tileset
	self._tileQuad = {}   -- tile number -> quad
	self._tileLocal = {}  -- tile number -> tile number inside its tileset
	self._solid = {}      -- tile number -> true
	self._firstTile = {}  -- tileset -> its first tile number
	local first = 0
	for i, rel in ipairs(type(data.tilesets) == "table" and data.tilesets or {}) do
		if type(rel) ~= "string" then error(("%s: tilesets[%d] should be a path"):format(path, i), 0) end
		local tsPath = assets.join(path, rel)
		if not love.filesystem.getInfo(tsPath, "file") then
			error(("%s: can't find its tileset %s"):format(path, tsPath), 0)
		end
		local ts = assets.cached("tileset", tsPath, loadTileset)
		self.tilesets[i] = ts
		self._firstTile[ts] = first
		for t = 0, ts.count - 1 do
			local g = first + t
			self._tileSet[g] = ts
			self._tileQuad[g] = ts:quad(t)
			self._tileLocal[g] = t
			if ts._properties[t] and ts._properties[t].solid then self._solid[g] = true end
		end
		first = first + ts.count
	end
	self.tileCount = first

	self.layers = {}
	self._layerByName = {}
	local cells = self.width * self.height
	for i, src in ipairs(type(data.layers) == "table" and data.layers or {}) do
		if type(src) ~= "table" then error(("%s: layers[%d] should be an object"):format(path, i), 0) end
		local layer = {
			name = type(src.name) == "string" and src.name or ("layer " .. i),
			type = src.type,
			visible = src.visible ~= false,
			properties = type(src.properties) == "table" and src.properties or {},
		}
		if src.type == "tiles" then
			local d = src.data
			if type(d) ~= "table" or #d ~= cells then
				error(("%s: layer %q should have %d tiles (%d × %d), has %s"):format(path, layer.name, cells,
					self.width, self.height, type(d) == "table" and #d or "none"), 0)
			end
			layer.data = d
			layer._chunks = {}
		elseif src.type == "objects" then
			layer.objects = type(src.objects) == "table" and src.objects or {}
			for _, o in ipairs(layer.objects) do
				o.x = tonumber(o.x) or 0
				o.y = tonumber(o.y) or 0
				o.width = tonumber(o.width) or 0
				o.height = tonumber(o.height) or 0
				o.properties = type(o.properties) == "table" and o.properties or {}
				o.layer = layer.name
			end
		else
			error(("%s: layer %q has an unknown type %q (expected \"tiles\" or \"objects\")"):format(path, layer.name,
				tostring(src.type)), 0)
		end
		self.layers[i] = layer
		if not self._layerByName[layer.name] then self._layerByName[layer.name] = layer end
	end
	self._chunksX = ceil(self.width / CHUNK)
	self._chunksY = ceil(self.height / CHUNK)
	-- Tiles may be bigger than the map's cells (drawn from the cell's top
	-- left), so culling looks this much further up and left.
	self._overhangX, self._overhangY = 0, 0
	for _, ts in ipairs(self.tilesets) do
		self._overhangX = max(self._overhangX, ts.tileWidth - self.tileWidth)
		self._overhangY = max(self._overhangY, ts.tileHeight - self.tileHeight)
	end
	return self
end

local function getLayer(self, name, what, level)
	local layer
	if type(name) == "number" then layer = self.layers[name] else layer = self._layerByName[name] end
	if not layer then
		local names = {}
		for _, l in ipairs(self.layers) do names[#names + 1] = ("%q"):format(l.name) end
		error(("%s: %s has no layer %s (it has %s)"):format(what, self.path, tostring(name),
			#names > 0 and table.concat(names, ", ") or "no layers"), level + 1)
	end
	return layer
end

local function tileLayer(self, name, what, level)
	local layer = getLayer(self, name, what, level + 1)
	if layer.type ~= "tiles" then
		error(("%s: layer %q of %s is an object layer, not a tile layer"):format(what, layer.name, self.path), level + 1)
	end
	return layer
end

---A layer by name (or index): a table with name, type, visible, properties,
---and data (tile layers) or objects (object layers). Set `visible` to hide it.
---@param name string|integer
---@return table
function Map:layer(name)
	return getLayer(self, name, "map:layer", 2)
end

-- Build (or rebuild) one chunk's batches.
local function buildChunk(self, layer, cx, cy)
	local chunk = { batches = {}, order = {}, ids = {} }
	local w, tw, th = self.width, self.tileWidth, self.tileHeight
	local data = layer.data
	for ty = cy * CHUNK, min((cy + 1) * CHUNK, self.height) - 1 do
		for tx = cx * CHUNK, min((cx + 1) * CHUNK, w) - 1 do
			local i = ty * w + tx + 1
			local g = data[i]
			local quad = self._tileQuad[g]
			if quad then
				local ts = self._tileSet[g]
				local b = chunk.batches[ts]
				if not b then
					b = { batch = love.graphics.newSpriteBatch(ts.image, 64), free = {} }
					chunk.batches[ts] = b
				end
				chunk.ids[i] = { b, b.batch:add(quad, tx * tw, ty * th) }
			end
		end
	end
	-- Draw in tileset order, so overlapping big tiles come out the same every time.
	for _, ts in ipairs(self.tilesets) do
		if chunk.batches[ts] then chunk.order[#chunk.order + 1] = chunk.batches[ts].batch end
	end
	layer._chunks[cy * self._chunksX + cx] = chunk
	return chunk
end

-- The part of the map (in map pixels) that's visible on the current render
-- target with the current transform and scissor.
local function visibleRect(self)
	local x0, y0, x1, y1 = 0, 0, nil, nil
	local canvas = love.graphics.getCanvas()
	if type(canvas) == "table" then canvas = canvas[1] and (canvas[1].texture or canvas[1][1] or canvas[1]) end
	if type(canvas) == "userdata" and canvas.getDimensions then
		x1, y1 = canvas:getDimensions()
	else
		x1, y1 = love.graphics.getDimensions()
	end
	local sx, sy, sw, sh = love.graphics.getScissor()
	if sx then
		x0, y0 = max(x0, sx), max(y0, sy)
		x1, y1 = min(x1, sx + sw), min(y1, sy + sh)
	end
	local ax, ay = love.graphics.inverseTransformPoint(x0, y0)
	local bx, by = love.graphics.inverseTransformPoint(x1, y0)
	local cx, cy = love.graphics.inverseTransformPoint(x0, y1)
	local dx, dy = love.graphics.inverseTransformPoint(x1, y1)
	return min(ax, bx, cx, dx), min(ay, by, cy, dy), max(ax, bx, cx, dx), max(ay, by, cy, dy)
end

local function drawTileLayer(self, layer, left, top, right, bottom)
	local cw, ch = CHUNK * self.tileWidth, CHUNK * self.tileHeight
	local cx0 = max(0, floor(left / cw))
	local cy0 = max(0, floor(top / ch))
	local cx1 = min(self._chunksX - 1, floor((right + self._overhangX) / cw))
	local cy1 = min(self._chunksY - 1, floor((bottom + self._overhangY) / ch))
	local chunks = layer._chunks
	for cy = cy0, cy1 do
		for cx = cx0, cx1 do
			local chunk = chunks[cy * self._chunksX + cx] or buildChunk(self, layer, cx, cy)
			for _, batch in ipairs(chunk.order) do love.graphics.draw(batch) end
		end
	end
end

---Draw every visible tile layer, in order, in map pixels from (0, 0).
---Use love.graphics.translate (or scale) for a camera.
function Map:draw()
	local left, top, right, bottom = visibleRect(self)
	for _, layer in ipairs(self.layers) do
		if layer.visible and layer.type == "tiles" then drawTileLayer(self, layer, left, top, right, bottom) end
	end
end

---Draw one tile layer (even if it's hidden).
---@param name string|integer layer name or index
function Map:drawLayer(name)
	local layer = tileLayer(self, name, "map:drawLayer", 2)
	drawTileLayer(self, layer, visibleRect(self))
end

---The tile number at a cell (tile coordinates from 0), or -1 if the cell is
---empty or outside the map.
---@param layer string|integer
---@param tx integer
---@param ty integer
---@return integer
function Map:getTile(layer, tx, ty)
	local l = tileLayer(self, layer, "map:getTile", 2)
	tx, ty = floor(tx), floor(ty)
	if tx < 0 or ty < 0 or tx >= self.width or ty >= self.height then return -1 end
	return l.data[ty * self.width + tx + 1]
end

---Change a tile (-1 empties the cell). Updates the layer's SpriteBatch.
---@param layer string|integer
---@param tx integer
---@param ty integer
---@param tile integer
function Map:setTile(layer, tx, ty, tile)
	local l = tileLayer(self, layer, "map:setTile", 2)
	tx, ty = floor(tx), floor(ty)
	if tx < 0 or ty < 0 or tx >= self.width or ty >= self.height then
		error(("map:setTile: (%d, %d) is outside %s (%d × %d tiles)"):format(tx, ty, self.path, self.width, self.height), 2)
	end
	if type(tile) ~= "number" or tile % 1 ~= 0 or tile < -1 or tile >= self.tileCount then
		error(("map:setTile: %s isn't a tile number of %s (0 to %d, or -1 for empty)"):format(tostring(tile), self.path,
			self.tileCount - 1), 2)
	end
	local i = ty * self.width + tx + 1
	if l.data[i] == tile then return end
	l.data[i] = tile
	local cx, cy = floor(tx / CHUNK), floor(ty / CHUNK)
	local chunk = l._chunks[cy * self._chunksX + cx]
	if not chunk then return end -- not built yet: it'll be built from the data
	local quad, ts = self._tileQuad[tile], self._tileSet[tile]
	local px, py = tx * self.tileWidth, ty * self.tileHeight
	local entry = chunk.ids[i]
	if entry and quad and entry[1] == chunk.batches[ts] then
		-- Same tileset: change the sprite in place.
		entry[1].batch:set(entry[2], quad, px, py)
		return
	end
	if entry then
		-- Hide the old sprite and keep its slot for reuse.
		entry[1].batch:set(entry[2], 0, 0, 0, 0, 0)
		entry[1].free[#entry[1].free + 1] = entry[2]
		chunk.ids[i] = nil
	end
	if quad then
		local b = chunk.batches[ts]
		if not b then
			-- A tileset this chunk didn't use yet: rebuild it.
			buildChunk(self, l, cx, cy)
			return
		end
		local id = table.remove(b.free)
		if id then b.batch:set(id, quad, px, py) else id = b.batch:add(quad, px, py) end
		chunk.ids[i] = { b, id }
	end
end

---A tile's properties from its tileset (an empty table if it has none).
---@param tile integer
---@return table
function Map:tileProperties(tile)
	local ts = self._tileSet[tile]
	if not ts then return {} end
	return ts._properties[self._tileLocal[tile]] or {}
end

---The tileset a tile number belongs to, and the tile's number inside it.
---@param tile integer
---@return smitten.Tileset?, integer?
function Map:tilesetOf(tile)
	local ts = self._tileSet[tile]
	if not ts then return nil end
	return ts, self._tileLocal[tile]
end

---Whether any tile layer (hidden ones too) has a solid tile at a cell.
---@param tx integer
---@param ty integer
---@return boolean
function Map:isSolidTile(tx, ty)
	if tx < 0 or ty < 0 or tx >= self.width or ty >= self.height then return false end
	local i = ty * self.width + tx + 1
	local solid = self._solid
	for _, layer in ipairs(self.layers) do
		if layer.data and solid[layer.data[i]] then return true end
	end
	return false
end

---Whether any tile layer has a solid tile at a point in map pixels.
---@param px number
---@param py number
---@return boolean
function Map:isSolid(px, py)
	return self:isSolidTile(floor(px / self.tileWidth), floor(py / self.tileHeight))
end

---The placed objects of every object layer, in order; only those of one type
---if given. Each has id, type, x, y, width, height, properties and layer.
---@param type? string
---@return table[]
function Map:objects(type)
	local list = {}
	for _, layer in ipairs(self.layers) do
		if layer.objects then
			for _, o in ipairs(layer.objects) do
				if type == nil or o.type == type then list[#list + 1] = o end
			end
		end
	end
	return list
end

---Create entities for the map's objects. For each object whose type is a key
---of classes, calls classes[type].new(object), or classes[type](object) if it
---has no `new`. Returns the created entities, in object order.
---@param classes table<string, table|function>
---@return table[]
function Map:spawn(classes)
	if type(classes) ~= "table" then
		error(("map:spawn: expected a table of classes by type name, got %s"):format(type(classes)), 2)
	end
	local created = {}
	for _, o in ipairs(self:objects()) do
		local class = o.type ~= nil and classes[o.type] or nil
		if class ~= nil then
			local entity
			if type(class) == "table" and class.new ~= nil then
				entity = class.new(o)
			elseif type(class) == "function" or (getmetatable(class) and getmetatable(class).__call) then
				entity = class(o)
			else
				error(("map:spawn: classes[%q] has no new function and can't be called"):format(o.type), 2)
			end
			if entity ~= nil then created[#created + 1] = entity end
		end
	end
	return created
end

---Load a map (cached: later calls return the same map). The .map.json
---extension may be left out.
---@param path string e.g. "maps/level1"
---@return smitten.Map
local function map(path)
	local resolved = assets.resolve(path, { ".map.json" }, "map")
	local ok, value = pcall(assets.cached, "map", resolved, loadMap)
	if not ok then error("smitten.map: " .. clean(value), 2) end
	return value
end

return { map = map, tileset = tileset, Map = Map, Tileset = Tileset, CHUNK = CHUNK }
