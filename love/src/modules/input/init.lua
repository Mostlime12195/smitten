-- smitten.input: named actions for keys, mouse buttons and gamepads.
--
--   if smitten.input.pressed("jump") then ... end
--   local dx = smitten.input.axis("left", "right")         -- -1 to 1
--   local x, y = smitten.input.vector("left", "right", "up", "down")
--   smitten.input.bind("dash", { "lshift", "pad:rightshoulder" })
--
-- Input names: a key ("space", "a", "left"), "mouse:1", "pad:a" (a gamepad
-- button), "axis:leftx-" / "axis:leftx+" (half of a stick or trigger).
-- Actions come from Project settings > Input (smitten.json "input"), on top
-- of the defaults below. love.engine feeds events in and ends each frame.

local input = {}

local DEFAULTS = {
	left = { "left", "a", "pad:dpleft", "axis:leftx-" },
	right = { "right", "d", "pad:dpright", "axis:leftx+" },
	up = { "up", "w", "pad:dpup", "axis:lefty-" },
	down = { "down", "s", "pad:dpdown", "axis:lefty+" },
	jump = { "space", "up", "w", "pad:a" },
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
	error(("there's no input action called %q%s (add it in Project settings > Input)")
		:format(tostring(action), require("love.engine.util").didYouMean(tostring(action), names)), level + 1)
end

local function strengthOf(name)
	if down[name] then return 1 end
	local a = axes[name]
	if a and a > DEADZONE then return (a - DEADZONE) / (1 - DEADZONE) end
	return 0
end

---How far an action is pushed: 0 to 1 (sticks give values in between).
function input.strength(action)
	local list = actions[action]
	if not list then unknown(action, 2) end
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

---True on the frame the action went down.
function input.pressed(action)
	local list = actions[action]
	if not list then unknown(action, 2) end
	for i = 1, #list do
		if pressedAt[list[i]] == frame then return true end
	end
	return false
end

---True on the frame the action went up.
function input.released(action)
	local list = actions[action]
	if not list then unknown(action, 2) end
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
	elseif name == "focus" and not a then
		-- Keys released while the window is in the background never arrive.
		for k in pairs(down) do release(k) end
	end
end

---How far the mouse moved this frame: dx, dy (works with relative mode).
function input._mouseDelta()
	return mouseDX, mouseDY
end

function input._endFrame()
	frame = frame + 1
	mouseDX, mouseDY = 0, 0
end

return input
