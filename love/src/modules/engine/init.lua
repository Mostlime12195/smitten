-- The engine at run time (DESIGN.md, section 2):
--
-- * Smitten's own modules (smitten.scene, smitten.input, ...) and the
--   optional ones (smitten.physics, smitten.video, ...) load the first
--   time a game uses them.
-- * Helpers join the module they belong to: smitten.math.chance,
--   smitten.timer.after, smitten.mouse.pressed, smitten.keyboard.pressed.
-- * A project's smitten.json sets up the display, input actions and the
--   main scene, and love.run (callbacks.lua) drives the scene tree through
--   this module.
-- * Game code (scripts and the Lua files they require) runs with
--   smitten.* and Lua's globals, without the engine's internal name, love.

local engine = {}

-- Modules loaded on first use, as love.<name>.
local LAZY = {
	scene = true, input = true, tween = true, json = true, assets = true, storage = true, display = true,
	synth = true, physics = true, video = true, paths = true, boards = true, text = true,
}

engine.project = nil   -- smitten.json, decoded (nil if the game has none: boot.lua says why)

local function installLazyModules()
	local mt = getmetatable(love) or {}
	local old = mt.__index
	mt.__index = function(t, k)
		if LAZY[k] and package.preload["love." .. k] then
			local m = require("love." .. k)
			rawset(t, k, m)
			return m
		end
		if type(old) == "function" then return old(t, k) end
		if type(old) == "table" then return old[k] end
		return nil
	end
	setmetatable(love, mt)
end

local function scene()
	return package.loaded["love.scene"]
end

local function extendModules()
	local input = require("love.input")
	local display = require("love.display")

	if love.math then
		local m = love.math
		---True with the given probability: chance(0.25) is true a quarter of the time.
		function m.chance(p) return m.random() < p end
		---A random element of a list.
		function m.pick(list) return list[m.random(1, #list)] end
		function m.clamp(v, lo, hi) return v < lo and lo or v > hi and hi or v end
		function m.lerp(a, b, t) return a + (b - a) * t end
		---v moved towards target by at most step.
		function m.approach(v, target, step)
			if v < target then return math.min(v + step, target) end
			return math.max(v - step, target)
		end
		function m.sign(v) return v > 0 and 1 or v < 0 and -1 or 0 end
		---v rounded to the nearest multiple of step (default 1).
		function m.round(v, step)
			step = step or 1
			return math.floor(v / step + 0.5) * step
		end
		function m.distance(x1, y1, x2, y2) return math.sqrt((x2 - x1) ^ 2 + (y2 - y1) ^ 2) end
		function m.angle(x1, y1, x2, y2) return math.atan2(y2 - y1, x2 - x1) end
		---A random number with a fraction, from a to b.
		function m.randomFloat(a, b) return a + (b - a) * m.random() end
	end

	if love.timer then
		---Calls fn once, after some seconds. Returns a handle with :cancel().
		function love.timer.after(seconds, fn) return require("love.tween").after(seconds, fn) end
		---Calls fn every so many seconds, until it returns false.
		function love.timer.every(seconds, fn) return require("love.tween").every(seconds, fn) end
	end

	if love.audio then
		-- The short API's sound calls (scene/audio.lua), for any code.
		local a = love.audio
		local function sound() return require("love.scene.audio") end
		local function find(name) return require("love.scene.script").soundPath(name, 3) end
		---Plays a sound once: smitten.audio.sfx("coin", { volume = 0.5 }).
		function a.sfx(name, volume, pitch) return sound().sfx(find(name), volume, pitch) end
		---Plays music on a loop instead of the music playing.
		function a.music(name, options) return sound().music(find(name), options) end
		function a.stopMusic(fade) return sound().stopMusic(fade) end
		function a.pauseMusic() return sound().pauseMusic() end
		function a.resumeMusic() return sound().resumeMusic() end
		---The Source playing the music, or nil.
		function a.getMusic() return sound().currentMusic() end
	end

	if love.keyboard then
		---True on the frame a key went down.
		function love.keyboard.pressed(key) return input._rawPressed(key) end
		---True on the frame a key went up.
		function love.keyboard.released(key) return input._rawReleased(key) end
	end

	if love.mouse then
		local mouse = love.mouse
		function mouse.pressed(button) return input._rawPressed("mouse:" .. (button or 1)) end
		function mouse.released(button) return input._rawReleased("mouse:" .. (button or 1)) end
		function mouse.down(button) return mouse.isDown(button or 1) end
		-- While a finger stands in for the mouse (scene/touch.lua: another
		-- finger is on a touch control), the mouse is where that finger is.
		local getPosition = mouse.getPosition
		function mouse.getPosition()
			local f = input._finger
			if f then return f[1], f[2] end
			return getPosition()
		end
		function mouse.getX() return (mouse.getPosition()) end
		function mouse.getY() return select(2, mouse.getPosition()) end
		---How far the mouse moved this frame: dx, dy (also while it's captured).
		function mouse.getDelta() return input._mouseDelta() end
		---True while the pointer is over a UI button or panel.
		function mouse.isOverUI()
			local ui = package.loaded["love.scene.ui"]
			return ui ~= nil and ui.isPointerOver()
		end
		-- x, y in game coordinates; worldX, worldY in the 2D scene's.
		local mt = getmetatable(mouse) or {}
		local old = mt.__index
		mt.__index = function(t, k)
			if k == "x" or k == "y" or k == "worldX" or k == "worldY" then
				local gx, gy = display.toGame(mouse.getPosition())
				if k == "x" then return gx elseif k == "y" then return gy end
				local wx, wy = require("love.scene.nodes2d").toWorld(gx, gy)
				return k == "worldX" and wx or wy
			end
			if type(old) == "function" then return old(t, k) end
			if type(old) == "table" then return old[k] end
		end
		setmetatable(mouse, mt)
	end
end

local INPUT_EVENTS = {
	"keypressed", "keyreleased", "mousepressed", "mousereleased", "mousemoved", "wheelmoved", "textinput",
	"gamepadpressed", "gamepadreleased", "gamepadaxis", "focus",
	"touchpressed", "touchmoved", "touchreleased", "joystickadded", "joystickremoved",
}

-- What a pointer does: the touch pieces (scene/touch.lua) see these first.
local POINTER = {
	mousepressed = true, mousereleased = true, mousemoved = true,
	touchpressed = true, touchmoved = true, touchreleased = true,
}

---A mouse event for the game and its UI: a real one, or one made from a
---finger by scene/touch.lua. x, y are the window's.
function engine._mouse(name, x, y, c, d, e)
	require("love.input")._event(name, x, y, c, d, e)
	if (name == "mousepressed" or name == "mousereleased") and scene() then
		local gx, gy = require("love.display").toGame(x, y)
		scene()._uiInput(name == "mousepressed" and "pressed" or "released", gx, gy, c)
	end
end

local function hookHandlers()
	local input = require("love.input")
	local handlers = love.handlers
	local loaded = package.loaded
	for _, name in ipairs(INPUT_EVENTS) do
		local orig = handlers[name]
		local pointer = POINTER[name]
		local mouse = name == "mousepressed" or name == "mousereleased"
		if orig then
			handlers[name] = function(a, b, c, d, e, f, ...)
				-- A scene with touch pieces: a touch on one of them is theirs,
				-- and not a click as well.
				local touch = loaded["love.scene.touch"]
				if touch and touch.count > 0 then
					if pointer then
						if touch.event(name, a, b, c, d, e) then return end
					elseif name == "focus" and not a then
						touch.releaseAll()
					end
				end
				if mouse then
					engine._mouse(name, a, b, c, d, e)
				else
					input._event(name, a, b, c, d, e)
				end
				return orig(a, b, c, d, e, f, ...)
			end
		end
	end
end

local function readProject()
	if not (love.filesystem and love.filesystem.getInfo("smitten.json", "file")) then return nil end
	local ok, data = pcall(require("love.assets").readJSON, "smitten.json")
	if not ok then
		print("smitten.json: " .. tostring(data))
		return nil
	end
	return type(data) == "table" and data or nil
end

-- What game code sees as globals: Lua's, the game's own and smitten, but
-- not love (the engine's internal name for the same table). Globals a game
-- sets are shared by all its code; one named love stays the game's own.
local HIDDEN = { love = true }
local globals
globals = setmetatable({}, {
	__index = function(_, k)
		if k == "_G" then return globals end
		if HIDDEN[k] then return nil end
		return _G[k]
	end,
	__newindex = function(t, k, v)
		if HIDDEN[k] then rawset(t, k, v) else _G[k] = v end
	end,
})
engine.globals = globals

-- Lua files a game requires get the same globals as its scripts. The first
-- searcher is package.preload, the engine's own modules.
local function wrapSearchers()
	local searchers = package.loaders
	for i = 2, #searchers do
		local search = searchers[i]
		searchers[i] = function(name)
			local found = search(name)
			if type(found) == "function" and debug.getinfo(found, "S").what ~= "C" then
				setfenv(found, globals)
			end
			return found
		end
	end
end

---Called by boot.lua once the modules are loaded.
function engine.init(conf)
	love.version = "0.2.0"
	installLazyModules()
	extendModules()
	hookHandlers()
	wrapSearchers()
	local project = readProject()
	engine.project = project
	if project then
		-- Saves (smitten.storage) belong to the game: its folder is named
		-- after the project, unless smitten.json names one.
		if not conf.identity then
			local id = type(project.identity) == "string" and project.identity or project.name
			id = type(id) == "string" and id:lower():gsub("[^%w]+", "-"):gsub("^%-+", ""):gsub("%-+$", "") or ""
			if id ~= "" then conf.identity = "smitten-" .. id end
		end
		if love.graphics then
			local display = require("love.display")
			display.setup(project.display)
			-- The window the display needs (boot.lua opens it after this):
			-- resizable, so the player can make it fill the page; at the
			-- screen's real resolution; multisampled for smooth edges.
			local win = display._windowSettings()
			if conf.window then
				conf.window.width, conf.window.height = win.width, win.height
				conf.window.resizable = win.resizable
				conf.window.msaa = win.msaa
				conf.window.usedpiscale = true
			end
			if love._setHighDPIAllowed then love._setHighDPIAllowed(win.highdpi) end
			-- For the web page around the game (the player hands it on):
			-- the sharing site gives the game its shape.
			if love.system and love.system.getOS() == "Web" then
				print("\1display " .. require("love.json").encode({
					width = display.width, height = display.height, stretch = display.stretch,
				}))
			end
		end
		require("love.input")._configure(project.input)
		-- boot.lua opens the window after this, with this title.
		local untitled = (conf.window and conf.window.title or conf.title) == "Untitled"
		if type(project.name) == "string" and conf.window and untitled then
			conf.window.title = project.name
		end
	end
	love._engine = engine
end

-- The scene to start with: the one the editor's "Play this scene" chose,
-- else the project's main scene.
local function startScene()
	local file = love.filesystem.getInfo(".smitten/start", "file") and love.filesystem.read(".smitten/start")
	if file and file:match("%S") then return (file:gsub("%s+$", "")) end
	local project = engine.project
	if project and type(project.main) == "string" and project.main ~= "" then return project.main end
	return nil
end

---Starts the main scene (love.run calls it before the first frame).
function engine.start()
	require("love.input")._start()
	if not engine.project then return end
	local path = startScene()
	if not path then
		error("smitten.json names no main scene: choose one in Project settings (\"main\" in smitten.json).", 0)
	end
	if not (scene() and scene().current) then
		love.scene.go(path)
	end
end

function engine.update(dt)
	if love._livePoll then require("love.engine.live").poll() end
	local s = scene()
	-- smitten.scene.timeScale slows the game down or speeds it up; music
	-- fades and scene transitions go at the real speed.
	local scaled = dt * (s and s.timeScale or 1)
	local tween = package.loaded["love.tween"]
	if tween then tween._update(scaled) end
	local sound = package.loaded["love.scene.audio"]
	if sound then sound._update(dt) end
	if s then s._update(scaled, dt) end
end

function engine.draw()
	local display = require("love.display")
	display.begin()
	local s = scene()
	if s and s.current then s._draw() end
	display.finish()
end

function engine.endFrame()
	require("love.input")._endFrame()
end

return engine
