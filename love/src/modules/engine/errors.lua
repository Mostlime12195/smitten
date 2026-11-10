-- Errors in plain words. Lua says
--
--   scripts/player.lua:9: attempt to perform arithmetic on global 'scroe' (a nil value)
--
-- followed by a traceback through the engine's own files. This turns it into
--
--   scripts/player.lua:9: "scroe" has no value here: it's nil (did you mean "score"?)
--
-- and keeps only the lines of the traceback that are the game's.

local errors = {}

-- Lines of a traceback that aren't the game's: the engine's Lua files, C
-- functions and tail calls.
local function isEngineFrame(line)
	return line:find('%[love "', 1) ~= nil or line:find('%[smitten "', 1) ~= nil
		or line:find("^%[C%]") ~= nil or line:find("^%(tail call%)") ~= nil
end

---The game's frames of a traceback (debug.traceback's text), in order.
function errors.frames(trace)
	local out = {}
	for line in tostring(trace or ""):gmatch("[^\n]+") do
		line = line:gsub("^%s+", "")
		if line ~= "" and not line:find("^stack traceback:") and not isEngineFrame(line) and out[#out] ~= line then
			out[#out + 1] = line
		end
	end
	return out
end

-- Takes "[smitten "scene/script.lua"]:589: " and the like off the front: where
-- in the engine an error passed through says nothing about the game.
local function stripEngine(msg)
	while true do
		local rest = msg:match('^%[%a+ "[^"\n]*"%]:%d+: (.*)$')
		if not rest then return msg end
		msg = rest
	end
end

-- Every name the code that raised an error in file could have meant: its
-- locals, the piece's variables, properties, methods and children, the
-- script API and Lua's own. thread is the coroutine it ran in (nil: this one).
local function namesAt(thread, file)
	local names, seen = {}, {}
	local function add(k)
		if type(k) == "string" and not seen[k] and k:find("^[%a][%w_]*$") then
			seen[k] = true
			names[#names + 1] = k
		end
	end
	-- The frame of the game's function, found by its file.
	local func
	for level = 0, 20 do
		local info
		if thread then info = debug.getinfo(thread, level, "Sf") else info = debug.getinfo(level, "Sf") end
		if not info then break end
		if info.what ~= "C" and info.short_src == file then
			func = info.func
			local i = 1
			while true do
				local k
				if thread then k = debug.getlocal(thread, level, i) else k = debug.getlocal(level, i) end
				if not k then break end
				add(k)
				i = i + 1
			end
			break
		end
	end
	if func then
		local i = 1
		while true do
			local k = debug.getupvalue(func, i)
			if not k then break end
			add(k)
			i = i + 1
		end
		local env = getfenv(func)
		local piece = type(env) == "table" and rawget(env, "self") or nil
		if type(piece) == "table" then
			for k in pairs(piece) do add(k) end
			local mt = getmetatable(piece)
			local cls, depth = mt and mt.__index, 0
			while type(cls) == "table" and depth < 8 do
				for k in pairs(cls) do add(k) end
				mt = getmetatable(cls)
				cls, depth = mt and mt.__index, depth + 1
			end
			if type(piece.children) == "table" then
				for _, c in ipairs(piece.children) do add(c.name) end
			end
		end
	end
	local script = package.loaded["love.scene.script"]
	if script then
		for k in pairs(script.api) do add(k) end
		for k in pairs(script.pieceApi) do add(k) end
	end
	for k in pairs(_G) do
		if k ~= "love" then add(k) end
	end
	return names
end

---An error message in plain words. thread is the coroutine it happened in
---(nil: the running one, when called from an error handler).
function errors.explain(msg, thread)
	msg = stripEngine(tostring(msg))
	local where, what, name, rest = msg:match("^(.-:%d+:) attempt to (.-) global '([^']+)' %(a nil value%)(.*)$")
	if not where then return msg end
	local hint = ""
	local ok, names = pcall(namesAt, thread, where:match("^(.-):%d+:$"))
	if ok then
		for i = #names, 1, -1 do
			if names[i] == name then table.remove(names, i) end
		end
		hint = require("love.engine.util").didYouMean(name, names)
	end
	if what == "call" then
		return ("%s there's no function called \"%s\" here%s%s"):format(where, name, hint, rest)
	end
	if hint == "" then
		hint = (". Give it a value first, like %s = 0 at the top of the script"):format(name)
	end
	return ("%s \"%s\" has no value here: it's nil%s%s"):format(where, name, hint, rest)
end

---What to show for an error: the message in plain words and the game's
---frames of the traceback. msg may already end in a task's traceback
---(script.lua adds it); trace is the handler's own debug.traceback().
function errors.report(msg, trace, thread)
	msg = tostring(msg)
	local body, inner = msg, nil
	local at = msg:find("\nstack traceback:", 1, true)
	if at then body, inner = msg:sub(1, at - 1), msg:sub(at + 1) end
	local frames = errors.frames(inner)
	for _, line in ipairs(errors.frames(trace)) do
		if frames[#frames] ~= line then frames[#frames + 1] = line end
	end
	return errors.explain(body, thread), frames
end

return errors
