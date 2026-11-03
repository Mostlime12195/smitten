-- Behavior nodes: each one moves its parent (DESIGN.md, section 4).
-- Platformer, TopDown, Follow, Mover, Spin and Draggable. FirstPerson, which
-- needs 3D physics, is in physics3d.lua.
--
-- Input is read every frame in _process (so a press is never missed between
-- physics steps) and movement happens in _physics, at a fixed 60 steps a
-- second.

local nodeLib = require("love.scene.node")
local nodes2d = require("love.scene.nodes2d")

local sqrt, atan2, cos, sin, min, max, abs = math.sqrt, math.atan2, math.cos, math.sin, math.min, math.max, math.abs

local function approach(v, target, step)
	if v < target then return min(v + step, target) end
	return max(v - step, target)
end

local function input()
	return require("love.input")
end

-- Plays the first of the named animations the parent's Sprite2D has, and
-- turns it to face the way it moves.
local function animate(body, names, dir)
	local sprite = body:findChildOfType("Sprite2D")
	if not sprite then return end
	if dir and dir ~= 0 then sprite.flipX = dir < 0 end
	local sheet = nodes2d.sheetOf(sprite)
	if not sheet or not sheet.animations then return end
	for _, name in ipairs(names) do
		if sheet.animations[name] then
			if sprite.animation ~= name then sprite:play(name) end
			return
		end
	end
end

local function is2DBody(n)
	return n and n.moveAndSlide ~= nil and n.vx ~= nil and n.vz == nil
end

---------------------------------------------------------------------------
-- Platformer

local Platformer = nodeLib.classes.Platformer

function Platformer:_enter()
	self._coyote, self._buffer, self._airLeft, self._cut = 0, 0, self.airJumps, false
end

function Platformer:_process(dt)
	if self.controls and input().pressed(self.jumpAction) then self._buffer = 0.12 end
end

function Platformer:jump()
	local body = self.parent
	if not is2DBody(body) then return end
	body.vy = -sqrt(2 * self.gravity * self.jumpHeight)
	self._coyote, self._buffer, self._cut = 0, 0, false
	body:emit("jumped")
end

function Platformer:_physics(dt)
	local body = self.parent
	if not is2DBody(body) then return end
	local dir = 0
	if self.controls then dir = input().axis(self.leftAction, self.rightAction) end
	body.vx = approach(body.vx, dir * self.speed, self.acceleration * dt)
	body.vy = min(body.vy + self.gravity * dt, self.maxFallSpeed)

	if body:isOnFloor() then
		self._coyote, self._airLeft = self.coyoteTime, self.airJumps
	else
		self._coyote = self._coyote - dt
	end
	if self._buffer > 0 then
		if self._coyote > 0 then
			self:jump()
		elseif self._airLeft > 0 then
			self._airLeft = self._airLeft - 1
			self:jump()
		end
		self._buffer = self._buffer - dt
	end
	-- Letting go of jump early makes a lower jump.
	if self.controls and body.vy < 0 and not self._cut and not input().down(self.jumpAction) then
		body.vy = body.vy * 0.5
		self._cut = true
	end

	local wasOnFloor = body:isOnFloor()
	body:moveAndSlide()
	if body:isOnFloor() then
		if not wasOnFloor then body:emit("landed") end
		animate(body, abs(body.vx) > 5 and { "run", "walk", "idle" } or { "idle" }, dir)
	else
		animate(body, body.vy < 0 and { "jump", "fall", "idle" } or { "fall", "jump", "idle" }, dir)
	end
end

---------------------------------------------------------------------------
-- TopDown

local TopDown = nodeLib.classes.TopDown

function TopDown:_physics(dt)
	local body = self.parent
	if not is2DBody(body) then return end
	local dx, dy = 0, 0
	if self.controls then dx, dy = input().vector("left", "right", "up", "down") end
	local step = self.acceleration * dt
	body.vx = approach(body.vx, dx * self.speed, step * max(abs(dx), 0.3))
	body.vy = approach(body.vy, dy * self.speed, step * max(abs(dy), 0.3))
	body:moveAndSlide()
	local moving = abs(body.vx) > 5 or abs(body.vy) > 5
	if self.rotate and moving then body.rotation = atan2(body.vy, body.vx) end
	animate(body, moving and { "walk", "run", "idle" } or { "idle" }, not self.rotate and dx or nil)
end

---------------------------------------------------------------------------
-- Follow (2D and 3D)

local Follow = nodeLib.classes.Follow

local function findTarget(self)
	if self.target ~= nil and self.target ~= "" then
		return self.parent and self.parent:find(self.target) or require("love.scene").find(self.target)
	end
	return require("love.scene").first("player")
end

function Follow:_physics(dt)
	local body = self.parent
	local target = findTarget(self)
	if not body or not target or target._dead then return end
	if body.rotationX ~= nil then
		-- 3D
		local x, y, z = body:getGlobalPosition()
		local tx, ty, tz = target:getGlobalPosition()
		local dx, dy, dz = tx - x, ty - y, tz - z
		local d = sqrt(dx * dx + dy * dy + dz * dz)
		if self.rotate then body.rotationY = atan2(-dx, -dz) end
		if d <= self.stopDistance or d == 0 then return end
		local k = min(self.speed * dt, d - self.stopDistance) / d
		if body.vx ~= nil and body.moveAndSlide then
			body.vx, body.vz = dx / d * self.speed, dz / d * self.speed
		else
			body:setGlobalPosition(x + dx * k, y + dy * k, z + dz * k)
		end
		return
	end
	local x, y = body:getGlobalPosition()
	local tx, ty = target:getGlobalPosition()
	local dx, dy = tx - x, ty - y
	local d = sqrt(dx * dx + dy * dy)
	if self.rotate then body.rotation = atan2(dy, dx) end
	if is2DBody(body) then
		if d <= self.stopDistance or d == 0 then
			body.vx, body.vy = 0, 0
		else
			body.vx, body.vy = dx / d * self.speed, dy / d * self.speed
		end
		body:moveAndSlide()
	elseif d > self.stopDistance and d > 0 then
		local step = min(self.speed * dt, d - self.stopDistance)
		body:setGlobalPosition(x + dx / d * step, y + dy / d * step)
	end
end

---------------------------------------------------------------------------
-- Mover

local Mover = nodeLib.classes.Mover

function Mover:_physics(dt)
	local body = self.parent
	if not body then return end
	if body.rotationX ~= nil then
		local fx, fy, fz = body:forward()
		body.x, body.y, body.z = body.x + fx * self.speed * dt, body.y + fy * self.speed * dt, body.z + fz * self.speed * dt
		return
	end
	if body.rotation == nil then return end
	local angle = self.direction
	if self.useRotation then
		local a, b = nodes2d.globalMatrix(body)
		angle = atan2(b, a)
	end
	local dx, dy = cos(angle) * self.speed * dt, sin(angle) * self.speed * dt
	local x, y = body:getGlobalPosition()
	body:setGlobalPosition(x + dx, y + dy)
	if self.destroyOffscreen then
		local display = require("love.display")
		local sx, sy = nodes2d.toScreen(x + dx, y + dy)
		local m = 64
		if sx < display.viewX - m or sy < display.viewY - m
			or sx > display.viewX + display.viewWidth + m or sy > display.viewY + display.viewHeight + m then
			body:destroy()
		end
	end
end

---------------------------------------------------------------------------
-- Spin

local Spin = nodeLib.classes.Spin

function Spin:_process(dt)
	local body = self.parent
	if not body then return end
	if body.rotationX ~= nil then
		local key = self.axis == "x" and "rotationX" or self.axis == "z" and "rotationZ" or "rotationY"
		body[key] = body[key] + self.speed * dt
	elseif body.rotation ~= nil then
		body.rotation = body.rotation + self.speed * dt
	end
end

---------------------------------------------------------------------------
-- Draggable

local Draggable = nodeLib.classes.Draggable

local function under(self, wx, wy)
	local body = self.parent
	local physics2d = require("love.scene.physics2d")
	local shapes = physics2d.shapesOf(body)
	if #shapes > 0 then
		for _, s in ipairs(shapes) do
			if abs(wx - s.x) <= s.hw and abs(wy - s.y) <= s.hh then return true end
		end
		return false
	end
	local lx, ly = body:toLocal(wx, wy)
	local sprite = body.getRect and body or body:findChildOfType("Sprite2D") or body:findChildOfType("Shape2D")
	if sprite and sprite.getRect then
		local x, y, w, h = sprite:getRect()
		if sprite ~= body then lx, ly = sprite:toLocal(wx, wy) end
		return lx >= x and ly >= y and lx < x + w and ly < y + h
	end
	return lx * lx + ly * ly <= self.size * self.size
end

function Draggable:_process()
	local body = self.parent
	if not body or body.rotation == nil then return end
	local mouse = love.mouse
	local wx, wy = mouse.worldX, mouse.worldY
	if self._dragging then
		if mouse.down(self.button) then
			body:setGlobalPosition(wx + self._ox, wy + self._oy)
		else
			self._dragging = false
			body:emit("dragEnded")
		end
	elseif mouse.pressed(self.button) and not require("love.scene.ui").isPointerOver() and under(self, wx, wy) then
		local x, y = body:getGlobalPosition()
		self._dragging, self._ox, self._oy = true, x - wx, y - wy
		body:emit("dragStarted")
	end
end

---True while the player is dragging the parent.
function Draggable:isDragging()
	return self._dragging == true
end
