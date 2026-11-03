-- smitten.camera: which part of the scene is on screen.
--
--   smitten.camera.follow(player)     -- or `camera = true` in an object definition
--   smitten.camera.shake(4, 0.3)
--   smitten.camera.x, smitten.camera.y   -- top left of the view, in scene pixels
--
-- Scenes from smitten.scene.go draw through it: each frame, after objects
-- update, the camera centers on the object it follows, then stays inside the
-- scene (unless `bounds = false`). A scene smaller than the screen is
-- centered. Shaking moves the picture without changing x and y.

local floor = math.floor

---@class smitten.camera
---@field x number left edge of the view, in scene pixels
---@field y number top edge of the view
---@field bounds boolean keep the view inside the scene (default true)
---@field target table? the object it follows
local camera = {
	x = 0,
	y = 0,
	bounds = true,
	target = nil,
}

local shakeAmount, shakeTime, shakeLeft = 0, 0, 0
local offsetX, offsetY = 0, 0

---Follow an object (anything with x and y; objects are centered by their
---hitbox). follow(nil) stops following.
---@param object table?
function camera.follow(object)
	if object ~= nil and (type(object) ~= "table" or type(object.x) ~= "number" or type(object.y) ~= "number") then
		error("smitten.camera.follow: expected an object with x and y (or nil to stop following)", 2)
	end
	camera.target = object
end

---Shake the view by up to `pixels`, fading out over `seconds`.
---@param pixels? number default 4
---@param seconds? number default 0.3
function camera.shake(pixels, seconds)
	pixels, seconds = pixels or 4, seconds or 0.3
	if type(pixels) ~= "number" or type(seconds) ~= "number" then
		error("smitten.camera.shake: expected pixels and seconds, like smitten.camera.shake(4, 0.3)", 2)
	end
	-- A new shake doesn't weaken one already going.
	if pixels * (seconds > 0 and 1 or 0) >= shakeAmount * (shakeTime > 0 and shakeLeft / shakeTime or 0) then
		shakeAmount, shakeTime, shakeLeft = pixels, seconds, seconds
	end
end

---Scene coordinates of a point on the game screen (e.g. the mouse).
---@param x number
---@param y number
---@return number, number
function camera.toWorld(x, y)
	return x + camera.x, y + camera.y
end

---Game screen coordinates of a point in the scene.
---@param x number
---@param y number
---@return number, number
function camera.toScreen(x, y)
	return x - camera.x, y - camera.y
end

-- Internal (smitten.scene.go): move the camera for this frame. width and
-- height are the scene's size in pixels.
local function update(dt, width, height)
	local screen = require("smitten.screen").screen
	local sw, sh = screen.width, screen.height
	local t = camera.target
	if t then
		if rawget(t, "_dead") then
			camera.target = nil
		else
			local cx, cy = t.x, t.y
			if t.offsetX and t.width then
				cx = t.x + t.offsetX + t.width / 2
				cy = t.y + t.offsetY + t.height / 2
			end
			camera.x = cx - sw / 2
			camera.y = cy - sh / 2
		end
	end
	if camera.bounds and width and height then
		if width <= sw then
			camera.x = (width - sw) / 2
		elseif camera.x < 0 then
			camera.x = 0
		elseif camera.x > width - sw then
			camera.x = width - sw
		end
		if height <= sh then
			camera.y = (height - sh) / 2
		elseif camera.y < 0 then
			camera.y = 0
		elseif camera.y > height - sh then
			camera.y = height - sh
		end
	end
	if shakeLeft > 0 then
		shakeLeft = shakeLeft - dt
		local strength = shakeTime > 0 and shakeAmount * math.max(shakeLeft, 0) / shakeTime or 0
		offsetX = (love.math.random() * 2 - 1) * strength
		offsetY = (love.math.random() * 2 - 1) * strength
	else
		offsetX, offsetY = 0, 0
	end
end

-- Internal: the translation to draw the scene with (whole pixels).
local function translation()
	return -floor(camera.x + offsetX + 0.5), -floor(camera.y + offsetY + 0.5)
end

-- Internal: back to the start (a new scene).
local function reset()
	camera.x, camera.y, camera.bounds, camera.target = 0, 0, true, nil
	shakeAmount, shakeTime, shakeLeft, offsetX, offsetY = 0, 0, 0, 0, 0
end

return { camera = camera, update = update, translation = translation, reset = reset }
