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
--
-- More than one player: every action call takes a player number at the end,
-- pressed("jump", 2). A player reads their own gamepad (player 2 the second
-- one) and, if they have the keyboard, their keys; with no player a call
-- reads every device, as it always did. Players get keys of their own in
-- Project settings > Input (smitten.json "input", "players") or with
-- bind(action, inputs, player).
--
-- Any code can press an action: press(), release(), setStrength(). The
-- touch pieces (scene/touch.lua) work that way.
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

local actions = {}       -- name -> list of input names: what every player starts with
local sets = {}          -- player -> { action -> list }: that player's own inputs
local any = {}           -- name -> list: actions, plus every player's own inputs (what no player reads)
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
local lastKind, lastPad = nil, nil  -- "keyboard", "mouse" or "gamepad", and which gamepad
local keysName, keysFrame = nil, 0  -- the last key or mouse button pressed
local single = {}              -- input name -> { name } (or false), for pressed("space")
local EMPTY = {}

-- Gamepads keep their number while they're connected: slots[2] is gamepad 2
-- even after gamepad 1 is unplugged. Each has its own buttons and sticks.
local slots = {}         -- number -> { index, joystick, id, down, pressedAt, releasedAt, axes }
local slotMax = 0
local byId = {}          -- joystick id -> its slot
local padsDirty = true   -- the list of gamepads may have changed
local padsKnown = false  -- the gamepads there at the start are in
local assigned = {}      -- player -> gamepad number (false: none); else player N has gamepad N
local listeners = {}     -- event name -> list of { fn }

-- Actions pressed by code: press(), release(), setStrength().
local virt = {}          -- player -> { strength = {}, pressedAt = {}, releasedAt = {}, lastFrame }
local vAny = {}          -- action -> the most any player pushes it
local vPressedAt = {}    -- action -> frame any player pressed it
local vReleasedAt = {}   -- action -> frame any player let it go
local vLastFrame = 0     -- the last frame any action was pressed by code

input._frame = frame     -- for scene/script.lua, which looks a piece's player up once a frame

-- any: what a call with no player reads. Without players' own inputs these
-- are the very lists in actions.
local function rebuild()
	any = {}
	for name, list in pairs(actions) do any[name] = list end
	for _, set in pairs(sets) do
		for name, list in pairs(set) do
			local have = any[name]
			if not have then
				any[name] = list
			else
				local merged, seen = {}, {}
				for i = 1, #have do
					merged[i] = have[i]
					seen[have[i]] = true
				end
				for i = 1, #list do
					if not seen[list[i]] then
						merged[#merged + 1] = list[i]
						seen[list[i]] = true
					end
				end
				any[name] = merged
			end
		end
	end
end

local function reset()
	actions = {}
	sets = {}
	for k, v in pairs(DEFAULTS) do
		local copy = {}
		for i, x in ipairs(v) do copy[i] = x end
		actions[k] = copy
	end
	rebuild()
end
reset()

local function stringList(list)
	local out = {}
	for _, v in ipairs(list) do
		if type(v) == "string" then out[#out + 1] = v end
	end
	return out
end

---Sets up actions from a project's settings: { action = { inputs } }, and
---players = { ["2"] = { action = { inputs } } } for players' own inputs.
function input._configure(map)
	reset()
	if type(map) ~= "table" then return end
	for name, list in pairs(map) do
		if name == "players" and type(list) == "table" and list[1] == nil then
			for key, set in pairs(list) do
				local player = tonumber(key)
				if player and player >= 1 and type(set) == "table" then
					local own = {}
					for action, inputs in pairs(set) do
						if type(action) == "string" and type(inputs) == "table" then own[action] = stringList(inputs) end
					end
					sets[math.floor(player)] = own
				end
			end
		elseif type(list) == "table" then
			actions[name] = list
		end
	end
	rebuild()
end

local function unknown(action, level)
	local names = {}
	for n in pairs(any) do names[#names + 1] = n end
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

-- An input used as an action: pressed("space").
local function singleOf(action)
	local s = single[action]
	if s == nil then
		s = isInputName(action) and { action } or false
		if type(action) == "string" then single[action] = s end
	end
	return s
end

-- The inputs of an action, or of a single input used as one.
local function listOf(action, level)
	local list = any[action]
	if list then return list end
	local s = singleOf(action)
	if s then return s end
	unknown(action, level + 1)
end

local function strengthOf(name)
	if down[name] then return 1 end
	local a = axes[name]
	if a and a > DEADZONE then return (a - DEADZONE) / (1 - DEADZONE) end
	return 0
end

---------------------------------------------------------------------------
-- Gamepads

local function fire(event, ...)
	local list = listeners[event]
	if not list then return end
	for _, l in ipairs({ unpack(list) }) do
		if l.fn then l.fn(...) end
	end
end

local release  -- below

-- Brings slots in line with the gamepads that are connected: a new one takes
-- the lowest free number, and one that's gone leaves its number free.
local function syncPads()
	padsDirty = false
	local js = love.joystick
	if not js then return end
	local seen = {}
	local added, removed = nil, nil
	for _, j in ipairs(js.getJoysticks()) do
		if j:isGamepad() then
			local id = j:getID()
			seen[id] = true
			if not byId[id] then
				local i = 1
				while slots[i] do i = i + 1 end
				local slot = { index = i, joystick = j, id = id, down = {}, pressedAt = {}, releasedAt = {}, axes = {} }
				slots[i] = slot
				byId[id] = slot
				if i > slotMax then slotMax = i end
				added = added or {}
				added[#added + 1] = slot
			end
		end
	end
	for id, slot in pairs(byId) do
		if not seen[id] then
			removed = removed or {}
			removed[#removed + 1] = slot
		end
	end
	for _, slot in ipairs(removed or EMPTY) do
		byId[slot.id] = nil
		slots[slot.index] = nil
		-- What it held isn't held any more, unless another gamepad holds it too.
		for name in pairs(slot.down) do
			local other = false
			for i = 1, slotMax do
				if slots[i] and slots[i].down[name] then other = true end
			end
			if not other then release(name) end
		end
		for name, v in pairs(slot.axes) do
			if v > 0 then axes[name] = 0 end
		end
	end
	-- Scripts hear about gamepads that come and go while the game runs.
	local tell = padsKnown
	padsKnown = true
	if tell then
		for _, slot in ipairs(removed or EMPTY) do fire("gamepadremoved", slot.index, slot.joystick) end
		for _, slot in ipairs(added or EMPTY) do fire("gamepadadded", slot.index, slot.joystick) end
	end
end

-- A player's gamepad (its slot): the one they were given, else gamepad N.
local function padOf(player)
	if padsDirty then syncPads() end
	local i = assigned[player]
	if i == nil then i = player end
	return i and slots[i] or nil
end

local function slotOf(joystick)
	local id = joystick:getID()
	local slot = byId[id]
	if not slot then
		syncPads()
		slot = byId[id]
	end
	return slot
end

local function gamepad(player)
	local slot = padOf(player or 1)
	return slot and slot.joystick or nil
end

local padNames = {}  -- input name -> true if it's a gamepad's ("pad:a", "axis:leftx+")
local function isPad(name)
	local v = padNames[name]
	if v == nil then
		v = name:sub(1, 4) == "pad:" or name:sub(1, 5) == "axis:"
		padNames[name] = v
	end
	return v
end

---------------------------------------------------------------------------
-- One player's actions

local function checkPlayer(player, level)
	if type(player) ~= "number" or player < 1 then
		error(("a player is a number from 1 up, and this is %s"):format(tostring(player)), level + 1)
	end
end

-- Player 1 has the keyboard and the mouse; so does any player with inputs
-- of their own.
local function hasKeys(player)
	return player == 1 or sets[player] ~= nil
end

-- A player's inputs for an action: their own, else the ones all share.
local function listFor(action, player, level)
	checkPlayer(player, level + 1)
	local set = sets[player]
	local list = set and set[action] or actions[action]
	if list then return list end
	if any[action] then return EMPTY end  -- another player's own action
	local s = singleOf(action)
	if s then return s end
	unknown(action, level + 1)
end

local function strengthIn(slot, name)
	if slot.down[name] then return 1 end
	local a = slot.axes[name]
	if a and a > DEADZONE then return (a - DEADZONE) / (1 - DEADZONE) end
	return 0
end

local function playerStrength(action, player, level)
	local list = listFor(action, player, level + 1)
	local slot, keys = padOf(player), hasKeys(player)
	local best = 0
	for i = 1, #list do
		local name = list[i]
		local s = 0
		if isPad(name) then
			if slot then s = strengthIn(slot, name) end
		elseif keys then
			s = strengthOf(name)
		end
		if s > best then best = s end
	end
	local v = virt[player]
	v = v and v.strength[action]
	if v and v > best then best = v end
	return best
end

-- The input a player pressed this frame, or nil.
local function lastOf(player)
	local slot = padOf(player)
	if slot and slot.lastFrame == frame then return slot.lastName, "gamepad", slot.index end
	if hasKeys(player) and keysFrame == frame then
		return keysName, keysName:sub(1, 6) == "mouse:" and "mouse" or keysName:sub(1, 6) == "wheel:" and "mouse" or "keyboard", nil
	end
	return nil
end

local function playerPressed(action, player)
	if action == nil then
		checkPlayer(player, 3)
		local v = virt[player]
		return lastOf(player) ~= nil or (v ~= nil and v.lastFrame == frame)
	end
	local list = listFor(action, player, 3)
	local slot, keys = padOf(player), hasKeys(player)
	for i = 1, #list do
		local name = list[i]
		if isPad(name) then
			if slot and slot.pressedAt[name] == frame then return true end
		elseif keys and pressedAt[name] == frame then
			return true
		end
	end
	local v = virt[player]
	return v ~= nil and v.pressedAt[action] == frame
end

local function playerReleased(action, player)
	local list = listFor(action, player, 3)
	local slot, keys = padOf(player), hasKeys(player)
	local v = virt[player]
	if v and (v.strength[action] or 0) > 0 then return false end
	local was = v ~= nil and v.releasedAt[action] == frame
	for i = 1, #list do
		local name = list[i]
		if isPad(name) then
			if slot then
				if slot.releasedAt[name] == frame then was = true end
				if strengthIn(slot, name) > 0 then return false end
			end
		elseif keys then
			if releasedAt[name] == frame then was = true end
			if strengthOf(name) > 0 then return false end
		end
	end
	return was
end

---------------------------------------------------------------------------
-- Actions

---How far an action is pushed: 0 to 1 (sticks give values in between).
---With a player, only that player's inputs count.
function input.strength(action, player)
	if player then return playerStrength(action, player, 2) end
	local list = listOf(action, 2)
	local best = 0
	for i = 1, #list do
		local s = strengthOf(list[i])
		if s > best then best = s end
	end
	local v = vAny[action]
	if v and v > best then best = v end
	return best
end

---True while the action is held.
function input.down(action, player)
	if player then return playerStrength(action, player, 2) > 0 end
	return input.strength(action) > 0
end

---True on the frame the action went down. With no action: true if any key,
---mouse button or gamepad button went down this frame.
function input.pressed(action, player)
	if player then return playerPressed(action, player) end
	if action == nil then return lastFrame == frame or vLastFrame == frame end
	local list = listOf(action, 2)
	for i = 1, #list do
		if pressedAt[list[i]] == frame then return true end
	end
	return vPressedAt[action] == frame
end

---True on the frame the action went up.
function input.released(action, player)
	if player then return playerReleased(action, player) end
	local list = listOf(action, 2)
	if vAny[action] then return false end
	local was = vReleasedAt[action] == frame
	for i = 1, #list do
		if releasedAt[list[i]] == frame then was = true end
		if strengthOf(list[i]) > 0 then return false end
	end
	return was
end

---From -1 (negative held) to 1 (positive held); sticks give values between.
function input.axis(negative, positive, player)
	if player then return playerStrength(positive, player, 2) - playerStrength(negative, player, 2) end
	return input.strength(positive) - input.strength(negative)
end

---A direction from four actions, at most 1 long: x, y.
function input.vector(left, right, up, down_, player)
	local x, y
	if player then
		x = playerStrength(right, player, 2) - playerStrength(left, player, 2)
		y = playerStrength(down_, player, 2) - playerStrength(up, player, 2)
	else
		x, y = input.axis(left, right), input.axis(up, down_)
	end
	local len = math.sqrt(x * x + y * y)
	if len > 1 then x, y = x / len, y / len end
	return x, y
end

---Adds or replaces an action. With a player, the inputs are that player's
---own (and the player shares the keyboard from then on).
function input.bind(action, inputs, player)
	if type(action) ~= "string" then error("bind() needs an action's name, then its inputs", 2) end
	if type(inputs) == "string" then inputs = { inputs } end
	if type(inputs) ~= "table" then error('bind() needs the inputs as a list: bind("dash", { "lshift", "pad:b" })', 2) end
	if player then
		checkPlayer(player, 2)
		sets[player] = sets[player] or {}
		sets[player][action] = inputs
	else
		actions[action] = inputs
	end
	rebuild()
end

---Removes an action, or a player's own inputs for it.
function input.unbind(action, player)
	if player then
		checkPlayer(player, 2)
		if sets[player] then sets[player][action] = nil end
	else
		actions[action] = nil
	end
	rebuild()
end

---The inputs bound to an action (with a player: the ones that player uses).
function input.bindings(action, player)
	local list
	if player then
		checkPlayer(player, 2)
		list = sets[player] and sets[player][action] or actions[action]
	else
		list = actions[action]
	end
	local out = {}
	for i, v in ipairs(list or EMPTY) do out[i] = v end
	return out
end

---The input pressed this frame ("space", "mouse:1", "pad:a"), or nil: for
---"press a key for jump" screens, with bind(). With a player, only what
---that player pressed.
function input.lastPressed(player)
	if player then
		checkPlayer(player, 2)
		return (lastOf(player))
	end
	if lastFrame == frame then return lastName end
	return nil
end

---What was pressed this frame and where: the input's name, "keyboard",
---"mouse" or "gamepad", and the gamepad's number. nil if nothing was.
function input.lastPressedBy()
	if lastFrame ~= frame then return nil end
	return lastName, lastKind, lastPad
end

---Every action's name.
function input.actions()
	local out = {}
	for n in pairs(any) do out[#out + 1] = n end
	table.sort(out)
	return out
end

---------------------------------------------------------------------------
-- Actions pressed by code

---Pushes an action as far as value, 0 to 1, as a stick would: for touch
---controls, replays and computer players. It stays until it's set again.
---player: whose action it is (default 1).
function input.setStrength(action, value, player)
	player = player or 1
	if type(value) ~= "number" then error("setStrength() needs an action and a number from 0 to 1", 2) end
	listFor(action, player, 2)  -- says so if there's no such action
	value = value < 0 and 0 or value > 1 and 1 or value
	local v = virt[player]
	if not v then
		v = { strength = {}, pressedAt = {}, releasedAt = {}, lastFrame = 0 }
		virt[player] = v
	end
	local was = v.strength[action] or 0
	if was == value then return end
	v.strength[action] = value > 0 and value or nil
	if was <= 0 then
		v.pressedAt[action], v.lastFrame = frame, frame
		vPressedAt[action], vLastFrame = frame, frame
	elseif value <= 0 then
		v.releasedAt[action] = frame
		vReleasedAt[action] = frame
	end
	local most = 0
	for _, other in pairs(virt) do
		local s = other.strength[action]
		if s and s > most then most = s end
	end
	vAny[action] = most > 0 and most or nil
end

---Presses an action, as if its key went down, until release().
function input.press(action, player)
	if type(action) ~= "string" then error("press() needs an action's name", 2) end
	listFor(action, player or 1, 2)
	return input.setStrength(action, 1, player)
end

---Lets go of an action pressed with press() or setStrength().
function input.release(action, player)
	if type(action) ~= "string" then error("release() needs an action's name", 2) end
	listFor(action, player or 1, 2)
	return input.setStrength(action, 0, player)
end

---------------------------------------------------------------------------
-- Raw input, also used by smitten.keyboard and smitten.mouse additions

function input._rawPressed(name) return pressedAt[name] == frame end
function input._rawReleased(name) return releasedAt[name] == frame end
function input._rawDown(name) return down[name] == true end

local function press(name, kind, pad)
	if not down[name] then
		down[name] = true
		pressedAt[name] = frame
		lastName, lastFrame, lastKind, lastPad = name, frame, kind, pad
		if kind ~= "gamepad" then keysName, keysFrame = name, frame end
	end
end

function release(name)
	if down[name] then
		down[name] = nil
		releasedAt[name] = frame
	end
end

-- Sticks count as pressed when they pass halfway.
local function setAxis(t, pressed, released, name, v)
	local was = (t[name] or 0) > 0.5
	t[name] = v
	if v > 0.5 and not was then pressed[name] = frame end
	if v <= 0.5 and was then released[name] = frame end
end

local sawTouch = false     -- a finger has touched the screen
local touchScreen = nil    -- the device is a phone or a tablet (worked out on first use)

---love.engine forwards events here: (event name, LÖVE's arguments).
function input._event(name, a, b, c, d, e)
	if name == "keypressed" then press(a, "keyboard")
	elseif name == "keyreleased" then release(a)
	elseif name == "mousepressed" then press("mouse:" .. tostring(c), "mouse")
	elseif name == "mousereleased" then release("mouse:" .. tostring(c))
	elseif name == "gamepadpressed" then
		-- Every gamepad's buttons together (what a call with no player
		-- reads), and this gamepad's own.
		local n = "pad:" .. b
		local slot = slotOf(a)
		if slot and not slot.down[n] then
			slot.down[n] = true
			slot.pressedAt[n] = frame
			slot.lastName, slot.lastFrame = n, frame
		end
		if down[n] then
			lastName, lastFrame, lastKind, lastPad = n, frame, "gamepad", slot and slot.index
		else
			press(n, "gamepad", slot and slot.index)
		end
	elseif name == "gamepadreleased" then
		local n = "pad:" .. b
		local slot = slotOf(a)
		if slot and slot.down[n] then
			slot.down[n] = nil
			slot.releasedAt[n] = frame
		end
		release(n)
	elseif name == "gamepadaxis" then
		local v = c
		local pos, neg = "axis:" .. b .. "+", "axis:" .. b .. "-"
		setAxis(axes, pressedAt, releasedAt, pos, math.max(0, v))
		setAxis(axes, pressedAt, releasedAt, neg, math.max(0, -v))
		local slot = slotOf(a)
		if slot then
			setAxis(slot.axes, slot.pressedAt, slot.releasedAt, pos, math.max(0, v))
			setAxis(slot.axes, slot.pressedAt, slot.releasedAt, neg, math.max(0, -v))
		end
	elseif name == "joystickadded" or name == "joystickremoved" then
		padsDirty = true
		syncPads()
	elseif name == "touchpressed" then
		sawTouch = true
	elseif name == "mousemoved" then
		mouseDX, mouseDY = mouseDX + c, mouseDY + d
	elseif name == "wheelmoved" then
		wheelX, wheelY = wheelX + a, wheelY + b
		local dir = b > 0 and "wheel:up" or b < 0 and "wheel:down" or a > 0 and "wheel:right" or a < 0 and "wheel:left"
		if dir then
			pressedAt[dir], releasedAt[dir] = frame, frame
			lastName, lastFrame, lastKind, lastPad = dir, frame, "mouse", nil
			keysName, keysFrame = dir, frame
		end
	elseif name == "textinput" then
		typedText = typedText .. a
	elseif name == "focus" and not a then
		-- Keys released while the window is in the background never arrive.
		for k in pairs(down) do release(k) end
		for i = 1, slotMax do
			local slot = slots[i]
			if slot then
				for k in pairs(slot.down) do
					slot.down[k] = nil
					slot.releasedAt[k] = frame
				end
			end
		end
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

---True on a phone or a tablet, and on any screen once a finger has touched
---it: the time to show touch controls.
function input.hasTouch()
	if sawTouch then return true end
	if touchScreen == nil then
		local os = love.system and love.system.getOS() or ""
		if os == "Android" or os == "iOS" then
			touchScreen = true
		elseif os == "Web" then
			-- In a browser the engine starts with text input off on phones
			-- and tablets only (so their keyboard stays away): input._start
			-- reads that before a game can change it.
			if input._textInputAtStart == nil then return false end
			touchScreen = input._textInputAtStart == false
		else
			touchScreen = false
		end
	end
	return touchScreen
end

---Called by love.engine once the window is open, before the game's code.
function input._start()
	local kb = love.keyboard
	if kb and kb.hasTextInput then input._textInputAtStart = kb.hasTextInput() end
end

---For tests: says there is (true) or isn't (false) a touch screen.
function input._setTouch(on)
	sawTouch = false
	touchScreen = on == true
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

---How many players have something to play with: player 1 (the keyboard),
---players with inputs of their own, and players with a gamepad.
function input.players()
	if padsDirty then syncPads() end
	local top = math.max(1, slotMax)
	for p in pairs(sets) do if p > top then top = p end end
	for p in pairs(assigned) do if p > top then top = p end end
	local n = 0
	for p = 1, top do
		if hasKeys(p) or padOf(p) then n = n + 1 end
	end
	return n
end

---A player's gamepad: its number and the gamepad itself, or nil. Player 2
---has gamepad 2 unless assignGamepad() said otherwise.
function input.gamepadOf(player)
	checkPlayer(player, 2)
	local slot = padOf(player)
	if not slot then return nil end
	return slot.index, slot.joystick
end

---Gives a player a gamepad: its number (as lastPressedBy() and the
---gamepadadded event give it) or the gamepad itself. false: no gamepad.
---nil: back to gamepad N for player N.
function input.assignGamepad(player, which)
	checkPlayer(player, 2)
	if which == nil or which == false then
		assigned[player] = which
	elseif type(which) == "number" then
		assigned[player] = which
	elseif type(which) == "userdata" and which.getID then
		local slot = slotOf(which)
		if not slot then error("assignGamepad(): that gamepad isn't connected", 2) end
		assigned[player] = slot.index
	else
		error("assignGamepad() needs a player and a gamepad's number: assignGamepad(2, 1)", 2)
	end
end

local EVENTS = { gamepadadded = true, gamepadremoved = true }

---Calls fn when something happens: "gamepadadded" and "gamepadremoved"
---give fn(number, gamepad). Returns a handle with :off().
function input.on(event, fn)
	if not EVENTS[event] then
		error(("smitten.input has no event called %q%s"):format(tostring(event),
			require("love.engine.util").didYouMean(tostring(event), { "gamepadadded", "gamepadremoved" })), 2)
	end
	if type(fn) ~= "function" then error("on() needs an event name and a function", 2) end
	local list = listeners[event]
	if not list then
		list = {}
		listeners[event] = list
	end
	local l = { fn = fn }
	function l.off()
		l.fn = nil
		for i = #list, 1, -1 do
			if list[i] == l then table.remove(list, i) end
		end
	end
	list[#list + 1] = l
	return l
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
	input._frame = frame
	if padsDirty then syncPads() end
	mouseDX, mouseDY = 0, 0
	wheelX, wheelY = 0, 0
	typedText = ""
end

return input
