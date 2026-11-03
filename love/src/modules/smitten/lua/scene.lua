-- smitten.scene: a stack of scenes (title, game, pause, ...), each a table of
-- love callbacks. smitten.scene.go/restart (scene files with objects) are
-- built on it in world.lua.
--
--   local Title = {}
--   function Title:draw() love.graphics.print("Press a key", 10, 10) end
--   function Title:keypressed() smitten.scene.switch(Game) end
--   smitten.scene.switch(Title)
--
-- How callbacks reach scenes (also used by smitten.input): the first time a
-- scene is set, `callbacks.install()` takes love.update, love.draw, love.quit
-- and every callback named in love.handlers (keypressed, mousepressed, ...)
-- out of the `love` table and keeps them aside, and gives `love` a metatable:
--
-- * Reading love.update (as love.run and love.handlers do every frame/event)
--   returns a wrapper that runs the game's own function first, then the
--   "after" hooks (the current scene's method). When neither the game nor a
--   hook handles a callback, reading it gives nil, as before.
-- * Assigning love.update = f (even after install, e.g. main.lua defining
--   callbacks below its smitten.scene.switch call) stores f as the game's
--   function, so it keeps running first.
-- * Libraries that wrap callbacks themselves (local old = love.update;
--   love.update = function(...) old(...) ... end) still work: the hooks run
--   once, around the outermost call.
--
-- Games that never use scenes or input never install anything.

local callbacks = {}

local installed = false
local game = {}      -- callback name -> the game's own function
local names = {}     -- callback name -> true for every callback handled here
local before = {}    -- callback name -> list of functions run before the game's
local after = {}     -- callback name -> list of functions run after the game's
local wanted = {}    -- list of functions(name) -> true if a hook wants that callback now
local depth = {}     -- callback name -> nesting depth of running wrappers
local wrappers = {}  -- callback name -> { fn = game function it wraps, call = wrapper }

local CALLBACKS = {
	"update", "draw", "quit",
	"keypressed", "keyreleased", "textinput", "textedited", "mousemoved", "mousepressed", "mousereleased",
	"wheelmoved", "touchpressed", "touchreleased", "touchmoved", "joystickpressed", "joystickreleased",
	"joystickaxis", "joystickhat", "gamepadpressed", "gamepadreleased", "gamepadaxis", "joystickadded",
	"joystickremoved", "focus", "mousefocus", "visible", "resize", "filedropped", "directorydropped",
	"lowmemory", "threaderror",
}

local function runHooks(list, name, ...)
	local result
	for i = 1, #list do
		local r = list[i](name, ...)
		if r ~= nil and result == nil then result = r end
	end
	return result
end

local function makeWrapper(name, fn)
	return function(...)
		local d = (depth[name] or 0) + 1
		depth[name] = d
		if d == 1 and before[name] then runHooks(before[name], name, ...) end
		local result
		if fn then result = fn(...) end
		depth[name] = d - 1
		if d == 1 and after[name] then
			local r = runHooks(after[name], name, ...)
			if result == nil then result = r end
		end
		return result
	end
end

local function isWanted(name)
	if game[name] then return true end
	for i = 1, #wanted do
		if wanted[i](name) then return true end
	end
	return false
end

---Take over love's callbacks (once). See the comment at the top of this file.
function callbacks.install()
	if installed then return end
	installed = true
	for _, name in ipairs(CALLBACKS) do names[name] = true end
	if type(love.handlers) == "table" then
		for name in pairs(love.handlers) do names[name] = true end
	end
	for name in pairs(names) do
		game[name] = rawget(love, name)
		rawset(love, name, nil)
	end

	local mt = getmetatable(love) or {}
	local oldIndex, oldNewindex = mt.__index, mt.__newindex
	mt.__index = function(t, key)
		if names[key] then
			if not isWanted(key) then return nil end
			local fn = game[key]
			local w = wrappers[key]
			if not w or w.fn ~= fn then
				w = { fn = fn, call = makeWrapper(key, fn) }
				wrappers[key] = w
			end
			return w.call
		end
		if type(oldIndex) == "function" then return oldIndex(t, key) end
		if type(oldIndex) == "table" then return oldIndex[key] end
		return nil
	end
	mt.__newindex = function(t, key, value)
		if names[key] then
			game[key] = value
		elseif oldNewindex then
			if type(oldNewindex) == "function" then oldNewindex(t, key, value) else oldNewindex[key] = value end
		else
			rawset(t, key, value)
		end
	end
	setmetatable(love, mt)
end

-- Handle one more callback name after install.
local function adopt(name)
	callbacks.install()
	if names[name] then return end
	names[name] = true
	game[name] = rawget(love, name)
	rawset(love, name, nil)
end

---Run fn(name, ...) before the game's callback `name` (e.g. "update").
---@param name string
---@param fn function
function callbacks.before(name, fn)
	adopt(name)
	before[name] = before[name] or {}
	table.insert(before[name], fn)
end

---Run fn(name, ...) after the game's callback `name`. A non-nil result is
---returned to LÖVE if the game's function returned nil (love.quit uses it).
---@param name string
---@param fn function
function callbacks.after(name, fn)
	adopt(name)
	after[name] = after[name] or {}
	table.insert(after[name], fn)
end

---Make love.<name> exist whenever wants(name) returns true, even if the game
---doesn't define it (so love.run calls it).
---@param wants fun(name: string): boolean
function callbacks.want(wants)
	callbacks.install()
	wanted[#wanted + 1] = wants
end

---The game's own function for a callback (nil if it has none).
---@param name string
---@return function?
function callbacks.game(name)
	if installed then return game[name] end
	return rawget(love, name)
end

-------------------------------------------------------------------------------
-- Scenes

local scene = {}

local stack = {}

local function call(s, method, ...)
	local f = s[method]
	if f ~= nil then return f(s, ...) end
end

-- Scenes drawn this frame: the top one, and the ones below it as long as the
-- scene above has `transparent = true`.
local function visibleScenes()
	local n = #stack
	local lowest = n
	while lowest > 1 and stack[lowest].transparent do lowest = lowest - 1 end
	local list = {}
	for i = lowest, n do list[#list + 1] = stack[i] end
	return list
end

local function dispatch(name, ...)
	local n = #stack
	if n == 0 then return nil end
	if name == "draw" then
		for _, s in ipairs(visibleScenes()) do
			if s.draw then s:draw(...) end
		end
		return nil
	end
	local top = stack[n]
	local f = top[name]
	if f ~= nil then return f(top, ...) end
end

local function wants(name)
	local n = #stack
	if n == 0 then return false end
	if name == "draw" then
		for _, s in ipairs(visibleScenes()) do
			if s.draw then return true end
		end
		return false
	end
	return stack[n][name] ~= nil
end

local hooked = false
local function hook()
	if hooked then return end
	hooked = true
	callbacks.install()
	for name in pairs(names) do callbacks.after(name, dispatch) end
	callbacks.want(wants)
end

local function checkScene(s, what)
	if type(s) ~= "table" then
		error(("smitten.scene.%s: expected a scene (a table of callbacks), got %s"):format(what, type(s)), 3)
	end
end

---Replace the current scene: calls the old one's leave(), then s:enter(...).
---@param s table the scene
---@param ... any passed to s:enter
function scene.switch(s, ...)
	checkScene(s, "switch")
	hook()
	local n = #stack
	if n > 0 then
		local old = stack[n]
		call(old, "leave")
		stack[#stack] = s
	else
		stack[1] = s
	end
	call(s, "enter", ...)
end

---Put a scene on top of the current one: calls the current scene's pause(),
---then s:enter(...). The scene below stops updating, and draws only if the
---top scene has `transparent = true`.
---@param s table
---@param ... any passed to s:enter
function scene.push(s, ...)
	checkScene(s, "push")
	hook()
	local n = #stack
	if n > 0 then call(stack[n], "pause") end
	stack[#stack + 1] = s
	call(s, "enter", ...)
end

---Leave the current scene and go back to the one below; calls the current
---scene's leave(), then the one below's resume(...).
---@param ... any passed to resume
function scene.pop(...)
	local n = #stack
	if n < 2 then
		error(n == 0 and "smitten.scene.pop: there's no scene to leave"
			or "smitten.scene.pop: there's no scene below the current one (use smitten.scene.switch to change it)", 2)
	end
	local old = stack[n]
	call(old, "leave")
	stack[n] = nil
	call(stack[n - 1], "resume", ...)
end

---The current (top) scene, or nil.
---@return table?
function scene.current()
	return stack[#stack]
end

---How many scenes are on the stack.
---@return integer
function scene.depth()
	return #stack
end

---The name of the scene started with smitten.scene.go ("level1"), or nil.
---@type string?
scene.name = nil

---The map of the scene started with smitten.scene.go (getTile, isSolid, ...),
---or nil if it has no .scene.json.
---@type smitten.Map?
scene.map = nil

---Go to a scene: scenes/<name>.scene.json and/or scenes/<name>.lua, with its
---objects (docs/objects-and-scenes.md). The current scene's objects, timers
---and tweens end. Called during a frame, the switch happens at its end.
---@param name string e.g. "level1"
---@param ... any passed to the scene script's enter(...)
function scene.go(name, ...)
	require("smitten.world").go(name, ...)
end

---Start the current scene (from smitten.scene.go) again, from its file.
function scene.restart()
	require("smitten.world").restart()
end

return { scene = scene, callbacks = callbacks }
