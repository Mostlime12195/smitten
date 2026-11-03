-- smitten.assets: loads and caches the files a game uses.
--
--   local img = smitten.assets.image("art/hero.png")
--   local font = smitten.assets.font("fonts/Inter.ttf", 24)
--   local level = smitten.assets.load("levels/level1.scene")   -- by extension
--
-- Paths are relative to the project's folder. Everything is cached, so
-- loading the same file twice is free; the editor clears the cache when a
-- file changes while the game runs.

local json = require("love.json")

local assets = {}

local cache = {}   -- kind -> path -> value

---A path in the project's folder: no "./", "res://" or leading "/", and
---"a/../b" collapsed.
function assets.normalize(path)
	path = tostring(path):gsub("\\", "/"):gsub("^res://", ""):gsub("^%./", ""):gsub("^/+", "")
	local out = {}
	for part in path:gmatch("[^/]+") do
		if part == ".." then
			out[#out] = nil
		elseif part ~= "." then
			out[#out + 1] = part
		end
	end
	return table.concat(out, "/")
end

---A path relative to a folder ("levels" + "../art/a.png" = "art/a.png").
function assets.join(base, rel)
	if rel:sub(1, 1) == "/" or base == nil or base == "" then return assets.normalize(rel) end
	return assets.normalize(base .. "/" .. rel)
end

local function exists(path)
	return love.filesystem.getInfo(path, "file") ~= nil
end

local function missing(path, what, level)
	-- Suggest files with a similar name.
	local util = require("love.engine.util")
	local dir = path:match("^(.*)/[^/]*$") or ""
	local names = {}
	for _, f in ipairs(love.filesystem.getDirectoryItems(dir)) do
		names[#names + 1] = dir == "" and f or (dir .. "/" .. f)
	end
	error(("can't find the %s %q%s"):format(what, path, util.didYouMean(path, names)), level + 1)
end

---Finds a file, trying each extension when the path has none of them.
function assets.resolve(path, extensions, what)
	path = assets.normalize(path)
	if exists(path) then return path end
	for _, ext in ipairs(extensions or {}) do
		if exists(path .. ext) then return path .. ext end
	end
	missing(path, what or "file", 2)
end

---Returns the cached value for (kind, path), making it with fn(path) once.
function assets.cached(kind, path, fn)
	local c = cache[kind]
	if not c then
		c = {}
		cache[kind] = c
	end
	local v = c[path]
	if v == nil then
		v = fn(path)
		c[path] = v
	end
	return v
end

---Reads and decodes a JSON file.
function assets.readJSON(path)
	local text, err = love.filesystem.read(path)
	if not text then error(("can't read %s: %s"):format(path, tostring(err)), 0) end
	local ok, value = pcall(json.decode, text)
	if not ok then error(("%s isn't valid JSON: %s"):format(path, tostring(value)), 0) end
	return value
end

---Forgets cached files (all of them, or the ones of a path) so they load
---again. Returns true if anything was cached.
function assets.clear(path)
	local any = false
	if path == nil then
		any = next(cache) ~= nil
		cache = {}
	else
		path = assets.normalize(path)
		for _, c in pairs(cache) do
			for key in pairs(c) do
				if key == path or key:sub(1, #path + 1) == path .. "#" then
					c[key] = nil
					any = true
				end
			end
		end
	end
	if any then require("love.scene.node").clearScripts() end
	return any
end

---------------------------------------------------------------------------
-- Images, sprite sheets, tilesets

-- "smooth" or "pixel", from Project settings > Display (love.display).
assets.filter = "smooth"

function assets.image(path)
	path = assets.normalize(path)
	return assets.cached("image", path, function(p)
		if not exists(p) then missing(p, "image", 4) end
		local img = love.graphics.newImage(p)
		local f = assets.filter == "pixel" and "nearest" or "linear"
		img:setFilter(f, f)
		return img
	end)
end

local function makeQuads(image, fw, fh, columns, rows, count)
	local quads = {}
	local iw, ih = image:getDimensions()
	for i = 0, count - 1 do
		local cx, cy = i % columns, math.floor(i / columns)
		quads[i + 1] = love.graphics.newQuad(cx * fw, cy * fh, fw, fh, iw, ih)
	end
	return quads
end

---A plain image cut into a grid of frames.
function assets.sheet(path, hframes, vframes)
	path = assets.normalize(path)
	hframes, vframes = math.max(1, hframes or 1), math.max(1, vframes or 1)
	return assets.cached("sheet", path .. "#" .. hframes .. "x" .. vframes, function()
		local image = assets.image(path)
		local iw, ih = image:getDimensions()
		local fw, fh = math.floor(iw / hframes), math.floor(ih / vframes)
		return {
			image = image, frameWidth = fw, frameHeight = fh, columns = hframes, rows = vframes,
			frameCount = hframes * vframes, quads = makeQuads(image, fw, fh, hframes, vframes, hframes * vframes),
			originX = fw / 2, originY = fh / 2, hasOrigin = false, animations = {},
		}
	end)
end

---A .sprite file: an image with a frame size, an origin and animations.
function assets.sprite(path)
	path = assets.normalize(path)
	return assets.cached("sprite", path, function(p)
		if not exists(p) then missing(p, "sprite", 4) end
		local data = assets.readJSON(p)
		if data.format ~= nil and data.format ~= "smitten.sprite" then
			error(("%s isn't a sprite file"):format(p), 0)
		end
		local dir = p:match("^(.*)/[^/]*$") or ""
		local image = assets.image(assets.join(dir, data.image or (p:gsub("%.sprite$", ".png"))))
		local iw, ih = image:getDimensions()
		local fw, fh = data.frameWidth or iw, data.frameHeight or ih
		local columns, rows = math.max(1, math.floor(iw / fw)), math.max(1, math.floor(ih / fh))
		local anims, first = {}, nil
		for name, a in pairs(data.animations or {}) do
			anims[name] = { frames = a.frames or { 0 }, fps = a.fps or 8, loop = a.loop ~= false }
			if not first or name == "idle" then first = name end
		end
		local origin = data.origin
		return {
			image = image, frameWidth = fw, frameHeight = fh, columns = columns, rows = rows,
			frameCount = columns * rows, quads = makeQuads(image, fw, fh, columns, rows, columns * rows),
			originX = origin and origin[1] or fw / 2, originY = origin and origin[2] or fh / 2,
			hasOrigin = origin ~= nil, animations = anims, defaultAnimation = first,
		}
	end)
end

---A .tileset file: an image cut into tiles, with per-tile properties.
function assets.tileset(path)
	path = assets.normalize(path)
	return assets.cached("tileset", path, function(p)
		if not exists(p) then missing(p, "tileset", 4) end
		local data = assets.readJSON(p)
		local dir = p:match("^(.*)/[^/]*$") or ""
		local image = assets.image(assets.join(dir, data.image))
		local iw, ih = image:getDimensions()
		local tw, th = data.tileWidth or 16, data.tileHeight or 16
		local columns, rows = math.max(1, math.floor(iw / tw)), math.max(1, math.floor(ih / th))
		local tiles = {}
		for k, v in pairs(data.tiles or {}) do tiles[tonumber(k)] = v end
		return {
			image = image, tileWidth = tw, tileHeight = th, columns = columns, rows = rows,
			count = columns * rows, quads = makeQuads(image, tw, th, columns, rows, columns * rows), tiles = tiles,
		}
	end)
end

---------------------------------------------------------------------------
-- Fonts

---A font at a size: "" for the default font, "pixel" for the built-in pixel
---font, or a .ttf/.otf file. scale renders it that many times bigger for
---crisp text on a scaled display; returns the font and the scale it was made
---at (draw with 1 / scale).
function assets.font(path, size, scale)
	size, scale = size or 16, scale or 1
	if path == "pixel" then
		local pixel = require("love.assets.pixelfont")
		return pixel.getFont(), pixel.lineHeight / size
	end
	local px = math.max(1, math.floor(size * scale + 0.5))
	local key = (path or "") .. "#" .. px
	return assets.cached("font", key, function()
		if path == nil or path == "" then return love.graphics.newFont(px) end
		local p = assets.normalize(path)
		if not exists(p) then missing(p, "font", 5) end
		return love.graphics.newFont(p, px)
	end), px / size
end

---------------------------------------------------------------------------
-- Sound

local STREAM_BYTES = 512 * 1024

---A sound file ready to play: :newSource() makes a Source for each play.
---Big files stream from disk; .sfx and .song files use the synth module.
function assets.audio(path)
	path = assets.normalize(path)
	return assets.cached("audio", path, function(p)
		if not exists(p) then missing(p, "sound", 4) end
		if p:match("%.sfx$") then
			local sound = love.synth.sfx(p)
			return { newSource = function() return love.audio.newSource(sound.soundData) end }
		elseif p:match("%.song$") then
			return { song = love.synth.song(p) }
		end
		local info = love.filesystem.getInfo(p)
		if info and info.size and info.size > STREAM_BYTES then
			return { newSource = function() return love.audio.newSource(p, "stream") end }
		end
		local data = love.sound.newSoundData(p)
		return { newSource = function() return love.audio.newSource(data) end }
	end)
end

---------------------------------------------------------------------------
-- Scenes, scripts, models

function assets.scene(path)
	path = assets.normalize(path)
	return assets.cached("scene", path, function(p)
		if not exists(p) then missing(p, "scene", 5) end
		local data = assets.readJSON(p)
		if data.format ~= "smitten.scene" then error(("%s isn't a scene file"):format(p), 0) end
		if type(data.version) == "number" and data.version > 2 then
			error(("%s was saved by a newer Smitten (scene version %d)"):format(p, data.version), 0)
		end
		if type(data.root) ~= "table" then error(("%s has no root node"):format(p), 0) end
		return data
	end)
end

---Loads a script file (love.scene.script): a script that is the piece, or
---the table an old-style script returns.
function assets.script(path)
	path = assets.normalize(path)
	return assets.cached("script", path, function(p)
		if not exists(p) then missing(p, "script", 5) end
		return require("love.scene.script").load(p)
	end)
end

function assets.model(path)
	path = assets.normalize(path)
	return assets.cached("model", path, function(p)
		if not exists(p) then missing(p, "model", 4) end
		return love.graphics3d.loadModel(p)
	end)
end

local BY_EXTENSION = {
	png = "image", jpg = "image", jpeg = "image", bmp = "image", tga = "image",
	sprite = "sprite", tileset = "tileset", scene = "scene", lua = "script",
	ttf = "font", otf = "font", wav = "audio", ogg = "audio", mp3 = "audio", flac = "audio",
	sfx = "audio", song = "audio", glb = "model", gltf = "model", json = "readJSON",
}

---Loads any file by its extension.
function assets.load(path, ...)
	local ext = tostring(path):match("%.([%w]+)$")
	local kind = ext and BY_EXTENSION[ext:lower()]
	if not kind then error(("don't know how to load %s"):format(tostring(path)), 2) end
	return assets[kind](path, ...)
end

return assets
