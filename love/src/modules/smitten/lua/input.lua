-- smitten.input: named actions bound to keys, gamepad buttons and sticks.
--
--   smitten.input.bind("jump", { "space", "up", "w", "pad:a" })
--   smitten.input.bind("left", { "left", "a", "pad:dpleft", "axis:leftx-" })
--   if smitten.input.pressed("jump") then ... end
--
-- How pressed/released work: the first time input is used, it hooks love's
-- callbacks through smitten.scene's callback layer (see scene.lua), so the
-- game doesn't have to call anything each frame:
--
-- * Before the game's love.update runs (every frame; love.update exists even
--   if the game doesn't define it), a new input frame starts: each action's
--   `pressed` is true if it went down since the previous frame's start, and
--   `released` if it went up. That stays the same through love.update,
--   love.draw and the next frame's events, until the next love.update.
-- * "Went down" combines two sources: key and gamepad button events
--   (love.keypressed etc., hooked before the game's own handlers), which
--   catch taps shorter than a frame, and polling (love.keyboard.isDown,
--   gamepad buttons and axes) compared with the previous frame, which
--   catches everything the events can't (sticks, keys held before binding).

local callbacks = require("smitten.scene").callbacks

local input = {}

local bindings = {}    -- action -> list of parsed bindings
local down = {}        -- action -> held at the start of this frame
local pressed = {}     -- action -> went down since the previous frame
local released = {}    -- action -> went up since the previous frame
local eventDown = {}   -- action -> a press event arrived since the frame started
local eventUp = {}     -- action -> a release event arrived since the frame started
local byKey = {}       -- key constant -> list of actions
local byButton = {}    -- gamepad button -> list of actions

local AXIS_THRESHOLD = 0.5

-- LÖVE accepts any text as a key constant (it uses the first character), so
-- names are checked here: one character, or one of LÖVE's named keys.
local NAMED_KEYS = {}
for _, k in ipairs({
	"return", "escape", "backspace", "tab", "space", "capslock", "f1", "f2", "f3", "f4", "f5", "f6", "f7", "f8",
	"f9", "f10", "f11", "f12", "printscreen", "scrolllock", "pause", "insert", "home", "pageup", "delete",
	"end", "pagedown", "right", "left", "down", "up", "numlock", "kp/", "kp*", "kp-", "kp+", "kpenter", "kp0",
	"kp1", "kp2", "kp3", "kp4", "kp5", "kp6", "kp7", "kp8", "kp9", "kp.", "kp,", "kp=", "application", "power",
	"f13", "f14", "f15", "f16", "f17", "f18", "f19", "f20", "f21", "f22", "f23", "f24", "execute", "help",
	"menu", "select", "stop", "again", "undo", "cut", "copy", "paste", "find", "mute", "volumeup", "volumedown",
	"alterase", "sysreq", "cancel", "clear", "prior", "return2", "separator", "out", "oper", "clearagain",
	"thousandsseparator", "decimalseparator", "currencyunit", "currencysubunit", "lctrl", "lshift", "lalt",
	"lgui", "rctrl", "rshift", "ralt", "rgui", "mode", "audionext", "audioprev", "audiostop", "audioplay",
	"audiomute", "mediaselect", "appsearch", "apphome", "appback", "appforward", "appstop", "apprefresh",
	"appbookmarks", "eject", "sleep"
}) do NAMED_KEYS[k] = true end

local function validKey(s)
	if NAMED_KEYS[s] then return true end
	local _, chars = s:gsub("[^\128-\191]", "")
	return chars == 1
end

local BUTTONS = {}
for _, b in ipairs({ "a", "b", "x", "y", "back", "guide", "start", "leftstick", "rightstick", "leftshoulder",
	"rightshoulder", "dpup", "dpdown", "dpleft", "dpright", "misc1", "paddle1", "paddle2", "paddle3", "paddle4",
	"touchpad" }) do BUTTONS[b] = true end

local AXES = {}
for _, a in ipairs({ "leftx", "lefty", "rightx", "righty", "triggerleft", "triggerright" }) do AXES[a] = true end

local function listOf(set)
	local list = {}
	for k in pairs(set) do list[#list + 1] = k end
	table.sort(list)
	return table.concat(list, ", ")
end

local function gamepads()
	if not love.joystick then return {} end
	local list = {}
	for _, j in ipairs(love.joystick.getJoysticks()) do
		if j:isGamepad() then list[#list + 1] = j end
	end
	return list
end

local function bindingDown(b, pads)
	if b.kind == "key" then
		return love.keyboard ~= nil and love.keyboard.isDown(b.key)
	elseif b.kind == "pad" then
		for _, j in ipairs(pads) do
			if j:isGamepadDown(b.button) then return true end
		end
	else
		for _, j in ipairs(pads) do
			local v = j:getGamepadAxis(b.axis)
			if b.sign > 0 and v > AXIS_THRESHOLD then return true end
			if b.sign < 0 and v < -AXIS_THRESHOLD then return true end
		end
	end
	return false
end

local function actionDown(action, pads)
	for _, b in ipairs(bindings[action]) do
		if bindingDown(b, pads) then return true end
	end
	return false
end

-- Start a new input frame (before love.update).
local function beginFrame()
	local pads = gamepads()
	for action in pairs(bindings) do
		local now = actionDown(action, pads)
		local was = down[action]
		pressed[action] = eventDown[action] or (now and not was) or false
		released[action] = eventUp[action] or (was and not now) or false
		down[action] = now
		eventDown[action], eventUp[action] = nil, nil
	end
end

local function onEvent(map, target)
	return function(_, a, b, c)
		local list = map[a]
		if list then
			for _, action in ipairs(list) do target[action] = true end
		end
	end
end

local installed = false
local function install()
	if installed then return end
	installed = true
	callbacks.before("update", beginFrame)
	-- keypressed(key, scancode, isrepeat): ignore key repeats.
	local onKeyDown = onEvent(byKey, eventDown)
	callbacks.before("keypressed", function(name, key, scancode, isrepeat)
		if not isrepeat then onKeyDown(name, key) end
	end)
	callbacks.before("keyreleased", onEvent(byKey, eventUp))
	-- gamepadpressed(joystick, button)
	local onPadDown, onPadUp = onEvent(byButton, eventDown), onEvent(byButton, eventUp)
	callbacks.before("gamepadpressed", function(name, _, button) onPadDown(name, button) end)
	callbacks.before("gamepadreleased", function(name, _, button) onPadUp(name, button) end)
	-- These callbacks must exist (and reach the hooks) even if the game
	-- doesn't define them.
	local needed = { update = true, keypressed = true, keyreleased = true, gamepadpressed = true, gamepadreleased = true }
	callbacks.want(function(name) return needed[name] == true end)
end

local function parse(action, s)
	if type(s) ~= "string" or s == "" then
		error(("smitten.input.bind: %q: expected key names like \"space\" or \"pad:a\", got %s"):format(action,
			tostring(s)), 3)
	end
	local button = s:match("^pad:(.+)$")
	if button then
		if not BUTTONS[button] then
			error(("smitten.input.bind: %q: unknown gamepad button %q (buttons: %s)"):format(action, button,
				listOf(BUTTONS)), 3)
		end
		return { kind = "pad", button = button, name = s }
	end
	local axis, sign = s:match("^axis:(%a+)([+-])$")
	if s:match("^axis:") then
		if not axis or not AXES[axis] then
			error(("smitten.input.bind: %q: %q should be axis:<axis>+ or axis:<axis>- (axes: %s)"):format(action, s,
				listOf(AXES)), 3)
		end
		return { kind = "axis", axis = axis, sign = sign == "+" and 1 or -1, name = s }
	end
	do
		if not validKey(s) then
			error(("smitten.input.bind: %q: unknown key %q (use love.keyboard key names like \"space\", \"left\", \"a\", \"return\")")
				:format(action, s), 3)
		end
	end
	return { kind = "key", key = s, name = s }
end

local function rebuildIndex()
	for k in pairs(byKey) do byKey[k] = nil end
	for k in pairs(byButton) do byButton[k] = nil end
	for action, list in pairs(bindings) do
		for _, b in ipairs(list) do
			local map, key = nil, nil
			if b.kind == "key" then map, key = byKey, b.key elseif b.kind == "pad" then map, key = byButton, b.button end
			if map then
				map[key] = map[key] or {}
				table.insert(map[key], action)
			end
		end
	end
end

---Bind an action to keys (love.keyboard key constants), gamepad buttons
---("pad:a") and gamepad axes ("axis:leftx-", "axis:lefty+"). Replaces the
---action's previous bindings.
---@param action string
---@param inputs string[]|string
function input.bind(action, inputs)
	if type(action) ~= "string" then error("smitten.input.bind: the action name should be a string", 2) end
	if type(inputs) == "string" then inputs = { inputs } end
	if type(inputs) ~= "table" then
		error(("smitten.input.bind: %q: expected a list of inputs, like { \"space\", \"pad:a\" }"):format(action), 2)
	end
	local list = {}
	for i, s in ipairs(inputs) do list[i] = parse(action, s) end
	install()
	local isNew = bindings[action] == nil
	bindings[action] = list
	rebuildIndex()
	if isNew then
		-- Held keys don't count as pressed when an action is (re)bound mid-press.
		down[action] = actionDown(action, gamepads())
		pressed[action], released[action] = false, false
	end
end

---Remove an action's bindings.
---@param action string
function input.unbind(action)
	bindings[action], down[action], pressed[action], released[action] = nil, nil, nil, nil
	rebuildIndex()
end

local function check(action, what)
	if bindings[action] == nil then
		local names = {}
		for k in pairs(bindings) do names[#names + 1] = ("%q"):format(k) end
		table.sort(names)
		error(("smitten.input.%s: no action named %s (bind it first with smitten.input.bind%s)"):format(what,
			("%q"):format(tostring(action)), #names > 0 and "; bound: " .. table.concat(names, ", ") or ""), 3)
	end
end

---Whether the action is held right now (or was pressed this frame, so taps
---shorter than a frame still count for one frame).
---@param action string
---@return boolean
function input.down(action)
	check(action, "down")
	return pressed[action] == true or actionDown(action, gamepads())
end

---Whether the action went down since the previous frame.
---@param action string
---@return boolean
function input.pressed(action)
	check(action, "pressed")
	return pressed[action] == true
end

---Whether the action went up since the previous frame.
---@param action string
---@return boolean
function input.released(action)
	check(action, "released")
	return released[action] == true
end

---The inputs bound to an action, as given to bind (e.g. { "space", "pad:a" }).
---@param action string
---@return string[]
function input.bindings(action)
	local list = {}
	for i, b in ipairs(bindings[action] or {}) do list[i] = b.name end
	return list
end

return { input = input }
