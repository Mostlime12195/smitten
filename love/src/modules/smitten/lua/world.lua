-- smitten.object, smitten.spawn/find/all, smitten.start and
-- smitten.scene.go: things placed in scenes, run by the engine
-- (docs/objects-and-scenes.md).
--
--   -- objects/coin.lua
--   local Coin = smitten.object { sprite = "sprites/coin" }
--   function Coin:touch(other) if other.type == "player" then self:destroy() end end
--   return Coin
--
--   -- main.lua
--   function love.load() smitten.start() end
--
-- How it fits together:
--
-- * smitten.object(definition) makes a class (the definition table itself,
--   with Object's methods behind it). Its type is its file's name; classes
--   are loaded the first time a scene places or the game spawns their type.
-- * smitten.scene.go(name) builds a scene for smitten.scene's stack (a
--   "runner": a table of love callbacks) and switches to it. Entering it
--   loads scenes/<name>.scene.json (a fresh copy) and scenes/<name>.lua,
--   creates the placed objects, then calls the script's enter(). Leaving it
--   drops its objects, timers and tweens.
-- * Each frame (runner:update): scene timers and tweens, then every object
--   (behaviors, then its update, then its animation), then touches, then
--   destroyed objects are removed, then the script's update, then the
--   camera. runner:draw draws the background, tile layers, objects sorted
--   by layer and y, and the script's draw(), inside smitten.screen.
-- * Touches use sort and sweep: a list of objects kept sorted by the left
--   edge of their hitbox (insertion sort, which is close to linear because
--   the order barely changes between frames), checked against the following
--   objects until one starts right of the current one's right edge. Every
--   pair seen this frame is stamped with the frame number in both objects'
--   _touching tables; pairs whose stamp is old have ended (untouch).
-- * Per frame, nothing is allocated for objects: no closures, no tables.

local scene = require("smitten.scene").scene
local collideFile = require("smitten.collide")
local sweepX, sweepY, EPSILON = collideFile.sweepX, collideFile.sweepY, collideFile.EPSILON
local util = require("smitten.util")
local cameraFile = require("smitten.camera")
local camera = cameraFile.camera
local timeFile = require("smitten.time")

local floor, sqrt, abs, atan2 = math.floor, math.sqrt, math.abs, math.atan2

local world = {}

-- The running scene.
local W = {
	active = false,   -- a scene from smitten.scene.go is running
	name = nil,       -- its name
	args = nil,       -- the arguments it was entered with: { n = count, ... }
	map = nil,        -- its smitten.Map, or nil
	script = nil,     -- its script table (an empty table if it has none)
	width = 0,        -- its size in pixels (the map's, or the screen's)
	height = 0,
	objectLayer = 1,  -- objects are drawn before this map layer index
	objects = {},     -- live objects in the order they were made
	byType = {},      -- type -> list of objects
	drawOrder = {},   -- objects sorted by layer, then y
	sweep = {},       -- objects sorted by the left edge of their hitbox
	solids = {},      -- objects with solid = true this frame
	solidsFrame = -1,
	frame = 0,
	dt = 0,
	dying = 0,        -- objects destroyed since the last cleanup
}
world.W = W

local busy = false    -- inside the scene's update or draw: scene changes wait for the end
local pending = nil   -- a scene change waiting: { def = ..., args = ... }

-------------------------------------------------------------------------------
-- Object types

---@class smitten.Object
---@field type string the object's type (its file name: "player")
---@field x number position of the sprite's origin
---@field y number
---@field vx number velocity in pixels per second (used by behaviors)
---@field vy number
---@field width number hitbox size
---@field height number
---@field offsetX number hitbox position relative to (x, y)
---@field offsetY number
---@field flipX boolean draw the sprite mirrored (set by behaviors from the direction of movement)
---@field flipY boolean
---@field visible boolean
---@field alpha number 0 (invisible) to 1
---@field scale number
---@field rotation number radians
---@field layer number draw order: higher draws on top
---@field solid boolean other objects' movement is blocked by it
---@field controls boolean behaviors read the default input actions (false: set moveX/moveY and call jump() from code)
---@field scene table the scene's script table
---@field anim smitten.Animation? the sprite's playback state
local Object = {
	vx = 0, vy = 0,
	flipX = false, flipY = false,
	visible = true,
	alpha = 1, scale = 1, rotation = 0,
	layer = 0,
	solid = false,
	controls = true,
	_dead = false,
}

local classes = {}       -- type -> class
local loadingType = nil  -- the type whose file is being loaded by the engine
local knownCache = {}    -- type -> true once checked to exist

local ClassMeta = {
	__index = Object,
	-- Bullet(x, y) is smitten.spawn(Bullet, x, y).
	__call = function(class, x, y, properties) return world.spawn(class, x, y, properties) end,
	__tostring = function(class) return ("object type %q"):format(class.type) end,
}

local function instanceString(o)
	return ("%s at %g, %g"):format(o.type, floor(o.x * 10 + 0.5) / 10, floor(o.y * 10 + 0.5) / 10)
end

local CALLBACKS = { "create", "update", "draw", "touch", "untouch", "destroyed", "fell", "jumped", "landed" }
local IS_CALLBACK = {}
for _, k in ipairs(CALLBACKS) do IS_CALLBACK[k] = true end

-- Fields people mean when they write these.
local FIELD_TYPOS = {
	behavior = "behaviors", behaviour = "behaviors", behaviours = "behaviors", Behaviors = "behaviors",
	sprites = "sprite", Sprite = "sprite",
}

local behaviors -- the built-in behaviors (behaviors.lua), loaded below

local function objectFile(t) return "objects/" .. t .. ".lua" end

-- Every object type the game has: loaded classes and files in objects/.
local function knownTypes()
	local list, seen = {}, {}
	for t in pairs(classes) do
		seen[t] = true
		list[#list + 1] = t
	end
	if love.filesystem.getInfo("objects", "directory") then
		for _, f in ipairs(love.filesystem.getDirectoryItems("objects")) do
			local t = f:match("^(.+)%.lua$")
			if t and not seen[t] then
				seen[t] = true
				list[#list + 1] = t
			end
		end
	end
	table.sort(list)
	return list
end

local function quoteList(list)
	local out = {}
	for i, s in ipairs(list) do out[i] = ("%q"):format(s) end
	return table.concat(out, ", ")
end

-- Types placed in scenes that look like typos, reported once each.
local warnedTypes = {}

-- The message for a type with no object file.
local function unknownTypeMessage(t, context)
	local types = knownTypes()
	local guess = util.didYouMean(t, types)
	local msg = ("%s doesn't exist%s"):format(objectFile(t), context or "")
	if guess then return msg .. ("; did you mean %q?"):format(guess) end
	if #types == 0 then return msg .. " (the game has no objects yet: add them as objects/<name>.lua)" end
	return msg .. (" (objects: %s)"):format(quoteList(types))
end

---Make an object type. Use it as the last line of objects/<name>.lua:
---`return smitten.object { sprite = "sprites/coin" }`. Definition fields
---(all optional): sprite, animation, width, height, offsetX, offsetY,
---behaviors, camera, solid, layer, color, visible, plus defaults for the
---object's own fields. Callbacks: create(), update(dt), draw(),
---touch(other), untouch(other), destroyed(), and for platformers fell(),
---jumped(), landed().
---@param definition table
---@return table class
function world.object(definition)
	if definition == nil then definition = {} end
	if type(definition) ~= "table" then
		error(("smitten.object: expected a table, like smitten.object { sprite = \"sprites/player\" }, got %s"):format(
			type(definition)), 2)
	end
	if getmetatable(definition) == ClassMeta then return definition end
	local class = definition

	-- The type: the file being loaded, else `type`, else objects/<name>.lua.
	local t = loadingType or (type(class.type) == "string" and class.type) or nil
	local file
	if t then
		file = objectFile(t)
	else
		local info = debug.getinfo(2, "S")
		local src = info and info.source or ""
		local name = src:match("^@?objects/(.+)%.lua$")
		if not name then
			error("smitten.object: give it a type, like smitten.object { type = \"bullet\", ... } (objects in objects/<name>.lua are named after their file)", 2)
		end
		t = name
		file = objectFile(t)
	end
	class.type = t
	class._file = file

	for k, v in pairs(FIELD_TYPOS) do
		if rawget(class, k) ~= nil then
			error(("%s: %q isn't a field of objects; did you mean %s?"):format(file, k, v), 2)
		end
	end
	if class.sprite ~= nil and type(class.sprite) ~= "string" then
		error(("%s: sprite should be a path like \"sprites/%s\", got %s"):format(file, t, type(class.sprite)), 2)
	end
	for _, k in ipairs({ "width", "height", "offsetX", "offsetY", "layer" }) do
		if class[k] ~= nil and type(class[k]) ~= "number" then
			error(("%s: %s should be a number, got %s"):format(file, k, type(class[k])), 2)
		end
	end

	-- Behaviors: their update functions, in order, and their defaults.
	local list = class.behaviors
	if list == nil then list = {} elseif type(list) ~= "table" then list = { list } end
	local updates, creates = {}, {}
	for i, b in ipairs(list) do
		local def = b
		if type(b) == "string" then
			def = behaviors[b] or behaviors[behaviors._aliases[b] or ""]
			if not def then
				local names = behaviors._names
				local guess = util.didYouMean(b, names)
				error(("%s: there's no behavior %q%s (behaviors: %s)"):format(file, b,
					guess and ("; did you mean %q?"):format(guess) or "", quoteList(names)), 2)
			end
		elseif type(b) ~= "table" then
			error(("%s: behaviors[%d] should be a behavior name like \"platformer\""):format(file, i), 2)
		end
		for k, v in pairs(def.defaults or {}) do
			if rawget(class, k) == nil then class[k] = v end
		end
		if def.update then updates[#updates + 1] = def.update end
		if def.create then creates[#creates + 1] = def.create end
	end
	class._updates = updates
	class._creates = creates
	class._ready = false
	class.__index = class
	class.__tostring = instanceString
	setmetatable(class, ClassMeta)
	classes[t] = class
	knownCache[t] = true
	return class
end

-- The class for a type, loading objects/<type>.lua the first time; nil if
-- the type has no file.
local function getClass(t)
	local class = classes[t]
	if class then return class end
	local path = objectFile(t)
	if not love.filesystem.getInfo(path, "file") then return nil end
	local previous = loadingType
	loadingType = t
	local ok, result = pcall(require, "objects." .. t)
	loadingType = previous
	if not ok then error(result, 0) end
	if classes[t] == nil then
		if type(result) ~= "table" then
			error(("%s should end with `return smitten.object { ... }` (it returned %s)"):format(path,
				result == true and "nothing" or type(result)), 0)
		end
		-- A plain table works too: it's the definition.
		loadingType = t
		world.object(result)
		loadingType = previous
	end
	return classes[t]
end

-- Check that a type name exists (for find, all, overlaps). Cached.
local function checkType(t, what, level)
	if knownCache[t] then return end
	if type(t) ~= "string" then
		error(("%s: expected an object type like \"coin\", got %s"):format(what, type(t)), level + 1)
	end
	if classes[t] or love.filesystem.getInfo(objectFile(t), "file") then
		knownCache[t] = true
		return
	end
	error(("%s(%q): %s"):format(what, t, unknownTypeMessage(t)), level + 1)
end

-- Load the class's sprite and check its callbacks, the first time one is made.
local function prepare(class)
	if class._ready then return end
	class._ready = true
	local file = class._file
	if class.sprite ~= nil then
		local ok, s = pcall(require("smitten.sprite").sprite, class.sprite)
		if ok then
			class._sprite = s
			local start = class.animation
			if start ~= nil then
				if not s:has(start) then
					local names = s:animationNames()
					error(("%s: the sprite %s has no animation %q (%s)"):format(file, s.path, tostring(start),
						#names > 0 and "it has " .. quoteList(names) or "it has none; add them in the sprite editor"), 0)
				end
			elseif s:has("idle") then
				start = "idle"
			else
				start = s:animationNames()[1]
			end
			class._startAnimation = start
		elseif tostring(s):find("can't find", 1, true) then
			class._placeholder = true
			print(("%s: the sprite %q doesn't exist yet, so it's drawn as a box. Draw it with New > Sprite (save it as %s.png)."):format(
				file, class.sprite, class.sprite:gsub("%.png$", "")))
		else
			error(("%s: %s"):format(file, tostring(s)), 0)
		end
	end
	if class.color ~= nil then
		local ok, err = pcall(util.color, class.color)
		if not ok then error(("%s: color: %s"):format(file, tostring(err):gsub("^[^:\n]*:%d+: ", "")), 0) end
	end
	-- A box color from the palette, the same for every object of the type.
	local palette = util.palette
	local h = 0
	for i = 1, #class.type do h = (h * 31 + class.type:byte(i)) % 1000003 end
	class._boxColor = #palette > 1 and (2 + h % (#palette - 1)) or 1
	-- Misspelled callbacks never run, which is hard to notice: say so.
	for k, v in pairs(class) do
		if type(k) == "string" and type(v) == "function" and not IS_CALLBACK[k] and Object[k] == nil
			and k:sub(1, 1) ~= "_" then
			local guess = util.didYouMean(k, CALLBACKS)
			if guess and (guess:lower() == k:lower() or util.distance(k:lower(), guess) <= 1) then
				print(("%s: %s isn't something Smitten calls; did you mean %s?"):format(file, k, guess))
			end
		end
	end
end

-------------------------------------------------------------------------------
-- Making and removing objects

local function makeObject(class, x, y, properties, placed)
	prepare(class)
	local o = setmetatable({}, class)
	local s = class._sprite
	if properties then
		for k, v in pairs(properties) do o[k] = v end
	end
	if placed then
		-- The scene editor saves the sprite's origin point; a size is saved
		-- only when the hitbox was changed there (0 or missing: the type's).
		x, y = placed.x, placed.y
	end
	o.x, o.y = x, y
	o._dead = false
	local pw = placed and placed.width and placed.width > 0 and placed.width or nil
	local ph = placed and placed.height and placed.height > 0 and placed.height or nil
	local w = rawget(o, "width") or pw or class.width or (s and s.width) or 16
	local h = rawget(o, "height") or ph or class.height or (s and s.height) or 16
	o.width, o.height = w, h
	if o.offsetX == nil then
		-- Centered on the frame, standing on its bottom edge.
		o.offsetX = s and (-s.originX + (s.width - w) / 2) or 0
	end
	if o.offsetY == nil then
		o.offsetY = s and (-s.originY + s.height - h) or 0
	end
	o._startX, o._startY = o.x, o.y
	o._touching = {}
	o._listens = o.touch ~= nil or o.untouch ~= nil
	o._updates = class._updates
	o._onGround = false
	o.scene = W.script
	if s then o.anim = s:animation(class._startAnimation) end
	local creates = class._creates
	for i = 1, #creates do creates[i](o) end

	local list = W.objects
	list[#list + 1] = o
	local t = class.type
	local of = W.byType[t]
	if not of then
		of = {}
		W.byType[t] = of
	end
	of[#of + 1] = o
	W.drawOrder[#W.drawOrder + 1] = o
	W.sweep[#W.sweep + 1] = o
	if class.camera then camera.follow(o) end
	return o
end

local function compact(list)
	local j = 0
	for i = 1, #list do
		local o = list[i]
		if not o._dead then
			j = j + 1
			list[j] = o
		end
	end
	for i = #list, j + 1, -1 do list[i] = nil end
end

-- Remove destroyed objects; the objects they were touching get untouch().
local function removeDead()
	W.dying = 0
	local list = W.objects
	for i = 1, #list do
		local o = list[i]
		if o._dead then
			for other in pairs(o._touching) do
				o._touching[other] = nil
				other._touching[o] = nil
				if not other._dead and other.untouch then other:untouch(o) end
			end
		end
	end
	compact(W.objects)
	compact(W.drawOrder)
	compact(W.sweep)
	for _, of in pairs(W.byType) do compact(of) end
end

---Create an object in the running scene (bullets, effects, ...): its
---create() runs before this returns. x, y: where its sprite's origin goes.
---@param objectType string|table a type ("coin") or a class
---@param x number
---@param y number
---@param properties? table fields to set on it before create()
---@return smitten.Object
function world.spawn(objectType, x, y, properties)
	if not W.active then
		error("smitten.spawn: no scene is running yet (smitten.start() or smitten.scene.go(\"level1\") starts one)", 2)
	end
	local class
	if type(objectType) == "table" and getmetatable(objectType) == ClassMeta then
		class = objectType
	elseif type(objectType) == "string" then
		class = getClass(objectType)
		if not class then error(("smitten.spawn(%q): %s"):format(objectType, unknownTypeMessage(objectType)), 2) end
	else
		error(("smitten.spawn: expected an object type like \"coin\", got %s"):format(type(objectType)), 2)
	end
	if type(x) ~= "number" or type(y) ~= "number" then
		error(("smitten.spawn(%q, x, y): x and y should be numbers"):format(class.type), 2)
	end
	if properties ~= nil and type(properties) ~= "table" then
		error(("smitten.spawn(%q, x, y, properties): properties should be a table like { speed = 50 }"):format(class.type), 2)
	end
	local o = makeObject(class, x, y, properties)
	if o.create then o:create() end
	return o
end

---The first object of a type in the running scene, or nil.
---@param objectType string
---@return smitten.Object?
function world.find(objectType)
	checkType(objectType, "smitten.find", 2)
	local of = W.byType[objectType]
	if of then
		for i = 1, #of do
			if not of[i]._dead then return of[i] end
		end
	end
	return nil
end

---Every object of a type in the running scene (a new list), or every object
---with no type given.
---@param objectType? string
---@return smitten.Object[]
function world.all(objectType)
	local source
	if objectType == nil then
		source = W.objects
	else
		checkType(objectType, "smitten.all", 2)
		source = W.byType[objectType]
	end
	local list = {}
	if source then
		for i = 1, #source do
			local o = source[i]
			if not o._dead then list[#list + 1] = o end
		end
	end
	return list
end

-------------------------------------------------------------------------------
-- Movement with collisions (used by behaviors and Object:move)

local function solidsList()
	if W.solidsFrame ~= W.frame then
		local solids, n = W.solids, 0
		local list = W.objects
		for i = 1, #list do
			local o = list[i]
			if o.solid and not o._dead then
				n = n + 1
				solids[n] = o
			end
		end
		for i = #solids, n + 1, -1 do solids[i] = nil end
		W.solidsFrame = W.frame
	end
	return W.solids
end

-- Move an object's hitbox by (dx, dy), x then y, through the scene's solid
-- tiles and solid objects. Returns hitX, hitY, ground, ceiling.
local function moveObject(o, dx, dy)
	local ox, oy = o.offsetX, o.offsetY
	local w, h = o.width, o.height
	local x, y = o.x + ox, o.y + oy
	local map = W.map
	local solids = solidsList()
	local ns = #solids
	local hitX, hitY, ground, ceiling = false, false, false, false
	if dx ~= 0 then
		local nx
		if map then nx, hitX = sweepX(map, x, y, w, h, dx) else nx = x + dx end
		for i = 1, ns do
			local s = solids[i]
			if s ~= o and s.solid and not s._dead then
				local st = s.y + s.offsetY
				if st < y + h - EPSILON and y + EPSILON < st + s.height then
					local sl = s.x + s.offsetX
					if dx > 0 then
						if sl >= x + w - EPSILON and sl < nx + w then
							nx, hitX = sl - w, true
						end
					else
						local sr = sl + s.width
						if sr <= x + EPSILON and sr > nx then
							nx, hitX = sr, true
						end
					end
				end
			end
		end
		x = nx
	end
	if dy ~= 0 then
		local ny
		if map then ny, hitY = sweepY(map, x, y, w, h, dy) else ny = y + dy end
		for i = 1, ns do
			local s = solids[i]
			if s ~= o and s.solid and not s._dead then
				local sl = s.x + s.offsetX
				if sl < x + w - EPSILON and x + EPSILON < sl + s.width then
					local st = s.y + s.offsetY
					if dy > 0 then
						if st >= y + h - EPSILON and st < ny + h then
							ny, hitY = st - h, true
						end
					else
						local sb = st + s.height
						if sb <= y + EPSILON and sb > ny then
							ny, hitY = sb, true
						end
					end
				end
			end
		end
		y = ny
		if hitY then
			if dy > 0 then ground = true else ceiling = true end
		end
	end
	o.x, o.y = x - ox, y - oy
	return hitX, hitY, ground, ceiling
end
world.moveObject = moveObject

behaviors = require("smitten.behaviors")({ W = W, move = moveObject })

-------------------------------------------------------------------------------
-- Object methods

---Remove it from the scene at the end of this frame. Its destroyed() runs now.
function Object:destroy()
	if self._dead then return end
	self._dead = true
	W.dying = W.dying + 1
	if self.destroyed then self:destroyed() end
end

---Switch its sprite's animation (no restart if it's already playing it).
---@param name string
---@param restart? boolean start again from the first frame even if it's playing
function Object:play(name, restart)
	local a = self.anim
	if not a then
		if getmetatable(self)._placeholder then return end -- its sprite isn't drawn yet
		error(("%s:play(%q): it has no sprite (set sprite = \"sprites/...\" in %s)"):format(self.type, tostring(name),
			getmetatable(self)._file or "its definition"), 2)
	end
	if not a.sprite:has(name) then
		local names = a.sprite:animationNames()
		error(("%s:play(%q): the sprite %s has no animation %q (%s)"):format(self.type, tostring(name), a.sprite.path,
			tostring(name), #names > 0 and "it has " .. quoteList(names) or "it has none; add them in the sprite editor"), 2)
	end
	a:play(name, restart)
end

---Draw its sprite (current animation frame, flipX/flipY, scale, rotation).
---Objects whose sprite file doesn't exist yet, and objects with `color` and
---no sprite, draw a box the size of their hitbox.
function Object:drawSprite()
	local a = self.anim
	if a then
		local s = self.scale
		a.sprite:draw(a.frame, floor(self.x + 0.5), floor(self.y + 0.5), self.rotation,
			self.flipX and -s or s, self.flipY and -s or s)
		return
	end
	local class = getmetatable(self)
	local c = self.color
	if c == nil and not class._placeholder then return end
	local _, _, _, alpha = love.graphics.getColor()
	local r, g, b, ca = util.color(c or class._boxColor)
	love.graphics.setColor(r, g, b, ca * alpha)
	love.graphics.rectangle("fill", floor(self.x + self.offsetX + 0.5), floor(self.y + self.offsetY + 0.5),
		self.width, self.height)
end

Object.draw = Object.drawSprite

---The hitbox: x, y, width, height.
---@return number x, number y, number width, number height
function Object:box()
	return self.x + self.offsetX, self.y + self.offsetY, self.width, self.height
end

local function overlapping(a, b)
	local ax, ay = a.x + a.offsetX, a.y + a.offsetY
	local bx, by = b.x + b.offsetX, b.y + b.offsetY
	return ax < bx + b.width and bx < ax + a.width and ay < by + b.height and by < ay + a.height
end

---The first object of a type (or that object) whose hitbox overlaps this
---one's, or nil.
---@param what string|smitten.Object
---@return smitten.Object?
function Object:overlaps(what)
	if type(what) == "string" then
		local of = W.byType[what]
		if not of then
			checkType(what, self.type .. ":overlaps", 2)
			return nil
		end
		for i = 1, #of do
			local o = of[i]
			if o ~= self and not o._dead and overlapping(self, o) then return o end
		end
		return nil
	elseif type(what) == "table" and what.offsetX ~= nil then
		if what ~= self and not what._dead and overlapping(self, what) then return what end
		return nil
	end
	error(("%s:overlaps: expected an object type like \"coin\" or an object, got %s"):format(self.type, type(what)), 2)
end

---True if it stood on something solid after its last move (platformer).
---@return boolean
function Object:isOnGround()
	return self._onGround == true
end

local function center(o)
	if o.offsetX ~= nil then
		return o.x + o.offsetX + o.width / 2, o.y + o.offsetY + o.height / 2
	end
	return o.x, o.y
end

local function pointOf(what, y, name, level)
	if type(what) == "table" and type(what.x) == "number" then return center(what) end
	if type(what) == "number" and type(y) == "number" then return what, y end
	error(("%s: expected an object, or x and y"):format(name), level + 1)
end

---Distance in pixels to another object (between hitbox centers), or to a
---point x, y.
---@param other smitten.Object|number
---@param y? number
---@return number
function Object:distanceTo(other, y)
	local ax, ay = center(self)
	local bx, by = pointOf(other, y, self.type .. ":distanceTo", 2)
	return sqrt((bx - ax) ^ 2 + (by - ay) ^ 2)
end

---Angle in radians towards another object (or a point x, y): 0 is right,
---math.pi / 2 is down.
---@param other smitten.Object|number
---@param y? number
---@return number
function Object:angleTo(other, y)
	local ax, ay = center(self)
	local bx, by = pointOf(other, y, self.type .. ":angleTo", 2)
	return atan2(by - ay, bx - ax)
end

---Move towards a point at `speed` pixels per second (no collisions).
---Returns true once it's there. dt defaults to this frame's.
---@param x number
---@param y number
---@param speed number
---@param dt? number
---@return boolean
function Object:moveTo(x, y, speed, dt)
	dt = dt or W.dt
	local dx, dy = x - self.x, y - self.y
	local d = sqrt(dx * dx + dy * dy)
	local step = speed * dt
	if d <= step or d == 0 then
		self.x, self.y = x, y
		return true
	end
	self.x, self.y = self.x + dx / d * step, self.y + dy / d * step
	return false
end

---Move by dx, dy pixels, stopping at solid tiles and solid objects. Returns
---hitX, hitY (true if blocked on that axis).
---@param dx number
---@param dy number
---@return boolean hitX, boolean hitY
function Object:move(dx, dy)
	local hitX, hitY, ground = moveObject(self, dx or 0, dy or 0)
	if dy and dy ~= 0 then self._onGround = ground end
	return hitX, hitY
end

---Put it back where it started, standing still.
function Object:respawn()
	self.x, self.y = self._startX, self._startY
	self.vx, self.vy = 0, 0
	self._coyote, self._buffer = 0, 0
end

---Ask a platformer object to jump (for objects with controls = false); it
---jumps if it can within the next moments, like a buffered button press.
function Object:jump()
	self._wantJump = true
end

---The properties of a tile under its hitbox (on any tile layer) that has
---this property set, or is named this ("damage", "spikes"); nil if none.
---@param property string
---@return table?
function Object:touchingTile(property)
	local map = W.map
	if not map then return nil end
	if type(property) ~= "string" then
		error(("%s:touchingTile: expected a tile property name like \"damage\""):format(self.type), 2)
	end
	local tw, th = map.tileWidth, map.tileHeight
	local x, y = self.x + self.offsetX, self.y + self.offsetY
	local c0, c1 = floor((x + EPSILON) / tw), floor((x + self.width - EPSILON) / tw)
	local r0, r1 = floor((y + EPSILON) / th), floor((y + self.height - EPSILON) / th)
	if c0 < 0 then c0 = 0 end
	if r0 < 0 then r0 = 0 end
	if c1 > map.width - 1 then c1 = map.width - 1 end
	if r1 > map.height - 1 then r1 = map.height - 1 end
	local layers, w = map.layers, map.width
	for li = 1, #layers do
		local data = layers[li].data
		if data then
			for r = r0, r1 do
				for c = c0, c1 do
					local tile = data[r * w + c + 1]
					if tile >= 0 then
						local p = map:tileProperties(tile)
						if p[property] or p.name == property then return p end
					end
				end
			end
		end
	end
	return nil
end

-------------------------------------------------------------------------------
-- The frame

local MAX_DT = 1 / 15 -- longer frames (a hidden tab) are slowed down, so nothing tunnels or jumps

local function touches()
	local list = W.sweep
	local n = #list
	for i = 1, n do
		local o = list[i]
		local l = o.x + o.offsetX
		local t = o.y + o.offsetY
		o._l, o._t, o._r, o._b = l, t, l + o.width, t + o.height
	end
	-- Insertion sort by left edge.
	for i = 2, n do
		local o = list[i]
		local l = o._l
		local j = i - 1
		while j >= 1 and list[j]._l > l do
			list[j + 1] = list[j]
			j = j - 1
		end
		list[j + 1] = o
	end
	local frame = W.frame
	for i = 1, n do
		local a = list[i]
		local ar = a._r
		for j = i + 1, n do
			local b = list[j]
			if b._l > ar then break end
			if a._listens or b._listens then
				-- Solid objects touch when their edges meet (standing on them counts).
				local hit
				if a.solid or b.solid then
					hit = b._l <= ar and a._l <= b._r and a._t <= b._b and b._t <= a._b
				else
					hit = b._l < ar and a._l < b._r and a._t < b._b and b._t < a._b
				end
				if hit and not a._dead and not b._dead then
					local ta = a._touching
					local new = ta[b] == nil
					ta[b] = frame
					b._touching[a] = frame
					if new then
						if a.touch then a:touch(b) end
						if b.touch then b:touch(a) end
					end
				end
			end
		end
	end
	-- Pairs not seen this frame have ended.
	for i = 1, n do
		local o = list[i]
		local touching = o._touching
		if next(touching) ~= nil then
			for other, stamp in pairs(touching) do
				if stamp ~= frame and not other._dead then
					touching[other] = nil
					if not o._dead and o.untouch then o:untouch(other) end
				end
			end
		end
	end
end

local function sortForDrawing()
	local list = W.drawOrder
	for i = 2, #list do
		local o = list[i]
		local layer, y = o.layer, o.y
		local j = i - 1
		while j >= 1 do
			local p = list[j]
			local pl = p.layer
			if pl < layer or (pl == layer and p.y <= y) then break end
			list[j + 1] = p
			j = j - 1
		end
		list[j + 1] = o
	end
end

local doSwitch -- below

local function finishBusy()
	busy = false
	if pending then
		local p = pending
		pending = nil
		doSwitch(p.def, p.args)
	end
end

local function update(dt)
	if dt > MAX_DT then dt = MAX_DT end
	busy = true
	W.frame = W.frame + 1
	W.dt = dt
	timeFile.updateScene(dt)
	local list = W.objects
	for i = 1, #list do
		local o = list[i]
		if not o._dead then
			local ups = o._updates
			for j = 1, #ups do ups[j](o, dt) end
			local u = o.update
			if u then u(o, dt) end
			local a = o.anim
			if a then a:update(dt) end
		end
	end
	touches()
	if W.dying > 0 then removeDead() end
	local script = W.script
	if script.update then script:update(dt) end
	cameraFile.update(dt, W.width, W.height)
	finishBusy()
end

local function drawTileLayers(from, to)
	local map = W.map
	for i = from, to do
		local l = map.layers[i]
		if l.visible and l.type == "tiles" then map:drawLayer(i) end
	end
end

local function draw()
	busy = true
	local screen = require("smitten.screen").screen
	screen.begin()
	local script = W.script
	local bg = script.background
	if bg ~= nil then
		love.graphics.clear(util.color(bg))
	elseif W.map and W.map.backgroundColor then
		love.graphics.clear(W.map.backgroundColor)
	else
		love.graphics.clear(util.color(1))
	end
	love.graphics.push()
	love.graphics.translate(cameraFile.translation())
	local map = W.map
	if map then drawTileLayers(1, W.objectLayer - 1) end
	sortForDrawing()
	local list = W.drawOrder
	for i = 1, #list do
		local o = list[i]
		if o.visible and not o._dead then
			love.graphics.setColor(1, 1, 1, o.alpha)
			o:draw()
		end
	end
	if map then drawTileLayers(W.objectLayer + 1, #map.layers) end
	love.graphics.setColor(1, 1, 1, 1)
	if script.drawWorld then script:drawWorld() end
	love.graphics.pop()
	love.graphics.setColor(1, 1, 1, 1)
	if script.draw then script:draw() end
	screen.finish()
	finishBusy()
end

-------------------------------------------------------------------------------
-- Scenes

-- Love callbacks a scene script may define, besides update and draw (which
-- the runner handles itself) and enter/leave.
local FORWARD = {}
for _, name in ipairs({ "keypressed", "keyreleased", "textinput", "textedited", "mousemoved", "mousepressed",
	"mousereleased", "wheelmoved", "touchpressed", "touchreleased", "touchmoved", "joystickpressed",
	"joystickreleased", "joystickaxis", "joystickhat", "gamepadpressed", "gamepadreleased", "gamepadaxis",
	"joystickadded", "joystickremoved", "focus", "mousefocus", "visible", "resize", "filedropped",
	"directorydropped", "quit", "pause", "resume" }) do FORWARD[name] = true end

-- "scenes/level1.scene.json", "level1.lua", "./scenes/level1" -> "level1"
local function sceneName(name)
	name = name:gsub("\\", "/"):gsub("^%./", ""):gsub("^scenes/", "")
	name = name:gsub("%.scene%.json$", ""):gsub("%.lua$", "")
	return name
end

local function sceneNames()
	local list, seen = {}, {}
	if love.filesystem.getInfo("scenes", "directory") then
		for _, f in ipairs(love.filesystem.getDirectoryItems("scenes")) do
			local n = f:match("^(.+)%.scene%.json$") or f:match("^(.+)%.lua$")
			if n and not seen[n] then
				seen[n] = true
				list[#list + 1] = n
			end
		end
	end
	table.sort(list)
	return list
end

-- Find a scene's files and load its script. Errors (level) name what's wrong.
local function loadScene(name, what, level)
	if type(name) ~= "string" or name == "" then
		error(("%s: expected a scene name like \"level1\", got %s"):format(what, type(name)), level + 1)
	end
	local n = sceneName(name)
	local mapPath, scriptPath = "scenes/" .. n .. ".scene.json", "scenes/" .. n .. ".lua"
	local hasMap = love.filesystem.getInfo(mapPath, "file") ~= nil
	local hasScript = love.filesystem.getInfo(scriptPath, "file") ~= nil
	if not hasMap and not hasScript then
		local names = sceneNames()
		local guess = util.didYouMean(n, names)
		local msg = ("%s: there's no scene %q (no %s or %s)"):format(what, n, mapPath, scriptPath)
		if guess then
			msg = msg .. ("; did you mean %q?"):format(guess)
		elseif #names > 0 then
			msg = msg .. (". Scenes: %s"):format(quoteList(names))
		else
			msg = msg .. ". The game has no scenes yet: make one with New > Scene."
		end
		error(msg, level + 1)
	end
	local script
	if hasScript then
		local chunk, err = love.filesystem.load(scriptPath)
		if not chunk then error(err, 0) end
		script = chunk()
		if type(script) ~= "table" then
			error(("%s should return a table: start it with `local Scene = {}` and end it with `return Scene` (it returned %s)")
				:format(scriptPath, script == nil and "nothing" or type(script)), 0)
		end
	end
	return { name = n, mapPath = hasMap and mapPath or nil, script = script or {} }
end

local function leaveScene()
	local script = W.script
	if script and script.leave then script:leave() end
	for _, o in ipairs(W.objects) do o._dead = true end
	W.objects, W.byType, W.drawOrder, W.sweep, W.solids = {}, {}, {}, {}, {}
	W.solidsFrame, W.dying = -1, 0
	timeFile.setScene(nil)
	cameraFile.reset()
	W.active = false
	W.map = nil
	scene.map = nil
end

local function enterScene(runner, def, ...)
	W.name = def.name
	W.args = { n = select("#", ...), ... }
	W.script = def.script
	W.objects, W.byType, W.drawOrder, W.sweep, W.solids = {}, {}, {}, {}, {}
	W.solidsFrame, W.dying = -1, 0
	timeFile.setScene(runner)
	cameraFile.reset()
	local screen = require("smitten.screen").screen
	if not screen.canvas then screen.setup() end
	local map
	if def.mapPath then map = require("smitten.map").loadFresh(def.mapPath) end
	W.map = map
	W.width = map and map.pixelWidth or screen.width
	W.height = map and map.pixelHeight or screen.height
	W.objectLayer = 1
	W.active = true
	scene.name, scene.map = def.name, map
	if map then
		local first
		for i, l in ipairs(map.layers) do
			if l.type == "objects" and not first then first = i end
		end
		W.objectLayer = first or (#map.layers + 1)
		-- Make every placed object, then call their create()s, so create()
		-- can find the others.
		local made = {}
		for _, l in ipairs(map.layers) do
			if l.objects then
				for _, placed in ipairs(l.objects) do
					local t = placed.type
					if type(t) == "string" and t ~= "" then
						local class = getClass(t)
						if class then
							local props = {}
							for k, v in pairs(placed.properties) do props[k] = v end
							made[#made + 1] = makeObject(class, 0, 0, props, placed)
						else
							-- Plain data (level:objects()). A name close to an object type is
							-- probably a typo, so say so once, without stopping the game:
							-- "goal2" next to "goal" may well be meant as data.
							local guess = util.didYouMean(t, knownTypes())
							if guess and not warnedTypes[t] then
								warnedTypes[t] = true
								print(("Note: %s doesn't exist, so the %q in %s (at %g, %g) is only data. Did you mean %q?"):format(
									objectFile(t), t, def.mapPath, placed.x, placed.y, guess))
							end
						end
					end
				end
			end
		end
		for i = 1, #made do
			local o = made[i]
			if not o._dead and o.create then o:create() end
		end
	end
	local script = W.script
	if script.enter then script:enter(...) end
	cameraFile.update(0, W.width, W.height)
end

local function makeRunner(def)
	local runner = {}
	runner.enter = function(self, ...) enterScene(self, def, ...) end
	runner.leave = function() leaveScene() end
	runner.update = function(_, dt) update(dt) end
	runner.draw = function() draw() end
	local script = def.script
	for name in pairs(FORWARD) do
		local fn = script[name]
		if type(fn) == "function" then
			runner[name] = function(_, ...) return fn(script, ...) end
		end
	end
	return runner
end

function doSwitch(def, args)
	-- Scenes pushed on top (a pause menu calling go) go away too.
	while scene.depth() > 1 do scene.pop() end
	scene.switch(makeRunner(def), unpack(args, 1, args.n))
end

local function go(name, args, what, level)
	local def = loadScene(name, what, level + 1)
	if busy then
		-- Inside the scene's update or draw: switch once it's finished.
		pending = { def = def, args = args }
		return
	end
	doSwitch(def, args)
end

---Go to a scene: scenes/<name>.scene.json and/or scenes/<name>.lua. The
---current scene's objects, timers and tweens end; the new one's objects are
---created, then its script's enter(...) runs. Called during a frame, the
---switch happens at the end of that frame.
---@param name string e.g. "level1"
---@param ... any passed to the scene script's enter
function world.go(name, ...)
	go(name, { n = select("#", ...), ... }, "smitten.scene.go", 3)
end

---Start the current scene again from its file, with the same arguments.
function world.restart()
	if not W.name then error("smitten.scene.restart: no scene is running (start one with smitten.scene.go)", 3) end
	go(W.name, W.args, "smitten.scene.restart", 3)
end

---Start the game: sets up smitten.screen and goes to the first scene: the
---one the editor's Play scene asked for (.smitten/start), else smitten.json's
---"start", else the only scene there is.
---@param name? string a scene to start with instead
function world.start(name)
	if name == nil and love.filesystem.getInfo(".smitten/start", "file") then
		local text = love.filesystem.read(".smitten/start") or ""
		text = text:match("^%s*(.-)%s*$")
		if text ~= "" then name = text end
	end
	if name == nil then name = util.project().start end
	if name == nil then
		local names = sceneNames()
		if #names == 1 then
			name = names[1]
		elseif #names == 0 then
			error("smitten.start: the game has no scenes yet. Make one with New > Scene (it goes in scenes/), then add \"start\": \"<its name>\" to smitten.json", 2)
		else
			error(("smitten.start: which scene should the game start with? Add \"start\": %q to smitten.json (scenes: %s)")
				:format(names[1], quoteList(names)), 2)
		end
	end
	local screen = require("smitten.screen").screen
	local ok, err = pcall(screen.setup)
	if not ok then error(err, 2) end
	love.graphics.setDefaultFilter("nearest", "nearest")
	love.graphics.setFont(require("smitten.text").getFont())
	go(name, { n = 0 }, "smitten.start", 2)
end

return {
	object = world.object, spawn = world.spawn, find = world.find, all = world.all, start = world.start,
	-- Internal:
	go = world.go, restart = world.restart, Object = Object, W = W, moveObject = moveObject, classes = classes,
}
