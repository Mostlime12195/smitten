-- smitten.input: named actions for keys, mouse buttons and gamepads.
--
--   if smitten.input.pressed("jump") then ... end
--   local dx = smitten.input.axis("left", "right")         -- -1 to 1
--   local x, y = smitten.input.vector("left", "right", "up", "down")
--   smitten.input.bind("dash", { "lshift", "pad:rightshoulder" })
--
-- Input names: a key ("space", "a", "left"), "mouse:1", "pad:a" (a gamepad
-- button), "axis:leftx-" / "axis:leftx+" (half of a stick or trigger),
-- "wheel:up" / "wheel:down" (the mouse wheel; pressed for one frame).
-- Actions come from Project settings > Input (smitten.json "input"), on top
-- of the defaults below. pressed(), down() and released() also take an
-- input name that isn't an action: pressed("space"), down("mouse:2").
-- love.engine feeds events in and ends each frame.

local input = {}

local DEFAULTS = {
	left = { "left", "a", "pad:dpleft", "axis:leftx-" },
	right = { "right", "d", "pad:dpright", "axis:leftx+" },
	up = { "up", "w", "pad:dpup", "axis:lefty-" },
	down = { "down", "s", "pad:dpdown", "axis:lefty+" },
	jump = { "space", "pad:a" },
	fire = { "x", "j", "mouse:1", "pad:x" },
	accept = { "return", "space", "pad:a" },
	cancel = { "escape", "backspace", "pad:b" },
	pause = { "escape", "p", "pad:start" },
}

local actions = {}       -- name -> list of input names
local down = {}          -- input name -> true while held
local pressedAt = {}     -- input name -> frame it went down
local releasedAt = {}    -- input name -> frame it went up
local axes = {}          -- "axis:leftx+" -> 0..1
local frame = 1
local DEADZONE = 0.25
local mouseDX, mouseDY = 0, 0  -- mouse movement this frame
local wheelX, wheelY = 0, 0    -- wheel movement this frame
local typedText = ""           -- text typed this frame
local lastName, lastFrame = nil, 0  -- the last input pressed, and when
local single = {}              -- input name -> { name } (or false), for pressed("space")

local function reset()
	actions = {}
	for k, v in pairs(DEFAULTS) do
		local copy = {}
		for i, x in ipairs(v) do copy[i] = x end
		actions[k] = copy
	end
end
reset()

---Sets up actions from a project's settings: { action = { inputs } }.
function input._configure(map)
	reset()
	if type(map) ~= "table" then return end
	for name, list in pairs(map) do
		if type(list) == "table" then actions[name] = list end
	end
end

local function unknown(action, level)
	local names = {}
	for n in pairs(actions) do names[#names + 1] = n end
	error(("there's no input action or key called %q%s (add actions in Project settings > Input)")
		:format(tostring(action), require("love.engine.util").didYouMean(tostring(action), names)), level + 1)
end

local KEYS = {}
for k in ([[space return escape backspace tab delete insert home end pageup pagedown up down left right
	lshift rshift lctrl rctrl lalt ralt lgui rgui capslock numlock scrolllock printscreen pause menu
	application mode help sysreq clear undo cut copy paste find mute volumeup volumedown kpenter
	www mail calculator computer appsearch apphome appback appforward apprefresh appbookmarks
	power currencyunit]]):gmatch("%S+") do KEYS[k] = true end

---True if a name is an input (a key, "mouse:1", "pad:a", "axis:leftx+", "wheel:up").
local function isInputName(name)
	if type(name) ~= "string" then return false end
	if name:find(":", 1, true) then
		return (name:match("^mouse:%d+$") or name:match("^pad:%w+$") or name:match("^axis:%w+[%+%-]$")
			or name:match("^wheel:%a+$")) ~= nil
	end
	-- LÖVE's key names (SDL takes any name, so they're listed here).
	if #name == 1 then return name ~= " " end
	return KEYS[name] == true or name:match("^f%d%d?$") ~= nil or name:match("^kp.$") ~= nil
end
input.isInputName = isInputName

-- The inputs of an action, or of a single input used as one.
local function listOf(action, level)
	local list = actions[action]
	if list then return list end
	local s = single[action]
	if s == nil then
		s = isInputName(action) and { action } or false
		if type(action) == "string" then single[action] = s end
	end
	if s then return s end
	unknown(action, level + 1)
end

local function strengthOf(name)
	if down[name] then return 1 end
	local a = axes[name]
	if a and a > DEADZONE then return (a - DEADZONE) / (1 - DEADZONE) end
	return 0
end

---How far an action is pushed: 0 to 1 (sticks give values in between).
function input.strength(action)
	local list = listOf(action, 2)
	local best = 0
	for i = 1, #list do
		local s = strengthOf(list[i])
		if s > best then best = s end
	end
	return best
end

---True while the action is held.
function input.down(action)
	return input.strength(action) > 0
end

---True on the frame the action went down. With no action: true if any key,
---mouse button or gamepad button went down this frame.
function input.pressed(action)
	if action == nil then return lastFrame == frame end
	local list = listOf(action, 2)
	for i = 1, #list do
		if pressedAt[list[i]] == frame then return true end
	end
	return false
end

---True on the frame the action went up.
function input.released(action)
	local list = listOf(action, 2)
	local any = false
	for i = 1, #list do
		if releasedAt[list[i]] == frame then any = true end
		if strengthOf(list[i]) > 0 then return false end
	end
	return any
end

---From -1 (negative held) to 1 (positive held); sticks give values between.
function input.axis(negative, positive)
	return input.strength(positive) - input.strength(negative)
end

---A direction from four actions, at most 1 long: x, y.
function input.vector(left, right, up, down_)
	local x, y = input.axis(left, right), input.axis(up, down_)
	local len = math.sqrt(x * x + y * y)
	if len > 1 then x, y = x / len, y / len end
	return x, y
end

---Adds or replaces an action.
function input.bind(action, inputs)
	if type(inputs) == "string" then inputs = { inputs } end
	actions[action] = inputs
end

function input.unbind(action)
	actions[action] = nil
end

---The inputs bound to an action.
function input.bindings(action)
	local out = {}
	for i, v in ipairs(actions[action] or {}) do out[i] = v end
	return out
end

---The input pressed this frame ("space", "mouse:1", "pad:a"), or nil: for
---"press a key for jump" screens, with bind().
function input.lastPressed()
	if lastFrame == frame then return lastName end
	return nil
end

---Every action's name.
function input.actions()
	local out = {}
	for n in pairs(actions) do out[#out + 1] = n end
	table.sort(out)
	return out
end

---------------------------------------------------------------------------
-- Raw input, also used by smitten.keyboard and smitten.mouse additions

function input._rawPressed(name) return pressedAt[name] == frame end
function input._rawReleased(name) return releasedAt[name] == frame end
function input._rawDown(name) return down[name] == true end

local function press(name)
	if not down[name] then
		down[name] = true
		pressedAt[name] = frame
		lastName, lastFrame = name, frame
	end
end

local function release(name)
	if down[name] then
		down[name] = nil
		releasedAt[name] = frame
	end
end

---love.engine forwards events here: (event name, LÖVE's arguments).
function input._event(name, a, b, c, d, e)
	if name == "keypressed" then press(a)
	elseif name == "keyreleased" then release(a)
	elseif name == "mousepressed" then press("mouse:" .. tostring(c))
	elseif name == "mousereleased" then release("mouse:" .. tostring(c))
	elseif name == "gamepadpressed" then press("pad:" .. b)
	elseif name == "gamepadreleased" then release("pad:" .. b)
	elseif name == "gamepadaxis" then
		local v = c
		local pos, neg = "axis:" .. b .. "+", "axis:" .. b .. "-"
		local was = { (axes[pos] or 0) > 0.5, (axes[neg] or 0) > 0.5 }
		axes[pos], axes[neg] = math.max(0, v), math.max(0, -v)
		-- Sticks count as pressed when they pass halfway.
		if axes[pos] > 0.5 and not was[1] then pressedAt[pos] = frame end
		if axes[pos] <= 0.5 and was[1] then releasedAt[pos] = frame end
		if axes[neg] > 0.5 and not was[2] then pressedAt[neg] = frame end
		if axes[neg] <= 0.5 and was[2] then releasedAt[neg] = frame end
	elseif name == "mousemoved" then
		mouseDX, mouseDY = mouseDX + c, mouseDY + d
	elseif name == "wheelmoved" then
		wheelX, wheelY = wheelX + a, wheelY + b
		local dir = b > 0 and "wheel:up" or b < 0 and "wheel:down" or a > 0 and "wheel:right" or a < 0 and "wheel:left"
		if dir then
			pressedAt[dir], releasedAt[dir] = frame, frame
			lastName, lastFrame = dir, frame
		end
	elseif name == "textinput" then
		typedText = typedText .. a
	elseif name == "focus" and not a then
		-- Keys released while the window is in the background never arrive.
		for k in pairs(down) do release(k) end
	end
end

---How far the mouse moved this frame: dx, dy (works with relative mode).
function input._mouseDelta()
	return mouseDX, mouseDY
end

---How far the mouse wheel turned this frame: x, y (y > 0 is up, away from you).
function input.wheel()
	return wheelX, wheelY
end

---The text typed this frame ("" if none). The first call turns text input
---on (on phones, that shows the keyboard); smitten.keyboard.setTextInput(false)
---turns it off.
function input.typed()
	local kb = love.keyboard
	if kb and kb.hasTextInput and not kb.hasTextInput() then kb.setTextInput(true) end
	return typedText
end

---The fingers on the screen: a list of { id, x, y, worldX, worldY } (x, y in
---game coordinates, worldX, worldY in the scene).
function input.touches()
	local out = {}
	local touch = love.touch
	if not touch then return out end
	local display = require("love.display")
	local toWorld = require("love.scene.nodes2d").toWorld
	for i, id in ipairs(touch.getTouches()) do
		local x, y = display.toGame(touch.getPosition(id))
		local wx, wy = toWorld(x, y)
		out[i] = { id = id, x = x, y = y, worldX = wx, worldY = wy }
	end
	return out
end

-- Gamepads, in the order they were connected (player 1 first).
local function gamepad(player)
	local js = love.joystick
	if not js then return nil end
	local n = 0
	for _, j in ipairs(js.getJoysticks()) do
		if j:isGamepad() then
			n = n + 1
			if n == (player or 1) then return j end
		end
	end
	return nil
end

---How many gamepads are connected.
function input.gamepads()
	local js = love.joystick
	if not js then return 0 end
	local n = 0
	for _, j in ipairs(js.getJoysticks()) do
		if j:isGamepad() then n = n + 1 end
	end
	return n
end

---A gamepad stick, "left" or "right": x, y from -1 to 1 (0, 0 inside the
---dead zone). player picks the gamepad (default 1).
function input.stick(side, player)
	if side ~= "left" and side ~= "right" then error('stick() needs "left" or "right"', 2) end
	local j = gamepad(player)
	if not j then return 0, 0 end
	local x, y = j:getGamepadAxis(side .. "x"), j:getGamepadAxis(side .. "y")
	local len = math.sqrt(x * x + y * y)
	if len < DEADZONE then return 0, 0 end
	local k = math.min(1, (len - DEADZONE) / (1 - DEADZONE)) / len
	return x * k, y * k
end

---A gamepad trigger, "left" or "right": 0 to 1.
function input.trigger(side, player)
	if side ~= "left" and side ~= "right" then error('trigger() needs "left" or "right"', 2) end
	local j = gamepad(player)
	if not j then return 0 end
	return math.max(0, j:getGamepadAxis("trigger" .. side))
end

---Rumbles gamepads: strength 0 to 1, for some seconds (every gamepad, or
---one player's). Returns false if nothing can rumble.
function input.vibrate(strength, seconds, player)
	local js = love.joystick
	if not js then return false end
	strength = math.max(0, math.min(1, strength or 0.5))
	local any = false
	for i, j in ipairs(player and { gamepad(player) } or js.getJoysticks()) do
		if j:isVibrationSupported() and j:setVibration(strength, strength, seconds or 0.2) then any = true end
	end
	return any
end

function input._endFrame()
	frame = frame + 1
	mouseDX, mouseDY = 0, 0
	wheelX, wheelY = 0, 0
	typedText = ""
end

return input
