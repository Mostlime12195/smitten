-- smitten.after, smitten.every and smitten.tween: things that happen later or
-- over time, without counting seconds by hand.
--
--   smitten.after(2, function() door:open() end)
--   local blink = smitten.every(0.5, function() light.visible = not light.visible end)
--   blink:cancel()
--   smitten.tween(coin, 0.3, { y = coin.y - 16, alpha = 0 }, "outQuad")
--
-- Timers and tweens made while a scene from smitten.scene.go runs belong to
-- it: they advance in its update (so they pause with it under a pushed
-- scene) and end when it ends. Others advance before every love.update
-- through smitten.scene's callback layer (see scene.lua), from the first
-- time one is made.

local callbacks = require("smitten.scene").callbacks

local time = {}

local sin, cos, pi = math.sin, math.cos, math.pi

---Easing functions: t from 0 to 1 -> progress (0 at the start, 1 at the end).
local EASINGS = {
	linear = function(t) return t end,
	inQuad = function(t) return t * t end,
	outQuad = function(t) return t * (2 - t) end,
	inOutQuad = function(t) return t < 0.5 and 2 * t * t or 1 - (-2 * t + 2) ^ 2 / 2 end,
	inCubic = function(t) return t * t * t end,
	outCubic = function(t) return 1 - (1 - t) ^ 3 end,
	inOutCubic = function(t) return t < 0.5 and 4 * t * t * t or 1 - (-2 * t + 2) ^ 3 / 2 end,
	inSine = function(t) return 1 - cos(t * pi / 2) end,
	outSine = function(t) return sin(t * pi / 2) end,
	inOutSine = function(t) return -(cos(pi * t) - 1) / 2 end,
	inBack = function(t) return 2.70158 * t * t * t - 1.70158 * t * t end,
	outBack = function(t)
		local u = t - 1
		return 1 + 2.70158 * u * u * u + 1.70158 * u * u
	end,
	outElastic = function(t)
		if t == 0 or t == 1 then return t end
		return 2 ^ (-10 * t) * sin((t * 10 - 0.75) * (2 * pi / 3)) + 1
	end,
	outBounce = function(t)
		local n, d = 7.5625, 2.75
		if t < 1 / d then return n * t * t
		elseif t < 2 / d then t = t - 1.5 / d return n * t * t + 0.75
		elseif t < 2.5 / d then t = t - 2.25 / d return n * t * t + 0.9375
		else t = t - 2.625 / d return n * t * t + 0.984375 end
	end,
}

local function easingNames()
	local names = {}
	for k in pairs(EASINGS) do names[#names + 1] = k end
	table.sort(names)
	return names
end

---@class smitten.Timer
---@field active boolean false once it has finished or was cancelled
local Timer = {}
Timer.__index = Timer

---Stop it: the function won't be called (again), and a tween stays where it is.
function Timer:cancel()
	self.active = false
end

local globalList = {}  -- timers that don't belong to a scene
local sceneList = {}   -- timers of the running smitten.scene.go scene
local sceneOwner = nil -- the scene that owns sceneList (set by smitten.scene.go)

-- Advance one list: fire timers, step tweens, then drop finished ones.
local function advance(list, dt)
	local n = #list
	for i = 1, n do
		local t = list[i]
		if t.active then
			if t.kind == "tween" then
				local target = t.target
				if rawget(target, "_dead") then
					t.active = false
				else
					t.elapsed = t.elapsed + dt
					local p = t.elapsed / t.duration
					if p >= 1 then p = 1 end
					local e = t.ease(p)
					local keys, from, to = t.keys, t.from, t.to
					for k = 1, #keys do
						local a = from[k]
						target[keys[k]] = a + (to[k] - a) * e
					end
					if p >= 1 then
						t.active = false
						if t.fn then t.fn(target) end
					end
				end
			else
				t.left = t.left - dt
				if t.left <= 0 then
					if t.kind == "after" then
						t.active = false
						t.fn()
					else
						-- every: catch up if dt spans several intervals, at most a few times.
						local runs = 0
						while t.active and t.left <= 0 and runs < 4 do
							t.left = t.left + t.interval
							runs = runs + 1
							if t.fn() == false then t.active = false end
						end
						if t.left <= 0 then t.left = t.interval end
					end
				end
			end
		end
	end
	-- Compact in place (timers made during this pass are kept, in order).
	local j = 0
	for i = 1, #list do
		local t = list[i]
		if t.active then
			j = j + 1
			list[j] = t
		end
	end
	for i = #list, j + 1, -1 do list[i] = nil end
end

local hooked = false
local function hook()
	if hooked then return end
	hooked = true
	callbacks.before("update", function(_, dt) advance(globalList, dt) end)
	callbacks.want(function(name) return name == "update" end)
end

local function add(t)
	if sceneOwner then
		sceneList[#sceneList + 1] = t
	else
		hook()
		globalList[#globalList + 1] = t
	end
	return setmetatable(t, Timer)
end

local function checkFunction(fn, what, example)
	if type(fn) ~= "function" then
		error(("smitten.%s: expected a function to call, like %s"):format(what, example), 3)
	end
end

local function checkSeconds(s, what, example)
	if type(s) ~= "number" or s ~= s or s < 0 then
		error(("smitten.%s: expected a number of seconds first, like %s"):format(what, example), 3)
	end
end

---Call fn once, `seconds` from now. Returns a timer with :cancel().
---@param seconds number
---@param fn function
---@return smitten.Timer
function time.after(seconds, fn)
	local example = "smitten.after(2, function() ... end)"
	checkSeconds(seconds, "after", example)
	checkFunction(fn, "after", example)
	return add({ kind = "after", left = seconds, fn = fn, active = true })
end

---Call fn every `seconds`, until it returns false or the timer is
---cancelled. Returns a timer with :cancel().
---@param seconds number
---@param fn function
---@return smitten.Timer
function time.every(seconds, fn)
	local example = "smitten.every(0.5, function() ... end)"
	checkSeconds(seconds, "every", example)
	if seconds <= 0 then error("smitten.every: the interval should be more than 0 seconds", 2) end
	checkFunction(fn, "every", example)
	return add({ kind = "every", left = seconds, interval = seconds, fn = fn, active = true })
end

---Change numbers in a table (an object, the camera, ...) smoothly to new
---values over `seconds`. easing: "linear", "inQuad", "outQuad" (default),
---"inOutQuad", "inCubic", "outCubic", "inOutCubic", "inSine", "outSine",
---"inOutSine", "inBack", "outBack", "outElastic", "outBounce". done(target)
---is called at the end. Returns a timer with :cancel().
---@param target table
---@param seconds number
---@param values table<string, number> e.g. { y = 40, alpha = 0 }
---@param easing? string
---@param done? function
---@return smitten.Timer
function time.tween(target, seconds, values, easing, done)
	local example = "smitten.tween(self, 0.5, { y = 40 }, \"outQuad\")"
	if type(target) ~= "table" then
		error(("smitten.tween: the first argument should be the table to change (like self), got %s"):format(type(target)), 2)
	end
	checkSeconds(seconds, "tween", example)
	if type(values) ~= "table" then
		error(("smitten.tween: expected the new values as a table, like %s"):format(example), 2)
	end
	if type(easing) == "function" and done == nil then easing, done = nil, easing end
	local ease = EASINGS[easing or "outQuad"]
	if not ease then
		local guess = require("smitten.util").didYouMean(tostring(easing), easingNames())
		error(("smitten.tween: unknown easing %q%s (easings: %s)"):format(tostring(easing),
			guess and ("; did you mean %q?"):format(guess) or "", table.concat(easingNames(), ", ")), 2)
	end
	if done ~= nil and type(done) ~= "function" then
		error("smitten.tween: the last argument should be a function to call when it's done", 2)
	end
	local keys, from, to = {}, {}, {}
	for k, v in pairs(values) do
		if type(v) ~= "number" then
			error(("smitten.tween: the new value of %q should be a number, got %s"):format(tostring(k), type(v)), 2)
		end
		local current = target[k]
		if type(current) ~= "number" then
			error(("smitten.tween: can't tween %q: it's %s, not a number (give it a starting value first)"):format(
				tostring(k), current == nil and "not set" or ("a " .. type(current))), 2)
		end
		keys[#keys + 1], from[#from + 1], to[#to + 1] = k, current, v
	end
	if seconds == 0 then seconds = 1e-9 end
	return add({ kind = "tween", target = target, duration = seconds, elapsed = 0, ease = ease,
		keys = keys, from = from, to = to, fn = done, active = true })
end

-- For smitten.scene.go: the scene that now owns new timers (nil for none);
-- the old scene's timers are cancelled.
local function setScene(owner)
	for i = #sceneList, 1, -1 do
		sceneList[i].active = false
		sceneList[i] = nil
	end
	sceneOwner = owner
end

-- For smitten.scene.go: advance the scene's timers (from its update).
local function updateScene(dt)
	advance(sceneList, dt)
end

return {
	after = time.after, every = time.every, tween = time.tween,
	-- Internal:
	setScene = setScene, updateScene = updateScene, EASINGS = EASINGS,
}
