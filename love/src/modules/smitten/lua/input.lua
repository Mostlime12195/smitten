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
--
-- Default actions (left, right, up, down, jump, a, b, start) are bound when
-- this file loads, so games need no setup. Key, button and mouse names work
-- directly too: down("e"), pressed("mouse:left"), pressed("pad:x") make a
-- hidden action named after the input the first time they're asked about,
-- or the first time that input is pressed, whichever comes first.

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
local byMouse = {}     -- mouse button number -> list of actions
local auto = {}        -- action -> true for the hidden actions named after an input ("e", "mouse:left")
local framePads = nil  -- the gamepads at the start of this frame

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

local MOUSE = { left = 1, right = 2, middle = 3 }

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
	elseif b.kind == "mouse" then
		return love.mouse ~= nil and love.mouse.isDown(b.button)
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
	framePads = pads
	for action in pairs(bindings) do
		local now = actionDown(action, pads)
		local was = down[action]
		pressed[action] = eventDown[action] or (now and not was) or false
		released[action] = eventUp[action] or (was and not now) or false
		down[action] = now
		eventDown[action], eventUp[action] = nil, nil
	end
end

-- Defined below: the hidden action's name for a key, button or mouse event,
-- and making that action.
local autoName, makeAuto

local function onEvent(map, target)
	return function(_, a)
		local name = autoName(map, a)
		if name ~= nil and target == eventDown then
			-- A press of an input nobody asked about yet: make its hidden
			-- action now, so pressed("e") works on the first frame it's asked.
			makeAuto(name)
		end
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
	-- mousepressed(x, y, button, istouch, presses)
	local onMouseDown, onMouseUp = onEvent(byMouse, eventDown), onEvent(byMouse, eventUp)
	callbacks.before("mousepressed", function(name, _, _, button) onMouseDown(name, button) end)
	callbacks.before("mousereleased", function(name, _, _, button) onMouseUp(name, button) end)
	-- These callbacks must exist (and reach the hooks) even if the game
	-- doesn't define them.
	local needed = { update = true, keypressed = true, keyreleased = true, gamepadpressed = true, gamepadreleased = true,
		mousepressed = true, mousereleased = true }
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
	local mouse = s:match("^mouse:(.+)$")
	if mouse then
		local n = MOUSE[mouse] or tonumber(mouse)
		if not n or n < 1 or n % 1 ~= 0 then
			error(("smitten.input.bind: %q: unknown mouse button %q (use mouse:left, mouse:right, mouse:middle)")
				:format(action, mouse), 3)
		end
		return { kind = "mouse", button = n, name = s }
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
	for k in pairs(byMouse) do byMouse[k] = nil end
	for action, list in pairs(bindings) do
		for _, b in ipairs(list) do
			local map, key = nil, nil
			if b.kind == "key" then map, key = byKey, b.key
			elseif b.kind == "pad" then map, key = byButton, b.button
			elseif b.kind == "mouse" then map, key = byMouse, b.button end
			if map then
				map[key] = map[key] or {}
				table.insert(map[key], action)
			end
		end
	end
end

---Bind an action to keys (love.keyboard key constants), gamepad buttons
---("pad:a"), gamepad axes ("axis:leftx-", "axis:lefty+") and mouse buttons
---("mouse:left"). Replaces the action's previous bindings.
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
	local isNew = bindings[action] == nil or auto[action]
	auto[action] = nil
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

-- Whether s names an input that works without binding: a key ("e"), a
-- gamepad button ("pad:x"), an axis direction ("axis:leftx+") or a mouse
-- button ("mouse:left").
local function directInput(s)
	if type(s) ~= "string" or s == "" then return false end
	return (pcall(parse, s, s))
end

-- Make the hidden action for an input (once).
function makeAuto(name)
	if bindings[name] ~= nil then return end
	install()
	bindings[name] = { parse(name, name) }
	auto[name] = true
	rebuildIndex()
	down[name] = actionDown(name, framePads or gamepads())
	pressed[name], released[name] = false, false
end

-- The hidden action name for an event's key, button or mouse button, if that
-- input has no action of its own name yet; nil otherwise.
function autoName(map, a)
	local name
	if map == byKey then
		name = a
		if type(name) ~= "string" or not validKey(name) then return nil end
	elseif map == byButton then
		if not BUTTONS[a] then return nil end
		name = "pad:" .. a
	elseif map == byMouse then
		if type(a) ~= "number" then return nil end
		name = a == 1 and "mouse:left" or a == 2 and "mouse:right" or a == 3 and "mouse:middle" or ("mouse:" .. a)
	end
	if bindings[name] ~= nil then return nil end
	return name
end

local function check(action, what)
	if bindings[action] == nil then
		if directInput(action) then
			makeAuto(action)
			return
		end
		local names = {}
		for k in pairs(bindings) do
			if not auto[k] then names[#names + 1] = k end
		end
		table.sort(names)
		local guess = require("smitten.util").didYouMean(tostring(action), names)
		local quoted = {}
		for i, k in ipairs(names) do quoted[i] = ("%q"):format(k) end
		error(("smitten.input.%s: no action named %s%s (actions: %s; key names like \"space\" or \"e\" work too, or bind a new action with smitten.input.bind)")
			:format(what, ("%q"):format(tostring(action)), guess and ("; did you mean %q?"):format(guess) or "",
				#quoted > 0 and table.concat(quoted, ", ") or "none"), 3)
	end
end

---Whether the action is held right now (or was pressed this frame, so taps
---shorter than a frame still count for one frame).
---@param action string
---@return boolean
function input.down(action)
	check(action, "down")
	return pressed[action] == true or actionDown(action, framePads or gamepads())
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

---Returns -1, 0 or 1 from two opposite actions: axis("left", "right") is -1 while
---only left is held, 1 while only right is held, else 0.
---@param negative string
---@param positive string
---@return integer
function input.axis(negative, positive)
	check(negative, "axis")
	check(positive, "axis")
	local n = pressed[negative] == true or actionDown(negative, framePads or gamepads())
	local p = pressed[positive] == true or actionDown(positive, framePads or gamepads())
	return (p and 1 or 0) - (n and 1 or 0)
end

-- The default actions, so games work without any setup.
input.bind("left", { "left", "a", "pad:dpleft", "axis:leftx-" })
input.bind("right", { "right", "d", "pad:dpright", "axis:leftx+" })
input.bind("up", { "up", "w", "pad:dpup", "axis:lefty-" })
input.bind("down", { "down", "s", "pad:dpdown", "axis:lefty+" })
input.bind("jump", { "space", "z", "pad:a" })
input.bind("a", { "space", "z", "pad:a" })
input.bind("b", { "x", "lshift", "rshift", "pad:b" })
input.bind("start", { "return", "kpenter", "pad:start" })

return { input = input }
