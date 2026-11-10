-- Tests for animations under plain Lua 5.1: the engine's real keyframes.lua
-- and the Animator piece (animator.lua) on real pieces (node.lua), with no
-- drawing. From the repository's root:
--
--   lua5.1 tools/animation-tests/test.lua
--
-- keyframes.lua is checked against tools/scene-tests/animation/keyframe-cases.json,
-- the cases the editor's copy (keyframes.js) and the built engine (the
-- "animation" scene test) are checked with too.

local root = (arg and arg[0] or ""):match("^(.*)tools[/\\]animation%-tests[/\\]") or ""
local modules = root .. "love/src/modules/"

local function read(path)
	local f = assert(io.open(path, "rb"), "can't open " .. path)
	local s = f:read("*a")
	f:close()
	return s
end

table.insert(package.loaders, 2, function(name)
	local dir, file = name:match("^love%.(%w+)%.?(%w*)$")
	if not dir then return nil end
	if file == "" then file = "init" end
	local path = modules .. dir .. "/" .. file .. ".lua"
	local f = io.open(path, "r")
	if not f then return "\n\tno file " .. path end
	f:close()
	return assert(loadfile(path))
end)

local json = require("love.json")
package.loaded["love.scene.schema"] = json.decode(read(modules .. "scene/pieces.json"))

-- Tasks, as script.lua has them (a coroutine that waits until resumed).
local tasks = {}
package.loaded["love.scene.script"] = {
	currentTask = function()
		local co = coroutine.running()
		return tasks[co] and co or nil
	end,
	suspendTask = function() return coroutine.yield() end,
	resumeTask = function(co, ...)
		if coroutine.status(co) ~= "suspended" then return end
		local ok, err = coroutine.resume(co, ...)
		if not ok then error(err, 0) end
	end,
}
local function task(fn)
	local co = coroutine.create(fn)
	tasks[co] = true
	local ok, err = coroutine.resume(co)
	if not ok then error(err, 0) end
	return co
end

local printed = {}
local realPrint = print
print = function(...)
	local parts = {}
	for i = 1, select("#", ...) do parts[i] = tostring((select(i, ...))) end
	printed[#printed + 1] = table.concat(parts, " ")
end

local nodeLib = require("love.scene.node")
local keyframes = require("love.scene.keyframes")
require("love.scene.animator")
local compat = require("love.engine.compat")

local passed, failed = 0, 0
local function check(name, ok, detail)
	if ok then
		passed = passed + 1
	else
		failed = failed + 1
		realPrint("FAIL " .. name .. (detail ~= nil and (": " .. tostring(detail)) or ""))
	end
end

local function show(v)
	if type(v) ~= "table" then return tostring(v) end
	local parts = {}
	for i = 1, #v do parts[i] = show(v[i]) end
	return "{" .. table.concat(parts, ", ") .. "}"
end

local function same(a, b)
	if type(a) == "number" and type(b) == "number" then return math.abs(a - b) < 1e-9 end
	if type(a) == "table" and type(b) == "table" then
		if #a ~= #b then return false end
		for i = 1, #a do
			if not same(a[i], b[i]) then return false end
		end
		return true
	end
	return a == b
end

local function near(name, got, want, tolerance)
	local ok
	if type(got) == "table" and type(want) == "table" then
		ok = #got == #want
		for i = 1, #want do ok = ok and type(got[i]) == "number" and math.abs(got[i] - want[i]) <= (tolerance or 1e-6) end
	else
		ok = type(got) == "number" and math.abs(got - want) <= (tolerance or 1e-6)
	end
	check(name, ok, ("got %s, wanted %s"):format(show(got), show(want)))
end

local function eq(name, got, want)
	check(name, same(got, want), ("got %s, wanted %s"):format(show(got), show(want)))
end

-- The shared cases ------------------------------------------------------------

local fixture = json.decode(read(root .. "tools/scene-tests/animation/keyframe-cases.json"))
for _, case in ipairs(fixture.tracks) do
	local keys = keyframes.sorted(case.keys)
	local hint = 0
	for i, t in ipairs(case.times) do
		-- Once from scratch, once going on from the last key found.
		local v = keyframes.sample(keys, t)
		eq(("keys: %s at %s"):format(case.name, t), v, case.expect[i])
		local v2, at = keyframes.sample(keys, t, hint)
		hint = at
		eq(("keys: %s at %s, going on"):format(case.name, t), v2, case.expect[i])
	end
end
for _, case in ipairs(fixture.calls) do
	local list = keyframes.sorted(case.calls)
	for i, r in ipairs(case.ranges) do
		local first, last = keyframes.callRange(list, r[1], r[2], r[3])
		local ids = {}
		for k = first, last, r[1] <= r[2] and 1 or -1 do ids[#ids + 1] = list[k].id end
		eq(("calls: %s from %s to %s%s"):format(case.name, r[1], r[2], r[3] and " (with the start)" or ""), ids, case.expect[i])
	end
end
-- Every easing the engine has is in the cases (and the other way round).
do
	local inCases = {}
	for _, case in ipairs(fixture.tracks) do
		local e = case.name:match("^easing (%w+)$")
		if e then inCases[e] = true end
	end
	for _, name in ipairs(keyframes.easingNames()) do
		if name ~= "step" then check("easing " .. name .. " is in the cases", inCases[name]) end
	end
end

-- The Animator ------------------------------------------------------------------

-- A Group with a Sprite "Door", a Shape "Look" and an Animator, all entered.
local function stage(animations, props)
	local top = nodeLib.new("Group")
	top.name = "Room"
	local door = nodeLib.new("Sprite")
	door.name = "Door"
	top:add(door)
	local look = nodeLib.new("Shape")
	look.name = "Look"
	top:add(look)
	local p = { animations = animations }
	for k, v in pairs(props or {}) do p[k] = v end
	local anim = nodeLib.new("Animator", nil, p)
	anim.name = "Anim"
	top:add(anim)
	nodeLib.enterTree(top)
	return top, anim, door, look
end

local function run(anim, seconds, dt)
	dt = dt or 1 / 60
	local n = math.floor(seconds / dt + 0.5)
	for _ = 1, n do anim:_process(dt) end
end

local function heard(n, event)
	local log = {}
	n:on(event, function(...) log[#log + 1] = { ... } end)
	return log
end

local OPEN = {
	open = {
		length = 1,
		tracks = {
			{ piece = "Door", property = "y", keys = { { time = 0, value = 0 }, { time = 1, value = -64 } } },
			{ piece = "Door", property = "x", keys = { { time = 0, value = 0 }, { time = 1, value = 100, easing = "outQuad" } } },
			{ piece = "Door", property = "visible", keys = { { time = 0, value = true }, { time = 0.5, value = false } } },
			{ piece = "Look", property = "color", keys = { { time = 0, value = { 1, 0, 0, 1 } }, { time = 1, value = { 0, 0, 1, 1 } } } },
			{ piece = "Door", property = "rotation", keys = { { time = 0, value = 0 }, { time = 1, value = 90 } } },
		},
	},
	spin = { length = 0.5, loop = true, tracks = { { piece = ".", property = "rotation", keys = { { time = 0, value = 0 }, { time = 0.5, value = 360 } } } } },
}

do
	local top, anim, door, look = stage(OPEN)
	eq("nothing plays without autoplay", anim.playing, false)
	eq("nothing changes without autoplay", door.y, 0)
	anim:play("open")
	eq("play() starts", anim.playing, true)
	eq("current", anim.current, "open")
	run(anim, 0.25)
	near("linear at 0.25", door.y, -16)
	near("outQuad at 0.25", door.x, 100 * (0.25 * (2 - 0.25)))
	eq("a step key before its time", door.visible, true)
	near("a color at 0.25", look.color, { 0.75, 0, 0.25, 1 })
	near("degrees at 0.25 (a version 3 project)", door.rotation, 22.5)
	run(anim, 0.5)
	eq("a step key after its time", door.visible, false)
	near("position", anim.position, 0.75)
	local color = look.color
	run(anim, 1 / 60)
	check("a color is written into one table", look.color == color)
	local finished = heard(anim, "finished")
	run(anim, 1)
	eq("finished is sent", #finished, 1)
	eq("finished gets the name", finished[1] and finished[1][1], "open")
	eq("it stops at the end", anim.playing, false)
	near("the end value", door.y, -64)
	near("position at the end", anim.position, 1)
	run(anim, 1)
	eq("finished only once", #finished, 1)
	-- play() again after the end starts again.
	anim:play("open")
	near("play() after the end starts again", door.y, 0)
	run(anim, 0.5)
	anim:pause()
	run(anim, 1)
	near("pause() keeps it where it is", door.y, -32)
	anim:play()
	run(anim, 0.25)
	near("play() continues", door.y, -48)
	anim:seek(0.25)
	near("seek()", door.y, -16)
	near("seek() sets position", anim.position, 0.25)
	anim:seek(5)
	near("seek() stops at the end", anim.position, 1)
	anim:stop()
	eq("stop()", anim.playing, false)
	near("stop() puts the pieces back to the start", door.y, 0)
	anim:play("open")
	anim.speed = 2
	run(anim, 0.25)
	near("speed 2", door.y, -32)
	anim.speed = 1
	anim:play("open", true)
	near("restart", door.y, 0)
	local ok, err = pcall(anim.play, anim, "opne")
	check("a wrong name is an error", not ok and err:find("no animation called \"opne\"", 1, true) and err:find("did you mean \"open\"", 1, true), err)

	-- A loop wraps, and the parent itself is "."
	anim:play("spin")
	run(anim, 0.75)
	near("a loop wraps", top.rotation, 180)
	eq("a loop keeps playing", anim.playing, true)
	anim.speed = -1
	run(anim, 0.5)
	near("a loop plays backwards", top.rotation, 180)
	run(anim, 0.125, 0.125)
	near("and wraps backwards", top.rotation, 90)
	anim.speed = 1
	anim:seek(1.2)
	near("seek() on a loop wraps", anim.position, 0.2)
end

-- Older projects (radians): the same keys, in the unit their scripts use.
do
	local was = compat.fromDegrees
	compat.fromDegrees = math.pi / 180
	local _, anim, door = stage(OPEN)
	anim:play("open")
	run(anim, 0.5)
	near("rotation in radians for an older project", door.rotation, math.pi / 4)
	near("and other numbers as they are", door.y, -32)
	compat.fromDegrees = was
end

-- Call keys: once each pass, in order, also across a big step; backwards.
do
	local calls = {}
	local top = nodeLib.new("Group")
	local target = nodeLib.new("Group")
	target.name = "T"
	function target.note(self, what) calls[#calls + 1] = what end
	top:add(target)
	local anim = nodeLib.new("Animator", nil, { animations = {
		beat = { length = 1, loop = true, tracks = {
			{ piece = "T", calls = { { time = 0.5, method = "note", args = { "b" } }, { time = 0, method = "note", args = { "a" } } } },
			{ piece = "T", calls = { { time = 0.5, method = "note", args = { "c" } }, { time = 0.9, method = "note", args = { "d" } } } },
		} },
		once = { length = 1, tracks = { { piece = "T", calls = { { time = 1, method = "note", args = { "end" } } } } } },
		wrong = { length = 1, tracks = { { piece = "T", calls = { { time = 0.1, method = "noot" } } } } },
	} })
	top:add(anim)
	nodeLib.enterTree(top)
	anim:play("beat")
	eq("nothing is called before the first step", #calls, 0)
	anim:_process(0.1)
	eq("a key at 0 runs on the first step", table.concat(calls, ","), "a")
	anim:_process(0.5)
	eq("keys at one time run in track order", table.concat(calls, ","), "a,b,c")
	anim:_process(0.35)
	eq("then the next", table.concat(calls, ","), "a,b,c,d")
	calls = {}
	anim:_process(0.1)
	eq("the key at 0 runs again on the next pass", table.concat(calls, ","), "a")
	calls = {}
	anim:_process(2.0)
	eq("a step of two passes runs every key twice, in order", table.concat(calls, ","), "b,c,d,a,b,c,d,a")
	calls = {}
	anim:seek(0.6)
	anim.speed = -1
	anim:_process(0.2)
	eq("backwards", table.concat(calls, ","), "c,b")
	anim:_process(0.7)
	eq("backwards round the loop", table.concat(calls, ","), "c,b,a,d")
	anim.speed = 1
	calls = {}
	anim:play("once")
	anim:_process(5)
	eq("a key at the end runs once", table.concat(calls, ","), "end")
	anim:play("wrong")
	local ok, err = pcall(anim._process, anim, 0.2)
	check("a call to a missing function is an error", not ok and err:find("noot", 1, true) and err:find("did you mean \"note\"", 1, true), err)
end

-- A call key that stops the animation stops the rest of the step (the
-- Animator is "Anim" next to the other pieces).
do
	local top = nodeLib.new("Group")
	local target = nodeLib.new("Group")
	target.name = "T"
	top:add(target)
	local anim = nodeLib.new("Animator", nil, { animations = {
		a = { length = 1, tracks = {
			{ piece = "T", property = "x", keys = { { time = 0, value = 0 }, { time = 1, value = 10 } } },
			{ piece = "Anim", calls = { { time = 0.5, method = "stop" }, { time = 0.6, method = "missing" } } },
		} },
	} })
	anim.name = "Anim"
	top:add(anim)
	nodeLib.enterTree(top)
	anim:play("a")
	anim:_process(0.9)
	eq("stop() from a call key", anim.playing, false)
	near("and the pieces are at the start", target.x, 0)
end

-- Autoplay, an Animator inside a placed scene's piece, physics steps.
do
	local _, anim, door = stage(OPEN, { autoplay = "open" })
	eq("autoplay starts it", anim.playing, true)
	run(anim, 0.5)
	near("autoplay plays", door.y, -32)
	local _, anim2, door2 = stage(OPEN, { autoplay = "open", physicsStep = true })
	anim2:_process(0.5)
	near("with physicsStep, frames do not move it on", door2.y, 0)
	for _ = 1, 30 do anim2:_physics(1 / 60) end
	near("physics steps do", door2.y, -32)
	local ok, err = pcall(stage, OPEN, { autoplay = "close" })
	check("a wrong autoplay is an error", not ok and err:find("autoplay", 1, true) and err:find("close", 1, true), err)
end

-- A missing piece is a warning, once; the other tracks still play.
do
	printed = {}
	local _, anim, door = stage({ a = { length = 1, tracks = {
		{ piece = "Dor", property = "y", keys = { { time = 0, value = 0 }, { time = 1, value = 10 } } },
		{ piece = "Door", property = "y", keys = { { time = 0, value = 0 }, { time = 1, value = 10 } } },
	} } })
	anim:play("a")
	anim:play("a", true)
	run(anim, 0.5)
	near("the other track plays", door.y, 5)
	eq("one warning", #printed, 1)
	check("the warning names the piece", (printed[1] or ""):find("no piece \"Dor\"", 1, true) and (printed[1] or ""):find("did you mean \"Door\"", 1, true), printed[1])
	local ok, err
	_, anim = stage({ e = { length = 1, tracks = { { piece = "Door", property = "y", keys = { { time = 0, value = 0 }, { time = 1, value = 1, easing = "outQaud" } } } } } })
	ok, err = pcall(anim.play, anim, "e")
	check("an unknown easing is an error", not ok and err:find("did you mean \"outQuad\"", 1, true), err)
	_, anim = stage(nil)
	ok, err = pcall(anim.play, anim, "e")
	check("an Animator with no animations says so", not ok and err:find("no animations yet", 1, true), err)
end

-- Lists that are not colors get a new table when they change (a Body's
-- points are noticed that way).
do
	local _, anim, _, look = stage({ p = { length = 1, tracks = {
		{ piece = "Look", property = "points", keys = { { time = 0, value = { 0, 0, 10, 0 } }, { time = 1, value = { 0, 0, 20, 0 } } } },
	} } })
	anim:play("p")
	local before = look.points
	run(anim, 0.5)
	near("points change", look.points, { 0, 0, 15, 0 })
	check("in a new table", look.points ~= before)
	local key = anim.animations.p.tracks[1].keys[1].value
	anim:seek(0)
	check("a key's own list is copied", look.points ~= key)
	look.points[3] = 99
	eq("so changing the piece leaves the key alone", key[3], 10)
end

-- animate() waits in a task until the end.
do
	local _, anim, door = stage(OPEN)
	local log = {}
	task(function()
		log[#log + 1] = "start"
		local done = anim:animate("open")
		log[#log + 1] = "after " .. tostring(done) .. " " .. tostring(door.y)
		done = anim:animate("open")
		log[#log + 1] = "again " .. tostring(done)
	end)
	eq("animate() waits", table.concat(log, "|"), "start")
	run(anim, 0.5)
	eq("still waiting halfway", table.concat(log, "|"), "start")
	run(anim, 0.6)
	eq("animate() goes on at the end", log[2], "after true -64")
	eq("and can wait again", #log, 2)
	anim:stop()
	eq("stop() ends the wait with false", log[3], "again false")
	local ok, err = pcall(anim.animate, anim, "open")
	check("animate() outside a task is an error", not ok and err:find("tasks", 1, true), err)
	-- Another animation in its place ends the wait with false.
	log = {}
	task(function() log[#log + 1] = tostring(anim:animate("open")) end)
	anim:play("spin")
	eq("another animation ends the wait with false", log[1], "false")
end

-- Changing the data between plays: play() reads it again.
do
	local _, anim, door = stage({ a = { length = 1, tracks = { { piece = "Door", property = "y", keys = { { time = 0, value = 0 }, { time = 1, value = 10 } } } } } })
	anim:play("a")
	run(anim, 2)
	anim.animations.a.tracks[1].keys[2].value = 20
	anim:play("a")
	run(anim, 2)
	near("a changed animation plays as it is now", door.y, 20)
	eq("getLength()", anim:getLength("a"), 1)
	eq("hasAnimation()", anim:hasAnimation("a") and not anim:hasAnimation("b"), true)
end

realPrint(("animation tests: %d passed, %d failed"):format(passed, failed))
if failed > 0 then os.exit(1) end
