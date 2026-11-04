R"luastring"--(
-- DO NOT REMOVE THE ABOVE LINE. It is used to load this file as a C++ string.
-- There is a matching delimiter at the bottom of the file.

--[[
Copyright (c) 2006-2024 LOVE Development Team

This software is provided 'as-is', without any express or implied
warranty.  In no event will the authors be held liable for any damages
arising from the use of this software.

Permission is granted to anyone to use this software for any purpose,
including commercial applications, and to alter it and redistribute it
freely, subject to the following restrictions:

1. The origin of this software must not be misrepresented; you must not
   claim that you wrote the original software. If you use this software
   in a product, an acknowledgment in the product documentation would be
   appreciated but is not required.
2. Altered source versions must be plainly marked as such, and must not be
   misrepresented as being the original software.
3. This notice may not be removed or altered from any source distribution.
--]]

-- Smitten: this is LÖVE's boot.lua, cut down. A game is a project with a
-- smitten.json that names its main scene; there is no conf.lua, no
-- main.lua and no command line to parse. The player passes the game's zip
-- (or folder) as the only argument.

-- Make sure love exists.
local love = require("love")

-- Essential code boot/init.
require("love.callbacks")

local game_source = nil
local invalid_game_path = nil

-- This can't be overridden.
function love.boot()

	-- This is absolutely needed.
	require("love.filesystem")
	require("love.system")

	love.rawGameArguments = arg

	local arg0 = arg[-2] or "smitten"
	love.filesystem.init(arg0)
	love.filesystem.setFused(false)
	love.setDeprecationOutput(true)

	invalid_game_path = nil
	game_source = arg[1]

	local identity = "smitten"
	if game_source then
		if not pcall(love.filesystem.setSource, game_source) then
			invalid_game_path = game_source
		end
		-- The game's file name until smitten.json names it (love.engine).
		identity = game_source:gsub("[/\\]+$", ""):match("[^/\\]*$")
	end

	identity = identity:gsub("^([%.]+)", "") -- strip leading "."'s
	identity = identity:gsub("%.([^%.]+)$", "") -- strip extension
	identity = identity:gsub("%.", "_") -- replace remaining "."'s with "_"
	identity = #identity > 0 and identity or "smitten"

	pcall(love.filesystem.setIdentity, identity, true)
end

-- Why a game can't start, in words for the person who made it.
local function projectProblem()
	if not game_source then
		return "There's no game to play."
	end
	if invalid_game_path then
		return "The game at '" .. invalid_game_path .. "' couldn't be opened."
	end
	local fs = love.filesystem
	if fs.getInfo("smitten.json", "file") then
		return nil
	end
	if fs.getInfo("main.lua", "file") then
		return "This project has a main.lua but no smitten.json.\n\n"
			.. "Smitten doesn't run main.lua: a game starts from its main scene, set in smitten.json. "
			.. "Open the project in the Smitten editor to give it one."
	end
	return "This isn't a Smitten game: there's no smitten.json at the top of its files."
end

function love.init()

	-- Smitten: modules that are separate downloads, loaded on first use.
	love._optionalModules = { physics = true, video = true }

	-- Default configuration settings. Smitten games set what they need in
	-- smitten.json (love.engine).
	local c = {
		title = "Untitled",
		window = {
			width = 800,
			height = 600,
			x = nil,
			y = nil,
			minwidth = 1,
			minheight = 1,
			fullscreen = false,
			fullscreentype = "desktop",
			displayindex = 1,
			vsync = 1,
			msaa = 0,
			borderless = false,
			resizable = false,
			centered = true,
			usedpiscale = true,
		},
		modules = {
			data = true,
			event = true,
			keyboard = true,
			mouse = true,
			timer = true,
			joystick = true,
			touch = true,
			image = true,
			graphics = true,
			audio = true,
			math = true,
			physics = true,
			sensor = true,
			sound = true,
			system = true,
			font = true,
			window = true,
			video = true,
		},
		identity = false,
		appendidentity = false,
		highdpi = false,
		trackpadtouch = false,
	}

	if love._setGammaCorrect then
		love._setGammaCorrect(false)
	end

	if love._setLowPowerPreferred then
		love._setLowPowerPreferred(false)
	end

	if love._setRenderers then
		love._setRenderers(love._getDefaultRenderers())
	end

	if love._setHighDPIAllowed then
		love._setHighDPIAllowed(c.highdpi)
	end

	if love._setTrackpadTouch then
		love._setTrackpadTouch(c.trackpadtouch)
	end

	-- Gets desired modules.
	for k,v in ipairs{
		"data",
		"timer",
		"event",
		"keyboard",
		"joystick",
		"mouse",
		"touch",
		"sound",
		"system",
		"sensor",
		"audio",
		"image",
		"video",
		"font",
		"window",
		"graphics",
		"math",
		"physics",
	} do
		-- Builds without a module leave it out of package.preload; skip it
		-- instead of failing to boot. Smitten's optional modules (physics,
		-- video) load the first time a game uses them (love.engine).
		if c.modules[v] and package.preload["love." .. v] and not (love._optionalModules or {})[v] then
			require("love." .. v)
		end
	end

	if love.event then
		love.createhandlers()
	end

	-- Smitten: its own modules, helpers and the scene tree's hooks, and the
	-- project's smitten.json.
	local problem = projectProblem()
	require("love.engine").init(c)

	-- Setup window here.
	if c.window and c.modules.window then
		love.window.setTitle(c.window.title or c.title)
		assert(love.window.setMode(c.window.width, c.window.height,
		{
			fullscreen = c.window.fullscreen,
			fullscreentype = c.window.fullscreentype,
			vsync = c.window.vsync,
			msaa = c.window.msaa,
			stencil = c.window.stencil,
			depth = c.window.depth,
			resizable = c.window.resizable,
			minwidth = c.window.minwidth,
			minheight = c.window.minheight,
			borderless = c.window.borderless,
			centered = c.window.centered,
			displayindex = c.window.displayindex,
			usedpiscale = c.window.usedpiscale,
			x = c.window.x,
			y = c.window.y,
		}), "Could not set window mode")
	end

	-- The first couple event pumps on some systems (e.g. macOS) can take a
	-- while. We'd rather hit that slowdown here than in event processing
	-- within the first frames.
	if love.event then
		for i = 1, 2 do love.event.pump() end
	end

	-- Our first timestep, because window creation can take some time
	if love.timer then
		love.timer.step()
	end

	if love.filesystem then
		love.filesystem.setIdentity(c.identity or love.filesystem.getIdentity(), c.appendidentity)
	end

	if problem then
		error(problem, 0)
	end
end

local xpcall = xpcall
local coroutine_yield = coroutine.yield
local print, debug, tostring = print, debug, tostring

local function error_printer(msg, layer)
	print((debug.traceback("Error: " .. tostring(msg), 1+(layer or 1)):gsub("\n[^\n]+$", "")))
end

-----------------------------------------------------------
-- The root of all calls.
-----------------------------------------------------------

return function()
	local func
	local setModalDrawFunc = false
	local inerror = false

	local function deferErrhand(...)
		local errhand = love.errorhandler
		local handler = (not inerror and errhand) or error_printer
		inerror = true
		func = handler(...)
		inerror = false
	end

	local function earlyinit()
		func = nil

		-- If love.boot fails, return 1 and finish immediately
		local result = xpcall(love.boot, error_printer)
		if not result then return 1 end

		-- If love.init or love.run fails, don't return a value,
		-- as we want the error handler to take over
		result = xpcall(love.init, deferErrhand)
		if not result then return end

		-- NOTE: We can't assign to func directly, as we'd
		-- overwrite the result of deferErrhand with nil on error
		local main
		result, main = xpcall(love.run, deferErrhand)
		if result then
			func = main
			setModalDrawFunc = true
		elseif inerror then -- Error in error handler
			print("Error: " .. tostring(main))
		end
	end

	func = earlyinit
	local prevFunc = nil

	while func do
		if setModalDrawFunc and love.event and func ~= prevFunc then
			prevFunc = func
			love.event._setDefaultModalDrawCallback(func)
		end
		local _, retval, restartvalue = xpcall(func, deferErrhand)
		if retval then return retval, restartvalue end
		coroutine_yield()
	end

	return 1
end

-- DO NOT REMOVE THE NEXT LINE. It is used to load this file as a C++ string.
--)luastring"--"
