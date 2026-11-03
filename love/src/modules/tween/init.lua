-- smitten.tween: smooth changes to numbers, and timers.
--
--   smitten.tween(self, 0.4, { y = 40, opacity = 0 }, "outBack")
--   smitten.tween.to(self, 0.4, { scaleX = 2 }):after(function() ... end)
--   smitten.timer.after(2, function() spawnWave() end)
--   smitten.timer.every(0.5, function() blink() end)
--
-- Tweens and timers made while a scene runs end when the scene changes. A
-- tween of a node also ends when the node is destroyed.

local tween = {}

local pi, sin, cos, sqrt = math.pi, math.sin, math.cos, math.sqrt

local easings = {
	linear = function(t) return t end,
	inQuad = function(t) return t * t end,
	outQuad = function(t) return t * (2 - t) end,
	inOutQuad = function(t) return t < 0.5 and 2 * t * t or -1 + (4 - 2 * t) * t end,
	inCubic = function(t) return t * t * t end,
	outCubic = function(t) t = t - 1 return t * t * t + 1 end,
	inOutCubic = function(t) return t < 0.5 and 4 * t * t * t or (t - 1) * (2 * t - 2) * (2 * t - 2) + 1 end,
	inSine = function(t) return 1 - cos(t * pi / 2) end,
	outSine = function(t) return sin(t * pi / 2) end,
	inOutSine = function(t) return -(cos(pi * t) - 1) / 2 end,
	inExpo = function(t) return t == 0 and 0 or 2 ^ (10 * t - 10) end,
	outExpo = function(t) return t == 1 and 1 or 1 - 2 ^ (-10 * t) end,
	inBack = function(t) local s = 1.70158 return t * t * ((s + 1) * t - s) end,
	outBack = function(t) local s = 1.70158 t = t - 1 return t * t * ((s + 1) * t + s) + 1 end,
	inOutBack = function(t)
		local s = 1.70158 * 1.525
		t = t * 2
		if t < 1 then return 0.5 * (t * t * ((s + 1) * t - s)) end
		t = t - 2
		return 0.5 * (t * t * ((s + 1) * t + s) + 2)
	end,
	outBounce = function(t)
		if t < 1 / 2.75 then return 7.5625 * t * t
		elseif t < 2 / 2.75 then t = t - 1.5 / 2.75 return 7.5625 * t * t + 0.75
		elseif t < 2.5 / 2.75 then t = t - 2.25 / 2.75 return 7.5625 * t * t + 0.9375
		end
		t = t - 2.625 / 2.75
		return 7.5625 * t * t + 0.984375
	end,
	outElastic = function(t)
		if t == 0 or t == 1 then return t end
		return 2 ^ (-10 * t) * sin((t * 10 - 0.75) * (2 * pi) / 3) + 1
	end,
}
tween.easings = easings

local active = {}   -- tweens and timers, updated every frame

local Handle = {}
Handle.__index = Handle

---Stops it without finishing.
function Handle:cancel()
	self.active = false
end

---Calls fn when it finishes (tweens) or each time it fires (timers).
function Handle:after(fn)
	self.done = fn
	return self
end

local function add(h)
	h.active = true
	active[#active + 1] = h
	return setmetatable(h, Handle)
end

---Changes numbers in a table (or node) smoothly over some seconds.
function tween.to(target, seconds, values, easing, done)
	if type(target) ~= "table" then error("tween needs a table or node to change", 2) end
	if type(values) ~= "table" then error("tween needs a table of the values to reach, like { x = 100 }", 2) end
	if type(easing) == "function" and done == nil then easing, done = nil, easing end
	easing = easing or "outQuad"
	local fn = type(easing) == "function" and easing or easings[easing]
	if not fn then
		local names = {}
		for n in pairs(easings) do names[#names + 1] = n end
		error(("there's no easing called %q%s"):format(tostring(easing),
			require("love.engine.util").didYouMean(tostring(easing), names)), 2)
	end
	local from = {}
	for k, v in pairs(values) do
		local now = target[k]
		if type(now) ~= "number" or type(v) ~= "number" then
			error(("tween can only change numbers, and %s is %s"):format(tostring(k), type(now)), 2)
		end
		from[k] = now
	end
	return add({ kind = "tween", target = target, from = from, to = values, time = 0,
		duration = math.max(seconds or 0, 1e-6), ease = fn, done = done })
end

setmetatable(tween, { __call = function(_, ...) return tween.to(...) end })

---Calls fn once, after some seconds.
function tween.after(seconds, fn)
	if type(fn) ~= "function" then error("after() needs a number of seconds and a function", 2) end
	return add({ kind = "after", time = 0, duration = seconds or 0, done = fn })
end

---Calls fn every so many seconds, until it returns false or is cancelled.
function tween.every(seconds, fn)
	if type(fn) ~= "function" then error("every() needs a number of seconds and a function", 2) end
	return add({ kind = "every", time = 0, duration = math.max(seconds or 0, 1e-3), done = fn })
end

function tween._update(dt)
	local list = active
	local n = #list
	for i = 1, n do
		local h = list[i]
		if h.active then
			if h.target and h.target._dead then
				h.active = false
			else
				h.time = h.time + dt
				if h.kind == "tween" then
					local t = math.min(1, h.time / h.duration)
					local e = h.ease(t)
					local target, from = h.target, h.from
					for k, v in pairs(h.to) do target[k] = from[k] + (v - from[k]) * e end
					if t >= 1 then
						h.active = false
						if h.done then h.done(target) end
					end
				elseif h.time >= h.duration then
					if h.kind == "after" then
						h.active = false
						h.done()
					else
						h.time = h.time - h.duration
						if h.done() == false then h.active = false end
					end
				end
			end
		end
	end
	-- Drop finished ones (new ones added during the loop are kept).
	local j = 0
	for i = 1, #list do
		local h = list[i]
		if h.active then
			j = j + 1
			list[j] = h
		end
	end
	for i = j + 1, #list do list[i] = nil end
end

function tween._sceneChanged()
	for _, h in ipairs(active) do h.active = false end
	active = {}
end

---Every easing's name.
function tween.easingNames()
	local out = {}
	for n in pairs(easings) do out[#out + 1] = n end
	table.sort(out)
	return out
end

return tween
