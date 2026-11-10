-- Scripts (DESIGN.md, section 5): a script is the piece's own code.
--
--   speed = 220                     -- a variable: shown in the inspector
--
--   function update(dt)
--     vx = axis("left", "right") * speed
--     move()
--   end
--
-- No table to make and return, and no self: names in a script are the
-- piece's. Each piece runs its script's file once, in an environment of its
-- own, so top-level assignments are its variables and top-level functions
-- its own functions. Reading a name looks, in order, at:
--
--   1. the script's own functions (update, hurt, ...)
--   2. the piece: properties, variables and methods (methods come bound, so
--      move() is self:move())
--   3. children, for capitalized names: Look.color = ..., Camera.zoom = 2
--   4. the short API below (input, scenes, sound, time, math, drawing)
--   5. the globals (math, string, print, smitten, ...; not love, the
--      engine's internal name for smitten)
--
-- Assigning a name that isn't a local sets it on the piece. A few calls are
-- decided the other way: spawn() adds to the scene (self:spawn() adds inside
-- this piece), and type() is Lua's (the piece's type is self.type). find() is
-- the piece's (relative), root() is the scene's root.
--
-- ready() and every event function (hit, entered, pressed, tick, a custom
-- emit("name")...) run as tasks, so they can wait(seconds); task(fn) runs
-- anything as one. update(), physicsUpdate() and draw() run straight through.
--
-- The file runs once per piece with the same compiled chunk, so functions
-- share their code (and the JIT's work) and each piece only gets its own
-- closures. Scripts in the old style (a table they return) still work: see
-- node.lua.

local node = require("love.scene.node")

local M = {}

local Node = node.Node
local unpack, select, type, rawget, rawset = unpack, select, type, rawget, rawset
local cocreate, coresume, coyield, corunning, costatus = coroutine.create, coroutine.resume, coroutine.yield, coroutine.running, coroutine.status

local function pack(...) return { n = select("#", ...), ... } end

---------------------------------------------------------------------------
-- Tasks: functions that can wait(). Finished coroutines go back to a pool,
-- so an event that runs every frame doesn't make a new one each time.

local DONE, WAIT, SUSPEND = {}, {}, {}
local idle = {}
local owners = setmetatable({}, { __mode = "k" }) -- coroutine -> piece

local function loop(...)
	local args = pack(...)
	while true do
		local results = pack(args[1](unpack(args, 2, args.n)))
		idle[#idle + 1] = corunning()
		args = pack(coyield(DONE, unpack(results, 1, results.n)))
	end
end

local resumeWith

local function step(co, ok, tag, ...)
	if not ok then
		owners[co] = nil
		-- The error in plain words, with the task's own frames (the handler
		-- only sees the engine's, which resumed it).
		local errors = require("love.engine.errors")
		local text = errors.explain(tag, co)
		local frames = errors.frames(debug.traceback(co))
		if #frames > 0 then text = text .. "\nstack traceback:\n\t" .. table.concat(frames, "\n\t") end
		error(text, 0)
	end
	if tag == WAIT then
		local seconds = ...
		local owner = owners[co]
		require("love.tween").after(seconds, function() resumeWith(co) end, owner)
		return
	end
	-- Suspended until whoever it waits for calls M.resumeTask.
	if tag == SUSPEND then return end
	if tag == DONE then owners[co] = nil end
	return ...
end

resumeWith = function(co, ...)
	return step(co, coresume(co, ...))
end

---Runs fn(...) as a task owned by a piece: it can wait(). Returns fn's
---results if it finishes without waiting.
local function runTask(owner, fn, ...)
	local co = idle[#idle]
	if co then idle[#idle] = nil else co = cocreate(loop) end
	owners[co] = owner or true
	return resumeWith(co, fn, ...)
end
M.runTask = runTask

---The running task, to resume later with M.resumeTask; nil outside one.
function M.currentTask()
	local co = corunning()
	if co and owners[co] then return co end
	return nil
end

---Pauses the running task until M.resumeTask(task, ...), and returns what
---that passes (smitten.boards waits for the games site this way).
function M.suspendTask()
	return coyield(SUSPEND)
end

---Carries on a task paused by M.suspendTask, unless its piece is gone.
function M.resumeTask(co, ...)
	local owner = owners[co]
	if not owner or costatus(co) ~= "suspended" then return end
	if owner ~= true and owner._dead then
		owners[co] = nil
		return
	end
	return resumeWith(co, ...)
end

---Pauses the running task for some seconds.
local function wait(seconds)
	local co = corunning()
	if not co or not owners[co] then
		error("wait() can pause ready(), events and tasks, not update() or draw(): "
			.. "use task(function() wait(1) ... end) or after(1, function() ... end)", 2)
	end
	coyield(WAIT, seconds or 0)
end

---------------------------------------------------------------------------
-- The short API: global in scripts. Everything in smitten.* stays there too.
-- web/editor/core/script-api.js lists it for completions and the docs.

local api = {}
M.api = api

local function input() return require("love.input") end
local function scene() return require("love.scene") end
local function sound() return require("love.scene.audio") end

-- Input. pressed(), down() and released() take an action ("jump") or an
-- input ("space", "mouse:1", "pad:a"); pressed() alone is any press.
function api.pressed(action) return input().pressed(action) end
function api.down(action) return input().down(action) end
function api.released(action) return input().released(action) end
function api.axis(negative, positive) return input().axis(negative, positive) end
function api.vector(left, right, up, down) return input().vector(left, right, up, down) end
function api.wheel() return input().wheel() end
function api.typed() return input().typed() end
function api.touches() return input().touches() end
function api.stick(side, player) return input().stick(side, player) end
function api.trigger(side, player) return input().trigger(side, player) end
function api.vibrate(strength, seconds, player) return input().vibrate(strength, seconds, player) end

---Where the mouse is in the scene (x, y).
function api.mouse()
	local m = love.mouse
	return m.worldX, m.worldY
end

---Where the mouse is on the screen, in game pixels (x, y): for UI.
function api.mouseScreen()
	local m = love.mouse
	return m.x, m.y
end

-- Scenes
function api.go(path, ...) return scene().go(path, ...) end
function api.reload() return scene().reload() end
function api.transition(kind, seconds, color) return scene().transition(kind, seconds, color) end
function api.make(what, props, script) return scene().make(what, props, script) end
function api.tagged(tag) return scene().tagged(tag) end
function api.first(tag) return scene().first(tag) end
function api.root() return scene().current end

---The camera in use, or nil.
function api.camera() return require("love.scene.nodes2d").currentCamera() end

---Spawns into the scene (or into parent); self:spawn() spawns inside this piece.
function api.spawn(what, props, parent)
	local s = scene()
	local ok, n = pcall(s.make, what, props)
	if not ok then error(n, 2) end
	parent = parent or s.current
	if not parent then error("spawn() needs a running scene (or a parent to add to)", 2) end
	return parent:add(n)
end

---State for the whole game, kept when the scene changes: game.score += 1.
api.game = {}

-- Pausing and time
function api.pauseGame() scene().paused = true end
function api.resumeGame() scene().paused = false end
function api.isPaused() return scene().paused == true end

---timeScale(0.5): slow motion; timeScale(): how fast time goes now.
function api.timeScale(scale)
	local s = scene()
	if scale ~= nil then
		if type(scale) ~= "number" or scale < 0 then error("timeScale() needs a number, 0 or more", 2) end
		s.timeScale = scale
	end
	return s.timeScale
end

-- Sound: a bare name finds the sound file with that name anywhere in the
-- project ("coin" -> sounds/coin.sfx); a path works too.
local AUDIO = { sfx = 1, wav = 2, ogg = 3, mp3 = 4, flac = 5, song = 6 }
local soundIndex = nil

local function indexSounds(dir, out)
	for _, item in ipairs(love.filesystem.getDirectoryItems(dir)) do
		if item:sub(1, 1) ~= "." then
			local p = dir == "" and item or dir .. "/" .. item
			local info = love.filesystem.getInfo(p)
			if info and info.type == "directory" then
				indexSounds(p, out)
			else
				local base, ext = item:match("^(.*)%.([%w]+)$")
				ext = ext and ext:lower()
				if base and AUDIO[ext] then
					local had = out[base]
					if not had or AUDIO[ext] < AUDIO[had:match("%.([%w]+)$"):lower()] then out[base] = p end
				end
			end
		end
	end
	return out
end

---The file of a sound by name ("coin") or path; errors at level.
local function soundPath(name, level)
	if type(name) ~= "string" or name == "" then error("give a sound's name, like \"coin\", or its file", level + 1) end
	if name:find("[/.]") then return name end
	soundIndex = soundIndex or indexSounds("", {})
	local p = soundIndex[name]
	if not p then
		soundIndex = indexSounds("", {}) -- it may be new
		p = soundIndex[name]
	end
	if not p then
		local names = {}
		for k in pairs(soundIndex) do names[#names + 1] = k end
		error(("there's no sound called %q%s"):format(name, require("love.engine.util").didYouMean(name, names)), level + 1)
	end
	return p
end
M.soundPath = soundPath

---Plays a sound once: sfx("coin"), sfx("hit", 0.5), sfx("hit", { volume = 0.5, pitch = 1.2 }).
function api.sfx(name, volume, pitch)
	return sound().sfx(soundPath(name, 2), volume, pitch)
end

---Plays music on a loop, instead of any music playing: music("theme"),
---music("boss", { volume = 0.6, fade = 1 }). The same music keeps playing.
function api.music(name, options)
	return sound().music(soundPath(name, 2), options)
end

function api.stopMusic(fade) return sound().stopMusic(fade) end
function api.pauseMusic() return sound().pauseMusic() end
function api.resumeMusic() return sound().resumeMusic() end

---masterVolume(0.5) turns every sound down; masterVolume() is the volume now.
function api.masterVolume(volume)
	if volume ~= nil then love.audio.setVolume(math.max(0, volume)) end
	return love.audio.getVolume()
end

-- Saving: values kept between plays, for this game.
function api.save(key, value) return require("love.storage").save(key, value) end
function api.load(key, default) return require("love.storage").load(key, default) end

-- Time
api.wait = wait

---Seconds since the game started.
function api.time() return love.timer.getTime() - M.startTime end
M.startTime = love.timer and love.timer.getTime() or 0

function api.tween(target, seconds, values, easing, done)
	return require("love.tween").to(target, seconds, values, easing, done)
end

-- Math
function api.approach(v, target, step)
	if v < target then return math.min(v + step, target) end
	return math.max(v - step, target)
end
function api.lerp(a, b, t) return a + (b - a) * t end
function api.clamp(v, lo, hi) return v < lo and lo or v > hi and hi or v end
function api.sign(v) return v > 0 and 1 or v < 0 and -1 or 0 end
function api.round(v, step)
	step = step or 1
	return math.floor(v / step + 0.5) * step
end

---rnd(): 0 to 1. rnd(n): 0 to n. rnd(list): one of its items.
function api.rnd(n)
	if type(n) == "table" then return n[love.math.random(1, #n)] end
	return love.math.random() * (n or 1)
end

---One of its arguments, at random: choose("red", "green", "blue").
function api.choose(...)
	return (select(love.math.random(1, select("#", ...)), ...))
end

---The distance between two pieces (or anything with x, y), or two points.
function api.dist(a, b, c, d)
	if type(a) == "table" then a, b, c, d = a.x, a.y, b.x, b.y end
	return math.sqrt((c - a) ^ 2 + (d - b) ^ 2)
end

-- Screen
function api.screenWidth() return require("love.display").width end
function api.screenHeight() return require("love.display").height end

---fullscreen(true) fills the screen (on the web, after the player clicks or
---presses a key); fullscreen() is true while it does.
function api.fullscreen(on)
	if on ~= nil and love.window then love.window.setFullscreen(on == true) end
	return love.window ~= nil and (love.window.getFullscreen()) == true
end

-- Drawing, for draw() (in the piece's own coordinates). The names differ
-- from properties some pieces have (color, text, image).
local function setColor(r, g, b, a)
	if type(r) == "table" then
		love.graphics.setColor(r[1] or 1, r[2] or 1, r[3] or 1, r[4] or 1)
	elseif type(r) == "string" then
		local hex = r:gsub("^#", "")
		local function byte(i) return tonumber(hex:sub(i, i + 1), 16) / 255 end
		love.graphics.setColor(byte(1), byte(3), byte(5), #hex >= 8 and byte(7) or 1)
	else
		love.graphics.setColor(r or 1, g or r or 1, b or r or 1, a or 1)
	end
end
---The color to draw with: pen(1, 0, 0), pen({1, 0, 0, 0.5}), pen("#ff8800").
api.pen = setColor
---How thick lines and outlines are, in pixels.
function api.penSize(width) love.graphics.setLineWidth(width or 1) end

---Fills the whole screen with a color (the pen's, if none is given).
function api.clearScreen(r, g, b, a)
	local gr = love.graphics
	gr.push("all")
	if r ~= nil then setColor(r, g, b, a) end
	gr.origin()
	local canvas = gr.getCanvas()
	if canvas then
		gr.rectangle("fill", 0, 0, canvas:getDimensions())
	else
		gr.rectangle("fill", require("love.display").getWindowRect())
	end
	gr.pop()
end

function api.rect(x, y, w, h, fill) love.graphics.rectangle(fill == false and "line" or "fill", x, y, w, h) end
function api.circle(x, y, r, fill) love.graphics.circle(fill == false and "line" or "fill", x, y, r) end
function api.oval(x, y, rx, ry, fill) love.graphics.ellipse(fill == false and "line" or "fill", x, y, rx, ry) end
function api.line(...) love.graphics.line(...) end
---One pixel (of the game's resolution).
function api.dot(x, y) love.graphics.rectangle("fill", x, y, 1, 1) end

---A polygon through points: poly({x1, y1, x2, y2, x3, y3}, fill).
function api.poly(points, fill)
	if type(points) ~= "table" or #points < 6 then error("poly() needs a list of at least 3 points: {x1, y1, x2, y2, x3, y3}", 2) end
	if fill == false then
		love.graphics.polygon("line", points)
	elseif love.math.isConvex(points) then
		love.graphics.polygon("fill", points)
	else
		for _, tri in ipairs(love.math.triangulate(points)) do love.graphics.polygon("fill", tri) end
	end
end

---Text at x, y: write("Hi", 10, 10), write("Hi", 10, 10, 24) (a size), or
---write("Hi", 160, 10, { size = 24, align = "center", font = "pixel", width = 200 }).
---align lines the text up around x; width wraps it.
function api.write(text, x, y, options)
	text, x, y = tostring(text), x or 0, y or 0
	local o = type(options) == "table" and options or { size = options }
	local font, scale = require("love.assets").font(o.font or "", o.size or 16, require("love.scene.nodes2d").textScale)
	local s = 1 / scale
	local g = love.graphics
	g.setFont(font)
	local align = o.align or "left"
	if o.width then
		local ox = align == "center" and o.width / 2 or align == "right" and o.width or 0
		g.printf(text, x - ox, y, o.width * scale, align, 0, s, s)
	else
		local w = font:getWidth(text) * s
		local ox = align == "center" and w / 2 or align == "right" and w or 0
		g.print(text, x - ox, y, 0, s, s)
	end
end

---An image, or one frame of a sprite sheet: sprite("art/star.png", x, y),
---sprite("art/hero.sprite", x, y, { frame = 2, scale = 2, flipX = true }).
---Options: frame, rotation, scale, scaleX, scaleY, flipX, flipY, centered,
---columns and rows (to cut a plain picture into frames).
function api.sprite(path, x, y, r, sx, sy)
	local assets = require("love.assets")
	x, y = x or 0, y or 0
	if type(r) ~= "table" then
		local img = assets.image(path)
		love.graphics.draw(img, x, y, r or 0, sx or 1, sy or sx or 1)
		return
	end
	local o = r
	local sheet
	if path:match("%.sprite$") then sheet = assets.sprite(path) else sheet = assets.sheet(path, o.columns or 1, o.rows or 1) end
	local quad = sheet.quads[((o.frame or 0) % sheet.frameCount) + 1]
	local fw, fh = sheet.frameWidth, sheet.frameHeight
	local ox, oy = 0, 0
	if o.centered then ox, oy = fw / 2, fh / 2 elseif sheet.hasOrigin then ox, oy = sheet.originX, sheet.originY end
	local scx, scy = o.scaleX or o.scale or 1, o.scaleY or o.scale or 1
	if o.flipX then scx = -scx end
	if o.flipY then scy = -scy end
	love.graphics.draw(sheet.image, quad, x, y, o.rotation or 0, scx, scy, ox, oy)
end

---------------------------------------------------------------------------
-- Physics (docs/physics.md): queries on the scene's world, the same as
-- smitten.physics.*. A Body's own calls (applyImpulse, move, contacts...)
-- are methods, so scripts already have them.

local function physics() return require("love.scene.physics2d") end

---The first body or tiles on the line from (x1, y1) to (x2, y2): {piece, x,
---y, nx, ny, fraction}, or nil. tags (optional) only counts pieces with one.
function api.raycast(x1, y1, x2, y2, tags) return physics().raycast(x1, y1, x2, y2, tags) end
---Every body and tiles on the line, nearest first.
function api.raycastAll(x1, y1, x2, y2, tags) return physics().raycastAll(x1, y1, x2, y2, tags) end
---The bodies and zones at a point.
function api.piecesAt(x, y, tags) return physics().piecesAt(x, y, tags) end
---The bodies and zones touching a circle or rectangle: overlap("circle", x, y, r), overlap("rect", x, y, w, h).
function api.overlap(kind, ...) return physics().overlap(kind, ...) end
---The scene's gravity, x and y, in pixels per second per second.
function api.getGravity() return physics().getGravity() end
function api.setGravity(x, y) return physics().setGravity(x, y) end

-- End of physics.
---------------------------------------------------------------------------

-- Calls that use the piece: given it first, bound to it in each script.
local pieceApi = {}
M.pieceApi = pieceApi

function pieceApi.task(n, fn, ...)
	if type(fn) ~= "function" then error("task() needs a function", 2) end
	return runTask(n, fn, ...)
end

---Calls fn once, after some seconds (unless the piece is gone by then).
function pieceApi.after(n, seconds, fn)
	if type(fn) ~= "function" then error("after() needs a number of seconds and a function", 2) end
	return require("love.tween").after(seconds, function() runTask(n, fn) end, n)
end

---Calls fn every so many seconds, until it returns false or the piece is gone.
function pieceApi.every(n, seconds, fn)
	if type(fn) ~= "function" then error("every() needs a number of seconds and a function", 2) end
	return require("love.tween").every(seconds, fn, n)
end

---How fast to go up to jump this high, with the piece's fallGravity (or g).
function pieceApi.jumpSpeed(n, height, g)
	-- Scripts used to call their variable gravity, which is also a Body's
	-- property (a multiplier around 1): a big one is such a script's.
	g = g or (type(n.fallGravity) == "number" and n.fallGravity)
		or (type(n.gravity) == "number" and n.gravity > 50 and n.gravity) or 1800
	return math.sqrt(2 * g * height)
end

---------------------------------------------------------------------------
-- Pieces

---True if it has the tag, or is that type (or a type that extends it).
function Node:is(name)
	return (self._tags ~= nil and self._tags[name] == true) or self:isA(name)
end

-- What game code sees as globals (love.engine): Lua's, the game's own and
-- smitten, but not love.
local globals = require("love.engine").globals

-- Run as they are, every frame: wait() can't pause them.
local DIRECT = { update = true, physicsUpdate = true, draw = true }

local SPAWN = api.spawn

---True if a loaded script is in the new style.
function M.isScript(s)
	return type(s) == "table" and rawget(s, "__smitten") ~= nil
end

-- The Lua types each kind of piece property holds.
local PROPERTY_LUA_TYPES = {
	number = { number = true }, int = { number = true }, angle = { number = true },
	bool = { boolean = true }, color = { table = true },
	text = { string = true, number = true }, enum = { string = true }, resource = { string = true },
}

-- A top-level line like `bounce = true` sets the piece's own property when
-- one has that name. With a value of the wrong kind that breaks the piece
-- somewhere far away, so say so where it happens.
local propertiesOf = {}
local function checkTopLevel(n, k, v)
	if type(k) ~= "string" then return end
	local props = propertiesOf[n.type]
	if not props then
		props = node.properties(n.type)
		propertiesOf[n.type] = props
	end
	local def = props[k]
	local ok = def and PROPERTY_LUA_TYPES[def.type]
	if ok and not ok[type(v)] then
		error(("%s is a property of every %s (a %s), so this sets it to %s. Give your variable another name."):format(
			k, n.type, def.type, tostring(v)), 3)
	end
end

-- A script's function with the name of one of the piece's methods replaces
-- it: `function move()` on a Body, and the body stands still with no error,
-- because move() is now the script's. Sometimes that's meant (a boss with
-- its own wake()), so it's a warning in the output, once for each script.
local warned = {}
local function checkMethod(n, k)
	if type(k) ~= "string" then return end
	local schema = require("love.scene.schema")
	local name = n.type
	while name do
		local def = schema.types[name]
		if not def then return end
		if def.methods and def.methods[k] then
			local info = debug.getinfo(3, "Sl")
			local where = info and (info.short_src .. ":" .. info.currentline) or "?"
			if not warned[where .. k] then
				warned[where .. k] = true
				print(("Warning: %s: every %s already has %s(), and this function replaces it. "
					.. "If you wanted the piece's own %s() too, give yours another name."):format(where, n.type, k, k))
			end
			return
		end
		name = def.extends
	end
end

---Gives a piece its script: runs the file in the piece's own environment.
function M.instantiate(n, s)
	local info = s.__smitten
	local fns = {}     -- the script's own functions
	local bound = {}   -- methods and piece calls, bound to n
	local vars = {}    -- top-level names: the script's variables
	local defining = true
	local env = {}
	local function bind(f)
		local b = bound[f]
		if not b then
			b = function(...) return f(n, ...) end
			bound[f] = b
		end
		return b
	end
	setmetatable(env, {
		__index = function(_, k)
			local f = fns[k]
			if f then return f end
			if k == "spawn" then return SPAWN end
			-- type() is Lua's; the piece's type is self.type.
			if k == "type" then return type end
			local v = n[k]
			if v ~= nil then
				if type(v) == "function" then return bind(v) end
				return v
			end
			if type(k) == "string" then
				local b = k:byte(1)
				if b and b >= 65 and b <= 90 then
					local child = n:find(k)
					if child then return child end
				end
			end
			local p = pieceApi[k]
			if p then return bind(p) end
			v = api[k]
			if v == nil then v = globals[k] end
			-- Functions and tables from the API and Lua (math, print, approach)
			-- are kept in the environment, so the next read is direct.
			local t = type(v)
			if t == "function" or t == "table" then rawset(env, k, v) end
			return v
		end,
		__newindex = function(_, k, v)
			if type(v) == "function" then
				if defining then checkMethod(n, k) end
				fns[k] = v
				if DIRECT[k] or (type(k) == "string" and k:sub(1, 1) == "_") then
					n[k] = function(_, ...) return v(...) end
				else
					n[k] = function(_, ...) return runTask(n, v, ...) end
				end
			else
				if defining then checkTopLevel(n, k, v) end
				n[k] = v
				if defining then vars[k] = true end
			end
		end,
	})
	rawset(env, "self", n)
	n._scriptVars = vars

	-- One compiled chunk for every piece; a piece that makes another piece
	-- with the same script at the top level gets a fresh copy.
	local chunk = info.chunk
	if info.running then
		chunk = loadstring(string.dump(info.chunk), "@" .. info.path)
	end
	setfenv(chunk, env)
	info.running = true
	local ok, err = pcall(chunk)
	info.running = false
	defining = false
	if not ok then error(err, 0) end
	return n
end

---True if a script's source is in the old style: its last line of code
---(not a comment or blank) is a top-level `return`.
function M.isOldStyle(source)
	local last = nil
	for line in (source .. "\n"):gmatch("([^\n]*)\n") do
		local code = line:gsub("%-%-.*$", "")
		if code:find("%S") then last = code end
	end
	return last ~= nil and last:find("^return[%s{]") ~= nil
end

---Loads a script file: a new-style script, or the table an old-style one returns.
function M.load(path)
	local chunk, err = love.filesystem.load(path)
	if not chunk then error(err, 0) end
	setfenv(chunk, globals)
	if M.isOldStyle(love.filesystem.read(path) or "") then
		local value = chunk()
		if type(value) ~= "table" then
			error(("%s returns %s; a script returns a table, or nothing at all (a script that is the piece)"):format(path, type(value)), 0)
		end
		return value
	end
	return { __smitten = { chunk = chunk, path = path } }
end

return M
