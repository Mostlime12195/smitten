-- smitten.sprite: sprite sheets and animations made with the sprite editor.
--
-- A sprite is a PNG (sprites/hero.png) plus an optional sprites/hero.sprite.json
-- with the frame size, origin and named animations (docs/reference.md,
-- "Sprites"). A PNG without a .sprite.json is one frame the size of the image.
--
--   local hero = smitten.sprite("sprites/hero")
--   local anim = hero:animation("run")
--   function love.update(dt) anim:update(dt) end
--   function love.draw() anim:draw(x, y) end

local assets = require("smitten.assets").assets

local FORMAT_VERSION = 1
local DEFAULT_FPS = 8

---@class smitten.Sprite
---@field path string the sprite's file (.sprite.json if it has one, else the .png)
---@field imagePath string
---@field image love.Image
---@field width integer frame width in pixels
---@field height integer frame height in pixels
---@field frameCount integer
---@field columns integer frames per row in the sheet
---@field rows integer
---@field originX number
---@field originY number
---@field animations table<string, {frames: integer[], fps: number, loop: boolean}>
local Sprite = {}
Sprite.__index = Sprite

---@class smitten.Animation
---@field sprite smitten.Sprite
---@field name string the current animation
---@field frame integer the current frame number in the sheet (0-based)
---@field finished boolean true once a non-looping animation reached its end
---@field paused boolean
local Animation = {}
Animation.__index = Animation

local function isInteger(n)
	return type(n) == "number" and n == math.floor(n) and n > -math.huge and n < math.huge
end

local function sortedNames(t)
	local names = {}
	for name in pairs(t) do names[#names + 1] = name end
	table.sort(names)
	return names
end

local function quoteList(names)
	local out = {}
	for i, name in ipairs(names) do out[i] = ("%q"):format(name) end
	return table.concat(out, ", ")
end

local function frameRange(count)
	if count == 1 then return "1 frame, numbered 0" end
	return ("%d frames, 0-%d"):format(count, count - 1)
end

-- Checks a sprite file's animations and returns them in a normalized form.
local function readAnimations(file, list, frameCount)
	local out = {}
	if list == nil then return out end
	if type(list) ~= "table" then
		error(("%s: \"animations\" should be an object of named animations"):format(file), 0)
	end
	for name, def in pairs(list) do
		if type(def) ~= "table" then
			error(("%s: animation %q should be an object with \"frames\""):format(file, tostring(name)), 0)
		end
		local frames = {}
		if def.frames == nil then
			for i = 0, frameCount - 1 do frames[#frames + 1] = i end
		elseif type(def.frames) ~= "table" then
			error(("%s: animation %q: \"frames\" should be a list of frame numbers"):format(file, name), 0)
		else
			for i, f in ipairs(def.frames) do
				if not isInteger(f) or f < 0 or f >= frameCount then
					error(("%s: animation %q uses frame %s, but the sheet has %s"):format(
						file, name, tostring(f), frameRange(frameCount)), 0)
				end
				frames[i] = f
			end
		end
		local fps = def.fps
		if fps == nil then fps = DEFAULT_FPS end
		if type(fps) ~= "number" or fps < 0 then
			error(("%s: animation %q: \"fps\" should be a number of frames per second"):format(file, name), 0)
		end
		local loop = def.loop
		if loop == nil then loop = true end
		out[name] = { frames = frames, fps = fps, loop = loop and true or false }
	end
	return out
end

-- Loads a sprite from its resolved paths (metaPath may be nil). Errors carry
-- no position (level 0); smitten.sprite adds the caller's.
local function load(imagePath, metaPath)
	local meta = {}
	if metaPath then
		local text, err = love.filesystem.read(metaPath)
		if not text then error(("%s: can't read it (%s)"):format(metaPath, tostring(err)), 0) end
		local ok, value = pcall(require("smitten.json").json.decode, text)
		if not ok then error(("%s: %s"):format(metaPath, tostring(value)), 0) end
		if type(value) ~= "table" then error(("%s: expected a JSON object"):format(metaPath), 0) end
		meta = value
		if meta.format ~= nil and meta.format ~= "smitten.sprite" then
			error(("%s: not a sprite file (its format is %q)"):format(metaPath, tostring(meta.format)), 0)
		end
		if type(meta.version) == "number" and meta.version > FORMAT_VERSION then
			error(("%s: made by a newer version of Smitten (sprite format %s; this engine reads up to %d)")
				:format(metaPath, tostring(meta.version), FORMAT_VERSION), 0)
		end
		if meta.image ~= nil then
			if type(meta.image) ~= "string" or meta.image == "" then
				error(("%s: \"image\" should be the PNG's file name"):format(metaPath), 0)
			end
			imagePath = assets.join(metaPath, meta.image)
		elseif not imagePath then
			imagePath = metaPath:gsub("%.sprite%.json$", "") .. ".png"
		end
	end
	if not love.filesystem.getInfo(imagePath, "file") then
		if metaPath then
			error(("%s: its image %s doesn't exist"):format(metaPath, imagePath), 0)
		end
		error(("can't find %s"):format(imagePath), 0)
	end

	local ok, image = pcall(love.graphics.newImage, imagePath)
	if not ok then error(("%s: can't load the image (%s)"):format(imagePath, tostring(image)), 0) end
	local filter = meta.filter == "linear" and "linear" or "nearest"
	image:setFilter(filter, filter)
	local iw, ih = image:getDimensions()

	local file = metaPath or imagePath
	local fw = meta.frameWidth == nil and iw or meta.frameWidth
	local fh = meta.frameHeight == nil and ih or meta.frameHeight
	if not isInteger(fw) or fw < 1 then error(("%s: \"frameWidth\" should be a whole number above 0"):format(file), 0) end
	if not isInteger(fh) or fh < 1 then error(("%s: \"frameHeight\" should be a whole number above 0"):format(file), 0) end
	if fw > iw or fh > ih then
		error(("%s: the frame size (%dx%d) is bigger than the image %s (%dx%d)"):format(file, fw, fh, imagePath, iw, ih), 0)
	end
	local columns, rows = math.floor(iw / fw), math.floor(ih / fh)

	local ox, oy = 0, 0
	if meta.origin ~= nil then
		local o = meta.origin
		if type(o) ~= "table" or type(o[1]) ~= "number" or type(o[2]) ~= "number" then
			error(("%s: \"origin\" should be [x, y]"):format(file), 0)
		end
		ox, oy = o[1], o[2]
	end

	local self = setmetatable({
		path = file,
		imagePath = imagePath,
		image = image,
		width = fw,
		height = fh,
		columns = columns,
		rows = rows,
		frameCount = columns * rows,
		originX = ox,
		originY = oy,
		quads = {},
	}, Sprite)
	self.animations = readAnimations(file, meta.animations, self.frameCount)
	return self
end

---Load a sprite (cached: the same path returns the same sprite).
---`path` may name the .png or the .sprite.json, or leave the extension out.
---@param path string e.g. "sprites/hero"
---@return smitten.Sprite
local function sprite(path)
	local ok, result = pcall(function()
		local resolved = assets.resolve(path, { ".sprite.json", ".png" }, "sprite")
		local imagePath, metaPath
		if resolved:sub(-12):lower() == ".sprite.json" then
			metaPath = resolved
		else
			imagePath = resolved
			local sibling = resolved:sub(1, -5) .. ".sprite.json"
			if love.filesystem.getInfo(sibling, "file") then metaPath = sibling end
		end
		return assets.cached("sprite", metaPath or imagePath, function()
			return load(imagePath, metaPath)
		end)
	end)
	if not ok then
		-- assets.resolve's message already has a position; strip it so the
		-- caller's position is used.
		error((tostring(result):gsub("^[^:\n]*:%d+: ", "")), 2)
	end
	return result
end

local function checkFrame(self, frame, level)
	if not isInteger(frame) or frame < 0 or frame >= self.frameCount then
		error(("%s: frame %s is out of range (the sheet has %s)"):format(
			self.path, tostring(frame), frameRange(self.frameCount)), level + 1)
	end
end

---The love Quad for a frame (0-based).
---@param frame integer
---@return love.Quad
function Sprite:quad(frame)
	local q = self.quads[frame]
	if q then return q end
	checkFrame(self, frame, 2)
	local col, row = frame % self.columns, math.floor(frame / self.columns)
	local iw, ih = self.image:getDimensions()
	q = love.graphics.newQuad(col * self.width, row * self.height, self.width, self.height, iw, ih)
	self.quads[frame] = q
	return q
end

---Draw one frame, with the same transform arguments as love.graphics.draw.
---The sprite's origin is drawn at (x, y) unless ox, oy are given.
---@param frame integer 0-based
---@param x? number
---@param y? number
---@param r? number
---@param sx? number
---@param sy? number
---@param ox? number
---@param oy? number
---@param kx? number
---@param ky? number
function Sprite:draw(frame, x, y, r, sx, sy, ox, oy, kx, ky)
	local q = self.quads[frame]
	if not q then
		checkFrame(self, frame, 2)
		q = self:quad(frame)
	end
	love.graphics.draw(self.image, q, x or 0, y or 0, r or 0, sx or 1, sy or sx or 1,
		ox or self.originX, oy or self.originY, kx or 0, ky or 0)
end

---Whether the sprite has an animation with this name.
---@param name string
---@return boolean
function Sprite:has(name)
	return self.animations[name] ~= nil
end

---The sprite's animation names, sorted.
---@return string[]
function Sprite:animationNames()
	return sortedNames(self.animations)
end

local function findAnimation(self, name, level)
	local def = self.animations[name]
	if def then return def end
	if name == nil then
		-- No name: every frame of the sheet, in order.
		self.allFrames = self.allFrames or (function()
			local frames = {}
			for i = 0, self.frameCount - 1 do frames[#frames + 1] = i end
			return { frames = frames, fps = DEFAULT_FPS, loop = true }
		end)()
		return self.allFrames
	end
	local names = sortedNames(self.animations)
	if #names == 0 then
		error(("%s has no animation %q (it has no animations; add them in the sprite editor)"):format(
			self.path, tostring(name)), level + 1)
	end
	error(("%s has no animation %q (it has %s)"):format(self.path, tostring(name), quoteList(names)), level + 1)
end

---A new, independent playback state for an animation. With no name, it plays
---every frame of the sheet at 8 fps.
---@param name? string
---@return smitten.Animation
function Sprite:animation(name)
	local def = findAnimation(self, name, 2)
	local anim = setmetatable({ sprite = self, paused = false }, Animation)
	anim:_start(name, def)
	return anim
end

function Animation:_start(name, def)
	self.name = name
	self.def = def
	self.index = 1
	self.time = 0
	self.finished = false
	self.paused = false
	self.frame = def.frames[1] or 0
end

---Advance the animation.
---@param dt number seconds
function Animation:update(dt)
	if self.paused or self.finished then return end
	local def = self.def
	local n = #def.frames
	if n <= 1 and def.loop then return end
	if def.fps <= 0 then return end
	local duration = 1 / def.fps
	self.time = self.time + dt
	if self.time < duration then return end
	local steps = math.floor(self.time / duration)
	self.time = self.time - steps * duration
	if def.loop then
		self.index = (self.index - 1 + steps) % n + 1
	else
		local index = self.index + steps
		if index > n then
			index = n
			self.time = 0
			self.finished = true
		end
		self.index = index
	end
	self.frame = def.frames[self.index] or 0
end

---Draw the current frame (same arguments as love.graphics.draw; a negative sx
---flips around the sprite's origin).
---@param x? number
---@param y? number
---@param r? number
---@param sx? number
---@param sy? number
---@param ox? number
---@param oy? number
---@param kx? number
---@param ky? number
function Animation:draw(x, y, r, sx, sy, ox, oy, kx, ky)
	self.sprite:draw(self.frame, x, y, r, sx, sy, ox, oy, kx, ky)
end

---Switch to another animation. Does nothing if it's already playing, unless
---restart is true.
---@param name string
---@param restart? boolean
---@return smitten.Animation self
function Animation:play(name, restart)
	if name == self.name and not restart then return self end
	local def = findAnimation(self.sprite, name, 2)
	self:_start(name, def)
	return self
end

---Stop advancing frames (draw still shows the current one).
function Animation:pause()
	self.paused = true
end

---Continue after pause().
function Animation:resume()
	self.paused = false
end

---The current animation's frames per second.
---@return number
function Animation:getFps()
	return self.def.fps
end

---Length of one pass through the current animation, in seconds.
---@return number
function Animation:getDuration()
	if self.def.fps <= 0 then return math.huge end
	return #self.def.frames / self.def.fps
end

return { sprite = sprite, Sprite = Sprite, Animation = Animation }
