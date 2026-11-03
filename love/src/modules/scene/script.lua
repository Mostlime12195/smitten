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
--   5. Lua's globals (math, string, print, smitten, ...)
--
-- Assigning a name that isn't a local sets it on the piece. A few calls are
-- decided the other way: spawn() adds to the scene (self:spawn() adds inside
-- this piece). find() is the piece's (relative), root() is the scene's root.
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

local DONE, WAIT = {}, {}
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
		error(debug.traceback(co, tostring(tag)), 0)
	end
	if tag == WAIT then
		local seconds = ...
		local owner = owners[co]
		require("love.tween").after(seconds, function() resumeWith(co) end, owner)
		return
	end
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

local api = {}
M.api = api

local function input() return require("love.input") end
local function scene() return require("love.scene") end

function api.pressed(action) return input().pressed(action) end
function api.down(action) return input().down(action) end
function api.released(action) return input().released(action) end
function api.axis(negative, positive) return input().axis(negative, positive) end
function api.vector(left, right, up, down) return input().vector(left, right, up, down) end

function api.go(path, ...) return scene().go(path, ...) end
function api.reload() return scene().reload() end
function api.make(what, props, script) return scene().make(what, props, script) end
function api.tagged(tag) return scene().tagged(tag) end
function api.first(tag) return scene().first(tag) end
function api.root() return scene().current end

---Spawns into the scene (or into parent); self:spawn() spawns inside this piece.
function api.spawn(what, props, parent)
	local s = scene()
	local ok, n = pcall(s.make, what, props)
	if not ok then error(n, 2) end
	parent = parent or s.current
	if not parent then error("spawn() needs a running scene (or a parent to add to)", 2) end
	return parent:add(n)
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

local function soundPath(name)
	if type(name) ~= "string" or name == "" then error("give a sound's name, like \"coin\", or its file", 3) end
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
		error(("there's no sound called %q%s"):format(name, require("love.engine.util").didYouMean(name, names)), 3)
	end
	return p
end

---Plays a sound once: sfx("coin"), sfx("sounds/hit.wav", 0.5).
function api.sfx(name, volume, pitch)
	local snd = require("love.assets").audio(soundPath(name))
	if snd.song then
		snd.song:setVolume(volume or 1)
		snd.song:play()
		return snd.song
	end
	local src = snd:newSource()
	src:setVolume(volume or 1)
	if pitch then src:setPitch(pitch) end
	src:play()
	return src
end

local playingMusic = nil

---Plays music on a loop, instead of any music playing: music("theme").
function api.music(name, volume)
	api.stopMusic()
	local snd = require("love.assets").audio(soundPath(name))
	if snd.song then
		snd.song:setVolume(volume or 1)
		snd.song:play()
		playingMusic = snd.song
	else
		local src = snd:newSource()
		src:setLooping(true)
		src:setVolume(volume or 1)
		src:play()
		playingMusic = src
	end
	return playingMusic
end

function api.stopMusic()
	if playingMusic then playingMusic:stop() end
	playingMusic = nil
end

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

---Where the mouse is in the scene (x, y).
function api.mouse()
	local m = love.mouse
	return m.worldX, m.worldY
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
function api.rect(x, y, w, h, fill) love.graphics.rectangle(fill == false and "line" or "fill", x, y, w, h) end
function api.circle(x, y, r, fill) love.graphics.circle(fill == false and "line" or "fill", x, y, r) end
function api.line(...) love.graphics.line(...) end
function api.write(text, x, y) love.graphics.print(tostring(text), x or 0, y or 0) end
function api.sprite(path, x, y, r, sx, sy)
	local img = require("love.assets").image(path)
	love.graphics.draw(img, x or 0, y or 0, r or 0, sx or 1, sy or sx or 1)
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

---How fast to go up to jump this high, with the piece's gravity (or g).
function pieceApi.jumpSpeed(n, height, g)
	g = g or (type(n.gravity) == "number" and n.gravity > 50 and n.gravity) or 1800
	return math.sqrt(2 * g * height)
end

---------------------------------------------------------------------------
-- Pieces

---True if it has the tag, or is that type (or a type that extends it).
function Node:is(name)
	return (self._tags ~= nil and self._tags[name] == true) or self:isA(name)
end

-- Run as they are, every frame: wait() can't pause them.
local DIRECT = { update = true, physicsUpdate = true, draw = true }

local SPAWN = api.spawn

---True if a loaded script is in the new style.
function M.isScript(s)
	return type(s) == "table" and rawget(s, "__smitten") ~= nil
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
			if v == nil then v = _G[k] end
			-- Functions and tables from the API and Lua (math, print, approach)
			-- are kept in the environment, so the next read is direct.
			local t = type(v)
			if t == "function" or t == "table" then rawset(env, k, v) end
			return v
		end,
		__newindex = function(_, k, v)
			if type(v) == "function" then
				fns[k] = v
				if DIRECT[k] or (type(k) == "string" and k:sub(1, 1) == "_") then
					n[k] = function(_, ...) return v(...) end
				else
					n[k] = function(_, ...) return runTask(n, v, ...) end
				end
			else
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
