-- Animator: keyframes for any property (docs/animation.md).
--
-- An Animator holds named animations (its `animations` property, saved in
-- the scene; the editor's Animate panel makes them). Each has a length, a
-- loop flag and tracks; a track names a piece by its path from the
-- Animator's parent ("." or "" is the parent itself, "Door/Hinge" a piece
-- inside it) and either a property with keys, or call keys:
--
--   { piece = "Door", property = "y",
--     keys = { { time = 0, value = 0 }, { time = 1, value = -64, easing = "outQuad" } } }
--   { piece = "Creak", calls = { { time = 0, method = "play" } } }
--
-- A call key calls a method or a script function of its piece:
-- Creak:play(), or Door:emit("opened") with args = { "opened" }.
--
-- play() turns an animation's data into a ready form (sorted keys, pieces
-- found, angles in the game's unit) and the Animator applies it every frame
-- while it plays (or every physics step, with physicsStep). A scene without
-- Animators pays nothing: only Animators have this work to do.
--
-- Angles: keys keep degrees, as a version 3 scene file does; a key for an
-- angle property is turned into the unit the game's scripts use
-- (compat.fromDegrees: degrees, or radians for an older project).

local nodeLib = require("love.scene.node")
local keyframes = require("love.scene.keyframes")
local compat = require("love.engine.compat")

local Animator = nodeLib.classes.Animator

-- Fields (pieces.json "fields"): the state scripts read.
Animator.playing = false
Animator.current = ""
Animator.position = 0

local sample, callRange = keyframes.sample, keyframes.callRange
local unpack = unpack

-- At most this many times round a looping animation in one step; a longer
-- step skips the call keys of the rest (a tiny loop and a huge dt).
local MAX_PASSES = 100
local MIN_LENGTH = 0.001

local function didYouMean(name, names)
	return require("love.engine.util").didYouMean(tostring(name), names)
end

local function namesOf(t)
	local out = {}
	if type(t) == "table" then
		for k in pairs(t) do
			if type(k) == "string" then out[#out + 1] = k end
		end
	end
	table.sort(out)
	return out
end

local function describe(self)
	return ("Animator \"%s\""):format(tostring(self.name))
end

-- Said once for each Animator, animation and problem.
local function warn(self, text)
	local said = self._warned
	if not said then
		said = {}
		self._warned = said
	end
	if said[text] then return end
	said[text] = true
	print(("Warning: %s: %s"):format(describe(self), text))
end

-- The pieces' property definitions, by type (to find angles and colors).
local propsByType = {}
local function propertyDef(n, key)
	local props = propsByType[n.type]
	if not props then
		props = nodeLib.properties(n.type)
		propsByType[n.type] = props
	end
	return props[key]
end

-- Where tracks' paths start: the Animator's parent (itself, if it has none).
local function base(self)
	return self.parent or self
end

local function findPiece(self, path, what)
	if type(path) ~= "string" then path = "" end
	local n = base(self):find(path)
	if not n then
		local names = {}
		for _, c in ipairs(base(self).children) do names[#names + 1] = c.name end
		warn(self, ("%s: there's no piece \"%s\" next to the Animator%s, so this track does nothing"):format(
			what, path, didYouMean(path:match("[^/]*$"), names)))
	end
	return n
end

local function number(v, default)
	v = tonumber(v)
	if v == nil or v ~= v then return default end
	return v
end

-- The animation called name, ready to play: { name, length, loop, tracks,
-- calls }. Errors (at level; nil: no position) for a name or an easing that
-- doesn't exist.
local function compile(self, name, level)
	level = level and level + 1 or 0
	local all = self.animations
	local data = type(all) == "table" and all[name] or nil
	if type(data) ~= "table" then
		local names = namesOf(all)
		if #names == 0 then
			error(("%s has no animations yet: make one in the Animate panel"):format(describe(self)), level)
		end
		error(("%s has no animation called \"%s\"%s"):format(describe(self), tostring(name), didYouMean(name, names)), level)
	end
	local tracks, calls = {}, {}
	local last = 0
	for ti, tr in ipairs(type(data.tracks) == "table" and data.tracks or {}) do
		local what = ("the animation \"%s\", track %d"):format(name, ti)
		if type(tr.calls) == "table" then
			local target = findPiece(self, tr.piece, what)
			for _, c in ipairs(tr.calls) do
				local t = math.max(0, number(c.time, 0))
				if t > last then last = t end
				if type(c.method) ~= "string" or c.method == "" then
					error(("%s of %s has a call key with no method to call"):format(what, describe(self)), level)
				end
				local args = type(c.args) == "table" and c.args or {}
				calls[#calls + 1] = { time = t, target = target, method = c.method, args = args, n = #args, track = ti }
			end
		elseif type(tr.property) == "string" and tr.property ~= "" and type(tr.keys) == "table" then
			local target = findPiece(self, tr.piece, what)
			local def = target and propertyDef(target, tr.property)
			local scale = (def and def.type == "angle") and compat.fromDegrees or 1
			local keys = {}
			for _, k in ipairs(tr.keys) do
				local t = math.max(0, number(k.time, 0))
				if t > last then last = t end
				local easing = k.easing
				if easing ~= nil and easing ~= "" and not keyframes.easings[easing] then
					error(("%s of %s has a key with the easing \"%s\", and there's no easing called that%s"):format(
						what, describe(self), tostring(easing), didYouMean(easing, keyframes.easingNames())), level)
				end
				local v = k.value
				if type(v) == "number" and scale ~= 1 then v = v * scale end
				keys[#keys + 1] = { time = t, value = v, easing = easing }
			end
			if target and #keys > 0 then
				if target[tr.property] == nil and not def then
					warn(self, ("%s: %s has no property or variable called %s"):format(what, tostring(target), tr.property))
				end
				tracks[#tracks + 1] = {
					target = target, property = tr.property, keys = keyframes.sorted(keys), at = 0,
					-- A color is written into one table of the track's own (drawing
					-- reads its numbers); other lists get a new table when they change,
					-- since pieces such as a Body's points notice a new table.
					color = def ~= nil and def.type == "color", buffer = {}, scratch = {}, from = nil,
				}
			end
		end
	end
	local length = number(data.length, nil)
	if not length or length <= 0 then length = last end
	local loop = data.loop == true
	if loop then length = math.max(length, MIN_LENGTH) end
	return { name = name, length = length, loop = loop, tracks = tracks, calls = keyframes.sorted(calls) }
end

-- Gives every track's piece its value at time t.
local function apply(a, t)
	local tracks = a.tracks
	for i = 1, #tracks do
		local tr = tracks[i]
		local target = tr.target
		if not target._dead then
			local v, at = sample(tr.keys, t, tr.at, tr.scratch)
			tr.at = at
			if type(v) ~= "table" then
				target[tr.property] = v
				tr.from = nil
			elseif tr.color then
				local buf = tr.buffer
				for j = 1, #v do buf[j] = v[j] end
				for j = #v + 1, #buf do buf[j] = nil end
				target[tr.property] = buf
			elseif v == tr.scratch then
				-- Between two keys: a new table each time it changes.
				local copy = {}
				for j = 1, #v do copy[j] = v[j] end
				target[tr.property] = copy
				tr.from = nil
			elseif v ~= tr.from then
				-- A key's own list: copied once (the key's data stays as it is).
				local copy = {}
				for j = 1, #v do copy[j] = v[j] end
				target[tr.property] = copy
				tr.from = v
			end
		end
	end
end

-- Calls the call keys between from and to (see keyframes.callRange). Stops
-- if a call changes what the Animator plays (gen).
local function fire(self, a, from, to, inclusive, gen)
	local calls = a.calls
	if #calls == 0 then return true end
	local first, last = callRange(calls, from, to, inclusive)
	local step = from <= to and 1 or -1
	for i = first, last, step do
		local c = calls[i]
		local target = c.target
		if target and not target._dead then
			local f = target[c.method]
			if type(f) ~= "function" then
				local names = {}
				local seen = {}
				local name = target.type
				local schema = require("love.scene.schema")
				while name do
					local def = schema.types[name]
					if not def then break end
					for m in pairs(def.methods or {}) do
						if not seen[m] then seen[m] = true names[#names + 1] = m end
					end
					name = def.extends
				end
				for k, v in pairs(target) do
					if type(v) == "function" and type(k) == "string" and not seen[k] and k:sub(1, 1) ~= "_" then names[#names + 1] = k end
				end
				table.sort(names)
				error(("the animation \"%s\" of %s calls %s() on %s at %s seconds, and it has no method or function called that%s"):format(
					a.name, describe(self), c.method, tostring(target), tostring(c.time), didYouMean(c.method, names)), 0)
			end
			f(target, unpack(c.args, 1, c.n))
			if self._gen ~= gen then return false end
		end
	end
	return true
end

-- Tasks waiting in animate() go on, with true if the animation got to its
-- end, or false if it stopped or another one took its place.
local function wake(self, result)
	local list = self._waiting
	if not list then return end
	self._waiting = nil
	local script = require("love.scene.script")
	for i = 1, #list do script.resumeTask(list[i], result) end
end

local function finish(self, a)
	self.playing = false
	self._done = true
	wake(self, true)
	self:emit("finished", a.name)
end

local function start(self, name, level)
	local a = compile(self, name, level and level + 1)
	local old = self._waiting
	self._gen = (self._gen or 0) + 1
	self._anim = a
	self.current = name
	self._done = false
	self._fresh = true
	self.position = (self.speed or 1) < 0 and a.length or 0
	apply(a, self.position)
	-- Tasks that waited for another animation: it won't end now.
	if old then wake(self, false) end
end

-- Moves the playing animation on by dt (times speed).
local function advance(self, dt)
	if not self.playing then return end
	local a = self._anim
	if not a then
		self.playing = false
		return
	end
	local delta = dt * (self.speed or 1)
	if delta == 0 then return end
	local gen = self._gen
	local len = a.length
	local t0 = self.position
	local t1 = t0 + delta
	local inclusive = self._fresh == true
	self._fresh = false
	if delta > 0 then
		if a.loop then
			local passes = 0
			while t1 > len do
				if not fire(self, a, t0, len, inclusive, gen) then return end
				t1, t0, inclusive = t1 - len, 0, true
				passes = passes + 1
				if passes >= MAX_PASSES then t1 = t1 % len end
			end
			if not fire(self, a, t0, t1, inclusive, gen) then return end
		elseif t1 >= len then
			if not fire(self, a, t0, len, inclusive, gen) then return end
			self.position = len
			apply(a, len)
			finish(self, a)
			return
		elseif not fire(self, a, t0, t1, inclusive, gen) then
			return
		end
	else
		if a.loop then
			local passes = 0
			while t1 < 0 do
				if not fire(self, a, t0, 0, inclusive, gen) then return end
				t1, t0, inclusive = t1 + len, len, true
				passes = passes + 1
				if passes >= MAX_PASSES then t1 = t1 % len end
			end
			if not fire(self, a, t0, t1, inclusive, gen) then return end
		elseif t1 <= 0 then
			if not fire(self, a, t0, 0, inclusive, gen) then return end
			self.position = 0
			apply(a, 0)
			finish(self, a)
			return
		elseif not fire(self, a, t0, t1, inclusive, gen) then
			return
		end
	end
	self.position = t1
	apply(a, t1)
end

function Animator:_enter()
	if self._started then return end
	self._started = true
	local name = self.autoplay
	if type(name) == "string" and name ~= "" then
		local ok, err = pcall(start, self, name, nil)
		if not ok then error(("autoplay: %s"):format(err), 0) end
		self.playing = true
	end
end

function Animator:_process(dt)
	if not self.physicsStep then advance(self, dt) end
end

function Animator:_physics(h)
	if self.physicsStep then advance(self, h) end
end

---Plays an animation, or continues the current one; restart starts it again
---from its start even if it's playing.
function Animator:play(name, restart)
	if name == nil or name == "" then
		name = self.current
		if name == "" then name = self.autoplay end
		if name == nil or name == "" then
			error("play() needs the name of an animation, like play(\"open\")", 2)
		end
	end
	if type(name) ~= "string" then error("play() needs the name of an animation, like play(\"open\")", 2) end
	if restart or name ~= self.current or self._done or not self._anim then start(self, name, 2) end
	self.playing = true
end

---Stops the animation where it is; play() continues it.
function Animator:pause()
	self.playing = false
end

---Stops the animation and puts its pieces back as they are at its start.
function Animator:stop()
	self.playing = false
	self._gen = (self._gen or 0) + 1
	self._done = false
	self._fresh = true
	local a = self._anim
	if a then
		self.position = 0
		apply(a, 0)
	end
	wake(self, false)
end

---Moves the current animation to a time (in seconds) and gives the pieces
---the values of that time. Call keys at that time run when it plays on.
function Animator:seek(seconds)
	if type(seconds) ~= "number" then error("seek() needs a time in seconds, like seek(0.5)", 2) end
	local a = self._anim
	if not a then
		local name = self.current ~= "" and self.current or self.autoplay
		if name == nil or name == "" then
			error("seek() moves the current animation, and there's none yet: call play(\"name\") first", 2)
		end
		start(self, name, 2)
		a = self._anim
	end
	local len = a.length
	if a.loop then
		seconds = seconds % len
	else
		seconds = math.max(0, math.min(len, seconds))
	end
	self._gen = (self._gen or 0) + 1
	self._done = false
	self._fresh = true
	self.position = seconds
	apply(a, seconds)
end

---Plays an animation and waits until it ends. Only in ready(), events and
---tasks, as wait() is. Returns true if it got to its end, false if it was
---stopped or another animation took its place.
function Animator:animate(name, restart)
	local script = require("love.scene.script")
	local co = script.currentTask()
	if not co then
		error("animate() waits for the animation to end, so it works in ready(), events and tasks, not in update() or draw(): "
			.. "use play() there, or task(function() Anim:animate(\"open\") end)", 2)
	end
	local ok, err = pcall(self.play, self, name, restart)
	if not ok then error(err, 2) end
	local list = self._waiting
	if not list then
		list = {}
		self._waiting = list
	end
	list[#list + 1] = co
	return script.suspendTask()
end

---True if the Animator has an animation called name.
function Animator:hasAnimation(name)
	local all = self.animations
	return type(all) == "table" and type(all[name]) == "table"
end

---How long an animation is, in seconds (the current one if no name).
function Animator:getLength(name)
	if name == nil then
		if self._anim then return self._anim.length end
		name = self.current
	end
	if not self:hasAnimation(name) then return 0 end
	return compile(self, name, 2).length
end

return Animator
