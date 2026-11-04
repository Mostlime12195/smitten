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

local love = require("love")

-- Smitten: events go to the engine (love.engine hooks the input events into
-- smitten.input and the UI), not to LÖVE-style callbacks on the engine
-- table; games react to them in scripts.
function love.createhandlers()
	local function ignore() end
	love.handlers = setmetatable({
		lowmemory = function ()
			collectgarbage()
			collectgarbage()
		end,
	}, {
		__index = function(self, name)
			return ignore
		end,
	})
end

-----------------------------------------------------------
-- The main loop.
-----------------------------------------------------------

-- Smitten: every frame runs the scene tree, input actions and timers
-- (love.engine), which starts the project's main scene.
function love.run()
	local engine = love._engine
	engine.start()

	-- The first frame's dt shouldn't include the time the scene took to load.
	if love.timer then love.timer.step() end

	return function()
		-- Process events.
		if love.event then
			love.event.pump()
			for name, a,b,c,d,e,f,g,h in love.event.poll() do
				if name == "quit" then
					return a or 0, b
				end
				love.handlers[name](a,b,c,d,e,f,g,h)
			end
		end

		local dt = love.timer and love.timer.step() or 0
		engine.update(dt)

		if love.graphics and love.graphics.isActive() then
			love.graphics.origin()
			love.graphics.clear(love.graphics.getBackgroundColor())
			engine.draw()
			love.graphics.present()
		end

		engine.endFrame()
	end
end

local pcall, table = pcall, table
local debug, print, tostring, error = debug, print, tostring, error

local utf8 = require("utf8")

local function error_printer(msg, layer)
	print((debug.traceback("Error: " .. tostring(msg), 1+(layer or 1)):gsub("\n[^\n]+$", "")))
end

function love.errorhandler(msg)
	msg = tostring(msg)

	error_printer(msg, 2)

	if not love.window then
		return
	end

	if not love.graphics or not love.event or not love.graphics.isCreated() or not love.window.isOpen() then
		local success, status
		if love.graphics and love.event then
			success, status = pcall(love.window.setMode, 800, 600)
		end
		if not success or not status then
			love.window.showMessageBox("Initialization error", msg, "error", false)
			return
		end
	end

	-- Reset state.
	if love.mouse then
		love.mouse.setVisible(true)
		love.mouse.setGrabbed(false)
		love.mouse.setRelativeMode(false)
		if love.mouse.isCursorSupported() then
			love.mouse.setCursor()
		end
	end
	if love.joystick then
		-- Stop all joystick vibrations.
		for i,v in ipairs(love.joystick.getJoysticks()) do
			v:setVibration()
		end
	end
	if love.audio then love.audio.stop() end

	love.graphics.reset()
	love.graphics.setFont(love.graphics.newFont(15))

	love.graphics.setColor(1, 1, 1)

	local trace = debug.traceback()

	love.graphics.origin()

	local sanitizedmsg = {}
	for char in msg:gmatch(utf8.charpattern) do
		table.insert(sanitizedmsg, char)
	end
	sanitizedmsg = table.concat(sanitizedmsg)

	local err = {}

	table.insert(err, "Error\n")
	table.insert(err, sanitizedmsg)

	if #sanitizedmsg ~= #msg then
		table.insert(err, "Invalid UTF-8 string in error message.")
	end

	table.insert(err, "\n")

	for l in trace:gmatch("([^\n]+)") do
		if not l:match("boot.lua") then
			l = l:gsub("stack traceback:", "Traceback\n")
			table.insert(err, l)
		end
	end

	local p = table.concat(err, "\n")

	p = p:gsub("\t", "")
	p = p:gsub("%[string \"(.-)\"%]", "%1")

	local function draw()
		if not love.graphics.isActive() then return end
		local pos = 60
		love.graphics.clear(89/255, 157/255, 220/255)
		love.graphics.printf(p, pos, pos, love.graphics.getWidth() - pos)
		love.graphics.present()
	end

	local fullErrorText = p
	local function copyToClipboard()
		if not love.system then return end
		love.system.setClipboardText(fullErrorText)
		p = p .. "\nCopied to clipboard!"
	end

	if love.system then
		p = p .. "\n\nPress Ctrl+C or tap to copy this error"
	end

	return function()
		love.event.pump(0.1)

		for e, a, b, c in love.event.poll() do
			if e == "quit" then
				-- Also handle restart args.
				return a or 1, b
			elseif e == "keypressed" and a == "escape" then
				return 1
			elseif e == "keypressed" and a == "c" and love.keyboard.isDown("lctrl", "rctrl") then
				copyToClipboard()
			elseif e == "touchpressed" then
				local name = love.window.getTitle()
				if #name == 0 or name == "Untitled" then name = "Game" end
				local buttons = {"OK", "Cancel"}
				if love.system then
					buttons[3] = "Copy to clipboard"
				end
				local pressed = love.window.showMessageBox("Quit "..name.."?", "", buttons)
				if pressed == 1 then
					return 1
				elseif pressed == 3 then
					copyToClipboard()
				end
			end
		end

		draw()

		if love.timer then
			love.timer.sleep(0.001)
		end
	end

end

-- DO NOT REMOVE THE NEXT LINE. It is used to load this file as a C++ string.
--)luastring"--"
