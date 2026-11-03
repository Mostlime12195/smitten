-- smitten.mouse: the pointer in game pixels and in the scene, and its
-- buttons. A touch acts as button 1.
--
--   if smitten.mouse.pressed() and smitten.mouse.over(button) then ... end
--   smitten.mouse.x, smitten.mouse.y             -- game pixels (through smitten.screen)
--   smitten.mouse.worldX, smitten.mouse.worldY   -- scene pixels (through smitten.camera)
--
-- The fields are updated before every love.update (and on each mouse or
-- touch event), through smitten.scene's callback layer, from the moment the
-- game first uses smitten.mouse. pressed/released work like smitten.input's:
-- they combine button events (so quick clicks count) with polling.

local callbacks = require("smitten.scene").callbacks

---@class smitten.mouse
---@field x number pointer x in game pixels
---@field y number pointer y in game pixels
---@field worldX number pointer x in the scene (camera applied)
---@field worldY number pointer y in the scene
local mouse = { x = 0, y = 0, worldX = 0, worldY = 0 }

local BUTTONS = 3
local down, pressed, released = {}, {}, {}  -- button -> boolean, for this frame
local eventDown, eventUp = {}, {}           -- button -> an event arrived since the frame started
local touches = 0                           -- fingers on the screen
local touchX, touchY                        -- the last touch position, in window pixels

local function windowPosition()
	if touches > 0 and touchX then return touchX, touchY end
	if love.mouse then return love.mouse.getPosition() end
	return 0, 0
end

local function refresh()
	local screen = require("smitten.screen").screen
	local wx, wy = windowPosition()
	local x, y = screen.toGame(wx, wy)
	mouse.x, mouse.y = x, y
	local cam = require("smitten.camera").camera
	mouse.worldX, mouse.worldY = x + cam.x, y + cam.y
end

local function isDown(b)
	if b == 1 and touches > 0 then return true end
	return love.mouse ~= nil and love.mouse.isDown(b)
end

local function beginFrame()
	for b = 1, BUTTONS do
		local now = isDown(b)
		local was = down[b]
		pressed[b] = eventDown[b] or (now and not was) or false
		released[b] = eventUp[b] or (was and not now) or false
		down[b] = now
		eventDown[b], eventUp[b] = nil, nil
	end
	refresh()
end

callbacks.before("update", beginFrame)
callbacks.before("mousepressed", function(_, x, y, button)
	if type(button) == "number" and button <= BUTTONS then eventDown[button] = true end
end)
callbacks.before("mousereleased", function(_, x, y, button)
	if type(button) == "number" and button <= BUTTONS then eventUp[button] = true end
end)
callbacks.before("mousemoved", function() refresh() end)
-- touchpressed(id, x, y, dx, dy, pressure): x, y in window pixels.
callbacks.before("touchpressed", function(_, id, x, y)
	touches = touches + 1
	touchX, touchY = x, y
	eventDown[1] = true
	refresh()
end)
callbacks.before("touchmoved", function(_, id, x, y)
	touchX, touchY = x, y
	refresh()
end)
callbacks.before("touchreleased", function(_, id, x, y)
	touches = math.max(touches - 1, 0)
	touchX, touchY = x, y
	eventUp[1] = true
	refresh()
end)
do
	local needed = { update = true, mousepressed = true, mousereleased = true, mousemoved = true,
		touchpressed = true, touchmoved = true, touchreleased = true }
	callbacks.want(function(name) return needed[name] == true end)
end
for b = 1, BUTTONS do down[b], pressed[b], released[b] = isDown(b), false, false end

local NAMES = { left = 1, right = 2, middle = 3 }

local function button(b, what)
	if b == nil then return 1 end
	if NAMES[b] then return NAMES[b] end
	if b == 1 or b == 2 or b == 3 then return b end
	error(("smitten.mouse.%s: buttons are 1 (left, the default), 2 (right) and 3 (middle), got %s"):format(what,
		tostring(b)), 3)
end

---Whether a mouse button is held (1 = left, the default; 2 = right; 3 = middle).
---A touch counts as button 1.
---@param b? integer|string
---@return boolean
function mouse.down(b)
	b = button(b, "down")
	return pressed[b] == true or isDown(b)
end

---Whether a button went down since the previous frame.
---@param b? integer|string
---@return boolean
function mouse.pressed(b)
	return pressed[button(b, "pressed")] == true
end

---Whether a button went up since the previous frame.
---@param b? integer|string
---@return boolean
function mouse.released(b)
	return released[button(b, "released")] == true
end

---Whether the pointer is over an object's hitbox (in the scene, so the
---camera is taken into account).
---@param object table an object (or any table with x, y, width, height)
---@return boolean
function mouse.over(object)
	if type(object) ~= "table" or type(object.x) ~= "number" then
		error("smitten.mouse.over: expected an object", 2)
	end
	local x, y = object.x + (object.offsetX or 0), object.y + (object.offsetY or 0)
	local w, h = object.width or 0, object.height or 0
	local mx, my = mouse.worldX, mouse.worldY
	return mx >= x and mx < x + w and my >= y and my < y + h
end

refresh()

return { mouse = mouse }
